import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useData } from "../lib/dataContext";
import { dupCounts } from "../lib/data";
import { fmtN } from "../lib/format";
import { VirtualGallery } from "../components/VirtualGallery";
import { Lightbox } from "../components/Lightbox";

const searchSchema = z.object({
  q: z.string().catch(""),
  who: z.string().catch("*"),
  ext: z.string().catch(""), // comma-separated allow-list
  dedupe: z.boolean().catch(false),
  md5: z.string().catch(""),
  sort: z.enum(["recent", "old", "size", "name"]).catch("recent"),
});

export const Route = createFileRoute("/gallery")({
  validateSearch: searchSchema,
  component: Gallery,
});

function Gallery() {
  const { data } = useData();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [open, setOpen] = useState<number | null>(null);

  const patch = (p: Partial<typeof search>) =>
    navigate({ to: "/gallery", search: { ...search, ...p } });

  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.files.filter((f) => f[7] === "i");
    if (search.who !== "*") r = r.filter((f) => f[5] === search.who);
    if (search.q) r = r.filter((f) => f[1].toLowerCase().includes(search.q.toLowerCase()));
    if (search.md5) r = r.filter((f) => f[6] === search.md5);
    if (search.ext) {
      const set = new Set(search.ext.split(",").filter(Boolean));
      r = r.filter((f) => set.has(f[2]));
    }
    const cmp =
      search.sort === "recent"
        ? (a: typeof r[0], b: typeof r[0]) => b[4].localeCompare(a[4]) || a[1].localeCompare(b[1])
        : search.sort === "old"
          ? (a: typeof r[0], b: typeof r[0]) => a[4].localeCompare(b[4]) || a[1].localeCompare(b[1])
          : search.sort === "size"
            ? (a: typeof r[0], b: typeof r[0]) => b[3] - a[3]
            : (a: typeof r[0], b: typeof r[0]) => a[1].localeCompare(b[1]);
    r = [...r].sort(cmp);
    if (search.dedupe) {
      const seen = new Set<string>();
      r = r.filter((f) => {
        if (!f[6]) return true;
        if (seen.has(f[6])) return false;
        seen.add(f[6]);
        return true;
      });
    }
    return r;
  }, [data, search]);

  // keep lightbox index valid when filters change
  useEffect(() => setOpen(null), [rows]);

  const dups = useMemo(() => (data ? new Set(dupCounts(data.files.filter((f) => f[7] === "i")).keys()) : new Set<string>()), [data]);

  const extOptions = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, number>();
    for (const f of data.files) if (f[7] === "i") m.set(f[2], (m.get(f[2]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [data]);

  const extSet = new Set(search.ext.split(",").filter(Boolean));
  if (!data) return null;
  const owners = Object.entries(data.owners)
    .map(([email, name]) => ({ email, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex h-[calc(100dvh-10rem)] flex-col">
      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#262626]/60 pb-4">
        <input
          value={search.q}
          onChange={(e) => patch({ q: e.target.value })}
          placeholder="search filename…"
          className="w-52 rounded-md border border-[#262626] bg-[#0a0a0a] px-3 py-1.5 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-[#666] focus:border-accent"
        />
        <select
          value={search.who}
          onChange={(e) => patch({ who: e.target.value })}
          className="max-w-56 rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
        >
          <option value="*">everyone</option>
          {owners.map((o) => (
            <option key={o.email} value={o.email}>
              {o.name}
            </option>
          ))}
        </select>

        <div className="flex max-w-full items-center gap-1 overflow-x-auto">
          {extOptions.map(([e, n]) => (
            <button
              key={e}
              onClick={() => {
                const next = new Set(extSet);
                next.has(e) ? next.delete(e) : next.add(e);
                patch({ ext: [...next].join(",") });
              }}
              className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors ${
                extSet.has(e)
                  ? "border-white bg-white text-black"
                  : "border-[#262626] text-[#a1a1a1] hover:border-[#404040]"
              }`}
            >
              .{e} · {fmtN(n)}
            </button>
          ))}
        </div>

        <select
          value={search.sort}
          onChange={(e) => patch({ sort: e.target.value as typeof search.sort })}
          className="rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
        >
          <option value="recent">recent first</option>
          <option value="old">oldest first</option>
          <option value="size">largest first</option>
          <option value="name">name A–Z</option>
        </select>

        <button
          onClick={() => patch({ dedupe: !search.dedupe })}
          className={`rounded-md border px-3 py-1.5 font-mono text-[11px] transition-colors ${
            search.dedupe ? "border-white bg-white text-black" : "border-[#262626] text-[#a1a1a1] hover:border-[#404040]"
          }`}
        >
          unique only
        </button>

        <span className="ml-auto font-mono text-[11px] tabular-nums text-[#666]">
          {fmtN(rows.length)} images
          {search.md5 && (
            <button onClick={() => patch({ md5: "" })} className="ml-2 text-danger hover:underline">
              md5 filter ✕
            </button>
          )}
        </span>
      </div>

      <VirtualGallery rows={rows} dupSet={dups} onOpen={setOpen} />

      {open != null && rows[open] && (
        <Lightbox
          row={rows[open]}
          latest={data}
          pos={open}
          total={rows.length}
          onClose={() => setOpen(null)}
          onPrev={() => setOpen(Math.max(0, open - 1))}
          onNext={() => setOpen(Math.min(rows.length - 1, open + 1))}
        />
      )}
    </div>
  );
}
