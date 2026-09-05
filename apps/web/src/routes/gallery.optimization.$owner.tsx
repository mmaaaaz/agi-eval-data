import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ThumbImage } from "@site/thumb";
import { fmtB, fmtN } from "../lib/format";

export const Route = createFileRoute("/gallery/optimization/$owner")({
  component: OwnerCleanup,
});

interface CleanupItem {
  id: string;
  name: string;
  size: number;
  md5: string;
  kept_id: string;
}

interface CleanupKit {
  owner: string;
  copies: number;
  gib: number;
  note: string;
  items: CleanupItem[];
}

function slugEmail(email: string): string {
  return email.replace("@", "-at-").replace(/\./g, "-");
}

function OwnerCleanup() {
  const { owner } = Route.useParams();
  const [kit, setKit] = useState<CleanupKit | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    const email = decodeURIComponent(owner);
    fetch(`/data/cleanup/${slugEmail(email)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setKit)
      .catch((e) => setErr(String(e)));
  }, [owner]);

  const items = useMemo(() => {
    if (!kit) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return kit.items;
    return kit.items.filter(
      (i) => i.name.toLowerCase().includes(needle) || i.id.toLowerCase().includes(needle),
    );
  }, [kit, q]);

  const reclaimedByDone = useMemo(
    () => kit?.items.filter((i) => done.has(i.id)).reduce((a, i) => a + i.size, 0) ?? 0,
    [kit, done],
  );

  if (err) {
    return (
      <div className="rounded-md border border-[#7f1d1d] bg-[#1a0f0f] p-4 font-mono text-xs text-[#f87171]">
        cleanup kit unavailable ({err})
      </div>
    );
  }
  if (!kit) {
    return <div className="font-mono text-xs text-[#737373]">loading kit…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#737373]">
            duplicate cleanup worklist
          </div>
          <h2 className="text-lg text-white">{kit.owner}</h2>
        </div>
        <div className="font-mono text-xs text-[#a3a3a3]">
          {fmtN(kit.copies)} copies · {kit.gib.toFixed(2)} GiB reclaimable
        </div>
      </div>

      <div className="rounded-md border border-[#262626] bg-[#0f0f0f] p-3 text-xs text-[#a3a3a3]">
        {kit.note}{" "}
        Deletion happens <b className="text-white">in your Drive</b> — this page never deletes.
        Open a file → <b className="text-white">Move to trash</b> (recoverable 30 days). The
        keep-twin button shows the surviving copy so you can confirm before deleting. Tick
        "done" to track progress locally.
        {done.size > 0 && (
          <span className="ml-1 font-mono text-[#8f8]">
            [{fmtN(done.size)} marked · {fmtB(reclaimedByDone)} reclaimed]
          </span>
        )}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="filter by name or id…"
        className="w-full rounded-md border border-[#262626] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-[#525252] focus:border-[#404040]"
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <div
            key={i.id}
            className={`flex gap-2 rounded-md border p-2 transition-colors ${
              done.has(i.id) ? "border-[#14532d] bg-[#0a140a] opacity-60" : "border-[#262626] bg-[#0f0f0f]"
            }`}
          >
            <ThumbImage fileId={i.id} w={400} alt={i.name} className="h-16 w-20 shrink-0 rounded object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-[#e5e5e5]" title={i.name}>{i.name}</div>
              <div className="font-mono text-[10px] text-[#737373]">{fmtB(i.size)}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <a href={`https://drive.google.com/file/d/${i.id}/view`} target="_blank" rel="noreferrer"
                   className="rounded border border-[#404040] px-1.5 py-0.5 font-mono text-[10px] text-[#7ab7ff] hover:border-[#7ab7ff]">
                  open ↗
                </a>
                <a href={`https://drive.google.com/file/d/${i.kept_id}/view`} target="_blank" rel="noreferrer"
                   className="rounded border border-[#262626] px-1.5 py-0.5 font-mono text-[10px] text-[#a1a1a1] hover:border-[#404040]">
                  keep-twin ↗
                </a>
                <button
                  onClick={() =>
                    setDone((s) => {
                      const n = new Set(s);
                      if (n.has(i.id)) n.delete(i.id); else n.add(i.id);
                      return n;
                    })
                  }
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                    done.has(i.id)
                      ? "border-[#14532d] text-[#4ade80]"
                      : "border-[#262626] text-[#737373] hover:border-[#404040]"
                  }`}
                >
                  {done.has(i.id) ? "✓ done" : "mark done"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && (
        <div className="font-mono text-xs text-[#737373]">nothing matches "{q}"</div>
      )}

      <Link
        to="/gallery/optimization"
        className="inline-block font-mono text-[10px] text-[#737373] hover:text-white"
      >
        ← back to optimization
      </Link>
    </div>
  );
}
