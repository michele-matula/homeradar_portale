import type { ErrorGroup, ErrorSource, Me } from '@homeradar/shared/api/types';
import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { ErrorGroups, SOURCE_LABELS } from '../components/ErrorGroups';
import { Layout } from '../components/Layout';

const FILTERS: (ErrorSource | null)[] = [null, 'portal', 'connector', 'server'];

/** Errori di portale, connettore e server degli ultimi 90 giorni. */
export function Errors({ me, onSignOut }: { me: Me; onSignOut(): void }) {
  const [source, setSource] = useState<ErrorSource | null>(null);
  const [groups, setGroups] = useState<ErrorGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGroups(null);
    setError(null);
    api<ErrorGroup[]>('GET', source ? `/api/admin/errors?source=${source}` : '/api/admin/errors')
      .then(setGroups)
      .catch((e: unknown) => setError(errorText(e)));
  }, [source]);

  return (
    <Layout me={me} onSignOut={onSignOut} wide>
      <h1>Errori</h1>
      <div className="actions" role="group" aria-label="Provenienza">
        {FILTERS.map((f) => (
          <button key={f ?? 'all'} type="button" className={`btn btn--small${f === source ? ' btn--primary' : ''}`} aria-pressed={f === source} onClick={() => setSource(f)}>
            {f ? SOURCE_LABELS[f] : 'Tutti'}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!groups && !error && <p aria-busy="true">Caricamento…</p>}
      {groups && <ErrorGroups groups={groups} label="Errori" />}
    </Layout>
  );
}
