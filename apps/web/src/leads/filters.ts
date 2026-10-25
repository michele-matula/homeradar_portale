import { applyQuery, describeQuery, inComuni, OTHER_COMUNI, parseThousands, type LeadQuery } from '@homeradar/shared/core/lead-filters';
import { isNewLead } from '@homeradar/shared/core/lead-groups';
import { groupByRecall, groupByStatus, leadCategories, leadPortals, PRIORITY_LABELS, sortLeadsBy } from '@homeradar/shared/core/leads';
import { isDue, type RecallKind } from '@homeradar/shared/core/recall';
import { joinList } from '@homeradar/shared/shared/format';
import {
  CATEGORY_LABELS, LEAD_STATUSES, PORTAL_TAGS, PORTALS, PROPERTY_CATEGORIES,
  type ComuneRef, type LeadStatus, type LeadView, type Portal, type PropertyCategory,
} from '@homeradar/shared/shared/types';
import type { SortByTab } from '../prefs';

// Filtri, schede e conteggi della lista, come nel pannello dell'estensione (homeradar/src/ui/sidepanel/App.tsx).

export type Tab = 'recall' | LeadStatus;
export const TABS: Tab[] = ['recall', ...LEAD_STATUSES];
export const TAB_LABELS: Record<Tab, string> = { recall: 'Richiami', new: 'Da lavorare', to_contact: 'Da contattare', contacted: 'Contattati', discarded: 'Scartati' };

export type PriorityFilter = 'all' | 'high' | 'medium' | 'verify';
export const PRIORITY_FILTERS: PriorityFilter[] = ['all', 'high', 'medium', 'verify'];
export const PRIORITY_FILTER_LABELS: Record<PriorityFilter, string> = {
  all: 'Tutti', high: PRIORITY_LABELS.high, medium: PRIORITY_LABELS.medium, verify: PRIORITY_LABELS.verify,
};

export interface LeadFilters {
  text: string;
  /** Prezzi in migliaia di euro, come li scrive l'agente. */
  minInput: string;
  maxInput: string;
  reservedOnly: boolean;
  priority: PriorityFilter;
  /** Vuoto = tutti i siti. */
  portals: Portal[];
  /** Solo lead pubblicati su più portali. */
  multi: boolean;
  categories: PropertyCategory[];
  /** Codici ISTAT della zona e/o `OTHER_COMUNI`; vuoto = tutti i comuni. */
  comuni: string[];
  missingOnly: boolean;
  /** Solo i lead nuovi dell'ultimo giro (`isNewLead`). */
  newOnly: boolean;
}

export const EMPTY_FILTERS: LeadFilters = {
  text: '', minInput: '', maxInput: '', reservedOnly: false, priority: 'all', portals: [], multi: false, categories: [], comuni: [], missingOnly: false, newOnly: false,
};

/** Filtri del riquadro «Filtri», mostrati come etichette che si tolgono con un clic. */
export type TagKey = 'comuni' | 'portals' | 'multi' | 'categories' | 'price' | 'missingOnly' | 'newOnly';

export interface FilteredLeads {
  tabCounts: Record<Tab, number>;
  /** Richiami di oggi o scaduti (lead non scartati) fra quelli filtrati. */
  dueCount: number;
  priorityCounts: Record<PriorityFilter, number>;
  comuneCounts: Record<string, number>;
  portalCounts: Record<Portal, number>;
  multiCount: number;
  categoryCounts: Record<PropertyCategory, number>;
  missingCount: number;
  /** Nuovi dell'ultimo giro fra quelli della scheda. */
  newCount: number;
  /** In ordine di lista: prima tutti i nuovi, poi gli altri. */
  visible: LeadView[];
  /** Quanti dei primi `visible` sono il gruppo dei nuovi; 0 nella scheda "Richiami", che ha i suoi gruppi. */
  newHead: number;
  recallGroups: { kind: RecallKind; leads: LeadView[] }[];
  tags: { key: TagKey; label: string }[];
  priceInvalid: { min: boolean; max: boolean };
}

const byPriority = (leads: LeadView[], f: PriorityFilter) => (f === 'all' ? leads : leads.filter((l) => l.evaluation.priority === f));
/** Un lead unito passa se ha una fonte su uno dei siti scelti. */
const byPortals = (leads: LeadView[], ps: Portal[]) => (ps.length ? leads.filter((l) => leadPortals(l).some((p) => ps.includes(p))) : leads);
const byMulti = (leads: LeadView[], on: boolean) => (on ? leads.filter((l) => leadPortals(l).length > 1) : leads);
const isMissing = (l: LeadView) => l.missing != null || l.missingPortals.length > 0;
const countBy = <K extends string>(keys: readonly K[], count: (k: K) => number) => Object.fromEntries(keys.map((k) => [k, count(k)])) as Record<K, number>;

/** Prezzi scritti dall'agente come filtro: un valore non valido non filtra. */
export function queryOf(f: LeadFilters): LeadQuery {
  const min = parseThousands(f.minInput);
  const max = parseThousands(f.maxInput);
  return { text: f.text, minPrice: min === 'invalid' ? null : min, maxPrice: max === 'invalid' ? null : max, reservedOnly: f.reservedOnly };
}

/** `newSince`: inizio dell'ultimo giro, da cui un lead è nuovo; null senza giri. */
export function filterLeads(leads: LeadView[], f: LeadFilters, tab: Tab, zone: ComuneRef[], sortByTab: SortByTab, now: number, newSince: number | null): FilteredLeads {
  const query = queryOf(f);
  const isNew = (l: LeadView) => isNewLead(l, newSince);
  // Ricerca, prezzo, non più visti e solo nuovi agiscono prima delle schede, così anche i loro conteggi li seguono.
  const base = applyQuery(leads, query).filter((l) => (!f.missingOnly || isMissing(l)) && (!f.newOnly || isNew(l)));
  // Un comune tolto dalla zona esce dal filtro; senza zona il filtro per comune non c'è.
  const comuni = zone.length ? f.comuni.filter((c) => c === OTHER_COMUNI || zone.some((z) => z.istat === c)) : [];
  const byCategories = (list: LeadView[]) => (f.categories.length ? list.filter((l) => leadCategories(l).some((c) => f.categories.includes(c))) : list);
  const byComuni = (list: LeadView[]) => (comuni.length ? list.filter((l) => inComuni(l, zone, comuni)) : list);
  // Categorie e comuni si contano prima del proprio filtro: così se ne può scegliere più di uno.
  const beforeCategories = byComuni(base);
  const beforeComuni = byCategories(base);
  const applied = byCategories(beforeCategories);
  const inTab = (list: LeadView[], t: Tab) => (t === 'recall' ? list.filter((l) => l.state.recallAt != null) : groupByStatus(list)[t]);
  const tabLeads = inTab(applied, tab);
  const inPortals = byMulti(byPortals(tabLeads, f.portals), f.multi);
  const filtered = byPriority(inPortals, f.priority);
  const recallGroups = tab === 'recall' ? groupByRecall(filtered, now) : [];
  // Nella scheda "Richiami" l'ordine è quello dei gruppi; altrove prima i nuovi, poi gli altri, ognuno col criterio della scheda.
  const fresh = tab === 'recall' ? [] : filtered.filter(isNew);
  const visible = tab === 'recall'
    ? recallGroups.flatMap((g) => g.leads)
    : [...sortLeadsBy(fresh, sortByTab[tab]), ...sortLeadsBy(filtered.filter((l) => !isNew(l)), sortByTab[tab])];

  const comuneOptions = [...zone.map((z) => z.istat), OTHER_COMUNI];
  const forComuni = byPriority(byMulti(byPortals(inTab(beforeComuni, tab), f.portals), f.multi), f.priority);
  const forPortals = byPriority(byMulti(tabLeads, f.multi), f.priority);
  const forCategories = inTab(beforeCategories, tab);

  const minPrice = parseThousands(f.minInput);
  const maxPrice = parseThousands(f.maxInput);
  const comuneName = (c: string) => (c === OTHER_COMUNI ? 'altri comuni' : zone.find((z) => z.istat === c)?.name ?? c);
  const priceTag = describeQuery({ ...query, text: '' }).join(', ') || (minPrice === 'invalid' || maxPrice === 'invalid' ? 'prezzo non valido' : '');
  const tags: FilteredLeads['tags'] = [
    ...(comuni.length ? [{ key: 'comuni' as const, label: joinList(comuni.map(comuneName), 'e') }] : []),
    ...(f.portals.length ? [{ key: 'portals' as const, label: joinList(f.portals.map((p) => PORTAL_TAGS[p]), 'e') }] : []),
    ...(f.multi ? [{ key: 'multi' as const, label: 'Su più portali' }] : []),
    ...(f.categories.length ? [{ key: 'categories' as const, label: joinList(f.categories.map((c) => CATEGORY_LABELS[c]), 'e') }] : []),
    ...(priceTag ? [{ key: 'price' as const, label: priceTag }] : []),
    ...(f.missingOnly ? [{ key: 'missingOnly' as const, label: 'Non più visti' }] : []),
    ...(f.newOnly ? [{ key: 'newOnly' as const, label: 'Solo nuovi' }] : []),
  ];

  return {
    tabCounts: countBy(TABS, (t) => inTab(applied, t).length),
    dueCount: applied.filter((l) => l.state.status !== 'discarded' && isDue(l.state.recallAt, now)).length,
    priorityCounts: countBy(PRIORITY_FILTERS, (p) => byPriority(inPortals, p).length),
    comuneCounts: countBy(comuneOptions, (c) => forComuni.filter((l) => inComuni(l, zone, [c])).length),
    portalCounts: countBy(PORTALS, (p) => forPortals.filter((l) => leadPortals(l).includes(p)).length),
    multiCount: byPriority(byPortals(tabLeads, f.portals), f.priority).filter((l) => leadPortals(l).length > 1).length,
    categoryCounts: countBy(PROPERTY_CATEGORIES, (c) => forCategories.filter((l) => leadCategories(l).includes(c)).length),
    missingCount: tabLeads.filter(isMissing).length,
    newCount: filtered.filter(isNew).length,
    visible,
    newHead: fresh.length,
    recallGroups,
    tags,
    priceInvalid: { min: minPrice === 'invalid', max: maxPrice === 'invalid' },
  };
}

/** Toglie il filtro di un'etichetta. */
export function clearTag(f: LeadFilters, key: TagKey): LeadFilters {
  if (key === 'price') return { ...f, minInput: '', maxInput: '', reservedOnly: false };
  return { ...f, [key]: EMPTY_FILTERS[key] };
}

/** Aggiunge o toglie `x`; sceglierli tutti equivale a nessun filtro. */
export function toggleIn<T>(all: readonly T[], chosen: T[], x: T): T[] {
  const next = all.filter((y) => (y === x ? !chosen.includes(y) : chosen.includes(y)));
  return next.length === all.length ? [] : next;
}

/** Si apre su "Richiami" solo se c'è qualcosa da fare oggi; poi decide l'agente. */
export function initialTab(leads: LeadView[], now: number): Tab {
  return leads.some((l) => l.state.status !== 'discarded' && isDue(l.state.recallAt, now)) ? 'recall' : 'new';
}

export const PAGE_SIZE = 25;

/** Una pagina della lista, da 1; una pagina fuori intervallo torna nell'intervallo. `from`/`to` da 1 per «Lead 1–25 di N», 0 se vuota. */
export function pageOf<T>(items: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, Math.floor(page)), pages);
  const slice = items.slice((p - 1) * size, p * size);
  const from = slice.length ? (p - 1) * size + 1 : 0;
  return { items: slice, page: p, pages, from, to: slice.length ? from + slice.length - 1 : 0 };
}

/** Filtri diversi da quelli vuoti (ricerca e priorità comprese): serve per «Azzera filtri». */
export const anyFilter = (f: LeadFilters): boolean => JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);
