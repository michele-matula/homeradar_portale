import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticateDevice } from '../src/device';
import { ORIGIN, fetchConnector, linkDevice, loginAs, resetDb } from './helpers';

const req = (headers: Record<string, string> = {}) => new Request(`${ORIGIN}/connector/x`, { headers });

beforeEach(resetDb);

describe('token del dispositivo', () => {
  it('senza token o con un token sconosciuto', async () => {
    const cases: Record<string, string>[] = [{}, { Authorization: 'Bearer sconosciuto' }, { Authorization: 'Basic abc' }];
    for (const h of cases) {
      const r = await authenticateDevice(req(h), env, Date.now());
      expect(r).toBeInstanceOf(Response);
      expect((r as Response).status).toBe(401);
      expect(await (r as Response).json()).toEqual({ error: 'Connettore non collegato' });
    }
  });

  it('riconosce utente e dispositivo; last_seen_at al più ogni 10 minuti', async () => {
    const agent = await loginAs('agent');
    const d = await linkDevice(agent.id);
    const now = Date.now();
    const r = await authenticateDevice(req(d.auth), env, now);
    expect(r).toMatchObject({ deviceId: d.id, user: { id: agent.id } });
    await authenticateDevice(req(d.auth), env, now + 60_000);
    const seen = async () => (await env.DB.prepare('SELECT last_seen_at AS t FROM devices WHERE id = ?').bind(d.id).first<{ t: number }>())!.t;
    expect(await seen()).toBe(now);
    await authenticateDevice(req(d.auth), env, now + 11 * 60_000);
    expect(await seen()).toBe(now + 11 * 60_000);
  });

  it('account sospeso: 403 e il dispositivo resta', async () => {
    const agent = await loginAs('agent');
    const d = await linkDevice(agent.id);
    await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(agent.id).run();
    const r = (await authenticateDevice(req(d.auth), env, Date.now())) as Response;
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'Account sospeso' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first('n')).toBe(1);
  });
});

describe('/connector/*', () => {
  it('senza Origin non è rifiutato: risponde la rotta (qui 404)', async () => {
    const r = await fetchConnector('POST', '/connector/qualcosa', {});
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Non trovato' });
  });
});
