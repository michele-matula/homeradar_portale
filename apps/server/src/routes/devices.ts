import { createLinkCode, deleteDevice, listDevices } from '../device';
import { fail, json, type Route } from '../http';
import { userRoute } from '../session';
import { closeDeviceSweeps } from '../sweeps';

/** Computer collegati dell'agente e codice per collegarne uno. */
export const deviceRoutes: Route[] = [
  userRoute('POST', '/api/devices/link-code', async (_req, env, _p, { user, now }) => {
    const code = await createLinkCode(env.DB, user.id, now);
    return code ? json({ code }, 201) : fail(429, 'Troppi codici di collegamento: riprova tra qualche minuto');
  }),

  userRoute('GET', '/api/devices', async (_req, env, _p, { user }) => json(await listDevices(env.DB, user.id))),

  userRoute('DELETE', '/api/devices/:id', async (_req, env, { id }, { user, now }) => {
    // Il connettore scollegato non manderà più la fine del giro: lo si chiude qui, così il «Cerca» successivo parte.
    await closeDeviceSweeps(env.DB, user.id, id!, now);
    return (await deleteDevice(env.DB, user.id, id!)) ? new Response(null, { status: 204 }) : fail(404, 'Dispositivo non trovato');
  }),
];
