import { leadComuni } from '@homeradar/shared/core/lead-filters';
import { buildLeadViews, defaultState, isHidden, isListed, type MemberState } from '@homeradar/shared/core/lead-groups';
import { groupStateWrite, RECALL_ON_DISCARDED, splitWrites, type LeadPatch } from '@homeradar/shared/core/lead-state';
import { sortLeads } from '@homeradar/shared/core/leads';
import { isDue } from '@homeradar/shared/core/recall';
import type { LeadState, LeadView } from '@homeradar/shared/shared/types';
import { listingsByKeys, loadAgentArchive, putSplit, putState, rowToState } from './archive';
import { fail } from './http';
import { getSettings } from './settings';
import { toComuneRefs, type UserRow } from './users';

/**
 * Lead dell'agente: annunci dell'archivio nei suoi comuni e nelle sue categorie, con i suoi stati e le sue separazioni.
 * Gruppi e mercato si calcolano su tutto ciò che è stato caricato, prima del filtro per comune.
 */
export async function agentLeads(db: D1Database, user: UserRow, now: number): Promise<LeadView[]> {
  const comuni = toComuneRefs(user.comuni);
  if (!comuni.length) return [];
  const settings = await getSettings(db, user.id);
  const archive = await loadAgentArchive(db, user.id, comuni, settings.categories);
  const views = buildLeadViews(archive, settings, now);
  return sortLeads(views.filter((v) => isListed(v) && !isHidden(v, now) && leadComuni(v, comuni).length > 0));
}

/** Richiami di oggi o scaduti: un lead è un immobile, quindi lo stesso immobile su più portali conta una volta. */
export function dueRecallCount(views: LeadView[], now: number): number {
  return views.filter((v) => v.state.status !== 'discarded' && isDue(v.state.recallAt, now)).length;
}

const NOT_FOUND = 'Annuncio non trovato';

/** Annunci con lo stato salvato dall'agente (o quello iniziale); stringa d'errore se una chiave non esiste. */
async function members(db: D1Database, userId: string, keys: string[]): Promise<MemberState[] | string> {
  const [listings, states] = await Promise.all([
    listingsByKeys(db, keys),
    db.prepare('SELECT * FROM lead_states WHERE user_id = ? AND listing_key IN (SELECT value FROM json_each(?))').bind(userId, JSON.stringify(keys)).all<Parameters<typeof rowToState>[0]>(),
  ]);
  const byKey = new Map(listings.map((l) => [l.key, l]));
  const stateOf = new Map(states.results.map((r) => [r.listing_key, rowToState(r)]));
  const out: MemberState[] = [];
  for (const k of keys) {
    const listing = byKey.get(k);
    if (!listing) return NOT_FOUND;
    out.push({ listing, state: stateOf.get(k) ?? defaultState(listing) });
  }
  return out;
}

/** Stato, note e richiamo su tutto il gruppo, in un solo batch. */
export async function setLeadState(db: D1Database, userId: string, keys: string[], patch: LeadPatch, now: number): Promise<LeadState | Response> {
  const list = [...new Set(keys)];
  const m = await members(db, userId, list);
  if (typeof m === 'string') return fail(404, m);
  let next: LeadState;
  try {
    next = groupStateWrite(m, patch, now).next;
  } catch (e) {
    if (e instanceof Error && e.message === RECALL_ON_DISCARDED) return fail(400, e.message);
    throw e;
  }
  await db.batch(list.map((k) => putState(db, userId, { ...next, listingKey: k })));
  return { ...next, listingKey: list[0]! };
}

/** Separa `key` dalle altre fonti, solo per questo agente. */
export async function splitLead(db: D1Database, user: UserRow, key: string, fromKeys: string[], now: number): Promise<Response | null> {
  const keys = [...new Set([key, ...fromKeys])];
  const m = await members(db, user.id, keys);
  if (typeof m === 'string') return fail(404, m);
  const archive = await loadAgentArchive(db, user.id, toComuneRefs(user.comuni), (await getSettings(db, user.id)).categories);
  // Gli annunci della richiesta servono anche se sono fuori zona: la catena di ripubblicazione si cerca fra tutti.
  const inArchive = new Set(archive.listings.map((l) => l.key));
  const listings = [...archive.listings, ...m.map((x) => x.listing).filter((l) => !inArchive.has(l.key))];
  const { states, pairs } = splitWrites({ listings, splits: archive.splits }, m, key, keys.slice(1), now);
  await db.batch([...states.map((s) => putState(db, user.id, s)), ...pairs.map((p) => putSplit(db, user.id, p))]);
  return null;
}

/** Una visita della lista inizia dopo così senza averla aperta. */
export const VISIT_GAP_MS = 30 * 60_000;

/**
 * L'agente apre la lista: all'inizio di una visita la soglia del «nuovo» diventa l'apertura precedente, poi resta ferma
 * finché la visita dura. Restituisce la soglia, null se non c'è ancora una visita precedente.
 */
export async function leadsVisit(db: D1Database, userId: string, now: number): Promise<number | null> {
  // In SQLite ogni espressione del SET legge i valori di prima: `leads_seen_at` a destra è quello vecchio.
  const r = await db
    .prepare(`UPDATE users SET new_since = CASE WHEN leads_seen_at < ?1 THEN leads_seen_at ELSE new_since END, leads_seen_at = ?2
      WHERE id = ?3 RETURNING new_since`)
    .bind(now - VISIT_GAP_MS, now, userId)
    .first<{ new_since: number | null }>();
  return r?.new_since ?? null;
}
