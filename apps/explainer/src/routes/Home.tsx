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
          A benchmark built on {n(FACTS.dataset.total)} real photographs. It measures the gap between
          seeing and understanding: the counts, positions and plain scene facts a model can look
          straight at and still get wrong. Questions are drafted by an open model we run ourselves,
          reviewed and picked by people, and {n(FACTS.dataset.handPicked)} hand-picked images form the
          curated set.
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
              <b>{n(FACTS.dataset.total)} real photographs.</b> Questions are drafted across the full
              dataset, about five per image, and every admitted item is reviewed by a person.
            </li>
            <li>
              <b>{n(FACTS.dataset.handPicked)} hand-picked images.</b> The curated benchmark, with
              balanced coverage of scene domains and codes on every item.
            </li>
            <li>
              <b>{n(FACTS.dataset.communityOpen)} images stay open.</b> The remaining images remain
              available for the community to contribute to.
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
          <a href="/anatomy.html" className="card">
            <span className="k">The anatomy</span>
            <div className="t">The pipeline as one machine</div>
            <div className="d">An interactive figure: plates, drafting, review, and the two shelves.</div>
          </a>
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
