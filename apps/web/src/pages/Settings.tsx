import { useEffect, useState, type ReactNode } from 'react';
import type { AgentSettings, Me } from '@homeradar/shared/api/types';
import { UNCERTAINTY_DAYS } from '@homeradar/shared/core/rules';
import { CATEGORY_LABELS, PORTAL_SITES, PORTALS, PROPERTY_CATEGORIES, type Portal, type PropertyCategory } from '@homeradar/shared/shared/types';
import { api, errorText } from '../api';
import { Devices } from '../components/Devices';
import { InfoTip } from '../components/InfoTip';
import { Layout } from '../components/Layout';

const AGE_HELP: ReactNode = (
  <>
    Un annuncio di privato diventa lead quando è online da almeno questi giorni: chi vende da tempo è più disposto a valutare un'agenzia. Se
    l'età è stimata ed è a meno di {UNCERTAINTY_DAYS} giorni dalla soglia, l'annuncio è segnato «Da verificare». Alzala per avere meno lead ma
    più maturi, abbassala per averne di più.
  </>
);
const DROP_HELP =
  'Un annuncio diventa lead anche quando il prezzo è sceso almeno di questa percentuale rispetto al prezzo più alto visto. Con 0 conta ' +
  'qualsiasi ribasso. I ribassi emergono confrontando i prezzi dei giri nel tempo (su Immobiliare e Idealista anche dal ribasso indicato ' +
  'dal portale): più spesso fai il giro, più ne trovi.';

/** Campi di `draft` diversi da `saved`: si manda solo quello che l'agente ha cambiato. */
function changes(saved: AgentSettings, draft: AgentSettings): Partial<AgentSettings> {
  const out: Partial<AgentSettings> = {};
  if (draft.minAgeDays !== saved.minAgeDays) out.minAgeDays = draft.minAgeDays;
  if (draft.minDropPercent !== saved.minDropPercent) out.minDropPercent = draft.minDropPercent;
  const cats = PROPERTY_CATEGORIES.filter((c) => draft.categories.includes(c));
  if (cats.join() !== PROPERTY_CATEGORIES.filter((c) => saved.categories.includes(c)).join()) out.categories = cats;
  const portals = PORTALS.filter((p) => draft.enabledPortals[p] !== saved.enabledPortals[p]);
  if (portals.length) out.enabledPortals = Object.fromEntries(portals.map((p) => [p, draft.enabledPortals[p]])) as Record<Portal, boolean>;
  return out;
}

/** Impostazioni dell'agente: quando un annuncio è un lead, cosa cerca il giro, zona e computer collegati. */
export function Settings({ me, onSignOut }: { me: Me; onSignOut(): void }) {
  const [saved, setSaved] = useState<AgentSettings | null>(null);
  const [draft, setDraft] = useState<AgentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<AgentSettings>('GET', '/api/settings').then(
      (s) => {
        setSaved(s);
        setDraft(s);
      },
      (e: unknown) => setError(errorText(e)),
    );
  }, []);

  const diff = saved && draft ? changes(saved, draft) : {};
  const dirty = Object.keys(diff).length > 0;
  const edit = (patch: Partial<AgentSettings>) => {
    setDraft((d) => d && { ...d, ...patch });
    setNotice(null);
  };
  const toggleCategory = (c: PropertyCategory) =>
    draft && edit({ categories: draft.categories.includes(c) ? draft.categories.filter((x) => x !== c) : [...draft.categories, c] });

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const s = await api<AgentSettings>('PUT', '/api/settings', diff);
      setSaved(s);
      setDraft(s);
      setNotice('Impostazioni salvate');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout me={me} onSignOut={onSignOut}>
      <h1>Impostazioni</h1>
      {draft && (
        <form
          className="settings"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <section className="card">
            <h2>Quando un annuncio è un lead</h2>
            <div className="settings__row">
              <label className="settings__field">
                <span>Online da almeno (giorni)</span>
                <input type="number" min={1} max={3650} step={1} value={draft.minAgeDays} onChange={(e) => edit({ minAgeDays: e.target.valueAsNumber })} />
              </label>
              <InfoTip label="Online da almeno">{AGE_HELP}</InfoTip>
            </div>
            <div className="settings__row">
              <label className="settings__field">
                <span>Ribasso di almeno (%)</span>
                <input type="number" min={0} max={100} step="any" value={draft.minDropPercent} onChange={(e) => edit({ minDropPercent: e.target.valueAsNumber })} />
              </label>
              <InfoTip label="Ribasso di almeno">{DROP_HELP}</InfoTip>
            </div>
          </section>
          <section className="card">
            <h2>Cosa cercare</h2>
            <fieldset className="settings__group">
              <legend>Categorie</legend>
              {PROPERTY_CATEGORIES.map((c) => (
                <label key={c} className="check">
                  <input type="checkbox" checked={draft.categories.includes(c)} onChange={() => toggleCategory(c)} />
                  {CATEGORY_LABELS[c]}
                </label>
              ))}
            </fieldset>
            <fieldset className="settings__group">
              <legend>Portali del giro</legend>
              {PORTALS.map((p) => (
                <label key={p} className="check">
                  <input
                    type="checkbox"
                    checked={draft.enabledPortals[p]}
                    onChange={() => edit({ enabledPortals: { ...draft.enabledPortals, [p]: !draft.enabledPortals[p] } })}
                  />
                  {PORTAL_SITES[p]}
                </label>
              ))}
            </fieldset>
            <p className="hint">Ogni categoria scelta aggiunge una ricerca per comune al giro: più categorie, giro più lungo.</p>
          </section>
          <div className="settings__actions">
            <button type="submit" className="btn btn--primary" disabled={!dirty || busy}>
              Salva
            </button>
            {notice && <span className="notice">{notice}</span>}
          </div>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <section className="card">
        <h2>La tua zona</h2>
        {me.comuni.length ? (
          <ul className="chips">
            {me.comuni.map((c) => (
              <li key={c.istat} className="chip">
                {c.name} ({c.province})
              </li>
            ))}
          </ul>
        ) : (
          <p>Nessun comune assegnato.</p>
        )}
        <p className="hint">La zona la imposta l'amministratore: scrivigli per cambiarla.</p>
      </section>
      <Devices />
    </Layout>
  );
}
