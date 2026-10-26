import type { ControlAgent as AgentData, ControlDevice, ControlRun, ControlSweep, Me } from '@homeradar/shared/api/types';
import type { SearchErrorReason } from '@homeradar/shared/core/sweep';
import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { ErrorGroups } from '../components/ErrorGroups';
import { Layout } from '../components/Layout';
import { dateTime } from '../format';
import { linkProps } from '../router';
import { outcomeText, Reasons } from './Control';

const RUN_STATUS: Record<string, string> = {
  pending: 'in corso', running: 'in corso', complete: 'completa', capped: 'al limite di pagine', blocked: 'bloccata', error: 'errore',
  notFound: 'non trovata', skipped: 'saltata',
};
const REASON_TEXT: Record<SearchErrorReason, string> = { timeout: 'pagina non arrivata in tempo', unreadable: 'annunci non letti' };

function DeviceRow({ d, onRevoked }: { d: ControlDevice; onRevoked(): void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', `/api/admin/devices/${d.id}`);
      onRevoked();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <tr>
      <td>{d.name}</td>
      <td>{d.version ?? '—'}</td>
      <td>{dateTime(d.createdAt)}</td>
      <td>{dateTime(d.lastSeenAt)}</td>
      <td>{d.lastGoodSweepAt ? dateTime(d.lastGoodSweepAt) : <span className="health__bad">nessun giro riuscito</span>}</td>
      <td>
        {!confirm && (
          <button type="button" className="btn btn--small btn--danger" onClick={() => setConfirm(true)}>
            Revoca
          </button>
        )}
        {confirm && (
          <div className="actions">
            <button type="button" className="btn btn--small btn--danger" disabled={busy} onClick={revoke}>
              Conferma revoca
            </button>
            <button type="button" className="btn btn--small" onClick={() => setConfirm(false)}>
              Annulla
            </button>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </td>
    </tr>
  );
}

function Runs({ sweep }: { sweep: ControlSweep }) {
  const [runs, setRuns] = useState<ControlRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRuns(null);
    setError(null);
    api<ControlRun[]>('GET', `/api/admin/sweeps/${sweep.id}/runs`)
      .then(setRuns)
      .catch((e: unknown) => setError(errorText(e)));
  }, [sweep.id]);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!runs) return <p aria-busy="true">Caricamento…</p>;
  return (
    <div className="table-wrap">
      <table className="table" aria-label="Ricerche del giro">
        <thead>
          <tr>
            <th>Ricerca</th>
            <th>Esito</th>
            <th>Pagine</th>
            <th>Privati</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.searchKey} className={r.status === 'blocked' || r.status === 'error' ? 'health--warn' : undefined}>
              <td>
                {r.label}
                <div className="hint">{r.portal}</div>
              </td>
              <td>{RUN_STATUS[r.status] ?? r.status}</td>
              <td>{r.pages}</td>
              <td>{r.privates}</td>
              <td>{r.reason ? REASON_TEXT[r.reason] : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const sweepText = (s: ControlSweep) =>
  `${dateTime(s.startedAt)} · ${outcomeText(s)}${s.auto ? ' · automatico' : ''} · ${s.searches} ricerche${s.problems ? `, ${s.problems} con problemi` : ''}${s.deviceName ? ` · da ${s.deviceName}` : ''}`;

/** Scheda di un agente: connettori, giri con le loro ricerche, errori. */
export function ControlAgent({ me, onSignOut, userId }: { me: Me; onSignOut(): void; userId: string }) {
  const [data, setData] = useState<AgentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AgentData>('GET', `/api/admin/control/${encodeURIComponent(userId)}`)
      .then(setData)
      .catch((e: unknown) => setError(errorText(e)));
  }, [userId]);
  useEffect(load, [load]);

  const sweep = data && (data.sweeps.find((s) => s.id === selected) ?? data.sweeps[0]);
  return (
    <Layout me={me} onSignOut={onSignOut} wide>
      <p>
        <a {...linkProps('/admin/controllo')}>← Controllo</a>
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <p aria-busy="true">Caricamento…</p>}
      {data && (
        <>
          <h1>{data.row.email}</h1>
          <div className={`card health health--${data.row.health}`}>
            <Reasons row={data.row} />
            <p className="hint">Ultimo accesso {dateTime(data.row.lastSeenAt)} · {data.row.sweeps30d} giri in 30 gg</p>
          </div>

          <h2>Connettori</h2>
          {!data.row.devices.length && <p className="hint">Nessun connettore collegato</p>}
          {data.row.devices.length > 0 && (
            <div className="table-wrap">
              <table className="table" aria-label="Connettori">
                <thead>
                  <tr>
                    <th>Connettore</th>
                    <th>Versione</th>
                    <th>Collegato</th>
                    <th>Ultimo contatto</th>
                    <th>Ultimo giro riuscito</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.row.devices.map((d) => <DeviceRow key={d.id} d={d} onRevoked={load} />)}
                </tbody>
              </table>
            </div>
          )}

          <h2>Giri</h2>
          {!sweep && <p className="hint">Nessun giro</p>}
          {sweep && (
            <>
              <ul className="sweeps">
                {data.sweeps.map((s) => (
                  <li key={s.id}>
                    <button type="button" className={`btn btn--small${s.id === sweep.id ? ' btn--primary' : ''}`} aria-pressed={s.id === sweep.id} onClick={() => setSelected(s.id)}>
                      {sweepText(s)}
                    </button>
                  </li>
                ))}
              </ul>
              <Runs sweep={sweep} />
            </>
          )}

          <h2>Errori</h2>
          <ErrorGroups groups={data.errors} label="Errori dell'agente" />
        </>
      )}
    </Layout>
  );
}
