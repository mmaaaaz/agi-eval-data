import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("samples page", () => {
  it("shows the disclaimer, domain filters, taxonomy codes and fifteen samples of five questions", async () => {
    const { container, findByText } = renderAt("/samples");
    expect(await findByText(/not items from the benchmark set/)).toBeInTheDocument();
    expect(container.querySelectorAll("article.sample").length).toBe(15);
    expect(container.querySelectorAll("article.sample li").length).toBe(75);
    expect(container.querySelectorAll(".filters button.chip").length).toBeGreaterThanOrEqual(9);
    const dom = Array.from(container.querySelectorAll("article.sample .chip.dom")).map(
      (c) => c.textContent ?? "",
    );
    expect(dom.length).toBe(15);
    expect(dom.every((t) => /^D\d+/.test(t))).toBe(true);
    const codes = Array.from(container.querySelectorAll("article.sample .chip.code")).map(
      (c) => c.textContent ?? "",
    );
    expect(codes.length).toBeGreaterThanOrEqual(30);
    expect(codes.some((t) => /^L\d/.test(t))).toBe(true);
    expect(container.querySelector('a[href*="/gallery?q="]')).not.toBeNull();
  });
});
