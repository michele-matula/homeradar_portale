import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aboveMarketText } from '@homeradar/shared/core/market';
import { addDays, startOfLocalDay } from '@homeradar/shared/core/recall';
import type { LeadState, LeadView } from '@homeradar/shared/shared/types';
import { LeadDetail } from '../src/components/LeadDetail';
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
/** Bottone di stato della scheda; acceso = `aria-checked`. */
const status = (name: string) => within(detail()).getByRole('radio', { name });
const checked = (name: string) => status(name).getAttribute('aria-checked');

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
    fireEvent.click(status('Contattato'));
    await vi.waitFor(() => expect(screen.getByRole('tab', { name: 'Contattati (1)' })).toBeTruthy());
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ keys: ['immobiliare:1', 'idealista:2'], status: 'contacted' });
    expect(checked('Contattato')).toBe('true');
  });

  it('richiamo con scorciatoia', async () => {
    const calls = mockApi(routes({ 'PATCH /api/leads/state': (b) => ({ status: 200, body: { state: saved({ recallAt: (b as { recallAt: number }).recallAt }) } }) }));
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
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
    fireEvent.click(status('Scartato'));
    expect(await d.findByRole('alert')).toBeTruthy();
    expect(d.getByRole('alert').textContent).toBe('Impossibile impostare un richiamo su un lead scartato');
    expect(checked('Da lavorare')).toBe('true');
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

  /** Come `mockApi`, ma le PATCH e le POST rispondono quando il test le libera (in ordine di partenza). */
  function slowWrites(): { bodies: unknown[]; release(i: number, status: number, body?: unknown): Promise<void> } {
    const base = routes();
    const bodies: unknown[] = [];
    const waiting: ((r: Response) => void)[] = [];
    vi.stubGlobal('fetch', (input: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (method === 'GET') {
        const r = base[`GET ${input}`] as { status: number; body?: unknown };
        return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
      }
      bodies.push(JSON.parse(String(init.body)));
      return new Promise<Response>((resolve) => waiting.push(resolve));
    });
    return {
      bodies,
      async release(i, status, body) {
        await act(async () => {
          waiting[i]!(new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
        });
      },
    };
  }

  it('due salvataggi ravvicinati partono uno dopo l\'altro e a video resta l\'ultimo', async () => {
    const w = slowWrites();
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    const d = within(detail());
    const notes = d.getByRole('textbox', { name: 'Note' });
    fireEvent.change(notes, { target: { value: 'richiamare' } });
    fireEvent.blur(notes);
    fireEvent.click(status('Contattato'));
    await vi.waitFor(() => expect(w.bodies).toHaveLength(1));
    // Il secondo aspetta il primo: così il server li applica in ordine e ogni risposta contiene i precedenti.
    await act(async () => {});
    expect(w.bodies).toHaveLength(1);
    await w.release(0, 200, { state: saved({ notes: 'richiamare' }) });
    await vi.waitFor(() => expect(w.bodies).toHaveLength(2));
    await w.release(1, 200, { state: saved({ status: 'contacted', notes: 'richiamare' }) });
    expect(checked('Contattato')).toBe('true');
  });

  it("se l'ultimo salvataggio fallisce si vede l'errore e resta a video quello riuscito prima", async () => {
    const w = slowWrites();
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    const d = within(detail());
    fireEvent.click(status('Scartato'));
    const notes = d.getByRole('textbox', { name: 'Note' });
    fireEvent.change(notes, { target: { value: 'x' } });
    fireEvent.blur(notes);
    await vi.waitFor(() => expect(w.bodies).toHaveLength(1));
    await w.release(0, 200, { state: saved({ status: 'discarded' }) });
    await vi.waitFor(() => expect(w.bodies).toHaveLength(2));
    await w.release(1, 500, { error: 'Errore del server' });
    expect(d.getByRole('alert').textContent).toBe('Errore del server');
    expect(checked('Scartato')).toBe('true');
  });

  it('Separa non parte due volte', async () => {
    const w = slowWrites();
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    const button = within(detail()).getByRole('button', { name: 'Separa annuncio precedente Idealista' });
    fireEvent.click(button);
    fireEvent.click(button);
    await vi.waitFor(() => expect(w.bodies).toHaveLength(1));
    expect((button as HTMLButtonElement).disabled).toBe(true);
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

  it('si apre come finestra sopra la lista e si chiude con Esc', async () => {
    mockApi(routes());
    renderAt('/lead/immobiliare%3A1');
    const dialog = await screen.findByRole('dialog', { name: 'Scheda del lead' });
    expect(within(dialog).getByText('Lead 1 di 2 · pagina 1')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Apri il lead: Bilocale' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('una selezione iniziata dentro e finita sullo sfondo non chiude', async () => {
    mockApi(routes());
    renderAt('/lead/immobiliare%3A1');
    const dialog = await screen.findByRole('dialog', { name: 'Scheda del lead' });
    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.mouseDown(within(dialog).getByRole('textbox', { name: 'Note' }));
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(window.location.pathname).toBe('/lead/immobiliare%3A1');
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(window.location.pathname).toBe('/');
  });

  it('clic sullo sfondo chiude, clic dentro no', async () => {
    mockApi(routes());
    renderAt('/lead/immobiliare%3A1');
    const dialog = await screen.findByRole('dialog', { name: 'Scheda del lead' });
    fireEvent.click(within(dialog).getByRole('heading', { name: 'Villa con giardino' }));
    expect(window.location.pathname).toBe('/lead/immobiliare%3A1');
    fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(window.location.pathname).toBe('/');
  });

  it('chiudendo la finestra filtri e lista restano', async () => {
    mockApi(routes());
    renderAt('/');
    fireEvent.click(await screen.findByRole('radio', { name: 'Alta (1)' }));
    fireEvent.click(screen.getByRole('link', { name: 'Apri il lead: Villa con giardino' }));
    await screen.findByRole('dialog');
    act(() => {
      window.history.back();
    });
    await vi.waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Alta (1)' }).getAttribute('aria-checked')).toBe('true');
  });

  it('lead aperto da indirizzo ma non nella pagina: niente posizione', async () => {
    const many = [MAIN, ...Array.from({ length: 30 }, (_, i) => lead({ key: `subito:${i + 10}`, title: `Casa ${i}`, priority: 'high', price: 1_000 + i }))];
    mockApi(routes({}, many));
    localStorage.setItem('homeradar.sortByTab', JSON.stringify({ new: 'price_asc' }));
    renderAt('/lead/immobiliare%3A1');
    const dialog = await screen.findByRole('dialog', { name: 'Scheda del lead' });
    expect(within(dialog).queryByText(/^Lead d+ di/)).toBeNull();
  });

  it('prezzo al metro quadro e NUOVO', async () => {
    const startedAt = Date.now() - 60_000;
    const last = { startedAt, finishedAt: startedAt + 1, outcome: 'completed', portals: {}, notFound: [], newCount: 1, drops: 0, missing: 0 };
    const fresh = lead({ key: 'subito:7', title: 'Appena trovato', firstSeenAt: startedAt + 1 });
    mockApi(routes({ 'GET /api/sweep': { status: 200, body: { running: null, last } } }, [fresh]));
    renderAt('/lead/subito%3A7');
    await screen.findByRole('dialog');
    expect(within(detail()).getByText('€ 1.875 al m²')).toBeTruthy();
    await vi.waitFor(() => expect(within(detail()).getByText('NUOVO')).toBeTruthy());
  });

  it('una nota scritta si salva anche chiudendo la scheda senza uscire dal campo', async () => {
    const calls = mockApi(routes({ 'PATCH /api/leads/state': () => ({ status: 200, body: { state: saved({ notes: 'da non perdere' }) } }) }));
    renderAt('/lead/immobiliare%3A1');
    await screen.findByRole('region', { name: 'Scheda del lead' });
    fireEvent.change(within(detail()).getByRole('textbox', { name: 'Note' }), { target: { value: 'da non perdere' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ keys: ['immobiliare:1', 'idealista:2'], notes: 'da non perdere' }]));
  });

  it('una nota cambiata altrove si aggiorna e non viene sovrascritta da quella vecchia', () => {
    const calls = mockApi({});
    const props = { now: NOW, isNew: false, onSaved: vi.fn(), onSplit: async () => {} };
    const { rerender } = render(<LeadDetail lead={lead({ notes: 'vecchia' })} {...props} />);
    rerender(<LeadDetail lead={lead({ notes: 'nuova' })} {...props} />);
    const notes = screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement;
    expect(notes.value).toBe('nuova');
    fireEvent.focus(notes);
    fireEvent.blur(notes);
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
  });

  it('✕ chiude la finestra', async () => {
    mockApi(routes());
    renderAt('/lead/immobiliare%3A1');
    const dialog = await screen.findByRole('dialog', { name: 'Scheda del lead' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chiudi' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByRole('region', { name: 'Scheda del lead' })).toBeNull();
  });
});
