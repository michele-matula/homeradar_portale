import { PAGE_TIMEOUT_MS, PAUSE_MS } from '@homeradar/shared/core/sweep';
import type { Portal } from '@homeradar/shared/shared/types';

export interface ConnectorTiming {
  pageTimeoutMs: number;
  pauseMs: Record<Portal, [number, number]>;
  /** Attese fra un tentativo d'invio e il successivo; l'ultima si ripete. */
  retryMs: number[];
  /** Giro automatico: primo controllo dopo l'avvio del browser e intervallo dei controlli (minuti, per chrome.alarms). */
  autoStartDelayMs: number;
  autoEveryMin: number;
  /** Oltre questa età un invio non si ritenta più da solo. */
  giveUpMs: number;
}

export const NORMAL_TIMING: ConnectorTiming = {
  pageTimeoutMs: PAGE_TIMEOUT_MS,
  pauseMs: PAUSE_MS,
  retryMs: [30_000, 120_000, 600_000, 1_800_000, 3_600_000],
  giveUpMs: 86_400_000,
  autoStartDelayMs: 120_000,
  autoEveryMin: 15,
};

/** Solo per la build dei test end-to-end. */
export const FAST_TIMING: ConnectorTiming = {
  pageTimeoutMs: 5_000,
  pauseMs: { immobiliare: [100, 200], idealista: [100, 200], subito: [100, 200], casadaprivato: [100, 200] },
  retryMs: [500, 1_000],
  giveUpMs: 60_000,
  autoStartDelayMs: 2_000,
  autoEveryMin: 0.5,
};

// Letterale `import.meta.env.WXT_SWEEP_FAST`: WXT lo sostituisce nella build, la build normale ha solo i tempi normali.
export const TIMING: ConnectorTiming = import.meta.env.WXT_SWEEP_FAST === '1' ? FAST_TIMING : NORMAL_TIMING;
