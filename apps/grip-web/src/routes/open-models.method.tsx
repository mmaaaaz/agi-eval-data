import { createFileRoute, Link } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { Panel, Section, Tile, TileGrid } from "../components/open-models/ui";
import { fmtInt, pct } from "../lib/openModelsFmt";

export const Route = createFileRoute("/open-models/method")({ component: Method });

export function Method() {
  const a = useOM();
  const oddDomains = a.domains.filter((d) => (d.per[0]?.images ?? 0) !== a.integrity.evaluatedPerDomain);
  const pair = a.integrity.gtPairing;
  const paired = pair.mismatch === 0 && pair.missing === 0;
  const levelN = a.models[0].totals.levels.map((l) => l.n);
  const balanced = new Set(levelN).size === 1;
  const halfWidth = (n: number, p: number) => 1.959964 * Math.sqrt((p * (1 - p)) / n);
  const smallDomains = a.domains.filter((d) => d.n !== a.domains[0].n);

  return (
    <div>
      <Section
        eyebrow="01 rule"
        title="The frozen grading rule"
        hint="Published once, applied to every answer of every model, unchanged between runs."
      >
        <Panel className="p-4">
          <ol className="grid gap-x-8 gap-y-2.5 lg:grid-cols-2">
            {a.benchmark.grader.rules.map((r, i) => (
              <li key={i} className="flex gap-3 text-[12.5px] leading-relaxed text-[#a1a1a1]">
                <span className="font-mono text-[10px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </Section>

      <Section
        eyebrow="02 verification"
        title="What was checked before publishing"
        hint="All of it re-derived from the raw runs by scripts/open_models_bake.py — the same code that produced this artifact."
      >
        <TileGrid cols={3}>
          <Tile
            label="records re-graded"
            value={fmtInt(a.models.reduce((s, m) => s + m.totals.n, 0))}
            sub={a.models.map((m) => m.label + " " + fmtInt(m.totals.n)).join(" · ")}
          />
          <Tile
            label="duplicate question ids"
            value={fmtInt(a.integrity.dupIds)}
            accent="#9fd8b4"
            sub="every id unique within a run"
          />
          <Tile
            label="levels balanced"
            value={balanced ? "yes" : "no"}
            accent="#9fd8b4"
            sub={levelN.map((n) => fmtInt(n)).join(" / ") + " questions per level"}
          />
          <Tile
            label="ground truth paired across runs"
            value={paired ? "yes" : "no"}
            accent={paired ? "#9fd8b4" : "#f0a5a5"}
            sub={
              fmtInt(pair.checked) + " questions compared against " + (pair.reference ?? "the reference run") + " · " +
              fmtInt(pair.mismatch) + " mismatches · " + fmtInt(pair.missing) + " missing"
            }
          />
          <Tile
            label="disagreements categorised"
            value={fmtInt(a.models.reduce((s, m) => s + m.classes.reduce((x, c) => x + c.n, 0), 0))}
            sub="every harness/rule disagreement classified and sampled"
          />
          <Tile
            label="hand-transcribed numbers"
            value="0"
            accent="#9fd8b4"
            sub="every figure on the site is computed at render from the artifact"
          />
        </TileGrid>
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-[#666]">
          {a.domains.length} domains · {a.models.map((m) => fmtInt(m.totals.images)).join(" / ")} images per model ·{" "}
          {a.models[0].totals.levels[0].n.toLocaleString("en-US")} questions per level · grader {a.benchmark.grader.version}
        </p>
      </Section>

      <Section eyebrow="03 certainty" title="Exact, rule-dependent, estimated">
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#9fd8b4]">exact</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              Counts, per-domain / level / family accuracies, oracle baselines, single-answer detection, coverage, parse-failure rates —
              integer tallies over complete files, re-derivable with the bake script.
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#f0c98a]">rule-dependent</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              Accuracy itself, because “correct” needs a stated comparison rule. This site freezes one rule and publishes it. The runs' own
              looser scorer gives {a.models.map((m) => pct(m.totals.as, 2)).join(" / ")} against{" "}
              {a.models.map((m) => pct(m.totals.acc, 2)).join(" / ")} here — that spread is the honest uncertainty on any single number.
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#a1a1a1]">estimated</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              Sampling error, if the evaluated subset was drawn at random. At n = {fmtInt(a.domains[0].n)} and p ≈ 0.30 the 95% interval is
              ±{(halfWidth(a.domains[0].n, 0.3) * 100).toFixed(1)} points; a n = {fmtInt(smallDomains[0]?.n ?? 1000)} domain is ±
              {(halfWidth(smallDomains[0]?.n ?? 1000, 0.3) * 100).toFixed(1)}. Gaps under ~1.5 points between models are noise.
            </p>
          </Panel>
        </div>
      </Section>

      <Section eyebrow="04 caveats" title="Read these before quoting a number">
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-4">
            <ul className="space-y-2.5 text-[12.5px] leading-relaxed text-[#a1a1a1] [&_b]:text-[#ededed]">
              <li>
                <b>Half sample.</b> Files are named <code className="font-mono text-[11px]">*_dataset_3000</code> but carry{" "}
                {fmtInt(a.integrity.evaluatedPerDomain)} distinct images per domain (ids span 1–{a.integrity.nominalPerDomain}). Full-set
                numbers will move.
              </li>
              <li>
                <b>Uneven image counts.</b>{" "}
                {oddDomains.length === 0
                  ? "Every domain carries the same number of images."
                  : oddDomains.map((d) => d.label + " has " + fmtInt(d.per[0].images)).join("; ")}{" "}
                — one more than its neighbours, so its per-domain accuracy carries slightly different weight.
              </li>
              <li>
                <b>{smallDomains.length} smaller domain{smallDomains.length === 1 ? "" : "s"}.</b>{" "}
                {smallDomains.map((d) => d.label + " (n = " + fmtInt(d.n) + ")").join(", ") || "None."} — treat its gaps with the wider
                interval above.
              </li>
              <li>
                <b>Per question, not per image.</b> Five questions share each image, so repeated question formats dominate some domains.
              </li>
            </ul>
          </Panel>
          <Panel className="p-4">
            <ul className="space-y-2.5 text-[12.5px] leading-relaxed text-[#a1a1a1] [&_b]:text-[#ededed]">
              <li>
                <b>Structured ground truth.</b> {a.audit.zeroHarness.filter((z) => z.category === "recovered by the frozen rule").length}{" "}
                levels store answers as dicts or lists; a string comparison scores them zero, and the frozen rule only partly repairs that.
                Their true difficulty is unknown until the harness is fixed.
              </li>
              <li>
                <b>Multi-part credit.</b>{" "}
                {a.audit.zeroHarness.filter((z) => z.category === "one part of a multi-part answer supplied").length} levels use
                semicolon-separated answers where models supply one part; the frozen rule awards no accuracy there, only partial credit.
              </li>
              <li>
                <b>Single-answer levels.</b> {a.audit.constantLevels.length} levels have one ground truth for all 1,500 images. Accuracy on
                them is 100% by guessing and should be excluded from any headline that includes them.
              </li>
              <li>
                <b>Paired, by construction.</b> All {fmtInt(pair.checked)} comparable questions share one ground truth across runs (
                {fmtInt(pair.mismatch)} mismatches, {fmtInt(pair.missing)} missing), so every gap here is a model difference, not a data
                difference. The bake fails loudly if a newly added run breaks that.
              </li>
              <li>
                <b>Upstream drift.</b> The dataset was regenerated after these runs:{" "}
                {pct(a.integrity.gtDrift.mismatch / Math.max(1, a.integrity.gtDrift.checked), 1)} of question ids now carry a different
                ground truth upstream. Re-run before publishing per-question examples.
              </li>
            </ul>
          </Panel>
        </div>
      </Section>

      <Section
        eyebrow="05 reproduce"
        title="From raw runs to this page"
        hint="The raw JSONL (hundreds of MB) is not committed; the bake output is, and the site reads it directly."
      >
        <Panel className="p-4">
          <ol className="space-y-3 font-mono text-[11.5px] leading-relaxed text-[#a1a1a1]">
            <li>
              <span className="text-[#666]">01</span> drop each run into{" "}
              <code className="text-white">data/open-model-analysis/&lt;run&gt;/&lt;model-id&gt;/*.jsonl</code> (one file per domain)
            </li>
            <li>
              <span className="text-[#666]">02</span> <code className="text-white">python scripts/open_models_bake.py</code> — grades
              every answer with the frozen rule and writes <code className="text-white">data/open-models/models.json</code>
            </li>
            <li>
              <span className="text-[#666]">03</span> <code className="text-white">python scripts/open_models_public.py</code> — copies the
              artifact into <code className="text-white">apps/grip-web/public/data/</code>
            </li>
            <li>
              <span className="text-[#666]">04</span> commit, push to <code className="text-white">main</code> — CI deploys the site and this
              page picks the artifact up with no code change
            </li>
          </ol>
          <p className="mt-4 border-t border-[#1c1c1e] pt-3 font-mono text-[10px] leading-relaxed text-[#666]">
            Adding a model is a data change, not a code change: drop the folder, re-bake, push. Every table, chart and “wins” count derives
            from the artifact's model list.
          </p>
        </Panel>
        <p className="mt-3 font-mono text-[10px] text-[#666]">
          artifact schema v{a.schema} · generated {a.generated} · benchmark {a.benchmark.fullName} · grader {a.benchmark.grader.version} ·{" "}
          <Link to="/open-models/audit" className="text-accent hover:underline">
            grading audit →
          </Link>
        </p>
      </Section>
    </div>
  );
}
