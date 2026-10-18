export interface FaqEntry {
  q: string;
  a: string;
}

export const FAQ: FaqEntry[] = [
  {
    q: "What is Seen but Not Grasped?",
    a: "A benchmark of 5,000 real photographs, each with five questions. Every question is answerable from the photograph alone, and every one is designed to be easy for a person and hard for a model. It measures the gap between seeing and understanding.",
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
    q: "Why 5,000 images?",
    a: "Five thousand gives every question family and every image category enough items to be reported on its own, with confidence intervals that survive splitting. A paired design needs about 1,440 items to spot a two-point gap; 5,000 leaves room for the sub-analyses the paper needs.",
  },
  {
    q: "How were the images selected?",
    a: "500 images are selected by hand on the contribution site, under rarity-balanced quotas so no band of the corpus dominates. 4,500 more are picked from the wider corpus by a pre-declared, seeded rule. The selection rule was fixed before question quality was looked at: quality is a fixup gate, never a selection criterion.",
  },
  {
    q: "Who writes the questions?",
    a: "The first 500 images get five questions each, written by the team by hand. The remaining 4,500 start as drafts from the fine-tuned open model, and every generated item is reviewed and fixed up by a person before admission. No unreviewed item enters the set.",
  },
  {
    q: "What is the machine-generated tier of questions, and who reviews it?",
    a: "Drafts come from Gemma 4 31B after fine-tuning on the hand-written set. Every draft goes through a fixup queue where a reviewer edits, accepts or rejects it, and the decision is recorded. The released set labels which tier each question came from.",
  },
  {
    q: "Which model generates questions, and what is fine-tuned on what?",
    a: "Gemma 4 31B is fine-tuned on the 2,500 hand-written items, which is 500 images times five questions. It then drafts items for the wider corpus. The fine-tune and the generation both run on the group's own cluster at no cost.",
  },
  {
    q: "What are the six question families?",
    a: "Counting (exact counts, often under clutter), scene text (signs, plates, receipts), spatial (relative position of two things), attribute binding (which object carries the property), absent entity (questions about things not in the photo), and knowledge boundary (questions the photo cannot supply, scored in their own group). The Questions page shows each with an example.",
  },
  {
    q: "How are images categorized, and who decides a category?",
    a: "Categories describe what a photograph shows: people, sports, indoor, outdoors, food, documents and signs, vehicles, animals, city and architecture, everyday objects. A category is assigned as part of selection and recorded with the image. The taxonomy is open to review while selection is running.",
  },
  {
    q: "Do the categories and the question families line up one to one?",
    a: "No. Families describe what a question tests; categories describe what a photograph shows. A sports photograph can carry a counting question and a spatial one. The Samples page shows the pairing in practice on real photographs.",
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
    a: "Open-weight models run on the group's own cluster, fine-tuning included, at no cost. A costed subset of frontier models runs through APIs. Frontier models are expected to refuse the adversarial probes often, and a refusal is reported rather than used to leave a model out. The full panel is on the Models page.",
  },
  {
    q: "What does the project cost, and where does the money go?",
    a: "The only planned spending is model inference on images. Everything else, from the contribution site to the fine-tune to this website, runs on free tiers or the group's own hardware. Every frontier run is costed before it starts.",
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
    q: "What happens to the rest of the 50,000-image corpus?",
    a: "The wider 50,000-image corpus is planned for release to the community on Hugging Face, so others can build on the same photographs. The 5,000 benchmark images are the curated, frozen subset with reviewed questions.",
  },
  {
    q: "What is the timeline, and what ships when?",
    a: "Results freeze is targeted for 1 November 2026, ahead of the research submission. The Roadmap page shows the order: select and author, fine-tune, generate and fix up, run the panel, then freeze and write.",
  },
  {
    q: "How can I contribute?",
    a: "Technical discussion lives in the project Slack channel, being set up now. The contribution site is where image selection and question authoring happen, with two-person review before anything is approved.",
  },
];
