import { createRootRoute } from "@tanstack/react-router";
import { AppShell, NotFound } from "@site/shell";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/gallery", label: "Gallery" },
  { to: "/ask", label: "Ask" },
  { to: "/contribute", label: "Contribute" },
  { to: "/project", label: "Project" },
];

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/gallery": "Gallery",
  "/gallery/insights": "Insights",
  "/gallery/duplicates": "Duplicates",
  "/gallery/contributors": "Contributors",
  "/ask": "Ask AI",
  "/contribute": "Contribute",
  "/contribute/evaluate": "Evaluate",
  "/project": "Project",
};

export const Route = createRootRoute({
  component: () => (
    <AppShell
      dataConfig={{
        repo: import.meta.env.VITE_REPO ?? "mmaaaaz/agi-eval-data",
        artifact: "latest.json",
        cacheKey: "agi-eval-data-v1",
      }}
      brand={{
        name: "agi-eval-data",
        logo: (
          <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden>
            <path d="M16 5 L27 25 L5 25 Z" fill="none" stroke="#ededed" strokeWidth="2.2" />
            <circle cx="16" cy="19" r="3" fill="#0070f3" />
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
          {latest.files.length.toLocaleString()} items indexed · press ⌘K
        </span>
      )}
      titles={PAGE_TITLES}
      palette
      fallbackTitle="agi-eval-data — dataset ledger"
      menuTitle="agi-eval-data · menu"
      mobileExtra={[{ to: "/settings", label: "Settings" }]}
      mobileHints={{
        "/": "dataset overview",
        "/gallery": "browse the images",
        "/ask": "chat with the data",
        "/contribute": "author questions",
        "/project": "about the benchmark",
        "/settings": "relay · access code · key",
      }}
    />
  ),
  notFoundComponent: NotFound,
});
