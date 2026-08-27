import { createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { ownerStats, ownerName } from "../lib/data";
import { fmtB, fmtN } from "../lib/format";
import { ThumbImage } from "@site/thumb";
import { Eyebrow } from "@site/section";

export const Route = createFileRoute("/gallery/contributors")({ component: Contributors });

function Contributors() {
  const { data } = useData();
  if (!data) return null;
  const stats = ownerStats(data);

  return (
    <div>
      <Eyebrow n="03">contributors</Eyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-white">Contributors</h1>
      <p className="mt-1 font-mono text-[11px] text-[#666]">
        {stats.length} owner{stats.length === 1 ? "" : "s"} · the dataset lives in one shared Drive mailbox
      </p>

      <div className="mt-6 space-y-3">
        {stats.map((s) => {
        const pdfCount = data.files.filter((r) => r[5] === s.email && r[7] === "o").length;
        return (
          <div key={s.email} className="flex items-center gap-4 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-4">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-[#262626]">
              {s.lastId ? (
                <ThumbImage fileId={s.lastId} alt={s.email} className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center bg-[#141414] font-mono text-xs text-[#666]">
                  {ownerName(data, s.email).slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[#ededed]">{ownerName(data, s.email)}</p>
              <p className="truncate font-mono text-[10px] text-[#666]">{s.email}</p>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 text-right sm:grid-cols-4">
              <Stat label="maps" value={fmtN(s.unique)} />
              <Stat label="pdfs" value={fmtN(pdfCount)} />
              <Stat label="stored" value={fmtB(s.bytes)} />
              <Stat label="dupes" value={fmtN(s.dupes)} danger={s.dupes > 0} />
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <p className={`font-mono text-sm tabular-nums ${danger ? "text-danger" : "text-white"}`}>{value}</p>
      <p className="font-mono text-[9px] uppercase tracking-wider text-[#666]">{label}</p>
    </div>
  );
}
