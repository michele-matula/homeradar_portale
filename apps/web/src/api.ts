export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Unico punto che parla col server: JSON in andata e ritorno, errori come ApiError col messaggio del server. */
export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Server non raggiungibile: controlla la connessione', 0);
  }
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error ?? `Errore ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : 'Errore imprevisto');
