/**
 * MIRROR of the project's closed sets. Source of truth:
 *   capabilities + levels: scripts/harness/taxonomy.py
 *   domain labels:         scripts/factory/04_tag_ground.py
 * scripts/factory/17_explainer_taxonomy.py fails CI if this file drifts.
 * The words "category" and "type" are not used here on purpose (see the glossary).
 */
export interface CodeEntry {
  id: string;
  label: string;
  note: string;
}
export interface CodeGroup {
  id: string;
  label: string;
  note: string;
  codes: CodeEntry[];
}

export const CAPABILITY_GROUPS: CodeGroup[] = [
  {
    id: "geometry",
    label: "Geometry",
    note: "what the layout of the scene is",
    codes: [
      { id: "G1", label: "depth and occlusion", note: "which object is closer, or what is in front of what" },
      { id: "G2", label: "relative size and distance", note: "which of two objects is larger in real life, or farther" },
      { id: "G3", label: "shape and structure", note: "the shape of an object, or how many faces or sides it has" },
      { id: "G4", label: "lines and angles", note: "whether two edges are parallel or perpendicular, or roughly what angle" },
      { id: "G5", label: "perspective and viewpoint", note: "whether the camera was tilted up or down, or where lines converge" },
      { id: "G6", label: "spatial layout", note: "left, right, above, below, inside, or along" },
      { id: "G7", label: "symmetry and pattern", note: "whether something is symmetric, or whether a pattern repeats" },
      { id: "G8", label: "fit and clearance", note: "whether one thing would fit under, through or inside another" },
    ],
  },
  {
    id: "physics",
    label: "Physics",
    note: "what would happen, and why",
    codes: [
      { id: "P1", label: "material properties", note: "whether something is rigid or flexible, heavy or light, fragile" },
      { id: "P2", label: "support and stability", note: "what holds something up, or whether it would stay standing" },
      { id: "P3", label: "contact and containment", note: "what touches what, or what is inside what" },
      { id: "P4", label: "forces and load paths", note: "where the weight goes, or which part is in tension" },
      { id: "P5", label: "dynamics and prediction", note: "what would happen if something were pushed, dropped or released" },
      { id: "P6", label: "light and shadow", note: "where the light comes from, or which way shadows fall" },
      { id: "P7", label: "fluids, air and heat", note: "which way a liquid would flow, or where a gas goes" },
      { id: "P8", label: "function and affordance", note: "what a part is for, or how it would be used" },
    ],
  },
  {
    id: "bridge",
    label: "Bridge pairs",
    note: "geometry and physics asked of the same object, scored as one pair",
    codes: [
      { id: "B1", label: "tipping and balance", note: "where the centre of mass sits relative to the base" },
      { id: "B2", label: "shadows as a sun cue", note: "which way shadows fall, and therefore where the sun is" },
      { id: "B3", label: "rolling and sliding", note: "which way a surface slopes, and which way something would move" },
      { id: "B4", label: "passage and collision", note: "whether a gap is wider than an object, and whether it would pass" },
    ],
  },
  {
    id: "control",
    label: "Control",
    note: "perception-only rungs, kept separate from the reasoning score",
    codes: [
      { id: "PERC", label: "perception only", note: "what is present; the control rung" },
    ],
  },
];

export const LEVELS: CodeEntry[] = [
  { id: "L1", label: "perception only", note: "is there a box on top" },
  { id: "L2", label: "one judgement", note: "is the forklift closer than the SUV" },
  { id: "L3", label: "two linked steps", note: "which way does the road curve after the median ends" },
  { id: "L4", label: "prediction or counterfactual", note: "would the overhead guard hit the canopy" },
  { id: "L5", label: "multi-step plus outside knowledge", note: "why is the frame triangulated" },
];

export const DOMAINS: CodeEntry[] = [
  { id: "D1", label: "urban streets and roads", note: "" },
  { id: "D2", label: "transport hubs and vehicles", note: "" },
  { id: "D3", label: "architecture and buildings", note: "" },
  { id: "D4", label: "religious and cultural sites", note: "" },
  { id: "D5", label: "health and medical settings", note: "" },
  { id: "D6", label: "engineering, tech and expos", note: "" },
  { id: "D7", label: "markets, food and retail", note: "" },
  { id: "D8", label: "indoor home and office", note: "" },
  { id: "D9", label: "nature and agriculture", note: "" },
  { id: "D10", label: "crowds and events", note: "" },
  { id: "D11", label: "industrial and construction", note: "" },
];
