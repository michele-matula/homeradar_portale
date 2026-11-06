import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SweepProgress, SweepResult, SweepStatus } from '@homeradar/shared/shared/types';
import { Sweep } from '../src/components/Sweep';
import type { ConnectorPort } from '../src/connector';
import { mockApi, type Routes } from './helpers';

const absent: ConnectorPort = { send: vi.fn(async () => null) as never };
const BASE: SweepStatus = { running: null, last: null, remote: null, computers: { enabled: 1, online: ['PC di casa'] } };
const RUNNING: SweepProgress = {
  startedAt: Date.now() - 60_000, total: 10, done: 4, current: 'Treviglio', portals: {}, newCount: 3, drops: 0,
  auto: false, remote: true, deviceName: 'PC di casa', stopRequested: false,
};

function phone(status: Partial<SweepStatus> | (() => Partial<SweepStatus>), extra: Routes = {}) {
  const calls = mockApi({
    'GET /api/sweep': () => ({ status: 200, body: { ...BASE, ...(typeof status === 'function' ? status() : status) } }),
    ...extra,
  });
  render(<Sweep userId="u1" connector={absent} phone />);
  return calls;
}
const later = () => Date.now() + 60_000;

afterEach(() => vi.useRealTimers());

describe('«Avvia sul computer» dal telefono', () => {
  it('pronto: computer online e bottone che lascia la richiesta', async () => {
    const calls = phone({}, { 'POST /api/sweep/remote': { status: 201, body: { fresh: false } } });
    expect(await screen.findByText('PC di casa è online')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Avvia sul computer' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/sweep/remote')).toBe(true));
  });

  it('più computer online', async () => {
    phone({ computers: { enabled: 2, online: ['PC di casa', 'PC ufficio'] } });
    expect(await screen.findByText('PC di casa e PC ufficio sono online')).toBeTruthy();
  });

  it('nessun computer online: il bottone resta', async () => {
    phone({ computers: { enabled: 1, online: [] } });
    expect(await screen.findByText('Nessun tuo computer è online ora')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Avvia sul computer' })).toBeTruthy();
  });

  it('nessun computer abilitato: niente bottone, rimando alle impostazioni', async () => {
    phone({ computers: { enabled: 0, online: [] } });
    const link = await screen.findByRole('link', { name: 'Impostazioni' });
    expect(link.getAttribute('href')).toBe('/impostazioni');
    expect(screen.queryByRole('button', { name: 'Avvia sul computer' })).toBeNull();
  });

  it('dati già freschi: lo dice subito', async () => {
    phone({}, { 'POST /api/sweep/remote': { status: 200, body: { fresh: true } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Avvia sul computer' }));
    expect(await screen.findByText("Dati già aggiornati da meno di un'ora")).toBeTruthy();
  });

  it('errore del server: il suo messaggio', async () => {
    phone({}, { 'POST /api/sweep/remote': { status: 409, body: { error: 'Giro già in corso' } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Avvia sul computer' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Giro già in corso');
  });

  it('in attesa: si può annullare', async () => {
    let state: Partial<SweepStatus> = { remote: { state: 'waiting', createdAt: later(), deviceName: null } };
    const calls = phone(() => state, {
      'DELETE /api/sweep/remote': () => {
        state = {};
        return { status: 204 };
      },
    });
    expect(await screen.findByText('Aspetto un computer acceso… (fino a 2 minuti)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/sweep/remote')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Avvia sul computer' })).toBeTruthy();
  });

  it('in attesa si rilegge lo stato finché il giro parte', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: Partial<SweepStatus> = { remote: { state: 'waiting', createdAt: later(), deviceName: null } };
    phone(() => state);
    expect(await screen.findByText(/Aspetto un computer acceso/)).toBeTruthy();
    state = { running: RUNNING, remote: { state: 'started', createdAt: later(), deviceName: 'PC di casa' } };
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(await screen.findByText('Giro in corso su «PC di casa»')).toBeTruthy();
  });

  it('nessuno ha risposto: lo dice e si riprova', async () => {
    phone({ remote: { state: 'noAnswer', createdAt: later(), deviceName: null } });
    expect(await screen.findByText('Nessun computer ha risposto')).toBeTruthy();
    expect(screen.getByText(/Serve un computer acceso, non in sospensione, con Chrome aperto/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy();
  });

  it('una richiesta di prima di aprire la pagina non si mostra', async () => {
    phone({ remote: { state: 'noAnswer', createdAt: Date.now() - 60_000, deviceName: null } });
    expect(await screen.findByRole('button', { name: 'Avvia sul computer' })).toBeTruthy();
    expect(screen.queryByText('Nessun computer ha risposto')).toBeNull();
  });

  it('presa ma il giro non è partito: col nome del computer', async () => {
    phone({ remote: { state: 'failed', createdAt: later(), deviceName: 'PC di casa' } });
    expect(await screen.findByText('«PC di casa» ha risposto ma il giro non è partito: riprova')).toBeTruthy();
  });

  it('presa con i dati già freschi', async () => {
    phone({ remote: { state: 'fresh', createdAt: later(), deviceName: 'PC di casa' } });
    expect(await screen.findByText("Dati già aggiornati da meno di un'ora")).toBeTruthy();
  });

  it('giro in corso: Ferma passa dal server', async () => {
    let running = RUNNING;
    const calls = phone(() => ({ running }), {
      'POST /api/sweep/stop': () => {
        running = { ...RUNNING, stopRequested: true };
        return { status: 204 };
      },
    });
    expect(await screen.findByText('Giro in corso su «PC di casa»')).toBeTruthy();
    expect(screen.getByText('4 di 10 ricerche · finora 3 annunci nuovi')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ferma' }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/sweep/stop')).toBe(true));
    expect(await screen.findByText('Si ferma entro un minuto…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ferma' })).toBeNull();
  });

  it('giro automatico in corso', async () => {
    phone({ running: { ...RUNNING, auto: true, remote: false } });
    expect(await screen.findByText('Giro automatico in corso')).toBeTruthy();
  });

  it('finito mentre la pagina era aperta: riepilogo; la verifica si fa al computer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: Partial<SweepStatus> = { running: RUNNING };
    phone(() => state);
    expect(await screen.findByText('Giro in corso su «PC di casa»')).toBeTruthy();
    const last: SweepResult = {
      startedAt: Date.now() - 300_000, finishedAt: Date.now(), outcome: 'partial', newCount: 7, drops: 2, missing: 0, notFound: [], remote: true,
      portals: { idealista: { pages: 1, privates: 0, outcome: 'blocked' } },
    };
    state = { last };
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(await screen.findByText('7 nuovi lead · 2 ribassi · 0 non più visti')).toBeTruthy();
    expect(screen.getByText('Idealista.it ha chiesto una verifica: aprilo quando sei al computer.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vedi i nuovi' })).toBeTruthy();
  });

  it("l'ultimo giro dal telefono lo dice", async () => {
    const last: SweepResult = { startedAt: 1, finishedAt: 2, outcome: 'completed', newCount: 1, drops: 0, missing: 0, notFound: [], remote: true, portals: {} };
    phone({ last });
    expect(await screen.findByText(/· dal telefono/)).toBeTruthy();
  });
});

describe('computer senza connettore', () => {
  it('istruzioni per installarlo e anche «Avvia sul computer»', async () => {
    mockApi({ 'GET /api/sweep': { status: 200, body: BASE } });
    render(<Sweep userId="u1" connector={absent} phone={false} />);
    expect(await screen.findByText(/Connettore non trovato/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Avvia sul computer' })).toBeTruthy();
  });
});
