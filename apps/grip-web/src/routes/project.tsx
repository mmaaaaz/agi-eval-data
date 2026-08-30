import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eyebrow } from "@site/section";
import { useTree } from "../components/GripShell";
import { loadLocalEdits } from "./sample.$slug.$";
import { deleteStagedEdit, listStagedEdits, runSync, syncStatus, workerConfigured, type SyncStatus } from "../lib/gripSync";
import type { StagedEdit } from "../lib/gripTypes";

export const Route = createFileRoute("/project")({ component: Project });

const LEVELS = [
  ["L1", "Simple Description", "perceive one directly visible fact; no inference."],
  ["L2", "Basic Relational", "one comparison or one-step rule application."],
  ["L3", "Comparative/Structural", "rank, extremes, cross-referencing image regions."],
  ["L4", "Compound Reasoning", "combine ≥2 facts or a multi-step rule chain; no hypotheticals."],
  ["L5", "Extrapolative/Counterfactual", "deterministic hypothetical recompute from stored scene geometry."],
] as const;

function Project() {
  const tree = useTree();
  const [staged, setStaged] = useState<StagedEdit[]>([]);
  const [local, setLocal] = useState(loadLocalEdits());
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const refresh = () => {
    setLocal(loadLocalEdits());
    if (workerConfigured()) {
      listStagedEdits().then(setStaged).catch(() => setStaged([]));
      syncStatus().then(setStatus).catch(() => setStatus(null));
    }
  };
  useEffect(refresh, []);

  const doSync = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await runSync();
      if (r.status === "synced") setSyncMsg(`synced — commit ${r.commitSha.slice(0, 8)}. re-bake with 'bun run data:grip' to publish the edits on this site.`);
      else if (r.status === "conflict") setSyncMsg(`conflict — upstream moved to ${r.upstreamSha.slice(0, 8)}; stale: ${r.staleIds.join(", ")}`);
      else setSyncMsg(r.message);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "sync failed");
    } finally {
      setSyncing(false);
      refresh();
    }
  };

  const allEdits: { slug: string; sampleId: string; patch: StagedEdit["patch"]; remote: boolean }[] = [
    ...staged.map((e) => ({ ...e, remote: true })),
    ...local.filter((l) => !staged.some((s) => s.slug === l.slug && s.sampleId === l.sampleId)).map((l) => ({ ...l, remote: false })),
  ];

  return (
    <div>
      <Eyebrow n="06">project — methodology, edits & sync</Eyebrow>

      <section className="max-w-3xl">
        <h2 className="mb-2 font-medium tracking-tight text-white">The unified five-level rubric</h2>
        <p className="mb-4 text-sm leading-6 text-[#a1a1a1]">
          Every main-suite image carries exactly five questions in increasing difficulty. Ground truth is
          generated programmatically and independently re-derived by per-dataset validators — all 34
          report PASS with zero mismatches. This site displays the shipped ground truth behind a spoiler;
          it never invents answers.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {LEVELS.map(([tag, name, desc]) => (
            <div key={tag} className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-3">
              <p className="font-mono text-[10px] font-bold text-accent">{tag}</p>
              <p className="mt-1 font-mono text-[11px] text-white">{name}</p>
              <p className="mt-1 text-[11px] leading-4 text-[#666]">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 max-w-3xl">
        <h2 className="mb-2 font-medium tracking-tight text-white">Override edits & GitHub sync</h2>
        <p className="mb-3 text-sm leading-6 text-[#a1a1a1]">
          Edits made on sample pages are <span className="text-white">staged</span> — visible here, applied to
          site artifacts only after a sync, and never touching the source suite. Syncing writes the staged
          override files to the upstream repo (<code className="font-mono text-xs text-accent">data/overrides/…</code>) as{" "}
          <span className="text-white">one atomic commit</span>. If upstream moved meanwhile, the worker
          returns a conflict report instead of overwriting.
        </p>

        {!workerConfigured() && (
          <p className="mb-3 rounded-lg border border-dashed border-[#262626] px-3 py-2 font-mono text-[11px] text-[#666]">
            worker not configured — set the grip-sync URL + access code in <Link to="/settings" className="text-accent hover:underline">/settings</Link>.
            Edits staged in this browser still apply via the local pipeline (data/grip-overrides).
          </p>
        )}

        <div className="overflow-x-auto rounded-lg border border-[#262626]">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-[#262626] font-mono text-[9px] uppercase tracking-widest text-[#666]">
                <th className="px-3 py-2 font-normal">sample</th>
                <th className="px-3 py-2 font-normal">changes</th>
                <th className="px-3 py-2 font-normal">reason</th>
                <th className="px-3 py-2 font-normal">where</th>
                <th className="px-3 py-2 text-right font-normal">actions</th>
              </tr>
            </thead>
            <tbody>
              {allEdits.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-4 text-center font-mono text-[11px] text-[#555]">no staged edits</td></tr>
              )}
              {allEdits.map((e) => (
                <tr key={`${e.slug}/${e.sampleId}`} className="border-b border-[#141414] last:border-0">
                  <td className="px-3 py-2 font-mono text-[11px] text-white">
                    <Link
                      to="/sample/$slug/$"
                      params={{ slug: e.slug, _splat: e.sampleId }}
                      className="text-[#ededed] hover:text-accent"
                    >
                      {e.slug}/{e.sampleId}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-[#a1a1a1]">
                    {e.patch.changes.map((c) => c.field).join(", ")}
                  </td>
                  <td className="max-w-[240px] truncate px-3 py-2 text-[11px] text-[#666]" title={e.patch.reason}>{e.patch.reason}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${e.remote ? "bg-[#8b5cf6]/15 text-[#a78bfa]" : "bg-[#141414] text-[#666]"}`}>
                      {e.remote ? "worker KV" : "browser local"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {e.remote && workerConfigured() && (
                      <button
                        onClick={() => { void deleteStagedEdit(e.slug, e.sampleId).then(refresh); }}
                        className="font-mono text-[10px] text-[#666] hover:text-danger"
                      >
                        drop
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {workerConfigured() && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={doSync}
              disabled={syncing || allEdits.length === 0}
              className="rounded bg-[#8b5cf6] px-4 py-2 font-mono text-xs font-medium text-black transition-opacity disabled:opacity-40"
            >
              {syncing ? "syncing…" : `sync ${allEdits.length} edit${allEdits.length === 1 ? "" : "s"} → 1 commit`}
            </button>
            {status && (
              <span className="font-mono text-[10px] text-[#666]">
                upstream {status.upstreamSha?.slice(0, 8) ?? "—"} · staged {status.staged}
              </span>
            )}
            {syncMsg && <span className="font-mono text-[10px] text-[#a1a1a1]">{syncMsg}</span>}
          </div>
        )}
      </section>

      <section className="mt-8 max-w-3xl">
        <h2 className="mb-2 font-medium tracking-tight text-white">Provenance</h2>
        <p className="text-sm leading-6 text-[#a1a1a1]">
          Suite: <a className="text-accent hover:underline" href={`https://github.com/${tree.upstreamRepo}`} target="_blank" rel="noopener noreferrer">{tree.upstreamRepo} ↗</a>{" "}
          (MIT, per the HF dataset card). Artifacts baked {tree.builtAt} from {tree.bakedFromCommit} ·{" "}
          {tree.counts.imagesMain.toLocaleString()} main images / {tree.counts.questionsMain.toLocaleString()} questions ·{" "}
          {tree.counts.legacyImages.toLocaleString()} legacy snapshot images. The legacy subsuites
          (sample_test / stress_test / …) are pre-retrofit snapshots kept for provenance — most carry the
          original 4-question structure.
        </p>
      </section>
    </div>
  );
}
