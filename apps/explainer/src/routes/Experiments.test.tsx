import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("experiments page", () => {
  it("shows the probe tracks, run scorecard and the image-first evidence board", async () => {
    const { container, findByText } = renderAt("/experiments");
    expect(await findByText(/Bias probes/)).toBeInTheDocument();
    expect(await findByText(/Adversarial probes/)).toBeInTheDocument();
    expect(await findByText(/Keeping the numbers honest/)).toBeInTheDocument();
    expect(container.querySelectorAll(".ws").length).toBe(14);
    expect(await findByText(/5\.4 · First runs/)).toBeInTheDocument();
    expect(container.querySelectorAll(".scorebar").length).toBe(8);
    expect(container.querySelectorAll(".board-tools button").length).toBe(2);
    expect(container.querySelectorAll(".imgcard").length).toBe(10);
    expect(container.querySelectorAll(".imgtable tbody tr").length).toBe(30);
    expect(container.querySelectorAll(".dot").length).toBe(180);
    expect(container.querySelectorAll(".dot.ok").length).toBe(108);
    const body = container.textContent ?? "";
    expect(body).toContain("28 / 30");
    expect(body).toContain("25 / 30");
    expect(body).toContain("1 / 30");
  });

  it("opens each photograph into its questions with per-model answers", async () => {
    const { container, findByText } = renderAt("/experiments");
    await findByText(/5\.4 · First runs/);
    const first = container.querySelector(".imgcard");
    expect(first?.tagName.toLowerCase()).toBe("details");
    const table = first?.querySelector(".imgtable");
    expect(table?.textContent ?? "").toContain("Ground truth");
    expect(table?.textContent ?? "").toContain("Blind, no image");
  });
});
