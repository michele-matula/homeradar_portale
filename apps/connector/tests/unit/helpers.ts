import type { ListingObservation, PageReport, SearchSpec } from '@homeradar/shared/shared/types';

export const IMM: SearchSpec = {
  portal: 'immobiliare', key: 'immobiliare|comune:015059|negozi', label: "Cassano d'Adda · Negozi", categories: ['commercial'],
  url: 'https://www.immobiliare.it/vendita-negozi/cassano-d-adda/?criterio=privateFirst',
};
export const SUB: SearchSpec = {
  portal: 'subito', key: 'subito|comune:015059|immobili', label: "Cassano d'Adda · Immobili", categories: ['residential', 'commercial'],
  url: 'https://www.subito.it/annunci-lombardia/vendita/immobili/milano/cassano-d-adda/?advt=0',
};

export function obs(o: Partial<ListingObservation> = {}): ListingObservation {
  const portalId = o.portalId ?? 128416572;
  return {
    portal: 'immobiliare', portalId, url: `https://www.immobiliare.it/annunci/${portalId}/`, title: 'Negozio', address: null, city: "Cassano d'Adda",
    zone: null, typology: 'Negozio', category: 'commercial', surfaceM2: 80, rooms: 2, price: 200_000, sellerType: 'private', portalCreatedAt: null,
    lastDrop: null, coverUrl: null, source: 'search', ...o,
  };
}

export const page = (portal: PageReport['portal'], o: Partial<PageReport> = {}): PageReport => ({
  portal, url: portal === 'immobiliare' ? IMM.url : SUB.url, results: 3, privates: 1, lastPage: true, blocked: false, notFound: false, parseErrors: 0, ...o,
});
