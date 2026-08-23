import { createFileRoute } from "@tanstack/react-router";
import { useData } from "../lib/dataContext";
import { fmtN } from "../lib/format";

export const Route = createFileRoute("/project")({ component: Project });

function Project() {
  const { data } = useData();
  if (!data) return null;
  const c = data.meta.counts;

  return (
    <div className="max-w-3xl">
      <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">
        <span className="text-accent">05</span> — project
      </p>
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        agi-eval-data
      </h1>
      <p className="mt-4 leading-7 text-[#a1a1a1]">
        An evaluation dataset targeting failures of current vision-language models on{" "}
        <strong className="text-white">real-world visual and geometric reasoning</strong> — photographs
        where frontier models break down, paired with complex geometrical shape problems.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-4">
        {[
          ["unique images", fmtN(c.imagesUnique)],
          ["raw files", fmtN(c.imagesRaw)],
          ["contributors", fmtN(Object.keys(data.owners).length)],
          ["stored", `${(c.bytes / 1024 ** 3).toFixed(1)} GB`],
        ].map(([l, v]) => (
          <div key={l} className="bg-black p-4">
            <p className="font-mono text-lg tabular-nums text-white">{v}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#666]">{l}</p>
          </div>
        ))}
      </div>

      <section className="mt-10 space-y-6">
        <Block title="Thesis" body="Benchmark items are selected for verified model failure modes: spatial relations, object permanence, counting under clutter, perspective and shadow consistency, and multi-step geometric construction problems." />
        <Block title="Dataset composition" body={`${fmtN(c.imagesUnique)} unique real-world images across ${Object.keys(data.owners).length} contributors, curated and deduplicated continuously. Geometric problem sets are tracked separately.`} />
        <Block title="Status" body="Collection phase. This ledger is the live ground truth of what exists today; evaluation harness and task definitions land here as the project matures." draft />
      </section>
    </div>
  );
}

function Block({ title, body, draft }: { title: string; body: string; draft?: boolean }) {
  return (
    <div className="border-l-2 border-[#262626] pl-5">
      <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-white">
        {title}
        {draft && <span className="rounded bg-[#141414] px-1.5 py-0.5 text-[9px] text-[#666]">DRAFT</span>}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[#a1a1a1]">{body}</p>
    </div>
  );
}
