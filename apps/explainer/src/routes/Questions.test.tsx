import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("questions page", () => {
  it("shows the six families and the authoring workflow", async () => {
    const { container, findByText } = renderAt("/questions");
    expect(await findByText(/Six question families/)).toBeInTheDocument();
    expect(container.querySelectorAll(".family").length).toBe(6);
    expect(await findByText(/Gemma 4 31B is fine-tuned on those 2,500 hand-written items/)).toBeInTheDocument();
    expect(container.querySelectorAll("ol.qa li").length).toBe(4);
  });
});
