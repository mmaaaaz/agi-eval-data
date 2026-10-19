import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("experiments page", () => {
  it("shows bias, adversarial and honesty experiments plus the item-by-item runs", async () => {
    const { container, findByText } = renderAt("/experiments");
    expect(await findByText(/Bias probes/)).toBeInTheDocument();
    expect(await findByText(/Adversarial probes/)).toBeInTheDocument();
    expect(await findByText(/Keeping the numbers honest/)).toBeInTheDocument();
    expect(container.querySelectorAll(".ws").length).toBe(14);
    expect(await findByText(/5\.4 · First runs/)).toBeInTheDocument();
    expect(container.querySelectorAll(".scorebar").length).toBe(8);
    expect(container.querySelectorAll(".runsec").length).toBe(4);
    expect(container.querySelectorAll(".itemtable tbody tr").length).toBe(90);
    expect(container.querySelectorAll(".vd.correct").length).toBeGreaterThanOrEqual(54);
    const body = container.textContent ?? "";
    expect(body).toContain("28 / 30");
    expect(body).toContain("25 / 30");
    expect(body).toContain("1 / 30");
  });
});
