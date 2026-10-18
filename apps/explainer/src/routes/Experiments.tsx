import { ADVERSARIAL_TRACK, BIAS_TRACK, HONESTY } from "../content/experiments";
import type { ExperimentTrack } from "../content/experiments";

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
    </>
  );
}
