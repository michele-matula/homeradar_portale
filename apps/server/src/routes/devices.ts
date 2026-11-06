import { DevicePatchBody } from '@homeradar/shared/api/connector';
import { createLinkCode, deleteDevice, listDevices, updateDevice } from '../device';
import { fail, json, readBody, type Route } from '../http';
import { userRoute } from '../session';
import { closeDeviceSweeps } from '../sweeps';

/** Computer collegati dell'agente e codice per collegarne uno. */
export const deviceRoutes: Route[] = [
  userRoute('POST', '/api/devices/link-code', async (_req, env, _p, { user, now }) => {
    const code = await createLinkCode(env.DB, user.id, now);
    return code ? json({ code }, 201) : fail(429, 'Troppi codici di collegamento: riprova tra qualche minuto');
  }),

  userRoute('GET', '/api/devices', async (_req, env, _p, { user, now }) => json(await listDevices(env.DB, user.id, now))),

  userRoute('PATCH', '/api/devices/:id', async (req, env, { id }, { user, now }) => {
    const body = await readBody(req, DevicePatchBody);
    if (body instanceof Response) return body;
    if (!(await updateDevice(env.DB, user.id, id!, body))) return fail(404, 'Dispositivo non trovato');
    return json((await listDevices(env.DB, user.id, now)).find((d) => d.id === id));
  }),

  userRoute('DELETE', '/api/devices/:id', async (_req, env, { id }, { user, now }) => {
    // Il connettore scollegato non manderà più la fine del giro: lo si chiude qui, così il «Cerca» successivo parte.
    await closeDeviceSweeps(env.DB, user.id, id!, now);
    return (await deleteDevice(env.DB, user.id, id!)) ? new Response(null, { status: 204 }) : fail(404, 'Dispositivo non trovato');
  }),
];
