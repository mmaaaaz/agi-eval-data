import { createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { fmtB, fmtN } from "../lib/format";
import { Eyebrow } from "@site/section";
import MetroNearDupSection from "./MetroNearDupSection";

export const Route = createFileRoute("/gallery/duplicates")({ component: Duplicates });

function Duplicates() {
  const { data } = useData();
  if (!data) return null;

  const groups = data.dupGroups ?? [];
  const wasted = groups.reduce((s, g) => s + (g.count - 1) * g.size, 0);

  return (
    <div>
      <Eyebrow n="03">duplicates</Eyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-white">Duplicate check</h1>
      <p className="mt-1 font-mono text-[11px] text-[#666]">
        {fmtN(groups.length)} md5 group{groups.length === 1 ? "" : "s"} ·{" "}
        {wasted > 0 ? `${fmtB(wasted)} recoverable` : "no duplicate bytes — the dataset is clean"}
      </p>

      {groups.length === 0 ? (
        <div className="mt-8 rounded-lg border border-[#0cce6b]/30 bg-[#0cce6b]/5 p-6 text-center">
          <p className="font-mono text-sm text-[#0cce6b]">✓ no byte-identical duplicates</p>
          <p className="mt-1 font-mono text-[10px] text-[#666]">
            every network map is unique — checked by md5 checksum on each sync
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {groups.map((g) => (
            <div key={g.md5} className="rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] text-[#ededed]">
                  {g.count} copies · {fmtB(g.size)} each
                </p>
                <span className="font-mono text-[10px] text-danger">{fmtB((g.count - 1) * g.size)} wasted</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {g.names.slice(0, 6).map((n, i) => (
                  <span key={i} className="rounded bg-[#141414] px-2 py-1 font-mono text-[9px] text-[#a1a1a1]">
                    {n}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-8 border-t border-[#262626]/60 pt-4 font-mono text-[10px] leading-5 text-[#666]">
        uniqueness = first occurrence per md5 checksum · byte-identical dedup only · to clean
        up, open the Drive folder and trash duplicate copies (recoverable for 30 days)
      </p>

      <MetroNearDupSection />
    </div>
  );
}
