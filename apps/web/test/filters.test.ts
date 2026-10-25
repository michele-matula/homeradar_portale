import { describe, expect, it } from 'vitest';
import { OTHER_COMUNI } from '@homeradar/shared/core/lead-filters';
import { addDays, startOfLocalDay } from '@homeradar/shared/core/recall';
import { EMPTY_FILTERS, filterLeads, initialTab, pageOf, toggleIn, type LeadFilters, type Tab } from '../src/leads/filters';
import { DEFAULT_SORT_BY_TAB } from '../src/prefs';
import { lead, NOW, source } from './fixtures';

const ZONE = [
  { istat: '016219', name: 'Treviglio', province: 'BG' },
  { istat: '016053', name: 'Caravaggio', province: 'BG' },
];
const today = startOfLocalDay(NOW);
const run = (leads: ReturnType<typeof lead>[], f: Partial<LeadFilters> = {}, tab: Tab = 'new', sort = DEFAULT_SORT_BY_TAB, newSince: number | null = null) =>
  filterLeads(leads, { ...EMPTY_FILTERS, ...f }, tab, ZONE, sort, NOW, newSince);
const keys = (r: ReturnType<typeof run>) => r.visible.map((l) => l.listing.key);

describe('filtri dei lead', () => {
  it('le schede contano dopo ricerca e prezzo', () => {
    const r = run([lead({ key: 'subito:1', title: 'Villa' }), lead({ key: 'subito:2', title: 'Box' }), lead({ key: 'subito:3', title: 'Villa', status: 'contacted' })], { text: 'villa' });
    expect(r.tabCounts.new).toBe(1);
    expect(r.tabCounts.contacted).toBe(1);
    expect(keys(r)).toEqual(['subito:1']);
  });

  it('la scheda Richiami ha i lead con richiamo, ordinati per gruppo', () => {
    const leads = [
      lead({ key: 'subito:1', recallAt: addDays(today, 3) }),
      lead({ key: 'subito:2', recallAt: today }),
      lead({ key: 'subito:3', recallAt: addDays(today, -1), status: 'to_contact' }),
      lead({ key: 'subito:4' }),
    ];
    const r = run(leads, {}, 'recall');
    expect(r.recallGroups.map((g) => g.kind)).toEqual(['overdue', 'today', 'upcoming']);
    expect(keys(r)).toEqual(['subito:3', 'subito:2', 'subito:1']);
    expect(r.tabCounts.recall).toBe(3);
    expect(r.dueCount).toBe(2);
  });

  it('un lead scartato non conta fra i richiami dovuti', () => {
    expect(run([lead({ recallAt: today, status: 'discarded' })]).dueCount).toBe(0);
  });

  it('i conteggi per sito ignorano il filtro sito ma seguono priorità e su più portali', () => {
    const multi = lead({ key: 'immobiliare:1', others: [source('subito:9')] });
    const leads = [multi, lead({ key: 'subito:2' }), lead({ key: 'idealista:3', priority: 'medium' })];
    const r = run(leads, { portals: ['subito'], priority: 'high' });
    expect(r.portalCounts).toEqual({ immobiliare: 1, idealista: 0, subito: 2, casadaprivato: 0 });
    expect(keys(r).sort()).toEqual(['immobiliare:1', 'subito:2']);
    const m = run(leads, { multi: true });
    expect(m.portalCounts.subito).toBe(1);
    expect(m.multiCount).toBe(1);
  });

  it('i conteggi per comune ignorano il filtro comune', () => {
    const leads = [lead({ key: 'subito:1' }), lead({ key: 'subito:2', city: 'Caravaggio' }), lead({ key: 'subito:3', city: 'Milano' })];
    const r = run(leads, { comuni: ['016053'] });
    expect(keys(r)).toEqual(['subito:2']);
    expect(r.comuneCounts).toEqual({ '016219': 1, '016053': 1, [OTHER_COMUNI]: 1 });
  });

  it('un comune non più in zona esce dal filtro', () => {
    const r = run([lead({ key: 'subito:1' }), lead({ key: 'subito:2', city: 'Caravaggio' })], { comuni: ['099999'] });
    expect(keys(r).sort()).toEqual(['subito:1', 'subito:2']);
    expect(r.tags).toEqual([]);
  });

  it('prezzo non valido non filtra', () => {
    const r = run([lead({ key: 'subito:1', price: 100_000 }), lead({ key: 'subito:2', price: 300_000 })], { minInput: 'abc' });
    expect(r.visible).toHaveLength(2);
    expect(r.priceInvalid).toEqual({ min: true, max: false });
  });

  it('fascia di prezzo in migliaia', () => {
    const r = run([lead({ key: 'subito:1', price: 100_000 }), lead({ key: 'subito:2', price: 300_000 })], { minInput: '200' });
    expect(keys(r)).toEqual(['subito:2']);
    expect(r.tags.map((t) => t.label)).toEqual(['da 200 k€']);
  });

  it('solo trattativa riservata', () => {
    expect(keys(run([lead({ key: 'subito:1', price: null }), lead({ key: 'subito:2' })], { reservedOnly: true }))).toEqual(['subito:1']);
  });

  describe('nuovi dell\'ultimo giro', () => {
    const T = NOW - 3_600_000;

    it('nelle schede di stato i nuovi stanno in cima, ognuno col suo ordinamento', () => {
      const leads = [
        lead({ key: 'subito:1', price: 100_000, firstSeenAt: T - 1 }),
        lead({ key: 'subito:2', price: 300_000, firstSeenAt: T + 1 }),
        lead({ key: 'subito:3', price: 200_000, firstSeenAt: T + 2 }),
        lead({ key: 'subito:4', price: 50_000, firstSeenAt: T - 1 }),
      ];
      const r = run(leads, {}, 'new', { ...DEFAULT_SORT_BY_TAB, new: 'price_asc' }, T);
      expect(keys(r)).toEqual(['subito:3', 'subito:2', 'subito:4', 'subito:1']);
      expect(r.newHead).toBe(2);
      expect(r.newCount).toBe(2);
    });

    it('Solo nuovi', () => {
      const r = run([lead({ key: 'subito:1', firstSeenAt: T + 1 }), lead({ key: 'subito:2', firstSeenAt: T - 1 })], { newOnly: true }, 'new', DEFAULT_SORT_BY_TAB, T);
      expect(keys(r)).toEqual(['subito:1']);
      expect(r.newCount).toBe(1);
      expect(r.tags.map((t) => t.label)).toEqual(['Solo nuovi']);
    });

    it('un lead con un annuncio già visto non è nuovo', () => {
      const r = run([lead({ key: 'subito:1', firstSeenAt: T + 1, others: [source('idealista:2', { firstSeenAt: T - 1 })] })], {}, 'new', DEFAULT_SORT_BY_TAB, T);
      expect(r.newHead).toBe(0);
    });

    it('nella scheda Richiami niente gruppo dei nuovi', () => {
      const r = run([lead({ key: 'subito:1', firstSeenAt: T + 1, recallAt: today })], {}, 'recall', DEFAULT_SORT_BY_TAB, T);
      expect(r.newHead).toBe(0);
    });

    it('senza giro nessun nuovo', () => {
      expect(run([lead({ key: 'subito:1', firstSeenAt: T + 1 })]).newHead).toBe(0);
    });
  });

  it('pagine da 25', () => {
    const xs = Array.from({ length: 60 }, (_, i) => i);
    expect(pageOf(xs, 1)).toMatchObject({ page: 1, pages: 3, from: 1, to: 25 });
    expect(pageOf(xs, 3)).toMatchObject({ page: 3, from: 51, to: 60 });
    expect(pageOf(xs, 3).items).toHaveLength(10);
    expect(pageOf(xs, 9).page).toBe(3);
    expect(pageOf(xs, 0).page).toBe(1);
    expect(pageOf([], 4)).toMatchObject({ items: [], page: 1, pages: 1, from: 0, to: 0 });
  });

  it('non più visti', () => {
    const r = run([lead({ key: 'subito:1', missing: NOW - 1000 }), lead({ key: 'subito:2' })], { missingOnly: true });
    expect(keys(r)).toEqual(['subito:1']);
    expect(r.missingCount).toBe(1);
  });

  it('categorie contate prima del proprio filtro', () => {
    const r = run([lead({ key: 'subito:1' }), lead({ key: 'subito:2', category: 'garage' })], { categories: ['garage'] });
    expect(keys(r)).toEqual(['subito:2']);
    expect(r.categoryCounts.residential).toBe(1);
  });

  it('conteggi per priorità', () => {
    const r = run([lead({ key: 'subito:1' }), lead({ key: 'subito:2', priority: 'verify' })], { priority: 'verify' });
    expect(r.priorityCounts).toEqual({ all: 2, high: 1, medium: 0, verify: 1 });
    expect(keys(r)).toEqual(['subito:2']);
  });

  it('ordinamento della scheda', () => {
    const leads = [lead({ key: 'subito:1', price: 300_000 }), lead({ key: 'subito:2', price: 100_000 })];
    expect(keys(run(leads, {}, 'new', { ...DEFAULT_SORT_BY_TAB, new: 'price_asc' }))).toEqual(['subito:2', 'subito:1']);
  });

  it('toggleIn: sceglierli tutti torna a []', () => {
    expect(toggleIn(['a', 'b', 'c'], ['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleIn(['a', 'b', 'c'], ['a', 'b'], 'c')).toEqual([]);
    expect(toggleIn(['a', 'b', 'c'], ['a', 'b'], 'a')).toEqual(['b']);
  });

  it('initialTab', () => {
    expect(initialTab([lead({ recallAt: today })], NOW)).toBe('recall');
    expect(initialTab([lead({ recallAt: addDays(today, 2) })], NOW)).toBe('new');
  });

  it('tags', () => {
    const r = run([lead()], { portals: ['subito'], missingOnly: true });
    expect(r.tags.map((t) => t.label)).toEqual(['Subito', 'Non più visti']);
    expect(r.tags.map((t) => t.key)).toEqual(['portals', 'missingOnly']);
  });
});
