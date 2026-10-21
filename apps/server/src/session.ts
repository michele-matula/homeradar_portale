import type { Env } from './env';
import { hashToken, newToken } from './crypto';
import { fail } from './http';
import { findUserById, type UserRow } from './users';

export const SESSION_COOKIE = 'hr_session';
export const SESSION_TTL_MS = 30 * 86_400_000;
export const RENEW_BELOW_MS = 15 * 86_400_000;
/** `last_seen_at` si scrive al più una volta ogni tanto: non serve una scrittura per richiesta. */
const LAST_SEEN_EVERY_MS = 10 * 60_000;

const cookie = (value: string, maxAgeS: number) => `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeS}`;

export const clearCookie = (): string => cookie('', 0);

/** Nuova sessione: restituisce l'header Set-Cookie. */
export async function createSession(db: D1Database, userId: string, now: number): Promise<string> {
  const token = newToken();
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await hashToken(token), userId, now, now + SESSION_TTL_MS)
    .run();
  return cookie(token, SESSION_TTL_MS / 1000);
}

export function sessionToken(req: Request): string | null {
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return v.join('=') || null;
  }
  return null;
}

export type AuthResult = { user: UserRow; setCookie?: string } | Response;

export async function authenticate(req: Request, env: Env, now: number): Promise<AuthResult> {
  const token = sessionToken(req);
  if (!token) return fail(401, 'Accesso richiesto');
  const hash = await hashToken(token);
  const s = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(hash, now)
    .first<{ user_id: string; expires_at: number }>();
  const user = s && (await findUserById(env.DB, s.user_id));
  if (!s || !user) return fail(401, 'Accesso richiesto');
  if (user.status !== 'active') {
    const r = fail(403, 'Account sospeso');
    r.headers.set('Set-Cookie', clearCookie());
    return r;
  }
  let setCookie: string | undefined;
  if (s.expires_at - now < RENEW_BELOW_MS) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_TTL_MS, hash).run();
    setCookie = cookie(token, SESSION_TTL_MS / 1000);
  }
  if (user.lastSeenAt == null || now - user.lastSeenAt > LAST_SEEN_EVERY_MS) {
    await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now, user.id).run();
    user.lastSeenAt = now;
  }
  return { user, setCookie };
}

export async function endSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

export async function endSession(req: Request, db: D1Database): Promise<void> {
  const token = sessionToken(req);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
}
