import { acceptLearnedPoint, estimateCreatedAt, LEARN_RATE_PER_DAY, utcDay, type IdDate } from './age';
import {
  listingKey, VISIT_GAP_MS,
  type CalibrationHint, type CalibrationPoint, type ListingObservation, type ListingRecord, type ObservedPriceDrop, type PriceDrop, type PriceSnapshot, type PropertyCategory,
} from '../shared/types';

/** Lettura di una pagina del giro: quando, da quale ricerca, con quali punti di calibrazione del portale. */
export interface IngestContext {
  at: number;
  sweepScope: string;
  /** Categoria della ricerca, usata se la tipologia non la dice. */
  searchCategory: PropertyCategory | null;
  points: IdDate[];
}

export interface Merged {
  record: ListingRecord;
  /** Prezzi da aggiungere se non c'è già uno snapshot con lo stesso `at`. */
  snapshots: Omit<PriceSnapshot, 'id'>[];
  /** Annuncio già salvato con il prezzo sceso o un ribasso nuovo dichiarato dal portale. */
  dropped: boolean;
}

/** Dà una data al ribasso: quella del portale, quella già registrata per lo stesso ribasso o il giorno della lettura. */
function resolveDrop(drop: ObservedPriceDrop | null, prev: PriceDrop | null, at: number): PriceDrop | null {
  if (!drop) return null;
  if (drop.date != null) return { ...drop, date: drop.date };
  if (prev && prev.fromPrice === drop.fromPrice && prev.toPrice === drop.toPrice) return prev;
  return { ...drop, date: utcDay(at), dateEstimated: true };
}

/**
 * Unisce un'osservazione di un privato all'annuncio salvato. `lastPrice` è il prezzo dell'ultimo snapshot.
 * null se la lettura è più vecchia dell'ultima lettura salvata (lotto arrivato in ritardo): l'archivio sa già di più.
 * Vale anche dentro una visita, dove `lastSeenAt` resta fermo: per questo il confronto è con `lastReadAt`.
 */
export function mergeObservation(prev: ListingRecord | null, o: ListingObservation, ctx: IngestContext, lastPrice: number | null): Merged | null {
  const { at } = ctx;
  if (prev && at < (prev.lastReadAt ?? prev.lastSeenAt)) return null;
  const key = listingKey(o.portal, o.portalId);
  const drop = resolveDrop(o.lastDrop, prev?.lastDrop ?? null, at);
  const priceDropped = prev?.currentPrice != null && o.price != null && o.price < prev.currentPrice;
  const newDeclared = drop != null && (prev?.lastDrop == null || prev.lastDrop.fromPrice !== drop.fromPrice || prev.lastDrop.toPrice !== drop.toPrice);
  const record: ListingRecord = {
    key,
    portal: o.portal,
    portalId: o.portalId,
    url: o.url,
    title: o.title,
    address: o.address ?? prev?.address ?? null,
    city: o.city ?? prev?.city ?? null,
    zone: o.zone ?? prev?.zone ?? null,
    typology: o.typology ?? prev?.typology ?? null,
    category: o.category ?? ctx.searchCategory ?? prev?.category ?? 'residential',
    surfaceM2: o.surfaceM2 ?? prev?.surfaceM2 ?? null,
    rooms: o.rooms ?? prev?.rooms ?? null,
    currentPrice: o.priceReserved ? null : (o.price ?? prev?.currentPrice ?? null),
    portalCreatedAt: o.portalCreatedAt ?? prev?.portalCreatedAt ?? null,
    estimatedCreatedAt: estimateCreatedAt(o.portalId, ctx.points),
    lastDrop: drop ?? prev?.lastDrop ?? null,
    firstSeenAt: prev?.firstSeenAt ?? at,
    // Se la visita precedente è recente, lastSeenAt non avanza: altrimenti visite ravvicinate
    // spezzerebbero all'infinito la finestra di VISIT_GAP_MS.
    lastSeenAt: prev && at - prev.lastSeenAt < VISIT_GAP_MS ? prev.lastSeenAt : at,
    seenCount: !prev ? 1 : at - prev.lastSeenAt >= VISIT_GAP_MS ? prev.seenCount + 1 : prev.seenCount,
    sweepScope: ctx.sweepScope,
    // Visto adesso: non è più "non più visto".
    missedSweeps: 0,
    missingSince: null,
  };
  // La copertina si scrive solo se nota: una lettura senza foto non cancella quella salvata.
  const cover = o.coverUrl ?? prev?.coverUrl;
  if (cover) record.coverUrl = cover;
  record.lastReadAt = at;

  const snapshots: Omit<PriceSnapshot, 'id'>[] = [];
  if (drop) {
    snapshots.push({ listingKey: key, price: drop.fromPrice, at: drop.date - 1, source: 'declared' });
    snapshots.push({ listingKey: key, price: drop.toPrice, at: drop.date, source: 'declared' });
  }
  if (o.price != null && o.price !== lastPrice) snapshots.push({ listingKey: key, price: o.price, at, source: 'observed' });
  return { record, snapshots, dropped: prev != null && (priceDropped || newDeclared) };
}

/** Punto "creato oggi" dall'annuncio più recente di una pagina ordinata per data; null se non è affidabile. */
export function learnedPoint(hint: CalibrationHint, points: IdDate[], at: number): CalibrationPoint | null {
  const rate = LEARN_RATE_PER_DAY[hint.portal];
  if (!rate) return null;
  const candidate = { portal: hint.portal, portalId: hint.portalId, createdAt: utcDay(at) };
  return acceptLearnedPoint(candidate, points, rate) ? candidate : null;
}
