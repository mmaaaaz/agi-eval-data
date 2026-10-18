import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("experiments page", () => {
  it("shows bias, adversarial and honesty experiments", async () => {
    const { container, findByText } = renderAt("/experiments");
    expect(await findByText(/Bias probes/)).toBeInTheDocument();
    expect(await findByText(/Adversarial probes/)).toBeInTheDocument();
    expect(await findByText(/Keeping the numbers honest/)).toBeInTheDocument();
    expect(container.querySelectorAll(".ws").length).toBe(14);
  });
});
