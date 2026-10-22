import { ErrorReportBody } from '@homeradar/shared/api/types';
import { QUOTA, recordErrors, takeQuota } from '../errors';
import { readBody, route, type Route } from '../http';
import { authenticate, sessionToken } from '../session';

/** Versione mandata senza sessione: solo un commit (o "dev"), altrimenti chiunque crea gruppi nuovi a piacere. */
const KNOWN_VERSION = /^(?:[0-9a-f]{7,12}|dev)$/;

/** Chiave della quota di un IP: per IPv6 la /64, che di solito è un solo cliente. */
export function ipBucket(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** Errori del portale: anche senza sessione (pagina d'accesso), con limiti per IP e in tutto. Risposta sempre 204. */
export const errorRoutes: Route[] = [
  route('POST', '/api/errors', async (req, env) => {
    const body = await readBody(req, ErrorReportBody);
    if (body instanceof Response) return body;
    const now = Date.now();
    const auth = sessionToken(req) ? await authenticate(req, env, now, false) : null;
    const userId = auth && !(auth instanceof Response) ? auth.user.id : undefined;
    let allowed: number;
    if (userId) allowed = await takeQuota(env.DB, `u:${userId}`, body.errors.length, QUOTA.user, now);
    else {
      const ip = await takeQuota(env.DB, `ip:${ipBucket(req.headers.get('CF-Connecting-IP') ?? 'unknown')}`, body.errors.length, QUOTA.ip, now);
      allowed = ip > 0 ? await takeQuota(env.DB, 'anonymous', ip, QUOTA.anonymous, now) : 0;
    }
    if (allowed > 0) {
      const version = userId || KNOWN_VERSION.test(body.version) ? body.version : 'sconosciuta';
      await recordErrors(env.DB, { source: 'portal', version, userId }, body.errors.slice(0, allowed), now);
    }
    return new Response(null, { status: 204 });
  }),
];
