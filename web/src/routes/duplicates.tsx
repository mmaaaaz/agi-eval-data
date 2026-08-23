import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { ownerStats } from "../lib/data";
import { fmtB, fmtN } from "../lib/format";

export const Route = createFileRoute("/duplicates")({ component: Duplicates });

function Duplicates() {
  const { data } = useData();
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (!data) return null;
  const groups = [...data.dupGroups].sort((a, b) => (b.count - 1) * b.size - (a.count - 1) * a.size);
  const wasted = groups.reduce((s, g) => s + (g.count - 1) * g.size, 0);

  const toggle = (md5: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(md5) ? next.delete(md5) : next.add(md5);
      return next;
    });

  return (
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">
        <span className="text-accent">06</span> — duplicates
      </p>
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        Byte-identical copies{" "}
        <span className="ml-2 font-mono text-sm font-normal tabular-nums text-[#666]">
          {fmtN(groups.length)} groups · {fmtB(wasted)} recoverable
        </span>
      </h1>
      <p className="mt-2 max-w-2xl font-mono text-[11px] leading-5 text-[#666]">
        Grouped by md5 checksum — files that are byte-for-byte identical. Re-saved or re-compressed
        variants are intentionally not flagged.
      </p>

      {/* duplicate guilt chart */}
      {(() => {
        const guilt = ownerStats(data)
          .map((o) => ({ name: data.owners[o.email] ?? o.email, dupes: o.dupes }))
          .filter((g) => g.dupes > 0)
          .sort((a, b) => b.dupes - a.dupes);
        if (guilt.length === 0) return null;
        const max = Math.max(...guilt.map((g) => g.dupes), 1);
        const totalDupes = guilt.reduce((s, g) => s + g.dupes, 0);
        return (
          <section className="mt-8">
            <h2 className="mb-4 font-medium tracking-tight text-white">
              Duplicate contributions
              <span className="ml-2 font-mono text-xs font-normal tabular-nums text-[#666]">
                copies per contributor · {fmtN(totalDupes)} total
              </span>
            </h2>
            <div>
              {guilt.map((g) => (
                <div key={g.name} className="mb-2 grid grid-cols-[minmax(90px,180px)_1fr_64px] items-center gap-3">
                  <span className="truncate font-mono text-[11px] text-[#a1a1a1]" title={g.name}>{g.name}</span>
                  <span className="h-[10px] overflow-hidden rounded-full bg-[#161616]">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-[#7a2015] to-danger"
                      style={{ width: `${Math.max(2, (g.dupes / max) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right font-mono text-[11px] tabular-nums text-danger">{fmtN(g.dupes)}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      <div className="mt-6 overflow-hidden rounded-lg border border-[#262626]">
        <div className="grid grid-cols-[52px_70px_90px_1fr_24px] items-center gap-3 border-b border-[#262626] bg-[#0a0a0a] px-4 py-2.5 md:grid-cols-[52px_70px_110px_110px_1fr_24px]">
          {["copies", "size", "wasted", "files", ""].map((h, i) => (
            <span key={i} className={`font-mono text-[10px] uppercase tracking-wider text-[#666] ${i === 4 ? "hidden md:block" : ""}`}>
              {h}
            </span>
          ))}
        </div>

        {groups.map((g) => {
          const isOpen = open.has(g.md5);
          return (
            <div key={g.md5} className="border-b border-[#262626]/50 last:border-b-0">
              <button
                onClick={() => toggle(g.md5)}
                aria-expanded={isOpen}
                className="grid w-full grid-cols-[52px_70px_90px_1fr_24px] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#0a0a0a] md:grid-cols-[52px_70px_110px_110px_1fr_24px]"
              >
                <span className="font-mono text-xs tabular-nums text-danger">×{g.count}</span>
                <span className="font-mono text-xs tabular-nums text-[#a1a1a1]">{fmtB(g.size)}</span>
                <span className="hidden font-mono text-xs tabular-nums text-danger md:block">
                  {fmtB((g.count - 1) * g.size)}
                </span>
                <span className="truncate font-mono text-xs text-[#ededed]" title={g.names.join(" · ")}>
                  {g.names[0]}
                  {g.count > 2 && <span className="ml-2 text-[#666]">+{g.count - 1} more</span>}
                </span>
                <span className={`font-mono text-[10px] text-[#666] transition-transform ${isOpen ? "rotate-180" : ""}`}>
                  ▾
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-[#262626]/40 bg-[#050505] px-4 py-3">
                  {g.names.map((n) => (
                    <p key={n} className="break-all py-0.5 font-mono text-[11px] text-[#a1a1a1]">
                      {n}
                    </p>
                  ))}
                  <Link
                    to="/gallery"
                    search={{ md5: g.md5 }}
                    className="mt-2 inline-block rounded border border-accent/40 px-2.5 py-1 font-mono text-[10px] text-accent transition-colors hover:bg-accent hover:text-white"
                  >
                    view all {g.count} in gallery →
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {groups.length === 0 && (
        <p className="py-16 text-center font-mono text-xs text-[#666]">zero duplicates 🎉</p>
      )}
    </div>
  );
}
