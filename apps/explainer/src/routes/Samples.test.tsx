import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("samples page", () => {
  it("shows the disclaimer and ten domain-tagged samples with example questions", async () => {
    const { container, findByText } = renderAt("/samples");
    expect(await findByText(/not items from the benchmark set/)).toBeInTheDocument();
    expect(container.querySelectorAll("article.sample").length).toBe(10);
    expect(container.querySelectorAll("article.sample li").length).toBeGreaterThanOrEqual(30);
    const chips = Array.from(container.querySelectorAll("article.sample .chip")).map(
      (c) => c.textContent ?? "",
    );
    expect(chips.length).toBe(10);
    expect(chips.every((t) => /^D\d+/.test(t))).toBe(true);
    expect(container.querySelector('a[href*="/gallery?q="]')).not.toBeNull();
  });
});
