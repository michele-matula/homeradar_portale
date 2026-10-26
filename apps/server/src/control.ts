import type {
  ControlDevice, ControlRow, ControlRun, ControlSweep, ErrorGroup, ErrorSource, Health, UserStatus,
} from '@homeradar/shared/api/types';
import type { SearchErrorReason } from '@homeradar/shared/core/sweep';
import type { Portal, SearchSpec, SweepOutcome } from '@homeradar/shared/shared/types';
import { ERROR_TTL_MS } from './errors';

const DAY_MS = 86_400_000;
/** Oltre questo silenzio un connettore, o un agente, è da guardare. */
export const QUIET_MS = 7 * DAY_MS;
/** Righe d'errore lette al più per una pagina: bastano per gli ultimi 90 giorni di un pilota. */
const MAX_ERROR_ROWS = 2000;

const OUTCOME_TEXT: Record<Exclude<SweepOutcome, 'completed'>, string> = { partial: 'parziale', stopped: 'fermato', interrupted: 'interrotto' };
const days = (now: number, t: number) => Math.floor((now - t) / DAY_MS);

/** Colore e motivi di un agente: rosso se non può funzionare, arancio se qualcosa va guardato. Unico posto delle regole. */
export function controlHealth(r: Omit<ControlRow, 'health' | 'reasons'>, now: number): { health: Health; reasons: string[] } {
  const found: [Health, string][] = [];
  if (!r.devices.length) found.push(['bad', 'Nessun connettore']);
  else if (!r.devices.some((d) => d.lastGoodSweepAt != null)) found.push(['bad', 'Nessun giro riuscito']);
  for (const d of r.devices) {
    const seen = d.lastSeenAt ?? d.createdAt;
    if (now - seen > QUIET_MS) found.push(['warn', `Connettore ${d.name} muto da ${days(now, seen)} giorni`]);
  }
  const s = r.lastSweep;
  if (!s) found.push(['bad', 'Mai fatto un giro']);
  // Un giro in corso non è un problema: si giudica quando finisce.
  else if (s.finishedAt != null) {
    if (s.outcome && s.outcome !== 'completed') found.push(['warn', `Ultimo giro: ${OUTCOME_TEXT[s.outcome]}`]);
    if (s.problems > 0) found.push(['warn', `Ultimo giro: ${s.problems} ${s.problems === 1 ? 'ricerca' : 'ricerche'} con problemi`]);
  }
  if (r.errors7d > 0) found.push(['warn', `${r.errors7d} ${r.errors7d === 1 ? 'errore diverso' : 'errori diversi'} negli ultimi 7 giorni`]);
  if (r.lastSeenAt == null) found.push(['warn', 'Mai entrato']);
  else if (now - r.lastSeenAt > QUIET_MS) found.push(['warn', `Nessun accesso da ${days(now, r.lastSeenAt)} giorni`]);
  const health: Health = found.some(([h]) => h === 'bad') ? 'bad' : found.length ? 'warn' : 'ok';
  return { health, reasons: found.map(([, t]) => t) };
}

interface SweepRow {
  id: string;
  user_id: string;
  started_at: number;
  finished_at: number | null;
  outcome: SweepOutcome | null;
  device_name: string | null;
  searches: number;
  problems: number;
  trigger: 'manual' | 'auto';
}

const SWEEP_COLUMNS = `s.id, s.user_id, s.started_at, s.finished_at, s.outcome, s.trigger, d.name AS device_name,
  (SELECT COUNT(*) FROM search_runs r WHERE r.sweep_id = s.id) AS searches,
  (SELECT COUNT(*) FROM search_runs r WHERE r.sweep_id = s.id AND r.status IN ('blocked', 'error')) AS problems
  FROM sweeps s LEFT JOIN devices d ON d.id = s.device_id`;

const toSweep = (s: SweepRow): ControlSweep => ({
  id: s.id, startedAt: s.started_at, finishedAt: s.finished_at, outcome: s.outcome, deviceName: s.device_name, searches: s.searches, problems: s.problems,
  auto: s.trigger === 'auto',
});

/** Righe di «Controllo» (o di un solo agente): un numero fisso di query, qualunque sia il numero di agenti. */
export async function controlRows(db: D1Database, now: number, userId?: string): Promise<ControlRow[]> {
  const { results: users } = await db
    .prepare(`SELECT id, email, status, last_seen_at FROM users WHERE role = 'agent' ${userId ? 'AND id = ?' : ''}
      ORDER BY CASE status WHEN 'suspended' THEN 1 ELSE 0 END, email`)
    .bind(...(userId ? [userId] : []))
    .all<{ id: string; email: string; status: UserStatus; last_seen_at: number | null }>();
  if (!users.length) return [];
  const ids = JSON.stringify(users.map((u) => u.id));
  const [devices, lastSweeps, recent, errors] = await db.batch([
    db.prepare(`SELECT d.id, d.user_id, d.name, d.version, d.created_at, d.last_seen_at,
        (SELECT MAX(s.finished_at) FROM sweeps s WHERE s.device_id = d.id AND s.outcome = 'completed'
          AND NOT EXISTS (SELECT 1 FROM search_runs r WHERE r.sweep_id = s.id AND r.status IN ('blocked', 'error'))) AS last_good
      FROM devices d WHERE d.user_id IN (SELECT value FROM json_each(?)) ORDER BY d.created_at`).bind(ids),
    db.prepare(`SELECT ${SWEEP_COLUMNS}
      WHERE s.id IN (SELECT (SELECT x.id FROM sweeps x WHERE x.user_id = u.value ORDER BY x.started_at DESC LIMIT 1) FROM json_each(?) u)`).bind(ids),
    db.prepare('SELECT user_id, COUNT(*) AS n FROM sweeps WHERE started_at > ? AND user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id')
      .bind(now - 30 * DAY_MS, ids),
    db.prepare('SELECT user_id, COUNT(*) AS n FROM errors WHERE last_at > ? AND user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id')
      .bind(now - QUIET_MS, ids),
  ]);
  type DeviceRow = { id: string; user_id: string; name: string; version: string | null; created_at: number; last_seen_at: number | null; last_good: number | null };
  const byUser = <T extends { user_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]);
    return m;
  };
  const devs = byUser(devices!.results as DeviceRow[]);
  const sweeps = new Map((lastSweeps!.results as SweepRow[]).map((s) => [s.user_id, s]));
  const counts = (rows: unknown[]) => new Map((rows as { user_id: string; n: number }[]).map((r) => [r.user_id, r.n]));
  const sweeps30 = counts(recent!.results);
  const errs = counts(errors!.results);
  return users.map((u) => {
    const base = {
      userId: u.id, email: u.email, status: u.status, lastSeenAt: u.last_seen_at,
      devices: (devs.get(u.id) ?? []).map((d): ControlDevice => ({
        id: d.id, name: d.name, version: d.version, createdAt: d.created_at, lastSeenAt: d.last_seen_at, lastGoodSweepAt: d.last_good,
      })),
      lastSweep: sweeps.has(u.id) ? toSweep(sweeps.get(u.id)!) : null,
      sweeps30d: sweeps30.get(u.id) ?? 0,
      errors7d: errs.get(u.id) ?? 0,
    };
    return { ...base, ...controlHealth(base, now) };
  });
}

/** Ultimi giri dell'agente, dal più recente. */
export async function agentSweeps(db: D1Database, userId: string, limit: number): Promise<ControlSweep[]> {
  const { results } = await db.prepare(`SELECT ${SWEEP_COLUMNS} WHERE s.user_id = ? ORDER BY s.started_at DESC LIMIT ?`).bind(userId, limit).all<SweepRow>();
  return results.map(toSweep);
}

/** Ricerche di un giro, nell'ordine in cui sono state pianificate. */
export async function sweepRuns(db: D1Database, sweepId: string): Promise<ControlRun[]> {
  const { results } = await db
    .prepare('SELECT search_key, portal, spec, status, pages, privates, reason FROM search_runs WHERE sweep_id = ? ORDER BY id')
    .bind(sweepId)
    .all<{ search_key: string; portal: Portal; spec: string; status: string; pages: number; privates: number; reason: SearchErrorReason | null }>();
  return results.map((r) => ({
    searchKey: r.search_key, portal: r.portal, label: (JSON.parse(r.spec) as SearchSpec).label, status: r.status, pages: r.pages, privates: r.privates,
    reason: r.reason,
  }));
}

/** Errori degli ultimi 90 giorni, una riga per (provenienza, versione, messaggio), dalla più recente. */
export async function errorGroups(db: D1Database, now: number, f: { source?: ErrorSource; userId?: string } = {}): Promise<ErrorGroup[]> {
  const where = ['e.last_at >= ?'];
  const args: unknown[] = [now - ERROR_TTL_MS];
  if (f.source) {
    where.push('e.source = ?');
    args.push(f.source);
  }
  if (f.userId) {
    where.push('e.user_id = ?');
    args.push(f.userId);
  }
  const { results } = await db
    .prepare(`SELECT e.source, e.version, e.message, e.count, e.first_at, e.last_at, e.context, e.device_id, e.device_name, u.email,
        d.id IS NOT NULL AS device_exists
      FROM errors e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN devices d ON d.id = e.device_id
      WHERE ${where.join(' AND ')} ORDER BY e.last_at DESC LIMIT ${MAX_ERROR_ROWS}`)
    .bind(...args)
    .all<{
      source: ErrorSource; version: string; message: string; count: number; first_at: number; last_at: number; context: string | null;
      device_id: string; device_name: string | null; email: string | null; device_exists: number;
    }>();
  const groups = new Map<string, ErrorGroup>();
  for (const r of results) {
    const key = JSON.stringify([r.source, r.version, r.message]);
    let g = groups.get(key);
    // Le righe arrivano dalla più recente: la prima di un gruppo ne dà il contesto.
    if (!g) {
      g = { source: r.source, version: r.version, message: r.message, count: 0, firstAt: r.first_at, lastAt: r.last_at, context: r.context, agents: [], devices: [] };
      groups.set(key, g);
    }
    g.count += r.count;
    g.firstAt = Math.min(g.firstAt, r.first_at);
    if (r.email && !g.agents.includes(r.email)) g.agents.push(r.email);
    if (r.device_id) {
      const dev = { name: r.device_name, revoked: !r.device_exists };
      if (!g.devices.some((x) => x.name === dev.name && x.revoked === dev.revoked)) g.devices.push(dev);
    }
  }
  return [...groups.values()];
}
