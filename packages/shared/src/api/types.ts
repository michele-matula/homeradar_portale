import { z } from 'zod';
import type { ComuneRef } from '../shared/types';

export type Role = 'agent' | 'admin';
export type UserStatus = 'invited' | 'active' | 'suspended';

/** Versione dell'informativa che l'agente accetta all'attivazione; si alza quando il testo cambia. */
export const PRIVACY_VERSION = 1;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const PASSWORD_TOO_SHORT = 'La password deve avere almeno 10 caratteri';

export interface Me {
  id: string;
  email: string;
  role: Role;
  comuni: ComuneRef[];
}

export interface AdminUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  comuni: ComuneRef[];
  maxComuni: number;
  createdAt: number;
  lastSeenAt: number | null;
}

export interface TokenInfo {
  kind: 'invite' | 'reset';
  email: string;
}

export const normalizeEmail = (s: string): string => s.trim().toLowerCase();

// Ogni errore ha un messaggio in italiano: il server lo restituisce così com'è (`readBody`).
const missingOr = (missing: string, invalid: string) => ({ error: (iss: { input?: unknown }) => (iss.input === undefined ? missing : invalid) });
/** Oggetto senza campi non dichiarati; un corpo che non è un oggetto è "Richiesta non valida". */
const body = <T extends z.core.$ZodLooseShape>(shape: T) =>
  z.strictObject(shape, {
    error: (iss) => (iss.code === 'unrecognized_keys' ? `Campo non ammesso: ${iss.keys.join(', ')}` : 'Richiesta non valida'),
  });

const Email = z.string(missingOr('Email mancante', 'Email non valida')).transform(normalizeEmail).pipe(z.email({ error: 'Email non valida' }));
const Password = z
  .string(missingOr('Password mancante', 'Password non valida'))
  .min(PASSWORD_MIN, { error: PASSWORD_TOO_SHORT })
  .max(PASSWORD_MAX, { error: 'Password troppo lunga' });
const Istat = z.string({ error: 'Codice ISTAT non valido' }).regex(/^\d{6}$/, { error: 'Codice ISTAT non valido' });
const Comuni = z.array(Istat, { error: 'Elenco dei comuni non valido' });
const MAX_COMUNI_ERROR = { error: 'Il limite dei comuni deve essere un intero fra 1 e 30' };
const MaxComuni = z.number(MAX_COMUNI_ERROR).int(MAX_COMUNI_ERROR).min(1, MAX_COMUNI_ERROR).max(30, MAX_COMUNI_ERROR);

export const LoginBody = body({
  email: Email,
  password: z.string(missingOr('Password mancante', 'Password non valida')).max(PASSWORD_MAX, { error: 'Password troppo lunga' }),
});
export const TokenBody = body({
  password: Password,
  privacyVersion: z.number({ error: "Versione dell'informativa non valida" }).int({ error: "Versione dell'informativa non valida" }).optional(),
});
export const CreateUserBody = body({ email: Email, comuni: Comuni, maxComuni: MaxComuni.optional() });
export const UpdateUserBody = body({
  comuni: Comuni.optional(),
  maxComuni: MaxComuni.optional(),
  status: z.enum(['active', 'suspended'], { error: 'Stato non valido' }).optional(),
});
