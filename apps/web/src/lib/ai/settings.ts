/**
 * /ask + /contribute settings v4 — pooled AI Gateway via relay. localStorage only.
 * Re-exported from @site with the web-specific key + default relay.
 */
import { loadSettings as _load, saveSettings as _save } from "@site/settings";
import type { AskSettings } from "@site/settings";

export type { AskSettings };

const LS_KEY = "ask.settings.v4";
export const DEFAULT_RELAY = "https://agi-eval-relay.devmaaaaz.workers.dev";

export function loadSettings(): AskSettings {
  return _load({ lsKey: LS_KEY, defaultRelay: DEFAULT_RELAY, migrateFrom: "ask.settings.v3" });
}

export function saveSettings(s: AskSettings): void {
  _save({ lsKey: LS_KEY, defaultRelay: DEFAULT_RELAY, migrateFrom: "ask.settings.v3" }, s);
}
