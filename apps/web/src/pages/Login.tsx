import type { Me } from '@homeradar/shared/api/types';
import { useState, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { Footer } from '../components/Footer';

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
    <div className="page login">
      <div className="login__main">
        <section className="login__intro">
          <div className="login__brand">
            <img src="/icon-192.png" alt="" width="56" height="56" />
            <span>HomeRadar</span>
          </div>
          <p className="login__claim">I privati che vendono nella tua zona, in un posto solo.</p>
          <ul className="login__points">
            <li>Annunci di privati raccolti ogni giorno dai portali</li>
            <li>Stati, note e richiami per non perdere nessun contatto</li>
          </ul>
        </section>
        <div className="login__side">
          <form className="login__form" onSubmit={submit}>
            <h1>Bentornato</h1>
            <p className="login__lead">Accedi con l'email del tuo invito.</p>
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
        </div>
      </div>
      <Footer />
    </div>
  );
}
