import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { loadSettings, saveSettings, type AskSettings as AskSettingsData } from "../lib/ai/settings";
import { questionsApi } from "../lib/questions";
import { Eyebrow } from "@site/section";

export const Route = createFileRoute("/settings")({ component: Settings });

const OR_KEY_STORAGE = "evaluate.openrouterKey";

function Settings() {
  const [settings, setSettings] = useState<AskSettingsData>(loadSettings);
  const [orKey, setOrKey] = useState(() => localStorage.getItem(OR_KEY_STORAGE) ?? "");
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { localStorage.setItem(OR_KEY_STORAGE, orKey); }, [orKey]);

  const downloadExport = async () => {
    const res = await fetch(questionsApi.exportUrl(settings.relay.replace(/\/+$/, "")), {
      headers: { "x-questions-code": settings.accessCode },
    });
    if (!res.ok) { toast.error(`export failed: HTTP ${res.status}`); return; }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "metro-questions.jsonl";
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("metro-questions.jsonl downloaded");
  };

  return (
    <div className="max-w-2xl">
      <Eyebrow n="06">settings</Eyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-white">Settings</h1>
      <p className="mt-2 font-mono text-[11px] leading-5 text-[#666]">
        stored only in this browser (localStorage) — nothing account-level, nothing server-side
      </p>

      <section className="mt-8 space-y-5 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">questions relay</h2>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">relay url</span>
          <input
            value={settings.relay}
            onChange={(e) => setSettings({ ...settings, relay: e.target.value })}
            placeholder="https://metro-eval-relay.devmaaaaz.workers.dev"
            className="w-full rounded-md border border-[#262626] bg-[#050505] px-3 py-2 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">access code (optional)</span>
          <input
            value={settings.accessCode}
            onChange={(e) => setSettings({ ...settings, accessCode: e.target.value })}
            placeholder="leave empty if unset"
            className="w-full rounded-md border border-[#262626] bg-[#050505] px-3 py-2 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
          />
        </label>
      </section>

      <section className="mt-6 space-y-5 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">model evaluation</h2>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            openrouter key (browser-direct, never sent to the relay)
          </span>
          <input
            value={orKey}
            onChange={(e) => setOrKey(e.target.value)}
            placeholder="sk-or-…"
            type="password"
            className="w-full rounded-md border border-[#262626] bg-[#050505] px-3 py-2 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
          />
        </label>
      </section>

      <section className="mt-6 space-y-3 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">export</h2>
        <button
          onClick={downloadExport}
          className="rounded-lg border border-[#262626] px-4 py-2 font-mono text-xs text-[#ededed] transition-colors hover:border-[#404040]"
        >
          download questions.jsonl
        </button>
        <p className="font-mono text-[10px] text-muted-foreground">
          VQA-superset export of all approved questions from the metro D1.
        </p>
      </section>
    </div>
  );
}
