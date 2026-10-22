import { describe, expect, it } from 'vitest';
import { deviceName } from '../../src/device-name';

describe('nome del computer', () => {
  it('browser e sistema', () => {
    expect(deviceName([{ brand: 'Microsoft Edge' }], 'win')).toBe('Edge su Windows');
    expect(deviceName([{ brand: 'Not A Brand' }, { brand: 'Chromium' }, { brand: 'Google Chrome' }], 'mac')).toBe('Chrome su macOS');
    expect(deviceName([{ brand: 'Brave' }], 'linux')).toBe('Brave su Linux');
    expect(deviceName([{ brand: 'Opera' }], 'cros')).toBe('Opera su ChromeOS');
  });

  it('senza indicazioni', () => {
    expect(deviceName(undefined, 'android')).toBe('Browser');
    expect(deviceName([{ brand: 'Chromium' }], 'win')).toBe('Browser su Windows');
  });
});
