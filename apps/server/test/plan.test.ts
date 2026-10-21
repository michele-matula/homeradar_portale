import { env } from 'cloudflare:workers';
import type { SweepPlan } from '@homeradar/shared/api/connector';
import { searchesFor } from '@homeradar/shared/core/searches';
import { DEFAULT_SETTINGS } from '@homeradar/shared/shared/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toComuneRefs } from '../src/users';
import { fetchApi, fetchConnector, linkDevice, loginAs, resetDb } from './helpers';

const MIN = 60_000;
const COMUNI = ['016219', '016062'];
const SPECS = searchesFor({ comuni: toComuneRefs(COMUNI), categories: ['residential'] }, DEFAULT_SETTINGS.enabledPortals);
const KEY = SPECS[0]!.key;

interface Agent { id: string; cookie: string; auth: Record<string, string>; deviceId: string }
async function agent(comuni = COMUNI): Promise<Agent> {
  const u = await loginAs('agent');
  await env.DB.prepare('UPDATE users SET comuni = ? WHERE id = ?').bind(JSON.stringify(comuni), u.id).run();
  const d = await linkDevice(u.id);
  return { ...u, auth: d.auth, deviceId: d.id };
}
const start = (a: { auth: Record<string, string> }, body: unknown = {}) => fetchConnector('POST', '/connector/sweeps', body, a.auth);

/** Ricerca già fatta (o in corso) da un agente, in un giro chiuso o aperto. */
async function pastRun(userId: string, status: string, o: { startedAt?: number | null; finishedAt?: number | null; open?: boolean } = {}) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sweeps (id, user_id, started_at, last_activity_at, finished_at) VALUES (?, ?, ?, ?, ?)').bind(id, userId, now - 60 * MIN, now, o.open ? null : now),
    env.DB.prepare('INSERT INTO search_runs (sweep_id, search_key, portal, spec, user_id, status, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, KEY, SPECS[0]!.portal, '{}', userId, status, o.startedAt ?? null, o.finishedAt ?? null),
  ]);
}

let a: Agent;
let b: Agent;
beforeEach(async () => {
  await resetDb();
  a = await agent();
  b = await agent();
});
afterEach(async () => {
  await env.DB.prepare("UPDATE config SET value = '60' WHERE key = 'freshness_minutes'").run();
});

describe('POST /connector/sweeps', () => {
  it('tutte le ricerche della zona, nell\'ordine del giro, con le righe in attesa', async () => {
    const r = await start(a);
    expect(r.status).toBe(201);
    const plan = (await r.json()) as SweepPlan;
    expect(plan.searches).toEqual(SPECS);
    expect(plan.skipped).toBe(0);
    const rows = await env.DB.prepare('SELECT status, user_id FROM search_runs WHERE sweep_id = ?').bind(plan.sweepId).all();
    expect(rows.results).toHaveLength(SPECS.length);
    expect(rows.results.every((x) => x.status === 'pending' && x.user_id === a.id)).toBe(true);
  });

  it('salta le ricerche complete da meno dei minuti di freschezza, di chiunque', async () => {
    await pastRun(b.id, 'complete', { finishedAt: Date.now() - 30 * MIN });
    const plan = (await (await start(a)).json()) as SweepPlan;
    expect(plan.skipped).toBe(1);
    expect(plan.searches.map((s) => s.key)).not.toContain(KEY);
  });

  it('freschezza: 61 minuti fa non basta, salvo con freshness_minutes più alto', async () => {
    await pastRun(b.id, 'complete', { finishedAt: Date.now() - 61 * MIN });
    expect(((await (await start(a)).json()) as SweepPlan).skipped).toBe(0);
    await env.DB.prepare("UPDATE config SET value = '120' WHERE key = 'freshness_minutes'").run();
    expect(((await (await start(a)).json()) as SweepPlan).skipped).toBe(1);
  });

  it('vale anche una ricerca fatta dallo stesso agente', async () => {
    await pastRun(a.id, 'complete', { finishedAt: Date.now() - 10 * MIN });
    expect(((await (await start(a)).json()) as SweepPlan).skipped).toBe(1);
  });

  it('in corso per un altro agente da meno di 15 minuti', async () => {
    await pastRun(b.id, 'running', { startedAt: Date.now() - 10 * MIN, open: true });
    expect(((await (await start(a)).json()) as SweepPlan).skipped).toBe(1);
  });

  it('in corso da 16 minuti, o dello stesso agente: non si salta', async () => {
    await pastRun(b.id, 'running', { startedAt: Date.now() - 16 * MIN, open: true });
    await pastRun(a.id, 'running', { startedAt: Date.now() - 5 * MIN });
    expect(((await (await start(a)).json()) as SweepPlan).skipped).toBe(0);
  });

  it('tutte fresche: nessun giro', async () => {
    const solo = await agent(['016219']);
    const specs = searchesFor({ comuni: toComuneRefs(['016219']), categories: ['residential'] }, DEFAULT_SETTINGS.enabledPortals);
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO sweeps (id, user_id, started_at, last_activity_at, finished_at) VALUES (?, ?, 1, 1, 1)').bind(id, b.id),
      ...specs.map((s) => env.DB.prepare("INSERT INTO search_runs (sweep_id, search_key, portal, spec, user_id, status, finished_at) VALUES (?, ?, ?, '{}', ?, 'complete', ?)")
        .bind(id, s.key, s.portal, b.id, Date.now())),
    ]);
    const r = await start(solo);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ sweepId: null, searches: [], skipped: specs.length });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sweeps WHERE user_id = ?').bind(solo.id).first('n')).toBe(0);
  });

  it('il piano non dice chi ha fatto le ricerche', async () => {
    await pastRun(b.id, 'complete', { finishedAt: Date.now() - 5 * MIN });
    const text = await (await start(a)).text();
    expect(text).not.toContain(b.id);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['searches', 'skipped', 'sweepId']);
  });

  it('un giro alla volta: altro computer 409, giro fermo da 16 minuti o stesso computer si chiude', async () => {
    const other = await linkDevice(a.id);
    const first = (await (await start(a)).json()) as SweepPlan;
    const r = await start({ auth: other.auth });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'Giro già in corso su un altro computer' });

    await env.DB.prepare('UPDATE sweeps SET last_activity_at = ? WHERE id = ?').bind(Date.now() - 16 * MIN, first.sweepId).run();
    const second = (await (await start({ auth: other.auth })).json()) as SweepPlan;
    expect(await env.DB.prepare('SELECT outcome FROM sweeps WHERE id = ?').bind(first.sweepId).first('outcome')).toBe('interrupted');

    expect((await start({ auth: other.auth })).status).toBe(201);
    expect(await env.DB.prepare('SELECT outcome FROM sweeps WHERE id = ?').bind(second.sweepId).first('outcome')).toBe('interrupted');
  });

  it('portali spenti, nessun comune, campi in più', async () => {
    await fetchApi('PUT', '/api/settings', { enabledPortals: { subito: false } }, { Cookie: a.cookie });
    const plan = (await (await start(a)).json()) as SweepPlan;
    expect(plan.searches.some((s) => s.portal === 'subito')).toBe(false);
    const empty = await agent([]);
    const r = await start(empty);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Nessun comune assegnato: chiedi all'amministratore" });
    expect((await start(b, { comuni: ['016219'] })).status).toBe(400);
  });
});
