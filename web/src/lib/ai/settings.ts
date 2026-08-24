/** /ask settings v3 — pooled gateway by default, BYOK optional. localStorage only. */

export interface AskSettings {
  /** relay base URL (the Worker/server that fronts the pooled gateway) */
  relay: string;
  /** optional shared gate for the relay */
  accessCode: string;
  /** power users: bring your own key (bypasses pooled quota) */
  byokEnabled: boolean;
  byokBase: string;
  byokKey: string;
  byokModel: string;
  byokProtocol: "openai" | "anthropic";
}

const LS_KEY = "ask.settings.v3";
/** change this constant when the relay gets a permanent home */
export const DEFAULT_RELAY = "https://agi-eval-relay.devmaaaaz.workers.dev";

export function loadSettings(): AskSettings {
  const defaults: AskSettings = {
    relay: DEFAULT_RELAY,
    accessCode: "",
    byokEnabled: false,
    byokBase: "https://openrouter.ai/api/v1",
    byokKey: "",
    byokModel: "",
    byokProtocol: "openai",
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<AskSettings>) };
  } catch { /* fresh */ }
  return defaults;
}

export function saveSettings(s: AskSettings): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}
