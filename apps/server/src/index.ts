import type { Env } from './env';
import { fail, json, route, sameOrigin, type Route } from './http';
import { adminUserRoutes } from './routes/admin-users';
import { authRoutes } from './routes/auth';

const routes: Route[] = [route('GET', '/api/health', async () => json({ ok: true })), ...authRoutes, ...adminUserRoutes];

async function handleApi(req: Request, env: Env, path: string): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) return fail(403, 'Origine non ammessa');
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const params = r.match(path);
    if (params) return r.h(req, env, params);
  }
  return fail(404, 'Non trovato');
}

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, env, pathname);
      } catch (e) {
        console.error(e);
        return fail(500, 'Errore interno');
      }
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
