/** Multi-provider BYOK settings — persisted to localStorage, migrated from v1. */
import { presetById, type ModelInfo } from "./providers";

export interface Account {
  id: string;
  providerId: string; // preset id
  base: string;
  key: string;
  models: ModelInfo[]; // fetched model list (persisted so it survives reloads)
  modelsState: "idle" | "loading" | "ok" | "error";
  modelsError?: string;
}

export interface AskSettings {
  accounts: Account[];
  activeAccountId: string | null;
  activeModel: string | null; // model id within the active account
}

const LS_KEY = "ask.settings.v2";
const LS_KEY_V1 = "ask.settings.v1";

export function loadSettings(): AskSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as AskSettings;
      if (s && Array.isArray(s.accounts)) return s;
    }
  } catch { /* fall through to migration */ }

  // migrate v1 (single provider) if present
  try {
    const v1raw = localStorage.getItem(LS_KEY_V1);
    if (v1raw) {
      const v1 = JSON.parse(v1raw) as { providerId: string; base: string; key: string; model: string };
      if (v1 && v1.providerId) {
        const account: Account = {
          id: "a1",
          providerId: v1.providerId,
          base: v1.base,
          key: v1.key ?? "",
          models: [],
          modelsState: "idle",
        };
        return {
          accounts: [account],
          activeAccountId: account.id,
          activeModel: v1.model || null,
        };
      }
    }
  } catch { /* fresh */ }

  return { accounts: [], activeAccountId: null, activeModel: null };
}

export function saveSettings(s: AskSettings): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

export function accountLabel(a: Account): string {
  try {
    return presetById(a.providerId).name;
  } catch {
    return a.providerId;
  }
}

export function activeAccount(s: AskSettings): Account | null {
  return s.accounts.find((a) => a.id === s.activeAccountId) ?? null;
}
