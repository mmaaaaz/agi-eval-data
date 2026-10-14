import { createFileRoute, Link } from "@tanstack/react-router";
import { Eyebrow } from "@site/section";

export const Route = createFileRoute("/contribute/rules")({ component: Rules });

/**
 * The six writing rules, with a worked example each.
 *
 * This page exists because the alternative is a 30-minute briefing per contributor
 * that nobody can refer back to. Everything here is enforced somewhere downstream
 * and points at the mechanism, so a contributor can see WHY a rule exists rather
 * than taking it on faith.
 */

interface Rule {
  n: number;
  title: string;
  body: string;
  good: string;
  bad: string;
  enforced: string;
}

const RULES: Rule[] = [
  {
    n: 1,
    title: "The image must be necessary",
    body: "If someone can answer it from the words alone, the item measures language priors, not vision. It gets rewritten or dropped.",
    good: "Would the forklift's overhead guard clear the canopy's front edge?",
    bad: "What colour are most forklifts in this kind of photograph?",
    enforced: "The blind filter asks every item of a text-only model with the image withheld. Over 5% solvable fails the gate at C4.1.",
  },
  {
    n: 2,
    title: "Exactly one defensible answer",
    body: "If two careful people can argue for two different options, the item is noise. Rewrite it, or drop it.",
    good: "Which is closer to the camera: the forklift or the white SUV?",
    bad: "Is the space under the canopy big enough for a vehicle?",
    enforced: "Every test-split item is reviewed, and a second reviewer audits a sample. Agreement is reported, and C5.1 requires 15% of the set to be double-annotated.",
  },
  {
    n: 3,
    title: "No dense counting, no metric guesses",
    body: "Counting a crowd is not a reasoning task, and a distance is only meaningful if something visible sets the scale.",
    good: "How many round pressure gauges are on the top front panel?",
    bad: "How many people are in the plaza? / How wide is the road?",
    enforced: "C2.5 — a numeric answer must carry a tolerance, and the gate refuses one without it.",
  },
  {
    n: 4,
    title: "Distractors must be plausible and the same shape",
    body: "An option that reads differently from the others gives the answer away. Keep length, style and specificity equal.",
    good: "A) The front, lower part; yes, its struts cross in front of the drone",
    bad: "A) Triangles  B) Squares that cannot be 3D printed at all in practice  C) Hexagons  D) Circles",
    enforced: "C2.14 checks that the correct answer is not always in the same position; C2.15 that it is not systematically the longest option; C2.16 that option lengths are comparable within an item.",
  },
  {
    n: 5,
    title: "Name things by position or appearance",
    body: "Never use a word that hands over the answer, and never a word that only makes sense if you already know the scene.",
    good: "the yellow forklift / the person in the black T-shirt",
    bad: "the unstable stack / the suicide bomber",
    enforced: "Bias probes exist precisely to catch a question that assumes something the image does not show.",
  },
  {
    n: 6,
    title: "Mark the anchor, and pair the bridge items",
    body: "The anchor is the one object the question is about. Every bridge item is one half of a pair on that same object — geometry and physics, side by side.",
    good: "Anchor the canopy edge, ask whether the guard clears it, then ask what touches the floor first.",
    bad: "Two questions about two different objects, filed as if they were a pair.",
    enforced: "C2.12 fails a bridge item with no pair; C2.13 flags a pair missing its geometry or physics probe.",
  },
];

const FORMATS: { name: string; example: string }[] = [
  {
    name: "Multiple choice (about half of the set)",
    example: "What is inside the spherical frame on the table?  A) A drone  B) A lamp  C) A ball  D) Nothing",
  },
  {
    name: "Yes / no",
    example: "Is the top of the forklift's overhead guard lower than the underside of the canopy's front edge?",
  },
  {
    name: "Numeric, with a tolerance",
    example: "How many round pressure gauges are on the top front panel?  (tolerance 0 — an exact count)",
  },
  {
    name: "Open-ended, graded with a rubric",
    example: "Explain how the cage protects the drone if it flies into a wall.",
  },
];

const LEVELS = [
  { id: "L1", what: "perception only", example: "is there a box on top" },
  { id: "L2", what: "one judgement", example: "is the forklift closer than the SUV" },
  { id: "L3", what: "two linked steps", example: "which way does the road curve after the median ends" },
  { id: "L4", what: "prediction or counterfactual", example: "would the overhead guard hit the canopy" },
  { id: "L5", what: "multi-step plus outside knowledge", example: "why is the frame triangulated" },
];

function Rules() {
  return (
    <div className="max-w-3xl">
      <Eyebrow n="04">contribute</Eyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-white">The six writing rules</h1>
      <p className="mt-2 font-mono text-[11px] leading-5 text-[#a1a1a1]">
        Read this once. It takes five minutes and it is the difference between an item that
        survives review and one that costs a reviewer three minutes to reject.
      </p>

      <div className="mt-4 rounded-lg border border-[#f59e0b]/40 bg-[#f59e0b]/5 p-3">
        <p className="font-mono text-[11px] leading-5 text-[#f59e0b]">
          Authoring needs a keyboard and a screen you can zoom into. It is deliberately not
          supported on a phone — judging whether a forklift clears a canopy is not a phone
          task, and a half-finished attempt is worse than none.
        </p>
      </div>

      <div className="mt-8 space-y-6">
        {RULES.map((r) => (
          <section key={r.n} className="rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-4">
            <h2 className="text-sm font-semibold text-white">
              <span className="mr-2 font-mono text-[#0b5fff]">{r.n}</span>
              {r.title}
            </h2>
            <p className="mt-1 text-[13px] leading-6 text-[#a1a1a1]">{r.body}</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div className="rounded-md border border-[#0cce6b]/40 bg-[#0cce6b]/5 p-2.5">
                <span className="block font-mono text-[9px] uppercase tracking-wider text-[#0cce6b]">good</span>
                <p className="mt-1 font-mono text-[11px] leading-5 text-[#ededed]">{r.good}</p>
              </div>
              <div className="rounded-md border border-danger/40 bg-danger/5 p-2.5">
                <span className="block font-mono text-[9px] uppercase tracking-wider text-danger">avoid</span>
                <p className="mt-1 font-mono text-[11px] leading-5 text-[#ededed]">{r.bad}</p>
              </div>
            </div>
            <p className="mt-2 font-mono text-[10px] leading-4 text-[#666]">
              enforced by: {r.enforced}
            </p>
          </section>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold tracking-tight text-white">The paired probe</h2>
      <p className="mt-2 text-[13px] leading-6 text-[#a1a1a1]">
        This is the one thing that makes this benchmark different, so it is worth two extra
        minutes per image. A <strong className="text-white">bridge</strong> item is always one
        half of a pair on the <em>same object in the same photograph</em>:
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-md border border-[#262626] bg-[#050505] p-3">
          <span className="block font-mono text-[9px] uppercase tracking-wider text-[#666]">geometry probe</span>
          <p className="mt-1 font-mono text-[11px] leading-5 text-[#ededed]">
            Is the top of the forklift's overhead guard lower than the underside of the canopy's front edge?
          </p>
        </div>
        <div className="rounded-md border border-[#262626] bg-[#050505] p-3">
          <span className="block font-mono text-[9px] uppercase tracking-wider text-[#666]">physics probe</span>
          <p className="mt-1 font-mono text-[11px] leading-5 text-[#ededed]">
            If the forklift drove straight under the canopy, would its overhead guard hit the roof?
          </p>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto rounded-md border border-[#262626]">
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="bg-[#0a0a0a] text-left text-[#666]">
              <th className="p-2">geometry</th>
              <th className="p-2">physics</th>
              <th className="p-2">what it means</th>
            </tr>
          </thead>
          <tbody className="text-[#a1a1a1]">
            <tr className="border-t border-[#262626]"><td className="p-2 text-[#0cce6b]">right</td><td className="p-2 text-[#0cce6b]">right</td><td className="p-2">understands it</td></tr>
            <tr className="border-t border-[#262626]"><td className="p-2 text-[#0cce6b]">right</td><td className="p-2 text-danger">wrong</td><td className="p-2">sees the layout, reasons badly about it</td></tr>
            <tr className="border-t border-[#262626]"><td className="p-2 text-danger">wrong</td><td className="p-2 text-danger">wrong</td><td className="p-2">never saw it, or misjudged the geometry</td></tr>
            <tr className="border-t border-[#262626]"><td className="p-2 text-danger">wrong</td><td className="p-2 text-[#0cce6b]">right</td><td className="p-2">guessing from priors</td></tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-mono text-[10px] text-[#666]">
        Add a perception probe ("is there a forklift?") and a wrong geometry answer can be
        split into "did not see" and "saw but misjudged".
      </p>

      <h2 className="mt-10 text-lg font-semibold tracking-tight text-white">Formats</h2>
      <div className="mt-2 space-y-2">
        {FORMATS.map((f) => (
          <div key={f.name} className="rounded-md border border-[#262626] bg-[#050505] p-3">
            <span className="block font-mono text-[10px] uppercase tracking-wider text-[#666]">{f.name}</span>
            <p className="mt-1 font-mono text-[11px] leading-5 text-[#ededed]">{f.example}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold tracking-tight text-white">Levels</h2>
      <div className="mt-2 space-y-1">
        {LEVELS.map((l) => (
          <div key={l.id} className="flex gap-3 font-mono text-[11px]">
            <span className="w-8 shrink-0 text-[#0b5fff]">{l.id}</span>
            <span className="w-56 shrink-0 text-[#ededed]">{l.what}</span>
            <span className="text-[#666]">e.g. {l.example}</span>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-4">
        <p className="font-mono text-[11px] leading-5 text-[#a1a1a1]">
          Ready? Your batch is a bounded set of images chosen so two contributors never write
          about the same one.
        </p>
        <Link
          to="/contribute"
          className="mt-3 inline-block rounded-lg bg-white px-4 py-2 font-mono text-xs font-semibold text-black"
        >
          go to my batch
        </Link>
      </div>
    </div>
  );
}
