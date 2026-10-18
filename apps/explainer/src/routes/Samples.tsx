import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { SAMPLES } from "../content/samples";
import { DOMAINS } from "../content/taxonomy";

function SampleThumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="thumb-fallback" role="img" aria-label={alt}>
        The photograph could not be loaded here. Open it in the dataset gallery instead.
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function SamplesPage() {
  return (
    <section>
      <span className="eyebrow">04.1 · See it</span>
      <h2>Real photographs, real questions</h2>
      <div className="prose">
        <p className="lead-in">
          Ten photographs from the dataset, with example questions written for this page after looking
          at each image. They show the shape of the questions the benchmark asks across domains. They
          are not items from the benchmark set, and nothing shown here has been written into the
          dataset.
        </p>
      </div>
      <div className="samples">
        {SAMPLES.map((s) => (
          <article className="sample" key={s.id}>
            <div>
              <div className="thumb">
                <SampleThumb src={s.thumbUrl} alt={s.sighted} />
              </div>
              <p className="sighted">{s.sighted}</p>
              <a className="see" href={s.sourceUrl}>
                View in the dataset gallery →
              </a>
            </div>
            <div>
              <div>
                <Link className="chip" to="/taxonomy" hash={s.domain.toLowerCase()}>
                  {s.domain} · {DOMAINS.find((d) => d.id === s.domain)?.label ?? s.domain}
                </Link>
              </div>
              <ul className="examples">
                {s.questions.map((q) => (
                  <li key={q.q}>
                    <div className="q">{q.q}</div>
                    <div className="a">{q.a}</div>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
