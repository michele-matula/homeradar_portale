import { ErrorReportBody } from '@homeradar/shared/api/types';
import { QUOTA, recordErrors, takeQuota } from '../errors';
import { readBody, route, type Route } from '../http';
import { authenticate, sessionToken } from '../session';

/** Errori del portale: anche senza sessione (pagina d'accesso), con un limite per IP. Risposta sempre 204. */
export const errorRoutes: Route[] = [
  route('POST', '/api/errors', async (req, env) => {
    const body = await readBody(req, ErrorReportBody);
    if (body instanceof Response) return body;
    const now = Date.now();
    const auth = sessionToken(req) ? await authenticate(req, env, now) : null;
    const userId = auth && !(auth instanceof Response) ? auth.user.id : undefined;
    const bucket = userId ? `u:${userId}` : `ip:${req.headers.get('CF-Connecting-IP') ?? 'unknown'}`;
    const allowed = await takeQuota(env.DB, bucket, body.errors.length, userId ? QUOTA.user : QUOTA.ip, now);
    if (allowed > 0) await recordErrors(env.DB, { source: 'portal', version: body.version, userId }, body.errors.slice(0, allowed), now);
    return new Response(null, { status: 204 });
  }),
];
