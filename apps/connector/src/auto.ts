import type { SweepStarted } from '@homeradar/shared/api/connector-messages';
import { AUTO_OFF_RECHECK_MS } from '@homeradar/shared/core/auto-sweep';
import { PORTAL_SITES, type Portal } from '@homeradar/shared/shared/types';

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
  /** Avvio del browser (in `storage.session`, che il riavvio svuota). */
  browserStartedAt(): Promise<number>;
  /** Nei primi istanti dopo l'avvio non si chiede: Chrome ripristina le schede e fa scattare subito gli allarmi in ritardo. */
  startDelayMs: number;
}

/**
 * Quando il connettore chiede al server se il giro automatico è dovuto: collegato, nessun giro in corso, agente al
 * computer e passata l'ora indicata dal server. Non lancia mai: un errore rimanda il controllo di 15 minuti.
 */
export function createAutoSweep(d: AutoDeps) {
  let inFlight: Promise<'started' | 'skipped'> | null = null;

  async function run(): Promise<'started' | 'skipped'> {
    if (d.now() - (await d.browserStartedAt()) < d.startDelayMs) return 'skipped';
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

/** Notifica di fine giro automatico quando dei portali hanno chiesto una verifica: testo e pagine da aprire al clic. */
export function verifyNotice(blocked: Portal[]): { message: string; urls: string[] } {
  const sites = blocked.map((p) => PORTAL_SITES[p]);
  const many = sites.length > 1;
  const names = many ? `${sites.slice(0, -1).join(', ')} e ${sites.at(-1)}` : (sites[0] ?? '');
  return {
    message: `${names} ${many ? 'hanno' : 'ha'} chiesto una verifica: ${many ? 'aprili' : 'aprilo'} tu`,
    urls: sites.map((s) => `https://www.${s.toLowerCase()}/`),
  };
}
