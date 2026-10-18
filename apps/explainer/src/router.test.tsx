import { describe, expect, it } from "vitest";
import { ROUTE_PATHS } from "./router";

describe("router", () => {
  it("declares nine unique routes, in reading order", () => {
    expect(ROUTE_PATHS.length).toBe(9);
    expect(new Set(ROUTE_PATHS).size).toBe(9);
    expect(ROUTE_PATHS[4]).toBe("/samples");
  });
});
