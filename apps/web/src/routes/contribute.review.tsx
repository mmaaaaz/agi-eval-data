import { createFileRoute } from "@tanstack/react-router";
import { ReviewQueue } from "@site/review";
import { loadSettings, saveSettings } from "../lib/ai/settings";

export const Route = createFileRoute("/contribute/review")({ component: Review });

function Review() {
  return <ReviewQueue site={{ loadSettings, saveSettings }} />;
}
