import { NOT_LINKED } from '@homeradar/shared/api/connector-messages';
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../../src/client';

describe('client del server', () => {
  it('JSON con il token del dispositivo', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const c = createClient({ baseUrl: 'https://portale.test', token: async () => 't', fetch });
    expect(await c.post('/connector/runs', { a: 1 })).toEqual({ status: 200, data: { ok: true } });
    expect(fetch).toHaveBeenCalledWith('https://portale.test/connector/runs', {
      method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: '{"a":1}',
    });
  });

  it('rete assente: stato 0', async () => {
    const fetch = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    };
    const c = createClient({ baseUrl: 'https://portale.test', token: async () => 't', fetch });
    expect((await c.post('/x', {})).status).toBe(0);
  });

  it('risposta non JSON: data null', async () => {
    const c = createClient({ baseUrl: 'https://portale.test', token: async () => 't', fetch: async () => new Response('Bad gateway', { status: 502 }) });
    expect(await c.post('/x', {})).toEqual({ status: 502, data: null });
  });

  it('senza token non chiama il server', async () => {
    const fetch = vi.fn();
    const c = createClient({ baseUrl: 'https://portale.test', token: async () => null, fetch });
    expect(await c.post('/x', {})).toEqual({ status: 401, data: { error: NOT_LINKED } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
