import { useCallback, useEffect, useRef, useState } from 'react';
import { CONNECTOR_STORE_URL, type ConnectorState, type SweepStarted } from '@homeradar/shared/api/connector-messages';
import { startOfLocalDay } from '@homeradar/shared/core/recall';
import { formatDateTime } from '@homeradar/shared/shared/format';
import { PORTAL_SITES, PORTALS, type Portal, type PortalSweepOutcome, type SweepOutcome, type SweepResult, type SweepStatus } from '@homeradar/shared/shared/types';
import { api, errorText } from '../api';
import { chromeConnector, isPhone, type ConnectorPort } from '../connector';

/** Avanzamento e connettore si rileggono ogni tanto mentre il giro corre, il connettore non risponde o ha pagine da inviare. */
const POLL_MS = 3_000;

const OUTCOMES: Record<SweepOutcome, string> = { completed: 'completato', partial: 'completato in parte', stopped: 'fermato', interrupted: 'interrotto' };
const OUTCOME_TITLES: Record<SweepOutcome, string> = {
  completed: 'Giro completato', partial: 'Giro completato in parte', stopped: 'Giro fermato', interrupted: 'Giro interrotto',
};
const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;

function portalReason(p: Portal, o: PortalSweepOutcome): string | null {
  const site = PORTAL_SITES[p];
  if (o === 'blocked') return `${site} ha chiesto una verifica: aprilo tu e riprova domani.`;
  if (o === 'capped') return `${site}: raggiunto il limite di pagine, alcune ricerche sono incomplete.`;
  if (o === 'error') return `${site} non ha risposto ad alcune pagine.`;
  return null;
}

/** Motivi per cui il giro non è andato del tutto bene, per portale, più le ricerche che il portale non riconosce. */
function reasons(r: SweepResult): string[] {
  const out = PORTALS.flatMap((p) => {
    const s = r.portals[p];
    const why = s && portalReason(p, s.outcome);
    return why ? [why] : [];
  });
  if (r.notFound.length) out.push(`Non trovati: ${r.notFound.join(', ')}.`);
  return out;
}

// Durante il giro il server conta gli annunci nuovi; alla fine i lead nuovi (stesso immobile su più portali = uno).
const lastLine = (last: SweepResult) => `Ultimo giro: ${formatDateTime(last.startedAt)} · ${OUTCOMES[last.outcome]} · ${last.newCount} nuovi lead`;

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
  /** «Vedi i nuovi»: solo i lead nuovi dell'ultimo giro. */
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
    void refresh();
    if (!phone) void ping();
  }, [refresh, ping, phone, hasZone]);

  const running = status?.running != null;
  useEffect(() => {
    if (wasRunning.current && !running && status) onFinished?.();
    wasRunning.current = running;
  }, [running, status, onFinished]);

  const waiting = !phone && conn === null;
  const pending = conn?.pending ?? 0;
  useEffect(() => {
    if (!hasZone || (!running && !waiting && pending === 0)) return;
    const h = setInterval(() => {
      if (running) void refresh();
      if (!phone) void ping();
    }, POLL_MS);
    return () => clearInterval(h);
  }, [running, waiting, pending, refresh, ping, phone, hasZone]);

  async function linkNow(): Promise<void> {
    const { code } = await api<{ code: string }>('POST', '/api/devices/link-code', {});
    const r = await connector.send<null>({ type: 'link', code });
    if (!r) throw new Error('Il connettore non risponde');
    if (!r.ok) throw new Error(r.error);
    onLinked?.();
  }

  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const state = await connector.send<ConnectorState>({ type: 'ping' });
      if (!state?.ok) throw new Error('Il connettore non risponde');
      // Non collegato, o collegato a un altro account (PC condiviso, cambio d'account): si collega a questo.
      if (!state.data.linked || state.data.userId !== userId) await linkNow();
      let r = await connector.send<SweepStarted>({ type: 'startSweep' });
      // Collegamento revocato dal portale o token perso: si ricollega una volta sola.
      if (r && !r.ok && r.notLinked) {
        await linkNow();
        r = await connector.send<SweepStarted>({ type: 'startSweep' });
      }
      if (!r) throw new Error('Il connettore non risponde');
      if (!r.ok) throw new Error(r.error);
      if (r.data.sweepId === null) setInfo("Dati già aggiornati da meno di un'ora");
      await refresh();
      await ping();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
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

  if (phone) {
    return (
      <section className="card sweep">
        <h2>Ricerche</h2>
        <p>Le ricerche partono dal computer</p>
        {status?.running && <p className="hint">{`Giro in corso: ${status.running.done} di ${status.running.total} ricerche`}</p>}
        {!status?.running && last && <p className="hint">{lastLine(last)}</p>}
      </section>
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
        <h2>{`Ricerca in corso · ${minutes(now - r.startedAt)}`}</h2>
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
      {conn === null && (
        <p>
          Connettore non trovato. Se non l'hai installato,{' '}
          <a href={CONNECTOR_STORE_URL} target="_blank" rel="noreferrer">
            installalo dal Chrome Web Store
          </a>
          ; se sei in una finestra in incognito, apri il portale in una finestra normale. Questa pagina se ne accorge da sola.
        </p>
      )}
      <p className="sweep__last">{last ? lastLine(last) : 'Nessun giro fatto finora'}</p>
      {last && reasons(last).map((r) => <p key={r} className="sweep__reason">{r}</p>)}
      {conn && (
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
