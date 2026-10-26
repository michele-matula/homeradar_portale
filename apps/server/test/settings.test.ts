import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@homeradar/shared/api/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { fetchApi, loginAs, resetDb } from './helpers';

let a: { id: string; cookie: string };
const put = (body: unknown, cookie = a.cookie) => fetchApi('PUT', '/api/settings', body, { Cookie: cookie });
const get = async (cookie = a.cookie) => (await (await fetchApi('GET', '/api/settings', undefined, { Cookie: cookie })).json()) as AgentSettings;

beforeEach(async () => {
  await resetDb();
  a = await loginAs('agent');
});

describe('impostazioni dell\'agente', () => {
  it('senza sessione', async () => {
    expect((await fetchApi('GET', '/api/settings')).status).toBe(401);
    expect((await fetchApi('PUT', '/api/settings', { minAgeDays: 90 })).status).toBe(401);
  });

  it('default alla prima lettura, poi modifiche parziali', async () => {
    expect(await get()).toEqual(DEFAULT_AGENT_SETTINGS);
    const r = await put({ minAgeDays: 90 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ...DEFAULT_AGENT_SETTINGS, minAgeDays: 90 });
    await put({ enabledPortals: { subito: false } });
    expect(await get()).toEqual({ ...DEFAULT_AGENT_SETTINGS, minAgeDays: 90, enabledPortals: { ...DEFAULT_AGENT_SETTINGS.enabledPortals, subito: false } });
  });

  it('almeno un portale acceso', async () => {
    const r = await put({ enabledPortals: { immobiliare: false, idealista: false, subito: false, casadaprivato: false } });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Attiva almeno un portale' });
    expect(await get()).toEqual(DEFAULT_AGENT_SETTINGS);
  });

  it('valori non validi', async () => {
    const r = await put({ minAgeDays: 0 });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Soglia giorni non valida' });
  });

  it('le impostazioni sono di ciascun agente', async () => {
    const b = await loginAs('agent');
    await put({ categories: ['garage'] });
    expect((await get(b.cookie)).categories).toEqual(['residential']);
  });

  it('PUT da un\'altra origine', async () => {
    expect((await fetchApi('PUT', '/api/settings', { minAgeDays: 90 }, { Cookie: a.cookie, Origin: 'https://evil.test' })).status).toBe(403);
  });
});

describe('giro automatico', () => {
  it('spento e una volta al giorno di default', async () => {
    expect(await get()).toMatchObject({ autoSweep: false, autoSweepHours: null });
  });

  it('si accende con una frequenza e il resto non cambia', async () => {
    const r = await put({ autoSweep: true, autoSweepHours: 4 });
    expect(r.status).toBe(200);
    expect(await get()).toEqual({ ...DEFAULT_AGENT_SETTINGS, autoSweep: true, autoSweepHours: 4 });
    await put({ autoSweepHours: null });
    expect(await get()).toEqual({ ...DEFAULT_AGENT_SETTINGS, autoSweep: true, autoSweepHours: null });
  });

  it('frequenza non ammessa', async () => {
    const r = await put({ autoSweepHours: 2 });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Frequenza del giro automatico non valida' });
  });
});
