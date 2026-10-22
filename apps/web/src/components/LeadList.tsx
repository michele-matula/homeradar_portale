import { Fragment, type ReactNode } from 'react';
import { OTHER_COMUNI } from '@homeradar/shared/core/lead-filters';
import { RECALL_GROUP_LABELS, SORT_KEYS, SORT_LABELS, type SortKey } from '@homeradar/shared/core/leads';
import { CATEGORY_LABELS, PORTAL_TAGS, PORTALS, PROPERTY_CATEGORIES, type ComuneRef } from '@homeradar/shared/shared/types';
import {
  anyFilter, clearTag, EMPTY_FILTERS, PRIORITY_FILTER_LABELS, PRIORITY_FILTERS, TAB_LABELS, TABS, toggleIn,
  type FilteredLeads, type LeadFilters, type Tab,
} from '../leads/filters';
import { ExportBar } from './ExportBar';
import { LeadRow } from './LeadRow';


/** Bottone a pillola di un filtro con il suo conteggio; spento se non c'è niente da trovare. */
function Chip({ label, count, on, onClick, className = '' }: { label: string; count?: number; on: boolean; onClick(): void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={count == null ? label : `${label} (${count})`}
      className={`chip${className}${on ? ' chip--on' : ''}`}
      disabled={count === 0 && !on}
      onClick={onClick}
    >
      {label} {count != null && <span className="chip__count">{count}</span>}
    </button>
  );
}

function Section({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  return (
    <section className="drawer__section">
      <h4 className="drawer__title">{title}</h4>
      <div className="filters" role="group" aria-label={label}>
        {children}
      </div>
    </section>
  );
}

/** Schede, ricerca, filtri, ordinamento e righe della lista. */
export function LeadList({ result, filters, setFilters, tab, setTab, sort, setSort, filtersOpen, toggleFilters, zone, selectedKey, now }: {
  result: FilteredLeads;
  filters: LeadFilters;
  setFilters(f: LeadFilters): void;
  tab: Tab;
  setTab(t: Tab): void;
  sort: SortKey | null;
  setSort(k: SortKey): void;
  filtersOpen: boolean;
  toggleFilters(): void;
  zone: ComuneRef[];
  selectedKey: string | null;
  now: number;
}) {
  const set = (patch: Partial<LeadFilters>) => setFilters({ ...filters, ...patch });
  const { visible, tags } = result;
  const comuneName = (c: string) => (c === OTHER_COMUNI ? 'Altri comuni' : zone.find((z) => z.istat === c)?.name ?? c);
  const emptyTag = [
    ...(filters.priority === 'all' ? [] : [PRIORITY_FILTER_LABELS[filters.priority]]),
    ...tags.map((t) => t.label),
    ...(filters.text.trim() ? [`"${filters.text.trim()}"`] : []),
  ];

  return (
    <div className="leadlist">
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
              <span className={due ? 'tab__count tab__count--due' : 'tab__count'}>{count}</span>
              <span className="tab__label">{TAB_LABELS[t]}</span>
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
      <div className="filters" role="radiogroup" aria-label="Filtra per priorità">
        {PRIORITY_FILTERS.map((p) => {
          const count = result.priorityCounts[p];
          const on = p === filters.priority;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${PRIORITY_FILTER_LABELS[p]} (${count})`}
              className={`chip chip--${p}${on ? ' chip--on' : ''}`}
              disabled={count === 0 && !on}
              onClick={() => set({ priority: p })}
            >
              {PRIORITY_FILTER_LABELS[p]} <span className="chip__count">{count}</span>
            </button>
          );
        })}
      </div>
      <div className="filterbar">
        <button
          type="button"
          className={`btn btn--small filterbar__toggle${tags.length ? ' filterbar__toggle--on' : ''}`}
          aria-expanded={filtersOpen}
          aria-controls="filters-drawer"
          onClick={toggleFilters}
        >
          {tags.length ? `Filtri (${tags.length})` : 'Filtri'} {filtersOpen ? '▴' : '▾'}
        </button>
        {!filtersOpen && tags.map((t) => (
          <button key={t.key} type="button" className="filter-tag" aria-label={`Togli il filtro ${t.label}`} title="Togli il filtro" onClick={() => setFilters(clearTag(filters, t.key))}>
            {t.label} ✕
          </button>
        ))}
        {anyFilter(filters) && (
          <button type="button" className="btn btn--small filterbar__reset" onClick={() => setFilters(EMPTY_FILTERS)}>
            Azzera filtri
          </button>
        )}
      </div>
      {filtersOpen && (
        <div className="drawer" id="filters-drawer">
          {zone.length > 0 && (
            <Section title="Comune" label="Filtra per comune">
              <Chip label="Tutti i comuni" on={filters.comuni.length === 0} onClick={() => set({ comuni: [] })} />
              {[...zone.map((z) => z.istat), OTHER_COMUNI].map((c) => (
                <Chip
                  key={c}
                  label={comuneName(c)}
                  count={result.comuneCounts[c]}
                  on={filters.comuni.includes(c)}
                  onClick={() => set({ comuni: toggleIn([...zone.map((z) => z.istat), OTHER_COMUNI], filters.comuni, c) })}
                />
              ))}
            </Section>
          )}
          <Section title="Sito" label="Filtra per sito">
            <Chip label="Tutti i siti" on={filters.portals.length === 0} onClick={() => set({ portals: [] })} />
            {PORTALS.map((p) => (
              <Chip key={p} label={PORTAL_TAGS[p]} count={result.portalCounts[p]} on={filters.portals.includes(p)} onClick={() => set({ portals: toggleIn(PORTALS, filters.portals, p) })} />
            ))}
            <Chip label="Su più portali" count={result.multiCount} on={filters.multi} onClick={() => set({ multi: !filters.multi })} />
          </Section>
          <Section title="Categoria" label="Filtra per categoria">
            {PROPERTY_CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={CATEGORY_LABELS[c]}
                count={result.categoryCounts[c]}
                on={filters.categories.includes(c)}
                onClick={() => set({ categories: toggleIn(PROPERTY_CATEGORIES, filters.categories, c) })}
              />
            ))}
          </Section>
          <section className="drawer__section">
            <h4 className="drawer__title">Prezzo</h4>
            <div className="price">
              <span className="price__label">da</span>
              <input
                className="field price__input"
                inputMode="decimal"
                aria-label="Prezzo minimo in migliaia di euro"
                aria-invalid={result.priceInvalid.min}
                value={filters.minInput}
                onChange={(e) => set({ minInput: e.target.value, reservedOnly: false })}
              />
              <span className="price__label">a</span>
              <input
                className="field price__input"
                inputMode="decimal"
                aria-label="Prezzo massimo in migliaia di euro"
                aria-invalid={result.priceInvalid.max}
                value={filters.maxInput}
                onChange={(e) => set({ maxInput: e.target.value, reservedOnly: false })}
              />
              <span className="price__label">k€</span>
              <button
                type="button"
                className="btn btn--small"
                aria-pressed={filters.reservedOnly}
                onClick={() => set(filters.reservedOnly ? { reservedOnly: false } : { reservedOnly: true, minInput: '', maxInput: '' })}
              >
                Solo trattativa riservata
              </button>
            </div>
          </section>
          <Section title="Altro" label="Altri filtri">
            <Chip label="Non più visti" count={result.missingCount} on={filters.missingOnly} onClick={() => set({ missingOnly: !filters.missingOnly })} />
            {filters.since != null && <Chip label="Da questo giro ✕" on onClick={() => set({ since: null })} />}
          </Section>
        </div>
      )}
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
          <p className="leadlist__count">{`${visible.length} lead`}</p>
          <ul className="leads">
            {(tab === 'recall' ? result.recallGroups : [{ kind: null, leads: visible }]).map((g) => (
              <Fragment key={g.kind ?? 'all'}>
                {g.kind && <li className="leads__group"><h3>{RECALL_GROUP_LABELS[g.kind]}</h3></li>}
                {g.leads.map((l) => (
                  <LeadRow key={l.listing.key} lead={l} now={now} selected={l.listing.key === selectedKey} />
                ))}
              </Fragment>
            ))}
          </ul>
        </>
      )}
      <ExportBar leads={visible} />
    </div>
  );
}
