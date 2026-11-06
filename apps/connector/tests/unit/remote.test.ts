import type { RemotePoll } from '@homeradar/shared/api/connector';
import type { SweepStarted } from '@homeradar/shared/api/connector-messages';
import { describe, expect, it, vi } from 'vitest';
import { createRemote, type RemoteDeps } from '../../src/remote';

const REQUEST: RemotePoll = { enabled: true, requestId: 'r1', stop: false };

function deps(o: Partial<RemoteDeps> = {}): RemoteDeps {
  return {
    linked: vi.fn(async () => true),
    poll: vi.fn(async (): Promise<RemotePoll | 'unlinked' | null> => REQUEST),
    running: vi.fn(async () => false),
    start: vi.fn(async (): Promise<SweepStarted> => ({ sweepId: 'g', total: 3, skipped: 0 })),
    stop: vi.fn(async () => {}),
    setFast: vi.fn(async () => {}),
    started: vi.fn(),
    ...o,
  };
}

describe('richieste dal telefono', () => {
  it('richiesta aperta e nessun giro: parte e avvisa', async () => {
    const d = deps();
    expect(await createRemote(d).check()).toBe('started');
    expect(d.start).toHaveBeenCalledExactlyOnceWith('r1');
    expect(d.setFast).toHaveBeenCalledWith(true);
    expect(d.started).toHaveBeenCalledOnce();
  });

  it('presa da un altro computer o scaduta: niente, senza errori', async () => {
    const d = deps({ start: vi.fn(async () => { throw new Error('Richiesta già presa o scaduta'); }) });
    expect(await createRemote(d).check()).toBe('idle');
    expect(d.started).not.toHaveBeenCalled();
  });

  it('dati già freschi: nessun avviso', async () => {
    const d = deps({ start: vi.fn(async () => ({ sweepId: null, total: 0, skipped: 4 })) });
    expect(await createRemote(d).check()).toBe('idle');
    expect(d.started).not.toHaveBeenCalled();
  });

  it('interruttore spento: controllo lento e nessun giro', async () => {
    const d = deps({ poll: vi.fn(async () => ({ enabled: false, requestId: null, stop: false })) });
    expect(await createRemote(d).check()).toBe('idle');
    expect(d.setFast).toHaveBeenCalledWith(false);
    expect(d.start).not.toHaveBeenCalled();
  });

  it('stop dal telefono durante il giro; nessun giro nuovo mentre uno corre', async () => {
    const d = deps({ running: vi.fn(async () => true), poll: vi.fn(async () => ({ enabled: true, requestId: 'r2', stop: true })) });
    expect(await createRemote(d).check()).toBe('stopped');
    expect(d.stop).toHaveBeenCalledOnce();
    expect(d.start).not.toHaveBeenCalled();
  });

  it('non collegato, scollegato o server non raggiungibile: niente', async () => {
    const off = deps({ linked: vi.fn(async () => false) });
    expect(await createRemote(off).check()).toBe('idle');
    expect(off.poll).not.toHaveBeenCalled();
    for (const reply of ['unlinked', null] as const) {
      const d = deps({ poll: vi.fn(async () => reply) });
      expect(await createRemote(d).check()).toBe('idle');
      expect(d.setFast).not.toHaveBeenCalled();
      expect(d.start).not.toHaveBeenCalled();
    }
  });

  it('due controlli insieme: una richiesta sola', async () => {
    const d = deps();
    const r = createRemote(d);
    await Promise.all([r.check(), r.check()]);
    expect(d.poll).toHaveBeenCalledOnce();
  });
});
