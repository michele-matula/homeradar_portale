import type { ServerReply } from './client';

export const MAX_STORED_ERRORS = 50;
const MAX_MESSAGE = 2000;
/** Come per la coda: oltre un giorno un errore non si manda più. */
const MAX_AGE_MS = 86_400_000;
/** Il server ne accetta al più tanti per richiesta (`MAX_ERRORS_PER_REPORT`). */
const PER_POST = 20;
/** Rifiuti definitivi: rimandare lo stesso corpo darebbe la stessa risposta (429 = oltre la quota dell'ora). */
const DROP = new Set([400, 413, 429]);

export interface StoredError {
  message: string;
  context?: string;
  at: number;
}

export interface ErrorLogDeps {
  load(): Promise<StoredError[]>;
  save(list: StoredError[]): Promise<void>;
  post(path: string, body: unknown): Promise<ServerReply>;
  now(): number;
  version: string;
}

/**
 * Errori del connettore per il server: un piccolo buffer persistente, mandato a parte rispetto alla coda d'invio (non la
 * blocca mai). Il server li ripulisce prima di salvarli.
 */
export function createErrorLog(d: ErrorLogDeps) {
  // Un'operazione alla volta: report e flush leggono e riscrivono la stessa lista.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };

  return {
    report: (message: string, context?: string) => serial(async () => {
      const list = [...(await d.load()), { message: message.slice(0, MAX_MESSAGE), ...(context ? { context } : {}), at: d.now() }];
      await d.save(list.slice(-MAX_STORED_ERRORS));
    }),

    flush: () => serial(async () => {
      let list = (await d.load()).filter((e) => d.now() - e.at < MAX_AGE_MS);
      while (list.length) {
        const chunk = list.slice(0, PER_POST);
        const r = await d.post('/connector/errors', { version: d.version, errors: chunk });
        if (r.status === 401) {
          list = [];
          break;
        }
        if ((r.status >= 200 && r.status < 300) || DROP.has(r.status)) list = list.slice(chunk.length);
        else break;
      }
      await d.save(list);
    }),
  };
}
