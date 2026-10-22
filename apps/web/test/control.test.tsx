import { fireEvent, screen, within } from '@testing-library/react';
import type { ControlAgent, ControlRow, ControlRun, ErrorGroup } from '@homeradar/shared/api/types';
import { describe, expect, it } from 'vitest';
import { ADMIN, AGENT, mockApi, renderAt } from './helpers';

const NOW = Date.now();
const DAY = 86_400_000;

const ROSSI: ControlRow = {
  userId: 'u1', email: 'rossi@agenzia.it', status: 'active', lastSeenAt: NOW - DAY,
  devices: [
    { id: 'd1', name: 'Chrome · Windows', version: '0.4.0', createdAt: NOW - 30 * DAY, lastSeenAt: NOW - DAY, lastGoodSweepAt: NOW - DAY },
    { id: 'd2', name: 'Chrome · macOS', version: '0.3.0', createdAt: NOW - 20 * DAY, lastSeenAt: NOW - 9 * DAY, lastGoodSweepAt: null },
  ],
  lastSweep: { id: 's1', startedAt: NOW - DAY, finishedAt: NOW - DAY + 60_000, outcome: 'completed', deviceName: 'Chrome · Windows', searches: 3, problems: 1 },
  sweeps30d: 6, errors7d: 2, health: 'warn', reasons: ['Connettore Chrome · macOS muto da 9 giorni', 'Ultimo giro: 1 ricerca con problemi'],
};
const VERDI: ControlRow = {
  userId: 'u2', email: 'verdi@agenzia.it', status: 'invited', lastSeenAt: null, devices: [], lastSweep: null, sweeps30d: 0, errors7d: 0,
  health: 'bad', reasons: ['Nessun connettore', 'Mai fatto un giro', 'Mai entrato'],
};
const RUNS: ControlRun[] = [
  { searchKey: 'k1', portal: 'immobiliare', label: 'Treviglio · Case', status: 'complete', pages: 2, privates: 5, reason: null },
  { searchKey: 'k2', portal: 'idealista', label: 'Treviglio · Case', status: 'error', pages: 1, privates: 0, reason: 'timeout' },
];
const OLD_RUNS: ControlRun[] = [{ searchKey: 'k3', portal: 'subito', label: 'Caravaggio · Immobili', status: 'error', pages: 1, privates: 0, reason: 'unreadable' }];
const GROUP: ErrorGroup = {
  source: 'connector', version: '0.4.0', message: 'Ricerca non riuscita: annunci non letti', count: 12, firstAt: NOW - 5 * DAY, lastAt: NOW - DAY,
  context: 'idealista', agents: ['rossi@agenzia.it'], devices: [{ name: 'Chrome · Windows', revoked: true }],
};
const AGENT_PAGE: ControlAgent = {
  row: ROSSI,
  sweeps: [ROSSI.lastSweep!, { id: 's0', startedAt: NOW - 2 * DAY, finishedAt: NOW - 2 * DAY + 60_000, outcome: 'interrupted', deviceName: null, searches: 1, problems: 1 }],
  errors: [GROUP],
};

const me = { 'GET /api/me': { status: 200, body: { user: ADMIN } } };

describe('pagina «Controllo»', () => {
  it('una riga per agente con stato e motivi; clic → scheda', async () => {
    mockApi({ ...me, 'GET /api/admin/control': { status: 200, body: [ROSSI, VERDI] } });
    renderAt('/admin/controllo');
    const rossi = (await screen.findByText('rossi@agenzia.it')).closest('tr')!;
    expect(rossi.className).toContain('health--warn');
    expect(within(rossi).getByText('Ultimo giro: 1 ricerca con problemi')).toBeTruthy();
    expect(within(rossi).getByText(/6 giri in 30 gg/)).toBeTruthy();
    const verdi = screen.getByText('verdi@agenzia.it').closest('tr')!;
    expect(verdi.className).toContain('health--bad');
    expect(within(verdi).getAllByText('mai').length).toBeGreaterThan(0);
    expect(within(verdi).getByText('nessuno')).toBeTruthy();
    fireEvent.click(rossi);
    expect(window.location.pathname).toBe('/admin/controllo/u1');
  });

  it('un agente non admin viene rimandato ai lead', async () => {
    mockApi({ 'GET /api/me': { status: 200, body: { user: AGENT } }, 'GET /api/leads': { status: 200, body: { leads: [] } } });
    renderAt('/admin/controllo');
    await screen.findByRole('link', { name: /Lead/ });
    expect(window.location.pathname).toBe('/');
  });
});

describe('scheda dell\'agente', () => {
  it('connettori, ultimo giro con le ricerche, giri precedenti ed errori', async () => {
    const calls = mockApi({
      ...me,
      'GET /api/admin/control/u1': { status: 200, body: AGENT_PAGE },
      'GET /api/admin/sweeps/s1/runs': { status: 200, body: RUNS },
      'GET /api/admin/sweeps/s0/runs': { status: 200, body: OLD_RUNS },
    });
    renderAt('/admin/controllo/u1');
    const devices = await screen.findByRole('table', { name: 'Connettori' });
    expect(within(devices).getByText('Chrome · macOS')).toBeTruthy();
    expect(within(devices).getByText('nessun giro riuscito')).toBeTruthy();
    expect(within(devices).getByText('0.3.0')).toBeTruthy();
    const runs = await screen.findByRole('table', { name: 'Ricerche del giro' });
    expect(within(runs).getByText('pagina non arrivata in tempo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /interrotto/ }));
    expect(await screen.findByText('annunci non letti')).toBeTruthy();
    expect(calls.some((c) => c.path === '/api/admin/sweeps/s0/runs')).toBe(true);
    expect(screen.getByText('Ricerca non riuscita: annunci non letti')).toBeTruthy();
  });

  it('revoca con conferma, poi ricarica', async () => {
    let revoked = false;
    const calls = mockApi({
      ...me,
      'GET /api/admin/control/u1': () => ({ status: 200, body: revoked ? { ...AGENT_PAGE, row: { ...ROSSI, devices: [ROSSI.devices[0]] } } : AGENT_PAGE }),
      'GET /api/admin/sweeps/s1/runs': { status: 200, body: RUNS },
      'DELETE /api/admin/devices/d2': () => {
        revoked = true;
        return { status: 204 };
      },
    });
    renderAt('/admin/controllo/u1');
    const row = (await screen.findByText('Chrome · macOS')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Revoca' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Conferma revoca' }));
    await screen.findByText('Chrome · Windows');
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/admin/devices/d2']);
    await expect.poll(() => screen.queryByText('Chrome · macOS')).toBeNull();
  });

  it('agente sconosciuto', async () => {
    mockApi({ ...me, 'GET /api/admin/control/zz': { status: 404, body: { error: 'Agente non trovato' } } });
    renderAt('/admin/controllo/zz');
    expect(await screen.findByText('Agente non trovato')).toBeTruthy();
  });
});

describe('pagina «Errori»', () => {
  it('righe con connettore revocato e filtro per provenienza', async () => {
    const calls = mockApi({
      ...me,
      'GET /api/admin/errors': { status: 200, body: [GROUP] },
      'GET /api/admin/errors?source=server': { status: 200, body: [] },
    });
    renderAt('/admin/errori');
    expect(await screen.findByText('Ricerca non riuscita: annunci non letti')).toBeTruthy();
    expect(screen.getByText('Chrome · Windows (connettore revocato)')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Server' }));
    expect(await screen.findByText('Nessun errore negli ultimi 90 giorni')).toBeTruthy();
    expect(calls.map((c) => c.path)).toContain('/api/admin/errors?source=server');
  });
});
