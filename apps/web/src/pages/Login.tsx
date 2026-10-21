import type { Me } from '@homeradar/shared/api/types';
import { useState, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { Layout } from '../components/Layout';

export function Login({ onDone }: { onDone(user: Me): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone((await api<{ user: Me }>('POST', '/api/login', { email, password })).user);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Layout>
      <form className="card form" onSubmit={submit}>
        <h1>Accedi</h1>
        <label htmlFor="login-email">Email</label>
        <input id="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="login-password">Password</label>
        <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          Accedi
        </button>
        <p className="hint">Password dimenticata? Chiedi un link per reimpostarla a chi ti ha dato l'accesso.</p>
      </form>
    </Layout>
  );
}
