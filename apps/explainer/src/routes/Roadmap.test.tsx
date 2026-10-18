import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("roadmap page", () => {
  it("shows five milestones with confirm markers", async () => {
    const { container, findByText } = renderAt("/roadmap");
    expect(await findByText(/From selection to submission/)).toBeInTheDocument();
    expect(container.querySelectorAll(".ms").length).toBe(5);
    expect(container.querySelectorAll(".planned").length).toBeGreaterThanOrEqual(5);
    expect(await findByText(/1 November 2026/)).toBeInTheDocument();
  });
});
