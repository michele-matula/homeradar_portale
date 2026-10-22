import { CreateUserBody, UpdateUserBody, type AdminUser } from '@homeradar/shared/api/types';
import { comuneInfo } from '@homeradar/shared/core/comuni';
import type { Env } from '../env';
import { fail, json, readBody, route, type Handler, type Route } from '../http';
import { authenticate } from '../session';
import { EmailTaken, findUserById, insertUser, issueToken, listUsers, toComuneRefs, type UserRow } from '../users';

const toAdminUser = (u: UserRow): AdminUser => ({
  id: u.id,
  email: u.email,
  role: u.role,
  status: u.status,
  comuni: toComuneRefs(u.comuni),
  maxComuni: u.maxComuni,
  createdAt: u.createdAt,
  lastSeenAt: u.lastSeenAt,
});

export async function requireAdmin(req: Request, env: Env, now: number): Promise<{ user: UserRow; setCookie?: string } | Response> {
  const auth = await authenticate(req, env, now);
  if (auth instanceof Response) return auth;
  if (auth.user.role !== 'admin') return fail(403, "Riservato all'amministratore");
  return auth;
}

/** Rotta riservata all'admin: l'handler riceve anche l'istante della richiesta. */
export const admin = (method: string, pattern: string, h: (req: Request, env: Env, params: Record<string, string>, now: number) => Promise<Response>): Route => {
  const wrapped: Handler = async (req, env, params) => {
    const now = Date.now();
    const auth = await requireAdmin(req, env, now);
    if (auth instanceof Response) return auth;
    const res = await h(req, env, params, now);
    if (auth.setCookie) res.headers.append('Set-Cookie', auth.setCookie);
    return res;
  };
  return route(method, pattern, wrapped);
};

/** Messaggio d'errore per i comuni, o null se vanno bene. */
function comuniError(comuni: string[], max: number): string | null {
  const unknown = comuni.find((c) => !comuneInfo(c));
  if (unknown) return `Comune sconosciuto: ${unknown}`;
  if (new Set(comuni).size !== comuni.length) return 'Comune ripetuto';
  if (comuni.length > max) return `Al massimo ${max} comuni per questo utente`;
  return null;
}

async function defaultMaxComuni(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT value FROM config WHERE key = 'default_max_comuni'").first<{ value: string }>();
  return Number(r?.value ?? 4);
}

const linkUrl = (req: Request, path: string) => `${new URL(req.url).origin}${path}`;

/** Utente modificabile dall'admin: 404 se assente, 400 se è l'account amministratore. */
async function target(env: Env, id: string): Promise<UserRow | Response> {
  const u = await findUserById(env.DB, id);
  if (!u) return fail(404, 'Utente non trovato');
  if (u.role === 'admin') return fail(400, "L'account amministratore non si modifica da qui");
  return u;
}

export const adminUserRoutes: Route[] = [
  admin('GET', '/api/admin/users', async (_req, env) => json({ users: (await listUsers(env.DB)).map(toAdminUser) })),

  admin('POST', '/api/admin/users', async (req, env, _p, now) => {
    const body = await readBody(req, CreateUserBody);
    if (body instanceof Response) return body;
    const maxComuni = body.maxComuni ?? (await defaultMaxComuni(env.DB));
    const err = comuniError(body.comuni, maxComuni);
    if (err) return fail(400, err);
    let user: UserRow;
    try {
      user = await insertUser(env.DB, { email: body.email, role: 'agent', comuni: body.comuni, maxComuni }, now);
    } catch (e) {
      if (e instanceof EmailTaken) return fail(409, 'Esiste già un utente con questa email');
      throw e;
    }
    const token = await issueToken(env.DB, user.id, 'invite', now);
    return json({ user: toAdminUser(user), inviteUrl: linkUrl(req, `/attiva/${token}`) }, 201);
  }),

  admin('PATCH', '/api/admin/users/:id', async (req, env, { id }, now) => {
    const body = await readBody(req, UpdateUserBody);
    if (body instanceof Response) return body;
    const u = await target(env, id!);
    if (u instanceof Response) return u;
    const comuni = body.comuni ?? u.comuni;
    const maxComuni = body.maxComuni ?? u.maxComuni;
    const err = comuniError(comuni, maxComuni);
    if (err) return fail(400, err);
    const status = body.status ?? u.status;
    if (body.status && u.status === 'invited') return fail(400, "L'utente non ha ancora attivato l'account");
    await env.DB.prepare('UPDATE users SET comuni = ?, max_comuni = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(comuni), maxComuni, status, now, u.id)
      .run();
    return json({ user: toAdminUser((await findUserById(env.DB, u.id))!) });
  }),

  admin('POST', '/api/admin/users/:id/invite', async (req, env, { id }, now) => {
    const u = await target(env, id!);
    if (u instanceof Response) return u;
    if (u.status !== 'invited') return fail(400, "L'account è già attivo");
    return json({ inviteUrl: linkUrl(req, `/attiva/${await issueToken(env.DB, u.id, 'invite', now)}`) });
  }),

  admin('POST', '/api/admin/users/:id/reset', async (req, env, { id }, now) => {
    const u = await target(env, id!);
    if (u instanceof Response) return u;
    if (u.status !== 'active') return fail(400, "L'account non è attivo");
    return json({ resetUrl: linkUrl(req, `/reimposta/${await issueToken(env.DB, u.id, 'reset', now)}`) });
  }),

  admin('DELETE', '/api/admin/users/:id', async (_req, env, { id }) => {
    const u = await target(env, id!);
    if (u instanceof Response) return u;
    // I suoi errori restano, senza agente né dispositivo; OR REPLACE: se c'è già un gruppo anonimo uguale, prende il suo posto.
    await env.DB.batch([
      env.DB.prepare("UPDATE OR REPLACE errors SET user_id = '', device_id = '' WHERE user_id = ?").bind(u.id),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(u.id),
    ]);
    return new Response(null, { status: 204 });
  }),
];
