import { useState } from 'react';
import type { LeadView } from '@homeradar/shared/shared/types';
import { errorText } from '../api';
import { downloadBlob } from '../download';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Esporta i lead della vista corrente (scheda e filtri). Il modulo d'esportazione (con `xlsx`) si carica solo al clic. */
export function ExportBar({ leads, download = downloadBlob }: { leads: LeadView[]; download?: (b: Blob, name: string) => void }) {
  const [error, setError] = useState<string | null>(null);

  async function run(format: 'xlsx' | 'csv'): Promise<void> {
    setError(null);
    try {
      const { exportFileName, toCsv, toExportRows, toXlsx } = await import('@homeradar/shared/core/export');
      const rows = toExportRows(leads);
      const blob = format === 'xlsx'
        ? new Blob([toXlsx(rows) as BlobPart], { type: XLSX_TYPE })
        : new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
      download(blob, exportFileName(format, Date.now()));
    } catch (e) {
      setError(errorText(e));
    }
  }

  const empty = leads.length === 0;
  return (
    <footer className="export">
      <button type="button" className="btn btn--primary btn--small" disabled={empty} onClick={() => void run('xlsx')}>
        Esporta XLSX
      </button>
      <button type="button" className="btn btn--small" disabled={empty} onClick={() => void run('csv')}>
        CSV
      </button>
      <span className="export__hint">{`Esporta la vista corrente (${leads.length})`}</span>
      {error && <p className="error" role="alert">{error}</p>}
    </footer>
  );
}
