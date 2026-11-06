import { formatDateTime } from '@homeradar/shared/shared/format';
import { PORTAL_SITES, PORTALS, type Portal, type PortalSweepOutcome, type SweepOutcome, type SweepResult } from '@homeradar/shared/shared/types';

// Testi del giro, comuni al riquadro del computer e a quello del telefono.

export const OUTCOMES: Record<SweepOutcome, string> = { completed: 'completato', partial: 'completato in parte', stopped: 'fermato', interrupted: 'interrotto' };
export const OUTCOME_TITLES: Record<SweepOutcome, string> = {
  completed: 'Giro completato', partial: 'Giro completato in parte', stopped: 'Giro fermato', interrupted: 'Giro interrotto',
};
export const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;

function portalReason(p: Portal, o: PortalSweepOutcome, phone: boolean): string | null {
  const site = PORTAL_SITES[p];
  // Dal telefono la verifica non si può fare: si rimanda a quando l'agente è al computer.
  if (o === 'blocked') return phone ? `${site} ha chiesto una verifica: aprilo quando sei al computer.` : `${site} ha chiesto una verifica: aprilo tu e riprova domani.`;
  if (o === 'capped') return `${site}: raggiunto il limite di pagine, alcune ricerche sono incomplete.`;
  if (o === 'error') return `${site} non ha risposto ad alcune pagine.`;
  return null;
}

/** Motivi per cui il giro non è andato del tutto bene, per portale, più le ricerche che il portale non riconosce. */
export function reasons(r: SweepResult, phone = false): string[] {
  const out = PORTALS.flatMap((p) => {
    const s = r.portals[p];
    const why = s && portalReason(p, s.outcome, phone);
    return why ? [why] : [];
  });
  if (r.notFound.length) out.push(`Non trovati: ${r.notFound.join(', ')}.`);
  return out;
}

// Durante il giro il server conta gli annunci nuovi; alla fine i lead nuovi (stesso immobile su più portali = uno).
export const lastLine = (last: SweepResult) =>
  `Ultimo giro: ${formatDateTime(last.startedAt)} · ${OUTCOMES[last.outcome]} · ${last.newCount} nuovi lead${last.auto ? ' · automatico' : ''}${last.remote ? ' · dal telefono' : ''}`;

