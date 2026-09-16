import { createRootRoute } from "@tanstack/react-router";
import { Home, LayoutGrid, Info, Search, BarChart3 } from "lucide-react";
import { GripShell } from "../components/GripShell";
import { NotFound } from "./-notFound";

const NAV = [
  { to: "/", label: "Overview", icon: <Home className="h-4 w-4" /> },
  { to: "/categories", label: "Categories", icon: <LayoutGrid className="h-4 w-4" /> },
  { to: "/browse", label: "Browse", icon: <Search className="h-4 w-4" /> },
  { to: "/open-models", label: "Open models", icon: <BarChart3 className="h-4 w-4" /> },
  { to: "/project", label: "Project", icon: <Info className="h-4 w-4" /> },
];

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/categories": "Categories",
  "/browse": "Browse",
  "/open-models": "Open models",
  "/open-models/domains": "Domains · Open models",
  "/open-models/matrix": "Matrix · Open models",
  "/open-models/compare": "Compare · Open models",
  "/open-models/audit": "Audit · Open models",
  "/open-models/method": "Method · Open models",
  "/project": "Project",
  "/settings": "Settings",
};

export const Route = createRootRoute({
  component: () => (
    <GripShell nav={NAV} titles={PAGE_TITLES} />
  ),
  notFoundComponent: NotFound,
});
