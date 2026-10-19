import { ADVERSARIAL_TRACK, BIAS_TRACK, HONESTY } from "../content/experiments";
import type { ExperimentTrack } from "../content/experiments";
import { RUNS, TYPOGRAPHIC, RUNS_CAVEAT } from "../content/runs";
import type { Run, RunItem } from "../content/runs";
import { SampleThumb } from "../components/Thumb";

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

const VERDICT_LABEL: Record<RunItem["verdict"], string> = {
  correct: "correct",
  wrong: "wrong choice",
  parse_fail: "no letter",
  abstained: "abstained",
};

function answerCell(it: RunItem): string {
  if (it.responseText) return it.responseText;
  if (it.response) return `"${it.response}" does not name a choice`;
  return "no answer returned";
}

function ScoreBar({
  label,
  correct,
  n,
  note,
}: {
  label: string;
  correct: number;
  n: number;
  note?: string;
}) {
  const pct = Math.round((correct / n) * 100);
  return (
    <div className="scorebar">
      <span className="nm">{label}</span>
      <div className="bartrack">
        <div className="barfill" style={{ width: `${pct}%` }} />
      </div>
      <span className="pc">
        {correct} / {n}
      </span>
      {note ? <span className="sub">{note}</span> : null}
    </div>
  );
}

function RunBlock({ run }: { run: Run }) {
  return (
    <div className="runsec">
      <div className="runhead">
        <h3>{run.label}</h3>
        <span className="mono small">{run.modelId}</span>
      </div>
      <p className="runmeta">
        {run.gateway} · temperature {run.temperature} · pixel budget {run.pixelBudget} · latency:
        mean {run.latency.mean.toLocaleString()} ms, p50 {run.latency.p50.toLocaleString()} ms
      </p>
      <table className="itemtable">
        <thead>
          <tr>
            <th aria-label="photograph" />
            <th>Question</th>
            <th>Its answer</th>
            <th>Correct answer</th>
            <th>Verdict</th>
            <th>ms</th>
          </tr>
        </thead>
        <tbody>
          {run.items.map((it) => (
            <tr key={`${run.id}-${it.qid}`} className={it.verdict === "correct" ? "ok" : "miss"}>
              <td className="thumb">
                <SampleThumb
                  src={`https://lh3.googleusercontent.com/d/${it.fileId}=w128`}
                  alt={it.sample}
                />
              </td>
              <td>
                {it.question}
                <span className="mono small">
                  {" "}
                  {it.capability} · {it.level}
                </span>
              </td>
              <td>{answerCell(it)}</td>
              <td>{it.answer}</td>
              <td>
                <span className={`vd ${it.verdict}`}>{VERDICT_LABEL[it.verdict]}</span>
              </td>
              <td className="num">{it.latencyMs.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExperimentsPage() {
  const blind = RUNS.find((r) => r.id === "blind");
  const imageRuns = RUNS.filter((r) => r.id !== "blind");
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
        <h2>Every item of the first runs, scored</h2>
        <p className="prose lead-in">
          19 October 2026 · 30 hand-drafted questions over the ten sample photographs, through{" "}
          {RUNS[0]?.gateway}. Each row below is one question: what the model answered, what the
          correct answer is, and what the harness recorded. This is everything the runs produced,
          nothing rounded.
        </p>

        <div className="chart">
          {RUNS.map((r) => (
            <ScoreBar
              key={r.id}
              label={r.label}
              correct={r.correct}
              n={r.n}
              note={
                r.parseFail
                  ? `${r.parseFail} returned no letter`
                  : r.abstained
                    ? `${r.abstained} abstained, no image`
                    : undefined
              }
            />
          ))}
        </div>
        <p className="table-note">
          Bars show correct answers out of 30. An answer without a usable choice letter counts as a
          miss. The blind run abstaining on 28 of 30 is that baseline working, not failing.
        </p>

        {imageRuns.map((r) => (
          <RunBlock key={r.id} run={r} />
        ))}
        {blind ? <RunBlock run={blind} /> : null}

        <div className="runsec">
          <div className="runhead">
            <h3>Typographic track</h3>
            <span className="mono small">DeepSeek-V4.1-Flash-1017, 8 items per banner style</span>
          </div>
          <p className="runmeta">
            The same questions with text banners rendered into the photographs: a control with no
            banner, then yes, no, none and off-topic banners.
          </p>
          {TYPOGRAPHIC.groups.map((g) => (
            <ScoreBar key={g.id} label={g.label} correct={g.correct} n={g.n} />
          ))}
          <p className="table-note">
            Eight items cannot conclude anything. At this size the banner did not move accuracy; the
            track re-runs on the full set.
          </p>
        </div>

        <p className="table-note">{RUNS_CAVEAT}</p>
      </section>
    </>
  );
}
