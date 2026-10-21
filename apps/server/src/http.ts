import type { z } from 'zod';
import type { Env } from './env';

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}

export const fail = (status: number, error: string): Response => json({ error }, status);

/** Limite di default dei corpi JSON: le richieste del portale sono piccole. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Testo del corpo; null se supera `max` byte. Si conta leggendo: un corpo senza Content-Length non sfugge al limite. */
async function readText(req: Request, max: number): Promise<string | null> {
  const declared = req.headers.get('Content-Length');
  if (declared != null && !(Number(declared) <= max)) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Corpo JSON validato con lo schema; altrimenti la risposta d'errore pronta. */
export async function readBody<T>(
  req: Request, schema: z.ZodType<T>, limit: { bytes: number; error: string } = { bytes: MAX_BODY_BYTES, error: 'Richiesta troppo grande' },
): Promise<T | Response> {
  if (!(req.headers.get('Content-Type') ?? '').startsWith('application/json')) return fail(415, 'Serve un corpo JSON');
  const text = await readText(req, limit.bytes);
  if (text == null) return fail(413, limit.error);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
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
