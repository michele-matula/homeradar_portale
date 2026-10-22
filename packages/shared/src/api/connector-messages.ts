import { z } from 'zod';

// Messaggi fra il portale (pagina) e il connettore (estensione): `chrome.runtime.sendMessage(CONNECTOR_ID, …)`.

/** ID fisso dell'estensione, ricavato dalla chiave pubblica del manifest (`apps/connector/src/key.ts`). */
export const CONNECTOR_ID = 'jojmcoiibegdcgafonhdkdkkdoiaeapc';

export const NOT_LINKED = 'Connettore non collegato';

export type PortalMessage = { type: 'ping' } | { type: 'link'; code: string } | { type: 'startSweep' } | { type: 'stopSweep' };

export const PortalMessage: z.ZodType<PortalMessage> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ping') }),
  z.strictObject({ type: z.literal('link'), code: z.string().min(1).max(200) }),
  z.strictObject({ type: z.literal('startSweep') }),
  z.strictObject({ type: z.literal('stopSweep') }),
]);

/** Risposta a `ping`: `pending` sono le pagine lette che aspettano d'essere inviate. */
export interface ConnectorState {
  version: string;
  linked: boolean;
  /** Account a cui è collegato: il portale ricollega se non è quello di chi è entrato. */
  userId: string | null;
  sweeping: boolean;
  pending: number;
  stuck: boolean;
}

/** Risposta a `startSweep`: `sweepId` null se tutte le ricerche erano fresche. */
export interface SweepStarted {
  sweepId: string | null;
  total: number;
  skipped: number;
}

export type ConnectorReply<T> = { ok: true; data: T } | { ok: false; error: string; notLinked?: true };
