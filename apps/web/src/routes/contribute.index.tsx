import { createFileRoute } from "@tanstack/react-router";
import { SelectGrid } from "@site/select";
import { loadSettings, saveSettings } from "../lib/ai/settings";

export const Route = createFileRoute("/contribute/")({ component: ContributeSelect });

function ContributeSelect() {
  return <SelectGrid site={{ loadSettings, saveSettings }} />;
}
