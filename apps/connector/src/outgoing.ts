import { ObservationSchema } from '@homeradar/shared/api/connector';
import type { SweepState } from '@homeradar/shared/core/sweep';
import type { ListingObservation, PageReport, SweepOutcome } from '@homeradar/shared/shared/types';
import type { z } from 'zod';
import type { Outgoing } from './queue-store';

type WireObservation = z.input<typeof ObservationSchema>;

/** I campi che il server ammette: lo schema è la lista di ciò che si può salvare. */
const FIELDS = Object.keys(ObservationSchema.in.shape) as (keyof WireObservation)[];

/**
 * Annunci da mandare: solo privati, solo i campi ammessi. Chi non passa lo schema del server non esce e si conta come
 * errore di lettura (la ricerca allora non risulta completa).
 */
export function toWire(observations: ListingObservation[]): { observations: WireObservation[]; invalid: number } {
  const out: WireObservation[] = [];
  let invalid = 0;
  for (const o of observations) {
    if (o.sellerType !== 'private') continue;
    const picked = Object.fromEntries(FIELDS.filter((k) => k in o).map((k) => [k, o[k as keyof ListingObservation]]));
    if (ObservationSchema.safeParse(picked).success) out.push(picked as WireObservation);
    else invalid++;
  }
  return { observations: out, invalid };
}

export function batchFor(a: {
  id: string; sweepId: string; searchKey: string; readAt: number; page: number; report: PageReport; observations: ListingObservation[]; newestId?: number;
}): Outgoing {
  const { observations, newestId, ...rest } = a;
  return {
    path: '/connector/batches',
    body: { ...rest, observations: toWire(observations).observations, ...(newestId != null ? { newestId } : {}) },
  };
}

/** Esiti delle ricerche chiuse fra i due stati; le saltate le chiude il server alla fine del giro. */
export function settledRuns(before: SweepState, after: SweepState): Outgoing[] {
  return after.runs.flatMap((r, i) =>
    before.runs[i]?.outcome === 'pending' && r.outcome !== 'pending' && r.outcome !== 'skipped'
      ? [{
        path: '/connector/runs',
        body: { sweepId: after.id, searchKey: r.spec.key, outcome: r.outcome, pages: r.pages, privates: r.privates, ...(r.reason ? { reason: r.reason } : {}) },
      }]
      : [],
  );
}

export const finishFor = (sweepId: string, outcome: SweepOutcome): Outgoing => ({ path: `/connector/sweeps/${sweepId}/finish`, body: { outcome } });
