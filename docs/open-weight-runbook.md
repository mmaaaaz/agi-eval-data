# Runbook: the open-weight tier, on the GPU cluster

**For whoever has the cluster.** Everything here is $0 in API spend. This covers three jobs:

1. **Run the open-weight panel** through every harness track.
2. **Fine-tune Gemma 4 31B** on the manual questions.
3. **Re-run the panel with the fine-tuned model** — the before/after evidence.

---

## 0. What to fetch first

```bash
git clone https://github.com/mmaaaaz/agi-eval-data
cd agi-eval-data
python -m pip install -r requirements.txt
```

**Read `scripts/harness/models.json` first.** Every model is there with its release date, price,
HuggingFace id and where it runs. **The harness reads that file — do not edit a model list in a
script.**

---

## 1. The six open-weight models

| model | params | HF id | notes |
|---|---|---|---|
| **NVIDIA Nemotron 3.5 Super VL** | 30B-class | `nvidia/nemotron-3.5-super-vl` | newest (2026-10-15) |
| **Gemma 4 31B** | 31B dense | `google/gemma-4-31b-it` | **the fine-tune target** |
| **Gemma 4 26B A4B** | 26B MoE, 4B active | `google/gemma-4-26b-a4b-it` | cheapest to serve |
| **Inkling** | — | `thinkingmachines/inkling` | |
| **Inkling Small** | — | `thinkingmachines/inkling-small` | |
| **Dots 3 Note** | — | `dots-studio/dots-3-note-preview` | |

Serve them with **vLLM**, one at a time, on an OpenAI-compatible endpoint:

```bash
vllm serve google/gemma-4-31b-it --port 8000 --max-model-len 8192
```

The harness points at it with a single variable:

```bash
export VLLM_BASE_URL=http://localhost:8000/v1
```

---

## 2. The tracks, and the command for each

**All of these run free against the local endpoint.** They are the same commands the closed models
use — only the backend differs.

```bash
# the main sweep: every item, every condition
python -m scripts.harness.run_open --release release/v1 --model gemma-4-31b --out runs/

# the blind pass - the image is REMOVED. This is the test that separates vision
# from language prior, and it is the one the published benchmarks do not do.
python -m scripts.harness.blind --release release/v1 --model gemma-4-31b --out runs/

# the three confidence arms. A2 is k samples per item; k=5 is the default and
# k=3 is defensible - self-consistency saturates.
python -m scripts.harness.run_elicitation --release release/v1 --model gemma-4-31b --spend

# the attack tracks: typographic, patch, corruption
python -m scripts.harness.run_attack --release release/v1 --track all --model gemma-4-31b

# the counterfactual: remove the grounded object, check the answer changes
python -m scripts.harness.run_counterfactual --release release/v1 --model gemma-4-31b

# the crop: the answer leaves the frame
python -m scripts.harness.run_crop --release release/v1 --model gemma-4-31b
```

**Run `python -m scripts.harness.selftest` first.** It proves the harness is intact before any GPU
time is spent — 460-odd assertions, no network, no model.

---

## 3. Fine-tuning Gemma 4 31B

**Yes, Gemma 4 31B is the right target**: open-weight, vision-capable, 31B is large enough to hold
the taxonomy and small enough to fine-tune on one GPU.

**Use LoRA, not a full fine-tune.** With ~1,500 training examples a full fine-tune will overfit and
costs 8× the memory for no measured benefit. LoRA adapters are also a few hundred MB, which makes
them publishable.

### Resources

| | |
|---|---|
| **GPU** | 1× A100 80GB, or 2× 48GB |
| **Method** | LoRA, rank 16–32, targeting the attention projections |
| **Epochs** | 3–5, with early stopping on a held-out split |
| **Time** | **2–4 hours** at 1,500 examples |
| **Disk** | adapters ~200–500 MB; base weights ~60 GB |

### On Modal

Modal bills per second and needs no reservation — **a one-off fine-tune like this is a few
dollars**, well inside the free monthly credit. The same applies to a batch inference run if the
cluster is busy: `vllm serve` on a Modal GPU and point `VLLM_BASE_URL` at it.

### Publishing

Push the adapter to Hugging Face, not the merged weights:

```
agi-eval-data/gemma-4-31b-manual-questions-lora
```

**Record in the model card**: base model and revision, the exact training set (the 1,500 manual
items, by hash), LoRA rank and target modules, epochs, the held-out split, and the harness commit
that produced it.

---

## 4. The before/after evidence — the part that matters for the paper

**This is a controlled experiment, and it is only credible if both runs are identical except for the
model.**

```
step 1   gemma-4-31b  BASE       -> every track -> runs/base/
step 2   fine-tune on the 1,500 manual items
step 3   gemma-4-31b  FINE-TUNED  -> every track -> runs/tuned/
step 4   compare, per capability and per level
```

**Three things to hold fixed, and to write down:**

1. **The same frozen release** (same questions, same images, same hashes) for both runs.
2. **The same harness commit.** Note it in the results.
3. **The same decoding settings** — temperature, max tokens, and the seed if the engine accepts one.

**What the comparison should show, and what to report either way:**

- **Generated-question acceptance rate** — the number that decides whether fine-tuning was worth it.
  This is the measurable answer to *"few-shot or fine-tune?"*
- **Accuracy before vs after**, per capability, with paired intervals.
- **Whether the model learned the taxonomy**: does a fine-tuned model produce questions spread
  across capabilities, or does it collapse onto the easy ones?
- **Regression on the base model's strengths.** Fine-tuning narrows a model. If it gets better at
  our taxonomy and worse at general reasoning, say so — that finding is worth reporting.

**A negative result is still a result.** If fine-tuning does not beat few-shot, that is a sentence in
the paper and it saves the next person the GPU time.

---

## 5. What comes back

Push `runs/*.jsonl` and the adapter. **Every trace row carries the release hash and the image hash**,
so a result can be traced to the exact question and photograph that produced it.

**Do not commit image bytes** — the cache is content-addressed and explicitly never committed.

---

## The one rule

**Nothing here spends money.** The open-weight tier is free by construction: local vLLM, no API key,
no per-call cost. If a command in this runbook ever asks for a key, something is wrong — stop and
ask.
