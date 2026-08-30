import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Eyebrow } from "@site/section";
import { fmtN } from "@site/format";
import { useTree } from "../components/GripShell";
import { loadCategoryDetail } from "../lib/gripData";
import { GripGallery } from "../components/GripGallery";
import { normQ } from "@agi-eval/shared";
import type { Sample } from "../lib/gripTypes";

export const Route = createFileRoute("/browse")({
  component: Browse,
  validateSearch: (s: Record<string, unknown>) => ({
    cats: typeof s.cats === "string" ? s.cats : "",
    family: typeof s.family === "string" && s.family ? s.family : "",
    q: typeof s.q === "string" ? s.q : "",
    min: typeof s.min === "string" && s.min !== "" ? Number(s.min) : null,
    max: typeof s.max === "string" && s.max !== "" ? Number(s.max) : null,
  }),
});

/** Global browse: category-queued lazy detail loads (max 3 concurrent),
 *  client-side filters, virtualized grid. */
function Browse() {
  const tree = useTree();
  const router = useRouter();
  useEffect(() => primeCategoryFolders(tree), [tree]);
  const search = Route.useSearch();
  const selectedSlugs = useMemo(
    () => (search.cats ? search.cats.split(",").filter(Boolean) : []),
    [search.cats],
  );

  const [records, setRecords] = useState<Sample[]>([]);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let alive = true;
    const slugs = selectedSlugs.length > 0
      ? selectedSlugs
      : tree.categories.map((c) => c.slug); // default: everything (queued)
    let cursor = 0;
    let active = 0;
    const collected: Sample[] = [];
    setRecords([]);
    const total = slugs.length;
    setPending(total);
    const pump = () => {
      if (!alive) return;
      while (active < 3 && cursor < slugs.length) {
        const slug = slugs[cursor++];
        active++;
        loadCategoryDetail(slug)
          .then((d) => {
            if (!alive) return;
            collected.push(...d.records);
            setRecords([...collected]);
          })
          .catch(() => { /* category failed — skip */ })
          .finally(() => {
            active--;
            setPending(total - (cursor >= slugs.length && active === 0 ? 0 : cursor - active));
            pump();
          });
      }
    };
    pump();
    return () => { alive = false; };
  }, [selectedSlugs, tree.categories]);

  const filtered = useMemo(() => {
    let rows = records;
    if (search.family) {
      const famSlugs = new Set(tree.categories.filter((c) => c.family === search.family).map((c) => c.slug));
      rows = rows.filter((r) => famSlugs.has(slugOfRecord(r)));
    }
    if (search.min != null) rows = rows.filter((r) => typeof r.score === "number" && r.score >= search.min!);
    if (search.max != null) rows = rows.filter((r) => typeof r.score === "number" && r.score <= search.max!);
    if (search.q.trim()) {
      const q = normQ(search.q);
      rows = rows.filter((r) => normQ(r.id).includes(q) || r.q.some((qq) => normQ(qq.question_text).includes(q)));
    }
    return rows;
  }, [records, search, tree.categories]);

  const setParam = (kv: Record<string, string | number | null>) => {
    const merged = { ...search, ...kv };
    const next: Partial<typeof search> = {};
    for (const [k, v] of Object.entries(merged)) {
      if (v != null && v !== "") (next as Record<string, unknown>)[k] = v;
    }
    void router.navigate({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      search: ((prev: Record<string, unknown>) => ({ ...prev, ...next })) as never,
      resetScroll: false,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Eyebrow n="05">{`browse — ${fmtN(filtered.length)} samples${pending > 0 ? ` · loading ${pending} categories…` : ""}`}</Eyebrow>

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search.q}
          onChange={(e) => setParam({ q: e.target.value })}
          placeholder="search id or question text…"
          className="w-56 rounded border border-[#262626] bg-black px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-[#8b5cf6]"
        />
        <select
          value={search.family}
          onChange={(e) => setParam({ family: e.target.value || null })}
          className="rounded border border-[#262626] bg-black px-2 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-[#8b5cf6]"
        >
          <option value="">all families</option>
          <option value="geometric">geometric</option>
          <option value="physical">physical</option>
        </select>
        <input
          type="number"
          step="0.05"
          value={search.min ?? ""}
          onChange={(e) => setParam({ min: e.target.value })}
          placeholder="min score"
          className="w-24 rounded border border-[#262626] bg-black px-2 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-[#8b5cf6]"
        />
        <input
          type="number"
          step="0.05"
          value={search.max ?? ""}
          onChange={(e) => setParam({ max: e.target.value })}
          placeholder="max score"
          className="w-24 rounded border border-[#262626] bg-black px-2 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-[#8b5cf6]"
        />
        {selectedSlugs.length > 0 && (
          <button onClick={() => setParam({ cats: null })} className="rounded border border-[#262626] px-2 py-1.5 font-mono text-[10px] text-[#a1a1a1] hover:border-[#404040]">
            clear {selectedSlugs.length} category filter{selectedSlugs.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {/* category chips */}
      <div className="mb-3 flex max-h-24 flex-wrap gap-1 overflow-y-auto scrollbar-none">
        {tree.categories.map((c) => {
          const on = selectedSlugs.includes(c.slug);
          return (
            <button
              key={c.slug}
              onClick={() => {
                const next = on ? selectedSlugs.filter((s) => s !== c.slug) : [...selectedSlugs, c.slug];
                setParam({ cats: next.join(",") || null });
              }}
              className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] transition-colors ${
                on ? "border-[#8b5cf6] bg-[#8b5cf6]/15 text-[#a78bfa]" : "border-[#262626] text-[#666] hover:border-[#404040] hover:text-[#a1a1a1]"
              }`}
            >
              {c.slug}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center font-mono text-xs text-[#666]">
          {records.length === 0 ? "loading samples…" : "no samples match the filters"}
        </p>
      ) : (
        <GripGallery
          samples={filtered}
          onOpen={(s) => {
            const slug = slugOfRecord(s);
            window.location.assign(s.sub === "main" ? `/sample/${slug}/${s.id}` : `/sample/${slug}/${s.sub}/${s.id}`);
          }}
        />
      )}
    </div>
  );
}

/** recover the category slug for a sample via its img path (Dataset/<folder>/…) */
function slugOfRecord(r: Sample): string {
  const folder = r.img.split("/")[1] ?? "";
  for (const c of CATEGORY_FOLDERS) {
    if (c.folder === folder) return c.slug;
  }
  return folder.replace(/_dataset_(3000|1000)$/, "");
}

let CATEGORY_FOLDERS: { slug: string; folder: string }[] = [];
export function primeCategoryFolders(tree: { categories: { slug: string; folder: string }[] }): void {
  CATEGORY_FOLDERS = tree.categories.map((c) => ({ slug: c.slug, folder: c.folder }));
}
