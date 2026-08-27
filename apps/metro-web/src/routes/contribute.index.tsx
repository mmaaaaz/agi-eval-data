import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AuthorQuestions } from "@site/authoring";
import type { AuthorSite } from "@site/authoring";
import { loadSettings } from "../lib/ai/settings";
import { branchOf, cityName, countryOf } from "../lib/data";

// Assist ships enabled; opt OUT with VITE_ENABLE_MAPS_ASSIST=0/false.
const ENABLE_ASSIST = !(import.meta.env.VITE_ENABLE_MAPS_ASSIST === "false" || import.meta.env.VITE_ENABLE_MAPS_ASSIST === "0");

const GraphAssist = ENABLE_ASSIST
  ? lazy(() => import("../components/GraphAssist"))
  : null as unknown as React.ComponentType<{ site: AuthorSite }>;

export const Route = createFileRoute("/contribute/")({ component: ContributeQuestions });

function ContributeQuestions() {
  if (ENABLE_ASSIST && GraphAssist) {
    return (
      <Suspense fallback={<AuthorQuestions site={siteConfig} />}>
        <GraphAssistWrapper />
      </Suspense>
    );
  }
  return <AuthorQuestions site={siteConfig} />;
}

const siteConfig: AuthorSite = {
  imageLabel: "maps",
  contributor: "metro",
  searchPlaceholder: "search city or country…",
  searchText: (r) => countryOf(r),
  tagChips: (r) => [branchOf(r), countryOf(r), cityName(r)].filter(Boolean),
  navigateMarkedTo: "/gallery",
  questionPlaceholder: "e.g. which line connects the airport to the city center?",
  answerPlaceholderMap: {
    number: "e.g. 3",
    yesno: "yes / no",
    text: "the answer",
  },
  existingWording: "existing questions",
  loadSettings,
  titleFor: (r) => cityName(r) || r[1],
};

function GraphAssistWrapper() {
  // lazy wrapper — the assist injects MarkLayer via AuthorQuestions children/context.
  // When the flag is on, it wraps the same AuthorQuestions with graph context.
  const GA = GraphAssist as unknown as React.ComponentType<{ site: AuthorSite }>;
  return <GA site={siteConfig} />;
}
