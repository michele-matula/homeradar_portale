import type { PayloadKind, PortalAdapter } from '@homeradar/shared/adapters/types';
import { pageProblem } from '@homeradar/shared/content/page-problem';
import type { ListingObservation, PageReport, ParseResult } from '@homeradar/shared/shared/types';

/** Messaggi dal content script al background. */
export type ReaderMessage =
  | { type: 'isSweepTab' }
  | { type: 'page'; url: string; observations: ListingObservation[]; newestId?: number; report: PageReport | null };

export interface ReaderDeps {
  adapter: PortalAdapter;
  send(m: ReaderMessage): Promise<unknown>;
  root: ParentNode;
  getUrl(): string;
}

function docOf(root: ParentNode): Document {
  return (root as Node).ownerDocument ?? (root as Document);
}

/**
 * Lettura delle pagine di ricerca durante il giro: niente badge né avvisi. Prima di leggere chiede al background se
 * questa è la scheda del giro; se non lo è non legge nulla.
 */
export function createReader({ adapter, send, root, getUrl }: ReaderDeps) {
  /** Modalità DOM: ID ed errori già inviati per l'URL corrente. */
  const sent = new Set<number>();
  const sentErrors = new Set<string>();
  let scannedUrl: string | null = null;

  const isSearch = () => adapter.pageKind(getUrl()) === 'search';
  const inSweep = async () => (await send({ type: 'isSweepTab' })) === true;

  async function process(result: ParseResult): Promise<void> {
    // Una pagina di verifica o inesistente non è una ricerca vuota: al giro va solo il problema.
    if (await checkProblem(docOf(root), false)) return;
    const unknownSellers = result.observations.filter((o) => o.sellerType === 'unknown').length;
    const report: PageReport | null = result.page
      ? { portal: adapter.portal, url: getUrl(), ...result.page, blocked: false, notFound: false, parseErrors: result.errors.length + unknownSellers }
      : null;
    if (!report && !result.observations.length) return;
    await send({
      type: 'page', url: getUrl(), observations: result.observations, report, ...(result.newestId != null ? { newestId: result.newestId } : {}),
    });
  }

  /** Pagina di ricerca senza dati perché il portale chiede una verifica o non trova la pagina: lo dice al giro. */
  async function checkProblem(doc: Document, ask = true): Promise<boolean> {
    if (!isSearch()) return false;
    const problem = pageProblem(doc);
    if (!problem) return false;
    if (ask && !(await inSweep())) return true;
    const url = getUrl();
    await send({
      type: 'page', url, observations: [],
      report: { portal: adapter.portal, url, results: 0, privates: 0, lastPage: true, blocked: problem === 'blocked', notFound: problem === 'notFound', parseErrors: 0 },
    });
    return true;
  }

  async function handle(kind: PayloadKind, url: string, payload: unknown): Promise<void> {
    if (!adapter.parsePayload || !isSearch()) return;
    if (!(await inSweep())) return;
    await process(adapter.parsePayload(kind, url, payload));
  }

  /** Modalità DOM: manda le card nuove; senza card nuove non manda nulla. */
  async function scan(): Promise<void> {
    if (!adapter.readDocument || !isSearch()) return;
    if (!(await inSweep())) return;
    const url = getUrl();
    const isNewUrl = url !== scannedUrl;
    if (isNewUrl) {
      scannedUrl = url;
      sent.clear();
      sentErrors.clear();
    }
    const result = adapter.readDocument(root, url);
    const fresh = result.observations.filter((o) => !sent.has(o.portalId));
    if (!isNewUrl && !fresh.length) return;
    // Solo gli errori nuovi: quelli già mandati con la prima lettura non contano due volte.
    const freshErrors = result.errors.filter((e) => !sentErrors.has(e));
    for (const o of fresh) sent.add(o.portalId);
    for (const e of freshErrors) sentErrors.add(e);
    await process({ ...result, observations: fresh, errors: freshErrors });
  }

  return { handle, scan, checkProblem };
}
