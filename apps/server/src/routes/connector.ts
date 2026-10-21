import { BatchBody, StartSweepBody } from '@homeradar/shared/api/connector';
import { deviceRoute } from '../device';
import { fail, json, readBody, type Route } from '../http';
import { ingestBatch, MAX_BATCH_BYTES } from '../ingest';
import { startSweep } from '../sweeps';

/** Rotte del connettore (`/connector/*`): token di dispositivo, nessun controllo dell'Origin. */
export const connectorRoutes: Route[] = [
  deviceRoute('POST', '/connector/sweeps', async (req, env, _p, { user, deviceId, now }) => {
    const body = await readBody(req, StartSweepBody);
    if (body instanceof Response) return body;
    const plan = await startSweep(env.DB, user, deviceId, now);
    if (plan instanceof Response) return plan;
    return json(plan, plan.sweepId ? 201 : 200);
  }),

  deviceRoute('POST', '/connector/batches', async (req, env, _p, { user, deviceId, now }) => {
    // Prima di leggere il corpo: un lotto enorme non si carica in memoria.
    if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BATCH_BYTES) return fail(413, 'Lotto troppo grande');
    const body = await readBody(req, BatchBody);
    if (body instanceof Response) return body;
    return ingestBatch(env.DB, user, deviceId, body, now);
  }),
];
