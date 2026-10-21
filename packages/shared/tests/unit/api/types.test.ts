import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CreateUserBody, LoginBody, normalizeEmail, PASSWORD_TOO_SHORT, TokenBody, UpdateUserBody } from '@/api/types';

const PW = 'x'.repeat(10);

describe('schemi delle API', () => {
  it('normalizza l\'email', () => expect(LoginBody.parse({ email: '  Mario@Rossi.IT ', password: PW }).email).toBe('mario@rossi.it'));
  it('normalizeEmail', () => expect(normalizeEmail(' A@B.It ')).toBe('a@b.it'));
  it('rifiuta email non valide', () => expect(LoginBody.safeParse({ email: 'mario', password: PW }).success).toBe(false));
  it('rifiuta password corte', () => expect(TokenBody.safeParse({ password: 'corta' }).error?.issues[0]?.message).toBe(PASSWORD_TOO_SHORT));
  it('rifiuta password oltre 200 caratteri', () => expect(TokenBody.safeParse({ password: 'x'.repeat(201) }).success).toBe(false));
  it('rifiuta campi non dichiarati', () => expect(LoginBody.safeParse({ email: 'a@b.it', password: PW, role: 'admin' }).success).toBe(false));
  it('rifiuta codici ISTAT malformati', () => expect(CreateUserBody.safeParse({ email: 'a@b.it', comuni: ['15059'] }).success).toBe(false));
  it('accetta un utente valido', () => expect(CreateUserBody.parse({ email: 'a@b.it', comuni: ['015059'] })).toEqual({ email: 'a@b.it', comuni: ['015059'] }));
  it('maxComuni fra 1 e 30', () => {
    expect(UpdateUserBody.safeParse({ maxComuni: 0 }).success).toBe(false);
    expect(UpdateUserBody.safeParse({ maxComuni: 31 }).success).toBe(false);
    expect(UpdateUserBody.safeParse({ maxComuni: 2.5 }).success).toBe(false);
    expect(UpdateUserBody.safeParse({ maxComuni: 30 }).success).toBe(true);
  });
  it('lo stato si cambia solo fra attivo e sospeso', () => expect(UpdateUserBody.safeParse({ status: 'invited' }).success).toBe(false));

  it('ogni errore ha un messaggio in italiano', () => {
    const cases: [z.ZodType, unknown, string][] = [
      [UpdateUserBody, { maxComuni: 0 }, 'Il limite dei comuni deve essere un intero fra 1 e 30'],
      [UpdateUserBody, { maxComuni: '4' }, 'Il limite dei comuni deve essere un intero fra 1 e 30'],
      [UpdateUserBody, { comuni: '016219' }, 'Elenco dei comuni non valido'],
      [UpdateUserBody, { status: 'invited' }, 'Stato non valido'],
      [LoginBody, { email: 'a@b.it', password: PW, role: 'admin' }, 'Campo non ammesso: role'],
      [LoginBody, { email: 'a@b.it' }, 'Password mancante'],
      [LoginBody, { password: PW }, 'Email mancante'],
      [LoginBody, 'testo', 'Richiesta non valida'],
      [TokenBody, { password: PW, privacyVersion: 'uno' }, 'Versione dell\'informativa non valida'],
    ];
    for (const [schema, input, message] of cases) expect(schema.safeParse(input).error?.issues[0]?.message).toBe(message);
  });
});
