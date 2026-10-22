import type { DeviceInfo } from '@homeradar/shared/api/connector';
import type { Env } from './env';
import { hashToken, newToken } from './crypto';
import { fail, route, type Handler, type Route } from './http';
import { findUserById, type UserRow } from './users';

/** `last_seen_at` del dispositivo si scrive al più una volta ogni tanto, come quello dell'utente. */
const LAST_SEEN_EVERY_MS = 10 * 60_000;
const NOT_LINKED = 'Connettore non collegato';

/** Codice che il portale passa al connettore per collegarlo: monouso. */
export const LINK_CODE_TTL_MS = 5 * 60_000;

/** Nuovo dispositivo dell'utente: il token si restituisce una volta sola, nel database c'è solo il suo hash. */
export async function insertDevice(
  db: D1Database, userId: string, name: string, now: number, version: string | null = null,
): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  const token = newToken();
  await db
    .prepare('INSERT INTO devices (id, user_id, name, token_hash, version, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, userId, name, await hashToken(token), version, now)
    .run();
  return { id, token };
}

/** Codici non scaduti che un utente può avere insieme. */
export const MAX_OPEN_LINK_CODES = 5;

/** Codice di collegamento per l'utente; nel database c'è solo il suo hash. null se ne ha già troppi aperti. */
export async function createLinkCode(db: D1Database, userId: string, now: number): Promise<string | null> {
  const open = await db.prepare('SELECT COUNT(*) AS n FROM link_codes WHERE user_id = ? AND expires_at > ?').bind(userId, now).first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_LINK_CODES) return null;
  const code = newToken();
  await db.batch([
    db.prepare('DELETE FROM link_codes WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO link_codes (code_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await hashToken(code), userId, now + LINK_CODE_TTL_MS),
  ]);
  return code;
}

/** Contatto del connettore: nome, versione e ultimo contatto, sempre (non ogni tanto come le altre richieste). */
export async function touchDevice(db: D1Database, deviceId: string, name: string, version: string, now: number): Promise<void> {
  await db.prepare('UPDATE devices SET name = ?, version = ?, last_seen_at = ? WHERE id = ?').bind(name, version, now, deviceId).run();
}

/**
 * Il browser si ricollega con il token che aveva: i giri del dispositivo vecchio passano al nuovo, che lo sostituisce.
 * Solo se il vecchio è dello stesso utente; altrimenti non cambia niente.
 */
export async function replaceDevice(db: D1Database, userId: string, previousToken: string, newId: string): Promise<void> {
  const old = await db.prepare('SELECT id FROM devices WHERE token_hash = ? AND user_id = ? AND id <> ?')
    .bind(await hashToken(previousToken), userId, newId)
    .first<{ id: string }>();
  if (!old) return;
  await db.batch([
    db.prepare('UPDATE sweeps SET device_id = ? WHERE device_id = ?').bind(newId, old.id),
    db.prepare('DELETE FROM devices WHERE id = ?').bind(old.id),
  ]);
}

/** Utente del codice, che si consuma: due richieste con lo stesso codice non passano entrambe. null se scaduto o ignoto. */
export async function redeemLinkCode(db: D1Database, code: string, now: number): Promise<string | null> {
  const r = await db.prepare('DELETE FROM link_codes WHERE code_hash = ? AND expires_at > ? RETURNING user_id')
    .bind(await hashToken(code), now)
    .first<{ user_id: string }>();
  return r?.user_id ?? null;
}

export async function listDevices(db: D1Database, userId: string): Promise<DeviceInfo[]> {
  const { results } = await db
    .prepare('SELECT id, name, created_at, last_seen_at FROM devices WHERE user_id = ? ORDER BY created_at')
    .bind(userId)
    .all<{ id: string; name: string; created_at: number; last_seen_at: number | null }>();
  return results.map((d) => ({ id: d.id, name: d.name, createdAt: d.created_at, lastSeenAt: d.last_seen_at }));
}

/** Scollega un dispositivo dell'utente; false se non è suo. I suoi giri restano, senza dispositivo. */
export async function deleteDevice(db: D1Database, userId: string, id: string): Promise<boolean> {
  // RETURNING, non meta.changes: D1 conta anche i giri aggiornati da ON DELETE SET NULL.
  const r = await db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ? RETURNING id').bind(id, userId).first();
  return r != null;
}

export interface DeviceAuth {
  user: UserRow;
  deviceId: string;
}

/** Il connettore si presenta con `Authorization: Bearer <token>`; il cookie del portale non vale qui. */
export async function authenticateDevice(req: Request, env: Env, now: number): Promise<DeviceAuth | Response> {
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.get('Authorization') ?? '');
  if (!m) return fail(401, NOT_LINKED);
  const d = await env.DB.prepare('SELECT id, user_id, last_seen_at FROM devices WHERE token_hash = ?')
    .bind(await hashToken(m[1]!))
    .first<{ id: string; user_id: string; last_seen_at: number | null }>();
  const user = d && (await findUserById(env.DB, d.user_id));
  if (!d || !user) return fail(401, NOT_LINKED);
  // Un account sospeso non cancella i dispositivi: alla riattivazione il connettore funziona di nuovo.
  if (user.status !== 'active') return fail(403, 'Account sospeso');
  if (d.last_seen_at == null || now - d.last_seen_at > LAST_SEEN_EVERY_MS) {
    await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(now, d.id).run();
  }
  return { user, deviceId: d.id };
}

/** Rotta del connettore: l'handler riceve utente, dispositivo e istante della richiesta. */
export function deviceRoute(
  method: string, pattern: string, h: (req: Request, env: Env, params: Record<string, string>, ctx: DeviceAuth & { now: number }) => Promise<Response>,
): Route {
  const wrapped: Handler = async (req, env, params) => {
    const now = Date.now();
    const auth = await authenticateDevice(req, env, now);
    if (auth instanceof Response) return auth;
    return h(req, env, params, { ...auth, now });
  };
  return route(method, pattern, wrapped);
}
