import { createFileRoute } from "@tanstack/react-router";
import { VqaReview } from "@site/vqaReview";
import { loadSettings, saveSettings } from "../lib/ai/settings";

/**
 * /review — the review room for model-drafted VQA candidates (migration 0010).
 *
 * Separate from /contribute/review, which approves hand-authored questions in
 * the live authoring store. This screen only ever touches vqa_candidates: the
 * drafts are reviewed against their photograph and exported as a frozen release,
 * they never become live authoring state.
 */
export const Route = createFileRoute("/review")({ component: Review });

function Review() {
  return <VqaReview site={{ loadSettings, saveSettings }} />;
}
