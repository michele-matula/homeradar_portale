import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Sent {
  version: string;
  errors: { message: string; context?: string; at: number }[];
}

let sent: { body: Sent; init: RequestInit }[] = [];
let status = 204;
let leadsStatus = 500;

/** Moduli nuovi a ogni test: la coda degli errori è stato del modulo. */
async function fresh() {
  vi.resetModules();
  return { errors: await import('../src/errors'), api: await import('../src/api') };
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  status = 204;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    if (input === '/api/errors') {
      sent.push({ body: JSON.parse(String(init.body)) as Sent, init });
      if (status === 0) throw new TypeError('Failed to fetch');
      return new Response(null, { status });
    }
    if (input === '/api/leads') return new Response(JSON.stringify({ error: 'Errore interno' }), { status: leadsStatus });
    return new Response(null, { status: 404 });
  }));
});
afterEach(() => vi.useRealTimers());


describe('errori del portale', () => {
  it('raccoglie gli errori di un secondo in un solo invio', async () => {
    const { errors } = await fresh();
    window.history.replaceState(null, '', '/lead/immobiliare%3A123456');
    errors.reportError('Uno');
    errors.reportError('Due');
    errors.reportError('Tre');
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.init.keepalive).toBe(true);
    expect(sent[0]!.body.version).toBe('test');
    expect(sent[0]!.body.errors.map((e) => [e.message, e.context])).toEqual([['Uno', '/lead/:chiave'], ['Due', '/lead/:chiave'], ['Tre', '/lead/:chiave']]);
  });

  it('percorsi senza chiavi né id', async () => {
    const { errors } = await fresh();
    expect(errors.routeOf('/lead/immobiliare%3A123456')).toBe('/lead/:chiave');
    expect(errors.routeOf('/admin/controllo/7a1c3c58-1a7d-4c0e-9d55-3f3b8f0f2a10')).toBe('/admin/controllo/:id');
    expect(errors.routeOf('/attiva/abcDEF123_-xyz')).toBe('/attiva/:token');
    expect(errors.routeOf('/impostazioni')).toBe('/impostazioni');
  });

  it('se l\'invio fallisce non ritenta e non si segnala', async () => {
    for (const s of [500, 0]) {
      status = s;
      sent = [];
      const { errors } = await fresh();
      errors.reportError('Boom');
      await vi.advanceTimersByTimeAsync(5000);
      expect(sent).toHaveLength(1);
    }
  });

  it('più di 20 nello stesso secondo: partono i primi 20', async () => {
    const { errors } = await fresh();
    for (let i = 0; i < 25; i++) errors.reportError(`E${i}`);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.errors).toHaveLength(20);
  });

  it('le API segnalano 5xx e rete, non i 4xx', async () => {
    const { api } = await fresh();
    leadsStatus = 500;
    await expect(api.api('GET', '/api/leads')).rejects.toThrow('Errore interno');
    leadsStatus = 400;
    await expect(api.api('GET', '/api/leads')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.flatMap((s) => s.body.errors.map((e) => e.message))).toEqual(['API GET /api/leads: 500 Errore interno']);
    (fetch as unknown as { mockImplementationOnce(f: () => never): void }).mockImplementationOnce(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(api.api('GET', '/api/leads')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.at(-1)!.body.errors.map((e) => e.message)).toEqual(['API GET /api/leads: rete']);
  });

  it('un errore di render mostra «Qualcosa non va.» e si segnala', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ErrorBoundary } = await import('../src/components/ErrorBoundary');
    const Broken = () => {
      throw new Error('Render rotto');
    };
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(screen.getByText('Qualcosa non va.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ricarica la pagina' })).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.at(-1)!.body.errors[0]!.message).toContain('Render rotto');
  });
});
