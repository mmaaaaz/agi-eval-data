import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$")({ component: CatchAll });

function CatchAll() {
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
