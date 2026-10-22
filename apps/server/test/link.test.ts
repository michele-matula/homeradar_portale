import { env } from 'cloudflare:workers';
import type { DeviceInfo } from '@homeradar/shared/api/connector';
import { beforeEach, describe, expect, it } from 'vitest';
import { fetchApi, fetchConnector, loginAs, resetDb } from './helpers';

beforeEach(resetDb);

const INVALID = 'Codice di collegamento non valido o scaduto';
const LINK = { name: 'Chrome su Windows', version: '0.1.0' };

async function agent() {
  const u = await loginAs('agent');
  await env.DB.prepare(`UPDATE users SET comuni = '["016219"]' WHERE id = ?`).bind(u.id).run();
  return u;
}
async function codeFor(cookie: string): Promise<string> {
  const r = await fetchApi('POST', '/api/devices/link-code', {}, { Cookie: cookie });
  expect(r.status).toBe(201);
  return ((await r.json()) as { code: string }).code;
}
const link = (code: string) => fetchConnector('POST', '/connector/link', { code, ...LINK });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const devices = async (cookie: string) => (await (await fetchApi('GET', '/api/devices', undefined, { Cookie: cookie })).json()) as DeviceInfo[];

describe('collegamento del connettore', () => {
  it('codice dal portale → token del dispositivo, visibile fra i computer dell\'agente', async () => {
    const u = await agent();
    const r = await link(await codeFor(u.cookie));
    expect(r.status).toBe(201);
    const { token } = (await r.json()) as { token: string };
    expect((await fetchConnector('POST', '/connector/sweeps', {}, bearer(token))).status).not.toBe(401);
    const list = await devices(u.cookie);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Chrome su Windows', lastSeenAt: expect.any(Number) });
    expect(await env.DB.prepare('SELECT version FROM devices').first('version')).toBe('0.1.0');
  });

  it('il codice vale una volta sola, anche in parallelo', async () => {
    const u = await agent();
    const code = await codeFor(u.cookie);
    expect((await link(code)).status).toBe(201);
    const again = await link(code);
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: INVALID });
    const c2 = await codeFor(u.cookie);
    const statuses = (await Promise.all([link(c2), link(c2)])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 400]);
  });

  it('codice scaduto o sconosciuto', async () => {
    const u = await agent();
    const code = await codeFor(u.cookie);
    await env.DB.prepare('UPDATE link_codes SET expires_at = ?').bind(Date.now() - 1).run();
    expect((await link(code)).status).toBe(400);
    expect((await link('sconosciuto')).status).toBe(400);
  });

  it('5 minuti di validità e solo l\'hash nel database', async () => {
    const u = await agent();
    const before = Date.now();
    const code = await codeFor(u.cookie);
    const row = await env.DB.prepare('SELECT code_hash, expires_at FROM link_codes').first<{ code_hash: string; expires_at: number }>();
    expect(row!.code_hash).not.toBe(code);
    expect(row!.expires_at).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(row!.expires_at).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  });

  it('account sospeso dopo la creazione del codice: 403', async () => {
    const u = await agent();
    const code = await codeFor(u.cookie);
    await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(u.id).run();
    const r = await link(code);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'Account sospeso' });
  });

  it('corpo non valido', async () => {
    const r = await fetchConnector('POST', '/connector/link', { code: 'x' });
    expect(r.status).toBe(400);
  });

  it('il codice si chiede solo con una sessione e dall\'origine del portale', async () => {
    const u = await agent();
    expect((await fetchApi('POST', '/api/devices/link-code', {})).status).toBe(401);
    expect((await fetchConnector('POST', '/api/devices/link-code', {}, { Cookie: u.cookie })).status).toBe(403);
  });
});

describe('computer collegati', () => {
  it('il collegamento dice di quale account è il connettore', async () => {
    const u = await agent();
    expect(await (await link(await codeFor(u.cookie))).json()).toEqual({ token: expect.any(String), userId: u.id });
  });

  it('scollegato a metà giro: il «Cerca» dal computer ricollegato parte subito', async () => {
    const u = await agent();
    const { token } = (await (await link(await codeFor(u.cookie))).json()) as { token: string };
    expect((await fetchConnector('POST', '/connector/sweeps', {}, bearer(token))).status).toBe(201);
    const [dev] = await devices(u.cookie);
    // Il dispositivo ha un giro: cancellarlo tocca anche quel giro, ma la risposta resta 204.
    expect((await fetchApi('DELETE', `/api/devices/${dev!.id}`, undefined, { Cookie: u.cookie })).status).toBe(204);
    expect(await devices(u.cookie)).toEqual([]);
    const relinked = (await (await link(await codeFor(u.cookie))).json()) as { token: string };
    const r = await fetchConnector('POST', '/connector/sweeps', {}, bearer(relinked.token));
    expect(r.status).toBe(201);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sweeps WHERE outcome = 'interrupted'").first('n')).toBe(1);
  });

  it('scollegare: solo i propri; il token scollegato non vale più', async () => {
    const a = await agent();
    const b = await agent();
    const { token } = (await (await link(await codeFor(a.cookie))).json()) as { token: string };
    const [dev] = await devices(a.cookie);
    const other = await fetchApi('DELETE', `/api/devices/${dev!.id}`, undefined, { Cookie: b.cookie });
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: 'Dispositivo non trovato' });
    expect(await devices(a.cookie)).toHaveLength(1);
    expect(await devices(b.cookie)).toEqual([]);
    expect((await fetchApi('DELETE', `/api/devices/${dev!.id}`, undefined, { Cookie: a.cookie })).status).toBe(204);
    expect(await devices(a.cookie)).toEqual([]);
    expect((await fetchConnector('POST', '/connector/sweeps', {}, bearer(token))).status).toBe(401);
  });
});

describe('contatto del connettore', () => {
  it('hello aggiorna nome, versione e ultimo contatto', async () => {
    const u = await agent();
    const { token } = (await (await link(await codeFor(u.cookie))).json()) as { token: string };
    const before = Date.now() - 60_000;
    await env.DB.prepare('UPDATE devices SET last_seen_at = ?').bind(before).run();
    const r = await fetchConnector('POST', '/connector/hello', { name: 'Edge · Windows', version: '0.4.0' }, bearer(token));
    expect(r.status).toBe(204);
    const d = await env.DB.prepare('SELECT name, version, last_seen_at FROM devices').first<{ name: string; version: string; last_seen_at: number }>();
    expect(d).toMatchObject({ name: 'Edge · Windows', version: '0.4.0' });
    expect(d!.last_seen_at).toBeGreaterThan(before);
  });

  it('hello senza token → 401', async () => {
    expect((await fetchConnector('POST', '/connector/hello', { name: 'x', version: '1' })).status).toBe(401);
  });
});

describe('ricollegamento dello stesso browser', () => {
  async function linked(cookie: string, previousToken?: string) {
    const r = await fetchConnector('POST', '/connector/link', { code: await codeFor(cookie), ...LINK, ...(previousToken ? { previousToken } : {}) });
    expect(r.status).toBe(201);
    return ((await r.json()) as { token: string }).token;
  }
  const deviceIdOf = async (token: string) =>
    (await env.DB.prepare('SELECT id FROM devices WHERE token_hash = ?').bind(await (await import('../src/crypto')).hashToken(token)).first<{ id: string }>())?.id;

  it('il dispositivo vecchio sparisce e i suoi giri passano al nuovo', async () => {
    const u = await agent();
    const old = await linked(u.cookie);
    const oldId = (await deviceIdOf(old))!;
    for (const id of [crypto.randomUUID(), crypto.randomUUID()]) {
      await env.DB.prepare("INSERT INTO sweeps (id, user_id, device_id, started_at, last_activity_at, finished_at, outcome) VALUES (?, ?, ?, 1, 1, 2, 'completed')")
        .bind(id, u.id, oldId).run();
    }
    const fresh = await linked(u.cookie, old);
    const newId = (await deviceIdOf(fresh))!;
    expect(await devices(u.cookie)).toHaveLength(1);
    const moved = await env.DB.prepare('SELECT COUNT(*) AS n FROM sweeps WHERE device_id = ?').bind(newId).first<{ n: number }>();
    expect(moved!.n).toBe(2);
    expect((await fetchConnector('POST', '/connector/hello', { name: 'x', version: '1' }, bearer(old))).status).toBe(401);
  });

  it("il token di un altro agente non tocca il suo dispositivo", async () => {
    const other = await agent();
    const theirs = await linked(other.cookie);
    const u = await agent();
    await linked(u.cookie, theirs);
    expect(await devices(other.cookie)).toHaveLength(1);
    expect(await devices(u.cookie)).toHaveLength(1);
  });

  it('un token sconosciuto non cambia niente', async () => {
    const u = await agent();
    await linked(u.cookie, 'sconosciuto');
    expect(await devices(u.cookie)).toHaveLength(1);
  });
});

describe('codici di collegamento', () => {
  it('al più 5 aperti per agente', async () => {
    const u = await agent();
    for (let i = 0; i < 5; i++) await codeFor(u.cookie);
    const r = await fetchApi('POST', '/api/devices/link-code', {}, { Cookie: u.cookie });
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'Troppi codici di collegamento: riprova tra qualche minuto' });
  });
});
