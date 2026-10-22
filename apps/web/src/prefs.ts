import { SORT_KEYS, type SortKey } from '@homeradar/shared/core/leads';
import { LEAD_STATUSES, type LeadStatus } from '@homeradar/shared/shared/types';

// Comodità della vista, come nel pannello dell'estensione: stanno nel browser e, se mancano o non si leggono, valgono i default.

export type SortByTab = Record<LeadStatus, SortKey>;

const SORT_KEY = 'homeradar.sortByTab';
const FILTERS_KEY = 'homeradar.filtersOpen';
export const DEFAULT_SORT_BY_TAB: SortByTab = { new: 'priority', to_contact: 'priority', contacted: 'priority', discarded: 'priority' };

/** Ordinamento scelto per ogni scheda; i valori sconosciuti tornano all'ordine per priorità. */
export function loadSortByTab(): SortByTab {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SORT_KEY) ?? '{}');
    const record = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
    const valid = (v: unknown): v is SortKey => SORT_KEYS.includes(v as SortKey);
    return Object.fromEntries(LEAD_STATUSES.map((s) => [s, valid(record[s]) ? record[s] : DEFAULT_SORT_BY_TAB[s]])) as SortByTab;
  } catch {
    return { ...DEFAULT_SORT_BY_TAB };
  }
}

export function saveSortByTab(s: SortByTab): void {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(s));
  } catch {
    // Archivio non disponibile: la scelta vale finché la pagina resta aperta.
  }
}

/** Riquadro «Filtri» aperto o chiuso; chiuso se manca. */
export function loadFiltersOpen(): boolean {
  try {
    return localStorage.getItem(FILTERS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveFiltersOpen(open: boolean): void {
  try {
    localStorage.setItem(FILTERS_KEY, String(open));
  } catch {
    // Come sopra.
  }
}
