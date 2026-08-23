import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useData } from "../lib/dataContext";
import { dupCounts, exifOf, megapixels, orientationOf, ownerStats, type Orientation } from "../lib/data";
import { fmtN } from "../lib/format";
import type { Latest, Row } from "../lib/types";
import { VirtualGallery } from "../components/VirtualGallery";
import { Lightbox } from "../components/Lightbox";

function doExport(rows: Row[], data: Latest, fmt: "csv" | "jsonl") {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dl = (id: string) => `https://drive.google.com/uc?export=download&id=${id}`;
  const view = (id: string) => `https://drive.google.com/file/d/${id}/view`;

  let blob: Blob;
  if (fmt === "csv") {
    const head = "id,name,width,height,megapixels,camera,ext,bytes,day,owner_email,owner_name,md5,view_url,download_url";
    const lines = rows.map((r) => {
      const e = exifOf(data, r[0]);
      const cells = [
        r[0], r[1], e?.w ?? "", e?.h ?? "", e ? megapixels(e.w, e.h).toFixed(1) : "",
        e?.camera ?? "", r[2], String(r[3]), r[4], r[5], data.owners[r[5]] ?? r[5],
        r[6], view(r[0]), dl(r[0]),
      ];
      return cells.map((c) => (String(c).includes(",") ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",");
    });
    blob = new Blob([[head, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  } else {
    const lines = rows.map((r) => {
      const e = exifOf(data, r[0]);
      return JSON.stringify({
        id: r[0], name: r[1], ext: r[2], bytes: r[3], day: r[4],
        owner: r[5], owner_name: data.owners[r[5]] ?? r[5], md5: r[6],
        width: e?.w, height: e?.h, camera: e?.camera,
        view_url: view(r[0]), download_url: dl(r[0]),
      });
    });
    blob = new Blob([lines.join("\n")], { type: "application/x-jsonlines" });
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `agi-eval-manifest_${stamp}_${rows.length}.${fmt}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const searchSchema = z.object({
  q: z.string().catch(""),
  who: z.string().catch("*"),
  ext: z.string().catch("") , // comma-separated allow-list
  dedupe: z.boolean().catch(false),
  md5: z.string().catch(""),
  sort: z.enum(["recent", "old", "size", "name"]).catch("recent"),
  orient: z.enum(["", "landscape", "portrait", "square"]).catch(""),
  minmp: z.coerce.number().min(0).catch(0),
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
    if (search.orient || search.minmp > 0) {
      r = r.filter((f) => {
        const e = exifOf(data, f[0]);
        if (!e) return false; // filtered by exif ⇒ unknowns excluded
        if (search.orient && orientationOf(e.w, e.h) !== (search.orient as Orientation)) return false;
        if (search.minmp > 0 && megapixels(e.w, e.h) < search.minmp) return false;
        return true;
      });
    }
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
  const owners = ownerStats(data).map((o) => ({ email: o.email, name: data.owners[o.email] ?? o.email, raw: o.raw }));

  return (
    <div className="relative flex h-[calc(100dvh-16rem)] min-h-[420px] flex-col md:h-[calc(100dvh-10rem)]">
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
          className="max-w-56 min-w-0 rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
        >
          <option value="*">everyone</option>
          {owners.map((o) => (
            <option key={o.email} value={o.email}>
              {o.name} ({fmtN(o.raw)})
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

        <details className="relative">
          <summary className="cursor-pointer list-none rounded-md border border-[#262626] px-3 py-1.5 font-mono text-xs text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white">
            export ⬇
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-[#262626] bg-[#0a0a0a] shadow-xl shadow-black/60">
            {(["csv", "jsonl"] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => doExport(rows, data, fmt)}
                className="block w-full px-3 py-2 text-left font-mono text-[11px] text-[#a1a1a1] transition-colors hover:bg-[#141414] hover:text-white"
              >
                manifest .{fmt} — {fmtN(rows.length)} rows
              </button>
            ))}
          </div>
        </details>

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

      {rows.length === 0 && search.md5 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-lg border border-[#262626] bg-black/80 px-4 py-3 font-mono text-xs text-[#a1a1a1]">
            no files with hash {search.md5.slice(0, 12)}… in this snapshot
          </p>
        </div>
      )}

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
