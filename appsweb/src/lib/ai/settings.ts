/** /ask settings v4 — pooled AI Gateway via relay. localStorage only. */

export interface AskSettings {
  /** relay base URL (Worker fronting the Vercel AI Gateway) */
  relay: string;
  /** optional shared gate for the relay */
  accessCode: string;
}

const LS_KEY = "ask.settings.v4";
export const DEFAULT_RELAY = "https://agi-eval-relay.devmaaaaz.workers.dev";

export function loadSettings(): AskSettings {
  const defaults: AskSettings = {
    relay: DEFAULT_RELAY,
    accessCode: "",
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<AskSettings>) };
    // migrate v3 (relay + accessCode carried over)
    const v3raw = localStorage.getItem("ask.settings.v3");
    if (v3raw) {
      const v3 = JSON.parse(v3raw) as Partial<AskSettings>;
      return { ...defaults, ...(v3.relay ? { relay: v3.relay } : {}), ...(v3.accessCode ? { accessCode: v3.accessCode } : {}) };
    }
  } catch { /* fresh */ }
  return defaults;
}

export function saveSettings(s: AskSettings): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}
