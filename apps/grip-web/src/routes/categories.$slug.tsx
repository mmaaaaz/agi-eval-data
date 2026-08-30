import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Eyebrow } from "@site/section";
import { fmtN } from "@site/format";
import { useTree } from "../components/GripShell";
import { useCategoryDetail } from "../lib/gripData";
import { upstreamBlobUrl } from "../lib/gripImage";
import { GripGallery } from "../components/GripGallery";
import type { Sample } from "../lib/gripTypes";

export const Route = createFileRoute("/categories/$slug")({
  component: CategoryDetailPage,
  validateSearch: (s: Record<string, unknown>) => ({
    sub: typeof s.sub === "string" && s.sub ? s.sub : "main",
  }),
});

function CategoryDetailPage() {
  const { slug } = Route.useParams();
  const tree = useTree();
  const cat = tree.categories.find((c) => c.slug === slug);
  const { detail, loading, error } = useCategoryDetail(slug);
  const search = Route.useSearch();

  if (!cat) return <p className="font-mono text-sm text-[#666]">unknown category: {slug}</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Eyebrow n="03">{`${cat.name} — ${cat.geometryClass}`}</Eyebrow>

      {/* header row */}
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[11px] text-[#666]">
        <span className="text-[#a1a1a1]">{cat.folder}</span>
        <span>{fmtN(cat.imagesMain)} main imgs · {fmtN(cat.questionsMain)} q</span>
        {cat.legacyImages > 0 && <span className="text-[#8a6d1f]">{fmtN(cat.legacyImages)} legacy imgs</span>}
        {cat.score && <span>difficulty {cat.score.min.toFixed(2)}–{cat.score.max.toFixed(2)} (mean {cat.score.mean.toFixed(3)})</span>}
        <a href={upstreamBlobUrl(`Dataset/${cat.folder}/README.md`)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          README ↗
        </a>
      </div>

      {/* question-type inventory */}
      {cat.questionTypes.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {cat.questionTypes.map((qt) => (
            <span key={qt} className="rounded border border-[#262626] px-2 py-0.5 font-mono text-[10px] text-[#a1a1a1]">
              {qt}
            </span>
          ))}
        </div>
      )}

      {/* docs list */}
      {cat.docs.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-x-4 gap-y-1">
          {cat.docs.map((d) => (
            <a key={d} href={upstreamBlobUrl(d)} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] text-[#666] hover:text-accent">
              {d.split("/").pop()} ↗
            </a>
          ))}
        </div>
      )}

      {/* subsuite tabs */}
      {detail && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {cat.subsuites.map((sub) => (
              <Link
                key={sub.id}
                to="/categories/$slug"
                params={{ slug }}
                search={{ sub: sub.id }}
                activeOptions={{ exact: false }}
                className={`rounded-md border px-3 py-1.5 font-mono text-[11px] transition-colors ${
                  (search.sub ?? "main") === sub.id
                    ? "border-white bg-white text-black"
                    : "border-[#262626] text-[#a1a1a1] hover:border-[#404040] hover:text-white"
                }`}
              >
                {sub.id}
                {sub.id !== "main" && <span className="ml-1.5 opacity-50">snapshot</span>}
              </Link>
            ))}
            {cat.galleries.map((g) => (
              <GalleryLink key={g.id} slug={slug} galleryId={g.id} images={g.images} />
            ))}
          </div>

          {error && <p className="font-mono text-xs text-danger">failed to load {slug} detail: {error}</p>}
          {loading && <p className="font-mono text-xs text-[#666]">loading {slug} records…</p>}
          {detail && <SampleGrid slug={slug} sub={search.sub ?? "main"} records={detail.records} />}
        </>
      )}
    </div>
  );
}

function GalleryLink({ slug, galleryId, images }: { slug: string; galleryId: string; images: number }) {
  return (
    <a
      href={upstreamBlobUrl(`Dataset/${slug}`)}
      onClick={(e) => e.preventDefault()}
      className="pointer-events-none rounded-md border border-dashed border-[#262626] px-3 py-1.5 font-mono text-[11px] text-[#666]"
      title="gallery node (PNGs only, no annotations)"
    >
      {galleryId} · {images} png (no Q/A)
    </a>
  );
}

function SampleGrid({ slug, sub, records }: { slug: string; sub: string; records: Sample[] }) {
  const rows = useMemo(() => records.filter((r) => r.sub === sub), [records, sub]);

  const open = (s: Sample) => {
    const url = s.sub === "main" ? `/sample/${slug}/${s.id}` : `/sample/${slug}/${s.sub}/${s.id}`;
    window.location.assign(url);
  };

  if (rows.length === 0) return <p className="font-mono text-xs text-[#666]">no samples in this subsuite</p>;
  return <GripGallery samples={rows} onOpen={open} />;
}
