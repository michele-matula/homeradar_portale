import { CONNECTOR_ID, type ConnectorReply, type PortalMessage } from '@homeradar/shared/api/connector-messages';

/** Canale verso il connettore; null = connettore assente o muto. */
export interface ConnectorPort {
  send<T>(m: PortalMessage): Promise<ConnectorReply<T> | null>;
}

interface ChromeRuntime {
  sendMessage(id: string, m: unknown, cb: (reply: unknown) => void): void;
  lastError?: unknown;
}

/** Il ping deve rispondere subito; l'avvio del giro chiede prima il piano al server. */
const TIMEOUT_MS: Record<PortalMessage['type'], number> = { ping: 2_000, link: 30_000, startSweep: 30_000, stopSweep: 10_000 };

/**
 * `chrome.runtime` esiste nella pagina solo se un'estensione installata la ammette (`externally_connectable`):
 * senza connettore, o su un browser che non lo supporta, il connettore è assente.
 */
export const chromeConnector: ConnectorPort = {
  send<T>(m: PortalMessage): Promise<ConnectorReply<T> | null> {
    const rt = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
    if (!rt?.sendMessage) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), TIMEOUT_MS[m.type]);
      const done = (reply: ConnectorReply<T> | null) => {
        clearTimeout(timer);
        resolve(reply);
      };
      try {
        rt.sendMessage(CONNECTOR_ID, m, (reply) => done(rt.lastError || reply == null ? null : (reply as ConnectorReply<T>)));
      } catch {
        done(null);
      }
    });
  },
};

/** Telefono o tablet: niente mouse, il giro non parte da qui. */
export const isPhone = (): boolean => typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
