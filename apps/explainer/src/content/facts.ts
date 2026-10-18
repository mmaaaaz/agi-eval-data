/**
 * SINGLE SOURCE OF TRUTH for every number on the site. Never write a count twice.
 * Locked 2026-10-18: 500 manual, 4,500 selected from the generated pool, 5,000 total.
 */
export const FACTS = {
  benchmark: {
    manual: 500,
    selectedFromGenerated: 4500,
    get total(): number {
      return this.manual + this.selectedFromGenerated;
    },
    questionsPerImage: 5,
    get qaPairs(): number {
      return this.total * this.questionsPerImage;
    },
    families: 6,
  },
  corpus: { size: 50000, communityRelease: "Hugging Face" },
  generationModel: {
    name: "Gemma 4 31B",
    panelId: "google/gemma-4-31b-it",
    role: "fine-tuned on the hand-written set, then used to draft questions for the wider corpus",
  },
  team: {
    names: "Muhammad Maaz · Bilal Jawaid · Osama Farooqi",
    collaborators: "Prof. Rizwan Qureshi · Dr. Shaina Raza, Vector Institute (fairness and bias)",
  },
  freezeTarget: "1 November 2026",
} as const;

/** thousands-separated number for visible copy: 5000 -> "5,000" */
export const n = (x: number) => x.toLocaleString("en-US");
