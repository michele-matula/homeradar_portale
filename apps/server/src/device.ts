import type { Env } from './env';
import { hashToken, newToken } from './crypto';
import { fail, route, type Handler, type Route } from './http';
import { findUserById, type UserRow } from './users';

/** `last_seen_at` del dispositivo si scrive al più una volta ogni tanto, come quello dell'utente. */
const LAST_SEEN_EVERY_MS = 10 * 60_000;
const NOT_LINKED = 'Connettore non collegato';

/** Nuovo dispositivo dell'utente: il token si restituisce una volta sola, nel database c'è solo il suo hash. */
export async function insertDevice(db: D1Database, userId: string, name: string, now: number): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  const token = newToken();
  await db
    .prepare('INSERT INTO devices (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, userId, name, await hashToken(token), now)
    .run();
  return { id, token };
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
