import { z } from 'zod';
import {
  DEFAULT_SETTINGS, LEAD_STATUSES, PORTALS, PROPERTY_CATEGORIES, type ComuneRef, type LeadView, type Portal, type PropertyCategory, type SweepOutcome,
} from '../shared/types';
import type { SearchErrorReason } from '../core/sweep';
import { AUTO_SWEEP_HOURS, type AutoSweepHours } from '../core/auto-sweep';

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
  /** Il connettore fa il giro da solo quando l'agente usa il computer. */
  autoSweep: boolean;
  /** null = una volta al giorno. */
  autoSweepHours: AutoSweepHours | null;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  minAgeDays: DEFAULT_SETTINGS.minAgeDays,
  minDropPercent: DEFAULT_SETTINGS.minDropPercent,
  categories: DEFAULT_SETTINGS.searchArea.categories,
  enabledPortals: DEFAULT_SETTINGS.enabledPortals,
  autoSweep: false,
  autoSweepHours: null,
};

const AGE_ERROR = { error: 'Soglia giorni non valida' };
const DROP_ERROR = { error: 'Ribasso minimo non valido' };
const PORTALS_ERROR = { error: 'Portali attivi non validi' };
const AUTO_ERROR = { error: 'Frequenza del giro automatico non valida' };
export const AgentSettingsBody = body({
  minAgeDays: z.number(AGE_ERROR).int(AGE_ERROR).min(1, AGE_ERROR).max(3650, AGE_ERROR).optional(),
  minDropPercent: z.number(DROP_ERROR).min(0, DROP_ERROR).max(100, DROP_ERROR).optional(),
  categories: z
    .array(z.enum(PROPERTY_CATEGORIES, { error: 'Categoria non valida' }), { error: 'Categorie non valide' })
    .min(1, { error: 'Scegli almeno una categoria' })
    .optional(),
  enabledPortals: z.partialRecord(z.enum(PORTALS, PORTALS_ERROR), z.boolean(PORTALS_ERROR), PORTALS_ERROR).optional(),
  autoSweep: z.boolean({ error: 'Giro automatico non valido' }).optional(),
  autoSweepHours: z.literal(AUTO_SWEEP_HOURS, AUTO_ERROR).nullable().optional(),
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

export type ErrorSource = 'portal' | 'connector' | 'server';
export const MAX_ERRORS_PER_REPORT = 20;
const BAD_REPORT = { error: 'Segnalazione non valida' };
const reportText = (max: number) => z.string(BAD_REPORT).min(1, BAD_REPORT).max(max, BAD_REPORT);
/** Errori da portale o connettore: il server li ripulisce prima di salvarli (`sanitizeError`). */
export const ErrorReportBody = z.strictObject({
  version: reportText(40),
  errors: z
    .array(z.strictObject({ message: reportText(2000), context: reportText(300).optional(), at: z.number(BAD_REPORT).int(BAD_REPORT) }, BAD_REPORT), BAD_REPORT)
    .min(1, BAD_REPORT)
    .max(MAX_ERRORS_PER_REPORT, BAD_REPORT),
}, BAD_REPORT);
export type ErrorReport = z.infer<typeof ErrorReportBody>;

/** Stato di un agente nella pagina «Controllo»: verde, arancio, rosso. */
export type Health = 'ok' | 'warn' | 'bad';

export interface ControlDevice {
  id: string;
  name: string;
  version: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  /** Fine dell'ultimo giro completato senza ricerche bloccate o in errore; null = nessun giro riuscito. */
  lastGoodSweepAt: number | null;
}

export interface ControlSweep {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  outcome: SweepOutcome | null;
  deviceName: string | null;
  searches: number;
  /** Ricerche `blocked` o `error`. */
  problems: number;
  /** Partito da solo (giro automatico). */
  auto: boolean;
}

export interface ControlRow {
  userId: string;
  email: string;
  status: UserStatus;
  lastSeenAt: number | null;
  devices: ControlDevice[];
  lastSweep: ControlSweep | null;
  sweeps30d: number;
  errors7d: number;
  health: Health;
  reasons: string[];
}

export interface ControlRun {
  searchKey: string;
  portal: Portal;
  label: string;
  status: string;
  pages: number;
  privates: number;
  reason: SearchErrorReason | null;
}

export interface ErrorGroup {
  source: ErrorSource;
  version: string;
  message: string;
  count: number;
  firstAt: number;
  lastAt: number;
  context: string | null;
  /** Email degli agenti coinvolti (vuoto: errori senza agente). */
  agents: string[];
  devices: { name: string | null; revoked: boolean }[];
}

export interface ControlAgent {
  row: ControlRow;
  sweeps: ControlSweep[];
  errors: ErrorGroup[];
}
