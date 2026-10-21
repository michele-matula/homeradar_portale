import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../src/crypto';
import { claimToken, EmailTaken, findUserByEmail, findUserById, insertUser, INVITE_TTL_MS, issueToken, readToken, RESET_TTL_MS, toComuneRefs } from '../src/users';
import { resetDb } from './helpers';

const agent = (email: string) => ({ email, role: 'agent' as const, comuni: ['015059'], maxComuni: 4 });

beforeEach(resetDb);

describe('utenti', () => {
  it('crea un utente invitato', async () => {
    const u = await insertUser(env.DB, agent('mario@rossi.it'), 5);
    expect(u).toMatchObject({ email: 'mario@rossi.it', role: 'agent', status: 'invited', comuni: ['015059'], maxComuni: 4, passwordHash: null, createdAt: 5 });
    expect(await findUserById(env.DB, u.id)).toEqual(u);
  });
  it('email duplicata con maiuscole e spazi', async () => {
    await insertUser(env.DB, agent('mario@rossi.it'), 1);
    await expect(insertUser(env.DB, agent(' Mario@Rossi.IT '), 2)).rejects.toBeInstanceOf(EmailTaken);
    expect((await findUserByEmail(env.DB, 'MARIO@rossi.it '))?.email).toBe('mario@rossi.it');
  });
  it('utente assente', async () => expect(await findUserByEmail(env.DB, 'nessuno@x.it')).toBeNull());
  it('comuni come ComuneRef, codici sconosciuti scartati', () => {
    const refs = toComuneRefs(['015059', '999999']);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ istat: '015059' });
  });
});

describe('token', () => {
  it('valido, poi usato', async () => {
    const u = await insertUser(env.DB, agent('a@b.it'), 0);
    const t = await issueToken(env.DB, u.id, 'invite', 0);
    const r = await readToken(env.DB, t, 1);
    expect(r?.kind).toBe('invite');
    expect(r?.user.id).toBe(u.id);
    expect(await claimToken(env.DB, t, 2)).toBe(true);
    expect(await readToken(env.DB, t, 3)).toBeNull();
  });
  it('invito scaduto', async () => {
    const u = await insertUser(env.DB, agent('a@b.it'), 0);
    const t = await issueToken(env.DB, u.id, 'invite', 0);
    expect(await readToken(env.DB, t, INVITE_TTL_MS - 1)).not.toBeNull();
    expect(await readToken(env.DB, t, INVITE_TTL_MS + 1)).toBeNull();
  });
  it('reimpostazione valida un\'ora', async () => {
    const u = await insertUser(env.DB, agent('a@b.it'), 0);
    const t = await issueToken(env.DB, u.id, 'reset', 0);
    expect(await readToken(env.DB, t, RESET_TTL_MS + 1)).toBeNull();
  });
  it('un nuovo invito invalida il precedente', async () => {
    const u = await insertUser(env.DB, agent('a@b.it'), 0);
    const t1 = await issueToken(env.DB, u.id, 'invite', 0);
    const t2 = await issueToken(env.DB, u.id, 'invite', 1);
    expect(await readToken(env.DB, t1, 2)).toBeNull();
    expect(await readToken(env.DB, t2, 2)).not.toBeNull();
  });
  it('claimToken consuma il link una sola volta, anche se letto due volte prima', async () => {
    const u = await insertUser(env.DB, agent('a@b.it'), 0);
    const t = await issueToken(env.DB, u.id, 'invite', 0);
    expect(await readToken(env.DB, t, 1)).not.toBeNull();
    expect(await readToken(env.DB, t, 1)).not.toBeNull();
    expect(await claimToken(env.DB, t, 2)).toBe(true);
    expect(await claimToken(env.DB, t, 3)).toBe(false);
  });

  it('claimToken rifiuta un link scaduto', async () => {
    const u = await insertUser(env.DB, agent('a@b.it'), 0);
    const t = await issueToken(env.DB, u.id, 'invite', 0);
    expect(await claimToken(env.DB, t, INVITE_TTL_MS + 1)).toBe(false);
  });

  it('token sconosciuto', async () => expect(await readToken(env.DB, 'nulla', 0)).toBeNull());
  it('nel database solo l\'hash del token', async () => {
    const u = await insertUser(env.DB, agent('a@b.it'), 0);
    const t = await issueToken(env.DB, u.id, 'invite', 0);
    const row = await env.DB.prepare('SELECT token_hash FROM tokens').first<{ token_hash: string }>();
    expect(row?.token_hash).not.toBe(t);
    expect(row?.token_hash).toBe(await hashToken(t));
  });
});
