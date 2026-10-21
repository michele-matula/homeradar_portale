import { describe, expect, it } from 'vitest';
import { DEFAULT_CALIBRATION, mergeCalibration, utcDay } from '@/core/age';
import { learnedPoint, mergeObservation, type IngestContext } from '@/core/ingest';
import { DAY_MS, VISIT_GAP_MS, type ListingObservation } from '@/shared/types';

const NOW = Date.UTC(2026, 9, 21, 10);
const SCOPE = 'immobiliare|comune:016219|case';
const ctx = (o: Partial<IngestContext> = {}): IngestContext => ({ at: NOW, sweepScope: SCOPE, searchCategory: 'residential', points: DEFAULT_CALIBRATION.immobiliare, ...o });

function obs(o: Partial<ListingObservation> = {}): ListingObservation {
  return {
    portal: 'immobiliare', portalId: 128416572, url: 'https://www.immobiliare.it/annunci/128416572/', title: 'Trilocale', address: 'Via Roma 1',
    city: 'Treviglio', zone: 'Centro', typology: 'Appartamento', category: null, surfaceM2: 80, rooms: 3, price: 200_000, sellerType: 'private',
    portalCreatedAt: null, lastDrop: null, coverUrl: null, source: 'search', ...o,
  };
}

const first = () => mergeObservation(null, obs(), ctx(), null)!;

describe('mergeObservation', () => {
  it('primo avvistamento', () => {
    const m = first();
    expect(m.record).toMatchObject({
      key: 'immobiliare:128416572', firstSeenAt: NOW, lastSeenAt: NOW, seenCount: 1, sweepScope: SCOPE, category: 'residential',
      currentPrice: 200_000, missedSweeps: 0, missingSince: null,
    });
    expect(m.record.estimatedCreatedAt).not.toBeNull();
    expect(m.snapshots).toEqual([{ listingKey: 'immobiliare:128416572', price: 200_000, at: NOW, source: 'observed' }]);
    expect(m.dropped).toBe(false);
  });

  it('i campi assenti non cancellano quelli salvati', () => {
    const prev = first().record;
    const m = mergeObservation(prev, obs({ address: null, city: null, zone: null, typology: null, surfaceM2: null, rooms: null, price: null }), ctx({ at: NOW + DAY_MS }), 200_000)!;
    expect(m.record).toMatchObject({ address: 'Via Roma 1', city: 'Treviglio', zone: 'Centro', typology: 'Appartamento', surfaceM2: 80, rooms: 3, currentPrice: 200_000 });
    expect(m.snapshots).toEqual([]);
  });

  it('trattativa riservata azzera il prezzo', () => {
    const m = mergeObservation(first().record, obs({ price: null, priceReserved: true }), ctx({ at: NOW + DAY_MS }), 200_000)!;
    expect(m.record.currentPrice).toBeNull();
  });

  it('categoria: osservazione, poi ricerca, poi precedente, poi residenziale', () => {
    expect(mergeObservation(null, obs({ category: 'garage' }), ctx(), null)!.record.category).toBe('garage');
    expect(mergeObservation(null, obs(), ctx({ searchCategory: 'land' }), null)!.record.category).toBe('land');
    const prev = mergeObservation(null, obs(), ctx({ searchCategory: 'commercial' }), null)!.record;
    expect(mergeObservation(prev, obs(), ctx({ searchCategory: null, at: NOW + DAY_MS }), 200_000)!.record.category).toBe('commercial');
    expect(mergeObservation(null, obs(), ctx({ searchCategory: null }), null)!.record.category).toBe('residential');
  });

  it('visite ravvicinate: seenCount e lastSeenAt non avanzano', () => {
    const prev = first().record;
    const near = mergeObservation(prev, obs(), ctx({ at: NOW + VISIT_GAP_MS - 1 }), 200_000)!.record;
    expect(near).toMatchObject({ seenCount: 1, lastSeenAt: NOW });
    const far = mergeObservation(prev, obs(), ctx({ at: NOW + VISIT_GAP_MS }), 200_000)!.record;
    expect(far).toMatchObject({ seenCount: 2, lastSeenAt: NOW + VISIT_GAP_MS });
  });

  it('la copertina non si cancella con una lettura senza foto', () => {
    const prev = mergeObservation(null, obs({ coverUrl: 'https://pwm.im-cdn.it/image/1/xxs-c.jpg' }), ctx(), null)!.record;
    expect(mergeObservation(prev, obs(), ctx({ at: NOW + DAY_MS }), 200_000)!.record.coverUrl).toBe('https://pwm.im-cdn.it/image/1/xxs-c.jpg');
    expect('coverUrl' in first().record).toBe(false);
  });

  it('ribasso dichiarato: due prezzi dichiarati', () => {
    const date = Date.UTC(2026, 9, 1);
    const m = mergeObservation(null, obs({ price: 180_000, lastDrop: { fromPrice: 200_000, toPrice: 180_000, percent: 10, date } }), ctx(), null)!;
    expect(m.record.lastDrop).toEqual({ fromPrice: 200_000, toPrice: 180_000, percent: 10, date });
    expect(m.snapshots).toEqual([
      { listingKey: m.record.key, price: 200_000, at: date - 1, source: 'declared' },
      { listingKey: m.record.key, price: 180_000, at: date, source: 'declared' },
      { listingKey: m.record.key, price: 180_000, at: NOW, source: 'observed' },
    ]);
  });

  it('ribasso senza data: il giorno in cui si vede, poi resta quello', () => {
    const drop = { fromPrice: 200_000, toPrice: 180_000, percent: 10, date: null };
    const m = mergeObservation(null, obs({ portal: 'idealista', price: 180_000, lastDrop: drop }), ctx(), null)!;
    expect(m.record.lastDrop).toEqual({ fromPrice: 200_000, toPrice: 180_000, percent: 10, date: utcDay(NOW), dateEstimated: true });
    const later = mergeObservation(m.record, obs({ portal: 'idealista', price: 180_000, lastDrop: drop }), ctx({ at: NOW + 3 * DAY_MS }), 180_000)!;
    expect(later.record.lastDrop!.date).toBe(utcDay(NOW));
    expect(later.dropped).toBe(false);
  });

  it('dropped solo per un annuncio già salvato con prezzo sceso o ribasso nuovo', () => {
    const prev = first().record;
    expect(mergeObservation(prev, obs({ price: 190_000 }), ctx({ at: NOW + DAY_MS }), 200_000)!.dropped).toBe(true);
    expect(mergeObservation(prev, obs({ price: 210_000 }), ctx({ at: NOW + DAY_MS }), 200_000)!.dropped).toBe(false);
    const declared = obs({ lastDrop: { fromPrice: 220_000, toPrice: 200_000, percent: 9, date: Date.UTC(2026, 9, 1) } });
    expect(mergeObservation(prev, declared, ctx({ at: NOW + DAY_MS }), 200_000)!.dropped).toBe(true);
    expect(mergeObservation(null, obs({ price: 1 }), ctx(), null)!.dropped).toBe(false);
  });

  it('visto adesso: non è più "non più visto"', () => {
    const prev = { ...first().record, missedSweeps: 3, missingSince: NOW - DAY_MS };
    expect(mergeObservation(prev, obs(), ctx({ at: NOW + DAY_MS }), 200_000)!.record).toMatchObject({ missedSweeps: 0, missingSince: null });
  });

  it('prezzo osservato solo se cambia', () => {
    const prev = first().record;
    expect(mergeObservation(prev, obs(), ctx({ at: NOW + DAY_MS }), 200_000)!.snapshots).toEqual([]);
    expect(mergeObservation(prev, obs({ price: 205_000 }), ctx({ at: NOW + DAY_MS }), 200_000)!.snapshots).toEqual([
      { listingKey: prev.key, price: 205_000, at: NOW + DAY_MS, source: 'observed' },
    ]);
  });

  it('una lettura più vecchia dell\'ultima letta, anche dentro la stessa visita, non cambia nulla', () => {
    const prev = first().record;
    const later = mergeObservation(prev, obs({ price: 210_000 }), ctx({ at: NOW + 25 * 60_000 }), 200_000)!.record;
    expect(later).toMatchObject({ lastSeenAt: NOW, lastReadAt: NOW + 25 * 60_000, currentPrice: 210_000 });
    expect(mergeObservation(later, obs({ price: 200_000 }), ctx({ at: NOW + 10 * 60_000 }), 210_000)).toBeNull();
  });

  it('una lettura più vecchia di quella salvata non cambia nulla', () => {
    const prev = first().record;
    expect(mergeObservation(prev, obs({ price: 150_000 }), ctx({ at: NOW - 3_600_000 }), 200_000)).toBeNull();
  });
});

describe('learnedPoint', () => {
  const points = DEFAULT_CALIBRATION.idealista;
  const last = mergeCalibration([], points).at(-1)!;
  it('accetta un ID coerente con il ritmo di Idealista', () => {
    const at = last.createdAt + 10 * DAY_MS;
    const id = last.portalId + 10 * 8200;
    expect(learnedPoint({ portal: 'idealista', portalId: id }, points, at)).toEqual({ portal: 'idealista', portalId: id, createdAt: utcDay(at) });
  });
  it('nessun punto per Immobiliare o per un ID incoerente', () => {
    expect(learnedPoint({ portal: 'immobiliare', portalId: 999_999_999 }, DEFAULT_CALIBRATION.immobiliare, NOW)).toBeNull();
    expect(learnedPoint({ portal: 'idealista', portalId: 1 }, points, last.createdAt + 10 * DAY_MS)).toBeNull();
  });
});
