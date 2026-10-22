import { isListingsApiUrl } from '@homeradar/shared/adapters/immobiliare/urls';
import { installBridge } from '../bridge';

// Nella pagina (MAIN world): inoltra al content script solo ciò che il sito ha già caricato. Chi legge decide il content script.
export default defineContentScript({
  matches: ['https://www.immobiliare.it/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installBridge(window, isListingsApiUrl);
  },
});
