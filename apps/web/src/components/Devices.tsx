import { useCallback, useEffect, useState } from 'react';
import type { DeviceInfo } from '@homeradar/shared/api/connector';
import type { ConnectorState } from '@homeradar/shared/api/connector-messages';
import { formatDateTime } from '@homeradar/shared/shared/format';
import { api, errorText } from '../api';
import { chromeConnector, type ConnectorPort } from '../connector';

const formatDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString('it-IT') : 'mai');
/** Lo stato online si rilegge da solo mentre la pagina è aperta. */
const RELOAD_MS = 30_000;

/**
 * Computer dove il connettore è collegato all'account: nome scelto, «Avvia dal telefono» e stato online.
 * Scollegarne uno ne invalida il token.
 */
export function Devices({ reload = 0, connector = chromeConnector }: {
  /** Cambia quando un computer si collega: la lista si rilegge. */
  reload?: number;
  connector?: ConnectorPort;
}) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Id del computer da cui si guarda la pagina (dal connettore), per «(questo computer)». */
  const [here, setHere] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);

  const load = useCallback(() => api<DeviceInfo[]>('GET', '/api/devices').then(setDevices, (e: unknown) => setError(errorText(e))), []);
  useEffect(() => {
    void load();
    const h = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, RELOAD_MS);
    return () => clearInterval(h);
  }, [reload, load]);
  useEffect(() => {
    void connector.send<ConnectorState>({ type: 'ping' }).then((r) => setHere(r?.ok ? r.data.deviceId : null), () => {});
  }, [connector]);

  async function act(f: () => Promise<unknown>): Promise<void> {
    setError(null);
    try {
      await f();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }
  const unlink = (id: string) => act(() => api('DELETE', `/api/devices/${id}`));
  const toggle = (d: DeviceInfo) =>
    act(async () => {
      await api('PATCH', `/api/devices/${d.id}`, { remote: !d.remote });
      // Il connettore di questo computer controlla subito, senza aspettare il suo allarme.
      if (d.id === here) void connector.send({ type: 'remoteChanged' }).catch(() => {});
    });
  function rename(id: string, value: string): void {
    setRenaming(null);
    void act(() => api('PATCH', `/api/devices/${id}`, { label: value.trim() || null }));
  }

  if (!devices.length && !error) return null;
  return (
    <section className="card">
      <h2>I tuoi computer</h2>
      <ul className="devices">
        {devices.map((d) => {
          const shown = d.label ?? d.name;
          const status = !d.remote || !d.remoteReady
            ? `ultimo uso ${formatDate(d.lastSeenAt)}`
            : d.online
              ? 'Online ora'
              : `Non raggiungibile · visto l'ultima volta ${d.lastSeenAt ? formatDateTime(d.lastSeenAt) : 'mai'}`;
          return (
            <li key={d.id} className="device">
              <div className="device__top">
                <span>
                  {d.remote && d.remoteReady && <span className={d.online ? 'dot dot--on' : 'dot'} aria-hidden="true" />}
                  {renaming?.id === d.id ? (
                    <input
                      aria-label="Nuovo nome"
                      className="device__rename"
                      autoFocus
                      maxLength={60}
                      value={renaming.value}
                      onChange={(e) => setRenaming({ id: d.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') rename(d.id, renaming.value);
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : (
                    <strong>{shown}</strong>
                  )}
                  {d.id === here && <span className="hint"> (questo computer)</span>}
                </span>
                {d.remoteReady ? (
                  <label className="device__remote">
                    <input type="checkbox" checked={d.remote} onChange={() => void toggle(d)} />
                    Avvia dal telefono
                  </label>
                ) : (
                  <span className="hint">Aggiorna il connettore per usare l'avvio dal telefono (Chrome lo fa da solo, di solito entro un giorno)</span>
                )}
              </div>
              <div className="device__bottom hint">
                <span>
                  {status}
                  {d.label && ` · ${d.name}`}
                </span>
                <span>
                  <button type="button" className="btn btn--small" onClick={() => setRenaming({ id: d.id, value: shown })}>
                    Rinomina
                  </button>{' '}
                  <button type="button" className="btn btn--small" onClick={() => void unlink(d.id)}>
                    Scollega
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="hint">
        Per avviare le ricerche dal telefono il computer deve essere acceso, non in sospensione, con Chrome aperto. Consiglio: in Windows
        imposta «Sospensione: mai» quando è collegato alla corrente.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
