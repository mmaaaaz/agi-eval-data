import { describe, expect, it } from "vitest";
import fixtures from "./choices.fixtures.json";
import { parseChoices } from "./questions";

/**
 * The SAME fixture is asserted by scripts/harness/selftest.py against
 * release.parse_choices. One fixture, two languages: the frozen release and the review
 * screen cannot disagree about what an item's options are without a test failing on one
 * side.
 */
describe("parseChoices agrees with release.parse_choices", () => {
  for (const c of fixtures.cases) {
    it(c.why, () => {
      expect(parseChoices(c.input)).toEqual(c.expected);
    });
  }

  it("never throws, whatever it is handed", () => {
    for (const junk of [undefined, 0, false, {}, [[]], Number.NaN]) {
      expect(() => parseChoices(junk as unknown)).not.toThrow();
    }
  });
});
