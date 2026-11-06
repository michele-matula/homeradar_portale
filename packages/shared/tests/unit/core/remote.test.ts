import { describe, expect, it } from 'vitest';
import { REMOTE_MIN_VERSION, remoteState, versionAtLeast, type RemoteRow } from '@/core/remote';
import { DevicePatchBody, StartSweepBody } from '@/api/connector';
import { PortalMessage } from '@/api/connector-messages';

describe('versionAtLeast', () => {
  it('confronta le parti come numeri', () => {
    expect(versionAtLeast('0.3.0', '0.3.0')).toBe(true);
    expect(versionAtLeast('0.10.0', '0.3.0')).toBe(true);
    expect(versionAtLeast('1.0', '0.3.0')).toBe(true);
    expect(versionAtLeast('0.2.9', '0.3.0')).toBe(false);
  });
  it('una versione assente o strana non basta', () => {
    expect(versionAtLeast(null, REMOTE_MIN_VERSION)).toBe(false);
    expect(versionAtLeast('abc', REMOTE_MIN_VERSION)).toBe(false);
  });
});

describe('remoteState', () => {
  const base: RemoteRow = { createdAt: 0, expiresAt: 120_000, deviceId: null, outcome: null };
  it('in attesa finché non scade, poi nessuno ha risposto', () => {
    expect(remoteState(base, 60_000)).toBe('waiting');
    expect(remoteState(base, 120_000)).toBe('noAnswer');
  });
  it('presa senza esito: il giro non è partito', () => {
    expect(remoteState({ ...base, deviceId: 'd' }, 60_000)).toBe('failed');
  });
  it("l'esito salvato vale; annullata non si mostra", () => {
    expect(remoteState({ ...base, deviceId: 'd', outcome: 'fresh' }, 60_000)).toBe('fresh');
    expect(remoteState({ ...base, deviceId: 'd', outcome: 'started' }, 500_000)).toBe('started');
    expect(remoteState({ ...base, outcome: 'cancelled' }, 60_000)).toBeNull();
  });
});

describe('schemi', () => {
  it('link con un nome non vuoto, remoteChanged senza campi', () => {
    expect(PortalMessage.safeParse({ type: 'link', code: 'x', name: '' }).success).toBe(false);
    expect(PortalMessage.safeParse({ type: 'link', code: 'x', name: 'PC di casa' }).success).toBe(true);
    expect(PortalMessage.safeParse({ type: 'link', code: 'x' }).success).toBe(true);
    expect(PortalMessage.safeParse({ type: 'remoteChanged' }).success).toBe(true);
  });
  it('il giro dal telefono porta l’id della richiesta', () => {
    expect(StartSweepBody.safeParse({ remote: 'non-uuid' }).success).toBe(false);
    expect(StartSweepBody.safeParse({ remote: crypto.randomUUID() }).success).toBe(true);
  });
  it('rinomina e interruttore', () => {
    expect(DevicePatchBody.safeParse({ label: '' }).success).toBe(false);
    expect(DevicePatchBody.safeParse({ label: '  ' }).success).toBe(false);
    expect(DevicePatchBody.safeParse({ label: null, remote: true }).success).toBe(true);
    expect(DevicePatchBody.safeParse({ label: 'x'.repeat(61) }).success).toBe(false);
    expect(DevicePatchBody.parse({ label: ' PC di casa ' })).toEqual({ label: 'PC di casa' });
  });
});
