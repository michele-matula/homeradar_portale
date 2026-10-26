import { DEFAULT_AGENT_SETTINGS } from '@homeradar/shared/api/types';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/App';

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Reply = { status: number; body?: unknown };
/** Risposte per "METODO /percorso"; una funzione riceve il corpo della richiesta. */
export type Routes = Record<string, Reply | ((body: unknown) => Reply)>;

/** fetch simulato: registra le chiamate e risponde secondo `routes` (404 per le altre). */
export function mockApi(routes: Routes): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: input, body });
    const r = routes[`${method} ${input}`];
    const reply = typeof r === 'function' ? r(body) : (r ?? { status: 404, body: { error: 'Non trovato' } });
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

export function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return render(<App />);
}

export const AGENT = { id: 'u1', email: 'mario@rossi.it', role: 'agent', comuni: [{ istat: '016219', name: 'Treviglio', province: 'BG' }] };
export const ADMIN = { id: 'a1', email: 'admin@homeradar.test', role: 'admin', comuni: [] };
export const NOT_LOGGED = { status: 401, body: { error: 'Accesso richiesto' } };

/** Risposte di base per un agente collegato senza lead né giri. */
export const AGENT_ROUTES: Routes = {
  'GET /api/me': { status: 200, body: { user: AGENT } },
  'GET /api/leads': { status: 200, body: { leads: [], dueRecalls: 0 } },
  'GET /api/sweep': { status: 200, body: { running: null, last: null } },
  'GET /api/devices': { status: 200, body: [] },
  'GET /api/settings': { status: 200, body: DEFAULT_AGENT_SETTINGS },
  'POST /api/leads/visit': { status: 200, body: { newSince: null } },
};
