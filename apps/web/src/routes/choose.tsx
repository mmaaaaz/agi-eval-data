import { createFileRoute, redirect } from "@tanstack/react-router";

// The owner (and everyone with a link) says "/choose" — it now resolves to the one door.
export const Route = createFileRoute("/choose")({
  beforeLoad: () => {
    throw redirect({ to: "/contribute", replace: true });
  },
});
