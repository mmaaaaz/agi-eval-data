import { PRESETS, presetById, type ModelInfo } from "../lib/ai/providers";
import type { Account } from "../lib/ai/settings";
import { fmtN } from "../lib/format";

interface Props {
  accounts: Account[];
  onUpdate: (id: string, patch: Partial<Account>) => void;
  onRemove: (id: string) => void;
  onAdd: (providerId: string) => void;
  onFetchModels: (id: string) => void;
}

/** Multi-provider BYOK accounts panel: add, edit keys, fetch models, remove. */
export function AskSettings({ accounts, onUpdate, onRemove, onAdd, onFetchModels }: Props) {
  return (
    <div className="mb-3 space-y-3 rounded-lg border border-[#262626] bg-[#0a0a0a] p-4">
      {accounts.length === 0 && (
        <p className="font-mono text-[11px] text-[#666]">
          no providers yet — add one below, paste your key, fetch models.
        </p>
      )}

      {accounts.map((a) => {
        const preset = presetById(a.providerId);
        return (
          <div key={a.id} className="rounded-lg border border-[#262626] p-3.5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-[#a1a1a1]">
                {preset.name}
                {a.modelsState === "ok" && (
                  <span className="ml-2 normal-case tracking-normal text-[#0cce6b]">{a.models.length} models</span>
                )}
                {a.modelsState === "loading" && (
                  <span className="ml-2 normal-case tracking-normal text-[#666]">fetching…</span>
                )}
                {a.modelsState === "error" && (
                  <span className="ml-2 normal-case tracking-normal text-danger" title={a.modelsError}>
                    fetch failed
                  </span>
                )}
              </span>
              <button
                onClick={() => onRemove(a.id)}
                aria-label={`Remove ${preset.name}`}
                className="rounded border border-[#262626] px-2 py-0.5 font-mono text-[10px] text-[#666] transition-colors hover:border-danger/50 hover:text-danger"
              >
                remove
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">base url</span>
                <input
                  value={a.base}
                  onChange={(e) => onUpdate(a.id, { base: e.target.value })}
                  className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
                  placeholder="https://…/v1"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">
                  api key <span className="normal-case text-[#404040]">· this browser only</span>
                </span>
                <input
                  type="password"
                  value={a.key}
                  onChange={(e) => onUpdate(a.id, { key: e.target.value })}
                  className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
                  placeholder={preset.protocol === "anthropic" ? "sk-ant-…" : "sk-… / optional for openrouter list"}
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={() => onFetchModels(a.id)}
                disabled={a.modelsState === "loading" || !a.base}
                className="rounded-md border border-[#262626] px-3 py-1.5 font-mono text-[11px] text-[#ededed] transition-colors enabled:hover:border-[#404040] disabled:opacity-40"
              >
                {a.modelsState === "loading" ? "fetching…" : `fetch models${a.models.length ? ` (${a.models.length})` : ""}`}
              </button>
              {preset.note && <span className="font-mono text-[10px] text-[#666]">{preset.note}</span>}
              {a.modelsState === "error" && (
                <span className="font-mono text-[10px] text-danger" title={a.modelsError}>
                  {a.modelsError?.slice(0, 80)}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* add provider */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[#262626]/60 pt-3">
        <AddProvider onAdd={onAdd} existing={accounts.map((a) => a.providerId)} />
        <span className="font-mono text-[10px] text-[#666]">
          {fmtN(accounts.length)} provider{accounts.length === 1 ? "" : "s"} configured · keys stay in this browser
        </span>
      </div>
    </div>
  );
}

function AddProvider({
  onAdd,
  existing,
}: {
  onAdd: (providerId: string) => void;
  existing: string[];
}) {
  const unused = PRESETS.filter((p) => !existing.includes(p.id));
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const sel = (e.currentTarget.elements.namedItem("preset") as HTMLSelectElement).value;
        onAdd(sel);
      }}
    >
      <select
        name="preset"
        className="rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
        defaultValue={unused[0]?.id ?? "custom"}
      >
        {(unused.length ? unused : PRESETS).map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-md border border-accent/50 px-3 py-1.5 font-mono text-[11px] text-accent transition-colors hover:bg-accent hover:text-white"
      >
        + add provider
      </button>
    </form>
  );
}

export function modelOptionLabel(m: ModelInfo): string {
  return m.pricing != null ? `${m.id} · $${m.pricing.toFixed(2)}/M` : m.id;
}
