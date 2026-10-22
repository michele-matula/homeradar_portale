import { env } from 'cloudflare:workers';
import type { ControlAgent, ControlRow, ControlRun, ErrorGroup } from '@homeradar/shared/api/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { controlHealth } from '../src/control';
import { fetchApi, fetchConnector, linkDevice, loginAs, resetDb } from './helpers';

beforeEach(resetDb);

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

type Base = Omit<ControlRow, 'health' | 'reasons'>;
const base = (o: Partial<Base> = {}): Base => ({
  userId: 'u', email: 'a@b.it', status: 'active', lastSeenAt: NOW - DAY,
  devices: [{ id: 'd', name: 'Chrome · Windows', version: '0.4.0', createdAt: NOW - 30 * DAY, lastSeenAt: NOW - DAY, lastGoodSweepAt: NOW - DAY }],
  lastSweep: { id: 's', startedAt: NOW - DAY, finishedAt: NOW - DAY + 60_000, outcome: 'completed', deviceName: 'Chrome · Windows', searches: 4, problems: 0 },
  sweeps30d: 5, errors7d: 0, ...o,
});

describe('controlHealth', () => {
  it('agente appena creato: rosso con tutti i motivi', () => {
    expect(controlHealth(base({ devices: [], lastSweep: null, lastSeenAt: null }), NOW)).toEqual({
      health: 'bad', reasons: ['Nessun connettore', 'Mai fatto un giro', 'Mai entrato'],
    });
  });

  it('nessun giro riuscito è rosso, anche con le ricerche dell\'ultimo giro', () => {
    const r = controlHealth(base({
      devices: [{ ...base().devices[0]!, lastGoodSweepAt: null }],
      lastSweep: { ...base().lastSweep!, problems: 2 },
    }), NOW);
    expect(r.health).toBe('bad');
    expect(r.reasons).toEqual(expect.arrayContaining(['Nessun giro riuscito', 'Ultimo giro: 2 ricerche con problemi']));
  });

  it('connettore muto da più di 7 giorni: arancio', () => {
    const r = controlHealth(base({ devices: [{ ...base().devices[0]!, lastSeenAt: NOW - 9 * DAY }] }), NOW);
    expect(r).toEqual({ health: 'warn', reasons: ['Connettore Chrome · Windows muto da 9 giorni'] });
  });

  it('ultimo giro non completato: arancio, con l\'esito', () => {
    const at = (outcome: 'interrupted' | 'partial' | 'stopped') => controlHealth(base({ lastSweep: { ...base().lastSweep!, outcome } }), NOW).reasons;
    expect(at('interrupted')).toEqual(['Ultimo giro: interrotto']);
    expect(at('partial')).toEqual(['Ultimo giro: parziale']);
    expect(at('stopped')).toEqual(['Ultimo giro: fermato']);
  });

  it('errori recenti e accesso vecchio: arancio', () => {
    const r = controlHealth(base({ errors7d: 3, lastSeenAt: NOW - 12 * DAY }), NOW);
    expect(r).toEqual({ health: 'warn', reasons: ['3 errori negli ultimi 7 giorni', 'Nessun accesso da 12 giorni'] });
  });

  it('giro in corso e il resto a posto: verde', () => {
    const r = controlHealth(base({ lastSweep: { ...base().lastSweep!, finishedAt: null, outcome: null } }), NOW);
    expect(r).toEqual({ health: 'ok', reasons: [] });
  });
});

const SPEC = (portal: string, label: string) => JSON.stringify({ portal, key: `${portal}|x`, label, categories: ['residential'], url: 'https://x.test/' });

async function sweep(userId: string, deviceId: string | null, o: { startedAt: number; finishedAt?: number | null; outcome?: string | null; runs?: [string, string | null][] }) {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO sweeps (id, user_id, device_id, started_at, last_activity_at, finished_at, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, deviceId, o.startedAt, o.startedAt, o.finishedAt === undefined ? o.startedAt + 60_000 : o.finishedAt, o.outcome === undefined ? 'completed' : o.outcome).run();
  for (const [i, [status, reason]] of (o.runs ?? [['complete', null]]).entries()) {
    await env.DB.prepare('INSERT INTO search_runs (sweep_id, search_key, portal, spec, user_id, status, pages, privates, reason) VALUES (?, ?, ?, ?, ?, ?, 1, 2, ?)')
      .bind(id, `immobiliare|${i}`, 'immobiliare', SPEC('immobiliare', `Treviglio · Case ${i}`), userId, status, reason).run();
  }
  return id;
}

const get = async <T>(cookie: string, path: string) => {
  const r = await fetchApi('GET', path, undefined, { Cookie: cookie });
  expect(r.status).toBe(200);
  return (await r.json()) as T;
};

describe('API di «Controllo»', () => {
  it('ultimo giro riuscito per connettore e ricerche con problemi dell\'ultimo giro', async () => {
    const admin = await loginAs('admin');
    const u = await loginAs('agent', 'rossi@test.it');
    const d = await linkDevice(u.id);
    const t = Date.now() - 2 * DAY;
    await sweep(u.id, d.id, { startedAt: t });
    await sweep(u.id, d.id, { startedAt: t + DAY, runs: [['complete', null], ['blocked', null]] });
    const rows = await get<ControlRow[]>(admin.cookie, '/api/admin/control');
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.email).toBe('rossi@test.it');
    expect(row!.devices[0]!.lastGoodSweepAt).toBe(t + 60_000);
    expect(row!.lastSweep).toMatchObject({ startedAt: t + DAY, searches: 2, problems: 1, deviceName: 'PC di prova' });
    expect(row!.sweeps30d).toBe(2);
    expect(row!.health).toBe('warn');
  });

  it('un giro senza dispositivo non conta per nessun connettore', async () => {
    const admin = await loginAs('admin');
    const u = await loginAs('agent');
    await linkDevice(u.id);
    await sweep(u.id, null, { startedAt: Date.now() - DAY });
    const [row] = await get<ControlRow[]>(admin.cookie, '/api/admin/control');
    expect(row!.devices[0]!.lastGoodSweepAt).toBeNull();
    expect(row!.lastSweep!.deviceName).toBeNull();
    expect(row!.reasons).toContain('Nessun giro riuscito');
  });

  it('sospesi in fondo; errori degli ultimi 7 giorni per agente', async () => {
    const admin = await loginAs('admin');
    const a = await loginAs('agent', 'a@test.it');
    const z = await loginAs('agent', 'z@test.it');
    await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(a.id).run();
    await fetchApi('POST', '/api/errors', { version: 'v', errors: [{ message: 'Uno', at: Date.now() }, { message: 'Due', at: Date.now() }] }, { Cookie: z.cookie });
    const rows = await get<ControlRow[]>(admin.cookie, '/api/admin/control');
    expect(rows.map((r) => r.email)).toEqual(['z@test.it', 'a@test.it']);
    expect(rows[0]!.errors7d).toBe(2);
  });

  it('solo per l\'admin', async () => {
    const u = await loginAs('agent');
    const r = await fetchApi('GET', '/api/admin/control', undefined, { Cookie: u.cookie });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "Riservato all'amministratore" });
  });

  it('scheda dell\'agente: riga, ultimi giri ed errori; agente sconosciuto → 404', async () => {
    const admin = await loginAs('admin');
    const u = await loginAs('agent');
    const d = await linkDevice(u.id);
    for (let i = 0; i < 22; i++) await sweep(u.id, d.id, { startedAt: Date.now() - (i + 1) * 3_600_000 });
    await fetchApi('POST', '/api/errors', { version: 'v', errors: [{ message: 'Suo', at: Date.now() }] }, { Cookie: u.cookie });
    await fetchApi('POST', '/api/errors', { version: 'v', errors: [{ message: 'Anonimo', at: Date.now() }] });
    const a = await get<ControlAgent>(admin.cookie, `/api/admin/control/${u.id}`);
    expect(a.row.userId).toBe(u.id);
    expect(a.sweeps).toHaveLength(20);
    expect(a.sweeps[0]!.startedAt).toBeGreaterThan(a.sweeps[1]!.startedAt);
    expect(a.errors.map((e) => e.message)).toEqual(['Suo']);
    const r = await fetchApi('GET', `/api/admin/control/${crypto.randomUUID()}`, undefined, { Cookie: admin.cookie });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Agente non trovato' });
  });

  it('ricerche di un giro con etichetta e motivo', async () => {
    const admin = await loginAs('admin');
    const u = await loginAs('agent');
    const id = await sweep(u.id, null, { startedAt: Date.now(), runs: [['complete', null], ['error', 'timeout']] });
    const runs = await get<ControlRun[]>(admin.cookie, `/api/admin/sweeps/${id}/runs`);
    expect(runs).toEqual([
      { searchKey: 'immobiliare|0', portal: 'immobiliare', label: 'Treviglio · Case 0', status: 'complete', pages: 1, privates: 2, reason: null },
      { searchKey: 'immobiliare|1', portal: 'immobiliare', label: 'Treviglio · Case 1', status: 'error', pages: 1, privates: 2, reason: 'timeout' },
    ]);
    const r = await fetchApi('GET', `/api/admin/sweeps/${crypto.randomUUID()}/runs`, undefined, { Cookie: admin.cookie });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Giro non trovato' });
  });
});

describe('API degli errori', () => {
  it('lo stesso messaggio da due agenti è una riga; anonimi senza agenti; filtro per provenienza', async () => {
    const admin = await loginAs('admin');
    const a = await loginAs('agent', 'a@test.it');
    const b = await loginAs('agent', 'b@test.it');
    const send = (m: string, cookie?: string) =>
      fetchApi('POST', '/api/errors', { version: 'v1', errors: [{ message: m, at: Date.now() }] }, cookie ? { Cookie: cookie } : {});
    await send('Comune', a.cookie);
    await send('Comune', b.cookie);
    await send('Comune', b.cookie);
    await send('Anonimo');
    const all = await get<ErrorGroup[]>(admin.cookie, '/api/admin/errors');
    const comune = all.find((e) => e.message === 'Comune')!;
    expect(comune).toMatchObject({ source: 'portal', version: 'v1', count: 3 });
    expect(comune.agents.sort()).toEqual(['a@test.it', 'b@test.it']);
    expect(all.find((e) => e.message === 'Anonimo')!.agents).toEqual([]);
    expect(await get<ErrorGroup[]>(admin.cookie, '/api/admin/errors?source=connector')).toEqual([]);
    const bad = await fetchApi('GET', '/api/admin/errors?source=altro', undefined, { Cookie: admin.cookie });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Provenienza non valida' });
  });

  it('un connettore revocato resta col suo nome', async () => {
    const admin = await loginAs('admin');
    const u = await loginAs('agent');
    const d = await linkDevice(u.id);
    await fetchConnector('POST', '/connector/errors', { version: '0.4.0', errors: [{ message: 'Rotto', at: Date.now() }] }, d.auth);
    expect((await fetchApi('DELETE', `/api/admin/devices/${d.id}`, undefined, { Cookie: admin.cookie })).status).toBe(204);
    const [e] = await get<ErrorGroup[]>(admin.cookie, '/api/admin/errors');
    expect(e!.devices).toEqual([{ name: 'PC di prova', revoked: true }]);
  });
});

describe('revoca dall\'admin', () => {
  it('chiude il giro aperto e cancella il dispositivo; sconosciuto → 404', async () => {
    const admin = await loginAs('admin');
    const u = await loginAs('agent');
    const d = await linkDevice(u.id);
    const open = await sweep(u.id, d.id, { startedAt: Date.now(), finishedAt: null, outcome: null });
    expect((await fetchApi('DELETE', `/api/admin/devices/${d.id}`, undefined, { Cookie: admin.cookie })).status).toBe(204);
    const s = await env.DB.prepare('SELECT outcome FROM sweeps WHERE id = ?').bind(open).first<{ outcome: string }>();
    expect(s!.outcome).toBe('interrupted');
    expect(await env.DB.prepare('SELECT id FROM devices WHERE id = ?').bind(d.id).first()).toBeNull();
    const r = await fetchApi('DELETE', `/api/admin/devices/${d.id}`, undefined, { Cookie: admin.cookie });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Dispositivo non trovato' });
  });
});
