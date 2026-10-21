import { LoginBody, PRIVACY_VERSION, TokenBody, type Me, type TokenInfo } from '@homeradar/shared/api/types';
import { hashPassword, verifyPassword } from '../crypto';
import { fail, json, readBody, route, type Route } from '../http';
import { clearFailures, recordAttempt, tooManyAttempts } from '../rate-limit';
import { authenticate, clearCookie, createSession, endSession } from '../session';
import { claimToken, findUserByEmail, readToken, toComuneRefs, type UserRow } from '../users';

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
    // Il tentativo si registra prima della verifica: richieste in parallelo non superano il limite.
    await recordAttempt(env.DB, body.email, ip, now);
    if (await tooManyAttempts(env.DB, body.email, ip, now)) return fail(429, 'Troppi tentativi: riprova fra qualche minuto');
    const u = await findUserByEmail(env.DB, body.email);
    // Senza utente si calcola comunque un hash: i tempi non dicono se l'email esiste.
    const ok = await verifyPassword(body.password, u?.passwordHash ?? (await dummyHash()));
    if (!u?.passwordHash || !ok) return fail(401, 'Email o password errati');
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
    // Controlli prima di consumare il link: una richiesta sbagliata non lo brucia.
    if (kind === 'invite' && body.privacyVersion !== PRIVACY_VERSION) return fail(400, "Devi accettare l'informativa");
    if (kind === 'reset' && user.status !== 'active') return fail(403, 'Account sospeso');
    const hash = await hashPassword(body.password);
    // Consumo atomico: fra due richieste simultanee con lo stesso link ne passa una sola.
    if (!(await claimToken(env.DB, token!, Date.now()))) return fail(404, LINK_INVALID);
    if (kind === 'invite') {
      await env.DB.prepare("UPDATE users SET password_hash = ?, status = 'active', privacy_version = ?, updated_at = ? WHERE id = ? AND status = 'invited'")
        .bind(hash, PRIVACY_VERSION, now, user.id)
        .run();
    } else {
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(hash, now, user.id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
      ]);
    }
    const activated: UserRow = { ...user, status: 'active' };
    return json({ user: toMe(activated) }, 200, { 'Set-Cookie': await createSession(env.DB, user.id, now) });
  }),
];
