import { createFileRoute } from "@tanstack/react-router";
import { GradeModels } from "@site/grading";
import { loadSettings } from "../lib/ai/settings";

export const Route = createFileRoute("/contribute/evaluate")({ component: Evaluate });

function Evaluate() {
  return (
    <GradeModels
      site={{
        countsWording: "maps with questions",
        onThisWording: () => "map",
        loadSettings,
        orMeta: {
          name: "metro-eval evaluator",
          subject: "metro network map",
        },
        tagBarFrom: "from-[#0a5c40]",
      }}
    />
  );
}
