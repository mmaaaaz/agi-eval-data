import { FACTS, n } from "../content/facts";
import { PIPELINE } from "../content/pipeline";

export function BenchmarkPage() {
  return (
    <>
      <section>
        <span className="eyebrow">01 · What this is</span>
        <h2>A benchmark of what models see and miss</h2>
        <div className="prose">
          <p>
            We are building a benchmark on a dataset of {n(FACTS.dataset.total)} real-world
            photographs, with about five questions per image across the set. Each question is
            answerable from the photograph alone, and each is designed to be easy for a person and
            hard for a model: a count under clutter, the text on a sign, which of two cups sits on
            the left.
          </p>
          <p className="lead-in">
            Existing benchmarks report scores. Ours is built to explain them. Every item carries
            codes from a closed taxonomy (capability, level and scene domain), so a result can be
            reasoned about rather than just ranked. Questions are drafted by the model across the
            whole dataset; {n(FACTS.dataset.handPicked)} hand-picked images form the curated
            benchmark, and the remaining {n(FACTS.dataset.communityOpen)} stay open for the
            community to contribute to.
          </p>
        </div>
      </section>

      <section className="sec-rule">
        <span className="eyebrow">02 · The benchmark at a glance</span>
        <h2>The numbers, and the order they get built in</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: 130 }}>Figure</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="num">{n(FACTS.dataset.total)}</td>
              <td>photographs in the dataset; questions are drafted across all of them</td>
            </tr>
            <tr>
              <td className="num">{n(FACTS.dataset.handPicked)}</td>
              <td>hand-picked images in the curated benchmark</td>
            </tr>
            <tr>
              <td className="num">{n(FACTS.dataset.communityOpen)}</td>
              <td>images open for community contribution</td>
            </tr>
            <tr>
              <td className="num">≈{n(FACTS.benchmark.qaPairs)}</td>
              <td>reviewed question-answer pairs in the benchmark</td>
            </tr>
            <tr>
              <td className="num">L1–L5</td>
              <td>the reasoning level recorded on every item</td>
            </tr>
            <tr>
              <td className="num">D1–D11</td>
              <td>the scene domains recorded on every image</td>
            </tr>
          </tbody>
        </table>

        <ol className="pipeline">
          {PIPELINE.map((s) => (
            <li key={s.n}>
              <span>
                <strong>{s.title}</strong>
                <span className="sub">{s.note}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
