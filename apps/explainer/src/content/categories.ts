export interface Category {
  id: string;
  label: string;
  note: string;
  planned: boolean;
}

/** Draft taxonomy, pending the owner's sign-off. Marked "planned" on the site
 *  until the dataset ledger actually carries categories. */
export const CATEGORIES: Category[] = [
  { id: "people", label: "people", note: "single and multi-actor scenes; the home of the bias probes", planned: true },
  { id: "sports", label: "sports", note: "motion, equipment, referee signals, crowd text", planned: true },
  { id: "indoor", label: "indoor", note: "clutter, occlusion, small text on household objects", planned: true },
  { id: "outdoors", label: "outdoors", note: "scale, horizon, terrain and weather cues", planned: true },
  { id: "food", label: "food", note: "counting and portion-scale questions", planned: true },
  { id: "documents-signs", label: "documents and signs", note: "the scene-text pressure test", planned: true },
  { id: "vehicles", label: "vehicles and transport", note: "plates, lights, relative position on roads", planned: true },
  { id: "animals", label: "animals", note: "counts under motion and camouflage", planned: true },
  { id: "city-architecture", label: "city and architecture", note: "geometry, perspective, repetition", planned: true },
  { id: "everyday-objects", label: "everyday objects", note: "attribute binding and absent-entity probes", planned: true },
];
