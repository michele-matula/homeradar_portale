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
