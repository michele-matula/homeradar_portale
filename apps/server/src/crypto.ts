const ITERATIONS = 100_000; // massimo ammesso da PBKDF2 nei Workers
const SALT_BYTES = 16;
const HASH_BITS = 256;
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS));
}

/** "pbkdf2$<iterazioni>$<sale>$<hash>", sale e hash in base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split('$');
  if (algo !== 'pbkdf2' || !iter || !salt || !hash) return false;
  try {
    const expected = fromB64url(hash);
    const actual = await derive(password, fromB64url(salt), Number(iter));
    return actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function newToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(token)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
