import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { fmtN } from "../lib/format";

export const Route = createFileRoute("/gallery/optimization/")({
  component: Optimization,
});

interface OptReport {
  generated: string;
  before_gib: number;
  after_gib: number;
  files_total: number;
  files: { inplace: number; siblings: number };
  pixels: { original_avg_mp: number; cap_long_edge: number; upscale: boolean };
  pipeline: string[];
  safety: string[];
  metadata_preserved: string[];
  cost: string;
  provenance: string;
}

interface CleanupOwner {
  owner: string;
  copies: number;
  gib: number;
  slug: string;
}

interface CleanupIndex {
  generated: string;
  total_copies: number;
  total_gib: number;
  note: string;
  owners: CleanupOwner[];
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-[#262626] bg-[#0f0f0f] p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-[#737373]">{label}</div>
      <div className="mt-1 font-mono text-xl text-white">{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[10px] text-[#525252]">{sub}</div>}
    </div>
  );
}

function Optimization() {
  const [report, setReport] = useState<OptReport | null>(null);
  const [cleanup, setCleanup] = useState<CleanupIndex | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/data/optimization-report.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setReport)
      .catch((e) => setErr(String(e)));
    fetch("/data/cleanup/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setCleanup)
      .catch(() => {}); // cleanup index optional
  }, []);

  const saved = report ? 1 - report.after_gib / report.before_gib : 0;

  return (
    <div className="space-y-6">
      {err && (
        <div className="rounded-md border border-[#7f1d1d] bg-[#1a0f0f] p-4 font-mono text-xs text-[#f87171]">
          optimization report unavailable ({err}) — the deploy pipeline bakes /data/optimization-report.json
        </div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="dataset size" value={`${report.before_gib.toFixed(1)} → ${report.after_gib.toFixed(1)} GiB`}
                  sub={`${(saved * 100).toFixed(1)}% smaller`} />
            <Stat label="files optimized" value={fmtN(report.files.inplace + report.files.siblings)}
                  sub={`${fmtN(report.files_total)} total rows`} />
            <Stat label="in-place rewrites" value={fmtN(report.files.inplace)} sub="same URL, same file-id" />
            <Stat label="webp siblings" value={fmtN(report.files.siblings)} sub="new id, original kept" />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-[#262626] bg-[#0f0f0f] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#737373]">spec</div>
              <ul className="mt-2 space-y-1.5 text-xs text-[#a3a3a3]">
                <li>· long edge ≤ <b className="text-white">{report.pixels.cap_long_edge}px</b> (VLM ceiling — Claude resamples above 1568 anyway)</li>
                <li>· original avg {report.pixels.original_avg_mp} MP → capped with LANCZOS; never upscaled</li>
                <li>· JPEG re-encoded in place (q78, same file-id); PNG/HEIC → WebP q75 siblings</li>
                <li>· no-regression guard: a re-encode that can't beat the original's size is discarded</li>
                <li>· EXIF stripped from bytes; metadata preserved in per-file ledgers</li>
              </ul>
            </div>
            <div className="rounded-md border border-[#262626] bg-[#0f0f0f] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[#737373]">safety &amp; effort</div>
              <ul className="mt-2 space-y-1.5 text-xs text-[#a3a3a3]">
                {report.safety.map((s) => <li key={s}>· {s}</li>)}
                <li>· metadata preserved: {report.metadata_preserved.join(", ")}</li>
                <li>· pipeline: {report.pipeline.length} stages, 27 CI batches on GitHub Actions</li>
                <li>· {report.cost}</li>
                <li>· provenance: <code className="text-[10px]">{report.provenance}</code></li>
              </ul>
            </div>
          </div>

          <div className="rounded-md border border-[#262626] bg-[#0f0f0f] p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[#737373]">pipeline stages</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {report.pipeline.map((p, i) => (
                <span key={p} className="rounded border border-[#262626] px-2 py-0.5 font-mono text-[10px] text-[#a3a3a3]">
                  {i + 1}. {p}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {cleanup && cleanup.owners.length > 0 && (
        <div className="rounded-md border border-[#262626] bg-[#0f0f0f] p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#737373]">
            duplicate cleanup — owner worklists
          </div>
          <p className="mt-2 text-xs text-[#a3a3a3]">
            Physical duplicate copies still exist in Drive (deletion is owner-side only).
            Each kit lists that owner's duplicate files with direct Drive deeplinks —
            open, compare against the surviving twin, move to trash (recoverable 30 days).
          </p>
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase text-[#737373]">
                <th className="py-1.5">owner</th><th>copies</th><th>reclaimable</th><th></th>
              </tr>
            </thead>
            <tbody>
              {cleanup.owners.map((o) => (
                <tr key={o.owner} className="border-t border-[#1f1f1f]">
                  <td className="py-1.5 text-[#e5e5e5]">{o.owner}</td>
                  <td className="font-mono">{fmtN(o.copies)}</td>
                  <td className="font-mono">{o.gib.toFixed(2)} GiB</td>
                  <td>
                    <Link
                      to="/gallery/optimization/$owner"
                      params={{ owner: encodeURIComponent(o.owner) }}
                      className="rounded border border-[#404040] px-2 py-0.5 font-mono text-[10px] text-[#7ab7ff] hover:border-[#7ab7ff]"
                    >
                      open worklist →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 font-mono text-[10px] text-[#525252]">
            {fmtN(cleanup.total_copies)} copies · {cleanup.total_gib.toFixed(2)} GiB reclaimable in total
          </div>
        </div>
      )}
    </div>
  );
}
