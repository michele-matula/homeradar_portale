import type { SweepStarted } from '@homeradar/shared/api/connector-messages';
import { describe, expect, it, vi } from 'vitest';
import { createAutoSweep, type AutoDeps } from '../../src/auto';

const NOW = 1_000_000;
const MIN = 60_000;

function deps(o: Partial<AutoDeps> = {}) {
  let next = 0;
  const d: AutoDeps = {
    now: () => NOW,
    linked: vi.fn(async () => true),
    idleState: vi.fn(async () => 'active' as const),
    running: vi.fn(async () => false),
    loadNext: vi.fn(async () => next),
    saveNext: vi.fn(async (at: number) => {
      next = at;
    }),
    start: vi.fn(async (): Promise<SweepStarted> => ({ sweepId: 'g', total: 3, skipped: 0 })),
    browserStartedAt: vi.fn(async () => NOW - 10 * MIN),
    startDelayMs: 2 * MIN,
    ...o,
  };
  return d;
}

describe('giro automatico: quando chiedere', () => {
  it('tutto a posto e dovuto: parte', async () => {
    const d = deps();
    expect(await createAutoSweep(d).check()).toBe('started');
    expect(d.start).toHaveBeenCalledOnce();
  });

  it('non collegato, giro in corso, PC non in uso o prima del prossimo controllo: non chiede', async () => {
    for (const o of [
      { linked: async () => false },
      { running: async () => true },
      { idleState: async () => 'idle' as const },
      { idleState: async () => 'locked' as const },
      { loadNext: async () => NOW + 1 },
    ] satisfies Partial<AutoDeps>[]) {
      const d = deps(o);
      expect(await createAutoSweep(d).check()).toBe('skipped');
      expect(d.start).not.toHaveBeenCalled();
    }
  });

  it('non dovuto: si ricorda quando richiedere (un\'ora se il server non lo dice)', async () => {
    const d = deps({ start: async () => ({ sweepId: null, total: 0, skipped: 0, nextCheckAt: NOW + 90 * MIN }) });
    expect(await createAutoSweep(d).check()).toBe('skipped');
    expect(d.saveNext).toHaveBeenCalledWith(NOW + 90 * MIN);
    const e = deps({ start: async () => ({ sweepId: null, total: 0, skipped: 4 }) });
    await createAutoSweep(e).check();
    expect(e.saveNext).toHaveBeenCalledWith(NOW + 60 * MIN);
  });

  it('errore (altro computer, rete): riprova fra 15 minuti, senza lanciare', async () => {
    const d = deps({ start: async () => Promise.reject(new Error('Giro già in corso su un altro computer')) });
    expect(await createAutoSweep(d).check()).toBe('skipped');
    expect(d.saveNext).toHaveBeenCalledWith(NOW + 15 * MIN);
  });

  it('due controlli insieme: una sola richiesta', async () => {
    const d = deps();
    const auto = createAutoSweep(d);
    await Promise.all([auto.check(), auto.check()]);
    expect(d.start).toHaveBeenCalledOnce();
  });

  it('reset: si richiede subito', async () => {
    const d = deps({ loadNext: async () => NOW + 1 });
    await createAutoSweep(d).reset();
    expect(d.saveNext).toHaveBeenCalledWith(0);
  });
});

describe('avvio del browser', () => {
  it('nei primi minuti dopo l\'avvio non chiede, anche se un allarme in ritardo scatta subito', async () => {
    const d = deps({ browserStartedAt: async () => NOW - MIN });
    expect(await createAutoSweep(d).check()).toBe('skipped');
    expect(d.start).not.toHaveBeenCalled();
  });
});
