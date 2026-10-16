import { createFileRoute, Link } from "@tanstack/react-router";
import { GalleryTriage } from "@site/triage";
import { loadSettings, saveSettings } from "../lib/ai/settings";

export const Route = createFileRoute("/contribute/triage")({ component: ContributeTriage });

/** The keyboard mode of Select — same decisions, single-key speed. Kept reachable, never advertised. */
function ContributeTriage() {
  return (
    <div>
      <p className="mb-4 font-mono text-[10px] text-[#666]">
        keyboard mode — 1 nominate · 2 choose · 3 exclude · z undo ·{" "}
        <Link to="/contribute" className="text-accent hover:underline">
          back to the grid
        </Link>
      </p>
      <GalleryTriage site={{ loadSettings, saveSettings }} />
    </div>
  );
}
