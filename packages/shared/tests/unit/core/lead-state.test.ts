import { describe, expect, it } from 'vitest';
import { groupStateWrite, nextLeadState, RECALL_ON_DISCARDED, splitWrites } from '@/core/lead-state';
import { startOfLocalDay } from '@/core/recall';
import { splitPair } from '@/core/same-property';
import { DAY_MS, type LeadState, type ListingRecord, type Portal } from '@/shared/types';

const NOW = Date.UTC(2026, 9, 21, 10);

function rec(portal: Portal, id: number, o: Partial<ListingRecord> = {}): ListingRecord {
  return {
    key: `${portal}:${id}`, portal, portalId: id, url: '', title: `${portal} ${id}`, address: null,
    city: 'Milano', zone: 'Navigli', typology: null, surfaceM2: 80, rooms: 3, currentPrice: 300000,
    portalCreatedAt: null, estimatedCreatedAt: NOW - 200 * DAY_MS, lastDrop: null, firstSeenAt: 0, lastSeenAt: NOW, seenCount: 1, category: 'residential', sweepScope: null, missedSweeps: 0, missingSince: null, ...o,
  };
}
const state = (listingKey: string, o: Partial<LeadState> = {}): LeadState => ({
  listingKey, status: 'new', notes: '', statusChangedAt: 0, updatedAt: 0, recallAt: null, ...o,
});

describe('nextLeadState', () => {
  const prev = state('immobiliare:1');
  it('updatedAt avanza solo se qualcosa cambia', () => {
    expect(nextLeadState(prev, { status: 'new', notes: '' }, NOW)).toEqual({ ...prev });
    expect(nextLeadState(prev, { notes: 'sera' }, NOW)).toMatchObject({ notes: 'sera', updatedAt: NOW, statusChangedAt: 0 });
    expect(nextLeadState(prev, { status: 'contacted' }, NOW)).toMatchObject({ status: 'contacted', statusChangedAt: NOW, updatedAt: NOW });
  });
  it('un richiamo su un lead nuovo lo porta a "Da contattare", al giorno locale', () => {
    const s = nextLeadState(prev, { recallAt: NOW + 3_600_000 }, NOW);
    expect(s).toMatchObject({ status: 'to_contact', recallAt: startOfLocalDay(NOW + 3_600_000), updatedAt: NOW });
  });
  it('scartato: niente richiamo', () => {
    expect(() => nextLeadState(prev, { status: 'discarded', recallAt: NOW }, NOW)).toThrow(RECALL_ON_DISCARDED);
    const withRecall = state('immobiliare:1', { status: 'to_contact', recallAt: NOW });
    expect(nextLeadState(withRecall, { status: 'discarded' }, NOW)).toMatchObject({ status: 'discarded', recallAt: null });
  });
  it('recallAt null toglie il richiamo', () => {
    expect(nextLeadState(state('k', { status: 'to_contact', recallAt: NOW }), { recallAt: null }, NOW + 1)).toMatchObject({ recallAt: null, updatedAt: NOW + 1 });
  });
});

describe('groupStateWrite', () => {
  const a = rec('immobiliare', 1);
  const b = rec('idealista', 2);
  it('parte dallo stato unito del gruppo e scrive lo stesso stato su tutti', () => {
    const { prev, next } = groupStateWrite([
      { listing: a, state: state(a.key) },
      { listing: b, state: state(b.key, { status: 'contacted', updatedAt: 9, statusChangedAt: 9 }) },
    ], { notes: 'ok' }, NOW);
    expect(prev).toMatchObject({ listingKey: a.key, status: 'contacted' });
    expect(next).toMatchObject({ status: 'contacted', notes: 'ok', updatedAt: NOW });
  });
  it('un membro diverso dallo stato unito è una modifica anche senza cambiare nulla', () => {
    const { next } = groupStateWrite([
      { listing: a, state: state(a.key) },
      { listing: b, state: state(b.key, { status: 'contacted', updatedAt: 9, statusChangedAt: 9 }) },
    ], {}, NOW);
    expect(next.updatedAt).toBe(NOW);
  });
  it('un annuncio da solo senza modifiche resta com\'è', () => {
    expect(groupStateWrite([{ listing: a, state: state(a.key, { updatedAt: 5 }) }], {}, NOW).next.updatedAt).toBe(5);
  });
});

describe('splitWrites', () => {
  it('stato del gruppo su tutti e coppie con le altre fonti', () => {
    const a = rec('immobiliare', 1);
    const b = rec('idealista', 2);
    const { states, pairs } = splitWrites({ listings: [a, b], splits: [] }, [
      { listing: a, state: state(a.key, { status: 'contacted', updatedAt: 5 }) },
      { listing: b, state: state(b.key) },
    ], a.key, [b.key], NOW);
    expect(states.map((s) => [s.listingKey, s.status, s.updatedAt])).toEqual([[a.key, 'contacted', NOW], [b.key, 'contacted', NOW]]);
    expect(pairs).toEqual([splitPair(a.key, b.key, NOW)]);
  });
  it('la catena di ripubblicazione si stacca intera', () => {
    const before = rec('immobiliare', 1, { portalCreatedAt: NOW - 300 * DAY_MS, currentPrice: 300000, firstSeenAt: NOW - 300 * DAY_MS, lastSeenAt: NOW - 30 * DAY_MS });
    const head = rec('immobiliare', 2, { portalCreatedAt: NOW - 5 * DAY_MS, currentPrice: 300000, firstSeenAt: NOW - 5 * DAY_MS, lastSeenAt: NOW });
    const other = rec('idealista', 3, { currentPrice: 300000 });
    const members = [head, before, other].map((l) => ({ listing: l, state: state(l.key) }));
    const { pairs } = splitWrites({ listings: [before, head, other], splits: [] }, members, head.key, [before.key, other.key], NOW);
    expect(pairs).toEqual(expect.arrayContaining([splitPair(head.key, other.key, NOW), splitPair(before.key, other.key, NOW)]));
    expect(pairs).toHaveLength(2);
  });
});
