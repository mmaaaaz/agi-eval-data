import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./index.css";

// The one build-time knob the shared UI reads. It lives on a global rather than
// import.meta so the shared package (which is not a Vite app) typechecks without
// Vite's client types. Unset in CI: ThumbImage falls back to the corpus CDN.
(globalThis as { __IMG_BASE__?: string }).__IMG_BASE__ = import.meta.env.VITE_IMG_BASE ?? "";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
