import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("home page", () => {
  it("shows the thesis, four short-version bullets, status chips and the references", async () => {
    const { container, findByText } = renderAt("/");
    expect(await findByText(/A benchmark built on 50,000 real photographs/)).toBeInTheDocument();
    expect(container.querySelectorAll(".shortbox li").length).toBe(4);
    expect(container.querySelectorAll(".chip").length).toBeGreaterThanOrEqual(4);
    expect(await findByText(/BBQ-V/)).toBeInTheDocument();
    expect(container.querySelector('a[href="/docs/seen-but-not-grasped-briefing.docx"]')).not.toBeNull();
  });
});
