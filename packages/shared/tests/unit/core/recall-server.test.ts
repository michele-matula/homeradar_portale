import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isDue, startOfLocalDay } from '@/core/recall';

// Il Worker gira in UTC: il giorno dei richiami resta comunque quello di Europe/Rome.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'UTC';
});
afterAll(() => {
  process.env.TZ = originalTz;
});

describe('giorno locale con il processo in UTC', () => {
  it('mezzanotte di Roma, ora legale e solare', () => {
    // 22 ottobre 00:30 a Roma (CEST, UTC+2).
    expect(startOfLocalDay(Date.UTC(2026, 9, 21, 22, 30))).toBe(Date.UTC(2026, 9, 21, 22));
    // 10 dicembre 12:00 a Roma (CET, UTC+1).
    expect(startOfLocalDay(Date.UTC(2026, 11, 10, 11))).toBe(Date.UTC(2026, 11, 9, 23));
  });
  it('addDays attraversa il cambio dell\'ora', () => {
    // 24 ottobre → 26 ottobre 2026: il 25 si torna all'ora solare.
    expect(addDays(Date.UTC(2026, 9, 23, 22), 2)).toBe(Date.UTC(2026, 9, 25, 23));
  });
  it('isDue usa la mezzanotte di Roma', () => {
    const now = Date.UTC(2026, 9, 21, 22, 30); // già il 22 a Roma
    expect(isDue(Date.UTC(2026, 9, 21, 22), now)).toBe(true);
    expect(isDue(Date.UTC(2026, 9, 22, 22), now)).toBe(false);
  });
});
