import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";
import { PANEL } from "../content/models";
import { COST_ROWS, PLAN, SCENARIOS } from "../content/costs";

describe("costs page", () => {
  it("renders the projection, every model priced, and the ranked scenarios", async () => {
    const { container, findByText } = renderAt("/costs");
    expect(await findByText(/What a full run would cost/)).toBeInTheDocument();
    const rows = container.querySelectorAll(".costtable tbody tr");
    expect(rows.length).toBe(PANEL.length);
    const body = container.textContent ?? "";
    expect(body).toContain("recommended");
    expect(body).toContain("$0");
    expect(body).toContain("25,000");
    expect(container.querySelectorAll(".scen").length).toBe(SCENARIOS.length);
  });

  it("computes every projection from the panel's own prices", () => {
    expect(COST_ROWS.length).toBe(PANEL.length);
    const ds = COST_ROWS.find((r) => r.id === "deepseek/deepseek-v4.1-flash-1017");
    expect(ds).toBeDefined();
    // 25,000 items at 1,750 in + 24 out tokens: 6.92 USD at 0.15 / 0.6 per million.
    expect(ds!.fullUsd).toBeCloseTo(6.92, 1);
    const free = COST_ROWS.filter((r) => r.free);
    expect(free.length).toBeGreaterThanOrEqual(6);
    for (const r of free) expect(r.fullUsd).toBe(0);
    expect(PLAN.totalUsd).toBeGreaterThan(0);
    expect(PLAN.totalUsd).toBeLessThan(PLAN.everythingFullUsd);
    expect(SCENARIOS[0].on).toBe(true);
    expect(SCENARIOS[0].usd).toBe(PLAN.totalUsd);
  });
});
