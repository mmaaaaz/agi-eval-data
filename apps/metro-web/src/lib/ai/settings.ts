/** /settings — questions relay + access code. localStorage only. */

export interface AskSettings {
  /** relay base URL (questions Worker) */
  relay: string;
  /** optional shared gate for the questions API */
  accessCode: string;
}

const LS_KEY = "metro.settings.v1";
export const DEFAULT_RELAY = "https://metro-eval-relay.devmaaaaz.workers.dev";

export function loadSettings(): AskSettings {
  const defaults: AskSettings = { relay: DEFAULT_RELAY, accessCode: "" };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<AskSettings>) };
  } catch { /* fresh */ }
  return defaults;
}

export function saveSettings(s: AskSettings): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}
