import { Link, createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { ownerStats } from "../lib/data";
import { fmtB, fmtN } from "../lib/format";
import { ThumbImage } from "@site/thumb";

export const Route = createFileRoute("/gallery/contributors/")({ component: Contributors });

function Contributors() {
  const { data } = useData();
  if (!data) return null;
  const stats = ownerStats(data);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-white">Who uploads what</h1>

      <div className="overflow-hidden rounded-lg border border-[#262626]">
        {/* desktop header */}
        <div className="hidden grid-cols-[40px_minmax(0,1fr)_repeat(5,minmax(0,90px))_110px] gap-4 border-b border-[#262626] bg-[#0a0a0a] px-4 py-2.5 md:grid">
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
              to="/gallery/contributors/$email"
              params={{ email: o.email }}
              className="block border-b border-[#262626]/50 px-4 py-3 transition-colors last:border-b-0 hover:bg-[#0a0a0a] md:grid md:grid-cols-[40px_minmax(0,1fr)_repeat(5,minmax(0,90px))_110px] md:items-center md:gap-4"
            >
              <span className="hidden font-mono text-xs tabular-nums text-[#666] md:block">
                {String(i + 1).padStart(2, "0")}
              </span>

              <span className="flex items-center gap-3">
                <ThumbImage
                  fileId={o.lastId || ""}
                  alt={name}
                  eager
                  className="h-10 w-10 shrink-0 rounded-full border border-[#262626]"
                />
                <span className="min-w-0 flex-1 md:flex-none">
                  <span className="flex items-center justify-between gap-3 md:block">
                    <span className="truncate text-sm text-white">{name}</span>
                    <span className="font-mono text-[9px] tabular-nums text-[#666] md:hidden">
                      #{String(i + 1).padStart(2, "0")}
                    </span>
                  </span>
                  <span className="block truncate font-mono text-[10px] text-[#666]">{o.email}</span>
                </span>
              </span>

              {/* metrics: spread row on mobile, table cells on desktop */}
              <span className="mt-3 grid grid-cols-4 gap-2 md:contents">
                <Cell label="pics" v={fmtN(o.raw)} />
                <Cell label="unique" v={fmtN(o.unique)} />
                <Cell label="dupes" v={fmtN(o.dupes)} danger={o.dupes > 0} />
                <Cell label="videos" v={fmtN(o.videos)} />
                <Cell label="size" v={fmtB(o.bytes)} className="hidden md:block" />
                <Cell label="last" v={o.lastDay || "—"} muted className="hidden md:block" />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Cell({
  label,
  v,
  danger,
  muted,
  className = "",
}: {
  label: string;
  v: string;
  danger?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <span className={`text-right ${className}`}>
      <span className="block text-[9px] uppercase tracking-wider text-[#666] md:hidden">{label}</span>
      <span
        className={`block font-mono text-xs tabular-nums ${
          danger ? "text-danger" : muted ? "text-[#666]" : "text-[#ededed]"
        }`}
      >
        {v}
      </span>
    </span>
  );
}
