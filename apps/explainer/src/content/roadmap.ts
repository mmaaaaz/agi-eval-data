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
    title: "Select and author the manual tier",
    window: "now",
    confirm: true,
    items: [
      "select 500 photographs on the contribution site",
      "write five questions per image, one capability each",
    ],
  },
  {
    id: "m2",
    title: "Fine-tune Gemma 4 31B",
    window: "next",
    confirm: true,
    items: [
      "fine-tune on the hand-authored items",
      "check drafts against the fixup gate",
    ],
  },
  {
    id: "m3",
    title: "Generate, select, fix up the second tier",
    window: "next",
    confirm: true,
    items: [
      "draft questions across the wider corpus",
      "select 4,500 by the pre-declared seeded rule",
      "human fixup on every admitted item",
    ],
  },
  {
    id: "m4",
    title: "Run the model panel",
    window: "then",
    confirm: true,
    items: [
      "open-weight tier on the group's cluster",
      "costed frontier subset through APIs",
      "two-tier human baseline",
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
