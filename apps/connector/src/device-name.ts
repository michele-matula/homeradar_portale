const BRANDS: Record<string, string> = { 'Google Chrome': 'Chrome', 'Microsoft Edge': 'Edge', Brave: 'Brave', Opera: 'Opera' };
const SYSTEMS: Record<string, string> = { win: 'Windows', mac: 'macOS', linux: 'Linux', cros: 'ChromeOS' };

/** Come l'agente riconosce il computer nel portale: "Edge su Windows". */
export function deviceName(brands: { brand: string }[] | undefined, os: string): string {
  const browser = brands?.map((b) => BRANDS[b.brand]).find(Boolean) ?? 'Browser';
  const system = SYSTEMS[os];
  return system ? `${browser} su ${system}` : browser;
}
