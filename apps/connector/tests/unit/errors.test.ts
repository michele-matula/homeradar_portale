import { describe, expect, it } from 'vitest';
import type { ServerReply } from '../../src/client';
import { createErrorLog, MAX_STORED_ERRORS, type StoredError } from '../../src/errors';

const DAY = 86_400_000;

function setup(status: (n: number) => number = () => 204) {
  let stored: StoredError[] = [];
  let now = 10 * DAY;
  const posts: { path: string; body: { version: string; errors: StoredError[] } }[] = [];
  const log = createErrorLog({
    load: async () => stored.map((e) => ({ ...e })),
    save: async (l) => void (stored = l.map((e) => ({ ...e }))),
    post: async (path, body): Promise<ServerReply> => {
      posts.push({ path, body: body as never });
      return { status: status(posts.length), data: null };
    },
    now: () => now,
    version: '0.4.0',
  });
  return { log, posts, stored: () => stored, tick: (ms: number) => (now += ms) };
}

describe('errori del connettore', () => {
  it('tronca i messaggi e tiene al più 50 voci, le più recenti', async () => {
    const t = setup();
    await t.log.report('x'.repeat(3000), 'idealista');
    for (let i = 0; i < MAX_STORED_ERRORS; i++) await t.log.report(`E${i}`);
    expect(t.stored()).toHaveLength(MAX_STORED_ERRORS);
    expect(t.stored()[0]!.message).toBe('E0');
    const t2 = setup();
    await t2.log.report('x'.repeat(3000), 'idealista');
    expect(t2.stored()[0]).toMatchObject({ message: 'x'.repeat(2000), context: 'idealista' });
  });

  it('manda a blocchi di 20 con la versione e toglie quelli inviati', async () => {
    const t = setup();
    for (let i = 0; i < 25; i++) await t.log.report(`E${i}`);
    await t.log.flush();
    expect(t.posts.map((p) => [p.path, p.body.errors.length, p.body.version])).toEqual([['/connector/errors', 20, '0.4.0'], ['/connector/errors', 5, '0.4.0']]);
    expect(t.stored()).toEqual([]);
  });

  it('su 400 e 429 scarta, su rete o 5xx tiene, su 401 svuota', async () => {
    for (const [status, left] of [[400, 0], [429, 0], [0, 1], [503, 1], [401, 0]] as const) {
      const t = setup(() => status);
      await t.log.report('E');
      await t.log.flush();
      expect(t.stored()).toHaveLength(left);
      expect(t.posts).toHaveLength(1);
    }
  });

  it('le voci più vecchie di 24 ore si scartano senza inviarle', async () => {
    const t = setup();
    await t.log.report('Vecchio');
    t.tick(DAY + 1);
    await t.log.report('Nuovo');
    await t.log.flush();
    expect(t.posts[0]!.body.errors.map((e) => e.message)).toEqual(['Nuovo']);
  });

  it('due flush insieme non mandano due volte', async () => {
    const t = setup();
    await t.log.report('E');
    await Promise.all([t.log.flush(), t.log.flush()]);
    expect(t.posts).toHaveLength(1);
  });
});
