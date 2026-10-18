import { describe, expect, it } from "vitest";
import { renderAt } from "../test/renderRoute";

describe("faq page", () => {
  it("renders twenty native details entries", async () => {
    const { container, findByText } = renderAt("/faq");
    expect(await findByText(/Everything else, answered/)).toBeInTheDocument();
    expect(container.querySelectorAll("details").length).toBe(20);
    expect(container.querySelectorAll("details summary").length).toBe(20);
  });
});
