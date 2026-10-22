import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, startOfLocalDay } from '@homeradar/shared/core/recall';
import type { LeadView } from '@homeradar/shared/shared/types';
import { AGENT, AGENT_ROUTES, mockApi, renderAt, type Routes } from './helpers';
import { lead } from './fixtures';

const today = startOfLocalDay(Date.now());
const LEADS = [
  lead({ key: 'immobiliare:1', title: 'Villa con giardino', priority: 'high', price: 300_000 }),
  lead({ key: 'subito:2', title: 'Bilocale in centro', priority: 'medium', price: 100_000 }),
  lead({ key: 'idealista:3', title: 'Trilocale da richiamare', status: 'to_contact', recallAt: addDays(today, -1) }),
];

function routes(leads: LeadView[] = LEADS, extra: Routes = {}): Routes {
  return { ...AGENT_ROUTES, 'GET /api/leads': { status: 200, body: { leads, dueRecalls: 0 } }, ...extra };
}
const rows = () => screen.queryAllByRole('link', { name: /^Apri il lead/ }).map((a) => a.getAttribute('aria-label'));

afterEach(() => vi.useRealTimers());

describe('lista dei lead', () => {
  it('si apre su Richiami se c\'è un richiamo da fare', async () => {
    mockApi(routes());
    renderAt('/');
    const tab = await screen.findByRole('tab', { name: 'Richiami (1 da fare)' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(rows()).toEqual(['Apri il lead: Trilocale da richiamare']);
    expect(screen.getByRole('link', { name: /1 da richiamare/ })).toBeTruthy();
  });

  it('cambiare scheda e filtrare per priorità', async () => {
    mockApi(routes());
    renderAt('/');
    fireEvent.click(await screen.findByRole('tab', { name: /^Nuovi/ }));
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: 'Alta (1)' }));
    expect(rows()).toEqual(['Apri il lead: Villa con giardino']);
  });

  it('la ricerca a testo filtra tutte le schede', async () => {
    mockApi(routes());
    renderAt('/');
    await screen.findByRole('tab', { name: /^Nuovi/ });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca nei lead' }), { target: { value: 'villa' } });
    expect(screen.getByRole('tab', { name: 'Nuovi (1)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Da contattare (0)' })).toBeTruthy();
  });

  it('Filtri: il riquadro si apre, il sito filtra, l\'etichetta si toglie', async () => {
    mockApi(routes());
    renderAt('/');
    fireEvent.click(await screen.findByRole('tab', { name: /^Nuovi/ }));
    expect(screen.queryByRole('button', { name: 'Azzera filtri' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Filtri/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Filtra per sito' })).getByRole('button', { name: 'Subito (1)' }));
    expect(rows()).toEqual(['Apri il lead: Bilocale in centro']);
    fireEvent.click(screen.getByRole('button', { name: /^Filtri/ }));
    expect(screen.getByRole('button', { name: 'Azzera filtri' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Togli il filtro Subito' }));
    expect(rows()).toHaveLength(2);
  });

  it('l\'ordinamento si ricorda per scheda', async () => {
    mockApi(routes());
    const { unmount } = renderAt('/');
    fireEvent.click(await screen.findByRole('tab', { name: /^Nuovi/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Ordina per' }), { target: { value: 'price_asc' } });
    expect(rows()).toEqual(['Apri il lead: Bilocale in centro', 'Apri il lead: Villa con giardino']);
    unmount();
    renderAt('/');
    fireEvent.click(await screen.findByRole('tab', { name: /^Nuovi/ }));
    expect((screen.getByRole('combobox', { name: 'Ordina per' }) as HTMLSelectElement).value).toBe('price_asc');
  });

  it('clic su una riga apre /lead/<chiave>', async () => {
    mockApi(routes());
    renderAt('/');
    fireEvent.click(await screen.findByRole('link', { name: 'Apri il lead: Trilocale da richiamare' }));
    expect(window.location.pathname).toBe('/lead/idealista%3A3');
  });

  it('senza zona: messaggio per l\'agente', async () => {
    mockApi(routes([], { 'GET /api/me': { status: 200, body: { user: { ...AGENT, comuni: [] } } } }));
    renderAt('/');
    expect(await screen.findByText(/L'amministratore non ti ha ancora assegnato una zona/)).toBeTruthy();
    expect(screen.queryByText(/Nessun lead/)).toBeNull();
  });

  it('scheda vuota con filtri: lo dice', async () => {
    mockApi(routes());
    renderAt('/');
    fireEvent.click(await screen.findByRole('tab', { name: /^Nuovi/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cerca nei lead' }), { target: { value: 'castello' } });
    expect(screen.getByText('Nessun lead «"castello"» in questa scheda.')).toBeTruthy();
  });

  it('scheda vuota senza filtri', async () => {
    mockApi(routes([]));
    renderAt('/');
    expect(await screen.findByText('Nessun lead in questa scheda. Premi «Cerca» dal computer per raccoglierne.')).toBeTruthy();
  });

  it('errore del server: messaggio e Riprova', async () => {
    let fail = true;
    const calls = mockApi(routes(LEADS, {
      'GET /api/leads': () => (fail ? { status: 500, body: { error: 'Errore del server' } } : { status: 200, body: { leads: LEADS, dueRecalls: 0 } }),
    }));
    renderAt('/');
    expect(await screen.findByText('Errore del server')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('tab', { name: 'Richiami (1 da fare)' })).toBeTruthy();
    expect(calls.filter((c) => c.path === '/api/leads')).toHaveLength(2);
  });

  it('Vedi i nuovi filtra i lead del giro', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const startedAt = Date.now() - 60_000;
    let n = 0;
    const running = { startedAt, total: 1, done: 0, current: null, portals: {}, newCount: 0, drops: 0 };
    const last = { startedAt, finishedAt: Date.now() + 60_000, outcome: 'completed', portals: {}, notFound: [], newCount: 1, drops: 0, missing: 0 };
    mockApi(routes(
      [lead({ key: 'subito:1', title: 'Nuovo del giro', firstSeenAt: Date.now() }), lead({ key: 'subito:2', title: 'Vecchio', firstSeenAt: startedAt - 86_400_000 })],
      { 'GET /api/sweep': () => ({ status: 200, body: n++ === 0 ? { running, last: null } : { running: null, last } }) },
    ));
    renderAt('/');
    await screen.findByText(/^Ricerca in corso/);
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    fireEvent.click(await screen.findByRole('button', { name: 'Vedi i nuovi' }));
    expect(rows()).toEqual(['Apri il lead: Nuovo del giro']);
    expect(screen.getByRole('button', { name: 'Togli il filtro Da questo giro' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Nuovi/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('a mezzanotte i richiami si ricalcolano', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    // 23:59 a Roma (UTC+2 in ottobre prima del cambio d'ora).
    vi.setSystemTime(Date.UTC(2026, 9, 22, 21, 59));
    const tomorrow = addDays(startOfLocalDay(Date.now()), 1);
    mockApi(routes([lead({ key: 'subito:9', title: 'Da richiamare domani', status: 'to_contact', recallAt: tomorrow })]));
    renderAt('/');
    expect(await screen.findByRole('tab', { name: 'Richiami (1)' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /da richiamare/ })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(await screen.findByRole('link', { name: /1 da richiamare/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Richiami (1 da fare)' })).toBeTruthy();
  });
});
