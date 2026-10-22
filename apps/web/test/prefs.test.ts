import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SORT_BY_TAB, loadFiltersOpen, loadSortByTab, saveFiltersOpen, saveSortByTab } from '../src/prefs';
import { leadKeyOf, leadPath } from '../src/router';

afterEach(() => localStorage.clear());

describe('preferenze di vista', () => {
  it('ordinamento: salvato e riletto, valori sconosciuti tornano al default', () => {
    saveSortByTab({ ...DEFAULT_SORT_BY_TAB, new: 'price_asc' });
    expect(loadSortByTab().new).toBe('price_asc');
    localStorage.setItem('homeradar.sortByTab', JSON.stringify({ new: 'boh', contacted: 'drop' }));
    expect(loadSortByTab()).toEqual({ ...DEFAULT_SORT_BY_TAB, contacted: 'drop' });
    localStorage.setItem('homeradar.sortByTab', '{rotto');
    expect(loadSortByTab()).toEqual(DEFAULT_SORT_BY_TAB);
  });

  it('riquadro filtri: chiuso se manca', () => {
    expect(loadFiltersOpen()).toBe(false);
    saveFiltersOpen(true);
    expect(loadFiltersOpen()).toBe(true);
  });

  it('localStorage che lancia: default', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloccato');
    });
    expect(loadSortByTab()).toEqual(DEFAULT_SORT_BY_TAB);
    expect(loadFiltersOpen()).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('indirizzi dei lead', () => {
  it('andata e ritorno della chiave', () => {
    expect(leadPath('subito:12')).toBe('/lead/subito%3A12');
    expect(leadKeyOf(leadPath('subito:12'))).toBe('subito:12');
  });

  it('percorsi che non sono un lead', () => {
    expect(leadKeyOf('/lead/%E0')).toBeNull();
    expect(leadKeyOf('/')).toBeNull();
    expect(leadKeyOf('/lead/')).toBeNull();
  });
});
