import { createRootRoute } from "@tanstack/react-router";
import { Home, LayoutGrid, Info, Search } from "lucide-react";
import { GripShell } from "../components/GripShell";
import { NotFound } from "./notFound";

const NAV = [
  { to: "/", label: "Overview", icon: <Home className="h-4 w-4" /> },
  { to: "/categories", label: "Categories", icon: <LayoutGrid className="h-4 w-4" /> },
  { to: "/browse", label: "Browse", icon: <Search className="h-4 w-4" /> },
  { to: "/project", label: "Project", icon: <Info className="h-4 w-4" /> },
];

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/categories": "Categories",
  "/browse": "Browse",
  "/project": "Project",
  "/settings": "Settings",
};

export const Route = createRootRoute({
  component: () => (
    <GripShell nav={NAV} titles={PAGE_TITLES} />
  ),
  notFoundComponent: NotFound,
});
