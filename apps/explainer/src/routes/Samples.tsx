import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { SAMPLES } from "../content/samples";
import { DOMAINS } from "../content/taxonomy";
import { SampleThumb } from "../components/Thumb";

export function SamplesPage() {
  const [domain, setDomain] = useState<string | null>(null);
  const present = useMemo(() => DOMAINS.filter((d) => SAMPLES.some((s) => s.domain === d.id)), []);
  const shown = useMemo(
    () => (domain ? SAMPLES.filter((s) => s.domain === domain) : SAMPLES),
    [domain],
  );
  const totalQuestions = useMemo(
    () => SAMPLES.reduce((n, s) => n + s.questions.length, 0),
    [],
  );

  return (
    <section>
      <span className="eyebrow">04.1 · See it</span>
      <h2>Real photographs, real questions</h2>
      <div className="prose">
        <p className="lead-in">
          {SAMPLES.length} photographs from the dataset, five example questions each, written for
          this page after looking at each image: {totalQuestions} questions across{" "}
          {present.length} of the {DOMAINS.length} scene domains. They show the shape of the
          questions the benchmark asks. They are not items from the benchmark set, and nothing
          shown here has been written into the dataset.
        </p>
      </div>

      <div className="filters" role="group" aria-label="Filter by scene domain">
        <button
          type="button"
          className={domain === null ? "chip on" : "chip"}
          onClick={() => setDomain(null)}
        >
          all · {SAMPLES.length}
        </button>
        {present.map((d) => (
          <button
            key={d.id}
            type="button"
            className={domain === d.id ? "chip on" : "chip"}
            onClick={() => setDomain(domain === d.id ? null : d.id)}
          >
            {d.id} · {d.label} · {SAMPLES.filter((s) => s.domain === d.id).length}
          </button>
        ))}
      </div>

      <div className="samples">
        {shown.map((s) => (
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
              <div className="codes">
                <Link className="chip dom" to="/taxonomy" hash={s.domain.toLowerCase()}>
                  {s.domain} · {DOMAINS.find((d) => d.id === s.domain)?.label ?? s.domain}
                </Link>
                {s.caps.map((c) => (
                  <Link key={c} className="chip code" to="/taxonomy">
                    {c}
                  </Link>
                ))}
                <span className="chip code level">{s.levels.join(" · ")}</span>
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
      <p className="table-note">
        Capability and level codes come from the taxonomy's closed sets. The ten images that ran in
        the first demonstration carry the exact codes their demo items were tagged with; the rest
        are tagged by the same rubric, before their questions were written.
      </p>
    </section>
  );
}
