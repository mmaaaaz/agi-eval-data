import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Eyebrow } from "@site/section";
import { loadSettings, saveSettings, workerConfigured } from "../lib/gripSync";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
  const [s, setS] = useState(loadSettings);

  const save = () => {
    saveSettings(s);
    toast.success(workerConfigured() ? "settings saved" : "saved (worker URL empty — local-only mode)");
  };

  return (
    <div className="max-w-xl">
      <Eyebrow n="07">settings — stored in this browser only</Eyebrow>

      <label className="mt-4 block font-mono text-[10px] uppercase tracking-wider text-[#666]">
        grip-sync worker URL
      </label>
      <input
        value={s.relay}
        onChange={(e) => setS({ ...s, relay: e.target.value })}
        placeholder="https://grip-sync.<account>.workers.dev"
        spellCheck={false}
        className="mt-1 w-full rounded border border-[#262626] bg-black px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-[#8b5cf6]"
      />
      <p className="mt-1 font-mono text-[9px] text-[#555]">
        empty = local-only mode (edits stay in this browser's override mirror).
      </p>

      <label className="mt-4 block font-mono text-[10px] uppercase tracking-wider text-[#666]">
        access code
      </label>
      <input
        value={s.accessCode}
        onChange={(e) => setS({ ...s, accessCode: e.target.value })}
        type="password"
        placeholder="GRIP_ACCESS_CODE"
        className="mt-1 w-full rounded border border-[#262626] bg-black px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-[#8b5cf6]"
      />
      <p className="mt-1 font-mono text-[9px] text-[#555]">
        sent as x-questions-code to mutating endpoints only. never leaves this browser except to the worker.
      </p>

      <button
        onClick={save}
        className="mt-5 rounded bg-[#8b5cf6] px-4 py-2 font-mono text-xs font-medium text-black"
      >
        save
      </button>
    </div>
  );
}
