import type { Role, UserStatus } from '@homeradar/shared/api/types';
import { normalizeEmail } from '@homeradar/shared/api/types';
import { comuneInfo, toRef } from '@homeradar/shared/core/comuni';
import type { ComuneRef } from '@homeradar/shared/shared/types';
import { hashToken, newToken } from './crypto';

export const INVITE_TTL_MS = 7 * 86_400_000;
export const RESET_TTL_MS = 3_600_000;

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string | null;
  role: Role;
  status: UserStatus;
  comuni: string[];
  maxComuni: number;
  privacyVersion: number | null;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
}

interface DbUser {
  id: string;
  email: string;
  password_hash: string | null;
  role: Role;
  status: UserStatus;
  comuni: string;
  max_comuni: number;
  privacy_version: number | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number | null;
}

export class EmailTaken extends Error {}

const fromDb = (r: DbUser): UserRow => ({
  id: r.id,
  email: r.email,
  passwordHash: r.password_hash,
  role: r.role,
  status: r.status,
  comuni: JSON.parse(r.comuni) as string[],
  maxComuni: r.max_comuni,
  privacyVersion: r.privacy_version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastSeenAt: r.last_seen_at,
});

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  const r = await db.prepare('SELECT * FROM users WHERE email = ?').bind(normalizeEmail(email)).first<DbUser>();
  return r ? fromDb(r) : null;
}

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  const r = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<DbUser>();
  return r ? fromDb(r) : null;
}

export async function insertUser(db: D1Database, u: { email: string; role: Role; comuni: string[]; maxComuni: number }, now: number): Promise<UserRow> {
  const email = normalizeEmail(u.email);
  if (await findUserByEmail(db, email)) throw new EmailTaken(email);
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, role, status, comuni, max_comuni, created_at, updated_at) VALUES (?, ?, ?, 'invited', ?, ?, ?, ?)")
    .bind(id, email, u.role, JSON.stringify(u.comuni), u.maxComuni, now, now)
    .run();
  return (await findUserById(db, id))!;
}

/** Nuovo link monouso; quelli non usati dello stesso tipo smettono di valere. */
export async function issueToken(db: D1Database, userId: string, kind: 'invite' | 'reset', now: number): Promise<string> {
  const token = newToken();
  const ttl = kind === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS;
  await db.batch([
    db.prepare('UPDATE tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL').bind(now, userId, kind),
    db.prepare('INSERT INTO tokens (token_hash, user_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(await hashToken(token), userId, kind, now + ttl, now),
  ]);
  return token;
}

export async function readToken(db: D1Database, token: string, now: number): Promise<{ user: UserRow; kind: 'invite' | 'reset' } | null> {
  const t = await db
    .prepare('SELECT user_id, kind FROM tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
    .bind(await hashToken(token), now)
    .first<{ user_id: string; kind: 'invite' | 'reset' }>();
  if (!t) return null;
  const user = await findUserById(db, t.user_id);
  return user ? { user, kind: t.kind } : null;
}

export async function consumeToken(db: D1Database, token: string, now: number): Promise<void> {
  await db.prepare('UPDATE tokens SET used_at = ? WHERE token_hash = ?').bind(now, await hashToken(token)).run();
}

export function toComuneRefs(istat: string[]): ComuneRef[] {
  return istat.flatMap((code) => {
    const c = comuneInfo(code);
    return c ? [toRef(c)] : [];
  });
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const { results } = await db.prepare('SELECT * FROM users ORDER BY email').all<DbUser>();
  return results.map(fromDb);
}
