import type { Env } from './env';
import { fail, json, route, sameOrigin, type Route } from './http';
import { adminUserRoutes } from './routes/admin-users';
import { authRoutes } from './routes/auth';
import { connectorRoutes } from './routes/connector';
import { leadRoutes } from './routes/leads';

const routes: Route[] = [route('GET', '/api/health', async () => json({ ok: true })), ...authRoutes, ...adminUserRoutes, ...leadRoutes];

async function dispatch(req: Request, env: Env, path: string, list: Route[]): Promise<Response> {
  for (const r of list) {
    if (r.method !== req.method) continue;
    const params = r.match(path);
    if (params) return r.h(req, env, params);
  }
  return fail(404, 'Non trovato');
}

async function handleApi(req: Request, env: Env, path: string): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) return fail(403, 'Origine non ammessa');
  return dispatch(req, env, path, routes);
}

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    // Il connettore non è una pagina del portale: niente cookie, si autentica con il token del dispositivo.
    const api = under(pathname, '/api');
    if (api || under(pathname, '/connector')) {
      try {
        return api ? await handleApi(req, env, pathname) : await dispatch(req, env, pathname, connectorRoutes);
      } catch (e) {
        console.error(e);
        return fail(500, 'Errore interno');
      }
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
