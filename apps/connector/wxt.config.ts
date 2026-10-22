import { loadEnv } from 'vite';
import { defineConfig } from 'wxt';
import { MANIFEST_KEY } from './src/key';

const PORTAL_HOSTS = ['https://www.immobiliare.it/*', 'https://www.idealista.it/*', 'https://www.subito.it/*', 'https://www.casadaprivato.it/*'];

/** Origine del portale: il connettore parla solo con lei (API e messaggi della pagina). */
export function portalOrigin(mode: string): string {
  const url = process.env.WXT_PORTAL_URL ?? loadEnv(mode, process.cwd(), 'WXT_').WXT_PORTAL_URL;
  // `wxt prepare` (all'installazione) genera solo i tipi: lì il portale non serve.
  if (!url && process.argv.includes('prepare')) return 'http://localhost';
  if (!url) throw new Error('Manca WXT_PORTAL_URL (es. https://portale.example): il connettore deve sapere qual è il portale');
  return new URL(url).origin;
}

/** Pacchetto per il Chrome Web Store: lo Store non accetta `key` (l'ID lo assegna lui). */
const STORE = process.env.WXT_STORE === '1';

export default defineConfig({
  srcDir: 'src',
  // La build dei test end-to-end (tempi brevissimi) e quella dello Store non devono mai finire nella cartella che si carica in Chrome.
  outDir: process.env.WXT_SWEEP_FAST === '1' ? '.output-e2e' : STORE ? '.output-store' : '.output',
  manifest: ({ mode }) => {
    const origin = portalOrigin(mode);
    return {
      name: 'HomeRadar connettore',
      description: 'Cerca gli annunci di privati della tua zona quando lo chiedi dal portale HomeRadar',
      ...(STORE ? {} : { key: MANIFEST_KEY }),
      permissions: ['storage', 'alarms', 'notifications'],
      host_permissions: [...PORTAL_HOSTS, `${origin}/*`],
      externally_connectable: { matches: [`${origin}/*`] },
      action: { default_title: 'HomeRadar' },
    };
  },
});
