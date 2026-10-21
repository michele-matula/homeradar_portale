import { describe, expect, it } from 'vitest';
import { hashPassword, hashToken, newToken, verifyPassword } from '../src/crypto';

describe('password e token', () => {
  it('verifica la password giusta e rifiuta quella sbagliata', async () => {
    const h = await hashPassword('password-lunga');
    expect(h).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await verifyPassword('password-lunga', h)).toBe(true);
    expect(await verifyPassword('password-lungA', h)).toBe(false);
  });
  it('due hash della stessa password sono diversi', async () => expect(await hashPassword('x'.repeat(10))).not.toBe(await hashPassword('x'.repeat(10))));
  it('un hash malformato non verifica', async () => expect(await verifyPassword('x', 'rotto')).toBe(false));
  it('token di 32 byte in base64url', () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
  });
  it('hash del token in esadecimale', async () => expect(await hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
});
