import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("models page", () => {
  it("renders the panel from the harness snapshot, including DeepSeek-V4.1-Flash-1017", async () => {
    const { container, findByText } = renderAt("/models");
    expect(await findByText(/Models we are evaluating/)).toBeInTheDocument();
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThanOrEqual(17);
    const body = container.querySelector("tbody")?.textContent ?? "";
    expect(body).toContain("DeepSeek-V4.1-Flash-1017");
    expect(body).toContain("in panel · updated 17 Oct 2026");
    expect(body).toContain("Gemma 4 31B");
  });
});
