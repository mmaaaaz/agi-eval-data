import { useEffect, useState } from "react";
import { Link, createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useLatest } from "../lib/data";
import { DataProvider, useData } from "../lib/dataContext";
import { SyncChip } from "../components/SyncChip";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Menu, Globe, Images, PenLine, Info } from "lucide-react";

const NAV = [
  { to: "/", label: "Overview", icon: Info },
  { to: "/catalog", label: "Catalog", icon: Globe },
  { to: "/gallery", label: "Gallery", icon: Images },
  { to: "/contribute", label: "Contribute", icon: PenLine },
  { to: "/project", label: "Project", icon: Info },
] as const;

function Loader({ progress }: { progress: number | null }) {
  const pct = progress != null ? Math.round(progress * 100) : null;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8">
      <h1 className="sheen font-mono text-sm uppercase tracking-[0.35em]">metro-eval</h1>
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
        Couldn't load the metro dataset ledger from GitHub ({message}). The sync bot may be mid-run — retry in a minute.
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
        <path d="M4 22 L16 6 L28 22 Z" fill="none" stroke="#ededed" strokeWidth="2.2" />
        <circle cx="16" cy="19" r="3" fill="#10b981" />
      </svg>
      <span className="font-mono text-[13px] tracking-tight text-white">metro-eval</span>
    </Link>
  );
}

function Shell() {
  const latest = useData();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // any navigation closes the mobile menu (route change fires before render)
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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
          <div className="flex h-12 items-center justify-between gap-3 lg:h-14">
            <div className="flex items-center gap-2">
              {/* mobile menu */}
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
                  <SheetTitle className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">navigation</SheetTitle>
                  <nav className="mt-5 flex flex-col gap-1.5">
                    {NAV.map((n) => {
                      const Icon = n.icon;
                      return (
                        <Link
                          key={n.to}
                          to={n.to}
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 font-mono text-sm text-[#a1a1a1] transition-colors hover:border-[#262626] hover:bg-[#141414] hover:text-white"
                          activeProps={{ className: "border-[#262626] bg-[#141414] text-white" }}
                        >
                          <Icon className="h-4 w-4 text-[#666]" />
                          {n.label}
                          <span className="ml-auto font-mono text-[10px] text-[#666]">→</span>
                        </Link>
                      );
                    })}
                    <div className="my-2 h-px bg-[#262626]" />
                    <Link
                      to="/settings"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-sm text-[#a1a1a1] transition-colors hover:bg-[#141414] hover:text-white"
                    >
                      <span className="font-mono text-[13px]">⚙</span>
                      Settings
                    </Link>
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
            {latest.data.files.length.toLocaleString()} items indexed
          </span>
        </div>
      </footer>

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
  component: function Root() {
    const latest = useLatest();
    const pathname = useRouterState({ select: (s) => s.location.pathname });

    useEffect(() => {
      const base = PAGE_TITLES[pathname];
      document.title = base ? `${base} · metro-eval` : "metro-eval — transit dataset ledger";
    }, [pathname]);

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
      <p className="font-mono text-xs text-[#666]">this line didn't make the map</p>
      <Link to="/" className="font-mono text-xs text-accent hover:underline">
        ← back to overview
      </Link>
    </div>
  );
}
