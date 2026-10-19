export interface Milestone {
  id: string;
  title: string;
  window: string;
  items: string[];
  confirm: boolean;
}

export const MILESTONES: Milestone[] = [
  {
    id: "m1",
    title: "Draft across the corpus",
    window: "now",
    confirm: true,
    items: [
      "Gemma 4 31B drafts candidate questions for photographs across all 50,000",
      "every candidate tagged with its capability, level and scene domain",
    ],
  },
  {
    id: "m2",
    title: "Review and pick the curated set",
    window: "now",
    confirm: true,
    items: [
      "people review, edit, accept or reject, with the decision recorded",
      "5,000 hand-picked images form the curated benchmark",
    ],
  },
  {
    id: "m3",
    title: "Run the model panel",
    window: "next",
    confirm: true,
    items: [
      "open-weight tier on the group's own cluster",
      "costed frontier subset through APIs",
      "two-tier human baseline",
    ],
  },
  {
    id: "m4",
    title: "Probe bias, adversarial and honesty",
    window: "next",
    confirm: true,
    items: [
      "forced-choice and story probes, with fairness expertise",
      "multilingual and injection probes, both numbers reported",
      "calibration, baselines and option rotation on every score",
    ],
  },
  {
    id: "m5",
    title: "Freeze and write",
    window: "then",
    confirm: true,
    items: [
      "hash the frozen release",
      "analyses with paired intervals and calibration",
      "paper draft and submission preparation",
    ],
  },
];
