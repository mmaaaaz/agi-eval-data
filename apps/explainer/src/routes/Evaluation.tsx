import { EVAL_TESTS } from "../content/evalTests";

export function EvaluationPage() {
  return (
    <>
      <section>
        <span className="eyebrow">05 · How we evaluate</span>
        <h2>The tests that keep the numbers honest</h2>
        <ul className="checks">
          {EVAL_TESTS.map((t) => (
            <li key={t.lead}>
              <span>
                <strong>{t.lead}</strong> {t.detail}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="sec-rule">
        <span className="eyebrow">05.1 · How a run works</span>
        <h2>One configuration, one frozen release</h2>
        <div className="prose">
          <p className="lead-in">
            Runs execute through the measurement harness and only ever touch a frozen, hashed release of
            the benchmark. Each response is stored with the release hash and the image hash, and graded
            into correct, close, wrong, unanswered or unparseable. A re-run resumes instead of
            duplicating. Every frontier run is costed before it starts.
          </p>
        </div>
      </section>
    </>
  );
}
