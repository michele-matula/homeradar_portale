import { env } from 'cloudflare:workers';
import type { LeadsResponse } from '@homeradar/shared/api/types';
import { addDays, startOfLocalDay } from '@homeradar/shared/core/recall';
import type { LeadState } from '@homeradar/shared/shared/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { putSplit, putState } from '../src/archive';
import { fetchApi, loginAs, putListing, resetDb } from './helpers';

const DAY = 86_400_000;
const TREVIGLIO = '016219';

async function agent(comuni = [TREVIGLIO]): Promise<{ id: string; cookie: string }> {
  const a = await loginAs('agent');
  await env.DB.prepare('UPDATE users SET comuni = ? WHERE id = ?').bind(JSON.stringify(comuni), a.id).run();
  return a;
}
const leads = async (cookie: string) => (await (await fetchApi('GET', '/api/leads', undefined, { Cookie: cookie })).json()) as LeadsResponse;
const keys = (r: LeadsResponse) => r.leads.map((l) => l.listing.key).sort();
const st = (listingKey: string, o: Partial<LeadState> = {}): LeadState => ({ listingKey, status: 'new', notes: '', statusChangedAt: 1, updatedAt: 1, recallAt: null, ...o });

beforeEach(resetDb);

describe('GET /api/leads', () => {
  it('senza sessione', async () => expect((await fetchApi('GET', '/api/leads')).status).toBe(401));

  it('zona e categorie dell\'agente, anche annunci trovati da ricerche di altri comuni', async () => {
    const a = await agent();
    await putListing({ portal: 'immobiliare', portalId: 1, city: 'Treviglio', sweepScope: 'immobiliare|comune:016062|case' });
    await putListing({ portal: 'immobiliare', portalId: 2, city: 'Caravaggio', sweepScope: 'immobiliare|comune:016062|case' });
    await putListing({ portal: 'immobiliare', portalId: 3, city: 'Treviglio', category: 'garage', surfaceM2: 15, currentPrice: 20_000 });
    expect(keys(await leads(a.cookie))).toEqual(['immobiliare:1']);
    await fetchApi('PUT', '/api/settings', { categories: ['residential', 'garage'] }, { Cookie: a.cookie });
    expect(keys(await leads(a.cookie))).toEqual(['immobiliare:1', 'immobiliare:3']);
  });

  it('lo stesso immobile su due portali è un lead solo', async () => {
    const a = await agent();
    await putListing({ portal: 'immobiliare', portalId: 1, zone: 'Centro' });
    await putListing({ portal: 'idealista', portalId: 2, zone: 'Centro' });
    const r = await leads(a.cookie);
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]!.others).toHaveLength(1);
  });

  it('non visto da più di 90 giorni: fuori, a meno che sia lavorato', async () => {
    const a = await agent();
    const old = await putListing({ portal: 'immobiliare', portalId: 1, lastSeenAt: Date.now() - 91 * DAY });
    expect(keys(await leads(a.cookie))).toEqual([]);
    await putState(env.DB, a.id, st(old.key, { notes: 'richiamare' })).run();
    expect(keys(await leads(a.cookie))).toEqual([old.key]);
  });

  it('stati, note e separazioni di un agente non arrivano all\'altro', async () => {
    const a = await agent();
    const b = await agent();
    const x = await putListing({ portal: 'immobiliare', portalId: 1, zone: 'Centro' });
    const y = await putListing({ portal: 'idealista', portalId: 2, zone: 'Centro' });
    await env.DB.batch([
      putState(env.DB, a.id, st(x.key, { status: 'contacted', notes: 'privato gentile' })),
      putState(env.DB, a.id, st(y.key, { status: 'contacted', notes: 'privato gentile' })),
      putSplit(env.DB, a.id, { a: x.key, b: y.key, at: 1 }),
    ]);
    const forA = await leads(a.cookie);
    expect(forA.leads).toHaveLength(2);
    const forB = await leads(b.cookie);
    expect(forB.leads).toHaveLength(1);
    expect(forB.leads[0]!.state).toMatchObject({ status: 'new', notes: '' });
    expect(JSON.stringify(forB)).not.toContain('privato gentile');
  });

  it('richiami da fare: lo stesso immobile conta una volta, futuri e scartati no', async () => {
    const a = await agent();
    const today = startOfLocalDay(Date.now());
    const x = await putListing({ portal: 'immobiliare', portalId: 1, zone: 'Centro' });
    const y = await putListing({ portal: 'idealista', portalId: 2, zone: 'Centro' });
    const z = await putListing({ portal: 'immobiliare', portalId: 3, zone: 'Altrove', surfaceM2: 200, currentPrice: 900_000 });
    const w = await putListing({ portal: 'immobiliare', portalId: 4, zone: 'Lontano', surfaceM2: 40, currentPrice: 90_000 });
    await env.DB.batch([
      putState(env.DB, a.id, st(x.key, { status: 'to_contact', recallAt: addDays(today, -1), updatedAt: 2 })),
      putState(env.DB, a.id, st(y.key, { status: 'to_contact', recallAt: today })),
      putState(env.DB, a.id, st(z.key, { status: 'to_contact', recallAt: addDays(today, 1) })),
      putState(env.DB, a.id, st(w.key, { status: 'discarded', recallAt: today })),
    ]);
    expect((await leads(a.cookie)).dueRecalls).toBe(1);
  });

  it('admin senza comuni', async () => {
    const admin = await loginAs('admin');
    await putListing({ portal: 'immobiliare', portalId: 1 });
    expect(await leads(admin.cookie)).toEqual({ leads: [], dueRecalls: 0 });
  });
});

describe('POST /api/leads/visit', () => {
  const visit = async (cookie: string) => (await (await fetchApi('POST', '/api/leads/visit', {}, { Cookie: cookie })).json()) as { newSince: number | null };
  const seenAt = (id: string, t: number) => env.DB.prepare('UPDATE users SET leads_seen_at = ? WHERE id = ?').bind(t, id).run();
  const MIN = 60_000;

  it('senza sessione', async () => expect((await fetchApi('POST', '/api/leads/visit', {})).status).toBe(401));

  it('prima visita: nessuna soglia; poi la soglia è l\'apertura della visita precedente e non si sposta durante la visita', async () => {
    const a = await agent();
    expect(await visit(a.cookie)).toEqual({ newSince: null });
    // Dieci minuti dopo: stessa visita, ancora nessuna soglia.
    const first = Date.now() - 10 * MIN;
    await seenAt(a.id, first);
    expect(await visit(a.cookie)).toEqual({ newSince: null });
    // Dopo 45 minuti senza aprire la lista: visita nuova, soglia = ultima apertura.
    const last = Date.now() - 45 * MIN;
    await seenAt(a.id, last);
    expect(await visit(a.cookie)).toEqual({ newSince: last });
    expect(await visit(a.cookie)).toEqual({ newSince: last });
  });
});
