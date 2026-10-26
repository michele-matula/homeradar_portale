import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoSweepDecision, nextAfterSweep, type AutoSweepRow } from '@/core/auto-sweep';
import type { SweepOutcome } from '@/shared/types';

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Rome';
});
afterAll(() => {
  process.env.TZ = originalTz;
});

/** Ottobre 2026, ora di Roma. */
const T = (h: number, m = 0, day = 26) => new Date(2026, 9, day, h, m).getTime();
const row = (startedAt: number, outcome: SweepOutcome | null, auto = true): AutoSweepRow => ({ startedAt, outcome, auto });
const ON = { enabled: true, hours: null };
const EVERY4 = { enabled: true, hours: 4 as const };

describe('autoSweepDecision', () => {
  it("spento: non dovuto, si ricontrolla fra un'ora", () =>
    expect(autoSweepDecision({ enabled: false, hours: null }, [], T(9))).toEqual({ due: false, nextCheckAt: T(10) }));

  it('prima delle 7: alle 7; dopo le 21: domani alle 7', () => {
    expect(autoSweepDecision(ON, [], T(6, 30))).toEqual({ due: false, nextCheckAt: T(7) });
    expect(autoSweepDecision(ON, [], T(21, 5))).toEqual({ due: false, nextCheckAt: T(7, 0, 27) });
  });

  it('una volta al giorno: dovuto se oggi nessun giro conta', () => {
    expect(autoSweepDecision(ON, [row(T(20, 0, 25), 'completed')], T(8))).toEqual({ due: true });
    expect(autoSweepDecision(ON, [row(T(7, 30), 'partial')], T(8))).toEqual({ due: false, nextCheckAt: T(7, 0, 27) });
  });

  it("un giro interrotto non conta, ma il freno di un'ora vale per gli automatici", () => {
    expect(autoSweepDecision(ON, [row(T(7, 30), 'interrupted', false)], T(8))).toEqual({ due: true });
    expect(autoSweepDecision(ON, [row(T(7, 30), 'interrupted', true)], T(8))).toEqual({ due: false, nextCheckAt: T(8, 30) });
  });

  it("ogni 4 ore: dovuto 4 ore dopo l'ultimo giro che conta; aperto conta", () => {
    expect(autoSweepDecision(EVERY4, [row(T(8), 'stopped')], T(11))).toEqual({ due: false, nextCheckAt: T(12) });
    expect(autoSweepDecision(EVERY4, [row(T(8), 'completed')], T(12))).toEqual({ due: true });
    expect(autoSweepDecision(EVERY4, [row(T(10), null)], T(11))).toEqual({ due: false, nextCheckAt: T(11, 15) });
  });

  it('soglia oltre le 21: domani alle 7', () =>
    expect(autoSweepDecision(EVERY4, [row(T(18), 'completed')], T(19))).toEqual({ due: false, nextCheckAt: T(7, 0, 27) }));

  it("giorno del cambio d'ora: le 7 restano le 7 locali", () =>
    expect(autoSweepDecision(ON, [row(T(9, 0, 25), 'completed')], T(10, 0, 25))).toEqual({ due: false, nextCheckAt: T(7, 0, 26) }));
});

describe('nextAfterSweep', () => {
  it('una volta al giorno: domani alle 7; ogni N ore: N ore dopo, dentro la fascia', () => {
    expect(nextAfterSweep(null, T(9))).toBe(T(7, 0, 27));
    expect(nextAfterSweep(6, T(9))).toBe(T(15));
    expect(nextAfterSweep(6, T(16))).toBe(T(7, 0, 27));
  });
});

describe('giro aperto', () => {
  it('conta, ma si ricontrolla fra 15 minuti: potrebbe finire interrotto', () => {
    expect(autoSweepDecision(ON, [row(T(9), null, false)], T(9, 30))).toEqual({ due: false, nextCheckAt: T(9, 45) });
    expect(autoSweepDecision(EVERY4, [row(T(8), 'completed'), row(T(9), null, false)], T(9, 30))).toEqual({ due: false, nextCheckAt: T(9, 45) });
  });
});
