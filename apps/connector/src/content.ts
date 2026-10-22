import './zod-config';
import type { PortalAdapter } from '@homeradar/shared/adapters/types';
import { isBridgeMessage } from './bridge';
import { createReader, type ReaderMessage } from './reader';

/** La parte del contesto WXT che serve qui. */
export interface ScriptContext {
  onInvalidated(cb: () => void): () => void;
}

const send = (m: ReaderMessage) => browser.runtime.sendMessage(m);
const warn = (err: unknown) => console.warn('[HomeRadar]', err);
/** Verifica di DataDome o pagina inesistente: nessun dato arriverà, il giro lo deve sapere subito. */
const PROBLEM_CHECK_MS = 2500;

/** Portali con bridge (Immobiliare, Subito): legge i payload che la pagina ha già caricato, solo nella scheda del giro. */
export function runPayloadReader(adapter: PortalAdapter): void {
  const reader = createReader({ adapter, send, root: document, getUrl: () => location.href });
  window.addEventListener('message', (event) => {
    if (event.source !== window || !isBridgeMessage(event.data)) return;
    reader.handle(event.data.kind, event.data.url, event.data.payload).catch(warn);
  });
  setTimeout(() => void reader.checkProblem(document).catch(warn), PROBLEM_CHECK_MS);
}

/** Portali renderizzati lato server (Idealista, CasaDaPrivato): legge le card mostrate, anche quelle caricate dopo. */
export function runDomReader(ctx: ScriptContext, adapter: PortalAdapter): void {
  const reader = createReader({ adapter, send, root: document, getUrl: () => location.href });
  const scan = () => reader.scan().catch(warn);
  scan();
  setTimeout(() => void reader.checkProblem(document).catch(warn), PROBLEM_CHECK_MS);
  let pending: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(scan, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  ctx.onInvalidated(() => observer.disconnect());
}
