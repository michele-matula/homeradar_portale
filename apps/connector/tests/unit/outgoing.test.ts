import { BatchBody, FinishBody, ObservationSchema, RunBody } from '@homeradar/shared/api/connector';
import { createSweep, type SweepState } from '@homeradar/shared/core/sweep';
import { describe, expect, it } from 'vitest';
import { batchFor, finishFor, settledRuns, toWire } from '../../src/outgoing';
import { IMM, obs, page, SUB } from './helpers';

const SWEEP_ID = '7a1c3c58-1a7d-4c0e-9d55-3f3b8f0f2a10';
const ALLOWED = Object.keys(ObservationSchema.parse(obs())).sort();

describe('toWire', () => {
  it('solo privati, solo i campi ammessi, scarta (e conta) quelli che il server rifiuterebbe', () => {
    const extra = { ...obs({ portalId: 1 }), sellerName: 'Mario', phone: '333' } as never;
    const r = toWire([extra, obs({ portalId: 2, sellerType: 'agency' }), obs({ portalId: 3, url: 'https://www.idealista.it/immobile/3/' })]);
    expect(r.invalid).toBe(1);
    expect(r.observations.map((o) => o.portalId)).toEqual([1]);
    expect(Object.keys(r.observations[0]!).sort()).toEqual(ALLOWED);
  });

  it('venditore sconosciuto: non esce', () => {
    expect(toWire([obs({ sellerType: 'unknown' })])).toEqual({ observations: [], invalid: 0 });
  });
});

describe('richieste per il server', () => {
  it('lotto di una pagina', () => {
    const o = batchFor({ id: crypto.randomUUID(), sweepId: SWEEP_ID, searchKey: IMM.key, readAt: 5, page: 1, report: page('immobiliare'), observations: [obs()], newestId: 9 });
    expect(o.path).toBe('/connector/batches');
    expect(BatchBody.safeParse(o.body).success).toBe(true);
    expect(o.body).toMatchObject({ page: 1, readAt: 5, newestId: 9, searchKey: IMM.key, sweepId: SWEEP_ID });
  });

  it('lotto senza id più recente: il campo manca', () => {
    const o = batchFor({ id: crypto.randomUUID(), sweepId: SWEEP_ID, searchKey: IMM.key, readAt: 5, page: 1, report: page('immobiliare'), observations: [] });
    expect(o.body).not.toHaveProperty('newestId');
    expect(BatchBody.safeParse(o.body).success).toBe(true);
  });

  it('esiti delle sole ricerche chiuse ora, senza le saltate', () => {
    const before = createSweep([IMM, SUB, { ...IMM, key: 'c' }], 0, SWEEP_ID);
    const after: SweepState = {
      ...before,
      runs: [
        { ...before.runs[0]!, pages: 2, privates: 4, outcome: 'complete' },
        { ...before.runs[1]!, outcome: 'skipped' },
        before.runs[2]!,
      ],
    };
    const out = settledRuns(before, after);
    expect(out).toEqual([{ path: '/connector/runs', body: { sweepId: SWEEP_ID, searchKey: IMM.key, outcome: 'complete', pages: 2, privates: 4 } }]);
    expect(RunBody.safeParse(out[0]!.body).success).toBe(true);
    expect(settledRuns(after, after)).toEqual([]);
  });

  it('fine del giro', () => {
    const o = finishFor(SWEEP_ID, 'stopped');
    expect(o).toEqual({ path: `/connector/sweeps/${SWEEP_ID}/finish`, body: { outcome: 'stopped' } });
    expect(FinishBody.safeParse(o.body).success).toBe(true);
  });
});

describe('motivo delle ricerche in errore', () => {
  it('va nel corpo solo se c\'è', () => {
    const before = createSweep([IMM, SUB], 0, SWEEP_ID);
    const after: SweepState = {
      ...before,
      runs: [{ ...before.runs[0]!, outcome: 'error', reason: 'timeout' }, { ...before.runs[1]!, pages: 1, outcome: 'complete' }],
    };
    const [err, ok] = settledRuns(before, after);
    expect(err!.body).toMatchObject({ outcome: 'error', reason: 'timeout' });
    expect(RunBody.safeParse(err!.body).success).toBe(true);
    expect(ok!.body).not.toHaveProperty('reason');
  });
});
