import { Link, createFileRoute, Outlet } from "@tanstack/react-router";
import { Eyebrow } from "@site/section";

// ONE DOOR: Select → Nominated → Questions → Review → Guide. The separate Choose page
// retired into the Select tab (2026-10-16 decision); the keyboard triage persists for
// power use, unadvertised, at /contribute/triage.
const TABS = [
  { to: "/contribute", label: "Select", exact: true },
  { to: "/contribute/nominated", label: "Nominated", exact: false },
  { to: "/contribute/write", label: "Questions", exact: false },
  { to: "/contribute/review", label: "Review", exact: false },
  { to: "/contribute/rules", label: "Guide", exact: false },
];

export const Route = createFileRoute("/contribute")({ component: ContributeLayout });

function ContributeLayout() {
  return (
    <div>
      <Eyebrow n="04">contribute</Eyebrow>
      <div className="scrollbar-none mb-6 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            activeOptions={{ exact: t.exact }}
            activeProps={{ className: "bg-white text-black border-white" }}
            className="shrink-0 rounded-md border border-[#262626] px-3.5 py-1.5 font-mono text-[11px] text-[#a1a1a1] transition-colors hover:border-[#404040] hover:text-white"
          >
            {t.label}
          </Link>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
