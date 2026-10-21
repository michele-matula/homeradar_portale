import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { fetchApi } from './helpers';

describe('base HTTP', () => {
  it('health', async () => expect(await (await fetchApi('GET', '/api/health')).json()).toEqual({ ok: true }));
  it('rotta assente', async () => {
    const r = await fetchApi('GET', '/api/nulla');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'Non trovato' });
  });
  it('POST da un\'altra origine', async () => {
    const r = await fetchApi('POST', '/api/health', {}, { Origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'Origine non ammessa' });
  });
  it('POST senza Origin', async () => {
    const r = await fetchApi('POST', '/api/health', {}, { Origin: '' });
    expect(r.status).toBe(403);
  });
  it('config iniziale', async () =>
    expect((await env.DB.prepare("SELECT value FROM config WHERE key='freshness_minutes'").first<{ value: string }>())?.value).toBe('60'));
});
