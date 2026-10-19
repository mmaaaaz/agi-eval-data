import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("samples page", () => {
  it("shows the disclaimer, domain filters and fifteen samples of five questions", async () => {
    const { container, findByText } = renderAt("/samples");
    expect(await findByText(/not items from the benchmark set/)).toBeInTheDocument();
    expect(container.querySelectorAll("article.sample").length).toBe(15);
    expect(container.querySelectorAll("article.sample li").length).toBe(75);
    expect(container.querySelectorAll(".filters button.chip").length).toBeGreaterThanOrEqual(9);
    const chips = Array.from(container.querySelectorAll("article.sample .chip")).map(
      (c) => c.textContent ?? "",
    );
    expect(chips.length).toBe(15);
    expect(chips.every((t) => /^D\d+/.test(t))).toBe(true);
    expect(container.querySelector('a[href*="/gallery?q="]')).not.toBeNull();
  });
});
