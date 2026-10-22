import { useSyncExternalStore } from 'react';

const NAV_EVENT = 'hr:navigate';

const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
};

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function navigate(path: string, replace = false): void {
  if (path === window.location.pathname) return;
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** Link interno: niente ricaricamento della pagina. */
export function linkProps(path: string) {
  return {
    href: path,
    onClick: (e: { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean }) => {
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      navigate(path);
    },
  };
}

export const leadPath = (key: string): string => `/lead/${encodeURIComponent(key)}`;

/** Chiave del lead aperto in `/lead/<chiave>`; null se il percorso non è una scheda o non si decodifica. */
export function leadKeyOf(path: string): string | null {
  const m = /^\/lead\/([^/]+)$/.exec(path);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

export const controlPath = (userId: string): string => `/admin/controllo/${encodeURIComponent(userId)}`;

/** Agente della scheda `/admin/controllo/<id>`; null se il percorso non è una scheda o non si decodifica. */
export function controlUserOf(path: string): string | null {
  const m = /^\/admin\/controllo\/([^/]+)$/.exec(path);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}
