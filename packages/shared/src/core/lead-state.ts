import { mergeGroupState, type Archive, type MemberState } from './lead-groups';
import { startOfLocalDay } from './recall';
import { groupListings, splitPair } from './same-property';
import type { LeadState, LeadStatus, SplitPair } from '../shared/types';

export const RECALL_ON_DISCARDED = 'Impossibile impostare un richiamo su un lead scartato';

export type LeadPatch = { status?: LeadStatus; notes?: string; recallAt?: number | null };

/** Applica la modifica dell'agente a uno stato: `updatedAt` avanza solo se qualcosa cambia. */
export function nextLeadState(prev: LeadState, patch: LeadPatch, now: number): LeadState {
  const next: LeadState = { ...prev, recallAt: prev.recallAt ?? null };
  const recallAt = patch.recallAt == null ? patch.recallAt : startOfLocalDay(patch.recallAt);
  let status = patch.status ?? prev.status;
  if (status === 'discarded' && recallAt != null) throw new Error(RECALL_ON_DISCARDED);
  // Un lead con un richiamo è già in lavorazione: da "Nuovo" passa a "Da contattare".
  if (recallAt != null && status === 'new') status = 'to_contact';
  if (patch.notes !== undefined && patch.notes !== prev.notes) {
    next.notes = patch.notes;
    next.updatedAt = now;
  }
  if (status !== prev.status) {
    next.status = status;
    next.statusChangedAt = now;
    next.updatedAt = now;
  }
  const nextRecall = status === 'discarded' ? null : recallAt === undefined ? next.recallAt : recallAt;
  if (nextRecall !== next.recallAt) {
    next.recallAt = nextRecall;
    next.updatedAt = now;
  }
  return next;
}

const sameState = (a: LeadState, b: LeadState) =>
  a.status === b.status && a.notes === b.notes && (a.recallAt ?? null) === b.recallAt && a.statusChangedAt === b.statusChangedAt;

/**
 * Stato da scrivere su tutti gli annunci di un gruppo: la modifica parte dallo stato unito, così non restano stati
 * diversi. Un membro che cambia rispetto al suo stato salvato è una modifica anche se il gruppo non cambia.
 */
export function groupStateWrite(members: MemberState[], patch: LeadPatch, now: number): { prev: LeadState; next: LeadState } {
  const prev = members.length === 1 ? members[0]!.state : mergeGroupState(members);
  const next = nextLeadState(prev, patch, now);
  if (members.some((m) => !sameState(m.state, next))) next.updatedAt = Math.max(next.updatedAt, now);
  return { prev, next };
}

/**
 * Stacca `key` dalle altre fonti del suo gruppo. Lo stato del gruppo va su tutti, così un annuncio entrato nel gruppo
 * dopo l'ultima modifica non torna "Nuovo". Separare l'annuncio vivo di una catena di ripubblicazione vuol dire "non è
 * l'immobile degli altri portali": la catena si stacca intera dalle altre fonti.
 */
export function splitWrites(
  archive: Pick<Archive, 'listings' | 'splits'>, members: MemberState[], key: string, fromKeys: string[], now: number,
): { states: LeadState[]; pairs: SplitPair[] } {
  const merged = mergeGroupState(members);
  const states = [key, ...fromKeys].map((k) => ({ ...merged, listingKey: k, updatedAt: now }));
  const chain = groupListings(archive.listings, archive.splits).flatMap((g) => g.chains).find((c) => c.length > 1 && c[c.length - 1] === key) ?? [key];
  const others = fromKeys.filter((k) => !chain.includes(k));
  return { states, pairs: chain.flatMap((c) => others.map((k) => splitPair(c, k, now))) };
}
