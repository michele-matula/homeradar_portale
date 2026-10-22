import { describe, expect, it } from 'vitest';
import { openQueueStore, type QueueItem } from '../../src/queue-store';

const item = (path: string): QueueItem => ({ path, body: { path }, createdAt: 1, attempts: 0, nextAt: 1 });
let n = 0;
const fresh = () => `coda-${++n}`;

describe('archivio della coda (IndexedDB)', () => {
  it('in ordine di inserimento', async () => {
    const s = openQueueStore(fresh());
    await s.add(item('/a'));
    await s.add(item('/b'));
    await s.add(item('/c'));
    expect((await s.first())?.path).toBe('/a');
    expect((await s.all()).map((i) => i.path)).toEqual(['/a', '/b', '/c']);
  });

  it('aggiorna, toglie, svuota', async () => {
    const s = openQueueStore(fresh());
    await s.add(item('/a'));
    await s.add(item('/b'));
    const first = (await s.first())!;
    await s.put({ ...first, attempts: 3 });
    expect((await s.first())?.attempts).toBe(3);
    await s.remove(first.seq!);
    expect((await s.first())?.path).toBe('/b');
    await s.clear();
    expect(await s.first()).toBeNull();
    expect(await s.all()).toEqual([]);
  });

  it('i dati restano riaprendo lo stesso archivio', async () => {
    const name = fresh();
    await openQueueStore(name).add(item('/a'));
    expect((await openQueueStore(name).all()).map((i) => i.path)).toEqual(['/a']);
  });
});
