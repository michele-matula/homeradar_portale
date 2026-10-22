import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_SETTINGS } from '@homeradar/shared/api/types';
import { AGENT, mockApi, renderAt, type Routes } from './helpers';

export const AGENT_ROUTES: Routes = {
  'GET /api/me': { status: 200, body: { user: AGENT } },
  'GET /api/leads': { status: 200, body: { leads: [], dueRecalls: 0 } },
  'GET /api/sweep': { status: 200, body: { running: null, last: null } },
  'GET /api/devices': { status: 200, body: [] },
  'GET /api/settings': { status: 200, body: DEFAULT_AGENT_SETTINGS },
};

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
