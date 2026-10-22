import { errorOf, type ServerReply } from './client';
import type { Outgoing, QueueItem, QueueStore } from './queue-store';
import type { ConnectorTiming } from './timing';

/** Rifiuti definitivi: rimandare lo stesso corpo darebbe la stessa risposta. */
const REJECTED = new Set([400, 404, 413]);

export interface SendQueueDeps {
  store: QueueStore;
  post(path: string, body: unknown): Promise<ServerReply>;
  now(): number;
  timing: Pick<ConnectorTiming, 'retryMs' | 'giveUpMs'>;
  /** Prossimo tentativo: il background lo fissa con un timer e con chrome.alarms (il worker può spegnersi). */
  schedule(at: number): void;
  /** Un invio non riesce da più di `giveUpMs` (o non più): chiamato solo al cambio. */
  onStuck(stuck: boolean): void;
  /** Il server non riconosce più il dispositivo. */
  onUnlinked(): Promise<void>;
}

/**
 * Coda d'invio: un elemento alla volta, nell'ordine in cui nascono (lotti, esiti, fine del giro). Il primo che non
 * passa ferma gli altri finché non riesce, con attese crescenti.
 */
export function createSendQueue(d: SendQueueDeps) {
  let stuck = false;
  let running: Promise<void> = Promise.resolve();

  const tooOld = (i: QueueItem) => d.now() - i.createdAt >= d.timing.giveUpMs;
  const delay = (attempts: number) => d.timing.retryMs[Math.min(attempts, d.timing.retryMs.length) - 1]!;

  async function updateStuck(): Promise<void> {
    const now = (await d.store.all()).some(tooOld);
    if (now !== stuck) {
      stuck = now;
      d.onStuck(now);
    }
  }

  async function pass(force: boolean): Promise<void> {
    for (;;) {
      const item = await d.store.first();
      if (!item) break;
      if (!force && (tooOld(item) || item.nextAt > d.now())) break;
      const reply = await d.post(item.path, item.body);
      if (reply.status >= 200 && reply.status < 300) {
        await d.store.remove(item.seq!);
        continue;
      }
      if (REJECTED.has(reply.status)) {
        console.warn('[HomeRadar] invio scartato', item.path, reply.status, errorOf(reply));
        await d.store.remove(item.seq!);
        continue;
      }
      if (reply.status === 401) {
        await d.store.clear();
        await d.onUnlinked();
        break;
      }
      const attempts = item.attempts + 1;
      const nextAt = d.now() + delay(attempts);
      await d.store.put({ ...item, attempts, nextAt });
      if (!tooOld(item)) d.schedule(nextAt);
      break;
    }
    await updateStuck();
  }

  /** Un passaggio alla volta: chi chiama durante un passaggio aspetta quello e poi fa il suo. */
  function flush(opts: { force?: boolean } = {}): Promise<void> {
    const p = running.then(() => pass(opts.force ?? false));
    running = p.catch(() => {});
    return p;
  }

  return {
    /**
     * Mette in coda e avvia l'invio senza aspettarlo: il giro non si ferma per la rete. Un elemento nuovo vuol dire giro
     * in corso: si riprova subito anche il primo, senza aspettare l'attesa (il server chiude un giro fermo da 15 minuti).
     */
    async enqueue(o: Outgoing): Promise<void> {
      const now = d.now();
      await d.store.add({ path: o.path, body: o.body, createdAt: now, attempts: 0, nextAt: now });
      flush({ force: true }).catch((err: unknown) => console.warn('[HomeRadar] coda d\'invio', err));
    },
    flush,
    async state(): Promise<{ pending: number; stuck: boolean }> {
      const items = await d.store.all();
      return { pending: items.filter((i) => i.path === '/connector/batches').length, stuck: items.some(tooOld) };
    },
  };
}
