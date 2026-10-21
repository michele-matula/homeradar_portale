import type { Archive } from '@homeradar/shared/core/lead-groups';
import { normalize, scopeIstat } from '@homeradar/shared/core/lead-filters';
import type { ComuneRef, LeadState, ListingRecord, PriceSnapshot, PropertyCategory, SplitPair } from '@homeradar/shared/shared/types';

// Righe D1 ↔ tipi della logica condivisa. Le liste vanno in SQL come un solo parametro JSON (json_each).

interface DbListing {
  key: string;
  portal: ListingRecord['portal'];
  portal_id: number;
  url: string;
  title: string;
  address: string | null;
  city: string | null;
  zone: string | null;
  typology: string | null;
  category: PropertyCategory;
  surface_m2: number | null;
  rooms: number | null;
  current_price: number | null;
  portal_created_at: number | null;
  estimated_created_at: number | null;
  last_drop: string | null;
  first_seen_at: number;
  last_seen_at: number;
  seen_count: number;
  sweep_scope: string | null;
  missed_sweeps: number;
  missing_since: number | null;
  cover_url: string | null;
  last_read_at: number | null;
}

export function rowToListing(r: DbListing): ListingRecord {
  const l: ListingRecord = {
    key: r.key,
    portal: r.portal,
    portalId: r.portal_id,
    url: r.url,
    title: r.title,
    address: r.address,
    city: r.city,
    zone: r.zone,
    typology: r.typology,
    category: r.category,
    surfaceM2: r.surface_m2,
    rooms: r.rooms,
    currentPrice: r.current_price,
    portalCreatedAt: r.portal_created_at,
    estimatedCreatedAt: r.estimated_created_at,
    lastDrop: r.last_drop ? JSON.parse(r.last_drop) : null,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    seenCount: r.seen_count,
    sweepScope: r.sweep_scope,
    missedSweeps: r.missed_sweeps,
    missingSince: r.missing_since,
  };
  if (r.cover_url) l.coverUrl = r.cover_url;
  if (r.last_read_at != null) l.lastReadAt = r.last_read_at;
  return l;
}

const LISTING_COLUMNS = [
  'key', 'portal', 'portal_id', 'url', 'title', 'address', 'city', 'city_norm', 'zone', 'typology', 'category', 'surface_m2', 'rooms',
  'current_price', 'portal_created_at', 'estimated_created_at', 'last_drop', 'first_seen_at', 'last_seen_at', 'seen_count', 'sweep_scope',
  'scope_istat', 'missed_sweeps', 'missing_since', 'cover_url', 'last_read_at',
];
const UPSERT_LISTING = `INSERT INTO listings (${LISTING_COLUMNS.join(', ')}) VALUES (${LISTING_COLUMNS.map(() => '?').join(', ')})
  ON CONFLICT(key) DO UPDATE SET ${LISTING_COLUMNS.slice(1).map((c) => `${c} = excluded.${c}`).join(', ')}`;

export function upsertListing(db: D1Database, l: ListingRecord): D1PreparedStatement {
  return db.prepare(UPSERT_LISTING).bind(
    l.key, l.portal, l.portalId, l.url, l.title, l.address, l.city, l.city == null ? null : normalize(l.city), l.zone, l.typology, l.category,
    l.surfaceM2, l.rooms, l.currentPrice, l.portalCreatedAt, l.estimatedCreatedAt, l.lastDrop ? JSON.stringify(l.lastDrop) : null,
    l.firstSeenAt, l.lastSeenAt, l.seenCount, l.sweepScope, scopeIstat(l.sweepScope), l.missedSweeps, l.missingSince, l.coverUrl ?? null, l.lastReadAt ?? null,
  );
}

/** Uno snapshot per annuncio e istante: lo stesso prezzo mandato due volte non si duplica. */
export function insertSnapshot(db: D1Database, s: Omit<PriceSnapshot, 'id'>): D1PreparedStatement {
  return db.prepare('INSERT OR IGNORE INTO price_snapshots (listing_key, price, at, source) VALUES (?, ?, ?, ?)').bind(s.listingKey, s.price, s.at, s.source);
}

interface DbState {
  listing_key: string;
  status: LeadState['status'];
  notes: string;
  status_changed_at: number;
  updated_at: number;
  recall_at: number | null;
}

export const rowToState = (r: DbState): LeadState => ({
  listingKey: r.listing_key, status: r.status, notes: r.notes, statusChangedAt: r.status_changed_at, updatedAt: r.updated_at, recallAt: r.recall_at,
});

export function putState(db: D1Database, userId: string, s: LeadState): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO lead_states (user_id, listing_key, status, notes, status_changed_at, updated_at, recall_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, listing_key) DO UPDATE SET status = excluded.status, notes = excluded.notes,
      status_changed_at = excluded.status_changed_at, updated_at = excluded.updated_at, recall_at = excluded.recall_at`)
    .bind(userId, s.listingKey, s.status, s.notes, s.statusChangedAt, s.updatedAt, s.recallAt);
}

export function putSplit(db: D1Database, userId: string, p: SplitPair): D1PreparedStatement {
  return db.prepare('INSERT OR REPLACE INTO splits (user_id, a, b, at) VALUES (?, ?, ?, ?)').bind(userId, p.a, p.b, p.at);
}

export async function listingsByKeys(db: D1Database, keys: string[]): Promise<ListingRecord[]> {
  const { results } = await db.prepare('SELECT * FROM listings WHERE key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all<DbListing>();
  return results.map(rowToListing);
}

/** Annunci della zona e delle categorie: comune della ricerca o nome della città fra quelli della zona. */
export const ZONE_FILTER = `l.category IN (SELECT value FROM json_each(?1))
  AND (l.scope_istat IN (SELECT value FROM json_each(?2)) OR l.city_norm IN (SELECT value FROM json_each(?3)))`;

export function zoneParams(comuni: ComuneRef[], categories: PropertyCategory[]): string[] {
  return [JSON.stringify(categories), JSON.stringify(comuni.map((c) => c.istat)), JSON.stringify(comuni.map((c) => normalize(c.name)))];
}

/**
 * Archivio per i lead di un agente: annunci della sua zona e categorie (chiunque li abbia trovati), con i loro prezzi,
 * e solo i suoi stati e le sue coppie separate.
 */
export async function loadAgentArchive(db: D1Database, userId: string, comuni: ComuneRef[], categories: PropertyCategory[]): Promise<Archive> {
  if (!comuni.length || !categories.length) return { listings: [], states: [], snapshots: [], splits: [] };
  const zone = zoneParams(comuni, categories);
  const [listings, snapshots, states, splits] = await db.batch([
    db.prepare(`SELECT l.* FROM listings l WHERE ${ZONE_FILTER}`).bind(...zone),
    db.prepare(`SELECT s.listing_key, s.price, s.at, s.source FROM price_snapshots s JOIN listings l ON l.key = s.listing_key WHERE ${ZONE_FILTER}`).bind(...zone),
    db.prepare('SELECT * FROM lead_states WHERE user_id = ?').bind(userId),
    db.prepare('SELECT a, b, at FROM splits WHERE user_id = ?').bind(userId),
  ]);
  type Snap = { listing_key: string; price: number; at: number; source: PriceSnapshot['source'] };
  return {
    listings: (listings!.results as DbListing[]).map(rowToListing),
    snapshots: (snapshots!.results as Snap[]).map((s) => ({ listingKey: s.listing_key, price: s.price, at: s.at, source: s.source })),
    states: (states!.results as DbState[]).map(rowToState),
    splits: splits!.results as SplitPair[],
  };
}
