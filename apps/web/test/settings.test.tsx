import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_SETTINGS } from '@homeradar/shared/api/types';
import { AGENT_ROUTES, mockApi, renderAt, type Routes } from './helpers';

const routes = (extra: Routes = {}): Routes => ({ ...AGENT_ROUTES, ...extra });
const save = () => screen.getByRole('button', { name: 'Salva' }) as HTMLButtonElement;

describe('impostazioni', () => {
  it('carica e salva solo ciò che cambia', async () => {
    const calls = mockApi(routes({ 'PUT /api/settings': (b) => ({ status: 200, body: { ...DEFAULT_AGENT_SETTINGS, ...(b as object) } }) }));
    renderAt('/impostazioni');
    const days = await screen.findByRole('spinbutton', { name: 'Online da almeno (giorni)' });
    expect((days as HTMLInputElement).value).toBe(String(DEFAULT_AGENT_SETTINGS.minAgeDays));
    fireEvent.change(days, { target: { value: '60' } });
    fireEvent.click(save());
    expect(await screen.findByText('Impostazioni salvate')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ minAgeDays: 60 });
    expect(save().disabled).toBe(true);
  });

  it('Salva disattivato senza modifiche', async () => {
    mockApi(routes());
    renderAt('/impostazioni');
    await screen.findByRole('spinbutton', { name: 'Online da almeno (giorni)' });
    expect(save().disabled).toBe(true);
  });

  it('categorie e portali', async () => {
    const calls = mockApi(routes({ 'PUT /api/settings': (b) => ({ status: 200, body: { ...DEFAULT_AGENT_SETTINGS, ...(b as object) } }) }));
    renderAt('/impostazioni');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Subito.it' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Box' }));
    fireEvent.click(save());
    await screen.findByText('Impostazioni salvate');
    const body = calls.find((c) => c.method === 'PUT')?.body as Record<string, unknown>;
    expect(body.enabledPortals).toEqual({ subito: !DEFAULT_AGENT_SETTINGS.enabledPortals.subito });
    expect(Object.keys(body).sort()).toEqual(['categories', 'enabledPortals']);
  });

  it('togliere l\'ultimo portale: errore del server', async () => {
    mockApi(routes({ 'PUT /api/settings': { status: 400, body: { error: 'Attiva almeno un portale' } } }));
    renderAt('/impostazioni');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Immobiliare.it' }));
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toBe('Attiva almeno un portale');
  });

  it('la zona si vede ma non si modifica', async () => {
    mockApi(routes());
    renderAt('/impostazioni');
    expect(await screen.findByText('Treviglio (BG)')).toBeTruthy();
    expect(screen.getByText(/La zona la imposta l'amministratore/)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /comune/i })).toBeNull();
  });

  it('i computer collegati sono qui', async () => {
    const calls = mockApi(routes({ 'GET /api/devices': { status: 200, body: [{ id: 'd1', name: 'Chrome su Windows', createdAt: 1, lastSeenAt: 2 }] } }));
    renderAt('/impostazioni');
    expect(await screen.findByRole('heading', { name: 'I tuoi computer' })).toBeTruthy();
    expect(await screen.findByText('Chrome su Windows')).toBeTruthy();
    expect(calls.some((c) => c.path === '/api/devices')).toBe(true);
  });

  it('errore di lettura: messaggio', async () => {
    mockApi(routes({ 'GET /api/settings': { status: 500, body: { error: 'Errore del server' } } }));
    renderAt('/impostazioni');
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Errore del server'));
  });
});
