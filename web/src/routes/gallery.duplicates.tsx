import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useData } from "../lib/dataContext";
import { imageRows, ownerName } from "../lib/data";
import { fmtB, fmtN } from "../lib/format";
import { loadSettings } from "../lib/ai/settings";
import { questionsApi } from "../lib/questions";
import { ThumbImage } from "../components/ThumbImage";
import type { DupGroup, Row } from "../lib/types";

const searchSchema = z.object({
  q: z.string().catch(""),
  sort: z.enum(["wasted", "copies", "size", "recent", "name"]).catch("wasted"),
});

export const Route = createFileRoute("/gallery/duplicates")({
  validateSearch: searchSchema,
  component: Duplicates,
});

interface EnrichedGroup {
  md5: string;
  count: number;
  size: number;
  wasted: number;
  names: string[];
  lastDay: string;
}

function Duplicates() {
  const { data } = useData();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const settings = loadSettings();
  const relay = settings.relay.replace(/\/+$/, "");
  const code = settings.accessCode;
  const [marked, setMarked] = useState<{ file_id: string; reason: string; created_at: string }[]>([]);

  const refreshMarked = () => {
    if (!relay) return;
    questionsApi.excluded(relay, code).then((r) => setMarked(r.excluded)).catch(() => {});
  };
  useEffect(() => { refreshMarked(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const unmark = async (fileId: string) => {
    try {
      await questionsApi.unexclude(relay, code, fileId);
      refreshMarked();
    } catch { /* noop */ }
  };

  const patch = (p: Partial<typeof search>) =>
    navigate({ to: "/gallery/duplicates", search: { ...search, ...p } });

  /* md5 → actual copy rows (dupGroups.names is capped at 10 by the scanner) */
  const copiesByMd5 = useMemo(() => {
    const m = new Map<string, Row[]>();
    if (!data) return m;
    for (const r of imageRows(data)) {
      if (!r[6]) continue;
      const list = m.get(r[6]);
      if (list) list.push(r);
      else m.set(r[6], [r]);
    }
    return m;
  }, [data]);

  const groups = useMemo<EnrichedGroup[]>(() => {
    if (!data) return [];
    const lastDays = new Map<string, string>();
    for (const g of data.dupGroups) {
      let last = "";
      for (const r of copiesByMd5.get(g.md5) ?? []) if (r[4] > last) last = r[4];
      lastDays.set(g.md5, last);
    }
    const q = search.q.trim().toLowerCase();
    const out = data.dupGroups
      .filter((g: DupGroup) => {
        if (!q) return true;
        if (g.md5.toLowerCase().startsWith(q)) return true;
        return (copiesByMd5.get(g.md5) ?? []).some((r) => r[1].toLowerCase().includes(q));
      })
      .map((g: DupGroup) => ({
        md5: g.md5,
        count: g.count,
        size: g.size,
        wasted: (g.count - 1) * g.size,
        names: g.names,
        lastDay: lastDays.get(g.md5) ?? "",
      }));
    const cmp: Record<typeof search.sort, (a: EnrichedGroup, b: EnrichedGroup) => number> = {
      wasted: (a, b) => b.wasted - a.wasted,
      copies: (a, b) => b.count - a.count || b.size - a.size,
      size: (a, b) => b.size - a.size || b.wasted - a.wasted,
      recent: (a, b) => b.lastDay.localeCompare(a.lastDay),
      name: (a, b) => (a.names[0] ?? "").localeCompare(b.names[0] ?? ""),
    };
    return out.sort(cmp[search.sort]);
  }, [data, search.q, search.sort, copiesByMd5]);

  /* redundant bytes charged to each copy's own holder */
  const wasteByOwner = useMemo(() => {
    const m = new Map<string, number>();
    for (const rows of copiesByMd5.values()) {
      if (rows.length < 2) continue;
      for (const r of rows.slice(1)) m.set(r[5], (m.get(r[5]) ?? 0) + r[3]);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [copiesByMd5]);

  if (!data) return null;

  const c = data.meta.counts;
  const wastedTotal = data.dupGroups.reduce((s, g) => s + (g.count - 1) * g.size, 0);

  const toggle = (md5: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(md5)) next.delete(md5);
      else next.add(md5);
      return next;
    });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        Byte-identical copies
      </h1>

      {/* marked for removal */}
      {marked.length > 0 && (
        <div className="mt-5 rounded-lg border border-danger/30 bg-danger/[0.03] p-3">
          <p className="font-mono text-[11px] text-danger">marked for removal ({marked.length}) — hidden from /contribute; trash them in Drive when ready</p>
          <div className="mt-2 space-y-1.5">
            {marked.map((x) => {
              const img = data.files.find((r) => r[0] === x.file_id);
              return (
                <div key={x.file_id} className="flex items-center gap-2 rounded border border-[#262626]/60 px-2 py-1.5">
                  {img && <ThumbImage fileId={x.file_id} alt="" className="h-7 w-9 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#a1a1a1]">
                    {img ? img[1] : x.file_id}
                    {x.reason && <span className="ml-1.5 text-[#666]">— {x.reason}</span>}
                  </span>
                  <a
                    href={`https://drive.google.com/file/d/${x.file_id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 font-mono text-[9px] text-accent hover:underline"
                  >
                    drive ↗
                  </a>
                  <button
                    onClick={() => unmark(x.file_id)}
                    className="shrink-0 font-mono text-[9px] text-[#666] transition-colors hover:text-white"
                  >
                    unmark
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* summary tiles */}
      <section aria-label="duplicate stats" className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-4">
        <Tile label="groups" value={fmtN(data.dupGroups.length)} />
        <Tile label="extra copies" value={fmtN(c.dupCopies)} />
        <Tile label="recoverable" value={fmtB(wastedTotal)} danger={wastedTotal > 0} />
        <Tile
          label="of stored bytes"
          value={c.bytes ? `${((wastedTotal / c.bytes) * 100).toFixed(2)}%` : "—"}
        />
      </section>

      {/* recoverable by contributor */}
      {wasteByOwner.length > 0 && (
        <section className="mt-6 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#666]">
            recoverable by contributor — redundant bytes held by each person
          </p>
          <div className="mt-3 space-y-2">
            {wasteByOwner.slice(0, 5).map(([email, bytes]) => (
              <div key={email} className="grid grid-cols-[minmax(80px,160px)_1fr_72px] items-center gap-3">
                <span className="truncate font-mono text-[11px] text-[#a1a1a1]" title={ownerName(data, email)}>
                  {ownerName(data, email)}
                </span>
                <span className="h-[7px] overflow-hidden rounded-full bg-[#161616]">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-[#155a9d] to-danger"
                    style={{ width: `${Math.max(2, (bytes / wasteByOwner[0][1]) * 100)}%` }}
                  />
                </span>
                <span className="text-right font-mono text-[10px] tabular-nums text-[#ededed]">{fmtB(bytes)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-[#262626]/60 pb-4">
        <input
          value={search.q}
          onChange={(e) => patch({ q: e.target.value })}
          placeholder="search filename or hash prefix…"
          className="w-60 rounded-md border border-[#262626] bg-[#0a0a0a] px-3 py-1.5 font-mono text-xs text-[#ededed] outline-none transition-colors placeholder:text-[#666] focus:border-accent"
        />
        <select
          value={search.sort}
          onChange={(e) => patch({ sort: e.target.value as typeof search.sort })}
          className="rounded-md border border-[#262626] bg-[#0a0a0a] px-2.5 py-1.5 font-mono text-xs text-[#ededed] outline-none focus:border-accent"
        >
          <option value="wasted">most recoverable</option>
          <option value="copies">most copies</option>
          <option value="size">largest files</option>
          <option value="recent">newest copies</option>
          <option value="name">name A–Z</option>
        </select>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-[#666]">
          {fmtN(groups.length)} of {fmtN(data.dupGroups.length)} groups
        </span>
      </div>

      {/* group list */}
      {data.dupGroups.length === 0 ? (
        <p className="py-16 text-center font-mono text-xs text-[#666]">zero duplicates 🎉</p>
      ) : groups.length === 0 ? (
        <p className="py-16 text-center font-mono text-xs text-[#666]">
          nothing matches — loosen the filters
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-[#262626]">
          {groups.map((g, i) => (
            <GroupRow
              key={g.md5}
              group={g}
              index={i}
              copies={copiesByMd5.get(g.md5) ?? []}
              nameOf={(email) => ownerName(data, email)}
              open={open.has(g.md5)}
              onToggle={() => toggle(g.md5)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="bg-black p-3 sm:p-4">
      <p className={`font-mono text-base tabular-nums sm:text-lg ${danger ? "text-danger" : "text-white"}`}>{value}</p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[#666]">{label}</p>
    </div>
  );
}

function GroupRow({
  group,
  index,
  copies,
  nameOf,
  open,
  onToggle,
}: {
  group: EnrichedGroup;
  index: number;
  copies: Row[];
  nameOf: (email: string) => string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`border-b border-[#262626]/60 last:border-b-0 ${open ? "bg-[#0a0a0a]/60" : ""}`}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="group grid w-full grid-cols-[28px_minmax(0,1fr)_88px_20px] items-center gap-x-3 px-3 py-2.5 text-left transition-colors hover:bg-[#0f0f0f] sm:grid-cols-[36px_minmax(0,1fr)_130px_72px_96px_20px] sm:px-4"
      >
        <span className="font-mono text-[10px] tabular-nums text-[#404040]">{String(index + 1).padStart(3, "0")}</span>
        <span className="min-w-0">
          <span className="block truncate font-mono text-xs text-[#ededed] transition-colors group-hover:text-white" title={group.names.join(" · ")}>
            {group.names[0]}
            {group.count > 1 && <span className="ml-1.5 shrink-0 text-[10px] tabular-nums text-[#666]">×{fmtN(group.count)}</span>}
          </span>
          <span className="mt-0.5 block font-mono text-[9px] tabular-nums text-[#404040] sm:hidden">
            {group.md5.slice(0, 10)}… · −{fmtB(group.wasted)}
          </span>
        </span>
        <span className="hidden truncate font-mono text-[10px] tabular-nums text-[#666] sm:block" title={group.md5}>
          {group.md5.slice(0, 12)}…
        </span>
        <span className="hidden text-right font-mono text-[11px] tabular-nums text-[#a1a1a1] sm:block">
          {fmtB(group.size)} ea
        </span>
        <span className="text-right font-mono text-[11px] tabular-nums text-danger">−{fmtB(group.wasted)}</span>
        <span className={`font-mono text-[10px] text-[#666] transition-transform duration-150 ${open ? "rotate-90" : ""}`}>▸</span>
      </button>

      {open && (
        <div className="border-t border-[#262626]/40 px-3 pb-4 pt-3 sm:px-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {copies.map((r) => (
              <Link
                key={r[0]}
                to="/gallery"
                search={{ md5: group.md5 }}
                className="block overflow-hidden rounded-md border border-[#262626] bg-[#0a0a0a] transition-colors hover:border-[#404040]"
                title={`${r[1]} — view in gallery`}
              >
                <ThumbImage fileId={r[0]} alt={r[1]} className="h-24 w-full" />
                <span className="block px-2 py-1.5">
                  <span className="block truncate font-mono text-[9px] text-[#ededed]">{r[1]}</span>
                  <span className="mt-0.5 block truncate font-mono text-[8px] text-[#666]">
                    {nameOf(r[5])} · {fmtB(r[3])} · {r[4]}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          <Link
            to="/gallery"
            search={{ md5: group.md5 }}
            className="mt-3 inline-block font-mono text-[10px] text-accent transition-colors hover:underline"
          >
            open all {fmtN(copies.length)} copies in gallery →
          </Link>
        </div>
      )}
    </div>
  );
}
