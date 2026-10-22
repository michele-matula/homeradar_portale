import { BatchBody, FinishBody, LinkBody, RunBody, StartSweepBody } from '@homeradar/shared/api/connector';
import { deviceRoute, insertDevice, redeemLinkCode } from '../device';
import { fail, json, readBody, route, type Route } from '../http';
import { ingestBatch, MAX_BATCH_BYTES } from '../ingest';
import { finishSweep, reportRun, startSweep } from '../sweeps';
import { findUserById } from '../users';

/** Rotte del connettore (`/connector/*`): token di dispositivo, nessun controllo dell'Origin. */
export const connectorRoutes: Route[] = [
  // L'unica rotta senza token: il codice monouso avuto dal portale diventa il token del dispositivo.
  route('POST', '/connector/link', async (req, env) => {
    const body = await readBody(req, LinkBody);
    if (body instanceof Response) return body;
    const now = Date.now();
    const userId = await redeemLinkCode(env.DB, body.code, now);
    const user = userId && (await findUserById(env.DB, userId));
    if (!user) return fail(400, 'Codice di collegamento non valido o scaduto');
    if (user.status !== 'active') return fail(403, 'Account sospeso');
    const { token } = await insertDevice(env.DB, user.id, body.name, now, body.version);
    // L'account del token: il portale lo confronta con quello di chi è entrato (PC condiviso, cambio d'account).
    return json({ token, userId: user.id }, 201);
  }),

  deviceRoute('POST', '/connector/sweeps', async (req, env, _p, { user, deviceId, now }) => {
    const body = await readBody(req, StartSweepBody);
    if (body instanceof Response) return body;
    const plan = await startSweep(env.DB, user, deviceId, now);
    if (plan instanceof Response) return plan;
    return json(plan, plan.sweepId ? 201 : 200);
  }),

  deviceRoute('POST', '/connector/batches', async (req, env, _p, { user, deviceId, now }) => {
    // Il limite si conta leggendo il corpo: un lotto enorme non si carica in memoria.
    const body = await readBody(req, BatchBody, { bytes: MAX_BATCH_BYTES, error: 'Lotto troppo grande' });
    if (body instanceof Response) return body;
    return ingestBatch(env.DB, user, deviceId, body, now);
  }),

  deviceRoute('POST', '/connector/runs', async (req, env, _p, { user, now }) => {
    const body = await readBody(req, RunBody);
    if (body instanceof Response) return body;
    return reportRun(env.DB, user, body, now);
  }),

  deviceRoute('POST', '/connector/sweeps/:id/finish', async (req, env, { id }, { user, now }) => {
    const body = await readBody(req, FinishBody);
    if (body instanceof Response) return body;
    const own = await env.DB.prepare('SELECT id FROM sweeps WHERE id = ? AND user_id = ?').bind(id, user.id).first();
    if (!own) return fail(404, 'Giro non trovato');
    return json({ result: await finishSweep(env.DB, id!, body.outcome, now) });
  }),
];
