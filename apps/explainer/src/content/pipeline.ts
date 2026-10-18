import { FACTS, n } from "./facts";

export interface PipelineStep {
  n: string;
  title: string;
  note: string;
}

export const PIPELINE: PipelineStep[] = [
  {
    n: "01",
    title: "Select the 500.",
    note: "A rarity-stratified, logged choice, so no band of the corpus dominates.",
  },
  {
    n: "02",
    title: "Write five questions per image.",
    note: "One capability each, with ground truth and a recorded reason for every exclusion.",
  },
  {
    n: "03",
    title: "Fine-tune an open model on the hand-written set.",
    note: `${FACTS.generationModel.name} is the current target; the 500 × 5 authored items become its training data.`,
  },
  {
    n: "04",
    title: "Generate questions across the wider corpus.",
    note: "The fine-tuned model drafts items for the remaining photographs.",
  },
  {
    n: "05",
    title: `Select ${n(FACTS.benchmark.selectedFromGenerated)} more by a fixed rule.`,
    note: "A pre-declared, seeded allocation picks the images. Question quality is a fixup gate, never a selection criterion.",
  },
  {
    n: "06",
    title: "Fix up and verify everything generated.",
    note: "No item enters the set unreviewed.",
  },
  {
    n: "07",
    title: "Freeze, then evaluate.",
    note: "The frozen release is hashed, and the model panel runs against it alone.",
  },
];
