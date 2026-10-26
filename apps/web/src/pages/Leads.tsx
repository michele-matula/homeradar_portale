import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeadsResponse, LeadsVisit, Me } from '@homeradar/shared/api/types';
import { isNewLead } from '@homeradar/shared/core/lead-groups';
import { leadKeys } from '@homeradar/shared/core/leads';
import { isDue, nextRecallCheck } from '@homeradar/shared/core/recall';
import type { LeadState, LeadView, SweepStatus } from '@homeradar/shared/shared/types';
import { api, errorText } from '../api';
import { FilterPanel } from '../components/FilterPanel';
import { Layout } from '../components/Layout';
import { LeadDetail } from '../components/LeadDetail';
import { LeadList } from '../components/LeadList';
import { LeadModal } from '../components/LeadModal';
import { Sweep } from '../components/Sweep';
import type { ConnectorPort } from '../connector';
import { EMPTY_FILTERS, filterLeads, initialTab, pageOf, type LeadFilters, type Tab } from '../leads/filters';
import { loadFiltersOpen, loadSortByTab, saveFiltersOpen, saveSortByTab, type SortByTab } from '../prefs';
import { leadKeyOf, navigate, usePath } from '../router';

/** Sotto questa larghezza i filtri stanno dietro un bottone e la finestra del lead prende lo schermo (stessa soglia del CSS). */
const NARROW = '(max-width: 899px)';
const narrow = () => typeof matchMedia === 'function' && matchMedia(NARROW).matches;

/** Schermo stretto, aggiornato quando cambia la larghezza. */
function useNarrow(): boolean {
  const [value, setValue] = useState(narrow);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(NARROW);
    const update = () => setValue(m.matches);
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, []);
  return value;
}

/** Pagina dei lead: giro delle ricerche, lista con filtri e scheda del lead aperta (`/lead/<chiave>`). */
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
  /** Apertura della lista nella visita precedente: i lead comparsi da allora sono nuovi (`POST /api/leads/visit`). */
  const [visitSince, setVisitSince] = useState<number | null>(null);
  /** Senza visite precedenti: inizio del giro in corso, altrimenti dell'ultimo finito. */
  const [sweepSince, setSweepSince] = useState<number | null>(null);
  const newSince = visitSince ?? sweepSince;
  const [page, setPage] = useState(1);
  const isNarrow = useNarrow();
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

  // Apertura della lista e ritorno sulla pagina (scheda lasciata aperta dalla sera prima): il server decide se è una visita nuova.
  useEffect(() => {
    if (!hasZone) return;
    const visit = () => {
      if (document.visibilityState !== 'visible') return;
      api<LeadsVisit>('POST', '/api/leads/visit').then((v) => setVisitSince(v.newSince), () => {});
    };
    // Al ritorno anche i lead si rileggono: un giro automatico può averne portati di nuovi.
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      visit();
      void reload();
    };
    visit();
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [hasZone, reload]);

  // A mezzanotte di Roma i richiami di "oggi" cambiano: si ricalcola senza ricaricare.
  useEffect(() => {
    const h = setTimeout(() => setNow(Date.now()), Math.max(1_000, nextRecallCheck(now) - Date.now()));
    return () => clearTimeout(h);
  }, [now]);
  // Con il PC sospeso il timer non scatta: al ritorno sulla pagina «oggi», richiami e giro di oggi si ricalcolano.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);

  /** Stato salvato per il gruppo del lead con questa chiave principale: si aggiorna senza ricaricare la lista. */
  const replaceState = useCallback((mainKey: string, state: LeadState) => {
    setLeads((ls) => ls && ls.map((l) => (l.listing.key === mainKey ? { ...l, state: { ...state, listingKey: mainKey } } : l)));
  }, []);

  const tab: Tab = chosenTab ?? 'new';
  // Altri filtri, un'altra scheda o un altro ordine: si riparte dalla prima pagina.
  useEffect(() => setPage(1), [filters, tab, sortByTab]);
  const result = useMemo(() => filterLeads(leads ?? [], filters, tab, me.comuni, sortByTab, now, newSince), [leads, filters, tab, me.comuni, sortByTab, now, newSince]);
  // Anche la chiave di una fonte secondaria apre il suo lead.
  const selected = selectedKey ? (leads ?? []).find((l) => leadKeys(l).includes(selectedKey)) ?? null : null;
  // «Lead 3 di 25 · pagina 1»: solo se il lead aperto è nella pagina mostrata.
  const shown = pageOf(result.visible, page);
  const index = selected ? shown.items.indexOf(selected) : -1;
  const position = index >= 0 ? `Lead ${index + 1} di ${shown.items.length} · pagina ${shown.page}` : null;
  const dueRecalls =(leads ?? []).filter((l) => l.state.status !== 'discarded' && isDue(l.state.recallAt, now)).length;

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
      <div className="leadspage">
      <aside className="leadspage__side" aria-label="Giro e filtri">
        <Sweep
          userId={me.id}
          connector={connector}
          hasZone={hasZone}
          onFinished={reload}
          onStatus={(s: SweepStatus) => setSweepSince(s.running?.startedAt ?? s.last?.startedAt ?? null)}
          onShowNew={() => {
            setFilters({ ...EMPTY_FILTERS, newOnly: true });
            setTab('new');
            navigate('/');
          }}
        />
        {hasZone && leads && (
          <>
            {isNarrow && (
              <button
                type="button"
                className={`btn filterbar__toggle${result.tags.length ? ' filterbar__toggle--on' : ''}`}
                aria-expanded={filtersOpen}
                aria-controls="filters-panel"
                onClick={toggleFilters}
              >
                {result.tags.length ? `Filtri (${result.tags.length})` : 'Filtri'} {filtersOpen ? '▴' : '▾'}
              </button>
            )}
            {(!isNarrow || filtersOpen) && <FilterPanel result={result} filters={filters} setFilters={setFilters} zone={me.comuni} />}
          </>
        )}
      </aside>
      <div className="leadspage__main">
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
        <>
          <LeadList
            result={result}
            filters={filters}
            setFilters={setFilters}
            tab={tab}
            setTab={setTab}
            sort={tab === 'recall' ? null : sortByTab[tab]}
            setSort={setSort}
            page={page}
            setPage={setPage}
            selectedKey={selectedKey}
            isNew={(l) => isNewLead(l, newSince)}
            now={now}
          />
          {/* La lista resta montata sotto la finestra: chiudendola filtri, pagina e posizione sono quelli di prima. */}
          {selectedKey && (
            <LeadModal onClose={() => navigate('/')} position={position}>
              {selected ? (
                <LeadDetail key={selected.listing.key} lead={selected} now={now} isNew={isNewLead(selected, newSince)} onSaved={(s) => replaceState(selected.listing.key, s)} onSplit={reload} />
              ) : (
                <section className="detail detail--empty">
                  <p>Questo lead non è nella tua lista</p>
                  <p className="hint">Può essere stato separato, o non è più visto da molto tempo.</p>
                  <button type="button" className="btn" onClick={() => navigate('/')}>
                    Torna ai lead
                  </button>
                </section>
              )}
            </LeadModal>
          )}
        </>
      )}
      {error && leads && <p className="error" role="alert">{error}</p>}
      </div>
      </div>
    </Layout>
  );
}
