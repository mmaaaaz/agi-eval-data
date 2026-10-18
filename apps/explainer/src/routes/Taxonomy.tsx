import { BIAS_AXES, CAPABILITY_GROUPS, DOMAINS, LEVELS, SENSITIVITY } from "../content/taxonomy";

export function TaxonomyPage() {
  return (
    <>
      <section>
        <span className="eyebrow">04 · The taxonomy</span>
        <h2>Every item carries a code</h2>
        <div className="prose">
          <p className="lead-in">
            Three closed lists, so a result can always be reported against them: a capability, a
            reasoning level, and the scene domains of the image. Nothing is scored by an invented
            label, and the lists are mirrored from the pipeline code and checked in CI.
          </p>
        </div>
        {CAPABILITY_GROUPS.map((g) => (
          <div className="tax-group" key={g.id}>
            <h3>
              {g.label} <span className="mono">· {g.note}</span>
            </h3>
            <div className="tax-grid">
              {g.codes.map((c) => (
                <div className="tax" key={c.id} id={c.id.toLowerCase()}>
                  <span className="code">{c.id}</span>
                  <span className="lbl">{c.label}</span>
                  <div className="note">{c.note}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="sec-rule">
        <span className="eyebrow">04.1 · Reasoning level</span>
        <h2>How many steps it takes</h2>
        <div className="tax-grid">
          {LEVELS.map((c) => (
            <div className="tax" key={c.id} id={c.id.toLowerCase()}>
              <span className="code">{c.id}</span>
              <span className="lbl">{c.label}</span>
              <div className="note">e.g. {c.note}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="sec-rule">
        <span className="eyebrow">04.2 · Scene domain</span>
        <h2>What kind of scene it is</h2>
        <div className="tax-grid">
          {DOMAINS.map((c) => (
            <div className="tax" key={c.id} id={c.id.toLowerCase()}>
              <span className="code">{c.id}</span>
              <span className="lbl">{c.label}</span>
            </div>
          ))}
        </div>
        <p className="table-note">Domains are used for balanced coverage during selection, never for scoring.</p>
      </section>

      <section className="sec-rule">
        <span className="eyebrow">04.3 · Bias and fairness</span>
        <h2>What a model assumes about people</h2>
        <div className="tax-grid">
          {BIAS_AXES.map((c) => (
            <div className="tax" key={c.id} id={c.id.toLowerCase()}>
              <span className="code">{c.id}</span>
              <span className="lbl">{c.label}</span>
              <div className="note">{c.note}</div>
            </div>
          ))}
        </div>
        <p className="table-note">
          Bias probes are scored on their own, next to the perception tests. The axis letter is F:
          B1 to B4 is the bridge-pair set. The Experiments page carries the probe designs.
        </p>
      </section>

      <section className="sec-rule">
        <span className="eyebrow">04.4 · Sensitive content</span>
        <h2>What gets flagged before questions are written</h2>
        <div className="tax-grid">
          {SENSITIVITY.map((c) => (
            <div className="tax" key={c.id} id={c.id.toLowerCase()}>
              <span className="code">{c.id}</span>
              <span className="lbl">{c.label}</span>
              <div className="note">{c.note}</div>
            </div>
          ))}
        </div>
        <p className="table-note">
          An image that trips any of these is flagged in the annotation record and no questions are
          written about it.
        </p>
      </section>
    </>
  );
}
