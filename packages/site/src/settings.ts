/** /settings — questions relay + access code. localStorage only. */

export interface AskSettings {
  /** relay base URL (questions Worker) */
  relay: string;
  /** optional shared gate for the questions API */
  accessCode: string;
}

export interface SettingsConfig {
  /** localStorage key, e.g. "ask.settings.v4" (web) or "metro.settings.v1" */
  lsKey: string;
  /** default relay URL for this site */
  defaultRelay: string;
}

export function loadSettings(cfg: SettingsConfig): AskSettings {
  const defaults: AskSettings = { relay: cfg.defaultRelay, accessCode: "" };
  try {
    const raw = localStorage.getItem(cfg.lsKey);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<AskSettings>) };
  } catch { /* fresh */ }
  return defaults;
}

export function saveSettings(cfg: SettingsConfig, s: AskSettings): void {
  localStorage.setItem(cfg.lsKey, JSON.stringify(s));
}
