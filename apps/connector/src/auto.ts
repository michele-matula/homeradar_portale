import type { SweepStarted } from '@homeradar/shared/api/connector-messages';
import { AUTO_OFF_RECHECK_MS } from '@homeradar/shared/core/auto-sweep';

/** Dopo un errore (giro aperto su un altro computer, rete) si richiede dopo così. */
const ERROR_RETRY_MS = 15 * 60_000;

export interface AutoDeps {
  now(): number;
  linked(): Promise<boolean>;
  /** `chrome.idle.queryState`: il giro parte solo se l'agente sta usando il computer. */
  idleState(): Promise<'active' | 'idle' | 'locked'>;
  running(): Promise<boolean>;
  /** Prima di quest'ora non si richiede al server; 0 se assente. */
  loadNext(): Promise<number>;
  saveNext(at: number): Promise<void>;
  /** `runner.start({ auto: true })`: il server apre il giro solo se è dovuto. */
  start(): Promise<SweepStarted>;
}

/**
 * Quando il connettore chiede al server se il giro automatico è dovuto: collegato, nessun giro in corso, agente al
 * computer e passata l'ora indicata dal server. Non lancia mai: un errore rimanda il controllo di 15 minuti.
 */
export function createAutoSweep(d: AutoDeps) {
  let inFlight: Promise<'started' | 'skipped'> | null = null;

  async function run(): Promise<'started' | 'skipped'> {
    if (!(await d.linked()) || (await d.running()) || (await d.idleState()) !== 'active' || d.now() < (await d.loadNext())) return 'skipped';
    try {
      const r = await d.start();
      if (r.sweepId) return 'started';
      await d.saveNext(r.nextCheckAt ?? d.now() + AUTO_OFF_RECHECK_MS);
    } catch {
      await d.saveNext(d.now() + ERROR_RETRY_MS);
    }
    return 'skipped';
  }

  return {
    /** Allarmi, avvio del browser e ritorno al computer possono arrivare insieme: una richiesta alla volta. */
    check(): Promise<'started' | 'skipped'> {
      inFlight ??= run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    /** Impostazioni cambiate o connettore ricollegato: si richiede al prossimo controllo. */
    reset: () => d.saveNext(0),
  };
}
