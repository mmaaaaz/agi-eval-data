import { createFileRoute } from "@tanstack/react-router";
import { NominationBoard } from "@site/nominated";
import { loadSettings } from "../lib/ai/settings";

export const Route = createFileRoute("/contribute/nominated")({ component: ContributeNominated });

function ContributeNominated() {
  return <NominationBoard site={{ loadSettings }} />;
}
