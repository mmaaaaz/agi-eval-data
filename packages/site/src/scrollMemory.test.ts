import { describe, expect, it } from "vitest";
import { rememberScroll, restoreScroll } from "./scrollMemory";

describe("scroll memory", () => {
  it("returns the container to the exact offset it had when the modal opened", () => {
    const box = { scrollTop: 4321 };
    const slot = { top: 0 };
    rememberScroll(box, slot);
    box.scrollTop = 0; // the grid re-renders while the modal is open
    restoreScroll(box, slot);
    expect(box.scrollTop).toBe(4321);
  });

  it("does nothing when there is no scroll container", () => {
    const slot = { top: 99 };
    expect(() => rememberScroll(null, slot)).not.toThrow();
    expect(() => restoreScroll(null, slot)).not.toThrow();
    expect(slot.top).toBe(99);
  });
});
