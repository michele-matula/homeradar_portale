import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeadsResponse, Me } from '@homeradar/shared/api/types';
import { isDue, nextRecallCheck } from '@homeradar/shared/core/recall';
import type { LeadState, LeadView } from '@homeradar/shared/shared/types';
import { api, errorText } from '../api';
import { Devices } from '../components/Devices';
import { Layout } from '../components/Layout';
import { LeadList } from '../components/LeadList';
import { Sweep } from '../components/Sweep';
import type { ConnectorPort } from '../connector';
import { EMPTY_FILTERS, filterLeads, initialTab, type LeadFilters, type Tab } from '../leads/filters';
import { loadFiltersOpen, loadSortByTab, saveFiltersOpen, saveSortByTab, type SortByTab } from '../prefs';
import { leadKeyOf, usePath } from '../router';

/** Pagina dei lead: giro delle ricerche, lista con filtri e (Task 4) scheda del lead aperta. */
export function Leads({ me, onSignOut, connector }: { me: Me; onSignOut(): void; connector?: ConnectorPort }) {
  const path = usePath();
  const selectedKey = leadKeyOf(path);
  /** null finché la prima lettura non arriva. */
  const [leads, setLeads] = useState<LeadView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS);
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const [sortByTab, setSortByTab] = useState<SortByTab>(loadSortByTab);
  const [filtersOpen, setFiltersOpen] = useState(loadFiltersOpen);
  const [now, setNow] = useState(Date.now);
  // Cresce a ogni collegamento del connettore: la lista dei computer si rilegge.
  const [linked, setLinked] = useState(0);
  const hasZone = me.comuni.length > 0;

  const reload = useCallback(async () => {
    try {
      const r = await api<LeadsResponse>('GET', '/api/leads');
      const t = Date.now();
      setLeads(r.leads);
      setNow(t);
      // Si apre su "Richiami" solo se c'è qualcosa da fare oggi; poi decide l'agente.
      setTab((cur) => cur ?? initialTab(r.leads, t));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    if (hasZone) void reload();
  }, [reload, hasZone]);

  // A mezzanotte di Roma i richiami di "oggi" cambiano: si ricalcola senza ricaricare.
  useEffect(() => {
    const h = setTimeout(() => setNow(Date.now()), Math.max(1_000, nextRecallCheck(now) - Date.now()));
    return () => clearTimeout(h);
  }, [now]);

  /** Stato salvato per il gruppo del lead con questa chiave principale: si aggiorna senza ricaricare la lista. */
  const replaceState = useCallback((mainKey: string, state: LeadState) => {
    setLeads((ls) => ls && ls.map((l) => (l.listing.key === mainKey ? { ...l, state: { ...state, listingKey: mainKey } } : l)));
  }, []);

  const tab: Tab = chosenTab ?? 'new';
  const result = useMemo(() => filterLeads(leads ?? [], filters, tab, me.comuni, sortByTab, now), [leads, filters, tab, me.comuni, sortByTab, now]);
  const dueRecalls = (leads ?? []).filter((l) => l.state.status !== 'discarded' && isDue(l.state.recallAt, now)).length;

  const setSort = (k: Parameters<typeof saveSortByTab>[0][keyof SortByTab]) => {
    if (tab === 'recall') return;
    const next = { ...sortByTab, [tab]: k };
    saveSortByTab(next);
    setSortByTab(next);
  };
  const toggleFilters = () => {
    saveFiltersOpen(!filtersOpen);
    setFiltersOpen(!filtersOpen);
  };

  return (
    <Layout me={me} onSignOut={onSignOut} dueRecalls={dueRecalls} wide>
      <Sweep userId={me.id} connector={connector} onLinked={() => setLinked((n) => n + 1)} />
      {!hasZone ? (
        <section className="card">
          <p>L'amministratore non ti ha ancora assegnato una zona: quando lo farà, qui troverai i lead dei tuoi comuni.</p>
        </section>
      ) : error && !leads ? (
        <section className="card">
          <p className="error" role="alert">{error}</p>
          <button type="button" className="btn" onClick={() => void reload()}>
            Riprova
          </button>
        </section>
      ) : leads === null ? (
        <p className="hint" aria-busy="true">Caricamento dei lead…</p>
      ) : (
        <div className={selectedKey ? 'workspace workspace--detail' : 'workspace'}>
          <LeadList
            result={result}
            filters={filters}
            setFilters={setFilters}
            tab={tab}
            setTab={setTab}
            sort={tab === 'recall' ? null : sortByTab[tab]}
            setSort={setSort}
            filtersOpen={filtersOpen}
            toggleFilters={toggleFilters}
            zone={me.comuni}
            selectedKey={selectedKey}
            now={now}
          />
        </div>
      )}
      {error && leads && <p className="error" role="alert">{error}</p>}
      <Devices reload={linked} />
    </Layout>
  );
}
