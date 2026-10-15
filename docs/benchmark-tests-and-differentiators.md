# Tests to run, and what to do differently to the published benchmarks

**Written 2026-10-14. Two parts: the tests worth running, and the specific ways the published
benchmarks are weak — so this project can be strong where they are not.**

Kept short on purpose. Each test says *what it is*, *why it earns trust*, and *whether we already
have it*.

---

## Part 1 — The tests, in the order they earn credibility

### 1. Accuracy, **paired**, with bootstrap confidence intervals
**What:** every model answers the *same* items; the interval is computed over items, not assumed.

**Why:** a paired design needs **n ≈ 1,440** to detect a 2-point gap. An unpaired one needs
**n ≈ 18,400**. This is the single most important number in the plan — it is *why* 2,000 images.

**Why they are weak here:** none of the five published benchmarks reports a confidence interval at
all. RealWorldQA's 765 items carry **±3.5 pp**, so its published ranking of five models is not
evidence.

**We have:** `analyze.py` computes intervals. **Status: built, unused.**

---

### 2. The no-image baseline
**What:** ask every question with the image **removed**.

**Why:** anything answered correctly was never vision-dependent. MMStar found **Gemini Pro scores
42.9% on MMMU with no image at all** — above chance by 24 points across six benchmarks.

**Why it matters most for us:** this is the test that separates *"the model reasoned about the
photograph"* from *"the model guessed from the words."* Without it, a high score means nothing.

**We have:** `blind.py` and the blind pass. **Status: built, unused.**

---

### 3. The constant-answer baseline
**What:** what a model scores by always answering the same thing.

**Why:** it is the cheapest credibility purchase available, and it catches the failure where a
model looks competent because the answer distribution is skewed. Two of six GRIP runs scored
**below** this baseline.

**We have:** `constant_answer_baseline` in `analyze.py`. **Status: built, unused.**

---

### 4. Calibration — ECE and Brier
**What:** does the model know when it is unsure?

**Why:** **none of the five benchmarks measures this.** The failure that matters in the real world
is not the wrong answer, it is the *confident* wrong answer.

**We have:** three confidence arms and ECE/Brier in `analyze.py`. **Status: built, unused.**

---

### 5. Abstention and risk–coverage
**What:** an explicit *"cannot be determined from this image"* option on a defined subset, and the
curve of accuracy against how often the model answers.

**Why:** some photographs genuinely cannot settle a question — occlusion, no scale reference, no
depth cue. A benchmark that forces an answer measures guessing.

**Caution:** do not offer it on every item; it interacts with option bias. Define the subset first.

---

### 6. Option-order robustness
**What:** ask each question with the options rotated; the model must pass on all rotations.

**Why:** MMBench's own numbers show position bias is larger than the gap between models —
OpenFlamingo scored **2.6%** under circular evaluation against 36.7% without.

---

### 7. Option-leakage test
**What:** can the correct option be picked from the image **and the options alone**, without the
question text?

**Why:** a published analysis found this on RealWorldQA and SEED-Bench. If it holds for us, the
questions are decorative.

---

### 8. Per-capability n, floored
**What:** never report a per-category number computed from too few items.

**Why:** SEED-Bench ships a dimension with **n = 85** and ranks models on it. Our harness already
refuses to report a number it cannot support.

---

### 9. A human baseline, documented **before** it runs
**What:** at least two tiers of human performance on the same items.

**Why:** PhysBench's protocol is *"each question was assigned to all annotators"* — ambiguous two
years later and impossible to fix retrospectively.

---

## Part 2 — What to do differently

| The published benchmarks | What we do instead |
| --- | --- |
| **No confidence intervals anywhere.** PhysBench: zero hits for "confidence interval" | paired bootstrap CIs on every number |
| **No calibration, no abstention.** "Refuse to answer" is only an error category | ECE, Brier, risk–coverage, a "cannot be determined" subset |
| **~1 question per image** (PhysBench 1.02; RealWorldQA 1.0) | **5 questions per image**, each a *different* capability |
| **PhysBench is 51% simulation** (5,107 of 10,002) | **100% real photographs** |
| **No out-of-distribution split.** A reviewer: *"the test set is derived from the similar set of images as train"* | hold out a contributor, or a camera |
| **26.6% of PhysBench questions are exact duplicates** (one template ×126) | "5 **different capabilities**" enforced at save time |
| **No inter-annotator agreement in any of the five** | report κ on the manual set — cheap, and they cannot |
| **Contradictory numbers across their own artifacts** (MMBench: 3,217 / 2,974 / 2,948; MMMU: 30 vs 32 image types) | our guards already fail on this class |
| **Unstated provenance** (RealWorldQA: "anonymized images from vehicles", no sampling frame) | a committed ledger: every selection decision, reproducible from a seed |
| **Per-category n with no floor** | floors, and the harness refuses to report below them |

### The three sentences worth saying out loud

1. **We report confidence intervals; they do not.** That is the difference between a ranking and a
   guess.
2. **We ask with the image removed.** That is the test that separates vision from language prior,
   and it is the critique that has been aimed at MMMU, MMBench, SEED-Bench and RealWorldQA alike.
3. **Our images are real photographs, not renders.** PhysBench is half simulation; we are not.

### And the two things to decide before writing anything

- **The human baseline protocol** — who, how many, on which items, and what "expert" means.
  Decide it before the first question, because it cannot be reconstructed afterwards.
- **The licence of the image corpus.** A benchmark that cannot be redistributed is not a
  benchmark. RealWorldQA is CC BY-ND — *no derivatives* — which is a poor fit for something meant
  to be extended.
