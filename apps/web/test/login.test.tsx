import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    expect(window.location.pathname).toBe('/accedi');
  });

  it('accesso riuscito porta alla home', async () => {
    const calls = mockApi({ 'GET /api/me': NOT_LOGGED, 'POST /api/login': { status: 200, body: { user: AGENT } } });
    renderAt('/accedi');
    await screen.findByRole('button', { name: 'Accedi' });
    fillLogin('mario@rossi.it', 'password-lunga');
    expect(await screen.findByText('Ciao mario@rossi.it')).toBeTruthy();
    expect(screen.getByText('Treviglio (BG)')).toBeTruthy();
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
    expect(await screen.findByText('Ciao mario@rossi.it')).toBeTruthy();
  });

  it('esci', async () => {
    const calls = mockApi({ 'GET /api/me': { status: 200, body: { user: AGENT } }, 'POST /api/logout': { status: 204 } });
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Esci' }));
    expect(await screen.findByRole('button', { name: 'Accedi' })).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/logout')).toBe(true);
  });

  it('l\'agente non vede il link Utenti', async () => {
    mockApi({ 'GET /api/me': { status: 200, body: { user: AGENT } } });
    renderAt('/');
    await screen.findByText('Ciao mario@rossi.it');
    expect(screen.queryByRole('link', { name: 'Utenti' })).toBeNull();
  });
});
