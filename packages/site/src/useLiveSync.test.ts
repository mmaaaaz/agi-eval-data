import { describe, expect, it } from "vitest";
import { decidePoll } from "./useLiveSync";

/**
 * THE COST RULE, asserted.
 *
 * The file's whole reason for existing is that D1 bills rows read and a naive poll is a full
 * table scan. "An idle tab costs one row per poll and nothing else" is a claim about three
 * branches, and all three of them used to live inside a useEffect closure where nothing could
 * check them.
 */
const base = { visible: true, inFlight: false, known: true, head: 10, current: 10 };

describe("the poll decision", () => {
  it("fetches when the cursor has moved", () => {
    expect(decidePoll({ ...base, head: 11 })).toBe("fetch");
  });

  it("does NOT fetch when the cursor is unchanged", () => {
    // The claim behind the whole design: an idle tab reads one cursor row and stops.
    expect(decidePoll(base)).toBe("skip");
  });

  it("does NOT poll while the tab is hidden", () => {
    expect(decidePoll({ ...base, visible: false, head: 99 })).toBe("skip");
  });

  it("does NOT poll while a request is already in flight", () => {
    // Otherwise a slow relay turns a 15s interval into overlapping requests.
    expect(decidePoll({ ...base, inFlight: true, head: 99 })).toBe("skip");
  });

  it("RECORDS on first contact rather than replaying the log", () => {
    // A client that has never synced must not fetch the entire change history.
    expect(decidePoll({ ...base, known: false, current: null, head: 5000 })).toBe("record");
  });

  it("records even when the cursor would look like it moved", () => {
    // current is null on first contact; comparing null against head must not fall through to
    // fetch, which is the expensive mistake this branch exists to prevent.
    expect(decidePoll({ ...base, known: false, current: null, head: 1 })).toBe("record");
  });

  it("treats a cursor going backwards as no change, not as a fetch", () => {
    // A restored database or a rolled-back sequence must not look like new work.
    expect(decidePoll({ ...base, head: 5, current: 10 })).toBe("skip");
  });

  it("hidden wins over a moved cursor", () => {
    expect(decidePoll({ ...base, visible: false, head: 9999, inFlight: false })).toBe("skip");
  });
});
