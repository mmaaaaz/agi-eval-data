/** The field control: one chip per run, reused on every page.
 *
 * Clicking a chip isolates that model everywhere (charts dim the rest); clicking
 * it again, or "all", restores the whole field. This is the report's single
 * shared interaction, which is what keeps six models from feeling like six
 * different pages.
 */
import type { ModelEntry } from "../../lib/openModelsTypes";
import { fmtInt, pct, type Metric } from "../../lib/openModelsFmt";
import { Dot } from "./ui";
import { dim, shortName } from "./charts";

export function ModelChips({
  models,
  focus,
  onFocus,
  metric = "acc",
  showValues = true,
  dense = false,
}: {
  models: ModelEntry[];
  focus: string | null;
  onFocus: (id: string | null) => void;
  metric?: Metric;
  showValues?: boolean;
  dense?: boolean;
}) {
  const value = (m: ModelEntry) => {
    const t = m.totals;
    switch (metric) {
      case "as":
        return t.as;
      case "partial":
        return t.partial;
      case "headroom":
        return t.headroom;
      default:
        return t.acc;
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onFocus(null)}
        aria-pressed={focus === null}
        className={
          "rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors " +
          (focus === null ? "border-accent bg-accent/15 text-white" : "border-[#262626] text-[#a1a1a1] hover:border-[#404040] hover:text-white")
        }
      >
        all {models.length}
      </button>
      {models.map((m) => {
        const active = focus === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onFocus(active ? null : m.id)}
            aria-pressed={active}
            title={m.label + " · " + pct(m.totals.acc, 2) + " under the frozen rule"}
            className={
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors " +
              (active ? "border-transparent text-[#0a0a0a]" : "border-[#262626] text-[#c9c9c9] hover:border-[#404040] hover:text-white")
            }
            style={active ? { background: m.accent } : undefined}
          >
            <Dot color={active ? "#0a0a0a" : m.accent} size={6} />
            {dense ? shortName(m) : m.label}
            {showValues && <span className={active ? "opacity-80" : "text-[#666]"}>{pct(value(m), 1)}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A one-line statement of what the rest of the page is anchored to. */
export function FieldNote({ models, focus, className = "" }: { models: ModelEntry[]; focus: string | null; className?: string }) {
  const focused = models.find((m) => m.id === focus);
  return (
    <p className={"font-mono text-[10px] text-[#666] " + className}>
      {focused ? (
        <>
          <span style={{ color: focused.accent }}>{focused.label}</span> isolated — click its chip again or{" "}
          <span className="text-[#a1a1a1]">all {models.length}</span> to compare the whole field
        </>
      ) : (
        <>
          {models.length} runs · {fmtInt(models.reduce((s, m) => s + m.totals.n, 0))} graded answers · click a model to isolate it
          everywhere
        </>
      )}
    </p>
  );
}

export { dim, shortName };
