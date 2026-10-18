// The panel is READ from the harness's dated snapshot. The site never duplicates
// or rewrites model data; a new release is a one-line edit in scripts/harness/models.json.
import panel from "../../../../scripts/harness/models.json";
import { MODEL_STATUS, DEFAULT_STATUS } from "./modelStatus";

export interface PanelModel {
  id: string;
  name: string;
  tier: string;
  created: string;
  context_length: number | null;
  hugging_face_id: string | null;
  runs_on: string;
  cost_tier: string;
  pricing_per_million: { prompt: number; completion: number };
}

export const PANEL: PanelModel[] = panel.models as unknown as PanelModel[];

export const panelWithStatus = PANEL.map((m) => ({
  ...m,
  status: MODEL_STATUS[m.id] ?? DEFAULT_STATUS,
}));
