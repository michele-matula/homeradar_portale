import type { RunReport, SweepPlan } from '@homeradar/shared/api/connector';
import { isNewLead } from '@homeradar/shared/core/lead-groups';
import { MISSING_SWEEPS } from '@homeradar/shared/core/missing';
import { searchesFor } from '@homeradar/shared/core/searches';
import {
  PORTAL_TAGS, PORTALS,
  type Portal, type PortalSweepOutcome, type SearchSpec, type SweepOutcome, type SweepProgress, type SweepResult, type SweepStatus,
} from '@homeradar/shared/shared/types';
import { ZONE_FILTER, zoneParams } from './archive';
import { fail, json } from './http';
import { agentLeads } from './leads';
import { getSettings } from './settings';
import { findUserById, toComuneRefs, type UserRow } from './users';

/** Una ricerca avviata da un altro agente da meno di così è "in corso": non si rifà. */
export const RUNNING_SKIP_MS = 15 * 60_000;
/** Un giro senza lotti né esiti da così è interrotto (connettore chiuso, PC spento). */
export const SWEEP_STALE_MS = 15 * 60_000;

interface SweepRow {
  id: string;
  user_id: string | null;
  started_at: number;
  finished_at: number | null;
  outcome: SweepOutcome | null;
  drops: number;
  missing: number;
  result: string | null;
}

interface RunRow {
  id: number;
  search_key: string;
  portal: Portal;
  spec: string;
  status: string;
  started_at: number | null;
  pages: number;
  pages_received: number;
  privates: number;
  missing_applied: number;
}

export async function freshnessMinutes(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT value FROM config WHERE key = 'freshness_minutes'").first<{ value: string }>();
  return Number(r?.value ?? 60);
}

const runsOf = async (db: D1Database, sweepId: string) =>
  (await db.prepare('SELECT * FROM search_runs WHERE sweep_id = ? ORDER BY id').bind(sweepId).all<RunRow>()).results;

/** Esito del portale nel giro: una verifica lo ferma, poi gli errori, i tetti, le ricerche saltate. */
function portalOutcome(runs: RunRow[]): PortalSweepOutcome {
  const s = new Set(runs.map((r) => r.status));
  if (s.has('blocked')) return 'blocked';
  if (s.has('error')) return 'error';
  if (s.has('capped')) return 'capped';
  if (s.has('skipped') || s.has('pending') || s.has('running')) return 'skipped';
  return 'complete';
}

function portalTotals(runs: RunRow[]): Partial<Record<Portal, { pages: number; privates: number; runs: RunRow[] }>> {
  const out: Partial<Record<Portal, { pages: number; privates: number; runs: RunRow[] }>> = {};
  for (const p of PORTALS) {
    const own = runs.filter((r) => r.portal === p);
    if (own.length) out[p] = { pages: own.reduce((n, r) => n + r.pages_received, 0), privates: own.reduce((n, r) => n + r.privates, 0), runs: own };
  }
  return out;
}

/** Lead nuovi comparsi dall'inizio del giro, come li vede l'agente. */
async function newLeadsSince(db: D1Database, userId: string | null, since: number, now: number): Promise<number> {
  const user = userId ? await findUserById(db, userId) : null;
  if (!user) return 0;
  return (await agentLeads(db, user, now)).filter((v) => isNewLead(v, since)).length;
}

/**
 * Chiude il giro e ne salva il risultato: le ricerche non fatte diventano saltate. Un giro già chiuso restituisce il
 * risultato salvato. null se il giro non esiste.
 */
export async function finishSweep(db: D1Database, sweepId: string, outcome: SweepOutcome, now: number): Promise<SweepResult | null> {
  const s = await db.prepare('SELECT * FROM sweeps WHERE id = ?').bind(sweepId).first<SweepRow>();
  if (!s) return null;
  if (s.result) return JSON.parse(s.result) as SweepResult;
  await db.prepare("UPDATE search_runs SET status = 'skipped' WHERE sweep_id = ? AND status IN ('pending', 'running')").bind(sweepId).run();
  const runs = await runsOf(db, sweepId);
  const totals = portalTotals(runs);
  const result: SweepResult = {
    startedAt: s.started_at,
    finishedAt: s.finished_at ?? now,
    outcome: s.outcome ?? outcome,
    portals: Object.fromEntries(Object.entries(totals).map(([p, t]) => [p, { pages: t.pages, privates: t.privates, outcome: portalOutcome(t.runs) }])),
    notFound: runs.filter((r) => r.status === 'notFound').map((r) => `${(JSON.parse(r.spec) as SearchSpec).label} (${PORTAL_TAGS[r.portal]})`),
    newCount: await newLeadsSince(db, s.user_id, s.started_at, now),
    drops: s.drops,
    missing: s.missing,
  };
  await db.prepare('UPDATE sweeps SET finished_at = ?, outcome = ?, result = ? WHERE id = ?').bind(result.finishedAt, result.outcome, JSON.stringify(result), sweepId).run();
  return result;
}

/** Giri dell'utente rimasti aperti senza attività: interrotti. */
export async function closeStaleSweeps(db: D1Database, userId: string, now: number): Promise<void> {
  const { results } = await db
    .prepare('SELECT id FROM sweeps WHERE user_id = ? AND finished_at IS NULL AND last_activity_at < ?')
    .bind(userId, now - SWEEP_STALE_MS)
    .all<{ id: string }>();
  for (const s of results) await finishSweep(db, s.id, 'interrupted', now);
}

/** Giri aperti di un dispositivo che si scollega: interrotti. */
export async function closeDeviceSweeps(db: D1Database, userId: string, deviceId: string, now: number): Promise<void> {
  const { results } = await db
    .prepare('SELECT id FROM sweeps WHERE user_id = ? AND device_id = ? AND finished_at IS NULL')
    .bind(userId, deviceId)
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
  try {
    await db.batch([
      db.prepare('INSERT INTO sweeps (id, user_id, device_id, started_at, last_activity_at) VALUES (?, ?, ?, ?, ?)').bind(sweepId, user.id, deviceId, now, now),
      ...searches.map((s) =>
        db.prepare("INSERT INTO search_runs (sweep_id, search_key, portal, spec, user_id, status) VALUES (?, ?, ?, ?, ?, 'pending')").bind(sweepId, s.key, s.portal, JSON.stringify(s), user.id),
      ),
    ]);
  } catch (e) {
    // Due avvii nello stesso istante: l'indice sweeps_one_open lascia passare solo il primo.
    if (e instanceof Error && /UNIQUE constraint failed: sweeps\.user_id/.test(e.message)) return fail(409, 'Giro già in corso su un altro computer');
    throw e;
  }
  return { sweepId, searches, skipped: specs.length - searches.length };
}

/** Giro dell'utente e sua ricerca; la risposta d'errore se non ci sono. */
export async function findRun(db: D1Database, userId: string, sweepId: string, searchKey: string): Promise<RunRow | Response> {
  const sweep = await db.prepare('SELECT id FROM sweeps WHERE id = ? AND user_id = ?').bind(sweepId, userId).first();
  if (!sweep) return fail(404, 'Giro non trovato');
  const run = await db.prepare('SELECT * FROM search_runs WHERE sweep_id = ? AND search_key = ?').bind(sweepId, searchKey).first<RunRow>();
  return run ?? fail(400, 'Ricerca non nel piano');
}

/** Esito di una ricerca. Un esito ripetuto non cambia nulla; uno arrivato dopo la fine del giro sostituisce "saltata". */
export async function reportRun(db: D1Database, user: UserRow, r: RunReport, now: number): Promise<Response> {
  const run = await findRun(db, user.id, r.sweepId, r.searchKey);
  if (run instanceof Response) return run;
  await db.batch([
    db.prepare("UPDATE search_runs SET status = ?, pages = ?, privates = ?, reason = ?, finished_at = ? WHERE id = ? AND status IN ('pending', 'running', 'skipped')")
      .bind(r.outcome, r.pages, r.privates, r.reason ?? null, now, run.id),
    db.prepare('UPDATE sweeps SET last_activity_at = ? WHERE id = ?').bind(now, r.sweepId),
  ]);
  await maybeApplyMissing(db, run.id, now);
  return json({ ok: true });
}

/**
 * "Non più visto" per una ricerca completa, quando sono arrivate tutte le sue pagine: gli annunci della ricerca che non
 * c'erano contano un giro mancato. Chi è stato visto dopo l'inizio di questa ricerca (da un altro agente) non conta.
 * Le 24 ore senza avvistamenti le controlla `isMissing` alla lettura.
 */
export async function maybeApplyMissing(db: D1Database, runId: number, _now: number): Promise<void> {
  const run = await db.prepare('SELECT * FROM search_runs WHERE id = ?').bind(runId).first<RunRow & { sweep_id: string }>();
  if (!run || run.status !== 'complete' || run.missing_applied || run.pages_received < run.pages || run.started_at == null) return;
  // Si prende il diritto di applicarlo prima di farlo: due richieste in parallelo non contano due volte.
  const claim = await db.prepare('UPDATE search_runs SET missing_applied = 1 WHERE id = ? AND missing_applied = 0').bind(runId).run();
  if (claim.meta.changes !== 1) return;
  const { results } = await db
    .prepare(`UPDATE listings SET missed_sweeps = missed_sweeps + 1, missing_since = COALESCE(missing_since, ?1)
      WHERE sweep_scope = ?2 AND COALESCE(last_read_at, last_seen_at) < ?1 AND key NOT IN (SELECT listing_key FROM run_seen WHERE run_id = ?3) RETURNING missed_sweeps`)
    .bind(run.started_at, run.search_key, runId)
    .all<{ missed_sweeps: number }>();
  const gone = results.filter((r) => r.missed_sweeps === MISSING_SWEEPS).length;
  await db.batch([
    db.prepare('UPDATE sweeps SET missing = missing + ? WHERE id = ?').bind(gone, run.sweep_id),
    db.prepare('DELETE FROM run_seen WHERE run_id = ?').bind(runId),
  ]);
}

/** Giro in corso dell'utente e risultato dell'ultimo chiuso. Mai dati dei giri di altri. */
export async function sweepStatus(db: D1Database, user: UserRow, now: number): Promise<SweepStatus> {
  await closeStaleSweeps(db, user.id, now);
  const open = await db.prepare('SELECT * FROM sweeps WHERE user_id = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1').bind(user.id).first<SweepRow>();
  const last = await db.prepare('SELECT result FROM sweeps WHERE user_id = ? AND result IS NOT NULL ORDER BY finished_at DESC LIMIT 1').bind(user.id).first<{ result: string }>();
  return { running: open ? await progress(db, user, open) : null, last: last ? (JSON.parse(last.result) as SweepResult) : null };
}

async function progress(db: D1Database, user: UserRow, s: SweepRow): Promise<SweepProgress> {
  const runs = await runsOf(db, s.id);
  const current = runs.filter((r) => r.status === 'running').sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))[0];
  // Durante il giro basta un conteggio: annunci nuovi della zona, senza costruire i lead a ogni interrogazione.
  const comuni = toComuneRefs(user.comuni);
  const categories = (await getSettings(db, user.id)).categories;
  const newCount = comuni.length
    ? ((await db.prepare(`SELECT COUNT(*) AS n FROM listings l WHERE ${ZONE_FILTER} AND l.first_seen_at >= ?4`).bind(...zoneParams(comuni, categories), s.started_at).first<number>('n')) ?? 0)
    : 0;
  return {
    startedAt: s.started_at,
    total: runs.length,
    done: runs.filter((r) => r.status !== 'pending' && r.status !== 'running').length,
    current: current ? (JSON.parse(current.spec) as SearchSpec).label : null,
    portals: Object.fromEntries(Object.entries(portalTotals(runs)).map(([p, t]) => [p, { pages: t.pages, privates: t.privates }])),
    newCount,
    drops: s.drops,
  };
}
