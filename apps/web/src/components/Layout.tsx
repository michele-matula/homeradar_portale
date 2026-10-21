import type { Me } from '@homeradar/shared/api/types';
import type { ReactNode } from 'react';
import { api } from '../api';
import { linkProps } from '../router';

/** Intestazione del portale con il marchio; con un utente collegato anche menu e «Esci». */
export function Layout({ me, onSignOut, children }: { me?: Me; onSignOut?(): void; children: ReactNode }) {
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
            {me.role === 'admin' && <a {...linkProps('/admin/utenti')}>Utenti</a>}
            <button type="button" className="btn btn--ghost" onClick={signOut}>
              Esci
            </button>
          </nav>
        )}
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
