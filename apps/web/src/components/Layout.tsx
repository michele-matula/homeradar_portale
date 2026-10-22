import type { Me } from '@homeradar/shared/api/types';
import type { ReactNode } from 'react';
import { api } from '../api';
import { linkProps } from '../router';

/** Intestazione del portale con il marchio; con un utente collegato anche menu e «Esci». */
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
          <span className="brand__name">HomeRadar</span>
        </a>
        {me && (
          <nav className="topbar__nav">
            <a {...linkProps('/')}>
              Lead
              {dueRecalls > 0 && <span className="badge">{`${dueRecalls} da richiamare`}</span>}
            </a>
            <a {...linkProps('/impostazioni')}>Impostazioni</a>
            {me.role === 'admin' && <a {...linkProps('/admin/utenti')}>Utenti</a>}
            <button type="button" className="btn btn--ghost" onClick={signOut}>
              Esci
            </button>
          </nav>
        )}
      </header>
      <main className={wide ? 'content content--wide' : 'content'}>{children}</main>
    </div>
  );
}
