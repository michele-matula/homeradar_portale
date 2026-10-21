import { searchComuni, toRef, type ComuneInfo } from '@homeradar/shared/core/comuni';
import type { ComuneRef } from '@homeradar/shared/shared/types';
import { useId, useState } from 'react';

/** Comuni assegnati a un agente, con un limite. Controllato: chi lo usa decide quando salvare. */
export function ComunePicker({ value, max, onChange }: { value: ComuneRef[]; max: number; onChange(next: ComuneRef[]): void }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const chosen = new Set(value.map((c) => c.istat));
  const full = value.length >= max;
  const suggestions = full ? [] : searchComuni(query).filter((c) => !chosen.has(c.istat));

  const add = (c: ComuneInfo) => {
    onChange([...value, toRef(c)]);
    setQuery('');
  };

  return (
    <div className="picker">
      {value.length > 0 && (
        <ul className="chips">
          {value.map((c) => (
            <li key={c.istat} className="chip">
              {c.name} ({c.province})
              <button type="button" aria-label={`Togli ${c.name}`} onClick={() => onChange(value.filter((x) => x.istat !== c.istat))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        type="search"
        aria-label="Cerca un comune"
        placeholder={full ? '' : 'Cerca un comune'}
        autoComplete="off"
        disabled={full}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {full && <p className="hint">Al massimo {max} comuni</p>}
      {suggestions.length > 0 && (
        <ul className="picker__list">
          {suggestions.map((c) => (
            <li key={c.istat}>
              <button type="button" className="picker__option" onClick={() => add(c)}>
                {c.name} ({c.province.sigla})
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
