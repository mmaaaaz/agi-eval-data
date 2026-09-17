import { createFileRoute, Link } from "@tanstack/react-router";
import { useOM } from "./open-models";
import { Dot, ModeBadge, Panel, Section, Tile, TileGrid } from "../components/open-models/ui";
import { fmtInt, pct, ranked, signed } from "../lib/openModelsFmt";

export const Route = createFileRoute("/open-models/method")({ component: Method });

export function Method() {
  const a = useOM();
  const order = ranked(a.models);
  const pair = a.integrity.gtPairing;
  const paired = pair.mismatch === 0 && pair.missing === 0;
  const oddDomains = a.domains.filter((d) => (d.per[0]?.images ?? 0) !== a.integrity.evaluatedPerDomain);
  const smallDomains = a.domains.filter((d) => d.n !== a.domains[0].n);
  const levelNs = a.models.map((m) => m.totals.levels[0]?.n ?? 0);
  const balanced = new Set(levelNs).size === 1;
  const disagreements = a.models.reduce((s, m) => s + m.classes.reduce((x, c) => x + c.n, 0), 0);
  const ruleAcc = order.map((m) => m.totals.acc ?? 0);
  const ownAcc = order.map((m) => m.totals.as ?? 0);
  const worstDrift = Math.max(...ownAcc.map((v, i) => v - ruleAcc[i]));
  const halfWidth = (n: number, p: number) => 1.959964 * Math.sqrt((p * (1 - p)) / n);

  return (
    <div>
      <Section eyebrow="01 rule" title="The frozen grading rule" hint="Published once, applied to every answer of every run, unchanged between runs.">
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
        hint="All of it re-derived from the raw runs by scripts/open_models_bake.py — the same code that produced this artifact, and which refuses to write when an invariant fails."
      >
        <TileGrid cols={3}>
          <Tile
            label="answers re-graded"
            value={fmtInt(a.models.reduce((s, m) => s + m.totals.n, 0))}
            sub={a.models.length + " runs × ~" + fmtInt(a.benchmark.questionsPerModel) + " questions"}
          />
          <Tile label="duplicate question ids" value={fmtInt(a.integrity.dupIds)} accent="#9fd8b4" sub="every id unique within a run" />
          <Tile
            label="levels balanced"
            value={balanced ? "yes" : "per run"}
            accent="#9fd8b4"
            sub={
              balanced
                ? fmtInt(levelNs[0]) + " questions per level in every run"
                : "run to run: " + fmtInt(Math.min(...levelNs)) + "–" + fmtInt(Math.max(...levelNs)) + " per level"
            }
          />
          <Tile
            label="paired across runs"
            value={paired ? "yes" : "no"}
            accent={paired ? "#9fd8b4" : "#f0a5a5"}
            sub={fmtInt(pair.checked) + " questions share one ground truth · " + fmtInt(pair.mismatch) + " mismatches"}
          />
          <Tile label="disagreements categorised" value={fmtInt(disagreements)} sub="every harness/rule disagreement classified and sampled" />
          <Tile label="hand-transcribed numbers" value="0" accent="#9fd8b4" sub="every figure on the site is computed at render time" />
        </TileGrid>
      </Section>

      <Section
        eyebrow="03 field"
        title="The runs in this report"
        hint="Card fields come from each model's official Hugging Face page; “mode” is recorded only where the model name states it."
      >
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-widest text-[#666]">
                  <th className="px-3 py-2 font-normal">run</th>
                  <th className="px-3 py-2 font-normal">organisation</th>
                  <th className="px-3 py-2 text-right font-normal">params</th>
                  <th className="px-3 py-2 font-normal">licence</th>
                  <th className="px-3 py-2 text-right font-normal">released</th>
                  <th className="px-3 py-2 text-right font-normal">questions</th>
                  <th className="px-3 py-2 text-right font-normal">accuracy</th>
                  <th className="px-3 py-2 font-normal">links</th>
                </tr>
              </thead>
              <tbody>
                {order.map((m) => (
                  <tr key={m.id} className="border-t border-[#141414]">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <Link to="/open-models/models/$id" params={{ id: m.id }} className="inline-flex items-center gap-2 text-[12.5px] text-[#ededed] hover:text-accent">
                        <Dot color={m.accent} size={6} />
                        {m.label}
                        <ModeBadge mode={m.meta.mode} />
                      </Link>
                    </th>
                    <td className="px-3 py-2 font-mono text-[11px] text-[#a1a1a1]">{m.meta.org ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] text-[#a1a1a1]">
                      {m.meta.params ?? "—"}
                      {m.meta.activeParams ? <span className="block text-[9px] text-[#555]">{m.meta.activeParams}</span> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10.5px] text-[#a1a1a1]">{m.meta.license ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] text-[#a1a1a1]">{m.meta.released ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[#a1a1a1]">{fmtInt(m.totals.n)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums" style={{ color: m.accent }}>
                      {pct(m.totals.acc, 2)}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px]">
                      {m.meta.links?.huggingface && (
                        <a href={m.meta.links.huggingface} target="_blank" rel="noopener noreferrer" className="text-[#a1a1a1] hover:text-accent">
                          weights ↗
                        </a>
                      )}
                      {m.meta.links?.paper && (
                        <a href={m.meta.links.paper} target="_blank" rel="noopener noreferrer" className="ml-2 text-[#a1a1a1] hover:text-accent">
                          paper ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </Section>

      <Section eyebrow="04 certainty" title="Exact, rule-dependent, estimated">
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#9fd8b4]">exact</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              Counts, per-domain / level / family accuracies, guessing shares, single-answer detection, coverage and no-usable-answer rates —
              integer tallies over complete files, re-derivable with the bake script.
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#f0c98a]">rule-dependent</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              Accuracy itself, because “correct” needs a stated comparison rule. The published rule gives{" "}
              {pct(ruleAcc[ruleAcc.length - 1], 2)}–{pct(ruleAcc[0], 2)} across the field
              {"; each run's own harness gives " + pct(ownAcc[ownAcc.length - 1], 2) + "–" + pct(ownAcc[0], 2) + ". That spread — up to " +
                signed(worstDrift, 2) + " on one run — is the honest uncertainty on any single number here, and it is why the rule is published rather than assumed."}
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="font-mono text-[9px] uppercase tracking-widest text-[#a1a1a1]">estimated</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a1a1a1]">
              Sampling error, if the evaluated subset was drawn at random. At n = {fmtInt(a.domains[0].n)} and p ≈ 0.35 the 95% interval is ±
              {(halfWidth(a.domains[0].n, 0.35) * 100).toFixed(1)} points; for {smallDomains[0]?.label ?? "the smaller domain"} (n ={" "}
              {fmtInt(smallDomains[0]?.n ?? 5000)}) it is ±{(halfWidth(smallDomains[0]?.n ?? 5000, 0.35) * 100).toFixed(1)}. Gaps under ~1.5
              points between runs are noise.
            </p>
          </Panel>
        </div>
      </Section>

      <Section eyebrow="05 caveats" title="Read these before quoting a number">
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="p-4">
            <ul className="space-y-2.5 text-[12.5px] leading-relaxed text-[#a1a1a1] [&_b]:text-[#ededed]">
              <li>
                <b>Half sample.</b> Files are named <code className="font-mono text-[11px]">*_dataset_3000</code> but carry{" "}
                {fmtInt(a.integrity.evaluatedPerDomain)} distinct images per domain (ids span 1–{a.integrity.nominalPerDomain}). Full-set
                numbers will move.
              </li>
              <li>
                <b>Slightly uneven runs.</b>{" "}
                {oddDomains.length
                  ? oddDomains
                      .map((d) => {
                        const counts = [...new Set(d.per.map((p) => p.images))].sort((x, y) => y - x);
                        return (
                          d.label +
                          ": " +
                          counts
                            .map((c) => {
                              const runs = d.per.filter((p) => p.images === c).length;
                              return fmtInt(c) + " images (" + runs + " run" + (runs === 1 ? "" : "s") + ")";
                            })
                            .join(" / ")
                        );
                      })
                      .join("; ") + " — "
                  : "All runs cover the same slices — "}
                {a.benchmark.questionsRange[0] === a.benchmark.questionsRange[1]
                  ? "identical totals."
                  : fmtInt(a.benchmark.questionsRange[0]) + " vs " + fmtInt(a.benchmark.questionsRange[1]) +
                    " questions overall. The difference is 5 questions and moves no ranking, but the newer runs are the fuller ones."}
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
                <b>Structured ground truth.</b> {a.audit.zeroHarness.filter((z) => z.kind === "structured").length} domain-levels store their
                answer as a dict or list; a plain string comparison scores them zero and the frozen rule only partly repairs that. Their true
                difficulty is unknown until the harness is fixed.
              </li>
              <li>
                <b>Multi-part credit.</b> {a.audit.zeroHarness.filter((z) => z.kind === "multipart").length} levels use semicolon-separated
                answers where runs supply one part; the frozen rule awards no accuracy there, only half marks.
              </li>
              <li>
                <b>Single-answer levels.</b> {a.audit.constantLevels.length} levels have one ground truth for all images, and at L5 the
                guessing floor ({pct(a.models[0].totals.levels[4]?.oracle ?? null, 1)}) is ahead of every run. Exclude them before
                making any claim about L5.
              </li>
              <li>
                <b>Upstream drift.</b> The dataset was regenerated after these runs:{" "}
                {pct(a.integrity.gtDrift.mismatch / Math.max(1, a.integrity.gtDrift.checked), 1)} of question ids now carry a different
                ground truth upstream. Grading here always uses the truth each run recorded, so the comparison stays paired.
              </li>
            </ul>
          </Panel>
        </div>
      </Section>

      <Section
        eyebrow="06 reproduce"
        title="From raw runs to this page"
        hint="The raw JSONL (hundreds of MB) is not committed; the baked artifact is, and the site reads it directly."
      >
        <Panel className="p-4">
          <ol className="space-y-3 font-mono text-[11.5px] leading-relaxed text-[#a1a1a1]">
            <li>
              <span className="text-[#666]">01</span> drop each run into{" "}
              <code className="text-white">data/open-model-analysis/&lt;run&gt;/&lt;model-id&gt;/*.jsonl</code> (one file per domain)
            </li>
            <li>
              <span className="text-[#666]">02</span> fill its card in <code className="text-white">data/open-models/models.meta.json</code> —
              the bake seeds the entry, with params and licence from the model's Hugging Face page
            </li>
            <li>
              <span className="text-[#666]">03</span> <code className="text-white">bun run data:open-models</code> — grades every answer,
              checks domain coverage, level balance and cross-run pairing, then writes the artifact
            </li>
            <li>
              <span className="text-[#666]">04</span> commit and push to <code className="text-white">main</code> — CI deploys the site and
              this page picks the artifact up with no code change
            </li>
          </ol>
          <p className="mt-4 border-t border-[#1c1c1e] pt-3 font-mono text-[10px] leading-relaxed text-[#666]">
            Adding a model is a data change, not a code change: the leaderboard, difficulty curve, family matrix, winner map, domain table
            and every “wins” count derive from the artifact's model list.
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
