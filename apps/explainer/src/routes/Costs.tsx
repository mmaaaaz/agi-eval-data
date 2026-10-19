import { Link } from "@tanstack/react-router";
import {
  COST_ASSUMPTIONS,
  COST_ROWS,
  FRONTIER_SLICE_ITEMS,
  LATENCY_ROWS,
  PLAN,
  SCENARIOS,
  outTokensPerItem,
  tokensPerItem,
} from "../content/costs";

const money = (n: number) =>
  n === 0
    ? "$0"
    : n >= 1000
      ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : `$${n.toFixed(2)}`;

const perItem = (n: number) => `${(n * 100).toFixed(3)}¢`;

export function CostsPage() {
  const sorted = [...COST_ROWS].sort((a, b) => a.fullUsd - b.fullUsd);
  return (
    <section>
      <span className="eyebrow">06.1 · Costs</span>
      <h2>What a full run would cost</h2>
      <div className="prose">
        <p className="lead-in">
          The only money this project spends is model inference over images. Question drafting runs on
          the group's own cluster, hosting and storage sit on free tiers, and nothing else is allowed to
          cost anything. The projection below prices the panel's{" "}
          {COST_ASSUMPTIONS.items.toLocaleString()} items against the panel's own list.
        </p>
      </div>

      <div className="costhead">
        <div>
          <span className="big">{money(PLAN.totalUsd)}</span>
          <span className="sub">the planned panel, scenario A below</span>
        </div>
        <div>
          <span className="big">{money(PLAN.everythingFullUsd)}</span>
          <span className="sub">if every priceable model ran the full set</span>
        </div>
        <div>
          <span className="big">$0</span>
          <span className="sub">{PLAN.freeModels} open-weight models on the group's cluster</span>
        </div>
      </div>

      <h3>The assumptions, all of them</h3>
      <ul className="assumptions">
        <li>
          One item costs about {tokensPerItem.toLocaleString()} input tokens (the photograph at the
          standard pixel budget plus the question) and about {outTokensPerItem} output tokens.
        </li>
        <li>
          One full pass is {COST_ASSUMPTIONS.items.toLocaleString()} items. {COST_ASSUMPTIONS.tokenNote}.
        </li>
        <li>{COST_ASSUMPTIONS.priceNote}, per million tokens.</li>
        <li>
          Cluster runs (vLLM) are $0 of cash: the machines belong to the group. A model that refuses to
          answer still produces a result, so nothing is paid twice.
        </li>
      </ul>

      <table className="costtable">
        <thead>
          <tr>
            <th>Model</th>
            <th>Tier</th>
            <th>Priced, per M tokens</th>
            <th>One item</th>
            <th>{COST_ASSUMPTIONS.items.toLocaleString()} items</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.tier}</td>
              <td className="num">
                {r.free ? "cluster, $0" : `$${r.promptPrice} in · $${r.completionPrice} out`}
              </td>
              <td className="num">{r.free ? "$0" : perItem(r.perItemUsd)}</td>
              <td className="num">{money(r.fullUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="table-note">
        Prices are the October 2026 snapshot from <span className="mono">scripts/harness/models.json</span>,
        the same file the harness reads at run time.
      </p>

      <h3>Three ways to run it, ranked</h3>
      {SCENARIOS.map((s) => (
        <div className="scen" key={s.id}>
          <div className="shead">
            <strong>{s.label}</strong>
            <span className="big small">{money(s.usd)}</span>
          </div>
          <p>{s.detail}</p>
          {s.on ? <span className="vd correct">recommended</span> : null}
        </div>
      ))}
      <p className="table-note">
        Scenario A buys the frontier comparison on {FRONTIER_SLICE_ITEMS.toLocaleString()} items, which
        is enough to place each frontier model against the free cluster tier without paying full-set
        prices for five models at once.
      </p>

      <h3>What the demo measured</h3>
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Mean per call</th>
            <th>p50</th>
            <th>Full set, serial upper bound</th>
          </tr>
        </thead>
        <tbody>
          {LATENCY_ROWS.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="num">{(r.meanMs / 1000).toFixed(1)} s</td>
              <td className="num">{(r.p50Ms / 1000).toFixed(1)} s</td>
              <td className="num">{Math.round(r.serialHoursForFullSet).toLocaleString()} h</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="table-note">
        Latency is measured on the 30-item demo runs and is real; the serial figure is an upper bound
        that parallel workers divide down. Beyond inference there is nothing to pay for: drafting,
        hosting and storage all run on the group's machines or free tiers. The demo traces and totals
        are on the <Link to="/experiments">Experiments page</Link>.
      </p>
    </section>
  );
}
