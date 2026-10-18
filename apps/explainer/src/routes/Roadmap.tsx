import { FACTS } from "../content/facts";
import { MILESTONES } from "../content/roadmap";

export function RoadmapPage() {
  return (
    <section>
      <span className="eyebrow">07 · The plan</span>
      <h2>From selection to submission</h2>
      <div className="prose">
        <p className="lead-in">
          Results freeze is targeted for {FACTS.freezeTarget}, ahead of the research submission. Windows
          are intentionally coarse while the calendar settles, and items marked dates to confirm will be
          dated as the team locks them.
        </p>
      </div>
      <div className="roadmap">
        {MILESTONES.map((m) => (
          <div className="ms" key={m.id}>
            <div>
              <div className="when">{m.window}</div>
              <div className="title">{m.title}</div>
              {m.confirm ? <div className="planned">dates to confirm</div> : null}
            </div>
            <ul>
              {m.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
