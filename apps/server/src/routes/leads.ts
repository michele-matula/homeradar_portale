import { AgentSettingsBody, type LeadsResponse } from '@homeradar/shared/api/types';
import { fail, json, readBody, type Route } from '../http';
import { agentLeads, dueRecallCount } from '../leads';
import { userRoute } from '../session';
import { getSettings, saveSettings } from '../settings';

/** Rotte dell'agente: lead, impostazioni, giro. Ogni dato privato è quello dell'utente della sessione. */
export const leadRoutes: Route[] = [
  userRoute('GET', '/api/leads', async (_req, env, _p, { user, now }) => {
    const leads = await agentLeads(env.DB, user, now);
    return json({ leads, dueRecalls: dueRecallCount(leads, now) } satisfies LeadsResponse);
  }),

  userRoute('GET', '/api/settings', async (_req, env, _p, { user }) => json(await getSettings(env.DB, user.id))),

  userRoute('PUT', '/api/settings', async (req, env, _p, { user, now }) => {
    const body = await readBody(req, AgentSettingsBody);
    if (body instanceof Response) return body;
    const s = await saveSettings(env.DB, user.id, body, now);
    return typeof s === 'string' ? fail(400, s) : json(s);
  }),
];
