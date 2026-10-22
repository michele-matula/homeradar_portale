import { idealistaAdapter } from '@homeradar/shared/adapters/idealista/index';
import { immobiliareAdapter } from '@homeradar/shared/adapters/immobiliare/index';
import type { PortalAdapter } from '@homeradar/shared/adapters/types';
import type { ListingObservation } from '@homeradar/shared/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReader, type ReaderMessage } from '../../src/reader';
import { API_URL, DETAIL_URL, SEARCH_URL, agencyAdvertiser, realEstate, searchNextData, searchResult } from '../../../../packages/shared/tests/unit/adapters/builders';
import { card as idealistaCard, NEWEST_URL, searchBody } from '../../../../packages/shared/tests/unit/adapters/idealista-builders';

beforeEach(() => {
  document.body.innerHTML = '<ul><li><img><a href="/annunci/128416572/">a</a></li></ul>';
});

/** Il background finto: risponde a isSweepTab con `inSweep`. */
function fakeSend(inSweep = true) {
  return vi.fn(async (m: ReaderMessage) => (m.type === 'isSweepTab' ? inSweep : null));
}
const pages = (send: ReturnType<typeof fakeSend>) =>
  send.mock.calls.map(([m]) => m).filter((m): m is Extract<ReaderMessage, { type: 'page' }> => m.type === 'page');

describe('lettura solo nella scheda del giro', () => {
  it('fuori dal giro non legge e non manda nulla', async () => {
    const send = fakeSend(false);
    const r = createReader({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await r.handle('next-data', SEARCH_URL, searchNextData([searchResult(realEstate())]));
    expect(send.mock.calls.map(([m]) => m)).toEqual([{ type: 'isSweepTab' }]);
  });

  it('su Idealista fuori dal giro non legge le card', async () => {
    document.body.innerHTML = searchBody([idealistaCard({ id: 1 })]);
    const send = fakeSend(false);
    await createReader({ adapter: idealistaAdapter, send, root: document, getUrl: () => NEWEST_URL }).scan();
    expect(pages(send)).toEqual([]);
  });

  it('se il background non risponde non legge nulla', async () => {
    const send = vi.fn(async (m: ReaderMessage) => {
      if (m.type === 'isSweepTab') throw new Error('Nessuna risposta dal background');
      return null;
    });
    const r = createReader({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await expect(r.handle('next-data', SEARCH_URL, searchNextData([searchResult(realEstate())]))).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('pagine di ricerca', () => {
  it('un messaggio per lettura: annunci (anche agenzie) e riassunto della pagina insieme', async () => {
    const send = fakeSend();
    const r = createReader({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await r.handle('next-data', SEARCH_URL, searchNextData([searchResult(realEstate()), searchResult(realEstate({ id: 2, advertiser: agencyAdvertiser }), 2)]));
    const [p, ...rest] = pages(send);
    expect(rest).toEqual([]);
    expect(p!.url).toBe(SEARCH_URL);
    expect(p!.observations.map((o) => [o.portalId, o.sellerType])).toEqual([[128416572, 'private'], [2, 'agency']]);
    expect(p!.report).toEqual({ portal: 'immobiliare', url: SEARCH_URL, results: 2, privates: 1, lastPage: false, blocked: false, notFound: false, parseErrors: 0 });
  });

  it('pagina vuota: riassunto con 0 risultati', async () => {
    const send = fakeSend();
    await createReader({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL }).handle('next-data', SEARCH_URL, searchNextData([]));
    expect(pages(send)[0]).toMatchObject({ observations: [], report: { results: 0, lastPage: true } });
  });

  it('conta gli annunci non letti e i venditori non riconosciuti', async () => {
    const send = fakeSend();
    const r = createReader({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    const broken = { realEstate: { id: 'x' } };
    const unknownSeller = searchResult(realEstate({ id: 3, advertiser: {} }), 3);
    await r.handle('next-data', SEARCH_URL, searchNextData([searchResult(realEstate()), broken, unknownSeller]));
    expect(pages(send)[0]!.report).toMatchObject({ parseErrors: 2 });
  });

  it('le pagine di dettaglio non si leggono', async () => {
    const send = fakeSend();
    const r = createReader({ adapter: immobiliareAdapter, send, root: document, getUrl: () => DETAIL_URL });
    await r.handle('api', API_URL, { results: [searchResult(realEstate())] });
    await r.handle('next-data', DETAIL_URL, searchNextData([searchResult(realEstate())]));
    expect(pages(send)).toEqual([]);
  });

  it('payload non leggibile: niente annunci e nessun riassunto', async () => {
    const send = fakeSend();
    await createReader({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL }).handle('api', API_URL, { nope: true });
    expect(pages(send)).toEqual([]);
  });
});

describe('modalità DOM', () => {
  const url = 'https://portale.test/vendita/';
  const card = (id: number) => `<article data-id="${id}"><div class="foto"><img></div></article>`;
  const obsFor = (id: number): ListingObservation => ({
    portal: 'idealista', portalId: id, url: `https://portale.test/immobile/${id}/`, title: 't', address: null, city: null, zone: null,
    typology: null, category: null, surfaceM2: null, rooms: null, price: 1, sellerType: 'private', portalCreatedAt: null, lastDrop: null, coverUrl: null, source: 'search',
  });
  const domAdapter: PortalAdapter = {
    portal: 'idealista',
    pageKind: () => 'search',
    readDocument(root, u) {
      const ids = [...root.querySelectorAll('article[data-id]')].map((a) => Number(a.getAttribute('data-id')));
      return {
        observations: ids.map((id) => obsFor(id)),
        errors: [],
        page: { results: ids.length, privates: ids.length, lastPage: false },
        ...(u.endsWith('?nuovi') && ids.length ? { newestId: Math.max(...ids) } : {}),
      };
    },
    cardFor: (root, id) => root.querySelector<HTMLElement>(`article[data-id="${id}"]`),
    badgeHost: (c) => c,
    cardIds: (root) => [...root.querySelectorAll('article[data-id]')].map((a) => Number(a.getAttribute('data-id'))),
  };

  it('scan ripetuto senza card nuove non rimanda nulla; le card aggiunte sì', async () => {
    document.body.innerHTML = card(1);
    const send = fakeSend();
    const r = createReader({ adapter: domAdapter, send, root: document, getUrl: () => url });
    await r.scan();
    await r.scan();
    document.body.insertAdjacentHTML('beforeend', card(3));
    await r.scan();
    expect(pages(send).map((p) => p.observations.map((o) => o.portalId))).toEqual([[1], [3]]);
  });

  it('passa l\'ID più recente', async () => {
    document.body.innerHTML = card(5) + card(9);
    const send = fakeSend();
    await createReader({ adapter: domAdapter, send, root: document, getUrl: () => `${url}?nuovi` }).scan();
    expect(pages(send)[0]).toMatchObject({ newestId: 9 });
  });

  it('Idealista vero: pagina di verifica → solo il blocco', async () => {
    document.body.innerHTML = '<h1>Ops! Al momento non siamo disponibili</h1>';
    const send = fakeSend();
    const u = 'https://www.idealista.it/vendita-case/treviglio-bergamo/?ordine=da-privati-asc';
    await createReader({ adapter: idealistaAdapter, send, root: document, getUrl: () => u }).scan();
    expect(pages(send)).toEqual([{ type: 'page', url: u, observations: [], report: expect.objectContaining({ blocked: true, notFound: false }) }]);
  });
});

describe('checkProblem', () => {
  it('segnala verifica e pagina inesistente solo sulle ricerche e solo nel giro', async () => {
    const send = fakeSend();
    let url = SEARCH_URL;
    const r = createReader({ adapter: immobiliareAdapter, send, root: document, getUrl: () => url });
    const captcha = new DOMParser().parseFromString('<body><iframe src="https://geo.captcha-delivery.com/x"></iframe></body>', 'text/html');
    expect(await r.checkProblem(captcha)).toBe(true);
    expect(pages(send).at(-1)).toEqual({
      type: 'page', url: SEARCH_URL, observations: [],
      report: { portal: 'immobiliare', url: SEARCH_URL, results: 0, privates: 0, lastPage: true, blocked: true, notFound: false, parseErrors: 0 },
    });
    const missing = new DOMParser().parseFromString('<body>La pagina che stai cercando non è presente</body>', 'text/html');
    await r.checkProblem(missing);
    expect(pages(send).at(-1)).toMatchObject({ report: { blocked: false, notFound: true } });
    send.mockClear();
    url = DETAIL_URL;
    expect(await r.checkProblem(captcha)).toBe(false);
    expect(pages(send)).toEqual([]);
    const outside = fakeSend(false);
    url = SEARCH_URL;
    await createReader({ adapter: immobiliareAdapter, send: outside, root: document, getUrl: () => url }).checkProblem(captcha);
    expect(pages(outside)).toEqual([]);
  });
});
