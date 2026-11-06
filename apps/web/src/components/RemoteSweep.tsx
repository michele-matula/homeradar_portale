import { useState, type ReactNode } from 'react';
import type { SweepStatus } from '@homeradar/shared/shared/types';
import { api, errorText } from '../api';
import { linkProps } from '../router';
import { lastLine, minutes, OUTCOME_TITLES, reasons } from './sweep-text';

const FRESH = "Dati già aggiornati da meno di un'ora";

/** «PC di casa è online», «PC di casa e PC ufficio sono online». */
function onlineLine(names: string[]): string {
  if (!names.length) return 'Nessun tuo computer è online ora';
  if (names.length === 1) return `${names[0]} è online`;
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)} sono online`;
}

/**
 * Giro avviato dal telefono (o da un computer senza connettore): la richiesta passa dal server e la prende il primo
 * computer dell'agente con «Avvia dal telefono» attivo. Stato, «Ferma» e riepilogo arrivano da `GET /api/sweep`.
 */
export function RemoteSweep({ status, refresh, openedAt, installHint, onShowNew }: {
  status: SweepStatus | null;
  refresh(): Promise<void>;
  /** Le richieste e i giri finiti prima di aprire la pagina non si raccontano. */
  openedAt: number;
  /** Sul computer senza connettore: come installarlo. */
  installHint?: ReactNode;
  onShowNew?(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  /** L'agente ha premuto «Avvia sul computer» in questa pagina: la richiesta si mostra anche se l'orologio del telefono è avanti. */
  const [asked, setAsked] = useState(false);

  async function act(f: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await f();
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const ask = () =>
    act(async () => {
      const r = await api<{ fresh: boolean }>('POST', '/api/sweep/remote', {});
      if (r.fresh) setInfo(FRESH);
      else setAsked(true);
    });
  const cancel = () => act(() => api('DELETE', '/api/sweep/remote'));
  const stop = () => act(() => api('POST', '/api/sweep/stop', {}));

  const footer = (
    <>
      {info && <p className="notice">{info}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
  const running = status?.running ?? null;
  const last = status?.last ?? null;
  const remote = status?.remote && (asked || status.remote.createdAt >= openedAt) ? status.remote : null;

  if (running) {
    const title = running.auto ? 'Giro automatico in corso' : running.deviceName ? `Giro in corso su «${running.deviceName}»` : 'Giro in corso';
    return (
      <section className="card sweep sweep--remote" aria-label="Ricerche">
        <h2>{title}</h2>
        <progress className="sweep__bar" max={running.total} value={running.done} aria-label="Ricerche fatte" />
        <p>{`${running.done} di ${running.total} ricerche · finora ${running.newCount} annunci nuovi`}</p>
        {running.stopRequested ? (
          <p className="hint">Si ferma entro un minuto…</p>
        ) : running.canStop === false ? (
          // Un connettore più vecchio dell'avvio dal telefono non riceve «Ferma» dal server.
          <p className="hint">{`Per fermarlo dal telefono aggiorna il connettore su «${running.deviceName ?? 'quel computer'}»`}</p>
        ) : (
          <div className="sweep__row">
            <button type="button" className="btn" disabled={busy} onClick={() => void stop()}>
              Ferma
            </button>
          </div>
        )}
        {footer}
      </section>
    );
  }

  if (last && last.finishedAt >= openedAt && dismissed !== last.finishedAt) {
    return (
      <section className="card sweep sweep--remote" aria-label="Ricerche">
        <h2>{`${OUTCOME_TITLES[last.outcome]} · ${minutes(last.finishedAt - last.startedAt)}`}</h2>
        <p>{`${last.newCount} nuovi lead · ${last.drops} ribassi · ${last.missing} non più visti`}</p>
        {reasons(last, true).map((r) => <p key={r} className="sweep__reason">{r}</p>)}
        <div className="sweep__row">
          <button type="button" className="btn btn--primary" onClick={() => onShowNew?.()}>
            Vedi i nuovi
          </button>
          <button type="button" className="btn" onClick={() => setDismissed(last.finishedAt)}>
            Chiudi
          </button>
        </div>
      </section>
    );
  }

  if (remote?.state === 'waiting') {
    return (
      <section className="card sweep sweep--remote" aria-label="Ricerche">
        <h2>Ricerche</h2>
        <p>Aspetto un computer acceso… (fino a 2 minuti)</p>
        <div className="sweep__row">
          <button type="button" className="btn" disabled={busy} onClick={() => void cancel()}>
            Annulla
          </button>
        </div>
        {footer}
      </section>
    );
  }

  const enabled = (status?.computers?.enabled ?? 0) > 0;
  const online = status?.computers?.online ?? [];
  /** Esito della richiesta appena fatta, se il giro non è partito. */
  const outcome =
    remote?.state === 'noAnswer' ? (
      <>
        <p className="error">Nessun computer ha risposto</p>
        <p className="hint">Serve un computer acceso, non in sospensione, con Chrome aperto e «Avvia dal telefono» attivo.</p>
      </>
    ) : remote?.state === 'failed' ? (
      <p className="error">{`«${remote.deviceName ?? 'Il computer'}» ha risposto ma il giro non è partito: riprova`}</p>
    ) : remote?.state === 'fresh' && !info ? (
      <p className="notice">{FRESH}</p>
    ) : null;
  const retry = remote?.state === 'noAnswer' || remote?.state === 'failed';

  return (
    <section className="card sweep sweep--remote" aria-label="Ricerche">
      <h2>Ricerche</h2>
      {installHint}
      <p className="sweep__last">{last ? lastLine(last) : 'Nessun giro fatto finora'}</p>
      {outcome}
      {enabled ? (
        <>
          <p className="sweep__online">
            <span className={online.length ? 'dot dot--on' : 'dot'} aria-hidden="true" />
            {onlineLine(online)}
          </p>
          <div className="sweep__row">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void ask()}>
              {retry ? 'Riprova' : 'Avvia sul computer'}
            </button>
          </div>
        </>
      ) : (
        status && (
          <p className="hint">
            Per avviare le ricerche dal telefono attiva «Avvia dal telefono» su un tuo computer in{' '}
            <a {...linkProps('/impostazioni')}>Impostazioni</a>.
          </p>
        )
      )}
      {footer}
    </section>
  );
}
