import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("questions page", () => {
  it("shows the model-drafted workflow and points to the taxonomy", async () => {
    const { container, findByText } = renderAt("/questions");
    expect(await findByText(/The model drafts, people decide/)).toBeInTheDocument();
    expect(container.querySelectorAll("ol.qa li").length).toBe(4);
    expect(container.textContent).toContain("Gemma 4 31B");
    expect(container.querySelector('a[href="/taxonomy"]')).not.toBeNull();
  });
});
