/** Provider presets + model discovery. All BYOK — keys never leave the browser except to the provider. */

export type Protocol = "openai" | "anthropic";

export interface ProviderPreset {
  id: string;
  name: string;
  base: string;
  protocol: Protocol;
  /** hint shown in the settings UI */
  note?: string;
}

export const PRESETS: ProviderPreset[] = [
  { id: "openrouter", name: "OpenRouter", base: "https://openrouter.ai/api/v1", protocol: "openai", note: "one key → every model; pricing shown per model" },
  { id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", protocol: "openai" },
  { id: "gemini", name: "Google Gemini (OpenAI-compat)", base: "https://generativelanguage.googleapis.com/v1beta/openai", protocol: "openai" },
  { id: "groq", name: "Groq", base: "https://api.groq.com/openai/v1", protocol: "openai" },
  { id: "mistral", name: "Mistral", base: "https://api.mistral.ai/v1", protocol: "openai" },
  { id: "ollama", name: "Ollama (local)", base: "http://localhost:11434/v1", protocol: "openai", note: "run with OLLAMA_ORIGINS=\"*\" for browser access" },
  { id: "anthropic", name: "Anthropic", base: "https://api.anthropic.com/v1", protocol: "anthropic" },
  { id: "custom", name: "Custom (OpenAI-compatible)", base: "", protocol: "openai", note: "any /v1 endpoint" },
];

export function presetById(id: string): ProviderPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
}

export interface ModelInfo {
  id: string;
  name?: string;
  /** $ / 1M combined tokens, when the provider exposes it (OpenRouter) */
  pricing?: number;
}

/**
 * Auto-fetch every model the key can access.
 * - OpenAI-compatible: GET {base}/models
 * - Anthropic: GET {base}/models with x-api-key + version header
 */
export async function fetchModels(base: string, key: string, protocol: Protocol): Promise<ModelInfo[]> {
  const baseClean = base.replace(/\/+$/, "");
  let j: {
    data?: { id: string; display_name?: string; name?: string; pricing?: { prompt?: string; completion?: string } }[];
  };

  if (protocol === "anthropic") {
    const res = await fetch(`${baseClean}/models`, {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    j = await res.json();
  } else {
    const res = await fetch(`${baseClean}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    j = await res.json();
  }

  const models = j.data ?? [];
  return models
    .map((m) => {
      const p = (m as { pricing?: { prompt?: string; completion?: string } }).pricing;
      const pricing = p?.prompt != null && p?.completion != null
        ? (Number(p.prompt) + Number(p.completion)) * 1e6
        : undefined;
      return { id: m.id, name: (m as { display_name?: string }).display_name ?? m.name ?? m.id, pricing };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
