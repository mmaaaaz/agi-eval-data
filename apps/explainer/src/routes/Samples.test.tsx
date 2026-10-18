import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("samples page", () => {
  it("shows the disclaimer and ten samples with example questions", async () => {
    const { container, findByText } = renderAt("/samples");
    expect(await findByText(/not items from the benchmark set/)).toBeInTheDocument();
    expect(container.querySelectorAll("article.sample").length).toBe(10);
    expect(container.querySelectorAll("article.sample li").length).toBeGreaterThanOrEqual(30);
    expect(container.querySelector('a[href*="/gallery?q="]')).not.toBeNull();
  });
});
