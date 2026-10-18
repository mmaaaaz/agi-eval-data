export interface FaqEntry {
  q: string;
  a: string;
}

export const FAQ: FaqEntry[] = [
  {
    q: "What is Seen but Not Grasped?",
    a: "A benchmark built on 50,000 real photographs, with about five questions each across the set. Every question is drafted by an open model we run ourselves, and every admitted item is reviewed by a person. 5,000 hand-picked images form the curated benchmark; the rest stay open for the community.",
  },
  {
    q: "What makes it different from other vision benchmarks?",
    a: "The probes sit on named failure modes instead of a single score, so a result explains itself. The protocol also measures things almost no VQA benchmark reports: calibration, a no-image baseline, a constant-answer baseline, and option-order rotation. And every construction decision is logged, so the set can be audited rather than trusted.",
  },
  {
    q: "Why real photographs instead of synthetic or studio images?",
    a: "Studio images and renders remove the clutter, odd lighting and small text where failures actually happen. Our photographs are lived scenes: kitchens, streets, shops, games. A model that can describe a cathedral can still miscount the chairs inside one.",
  },
  {
    q: "Why 5,000 hand-picked images?",
    a: "Five thousand gives every capability, level and domain enough items to be reported with confidence intervals that survive splitting. A paired design needs about 1,440 items to spot a two-point gap; the curated set is sized well past that so each axis clears its own reporting floor.",
  },
  {
    q: "How were the images selected?",
    a: "The model drafts questions across the whole 50,000-image dataset. Reviewers pick the images whose items hold up, under balanced coverage of scene domains (D1 to D11), and 5,000 hand-picked images form the curated benchmark. Selection rules are recorded as they are used.",
  },
  {
    q: "Who writes the questions?",
    a: "The model drafts every candidate; people review and pick. Nothing enters the benchmark without a recorded human review, and no unreviewed item is ever admitted.",
  },
  {
    q: "What happens to a model-drafted question before it enters the set?",
    a: "It goes through review: a person edits, accepts or rejects it, and the decision is recorded. Accepted items carry their capability, level and domain codes.",
  },
  {
    q: "Which model drafts the questions?",
    a: "Gemma 4 31B, run on the group's own cluster. The model proposes; people decide.",
  },
  {
    q: "What do the codes on each item mean?",
    a: "Every item carries a capability code (G1 to G8 for geometry, P1 to P8 for physics, B1 to B4 for bridge pairs, and PERC as a perception control) and a reasoning level (L1 to L5). Every image carries one or more scene domains (D1 to D11). The Taxonomy page lists all of them.",
  },
  {
    q: "How are images tagged?",
    a: "Each image is tagged with one or more scene domains from a closed list of eleven, D1 to D11. Tagging is done by a model looking at the pixels, and domains are used for balanced coverage, never for scoring.",
  },
  {
    q: "What is a bridge pair?",
    a: "Some questions come in pairs on the same object: one asks about the geometry of the layout, its partner asks what would happen physically in that same layout. B1 to B4 name these bridge capabilities, and the pair is scored as one unit.",
  },
  {
    q: "What is the forced-choice design, and why is there no unknown option in those probes?",
    a: "The bias probes show two people and force a choice between them, with no unknown option on purpose. A model that refuses, or says it cannot tell, is doing better than one that makes a confident, stereotype-shaped pick. What gets measured is the model's default association.",
  },
  {
    q: "How are adversarial attacks tested?",
    a: "Some photographs carry text in more than one language, and some carry instructions placed where a model might read them as commands. We report two numbers separately: how often an attack succeeds, and how often the model refuses. Both are results.",
  },
  {
    q: "Which models are being run, and why a mix of open and frontier models?",
    a: "Open-weight models run on the group's own cluster, at no cost. A costed subset of frontier models runs through APIs. Frontier models are expected to refuse the adversarial probes often, and a refusal is reported rather than used to leave a model out. The full panel is on the Models page.",
  },
  {
    q: "What does the project cost, and where does the money go?",
    a: "The only planned spending is model inference on images. Everything else, from the contribution site to this website, runs on free tiers or the group's own hardware. Every frontier run is costed before it starts.",
  },
  {
    q: "How is the evaluation kept honest?",
    a: "Every model answers the same items, and scores come with paired confidence intervals. We also run the no-image baseline, the constant-answer baseline, calibration, option-order rotation and the leakage check. A score that does not survive those tests is not a result.",
  },
  {
    q: "What do ECE and Brier measure?",
    a: "ECE, expected calibration error, measures how far a model's stated confidence is from its actual accuracy. The Brier score is a squared-error scoring rule over the same probabilities. Together they answer one question: does the model know when it is unsure?",
  },
  {
    q: "What happens to the rest of the dataset?",
    a: "The remaining 45,000 images stay open for the community to contribute to, so the same corpus can keep growing beyond the curated benchmark.",
  },
  {
    q: "What is the timeline, and what ships when?",
    a: "Results freeze is targeted for 1 November 2026, ahead of the research submission. The Roadmap page shows the order: draft and review, run the panel, then freeze and write.",
  },
  {
    q: "How can I contribute?",
    a: "Technical discussion lives in the project Slack channel, being set up now. The contribution site is where image selection and question authoring happen, with two-person review before anything is approved.",
  },
];
