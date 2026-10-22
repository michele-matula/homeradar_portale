import type { ControlAgent, ErrorSource } from '@homeradar/shared/api/types';
import { agentSweeps, controlRows, errorGroups, sweepRuns } from '../control';
import { deleteDevice } from '../device';
import { fail, json, type Route } from '../http';
import { closeDeviceSweeps } from '../sweeps';
import { admin } from './admin-users';

const SOURCES: ErrorSource[] = ['portal', 'connector', 'server'];
/** Giri mostrati nella scheda dell'agente. */
const AGENT_SWEEPS = 20;

/** Pagine «Controllo» ed «Errori» dell'admin, e revoca dei connettori. */
export const adminControlRoutes: Route[] = [
  admin('GET', '/api/admin/control', async (_req, env, _p, now) => json(await controlRows(env.DB, now))),

  admin('GET', '/api/admin/control/:userId', async (_req, env, { userId }, now) => {
    const [row] = await controlRows(env.DB, now, userId!);
    if (!row) return fail(404, 'Agente non trovato');
    const body: ControlAgent = {
      row, sweeps: await agentSweeps(env.DB, row.userId, AGENT_SWEEPS), errors: await errorGroups(env.DB, now, { userId: row.userId }),
    };
    return json(body);
  }),

  admin('GET', '/api/admin/sweeps/:id/runs', async (_req, env, { id }) => {
    const exists = await env.DB.prepare('SELECT id FROM sweeps WHERE id = ?').bind(id).first();
    if (!exists) return fail(404, 'Giro non trovato');
    return json(await sweepRuns(env.DB, id!));
  }),

  admin('GET', '/api/admin/errors', async (req, env, _p, now) => {
    const source = new URL(req.url).searchParams.get('source');
    if (source != null && !SOURCES.includes(source as ErrorSource)) return fail(400, 'Provenienza non valida');
    return json(await errorGroups(env.DB, now, source ? { source: source as ErrorSource } : {}));
  }),

  // Come quando l'agente lo scollega: i giri aperti di quel connettore si chiudono, poi il dispositivo sparisce.
  admin('DELETE', '/api/admin/devices/:id', async (_req, env, { id }, now) => {
    const d = await env.DB.prepare('SELECT user_id FROM devices WHERE id = ?').bind(id).first<{ user_id: string }>();
    if (!d) return fail(404, 'Dispositivo non trovato');
    await closeDeviceSweeps(env.DB, d.user_id, id!, now);
    await deleteDevice(env.DB, d.user_id, id!);
    return new Response(null, { status: 204 });
  }),
];
