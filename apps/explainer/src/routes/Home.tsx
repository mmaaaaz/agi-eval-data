import { Link } from "@tanstack/react-router";
import { FACTS, n } from "../content/facts";
import { STATUS } from "../content/status";
import { RESOURCES } from "../content/resources";

export function HomePage() {
  return (
    <>
      <header className="hero">
        <h1>
          Seen but <em>Not Grasped</em>
        </h1>
        <p className="thesis">
          A benchmark of {n(FACTS.benchmark.total)} real photographs, five questions each. It measures the gap
          between seeing and understanding. The counts, positions and plain scene facts a model can look
          straight at and still get wrong.
        </p>
        <div className="byline">
          <span>
            <span className="who">Team:</span> {FACTS.team.names}
          </span>
          <span>
            <span className="who">Collaborators:</span> {FACTS.team.collaborators}
          </span>
        </div>

        <div className="shortbox">
          <span className="lbl">The short version</span>
          <ul>
            <li>
              <b>{n(FACTS.benchmark.total)} real photographs.</b> Five questions each, every answer read off
              the image alone.
            </li>
            <li>
              <b>{n(FACTS.benchmark.manual)} images selected and annotated by hand.</b>{" "}
              {n(FACTS.benchmark.selectedFromGenerated)} written by an open model we fine-tune, then reviewed
              item by item.
            </li>
            <li>
              The contribution site is <b>live</b> and image selection is underway. The wider{" "}
              {n(FACTS.corpus.size)}-image corpus follows on {FACTS.corpus.communityRelease}.
            </li>
            <li>
              This site is the shared reference for everyone working on the benchmark, and for anyone
              joining. Corrections and questions are welcome in Slack.
            </li>
          </ul>
        </div>
      </header>

      <section className="sec-rule">
        <div className="cards">
          <Link to="/benchmark" className="card">
            <span className="k">Start here</span>
            <div className="t">What the benchmark is</div>
            <div className="d">The flow, the numbers and the reason for each step.</div>
          </Link>
          <Link to="/samples" className="card">
            <span className="k">See it</span>
            <div className="t">Real photographs, real questions</div>
            <div className="d">Ten images from the dataset with examples across domains.</div>
          </Link>
          <Link to="/models" className="card">
            <span className="k">The panel</span>
            <div className="t">Every model being run</div>
            <div className="d">Open and frontier, with the run status of each.</div>
          </Link>
        </div>
      </section>

      <section className="sec-rule">
        <span className="eyebrow">Status</span>
        <h2>Where the project stands</h2>
        <p className="prose lead-in">
          {STATUS.map((s) => (
            <span key={s.label}>
              <span className="chip">{s.label}</span>
              {s.text}{" "}
            </span>
          ))}
        </p>
      </section>

      <section className="sec-rule">
        <span className="eyebrow">References and downloads</span>
        <h2>Everything in one place</h2>
        <div className="links">
          {RESOURCES.map((r) => (
            <div className="link-row" key={r.id}>
              <span className="label">{r.label}</span>
              <span className="url">
                <a href={r.href}>{r.href}</a>
                {r.kind === "download" ? " · download" : ""} · {r.blurb}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
