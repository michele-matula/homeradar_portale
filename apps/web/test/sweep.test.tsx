import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_STORE_URL, type ConnectorReply, type ConnectorState, type PortalMessage } from '@homeradar/shared/api/connector-messages';
import { Devices } from '../src/components/Devices';
import { Sweep } from '../src/components/Sweep';
import type { ConnectorPort } from '../src/connector';
import { mockApi, type Routes } from './helpers';

const STATE: ConnectorState = { version: '0.1.0', linked: true, userId: 'u1', sweeping: false, pending: 0, stuck: false };
const IDLE = { 'GET /api/sweep': { status: 200, body: { running: null, last: null } } };

/** Connettore finto: registra i messaggi e risponde con `reply`, o null se assente. */
function fakeConnector(reply: (m: PortalMessage, n: number) => ConnectorReply<unknown> | null) {
  const sent: PortalMessage[] = [];
  const port: ConnectorPort = {
    send: vi.fn(async (m: PortalMessage) => {
      sent.push(m);
      return reply(m, sent.filter((x) => x.type === m.type).length) as never;
    }),
  };
  return { port, sent, types: () => sent.map((m) => m.type) };
}

const ok = <T,>(data: T): ConnectorReply<T> => ({ ok: true, data });
const notLinked: ConnectorReply<never> = { ok: false, error: 'Connettore non collegato', notLinked: true };

function api(extra: Routes = {}) {
  return mockApi({ ...IDLE, 'POST /api/devices/link-code': { status: 201, body: { code: 'cod1' } }, ...extra });
}

afterEach(() => vi.useRealTimers());

describe('«Cerca» dal portale', () => {
  it('non collegato: chiede il codice, collega il connettore e parte', async () => {
    const calls = api();
    const c = fakeConnector((m) => (m.type === 'ping' ? ok({ ...STATE, linked: false }) : m.type === 'startSweep' ? ok({ sweepId: 'g', total: 3, skipped: 0 }) : ok(null)));
    render(<Sweep userId="u1" connector={c.port} phone={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerca' }));
    await vi.waitFor(() => expect(c.types()).toContain('startSweep'));
    // Il primo ping è quello all'apertura; dopo l'avvio ne parte un altro.
    expect(c.types().slice(1, 4)).toEqual(['ping', 'link', 'startSweep']);
    expect(c.sent.find((m) => m.type === 'link')).toEqual({ type: 'link', code: 'cod1' });
    expect(calls.some((x) => x.method === 'POST' && x.path === '/api/devices/link-code')).toBe(true);
  });

  it('connettore collegato a un altro account: lo ricollega a questo', async () => {
    api();
    const c = fakeConnector((m) => (m.type === 'ping' ? ok({ ...STATE, userId: 'altro' }) : m.type === 'startSweep' ? ok({ sweepId: 'g', total: 1, skipped: 0 }) : ok(null)));
    render(<Sweep userId="u1" connector={c.port} phone={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerca' }));
    await vi.waitFor(() => expect(c.types()).toContain('startSweep'));
    expect(c.types().slice(1, 4)).toEqual(['ping', 'link', 'startSweep']);
  });

  it('collegamento perso: ricollega e riprova una volta sola', async () => {
    api();
    const c = fakeConnector((m) => (m.type === 'ping' ? ok(STATE) : m.type === 'startSweep' ? notLinked : ok(null)));
    render(<Sweep userId="u1" connector={c.port} phone={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerca' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Connettore non collegato');
    expect(c.types().filter((t) => t === 'startSweep')).toHaveLength(2);
    expect(c.types().filter((t) => t === 'link')).toHaveLength(1);
  });

  it('tutte le ricerche fresche', async () => {
    api();
    const c = fakeConnector((m) => (m.type === 'ping' ? ok(STATE) : m.type === 'startSweep' ? ok({ sweepId: null, total: 0, skipped: 4 }) : ok(null)));
    render(<Sweep userId="u1" connector={c.port} phone={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerca' }));
    expect(await screen.findByText("Dati già aggiornati da meno di un'ora")).toBeTruthy();
  });

  it('errore del connettore: il suo messaggio', async () => {
    api();
    const c = fakeConnector((m) => (m.type === 'ping' ? ok(STATE) : m.type === 'startSweep' ? { ok: false, error: 'Giro già in corso su un altro computer' } : ok(null)));
    render(<Sweep userId="u1" connector={c.port} phone={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerca' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Giro già in corso su un altro computer');
  });

  it('connettore assente: istruzioni, poi «Cerca» appena risponde', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api();
    let installed = false;
    const c = fakeConnector((m) => (m.type === 'ping' && installed ? ok(STATE) : null));
    render(<Sweep userId="u1" connector={c.port} phone={false} />);
    expect(await screen.findByText(/Connettore non trovato/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cerca' })).toBeNull();
    installed = true;
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(await screen.findByRole('button', { name: 'Cerca' })).toBeTruthy();
  });

  it('dal telefono: nessun «Cerca»', async () => {
    api();
    const c = fakeConnector(() => ok(STATE));
    render(<Sweep userId="u1" connector={c.port} phone />);
    expect(await screen.findByText('Le ricerche partono dal computer')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cerca' })).toBeNull();
    expect(c.sent).toEqual([]);
  });

  it('giro in corso: avanzamento e «Ferma»', async () => {
    mockApi({
      'GET /api/sweep': { status: 200, body: { running: { startedAt: 1, total: 5, done: 2, current: 'x', portals: {}, newCount: 0, drops: 0 }, last: null } },
    });
    const c = fakeConnector((m) => (m.type === 'ping' ? ok({ ...STATE, sweeping: true }) : ok(null)));
    render(<Sweep userId="u1" connector={c.port} phone={false} />);
    expect(await screen.findByText(/^Ricerca in corso/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ferma' }));
    await vi.waitFor(() => expect(c.types()).toContain('stopSweep'));
  });

  it('ultimo giro finito', async () => {
    mockApi({
      'GET /api/sweep': { status: 200, body: { running: null, last: { startedAt: 1, finishedAt: 2, outcome: 'partial', portals: {}, notFound: [], newCount: 7, drops: 0, missing: 0 } } },
    });
    render(<Sweep userId="u1" connector={fakeConnector(() => ok(STATE)).port} phone={false} />);
    expect(await screen.findByText(/^Ultimo giro: .* · completato in parte · 7 nuovi lead$/)).toBeTruthy();
  });

  it('pagine in attesa d\'invio e invio bloccato', async () => {
    api();
    const c = fakeConnector(() => ok({ ...STATE, pending: 3, stuck: true }));
    render(<Sweep userId="u1" connector={c.port} phone={false} />);
    expect(await screen.findByText("3 pagine in attesa d'invio")).toBeTruthy();
    expect(screen.getByText('Il connettore non riesce a inviare i dati: controlla la connessione')).toBeTruthy();
  });

  it('una sola pagina in attesa', async () => {
    api();
    render(<Sweep userId="u1" connector={fakeConnector(() => ok({ ...STATE, pending: 1 })).port} phone={false} />);
    expect(await screen.findByText("1 pagina in attesa d'invio")).toBeTruthy();
  });
});

const RUNNING = {
  startedAt: Date.now() - 4 * 60_000, total: 6, done: 2, current: 'Treviglio · Case (Immobiliare)',
  portals: { immobiliare: { pages: 4, privates: 37 } }, newCount: 5, drops: 1,
};
const FINISHED = {
  startedAt: Date.now() - 10 * 60_000, finishedAt: Date.now() + 60_000, outcome: 'partial',
  portals: { immobiliare: { outcome: 'complete', searches: 2, pages: 4, privates: 37 }, idealista: { outcome: 'blocked', searches: 1, pages: 0, privates: 0 } },
  notFound: ['Treviglio · Box (Subito)'], newCount: 3, drops: 2, missing: 1,
};

describe('avanzamento del giro', () => {
  it('in corso: barra, portali, ricerca corrente e Ferma', async () => {
    mockApi({ 'GET /api/sweep': { status: 200, body: { running: RUNNING, last: null } } });
    const c = fakeConnector((m) => (m.type === 'ping' ? ok({ ...STATE, sweeping: true }) : ok(null)));
    render(<Sweep userId="u1" connector={c.port} phone={false} />);
    expect(await screen.findByText('Ricerca in corso · 4 min')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Ricerche fatte' }) as HTMLProgressElement;
    expect([bar.value, bar.max]).toEqual([2, 6]);
    expect(screen.getByText('Treviglio · Case (Immobiliare)')).toBeTruthy();
    expect(screen.getByText('Immobiliare.it: 4 pagine · 37 privati')).toBeTruthy();
    expect(screen.getByText('Finora: 5 annunci nuovi · 1 ribassi')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ferma' })).toBeTruthy();
  });

  it('ogni stato letto arriva a onStatus', async () => {
    mockApi({ 'GET /api/sweep': { status: 200, body: { running: null, last: FINISHED } } });
    const onStatus = vi.fn();
    render(<Sweep userId="u1" connector={fakeConnector(() => ok(STATE)).port} phone={false} onStatus={onStatus} />);
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith({ running: null, last: FINISHED }));
  });

  it('a fine giro: riepilogo, motivi e Vedi i nuovi', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    mockApi({ 'GET /api/sweep': () => ({ status: 200, body: n++ === 0 ? { running: RUNNING, last: null } : { running: null, last: FINISHED } }) });
    const onFinished = vi.fn();
    const onShowNew = vi.fn();
    render(<Sweep userId="u1" connector={fakeConnector(() => ok(STATE)).port} phone={false} onFinished={onFinished} onShowNew={onShowNew} />);
    await screen.findByText(/^Ricerca in corso/);
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(await screen.findByText('Giro completato in parte · 11 min')).toBeTruthy();
    expect(screen.getByText('3 nuovi lead · 2 ribassi · 1 non più visti')).toBeTruthy();
    expect(screen.getByText('Idealista.it ha chiesto una verifica: aprilo tu e riprova domani.')).toBeTruthy();
    expect(screen.getByText('Non trovati: Treviglio · Box (Subito).')).toBeTruthy();
    expect(onFinished).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Vedi i nuovi' }));
    expect(onShowNew).toHaveBeenCalledWith();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByText('Giro completato in parte · 11 min')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cerca' })).toBeTruthy();
  });

  it('con pagine in attesa si continua a interrogare il connettore', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api();
    let pending = 2;
    render(<Sweep userId="u1" connector={fakeConnector(() => ok({ ...STATE, pending })).port} phone={false} />);
    expect(await screen.findByText("2 pagine in attesa d'invio")).toBeTruthy();
    pending = 0;
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await vi.waitFor(() => expect(screen.queryByText("2 pagine in attesa d'invio")).toBeNull());
  });

  it('connettore assente: testo con l\'incognito', async () => {
    api();
    render(<Sweep userId="u1" connector={fakeConnector(() => null).port} phone={false} />);
    expect(await screen.findByText(/se sei in una finestra in incognito, apri il portale in una finestra normale/)).toBeTruthy();
  });

  it('connettore assente: link al Chrome Web Store', async () => {
    api();
    render(<Sweep userId="u1" connector={fakeConnector(() => null).port} phone={false} />);
    const link = await screen.findByRole('link', { name: 'installalo dal Chrome Web Store' });
    expect(link.getAttribute('href')).toBe(CONNECTOR_STORE_URL);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('senza zona non c\'è Cerca', async () => {
    api();
    render(<Sweep userId="u1" connector={fakeConnector(() => ok(STATE)).port} phone={false} hasZone={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'Cerca' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Ricerche' })).toBeNull();
  });
});

describe('computer collegati', () => {
  const PC = { id: 'd1', name: 'Chrome su Windows', createdAt: 1, lastSeenAt: null };

  it('scollega un computer', async () => {
    let list = [PC];
    const calls = mockApi({
      'GET /api/devices': () => ({ status: 200, body: list }),
      'DELETE /api/devices/d1': () => {
        list = [];
        return { status: 204 };
      },
    });
    render(<Devices />);
    expect(await screen.findByText('Chrome su Windows')).toBeTruthy();
    expect(screen.getByText(/ultimo uso mai/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scollega' }));
    await vi.waitFor(() => expect(screen.queryByText('Chrome su Windows')).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/devices/d1')).toBe(true);
  });

  it('nessun computer: niente elenco', async () => {
    mockApi({ 'GET /api/devices': { status: 200, body: [] } });
    const { container } = render(<Devices />);
    await vi.waitFor(() => expect(container.textContent).toBe(''));
  });
});
