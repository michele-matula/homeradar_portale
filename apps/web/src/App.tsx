import type { Me } from '@homeradar/shared/api/types';
import { useEffect, useState } from 'react';
import { api } from './api';
import { AdminUsers } from './pages/AdminUsers';
import { Control } from './pages/Control';
import { ControlAgent } from './pages/ControlAgent';
import { Errors } from './pages/Errors';
import { Leads } from './pages/Leads';
import { Login } from './pages/Login';
import { Privacy } from './pages/Privacy';
import { Settings } from './pages/Settings';
import { TokenPage } from './pages/TokenPage';
import { controlUserOf, leadKeyOf, navigate, usePath } from './router';

/** Pagine aperte a tutti: link d'invito, reimpostazione, informativa. */
const PUBLIC = /^\/(attiva|reimposta)\/[^/]+$|^\/informativa$/;

/** Pagine dell'agente; l'admin ha in più `/admin/*`. */
const isAgentPath = (path: string) => path === '/' || path === '/impostazioni' || leadKeyOf(path) != null;

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
    else if (me && !isAgentPath(path) && !path.startsWith('/admin')) navigate('/', true);
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
  if (me.role === 'admin') {
    if (path === '/admin/utenti') return <AdminUsers me={me} onSignOut={signedOut} />;
    if (path === '/admin/controllo') return <Control me={me} onSignOut={signedOut} />;
    if (path === '/admin/errori') return <Errors me={me} onSignOut={signedOut} />;
    const userId = controlUserOf(path);
    if (userId) return <ControlAgent key={userId} me={me} onSignOut={signedOut} userId={userId} />;
  }
  if (path === '/impostazioni') return <Settings me={me} onSignOut={signedOut} />;
  // `/` e `/lead/<chiave>` sono la stessa pagina: aprire e chiudere una scheda non perde filtri e lista.
  return <Leads me={me} onSignOut={signedOut} />;
}
