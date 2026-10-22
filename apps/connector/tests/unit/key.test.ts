import { CONNECTOR_ID } from '@homeradar/shared/api/connector-messages';
import { describe, expect, it } from 'vitest';
import { extensionId, MANIFEST_KEY } from '../../src/key';

describe('chiave del manifest', () => {
  it('fissa l\'ID che il portale usa per parlare al connettore', async () => {
    expect(CONNECTOR_ID).toMatch(/^[a-p]{32}$/);
    expect(await extensionId(MANIFEST_KEY)).toBe(CONNECTOR_ID);
  });
});
