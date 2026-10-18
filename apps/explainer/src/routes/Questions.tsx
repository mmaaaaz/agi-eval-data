import { Link } from "@tanstack/react-router";
import { FACTS, n } from "../content/facts";

export function QuestionsPage() {
  return (
    <>
      <section>
        <span className="eyebrow">03 · How questions get written</span>
        <h2>The model drafts, people decide</h2>
        <div className="prose">
          <p className="lead-in">
            Candidate questions are drafted by {FACTS.generationModel.name} across the whole dataset.
            Reviewers pick the ones that hold up: nothing enters the benchmark without a recorded
            human review, and no unreviewed item is ever admitted.
          </p>
        </div>
        <ol className="qa">
          <li>
            <span>
              <b>Draft across the corpus.</b> {FACTS.generationModel.name} proposes questions for
              photographs across all {n(FACTS.dataset.total)} images, about five per image.
            </span>
          </li>
          <li>
            <span>
              <b>Tag every candidate.</b> Each one is recorded with its capability code (G, P, B or
              PERC), its reasoning level (L1 to L5) and the image's scene domain (D1 to D11).
            </span>
          </li>
          <li>
            <span>
              <b>Review and pick.</b> People review every candidate: edit, accept or reject, with the
              decision recorded. {n(FACTS.dataset.handPicked)} hand-picked images form the curated
              benchmark.
            </span>
          </li>
          <li>
            <span>
              <b>Fix up before admission.</b> Editors repair wording and ground truth. The remaining{" "}
              {n(FACTS.dataset.communityOpen)} images stay open for the community.
            </span>
          </li>
        </ol>
        <p className="table-note">
          Every item carries codes from a closed taxonomy so results can be reported per capability,
          level and domain. The full list lives on the <Link to="/taxonomy">Taxonomy</Link> page.
        </p>
      </section>
    </>
  );
}
