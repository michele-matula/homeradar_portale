import { describe, expect, it } from 'vitest';
import { BatchBody, ObservationSchema, RunBody, StartSweepBody } from '@/api/connector';

const OBS = {
  portal: 'immobiliare', portalId: 128416572, url: 'https://www.immobiliare.it/annunci/128416572/', title: 'Trilocale', address: 'Via Roma 1',
  city: 'Treviglio', zone: null, typology: 'Appartamento', category: null, surfaceM2: 80, rooms: 3, price: 200_000, sellerType: 'private',
  portalCreatedAt: null, lastDrop: null, coverUrl: 'https://pwm.im-cdn.it/image/1/xxs-c.jpg', source: 'search',
};
const REPORT = { portal: 'immobiliare', url: 'https://www.immobiliare.it/vendita-case/treviglio/', results: 25, privates: 3, lastPage: false, blocked: false, notFound: false, parseErrors: 0 };
const batch = (o: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), sweepId: crypto.randomUUID(), searchKey: 'immobiliare|comune:016219|case', readAt: 1, page: 1, report: REPORT, observations: [OBS], ...o,
});
const message = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

describe('ObservationSchema', () => {
  it('accetta un annuncio di un privato', () => expect(ObservationSchema.parse(OBS)).toEqual(OBS));
  it('solo privati', () => expect(ObservationSchema.safeParse({ ...OBS, sellerType: 'agency' }).success).toBe(false));
  it('nessun campo in più: niente telefoni né nomi', () => {
    expect(message(ObservationSchema.safeParse({ ...OBS, phone: '3331234567' }))).toBe('Campo non ammesso: phone');
    expect(message(ObservationSchema.safeParse({ ...OBS, sellerName: 'Mario' }))).toBe('Campo non ammesso: sellerName');
  });
  it('URL del portale dell\'annuncio, in https', () => {
    expect(ObservationSchema.safeParse({ ...OBS, url: 'https://immobiliare.it/annunci/1/' }).success).toBe(true);
    expect(ObservationSchema.safeParse({ ...OBS, url: 'http://www.immobiliare.it/annunci/1/' }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...OBS, url: 'https://www.idealista.it/immobile/1/' }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...OBS, url: 'https://immobiliare.it.evil.com/' }).success).toBe(false);
  });
  it('una copertina di un altro server diventa null', () => {
    expect(ObservationSchema.parse({ ...OBS, coverUrl: 'https://evil.com/x.jpg' }).coverUrl).toBeNull();
  });
  it('testi lunghi rifiutati', () => {
    expect(ObservationSchema.safeParse({ ...OBS, title: 'x'.repeat(301) }).success).toBe(false);
    for (const f of ['address', 'city', 'zone', 'typology']) expect(ObservationSchema.safeParse({ ...OBS, [f]: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('BatchBody', () => {
  it('accetta un lotto valido', () => expect(BatchBody.safeParse(batch()).success).toBe(true));
  it('al massimo 100 annunci', () => {
    expect(message(BatchBody.safeParse(batch({ observations: Array(101).fill(OBS) })))).toBe('Al massimo 100 annunci per lotto');
  });
  it('id del lotto UUID', () => expect(BatchBody.safeParse(batch({ id: 'abc' })).success).toBe(false));
  it('rapporto della pagina senza campi in più', () => expect(BatchBody.safeParse(batch({ report: { ...REPORT, html: '<p>' } })).success).toBe(false));
});

describe('RunBody e StartSweepBody', () => {
  const run = { sweepId: crypto.randomUUID(), searchKey: 'k', outcome: 'complete', pages: 2, privates: 5 };
  it('esiti ammessi', () => {
    expect(RunBody.safeParse(run).success).toBe(true);
    expect(RunBody.safeParse({ ...run, outcome: 'pending' }).success).toBe(false);
    expect(RunBody.safeParse({ ...run, pages: 11 }).success).toBe(false);
  });
  it('avvio senza campi', () => {
    expect(StartSweepBody.safeParse({}).success).toBe(true);
    expect(StartSweepBody.safeParse({ comuni: ['016219'] }).success).toBe(false);
  });
});
