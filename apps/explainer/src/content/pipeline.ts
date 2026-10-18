import { FACTS, n } from "./facts";

export interface PipelineStep {
  n: string;
  title: string;
  note: string;
}

export const PIPELINE: PipelineStep[] = [
  {
    n: "01",
    title: "Draft across the dataset.",
    note: `${FACTS.generationModel.name} drafts candidate questions for photographs across the whole corpus.`,
  },
  {
    n: "02",
    title: "Tag every candidate.",
    note: "Each candidate carries its capability code, its reasoning level and the image's scene domain.",
  },
  {
    n: "03",
    title: "Review and pick.",
    note: `People review candidates and pick the ones that enter the benchmark. ${n(FACTS.dataset.handPicked)} hand-picked images form the curated set.`,
  },
  {
    n: "04",
    title: "Fix up.",
    note: "Editors repair wording and ground truth. No item enters the set unreviewed.",
  },
  {
    n: "05",
    title: "Leave the rest open.",
    note: `The remaining ${n(FACTS.dataset.communityOpen)} images stay open for the community to contribute to.`,
  },
  {
    n: "06",
    title: "Freeze, then evaluate.",
    note: "The frozen release is hashed, and the model panel runs against it alone.",
  },
];
