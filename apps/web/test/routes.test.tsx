import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AGENT_ROUTES, mockApi, renderAt } from './helpers';

describe('rotte del portale', () => {
  it('/impostazioni mostra le impostazioni', async () => {
    mockApi(AGENT_ROUTES);
    renderAt('/impostazioni');
    expect(await screen.findByRole('heading', { name: 'Impostazioni' })).toBeTruthy();
    expect(window.location.pathname).toBe('/impostazioni');
  });

  it('/lead/immobiliare%3A1 resta sulla pagina dei lead', async () => {
    mockApi(AGENT_ROUTES);
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('link', { name: 'Impostazioni' });
    await new Promise((r) => setTimeout(r, 20));
    expect(window.location.pathname).toBe('/lead/immobiliare%3A1');
  });

  it('un percorso sconosciuto torna a /', async () => {
    mockApi(AGENT_ROUTES);
    renderAt('/xyz');
    await vi.waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('il menu porta a Impostazioni e ai lead', async () => {
    mockApi(AGENT_ROUTES);
    renderAt('/');
    fireEvent.click(await screen.findByRole('link', { name: 'Impostazioni' }));
    expect(window.location.pathname).toBe('/impostazioni');
    expect(await screen.findByRole('heading', { name: 'Impostazioni' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /^Lead/ }));
    expect(window.location.pathname).toBe('/');
  });
});
