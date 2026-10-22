import type { SweepPlan } from '@homeradar/shared/api/connector';
import type { PageReport } from '@homeradar/shared/shared/types';
import { describe, expect, it, vi } from 'vitest';
import type { Outgoing } from '../../src/queue-store';
import type { ReaderMessage } from '../../src/reader';
import { createRunner, SWEEP_RUNNING, type RunnerDeps, type RunnerState } from '../../src/runner';
import { IMM, obs, page, SUB } from './helpers';

const SWEEP_ID = '7a1c3c58-1a7d-4c0e-9d55-3f3b8f0f2a10';
const TIMING = { pageTimeoutMs: 45_000, pauseMs: { immobiliare: [4_000, 10_000], idealista: [8_000, 14_000], subito: [4_000, 10_000], casadaprivato: [4_000, 10_000] } } as RunnerDeps['timing'];

type PageMsg = Extract<ReaderMessage, { type: 'page' }>;
const msg = (report: PageReport | null, observations = [obs()], url = report?.url ?? IMM.url, newestId?: number): PageMsg => ({
  type: 'page', url, observations, report, ...(newestId ? { newestId } : {}),
});

function harness(o: Partial<RunnerDeps> = {}) {
  const timers: { fn: () => void; ms: number }[] = [];
  let stored: RunnerState | null = null;
  const queued: Outgoing[] = [];
  let n = 0;
  const deps: RunnerDeps = {
    now: () => 1000, random: () => 0, uuid: () => `00000000-0000-4000-8000-00000000000${++n}`,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length - 1;
    },
    clearTimer: (h) => {
      timers[h as number] = { fn: () => {}, ms: -1 };
    },
    keepAlive: () => () => {},
    openWindow: vi.fn(async () => ({ windowId: 7, tabId: 70 })),
    navigate: vi.fn(async () => {}),
    closeWindow: vi.fn(async () => {}),
    loadState: async () => stored,
    saveState: async (s) => {
      stored = s;
    },
    timing: TIMING,
    plan: async (): Promise<SweepPlan> => ({ sweepId: SWEEP_ID, searches: [IMM, SUB], skipped: 1 }),
    enqueue: async (x) => void queued.push(x),
    ...o,
  };
  const runner = createRunner(deps);
  /** Esegue l'ultimo timer ancora valido (pausa o timeout) e aspetta la coda del runner. */
  const fire = async () => {
    const t = [...timers].reverse().find((x) => x.ms >= 0)!;
    t.ms = -1;
    t.fn();
    await new Promise((r) => setTimeout(r, 0));
    await runner.running();
  };
  const paths = () => queued.map((q) => q.path);
  return { runner, deps, timers, queued, paths, fire, stored: () => stored };
}

const FINISH = `/connector/sweeps/${SWEEP_ID}/finish`;

describe('giro del connettore', () => {
  it('lotto, esito e fine in coda nell\'ordine; la finestra si chiude', async () => {
    const h = harness({ plan: async () => ({ sweepId: SWEEP_ID, searches: [IMM], skipped: 0 }) });
    expect(await h.runner.start()).toEqual({ sweepId: SWEEP_ID, total: 1, skipped: 0 });
    expect(h.deps.openWindow).toHaveBeenCalledWith(IMM.url);
    await h.runner.page(70, msg(null, [obs({ portalId: 1 }), obs({ portalId: 2, sellerType: 'agency' })], IMM.url, 9));
    await h.runner.page(70, msg(page('immobiliare', { results: 2, privates: 1 }), [obs({ portalId: 3 })]));
    expect(h.paths()).toEqual(['/connector/batches', '/connector/runs', FINISH]);
    const batch = h.queued[0]!.body as { page: number; observations: { portalId: number }[]; newestId?: number; searchKey: string; sweepId: string };
    expect(batch).toMatchObject({ page: 1, searchKey: IMM.key, sweepId: SWEEP_ID, newestId: 9 });
    expect(batch.observations.map((x) => x.portalId)).toEqual([1, 3]);
    expect(h.queued[1]!.body).toMatchObject({ searchKey: IMM.key, outcome: 'complete', pages: 1, privates: 1 });
    expect(h.queued[2]!.body).toEqual({ outcome: 'completed' });
    expect(h.deps.closeWindow).toHaveBeenCalledWith(7);
    expect(h.stored()).toBeNull();
  });

  it('alterna le ricerche dopo la pausa', async () => {
    const h = harness();
    await h.runner.start();
    await h.runner.page(70, msg(page('immobiliare')));
    expect(h.timers.at(-1)!.ms).toBe(4_000);
    await h.fire();
    expect(h.deps.navigate).toHaveBeenCalledWith(70, SUB.url);
    await h.runner.page(70, msg(page('subito'), [obs({ portal: 'subito', portalId: 5, url: 'https://www.subito.it/x/5.htm' })]));
    expect(h.paths()).toEqual(['/connector/batches', '/connector/runs', '/connector/batches', '/connector/runs', FINISH]);
  });

  it('ricerca senza annunci: il lotto della pagina 1 parte comunque', async () => {
    const h = harness({ plan: async () => ({ sweepId: SWEEP_ID, searches: [IMM], skipped: 0 }) });
    await h.runner.start();
    await h.runner.page(70, msg(page('immobiliare', { results: 0, privates: 0, lastPage: true }), []));
    expect(h.paths()).toEqual(['/connector/batches', '/connector/runs', FINISH]);
    expect(h.queued[0]!.body).toMatchObject({ page: 1, observations: [] });
    expect(h.queued[1]!.body).toMatchObject({ outcome: 'complete' });
  });

  it('verifica di DataDome: nessun lotto, esito bloccato, giro in parte', async () => {
    const h = harness({ plan: async () => ({ sweepId: SWEEP_ID, searches: [IMM], skipped: 0 }) });
    await h.runner.start();
    await h.runner.page(70, msg(page('immobiliare', { results: 0, privates: 0, blocked: true }), []));
    expect(h.paths()).toEqual(['/connector/runs', FINISH]);
    expect(h.queued[0]!.body).toMatchObject({ outcome: 'blocked', pages: 0 });
    expect(h.queued[1]!.body).toEqual({ outcome: 'partial' });
  });

  it('annunci non validi per il server contano come errori di lettura', async () => {
    const h = harness({ plan: async () => ({ sweepId: SWEEP_ID, searches: [IMM], skipped: 0 }) });
    await h.runner.start();
    await h.runner.page(70, msg(page('immobiliare'), [obs({ url: 'https://www.idealista.it/immobile/1/' })]));
    expect(h.queued[0]!.body).toMatchObject({ observations: [], report: { parseErrors: 1 } });
    expect(h.queued[1]!.body).toMatchObject({ outcome: 'error' });
  });

  it('altre schede e pagine non attese non contano', async () => {
    const h = harness();
    expect(await h.runner.isSweepTab(70)).toBe(false);
    await h.runner.start();
    expect(await h.runner.isSweepTab(70)).toBe(true);
    expect(await h.runner.isSweepTab(99)).toBe(false);
    expect(await h.runner.isSweepTab(undefined)).toBe(false);
    await h.runner.page(99, msg(page('immobiliare')));
    await h.runner.page(undefined, msg(page('immobiliare')));
    expect(h.queued).toEqual([]);
    expect(h.deps.navigate).not.toHaveBeenCalled();
    await h.runner.page(70, msg(page('immobiliare')));
    const before = h.queued.length;
    await h.runner.page(70, msg(page('immobiliare'), [obs({ portalId: 77 })]));
    expect(h.queued).toHaveLength(before);
    expect(h.stored()!.pageObs).toEqual([]);
  });

  it('timeout: ricerca in errore, esito in coda, si prosegue', async () => {
    const h = harness();
    await h.runner.start();
    await h.fire();
    expect(h.queued).toEqual([{ path: '/connector/runs', body: expect.objectContaining({ searchKey: IMM.key, outcome: 'error', pages: 0 }) }]);
    await h.fire();
    expect(h.deps.navigate).toHaveBeenCalledWith(70, SUB.url);
  });

  it('Ferma: esiti delle ricerche finite e fine "stopped", nessun esito delle saltate', async () => {
    const h = harness();
    await h.runner.start();
    await h.runner.page(70, msg(page('immobiliare')));
    await h.runner.stop();
    expect(h.paths()).toEqual(['/connector/batches', '/connector/runs', FINISH]);
    expect(h.queued[2]!.body).toEqual({ outcome: 'stopped' });
    expect(h.deps.closeWindow).toHaveBeenCalledWith(7);
    expect(await h.runner.running()).toBe(false);
  });

  it('finestra chiusa dall\'agente: interrotto, la finestra non si richiude', async () => {
    const h = harness();
    await h.runner.start();
    await h.runner.windowRemoved(7);
    expect(h.queued.at(-1)).toEqual({ path: FINISH, body: { outcome: 'interrupted' } });
    expect(h.deps.closeWindow).not.toHaveBeenCalled();
  });

  it('worker riavviato: la fine "interrupted" va in coda dopo quanto già nato', async () => {
    const h = harness();
    await h.runner.start();
    await h.runner.page(70, msg(page('immobiliare')));
    const restarted = createRunner({ ...h.deps, loadState: async () => h.stored() });
    await restarted.recover();
    expect(h.paths()).toEqual(['/connector/batches', '/connector/runs', FINISH]);
    expect(h.queued[2]!.body).toEqual({ outcome: 'interrupted' });
    expect(h.deps.closeWindow).toHaveBeenCalledWith(7);
  });

  it('reindirizzamento: ricerca non trovata, nessun lotto', async () => {
    const h = harness();
    await h.runner.start();
    await h.runner.page(70, msg(page('immobiliare', { url: 'https://www.immobiliare.it/vendita-negozi/milano-provincia/' })));
    expect(h.stored()!.sweep.runs[0]!.outcome).toBe('notFound');
    expect(h.queued).toEqual([{ path: '/connector/runs', body: expect.objectContaining({ outcome: 'notFound' }) }]);
  });

  it('un messaggio in ritardo della pagina precedente non vale per la successiva', async () => {
    const h = harness();
    await h.runner.start();
    await h.runner.page(70, msg(page('immobiliare')));
    await h.fire();
    await h.runner.page(70, msg(page('immobiliare'), [obs({ portalId: 44 })]));
    expect(h.stored()!.awaiting).toBe(true);
    expect(h.stored()!.pageObs).toEqual([]);
    expect(h.stored()!.sweep.runs[1]!.outcome).toBe('pending');
  });

  it('un timer del giro precedente non tocca il giro nuovo', async () => {
    const h = harness();
    await h.runner.start();
    await h.runner.page(70, msg(page('immobiliare')));
    const oldPause = h.timers.at(-1)!.fn;
    await h.runner.stop();
    await h.runner.start();
    oldPause();
    await new Promise((r) => setTimeout(r, 0));
    await h.runner.running();
    expect(h.deps.navigate).not.toHaveBeenCalled();
    expect(h.stored()!.sweep.current).toBe(0);
  });

  it('tutte fresche: nessuna finestra', async () => {
    const h = harness({ plan: async () => ({ sweepId: null, searches: [], skipped: 3 }) });
    expect(await h.runner.start()).toEqual({ sweepId: null, total: 0, skipped: 3 });
    expect(h.deps.openWindow).not.toHaveBeenCalled();
    expect(await h.runner.running()).toBe(false);
  });

  it('un secondo avvio durante il giro è rifiutato; un piano che fallisce non lascia stato', async () => {
    const h = harness();
    await h.runner.start();
    await expect(h.runner.start()).rejects.toThrow(SWEEP_RUNNING);
    const f = harness({ plan: async () => { throw new Error('Giro già in corso su un altro computer'); } });
    await expect(f.runner.start()).rejects.toThrow('Giro già in corso su un altro computer');
    expect(f.stored()).toBeNull();
    expect(f.deps.openWindow).not.toHaveBeenCalled();
  });
});
