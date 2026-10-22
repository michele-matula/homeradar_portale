import { env, exports } from 'cloudflare:workers';
import type { ListingRecord, Portal } from '@homeradar/shared/shared/types';

export const ORIGIN = 'https://portale.test';

export function fetchApi(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}${path}`, {
    method,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Svuota tutte le tabelle, figlie prima (la configurazione resta). */
export async function resetDb(): Promise<void> {
  const tables = ['errors', 'error_quota', 'link_codes', 'run_pages', 'run_seen', 'search_runs', 'batches', 'sweeps', 'devices', 'lead_states', 'splits', 'user_settings', 'price_snapshots', 'listings', 'calibration_points', 'login_attempts', 'sessions', 'tokens', 'users'];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
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

/** Connettore collegato per l'utente: id e header di autorizzazione. */
export async function linkDevice(userId: string): Promise<{ id: string; auth: Record<string, string> }> {
  const { insertDevice } = await import('../src/device');
  const { id, token } = await insertDevice(env.DB, userId, 'PC di prova', Date.now());
  return { id, auth: { Authorization: `Bearer ${token}` } };
}

/** Richiesta del connettore: senza Origin, come dal service worker dell'estensione. */
export function fetchConnector(method: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Annuncio dell'archivio con valori di default (Treviglio, residenziale). */
export async function putListing(o: Partial<ListingRecord> & { portal: Portal; portalId: number }): Promise<ListingRecord> {
  const { upsertListing } = await import('../src/archive');
  const now = Date.now();
  const l: ListingRecord = {
    key: `${o.portal}:${o.portalId}`, url: '', title: `${o.portal} ${o.portalId}`, address: null, city: 'Treviglio', zone: null, typology: null,
    category: 'residential', surfaceM2: 80, rooms: 3, currentPrice: 200_000, portalCreatedAt: now - 200 * 86_400_000, estimatedCreatedAt: null,
    lastDrop: null, firstSeenAt: now - 86_400_000, lastSeenAt: now, seenCount: 1, sweepScope: null, missedSweeps: 0, missingSince: null, ...o,
  };
  await upsertListing(env.DB, l).run();
  return l;
}
