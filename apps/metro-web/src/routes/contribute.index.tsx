import { createFileRoute } from "@tanstack/react-router";
import { AuthorQuestions } from "@site/authoring";
import { loadSettings } from "../lib/ai/settings";
import { branchOf, cityName, countryOf } from "../lib/data";

export const Route = createFileRoute("/contribute/")({ component: ContributeQuestions });

function ContributeQuestions() {
  return (
    <AuthorQuestions
      site={{
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
      }}
    />
  );
}
