import type { Batch } from '@homeradar/shared/api/connector';
import { DEFAULT_CALIBRATION, mergeCalibration, type IdDate } from '@homeradar/shared/core/age';
import { learnedPoint, mergeObservation } from '@homeradar/shared/core/ingest';
import { acceptObservation, searchCategory } from '@homeradar/shared/core/searches';
import { listingKey, type ListingObservation, type Portal, type SearchSpec } from '@homeradar/shared/shared/types';
import { insertSnapshot, listingsByKeys, upsertListing } from './archive';
import { fail, json } from './http';
import { maybeApplyMissing } from './sweeps';
import type { UserRow } from './users';

export const MAX_BATCH_BYTES = 512 * 1024;
export const MAX_BATCHES_PER_MINUTE = 30;
/** La coda del connettore ritenta per 24 ore: gli id dei lotti si ricordano per il doppio. */
const BATCH_ID_TTL_MS = 48 * 3_600_000;

interface RunRow {
  id: number;
  portal: Portal;
  spec: string;
}

/** Ultimo prezzo salvato di ciascun annuncio. */
async function lastPrices(db: D1Database, keys: string[]): Promise<Map<string, number>> {
  const { results } = await db
    .prepare('SELECT listing_key, price FROM price_snapshots WHERE listing_key IN (SELECT value FROM json_each(?)) ORDER BY at')
    .bind(JSON.stringify(keys))
    .all<{ listing_key: string; price: number }>();
  return new Map(results.map((r) => [r.listing_key, r.price]));
}

async function learnedPoints(db: D1Database, portal: Portal): Promise<IdDate[]> {
  const { results } = await db.prepare('SELECT portal_id, created_at FROM calibration_points WHERE portal = ?').bind(portal).all<{ portal_id: number; created_at: number }>();
  return results.map((r) => ({ portalId: r.portal_id, createdAt: r.created_at }));
}

const duplicate = (e: unknown) => e instanceof Error && /UNIQUE constraint failed: batches\.id/.test(e.message);

/**
 * Una pagina letta dal connettore. Tutte le scritture vanno in un solo batch, insieme all'id del lotto: un lotto
 * ripetuto (anche in parallelo) non scrive nulla due volte. Un giro chiuso accetta ancora i lotti arrivati in ritardo.
 */
export async function ingestBatch(db: D1Database, user: UserRow, deviceId: string, b: Batch, now: number): Promise<Response> {
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM batches WHERE device_id = ? AND received_at > ?').bind(deviceId, now - 60_000).first<number>('n');
  if ((recent ?? 0) >= MAX_BATCHES_PER_MINUTE) return fail(429, 'Troppi invii: riprova fra poco');
  if (await db.prepare('SELECT 1 AS x FROM batches WHERE id = ?').bind(b.id).first()) return json({ ok: true });

  const sweep = await db.prepare('SELECT started_at FROM sweeps WHERE id = ? AND user_id = ?').bind(b.sweepId, user.id).first<{ started_at: number }>();
  if (!sweep) return fail(404, 'Giro non trovato');
  const run = await db.prepare('SELECT id, portal, spec FROM search_runs WHERE sweep_id = ? AND search_key = ?').bind(b.sweepId, b.searchKey).first<RunRow>();
  if (!run) return fail(400, 'Ricerca non nel piano');
  if (b.observations.some((o) => o.portal !== run.portal)) return fail(400, 'Annuncio di un altro portale');

  const spec = JSON.parse(run.spec) as SearchSpec;
  const at = Math.min(Math.max(b.readAt, sweep.started_at), now);
  const accepted = new Map<string, ListingObservation>();
  for (const o of b.observations) if (acceptObservation(spec, o)) accepted.set(listingKey(o.portal, o.portalId), o);
  const keys = [...accepted.keys()];
  const [prevList, prices, learned] = await Promise.all([listingsByKeys(db, keys), lastPrices(db, keys), learnedPoints(db, run.portal)]);
  const prev = new Map(prevList.map((l) => [l.key, l]));

  // Le date dichiarate dal portale sono punti di calibrazione esatti, da usare già per questo lotto.
  const dated = b.observations.filter((o) => o.portalCreatedAt != null).map((o) => ({ portalId: o.portalId, createdAt: o.portalCreatedAt! }));
  let points = mergeCalibration(DEFAULT_CALIBRATION[run.portal], [...learned, ...dated]);
  const hinted = b.newestId ? learnedPoint({ portal: run.portal, portalId: b.newestId }, points, at) : null;
  if (hinted) points = mergeCalibration(points, [hinted]);

  const writes: D1PreparedStatement[] = [
    db.prepare('INSERT INTO batches (id, device_id, received_at) VALUES (?, ?, ?)').bind(b.id, deviceId, now),
    db.prepare('DELETE FROM batches WHERE received_at < ?').bind(now - BATCH_ID_TTL_MS),
  ];
  for (const p of [...dated, ...(hinted ? [hinted] : [])]) {
    writes.push(db.prepare('INSERT OR REPLACE INTO calibration_points (portal, portal_id, created_at) VALUES (?, ?, ?)').bind(run.portal, p.portalId, p.createdAt));
  }
  let drops = 0;
  const ctx = { at, sweepScope: b.searchKey, searchCategory: searchCategory(spec), points };
  for (const [key, o] of accepted) {
    const m = mergeObservation(prev.get(key) ?? null, o, ctx, prices.get(key) ?? null);
    if (!m) continue;
    if (m.dropped) drops++;
    writes.push(upsertListing(db, m.record), ...m.snapshots.map((s) => insertSnapshot(db, s)));
  }
  // Visti anche gli annunci scartati per categoria: sono ancora online e non devono risultare mancati.
  for (const o of b.observations) {
    writes.push(db.prepare('INSERT OR IGNORE INTO run_seen (run_id, listing_key) VALUES (?, ?)').bind(run.id, listingKey(o.portal, o.portalId)));
  }
  writes.push(
    // Pagine distinte: una pagina riletta dopo un errore non conta come una pagina in più.
    db.prepare('INSERT OR IGNORE INTO run_pages (run_id, page) VALUES (?, ?)').bind(run.id, b.page),
    db.prepare(`UPDATE search_runs SET pages_received = (SELECT COUNT(*) FROM run_pages WHERE run_id = ?1), privates = privates + ?2,
      status = CASE WHEN status = 'pending' THEN 'running' ELSE status END, started_at = COALESCE(started_at, ?3) WHERE id = ?1`).bind(run.id, b.report.privates, at),
    db.prepare('UPDATE sweeps SET last_activity_at = ?, drops = drops + ? WHERE id = ?').bind(now, drops, b.sweepId),
  );
  try {
    await db.batch(writes);
  } catch (e) {
    // Due copie dello stesso lotto in parallelo: la seconda si annulla per intero.
    if (duplicate(e)) return json({ ok: true });
    throw e;
  }
  await maybeApplyMissing(db, run.id, now);
  return json({ ok: true });
}
