import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LeadsResponse, Me } from '@homeradar/shared/api/types';
import { leadKeys } from '@homeradar/shared/core/leads';
import { isDue, nextRecallCheck } from '@homeradar/shared/core/recall';
import type { LeadState, LeadView } from '@homeradar/shared/shared/types';
import { api, errorText } from '../api';
import { Devices } from '../components/Devices';
import { Layout } from '../components/Layout';
import { LeadDetail } from '../components/LeadDetail';
import { LeadList } from '../components/LeadList';
import { Sweep } from '../components/Sweep';
import type { ConnectorPort } from '../connector';
import { EMPTY_FILTERS, filterLeads, initialTab, type LeadFilters, type Tab } from '../leads/filters';
import { loadFiltersOpen, loadSortByTab, saveFiltersOpen, saveSortByTab, type SortByTab } from '../prefs';
import { leadKeyOf, navigate, usePath } from '../router';

/** Sotto questa larghezza la scheda prende tutta la pagina (stessa soglia del CSS). */
const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches;

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
  // Cresce a ogni collegamento del connettore: la lista dei computer si rilegge.
  const [linked, setLinked] = useState(0);
  const hasZone = me.comuni.length > 0;
  const listScroll = useRef(0);
  const wasOpen = useRef(selectedKey != null);

  // Aprendo una scheda sul telefono si parte dall'alto; chiudendola si torna dov'era la lista.
  useLayoutEffect(() => {
    const open = selectedKey != null;
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (!open) window.scrollTo(0, listScroll.current);
    else if (narrow()) window.scrollTo(0, 0);
  }, [selectedKey]);

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
  // Anche la chiave di una fonte secondaria apre il suo lead.
  const selected = selectedKey ? (leads ?? []).find((l) => leadKeys(l).includes(selectedKey)) ?? null : null;
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
      <Sweep
        userId={me.id}
        connector={connector}
        hasZone={hasZone}
        onLinked={() => setLinked((n) => n + 1)}
        onFinished={reload}
        onShowNew={(since) => {
          setFilters({ ...EMPTY_FILTERS, since });
          setTab('new');
          navigate('/');
        }}
      />
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
          {/* Sul telefono la lista sparisce mentre la scheda è aperta: si ricorda dove era per tornarci. */}
          <div className="workspace__list" onClickCapture={() => {
            if (!selectedKey) listScroll.current = window.scrollY;
          }}>
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
          <div className="workspace__detail">
            {selected ? (
              <LeadDetail key={selected.listing.key} lead={selected} now={now} onSaved={(s) => replaceState(selected.listing.key, s)} onSplit={reload} onClose={() => navigate('/')} />
            ) : selectedKey ? (
              <section className="detail detail--empty">
                <p>Questo lead non è nella tua lista</p>
                <p className="hint">Può essere stato separato, o non è più visto da molto tempo.</p>
                <button type="button" className="btn" onClick={() => navigate('/')}>
                  Torna ai lead
                </button>
              </section>
            ) : (
              <section className="detail detail--empty">
                <p className="hint">Scegli un lead dalla lista</p>
              </section>
            )}
          </div>
        </div>
      )}
      {error && leads && <p className="error" role="alert">{error}</p>}
      <Devices reload={linked} />
    </Layout>
  );
}
