import { describe, expect, it } from 'vitest';
import { PortalMessage } from '@/api/connector-messages';

describe('PortalMessage', () => {
  it('accetta i messaggi del portale', () => {
    expect(PortalMessage.safeParse({ type: 'link', code: 'x' }).success).toBe(true);
    expect(PortalMessage.safeParse({ type: 'ping' }).success).toBe(true);
    expect(PortalMessage.safeParse({ type: 'startSweep' }).success).toBe(true);
    expect(PortalMessage.safeParse({ type: 'stopSweep' }).success).toBe(true);
  });
  it('rifiuta messaggi incompleti, con campi in più o sconosciuti', () => {
    expect(PortalMessage.safeParse({ type: 'link' }).success).toBe(false);
    expect(PortalMessage.safeParse({ type: 'ping', extra: 1 }).success).toBe(false);
    expect(PortalMessage.safeParse({ type: 'boh' }).success).toBe(false);
    expect(PortalMessage.safeParse(null).success).toBe(false);
  });
});
