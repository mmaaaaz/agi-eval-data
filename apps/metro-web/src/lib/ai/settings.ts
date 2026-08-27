/**
 * /settings — questions relay + access code. localStorage only.
 * Re-exported from @site with the metro-specific key + default relay.
 */
import { loadSettings as _load, saveSettings as _save } from "@site/settings";
import type { AskSettings } from "@site/settings";

export type { AskSettings };

const LS_KEY = "metro.settings.v1";
export const DEFAULT_RELAY = "https://metro-eval-relay.devmaaaaz.workers.dev";

export function loadSettings(): AskSettings {
  return _load({ lsKey: LS_KEY, defaultRelay: DEFAULT_RELAY });
}

export function saveSettings(s: AskSettings): void {
  _save({ lsKey: LS_KEY, defaultRelay: DEFAULT_RELAY }, s);
}
