import { AgentSettingsBody, LeadStateBody, SplitBody, type LeadsResponse } from '@homeradar/shared/api/types';
import { fail, json, readBody, type Route } from '../http';
import { agentLeads, dueRecallCount, setLeadState, splitLead } from '../leads';
import { userRoute } from '../session';
import { getSettings, saveSettings } from '../settings';

/** Rotte dell'agente: lead, impostazioni, giro. Ogni dato privato è quello dell'utente della sessione. */
export const leadRoutes: Route[] = [
  userRoute('GET', '/api/leads', async (_req, env, _p, { user, now }) => {
    const leads = await agentLeads(env.DB, user, now);
    return json({ leads, dueRecalls: dueRecallCount(leads, now) } satisfies LeadsResponse);
  }),

  userRoute('PATCH', '/api/leads/state', async (req, env, _p, { user, now }) => {
    const body = await readBody(req, LeadStateBody);
    if (body instanceof Response) return body;
    const { keys, ...patch } = body;
    const state = await setLeadState(env.DB, user.id, keys, patch, now);
    return state instanceof Response ? state : json({ state });
  }),

  userRoute('POST', '/api/leads/split', async (req, env, _p, { user, now }) => {
    const body = await readBody(req, SplitBody);
    if (body instanceof Response) return body;
    return (await splitLead(env.DB, user, body.key, body.fromKeys, now)) ?? new Response(null, { status: 204 });
  }),

  userRoute('GET', '/api/settings', async (_req, env, _p, { user }) => json(await getSettings(env.DB, user.id))),

  userRoute('PUT', '/api/settings', async (req, env, _p, { user, now }) => {
    const body = await readBody(req, AgentSettingsBody);
    if (body instanceof Response) return body;
    const s = await saveSettings(env.DB, user.id, body, now);
    return typeof s === 'string' ? fail(400, s) : json(s);
  }),
];
