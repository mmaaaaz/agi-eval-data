import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("models page", () => {
  it("renders the panel as tier-grouped cards with full specs and demo-run links", async () => {
    const { container, findByText } = renderAt("/models");
    expect(await findByText(/Models we are evaluating/)).toBeInTheDocument();
    expect(container.querySelectorAll(".tiergroup").length).toBe(3);
    expect(container.querySelectorAll(".mcard").length).toBe(17);
    const body = container.textContent ?? "";
    expect(body).toContain("Gemma 4 31B");
    expect(body).toContain("in panel · updated 17 Oct 2026");
    expect(body).toContain("28 / 30");
    expect(body).toContain("25 / 30");
    for (const label of ["Released", "Context", "Price /M", "Runs on", "Demo run", "Status"]) {
      expect(body).toContain(label);
    }
    expect(body).toContain("cluster, $0");
  });
});
