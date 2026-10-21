import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { listingsByKeys, loadAgentArchive, putSplit, putState, upsertListing } from '../src/archive';
import { toComuneRefs } from '../src/users';
import { fetchApi, linkDevice, loginAs, putListing, resetDb } from './helpers';

const TREVIGLIO = toComuneRefs(['016219']);
const state = (listingKey: string) => ({ listingKey, status: 'contacted' as const, notes: 'sera', statusChangedAt: 1, updatedAt: 1, recallAt: null });

beforeEach(resetDb);

describe('righe degli annunci', () => {
  it('scrittura e lettura restituiscono lo stesso annuncio', async () => {
    const a = await putListing({ portal: 'immobiliare', portalId: 1, coverUrl: 'https://pwm.im-cdn.it/x.jpg', lastDrop: { fromPrice: 2, toPrice: 1, percent: 50, date: 5, dateEstimated: true } });
    const b = await putListing({ portal: 'subito', portalId: 2 });
    expect(await listingsByKeys(env.DB, [b.key, a.key, 'idealista:9'])).toEqual(expect.arrayContaining([a, b]));
    expect('coverUrl' in (await listingsByKeys(env.DB, [b.key]))[0]!).toBe(false);
    // Un secondo upsert aggiorna la riga.
    await upsertListing(env.DB, { ...a, title: 'Nuovo titolo' }).run();
    expect((await listingsByKeys(env.DB, [a.key]))[0]!.title).toBe('Nuovo titolo');
  });
});

describe('archivio di un agente', () => {
  it('zona per città o per comune della ricerca, solo categorie scelte, solo i suoi stati', async () => {
    const a = await loginAs('agent');
    const b = await loginAs('agent');
    const byCity = await putListing({ portal: 'immobiliare', portalId: 1, city: 'Treviglio', sweepScope: 'immobiliare|comune:016062|case' });
    const byScope = await putListing({ portal: 'immobiliare', portalId: 2, city: null, sweepScope: 'immobiliare|comune:016219|case' });
    await putListing({ portal: 'immobiliare', portalId: 3, city: 'Caravaggio', sweepScope: 'immobiliare|comune:016062|case' });
    await putListing({ portal: 'immobiliare', portalId: 4, city: 'Treviglio', category: 'garage' });
    await env.DB.batch([putState(env.DB, a.id, state(byCity.key)), putState(env.DB, b.id, state(byScope.key)), putSplit(env.DB, b.id, { a: byCity.key, b: byScope.key, at: 1 })]);
    await env.DB.prepare("INSERT INTO price_snapshots (listing_key, price, at, source) VALUES (?, 1, 1, 'observed')").bind(byCity.key).run();

    const arch = await loadAgentArchive(env.DB, a.id, TREVIGLIO, ['residential']);
    expect(arch.listings.map((l) => l.key).sort()).toEqual([byCity.key, byScope.key]);
    expect(arch.states.map((s) => s.listingKey)).toEqual([byCity.key]);
    expect(arch.splits).toEqual([]);
    expect(arch.snapshots).toEqual([{ listingKey: byCity.key, price: 1, at: 1, source: 'observed' }]);
    expect((await loadAgentArchive(env.DB, a.id, TREVIGLIO, ['residential', 'garage'])).listings).toHaveLength(3);
    expect((await loadAgentArchive(env.DB, a.id, [], ['residential'])).listings).toEqual([]);
  });

  it('cancellare l\'agente cancella i suoi dati privati e rende anonimi giri e ricerche', async () => {
    const admin = await loginAs('admin');
    const a = await loginAs('agent');
    const d = await linkDevice(a.id);
    const l = await putListing({ portal: 'immobiliare', portalId: 1 });
    await env.DB.batch([
      putState(env.DB, a.id, state(l.key)),
      putSplit(env.DB, a.id, { a: 'immobiliare:1', b: 'idealista:2', at: 1 }),
      env.DB.prepare("INSERT INTO user_settings (user_id, min_age_days, min_drop_percent, categories, enabled_portals, updated_at) VALUES (?, 120, 0, '[]', '{}', 1)").bind(a.id),
      env.DB.prepare('INSERT INTO sweeps (id, user_id, device_id, started_at, last_activity_at) VALUES (?, ?, ?, 1, 1)').bind('s1', a.id, d.id),
      env.DB.prepare("INSERT INTO search_runs (sweep_id, search_key, portal, spec, user_id, status) VALUES ('s1', 'k', 'immobiliare', '{}', ?, 'complete')").bind(a.id),
    ]);
    expect((await fetchApi('DELETE', `/api/admin/users/${a.id}`, undefined, { Cookie: admin.cookie })).status).toBe(204);
    for (const t of ['lead_states', 'splits', 'user_settings', 'devices']) expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT user_id, device_id FROM sweeps').first()).toEqual({ user_id: null, device_id: null });
    expect(await env.DB.prepare('SELECT user_id FROM search_runs').first('user_id')).toBeNull();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM listings').first('n')).toBe(1);
  });
});
