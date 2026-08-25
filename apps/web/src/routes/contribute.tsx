import { Link, createFileRoute, Outlet } from "@tanstack/react-router";
import { Eyebrow } from "../components/Section";

const TABS = [
  { to: "/contribute", label: "Questions", exact: true },
  { to: "/contribute/evaluate", label: "Evaluate", exact: false },
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
