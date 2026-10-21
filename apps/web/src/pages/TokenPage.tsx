import { PRIVACY_VERSION, type Me, type TokenInfo } from '@homeradar/shared/api/types';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { Layout } from '../components/Layout';

/** Attivazione dell'account (link d'invito) o nuova password (link di reimpostazione). */
export function TokenPage({ mode, token, onDone }: { mode: 'invite' | 'reset'; token: string; onDone(user: Me): void }) {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invite = mode === 'invite';

  useEffect(() => {
    api<TokenInfo>('GET', `/api/tokens/${encodeURIComponent(token)}`)
      .then((t) => (t.kind === mode ? setInfo(t) : setLoadError('Link non valido o scaduto')))
      .catch((e: unknown) => setLoadError(errorText(e)));
  }, [token, mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== again) {
      setError('Le password non coincidono');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = invite ? { password, privacyVersion: PRIVACY_VERSION } : { password };
      onDone((await api<{ user: Me }>('POST', `/api/tokens/${encodeURIComponent(token)}`, body)).user);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Layout>
      <form className="card form" onSubmit={submit}>
        <h1>{invite ? 'Attiva il tuo account' : 'Nuova password'}</h1>
        {loadError && <p className="error" role="alert">{loadError}</p>}
        {!info && !loadError && <p aria-busy="true">Controllo del link…</p>}
        {info && (
          <>
            <p className="form__account">
              Account: <strong>{info.email}</strong>
            </p>
            <label htmlFor="token-password">Nuova password</label>
            <input id="token-password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <label htmlFor="token-again">Ripeti la password</label>
            <input id="token-again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
            <p className="hint">Almeno 10 caratteri.</p>
            {invite && (
              <label className="check">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span>
                  Ho letto l'<a href="/informativa" target="_blank" rel="noreferrer">informativa</a>
                </span>
              </label>
            )}
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="btn btn--primary" disabled={busy || (invite && !accepted)}>
              {invite ? "Attiva l'account" : 'Salva la password'}
            </button>
          </>
        )}
      </form>
    </Layout>
  );
}
