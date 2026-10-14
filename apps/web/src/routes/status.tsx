import { createFileRoute } from "@tanstack/react-router";
import { Eyebrow } from "@site/section";

export const Route = createFileRoute("/status")({ component: Status });

type Phase = {
  n: string;
  title: string;
  state: "done" | "open" | "next";
  detail: string;
  evidence: string;
};

const PHASES: Phase[] = [
  {
    n: "01",
    title: "Corpus and ledger",
    state: "done",
    detail:
      "The archive is indexed, deduplicated and published. Every figure on this site is derived from one machine-generated ledger rather than from hand-entered counts.",
    evidence:
      "56,285 items indexed · 55,969 unique images · 56,184 raw image files · 215 duplicate copies removed · 4 videos · 23.45 GB",
  },
  {
    n: "02",
    title: "Dataset integrity audit",
    state: "done",
    detail:
      "We audited our own metadata before trusting it. The long-edge figure that looked like a camera property turned out to be our own resize pass, and the dataset-asset naming that looked like photographic provenance was an artefact of how the archive was assembled.",
    evidence:
      "94.99 → 14.26 GiB · 49,768 files · originals retained as revisions · rollback verified 5/5 byte-perfect",
  },
  {
    n: "03",
    title: "Prior-art survey",
    state: "done",
    detail:
      "Fifteen neighbouring benchmarks mapped field by field, each matched to the specific number in the paper that settles it. Three measurement ideas we had proposed turned out to be published already, and are cited rather than claimed.",
    evidence:
      "Human-authored questions 5 of 15 · real uncurated photographs 5 of 15 · calibration measured 3 of 15 · person-derived unanswerable labels 2 of 15 · person-derived labels with an independent human ceiling 0 of 15",
  },
  {
    n: "04",
    title: "Adjacent-field sweep",
    state: "done",
    detail:
      "Because the prior-art survey showed vision-language evaluation to be crowded, we checked whether physical AI or vision-language-action offered an emptier field. It does not, for two independent reasons. Recorded so the negative result is on file.",
    evidence:
      "Calibration of VLA first-claimed upstream (ICML 2026) · VLA evaluation requires robot rollouts, not photographs · physical reasoning from still images already benchmarked",
  },
  {
    n: "05",
    title: "Question authoring",
    state: "open",
    detail:
      "The gate for the whole project. Nothing downstream — grading, baselines, paper — is interpretable until questions exist and each is authored by a person who can say it has exactly one defensible answer.",
    evidence: "Planned 2,400 questions over 900 images · 15 annotators · 438 human hours",
  },
  {
    n: "06",
    title: "Human grading and ceiling",
    state: "next",
    detail:
      "An independent human ceiling on the same items, by the same procedure, is the first result rather than an appendix. Existing label noise in the field is larger than most model gaps people report.",
    evidence:
      "VQAv2 ten-human agreement 83.3% · 95.8% on yes/no · VQA-Therapy 15.7% multiple groundings, ≈36% multiple valid answers",
  },
  {
    n: "07",
    title: "Baselines and submission",
    state: "next",
    detail:
      "Model evaluation follows the ceiling. The target is a narrow, defensible statistical claim rather than a leaderboard position.",
    evidence: "Target submission 16 Nov 2026",
  },
];

const SCALE = [
  { have: "2,400", what: "questions we intend to author", vs: "2,079 MM-AQA · 1,404 TRAPSBench" },
  { have: "900", what: "images authored by hand", vs: "smaller per-item budget than our comparators" },
  { have: "438 h", what: "total human effort", vs: "5.9 h per person per week across 15 annotators" },
  { have: "$63", what: "machine cost", vs: "grading and inference only" },
];

function Status() {
  return (
    <div className="max-w-4xl">
      <Eyebrow n="10">status</Eyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        What has been explored, and where this stands
      </h1>
      <p className="mt-3 leading-7 text-[#a1a1a1]">
        A running record of the work: what has been examined, what it showed, and what is still
        outstanding. Negative results are included deliberately — a field that was checked and
        ruled out is knowledge, not a gap in the record.
      </p>

      {/* ---------------- phase board ---------------- */}
      <section className="mt-10">
        <h2 className="mb-4 font-medium tracking-tight text-white">Phase board</h2>
        <div className="space-y-3">
          {PHASES.map((p) => (
            <div
              key={p.n}
              className={`rounded-lg border px-5 py-4 ${
                p.state === "done"
                  ? "border-[#134e3a] bg-[#08150f]"
                  : p.state === "open"
                    ? "border-[#5c1f2c] bg-[#1a0d11]"
                    : "border-[#262626]"
              }`}
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-[#ededed]">
                  <span className="font-mono text-[#666]">{p.n}</span> {p.title}
                </span>
                <span
                  className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${
                    p.state === "done" ? "text-[#10b981]" : p.state === "open" ? "text-[#f43f5e]" : "text-[#f59e0b]"
                  }`}
                >
                  {p.state === "done" ? "complete" : p.state === "open" ? "not started" : "queued"}
                </span>
              </div>
              <p className="mt-2 text-[13px] leading-6 text-[#a1a1a1]">{p.detail}</p>
              <p className="mt-2 border-t border-[#1a1a1a] pt-2 font-mono text-[11px] leading-5 text-[#666]">
                {p.evidence}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- what the survey established ---------------- */}
      <section className="mt-12">
        <h2 className="mb-2 font-medium tracking-tight text-white">
          What the prior-art survey established
        </h2>
        <p className="mb-4 leading-7 text-[#a1a1a1]">
          Our own design started from an axis that turned out not to separate the literature.
          Calibration, abstention, selective prediction and self-reported confidence are four
          different quantities, and they could not be applied consistently even across our own
          fifteen. The axis that does separate them is where the unanswerable label comes from.
        </p>
        <div className="overflow-x-auto rounded-lg border border-[#262626]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[#262626] text-left text-[10px] uppercase tracking-wider text-[#666]">
                <th className="px-3 py-2">axis</th>
                <th className="px-3 py-2">held by</th>
                <th className="px-3 py-2">reading</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[#1a1a1a] align-top">
                <td className="px-3 py-2.5 text-[#a1a1a1]">Human-authored questions</td>
                <td className="px-3 py-2.5 font-mono text-[#f59e0b]">5 of 15</td>
                <td className="px-3 py-2.5 text-[#666]">Crowded, and not novel on its own.</td>
              </tr>
              <tr className="border-b border-[#1a1a1a] align-top">
                <td className="px-3 py-2.5 text-[#a1a1a1]">Real, uncurated photographs</td>
                <td className="px-3 py-2.5 font-mono text-[#f59e0b]">5 of 15</td>
                <td className="px-3 py-2.5 text-[#666]">Crowded, and not novel on its own.</td>
              </tr>
              <tr className="border-b border-[#1a1a1a] align-top">
                <td className="px-3 py-2.5 text-[#a1a1a1]">Calibration or abstention measured</td>
                <td className="px-3 py-2.5 font-mono text-[#f59e0b]">3 of 15</td>
                <td className="px-3 py-2.5 text-[#666]">A deliberately loose column; four different quantities.</td>
              </tr>
              <tr className="border-b border-[#1a1a1a] align-top">
                <td className="px-3 py-2.5 text-[#a1a1a1]">Unanswerable label decided by a person</td>
                <td className="px-3 py-2.5 font-mono text-[#f59e0b]">2 of 15</td>
                <td className="px-3 py-2.5 text-[#666]">Everyone else derives it by edit, generator or model.</td>
              </tr>
              <tr className="border-b border-[#1a1a1a] bg-[#08150f] align-top">
                <td className="px-3 py-2.5 text-[#ededed]">
                  Person-derived labels on photographs, with an independent human ceiling
                </td>
                <td className="px-3 py-2.5 font-mono text-[#10b981]">0 of 15</td>
                <td className="px-3 py-2.5 text-[#a1a1a1]">
                  The claim we can make — and we make it as a sample-size argument, not a priority claim.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] leading-6 text-[#a1a1a1]">
          The nearest counterexample holds 300 scored cells from a single author at a single campus,
          and reports no annotator agreement. That is a sample-size observation, and it survives
          new publications in the field. Full working on the{" "}
          prior-art page.
        </p>
      </section>

      {/* ---------------- the ruled-out field ---------------- */}
      <section className="mt-12">
        <h2 className="mb-2 font-medium tracking-tight text-white">
          A field checked and ruled out
        </h2>
        <p className="mb-4 leading-7 text-[#a1a1a1]">
          With vision-language evaluation crowded, the adjacent physical-AI and
          vision-language-action literature was examined as a possible move. Two independent
          findings closed it.
        </p>
        <div className="space-y-3">
          <div className="rounded-lg border border-[#5c1f2c] bg-[#1a0d11] px-5 py-4">
            <p className="text-sm text-[#ededed]">The idea is already claimed there</p>
            <p className="mt-2 text-[13px] leading-6 text-[#a1a1a1]">
              Confidence calibration of vision-language-action models carries an explicit
              first-claim at ICML 2026, alongside several concurrent uncertainty and
              failure-prediction works. Moving fields would have meant re-proposing an
              announced result.
            </p>
          </div>
          <div className="rounded-lg border border-[#5c1f2c] bg-[#1a0d11] px-5 py-4">
            <p className="text-sm text-[#ededed]">The data type does not fit</p>
            <p className="mt-2 text-[13px] leading-6 text-[#a1a1a1]">
              These models emit motor commands, and their benchmarks roll out robots. A unified
              harness, two safety benchmarks and a public leaderboard already exist, none of which
              use uncurated photographs. The retreat to physical reasoning from still images is
              likewise already benchmarked.
            </p>
          </div>
        </div>
        <p className="mt-4 text-[13px] leading-6 text-[#a1a1a1]">
          Calibration turned out to be a shared concern of vision-language, physical reasoning and
          robotics at the same time, so every escape route led back to occupied ground. Full
          reasoning and sources on the{" "}
          alternatives page.
        </p>
      </section>

      {/* ---------------- planned scale ---------------- */}
      <section className="mt-12">
        <h2 className="mb-2 font-medium tracking-tight text-white">Planned scale</h2>
        <p className="mb-4 leading-7 text-[#a1a1a1]">
          The benchmark is smaller than a general VQA set by design. It measures a different
          quantity, one that converges quickly, so the sample is set by statistical power rather
          than by taste.
        </p>
        <div className="overflow-x-auto rounded-lg border border-[#262626]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[#262626] text-left text-[10px] uppercase tracking-wider text-[#666]">
                <th className="px-3 py-2">planned</th>
                <th className="px-3 py-2">what it is</th>
                <th className="px-3 py-2">against</th>
              </tr>
            </thead>
            <tbody>
              {SCALE.map((s) => (
                <tr key={s.have} className="border-b border-[#1a1a1a] last:border-b-0 align-top">
                  <td className="px-3 py-2.5 font-mono text-[#ededed]">{s.have}</td>
                  <td className="px-3 py-2.5 text-[#a1a1a1]">{s.what}</td>
                  <td className="px-3 py-2.5 text-[#666]">{s.vs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- provenance caveat ---------------- */}
      <section className="mt-12 rounded-lg border border-[#262626] bg-[#0a0a0a] px-5 py-5">
        <h2 className="font-medium tracking-tight text-white">A caveat on the corpus figures</h2>
        <p className="mt-3 text-sm leading-7 text-[#a1a1a1]">
          The archive is a collection of real personal photographs, and describing it honestly
          requires saying what that does <em>not</em> establish. Roughly 31% of files are
          identifiable as photographic by filename convention; about 19% carry dataset-asset naming
          rather than camera naming; only 1% carry a camera model in metadata. The remainder is
          <em> unresolved, not disproven</em> — some are screenshots, some are camera photographs
          with unhelpful filenames, and separating the two needs one human check per image. We
          describe the corpus as images and give the provenance breakdown rather than asserting a
          photography fraction we cannot support.
        </p>
      </section>

    </div>
  );
}