import { createFileRoute, redirect } from "@tanstack/react-router";

// SELECTION LIVES IN ONE PLACE NOW: /contribute (the Select tab). This old URL stays as a
// redirect so every shared link and every bit of muscle memory still lands on the door.
export const Route = createFileRoute("/gallery/triage")({
  beforeLoad: () => {
    throw redirect({ to: "/contribute", replace: true });
  },
});
