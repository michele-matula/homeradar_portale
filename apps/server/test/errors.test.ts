import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { ERROR_TTL_MS } from '../src/errors';
import { fetchApi, fetchConnector, linkDevice, loginAs, resetDb } from './helpers';

beforeEach(resetDb);

interface ErrorRow {
  source: string;
  version: string;
  message: string;
  user_id: string;
  device_id: string;
  device_name: string | null;
  context: string | null;
  count: number;
  first_at: number;
  last_at: number;
}

const rows = async () => (await env.DB.prepare('SELECT * FROM errors ORDER BY id').all<ErrorRow>()).results;
const report = (errors: { message: string; context?: string; at: number }[], headers: Record<string, string> = {}) =>
  fetchApi('POST', '/api/errors', { version: 'abc1234', errors }, headers);
const one = (message: string, at = Date.now()) => [{ message, at }];

describe('errori del portale', () => {
  it("si salva solo il messaggio ripulito, legato all'agente", async () => {
    const u = await loginAs('agent');
    const at = Date.now();
    const r = await report(
      [{ message: 'Errore su https://www.immobiliare.it/annunci/123456 prezzo 250000 "Villa al mare"', context: '/lead/:chiave', at }],
      { Cookie: u.cookie },
    );
    expect(r.status).toBe(204);
    const [e] = await rows();
    expect(e).toMatchObject({ source: 'portal', version: 'abc1234', message: 'Errore su <url> prezzo # <testo>', user_id: u.id, device_id: '', context: '/lead/:chiave', count: 1 });
  });

  it('lo stesso errore due volte è un gruppo solo', async () => {
    const u = await loginAs('agent');
    const t0 = Date.now() - 60_000;
    await report(one('Boom', t0), { Cookie: u.cookie });
    await report(one('Boom'), { Cookie: u.cookie });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.count).toBe(2);
    expect(all[0]!.first_at).toBe(t0);
    expect(all[0]!.last_at).toBeGreaterThan(t0);
  });

  it('senza sessione si salva senza agente; senza Origin no', async () => {
    expect((await report(one('Anonimo'))).status).toBe(204);
    expect((await rows())[0]!.user_id).toBe('');
    const r = await fetchApi('POST', '/api/errors', { version: 'abc', errors: one('x') }, { Origin: 'https://altro.test' });
    expect(r.status).toBe(403);
  });

  it('al più 20 errori per richiesta', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ message: `E${i}`, at: Date.now() }));
    const r = await report(many);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Segnalazione non valida' });
  });

  it('al più 100 errori l\'ora per sessione e 30 per IP senza sessione', async () => {
    const u = await loginAs('agent');
    for (let k = 0; k < 6; k++) {
      const batch = Array.from({ length: 20 }, (_, i) => ({ message: `S${k}-${i}`, at: Date.now() })).slice(0, k === 5 ? 1 : 20);
      expect((await report(batch, { Cookie: u.cookie })).status).toBe(204);
    }
    expect((await rows()).filter((e) => e.user_id === u.id)).toHaveLength(100);
    await resetDb();
    for (let k = 0; k < 2; k++) {
      const batch = Array.from({ length: k === 0 ? 20 : 11 }, (_, i) => ({ message: `A${k}-${i}`, at: Date.now() }));
      expect((await report(batch, { 'CF-Connecting-IP': '203.0.113.7' })).status).toBe(204);
    }
    expect(await rows()).toHaveLength(30);
  });

  it("un'ora del client nel futuro o troppo vecchia diventa quella del server", async () => {
    const before = Date.now();
    await report([{ message: 'Futuro', at: before + 86_400_000 }, { message: 'Vecchio', at: before - 8 * 86_400_000 }]);
    for (const e of await rows()) {
      expect(e.first_at).toBeGreaterThanOrEqual(before);
      expect(e.first_at).toBeLessThanOrEqual(Date.now());
    }
  });

  it('i gruppi fermi da oltre 90 giorni si cancellano', async () => {
    const old = Date.now() - ERROR_TTL_MS - 86_400_000;
    await env.DB.prepare("INSERT INTO errors (source, version, message, count, first_at, last_at) VALUES ('portal', 'v', 'Vecchio', 1, ?, ?)").bind(old, old).run();
    await report(one('Nuovo'));
    expect((await rows()).map((e) => e.message)).toEqual(['Nuovo']);
  });
});

describe('errori del connettore', () => {
  it('si legano al dispositivo, col suo nome', async () => {
    const u = await loginAs('agent');
    const d = await linkDevice(u.id);
    const r = await fetchConnector('POST', '/connector/errors', { version: '0.4.0', errors: one('Ricerca non riuscita: annunci non letti') }, d.auth);
    expect(r.status).toBe(204);
    expect((await rows())[0]).toMatchObject({ source: 'connector', version: '0.4.0', user_id: u.id, device_id: d.id, device_name: 'PC di prova' });
  });

  it('senza token → 401', async () => {
    const r = await fetchConnector('POST', '/connector/errors', { version: '0.4.0', errors: one('x') });
    expect(r.status).toBe(401);
  });
});

describe('errori del server', () => {
  it('una rotta che lancia risponde 500 e lascia un errore', async () => {
    const u = await loginAs('agent');
    await env.DB.prepare('ALTER TABLE user_settings RENAME TO user_settings_x').run();
    try {
      const r = await fetchApi('GET', '/api/settings', undefined, { Cookie: u.cookie });
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ error: 'Errore interno' });
    } finally {
      await env.DB.prepare('ALTER TABLE user_settings_x RENAME TO user_settings').run();
    }
    expect((await rows())[0]).toMatchObject({ source: 'server', version: 'dev', context: '/api/settings', count: 1 });
  });
});

describe('agente eliminato', () => {
  it('i suoi errori restano senza agente né dispositivo', async () => {
    const admin = await loginAs('admin');
    const u = await loginAs('agent');
    await report(one('Comune'), { Cookie: u.cookie });
    await report(one('Comune'));
    await report(one('Solo suo'), { Cookie: u.cookie });
    const r = await fetchApi('DELETE', `/api/admin/users/${u.id}`, undefined, { Cookie: admin.cookie });
    expect(r.status).toBe(204);
    const all = await rows();
    expect(all.every((e) => e.user_id === '' && e.device_id === '')).toBe(true);
    expect(all.map((e) => e.message).sort()).toEqual(['Comune', 'Solo suo']);
  });
});

describe('revisione finale', () => {
  it('i token di invito e reimpostazione non finiscono negli errori, né nel messaggio né nel contesto', async () => {
    const token = 'Zx9_kLmN-oPqRsTuVwXyZaBcDeFgHiJk';
    await report([{ message: `API POST /api/tokens/${token}: 500 Errore interno`, context: `/attiva/${token}`, at: Date.now() }]);
    await env.DB.prepare('ALTER TABLE tokens RENAME TO tokens_x').run();
    try {
      expect((await fetchApi('GET', `/api/tokens/${token}`)).status).toBe(500);
    } finally {
      await env.DB.prepare('ALTER TABLE tokens_x RENAME TO tokens').run();
    }
    const all = await rows();
    expect(JSON.stringify(all)).not.toContain(token);
    expect(all.find((e) => e.source === 'portal')).toMatchObject({ message: 'API POST /api/tokens/:token: 500 Errore interno', context: '/attiva/:token' });
    expect(all.find((e) => e.source === 'server')!.context).toBe('/api/tokens/:token');
  });

  it('senza sessione: indirizzi IPv6 della stessa /64 contano insieme', async () => {
    for (const ip of ['2001:db8:1:2::a', '2001:db8:1:2::b']) {
      const batch = Array.from({ length: 20 }, (_, i) => ({ message: `${ip}-${i}`, at: Date.now() }));
      await report(batch, { 'CF-Connecting-IP': ip });
    }
    expect(await rows()).toHaveLength(30);
  });

  it('senza sessione: al più 200 l\'ora in tutto, da qualunque IP', async () => {
    for (let k = 0; k < 11; k++) {
      const batch = Array.from({ length: 20 }, (_, i) => ({ message: `${k}-${i}`, at: Date.now() }));
      await report(batch, { 'CF-Connecting-IP': `203.0.113.${k}` });
    }
    expect(await rows()).toHaveLength(200);
  });

  it('senza sessione la versione inventata non crea gruppi nuovi', async () => {
    await fetchApi('POST', '/api/errors', { version: 'qualunque-cosa', errors: one('x') });
    await fetchApi('POST', '/api/errors', { version: 'abc1234', errors: one('x') });
    expect((await rows()).map((e) => e.version).sort()).toEqual(['abc1234', 'sconosciuta']);
  });

  it('agente eliminato: i conteggi si sommano al gruppo anonimo, non si perdono', async () => {
    const admin = await loginAs('admin');
    const u = await loginAs('agent');
    const t0 = Date.now() - 3 * 86_400_000;
    await report(one('Comune', t0), { Cookie: u.cookie });
    await report(one('Comune'), { Cookie: u.cookie });
    await report(one('Comune'));
    await fetchApi('DELETE', `/api/admin/users/${u.id}`, undefined, { Cookie: admin.cookie });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ user_id: '', count: 3, first_at: t0 });
  });
});
