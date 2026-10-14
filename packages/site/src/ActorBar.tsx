import { useState } from "react";
import { toast } from "sonner";
import { getActor, setActorName } from "./questions";

/**
 * "Writing as <name>", and the one-time prompt that sets it.
 *
 * The actor ID is issued and signed by the server; the name is the only thing the
 * contributor supplies, because it is a label for credit rather than a security
 * boundary. No email is ever asked for or sent: attribution to a real person
 * happens offline, by mapping the id to a name once.
 */
export function ActorBar({ compact = false }: { compact?: boolean }) {
  const [name, setName] = useState(() => getActor().name);
  const [editing, setEditing] = useState(() => getActor().name === "");
  const [draft, setDraft] = useState("");

  const save = () => {
    const clean = draft.trim().slice(0, 64);
    if (!clean) { toast.error("a display name is needed so your items can be credited"); return; }
    setActorName(clean);
    setName(clean);
    setEditing(false);
    setDraft("");
    toast.success("writing as " + clean);
  };

  if (editing) {
    return (
      <div className={compact ? "mb-3" : "mb-4"}>
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-accent">
            what should we credit you as?
          </span>
          <p className="mt-1 font-mono text-[10px] leading-4 text-[#a1a1a1]">
            A display name only. No account, no email, nothing that identifies you beyond
            what you type here.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
              placeholder="your name"
              className="w-full rounded-md border border-[#262626] bg-[#050505] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
            />
            <button
              onClick={save}
              disabled={!draft.trim()}
              className="shrink-0 rounded-md bg-white px-3 py-1.5 font-mono text-[10px] font-semibold text-black disabled:opacity-30"
            >
              use it
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? "mb-2 flex items-center gap-2" : "mb-3 flex items-center gap-2"}>
      <span className="font-mono text-[10px] text-[#666]">
        writing as <span className="text-[#ededed]">{name}</span>
      </span>
      <button
        onClick={() => { setDraft(name); setEditing(true); }}
        className="font-mono text-[10px] text-[#666] underline decoration-dotted transition-colors hover:text-accent"
      >
        change
      </button>
    </div>
  );
}
