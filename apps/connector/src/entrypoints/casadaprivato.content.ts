import { casadaprivatoAdapter } from '@homeradar/shared/adapters/casadaprivato/index';
import { runDomReader } from '../content';

export default defineContentScript({
  matches: ['https://www.casadaprivato.it/*'],
  runAt: 'document_idle',
  main(ctx) {
    runDomReader(ctx, casadaprivatoAdapter);
  },
});
