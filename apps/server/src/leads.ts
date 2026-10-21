import { leadComuni } from '@homeradar/shared/core/lead-filters';
import { buildLeadViews, isHidden, isListed } from '@homeradar/shared/core/lead-groups';
import { sortLeads } from '@homeradar/shared/core/leads';
import { isDue } from '@homeradar/shared/core/recall';
import type { LeadView } from '@homeradar/shared/shared/types';
import { loadAgentArchive } from './archive';
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
