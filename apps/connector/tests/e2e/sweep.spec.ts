import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { CONNECTOR_ID } from '@homeradar/shared/api/connector-messages';
import { expect, launchConnector, PORTAL, send, test } from './fixtures';
import type { FakeServer } from './fake-server';
import { buildSearchHtml } from './fixture-page';

const base = JSON.parse(readFileSync('../../packages/shared/tests/fixtures/immobiliare/search-privati.json', 'utf8'));
const agency = {
  realEstate: {
    id: 1, title: "Bilocale via Esempio 101, Centro, Cassano d'Adda", contract: 'sale', price: { visible: true, value: 200000 },
    properties: [{ surface: '60 m²', rooms: '2', typology: { name: 'Appartamento' }, location: { city: "Cassano d'Adda" } }],
    advertiser: { agency: { type: 'agency' } },
  },
  seo: { url: 'https://www.immobiliare.it/annunci/1/' },
};
/** Pagina 1 di Cassano d'Adda: privati della fixture, poi un'agenzia → la ricerca finisce qui. */
function cassanoPage() {
  const nd = structuredClone(base);
  const data = nd.props.pageProps.dehydratedState.queries[0].state.data;
  data.results.push(agency);
  data.currentPage = 1;
  data.maxPages = 1;
  return buildSearchHtml(nd);
}
const CAPTCHA = '<!doctype html><html><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>';
const CASSANO_PATH = '/vendita-case/cassano-d-adda/';
// I campi di ObservationSchema (lo schema non si importa qui: tira dentro la lista dei comuni, che Node non carica).
const ALLOWED = ['portal', 'portalId', 'url', 'title', 'address', 'city', 'zone', 'typology', 'category', 'surfaceM2', 'rooms', 'price', 'priceReserved', 'sellerType', 'portalCreatedAt', 'lastDrop', 'coverUrl', 'source'];

async function serveImmobiliare(context: BrowserContext, body: () => string, delayMs = 0) {
  await context.route('https://www.immobiliare.it/**', async (route) => {
    if (new URL(route.request().url()).pathname !== CASSANO_PATH) return route.fulfill({ status: 404, body: '' });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ contentType: 'text/html', body: body() });
  });
}

const paths = (s: FakeServer) => s.received.map((r) => r.path);
const finished = (s: FakeServer) => s.received.find((r) => r.path.endsWith('/finish'));
const waitFinish = (s: FakeServer) => expect.poll(() => finished(s), { timeout: 30_000 }).toBeTruthy();

test("l'ID del connettore è quello che il portale conosce", async ({ extensionId }) => {
  expect(extensionId).toBe(CONNECTOR_ID);
});

test('collegamento e giro: lotto, esito e fine in ordine, con il token', async ({ context, portal, server }) => {
  await serveImmobiliare(context, cassanoPage);
  expect(await send(portal, { type: 'ping' })).toMatchObject({ ok: true, data: { linked: false } });
  expect(await send(portal, { type: 'link', code: 'cod' })).toEqual({ ok: true, data: null });
  expect(await send(portal, { type: 'ping' })).toMatchObject({ ok: true, data: { linked: true, pending: 0 } });
  const started = await send(portal, { type: 'startSweep' });
  expect(started).toEqual({ ok: true, data: { sweepId: server.plan.sweepId, total: server.plan.searches.length, skipped: 0 } });
  await waitFinish(server);
  const sweepId = server.plan.sweepId;
  expect(paths(server)).toEqual(['/connector/link', '/connector/sweeps', '/connector/batches', '/connector/runs', `/connector/sweeps/${sweepId}/finish`]);
  expect(server.received[0]!.body).toMatchObject({ code: 'cod', version: '0.1.0' });
  const batch = server.received[2]!.body;
  expect(batch).toMatchObject({ page: 1, sweepId });
  expect(batch.observations.length).toBeGreaterThan(0);
  for (const o of batch.observations) {
    expect(o.sellerType).toBe('private');
    expect(Object.keys(o).every((k) => ALLOWED.includes(k))).toBe(true);
  }
  expect(server.received[3]!.body).toMatchObject({ outcome: 'complete', pages: 1 });
  expect(finished(server)!.body).toEqual({ outcome: 'completed' });
  for (const r of server.received.slice(1)) expect(r.auth).toBe('Bearer tok');
});

test('legge solo nella scheda del giro', async ({ context, portal, server }) => {
  await serveImmobiliare(context, cassanoPage, 3_000);
  await send(portal, { type: 'link', code: 'cod' });
  // Senza giro: l'agente apre a mano la ricerca, il connettore non manda nulla.
  const manual = await context.newPage();
  await manual.goto(`https://www.immobiliare.it${CASSANO_PATH}`);
  await manual.waitForTimeout(4_000);
  expect(paths(server)).toEqual(['/connector/link']);
  // Durante il giro, la stessa pagina aperta in un'altra scheda non conta.
  await send(portal, { type: 'startSweep' });
  const other = await context.newPage();
  await other.goto(`https://www.immobiliare.it${CASSANO_PATH}`);
  await waitFinish(server);
  expect(paths(server).filter((p) => p === '/connector/batches')).toHaveLength(1);
});

test('server giù: il giro continua, le pagine aspettano in coda e partono dopo', async ({ context, portal, server }) => {
  await serveImmobiliare(context, cassanoPage);
  await send(portal, { type: 'link', code: 'cod' });
  server.failNext('/connector/batches', 3, 503);
  await send(portal, { type: 'startSweep' });
  await expect.poll(async () => (await send(portal, { type: 'ping' })).data.pending, { timeout: 15_000, intervals: [100] }).toBe(1);
  await waitFinish(server);
  expect(paths(server).slice(-3)).toEqual(['/connector/batches', '/connector/runs', `/connector/sweeps/${server.plan.sweepId}/finish`]);
  expect(paths(server).filter((p) => p === '/connector/batches')).toHaveLength(4);
  expect((await send(portal, { type: 'ping' })).data).toMatchObject({ pending: 0, stuck: false });
});

test('Ferma: giro fermato', async ({ context, portal, server }) => {
  await serveImmobiliare(context, cassanoPage, 3_000);
  await send(portal, { type: 'link', code: 'cod' });
  await send(portal, { type: 'startSweep' });
  expect(await send(portal, { type: 'stopSweep' })).toEqual({ ok: true, data: null });
  await waitFinish(server);
  expect(finished(server)!.body).toEqual({ outcome: 'stopped' });
  expect(paths(server)).not.toContain('/connector/batches');
  expect((await send(portal, { type: 'ping' })).data.sweeping).toBe(false);
});

test('browser chiuso a metà giro: alla riapertura il giro si chiude come interrotto', async ({ server }) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hr-e2e-'));
  const first = await launchConnector(dir);
  await serveImmobiliare(first, cassanoPage, 10_000);
  const portal = await first.newPage();
  await portal.goto(`${PORTAL}/`);
  await send(portal, { type: 'link', code: 'cod' });
  expect((await send(portal, { type: 'startSweep' })).ok).toBe(true);
  await first.close();
  expect(finished(server)).toBeUndefined();
  const second = await launchConnector(dir);
  await waitFinish(server);
  expect(finished(server)!.body).toEqual({ outcome: 'interrupted' });
  await second.close();
});

test('verifica di DataDome: nessun lotto, ricerca bloccata, giro in parte', async ({ context, portal, server }) => {
  await serveImmobiliare(context, () => CAPTCHA);
  await send(portal, { type: 'link', code: 'cod' });
  await send(portal, { type: 'startSweep' });
  await waitFinish(server);
  expect(paths(server)).not.toContain('/connector/batches');
  expect(server.received.find((r) => r.path === '/connector/runs')!.body).toMatchObject({ outcome: 'blocked' });
  expect(finished(server)!.body).toEqual({ outcome: 'partial' });
});

test("da un'origine diversa dal portale il connettore non è raggiungibile", async ({ context, server, extensionId }) => {
  void extensionId;
  const page = await context.newPage();
  await page.goto(`${PORTAL.replace('localhost', '127.0.0.1')}/`);
  expect(await page.evaluate(() => typeof (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime?.sendMessage)).toBe('undefined');
  expect(server.received).toEqual([]);
});
