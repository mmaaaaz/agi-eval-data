import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Eyebrow } from "@site/section";
import { useTree } from "../components/GripShell";
import { useCategoryDetail } from "../lib/gripData";
import { gripImageUrl } from "../lib/gripImage";
import { QuestionCard } from "../components/QuestionCard";
import { ScenePanel } from "../components/ScenePanel";
import { EditDialog } from "../components/EditDialog";
import type { Question } from "../lib/gripTypes";

/** Two route shapes because sample ids collide across subsuites:
 *  /sample/$slug/$id           (main)
 *  /sample/$slug/$sub/$id      (sample_test / stress_test / …) */
export const Route = createFileRoute("/sample/$slug/$")({
  component: SamplePage,
});

type SamplePageProps = Record<string, never>;

function SamplePage(_props: SamplePageProps) {
  const { slug } = Route.useParams();
  const params = Route.useParams() as { slug: string; _splat?: string };
  const splat = (params._splat ?? "").split("/").filter(Boolean);
  const sub = splat.length === 2 ? splat[0] : "main";
  const id = splat.length === 2 ? splat[1] : splat[0] ?? "";

  const tree = useTree();
  const cat = tree.categories.find((c) => c.slug === slug);
  const { detail, loading, error } = useCategoryDetail(slug);
  const [editQ, setEditQ] = useState<Question | null>(null);
  const [editSceneKey, setEditSceneKey] = useState<string | null>(null);

  const sample = detail?.records.find((r) => r.sub === sub && r.id === id);

  /* staged-edit badge lookup (localStorage mirror; worker-backed when configured) */
  const edits = useMemo(() => loadLocalEdits(), [sample?.id]);
  const edit = sample ? edits.find((e) => e.slug === slug && e.sampleId === sample.id) : undefined;

  /* keyboard nav: ←/→ prev/next within subsuite, Esc → category */
  useEffect(() => {
    if (!detail || !sample) return;
    const rows = detail.records.filter((r) => r.sub === sample.sub);
    const idx = rows.findIndex((r) => r.id === sample.id);
    const urlOf = (t: typeof rows[number]) =>
      t.sub === "main" ? `/sample/${slug}/${t.id}` : `/sample/${slug}/${t.sub}/${t.id}`;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.location.assign(`/categories/${slug}`);
      if (e.key === "ArrowLeft" && idx > 0) window.location.assign(urlOf(rows[idx - 1]));
      if (e.key === "ArrowRight" && idx < rows.length - 1) window.location.assign(urlOf(rows[idx + 1]));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [detail, sample, slug]);

  if (!cat) return <p className="font-mono text-sm text-[#666]">unknown category: {slug}</p>;
  if (loading) return <p className="font-mono text-xs text-[#666]">loading {slug}…</p>;
  if (error) return <p className="font-mono text-xs text-danger">{error}</p>;
  if (!sample) return <p className="font-mono text-sm text-[#666]">sample not found: {sub}/{id}</p>;

  const isLegacy = sample.legacy;
  const levelNameOf = (lvl: number) => tree.levelNames[String(lvl)] ?? `level ${lvl}`;

  return (
    <div>
      <Eyebrow n="04">{`${cat.name} · ${sample.sub === "main" ? "main suite" : sample.sub}${isLegacy ? " · legacy snapshot" : ""}`}</Eyebrow>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Link
          to="/categories/$slug"
          params={{ slug }}
          search={sample.sub === "main" ? { sub: "main" } : { sub: sample.sub }}
          className="font-mono text-[11px] text-accent hover:underline"
        >
          ← {cat.name}
        </Link>
        <h1 className="font-mono text-sm text-white">{sample.id}</h1>
        <span className="font-mono text-[10px] text-[#666]">
          seed {sample.seed ?? "—"} · canvas {sample.canvas[0] ?? "?"}×{sample.canvas[1] ?? "?"} ·{" "}
          {typeof sample.score === "number" ? `difficulty ${sample.score.toFixed(3)}` : "difficulty —"}
        </span>
        {edit && <span className="rounded bg-[#8b5cf6]/20 px-1.5 py-0.5 font-mono text-[9px] text-[#a78bfa]" title={edit.patch.reason}>edited ({edit.patch.changes.length} change{edit.patch.changes.length === 1 ? "" : "s"})</span>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,58%)_minmax(0,42%)]">
        {/* image */}
        <div>
          <div className="overflow-hidden rounded-lg border border-[#262626] bg-[#050505]">
            <img
              src={gripImageUrl(sample.img)}
              alt={sample.id}
              loading="eager"
              className="max-h-[76vh] w-full object-contain"
            />
          </div>
          <p className="mt-1.5 font-mono text-[9px] text-[#555]">
            served from upstream LFS · {sample.img}
          </p>
        </div>

        {/* right rail: questions + scene */}
        <div className="flex flex-col gap-3">
          {isLegacy && (
            <p className="rounded-lg border border-[#8a6d1f]/40 bg-[#8a6d1f]/10 px-3 py-2 font-mono text-[10px] text-[#d4b04a]">
              legacy snapshot — this subsuite predates the five-level retrofit (its questions may not cover L1–L5).
            </p>
          )}
          {sample.q.map((q, i) => (
            <QuestionCard
              key={q.question_id}
              q={q}
              levelName={levelNameOf(q.difficulty_level)}
              index={i}
              edit={edit?.patch.changes.some((c) => c.field === `q:${q.question_id}`) ? edit : undefined}
              onEdit={(qq) => { setEditQ(qq); setEditSceneKey(null); }}
            />
          ))}
          {edit && (
            <button
              onClick={() => { setEditQ(null); setEditSceneKey("__scene__"); }}
              className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-[#8b5cf6]/50 px-3 py-2 font-mono text-[10px] text-[#a78bfa] transition-colors hover:bg-[#8b5cf6]/10"
            >
              + add another change to this sample's staged edit
            </button>
          )}
          <ScenePanel sample={sample} />
        </div>
      </div>

      {(editQ || editSceneKey) && sample && (
        <EditDialog
          slug={slug}
          sample={sample}
          question={editQ}
          sceneKey={editSceneKey === "__scene__" ? null : editSceneKey}
          existing={edit}
          onClose={() => { setEditQ(null); setEditSceneKey(null); }}
          onSaved={() => { setEditQ(null); setEditSceneKey(null); window.location.reload(); }}
        />
      )}
    </div>
  );
}

/* localStorage mirror of staged edits (offline + no-worker fallback) */

export interface LocalEdit { slug: string; sampleId: string; patch: { version: number; author: string; reason: string; editedAt: string; changes: { field: string; from?: unknown; to: unknown }[] } }

const LOCAL_EDITS_KEY = "grip.staged-edits.v1";

export function loadLocalEdits(): LocalEdit[] {
  try {
    const raw = localStorage.getItem(LOCAL_EDITS_KEY);
    return raw ? (JSON.parse(raw) as LocalEdit[]) : [];
  } catch { return []; }
}

export function saveLocalEdit(edit: LocalEdit): void {
  const all = loadLocalEdits().filter((e) => !(e.slug === edit.slug && e.sampleId === edit.sampleId));
  all.push(edit);
  localStorage.setItem(LOCAL_EDITS_KEY, JSON.stringify(all));
}
