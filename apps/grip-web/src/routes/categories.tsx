import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Eyebrow } from "@site/section";
import { fmtN } from "@site/format";
import { useTree } from "../components/GripShell";
import type { Category } from "../lib/gripTypes";

export const Route = createFileRoute("/categories")({ component: Categories });

function Categories() {
  const tree = useTree();

  const groups = useMemo(() => {
    const byFamily = new Map<string, Map<string, Category[]>>();
    for (const cat of tree.categories) {
      let byClass = byFamily.get(cat.family);
      if (!byClass) byFamily.set(cat.family, (byClass = new Map()));
      const arr = byClass.get(cat.geometryClass);
      if (arr) arr.push(cat);
      else byClass.set(cat.geometryClass, [cat]);
    }
    return [...byFamily.entries()].map(([family, byClass]) => ({
      family,
      classes: [...byClass.entries()],
    }));
  }, [tree]);

  return (
    <div>
      <Eyebrow n="02">categories — the full folder tree</Eyebrow>
      {groups.map(({ family, classes }) => (
        <section key={family} className="mb-10">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-white">
            {family}
            <span className="ml-2 text-[#666]">
              {family === "geometric" ? "geometry, spatial, topology" : "mechanical reasoning"}
            </span>
          </h2>
          {classes.map(([gclass, cats]) => (
            <div key={gclass} className="mb-5">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#666]">{gclass}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {cats.map((cat) => (
                  <CategoryCard key={cat.slug} cat={cat} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function CategoryCard({ cat }: { cat: Category }) {
  const subsuiteCount = cat.subsuites.length - 1; // main excluded
  const galleryCount = cat.galleries.length;
  return (
    <Link
      to="/categories/$slug"
      params={{ slug: cat.slug }}
      search={{ sub: "main" }}
      className="group rounded-lg border border-[#262626] bg-black p-3.5 transition-colors hover:border-[#404040]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-[#ededed] group-hover:text-white">{cat.name}</p>
        {cat.overridesApplied > 0 && (
          <span className="shrink-0 rounded bg-[#8b5cf6]/15 px-1.5 py-0.5 font-mono text-[9px] text-[#a78bfa]">
            {cat.overridesApplied} edit{cat.overridesApplied === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <p className="mt-1 font-mono text-[10px] text-[#666]">{cat.folder}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-[#a1a1a1]">
        <span>{fmtN(cat.imagesMain)} imgs</span>
        <span>{fmtN(cat.questionsMain)} q</span>
        {subsuiteCount > 0 && <span className="text-[#666]">+{subsuiteCount} subsuite{subsuiteCount === 1 ? "" : "s"}</span>}
        {galleryCount > 0 && <span className="text-[#666]">· {galleryCount} gallery</span>}
      </div>
    </Link>
  );
}
