import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("evaluation page", () => {
  it("shows the nine protocol tests and the run contract", async () => {
    const { container, findByText } = renderAt("/evaluation");
    expect(await findByText(/The tests that keep the numbers honest/)).toBeInTheDocument();
    expect(container.querySelectorAll(".checks li").length).toBe(9);
    expect(await findByText(/1,440/)).toBeInTheDocument();
    expect(await findByText(/resumes instead of\s+duplicating|resumes instead of/)).toBeInTheDocument();
  });
});
