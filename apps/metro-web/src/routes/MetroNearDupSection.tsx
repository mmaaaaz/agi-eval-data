import { useCallback, useEffect, useState } from "react";
import { ThumbImage } from "@site/thumb";
import { fmtB, fmtN } from "../lib/format";

export interface NearDupMember {
  id: string;
  kept: boolean;
  cos: number;
  name: string;
  size: number;
  owner: string;
  branch: string;
  country: string;
  city: string;
}
export interface NearDupGroup {
  id: string;
  kept: string;
  peakCos: number;
  members: NearDupMember[];
}
export interface NearDupData {
  groups: NearDupGroup[];
  groupCount: number;
  droppedCount: number;
}

const BRANCH_LABEL: Record<string, string> = {
  ours: "ours",
  "reason_map(exisiting_dataset)": "existing",
  reason_map: "existing",
};

export default function MetroNearDupSection() {
  const [nd, setNd] = useState<NearDupData | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [verdict, setVerdict] = useState<Record<string, "keep" | "drop">>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/data/nearDup.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then(setNd)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setVerdictFor = (groupId: string, fileId: string, v: "keep" | "drop") =>
    setVerdict((prev) => ({ ...prev, [`${groupId}:${fileId}`]: v }));

  const exportCsv = useCallback(() => {
    if (!nd) return;
    const lines = ["group_id,file_id,verdict,similarity,filename,branch,country,city"];
    for (const g of nd.groups) {
      for (const m of g.members) {
        const v = verdict[`${g.id}:${m.id}`] ?? (m.kept ? "keep" : "drop");
        lines.push(
          `${g.id},${m.id},${v},${m.cos},"${m.name.replaceAll('"', '""')}",${m.branch},${m.country},${m.city}`,
        );
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "metro-near-dup-review.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [nd, verdict]);

  if (err) return null; // artifact absent = no findings yet, keep page as-is
  if (!nd || nd.groupCount === 0) {
    return (
      <section className="mt-6 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#666]">
          near-duplicates (CLIP)
        </p>
        <p className="mt-1.5 font-mono text-[10px] text-[#666]">
          no near-dup findings yet — run dedup/colab_clip_dedup_metro.ipynb, commit
          dedup/metro-near-dup.csv, rebake
        </p>
      </section>
    );
  }

  const dropped = Object.values(verdict).filter((v) => v === "drop").length;

  return (
    <section className="mt-8 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#666]">
          near-duplicates (CLIP cosine &gt; 0.95)
        </p>
        <span className="font-mono text-[11px] tabular-nums text-[#ededed]">
          {fmtN(nd.groupCount)} group{nd.groupCount === 1 ? "" : "s"} · {fmtN(nd.droppedCount)} flagged
        </span>
        <button
          onClick={exportCsv}
          className="ml-auto rounded-md border border-accent px-3 py-1.5 font-mono text-[10px] text-accent transition-colors hover:bg-accent/10"
        >
          export review CSV{dropped > 0 ? ` (${dropped} marked drop)` : ""}
        </button>
      </div>
      <p className="mt-1.5 font-mono text-[10px] leading-5 text-[#666]">
        same map re-uploaded at a different size/render — different bytes, same layout.
        mark keep/drop per image, export the CSV, hand it back for the Drive trash pass.
      </p>

      <div className="mt-4 space-y-1">
        {nd.groups.map((g, i) => (
          <div key={g.id} className={`rounded border border-[#262626]/60 ${open.has(g.id) ? "bg-black/40" : ""}`}>
            <button
              onClick={() => toggle(g.id)}
              className="grid w-full grid-cols-[32px_minmax(0,1fr)_90px_20px] items-center gap-x-3 px-3 py-2 text-left hover:bg-[#0f0f0f] sm:grid-cols-[40px_minmax(0,1fr)_110px_90px_20px]"
            >
              <span className="font-mono text-[10px] tabular-nums text-[#404040]">{String(i + 1).padStart(3, "0")}</span>
              <span className="min-w-0 truncate font-mono text-xs text-[#ededed]">
                {g.members.find((m) => m.kept)?.name ?? g.kept}
                <span className="ml-1.5 text-[10px] text-[#666]">×{g.members.length}</span>
              </span>
              <span className="hidden font-mono text-[10px] tabular-nums text-[#a1a1a1] sm:block">
                peak {g.peakCos.toFixed(3)}
              </span>
              <span className="text-right font-mono text-[10px] tabular-nums text-[#666]">
                {fmtB(g.members.filter((m) => !m.kept).reduce((s, m) => s + m.size, 0))}
              </span>
              <span className={`font-mono text-[10px] text-[#666] transition-transform ${open.has(g.id) ? "rotate-90" : ""}`}>▸</span>
            </button>
            {open.has(g.id) && (
              <div className="border-t border-[#262626]/40 px-3 pb-3 pt-2">
                <div className="flex flex-wrap gap-2">
                  {g.members.map((m) => {
                    const v = verdict[`${g.id}:${m.id}`] ?? (m.kept ? "keep" : "drop");
                    return (
                      <div
                        key={m.id}
                        className={`w-40 overflow-hidden rounded-md border transition-colors ${
                          v === "drop" ? "border-danger" : "border-[#262626]"
                        }`}
                      >
                        <ThumbImage fileId={m.id} alt={m.name} className="h-32 w-full" />
                        <div className="px-1.5 py-1">
                          <p className="truncate font-mono text-[9px] text-[#ededed]" title={m.name}>{m.name}</p>
                          <p className="truncate font-mono text-[8px] text-[#666]">
                            {BRANCH_LABEL[m.branch] ?? m.branch} · {m.country} · {m.city}
                          </p>
                          <p className="font-mono text-[8px] text-[#666]">
                            {m.kept ? "auto-kept" : `cos ${m.cos.toFixed(3)}`} · {fmtB(m.size)}
                          </p>
                          <div className="mt-1 flex gap-1">
                            <button
                              onClick={() => setVerdictFor(g.id, m.id, "keep")}
                              className={`flex-1 rounded px-1 py-0.5 font-mono text-[8px] transition-colors ${
                                v === "keep" ? "bg-accent/20 text-accent" : "text-[#666] hover:text-white"
                              }`}
                            >
                              keep
                            </button>
                            <button
                              onClick={() => setVerdictFor(g.id, m.id, "drop")}
                              className={`flex-1 rounded px-1 py-0.5 font-mono text-[8px] transition-colors ${
                                v === "drop" ? "bg-danger/20 text-danger" : "text-[#666] hover:text-white"
                              }`}
                            >
                              drop
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
