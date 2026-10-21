import { env, exports } from 'cloudflare:workers';

export const ORIGIN = 'https://portale.test';

export function fetchApi(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}${path}`, {
    method,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Svuota le tabelle degli account (la configurazione resta). */
export async function resetDb(): Promise<void> {
  await env.DB.batch(['login_attempts', 'sessions', 'tokens', 'users'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

/** "hr_session=…" dall'header Set-Cookie, da rimandare come Cookie. */
export function cookieFrom(res: Response): string {
  return (res.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
}

/** Utente attivo con una sessione aperta: restituisce id e cookie. */
export async function loginAs(role: 'agent' | 'admin', email = `${role}-${crypto.randomUUID()}@test.it`): Promise<{ id: string; cookie: string }> {
  const { insertUser } = await import('../src/users');
  const { createSession } = await import('../src/session');
  const u = await insertUser(env.DB, { email, role, comuni: [], maxComuni: 4 }, Date.now());
  await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(u.id).run();
  return { id: u.id, cookie: (await createSession(env.DB, u.id, Date.now())).split(';')[0]! };
}
