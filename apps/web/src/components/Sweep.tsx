import { useCallback, useEffect, useRef, useState } from 'react';
import { CONNECTOR_STORE_URL, type ConnectorState, type SweepStarted } from '@homeradar/shared/api/connector-messages';
import { REMOTE_MIN_VERSION, versionAtLeast } from '@homeradar/shared/core/remote';
import { startOfLocalDay } from '@homeradar/shared/core/recall';
import { PORTAL_SITES, PORTALS, type SweepStatus } from '@homeradar/shared/shared/types';
import { api, errorText } from '../api';
import { RemoteSweep } from './RemoteSweep';
import { lastLine, minutes, OUTCOME_TITLES, reasons } from './sweep-text';
import { chromeConnector, isPhone, type ConnectorPort } from '../connector';

/** Avanzamento e connettore si rileggono ogni tanto mentre il giro corre, il connettore non risponde o ha pagine da inviare. */
const POLL_MS = 3_000;

/** Giro delle ricerche: «Cerca» e «Ferma» (il connettore lo fa sul computer dell'agente), avanzamento e riepilogo. */
export function Sweep({ userId, connector = chromeConnector, phone = isPhone(), hasZone = true, onLinked, onFinished, onShowNew, onStatus }: {
  userId: string;
  connector?: ConnectorPort;
  phone?: boolean;
  /** Senza comuni assegnati non c'è niente da cercare. */
  hasZone?: boolean;
  /** Il connettore si è appena collegato a questo account. */
  onLinked?(): void;
  /** Un giro in corso è appena finito: i lead vanno riletti. */
  onFinished?(): void;
  /** «Vedi i nuovi»: solo i lead nuovi (dall'ultima visita della lista). */
  onShowNew?(): void;
  /** Ogni stato letto da `/api/sweep`: la lista ne ricava da quando un lead è nuovo. */
  onStatus?(status: SweepStatus): void;
}) {
  const [status, setStatus] = useState<SweepStatus | null>(null);
  /** undefined = non ancora chiesto, null = connettore assente. */
  const [conn, setConn] = useState<ConnectorState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Nome del computer da collegare, mentre l'agente lo sceglie; null fuori dal collegamento. */
  const [naming, setNaming] = useState<string | null>(null);
  // Il riepilogo si mostra per un giro finito mentre la pagina era aperta, finché l'agente non lo chiude.
  const [openedAt] = useState(Date.now);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const wasRunning = useRef(false);

  // In un ref, così una funzione nuova a ogni disegno di chi la passa non rifà le letture.
  const statusListener = useRef(onStatus);
  statusListener.current = onStatus;
  const refresh = useCallback(() => api<SweepStatus>('GET', '/api/sweep').then((s) => {
    setStatus(s);
    statusListener.current?.(s);
  }, () => {}), []);
  const ping = useCallback(async () => {
    const r = await connector.send<ConnectorState>({ type: 'ping' });
    setConn(r?.ok ? r.data : null);
  }, [connector]);

  useEffect(() => {
    if (!hasZone) return;
    const read = () => {
      if (document.visibilityState !== 'visible') return;
      void refresh();
      if (!phone) void ping();
    };
    read();
    // Scheda lasciata aperta: un giro automatico può essere partito o finito mentre l'agente non guardava.
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
  }, [refresh, ping, phone, hasZone]);

  const running = status?.running != null;
  useEffect(() => {
    if (wasRunning.current && !running && status) onFinished?.();
    wasRunning.current = running;
  }, [running, status, onFinished]);

  const waiting = !phone && conn === null;
  const pending = conn?.pending ?? 0;
  // Richiesta dal telefono in attesa di un computer: si rilegge finché un computer la prende o scade.
  const asked = status?.remote?.state === 'waiting';
  useEffect(() => {
    if (!hasZone || (!running && !waiting && !asked && pending === 0)) return;
    const h = setInterval(() => {
      if (running || asked) void refresh();
      if (!phone) void ping();
    }, POLL_MS);
    return () => clearInterval(h);
  }, [running, waiting, asked, pending, refresh, ping, phone, hasZone]);

  async function linkNow(name?: string): Promise<void> {
    const { code } = await api<{ code: string }>('POST', '/api/devices/link-code', {});
    const r = await connector.send<null>(name ? { type: 'link', code, name } : { type: 'link', code });
    if (!r) throw new Error('Il connettore non risponde');
    if (!r.ok) throw new Error(r.error);
    onLinked?.();
  }

  /** «Cerca»: se il connettore non è collegato a questo account, prima si chiede il nome del computer. */
  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const state = await connector.send<ConnectorState>({ type: 'ping' });
      if (!state?.ok) throw new Error('Il connettore non risponde');
      // Non collegato, o collegato a un altro account (PC condiviso, cambio d'account): si collega a questo.
      if (!state.data.linked || state.data.userId !== userId) {
        // Un connettore più vecchio dell'avvio dal telefono rifiuterebbe il nome: si collega come prima.
        if (!versionAtLeast(state.data.version, REMOTE_MIN_VERSION)) await linkNow();
        else {
          setNaming(state.data.defaultName ?? '');
          return;
        }
      }
      await run();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  /** «Collega»: collega con il nome scelto, poi parte il giro. */
  async function linkAndStart(name: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await linkNow(name.trim() || undefined);
      setNaming(null);
      await run();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    let r = await connector.send<SweepStarted>({ type: 'startSweep' });
    // Collegamento revocato dal portale o token perso: si ricollega una volta sola (il nome resta quello automatico).
    if (r && !r.ok && r.notLinked) {
      await linkNow();
      r = await connector.send<SweepStarted>({ type: 'startSweep' });
    }
    if (!r) throw new Error('Il connettore non risponde');
    if (!r.ok) throw new Error(r.error);
    if (r.data.sweepId === null) setInfo("Dati già aggiornati da meno di un'ora");
    await refresh();
    await ping();
  }

  async function stop(): Promise<void> {
    setError(null);
    const r = await connector.send<null>({ type: 'stopSweep' });
    if (r && !r.ok) setError(r.error);
    await refresh();
  }

  if (!hasZone) return null;
  const last = status?.last ?? null;
  const now = Date.now();

  const installHint = (
    <p>
      Connettore non trovato. Se non l'hai installato,{' '}
      <a href={CONNECTOR_STORE_URL} target="_blank" rel="noreferrer">
        installalo dal Chrome Web Store
      </a>
      ; se sei in una finestra in incognito, apri il portale in una finestra normale. Questa pagina se ne accorge da sola.
    </p>
  );
  // Sul telefono, o su un computer senza connettore, il giro si chiede a un altro computer dell'agente.
  if (phone || conn === null) {
    return (
      <RemoteSweep
        status={status}
        refresh={refresh}
        openedAt={openedAt}
        installHint={phone ? undefined : installHint}
        onShowNew={onShowNew}
      />
    );
  }

  const footer = (
    <>
      {info && <p className="notice">{info}</p>}
      {pending > 0 && <p className="hint">{pending === 1 ? "1 pagina in attesa d'invio" : `${pending} pagine in attesa d'invio`}</p>}
      {conn?.stuck && <p className="error">Il connettore non riesce a inviare i dati: controlla la connessione</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );

  if (status?.running) {
    const r = status.running;
    return (
      <section className="card sweep">
        <h2>{`${r.auto ? 'Giro automatico in corso' : 'Ricerca in corso'} · ${minutes(now - r.startedAt)}`}</h2>
        <progress className="sweep__bar" max={r.total} value={r.done} aria-label="Ricerche fatte" />
        {r.current && <p className="sweep__current">{r.current}</p>}
        <ul className="sweep__portals">
          {PORTALS.filter((p) => r.portals[p]).map((p) => (
            <li key={p}>{`${PORTAL_SITES[p]}: ${r.portals[p]!.pages} pagine · ${r.portals[p]!.privates} privati`}</li>
          ))}
        </ul>
        <div className="sweep__row">
          <span>{`Finora: ${r.newCount} annunci nuovi · ${r.drops} ribassi`}</span>
          {conn && (
            <button type="button" className="btn" onClick={() => void stop()}>
              Ferma
            </button>
          )}
        </div>
        {footer}
      </section>
    );
  }

  if (last && last.finishedAt >= openedAt && dismissed !== last.finishedAt) {
    return (
      <section className="card sweep">
        <h2>{`${OUTCOME_TITLES[last.outcome]} · ${minutes(last.finishedAt - last.startedAt)}`}</h2>
        <p>{`${last.newCount} nuovi lead · ${last.drops} ribassi · ${last.missing} non più visti`}</p>
        {reasons(last).map((r) => <p key={r} className="sweep__reason">{r}</p>)}
        <div className="sweep__row">
          <button type="button" className="btn btn--primary" onClick={() => onShowNew?.()}>
            Vedi i nuovi
          </button>
          <button type="button" className="btn" onClick={() => setDismissed(last.finishedAt)}>
            Chiudi
          </button>
        </div>
        {footer}
      </section>
    );
  }

  const today = last != null && startOfLocalDay(last.startedAt) === startOfLocalDay(now);
  return (
    <section className="card sweep">
      <h2>Ricerche</h2>
      <p className="sweep__last">{last ? lastLine(last) : 'Nessun giro fatto finora'}</p>
      {last && reasons(last).map((r) => <p key={r} className="sweep__reason">{r}</p>)}
      {conn && naming !== null && (
        <form
          className="sweep__link"
          onSubmit={(e) => {
            e.preventDefault();
            void linkAndStart(naming);
          }}
        >
          <h3>Collega questo computer</h3>
          <label htmlFor="device-name">Come lo chiami?</label>
          <input id="device-name" value={naming} maxLength={60} onChange={(e) => setNaming(e.target.value)} />
          <p className="hint">es. PC di casa, PC ufficio</p>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Collega
          </button>
        </form>
      )}
      {conn && naming === null && (
        <div className="sweep__row">
          {!today && <span>Giro di oggi da fare</span>}
          <button type="button" className={today ? 'btn' : 'btn btn--primary'} disabled={busy} onClick={() => void start()}>
            Cerca
          </button>
        </div>
      )}
      {footer}
    </section>
  );
}
