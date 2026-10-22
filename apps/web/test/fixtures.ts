import type { LeadView, ListingRecord } from '@homeradar/shared/shared/types';

const DAY = 86_400_000;
export const NOW = Date.UTC(2026, 9, 22, 10);

type LeadOver = {
  key?: string; title?: string; price?: number | null; priority?: LeadView['evaluation']['priority']; status?: LeadView['state']['status'];
  recallAt?: number | null; notes?: string; city?: string | null; category?: ListingRecord['category']; firstSeenAt?: number;
  others?: LeadView['others']; missing?: number | null; listing?: Partial<ListingRecord>; view?: Partial<LeadView>;
};

export function listing(key: string, over: Partial<ListingRecord> = {}): ListingRecord {
  const [portal, id] = key.split(':') as [ListingRecord['portal'], string];
  return {
    key, portal, portalId: Number(id), url: `https://example.test/${id}`, title: `Casa ${id}`, address: null, city: 'Treviglio', zone: null,
    typology: 'Appartamento', category: 'residential', surfaceM2: 80, rooms: 3, currentPrice: 150_000, portalCreatedAt: NOW - 100 * DAY,
    estimatedCreatedAt: null, lastDrop: null, firstSeenAt: NOW - 10 * DAY, lastSeenAt: NOW - DAY, seenCount: 3, sweepScope: null,
    missedSweeps: 0, missingSince: null, ...over,
  };
}

/** Lead minimo per i test: un annuncio, valutazione e stato di base. */
export function lead(o: LeadOver = {}): LeadView {
  const key = o.key ?? 'immobiliare:1';
  const l = listing(key, {
    ...(o.title != null && { title: o.title }),
    ...(o.price !== undefined && { currentPrice: o.price }),
    ...(o.city !== undefined && { city: o.city }),
    ...(o.category && { category: o.category }),
    ...(o.firstSeenAt != null && { firstSeenAt: o.firstSeenAt }),
    ...o.listing,
  });
  return {
    listing: l,
    evaluation: {
      listingKey: key, portalId: l.portalId, priority: o.priority ?? 'high', ageDays: 100, ageEstimated: false, ageUncertain: false,
      dropPercent: 0, dropCount: 0, maxKnownPrice: l.currentPrice, reasons: ['Online da 100 giorni'], badgeText: '',
    },
    state: { listingKey: key, status: o.status ?? 'new', notes: o.notes ?? '', statusChangedAt: 0, updatedAt: 0, recallAt: o.recallAt ?? null },
    prices: [],
    market: null,
    others: o.others ?? [],
    reposted: false,
    missing: o.missing ?? null,
    missingPortals: [],
    covers: [],
    ...o.view,
  };
}

/** Altra fonte dello stesso immobile. */
export function source(key: string, over: Partial<ListingRecord> = {}, previous = false): LeadView['others'][number] {
  const v = lead({ key, listing: over });
  return { listing: v.listing, evaluation: v.evaluation, prices: [], previous };
}
