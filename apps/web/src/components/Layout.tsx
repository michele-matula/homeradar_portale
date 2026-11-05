import type { Me } from '@homeradar/shared/api/types';
import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { linkProps } from '../router';
import { Footer } from './Footer';

/** Utente collegato: iniziale ed email; sotto i 600 px solo l'iniziale, che mostra l'email al tocco. */
function Account({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? 'account account--open' : 'account'}>
      <button type="button" className="account__avatar" aria-label={`Account: ${email}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {email.charAt(0).toUpperCase()}
      </button>
      <span className="account__email" title={email}>
        {email}
      </span>
    </div>
  );
}

/** Intestazione del portale con il marchio e piè di pagina; con un utente collegato anche menu, account e «Esci». */
export function Layout({ me, onSignOut, dueRecalls = 0, wide = false, children }: {
  me?: Me;
  onSignOut?(): void;
  /** Richiami di oggi o scaduti, accanto a «Lead». */
  dueRecalls?: number;
  /** Pagina larga: lista e scheda affiancate. */
  wide?: boolean;
  children: ReactNode;
}) {
  const signOut = async () => {
    try {
      await api('POST', '/api/logout');
    } finally {
      onSignOut?.();
    }
  };
  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" {...linkProps('/')}>
          <img className="brand__logo" src="/icon-192.png" alt="" width="30" height="30" />
          <span className="brand__name">HomeRadar</span>
        </a>
        {me && (
          <nav className="topbar__nav">
            <a {...linkProps('/')}>
              Lead
              {dueRecalls > 0 && <span className="badge">{`${dueRecalls} da richiamare`}</span>}
            </a>
            <a {...linkProps('/impostazioni')}>Impostazioni</a>
            {me.role === 'admin' && (
              <>
                <a {...linkProps('/admin/utenti')}>Utenti</a>
                <a {...linkProps('/admin/controllo')}>Controllo</a>
                <a {...linkProps('/admin/errori')}>Errori</a>
              </>
            )}
            <Account email={me.email} />
            <button type="button" className="btn btn--ghost" onClick={signOut}>
              Esci
            </button>
          </nav>
        )}
      </header>
      <main className={wide ? 'content content--wide' : 'content'}>{children}</main>
      <Footer />
    </div>
  );
}
