import { createFileRoute } from "@tanstack/react-router";
import { GradeModels } from "@site/grading";
import { loadSettings } from "../lib/ai/settings";

export const Route = createFileRoute("/contribute/evaluate")({ component: Evaluate });

function Evaluate() {
  return (
    <GradeModels
      site={{
        countsWording: "images with questions",
        onThisWording: () => "image",
        loadSettings,
        orMeta: {
          referer: "https://agi-eval-data.pages.dev",
          title: "agi-eval-data evaluator",
          subject: "image",
        },
        tagBarFrom: "from-[#155a9d]",
      }}
    />
  );
}
