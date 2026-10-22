import type { SweepPlan } from '@homeradar/shared/api/connector';
import type { SweepStarted } from '@homeradar/shared/api/connector-messages';
import {
  beginStep, createSweep, finishSweep, nextStep, onPageRead, onTimeout, pauseMs, samePage, stepUrl, stopSweep, type SweepState,
} from '@homeradar/shared/core/sweep';
import type { ListingObservation, SweepOutcome } from '@homeradar/shared/shared/types';
import { batchFor, finishFor, settledRuns, toWire } from './outgoing';
import type { Outgoing } from './queue-store';
import type { ReaderMessage } from './reader';
import type { ConnectorTiming } from './timing';

export const SWEEP_RUNNING = 'Giro già in corso';

/** Stato salvato in storage.session: sopravvive al riavvio del service worker, non a quello del browser. */
export interface RunnerState {
  sweep: SweepState;
  windowId: number;
  tabId: number;
  /** Una pagina è in caricamento e si aspetta il suo riassunto. */
  awaiting: boolean;
  /** URL della pagina in caricamento e di quella prima: un messaggio di un'altra pagina non vale. */
  expectedUrl: string;
  previousUrl: string | null;
  /** Annunci letti finora dalla pagina in caricamento: partono tutti insieme nel suo lotto. */
  pageObs: ListingObservation[];
  newestId: number | null;
}

export interface RunnerDeps {
  now(): number;
  random(): number;
  uuid(): string;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Tiene sveglio il service worker durante il giro; restituisce la funzione che smette. */
  keepAlive(): () => void;
  openWindow(url: string): Promise<{ windowId: number; tabId: number }>;
  navigate(tabId: number, url: string): Promise<void>;
  closeWindow(windowId: number): Promise<void>;
  loadState(): Promise<RunnerState | null>;
  saveState(s: RunnerState | null): Promise<void>;
  timing: Pick<ConnectorTiming, 'pageTimeoutMs' | 'pauseMs'>;
  /** Piano dal server; lancia un Error col messaggio del server. */
  plan(): Promise<SweepPlan>;
  enqueue(o: Outgoing): Promise<void>;
}

type PageMessage = Extract<ReaderMessage, { type: 'page' }>;

/**
 * Giro delle ricerche: una scheda in una finestra ridotta a icona, una pagina alla volta con pause. Ogni pagina letta
 * diventa un lotto in coda, seguito dagli esiti delle ricerche che chiude e, alla fine, dalla fine del giro.
 */
export function createRunner(d: RunnerDeps) {
  let st: RunnerState | null = null;
  let loaded = false;
  let timer: unknown = null;
  let stopKeepAlive: (() => void) | null = null;
  // Un passo alla volta: messaggi dei content script, timer e comandi del portale non si accavallano.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  };

  async function load(): Promise<RunnerState | null> {
    if (!loaded) {
      st = await d.loadState();
      loaded = true;
    }
    return st;
  }
  function clearTimer(): void {
    if (timer != null) d.clearTimer(timer);
    timer = null;
  }
  function armTimeout(): void {
    timer = d.setTimer(() => void serial(timeoutTick), d.timing.pageTimeoutMs);
  }
  async function enqueueAll(items: Outgoing[]): Promise<void> {
    for (const o of items) await d.enqueue(o);
  }

  async function go(index: number): Promise<void> {
    timer = null;
    if (!st) return;
    st.sweep = beginStep(st.sweep, index);
    st.awaiting = true;
    st.previousUrl = st.expectedUrl;
    st.expectedUrl = stepUrl(st.sweep, index);
    st.pageObs = [];
    st.newestId = null;
    await d.saveState(st);
    armTimeout();
    try {
      await d.navigate(st.tabId, st.expectedUrl);
    } catch {
      // Scheda chiusa o non navigabile: il timeout chiude la ricerca.
    }
  }

  async function advance(): Promise<void> {
    if (!st) return;
    const index = nextStep(st.sweep);
    if (index == null) return end(null, true);
    timer = d.setTimer(() => void serial(() => go(index)), pauseMs(d.timing.pauseMs[st.sweep.runs[index]!.spec.portal], d.random));
  }

  async function timeoutTick(): Promise<void> {
    timer = null;
    if (!st?.awaiting) return;
    const before = st.sweep;
    st.awaiting = false;
    st.sweep = onTimeout(before);
    await enqueueAll(settledRuns(before, st.sweep));
    await d.saveState(st);
    await advance();
  }

  /** Chiude il giro: `how` null = finito da solo. */
  async function end(how: 'stopped' | 'interrupted' | null, closeWindow: boolean): Promise<void> {
    clearTimer();
    stopKeepAlive?.();
    stopKeepAlive = null;
    const cur = st!;
    st = null;
    const final = how ? stopSweep(cur.sweep, how, d.now()) : finishSweep(cur.sweep, d.now());
    await enqueueAll([...settledRuns(cur.sweep, final), finishFor(cur.sweep.id, final.status as SweepOutcome)]);
    await d.saveState(null);
    if (closeWindow) await d.closeWindow(cur.windowId).catch(() => {});
  }

  /** Annunci della pagina attesa: si tengono fino al suo riassunto. */
  function collect(s: RunnerState, m: PageMessage): void {
    if (!samePage(s.expectedUrl, m.url)) return;
    const known = new Set(s.pageObs.map((o) => o.portalId));
    s.pageObs = [...s.pageObs, ...m.observations.filter((o) => !known.has(o.portalId))];
    if (m.newestId != null) s.newestId = Math.max(s.newestId ?? 0, m.newestId);
  }

  return {
    start: () => serial(async (): Promise<SweepStarted> => {
      if (await load()) throw new Error(SWEEP_RUNNING);
      const plan = await d.plan();
      if (!plan.sweepId || !plan.searches.length) return { sweepId: null, total: 0, skipped: plan.skipped };
      let sweep = createSweep(plan.searches, d.now(), plan.sweepId);
      const index = nextStep(sweep)!;
      sweep = beginStep(sweep, index);
      const expectedUrl = stepUrl(sweep, index);
      const { windowId, tabId } = await d.openWindow(expectedUrl);
      st = { sweep, windowId, tabId, awaiting: true, expectedUrl, previousUrl: null, pageObs: [], newestId: null };
      stopKeepAlive = d.keepAlive();
      await d.saveState(st);
      armTimeout();
      return { sweepId: plan.sweepId, total: plan.searches.length, skipped: plan.skipped };
    }),

    stop: () => serial(async () => {
      if (await load()) await end('stopped', true);
    }),

    running: () => serial(async () => (await load()) != null),

    isSweepTab: (tabId: number | undefined) => serial(async () => {
      const s = await load();
      return s != null && tabId === s.tabId;
    }),

    page: (tabId: number | undefined, m: PageMessage) => serial(async () => {
      const s = await load();
      if (!s || tabId !== s.tabId || !s.awaiting) return;
      collect(s, m);
      let report = m.report;
      if (!report) return d.saveState(s);
      if (!samePage(s.expectedUrl, report.url)) {
        // Messaggio in ritardo della pagina precedente: si aspetta ancora quella giusta.
        if (s.previousUrl && samePage(s.previousUrl, report.url)) return;
        // Il portale ha reindirizzato altrove (comune non riconosciuto): la ricerca non è stata trovata.
        report = { ...report, notFound: !report.blocked };
      }
      clearTimer();
      s.awaiting = false;
      const before = s.sweep;
      const index = before.current;
      report = { ...report, parseErrors: report.parseErrors + toWire(s.pageObs).invalid };
      s.sweep = onPageRead(before, report);
      if (index != null && s.sweep.runs[index]!.pages > before.runs[index]!.pages) {
        await d.enqueue(batchFor({
          id: d.uuid(), sweepId: s.sweep.id, searchKey: before.runs[index]!.spec.key, readAt: d.now(), page: s.sweep.runs[index]!.pages,
          report, observations: s.pageObs, ...(s.newestId != null ? { newestId: s.newestId } : {}),
        }));
      }
      await enqueueAll(settledRuns(before, s.sweep));
      s.pageObs = [];
      s.newestId = null;
      await d.saveState(s);
      await advance();
    }),

    windowRemoved: (windowId: number) => serial(async () => {
      const s = await load();
      if (s && s.windowId === windowId) await end('interrupted', false);
    }),

    recover: () => serial(async () => {
      if (await load()) await end('interrupted', true);
    }),
  };
}
