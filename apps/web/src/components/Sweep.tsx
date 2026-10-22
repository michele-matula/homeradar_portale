import { useCallback, useEffect, useState } from 'react';
import type { ConnectorState, SweepStarted } from '@homeradar/shared/api/connector-messages';
import type { SweepOutcome, SweepStatus } from '@homeradar/shared/shared/types';
import { api, errorText } from '../api';
import { chromeConnector, isPhone, type ConnectorPort } from '../connector';

/** Avanzamento e connettore si rileggono ogni tanto mentre il giro corre o finché il connettore non risponde. */
const POLL_MS = 3_000;

const OUTCOMES: Record<SweepOutcome, string> = { completed: 'completato', partial: 'completato in parte', stopped: 'fermato', interrupted: 'interrotto' };

function lastLine(status: SweepStatus | null): string | null {
  const last = status?.last;
  return last ? `Ultimo giro: ${OUTCOMES[last.outcome]} · ${last.newCount} nuovi` : null;
}

/** «Cerca» e «Ferma» del giro delle ricerche, che il connettore fa sul computer dell'agente. */
export function Sweep({ connector = chromeConnector, phone = isPhone() }: { connector?: ConnectorPort; phone?: boolean }) {
  const [status, setStatus] = useState<SweepStatus | null>(null);
  /** undefined = non ancora chiesto, null = connettore assente. */
  const [conn, setConn] = useState<ConnectorState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => api<SweepStatus>('GET', '/api/sweep').then(setStatus, () => {}), []);
  const ping = useCallback(async () => {
    const r = await connector.send<ConnectorState>({ type: 'ping' });
    setConn(r?.ok ? r.data : null);
  }, [connector]);

  useEffect(() => {
    void refresh();
    if (!phone) void ping();
  }, [refresh, ping, phone]);

  const running = status?.running != null;
  const waiting = !phone && conn === null;
  useEffect(() => {
    if (!running && !waiting) return;
    const h = setInterval(() => {
      if (running) void refresh();
      if (!phone) void ping();
    }, POLL_MS);
    return () => clearInterval(h);
  }, [running, waiting, refresh, ping, phone]);

  async function linkNow(): Promise<void> {
    const { code } = await api<{ code: string }>('POST', '/api/devices/link-code', {});
    const r = await connector.send<null>({ type: 'link', code });
    if (!r) throw new Error('Il connettore non risponde');
    if (!r.ok) throw new Error(r.error);
  }

  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const state = await connector.send<ConnectorState>({ type: 'ping' });
      if (!state?.ok) throw new Error('Il connettore non risponde');
      if (!state.data.linked) await linkNow();
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

  const last = lastLine(status);
  if (phone) {
    return (
      <section className="card">
        <h2>Ricerche</h2>
        <p>Le ricerche partono dal computer</p>
        {last && <p className="hint">{last}</p>}
      </section>
    );
  }
  const pending = conn?.pending ?? 0;
  return (
    <section className="card">
      <h2>Ricerche</h2>
      {conn === null && <p>Installa il connettore HomeRadar per cercare dal computer. Questa pagina se ne accorge da sola.</p>}
      {status?.running ? (
        <>
          <p>Giro in corso: {status.running.done} di {status.running.total} ricerche</p>
          {conn && (
            <button type="button" className="btn" onClick={() => void stop()}>
              Ferma
            </button>
          )}
        </>
      ) : (
        conn && (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void start()}>
            Cerca
          </button>
        )
      )}
      {info && <p className="notice">{info}</p>}
      {!status?.running && last && <p className="hint">{last}</p>}
      {pending > 0 && <p className="hint">{pending === 1 ? "1 pagina in attesa d'invio" : `${pending} pagine in attesa d'invio`}</p>}
      {conn?.stuck && <p className="error">Il connettore non riesce a inviare i dati: controlla la connessione</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
