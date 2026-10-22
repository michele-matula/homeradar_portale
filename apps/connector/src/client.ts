import { NOT_LINKED } from '@homeradar/shared/api/connector-messages';

/** Risposta del server; `status` 0 = rete assente o server irraggiungibile. */
export interface ServerReply {
  status: number;
  data: unknown;
}

/** Richieste a `/connector/*` con il token del dispositivo. */
export function createClient(d: { baseUrl: string; token(): Promise<string | null>; fetch: typeof fetch }) {
  return {
    async post(path: string, body: unknown): Promise<ServerReply> {
      const token = await d.token();
      if (!token) return { status: 401, data: { error: NOT_LINKED } };
      let res: Response;
      try {
        res = await d.fetch(`${d.baseUrl}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        return { status: 0, data: null };
      }
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        // Risposta non JSON (proxy, pagina d'errore): conta solo lo stato.
      }
      return { status: res.status, data };
    },
  };
}

/** Messaggio d'errore del server, se c'è. */
export const errorOf = (r: ServerReply): string | null => (r.data as { error?: unknown } | null)?.error as string | null ?? null;
