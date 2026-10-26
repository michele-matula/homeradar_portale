import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@homeradar/shared/api/types';
import type { AutoSweepHours } from '@homeradar/shared/core/auto-sweep';
import { PORTALS, type Portal } from '@homeradar/shared/shared/types';

interface DbSettings {
  min_age_days: number;
  min_drop_percent: number;
  categories: string;
  enabled_portals: string;
  auto_sweep: number;
  auto_sweep_hours: number | null;
}

/** Impostazioni dell'agente; i default finché non ne salva. Un portale nuovo nasce acceso. */
export async function getSettings(db: D1Database, userId: string): Promise<AgentSettings> {
  const r = await db.prepare('SELECT * FROM user_settings WHERE user_id = ?').bind(userId).first<DbSettings>();
  if (!r) return { ...DEFAULT_AGENT_SETTINGS, enabledPortals: { ...DEFAULT_AGENT_SETTINGS.enabledPortals } };
  return {
    minAgeDays: r.min_age_days,
    minDropPercent: r.min_drop_percent,
    categories: JSON.parse(r.categories),
    enabledPortals: { ...DEFAULT_AGENT_SETTINGS.enabledPortals, ...JSON.parse(r.enabled_portals) },
    autoSweep: r.auto_sweep === 1,
    autoSweepHours: r.auto_sweep_hours as AutoSweepHours | null,
  };
}

export type SettingsPatch = Partial<Omit<AgentSettings, 'enabledPortals'>> & { enabledPortals?: Partial<Record<Portal, boolean>> };

/** Unisce la modifica a quanto salvato; restituisce il messaggio d'errore se il risultato non va bene. */
export async function saveSettings(db: D1Database, userId: string, patch: SettingsPatch, now: number): Promise<AgentSettings | string> {
  const cur = await getSettings(db, userId);
  const s: AgentSettings = { ...cur, ...patch, enabledPortals: { ...cur.enabledPortals, ...patch.enabledPortals } };
  if (!PORTALS.some((p) => s.enabledPortals[p])) return 'Attiva almeno un portale';
  await db
    .prepare(`INSERT INTO user_settings (user_id, min_age_days, min_drop_percent, categories, enabled_portals, auto_sweep, auto_sweep_hours, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET min_age_days = excluded.min_age_days, min_drop_percent = excluded.min_drop_percent,
      categories = excluded.categories, enabled_portals = excluded.enabled_portals, auto_sweep = excluded.auto_sweep,
      auto_sweep_hours = excluded.auto_sweep_hours, updated_at = excluded.updated_at`)
    .bind(userId, s.minAgeDays, s.minDropPercent, JSON.stringify(s.categories), JSON.stringify(s.enabledPortals), s.autoSweep ? 1 : 0, s.autoSweepHours, now)
    .run();
  return s;
}
