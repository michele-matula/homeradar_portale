import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AGENT, mockApi, NOT_LOGGED, renderAt } from './helpers';

function fillLogin(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Accedi' }));
}

describe('accesso', () => {
  it('senza sessione una pagina protetta porta all\'accesso', async () => {
    mockApi({ 'GET /api/me': NOT_LOGGED });
    renderAt('/');
    expect(await screen.findByRole('button', { name: 'Accedi' })).toBeTruthy();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/accedi'));
  });

  it('accesso riuscito porta alla home', async () => {
    const calls = mockApi({ 'GET /api/me': NOT_LOGGED, 'POST /api/login': { status: 200, body: { user: AGENT } } });
    renderAt('/accedi');
    await screen.findByRole('button', { name: 'Accedi' });
    fillLogin('mario@rossi.it', 'password-lunga');
    expect(await screen.findByRole('link', { name: 'Impostazioni' })).toBeTruthy();
    expect(window.location.pathname).toBe('/');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ email: 'mario@rossi.it', password: 'password-lunga' });
  });

  it('mostra l\'errore del server', async () => {
    mockApi({ 'GET /api/me': NOT_LOGGED, 'POST /api/login': { status: 401, body: { error: 'Email o password errati' } } });
    renderAt('/accedi');
    await screen.findByRole('button', { name: 'Accedi' });
    fillLogin('mario@rossi.it', 'sbagliata!!');
    expect(await screen.findByText('Email o password errati')).toBeTruthy();
  });

  it('utente già collegato su /accedi va alla home', async () => {
    mockApi({ 'GET /api/me': { status: 200, body: { user: AGENT } } });
    renderAt('/accedi');
    expect(await screen.findByRole('link', { name: 'Impostazioni' })).toBeTruthy();
  });

  it('esci', async () => {
    const calls = mockApi({ 'GET /api/me': { status: 200, body: { user: AGENT } }, 'POST /api/logout': { status: 204 } });
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Esci' }));
    expect(await screen.findByRole('button', { name: 'Accedi' })).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/logout')).toBe(true);
  });

  it('la barra in alto mostra l\'email dell\'utente collegato', async () => {
    mockApi({ 'GET /api/me': { status: 200, body: { user: AGENT } } });
    renderAt('/');
    expect(await screen.findByText('mario@rossi.it')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Account: mario@rossi.it' }).textContent).toBe('M');
  });

  it('la pagina di accesso ha informativa e assistenza nel piè di pagina', async () => {
    mockApi({ 'GET /api/me': NOT_LOGGED });
    renderAt('/accedi');
    await screen.findByRole('button', { name: 'Accedi' });
    expect(screen.getByRole('link', { name: 'Informativa privacy' }).getAttribute('href')).toBe('/informativa');
    expect(screen.getByRole('link', { name: 'Assistenza' }).getAttribute('href')).toBe('mailto:matulamichele+homeradar@gmail.com');
  });

  it('l\'agente non vede il link Utenti', async () => {
    mockApi({ 'GET /api/me': { status: 200, body: { user: AGENT } } });
    renderAt('/');
    await screen.findByRole('link', { name: 'Impostazioni' });
    expect(screen.queryByRole('link', { name: 'Utenti' })).toBeNull();
  });
});
