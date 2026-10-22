/** Richiesta al server da mandare: percorso sotto `/connector` e corpo JSON. */
export interface Outgoing {
  path: string;
  body: unknown;
}

export interface QueueItem extends Outgoing {
  seq?: number;
  createdAt: number;
  attempts: number;
  nextAt: number;
}

export interface QueueStore {
  add(i: QueueItem): Promise<void>;
  first(): Promise<QueueItem | null>;
  put(i: QueueItem): Promise<void>;
  remove(seq: number): Promise<void>;
  all(): Promise<QueueItem[]>;
  clear(): Promise<void>;
}

const STORE = 'outbox';

const done = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** Coda persistente in IndexedDB: sopravvive allo spegnimento del service worker e al riavvio del browser. */
export function openQueueStore(name = 'homeradar-connector'): QueueStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    done(fn((await open()).transaction(STORE, mode).objectStore(STORE)));

  return {
    add: async (i) => void (await run('readwrite', (s) => s.add(i))),
    async first() {
      const cursor = await run('readonly', (s) => s.openCursor());
      return (cursor?.value as QueueItem | undefined) ?? null;
    },
    put: async (i) => void (await run('readwrite', (s) => s.put(i))),
    remove: async (seq) => void (await run('readwrite', (s) => s.delete(seq))),
    all: async () => (await run('readonly', (s) => s.getAll())) as QueueItem[],
    clear: async () => void (await run('readwrite', (s) => s.clear())),
  };
}
