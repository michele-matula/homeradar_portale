import { immobiliareAdapter } from '@homeradar/shared/adapters/immobiliare/index';
import { runPayloadReader } from '../content';

export default defineContentScript({
  matches: ['https://www.immobiliare.it/*'],
  runAt: 'document_start',
  main() {
    runPayloadReader(immobiliareAdapter);
  },
});
