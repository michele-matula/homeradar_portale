export const MAX_FAILS_EMAIL = 5;
export const MAX_FAILS_IP = 20;
export const WINDOW_MS = 15 * 60_000;

export async function tooManyAttempts(db: D1Database, email: string, ip: string, now: number): Promise<boolean> {
  const since = now - WINDOW_MS;
  const [byEmail, byIp] = await db.batch<{ n: number }>([
    db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND at > ?').bind(email, since),
    db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?').bind(ip, since),
  ]);
  return (byEmail?.results[0]?.n ?? 0) >= MAX_FAILS_EMAIL || (byIp?.results[0]?.n ?? 0) >= MAX_FAILS_IP;
}

/** Registra un accesso fallito; intanto toglie i tentativi più vecchi della finestra. */
export async function recordFailure(db: D1Database, email: string, ip: string, now: number): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO login_attempts (email, ip, at) VALUES (?, ?, ?)').bind(email, ip, now),
    db.prepare('DELETE FROM login_attempts WHERE at <= ?').bind(now - WINDOW_MS),
  ]);
}

export async function clearFailures(db: D1Database, email: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();
}
