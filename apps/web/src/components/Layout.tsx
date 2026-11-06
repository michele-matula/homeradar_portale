import type { Me } from '@homeradar/shared/api/types';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { linkProps, usePath } from '../router';
import { Footer } from './Footer';

type NavItem = { path: string; label: string; badge?: string };

/** Voci del menu; «Lead» è attiva anche sulla scheda di un lead, le altre anche sulle loro sottopagine. */
function navItems(me: Me, dueRecalls: number): NavItem[] {
  const items: NavItem[] = [
    { path: '/', label: 'Lead', badge: dueRecalls > 0 ? `${dueRecalls} da richiamare` : undefined },
    { path: '/impostazioni', label: 'Impostazioni' },
  ];
  if (me.role === 'admin') {
    items.push({ path: '/admin/utenti', label: 'Utenti' }, { path: '/admin/controllo', label: 'Controllo' }, { path: '/admin/errori', label: 'Errori' });
  }
  return items;
}

const isCurrent = (item: string, path: string) =>
  item === '/' ? path === '/' || path.startsWith('/lead/') : path === item || path.startsWith(`${item}/`);

function NavLinks({ items, path, className }: { items: NavItem[]; path: string; className: string }) {
  return (
    <>
      {items.map((it) => (
        <a key={it.path} className={className} aria-current={isCurrent(it.path, path) ? 'page' : undefined} {...linkProps(it.path)}>
          {it.label}
          {it.badge && <span className="badge">{it.badge}</span>}
        </a>
      ))}
    </>
  );
}

/**
 * Utente collegato: iniziale (ed email sopra i 600 px) che apre il menu dell'account con «Esci».
 * Sotto i 600 px il menu contiene anche le voci di navigazione, che la barra non mostra.
 */
function Account({ me, items, path, alert, onSignOut }: { me: Me; items: NavItem[]; path: string; alert: boolean; onSignOut(): void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // Cambiando pagina il menu si chiude.
  useEffect(() => setOpen(false), [path]);

  return (
    <div className="account" ref={box}>
      <button
        type="button"
        className="account__button"
        aria-label={`Account: ${me.email}`}
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="account__avatar" aria-hidden="true">
          {me.email.charAt(0).toUpperCase()}
          {alert && <span className="account__dot" />}
        </span>
        <span className="account__email">{me.email}</span>
        <span className="account__caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="account__menu" id="account-menu">
          <p className="account__who">
            <span className="account__label">Collegato come</span>
            <span className="account__address">{me.email}</span>
          </p>
          <nav className="account__nav" aria-label="Menu">
            <NavLinks items={items} path={path} className="account__item" />
          </nav>
          <button type="button" className="account__item account__signout" onClick={onSignOut}>
            Esci
          </button>
        </div>
      )}
    </div>
  );
}

/** Intestazione del portale con il marchio e piè di pagina; con un utente collegato anche menu e account (con «Esci»). */
export function Layout({ me, onSignOut, dueRecalls = 0, wide = false, children }: {
  me?: Me;
  onSignOut?(): void;
  /** Richiami di oggi o scaduti, accanto a «Lead». */
  dueRecalls?: number;
  /** Pagina larga: lista e scheda affiancate. */
  wide?: boolean;
  children: ReactNode;
}) {
  const path = usePath();
  const signOut = async () => {
    try {
      await api('POST', '/api/logout');
    } finally {
      onSignOut?.();
    }
  };
  const items = me ? navItems(me, dueRecalls) : [];
  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" {...linkProps('/')}>
          <img className="brand__logo" src="/icon-192.png" alt="" width="30" height="30" />
          <span className="brand__name">HomeRadar</span>
        </a>
        {me && (
          <div className="topbar__end">
            <nav className="topbar__nav" aria-label="Sezioni">
              <NavLinks items={items} path={path} className="topbar__link" />
            </nav>
            <Account me={me} items={items} path={path} alert={dueRecalls > 0} onSignOut={() => void signOut()} />
          </div>
        )}
      </header>
      <main className={wide ? 'content content--wide' : 'content'}>{children}</main>
      <Footer />
    </div>
  );
}
