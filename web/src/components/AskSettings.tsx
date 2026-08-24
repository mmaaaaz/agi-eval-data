import type { AskSettings } from "../lib/ai/settings";

interface Props {
  settings: AskSettings;
  onChange: (patch: Partial<AskSettings>) => void;
  /** model id reported by the relay (/api/info); null while unknown */
  model?: string | null;
}
/** Pooled access settings — relay URL + optional shared access code. */
export function AskSettings({ settings, onChange, model }: Props) {
  return (
    <div className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-4">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[#a1a1a1]">Pooled access</p>
      <p className="mt-1 font-mono text-[10px] leading-5 text-[#666]">
        model: <span className="text-[#ededed]">{model ?? "pooled"}</span> · shared daily limit · nothing to configure. Keys live
        server-side as Worker secrets — never in the browser.
      </p>
      <label className="mt-3 block">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">relay url</span>
        <input
          value={settings.relay}
          onChange={(e) => onChange({ relay: e.target.value })}
          className="w-full max-w-md rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
          placeholder="https://agi-eval-relay.devmaaaaz.workers.dev"
        />
      </label>
      <label className="mt-3 block">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">access code (optional)</span>
        <input
          type="password"
          value={settings.accessCode}
          onChange={(e) => onChange({ accessCode: e.target.value })}
          className="w-full max-w-md rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
          placeholder="only if the relay sets ACCESS_CODE"
        />
      </label>
    </div>
  );
}
