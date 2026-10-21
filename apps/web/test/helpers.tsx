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
