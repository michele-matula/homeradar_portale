import { LoginBody, PRIVACY_VERSION, TokenBody, type Me, type TokenInfo } from '@homeradar/shared/api/types';
import { hashPassword, hashToken, verifyPassword } from '../crypto';
import { fail, json, readBody, route, type Route } from '../http';
import { clearFailures, recordFailure, tooManyAttempts } from '../rate-limit';
import { authenticate, clearCookie, createSession, endSession } from '../session';
import { findUserByEmail, readToken, toComuneRefs, type UserRow } from '../users';

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword(crypto.randomUUID()));

export const toMe = (u: UserRow): Me => ({ id: u.id, email: u.email, role: u.role, comuni: toComuneRefs(u.comuni) });

const withCookie = (res: Response, setCookie?: string): Response => {
  if (setCookie) res.headers.append('Set-Cookie', setCookie);
  return res;
};

const LINK_INVALID = 'Link non valido o scaduto';

export const authRoutes: Route[] = [
  route('POST', '/api/login', async (req, env) => {
    const body = await readBody(req, LoginBody);
    if (body instanceof Response) return body;
    const now = Date.now();
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (await tooManyAttempts(env.DB, body.email, ip, now)) return fail(429, 'Troppi tentativi: riprova fra qualche minuto');
    const u = await findUserByEmail(env.DB, body.email);
    // Senza utente si calcola comunque un hash: i tempi non dicono se l'email esiste.
    const ok = await verifyPassword(body.password, u?.passwordHash ?? (await dummyHash()));
    if (!u?.passwordHash || !ok) {
      await recordFailure(env.DB, body.email, ip, now);
      return fail(401, 'Email o password errati');
    }
    if (u.status !== 'active') return fail(403, 'Account sospeso');
    await clearFailures(env.DB, body.email);
    return json({ user: toMe(u) }, 200, { 'Set-Cookie': await createSession(env.DB, u.id, now) });
  }),

  route('POST', '/api/logout', async (req, env) => {
    await endSession(req, env.DB);
    return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie() } });
  }),

  route('GET', '/api/me', async (req, env) => {
    const auth = await authenticate(req, env, Date.now());
    if (auth instanceof Response) return auth;
    return withCookie(json({ user: toMe(auth.user) }), auth.setCookie);
  }),

  route('GET', '/api/tokens/:token', async (_req, env, { token }) => {
    const t = await readToken(env.DB, token!, Date.now());
    if (!t || (t.kind === 'invite' && t.user.status !== 'invited')) return fail(404, LINK_INVALID);
    return json({ kind: t.kind, email: t.user.email } satisfies TokenInfo);
  }),

  route('POST', '/api/tokens/:token', async (req, env, { token }) => {
    const body = await readBody(req, TokenBody);
    if (body instanceof Response) return body;
    const now = Date.now();
    const t = await readToken(env.DB, token!, now);
    if (!t || (t.kind === 'invite' && t.user.status !== 'invited')) return fail(404, LINK_INVALID);
    const { user, kind } = t;
    const consume = env.DB.prepare('UPDATE tokens SET used_at = ? WHERE token_hash = ?').bind(now, await hashToken(token!));
    const hash = await hashPassword(body.password);
    if (kind === 'invite') {
      if (body.privacyVersion !== PRIVACY_VERSION) return fail(400, "Devi accettare l'informativa");
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET password_hash = ?, status = 'active', privacy_version = ?, updated_at = ? WHERE id = ?").bind(hash, PRIVACY_VERSION, now, user.id),
        consume,
      ]);
    } else {
      if (user.status !== 'active') return fail(403, 'Account sospeso');
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(hash, now, user.id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
        consume,
      ]);
    }
    const activated: UserRow = { ...user, status: 'active' };
    return json({ user: toMe(activated) }, 200, { 'Set-Cookie': await createSession(env.DB, user.id, now) });
  }),
];
