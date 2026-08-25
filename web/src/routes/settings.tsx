import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { loadSettings, saveSettings, type AskSettings as AskSettingsData } from "../lib/ai/settings";
import { questionsApi } from "../lib/questions";
import { Eyebrow } from "../components/Section";

export const Route = createFileRoute("/settings")({ component: Settings });

const OR_KEY_STORAGE = "evaluate.openrouterKey";

function Settings() {
  const [settings, setSettings] = useState<AskSettingsData>(loadSettings);
  const [orKey, setOrKey] = useState(() => localStorage.getItem(OR_KEY_STORAGE) ?? "");
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { localStorage.setItem(OR_KEY_STORAGE, orKey); }, [orKey]);



  const exportUrl = questionsApi.exportUrl(settings.relay.replace(/\/+$/, ""), settings.accessCode);

  return (
    <div className="max-w-2xl">
      <Eyebrow n="06">settings</Eyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-white">Settings</h1>
      <p className="mt-2 font-mono text-[11px] leading-5 text-[#666]">
        stored only in this browser (localStorage) — nothing account-level, nothing server-side
      </p>
      <section className="mt-8 space-y-5 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-5">
        <div>
          <h2 className="font-medium tracking-tight text-white">Relay</h2>
          <p className="mt-1 font-mono text-[10px] leading-4 text-[#666]">
            Worker fronting the AI gateway (chat) and the questions API. Default works out of the box.
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">relay url</span>
          <input
            value={settings.relay}
            onChange={(e) => { setSettings((s) => ({ ...s, relay: e.target.value })); toast.success("saved"); }}
            className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">access code</span>
          <input
            type="password"
            value={settings.accessCode}
            onChange={(e) => { setSettings((s) => ({ ...s, accessCode: e.target.value })); toast.success("saved"); }}
            placeholder="the shared code for /contribute + /evaluate"
            className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
          />
        </label>
      </section>

      <section className="mt-6 space-y-5 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-5">
        <div>
          <h2 className="font-medium tracking-tight text-white">OpenRouter</h2>
          <p className="mt-1 font-mono text-[10px] leading-4 text-[#666]">
            used by /contribute → evaluate to run questions against models directly from your browser. get a key at
            {" "}<a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">openrouter.ai/settings/keys ↗</a>
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-[#666]">api key</span>
          <input
            type="password"
            value={orKey}
            onChange={(e) => { setOrKey(e.target.value); toast.success("saved"); }}
            placeholder="sk-or-v1-…"
            className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
          />
        </label>
      </section>

      <section className="mt-6 space-y-3 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-5">
        <div>
          <h2 className="font-medium tracking-tight text-white">Dataset export</h2>
          <p className="mt-1 font-mono text-[10px] leading-4 text-[#666]">
            all approved, answered questions as VQA-style JSONL — this is what lands in the repo as data/questions.jsonl
          </p>
        </div>
        <a
          href={exportUrl}
          className="inline-block rounded-lg border border-accent/60 px-4 py-2 font-mono text-xs text-accent transition-colors hover:bg-accent hover:text-white"
        >
          download questions.jsonl
        </a>
      </section>
    </div>
  );
}
