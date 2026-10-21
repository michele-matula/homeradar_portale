import type { z } from 'zod';
import type { Env } from './env';

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}

export const fail = (status: number, error: string): Response => json({ error }, status);

/** Corpo JSON validato con lo schema; altrimenti la risposta d'errore pronta. */
export async function readBody<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  if (!(req.headers.get('Content-Type') ?? '').startsWith('application/json')) return fail(415, 'Serve un corpo JSON');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, 'JSON non valido');
  }
  const r = schema.safeParse(raw);
  return r.success ? r.data : fail(400, r.error.issues[0]?.message ?? 'Richiesta non valida');
}

/** La richiesta arriva da una pagina della stessa origine: difesa dal CSRF insieme a SameSite=Lax. */
export function sameOrigin(req: Request): boolean {
  return req.headers.get('Origin') === new URL(req.url).origin;
}

export type Handler = (req: Request, env: Env, params: Record<string, string>) => Promise<Response>;

export interface Route {
  method: string;
  match(path: string): Record<string, string> | null;
  h: Handler;
}

/** `pattern` come "/api/users/:id": i segmenti con ":" diventano parametri. */
export function route(method: string, pattern: string, h: Handler): Route {
  const parts = pattern.split('/');
  return {
    method,
    h,
    match(path) {
      const segs = path.split('/');
      if (segs.length !== parts.length) return null;
      const params: Record<string, string> = {};
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]!;
        const s = segs[i]!;
        if (p.startsWith(':')) {
          if (!s) return null;
          params[p.slice(1)] = decodeURIComponent(s);
        } else if (p !== s) return null;
      }
      return params;
    },
  };
}
