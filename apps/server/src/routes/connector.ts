import { StartSweepBody } from '@homeradar/shared/api/connector';
import { deviceRoute } from '../device';
import { json, readBody, type Route } from '../http';
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
];
