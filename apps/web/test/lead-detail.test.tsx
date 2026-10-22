import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aboveMarketText } from '@homeradar/shared/core/market';
import { addDays, startOfLocalDay } from '@homeradar/shared/core/recall';
import type { LeadState, LeadView } from '@homeradar/shared/shared/types';
import { AGENT_ROUTES, mockApi, renderAt, type Routes } from './helpers';
import { lead, NOW, source } from './fixtures';

const MARKET = { scope: 'zone' as const, label: 'Centro', city: 'Treviglio', medianPerM2: 1500, sampleSize: 7, deltaPercent: 25 };
const MAIN = lead({
  key: 'immobiliare:1',
  title: 'Villa con giardino',
  others: [source('idealista:2', { lastSeenAt: NOW - 5 * 86_400_000 }, true)],
  view: {
    prices: [
      { listingKey: 'immobiliare:1', price: 200_000, at: NOW - 30 * 86_400_000, source: 'declared' },
      { listingKey: 'immobiliare:1', price: 190_000, at: NOW - 10 * 86_400_000, source: 'observed' },
      { listingKey: 'immobiliare:1', price: 180_000, at: NOW - 86_400_000, source: 'observed' },
    ],
    market: MARKET,
  },
});
const OTHER = lead({ key: 'subito:5', title: 'Bilocale', priority: 'medium' });

const saved = (over: Partial<LeadState>): LeadState => ({ ...MAIN.state, statusChangedAt: 1, updatedAt: 1, ...over });

function routes(extra: Routes = {}, leads: LeadView[] = [MAIN, OTHER]): Routes {
  return { ...AGENT_ROUTES, 'GET /api/leads': { status: 200, body: { leads, dueRecalls: 0 } }, ...extra };
}
const detail = () => screen.getByRole('region', { name: 'Scheda del lead' });

afterEach(() => vi.restoreAllMocks());

describe('scheda del lead', () => {
  it('mostra storico, fonti e mercato', async () => {
    mockApi(routes());
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    const d = within(detail());
    expect(d.getByRole('heading', { name: 'Villa con giardino' })).toBeTruthy();
    const history = d.getByRole('table', { name: 'Storico prezzi' });
    expect(within(history).getAllByRole('row')).toHaveLength(4);
    expect(d.getByText(/Annuncio precedente/)).toBeTruthy();
    expect(d.getByText(aboveMarketText(MARKET))).toBeTruthy();
  });

  it('cambiare stato manda tutte le chiavi del gruppo e sposta il lead', async () => {
    const calls = mockApi(routes({ 'PATCH /api/leads/state': (b) => ({ status: 200, body: { state: saved({ status: (b as { status: LeadState['status'] }).status }) } }) }));
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    fireEvent.change(within(detail()).getByRole('combobox', { name: 'Stato' }), { target: { value: 'contacted' } });
    await vi.waitFor(() => expect(screen.getByRole('tab', { name: 'Contattati (1)' })).toBeTruthy());
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ keys: ['immobiliare:1', 'idealista:2'], status: 'contacted' });
    expect((within(detail()).getByRole('combobox', { name: 'Stato' }) as HTMLSelectElement).value).toBe('contacted');
  });

  it('richiamo con scorciatoia', async () => {
    const calls = mockApi(routes({ 'PATCH /api/leads/state': (b) => ({ status: 200, body: { state: saved({ recallAt: (b as { recallAt: number }).recallAt }) } }) }));
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    fireEvent.click(within(detail()).getByRole('button', { name: 'Richiama…' }));
    fireEvent.click(within(detail()).getByRole('button', { name: 'Domani' }));
    await vi.waitFor(() => expect(within(detail()).getByRole('button', { name: 'Fatto' })).toBeTruthy());
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ keys: ['immobiliare:1', 'idealista:2'], recallAt: addDays(startOfLocalDay(Date.now()), 1) });
  });

  it('nota salvata all\'uscita dal campo, non a ogni tasto', async () => {
    const calls = mockApi(routes({ 'PATCH /api/leads/state': () => ({ status: 200, body: { state: saved({ notes: 'chiamare la sera' }) } }) }));
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    const notes = within(detail()).getByRole('textbox', { name: 'Note' });
    fireEvent.change(notes, { target: { value: 'chiamare' } });
    fireEvent.change(notes, { target: { value: 'chiamare la sera' } });
    fireEvent.blur(notes);
    expect(await within(detail()).findByText('Salvata')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ keys: ['immobiliare:1', 'idealista:2'], notes: 'chiamare la sera' }]);
  });

  it('errore del server: messaggio, stato invariato, nota conservata', async () => {
    mockApi(routes({ 'PATCH /api/leads/state': { status: 400, body: { error: 'Impossibile impostare un richiamo su un lead scartato' } } }));
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    const d = within(detail());
    fireEvent.change(d.getByRole('combobox', { name: 'Stato' }), { target: { value: 'discarded' } });
    expect(await d.findByRole('alert')).toBeTruthy();
    expect(d.getByRole('alert').textContent).toBe('Impossibile impostare un richiamo su un lead scartato');
    expect((d.getByRole('combobox', { name: 'Stato' }) as HTMLSelectElement).value).toBe('new');
    const notes = d.getByRole('textbox', { name: 'Note' });
    fireEvent.change(notes, { target: { value: 'testo importante' } });
    fireEvent.blur(notes);
    await vi.waitFor(() => expect(d.queryByText('Salvataggio…')).toBeNull());
    expect((notes as HTMLTextAreaElement).value).toBe('testo importante');
  });

  it('Separa ricarica la lista', async () => {
    const calls = mockApi(routes({ 'POST /api/leads/split': { status: 204 } }));
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    fireEvent.click(within(detail()).getByRole('button', { name: 'Separa annuncio precedente Idealista' }));
    await vi.waitFor(() => expect(calls.filter((c) => c.path === '/api/leads')).toHaveLength(2));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ key: 'idealista:2', fromKeys: ['immobiliare:1'] });
  });

  it('lead non in lista', async () => {
    mockApi(routes());
    renderAt('/lead/subito%3A999');
    expect(await screen.findByText('Questo lead non è nella tua lista')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Torna ai lead' }));
    expect(window.location.pathname).toBe('/');
  });

  it('una fonte secondaria apre il suo lead', async () => {
    mockApi(routes());
    renderAt('/lead/idealista%3A2');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    expect(within(detail()).getByRole('heading', { name: 'Villa con giardino' })).toBeTruthy();
  });

  it('tornando indietro filtri e posizione restano', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    mockApi(routes());
    renderAt('/');
    fireEvent.click(await screen.findByRole('radio', { name: 'Alta (1)' }));
    Object.defineProperty(window, 'scrollY', { value: 480, configurable: true });
    fireEvent.click(screen.getByRole('link', { name: 'Apri il lead: Villa con giardino' }));
    expect(window.location.pathname).toBe('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    act(() => {
      window.history.back();
    });
    await vi.waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(screen.getByRole('radio', { name: 'Alta (1)' }).getAttribute('aria-checked')).toBe('true');
    await vi.waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 480));
  });

  it('«← Lead» chiude la scheda', async () => {
    mockApi(routes());
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    fireEvent.click(screen.getByRole('button', { name: '← Lead' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByRole('region', { name: 'Scheda del lead' })).toBeNull();
  });
});
