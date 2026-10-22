import type { ErrorReport, ErrorSource } from '@homeradar/shared/api/types';
import { scrubPaths } from '@homeradar/shared/api/paths';
import { sanitizeError } from '@homeradar/shared/core/report';
import type { Env } from './env';

/** I gruppi d'errore fermi da più di così si cancellano. */
export const ERROR_TTL_MS = 90 * 86_400_000;
/** Errori salvati al più per ora: per agente con sessione, per dispositivo, per IP senza sessione e senza sessione in tutto. */
export const QUOTA = { user: 100, device: 100, ip: 30, anonymous: 200 } as const;

const HOUR_MS = 3_600_000;
const SAFE_VERSION = /^[A-Za-z0-9._-]{1,40}$/;
/** Un'ora del client fuori da questa finestra (orologio sbagliato) diventa quella del server. */
const CLIENT_CLOCK_MS = 7 * 86_400_000;

export interface ErrorOrigin {
  source: ErrorSource;
  version: string;
  userId?: string;
  deviceId?: string;
  deviceName?: string;
}

/** Quanti dei `wanted` errori si possono salvare in quest'ora per `bucket`; li conta tutti, anche gli scartati. */
export async function takeQuota(db: D1Database, bucket: string, wanted: number, max: number, now: number): Promise<number> {
  const r = await db
    .prepare('INSERT INTO error_quota (bucket, hour, n) VALUES (?, ?, ?) ON CONFLICT (bucket, hour) DO UPDATE SET n = n + excluded.n RETURNING n')
    .bind(bucket, Math.floor(now / HOUR_MS), wanted)
    .first<{ n: number }>();
  const before = (r?.n ?? wanted) - wanted;
  return Math.max(0, Math.min(wanted, max - before));
}

/** Somma gli errori ai loro gruppi; intanto toglie i gruppi vecchi e le quote passate. */
export async function recordErrors(db: D1Database, origin: ErrorOrigin, errors: ErrorReport['errors'], now: number): Promise<void> {
  const upsert = db.prepare(
    `INSERT INTO errors (source, version, message, user_id, device_id, device_name, context, count, first_at, last_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (source, version, message, user_id, device_id) DO UPDATE SET
       count = count + 1, last_at = MAX(last_at, excluded.last_at), context = COALESCE(excluded.context, context), device_name = excluded.device_name`,
  );
  // Commit o versione del manifest: si tiene com'è (sanitizeError storpierebbe le cifre); altro testo no.
  const version = SAFE_VERSION.test(origin.version) ? origin.version : 'sconosciuta';
  const clean = (text: string) => sanitizeError(scrubPaths(text));
  await db.batch([
    ...errors.map((e) => {
      const at = e.at > now || e.at < now - CLIENT_CLOCK_MS ? now : e.at;
      return upsert.bind(
        origin.source, version, clean(e.message), origin.userId ?? '', origin.deviceId ?? '', origin.deviceName ?? null,
        e.context ? clean(e.context) : null, at, at,
      );
    }),
    db.prepare('DELETE FROM errors WHERE last_at < ?').bind(now - ERROR_TTL_MS),
    db.prepare('DELETE FROM error_quota WHERE hour < ?').bind(Math.floor(now / HOUR_MS) - 1),
  ]);
}

/**
 * Gruppi d'errore di un agente che si elimina: diventano anonimi sommandosi a quelli anonimi uguali (stessi
 * provenienza, versione e messaggio), così nessun conteggio si perde.
 */
export function anonymizeErrors(db: D1Database, userId: string): D1PreparedStatement[] {
  return [
    // WHERE true: in SQLite un INSERT … SELECT con ON CONFLICT lo richiede per non confondere la sintassi.
    db.prepare(`INSERT INTO errors (source, version, message, user_id, device_id, device_name, context, count, first_at, last_at)
      SELECT source, version, message, '', '', NULL, MAX(context), SUM(count), MIN(first_at), MAX(last_at)
      FROM errors WHERE user_id = ? AND true GROUP BY source, version, message
      ON CONFLICT (source, version, message, user_id, device_id) DO UPDATE SET
        count = count + excluded.count, first_at = MIN(first_at, excluded.first_at), last_at = MAX(last_at, excluded.last_at),
        context = COALESCE(context, excluded.context)`).bind(userId),
    db.prepare('DELETE FROM errors WHERE user_id = ?').bind(userId),
  ];
}

/** Errore non gestito di una rotta: va nella tabella come gli altri. Non lancia mai: resta comunque la console. */
export async function recordServerError(env: Env, err: unknown, path: string, now: number): Promise<void> {
  try {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await recordErrors(env.DB, { source: 'server', version: env.VERSION ?? 'dev' }, [{ message, context: path, at: now }], now);
  } catch (e) {
    console.error(e);
  }
}
