import { Link } from "@tanstack/react-router";
import { panelWithStatus } from "../content/models";
import type { PanelModel } from "../content/models";
import { FACTS } from "../content/facts";
import { runForModel } from "../content/runs";

const TIERS = [
  {
    id: "open-weight",
    label: "Open weight, on the group's cluster",
    note: "$0 of cash; vLLM serves them, every run is repeatable",
  },
  {
    id: "cheap-closed",
    label: "Cheap closed, through an API",
    note: "priced per token; swept only against costed budgets",
  },
  {
    id: "frontier-closed",
    label: "Frontier closed, through an API",
    note: "the comparison tier; every run is costed before it begins",
  },
];

const fmtContext = (m: PanelModel) =>
  m.context_length
    ? `${(m.context_length / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })}k tokens`
    : "not listed";

const fmtPrice = (m: PanelModel) =>
  m.cost_tier === "free"
    ? "cluster, $0"
    : `$${m.pricing_per_million.prompt} in · $${m.pricing_per_million.completion} out, per M`;

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

      {TIERS.map((t) => {
        const models = panelWithStatus.filter((m) => m.tier === t.id);
        if (models.length === 0) return null;
        return (
          <section className="tiergroup" key={t.id}>
            <div className="tierhead">
              <h3>{t.label}</h3>
              <span className="count">{models.length}</span>
              <span className="table-note inline">{t.note}</span>
            </div>
            <div className="mgrid">
              {models.map((m) => {
                const run = runForModel(m.id);
                return (
                  <article className="mcard" key={m.id}>
                    <div className="mname">{m.name}</div>
                    <div className="mono small dim">{m.hugging_face_id ?? m.id}</div>
                    <dl className="specs">
                      <div>
                        <dt>Released</dt>
                        <dd>{m.created}</dd>
                      </div>
                      <div>
                        <dt>Context</dt>
                        <dd>{fmtContext(m)}</dd>
                      </div>
                      <div>
                        <dt>Price /M</dt>
                        <dd>{fmtPrice(m)}</dd>
                      </div>
                      <div>
                        <dt>Runs on</dt>
                        <dd>{m.runs_on}</dd>
                      </div>
                      <div>
                        <dt>Demo run</dt>
                        <dd>
                          {run ? (
                            <Link to="/experiments">
                              {run.correct} / {run.n}
                            </Link>
                          ) : (
                            <span className="dim">not yet</span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{m.status}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="table-note">
        Status values: planned means the run has not started yet; updated whenever a run is logged. A
        demo run figure links to the image-by-image evidence on the <Link to="/experiments">Experiments
        page</Link>; projected spend for a full run of each model is on the <Link to="/costs">Costs
        page</Link>.
      </p>
    </section>
  );
}
