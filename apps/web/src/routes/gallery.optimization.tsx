import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/gallery/optimization")({
  component: OptimizationLayout,
});

/* Layout-only parent: `/gallery/optimization` (index) and
   `/gallery/optimization/$owner` render inside this Outlet. */
function OptimizationLayout() {
  return <Outlet />;
}
