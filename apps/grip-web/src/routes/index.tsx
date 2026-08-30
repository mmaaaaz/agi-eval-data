import { createFileRoute, Link } from "@tanstack/react-router";
import { Eyebrow } from "@site/section";
import { fmtN } from "@site/format";
import { useTree } from "../components/GripShell";

export const Route = createFileRoute("/")({ component: Overview });

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black p-4">
      <p className="font-mono text-[9px] uppercase tracking-widest text-[#666]">{label}</p>
      <p className="t-num mt-1.5 text-xl font-semibold tabular-nums tracking-tight text-white">{value}</p>
    </div>
  );
}

function Overview() {
  const tree = useTree();
  const c = tree.counts;
  const geometric = tree.categories.filter((x) => x.family === "geometric").length;
  const physical = tree.categories.filter((x) => x.family === "physical").length;

  return (
    <div>
      <Eyebrow n="01">overview</Eyebrow>

      <section className="pb-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a1a1a1]">grip-benchmark-34 · synthetic · independently validated</p>
        <p className="t-num mt-2 text-5xl font-semibold tabular-nums tracking-tighter text-white sm:text-6xl lg:text-7xl">
          {fmtN(c.questionsMain)}
        </p>
        <p className="mt-3 font-mono text-[11px] text-[#666] sm:text-xs">
          ground-truthed questions · {fmtN(c.imagesMain)} images · {c.categories} sub-benchmarks · 5 difficulty levels
        </p>
      </section>

      <section aria-label="dataset stats" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#262626] bg-[#262626] sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="questions" value={fmtN(c.questionsMain)} />
        <Tile label="images" value={fmtN(c.imagesMain)} />
        <Tile label="sub-benchmarks" value={fmtN(c.categories)} />
        <Tile label="geometric / physical" value={`${geometric} / ${physical}`} />
        <Tile label="per level (L1–L5)" value={fmtN(c.levels["1"] ?? 0)} />
        <Tile label="legacy snapshot images" value={fmtN(c.legacyImages)} />
      </section>

      <section aria-label="quick jump" className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Jump to="/categories" label="Categories" hint="browse the tree" />
        <Jump to="/browse" label="Browse" hint="filter all samples" />
        <Jump to="/project" label="Project" hint="methodology + edits" />
        <Jump to="/settings" label="Settings" hint="worker + access code" />
      </section>

      <section className="pt-8 sm:pt-10">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-medium tracking-tight text-white">Sub-benchmarks</h2>
          <span className="font-mono text-[10px] text-[#666]">{c.categories} categories · full folder tree</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-[#262626]">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#262626] font-mono text-[9px] uppercase tracking-widest text-[#666]">
                <th className="px-3 py-2 font-normal">category</th>
                <th className="px-3 py-2 font-normal">class</th>
                <th className="px-3 py-2 text-right font-normal">images</th>
                <th className="px-3 py-2 text-right font-normal">questions</th>
                <th className="px-3 py-2 text-right font-normal">mean diff.</th>
                <th className="px-3 py-2 text-right font-normal">subsuites</th>
              </tr>
            </thead>
            <tbody>
              {tree.categories.map((cat) => (
                <tr key={cat.slug} className="border-b border-[#141414] last:border-0 hover:bg-[#0a0a0a]">
                  <td className="px-3 py-2">
                    <Link
                      to="/categories/$slug"
                      params={{ slug: cat.slug }}
                      search={{ sub: "main" }}
                      className="text-[#ededed] transition-colors hover:text-accent"
                    >
                      {cat.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-[#666]">{cat.geometryClass}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-[#a1a1a1]">{fmtN(cat.images)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-[#a1a1a1]">{fmtN(cat.questions)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-[#a1a1a1]">
                    {cat.score ? cat.score.mean.toFixed(3) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-[#666]">{cat.subsuites.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Jump({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-[#262626] bg-black p-4 transition-colors hover:border-[#404040]"
    >
      <p className="font-mono text-xs text-white">{label}</p>
      <p className="mt-1 font-mono text-[10px] text-[#666] group-hover:text-[#a1a1a1]">{hint} →</p>
    </Link>
  );
}
