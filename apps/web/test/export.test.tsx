import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EXPORT_COLUMNS } from '@homeradar/shared/core/export';
import { ExportBar } from '../src/components/ExportBar';
import { lead } from './fixtures';

const LEADS = [lead({ key: 'subito:1', title: 'Villa' }), lead({ key: 'subito:2', title: 'Box' })];

describe('esportazione', () => {
  it('CSV della vista corrente', async () => {
    const download = vi.fn();
    render(<ExportBar leads={LEADS} download={download} />);
    expect(screen.getByText('Esporta la vista corrente (2)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [blob, name] = download.mock.calls[0] as [Blob, string];
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(name).toMatch(/\.csv$/);
    const lines = (await blob.text()).replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines[0]).toContain(EXPORT_COLUMNS[0]);
    expect(lines[0]).toContain(EXPORT_COLUMNS[EXPORT_COLUMNS.length - 1]);
    expect(lines).toHaveLength(3);
  });

  it('XLSX', async () => {
    const download = vi.fn();
    render(<ExportBar leads={LEADS} download={download} />);
    fireEvent.click(screen.getByRole('button', { name: 'Esporta XLSX' }));
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [blob, name] = download.mock.calls[0] as [Blob, string];
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(name).toMatch(/\.xlsx$/);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('senza lead i bottoni sono disattivati', () => {
    render(<ExportBar leads={[]} download={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'CSV' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Esporta XLSX' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
