import { useEffect, useState } from 'react';
import type { DeviceInfo } from '@homeradar/shared/api/connector';
import { api, errorText } from '../api';

const formatDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString('it-IT') : 'mai');

/** Computer dove il connettore è collegato all'account; scollegarne uno ne invalida il token. */
export function Devices({ reload = 0 }: { /** Cambia quando un computer si collega: la lista si rilegge. */ reload?: number }) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<DeviceInfo[]>('GET', '/api/devices').then(setDevices, (e: unknown) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, [reload]);

  async function unlink(id: string) {
    setError(null);
    try {
      await api('DELETE', `/api/devices/${id}`);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (!devices.length && !error) return null;
  return (
    <section className="card">
      <h2>I tuoi computer</h2>
      <ul className="devices">
        {devices.map((d) => (
          <li key={d.id} className="device">
            <span>
              <strong>{d.name}</strong> <span className="hint">· ultimo uso {formatDate(d.lastSeenAt)}</span>
            </span>
            <button type="button" className="btn btn--small" onClick={() => void unlink(d.id)}>
              Scollega
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
