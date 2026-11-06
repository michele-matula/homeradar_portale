// Avvio del giro dal telefono: il server tiene la richiesta, il primo computer abilitato che controlla la prende.

/** Una richiesta che nessun computer prende entro così scade e non parte più. */
export const REMOTE_REQUEST_TTL_MS = 120_000;
/** Un computer abilitato è online se ha controllato le richieste da meno di così. */
export const REMOTE_ONLINE_MS = 120_000;
/** Prima versione del connettore che controlla le richieste. */
export const REMOTE_MIN_VERSION = '0.3.0';

/** `version` è almeno `min`, confrontando le parti `x.y.z` come numeri. Assente o non numerica: no. */
export function versionAtLeast(version: string | null, min: string): boolean {
  if (!version || !/^\d+(\.\d+)*$/.test(version)) return false;
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

export type RemoteOutcome = 'started' | 'fresh' | 'busy' | 'failed' | 'cancelled';
export type RemoteState = 'waiting' | 'noAnswer' | 'fresh' | 'busy' | 'failed' | 'started';

export interface RemoteRow {
  createdAt: number;
  expiresAt: number;
  /** Computer che l'ha presa; null finché nessuno la prende. */
  deviceId: string | null;
  outcome: RemoteOutcome | null;
}

/** Come il telefono vede la richiesta; null se annullata. Presa ma senza esito: il giro non è partito. */
export function remoteState(r: RemoteRow, now: number): RemoteState | null {
  if (r.outcome === 'cancelled') return null;
  if (r.outcome) return r.outcome;
  if (r.deviceId) return 'failed';
  return now < r.expiresAt ? 'waiting' : 'noAnswer';
}
