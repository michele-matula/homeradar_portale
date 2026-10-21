import type { Me } from '@homeradar/shared/api/types';
import { useEffect, useState } from 'react';
import { api } from './api';
import { AdminUsers } from './pages/AdminUsers';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Privacy } from './pages/Privacy';
import { TokenPage } from './pages/TokenPage';
import { navigate, usePath } from './router';

/** Pagine aperte a tutti: link d'invito, reimpostazione, informativa. */
const PUBLIC = /^\/(attiva|reimposta)\/[^/]+$|^\/informativa$/;

export function App() {
  const path = usePath();
  // undefined: ancora da sapere; null: nessuna sessione.
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    api<{ user: Me }>('GET', '/api/me')
      .then((r) => setMe(r.user))
      // Senza sessione, sospeso o server irraggiungibile: si torna all'accesso, che mostra l'errore al tentativo.
      .catch(() => setMe(null));
  }, []);

  const isPublic = PUBLIC.test(path);
  useEffect(() => {
    if (me === undefined || isPublic) return;
    if (me === null && path !== '/accedi') navigate('/accedi', true);
    else if (me && path === '/accedi') navigate('/', true);
    else if (me && path.startsWith('/admin') && me.role !== 'admin') navigate('/', true);
    else if (me && path !== '/' && !path.startsWith('/admin')) navigate('/', true);
  }, [me, path, isPublic]);

  const signedIn = (user: Me) => {
    setMe(user);
    navigate('/');
  };
  const signedOut = () => {
    setMe(null);
    navigate('/accedi');
  };

  if (path === '/informativa') return <Privacy />;
  const token = /^\/(attiva|reimposta)\/([^/]+)$/.exec(path);
  if (token) return <TokenPage mode={token[1] === 'attiva' ? 'invite' : 'reset'} token={token[2]!} onDone={signedIn} />;
  if (me === undefined) return <div className="page page--center" aria-busy="true" />;
  if (me === null) return <Login onDone={signedIn} />;
  if (path === '/admin/utenti' && me.role === 'admin') return <AdminUsers me={me} onSignOut={signedOut} />;
  return <Home me={me} onSignOut={signedOut} />;
}
