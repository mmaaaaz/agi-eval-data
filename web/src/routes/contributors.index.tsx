import { Link, createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { ownerStats } from "../lib/data";
import { fmtB, fmtN } from "../lib/format";

export const Route = createFileRoute("/contributors/")({ component: Contributors });

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Contributors() {
  const { data } = useData();
  if (!data) return null;
  const stats = ownerStats(data);

  return (
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">
        <span className="text-accent">03</span> — contributors
      </p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-white">
        Who uploads what
      </h1>

      <div className="overflow-hidden rounded-lg border border-[#262626]">
        <div className="grid grid-cols-[40px_1fr] gap-4 border-b border-[#262626] bg-[#0a0a0a] px-4 py-2.5 md:grid-cols-[40px_1fr_repeat(5,minmax(0,90px))_110px]">
          {["#", "contributor", "pictures", "unique", "dupes", "videos", "size", "last upload"].map((h) => (
            <span key={h} className="font-mono text-[10px] uppercase tracking-wider text-[#666]">
              {h}
            </span>
          ))}
        </div>
        {stats.map((o, i) => {
          const name = data.owners[o.email] ?? o.email;
          return (
            <Link
              key={o.email}
              to="/contributors/$email"
              params={{ email: encodeURIComponent(o.email) }}
              className="grid grid-cols-[40px_1fr] items-center gap-4 border-b border-[#262626]/50 px-4 py-3 transition-colors last:border-b-0 hover:bg-[#0a0a0a] md:grid-cols-[40px_1fr_repeat(5,minmax(0,90px))_110px]"
            >
              <span className="font-mono text-xs tabular-nums text-[#666]">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#262626] font-mono text-[10px] text-accent">
                  {initials(name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white">{name}</span>
                  <span className="block truncate font-mono text-[10px] text-[#666]">{o.email}</span>
                </span>
              </span>
              <Cell v={fmtN(o.raw)} />
              <Cell v={fmtN(o.unique)} />
              <Cell v={fmtN(o.dupes)} danger={o.dupes > 0} />
              <Cell v={fmtN(o.videos)} />
              <Cell v={fmtB(o.bytes)} />
              <Cell v={o.lastDay || "—"} muted />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Cell({ v, danger, muted }: { v: string; danger?: boolean; muted?: boolean }) {
  return (
    <span
      className={`hidden text-right font-mono text-xs tabular-nums md:block ${
        danger ? "text-danger" : muted ? "text-[#666]" : "text-[#ededed]"
      }`}
    >
      {v}
    </span>
  );
}
