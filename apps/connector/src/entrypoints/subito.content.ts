import { subitoAdapter } from '@homeradar/shared/adapters/subito/index';
import { runPayloadReader } from '../content';

export default defineContentScript({
  matches: ['https://www.subito.it/*'],
  runAt: 'document_start',
  main() {
    runPayloadReader(subitoAdapter);
  },
});
