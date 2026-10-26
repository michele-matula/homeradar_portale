import { env } from 'cloudflare:workers';
import { PRIVACY_VERSION, type AdminUser } from '@homeradar/shared/api/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, fetchApi, loginAs, resetDb } from './helpers';

// Cinque comuni validi della provincia di Bergamo.
const COMUNI = ['016001', '016002', '016003', '016004', '016005'];
const TREVIGLIO = '016219';

let admin: { id: string; cookie: string };
const as = (cookie: string) => ({ Cookie: cookie });
const call = (method: string, path: string, body?: unknown) => fetchApi(method, path, body, as(admin.cookie));
const users = async () => ((await (await call('GET', '/api/admin/users')).json()) as { users: AdminUser[] }).users;

async function create(email: string, comuni: string[] = [TREVIGLIO]): Promise<{ user: AdminUser; inviteUrl: string }> {
  const r = await call('POST', '/api/admin/users', { email, comuni });
  expect(r.status).toBe(201);
  return r.json();
}

async function activeAgent(email = 'luca@bianchi.it'): Promise<{ user: AdminUser; cookie: string }> {
  const { user, inviteUrl } = await create(email);
  const token = inviteUrl.split('/').pop()!;
  const r = await fetchApi('POST', `/api/tokens/${token}`, { password: 'password-lunga', privacyVersion: PRIVACY_VERSION });
  return { user, cookie: cookieFrom(r) };
}

beforeEach(async () => {
  await resetDb();
  admin = await loginAs('admin', 'admin@homeradar.test');
});

describe('accesso all\'admin', () => {
  it('un agente non entra', async () => {
    const agent = await loginAs('agent');
    const r = await fetchApi('GET', '/api/admin/users', undefined, as(agent.cookie));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "Riservato all'amministratore" });
    expect((await fetchApi('POST', '/api/admin/users', { email: 'x@y.it', comuni: [] }, as(agent.cookie))).status).toBe(403);
  });
  it('senza sessione', async () => expect((await fetchApi('GET', '/api/admin/users')).status).toBe(401));
});

describe('creazione', () => {
  it('crea un agente con il link d\'invito', async () => {
    const { user, inviteUrl } = await create(' Luca@Bianchi.it');
    expect(user).toMatchObject({ email: 'luca@bianchi.it', role: 'agent', status: 'invited', maxComuni: 4, comuni: [{ istat: TREVIGLIO, name: 'Treviglio' }], lastSeenAt: null });
    expect(inviteUrl).toMatch(/^https:\/\/portale\.test\/attiva\/[A-Za-z0-9_-]{43}$/);
    expect((await users()).map((u) => u.email)).toEqual(['admin@homeradar.test', 'luca@bianchi.it']);
  });
  it('limite comuni scelto alla creazione', async () => {
    const r = await call('POST', '/api/admin/users', { email: 'a@b.it', comuni: COMUNI, maxComuni: 5 });
    expect(r.status).toBe(201);
  });
  it('limite comuni di default dalla configurazione', async () => {
    await env.DB.prepare("UPDATE config SET value = '2' WHERE key = 'default_max_comuni'").run();
    const { user } = await create('a@b.it');
    expect(user.maxComuni).toBe(2);
    await env.DB.prepare("UPDATE config SET value = '4' WHERE key = 'default_max_comuni'").run();
  });
  it('email già presente', async () => {
    await create('luca@bianchi.it');
    const r = await call('POST', '/api/admin/users', { email: 'LUCA@bianchi.it', comuni: [] });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'Esiste già un utente con questa email' });
  });
});

describe('regole sui comuni', () => {
  it('comune sconosciuto, ripetuto, oltre il limite', async () => {
    const cases: [string[], string][] = [
      [['999999'], 'Comune sconosciuto: 999999'],
      [[TREVIGLIO, TREVIGLIO], 'Comune ripetuto'],
      [COMUNI, 'Al massimo 4 comuni per questo utente'],
    ];
    for (const [comuni, error] of cases) {
      const r = await call('POST', '/api/admin/users', { email: 'nuovo@b.it', comuni });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error });
    }
    expect((await users()).map((u) => u.email)).toEqual(['admin@homeradar.test']);
    const { user } = await create('luca@bianchi.it');
    for (const [comuni, error] of cases) {
      const r = await call('PATCH', `/api/admin/users/${user.id}`, { comuni });
      expect(await r.json()).toEqual({ error });
    }
    expect((await users()).find((u) => u.id === user.id)?.comuni.map((c) => c.istat)).toEqual([TREVIGLIO]);
  });
  it('alzare il limite e aggiungere comuni nella stessa richiesta', async () => {
    const { user } = await create('luca@bianchi.it');
    const r = await call('PATCH', `/api/admin/users/${user.id}`, { maxComuni: 6, comuni: [...COMUNI, TREVIGLIO] });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { user: AdminUser }).user).toMatchObject({ maxComuni: 6 });
  });
  it('abbassare il limite sotto i comuni già assegnati', async () => {
    const { user } = await create('luca@bianchi.it', COMUNI.slice(0, 3));
    const r = await call('PATCH', `/api/admin/users/${user.id}`, { maxComuni: 2 });
    expect(await r.json()).toEqual({ error: 'Al massimo 2 comuni per questo utente' });
  });
});

describe('stato', () => {
  it('sospendere: la sessione aperta riceve "Account sospeso" una volta, poi si chiude; riattivare riapre l\'accesso', async () => {
    const agent = await activeAgent();
    expect((await fetchApi('GET', '/api/me', undefined, as(agent.cookie))).status).toBe(200);
    const r = await call('PATCH', `/api/admin/users/${agent.user.id}`, { status: 'suspended' });
    expect(((await r.json()) as { user: AdminUser }).user.status).toBe('suspended');
    const me = await fetchApi('GET', '/api/me', undefined, as(agent.cookie));
    expect(me.status).toBe(403);
    expect(await me.json()).toEqual({ error: 'Account sospeso' });
    expect(me.headers.get('Set-Cookie')).toMatch(/^hr_session=; .*Max-Age=0/);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(agent.user.id).first<{ n: number }>())?.n).toBe(0);
    expect((await fetchApi('POST', '/api/login', { email: 'luca@bianchi.it', password: 'password-lunga' })).status).toBe(403);
    await call('PATCH', `/api/admin/users/${agent.user.id}`, { status: 'active' });
    expect((await fetchApi('POST', '/api/login', { email: 'luca@bianchi.it', password: 'password-lunga' })).status).toBe(200);
  });
  it('un invitato non si sospende', async () => {
    const { user } = await create('luca@bianchi.it');
    const r = await call('PATCH', `/api/admin/users/${user.id}`, { status: 'suspended' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "L'utente non ha ancora attivato l'account" });
  });
});

describe('link', () => {
  it('nuovo invito invalida il vecchio', async () => {
    const { user, inviteUrl } = await create('luca@bianchi.it');
    const r = await call('POST', `/api/admin/users/${user.id}/invite`);
    const { inviteUrl: nuovo } = (await r.json()) as { inviteUrl: string };
    expect((await fetchApi('GET', `/api/tokens/${inviteUrl.split('/').pop()}`)).status).toBe(404);
    expect((await fetchApi('GET', `/api/tokens/${nuovo.split('/').pop()}`)).status).toBe(200);
  });
  it('invito per un account attivo', async () => {
    const agent = await activeAgent();
    const r = await call('POST', `/api/admin/users/${agent.user.id}/invite`);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "L'account è già attivo" });
  });
  it('link di reimpostazione', async () => {
    const agent = await activeAgent();
    const r = await call('POST', `/api/admin/users/${agent.user.id}/reset`);
    const { resetUrl } = (await r.json()) as { resetUrl: string };
    expect(resetUrl).toMatch(/^https:\/\/portale\.test\/reimposta\/[A-Za-z0-9_-]{43}$/);
    expect(await (await fetchApi('GET', `/api/tokens/${resetUrl.split('/').pop()}`)).json()).toEqual({ kind: 'reset', email: 'luca@bianchi.it' });
  });
  it('reset solo per account attivi', async () => {
    const { user } = await create('luca@bianchi.it');
    const r = await call('POST', `/api/admin/users/${user.id}/reset`);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "L'account non è attivo" });
  });
});

describe('eliminazione', () => {
  it('cancella utente, sessioni e token', async () => {
    const agent = await activeAgent();
    expect((await call('DELETE', `/api/admin/users/${agent.user.id}`)).status).toBe(204);
    for (const t of ['users', 'sessions', 'tokens']) {
      const col = t === 'users' ? 'id' : 'user_id';
      expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`).bind(agent.user.id).first<{ n: number }>())?.n).toBe(0);
    }
    expect((await fetchApi('GET', '/api/me', undefined, as(agent.cookie))).status).toBe(401);
  });
  it('utente assente', async () => {
    const r = await call('DELETE', '/api/admin/users/nessuno');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Utente non trovato' });
  });
  it('l\'account amministratore non si tocca da qui', async () => {
    for (const [method, path, body] of [
      ['DELETE', `/api/admin/users/${admin.id}`, undefined],
      ['PATCH', `/api/admin/users/${admin.id}`, { status: 'suspended' }],
      ['POST', `/api/admin/users/${admin.id}/reset`, undefined],
    ] as const) {
      const r = await call(method, path, body);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "L'account amministratore non si modifica da qui" });
    }
  });
});
