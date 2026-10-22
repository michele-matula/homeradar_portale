import type { ControlRow, ControlSweep, Me, UserStatus } from '@homeradar/shared/api/types';
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { Layout } from '../components/Layout';
import { dateTime } from '../format';
import { controlPath, linkProps, navigate } from '../router';

export const OUTCOME_LABELS: Record<NonNullable<ControlSweep['outcome']>, string> = {
  completed: 'completato', partial: 'parziale', stopped: 'fermato', interrupted: 'interrotto',
};
export const outcomeText = (s: ControlSweep) => (s.outcome ? OUTCOME_LABELS[s.outcome] : 'in corso');
const STATUS_TEXT: Record<UserStatus, string | null> = { active: null, invited: 'invitato', suspended: 'sospeso' };

/** Motivi del colore dell'agente, uno per riga. */
export function Reasons({ row }: { row: ControlRow }) {
  if (!row.reasons.length) return <span className="health__ok">Tutto a posto</span>;
  return (
    <ul className="reasons">
      {row.reasons.map((r) => <li key={r}>{r}</li>)}
    </ul>
  );
}

function devicesText(row: ControlRow): string {
  if (!row.devices.length) return 'nessuno';
  const last = Math.max(...row.devices.map((d) => d.lastSeenAt ?? 0));
  return `${row.devices.length} · ultimo contatto ${dateTime(last || null)}`;
}

/** Un agente per riga, con verde, arancio o rosso: clic per la scheda. */
export function Control({ me, onSignOut }: { me: Me; onSignOut(): void }) {
  const [rows, setRows] = useState<ControlRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ControlRow[]>('GET', '/api/admin/control')
      .then(setRows)
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  return (
    <Layout me={me} onSignOut={onSignOut} wide>
      <h1>Controllo</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!rows && !error && <p aria-busy="true">Caricamento…</p>}
      {rows && !rows.length && <p className="hint">Nessun agente</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table table--rows" aria-label="Agenti">
            <thead>
              <tr>
                <th>Agente</th>
                <th>Ultimo accesso</th>
                <th>Connettori</th>
                <th>Ultimo giro</th>
                <th>Errori 7 gg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className={`health health--${r.health}`} onClick={() => navigate(controlPath(r.userId))}>
                  <td>
                    <a {...linkProps(controlPath(r.userId))}>{r.email}</a>
                    {STATUS_TEXT[r.status] && <span className="hint"> · {STATUS_TEXT[r.status]}</span>}
                    <Reasons row={r} />
                  </td>
                  <td>{dateTime(r.lastSeenAt)}</td>
                  <td>{devicesText(r)}</td>
                  <td>
                    <div>{r.lastSweep ? `${dateTime(r.lastSweep.startedAt)} · ${outcomeText(r.lastSweep)}` : 'mai'}</div>
                    <div className="hint">{r.sweeps30d} giri in 30 gg</div>
                  </td>
                  <td>{r.errors7d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
