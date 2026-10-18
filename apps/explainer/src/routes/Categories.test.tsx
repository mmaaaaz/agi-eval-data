import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("categories page", () => {
  it("shows the ten planned categories with anchors", async () => {
    const { container, findByText } = renderAt("/categories");
    expect(await findByText(/Image categories/)).toBeInTheDocument();
    expect(container.querySelectorAll(".cat").length).toBe(10);
    expect(container.querySelectorAll(".cat .planned").length).toBe(10);
    expect(container.querySelector("#sports")).not.toBeNull();
    expect(container.querySelector("#documents-signs")).not.toBeNull();
  });
});
