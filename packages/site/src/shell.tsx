import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useLatest, type DataConfig } from "./data";
import { SyncChip } from "./SyncChip";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, Toaster, TooltipProvider } from "./ui";
import { Menu } from "lucide-react";
import type { LatestState, Latest } from "./data";

export interface NavItem {
  to: string;
  label: string;
  icon?: ReactNode;
}

export interface ShellProps {
  /** dataset artifact config (repo/artifact/cacheKey) */
  dataConfig: DataConfig;
  brand: { name: string; logo: ReactNode };
  nav: NavItem[];
  footer: ReactNode;
  /** render the footer right slot with the loaded dataset (version/scannedAt) */
  footerRender?: (latest: Latest) => ReactNode;
  titles: Record<string, string>;
  /** show the ⌘K command-palette button in the header */
  palette?: boolean;
  /** fallback title suffix, e.g. "agi-eval-data — dataset ledger" */
  fallbackTitle: string;
  /** mobile sheet title, e.g. "agi-eval-data · menu" */
  menuTitle: string;
  /** extra nav entries for the mobile menu (e.g. Settings) */
  mobileExtra?: NavItem[];
  /** mobile menu hints keyed by route path */
  mobileHints?: Record<string, string>;
  /** sync pill schedule label (tooltip) */
  syncSchedule?: string;
  /** app shell content rendered inside <Outlet /> (usually null) */
  children?: ReactNode;
}

function Loader({ progress, brand }: { progress: number | null; brand: string }) {
  const pct = progress != null ? Math.round(progress * 100) : null;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8">
      <h1 className="sheen font-mono text-sm uppercase tracking-[0.35em]">{brand}</h1>
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

function Brand({ name, logo }: { name: string; logo: ReactNode }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 outline-none focus-visible:ring-1 focus-visible:ring-accent">
      {logo}
      <span className="font-mono text-[13px] tracking-tight text-white">{name}</span>
    </Link>
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

function Shell({
  props,
  data,
  refresh,
  loadingFirst,
  error,
  progress,
}: {
  	props: ShellProps;
	data: LatestState["data"];
	refresh: () => void;
	loadingFirst: boolean;
	error: string | null;
	progress: number | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // any navigation closes the mobile menu (route change fires before render)
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (loadingFirst && !data && !error) {
    return <Loader progress={progress} brand={props.brand.name} />;
  }
  if (error && !data) {
    return <ErrorCard message={error} onRetry={refresh} />;
  }
  if (!data) return <Loader progress={null} brand={props.brand.name} />;

  const mobileItems = [...props.nav, ...(props.mobileExtra ?? [])];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-[#262626] bg-black/85 backdrop-blur-md">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-5">
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
                  <SheetTitle className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">
                    {props.menuTitle}
                  </SheetTitle>
                  <nav className="mt-5 flex flex-col gap-1.5">
                    {mobileItems.map((n) => (
                      <Link
                        key={n.to}
                        to={n.to}
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-[#262626] hover:bg-[#141414]"
                        activeProps={{ className: "border-[#262626] bg-[#141414]" }}
                      >
                        {n.icon && <span className="h-4 w-4 text-[#666]">{n.icon}</span>}
                        <span className="font-mono text-sm text-white">{n.label}</span>
                        <span className="ml-auto font-mono text-[9px] text-[#666]">
                          {props.mobileHints?.[n.to] ?? "→"}
                        </span>
                      </Link>
                    ))}
                  </nav>
                </SheetContent>
              </Sheet>
              <Brand name={props.brand.name} logo={props.brand.logo} />
            </div>
            <nav className="hidden items-center gap-1 lg:flex">
              {props.nav.map((n) => (
                <NavLink key={n.to} to={n.to} label={n.label} />
              ))}
            </nav>
            <div className="flex items-center gap-3">
              {props.palette && (
                <div className="hidden items-center gap-1.5 rounded-md border border-[#262626] px-2 py-1 font-mono text-[10px] text-[#666] md:flex">
                  search <kbd className="rounded bg-[#141414] px-1">⌘K</kbd>
                </div>
              )}
              <div className="flex items-center gap-2">
                <SyncChip scheduleLabel={props.syncSchedule} />
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
          {props.footer}
          {props.footerRender && data ? props.footerRender(data) : null}
        </div>

      </footer>

      <Toaster position="bottom-right" />
    </div>
  );
}

export function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <p className="font-mono text-5xl tabular-nums text-[#262626]">404</p>
      <p className="font-mono text-xs text-[#666]">this page didn't make the cut</p>
      <Link to="/" className="font-mono text-xs text-accent hover:underline">
        ← back to overview
      </Link>
    </div>
  );
}

/**
 * AppShell — the shared site shell. Every route tree root renders this.
 * `titles` drives the per-route document.title, route-change scrolls to top,
 * and the mobile menu closes on any navigation (controlled Sheet).
 */
export function AppShell(props: ShellProps) {
  const { data, refresh, loadingFirst, error, progress } = useLatest(props.dataConfig);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // per-route tab titles (crawlers read static OG tags; this is for humans)
  useEffect(() => {
    const base = props.titles[pathname];
    document.title = base ? `${base} · ${props.brand.name}` : props.fallbackTitle;
  }, [pathname, props.titles, props.brand.name, props.fallbackTitle]);

  // SPA route change should land at the top, like a real page load
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <TooltipProvider delayDuration={200}>
      <Shell
        props={props}
        data={data}
        refresh={refresh}
        loadingFirst={loadingFirst}
        error={error}
        progress={progress}
      />
    </TooltipProvider>
  );
}
