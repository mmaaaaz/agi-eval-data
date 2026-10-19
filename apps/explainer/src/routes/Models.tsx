import { Link } from "@tanstack/react-router";
import { panelWithStatus } from "../content/models";
import { FACTS } from "../content/facts";
import { runForModel } from "../content/runs";

export function ModelsPage() {
  return (
    <section>
      <span className="eyebrow">06 · The model panel</span>
      <h2>Models we are evaluating</h2>
      <div className="prose">
        <p className="lead-in">
          The panel is a dated snapshot, maintained in the project repository and read by the benchmark
          harness itself, so this page can never drift from what actually runs. Open-weight models run on
          the group's own cluster; a costed subset of frontier models runs through APIs, and refusals are
          reported as results. Every field below comes from the same list file the harness reads.
        </p>
        <p className="lead-in">
          Question drafting runs on <strong>{FACTS.generationModel.name}</strong> across the whole
          corpus, and every drafted question is reviewed by people before it counts. The snapshot below
          was assembled in October 2026.
        </p>
      </div>
      <table className="panel-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Released</th>
            <th>Tier</th>
            <th>Context</th>
            <th>Priced, per M tokens</th>
            <th>Runs on</th>
            <th>Demo run</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {panelWithStatus.map((m) => {
            const run = runForModel(m.id);
            return (
              <tr key={m.id}>
                <td>
                  {m.name}
                  {m.hugging_face_id ? (
                    <span className="mono small"> {m.hugging_face_id.split("/").pop()}</span>
                  ) : null}
                </td>
                <td className="num">{m.created}</td>
                <td>{m.tier}</td>
                <td className="num">
                  {m.context_length
                    ? `${(m.context_length / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })}k`
                    : "—"}
                </td>
                <td className="num">
                  ${m.pricing_per_million.prompt} in · ${m.pricing_per_million.completion} out
                </td>
                <td>{m.runs_on}</td>
                <td>
                  {run ? (
                    <Link className="chip" to="/experiments">
                      {run.correct} / {run.n}
                    </Link>
                  ) : (
                    <span className="dim">not yet</span>
                  )}
                </td>
                <td>{m.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="table-note">
        Status values: planned means the run has not started yet; updated whenever a run is logged.
        A demo run figure links to the item-by-item evidence on the Experiments page. Projected spend
        for a full run of each model is on the <Link to="/costs">Costs page</Link>.
      </p>
    </section>
  );
}
