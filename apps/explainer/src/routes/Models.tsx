import { panelWithStatus } from "../content/models";
import { FACTS } from "../content/facts";

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
          reported as results.
        </p>
        <p className="lead-in">
          Question generation is fine-tuned on <strong>{FACTS.generationModel.name}</strong>, then the
          draft pool is selected down by a pre-declared rule. The snapshot below was assembled in October
          2026.
        </p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Released</th>
            <th>Tier</th>
            <th>Runs on</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {panelWithStatus.map((m) => (
            <tr key={m.id}>
              <td>
                {m.name}
                {m.hugging_face_id ? (
                  <span className="mono"> {m.hugging_face_id.split("/").pop()}</span>
                ) : null}
              </td>
              <td className="num">{m.created}</td>
              <td>{m.tier}</td>
              <td>{m.runs_on}</td>
              <td>{m.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="table-note">
        Status values: planned means the run has not started yet. Updated whenever a run is logged.
      </p>
    </section>
  );
}
