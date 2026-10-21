import { env } from 'cloudflare:workers';
import { PRIVACY_VERSION } from '@homeradar/shared/api/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../src/crypto';
import { findUserByEmail, insertUser, issueToken } from '../src/users';
import { cookieFrom, fetchApi, resetDb } from './helpers';

const PW = 'password-lunga';
const DAY = 86_400_000;

async function invite(email: string): Promise<string> {
  const u = await insertUser(env.DB, { email, role: 'agent', comuni: ['015059'], maxComuni: 4 }, Date.now());
  return issueToken(env.DB, u.id, 'invite', Date.now());
}

async function activate(email: string): Promise<string> {
  const r = await fetchApi('POST', `/api/tokens/${await invite(email)}`, { password: PW, privacyVersion: PRIVACY_VERSION });
  expect(r.status).toBe(200);
  return cookieFrom(r);
}

const me = (cookie: string) => fetchApi('GET', '/api/me', undefined, { Cookie: cookie });
const login = (email: string, password: string, headers: Record<string, string> = {}) => fetchApi('POST', '/api/login', { email, password }, headers);

beforeEach(resetDb);

describe('attivazione', () => {
  it('attivazione completa e accesso', async () => {
    const t = await invite('mario@rossi.it');
    expect(await (await fetchApi('GET', `/api/tokens/${t}`)).json()).toEqual({ kind: 'invite', email: 'mario@rossi.it' });
    const r = await fetchApi('POST', `/api/tokens/${t}`, { password: PW, privacyVersion: PRIVACY_VERSION });
    expect(r.status).toBe(200);
    expect(r.headers.get('Set-Cookie')).toMatch(/^hr_session=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/);
    expect(((await r.json()) as { user: unknown }).user).toMatchObject({ email: 'mario@rossi.it', role: 'agent', comuni: [{ istat: '015059' }] });
    expect(await findUserByEmail(env.DB, 'mario@rossi.it')).toMatchObject({ status: 'active', privacyVersion: PRIVACY_VERSION });
    const l = await login(' MARIO@rossi.it', PW);
    expect(l.status).toBe(200);
    expect((await me(cookieFrom(l))).status).toBe(200);
  });

  it('informativa non accettata', async () => {
    const r = await fetchApi('POST', `/api/tokens/${await invite('mario@rossi.it')}`, { password: PW });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Devi accettare l'informativa" });
    expect((await findUserByEmail(env.DB, 'mario@rossi.it'))?.status).toBe('invited');
  });

  it('password troppo corta', async () => {
    const r = await fetchApi('POST', `/api/tokens/${await invite('a@b.it')}`, { password: 'corta', privacyVersion: PRIVACY_VERSION });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'La password deve avere almeno 10 caratteri' });
  });

  it('link usato due volte', async () => {
    const t = await invite('mario@rossi.it');
    await fetchApi('POST', `/api/tokens/${t}`, { password: PW, privacyVersion: PRIVACY_VERSION });
    const again = await fetchApi('POST', `/api/tokens/${t}`, { password: 'altra-password', privacyVersion: PRIVACY_VERSION });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: 'Link non valido o scaduto' });
    expect((await fetchApi('GET', `/api/tokens/${t}`)).status).toBe(404);
    expect((await login('mario@rossi.it', 'altra-password')).status).toBe(401);
  });

  it('un invito non riattiva un account già attivo o sospeso', async () => {
    await activate('mario@rossi.it');
    const u = (await findUserByEmail(env.DB, 'mario@rossi.it'))!;
    await env.DB.prepare("UPDATE users SET status = 'suspended'").run();
    const t = await issueToken(env.DB, u.id, 'invite', Date.now());
    expect((await fetchApi('GET', `/api/tokens/${t}`)).status).toBe(404);
    expect((await fetchApi('POST', `/api/tokens/${t}`, { password: PW, privacyVersion: PRIVACY_VERSION })).status).toBe(404);
    expect((await findUserByEmail(env.DB, 'mario@rossi.it'))?.status).toBe('suspended');
  });

  it('due attivazioni simultanee con lo stesso link: ne passa una sola', async () => {
    const t = await invite('mario@rossi.it');
    const results = await Promise.all(
      ['password-uno-1', 'password-due-2'].map((password) => fetchApi('POST', `/api/tokens/${t}`, { password, privacyVersion: PRIVACY_VERSION })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>())?.n).toBe(1);
  });

  it('una richiesta senza informativa non consuma il link', async () => {
    const t = await invite('mario@rossi.it');
    await fetchApi('POST', `/api/tokens/${t}`, { password: PW });
    expect((await fetchApi('POST', `/api/tokens/${t}`, { password: PW, privacyVersion: PRIVACY_VERSION })).status).toBe(200);
  });

  it('link scaduto', async () => {
    const t = await invite('mario@rossi.it');
    await env.DB.prepare('UPDATE tokens SET expires_at = 1').run();
    expect((await fetchApi('GET', `/api/tokens/${t}`)).status).toBe(404);
  });
});

describe('accesso', () => {
  it('password sbagliata ed email sconosciuta: stesso messaggio', async () => {
    await activate('mario@rossi.it');
    for (const [email, pw] of [['mario@rossi.it', 'sbagliata!!'], ['nessuno@rossi.it', PW]] as const) {
      const r = await login(email, pw);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: 'Email o password errati' });
    }
  });

  it('utente invitato non può accedere', async () => {
    await invite('mario@rossi.it');
    expect((await login('mario@rossi.it', PW)).status).toBe(401);
  });

  it('dopo 5 errori sulla stessa email: 429 anche con la password giusta', async () => {
    await activate('mario@rossi.it');
    for (let i = 0; i < 5; i++) await login('mario@rossi.it', 'sbagliata!!');
    const r = await login('mario@rossi.it', PW);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'Troppi tentativi: riprova fra qualche minuto' });
  });

  it('tentativi in parallelo: al massimo 5 arrivano alla verifica', async () => {
    await activate('mario@rossi.it');
    const results = await Promise.all(Array.from({ length: 12 }, () => login('mario@rossi.it', 'sbagliata!!')));
    expect(results.filter((r) => r.status !== 429).length).toBeLessThanOrEqual(5);
  });

  it('dopo 20 errori dallo stesso IP: 429 solo da quell\'IP', async () => {
    await activate('mario@rossi.it');
    for (let i = 0; i < 20; i++) await login(`x${i}@rossi.it`, PW, { 'CF-Connecting-IP': '1.2.3.4' });
    expect((await login('mario@rossi.it', PW, { 'CF-Connecting-IP': '1.2.3.4' })).status).toBe(429);
    expect((await login('mario@rossi.it', PW, { 'CF-Connecting-IP': '5.6.7.8' })).status).toBe(200);
  });

  it('un accesso riuscito azzera gli errori dell\'email', async () => {
    await activate('mario@rossi.it');
    for (let i = 0; i < 4; i++) await login('mario@rossi.it', 'sbagliata!!');
    expect((await login('mario@rossi.it', PW)).status).toBe(200);
    for (let i = 0; i < 4; i++) await login('mario@rossi.it', 'sbagliata!!');
    expect((await login('mario@rossi.it', PW)).status).toBe(200);
  });

  it('accesso di un sospeso', async () => {
    await activate('mario@rossi.it');
    await env.DB.prepare("UPDATE users SET status = 'suspended'").run();
    const r = await login('mario@rossi.it', PW);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'Account sospeso' });
  });
});

describe('sessione', () => {
  it('me senza cookie', async () => {
    const r = await me('');
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'Accesso richiesto' });
  });

  it('me con un cookie inventato: 401 e cookie cancellato', async () => {
    const r = await me('hr_session=inventato');
    expect(r.status).toBe(401);
    expect(r.headers.get('Set-Cookie')).toMatch(/^hr_session=; .*Max-Age=0/);
  });

  it('sessione scaduta', async () => {
    const c = await activate('mario@rossi.it');
    await env.DB.prepare('UPDATE sessions SET expires_at = 1').run();
    expect((await me(c)).status).toBe(401);
  });

  it('sospeso con sessione aperta', async () => {
    const c = await activate('mario@rossi.it');
    await env.DB.prepare("UPDATE users SET status = 'suspended'").run();
    const r = await me(c);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'Account sospeso' });
    expect(r.headers.get('Set-Cookie')).toMatch(/^hr_session=; .*Max-Age=0/);
  });

  it('rinnovata quando ne mancano meno di 15 giorni', async () => {
    const c = await activate('mario@rossi.it');
    await env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() + 10 * DAY).run();
    const r = await me(c);
    expect(r.status).toBe(200);
    expect(r.headers.get('Set-Cookie')).toMatch(/^hr_session=.*Max-Age=2592000/);
    const s = await env.DB.prepare('SELECT expires_at FROM sessions').first<{ expires_at: number }>();
    expect(s!.expires_at).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it('non rinnovata se mancano più di 15 giorni', async () => {
    const r = await me(await activate('mario@rossi.it'));
    expect(r.headers.get('Set-Cookie')).toBeNull();
  });

  it('nel database solo l\'hash della sessione', async () => {
    const c = await activate('mario@rossi.it');
    const s = await env.DB.prepare('SELECT token_hash FROM sessions').first<{ token_hash: string }>();
    expect(s!.token_hash).toBe(await hashToken(c.slice('hr_session='.length)));
  });

  it('aggiorna l\'ultimo accesso', async () => {
    await me(await activate('mario@rossi.it'));
    expect((await findUserByEmail(env.DB, 'mario@rossi.it'))?.lastSeenAt).toBeGreaterThan(0);
  });

  it('logout chiude la sessione', async () => {
    const c = await activate('mario@rossi.it');
    const r = await fetchApi('POST', '/api/logout', undefined, { Cookie: c });
    expect(r.status).toBe(204);
    expect(r.headers.get('Set-Cookie')).toMatch(/Max-Age=0/);
    expect((await me(c)).status).toBe(401);
  });
});

describe('reimpostazione', () => {
  it('chiude le altre sessioni e cambia la password', async () => {
    const c1 = await activate('mario@rossi.it');
    const u = (await findUserByEmail(env.DB, 'mario@rossi.it'))!;
    const t = await issueToken(env.DB, u.id, 'reset', Date.now());
    expect(await (await fetchApi('GET', `/api/tokens/${t}`)).json()).toEqual({ kind: 'reset', email: 'mario@rossi.it' });
    const r = await fetchApi('POST', `/api/tokens/${t}`, { password: 'nuova-password' });
    expect(r.status).toBe(200);
    expect((await me(c1)).status).toBe(401);
    expect((await me(cookieFrom(r))).status).toBe(200);
    expect((await login('mario@rossi.it', PW)).status).toBe(401);
    expect((await login('mario@rossi.it', 'nuova-password')).status).toBe(200);
  });

  it('rifiutata per un sospeso', async () => {
    await activate('mario@rossi.it');
    const u = (await findUserByEmail(env.DB, 'mario@rossi.it'))!;
    const t = await issueToken(env.DB, u.id, 'reset', Date.now());
    await env.DB.prepare("UPDATE users SET status = 'suspended'").run();
    const r = await fetchApi('POST', `/api/tokens/${t}`, { password: 'nuova-password' });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'Account sospeso' });
  });
});
