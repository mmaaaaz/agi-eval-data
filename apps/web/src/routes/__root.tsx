import { createRootRoute, Link } from "@tanstack/react-router";
import { AppShell, NotFound } from "@site/shell";

// THE WORKING SET. The owner needs to select images and author questions quickly, so the nav
// holds the tools that do that plus the progress they check. **Method, Prior art, Alternatives
// and Project are gone** - they are reading pages, and they were asked for by name.
//
// ONE DOOR (2026-10-16): selection, authoring and review all live under /contribute as
// Select → Nominated → Questions → Review → Guide. The old "Choose" nav item retired into
// Contribute; its URL (/gallery/triage) redirects, and the keyboard mode stays unadvertised
// at /contribute/triage.
const NAV = [
  { to: "/contribute", label: "Contribute" },
  { to: "/gallery", label: "Gallery" },
  { to: "/results", label: "Results" },
  { to: "/status", label: "Status" },
];

// GALLERY, CHOOSE AND ASK ARE NOT IN THE NAV, BY THE OWNER'S REQUEST.
//
// The gallery is still reachable - `contribute` opens it as the image picker, which is where
// authoring starts - and `/gallery/*` still resolves for anyone with a link. **What changed is
// what the site advertises.**
//
// `ask` is the chat, and it is the one route that costs money: `apps/relay`'s `/api/chat`
// reaches a paid model. Its door fails closed, so it is off unless ACCESS_CODE is set - and it
// is now off the nav as well. **Ticket 24 is the decision to keep it or delete it; this is the
// half that needs no decision.**

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/gallery": "Gallery",
  "/gallery/insights": "Insights",
  "/gallery/duplicates": "Duplicates",
  "/gallery/contributors": "Contributors",
  "/contribute": "Contribute",
  "/contribute/nominated": "Nominated",
  "/contribute/write": "Questions",
  "/contribute/triage": "Keyboard triage",
  "/contribute/review": "Review",
  "/contribute/rules": "Writing rules",
  "/results": "Results",
  "/status": "Status",
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
          {" · "}
          {/* SETTINGS IS NOT A NAV ITEM. It holds the BYOK key and the access code -
              reachable, not advertised. Removing it entirely would make the key entry
              unreachable on mobile, which is a regression rather than a tidy-up. */}
          <Link to="/settings" className="text-accent transition-colors hover:underline">
            Settings
          </Link>
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
      mobileHints={{
        "/": "dataset overview",
        "/gallery": "browse the images",
        "/contribute": "select · questions · review",
        "/settings": "relay · access code · key",
      }}
    />
  ),
  notFoundComponent: NotFound,
});
