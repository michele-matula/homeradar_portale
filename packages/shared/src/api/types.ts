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

const Email = z.string().transform(normalizeEmail).pipe(z.email({ message: 'Email non valida' }));
const Password = z.string().min(PASSWORD_MIN, { message: PASSWORD_TOO_SHORT }).max(PASSWORD_MAX, { message: 'Password troppo lunga' });
const Istat = z.string().regex(/^\d{6}$/, { message: 'Codice ISTAT non valido' });
const MaxComuni = z.number().int().min(1).max(30);

export const LoginBody = z.strictObject({ email: Email, password: z.string().max(PASSWORD_MAX) });
export const TokenBody = z.strictObject({ password: Password, privacyVersion: z.number().int().optional() });
export const CreateUserBody = z.strictObject({ email: Email, comuni: z.array(Istat), maxComuni: MaxComuni.optional() });
export const UpdateUserBody = z.strictObject({
  comuni: z.array(Istat).optional(),
  maxComuni: MaxComuni.optional(),
  status: z.enum(['active', 'suspended']).optional(),
});
