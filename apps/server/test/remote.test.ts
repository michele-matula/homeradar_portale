import { env } from 'cloudflare:workers';
import type { RemotePoll, SweepPlan } from '@homeradar/shared/api/connector';
import { searchesFor } from '@homeradar/shared/core/searches';
import { DEFAULT_SETTINGS, type SweepStatus } from '@homeradar/shared/shared/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { toComuneRefs } from '../src/users';
import { fetchApi, fetchConnector, linkDevice, loginAs, resetDb } from './helpers';

const COMUNI = ['016219'];
const SPECS = searchesFor({ comuni: toComuneRefs(COMUNI), categories: ['residential'] }, DEFAULT_SETTINGS.enabledPortals);
const NO_COMPUTER = 'Nessun computer con «Avvia dal telefono» attivo: attivalo nelle impostazioni';

interface Device { id: string; auth: Record<string, string> }
interface Agent { id: string; cookie: string; pc: Device }

async function device(userId: string, o: { version?: string; remote?: number } = {}): Promise<Device> {
  const d = await linkDevice(userId);
  await env.DB.prepare('UPDATE devices SET version = ?, remote = ? WHERE id = ?').bind(o.version ?? '0.3.0', o.remote ?? 1, d.id).run();
  return d;
}
async function agent(comuni = COMUNI): Promise<Agent> {
  const u = await loginAs('agent');
  await env.DB.prepare('UPDATE users SET comuni = ? WHERE id = ?').bind(JSON.stringify(comuni), u.id).run();
  return { ...u, pc: await device(u.id) };
}

const ask = (a: Agent) => fetchApi('POST', '/api/sweep/remote', {}, { Cookie: a.cookie });
const status = async (a: Agent) => (await (await fetchApi('GET', '/api/sweep', undefined, { Cookie: a.cookie })).json()) as SweepStatus;
const poll = async (d: Device) => (await (await fetchConnector('POST', '/connector/remote', {}, d.auth)).json()) as RemotePoll;
const take = (d: Device, remote: string) => fetchConnector('POST', '/connector/sweeps', { remote }, d.auth);
const requestId = (userId: string) => env.DB.prepare('SELECT id FROM remote_requests WHERE user_id = ?').bind(userId).first<string>('id');

/** Tutte le ricerche della zona fatte da poco: il piano è vuoto. */
async function allFresh(userId: string) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sweeps (id, user_id, started_at, last_activity_at, finished_at) VALUES (?, ?, ?, ?, ?)').bind(id, userId, now - 60_000, now, now),
    ...SPECS.map((s) => env.DB.prepare("INSERT INTO search_runs (sweep_id, search_key, portal, spec, user_id, status, finished_at) VALUES (?, ?, ?, '{}', ?, 'complete', ?)")
      .bind(id, s.key, s.portal, userId, now)),
  ]);
}

let a: Agent;
beforeEach(async () => {
  await resetDb();
  a = await agent();
});

describe('richiesta dal telefono', () => {
  it('si crea una volta sola anche premendo due volte', async () => {
    expect((await ask(a)).status).toBe(201);
    const id = await requestId(a.id);
    expect((await status(a)).remote).toMatchObject({ state: 'waiting', deviceName: null });
    const again = await ask(a);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ fresh: false });
    expect(await requestId(a.id)).toBe(id);
  });

  it('senza computer abilitati, o solo con connettori vecchi: 400', async () => {
    await env.DB.prepare('UPDATE devices SET remote = 0').run();
    let r = await ask(a);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: NO_COMPUTER });
    await env.DB.prepare("UPDATE devices SET remote = 1, version = '0.2.0'").run();
    expect((await ask(a)).status).toBe(400);
    expect((await status(a)).computers).toEqual({ enabled: 0, online: [] });
  });

  it('dati già freschi: risposta subito, nessuna richiesta', async () => {
    await allFresh(a.id);
    const r = await ask(a);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ fresh: true });
    expect(await requestId(a.id)).toBeNull();
  });

  it('con un giro aperto: 409', async () => {
    await env.DB.prepare('INSERT INTO sweeps (id, user_id, device_id, started_at, last_activity_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), a.id, a.pc.id, Date.now(), Date.now()).run();
    expect((await ask(a)).status).toBe(409);
  });

  it('annullata prima che un computer la prenda: sparisce', async () => {
    await ask(a);
    expect((await fetchApi('DELETE', '/api/sweep/remote', undefined, { Cookie: a.cookie })).status).toBe(204);
    expect((await status(a)).remote).toBeNull();
    expect((await poll(a.pc)).requestId).toBeNull();
  });

  it('non presa entro 2 minuti: nessuno ha risposto, e non si prende più', async () => {
    await ask(a);
    await env.DB.prepare('UPDATE remote_requests SET expires_at = ?').bind(Date.now() - 1).run();
    expect((await status(a)).remote).toMatchObject({ state: 'noAnswer' });
    expect((await poll(a.pc)).requestId).toBeNull();
    expect((await take(a.pc, (await requestId(a.id))!)).status).toBe(409);
  });
});

describe('il computer prende la richiesta', () => {
  it('il controllo la mostra solo ai computer abilitati', async () => {
    const off = await device(a.id, { remote: 0 });
    await ask(a);
    expect(await poll(a.pc)).toEqual({ enabled: true, requestId: await requestId(a.id), stop: false });
    expect(await poll(off)).toEqual({ enabled: false, requestId: null, stop: false });
  });

  it('due computer insieme: parte su uno solo', async () => {
    const other = await device(a.id);
    await ask(a);
    const id = (await requestId(a.id))!;
    const [r1, r2] = await Promise.all([take(a.pc, id), take(other, id)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const s = await status(a);
    expect(s.remote).toMatchObject({ state: 'started', deviceName: 'PC di prova' });
    expect(s.running).toMatchObject({ remote: true, deviceName: 'PC di prova', stopRequested: false });
  });

  it('interruttore spento dopo la richiesta: non la può prendere', async () => {
    await ask(a);
    await fetchApi('PATCH', `/api/devices/${a.pc.id}`, { remote: false }, { Cookie: a.cookie });
    expect((await take(a.pc, (await requestId(a.id))!)).status).toBe(409);
    expect((await status(a)).remote).toMatchObject({ state: 'waiting' });
  });

  it('presa ma dati freschi nel frattempo: «fresh»', async () => {
    await ask(a);
    await allFresh(a.id);
    const r = await take(a.pc, (await requestId(a.id))!);
    expect(r.status).toBe(200);
    expect(((await r.json()) as SweepPlan).sweepId).toBeNull();
    expect((await status(a)).remote).toMatchObject({ state: 'fresh' });
  });

  it('presa ma giro aperto su un altro computer: «busy», col nome scelto nel messaggio', async () => {
    const other = await device(a.id);
    await env.DB.prepare("UPDATE devices SET label = 'PC ufficio' WHERE id = ?").bind(other.id).run();
    await ask(a);
    await env.DB.prepare('INSERT INTO sweeps (id, user_id, device_id, started_at, last_activity_at) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), a.id, other.id, Date.now(), Date.now()).run();
    const r = await take(a.pc, (await requestId(a.id))!);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'Giro già in corso su «PC ufficio»' });
    expect((await status(a)).remote).toMatchObject({ state: 'busy' });
  });

  it('presa ma il giro non può partire: «failed» col nome del computer', async () => {
    await ask(a);
    await env.DB.prepare("UPDATE users SET comuni = '[]' WHERE id = ?").bind(a.id).run();
    expect((await take(a.pc, (await requestId(a.id))!)).status).toBe(400);
    expect((await status(a)).remote).toMatchObject({ state: 'failed', deviceName: 'PC di prova' });
  });

  it('una richiesta di più di 10 minuti fa non si mostra più', async () => {
    await ask(a);
    await env.DB.prepare('UPDATE remote_requests SET created_at = ?, expires_at = ?').bind(Date.now() - 11 * 60_000, Date.now() - 9 * 60_000).run();
    expect((await status(a)).remote).toBeNull();
  });
});

describe('Ferma dal telefono e computer online', () => {
  it('lo stop arriva nella risposta ai lotti e al controllo del computer del giro', async () => {
    const plan = (await (await fetchConnector('POST', '/connector/sweeps', {}, a.pc.auth)).json()) as SweepPlan;
    expect((await fetchApi('POST', '/api/sweep/stop', {}, { Cookie: a.cookie })).status).toBe(204);
    expect((await status(a)).running).toMatchObject({ stopRequested: true });
    const spec = plan.searches[0]!;
    const batch = {
      id: crypto.randomUUID(), sweepId: plan.sweepId, searchKey: spec.key, readAt: Date.now(), page: 1, observations: [],
      report: { portal: spec.portal, url: 'https://www.immobiliare.it/x/', results: 0, privates: 0, lastPage: true, blocked: false, notFound: false, parseErrors: 0 },
    };
    const r = await fetchConnector('POST', '/connector/batches', batch, a.pc.auth);
    expect(await r.json()).toEqual({ ok: true, stop: true });
    // Lo stesso lotto rimandato dice ancora di fermarsi.
    expect(await (await fetchConnector('POST', '/connector/batches', batch, a.pc.auth)).json()).toEqual({ ok: true, stop: true });
    expect((await poll(a.pc)).stop).toBe(true);
    const other = await device(a.id);
    expect((await poll(other)).stop).toBe(false);
  });

  it('online dopo un controllo recente, non dopo 3 minuti', async () => {
    await env.DB.prepare("UPDATE devices SET label = 'PC di casa'").run();
    await poll(a.pc);
    expect((await status(a)).computers).toEqual({ enabled: 1, online: ['PC di casa'] });
    await env.DB.prepare('UPDATE devices SET polled_at = ?').bind(Date.now() - 3 * 60_000).run();
    expect((await status(a)).computers).toEqual({ enabled: 1, online: [] });
  });

  it("il giro dal telefono finito resta segnato e la pagina Controllo lo sa", async () => {
    await ask(a);
    const plan = (await (await take(a.pc, (await requestId(a.id))!)).json()) as SweepPlan;
    await fetchConnector('POST', `/connector/sweeps/${plan.sweepId}/finish`, { outcome: 'stopped' }, a.pc.auth);
    expect((await status(a)).last).toMatchObject({ remote: true });
    const admin = await loginAs('admin');
    const r = (await (await fetchApi('GET', `/api/admin/control/${a.id}`, undefined, { Cookie: admin.cookie })).json()) as { sweeps: { remote: boolean }[] };
    expect(r.sweeps[0]).toMatchObject({ remote: true });
  });
});
