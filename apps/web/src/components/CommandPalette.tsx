import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { ownerStats } from "../lib/data";

interface Item {
  key: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

/** ⌘K / Ctrl-K command palette — pages, people, actions. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, refresh } = useData();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const pages: Item[] = [
      { key: "p-overview", label: "Overview", group: "Pages", run: () => navigate({ to: "/" }) },
      { key: "p-gallery", label: "Gallery", group: "Pages", run: () => navigate({ to: "/gallery" }) },
      { key: "p-insights", label: "Insights", group: "Pages", run: () => navigate({ to: "/gallery/insights" }) },
      { key: "p-contribs", label: "Contributors", group: "Pages", run: () => navigate({ to: "/gallery/contributors" }) },
      { key: "p-dups", label: "Duplicates", group: "Pages", run: () => navigate({ to: "/gallery/duplicates" }) },
      { key: "p-project", label: "Project", group: "Pages", run: () => navigate({ to: "/project" }) },
    ];
    if (!data) return pages;
    const actions: Item[] = [
      {
        key: "a-dedupe",
        label: "Gallery — unique only",
        hint: "filter",
        group: "Actions",
        run: () => navigate({ to: "/gallery", search: { dedupe: true } as never }),
      },
      {
        key: "a-clear",
        label: "Clear gallery filters",
        hint: "reset",
        group: "Actions",
        run: () => navigate({ to: "/gallery" }),
      },
      {
        key: "a-refresh",
        label: "Refresh dataset now",
        hint: "sync",
        group: "Actions",
        run: () => refresh(),
      },
      {
        key: "a-repo",
        label: "Open GitHub repository",
        hint: "external",
        group: "Actions",
        run: () => window.open(`https://github.com/${import.meta.env.VITE_REPO ?? "mmaaaaz/agi-eval-data"}`, "_blank"),
      },
    ];
    const people: Item[] = ownerStats(data).map((o) => ({
      key: `c-${o.email}`,
      label: data.owners[o.email] ?? o.email,
      hint: `${o.raw.toLocaleString()} pics`,
      group: "People",
      run: () => navigate({ to: "/gallery/contributors/$email", params: { email: encodeURIComponent(o.email) } }),
    }));
    return [...pages, ...actions, ...people];
  }, [data, navigate, refresh]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;
    return items
      .map((it) => {
        const hay = `${it.label} ${it.group} ${it.hint ?? ""}`.toLowerCase();
        if (hay.startsWith(query)) return { it, rank: 0 };
        const idx = hay.indexOf(query);
        if (idx >= 0) return { it, rank: 1 + idx / 100 };
        return null;
      })
      .filter((x): x is { it: Item; rank: number } => x !== null)
      .sort((a, b) => a.rank - b.rank)
      .map((x) => x.it);
  }, [items, q]);

  useEffect(() => setSel(0), [q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
    }
  }, [open]);

  const commit = (it: Item | undefined) => {
    if (!it) return;
    onClose();
    // let the overlay unmount before routing
    setTimeout(() => it.run(), 0);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(results.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      commit(results[sel]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  useEffect(() => {
    listRef.current?.querySelector("[data-sel='true']")?.scrollIntoView({ block: "nearest" });
  }, [sel, results]);

  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-auto mt-[10vh] w-[min(580px,92vw)] overflow-hidden rounded-xl border border-[#262626] bg-[#0a0a0a] shadow-2xl shadow-black/70"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Jump to page, person, action…"
          className="w-full border-b border-[#262626] bg-transparent px-4 py-3.5 font-mono text-sm text-white outline-none placeholder:text-[#666]"
        />
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="px-3 py-6 text-center font-mono text-xs text-[#666]">no matches</p>
          )}
          {results.map((it, i) => {
            const showGroup = it.group !== lastGroup;
            lastGroup = it.group;
            return (
              <div key={it.key}>
                {showGroup && (
                  <p className="px-3 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#666]">
                    {it.group}
                  </p>
                )}
                <button
                  data-sel={i === sel}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => commit(it)}
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                    i === sel ? "bg-[#141414] text-white" : "text-[#a1a1a1]"
                  }`}
                >
                  <span className="truncate text-sm">{it.label}</span>
                  {it.hint && <span className="shrink-0 font-mono text-[10px] tabular-nums text-[#666]">{it.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-[#262626] px-4 py-2 font-mono text-[9px] text-[#666]">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>{results.length} results</span>
        </div>
      </div>
    </div>
  );
}
