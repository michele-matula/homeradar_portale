import { idealistaAdapter } from '@homeradar/shared/adapters/idealista/index';
import { runDomReader } from '../content';

export default defineContentScript({
  matches: ['https://www.idealista.it/*'],
  runAt: 'document_idle',
  main(ctx) {
    runDomReader(ctx, idealistaAdapter);
  },
});
