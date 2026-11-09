import { BatchBody, FinishBody, HelloBody, LinkBody, RemotePollBody, RunBody, StartSweepBody } from '@homeradar/shared/api/connector';
import { ErrorReportBody } from '@homeradar/shared/api/types';
import { DEVICE_NAME, deviceRoute, insertDevice, redeemLinkCode, replaceDevice, touchDevice } from '../device';
import { QUOTA, recordErrors, takeQuota } from '../errors';
import { fail, json, readBody, route, type Route } from '../http';
import { ingestBatch, MAX_BATCH_BYTES } from '../ingest';
import { pollRemote } from '../remote';
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
    // Il connettore manda qui il nome scelto dall'agente (o quello automatico, se non l'ha scelto): diventa anche
    // l'etichetta, che hello non tocca. Senza, al primo hello il nome tornerebbe «Chrome su Windows».
    const { id, token } = await insertDevice(env.DB, user.id, body.name, now, body.version, body.name);
    if (body.previousToken) await replaceDevice(env.DB, user.id, body.previousToken, id);
    // L'account del token: il portale lo confronta con quello di chi è entrato (PC condiviso, cambio d'account).
    return json({ token, userId: user.id, deviceId: id }, 201);
  }),

  deviceRoute('POST', '/connector/sweeps', async (req, env, _p, { user, deviceId, now }) => {
    const body = await readBody(req, StartSweepBody);
    if (body instanceof Response) return body;
    const plan = await startSweep(env.DB, user, deviceId, now, { auto: body.auto === true, remote: body.remote });
    if (plan instanceof Response) return plan;
    return json(plan, plan.sweepId ? 201 : 200);
  }),

  deviceRoute('POST', '/connector/batches', async (req, env, _p, { user, deviceId, now }) => {
    // Il limite si conta leggendo il corpo: un lotto enorme non si carica in memoria.
    const body = await readBody(req, BatchBody, { bytes: MAX_BATCH_BYTES, error: 'Lotto troppo grande' });
    if (body instanceof Response) return body;
    const r = await ingestBatch(env.DB, user, deviceId, body, now);
    if (r.status !== 200) return r;
    // «Ferma» dal telefono: i lotti arrivano a ogni pagina, la risposta lo porta al connettore in pochi secondi.
    const stop = await env.DB.prepare('SELECT 1 FROM sweeps WHERE id = ? AND user_id = ? AND stop_requested = 1 AND finished_at IS NULL').bind(body.sweepId, user.id).first();
    return stop ? json({ ok: true, stop: true }) : r;
  }),

  // Controllo del connettore (ogni minuto con «Avvia dal telefono» attivo): richiesta da prendere e stop del giro.
  deviceRoute('POST', '/connector/remote', async (req, env, _p, { user, deviceId, now }) => {
    const body = await readBody(req, RemotePollBody);
    if (body instanceof Response) return body;
    return json(await pollRemote(env.DB, user, deviceId, now));
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

  deviceRoute('POST', '/connector/hello', async (req, env, _p, { deviceId, now }) => {
    const body = await readBody(req, HelloBody);
    if (body instanceof Response) return body;
    await touchDevice(env.DB, deviceId, body.name, body.version, now);
    const remote = await env.DB.prepare('SELECT remote FROM devices WHERE id = ?').bind(deviceId).first<number>('remote');
    return json({ deviceId, remote: remote === 1 });
  }),

  deviceRoute('POST', '/connector/errors', async (req, env, _p, { user, deviceId, now }) => {
    const body = await readBody(req, ErrorReportBody);
    if (body instanceof Response) return body;
    const allowed = await takeQuota(env.DB, `d:${deviceId}`, body.errors.length, QUOTA.device, now);
    if (allowed > 0) {
      const d = await env.DB.prepare(`SELECT ${DEVICE_NAME} AS name FROM devices d WHERE id = ?`).bind(deviceId).first<{ name: string }>();
      const origin = { source: 'connector' as const, version: body.version, userId: user.id, deviceId, deviceName: d?.name };
      await recordErrors(env.DB, origin, body.errors.slice(0, allowed), now);
    }
    return new Response(null, { status: 204 });
  }),
];
