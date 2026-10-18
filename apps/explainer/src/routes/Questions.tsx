import { FACTS, n } from "../content/facts";
import { FAMILIES } from "../content/families";

export function QuestionsPage() {
  return (
    <>
      <section>
        <span className="eyebrow">03 · What we ask</span>
        <h2>Six question families</h2>
        <div className="families">
          {FAMILIES.map((f) => (
            <div className="family" key={f.id}>
              <div className="name">{f.name}</div>
              <div className="hint">{f.tests}</div>
              <div className="example">e.g. {f.example}</div>
            </div>
          ))}
        </div>
        <p className="table-note">
          Every question is answerable from the photograph itself, with one deliberate exception: the
          knowledge-boundary group asks what the image cannot supply, and it is scored separately. The
          physical reasoning probes (edges, surfaces, what supports what, how large things are) sit
          inside these families. They are where the benchmark gets its name.
        </p>
      </section>

      <section className="sec-rule">
        <span className="eyebrow">03.1 · The workflow</span>
        <h2>How questions get written</h2>
        <ol className="qa">
          <li>
            <span>
              <b>{n(FACTS.benchmark.manual)} images get five questions each, by hand.</b> One capability
              per question, with ground truth and a recorded reason for every exclusion.
            </span>
          </li>
          <li>
            <span>
              <b>
                {FACTS.generationModel.name} is fine-tuned on those{" "}
                {n(FACTS.benchmark.manual * FACTS.benchmark.questionsPerImage)} hand-written items.
              </b>{" "}
              It is then used to draft questions for the wider corpus. The fine-tune runs on the group's
              own cluster, at no cost.
            </span>
          </li>
          <li>
            <span>
              <b>
                A pre-declared, seeded rule selects {n(FACTS.benchmark.selectedFromGenerated)} more
                images.
              </b>{" "}
              Selection never looks at question quality; quality is a fixup gate, never a selection
              criterion.
            </span>
          </li>
          <li>
            <span>
              <b>Every generated item is fixed up by a person before admission.</b> The released set
              labels each question's tier: hand-written, or generated and reviewed.
            </span>
          </li>
        </ol>
      </section>
    </>
  );
}
