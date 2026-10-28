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

  it('un campo numerico vuoto non si manda e lo dice', async () => {
    const calls = mockApi(routes());
    renderAt('/impostazioni');
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Online da almeno (giorni)' }), { target: { value: '' } });
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toBe('Scrivi un numero in «Online da almeno» e in «Ribasso di almeno»');
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });

  it('ribasso 0 si salva', async () => {
    const calls = mockApi(routes({
      'GET /api/settings': { status: 200, body: { ...DEFAULT_AGENT_SETTINGS, minDropPercent: 10 } },
      'PUT /api/settings': (b) => ({ status: 200, body: { ...DEFAULT_AGENT_SETTINGS, ...(b as object) } }),
    }));
    renderAt('/impostazioni');
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Ribasso di almeno (%)' }), { target: { value: '0' } });
    fireEvent.click(save());
    expect(await screen.findByText('Impostazioni salvate')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ minDropPercent: 0 });
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

describe('giro automatico', () => {
  /** Il connettore installato: i messaggi che riceve dalla pagina. */
  function connector() {
    const sent: unknown[] = [];
    vi.stubGlobal('chrome', { runtime: { sendMessage: (_id: string, m: unknown, cb: (r: unknown) => void) => { sent.push(m); cb({ ok: true, data: null }); } } });
    return sent;
  }
  const putEcho = { 'PUT /api/settings': (b: unknown) => ({ status: 200, body: { ...DEFAULT_AGENT_SETTINGS, ...(b as object) } }) };

  it('spento di default, frequenza disattivata finché è spento', async () => {
    connector();
    mockApi(routes());
    renderAt('/impostazioni');
    const on = (await screen.findByRole('checkbox', { name: 'Fai il giro da solo quando uso il computer' })) as HTMLInputElement;
    expect(on.checked).toBe(false);
    const freq = screen.getByRole('combobox', { name: 'Frequenza' }) as HTMLSelectElement;
    expect(freq.disabled).toBe(true);
    expect([...freq.options].map((o) => o.text)).toEqual(['Una volta al giorno', 'Ogni 8 ore', 'Ogni 6 ore', 'Ogni 4 ore', 'Ogni 3 ore']);
    expect(screen.getByText(/si ferma dalla notifica o dal riquadro «Ricerche» della lista dei lead/)).toBeTruthy();
    fireEvent.click(on);
    expect(freq.disabled).toBe(false);
  });

  it('attivarlo lo salva e lo dice al connettore', async () => {
    const sent = connector();
    const calls = mockApi(routes(putEcho));
    renderAt('/impostazioni');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Fai il giro da solo quando uso il computer' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Frequenza' }), { target: { value: '4' } });
    fireEvent.click(save());
    await screen.findByText('Impostazioni salvate');
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ autoSweep: true, autoSweepHours: 4 });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'autoChanged' }]));
  });

  it('salvare altro non disturba il connettore', async () => {
    const sent = connector();
    mockApi(routes(putEcho));
    renderAt('/impostazioni');
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Online da almeno (giorni)' }), { target: { value: '60' } });
    fireEvent.click(save());
    await screen.findByText('Impostazioni salvate');
    expect(sent).toEqual([]);
  });
});

describe('online al massimo', () => {
  const field = () => screen.findByRole('spinbutton', { name: 'Online al massimo (giorni)' }) as Promise<HTMLInputElement>;
  const echo = (b: unknown) => ({ status: 200, body: { ...DEFAULT_AGENT_SETTINGS, ...(b as object) } });

  it('vuoto senza limite; un numero si salva', async () => {
    const calls = mockApi(routes({ 'PUT /api/settings': echo }));
    renderAt('/impostazioni');
    const max = await field();
    expect(max.value).toBe('');
    fireEvent.change(max, { target: { value: '730' } });
    fireEvent.click(save());
    expect(await screen.findByText('Impostazioni salvate')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ maxAgeDays: 730 });
  });

  it('svuotarlo toglie il limite, non è un errore', async () => {
    const calls = mockApi(routes({
      'GET /api/settings': { status: 200, body: { ...DEFAULT_AGENT_SETTINGS, maxAgeDays: 730 } },
      'PUT /api/settings': echo,
    }));
    renderAt('/impostazioni');
    fireEvent.change(await field(), { target: { value: '' } });
    fireEvent.click(save());
    expect(await screen.findByText('Impostazioni salvate')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ maxAgeDays: null });
  });

  it("l'errore del server si vede", async () => {
    mockApi(routes({ 'PUT /api/settings': { status: 400, body: { error: 'Online al massimo deve essere più del minimo' } } }));
    renderAt('/impostazioni');
    fireEvent.change(await field(), { target: { value: '100' } });
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toBe('Online al massimo deve essere più del minimo');
  });
});
