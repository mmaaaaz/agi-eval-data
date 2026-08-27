import { Link, createFileRoute, Outlet } from "@tanstack/react-router";
import { Eyebrow } from "@site/section";

const TABS = [
  { to: "/gallery", label: "Images", exact: true },
  { to: "/gallery/pdfs", label: "PDFs", exact: false },
  { to: "/gallery/contributors", label: "Contributors", exact: false },
  { to: "/gallery/duplicates", label: "Duplicates", exact: false },
];

export const Route = createFileRoute("/gallery")({ component: GalleryLayout });

function GalleryLayout() {
  return (
    <div>
      <Eyebrow n="03">gallery</Eyebrow>
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
