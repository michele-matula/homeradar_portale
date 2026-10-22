import type { ErrorGroup, ErrorSource } from '@homeradar/shared/api/types';
import { dateTime } from '../format';

export const SOURCE_LABELS: Record<ErrorSource, string> = { portal: 'Portale', connector: 'Connettore', server: 'Server' };

const deviceText = (d: ErrorGroup['devices'][number]) => `${d.name ?? 'connettore'}${d.revoked ? ' (connettore revocato)' : ''}`;

/** Errori raggruppati per provenienza, versione e messaggio: pagina «Errori» e scheda dell'agente. */
export function ErrorGroups({ groups, label }: { groups: ErrorGroup[]; label: string }) {
  if (!groups.length) return <p className="hint">Nessun errore negli ultimi 90 giorni</p>;
  return (
    <div className="table-wrap">
      <table className="table" aria-label={label}>
        <thead>
          <tr>
            <th>Provenienza</th>
            <th>Messaggio</th>
            <th>Versione</th>
            <th>Volte</th>
            <th>Prima</th>
            <th>Ultima</th>
            <th>Agenti e connettori</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={`${g.source}|${g.version}|${g.message}`}>
              <td>{SOURCE_LABELS[g.source]}</td>
              <td>
                <code className="table__message">{g.message}</code>
                {g.context && <div className="hint">{g.context}</div>}
              </td>
              <td>{g.version}</td>
              <td>{g.count}</td>
              <td>{dateTime(g.firstAt)}</td>
              <td>{dateTime(g.lastAt)}</td>
              <td>
                {g.agents.map((a) => <div key={a}>{a}</div>)}
                {g.devices.map((d) => <div key={deviceText(d)} className="hint">{deviceText(d)}</div>)}
                {!g.agents.length && !g.devices.length && '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
