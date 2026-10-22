import { describe, expect, it, vi } from 'vitest';
import type { ServerReply } from '../../src/client';
import { createSendQueue } from '../../src/queue';
import type { QueueItem, QueueStore } from '../../src/queue-store';

function memoryStore(): QueueStore {
  let items: QueueItem[] = [];
  let seq = 0;
  return {
    add: async (i) => void items.push({ ...i, seq: ++seq }),
    first: async () => (items[0] ? { ...items[0] } : null),
    put: async (i) => void (items = items.map((x) => (x.seq === i.seq ? { ...i } : x))),
    remove: async (s) => void (items = items.filter((x) => x.seq !== s)),
    all: async () => items.map((x) => ({ ...x })),
    clear: async () => void (items = []),
  };
}

const RETRY = [30_000, 120_000, 600_000, 1_800_000, 3_600_000];
const DAY = 86_400_000;

function setup(replies: (path: string) => number = () => 200) {
  let now = 1_000;
  const store = memoryStore();
  const sent: string[] = [];
  const schedule = vi.fn();
  const onStuck = vi.fn();
  const onUnlinked = vi.fn(async () => {});
  const onRejected = vi.fn();
  const q = createSendQueue({
    store,
    post: async (path): Promise<ServerReply> => {
      sent.push(path);
      return { status: replies(path), data: { error: 'no' } };
    },
    now: () => now,
    timing: { retryMs: RETRY, giveUpMs: DAY },
    schedule, onStuck, onUnlinked, onRejected,
  });
  // enqueue non aspetta l'invio (il giro non si ferma per la rete): qui si aspetta la coda.
  const enq = async (o: { path: string; body: unknown }) => {
    await q.enqueue(o);
    await q.flush();
  };
  return { q, enq, store, sent, schedule, onStuck, onUnlinked, onRejected, tick: (ms: number) => (now += ms), now: () => now };
}

describe('coda d\'invio', () => {
  it('manda tutto nell\'ordine d\'inserimento', async () => {
    const t = setup();
    await t.enq({ path: '/connector/batches', body: 1 });
    await t.enq({ path: '/connector/runs', body: 2 });
    await t.enq({ path: '/connector/sweeps/x/finish', body: 3 });
    expect(t.sent).toEqual(['/connector/batches', '/connector/runs', '/connector/sweeps/x/finish']);
    expect(await t.store.all()).toEqual([]);
  });

  it('un errore del server ferma la coda: il secondo aspetta il primo; attese crescenti', async () => {
    let fail = true;
    const t = setup(() => (fail ? 503 : 200));
    await t.enq({ path: '/connector/batches', body: 1 });
    await t.store.add({ path: '/connector/runs', body: 2, createdAt: t.now(), attempts: 0, nextAt: t.now() });
    await t.q.flush();
    expect(t.sent).toEqual(['/connector/batches']);
    expect((await t.store.first())!.attempts).toBe(1);
    expect(t.schedule).toHaveBeenLastCalledWith(t.now() + 30_000);
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      const next = (await t.store.first())!.nextAt;
      waits.push(next - t.now());
      t.tick(next - t.now());
      await t.q.flush();
    }
    expect(waits).toEqual([30_000, 120_000, 600_000, 1_800_000, 3_600_000, 3_600_000]);
    fail = false;
    t.tick(3_600_000);
    await t.q.flush();
    expect(t.sent.slice(-2)).toEqual(['/connector/batches', '/connector/runs']);
    expect(await t.store.all()).toEqual([]);
  });

  it('un elemento nuovo (giro in corso) riprova subito il primo, anche prima dell\'attesa', async () => {
    let fail = true;
    const t = setup(() => (fail ? 503 : 200));
    await t.enq({ path: '/connector/batches', body: 1 });
    fail = false;
    t.tick(1_000);
    await t.enq({ path: '/connector/batches', body: 2 });
    expect(t.sent).toEqual(['/connector/batches', '/connector/batches', '/connector/batches']);
    expect(await t.store.all()).toEqual([]);
  });

  it('prima dell\'attesa non riprova, se non forzata', async () => {
    let fail = true;
    const t = setup(() => (fail ? 0 : 200));
    await t.enq({ path: '/connector/batches', body: 1 });
    fail = false;
    await t.q.flush();
    expect(t.sent).toHaveLength(1);
    await t.q.flush({ force: true });
    expect(t.sent).toHaveLength(2);
    expect(await t.store.all()).toEqual([]);
  });

  it('dopo 24 ore non riprova da sola: avviso una volta, poi solo forzata', async () => {
    let fail = true;
    const t = setup(() => (fail ? 503 : 200));
    await t.enq({ path: '/connector/batches', body: 1 });
    t.tick(DAY);
    await t.q.flush();
    await t.q.flush();
    expect(t.sent).toHaveLength(1);
    expect(t.onStuck).toHaveBeenCalledTimes(1);
    expect(t.onStuck).toHaveBeenLastCalledWith(true);
    expect(await t.q.state()).toEqual({ pending: 1, stuck: true });
    fail = false;
    await t.q.flush({ force: true });
    expect(await t.store.all()).toEqual([]);
    expect(t.onStuck).toHaveBeenLastCalledWith(false);
    expect(await t.q.state()).toEqual({ pending: 0, stuck: false });
  });

  it('un invio rifiutato dal server si scarta e la coda va avanti', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = setup((p) => (p === '/connector/batches' ? 400 : 200));
    await t.enq({ path: '/connector/batches', body: 1 });
    await t.enq({ path: '/connector/runs', body: 2 });
    expect(t.sent).toEqual(['/connector/batches', '/connector/runs']);
    expect(await t.store.all()).toEqual([]);
    expect(t.onRejected).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('401: dispositivo scollegato, la coda si svuota', async () => {
    let status = 503;
    const t = setup(() => status);
    await t.enq({ path: '/connector/batches', body: 1 });
    await t.enq({ path: '/connector/runs', body: 2 });
    status = 401;
    await t.q.flush({ force: true });
    expect(t.onUnlinked).toHaveBeenCalledTimes(1);
    expect(await t.store.all()).toEqual([]);
    expect(t.sent.every((p) => p === '/connector/batches')).toBe(true);
  });

  it('in attesa contano solo le pagine', async () => {
    const t = setup(() => 503);
    await t.enq({ path: '/connector/batches', body: 1 });
    await t.enq({ path: '/connector/runs', body: 2 });
    await t.enq({ path: '/connector/batches', body: 3 });
    expect(await t.q.state()).toEqual({ pending: 2, stuck: false });
  });

  it('due flush insieme mandano ogni elemento una volta', async () => {
    const t = setup();
    await t.store.add({ path: '/a', body: 1, createdAt: 0, attempts: 0, nextAt: 0 });
    await t.store.add({ path: '/b', body: 2, createdAt: 0, attempts: 0, nextAt: 0 });
    await Promise.all([t.q.flush(), t.q.flush(), t.q.flush({ force: true })]);
    expect(t.sent).toEqual(['/a', '/b']);
  });
});

describe('invii rifiutati', () => {
  it('si segnalano col percorso senza id, niente console', async () => {
    const warn = vi.spyOn(console, 'warn');
    const id = '7a1c3c58-1a7d-4c0e-9d55-3f3b8f0f2a10';
    const t = setup(() => 400);
    await t.enq({ path: `/connector/sweeps/${id}/finish`, body: 1 });
    expect(t.onRejected).toHaveBeenCalledWith('/connector/sweeps/:id/finish', 400, 'no');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
