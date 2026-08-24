import type { AskSettings } from "../lib/ai/settings";

interface Props {
  settings: AskSettings;
  onChange: (patch: Partial<AskSettings>) => void;
}

/** Optional BYOK panel — power users can bypass the pooled quota with their own key. */
export function AskSettings({ settings, onChange }: Props) {
  return (
    <div className="mb-3 space-y-3 rounded-lg border border-[#262626] bg-[#0a0a0a] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-[#a1a1a1]">Bring your own key</p>
          <p className="mt-0.5 font-mono text-[10px] text-[#666]">
            optional · bypasses the shared daily limit · key never leaves this browser
          </p>
        </div>
        <button
          onClick={() => onChange({ byokEnabled: !settings.byokEnabled })}
          className={`rounded-md border px-3 py-1.5 font-mono text-[11px] transition-colors ${
            settings.byokEnabled
              ? "border-white bg-white text-black"
              : "border-[#262626] text-[#a1a1a1] hover:border-[#404040]"
          }`}
        >
          {settings.byokEnabled ? "on" : "off"}
        </button>
      </div>

      {settings.byokEnabled && (
        <div className="grid gap-3 border-t border-[#262626]/60 pt-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">base url</span>
            <input
              value={settings.byokBase}
              onChange={(e) => onChange({ byokBase: e.target.value })}
              className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
              placeholder="https://openrouter.ai/api/v1"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">api key</span>
            <input
              type="password"
              value={settings.byokKey}
              onChange={(e) => onChange({ byokKey: e.target.value })}
              className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
              placeholder="sk-…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">model</span>
            <input
              value={settings.byokModel}
              onChange={(e) => onChange({ byokModel: e.target.value })}
              className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
              placeholder="provider/model-id"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">protocol</span>
            <select
              value={settings.byokProtocol}
              onChange={(e) => onChange({ byokProtocol: e.target.value as AskSettings["byokProtocol"] })}
              className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
            >
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
