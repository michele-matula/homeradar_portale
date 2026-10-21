import { z } from 'zod';
import {
  DEFAULT_SETTINGS, LEAD_STATUSES, PORTALS, PROPERTY_CATEGORIES, type ComuneRef, type LeadView, type Portal, type PropertyCategory,
} from '../shared/types';

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
export const body = <T extends z.core.$ZodLooseShape>(shape: T) =>
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

// Archivio: impostazioni dell'agente, lead, stato, separazione.

/** Impostazioni private dell'agente: soglie della priorità, categorie e portali del giro. I comuni li assegna l'admin. */
export interface AgentSettings {
  minAgeDays: number;
  minDropPercent: number;
  categories: PropertyCategory[];
  enabledPortals: Record<Portal, boolean>;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  minAgeDays: DEFAULT_SETTINGS.minAgeDays,
  minDropPercent: DEFAULT_SETTINGS.minDropPercent,
  categories: DEFAULT_SETTINGS.searchArea.categories,
  enabledPortals: DEFAULT_SETTINGS.enabledPortals,
};

const AGE_ERROR = { error: 'Soglia giorni non valida' };
const DROP_ERROR = { error: 'Ribasso minimo non valido' };
const PORTALS_ERROR = { error: 'Portali attivi non validi' };
export const AgentSettingsBody = body({
  minAgeDays: z.number(AGE_ERROR).int(AGE_ERROR).min(1, AGE_ERROR).max(3650, AGE_ERROR).optional(),
  minDropPercent: z.number(DROP_ERROR).min(0, DROP_ERROR).max(100, DROP_ERROR).optional(),
  categories: z
    .array(z.enum(PROPERTY_CATEGORIES, { error: 'Categoria non valida' }), { error: 'Categorie non valide' })
    .min(1, { error: 'Scegli almeno una categoria' })
    .optional(),
  enabledPortals: z.partialRecord(z.enum(PORTALS, PORTALS_ERROR), z.boolean(PORTALS_ERROR), PORTALS_ERROR).optional(),
});

export interface LeadsResponse {
  leads: LeadView[];
  /** Lead con un richiamo di oggi o scaduto: lo stesso immobile su più portali conta una volta. */
  dueRecalls: number;
}

const ListingKey = z.string({ error: 'Annuncio non valido' }).regex(/^(immobiliare|idealista|subito|casadaprivato):\d+$/, { error: 'Annuncio non valido' });
const NOTES_ERROR = { error: 'Note troppo lunghe' };
export const LeadStateBody = body({
  keys: z.array(ListingKey, { error: 'Annunci non validi' }).min(1, { error: 'Annunci non validi' }).max(50, { error: 'Troppi annunci' }),
  status: z.enum(LEAD_STATUSES, { error: 'Stato non valido' }).optional(),
  notes: z.string(NOTES_ERROR).max(2000, NOTES_ERROR).optional(),
  recallAt: z.number({ error: 'Richiamo non valido' }).int({ error: 'Richiamo non valido' }).nullable().optional(),
});
export const SplitBody = body({
  key: ListingKey,
  fromKeys: z.array(ListingKey, { error: 'Annunci non validi' }).min(1, { error: 'Annunci non validi' }).max(20, { error: 'Troppi annunci' }),
});
