import { NOT_LINKED } from '@homeradar/shared/api/connector-messages';
import { describe, expect, it, vi } from 'vitest';
import { handleExternal, type ExternalDeps } from '../../src/external';

const ORIGIN = 'https://portale.test';

function deps(o: Partial<ExternalDeps> = {}): ExternalDeps {
  return {
    portalOrigin: ORIGIN, version: '0.1.0',
    linkedUser: vi.fn(async () => 'u1'),
    link: vi.fn(async () => {}),
    start: vi.fn(async () => ({ sweepId: 'g', total: 2, skipped: 1 })),
    stop: vi.fn(async () => {}),
    sweeping: vi.fn(async () => false),
    queueState: vi.fn(async () => ({ pending: 2, stuck: false })),
    retryNow: vi.fn(),
    ...o,
  };
}

describe('messaggi del portale', () => {
  it('da un\'altra origine o senza origine: rifiutati senza toccare nulla', async () => {
    for (const origin of ['https://altro.test', undefined]) {
      const d = deps();
      expect(await handleExternal({ type: 'startSweep' }, origin, d)).toEqual({ ok: false, error: 'Origine non ammessa' });
      expect(d.start).not.toHaveBeenCalled();
    }
  });

  it('messaggio non valido', async () => {
    expect(await handleExternal({ type: 'boh' }, ORIGIN, deps())).toEqual({ ok: false, error: 'Messaggio non valido' });
  });

  it('ping: stato del connettore', async () => {
    expect(await handleExternal({ type: 'ping' }, ORIGIN, deps())).toEqual({
      ok: true, data: { version: '0.1.0', linked: true, userId: 'u1', sweeping: false, pending: 2, stuck: false },
    });
  });

  it("ping con pagine in attesa: si riprova subito (il portale risponde, quindi il server c'è)", async () => {
    const d = deps();
    await handleExternal({ type: 'ping' }, ORIGIN, d);
    expect(d.retryNow).toHaveBeenCalledTimes(1);
    const empty = deps({ queueState: async () => ({ pending: 0, stuck: false }) });
    await handleExternal({ type: 'ping' }, ORIGIN, empty);
    expect(empty.retryNow).not.toHaveBeenCalled();
  });

  it('ping senza collegamento', async () => {
    expect(await handleExternal({ type: 'ping' }, ORIGIN, deps({ linkedUser: async () => null }))).toMatchObject({ ok: true, data: { linked: false, userId: null } });
  });

  it('link, start, stop', async () => {
    const d = deps();
    expect(await handleExternal({ type: 'link', code: 'abc' }, ORIGIN, d)).toEqual({ ok: true, data: null });
    expect(d.link).toHaveBeenCalledWith('abc');
    expect(await handleExternal({ type: 'startSweep' }, ORIGIN, d)).toEqual({ ok: true, data: { sweepId: 'g', total: 2, skipped: 1 } });
    expect(await handleExternal({ type: 'stopSweep' }, ORIGIN, d)).toEqual({ ok: true, data: null });
    expect(d.stop).toHaveBeenCalled();
  });

  it('errori: il messaggio del server; "non collegato" si riconosce', async () => {
    const d = deps({
      start: async () => { throw new Error(NOT_LINKED); },
      link: async () => { throw new Error('Codice di collegamento non valido o scaduto'); },
    });
    expect(await handleExternal({ type: 'startSweep' }, ORIGIN, d)).toEqual({ ok: false, error: NOT_LINKED, notLinked: true });
    expect(await handleExternal({ type: 'link', code: 'x' }, ORIGIN, d)).toEqual({ ok: false, error: 'Codice di collegamento non valido o scaduto' });
  });
});
