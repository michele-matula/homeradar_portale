/** Data e ora brevi per le pagine dell'admin; null = «mai». */
export const dateTime = (ms: number | null): string =>
  ms == null ? 'mai' : new Date(ms).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
