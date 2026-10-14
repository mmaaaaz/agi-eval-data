import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Eyebrow } from "@site/section";
import { loadSettings } from "../lib/ai/settings";

export const Route = createFileRoute("/results")({ component: Results });

/**
 * The results surface. Read-only, and deliberately so: the harness writes
 * measurements, this displays them. Nothing here can run a model.
 *
 * The 2x2 is the paper's headline, so it leads the page. The cells are shown beside
 * the pair count rather than as bare percentages, because "2 of 8" and "25%" tell a
 * reader different things and the first one cannot be misread.
 */

interface PairRow {
  model: string;
  pairs: number;
  understands: number;
  physics_gap: number;
  geometry_or_perception_gap: number;
  guessing_from_priors: number;
  physics_gap_rate: number | null;
}

interface BoardRow {
  model: string;
  /**
   * The condition this row measures. A corruption ladder is 21 runs of one model, so without
   * this the table would show several rows that look like duplicates — or, before the API was
   * fixed, ONE row averaging all 21, which hides the slope that is the actual result.
   * Empty for a human grade, which belongs to no run.
   */
  run_id?: string;
  graded: number;
  correct: number;
  close: number;
  wrong: number;
  /** items whose calls failed. Missing data, NOT wrong answers — shown, never folded in. */
  not_answered: number;
}

const CELLS: { key: keyof PairRow; label: string; note: string; tone: string }[] = [
  { key: "understands", label: "understands", note: "geometry right, physics right", tone: "text-[#0cce6b]" },
  { key: "physics_gap", label: "physics gap", note: "geometry right, physics wrong — the finding", tone: "text-danger" },
  { key: "geometry_or_perception_gap", label: "geometry or perception gap", note: "both wrong: never saw it, or misjudged it", tone: "text-[#a1a1a1]" },
  { key: "guessing_from_priors", label: "guessing from priors", note: "geometry wrong, physics right", tone: "text-[#f59e0b]" },
];

function pct(n: number | null): string {
  return n === null ? "—" : (n * 100).toFixed(1) + "%";
}

function Results() {
  const [relay] = useState(() => loadSettings().relay.replace(/\/+$/, ""));
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [unpaired, setUnpaired] = useState(0);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [releasable, setReleasable] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const get = async (path: string) => {
      const r = await fetch(relay + path);
      if (!r.ok) throw new Error(path + " -> HTTP " + r.status);
      return r.json();
    };
    (async () => {
      try {
        const [p, i, rel] = await Promise.all([
          get("/api/insights/pairs"),
          get("/api/insights"),
          get("/api/insights/release").catch(() => null),
        ]);
        if (cancelled) return;
        setPairs(p.models ?? []);
        setUnpaired(p.unpaired_bridge ?? 0);
        setBoard(i.leaderboard ?? []);
        setReleasable(rel?.releasable_items ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [relay]);

  return (
    <div className="max-w-5xl">
      <Eyebrow n="07">results</Eyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-white">Results</h1>
      <p className="mt-2 font-mono text-[11px] leading-5 text-[#a1a1a1]">
        Read-only. The harness writes measurements; this page displays them and cannot run a
        model.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 font-mono text-[11px] text-danger">
          {error}
        </p>
      )}

      {/* ---- the headline ---- */}
      <h2 className="mt-8 text-lg font-semibold tracking-tight text-white">The paired diagnostic</h2>
      <p className="mt-1 text-[13px] leading-6 text-[#a1a1a1]">
        A geometry probe and a physics probe on the <em>same object in the same photograph</em>.
        This is the table the whole benchmark exists to produce: it separates a model that
        cannot see from one that sees but reasons badly.
      </p>

      {loaded && pairs.length === 0 && !error && (
        <div className="mt-4 rounded-lg border border-[#262626] bg-[#0a0a0a]/60 p-4">
          <p className="font-mono text-[11px] leading-5 text-[#a1a1a1]">
            No pairs have been measured yet. This table fills in after a release is frozen and
            the harness has run against it — for every model, it counts how often the geometry
            probe was right and the physics probe was wrong on the same object.
          </p>
        </div>
      )}

      {pairs.map((m) => (
        <section key={m.model} className="mt-4 rounded-lg border border-[#262626] bg-[#0a0a0a]/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-mono text-[13px] text-white">{m.model}</h3>
            <span className="font-mono text-[11px] text-[#666]">
              {m.pairs} pairs · physics-gap rate{" "}
              <span className="text-danger">{pct(m.physics_gap_rate)}</span>
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {CELLS.map((c) => (
              <div key={String(c.key)} className="rounded-md border border-[#262626] bg-[#050505] p-2.5">
                <span className={"block font-mono text-[10px] uppercase tracking-wider " + c.tone}>
                  {c.label}
                </span>
                <span className="mt-1 block font-mono text-lg text-white">
                  {String(m[c.key] ?? 0)}
                  <span className="ml-1 text-[11px] text-[#666]">
                    ({m.pairs > 0 ? (((m[c.key] as number) / m.pairs) * 100).toFixed(0) : 0}%)
                  </span>
                </span>
                <span className="mt-0.5 block font-mono text-[9px] leading-4 text-[#666]">{c.note}</span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {unpaired > 0 && (
        <p className="mt-3 rounded-md border border-[#f59e0b]/40 bg-[#f59e0b]/5 p-2.5 font-mono text-[10px] leading-4 text-[#f59e0b]">
          {unpaired} bridge item{unpaired === 1 ? "" : "s"} have no twin. They are excluded from
          the table above, because an unpaired bridge item cannot be scored in the 2x2 — it
          would inflate the pair count while contributing nothing.
        </p>
      )}

      {/* ---- the leaderboard ---- */}
      <h2 className="mt-10 text-lg font-semibold tracking-tight text-white">Leaderboard</h2>
      {loaded && board.length === 0 && !error ? (
        <p className="mt-2 rounded-lg border border-[#262626] bg-[#0a0a0a]/60 p-4 font-mono text-[11px] text-[#a1a1a1]">
          No graded responses yet. Accuracy is quoted only after a frozen release has been run,
          so that every number traces to one release hash.
        </p>
      ) : (
        <div>
          <p className="mt-2 font-mono text-[10px] leading-4 text-[#666]">
            Accuracy is over items that produced an answer. An item whose call failed is
            missing data, not a wrong answer — it is the "no answer" column, so
            infrastructure trouble cannot be mistaken for a model's ability.
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-[#262626]">
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="bg-[#0a0a0a] text-left text-[#666]">
                <th className="p-2">model</th>
                <th className="p-2">run</th>
                <th className="p-2">graded</th>
                <th className="p-2">correct</th>
                <th className="p-2">close</th>
                <th className="p-2">wrong</th>
                <th className="p-2">no answer</th>
                <th className="p-2">accuracy</th>
              </tr>
            </thead>
            <tbody className="text-[#a1a1a1]">
              {/* keyed on model AND run: a corruption ladder is many rows for one model */}
              {board.map((b) => (
                <tr key={b.model + "\u0000" + (b.run_id ?? "")} className="border-t border-[#262626]">
                  <td className="p-2 text-[#ededed]">{b.model}</td>
                  <td className="p-2 text-[#666]">{b.run_id || "\u2014"}</td>
                  <td className="p-2">{b.graded}</td>
                  <td className="p-2 text-[#0cce6b]">{b.correct}</td>
                  <td className="p-2">{b.close}</td>
                  <td className="p-2 text-danger">{b.wrong}</td>
                  <td className="p-2 text-[#666]">{b.not_answered ?? 0}</td>
                  <td className="p-2">{b.graded > 0 ? ((b.correct / b.graded) * 100).toFixed(1) + "%" : "—"}</td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- release state ---- */}
      <h2 className="mt-10 text-lg font-semibold tracking-tight text-white">Release state</h2>
      <p className="mt-1 font-mono text-[11px] leading-5 text-[#a1a1a1]">
        {releasable === null
          ? "not available"
          : releasable.toLocaleString() + " items are approved, classified, and paired where required — the set a release would freeze."}
      </p>

      <p className="mt-8 font-mono text-[10px] leading-4 text-[#555]">
        Every number on this page is reported against a frozen release hash. A measurement from
        a run whose release hash does not match is refused rather than displayed, so a figure
        here always traces to one set of labels.
      </p>
    </div>
  );
}
