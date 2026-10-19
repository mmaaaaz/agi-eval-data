import { ADVERSARIAL_TRACK, BIAS_TRACK, HONESTY } from "../content/experiments";
import type { ExperimentTrack } from "../content/experiments";
import { FIRST_RUNS } from "../content/firstRuns";

function Track({ track }: { track: ExperimentTrack }) {
  return (
    <section>
      <span className="eyebrow">{track.label}</span>
      <h2>{track.title}</h2>
      <p className="prose lead-in">{track.blurb}</p>
      {track.items.map((it) => (
        <div className="ws" key={it.lead}>
          <h3>{it.lead}</h3>
          <p>
            <b>What we run.</b> {it.what}
          </p>
          <p>
            <b>Why it matters.</b> {it.why}
          </p>
        </div>
      ))}
    </section>
  );
}

export function ExperimentsPage() {
  return (
    <>
      <Track track={BIAS_TRACK} />
      <Track track={ADVERSARIAL_TRACK} />
      <section className="sec-rule">
        <span className="eyebrow">5.3 · Keeping the numbers honest</span>
        <h2>The experiments behind every score</h2>
        {HONESTY.map((it) => (
          <div className="ws" key={it.lead}>
            <h3>{it.lead}</h3>
            <p>
              <b>What we run.</b> {it.what}
            </p>
            <p>
              <b>Why it matters.</b> {it.why}
            </p>
          </div>
        ))}
        <p className="table-note">
          Every frontier run is costed before it begins, and the human baseline protocol is declared
          before anyone starts.
        </p>
      </section>

      <section className="sec-rule">
        <span className="eyebrow">5.4 · First runs</span>
        <h2>{FIRST_RUNS.title}</h2>
        <p className="prose lead-in">
          {FIRST_RUNS.date} · {FIRST_RUNS.release}, with the blind and typographic tracks on the
          same set.
        </p>
        <div className="runs">
          {FIRST_RUNS.rows.map((r) => (
            <div className="run-row" key={r.id}>
              <span className="score">{r.score}</span>
              <span>
                <strong>{r.what}</strong>
                <span className="sub">{r.note}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="table-note">{FIRST_RUNS.caveat}</p>
      </section>
    </>
  );
}
