import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ADVERSARIAL_TRACK, BIAS_TRACK, HONESTY } from "../content/experiments";
import type { ExperimentTrack } from "../content/experiments";
import { RUNS, TYPOGRAPHIC, RUNS_CAVEAT } from "../content/runs";
import type { Run, RunItem } from "../content/runs";
import { EVIDENCE, EVIDENCE_RUNS } from "../content/evidence";
import type { EvidenceQuestion, ImageEvidence, RunCell } from "../content/evidence";
import { SampleThumb } from "../components/Thumb";

const DOT_CLASS: Record<RunItem["verdict"], string> = {
  correct: "dot ok",
  wrong: "dot bad",
  parse_fail: "dot none",
  abstained: "dot abs",
};

const RUN_NAME: Record<string, string> = { deepseek: "DeepSeek", nemotron: "Nemotron", blind: "blind" };
const RUN_HEAD: Record<string, string> = { deepseek: "DeepSeek", nemotron: "Nemotron", blind: "Blind, no image" };

function Track({ track }: { track: ExperimentTrack }) {
  return (
    <section>
      <span className="eyebrow">{track.label}</span>
      <h2>{track.title}</h2>
      <p className="prose lead-in">{track.blurb}</p>
      <div className="track-items">
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
      </div>
    </section>
  );
}

function ScoreBar({ label, correct, n, note }: { label: string; correct: number; n: number; note?: string }) {
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

function cellText(cell: RunCell): string {
  if (cell.verdict === "correct") return cell.responseText ?? "correct";
  if (cell.responseText) return cell.responseText;
  if (cell.response) return `"${cell.response}"`;
  return "no answer";
}

function ImageCard({ image }: { image: ImageEvidence }) {
  return (
    <details className="imgcard" id={`img-${image.id}`}>
      <summary>
        <span className="thumb">
          <SampleThumb src={image.thumbUrl.replace("=w512", "=w160")} alt={image.name} />
        </span>
        <span className="meta">
          <span className="nm">{image.name}</span>
          <span className="codes">
            <span className="chip code">{image.domain}</span>
            {image.caps.map((c) => (
              <span key={c} className="chip code">
                {c}
              </span>
            ))}
            <span className="chip code level">{image.levels.join(" · ")}</span>
          </span>
        </span>
        <span className="strips">
          {EVIDENCE_RUNS.map((r) => {
            const sc = image.scores[r.id];
            return (
              <span className="strip" key={r.id}>
                <span className="who">{RUN_NAME[r.id] ?? r.id}</span>
                <span className="dots">
                  {image.questions.map((q) => (
                    <span key={q.qid} className={DOT_CLASS[q.cells[r.id]?.verdict ?? "abstained"]} />
                  ))}
                </span>
                <span className="sc">
                  {sc.correct}/{sc.n}
                </span>
              </span>
            );
          })}
          <span className="open-hint">open</span>
        </span>
      </summary>
      <div className="imgdetail">
        <table className="imgtable">
          <thead>
            <tr>
              <th>Question</th>
              <th>Ground truth</th>
              {EVIDENCE_RUNS.map((r) => (
                <th key={r.id}>{RUN_HEAD[r.id] ?? r.id}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {image.questions.map((q: EvidenceQuestion) => (
              <tr key={q.qid}>
                <td>
                  {q.question}
                  <span className="mono small">
                    {" "}
                    {q.capability} · {q.level}
                  </span>
                </td>
                <td>{q.answer}</td>
                {EVIDENCE_RUNS.map((r) => {
                  const cell = q.cells[r.id];
                  return (
                    <td key={r.id}>
                      <span className={DOT_CLASS[cell.verdict]} /> <span className="ans">{cellText(cell)}</span>
                      <span className="mono small"> {cell.latencyMs ? `${cell.latencyMs} ms` : ""}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="imglinks">
          <a href={image.sourceUrl}>Open the photograph in the dataset gallery →</a>
          <Link to="/samples">See it among the samples →</Link>
        </div>
      </div>
    </details>
  );
}

function RunHeader({ run }: { run: Run }) {
  return (
    <div className="runmeta-line">
      <span className="mono small">{run.modelId}</span>
      <span className="dim">
        {run.gateway} · temperature {run.temperature} · pixel budget {run.pixelBudget} · mean{" "}
        {run.latency.mean.toLocaleString()} ms · p50 {run.latency.p50.toLocaleString()} ms
      </span>
    </div>
  );
}

export function ExperimentsPage() {
  const [missOnly, setMissOnly] = useState(false);
  const withMiss = useMemo(() => EVIDENCE.filter((e) => e.anyMiss).length, []);
  const shown = useMemo(() => (missOnly ? EVIDENCE.filter((e) => e.anyMiss) : EVIDENCE), [missOnly]);

  // Deep links from the Samples page open the matching photograph's card.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    if (el instanceof HTMLDetailsElement) el.open = true;
  }, []);

  return (
    <>
      <Track track={BIAS_TRACK} />
      <Track track={ADVERSARIAL_TRACK} />
      <section className="sec-rule">
        <span className="eyebrow">5.3 · Keeping the numbers honest</span>
        <h2>The experiments behind every score</h2>
        <div className="track-items">
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
        </div>
        <p className="table-note">
          Every frontier run is costed before it begins, and the human baseline protocol is declared
          before anyone starts.
        </p>
      </section>

      <section className="sec-rule">
        <span className="eyebrow">5.4 · First runs</span>
        <h2>The runs, image by image</h2>
        <p className="prose lead-in">
          19 October 2026 · 30 hand-drafted questions over the ten sample photographs, through{" "}
          {RUNS[0]?.gateway}. Each photograph opens into the questions it was asked, with the ground
          truth and every model's answer side by side. This is everything the runs produced, nothing
          rounded.
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

        <div className="runmeta-stack">
          {RUNS.map((r) => (
            <RunHeader key={r.id} run={r} />
          ))}
        </div>

        <div className="board-tools">
          <button type="button" className={missOnly ? "chip on" : "chip"} onClick={() => setMissOnly(false)}>
            all {EVIDENCE.length} photographs
          </button>
          <button type="button" className={missOnly ? "chip on" : "chip"} onClick={() => setMissOnly(true)}>
            where a model missed · {withMiss}
          </button>
          <span className="table-note inline">
            dots: one per question, green correct, red wrong, ochre no letter, gray abstained
          </span>
        </div>

        <div className="board">
          {shown.map((e) => (
            <ImageCard key={e.id} image={e} />
          ))}
        </div>

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
