import { z } from 'zod';
import { body } from './types';
import { coverOrNull } from '../core/cover';
import { MAX_PAGES_PER_SEARCH } from '../core/sweep';
import { PORTAL_SITES, PORTALS, PROPERTY_CATEGORIES, type Portal, type SearchSpec } from '../shared/types';

// API del connettore: solo i campi dichiarati qui arrivano al server. È la lista di ciò che si può salvare.

export const MAX_BATCH_OBSERVATIONS = 100;

const INVALID = { error: 'Annuncio non valido' };
const text = (max: number) => z.string(INVALID).max(max, INVALID);
const nullableText = (max: number) => text(max).nullable();
const int = z.number(INVALID).int(INVALID);
const Portal = z.enum(PORTALS, { error: 'Portale non valido' });

/** L'URL è in https sul dominio del portale dell'annuncio, con o senza "www.". */
function onPortal(portal: Portal, url: string): boolean {
  try {
    const u = new URL(url);
    const site = PORTAL_SITES[portal].toLowerCase();
    return u.protocol === 'https:' && (u.hostname === site || u.hostname === `www.${site}`);
  } catch {
    return false;
  }
}

const Drop = body({
  fromPrice: z.number(INVALID).nonnegative(INVALID),
  toPrice: z.number(INVALID).nonnegative(INVALID),
  percent: z.number(INVALID),
  date: int.nullable(),
});

export const ObservationSchema = body({
  portal: Portal,
  portalId: int.positive(INVALID),
  url: text(500),
  title: text(300),
  address: nullableText(200),
  city: nullableText(200),
  zone: nullableText(200),
  typology: nullableText(200),
  category: z.enum(PROPERTY_CATEGORIES, INVALID).nullable(),
  surfaceM2: z.number(INVALID).positive(INVALID).nullable(),
  rooms: int.nonnegative(INVALID).nullable(),
  price: z.number(INVALID).nonnegative(INVALID).nullable(),
  priceReserved: z.boolean(INVALID).optional(),
  sellerType: z.literal('private', { error: 'Solo annunci di privati' }),
  portalCreatedAt: int.nullable(),
  lastDrop: Drop.nullable(),
  coverUrl: text(500).nullable(),
  source: z.enum(['search', 'detail'], INVALID),
})
  .refine((o) => onPortal(o.portal, o.url), { error: 'Indirizzo dell\'annuncio non valido', path: ['url'] })
  // Una copertina di un server non ammesso non arriva mai a un <img>: si scarta, l'annuncio resta.
  .transform((o) => ({ ...o, coverUrl: coverOrNull(o.portal, o.coverUrl) }));

const count = z.number({ error: 'Rapporto della pagina non valido' }).int({ error: 'Rapporto della pagina non valido' }).nonnegative({ error: 'Rapporto della pagina non valido' });
export const PageReportSchema = body({
  portal: Portal,
  url: z.string({ error: 'Rapporto della pagina non valido' }).max(1000, { error: 'Rapporto della pagina non valido' }),
  results: count,
  privates: count,
  lastPage: z.boolean({ error: 'Rapporto della pagina non valido' }),
  blocked: z.boolean({ error: 'Rapporto della pagina non valido' }),
  notFound: z.boolean({ error: 'Rapporto della pagina non valido' }),
  parseErrors: count,
});

const Uuid = (what: string) => z.uuid({ error: `${what} non valido` });
const SearchKey = z.string({ error: 'Ricerca non valida' }).min(1, { error: 'Ricerca non valida' }).max(200, { error: 'Ricerca non valida' });

const PAGES_ERROR = { error: 'Numero di pagine non valido' };
export const BatchBody = body({
  id: Uuid('Id del lotto'),
  sweepId: Uuid('Id del giro'),
  searchKey: SearchKey,
  /** Quando il connettore ha letto la pagina: il lotto può arrivare molto dopo. */
  readAt: z.number({ error: 'Data di lettura non valida' }).int({ error: 'Data di lettura non valida' }),
  /** Numero della pagina nella ricerca (1, 2, …): una pagina riletta non conta come una pagina in più. */
  page: z.number(PAGES_ERROR).int(PAGES_ERROR).min(1, PAGES_ERROR).max(MAX_PAGES_PER_SEARCH, PAGES_ERROR),
  report: PageReportSchema,
  observations: z.array(ObservationSchema, INVALID).max(MAX_BATCH_OBSERVATIONS, { error: `Al massimo ${MAX_BATCH_OBSERVATIONS} annunci per lotto` }),
  /** ID più alto di una pagina ordinata per data: candidato punto di calibrazione. */
  newestId: z.number({ error: 'Id non valido' }).int({ error: 'Id non valido' }).positive({ error: 'Id non valido' }).optional(),
});

export const RunBody = body({
  sweepId: Uuid('Id del giro'),
  searchKey: SearchKey,
  outcome: z.enum(['complete', 'capped', 'blocked', 'error', 'notFound', 'skipped'], { error: 'Esito non valido' }),
  pages: z.number(PAGES_ERROR).int(PAGES_ERROR).min(0, PAGES_ERROR).max(MAX_PAGES_PER_SEARCH, PAGES_ERROR),
  privates: z.number({ error: 'Numero di privati non valido' }).int({ error: 'Numero di privati non valido' }).nonnegative({ error: 'Numero di privati non valido' }),
});

export const FinishBody = body({ outcome: z.enum(['completed', 'partial', 'stopped', 'interrupted'], { error: 'Esito non valido' }) });
export const StartSweepBody = body({});

const BAD_REQUEST = { error: 'Richiesta non valida' };
const field = (max: number) => z.string(BAD_REQUEST).min(1, BAD_REQUEST).max(max, BAD_REQUEST);
/** Collegamento: il codice monouso avuto dal portale, più come si presenta il connettore. */
export const LinkBody = body({ code: field(200), name: field(100), version: field(20) });

/** Connettore collegato, come lo vede l'agente nel portale. */
export interface DeviceInfo {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
}

/** Ricerche da fare nel giro; `sweepId` null se sono tutte fresche o in corso per un altro agente. */
export interface SweepPlan {
  sweepId: string | null;
  searches: SearchSpec[];
  skipped: number;
}

export type Batch = z.infer<typeof BatchBody>;
export type RunReport = z.infer<typeof RunBody>;
