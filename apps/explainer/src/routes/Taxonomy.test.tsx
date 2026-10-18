import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("taxonomy page", () => {
  it("shows the capability groups, levels and domains with anchors", async () => {
    const { container, findByText } = renderAt("/taxonomy");
    expect(await findByText(/Every item carries a code/)).toBeInTheDocument();
    expect(container.querySelectorAll(".tax").length).toBe(37);
    expect(container.querySelector("#g1")).not.toBeNull();
    expect(container.querySelector("#perc")).not.toBeNull();
    expect(container.querySelector("#l5")).not.toBeNull();
    expect(container.querySelector("#d11")).not.toBeNull();
  });
});
