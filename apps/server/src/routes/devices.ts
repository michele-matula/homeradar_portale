import { createLinkCode, deleteDevice, listDevices } from '../device';
import { fail, json, type Route } from '../http';
import { userRoute } from '../session';

/** Computer collegati dell'agente e codice per collegarne uno. */
export const deviceRoutes: Route[] = [
  userRoute('POST', '/api/devices/link-code', async (_req, env, _p, { user, now }) => json({ code: await createLinkCode(env.DB, user.id, now) }, 201)),

  userRoute('GET', '/api/devices', async (_req, env, _p, { user }) => json(await listDevices(env.DB, user.id))),

  userRoute('DELETE', '/api/devices/:id', async (_req, env, { id }, { user }) =>
    (await deleteDevice(env.DB, user.id, id!)) ? new Response(null, { status: 204 }) : fail(404, 'Dispositivo non trovato')),
];
