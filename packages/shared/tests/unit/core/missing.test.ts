import { describe, expect, it } from 'vitest';
import { isMissing, MISSING_MIN_AGE_MS, MISSING_SWEEPS, missingUpdates } from '@/core/missing';
import type { ListingRecord } from '@/shared/types';
import { listing, NOW } from './backup-builders';

const HOUR = 3_600_000;

const A = 'immobiliare|comune:016219|case';
const rec = (o: Partial<ListingRecord>) => listing({ sweepScope: A, missedSweeps: 0, missingSince: null, ...o });

describe('missingUpdates', () => {
  it('conta un giro mancato solo se la sua ricerca è stata completa', () => {
    const l = rec({});
    expect(missingUpdates([l], new Set([A]), new Set(), 500)).toEqual([{ ...l, missedSweeps: 1, missingSince: 500 }]);
    expect(missingUpdates([l], new Set(['altra']), new Set(), 500)).toEqual([]);
  });
  it('non tocca gli annunci visti, quelli senza ricerca e quelli di ricerche tolte dalla zona', () => {
    expect(missingUpdates([rec({})], new Set([A]), new Set(['immobiliare:128416572']), 500)).toEqual([]);
    expect(missingUpdates([rec({ sweepScope: null })], new Set([A]), new Set(), 500)).toEqual([]);
    expect(missingUpdates([rec({ sweepScope: 'immobiliare|comune:999999|case' })], new Set([A]), new Set(), 500)).toEqual([]);
  });
  it('tiene la data del primo giro mancato; diventa "non più visto" al terzo', () => {
    const l = rec({ missedSweeps: MISSING_SWEEPS - 1, missingSince: 100 });
    const [u] = missingUpdates([l], new Set([A]), new Set(), 500);
    expect(u).toMatchObject({ missedSweeps: MISSING_SWEEPS, missingSince: 100 });
    expect(isMissing(u!, NOW + MISSING_MIN_AGE_MS)).toBe(true);
    expect(isMissing(l, NOW + MISSING_MIN_AGE_MS)).toBe(false);
  });
});

describe('isMissing', () => {
  it('serve anche non averlo visto da almeno 24 ore', () => {
    expect(isMissing(rec({ missedSweeps: 3, lastSeenAt: NOW - 23 * HOUR }), NOW)).toBe(false);
    expect(isMissing(rec({ missedSweeps: 3, lastSeenAt: NOW - 25 * HOUR }), NOW)).toBe(true);
    expect(isMissing(rec({ missedSweeps: 2, lastSeenAt: 0 }), NOW)).toBe(false);
  });
});
