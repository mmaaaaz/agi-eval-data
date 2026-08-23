import { Link, createRootRoute, Outlet } from "@tanstack/react-router";
import { useLatest } from "../lib/data";
import { DataProvider, useData } from "../lib/dataContext";
import { SyncChip } from "../components/SyncChip";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/gallery", label: "Gallery" },
  { to: "/contributors", label: "Contributors" },
  { to: "/duplicates", label: "Duplicates" },
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
            <div className="flex h-14 items-center justify-between gap-3">
              <Brand />
              <nav className="scrollbar-none flex flex-1 items-center justify-end gap-1 overflow-x-auto">
                {NAV.map((n) => (
                  <NavLink key={n.to} to={n.to} label={n.label} />
                ))}
              </nav>
              <div className="hidden lg:block">
                <SyncChip meta={latest.data.meta} />
              </div>
            </div>
            <div className="pb-2 lg:hidden">
              <SyncChip meta={latest.data.meta} />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-8">
          <Outlet />
        </main>

        <footer className="border-t border-[#262626]">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4 font-mono text-[10px] text-[#666]">
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

export const Route = createRootRoute({
  component: function Root() {
    const latest = useLatest();
    return (
      <DataProvider value={latest}>
        <Shell />
      </DataProvider>
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
