import type { ReactNode } from 'react';
import { OTHER_COMUNI } from '@homeradar/shared/core/lead-filters';
import { CATEGORY_LABELS, PORTAL_TAGS, PORTALS, PROPERTY_CATEGORIES, type ComuneRef } from '@homeradar/shared/shared/types';
import { PRIORITY_FILTER_LABELS, PRIORITY_FILTERS, toggleIn, type FilteredLeads, type LeadFilters } from '../leads/filters';

/** Riga di un filtro con il suo conteggio a destra; spenta se non c'è niente da trovare. */
function Option({ label, count, on, onClick }: { label: string; count?: number; on: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={count == null ? label : `${label} (${count})`}
      className={`opt${on ? ' opt--on' : ''}`}
      disabled={count === 0 && !on}
      onClick={onClick}
    >
      <span className="opt__label">{label}</span>
      {count != null && <span className="opt__count">{count}</span>}
    </button>
  );
}

function Group({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  return (
    <section className="fgroup">
      <h3 className="fgroup__title">{title}</h3>
      <div className="fgroup__options" role="group" aria-label={label}>
        {children}
      </div>
    </section>
  );
}

/** Filtri della colonna di sinistra, sempre aperti su schermo largo. Nessun filtro scelto in un gruppo = tutti. */
export function FilterPanel({ result, filters, setFilters, zone }: {
  result: FilteredLeads;
  filters: LeadFilters;
  setFilters(f: LeadFilters): void;
  zone: ComuneRef[];
}) {
  const set = (patch: Partial<LeadFilters>) => setFilters({ ...filters, ...patch });
  const comuneOptions = [...zone.map((z) => z.istat), OTHER_COMUNI];
  const comuneName = (c: string) => (c === OTHER_COMUNI ? 'Altri comuni' : zone.find((z) => z.istat === c)?.name ?? c);

  return (
    <div className="fpanel" id="filters-panel">
      <section className="fgroup">
        <h3 className="fgroup__title">Priorità</h3>
        <div className="fgroup__options" role="radiogroup" aria-label="Filtra per priorità">
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
                className={`opt opt--radio opt--${p}${on ? ' opt--on' : ''}`}
                disabled={count === 0 && !on}
                onClick={() => set({ priority: p })}
              >
                <span className="opt__label">{PRIORITY_FILTER_LABELS[p]}</span>
                <span className="opt__count">{count}</span>
              </button>
            );
          })}
        </div>
      </section>
      {zone.length > 0 && (
        <Group title="Comune" label="Filtra per comune">
          {comuneOptions.map((c) => (
            <Option key={c} label={comuneName(c)} count={result.comuneCounts[c]} on={filters.comuni.includes(c)} onClick={() => set({ comuni: toggleIn(comuneOptions, filters.comuni, c) })} />
          ))}
        </Group>
      )}
      <section className="fgroup">
        <h3 className="fgroup__title">Prezzo</h3>
        <div className="price">
          <input
            className="field price__input"
            inputMode="decimal"
            placeholder="da"
            aria-label="Prezzo minimo in migliaia di euro"
            aria-invalid={result.priceInvalid.min}
            value={filters.minInput}
            onChange={(e) => set({ minInput: e.target.value, reservedOnly: false })}
          />
          <input
            className="field price__input"
            inputMode="decimal"
            placeholder="a"
            aria-label="Prezzo massimo in migliaia di euro"
            aria-invalid={result.priceInvalid.max}
            value={filters.maxInput}
            onChange={(e) => set({ maxInput: e.target.value, reservedOnly: false })}
          />
          <span className="price__label">k€</span>
        </div>
        <Option
          label="Solo trattativa riservata"
          on={filters.reservedOnly}
          onClick={() => set(filters.reservedOnly ? { reservedOnly: false } : { reservedOnly: true, minInput: '', maxInput: '' })}
        />
      </section>
      <Group title="Categoria" label="Filtra per categoria">
        {PROPERTY_CATEGORIES.map((c) => (
          <Option
            key={c}
            label={CATEGORY_LABELS[c]}
            count={result.categoryCounts[c]}
            on={filters.categories.includes(c)}
            onClick={() => set({ categories: toggleIn(PROPERTY_CATEGORIES, filters.categories, c) })}
          />
        ))}
      </Group>
      <Group title="Sito" label="Filtra per sito">
        {PORTALS.map((p) => (
          <Option key={p} label={PORTAL_TAGS[p]} count={result.portalCounts[p]} on={filters.portals.includes(p)} onClick={() => set({ portals: toggleIn(PORTALS, filters.portals, p) })} />
        ))}
        <Option label="Su più portali" count={result.multiCount} on={filters.multi} onClick={() => set({ multi: !filters.multi })} />
      </Group>
      <Group title="Altro" label="Altri filtri">
        <Option label="Solo nuovi" count={result.newCount} on={filters.newOnly} onClick={() => set({ newOnly: !filters.newOnly })} />
        <Option label="Non più visti" count={result.missingCount} on={filters.missingOnly} onClick={() => set({ missingOnly: !filters.missingOnly })} />
      </Group>
    </div>
  );
}
