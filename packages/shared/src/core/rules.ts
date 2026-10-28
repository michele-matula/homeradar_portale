import { priorityLabel } from './leads';
import { formatDayMonth, formatEuro, formatPercent } from '../shared/format';
import {
  DAY_MS, type Evaluation, type ListingRecord, type Portal, type PriceDrop, type PriceSnapshot, type Priority, type Settings,
} from '../shared/types';

export const UNCERTAINTY_DAYS = 15;
/** Oltre il massimo un immobile rientra se ha cambiato prezzo in questi ultimi giorni. */
export const RECENT_CHANGE_DAYS = 30;
/** Oltre questa età una stima in giorni suggerirebbe una precisione che l'ID non dà. */
const ESTIMATED_YEARS_FROM_DAYS = 3 * 365;

const round1 = (n: number) => Math.round(n * 10) / 10;

// Su Immobiliare la scheda contiene la data vera; su Idealista, Subito e CasaDaPrivato no.
const VERIFY_REASON: Record<Portal, string> = {
  immobiliare: "Età da verificare: apri l'annuncio",
  idealista: 'Età stimata vicina alla soglia',
  subito: 'Età stimata vicina alla soglia',
  casadaprivato: 'Età stimata vicina alla soglia',
};

interface AgeFacts {
  /** Portale dell'annuncio da cui viene l'età: decide i testi dell'età incerta. */
  portal: Portal;
  ageDays: number | null;
  ageEstimated: boolean;
  ageUncertain: boolean;
  /** Segnale A: anzianità. */
  signal: boolean;
}

function ageFacts(listing: ListingRecord, settings: RuleSettings, now: number): AgeFacts {
  const created = listing.portalCreatedAt ?? listing.estimatedCreatedAt;
  const ageEstimated = listing.portalCreatedAt == null;
  const ageDays = created == null ? null : Math.max(0, Math.floor((now - created) / DAY_MS));
  const ageUncertain =
    ageDays != null &&
    ageEstimated &&
    ageDays >= settings.minAgeDays - UNCERTAINTY_DAYS &&
    ageDays < settings.minAgeDays + UNCERTAINTY_DAYS;
  const signal = ageDays != null && !ageUncertain && ageDays >= settings.minAgeDays;
  return { portal: listing.portal, ageDays, ageEstimated, ageUncertain, signal };
}

/** Cambio di prezzo ricavato dagli snapshot. */
export interface PriceChange {
  from: number;
  to: number;
  /** Data vera del cambio: quella dichiarata dal portale se c'è. */
  date: number;
  /** Quando HomeRadar ha saputo del cambio. */
  knownAt: number;
}

const lastOf = <T>(items: T[], ok: (t: T) => boolean): T | undefined => {
  for (let i = items.length - 1; i >= 0; i--) if (ok(items[i]!)) return items[i];
  return undefined;
};

/**
 * Cambi di prezzo, in ordine di tempo. Li fanno gli snapshot osservati; quelli dichiarati ne danno solo la data, così il
 * prezzo «prima» di un ribasso dichiarato non diventa un rialzo e lo stesso ribasso osservato e dichiarato conta una volta.
 * Unica eccezione: un ribasso dichiarato che arriva con la prima osservazione.
 */
export function priceChanges(snapshots: PriceSnapshot[]): PriceChange[] {
  const ordered = [...snapshots].sort((a, b) => a.at - b.at);
  const declared = ordered.filter((s) => s.source === 'declared');
  const out: PriceChange[] = [];
  let prev: PriceSnapshot | null = null;
  for (const s of ordered) {
    if (s.source !== 'observed') continue;
    if (prev == null) {
      const to = lastOf(declared, (d) => d.price === s.price && d.at <= s.at);
      const from = to && declared.find((d) => d.at === to.at - 1 && d.price !== to.price);
      if (to && from) out.push({ from: from.price, to: s.price, date: to.at, knownAt: s.at });
    } else if (s.price !== prev.price) {
      const after = prev.at;
      const to = lastOf(declared, (d) => d.price === s.price && d.at > after && d.at <= s.at);
      out.push({ from: prev.price, to: s.price, date: to?.at ?? s.at, knownAt: s.at });
    }
    prev = s;
  }
  return out;
}

/** Ultimo cambio recente che fa rientrare un immobile oltre il massimo: un rialzo qualsiasi o un ribasso dalla soglia in su. */
function returningChange(prices: PriceSnapshot[], settings: RuleSettings, now: number): PriceChange | null {
  const since = now - RECENT_CHANGE_DAYS * DAY_MS;
  let best: PriceChange | null = null;
  for (const c of priceChanges(prices)) {
    const counts = c.to > c.from || ((c.from - c.to) / c.from) * 100 >= settings.minDropPercent;
    if (c.date >= since && counts && (!best || c.knownAt > best.knownAt)) best = c;
  }
  return best;
}

const isPastMax = (age: AgeFacts, settings: RuleSettings) =>
  settings.maxAgeDays != null && age.ageDays != null && age.ageDays > settings.maxAgeDays;

interface DropFacts {
  current: number | null;
  lastDrop: PriceDrop | null;
  maxKnownPrice: number | null;
  dropPercent: number;
  dropCount: number;
  /** Segnale B: ribasso. */
  signal: boolean;
}

/** Ribassi rispetto al massimo prezzo noto. */
function dropFacts(listing: ListingRecord, snapshots: PriceSnapshot[], settings: RuleSettings): DropFacts {
  const ordered = [...snapshots].sort((a, b) => a.at - b.at);
  const current = listing.currentPrice;
  const known = ordered.map((s) => s.price);
  if (listing.lastDrop) known.push(listing.lastDrop.fromPrice);
  if (current != null) known.push(current);
  const maxKnownPrice = known.length ? Math.max(...known) : null;
  const dropPercent =
    current != null && maxKnownPrice != null && maxKnownPrice > current
      ? round1(((maxKnownPrice - current) / maxKnownPrice) * 100)
      : 0;
  const signal = dropPercent > 0 && dropPercent >= settings.minDropPercent;
  let dropCount = 0;
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.price < ordered[i - 1]!.price) dropCount++;
  return { current, lastDrop: listing.lastDrop, maxKnownPrice, dropPercent, dropCount, signal };
}

/** Cosa aggiunge il gruppo al badge: portali distinti e ripubblicazione. */
interface GroupFacts {
  portals: number;
  reposted: boolean;
}

const SINGLE: GroupFacts = { portals: 1, reposted: false };

/** Oltre il massimo: età e ribasso storico non contano, conta solo il cambio recente (null se non c'è). */
interface PastMax {
  change: PriceChange | null;
}

/**
 * Priorità, motivi e badge da età e ribasso; il gruppo aggiunge "· N portali" e "· ripubblicato" al badge.
 * Oltre il massimo (`pastMax`) l'immobile è Media solo con un cambio di prezzo recente.
 */
function compose(target: ListingRecord, age: AgeFacts, drop: DropFacts, group: GroupFacts = SINGLE, pastMax: PastMax | null = null): Evaluation {
  const { ageDays, ageEstimated, ageUncertain } = age;
  const { current, maxKnownPrice, dropPercent, dropCount } = drop;
  const change = pastMax?.change ?? null;

  let priority: Priority = 'none';
  if (pastMax) priority = change ? 'medium' : 'none';
  else if (age.signal && drop.signal) priority = 'high';
  else if (age.signal || drop.signal) priority = 'medium';
  else if (ageUncertain) priority = 'verify';

  const agePart =
    ageDays == null ? null
    : ageEstimated && ageDays >= ESTIMATED_YEARS_FROM_DAYS ? `oltre ${Math.floor(ageDays / 365)} anni`
    : `${ageEstimated ? '~' : ''}${ageDays} gg`;
  const reasons: string[] = [];
  if (agePart) reasons.push(`Online da ${agePart}`);
  if (ageUncertain && !pastMax) reasons.push(VERIFY_REASON[age.portal]);
  const changePercent = change ? round1((Math.abs(change.to - change.from) / change.from) * 100) : 0;
  if (change) {
    const what = change.to > change.from ? 'Prezzo alzato' : 'Ribassato';
    reasons.push(`${what} del ${formatPercent(changePercent)}% (${formatEuro(change.from)} → ${formatEuro(change.to)} €) il ${formatDayMonth(change.date)}`);
  }
  if (!pastMax && drop.signal && current != null && maxKnownPrice != null) {
    if (dropCount >= 2) {
      reasons.push(`${dropCount} ribassi, −${formatPercent(dropPercent)}% totale`);
    } else {
      const d = drop.lastDrop;
      const when = d && d.toPrice === current ? ` ${d.dateEstimated ? 'rilevato il' : 'il'} ${formatDayMonth(d.date)}` : '';
      reasons.push(`Ribassato del ${formatPercent(dropPercent)}% (${formatEuro(maxKnownPrice)} → ${formatEuro(current)} €)${when}`);
    }
  }

  const dropPart = change
    ? `${change.to > change.from ? '+' : '−'}${formatPercent(changePercent)}%`
    : !pastMax && drop.signal ? `−${formatPercent(dropPercent)}%` : null;
  const head = { high: '● Alta', medium: '● Media', verify: `◐ ${priorityLabel('verify', age.portal)}`, none: 'Privato' }[priority];
  const parts = priority === 'high' || priority === 'medium' ? [head, agePart, dropPart] : [head, agePart];
  if (group.portals > 1) parts.push(`${group.portals} portali`);
  if (group.reposted) parts.push('ripubblicato');

  return {
    listingKey: target.key,
    portalId: target.portalId,
    priority,
    ageDays,
    ageEstimated,
    ageUncertain,
    dropPercent,
    dropCount,
    maxKnownPrice,
    reasons,
    badgeText: parts.filter(Boolean).join(' · '),
    returnedAt: change?.knownAt ?? null,
  };
}

/** Le sole impostazioni che contano per la priorità. `maxAgeDays` assente o null = nessun limite. */
export type RuleSettings = Pick<Settings, 'minAgeDays' | 'minDropPercent'> & { maxAgeDays?: number | null };

export function evaluate(listing: ListingRecord, snapshots: PriceSnapshot[], settings: RuleSettings, now: number): Evaluation {
  const age = ageFacts(listing, settings, now);
  const pastMax = isPastMax(age, settings) ? { change: returningChange(snapshots, settings, now) } : null;
  return compose(listing, age, dropFacts(listing, snapshots, settings), SINGLE, pastMax);
}

export interface GroupMember {
  listing: ListingRecord;
  prices: PriceSnapshot[];
  /** Annuncio sostituito da una ripubblicazione: conta per l'età, non per il ribasso (il suo storico è già nella testa). */
  previous?: boolean;
}

const days = (a: AgeFacts) => a.ageDays ?? -1;

/**
 * Valutazione dello stesso immobile su più portali: le regole di `evaluate` sui fatti del gruppo.
 * Età del membro più vecchio tra quelli con il segnale A (altrimenti del più vecchio), ribasso maggiore tra gli annunci vivi.
 * `listingKey` e `portalId` sono quelli di `target`.
 */
export function evaluateGroup(target: ListingRecord, members: GroupMember[], settings: RuleSettings, now: number): Evaluation {
  const ages = members.map((m) => ageFacts(m.listing, settings, now));
  const live = members.filter((m) => !m.previous);
  const group = { portals: new Set(members.map((m) => m.listing.portal)).size, reposted: members.some((m) => m.previous) };
  // «Oltre il massimo» vale per l'immobile: conta il membro più vecchio, ripubblicazioni comprese.
  const oldest = ages.reduce((best, a) => (days(a) > days(best) ? a : best));
  if (isPastMax(oldest, settings)) {
    const change = live
      .map((m) => returningChange(m.prices, settings, now))
      .reduce<PriceChange | null>((best, c) => (c && (!best || c.knownAt > best.knownAt) ? c : best), null);
    const drop = live.map((m) => dropFacts(m.listing, m.prices, settings)).reduce((best, d) => (d.dropPercent > best.dropPercent ? d : best));
    return compose(target, oldest, drop, group, { change });
  }
  const pool = ages.some((a) => a.signal) ? ages.filter((a) => a.signal) : ages;
  // A parità di giorni vince l'età esatta.
  const age = pool.reduce((best, a) => (days(a) > days(best) || (days(a) === days(best) && best.ageEstimated && !a.ageEstimated) ? a : best));
  const drop = live
    .map((m) => dropFacts(m.listing, m.prices, settings))
    .reduce((best, d) => ((d.signal && !best.signal) || (d.signal === best.signal && d.dropPercent > best.dropPercent) ? d : best));
  return compose(target, age, drop, group);
}
