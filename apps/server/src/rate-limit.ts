export const MAX_FAILS_EMAIL = 5;
export const MAX_FAILS_IP = 20;
export const WINDOW_MS = 15 * 60_000;

/**
 * Vero se, contando anche il tentativo appena registrato, si superano i limiti della finestra:
 * dopo 5 errori su un'email (20 da un IP) il tentativo successivo è rifiutato.
 */
export async function tooManyAttempts(db: D1Database, email: string, ip: string, now: number): Promise<boolean> {
  const since = now - WINDOW_MS;
  const [byEmail, byIp] = await db.batch<{ n: number }>([
    db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND at > ?').bind(email, since),
    db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?').bind(ip, since),
  ]);
  return (byEmail?.results[0]?.n ?? 0) > MAX_FAILS_EMAIL || (byIp?.results[0]?.n ?? 0) > MAX_FAILS_IP;
}

/**
 * Registra un tentativo prima di verificare la password (D1 serializza le scritture: richieste in parallelo
 * si contano tutte); intanto toglie i tentativi più vecchi della finestra. Un accesso riuscito li cancella.
 */
export async function recordAttempt(db: D1Database, email: string, ip: string, now: number): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO login_attempts (email, ip, at) VALUES (?, ?, ?)').bind(email, ip, now),
    db.prepare('DELETE FROM login_attempts WHERE at <= ?').bind(now - WINDOW_MS),
  ]);
}

export async function clearFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();
}
