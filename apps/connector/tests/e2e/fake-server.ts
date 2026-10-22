import { createServer } from 'node:http';
import type { SweepPlan } from '@homeradar/shared/api/connector';
import type { SearchSpec } from '@homeradar/shared/shared/types';

export interface Received {
  path: string;
  auth: string | null;
  body: any;
}

/** La ricerca del giro finto: Cassano d'Adda, case, su Immobiliare (come la costruirebbe il server). */
export const CASSANO_CASE: SearchSpec = {
  portal: 'immobiliare', key: 'immobiliare|comune:015059|case', label: "Cassano d'Adda · Case", categories: ['residential'],
  url: 'https://www.immobiliare.it/vendita-case/cassano-d-adda/?criterio=privateFirst',
};

export const cassanoPlan = (): SweepPlan => ({ sweepId: crypto.randomUUID(), searches: [CASSANO_CASE], skipped: 0 });

/** Il portale finto su localhost: pagina vuota (l'origine dei messaggi) e API del connettore che registrano tutto. */
export async function startFakeServer(port = 8799) {
  const received: Received[] = [];
  const failures = new Map<string, { n: number; status: number }>();
  let plan = cassanoPlan();
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const path = req.url ?? '/';
      const send = (status: number, body?: unknown) => {
        res.writeHead(status, { 'Content-Type': body === undefined ? 'text/html' : 'application/json' });
        res.end(body === undefined ? '<!doctype html><html><body>Portale finto</body></html>' : JSON.stringify(body));
      };
      if (req.method === 'GET') return send(200);
      received.push({ path, auth: req.headers.authorization ?? null, body: raw ? JSON.parse(raw) : null });
      const key = path.endsWith('/finish') ? '/finish' : path;
      const f = failures.get(key);
      if (f && f.n > 0) {
        f.n--;
        return send(f.status, { error: 'Server giù' });
      }
      if (path === '/connector/link') return send(201, { token: 'tok' });
      if (path === '/connector/sweeps') return send(201, plan);
      return send(200, { ok: true });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return {
    received,
    get plan() {
      return plan;
    },
    newPlan: () => (plan = cassanoPlan()),
    /** Le prossime `n` richieste a `path` (o '/finish') rispondono con `status`. */
    failNext(path: string, n: number, status = 503) {
      failures.set(path, { n, status });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeServer = Awaited<ReturnType<typeof startFakeServer>>;
