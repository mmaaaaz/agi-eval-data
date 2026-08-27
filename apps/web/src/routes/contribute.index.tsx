import { createFileRoute } from "@tanstack/react-router";
import { AuthorQuestions } from "@site/authoring";
import { loadSettings } from "../lib/ai/settings";
import { ownerName } from "../lib/data";

export const Route = createFileRoute("/contribute/")({ component: ContributeQuestions });

function ContributeQuestions() {
  return (
    <AuthorQuestions
      site={{
        imageLabel: "images",
        contributor: "",
        searchPlaceholder: "search images…",
        navigateMarkedTo: "/gallery/duplicates",
        questionPlaceholder: "e.g. how many chairs are visible?",
        answerPlaceholderMap: {
          number: "e.g. 3",
          yesno: "yes / no",
          text: "the answer",
        },
        existingWording: "existing questions",
        loadSettings,
        ownerName,
      }}
    />
  );
}
