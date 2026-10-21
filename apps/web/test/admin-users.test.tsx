import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ComuneRef } from '@homeradar/shared/shared/types';
import { ComunePicker } from '../src/components/ComunePicker';
import { ADMIN, AGENT, mockApi, renderAt } from './helpers';

const TREVIGLIO = { istat: '016219', name: 'Treviglio', province: 'BG' };
const LUCA = { id: 'u2', email: 'luca@bianchi.it', role: 'agent', status: 'active', comuni: [TREVIGLIO], maxComuni: 4, createdAt: 0, lastSeenAt: null };
const ADMIN_ROW = { id: 'a1', email: 'admin@homeradar.test', role: 'admin', status: 'active', comuni: [], maxComuni: 0, createdAt: 0, lastSeenAt: 0 };
const INVITE_URL = 'https://portale.test/attiva/xyz';

const base = (users: unknown[] = [ADMIN_ROW, LUCA]) => ({
  'GET /api/me': { status: 200, body: { user: ADMIN } },
  'GET /api/admin/users': { status: 200, body: { users } },
});

const row = async (email: string) => (await screen.findByText(email)).closest('li')!;

describe('admin utenti', () => {
  it('crea un agente e mostra il link da copiare', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const calls = mockApi({
      ...base(),
      'POST /api/admin/users': { status: 201, body: { user: { ...LUCA, id: 'u3', email: 'nuovo@agente.it', status: 'invited' }, inviteUrl: INVITE_URL } },
    });
    renderAt('/admin/utenti');
    await screen.findByText('luca@bianchi.it');
    const form = screen.getByRole('form', { name: 'Nuovo agente' });
    fireEvent.change(within(form).getByLabelText('Email dell\'agente'), { target: { value: 'nuovo@agente.it' } });
    fireEvent.change(within(form).getByLabelText('Cerca un comune'), { target: { value: 'trevigl' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Treviglio (BG)' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Crea e invita' }));
    expect(await screen.findByText(INVITE_URL)).toBeTruthy();
    expect(screen.getByText("Mandalo all'agente: vale 7 giorni e si usa una volta sola")).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ email: 'nuovo@agente.it', comuni: ['016219'], maxComuni: 4 });
    fireEvent.click(screen.getByRole('button', { name: 'Copia link' }));
    expect(writeText).toHaveBeenCalledWith(INVITE_URL);
  });

  it('mostra l\'errore sui comuni accanto all\'azione', async () => {
    mockApi({ ...base(), 'PATCH /api/admin/users/u2': { status: 400, body: { error: 'Al massimo 4 comuni per questo utente' } } });
    renderAt('/admin/utenti');
    const r = await row('luca@bianchi.it');
    fireEvent.click(within(r).getByRole('button', { name: 'Modifica' }));
    fireEvent.click(within(r).getByRole('button', { name: 'Salva' }));
    expect(await within(r).findByText('Al massimo 4 comuni per questo utente')).toBeTruthy();
  });

  it('sospende un agente attivo', async () => {
    const calls = mockApi({ ...base(), 'PATCH /api/admin/users/u2': { status: 200, body: { user: { ...LUCA, status: 'suspended' } } } });
    renderAt('/admin/utenti');
    const r = await row('luca@bianchi.it');
    fireEvent.click(within(r).getByRole('button', { name: 'Sospendi' }));
    expect(await within(r).findByRole('button', { name: 'Riattiva' })).toBeTruthy();
    expect(within(r).getByText('Sospeso')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'suspended' });
  });

  it('link di reimpostazione per un attivo, nuovo invito per un invitato', async () => {
    mockApi({
      ...base([ADMIN_ROW, LUCA, { ...LUCA, id: 'u4', email: 'inv@agente.it', status: 'invited' }]),
      'POST /api/admin/users/u2/reset': { status: 200, body: { resetUrl: 'https://portale.test/reimposta/r1' } },
      'POST /api/admin/users/u4/invite': { status: 200, body: { inviteUrl: 'https://portale.test/attiva/i2' } },
    });
    renderAt('/admin/utenti');
    const active = await row('luca@bianchi.it');
    expect(within(active).queryByRole('button', { name: "Nuovo link d'invito" })).toBeNull();
    fireEvent.click(within(active).getByRole('button', { name: 'Link per reimpostare la password' }));
    expect(await within(active).findByText('https://portale.test/reimposta/r1')).toBeTruthy();
    expect(within(active).getByText('Vale 1 ora e si usa una volta sola')).toBeTruthy();
    const invited = await row('inv@agente.it');
    expect(within(invited).queryByRole('button', { name: 'Sospendi' })).toBeNull();
    fireEvent.click(within(invited).getByRole('button', { name: "Nuovo link d'invito" }));
    expect(await within(invited).findByText('https://portale.test/attiva/i2')).toBeTruthy();
  });

  it('elimina solo dopo conferma', async () => {
    const calls = mockApi({ ...base(), 'DELETE /api/admin/users/u2': { status: 204 } });
    renderAt('/admin/utenti');
    const r = await row('luca@bianchi.it');
    fireEvent.click(within(r).getByRole('button', { name: 'Elimina' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(within(r).getByText('Elimina definitivamente luca@bianchi.it?')).toBeTruthy();
    fireEvent.click(within(r).getByRole('button', { name: 'Conferma eliminazione' }));
    await vi.waitFor(() => expect(screen.queryByText('luca@bianchi.it')).toBeNull());
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/api/admin/users/u2');
  });

  it('nessuna azione sull\'account amministratore', async () => {
    mockApi(base());
    renderAt('/admin/utenti');
    const r = await row('admin@homeradar.test');
    expect(within(r).queryAllByRole('button')).toHaveLength(0);
  });

  it('un agente non vede la pagina', async () => {
    mockApi({ 'GET /api/me': { status: 200, body: { user: AGENT } } });
    renderAt('/admin/utenti');
    expect(await screen.findByText('Ciao mario@rossi.it')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });
});

describe('ComunePicker', () => {
  function Harness({ initial, max }: { initial: ComuneRef[]; max: number }) {
    const [value, setValue] = useState(initial);
    return <ComunePicker value={value} max={max} onChange={setValue} />;
  }

  it('si ferma al limite', () => {
    render(<Harness initial={[TREVIGLIO]} max={1} />);
    expect((screen.getByLabelText('Cerca un comune') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Al massimo 1 comuni')).toBeTruthy();
  });

  it('aggiunge e toglie', () => {
    render(<Harness initial={[]} max={4} />);
    fireEvent.change(screen.getByLabelText('Cerca un comune'), { target: { value: 'trevigl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Treviglio (BG)' }));
    expect(screen.getByText('Treviglio (BG)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Togli Treviglio' }));
    expect(screen.queryByText('Treviglio (BG)')).toBeNull();
  });
});
