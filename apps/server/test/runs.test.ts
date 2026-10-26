import { env } from 'cloudflare:workers';
import type { SweepPlan } from '@homeradar/shared/api/connector';
import type { LeadsResponse } from '@homeradar/shared/api/types';
import type { ListingObservation, SweepResult, SweepStatus } from '@homeradar/shared/shared/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listingsByKeys } from '../src/archive';
import { fetchApi, fetchConnector, linkDevice, loginAs, putListing, resetDb } from './helpers';

const HOUR = 3_600_000;
const KEY = 'immobiliare|comune:016219|case';

interface Agent { id: string; cookie: string; auth: Record<string, string> }
async function agent(): Promise<Agent> {
  const u = await loginAs('agent');
  await env.DB.prepare(`UPDATE users SET comuni = '["016219"]' WHERE id = ?`).bind(u.id).run();
  return { ...u, auth: (await linkDevice(u.id)).auth };
}
const start = async (a: Agent) => (await (await fetchConnector('POST', '/connector/sweeps', {}, a.auth)).json()) as SweepPlan;

function obs(portalId: number): ListingObservation {
  return {
    portal: 'immobiliare', portalId, url: `https://www.immobiliare.it/annunci/${portalId}/`, title: 'Trilocale', address: null, city: 'Treviglio', zone: `Zona ${portalId}`,
    typology: 'Appartamento', category: null, surfaceM2: 50 + portalId, rooms: 3, price: 100_000 + portalId * 7_000, sellerType: 'private',
    portalCreatedAt: Date.now() - 200 * 86_400_000, lastDrop: null, coverUrl: null, source: 'search',
  };
}
const batch = (a: Agent, sweepId: string, ids: number[], o: Record<string, unknown> = {}) =>
  fetchConnector('POST', '/connector/batches', {
    id: crypto.randomUUID(), sweepId, searchKey: KEY, readAt: Date.now(), page: 1,
    report: { portal: 'immobiliare', url: 'https://www.immobiliare.it/', results: ids.length, privates: ids.length, lastPage: true, blocked: false, notFound: false, parseErrors: 0 },
    observations: ids.map(obs), ...o,
  }, a.auth);
const report = (a: Agent, sweepId: string, outcome: string, pages = 1, searchKey = KEY) =>
  fetchConnector('POST', '/connector/runs', { sweepId, searchKey, outcome, pages, privates: 1 }, a.auth);
const finish = (a: Agent, sweepId: string, outcome = 'completed') => fetchConnector('POST', `/connector/sweeps/${sweepId}/finish`, { outcome }, a.auth);
const missed = async (key: string) => (await listingsByKeys(env.DB, [key]))[0]!.missedSweeps;

/** Un giro con la ricerca di Treviglio completa, in cui si vedono solo `seen`. */
async function completeRun(a: Agent, seen: number[] = [50]): Promise<string> {
  const plan = await start(a);
  await batch(a, plan.sweepId!, seen);
  expect((await report(a, plan.sweepId!, 'complete')).status).toBe(200);
  return plan.sweepId!;
}

// Qui le ricerche si rifanno subito: la freschezza non c'entra.
beforeAll(async () => {
  await env.DB.prepare("UPDATE config SET value = '0' WHERE key = 'freshness_minutes'").run();
});
afterAll(async () => {
  await env.DB.prepare("UPDATE config SET value = '60' WHERE key = 'freshness_minutes'").run();
});

let a: Agent;
let b: Agent;
beforeEach(async () => {
  await resetDb();
  a = await agent();
  b = await agent();
});

describe('"non più visto" con più agenti', () => {
  it('tre ricerche complete di agenti diversi e 24 ore senza vederlo', async () => {
    const x = await putListing({ portal: 'immobiliare', portalId: 1, sweepScope: KEY, lastSeenAt: Date.now() - 30 * HOUR });
    await completeRun(a);
    await completeRun(b);
    await completeRun(a);
    expect(await missed(x.key)).toBe(3);
    const lead = ((await (await fetchApi('GET', '/api/leads', undefined, { Cookie: a.cookie })).json()) as LeadsResponse).leads.find((l) => l.listing.key === x.key);
    expect(lead!.missing).not.toBeNull();
  });

  it('visto due ore fa: tre giri non bastano', async () => {
    const x = await putListing({ portal: 'immobiliare', portalId: 1, sweepScope: KEY, lastSeenAt: Date.now() - 2 * HOUR });
    for (const who of [a, b, a]) await completeRun(who);
    expect(await missed(x.key)).toBe(3);
    const lead = ((await (await fetchApi('GET', '/api/leads', undefined, { Cookie: a.cookie })).json()) as LeadsResponse).leads.find((l) => l.listing.key === x.key);
    expect(lead!.missing).toBeNull();
  });

  it('una ricerca non completa non conta', async () => {
    const x = await putListing({ portal: 'immobiliare', portalId: 1, sweepScope: KEY, lastSeenAt: Date.now() - 30 * HOUR });
    for (const outcome of ['capped', 'error']) {
      const plan = await start(a);
      await batch(a, plan.sweepId!, [50]);
      await report(a, plan.sweepId!, outcome);
    }
    expect(await missed(x.key)).toBe(0);
  });

  it('esito prima dei lotti: si aspetta che arrivino tutte le pagine', async () => {
    const x = await putListing({ portal: 'immobiliare', portalId: 1, sweepScope: KEY, lastSeenAt: Date.now() - 30 * HOUR });
    const y = await putListing({ portal: 'immobiliare', portalId: 2, sweepScope: KEY, lastSeenAt: Date.now() - 30 * HOUR });
    const plan = await start(a);
    await batch(a, plan.sweepId!, [50]);
    await report(a, plan.sweepId!, 'complete', 2);
    expect(await missed(y.key)).toBe(0);
    await batch(a, plan.sweepId!, [1], { page: 2 });
    expect(await missed(x.key)).toBe(0);
    expect(await missed(y.key)).toBe(1);
  });

  it('visto da un altro agente dopo l\'inizio della ricerca: non è mancato', async () => {
    const x = await putListing({ portal: 'immobiliare', portalId: 1, sweepScope: KEY, lastSeenAt: Date.now() - 30 * HOUR });
    const pa = await start(a);
    await env.DB.prepare('UPDATE sweeps SET started_at = ? WHERE id = ?').bind(Date.now() - 20 * 60_000, pa.sweepId).run();
    await batch(a, pa.sweepId!, [50], { readAt: Date.now() - 20 * 60_000 });
    const pb = await start(b);
    expect(pb.searches.map((s) => s.key)).toContain(KEY);
    await batch(b, pb.sweepId!, [1]);
    await report(a, pa.sweepId!, 'complete');
    expect(await missed(x.key)).toBe(0);
  });


  it('una pagina riletta conta una volta: si aspettano pagine diverse', async () => {
    const y = await putListing({ portal: 'immobiliare', portalId: 2, sweepScope: KEY, lastSeenAt: Date.now() - 30 * HOUR });
    const plan = await start(a);
    await batch(a, plan.sweepId!, [50]);
    await batch(a, plan.sweepId!, [50]);
    await report(a, plan.sweepId!, 'complete', 2);
    expect(await missed(y.key)).toBe(0);
    await batch(a, plan.sweepId!, [2], { page: 2 });
    expect(await missed(y.key)).toBe(0);
  });

  it('visto da un altro agente nella stessa visita di 30 minuti: non è mancato', async () => {
    const x = await putListing({ portal: 'immobiliare', portalId: 1, sweepScope: KEY, lastSeenAt: Date.now() - 30 * HOUR });
    const pa = await start(a);
    await env.DB.prepare('UPDATE sweeps SET started_at = ? WHERE id = ?').bind(Date.now() - 20 * 60_000, pa.sweepId).run();
    await batch(a, pa.sweepId!, [50], { readAt: Date.now() - 20 * 60_000 });
    // B lo vede due volte a pochi minuti: lastSeenAt resta alla prima, ma l'ultima lettura è dopo l'inizio di A.
    await env.DB.prepare('UPDATE listings SET last_seen_at = ?, last_read_at = ? WHERE key = ?').bind(Date.now() - 25 * 60_000, Date.now() - 5 * 60_000, x.key).run();
    await report(a, pa.sweepId!, 'complete');
    expect(await missed(x.key)).toBe(0);
  });
  it('un esito ripetuto conta una volta', async () => {
    const x = await putListing({ portal: 'immobiliare', portalId: 1, sweepScope: KEY, lastSeenAt: Date.now() - 30 * HOUR });
    const id = await completeRun(a);
    await report(a, id, 'complete');
    expect(await missed(x.key)).toBe(1);
  });

  it('esito per un giro di un altro agente', async () => {
    const plan = await start(a);
    const r = await report(b, plan.sweepId!, 'complete');
    expect(r.status).toBe(404);
  });
});

describe('fine del giro e avanzamento', () => {
  const status = async (who: Agent) => (await (await fetchApi('GET', '/api/sweep', undefined, { Cookie: who.cookie })).json()) as SweepStatus;

  it('risultato del giro, ripetibile', async () => {
    const plan = await start(a);
    const other = plan.searches.find((s) => s.key !== KEY && s.portal === 'idealista')!;
    await batch(a, plan.sweepId!, [50, 51]);
    await report(a, plan.sweepId!, 'complete');
    await report(a, plan.sweepId!, 'notFound', 0, other.key);
    const r = await finish(a, plan.sweepId!, 'partial');
    expect(r.status).toBe(200);
    const { result } = (await r.json()) as { result: SweepResult };
    expect(result).toMatchObject({ outcome: 'partial', newCount: 2, drops: 0, missing: 0, notFound: [`${other.label} (Idealista)`] });
    expect(result.portals.immobiliare).toEqual({ pages: 1, privates: 1, outcome: 'complete' });
    expect(result.portals.subito!.outcome).toBe('skipped');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM search_runs WHERE sweep_id = ? AND status = 'pending'").bind(plan.sweepId).first('n')).toBe(0);
    expect(((await (await finish(a, plan.sweepId!, 'stopped')).json()) as { result: SweepResult }).result).toEqual(result);
  });

  it('newCount non conta un immobile già visto su un altro portale', async () => {
    // Stesso immobile di obs(60) (città, m², locali, prezzo), visto su Idealista prima del giro; obs(50) è troppo diverso.
    await putListing({ portal: 'idealista', portalId: 9, surfaceM2: 110, rooms: 3, currentPrice: 520_000, firstSeenAt: Date.now() - 30 * HOUR });
    const plan = await start(a);
    await batch(a, plan.sweepId!, [50, 60]);
    await report(a, plan.sweepId!, 'complete');
    const { result } = (await (await finish(a, plan.sweepId!)).json()) as { result: SweepResult };
    expect(result.newCount).toBe(1);
  });

  it('GET /api/sweep: in corso, poi ultimo risultato; solo i propri giri', async () => {
    const plan = await start(a);
    await batch(a, plan.sweepId!, [50]);
    await report(a, plan.sweepId!, 'complete');
    const during = await status(a);
    expect(during.running).toMatchObject({ total: plan.searches.length, done: 1, newCount: 1, drops: 0 });
    expect(during.running!.portals.immobiliare).toEqual({ pages: 1, privates: 1 });
    expect(await status(b)).toEqual({ running: null, last: null });
    await finish(a, plan.sweepId!);
    const after = await status(a);
    expect(after.running).toBeNull();
    expect(after.last!.outcome).toBe('completed');
  });

  it('un giro fermo da 16 minuti risulta interrotto', async () => {
    const plan = await start(a);
    await env.DB.prepare('UPDATE sweeps SET last_activity_at = ? WHERE id = ?').bind(Date.now() - 16 * 60_000, plan.sweepId).run();
    const s = await status(a);
    expect(s.running).toBeNull();
    expect(s.last!.outcome).toBe('interrupted');
  });

  it('senza sessione', async () => expect((await fetchApi('GET', '/api/sweep')).status).toBe(401));
});

describe('motivo delle ricerche in errore', () => {
  it('si salva con l\'esito; un motivo sconosciuto è rifiutato', async () => {
    const a = await agent();
    const plan = await start(a);
    const r = await fetchConnector('POST', '/connector/runs', { sweepId: plan.sweepId, searchKey: KEY, outcome: 'error', pages: 1, privates: 0, reason: 'unreadable' }, a.auth);
    expect(r.status).toBeLessThan(300);
    const row = await env.DB.prepare('SELECT reason FROM search_runs WHERE sweep_id = ? AND search_key = ?').bind(plan.sweepId, KEY).first<{ reason: string | null }>();
    expect(row?.reason).toBe('unreadable');
    const bad = await fetchConnector('POST', '/connector/runs', { sweepId: plan.sweepId, searchKey: KEY, outcome: 'error', pages: 1, privates: 0, reason: 'altro' }, a.auth);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Esito non valido' });
  });
});

describe('giro automatico nello stato del giro', () => {
  it('in corso e poi ultimo risultato dicono che era automatico', async () => {
    // L'avvio con `auto` dipende dall'ora (fascia 7–21, provato in plan.test): qui conta solo come si legge il giro.
    const plan = await start(a);
    await env.DB.prepare("UPDATE sweeps SET trigger = 'auto' WHERE id = ?").bind(plan.sweepId).run();
    const st = async () => (await (await fetchApi('GET', '/api/sweep', undefined, { Cookie: a.cookie })).json()) as SweepStatus;
    expect((await st()).running!.auto).toBe(true);
    await fetchConnector('POST', `/connector/sweeps/${plan.sweepId}/finish`, { outcome: 'completed' }, a.auth);
    expect((await st()).last!.auto).toBe(true);
  });

  it('un giro manuale non è automatico', async () => {
    const plan = await start(a);
    const st = async () => (await (await fetchApi('GET', '/api/sweep', undefined, { Cookie: a.cookie })).json()) as SweepStatus;
    expect((await st()).running!.auto).toBe(false);
    await fetchConnector('POST', `/connector/sweeps/${plan.sweepId}/finish`, { outcome: 'completed' }, a.auth);
    expect((await st()).last!.auto).toBe(false);
  });
});
