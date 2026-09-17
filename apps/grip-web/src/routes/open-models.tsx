/**
 * /open-models - the evaluation-report section inside grip-eval.
 *
 * Owns the artifact fetch and hands it to every child route through context, so
 * navigating between report pages never refetches.
 */
import { createContext, useContext, useState } from "react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useOpenModels } from "../lib/openModels";
import type { Artifact } from "../lib/openModelsTypes";
import { Dot } from "../components/open-models/ui";
import { FieldNote, ModelChips } from "../components/open-models/field";
import { shortName } from "../components/open-models/charts";

const TABS = [
  { to: "/open-models", label: "overview" },
  { to: "/open-models/domains", label: "domains" },
  { to: "/open-models/matrix", label: "matrix" },
  { to: "/open-models/compare", label: "compare" },
  { to: "/open-models/audit", label: "audit" },
  { to: "/open-models/method", label: "method" },
] as const;

const Ctx = createContext<Artifact | null>(null);

/** The loaded artifact. Only valid inside the /open-models routes. */
export function useOM(): Artifact {
  const a = useContext(Ctx);
  if (!a) throw new Error("useOM outside the open-models layout");
  return a;
}

/** The isolated model (null = the whole field), shared by every report page. */
export function useFocus(): { focus: string | null; setFocus: (id: string | null) => void } {
  const f = useContext(FocusCtx);
  if (!f) throw new Error("useFocus outside the open-models layout");
  return f;
}

const FocusCtx = createContext<{ focus: string | null; setFocus: (id: string | null) => void } | null>(null);

export const Route = createFileRoute("/open-models")({
  component: OpenModelsLayout,
});

function OpenModelsLayout() {
  const { data, loading, error, source, reload } = useOpenModels();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [focus, setFocus] = useState<string | null>(null);

  if (loading && !data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-start justify-center gap-3">
        <p className="sheen font-mono text-[11px] uppercase tracking-[0.3em]">open-models report</p>
        <div className="indeterminate h-[2px] w-48 rounded bg-[#262626]" />
        <p className="font-mono text-[10px] text-[#666]">fetching the baked evaluation artifact …</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-start justify-center gap-4">
        <p className="font-mono text-xs uppercase tracking-widest text-danger">artifact unreachable</p>
        <p className="max-w-md font-mono text-[11px] leading-5 text-[#a1a1a1]">
          Could not load data/open-models/models.json from this origin or GitHub ({error}). Bake it with{" "}
          <code className="text-white">python scripts/open_models_bake.py</code> or retry in a minute.
        </p>
        <button
          onClick={reload}
          className="rounded border border-[#262626] px-4 py-2 font-mono text-xs text-[#ededed] transition-colors hover:border-[#404040]"
        >
          RETRY
        </button>
      </div>
    );
  }

  if (!data) return null;

  const totalAnswers = data.models.reduce((s, m) => s + m.totals.n, 0);

  return (
    <Ctx value={data}>
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#666]">
          <Link to="/" className="transition-colors hover:text-white">
            grip-eval
          </Link>
          <span className="text-[#333]">/</span>
          <span className="text-accent">open models</span>
          <span className="text-[#333]">/</span>
          <span>frozen re-grade</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#262626] pb-2">
          <nav className="-mb-2 flex flex-wrap items-center gap-1">
            {TABS.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className="rounded-t border-b-2 border-transparent px-3 py-2 font-mono text-[11px] text-[#a1a1a1] transition-colors hover:text-white"
                activeProps={{ className: "text-white border-accent" }}
                activeOptions={{ exact: t.to === "/open-models" }}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 pb-1.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-[#262626] px-2 py-0.5 font-mono text-[9px] text-[#666]"
              title={"artifact generated " + data.generated}
            >
              <Dot color={source === "local" ? "#10b981" : source === "cache" ? "#f59e0b" : "#38bdf8"} size={5} />
              {source === "local" ? "deployed copy" : source === "cache" ? "cached" : source ?? "—"}
            </span>
            <span className="hidden font-mono text-[9px] text-[#555] sm:inline">
              {data.models.length} runs · {totalAnswers.toLocaleString("en-US")} graded answers · best {shortName(
                data.models.reduce((a, b) => ((a.totals.acc ?? 0) > (b.totals.acc ?? 0) ? a : b)),
              )}
            </span>
            <button
              type="button"
              onClick={reload}
              className="rounded border border-[#262626] px-2 py-0.5 font-mono text-[9px] text-[#666] transition-colors hover:border-[#404040] hover:text-white"
            >
              refresh
            </button>
          </div>
        </div>

        <FocusCtx value={{ focus, setFocus }}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[#1c1c1c] py-3">
            <ModelChips models={data.models} focus={focus} onFocus={setFocus} />
            <FieldNote models={data.models} focus={focus} />
          </div>

          <div className="pt-7" key={pathname}>
            <Outlet />
          </div>
        </FocusCtx>
      </div>
    </Ctx>
  );
}
