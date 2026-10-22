import { MAX_ERRORS_PER_REPORT } from '@homeradar/shared/api/types';

/** Gli errori di questo intervallo partono insieme: un errore in ciclo non manda una richiesta per volta. */
const SEND_AFTER_MS = 1000;

let pending: { message: string; context: string; at: number }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Percorso senza chiavi dei lead, id e token: gli errori della stessa pagina si raggruppano e non portano dati. */
export function routeOf(path: string): string {
  return path
    .replace(/^\/lead\/[^/]+$/, '/lead/:chiave')
    .replace(/^\/(attiva|reimposta)\/[^/]+$/, '/$1/:token')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
}

function send(): void {
  timer = null;
  const errors = pending.slice(0, MAX_ERRORS_PER_REPORT);
  pending = [];
  // fetch diretto, mai api(): un invio che fallisce non diventa un altro errore, e non si ritenta.
  fetch('/api/errors', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: __APP_VERSION__, errors }),
    keepalive: true,
  }).catch(() => {});
}

/** Errore del portale per il server: si mette in coda e parte entro un secondo insieme agli altri. */
export function reportError(message: string): void {
  pending.push({ message: message.slice(0, 2000), context: routeOf(window.location.pathname), at: Date.now() });
  timer ??= setTimeout(send, SEND_AFTER_MS);
}

const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** Errori non gestiti della pagina. */
export function installErrorReporting(): void {
  window.addEventListener('error', (e) => reportError(e.error ? describe(e.error) : e.message));
  window.addEventListener('unhandledrejection', (e) => reportError(describe(e.reason)));
}
