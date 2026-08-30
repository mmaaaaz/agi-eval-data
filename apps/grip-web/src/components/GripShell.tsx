import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, Toaster, TooltipProvider } from "@site/ui";
import { Menu } from "lucide-react";
import { useGripTree } from "../lib/gripData";
import type { GripTree } from "../lib/gripTypes";

const GripContext = createContext<GripTree | null>(null);

/** useTree — the always-loaded grip index, available in every route. */
export function useTree(): GripTree {
  const t = useContext(GripContext);
  if (!t) throw new Error("useTree outside GripShell");
  return t;
}

export interface NavItem {
  to: string;
  label: string;
  icon?: ReactNode;
}

/**
 * GripShell — the grip-eval app shell. Visually identical to @site/shell's
 * AppShell (same header/nav/footer/motion), but typed against GripTree instead
 * of the metro `Latest` row shape — the shared shell's data contract doesn't fit
 * a category/level taxonomy, so grip carries its own thin copy.
 */
export function GripShell({ nav, titles }: { nav: NavItem[]; titles: Record<string, string> }) {
  const { tree, progress, loading, error } = useGripTree();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    const base = titles[pathname];
    document.title = base ? `${base} · grip-eval` : "grip-eval — geometric reasoning ledger";
  }, [pathname, titles]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (loading && !tree && !error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-8">
        <h1 className="sheen font-mono text-sm uppercase tracking-[0.35em]">grip-eval</h1>
        <div className="w-56">
          {progress != null ? (
            <>
              <div className="h-[2px] w-full overflow-hidden rounded bg-[#262626]">
                <div className="h-full bg-white transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="mt-2 text-right font-mono text-[10px] tabular-nums text-[#666]">{Math.round(progress * 100)}%</p>
            </>
          ) : (
            <div className="indeterminate h-[2px] w-full rounded bg-[#262626]" />
          )}
        </div>
        <p className="font-mono text-[10px] text-[#666]">fetching dataset index · nothing else downloads</p>
      </div>
    );
  }
  if (error && !tree) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-danger">data unreachable</p>
        <p className="max-w-md font-mono text-xs leading-5 text-[#a1a1a1]">
          Couldn't load the grip index from GitHub ({error}). The bake may be mid-deploy — retry in a minute.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded border border-[#262626] px-4 py-2 font-mono text-xs text-[#ededed] transition-colors hover:border-[#404040]"
        >
          RETRY
        </button>
      </div>
    );
  }
  if (!tree) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-40 border-b border-[#262626] bg-black/85 backdrop-blur-md">
          <div className="mx-auto max-w-[1400px] px-4 sm:px-5">
            <div className="flex h-12 items-center justify-between gap-3 lg:h-14">
              <div className="flex items-center gap-2">
                <SheetMenu open={menuOpen} setOpen={setMenuOpen} nav={nav} />
                <Link to="/" className="flex items-center gap-2.5 outline-none focus-visible:ring-1 focus-visible:ring-accent">
                  <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden>
                    <path d="M6 26 L16 6 L26 26 Z" fill="none" stroke="#ededed" strokeWidth="2.2" />
                    <circle cx="16" cy="21" r="3" fill="#8b5cf6" />
                  </svg>
                  <span className="font-mono text-[13px] tracking-tight text-white">grip-eval</span>
                </Link>
              </div>
              <nav className="hidden items-center gap-1 lg:flex">
                {nav.map((n) => (
                  <Link
                    key={n.to}
                    to={n.to}
                    className="rounded px-3 py-1.5 font-mono text-xs text-[#a1a1a1] transition-colors hover:bg-[#141414] hover:text-white"
                    activeProps={{ className: "text-white bg-[#141414]" }}
                  >
                    {n.label}
                  </Link>
                ))}
              </nav>
              <div className="flex items-center gap-2">
                <Link
                  to="/project"
                  aria-label="Sync panel"
                  className="hidden rounded-md border border-[#262626] px-2.5 py-1 font-mono text-[10px] text-[#666] transition-colors hover:border-[#404040] hover:text-white sm:block"
                >
                  edits
                </Link>
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

        <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-5 py-8">
          <GripContext value={tree}>
            <Outlet />
          </GripContext>
        </main>

        <footer className="border-t border-[#262626]">
          <div className="mx-auto flex max-w-[1400px] flex-col items-center gap-1.5 px-4 py-5 text-center font-mono text-[10px] text-[#666] sm:flex-row sm:justify-between sm:px-5 sm:py-4 sm:text-left">
            <span>
              <a
                href="https://github.com/mmaaaaz/agi-eval-data"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent transition-colors hover:underline"
              >
                mmaaaaz/agi-eval-data ↗
              </a>
              {" "}· upstream dataset:{" "}
              <a
                href={`https://github.com/${tree.upstreamRepo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#666] transition-colors hover:text-accent"
              >
                {tree.upstreamRepo} ↗
              </a>
            </span>
            <span>
              baked {tree.builtAt} · {tree.counts.imagesMain.toLocaleString()} images ·{" "}
              {tree.counts.questionsMain.toLocaleString()} questions · noindex
            </span>
          </div>
        </footer>

        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}

/* ---------- tree context ---------- */

function SheetMenu({ open, setOpen, nav }: { open: boolean; setOpen: (v: boolean) => void; nav: NavItem[] }) {
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          aria-label="Open menu"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[#262626] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 border-[#262626] bg-black">
        <SheetTitle className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#666]">grip-eval · menu</SheetTitle>
        <nav className="mt-5 flex flex-col gap-1.5">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-[#262626] hover:bg-[#141414]"
              activeProps={{ className: "border-[#262626] bg-[#141414]" }}
            >
              {n.icon && <span className="h-4 w-4 text-[#666]">{n.icon}</span>}
              <span className="font-mono text-sm text-white">{n.label}</span>
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
