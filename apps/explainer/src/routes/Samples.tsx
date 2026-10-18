import { Link } from "@tanstack/react-router";
import { SAMPLES } from "../content/samples";
import { CATEGORIES } from "../content/categories";

export function SamplesPage() {
  return (
    <section>
      <span className="eyebrow">04.1 · See it</span>
      <h2>Real photographs, real questions</h2>
      <div className="prose">
        <p className="lead-in">
          Ten photographs from the dataset, with example questions written for this page after looking at
          each image. They show the shape of the questions the benchmark asks across domains. They are not
          items from the benchmark set, and nothing shown here has been written into the dataset.
        </p>
      </div>
      <div className="samples">
        {SAMPLES.map((s) => {
          const cat = CATEGORIES.find((c) => c.id === s.category);
          return (
            <article className="sample" key={s.id}>
              <div>
                <div className="thumb">
                  <img src={s.thumbUrl} alt={s.sighted} loading="lazy" decoding="async" />
                </div>
                <p className="sighted">{s.sighted}</p>
                <a className="see" href={s.sourceUrl}>
                  View in the dataset gallery →
                </a>
              </div>
              <div>
                <div>
                  <Link className="chip" to="/categories" hash={s.category}>
                    {cat ? cat.label : s.category}
                  </Link>
                </div>
                <ul className="examples">
                  {s.questions.map((q) => (
                    <li key={q.q}>
                      <div className="q">
                        <span className="fam">{q.family}</span>
                        {q.q}
                      </div>
                      <div className="a">{q.a}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
