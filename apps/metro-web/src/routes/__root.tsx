import { createRootRoute } from "@tanstack/react-router";
import { AppShell, NotFound } from "@site/shell";
import { Globe, Images, Info, PenLine } from "lucide-react";

const NAV = [
  { to: "/", label: "Overview", icon: <Info className="h-4 w-4" /> },
  { to: "/catalog", label: "Catalog", icon: <Globe className="h-4 w-4" /> },
  { to: "/gallery", label: "Gallery", icon: <Images className="h-4 w-4" /> },
  { to: "/contribute", label: "Contribute", icon: <PenLine className="h-4 w-4" /> },
  { to: "/project", label: "Project", icon: <Info className="h-4 w-4" /> },
];

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/catalog": "Catalog",
  "/gallery": "Gallery",
  "/contribute": "Contribute",
  "/contribute/evaluate": "Evaluate",
  "/project": "Project",
  "/settings": "Settings",
};

export const Route = createRootRoute({
  component: () => (
    <AppShell
      dataConfig={{
        repo: import.meta.env.VITE_REPO_METRO ?? "mmaaaaz/agi-eval-data",
        artifact: "metro.json",
        cacheKey: "metro-eval-data-v1",
      }}
      syncSchedule="hourly at :00 UTC"
      syncCron="0 * * * *"
      brand={{
        name: "metro-eval",
        logo: (
          <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden>
            <path d="M4 22 L16 6 L28 22 Z" fill="none" stroke="#ededed" strokeWidth="2.2" />
            <circle cx="16" cy="19" r="3" fill="#10b981" />
          </svg>
        ),
      }}
      nav={NAV}
      footer={
        <span>
          metadata only · no dataset bytes served from here ·{" "}
          <a
            href="https://github.com/mmaaaaz/agi-eval-data"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent transition-colors hover:underline"
          >
            GitHub ↗
          </a>
        </span>
      }
      footerRender={(latest) => (
        <span>
          v{latest.version} · scanned {latest.meta.scannedAt} ·{" "}
          {latest.files.length.toLocaleString()} items indexed
        </span>
      )}
      titles={PAGE_TITLES}
      fallbackTitle="metro-eval — transit dataset ledger"
      menuTitle="metro-eval · menu"
      mobileExtra={[{ to: "/settings", label: "Settings", icon: <span className="font-mono text-[13px]">⚙</span> }]}
    />
  ),
  notFoundComponent: NotFound,
});
