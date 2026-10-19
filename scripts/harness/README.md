# The local evaluation harness

**Why this exists.** The site used to run models in the browser with the visitor's own
key: no fixed pixel budget, no seed, no temperature lock, no retry policy, and no
record of whether an answer failed to parse. None of that is publishable. Evaluation
moved here (ADR-0004). The site authors and displays; the harness measures.

**The spend rule.** This harness is the *only* place money is allowed to go: GPU or API
time to run models on images. Everything it depends on — the frozen release, the image
cache, the trace file — is local and free. **The spend rule is the owner's, and it is enforced here rather than documented here** — `spend.py` is the gate, and the rule it serves is stated in `AGENTS.md`.

## The five properties that make results publishable

1. **Reads a frozen release, never the live database.** `release/v1/`.
2. **Hashes the exact bytes it sent.** Every trace row carries `image_sha256`.
3. **Records an unparseable answer separately from a wrong one.** `parse_ok`.
4. **Stamps the release hash and the recipe hash on every row.** A run against drifted
   labels is refused at load time.
5. **Is idempotent on (run_id, question_id).** Re-running resumes; it never duplicates.

## Files

| File | Purpose |
| --- | --- |
| `recipe.py` | the frozen recipe: model, prompt id, temperature, pixel budget, seeds. Hashed and published |
| `release.py` | build and load a frozen release; the groundtruth hash and its tamper check |
| `grade.py` | the frozen grading rule: correct / close / wrong / unanswered, plus parse_ok |
| `run.py` | the runner: fetch, ask, grade, append a trace row, resume |
| `fetch.py` | image bytes from the corpus CDN with a local cache, plus an offline stub fetcher |
| `backends.py` | **the only place that spends money.** A stub, and one OpenAI-compatible client that covers both a local vLLM server and a hosted API |
| `build_release.py` | CLI: freeze a release from an approved export |
| `make_demo_release.py` | CLI: build `release/demo-samples-v1`, the 30-item demo release over the ten vision-verified sample photographs; run by hand, one-off |
| `sweep.py` | CLI shared by the two runners |
| `run_open.py` | CLI: sweep an open-weight model on your own GPU |
| `run_closed.py` | CLI: sweep a closed model on a capped subsample (the paid line) |
| `analyze.py` | the paper's tables from a trace file, with no database: leaderboard, the 2x2, by capability, ASR |
| `ingest.py` | POST the trace to the relay behind `x-harness-code`; compute the summary |
| `analyze.py` | **the paper's tables**, and the floors that make them readable: the constant-answer baseline, the text-only baseline, the difficulty ladder, counterfactual consistency, ECE/Brier/AURC, and the corruption slope |
| `spend.py` | **the ONE place that decides whether money may be spent.** `refuse_without_spend` is called by every model-calling entry point |
| `taxonomy.py` | every vocabulary an item must satisfy — capability, level, answer_type, relevance. **Enforced when a release is FROZEN**, not only when it is generated |
| `run_elicitation.py` | CLI: the three confidence arms — verbalised, self-consistency (k samples), order-then-rate. **PAID.** The prompts live in `05_elicitation.py` and are imported, not copied: two copies of an apparatus would be two experiments wearing one name |
| `blind.py` | CLI: ask every item with the image withheld, for the text-only baseline |
| `run_crop.py` | CLI: the crops-out-the-evidence curve. **PAID** |
| `run_counterfactual.py` | CLI: remove the grounded object; the answer must change. **PAID** |
| `run_attack.py` | CLI: typographic, patch and corruption tracks. **PAID.** The patch is **not** adversarially optimised |
| `ingest.py` | POST the trace to the relay behind `x-harness-code`; compute the summary. **One run at a time** since v5e |
| `consent.py` · `pii.py` | the two gates a release must pass, and their ledgers |
| `smoke.py` | the end-to-end check: 69 steps, no network, no cost |
| `selftest.py` | **the full self-test** — hundreds of assertions across the release, grading, resume, ingest, the analyses, the gates and the spend guards. Run it before every sweep |

*(Every module on disk is listed. A README that omits half the code is how `spend.py` went undocumented — the file that enforces the owner's spend rule was not in the file list.)*

## Usage

```bash
# 0. prove the harness is sound (no model, no network, no cost)
python -m scripts.harness.selftest

# 1. freeze a release from the approved export
python -m scripts.harness.build_release --export data/factory/questions.jsonl --out release/v1 --id v1

# 2. sweep an open model on your own GPU (vLLM) -- LOCAL, and therefore free
python -m scripts.harness.run_open --release release/v1 --model Qwen/Qwen3.8-27B --out runs/open.jsonl

# 3. sweep a closed model on a stratified subsample (API -- the other paid step)
python -m scripts.harness.run_closed --release release/v1 --model gpt-6 --limit 3000 --out runs/closed.jsonl

# 4. publish results to the leaderboard
python -m scripts.harness.ingest --trace runs/open.jsonl --relay $RELAY --code $HARNESS_CODE
```

## The model panel

Open weights only for the headline table (Apache-2.0 / MIT), so anyone can reproduce it:

| Tier | Models |
| --- | --- |
| Small (2B-9B) | Qwen3-VL-2B/4B/8B-Instruct, InternVL3.5-1B/2B/4B/8B, MiniCPM-V-4.7-1B, Gemma 4 E2B/E4B |
| Mid (12B-38B) | **Qwen3.8-27B**, InternVL3.5-38B, Gemma 4 12B/26B-A4B/31B, MiniCPM-V-4.7-35B-A3B, Ovis2.6-30B-A3B |
| Large | Intern-S2-397B, Ling-3.0-flash-VL, GLM-4.6V-Flash |
| Closed (subsample only) | GPT-6, Gemini 3.1 Pro, Claude Opus 5.5 |
| Baselines | random, constant-answer, text-only (no image), prior-only, human ceiling |

**Three panel rules.** Flag the generator family on the leaderboard. Report the
constant-answer and text-only baselines per capability, not only overall. Never let a
judge grade its own family.

## Cost

| Step | Basis | Estimate |
| --- | --- | --- |
| Open sweep, 16 models x 30k items | 60-100 H100-hours | 120-500 USD |
| Closed sweep, 4 models x 3k items | ~12k requests | 150-450 USD |
| Typographic, patch, corruption tracks (`run_attack`) | 21 conditions x items | paid calls |
| Counterfactual control (`run_counterfactual`) | 1 call per flippable item | paid calls |
| Crop ladder (`run_crop`) | 6 fractions x items | paid calls |
| Blind filter (`blind`) | 1 call per item, no image | paid calls |
| **Everything else in the harness** — analyse, grade, ingest, the gates, both test suites | local | **0** |
| `cleanroom.py` | Run every CI step against a `git worktree` of HEAD, where the private, gitignored tree is absent. **The thing to run before pushing.** Six defects shipped in one stretch and not one was findable by reading. |

**The three attack tracks and the blind filter are model calls**, and they were absent from this
table. `spend.py` is what stops any of them running without `--spend`.

Run the open sweep on hardware you already have and the cash cost approaches zero.
Closed frontier models are the only genuinely unavoidable spend, and the stratified
subsample is what keeps them cheap.

## What landed (this section said "next" and all of it exists)

- `build_release.py`, `run_open.py` (vLLM) and `run_closed.py` CLIs — **built**
- the `/api/runs` endpoint and the `x-harness-code` door — **built**, and it **fails closed**
- the read-only results surface on the site — **built**

*(Kept rather than deleted, because a section headed "what lands next" that lists only finished
work is a claim about the future that has quietly become a claim about the past.)*
