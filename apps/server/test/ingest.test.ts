import { env, exports } from 'cloudflare:workers';
import type { SweepPlan } from '@homeradar/shared/api/connector';
import { DEFAULT_CALIBRATION, LEARN_RATE_PER_DAY, mergeCalibration, utcDay } from '@homeradar/shared/core/age';
import { DAY_MS, type ListingObservation, type Portal } from '@homeradar/shared/shared/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { listingsByKeys } from '../src/archive';
import { ORIGIN, fetchConnector, linkDevice, loginAs, putListing, resetDb } from './helpers';

const HOUR = 3_600_000;

interface Agent { id: string; auth: Record<string, string>; deviceId: string; plan: SweepPlan }
async function agentWithSweep(): Promise<Agent> {
  const u = await loginAs('agent');
  await env.DB.prepare(`UPDATE users SET comuni = '["016219"]' WHERE id = ?`).bind(u.id).run();
  const d = await linkDevice(u.id);
  const plan = (await (await fetchConnector('POST', '/connector/sweeps', {}, d.auth)).json()) as SweepPlan;
  return { id: u.id, auth: d.auth, deviceId: d.id, plan };
}
const keyOf = (a: Agent, portal: Portal) => a.plan.searches.find((s) => s.portal === portal)!.key;

function obs(portalId: number, o: Partial<ListingObservation> = {}): ListingObservation {
  return {
    portal: 'immobiliare', portalId, url: `https://www.immobiliare.it/annunci/${portalId}/`, title: 'Trilocale', address: null, city: 'Treviglio', zone: null,
    typology: 'Appartamento', category: null, surfaceM2: 80, rooms: 3, price: 200_000, sellerType: 'private', portalCreatedAt: null, lastDrop: null,
    coverUrl: null, source: 'search', ...o,
  };
}
function batch(a: Agent, observations: unknown[], o: Record<string, unknown> = {}) {
  const portal = (o.portal as Portal | undefined) ?? 'immobiliare';
  delete o.portal;
  return {
    id: crypto.randomUUID(), sweepId: a.plan.sweepId, searchKey: keyOf(a, portal), readAt: Date.now(), page: 1,
    report: { portal, url: 'https://www.immobiliare.it/vendita-case/treviglio/', results: 25, privates: observations.length, lastPage: false, blocked: false, notFound: false, parseErrors: 0 },
    observations, ...o,
  };
}
const send = (a: Agent, body: unknown) => fetchConnector('POST', '/connector/batches', body, a.auth);
const n = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<number>('n');

let a: Agent;
beforeEach(async () => {
  await resetDb();
  a = await agentWithSweep();
});

describe('POST /connector/batches', () => {
  it('salva gli annunci con la ricerca e i prezzi; la ricerca passa a "in corso"', async () => {
    const r = await send(a, batch(a, [obs(1), obs(2)]));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const [l] = await listingsByKeys(env.DB, ['immobiliare:1']);
    expect(l).toMatchObject({ sweepScope: keyOf(a, 'immobiliare'), category: 'residential', currentPrice: 200_000, seenCount: 1 });
    expect(await n('SELECT COUNT(*) AS n FROM price_snapshots')).toBe(2);
    expect(await env.DB.prepare('SELECT status, pages_received, privates FROM search_runs WHERE search_key = ? AND sweep_id = ?').bind(keyOf(a, 'immobiliare'), a.plan.sweepId).first())
      .toEqual({ status: 'running', pages_received: 1, privates: 2 });
  });

  it('una categoria non scelta non si salva ma conta come vista', async () => {
    await send(a, batch(a, [obs(1, { category: 'garage' })]));
    expect(await listingsByKeys(env.DB, ['immobiliare:1'])).toEqual([]);
    expect(await n('SELECT COUNT(*) AS n FROM run_seen WHERE listing_key = ?', 'immobiliare:1')).toBe(1);
  });

  it('lo stesso lotto due volte, anche in parallelo: salvato una volta', async () => {
    await putListing({ portal: 'immobiliare', portalId: 1, currentPrice: 250_000, lastSeenAt: Date.now() - 2 * HOUR });
    const body = batch(a, [obs(1)]);
    const [r1, r2] = await Promise.all([send(a, body), send(a, body)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect((await send(a, body)).status).toBe(200);
    expect((await listingsByKeys(env.DB, ['immobiliare:1']))[0]!.seenCount).toBe(2);
    expect(await n('SELECT COUNT(*) AS n FROM price_snapshots')).toBe(1);
    expect(await n('SELECT drops AS n FROM sweeps WHERE id = ?', a.plan.sweepId)).toBe(1);
    expect(await n('SELECT pages_received AS n FROM search_runs WHERE sweep_id = ? AND search_key = ?', a.plan.sweepId, keyOf(a, 'immobiliare'))).toBe(1);
  });

  it('un lotto in ritardo non riporta indietro l\'annuncio, ma lo conta come visto', async () => {
    await env.DB.prepare('UPDATE sweeps SET started_at = ? WHERE id = ?').bind(Date.now() - 2 * HOUR, a.plan.sweepId).run();
    const seen = Date.now();
    await putListing({ portal: 'immobiliare', portalId: 1, currentPrice: 200_000, lastSeenAt: seen });
    await send(a, batch(a, [obs(1, { price: 150_000 })], { readAt: seen - HOUR }));
    expect((await listingsByKeys(env.DB, ['immobiliare:1']))[0]).toMatchObject({ currentPrice: 200_000, lastSeenAt: seen });
    expect(await n('SELECT COUNT(*) AS n FROM price_snapshots')).toBe(0);
    expect(await n('SELECT COUNT(*) AS n FROM run_seen WHERE listing_key = ?', 'immobiliare:1')).toBe(1);
  });


  it('un lotto in ritardo dentro la stessa visita di 30 minuti non riporta indietro il prezzo', async () => {
    await env.DB.prepare('UPDATE sweeps SET started_at = ? WHERE id = ?').bind(Date.now() - 2 * HOUR, a.plan.sweepId).run();
    const t0 = Date.now() - 30 * 60_000;
    await putListing({ portal: 'immobiliare', portalId: 1, currentPrice: 200_000, lastSeenAt: t0 });
    await send(a, batch(a, [obs(1, { price: 210_000 })], { readAt: t0 + 25 * 60_000 }));
    await send(a, batch(a, [obs(1, { price: 200_000 })], { readAt: t0 + 10 * 60_000, page: 2 }));
    expect((await listingsByKeys(env.DB, ['immobiliare:1']))[0]).toMatchObject({ currentPrice: 210_000, lastSeenAt: t0 });
    expect(await n('SELECT drops AS n FROM sweeps WHERE id = ?', a.plan.sweepId)).toBe(0);
  });
  it('un giro già chiuso accetta ancora i lotti', async () => {
    await env.DB.prepare("UPDATE sweeps SET finished_at = ?, outcome = 'completed' WHERE id = ?").bind(Date.now(), a.plan.sweepId).run();
    expect((await send(a, batch(a, [obs(1)]))).status).toBe(200);
    expect(await listingsByKeys(env.DB, ['immobiliare:1'])).toHaveLength(1);
  });

  it('giro di un altro agente, ricerca estranea, portale diverso', async () => {
    const b = await agentWithSweep();
    const other = await send(a, batch(a, [obs(1)], { sweepId: b.plan.sweepId }));
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: 'Giro non trovato' });
    const foreign = await send(a, batch(a, [obs(1)], { searchKey: 'immobiliare|comune:016062|case' }));
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ error: 'Ricerca non nel piano' });
    const wrong = await send(a, batch(a, [obs(1, { portal: 'idealista', url: 'https://www.idealista.it/immobile/1/' })]));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'Annuncio di un altro portale' });
    expect(await listingsByKeys(env.DB, ['immobiliare:1', 'idealista:1'])).toEqual([]);
  });

  it('agenzie e campi non dichiarati: rifiutati, nulla salvato', async () => {
    expect((await send(a, batch(a, [obs(1, { sellerType: 'agency' })]))).status).toBe(400);
    expect((await send(a, batch(a, [{ ...obs(2), phone: '3331234567' }]))).status).toBe(400);
    expect(await n('SELECT COUNT(*) AS n FROM listings')).toBe(0);
  });

  it('limiti di dimensione e frequenza', async () => {
    expect((await send(a, batch(a, Array.from({ length: 101 }, (_, i) => obs(i + 1))))).status).toBe(400);
    const big = await send(a, { ...batch(a, []), pad: 'x'.repeat(600_000) });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'Lotto troppo grande' });
    // Senza Content-Length (corpo a pezzi) il limite vale lo stesso.
    const text = new TextEncoder().encode(JSON.stringify({ ...batch(a, []), pad: 'x'.repeat(600_000) }));
    const chunked = new ReadableStream({ start(c) { c.enqueue(text.slice(0, 1000)); c.enqueue(text.slice(1000)); c.close(); } });
    const streamed = await exports.default.fetch(`${ORIGIN}/connector/batches`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...a.auth }, body: chunked, duplex: 'half',
    } as RequestInit);
    expect(streamed.status).toBe(413);
    const now = Date.now();
    await env.DB.batch(Array.from({ length: 30 }, () => env.DB.prepare('INSERT INTO batches (id, device_id, received_at) VALUES (?, ?, ?)').bind(crypto.randomUUID(), a.deviceId, now)));
    const r = await send(a, batch(a, [obs(1)]));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'Troppi invii: riprova fra poco' });
  });

  it('impara un punto di calibrazione dall\'annuncio più recente', async () => {
    const last = mergeCalibration([], DEFAULT_CALIBRATION.idealista).at(-1)!;
    const days = (utcDay(Date.now()) - last.createdAt) / DAY_MS;
    const newestId = Math.round(last.portalId + days * LEARN_RATE_PER_DAY.idealista!);
    expect((await send(a, batch(a, [], { portal: 'idealista', newestId }))).status).toBe(200);
    expect(await env.DB.prepare('SELECT portal, portal_id, created_at FROM calibration_points').first())
      .toEqual({ portal: 'idealista', portal_id: newestId, created_at: utcDay(Date.now()) });
  });
});

