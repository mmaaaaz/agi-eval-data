import { createFileRoute } from "@tanstack/react-router";
import { GalleryTriage } from "@site/triage";
import { loadSettings, saveSettings } from "../lib/ai/settings";

export const Route = createFileRoute("/gallery/triage")({ component: Triage });

function Triage() {
  return <GalleryTriage site={{ loadSettings, saveSettings }} />;
}
