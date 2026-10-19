import { describe, expect, it } from "vitest";
import { ROUTE_PATHS } from "./router";

describe("router", () => {
  it("declares ten unique routes, in reading order", () => {
    expect(ROUTE_PATHS.length).toBe(10);
    expect(new Set(ROUTE_PATHS).size).toBe(10);
    expect(ROUTE_PATHS[4]).toBe("/samples");
    expect(ROUTE_PATHS).toContain("/costs");
  });
});
