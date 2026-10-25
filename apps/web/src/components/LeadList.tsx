import { useRef, type ReactNode } from 'react';
import { RECALL_GROUP_LABELS, SORT_KEYS, SORT_LABELS, type SortKey } from '@homeradar/shared/core/leads';
import type { RecallKind } from '@homeradar/shared/core/recall';
import type { LeadView } from '@homeradar/shared/shared/types';
import { anyFilter, clearTag, EMPTY_FILTERS, pageOf, PRIORITY_FILTER_LABELS, TAB_LABELS, TABS, type FilteredLeads, type LeadFilters, type Tab } from '../leads/filters';
import { ExportBar } from './ExportBar';
import { LeadRow } from './LeadRow';
import { Pager } from './Pager';

type GroupKey = RecallKind | 'new' | 'other';

/**
 * Righe della pagina con i titoli dei gruppi presenti: nuovi e altri nelle schede di stato, scadenze nella scheda
 * "Richiami". `offset`: posizione in `visible` della prima riga della pagina.
 */
function pageRows(result: FilteredLeads, tab: Tab, items: LeadView[], offset: number, render: (l: LeadView, inNewGroup: boolean) => ReactNode): ReactNode[] {
  const kindOf = new Map(result.recallGroups.flatMap((g) => g.leads.map((l) => [l.listing.key, g.kind] as const)));
  const out: ReactNode[] = [];
  let group: GroupKey | null = null;
  items.forEach((l, i) => {
    const inNewGroup = offset + i < result.newHead;
    const next: GroupKey | null = tab === 'recall' ? kindOf.get(l.listing.key) ?? null : result.newHead > 0 ? (inNewGroup ? 'new' : 'other') : null;
    if (next && next !== group) {
      const title = next === 'new' ? `Nuovi dall'ultimo giro · ${result.newHead}`
        : next === 'other' ? `Altri lead · ${result.visible.length - result.newHead}`
        : RECALL_GROUP_LABELS[next];
      out.push(<li key={`group-${next}`} className={`leads__group leads__group--${next}`}><h3>{title}</h3></li>);
    }
    group = next;
    out.push(render(l, inNewGroup));
  });
  return out;
}

/** Colonna centrale: schede di stato, ricerca, filtri attivi, ordinamento, schede dei lead a pagine. */
export function LeadList({ result, filters, setFilters, tab, setTab, sort, setSort, page, setPage, selectedKey, isNew, now }: {
  result: FilteredLeads;
  filters: LeadFilters;
  setFilters(f: LeadFilters): void;
  tab: Tab;
  setTab(t: Tab): void;
  sort: SortKey | null;
  setSort(k: SortKey): void;
  page: number;
  setPage(p: number): void;
  selectedKey: string | null;
  /** Nuovo dell'ultimo giro: nella scheda "Richiami" non c'è il gruppo, ma il segno sì. */
  isNew(l: LeadView): boolean;
  now: number;
}) {
  const set = (patch: Partial<LeadFilters>) => setFilters({ ...filters, ...patch });
  const { visible, tags } = result;
  const top = useRef<HTMLDivElement>(null);
  const shown = pageOf(visible, page);
  const emptyTag = [
    ...(filters.priority === 'all' ? [] : [PRIORITY_FILTER_LABELS[filters.priority]]),
    ...tags.map((t) => t.label),
    ...(filters.text.trim() ? [`"${filters.text.trim()}"`] : []),
  ];
  const goTo = (p: number) => {
    setPage(p);
    top.current?.scrollIntoView?.({ block: 'start' });
  };

  return (
    <div className="leadlist" ref={top}>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => {
          const due = t === 'recall' && result.dueCount > 0;
          const count = due ? result.dueCount : result.tabCounts[t];
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              aria-label={`${TAB_LABELS[t]} (${due ? `${count} da fare` : count})`}
              className={t === tab ? 'tab tab--on' : 'tab'}
              onClick={() => setTab(t)}
            >
              <span className="tab__label">{TAB_LABELS[t]}</span>
              <span className={due ? 'tab__count tab__count--due' : 'tab__count'}>{count}</span>
            </button>
          );
        })}
      </nav>
      <div className="search">
        <input
          type="search"
          className="field search__input"
          aria-label="Cerca nei lead"
          placeholder="Cerca titolo, indirizzo, zona…"
          value={filters.text}
          onChange={(e) => set({ text: e.target.value })}
        />
      </div>
      {anyFilter(filters) && (
        <div className="filterbar">
          {tags.map((t) => (
            <button key={t.key} type="button" className="filter-tag" aria-label={`Togli il filtro ${t.label}`} title="Togli il filtro" onClick={() => setFilters(clearTag(filters, t.key))}>
              {t.label} ✕
            </button>
          ))}
          <button type="button" className="btn btn--small filterbar__reset" onClick={() => setFilters(EMPTY_FILTERS)}>
            Azzera filtri
          </button>
        </div>
      )}
      <div className="leadlist__bar">
        <h2 className="leadlist__count">{`${visible.length} lead`}</h2>
        {sort && (
          <label className="sort">
            <span className="sort__label">Ordina per</span>
            <select className="field field--select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORT_KEYS.map((k) => (
                <option key={k} value={k}>{SORT_LABELS[k]}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {visible.length === 0 ? (
        <div className="empty">
          <p>
            {emptyTag.length
              ? `Nessun lead «${emptyTag.join(', ')}» in questa scheda.`
              : tab === 'recall'
                ? 'Nessun richiamo. Apri un lead e scegli «Richiama…» per fissare la data di ricontatto.'
                : 'Nessun lead in questa scheda. Premi «Cerca» dal computer per raccoglierne.'}
          </p>
        </div>
      ) : (
        <>
          <ul className="leads">
            {pageRows(result, tab, shown.items, shown.from - 1, (l, inNewGroup) => (
              <LeadRow key={l.listing.key} lead={l} now={now} selected={l.listing.key === selectedKey} isNew={inNewGroup || isNew(l)} />
            ))}
          </ul>
          <p className="leadlist__range">{`Lead ${shown.from}–${shown.to} di ${visible.length}`}</p>
          <Pager page={shown.page} pages={shown.pages} onPage={goTo} />
        </>
      )}
      <ExportBar leads={visible} />
    </div>
  );
}
