/**
 * SINGLE SOURCE OF TRUTH for every number on the site. Never write a count twice.
 * Locked 2026-10-18 (owner): one 50,000-image dataset; questions are drafted by the
 * model across the corpus and reviewed/picked by people; 5,000 hand-picked images form
 * the curated benchmark; the remaining 45,000 stay open for the community.
 */
const TOTAL = 50000;
const HAND_PICKED = 5000;

export const FACTS = {
  dataset: {
    total: TOTAL,
    handPicked: HAND_PICKED,
    get communityOpen(): number {
      return TOTAL - HAND_PICKED;
    },
  },
  benchmark: {
    questionsPerImage: 5,
    get qaPairs(): number {
      return HAND_PICKED * this.questionsPerImage;
    },
  },
  generationModel: {
    name: "Gemma 4 31B",
    panelId: "google/gemma-4-31b-it",
    role: "drafts candidate questions across the corpus for review",
  },
  team: {
    names: "Muhammad Maaz · Bilal Jawaid · Osama Farooqi",
    collaborators: "Prof. Rizwan Qureshi · Dr. Shaina Raza, Vector Institute (fairness and bias)",
  },
  freezeTarget: "1 November 2026",
} as const;

/** thousands-separated number for visible copy: 5000 -> "5,000" */
export const n = (x: number) => x.toLocaleString("en-US");
