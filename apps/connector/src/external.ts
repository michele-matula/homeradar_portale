import {
  NOT_LINKED, PortalMessage, type ConnectorReply, type ConnectorState, type SweepStarted,
} from '@homeradar/shared/api/connector-messages';

export interface ExternalDeps {
  portalOrigin: string;
  version: string;
  /** Account del token salvato; null se non collegato. */
  linkedUser(): Promise<string | null>;
  /** Scambia il codice con il token del dispositivo; lancia un Error col messaggio del server. */
  link(code: string): Promise<void>;
  start(): Promise<SweepStarted>;
  stop(): Promise<void>;
  sweeping(): Promise<boolean>;
  queueState(): Promise<{ pending: number; stuck: boolean }>;
  /** Riprova subito gli invii in attesa, senza aspettare l'attesa crescente. */
  retryNow(): void;
  /** L'agente ha cambiato il giro automatico: si richiede subito al server se è dovuto. */
  autoChanged(): void;
}

/** Messaggi della pagina del portale (`externally_connectable`): solo dalla sua origine. */
export async function handleExternal(
  msg: unknown, origin: string | undefined, d: ExternalDeps,
): Promise<ConnectorReply<ConnectorState | SweepStarted | null>> {
  if (origin !== d.portalOrigin) return { ok: false, error: 'Origine non ammessa' };
  const parsed = PortalMessage.safeParse(msg);
  if (!parsed.success) return { ok: false, error: 'Messaggio non valido' };
  const m = parsed.data;
  try {
    switch (m.type) {
      case 'ping': {
        const [userId, sweeping, q] = await Promise.all([d.linkedUser(), d.sweeping(), d.queueState()]);
        // Il portale risponde, quindi anche il server: le pagine in attesa partono ora, non fra qualche minuto.
        if (q.pending > 0) d.retryNow();
        return { ok: true, data: { version: d.version, linked: userId != null, userId, sweeping, pending: q.pending, stuck: q.stuck } };
      }
      case 'link':
        await d.link(m.code);
        return { ok: true, data: null };
      case 'startSweep':
        return { ok: true, data: await d.start() };
      case 'autoChanged':
        d.autoChanged();
        return { ok: true, data: null };
      case 'stopSweep':
        await d.stop();
        return { ok: true, data: null };
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return error === NOT_LINKED ? { ok: false, error, notLinked: true } : { ok: false, error };
  }
}
