import type { ListingObservation } from '@/shared/types';
export function obs(o: Partial<ListingObservation> = {}): ListingObservation {
  return {
    portal: 'immobiliare', portalId: 128416572, url: 'https://www.immobiliare.it/annunci/128416572/',
    title: 'Bilocale via Esempio 1, Precotto, Milano', address: 'Via Esempio', city: 'Milano', zone: 'Precotto',
    typology: 'Appartamento', category: 'residential', surfaceM2: 62, rooms: 2, price: 235000, sellerType: 'private', portalCreatedAt: null,
    lastDrop: { fromPrice: 249000, toPrice: 235000, percent: 5.6, date: Date.UTC(2026, 8, 21) }, coverUrl: null, source: 'search',
    ...o,
  };
}
