import type { SweepPlan } from '@homeradar/shared/api/connector';
import { searchesFor } from '@homeradar/shared/core/searches';
import type { SweepOutcome, SweepResult } from '@homeradar/shared/shared/types';
import { fail } from './http';
import { getSettings } from './settings';
import { toComuneRefs, type UserRow } from './users';

/** Una ricerca avviata da un altro agente da meno di così è "in corso": non si rifà. */
export const RUNNING_SKIP_MS = 15 * 60_000;
/** Un giro senza lotti né esiti da così è interrotto (connettore chiuso, PC spento). */
export const SWEEP_STALE_MS = 15 * 60_000;

export async function freshnessMinutes(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT value FROM config WHERE key = 'freshness_minutes'").first<{ value: string }>();
  return Number(r?.value ?? 60);
}

/** Chiude il giro: lo completa il Task 9 con il risultato. Un giro già chiuso resta com'è. */
export async function finishSweep(db: D1Database, sweepId: string, outcome: SweepOutcome, now: number): Promise<SweepResult | null> {
  await db.prepare('UPDATE sweeps SET finished_at = ?, outcome = ? WHERE id = ? AND finished_at IS NULL').bind(now, outcome, sweepId).run();
  return null;
}

/** Giri dell'utente rimasti aperti senza attività: interrotti. */
export async function closeStaleSweeps(db: D1Database, userId: string, now: number): Promise<void> {
  const { results } = await db
    .prepare('SELECT id FROM sweeps WHERE user_id = ? AND finished_at IS NULL AND last_activity_at < ?')
    .bind(userId, now - SWEEP_STALE_MS)
    .all<{ id: string }>();
  for (const s of results) await finishSweep(db, s.id, 'interrupted', now);
}

/**
 * Piano del giro: le ricerche della zona e dei portali dell'agente, tranne quelle fresche (complete di chiunque negli
 * ultimi minuti di freschezza) e quelle in corso per un altro agente. Il piano non dice chi le ha fatte.
 */
export async function startSweep(db: D1Database, user: UserRow, deviceId: string, now: number): Promise<SweepPlan | Response> {
  await closeStaleSweeps(db, user.id, now);
  const open = await db.prepare('SELECT id, device_id FROM sweeps WHERE user_id = ? AND finished_at IS NULL').bind(user.id).all<{ id: string; device_id: string | null }>();
  if (open.results.some((s) => s.device_id !== deviceId)) return fail(409, 'Giro già in corso su un altro computer');
  for (const s of open.results) await finishSweep(db, s.id, 'interrupted', now);

  const comuni = toComuneRefs(user.comuni);
  if (!comuni.length) return fail(400, "Nessun comune assegnato: chiedi all'amministratore");
  const settings = await getSettings(db, user.id);
  const specs = searchesFor({ comuni, categories: settings.categories }, settings.enabledPortals);
  const { results: busy } = await db
    .prepare(`SELECT DISTINCT search_key FROM search_runs WHERE search_key IN (SELECT value FROM json_each(?1))
      AND ((status = 'complete' AND finished_at > ?2) OR (status = 'running' AND started_at > ?3 AND user_id IS NOT ?4))`)
    .bind(JSON.stringify(specs.map((s) => s.key)), now - (await freshnessMinutes(db)) * 60_000, now - RUNNING_SKIP_MS, user.id)
    .all<{ search_key: string }>();
  const skip = new Set(busy.map((r) => r.search_key));
  const searches = specs.filter((s) => !skip.has(s.key));
  if (!searches.length) return { sweepId: null, searches: [], skipped: specs.length };

  const sweepId = crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO sweeps (id, user_id, device_id, started_at, last_activity_at) VALUES (?, ?, ?, ?, ?)').bind(sweepId, user.id, deviceId, now, now),
    ...searches.map((s) =>
      db.prepare("INSERT INTO search_runs (sweep_id, search_key, portal, spec, user_id, status) VALUES (?, ?, ?, ?, ?, 'pending')").bind(sweepId, s.key, s.portal, JSON.stringify(s), user.id),
    ),
  ]);
  return { sweepId, searches, skipped: specs.length - searches.length };
}

/** "Non più visto" per una ricerca completa: lo completa il Task 9. */
export async function maybeApplyMissing(_db: D1Database, _runId: number, _now: number): Promise<void> {}
