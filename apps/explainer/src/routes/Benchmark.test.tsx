import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("benchmark page", () => {
  it("shows the numbers table and the six pipeline steps", async () => {
    const { container, findByText } = renderAt("/benchmark");
    expect(await findByText(/A benchmark of what models see and miss/)).toBeInTheDocument();
    const nums = Array.from(container.querySelectorAll("td.num")).map((td) => td.textContent);
    expect(nums).toContain("50,000");
    expect(nums).toContain("5,000");
    expect(nums).toContain("45,000");
    expect(nums).toContain("≈25,000");
    expect(container.querySelectorAll("ol.pipeline li").length).toBe(6);
    expect(await findByText(/Gemma 4 31B/)).toBeInTheDocument();
  });
});
