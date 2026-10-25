import { useEffect, useRef, useState } from 'react';
import type { LeadPatch } from '@homeradar/shared/core/lead-state';
import { leadKeys, leadPortals, priorityLabel, STATUS_LABELS } from '@homeradar/shared/core/leads';
import { aboveMarketText, isAboveMarket, marketExplanation } from '@homeradar/shared/core/market';
import { addDays, formatRecallDate, fromDateInput, RECALL_SHORTCUTS, recallLabel, recallStatus, startOfLocalDay, toDateInput } from '@homeradar/shared/core/recall';
import { formatDate, formatDayMonth, formatEuro, formatPercent } from '@homeradar/shared/shared/format';
import { LEAD_STATUSES, PORTAL_TAGS, type LeadState, type LeadStatus, type LeadView } from '@homeradar/shared/shared/types';
import { api, errorText } from '../api';
import { Cover } from './Cover';
import { dropOf, priceText } from './LeadRow';
import { Sparkline } from './Sparkline';

type NoteState = 'idle' | 'saving' | 'saved';

/**
 * Scheda del lead: storico, altre fonti, mercato e il lavoro dell'agente (stato, richiamo, nota).
 * Stato, richiamo e nota valgono per tutto il gruppo; il server restituisce lo stato salvato.
 */
export function LeadDetail({ lead, now, isNew, onSaved, onSplit }: {
  lead: LeadView;
  now: number;
  /** Nuovo dell'ultimo giro: la foto ha la scritta «NUOVO». */
  isNew: boolean;
  onSaved(state: LeadState): void;
  /** Una fonte separata: i gruppi cambiano, la lista si ricarica. */
  onSplit(): Promise<void>;
}) {
  const { listing, evaluation, state, market, others } = lead;
  const portals = leadPortals(lead);
  const keys = leadKeys(lead);
  const [notes, setNotes] = useState(state.notes);
  /** Nota cambiata dall'agente e non ancora salvata: solo questa si manda al server. */
  const [dirty, setDirty] = useState(false);
  const [noteState, setNoteState] = useState<NoteState>('idle');
  // Una nota non toccata segue quella salvata (cambiata da un altro dispositivo e riletta), così non si sovrascrive.
  useEffect(() => {
    if (!dirty) setNotes(state.notes);
  }, [state.notes, dirty]);
  // Chiudendo la scheda (✕, Esc, clic fuori, indietro del browser) la nota scritta si salva anche senza uscire dal campo.
  const pending = useRef<{ notes: string; keys: string[]; onSaved: typeof onSaved } | null>(null);
  pending.current = dirty ? { notes, keys, onSaved } : null;
  useEffect(
    () => () => {
      const p = pending.current;
      if (p) api<{ state: LeadState }>('PATCH', '/api/leads/state', { keys: p.keys, notes: p.notes }).then((r) => p.onSaved(r.state), () => {});
    },
    [],
  );
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recall = recallStatus(state.recallAt, now);

  /**
   * I salvataggi partono uno dopo l'altro (nota poi stato, a pochi istanti): il server li applica in ordine e ogni risposta
   * contiene anche i precedenti, così a video resta sempre l'ultimo stato salvato, anche se il salvataggio dopo fallisce.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function save(patch: LeadPatch): Promise<boolean> {
    const run = queue.current.then(async () => {
      setError(null);
      try {
        const r = await api<{ state: LeadState }>('PATCH', '/api/leads/state', { keys, ...patch });
        onSaved(r.state);
        return true;
      } catch (e) {
        setError(errorText(e));
        return false;
      }
    });
    queue.current = run;
    return run;
  }

  async function saveNotes(): Promise<void> {
    if (!dirty) return;
    setNoteState('saving');
    const ok = await save({ notes });
    if (ok) setDirty(false);
    setNoteState(ok ? 'saved' : 'idle');
  }

  const pick = (recallAt: number) => {
    setPicking(false);
    void save({ recallAt });
  };
  const commitDate = (value: string) => {
    const day = fromDateInput(value);
    if (day != null) pick(day);
  };

  // Il ref ferma il secondo clic prima che il bottone si ridisegni disabilitato.
  const splitting = useRef(false);
  const [splitBusy, setSplitBusy] = useState(false);
  async function split(key: string): Promise<void> {
    if (splitting.current) return;
    splitting.current = true;
    setSplitBusy(true);
    setError(null);
    try {
      await api('POST', '/api/leads/split', { key, fromKeys: keys.filter((k) => k !== key) });
      await onSplit();
    } catch (e) {
      setError(errorText(e));
    } finally {
      splitting.current = false;
      setSplitBusy(false);
    }
  }

  const prices = [...lead.prices].sort((a, b) => a.at - b.at);
  const sources = [{ listing, evaluation, previous: false }, ...others];
  const drop = dropOf(lead);
  const perM2 = listing.currentPrice != null && listing.surfaceM2 ? Math.round(listing.currentPrice / listing.surfaceM2) : null;
  const shortcuts = RECALL_SHORTCUTS.map((s) => (
    // Date.now() e non `now`: la pagina può essere aperta da prima di mezzanotte.
    <button key={s.days} type="button" className="chip" onClick={() => pick(addDays(startOfLocalDay(Date.now()), s.days))}>
      {s.label}
    </button>
  ));
  const dateInput = (
    <input
      type="date"
      className="field"
      aria-label="Data del richiamo"
      defaultValue={state.recallAt != null ? toDateInput(state.recallAt) : ''}
      // Si salva uscendo dal campo o con Invio: scrivendo da tastiera ogni cifra produce una data intermedia.
      onBlur={(e) => commitDate(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitDate(e.currentTarget.value);
      }}
    />
  );

  return (
    <section className="detail" aria-label="Scheda del lead">
      <header className="detail__head">
        <div className="detail__photo">
          <Cover key={lead.covers.join(' ')} covers={lead.covers} href={listing.url} size="large" />
          {isNew && <span className="new-badge">NUOVO</span>}
        </div>
        <div className="detail__summary">
          <div className="lead__tags">
            {evaluation.priority !== 'none' && <span className={`pill pill--${evaluation.priority}`}>{priorityLabel(evaluation.priority, listing.portal)}</span>}
            {drop && <span className="pill pill--drop">{`Ribassato −${formatPercent(drop.percent)}%`}</span>}
            {portals.map((p) => (
              <span key={p} className="portal-tag">{PORTAL_TAGS[p]}</span>
            ))}
            {portals.length > 1 && <span className="pill pill--multi">{`Su ${portals.length} portali`}</span>}
            {lead.reposted && <span className="pill pill--multi">Ripubblicato</span>}
            {lead.missing != null && <span className="pill pill--missing">{`Non più visto dal ${formatDate(lead.missing)}`}</span>}
            {lead.missingPortals.map((p) => (
              <span key={`gone-${p}`} className="pill pill--missing">{`Non più su ${PORTAL_TAGS[p]}`}</span>
            ))}
          </div>
          <p className="detail__price">
            {priceText(listing.currentPrice)}
            {drop && <s className="lead__was">{priceText(drop.from)}</s>}
          </p>
          <h2 className="detail__title">{listing.title}</h2>
          <p className="hint">{[listing.address, listing.zone, listing.city].filter(Boolean).join(' · ')}</p>
          <dl className="detail__facts">
            {listing.surfaceM2 != null && <div><dt>superficie</dt><dd>{`${listing.surfaceM2} m²`}</dd></div>}
            {listing.rooms != null && <div><dt>locali</dt><dd>{listing.rooms}</dd></div>}
            {perM2 != null && <div><dt>prezzo</dt><dd>{`€ ${formatEuro(perM2)} al m²`}</dd></div>}
          </dl>
          <a className="btn btn--primary" href={listing.url} target="_blank" rel="noreferrer">
            {`Apri l'annuncio su ${PORTAL_TAGS[listing.portal]} ↗`}
          </a>
        </div>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="detail__cols">
        <div className="detail__info">
          <section className="detail__section">
            <h3>Perché è un lead</h3>
            <p>{evaluation.reasons.join(' · ') || 'Nessun segnale: lo vedi perché l\'hai già lavorato.'}</p>
            <p className="hint">
              {evaluation.ageDays != null && `Online da ${evaluation.ageEstimated ? '~' : ''}${evaluation.ageDays} giorni · `}
              {`Visto ${listing.seenCount} ${listing.seenCount === 1 ? 'volta' : 'volte'}`}
            </p>
          </section>

          {prices.length > 0 && (
            <section className="detail__section">
              <h3>Storico prezzi</h3>
              <Sparkline prices={prices.map((p) => p.price)} width={240} height={48} />
              <table className="history" aria-label="Storico prezzi">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Prezzo</th>
                    <th>Fonte</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.map((p) => (
                    <tr key={`${p.listingKey}-${p.at}`}>
                      <td>{formatDate(p.at)}</td>
                      <td>{priceText(p.price)}</td>
                      <td>{p.source === 'declared' ? 'indicato dal portale' : 'visto nei giri'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {market && (
            <section className="detail__section">
              <h3>Mercato</h3>
              {isAboveMarket(market) && <span className="market-tag">{aboveMarketText(market)}</span>}
              <p className="hint">{marketExplanation(market)}</p>
            </section>
          )}

          {others.length > 0 && (
            <section className="detail__section">
              <h3>Stesso immobile</h3>
              <ul className="sources__list">
                {sources.map((s) => (
                  <li key={s.listing.key} className="sources__item">
                    <span className="portal-tag">{PORTAL_TAGS[s.listing.portal]}</span>
                    {s.previous && <span className="sources__previous">{`Annuncio precedente · visto fino al ${formatDayMonth(s.listing.lastSeenAt)}`}</span>}
                    <span className="sources__facts">
                      {[
                        priceText(s.listing.currentPrice),
                        s.listing.surfaceM2 != null ? `${s.listing.surfaceM2} m²` : null,
                        s.evaluation.ageDays != null ? `${s.evaluation.ageEstimated ? '~' : ''}${s.evaluation.ageDays} gg` : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                    <a className="btn btn--small" href={s.listing.url} target="_blank" rel="noreferrer">Apri ↗</a>
                    <button
                      type="button"
                      className="btn btn--small"
                      aria-label={s.previous ? `Separa annuncio precedente ${PORTAL_TAGS[s.listing.portal]}` : `Separa ${PORTAL_TAGS[s.listing.portal]}`}
                      title="Non è lo stesso immobile: mostralo come lead a sé"
                      disabled={splitBusy}
                      onClick={() => void split(s.listing.key)}
                    >
                      Separa
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="work">
          <h3 className="work__title">Il tuo lavoro</h3>
          <h4 className="work__label">Stato</h4>
          <div className="work__status" role="radiogroup" aria-label="Stato">
            {LEAD_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={state.status === s}
                className={`work__state${state.status === s ? ' work__state--on' : ''}`}
                onClick={() => {
                  if (state.status !== s) void save({ status: s });
                }}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          {state.status !== 'discarded' && (
            <>
              <h4 className="work__label">Richiamo</h4>
              <div className="recall">
                {state.recallAt != null && recall ? (
                  <>
                    <span className={`recall__tag recall__tag--${recall.kind}`}>{`Richiamo ${formatRecallDate(state.recallAt)} · ${recallLabel(recall)}`}</span>
                    <button type="button" className="btn btn--small" onClick={() => void save({ recallAt: null })}>Fatto</button>
                    <button type="button" className="btn btn--small" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>Sposta…</button>
                    {picking && <div className="recall__picker">{dateInput}{shortcuts}</div>}
                  </>
                ) : (
                  <>
                    {shortcuts}
                    <button type="button" className="chip" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>Scegli data…</button>
                    {picking && <div className="recall__picker">{dateInput}</div>}
                  </>
                )}
              </div>
            </>
          )}
          <label className="detail__field">
            <span className="work__label">Note</span>
            <textarea
              className="field detail__notes"
              aria-label="Note"
              placeholder="Aggiungi una nota…"
              rows={4}
              maxLength={2000}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
                setNoteState('idle');
              }}
              onBlur={() => void saveNotes()}
            />
          </label>
          {noteState !== 'idle' && <p className="hint">{noteState === 'saving' ? 'Salvataggio…' : 'Salvata'}</p>}
          <p className="hint">Stato, richiamo e note sono solo tuoi: nessun altro li vede.</p>
        </aside>
      </div>
    </section>
  );
}
