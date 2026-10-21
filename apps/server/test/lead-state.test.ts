import { env } from 'cloudflare:workers';
import type { LeadsResponse } from '@homeradar/shared/api/types';
import { RECALL_ON_DISCARDED } from '@homeradar/shared/core/lead-state';
import { beforeEach, describe, expect, it } from 'vitest';
import { fetchApi, loginAs, putListing, resetDb } from './helpers';

let a: { id: string; cookie: string };
let b: { id: string; cookie: string };
const X = 'immobiliare:1';
const Y = 'idealista:2';

async function agent(): Promise<{ id: string; cookie: string }> {
  const u = await loginAs('agent');
  await env.DB.prepare(`UPDATE users SET comuni = '["016219"]' WHERE id = ?`).bind(u.id).run();
  return u;
}
const patch = (body: unknown, cookie = a.cookie, headers: Record<string, string> = {}) => fetchApi('PATCH', '/api/leads/state', body, { Cookie: cookie, ...headers });
const leads = async (cookie: string) => ((await (await fetchApi('GET', '/api/leads', undefined, { Cookie: cookie })).json()) as LeadsResponse).leads;
const rows = async (userId: string) =>
  (await env.DB.prepare('SELECT listing_key, status, notes FROM lead_states WHERE user_id = ? ORDER BY listing_key').bind(userId).all()).results;

beforeEach(async () => {
  await resetDb();
  a = await agent();
  b = await agent();
  await putListing({ portal: 'immobiliare', portalId: 1, zone: 'Centro' });
  await putListing({ portal: 'idealista', portalId: 2, zone: 'Centro' });
});

describe('PATCH /api/leads/state', () => {
  it('lo stesso stato su tutto il gruppo, visibile nei lead', async () => {
    const r = await patch({ keys: [X, Y], status: 'contacted', notes: 'sera' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { state: { listingKey: string; status: string } }).state).toMatchObject({ listingKey: X, status: 'contacted', notes: 'sera' });
    expect(await rows(a.id)).toEqual([
      { listing_key: Y, status: 'contacted', notes: 'sera' },
      { listing_key: X, status: 'contacted', notes: 'sera' },
    ]);
    expect((await leads(a.cookie))[0]!.state).toMatchObject({ status: 'contacted', notes: 'sera' });
  });

  it('un richiamo su un lead nuovo lo porta a "Da contattare"; su uno scartato è rifiutato', async () => {
    const r = await patch({ keys: [X, Y], recallAt: Date.now() + 86_400_000 });
    expect(((await r.json()) as { state: { status: string } }).state.status).toBe('to_contact');
    await patch({ keys: [X, Y], status: 'discarded' });
    const bad = await patch({ keys: [X, Y], recallAt: Date.now() });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: RECALL_ON_DISCARDED });
  });

  it('annuncio inesistente: 404 e nulla scritto', async () => {
    const r = await patch({ keys: [X, 'subito:99'], status: 'contacted' });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Annuncio non trovato' });
    expect(await rows(a.id)).toEqual([]);
  });

  it('lo stato di un agente non tocca l\'altro', async () => {
    await patch({ keys: [X, Y], status: 'contacted', notes: 'mia nota' });
    await patch({ keys: [X, Y], status: 'to_contact' }, b.cookie);
    expect((await rows(a.id)).map((r) => r.status)).toEqual(['contacted', 'contacted']);
    expect((await rows(b.id)).map((r) => [r.status, r.notes])).toEqual([['to_contact', ''], ['to_contact', '']]);
  });

  it('da un\'altra origine', async () => {
    expect((await patch({ keys: [X], status: 'contacted' }, a.cookie, { Origin: 'https://evil.test' })).status).toBe(403);
  });
});

describe('POST /api/leads/split', () => {
  it('separa il lead solo per chi lo chiede', async () => {
    const r = await fetchApi('POST', '/api/leads/split', { key: X, fromKeys: [Y] }, { Cookie: a.cookie });
    expect(r.status).toBe(204);
    expect(await leads(a.cookie)).toHaveLength(2);
    expect(await leads(b.cookie)).toHaveLength(1);
  });

  it('annuncio inesistente', async () => {
    const r = await fetchApi('POST', '/api/leads/split', { key: X, fromKeys: ['subito:99'] }, { Cookie: a.cookie });
    expect(r.status).toBe(404);
  });
});
