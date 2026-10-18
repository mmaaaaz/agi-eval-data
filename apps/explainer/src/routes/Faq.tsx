import { FAQ } from "../content/faq";

export function FaqPage() {
  return (
    <section>
      <span className="eyebrow">08 · Questions we get</span>
      <h2>Everything else, answered</h2>
      <div className="prose">
        <p className="lead-in">
          Short answers to the questions that come up most. If something is missing, say so in Slack and
          it gets added here.
        </p>
      </div>
      <div className="faq">
        {FAQ.map((e) => (
          <details key={e.q}>
            <summary>{e.q}</summary>
            <div className="ans">{e.a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}
