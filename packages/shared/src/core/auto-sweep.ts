import type { SweepOutcome } from '../shared/types';
import { addDays, atRomeHour, startOfLocalDay } from './recall';

/** Frequenze del giro automatico oltre a «una volta al giorno» (null): sotto le 3 ore no, per il rischio di verifiche. */
export const AUTO_SWEEP_HOURS = [3, 4, 6, 8] as const;
export type AutoSweepHours = (typeof AUTO_SWEEP_HOURS)[number];

/** Fascia di Roma in cui il giro automatico può partire. */
export const AUTO_FROM_HOUR = 7;
export const AUTO_TO_HOUR = 21;
/** Un giro automatico non riparte prima di così dall'inizio del precedente, qualunque sia l'esito. */
export const AUTO_RETRY_MS = 3_600_000;
/** Giro automatico spento: il connettore richiede dopo così (un'attivazione fatta da un altro dispositivo). */
export const AUTO_OFF_RECHECK_MS = 3_600_000;
/** C'è un giro aperto: il connettore richiede dopo così, invece di aspettare la soglia. */
export const AUTO_OPEN_RECHECK_MS = 15 * 60_000;

const HOUR_MS = 3_600_000;

/** Un giro recente dell'agente; `outcome` null = ancora aperto. */
export interface AutoSweepRow {
  startedAt: number;
  outcome: SweepOutcome | null;
  auto: boolean;
}

export type AutoDecision = { due: true } | { due: false; nextCheckAt: number };

/** Il primo istante dentro la fascia a partire da `at`. */
function intoWindow(at: number): number {
  const from = atRomeHour(at, AUTO_FROM_HOUR);
  if (at < from) return from;
  if (at >= atRomeHour(at, AUTO_TO_HOUR)) return atRomeHour(addDays(startOfLocalDay(at), 1), AUTO_FROM_HOUR);
  return at;
}

/** Primo istante dovuto dopo un giro che conta iniziato a `startedAt`, già dentro la fascia. */
export function nextAfterSweep(hours: AutoSweepHours | null, startedAt: number): number {
  if (hours == null) return atRomeHour(addDays(startOfLocalDay(startedAt), 1), AUTO_FROM_HOUR);
  return intoWindow(startedAt + hours * HOUR_MS);
}

/**
 * Il giro automatico è dovuto? Contano i giri dell'agente manuali o automatici completati, parziali, fermati o aperti;
 * un giro interrotto no, ma uno automatico iniziato da meno di un'ora frena comunque.
 */
export function autoSweepDecision(s: { enabled: boolean; hours: AutoSweepHours | null }, sweeps: AutoSweepRow[], now: number): AutoDecision {
  if (!s.enabled) return { due: false, nextCheckAt: now + AUTO_OFF_RECHECK_MS };
  let next = intoWindow(now);
  const counted = sweeps.filter((x) => x.outcome !== 'interrupted').map((x) => x.startedAt);
  if (counted.length) next = Math.max(next, nextAfterSweep(s.hours, Math.max(...counted)));
  const autos = sweeps.filter((x) => x.auto).map((x) => x.startedAt);
  if (autos.length) next = Math.max(next, intoWindow(Math.max(...autos) + AUTO_RETRY_MS));
  if (next <= now) return { due: true };
  // Un giro aperto (altro computer, o rimasto orfano) potrebbe finire interrotto e allora non contare: si ricontrolla presto.
  if (sweeps.some((x) => x.outcome == null)) next = Math.min(next, intoWindow(now + AUTO_OPEN_RECHECK_MS));
  return { due: false, nextCheckAt: next };
}
