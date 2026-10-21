import { PRIVACY_VERSION } from '@homeradar/shared/api/types';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AGENT, mockApi, NOT_LOGGED, renderAt } from './helpers';

const TOKEN = 'abc123';

function fill(pw: string, again: string) {
  fireEvent.change(screen.getByLabelText('Nuova password'), { target: { value: pw } });
  fireEvent.change(screen.getByLabelText('Ripeti la password'), { target: { value: again } });
}

describe('attivazione', () => {
  const routes = {
    'GET /api/me': NOT_LOGGED,
    [`GET /api/tokens/${TOKEN}`]: { status: 200, body: { kind: 'invite', email: 'mario@rossi.it' } },
    [`POST /api/tokens/${TOKEN}`]: { status: 200, body: { user: AGENT } },
  };

  it('mostra l\'email dell\'invito', async () => {
    mockApi(routes);
    renderAt(`/attiva/${TOKEN}`);
    expect(await screen.findByText('mario@rossi.it')).toBeTruthy();
  });

  it('password diverse', async () => {
    const calls = mockApi(routes);
    renderAt(`/attiva/${TOKEN}`);
    await screen.findByText('mario@rossi.it');
    fill('password-lunga', 'password-diversa');
    fireEvent.click(screen.getByLabelText(/Ho letto l'informativa/));
    fireEvent.click(screen.getByRole('button', { name: 'Attiva l\'account' }));
    expect(await screen.findByText('Le password non coincidono')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('informativa obbligatoria', async () => {
    mockApi(routes);
    renderAt(`/attiva/${TOKEN}`);
    await screen.findByText('mario@rossi.it');
    fill('password-lunga', 'password-lunga');
    const button = screen.getByRole('button', { name: 'Attiva l\'account' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Ho letto l'informativa/));
    expect(button.disabled).toBe(false);
    expect(screen.getByRole('link', { name: 'informativa' }).getAttribute('href')).toBe('/informativa');
  });

  it('invia privacyVersion e porta alla home', async () => {
    const calls = mockApi(routes);
    renderAt(`/attiva/${TOKEN}`);
    await screen.findByText('mario@rossi.it');
    fill('password-lunga', 'password-lunga');
    fireEvent.click(screen.getByLabelText(/Ho letto l'informativa/));
    fireEvent.click(screen.getByRole('button', { name: 'Attiva l\'account' }));
    expect(await screen.findByText('Ciao mario@rossi.it')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ password: 'password-lunga', privacyVersion: PRIVACY_VERSION });
  });

  it('errore del server sulla password', async () => {
    mockApi({ ...routes, [`POST /api/tokens/${TOKEN}`]: { status: 400, body: { error: 'La password deve avere almeno 10 caratteri' } } });
    renderAt(`/attiva/${TOKEN}`);
    await screen.findByText('mario@rossi.it');
    fill('corta', 'corta');
    fireEvent.click(screen.getByLabelText(/Ho letto l'informativa/));
    fireEvent.click(screen.getByRole('button', { name: 'Attiva l\'account' }));
    expect(await screen.findByText('La password deve avere almeno 10 caratteri')).toBeTruthy();
  });

  it('link scaduto', async () => {
    mockApi({ 'GET /api/me': NOT_LOGGED, [`GET /api/tokens/${TOKEN}`]: { status: 404, body: { error: 'Link non valido o scaduto' } } });
    renderAt(`/attiva/${TOKEN}`);
    expect(await screen.findByText('Link non valido o scaduto')).toBeTruthy();
  });
});

describe('reimpostazione', () => {
  it('nessuna informativa, invia solo la password', async () => {
    const calls = mockApi({
      'GET /api/me': NOT_LOGGED,
      [`GET /api/tokens/${TOKEN}`]: { status: 200, body: { kind: 'reset', email: 'mario@rossi.it' } },
      [`POST /api/tokens/${TOKEN}`]: { status: 200, body: { user: AGENT } },
    });
    renderAt(`/reimposta/${TOKEN}`);
    await screen.findByText('mario@rossi.it');
    expect(screen.queryByLabelText(/Ho letto l'informativa/)).toBeNull();
    fill('nuova-password', 'nuova-password');
    fireEvent.click(screen.getByRole('button', { name: 'Salva la password' }));
    expect(await screen.findByText('Ciao mario@rossi.it')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ password: 'nuova-password' });
  });
});

describe('informativa', () => {
  it('pagina pubblica con testo provvisorio', async () => {
    mockApi({ 'GET /api/me': NOT_LOGGED });
    renderAt('/informativa');
    expect(await screen.findByRole('heading', { name: 'Informativa' })).toBeTruthy();
    expect(screen.getByText("Testo in preparazione: verrà pubblicato prima dell'apertura del servizio.")).toBeTruthy();
    expect(window.location.pathname).toBe('/informativa');
  });
});
