import { useEffect, useState } from "react";
import { Link, createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useLatest } from "../lib/data";
import { DataProvider, useData } from "../lib/dataContext";
import { SyncChip } from "../components/SyncChip";
import { CommandPalette } from "../components/CommandPalette";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Menu } from "lucide-react";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/gallery", label: "Gallery" },
  { to: "/ask", label: "Ask" },
  { to: "/contribute", label: "Contribute" },
  { to: "/project", label: "Project" },
] as const;

function Loader({ progress }: { progress: number | null }) {
  const pct = progress != null ? Math.round(progress * 100) : null;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8">
      <h1 className="sheen font-mono text-sm uppercase tracking-[0.35em]">agi-eval-data</h1>
      <div className="w-56">
        {pct != null ? (
          <>
            <div className="h-[2px] w-full overflow-hidden rounded bg-[#262626]">
              <div className="h-full bg-white transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-right font-mono text-[10px] tabular-nums text-[#666]">{pct}%</p>
          </>
        ) : (
          <div className="indeterminate h-[2px] w-full rounded bg-[#262626]" />
        )}
      </div>
      <p className="font-mono text-[10px] text-[#666]">fetching dataset metadata · nothing else downloads</p>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-danger">data unreachable</p>
      <p className="max-w-md font-mono text-xs leading-5 text-[#a1a1a1]">
        Couldn't load the dataset ledger from GitHub ({message}). The sync bot may be mid-run — retry in a minute.
      </p>
      <button
        onClick={onRetry}
        className="rounded border border-[#262626] px-4 py-2 font-mono text-xs text-[#ededed] transition-colors hover:border-[#404040]"
      >
        RETRY
      </button>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 outline-none focus-visible:ring-1 focus-visible:ring-accent">
      <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden>
        <path d="M16 5 L27 25 L5 25 Z" fill="none" stroke="#ededed" strokeWidth="2.2" />
        <circle cx="16" cy="19" r="3" fill="#0070f3" />
      </svg>
      <span className="font-mono text-[13px] tracking-tight text-white">agi-eval-data</span>
    </Link>
  );
}

function Shell() {
  const latest = useData();
  const [palette, setPalette] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // any navigation closes the mobile menu (route change fires before render)
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // global ⌘K / Ctrl-K
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (latest.loadingFirst && !latest.data && !latest.error) {
    return <Loader progress={latest.progress} />;
  }
  if (latest.error && !latest.data) {
    return <ErrorCard message={latest.error} onRetry={latest.refresh} />;
  }
  if (!latest.data) return <Loader progress={null} />;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-[#262626] bg-black/85 backdrop-blur-md">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-5">
          {/* row 1: brand · palette · sync */}
          <div className="flex h-12 items-center justify-between gap-3 lg:h-14">
            <div className="flex items-center gap-2">
              {/* mobile menu — controlled: closes on any navigation */}
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <button
                    aria-label="Open menu"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-[#262626] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white lg:hidden"
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72 border-[#262626] bg-black">
                  <SheetTitle className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">agi-eval-data · menu</SheetTitle>
                  <nav className="mt-5 flex flex-col gap-1.5">
                    {NAV.map((n) => (
                      <MobileNavLink key={n.to} to={n.to} label={n.label} onNavigate={() => setMenuOpen(false)} />
                    ))}
                    <div className="my-2 h-px bg-[#262626]" />
                    <MobileNavLink to="/settings" label="Settings" onNavigate={() => setMenuOpen(false)} />
                  </nav>
                </SheetContent>
              </Sheet>
              <Brand />
            </div>
            <nav className="hidden items-center gap-1 lg:flex">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} label={n.label} />
              ))}
            </nav>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPalette(true)}
                aria-label="Open command menu"
                className="hidden items-center gap-1.5 rounded-md border border-[#262626] px-2 py-1 font-mono text-[10px] text-[#666] transition-colors hover:border-[#404040] hover:text-[#a1a1a1] md:flex"
              >
                search <kbd className="rounded bg-[#141414] px-1">⌘K</kbd>
              </button>
              <div className="flex items-center gap-2">
                <SyncChip />
                <Link
                  to="/settings"
                  aria-label="Settings"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[#262626] font-mono text-[11px] text-[#666] transition-colors hover:border-[#404040] hover:text-white"
                >
                  ⚙
                </Link>
              </div>
            </div>
          </div>
        </div>
      </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-8">
          <Outlet />
        </main>

        <footer className="border-t border-[#262626]">
          <div className="mx-auto flex max-w-[1400px] flex-col items-center gap-1.5 px-4 py-5 text-center font-mono text-[10px] text-[#666] sm:flex-row sm:justify-between sm:px-5 sm:py-4 sm:text-left">
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
            <span>
              v{latest.data.version} · scanned {latest.data.meta.scannedAt} ·{" "}
              {latest.data.files.length.toLocaleString()} items indexed · press ⌘K
            </span>
          </div>
        </footer>

        <CommandPalette open={palette} onClose={() => setPalette(false)} />
        <Toaster position="bottom-right" />
      </div>
  );
}

function NavLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="rounded px-3 py-1.5 font-mono text-xs text-[#a1a1a1] transition-colors hover:bg-[#141414] hover:text-white"
      activeProps={{ className: "text-white bg-[#141414]" }}
    >
      {label}
    </Link>
  );
}

const MOBILE_HINTS: Record<string, string> = {
  "/": "dataset overview",
  "/gallery": "browse the images",
  "/ask": "chat with the data",
  "/contribute": "author questions",
  "/project": "about the benchmark",
  "/settings": "relay · access code · key",
};

/** Rich mobile menu item — icon row, hint, closes the sheet on click. */
function MobileNavLink({ to, label, onNavigate }: { to: string; label: string; onNavigate: () => void }) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-[#262626] hover:bg-[#141414]"
      activeProps={{ className: "border-[#262626] bg-[#141414]" }}
    >
      <span className="font-mono text-sm text-white">{label}</span>
      <span className="ml-auto font-mono text-[9px] text-[#666] group-hover:text-[#a1a1a1]">
        {MOBILE_HINTS[to] ?? "→"}
      </span>
    </Link>
  );
}

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
  component: function Root() {
    const latest = useLatest();
    const pathname = useRouterState({ select: (s) => s.location.pathname });

    // per-route tab titles (crawlers read static OG tags; this is for humans)
    useEffect(() => {
      const base = PAGE_TITLES[pathname];
      document.title = base ? `${base} · agi-eval-data` : "agi-eval-data — dataset ledger";
    }, [pathname]);

    // SPA route change should land at the top, like a real page load
    useEffect(() => {
      window.scrollTo(0, 0);
    }, [pathname]);

    return (
      <TooltipProvider delayDuration={200}>
        <DataProvider value={latest}>
          <Shell />
        </DataProvider>
      </TooltipProvider>
    );
  },
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <p className="font-mono text-5xl tabular-nums text-[#262626]">404</p>
      <p className="font-mono text-xs text-[#666]">this frame didn't make the cut</p>
      <Link to="/" className="font-mono text-xs text-accent hover:underline">
        ← back to overview
      </Link>
    </div>
  );
}
