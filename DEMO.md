# Seen but Not Grasped — where we are

**Open: http://localhost:5173/**

---

## The dataset

| | |
| --- | --- |
| Photographs in the corpus | **56,285** |
| Survive the technical filters | **55,527** |
| **Selected for annotation** | **600**, stratified by resolution — **and now LOADED into the live store** |
| **Questions authored (LIVE, in D1)** | **1** — approved, with 1 model evaluation |

**The 600 were chosen against a quota, not at random**, because the corpus is badly skewed:
**68% of images share one stored long edge**. Random choice drifts to the common band and the rare
high-resolution images are never seen.

| resolution band | selected |
| --- | --- |
| 1–4 MP | 434 |
| under 1 MP | 91 |
| 4–12 MP | 25 |
| 12–24 MP | 25 |
| 24+ MP | 25 |

Every selected image carries its dimensions, band, orientation, camera and contributor — so any
claim about the corpus can be checked against the ledger rather than asserted.

## The categories — formed, not proposed

**21 capabilities** in four groups, each with **5 difficulty levels**:

| | |
| --- | --- |
| **G1–G8** | geometry — counting, comparison, topology |
| **P1–P8** | physics — support, stability, optics |
| **B1–B4** | bridge items, the paired geometry/physics probe |
| **PERC** | perception |
| **L1–L5** | difficulty, every capability |

**Plus** 11 domains (D1–D11), a question family, and a relevance label for error analysis.

**The taxonomy is enforced when a release is frozen**, not only when questions are generated — so a
category that exists in a paper's table always exists in the data behind it.

## What to do in the meeting

**1. Open http://localhost:5173/ and click Choose.**
One keypress judges an image and advances automatically. The next two are preloaded, so there is no
spinner. `z` undoes. `3` excludes and asks why. It steers you toward the scarce bands, so a
session does not drift to whatever is common.

**2. Gallery shows all 56,285** — searchable, filterable, with the 600 marked.

**3. Choose now reads the 600 from the database.** They are loaded as `proposed`, so the triage
   screen steers you through them and your decision overwrites the proposal. **Re-running the
   seeder cannot clobber a human decision** — the guard is in the SQL.

**4. Contribute opens an image and lets you write a question against it** — multiple choice,
numeric with a tolerance, yes/no, or free text. The form validates as you go.

**5. Status and Results show progress.**

## The two claims worth making out loud

**Spend is capped where it should be.** The only paid thing in this project is **inference on
images**. Everything else is free or local. Nine model-calling entry points each refuse to run
without an explicit flag, and a check fails the build if a new billing host appears anywhere.

**Nothing is claimed that was not measured.** The corpus size, the band skew, the selected counts —
each comes from a ledger a script reads, and a guard prevents the site or the docs from stating a
number the data does not support.

## The honest state

- **One question is authored and one model evaluation recorded** (live in D1, visible at
  `/api/questions`). The tooling works end to end; the volume is what is missing.
- **One contributor, three tags, one evaluation.** The pipeline is proven and nearly empty.
- **No image has recorded consent, and none has been PII-reviewed.** Nothing is releasable until
  that moves — it needs conversations, not code.
- **Nothing has been measured against a model**, because no questions exist to measure.

**What is ready is the machine that turns photographs into a benchmark.** The next step is people
using it.
