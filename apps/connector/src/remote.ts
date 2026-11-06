import type { RemotePoll } from '@homeradar/shared/api/connector';
import type { SweepStarted } from '@homeradar/shared/api/connector-messages';

export interface RemoteDeps {
  linked(): Promise<boolean>;
  /** `POST /connector/remote`; 'unlinked' se il server non riconosce più il token, null per rete o errore del server. */
  poll(): Promise<RemotePoll | 'unlinked' | null>;
  running(): Promise<boolean>;
  /** `runner.start({ remote })`: il server prende la richiesta e apre il giro nella stessa chiamata. */
  start(requestId: string): Promise<SweepStarted>;
  stop(): Promise<void>;
  /** Controllo ogni minuto (interruttore attivo) oppure solo con l'allarme del giro automatico. */
  setFast(on: boolean): Promise<void>;
  /** Giro partito: notifica sul computer con «Ferma». */
  started(): void;
}

/**
 * Avvio dal telefono: il connettore chiede al server se c'è una richiesta da prendere o un «Ferma» per il suo giro.
 * Una richiesta presa da un altro computer, scaduta o con i dati già freschi non è un errore: non succede niente.
 */
export function createRemote(d: RemoteDeps) {
  let inFlight: Promise<'started' | 'stopped' | 'idle'> | null = null;

  async function run(): Promise<'started' | 'stopped' | 'idle'> {
    if (!(await d.linked())) return 'idle';
    const r = await d.poll();
    if (r === 'unlinked' || r === null) return 'idle';
    await d.setFast(r.enabled);
    const running = await d.running();
    if (running) {
      if (!r.stop) return 'idle';
      await d.stop();
      return 'stopped';
    }
    if (!r.requestId) return 'idle';
    try {
      const s = await d.start(r.requestId);
      if (!s.sweepId) return 'idle';
    } catch {
      return 'idle';
    }
    d.started();
    return 'started';
  }

  return {
    /** Allarmi, avvio e messaggi del portale possono arrivare insieme: un controllo alla volta. */
    check(): Promise<'started' | 'stopped' | 'idle'> {
      inFlight ??= run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
