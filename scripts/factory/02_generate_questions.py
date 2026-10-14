#!/usr/bin/env python3
"""
STAGE 2 — LLM question generation with a verification-first design.

Design principle, and it is the important part: the LLM does NOT write
questions. It writes *candidates*, and every candidate must survive an
automated gauntlet BEFORE a human sees it. The human reviews survivors, not
the raw stream.

Why this ordering: published pipelines that generate-then-filter with humans
in the loop report large human rejection rates. Cheapest checks go first.

The gauntlet, cheapest to most expensive:
  1. structural     — required fields present, types correct            (free)
  2. dedupe         — normalised question text, Jaccard against the pool  (free)
  3. self-consistency — ask the SAME model again under a different prompt
     framing; a question whose meaning flips between framings is unstable   (cheap)
  4. answerability  — ask a DIFFERENT model whether the question is
     answerable from the image alone                                  (cheap)
  5. premise check  — does the question presuppose something absent?  (cheap)
  6. HUMAN          — the only stage a person touches

Everything is written to disk with the stage that accepted or rejected each
candidate, so the yield at every stage is a reportable number.

Usage:
    export OPENROUTER_API_KEY=...
    python scripts/factory/02_generate_questions.py --n 40 --dry-run
    python scripts/factory/02_generate_questions.py --n 600 --model openai/gpt-6.1-sol-pro
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter
from urllib import request as urlreq

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

# THE SPEND GUARD, from the one place that decides. This script calls a model and had NO guard
# of its own — the pipeline refused a paid stage without --spend and a direct invocation did not.
from scripts.harness.spend import SPEND_HELP, refuse_without_spend  # noqa: E402
OUT = os.path.join(ROOT, "data", "factory")
OR_URL = "https://openrouter.ai/api/v1/chat/completions"

# --- the taxonomy every generated question must declare itself in --------
# Sourced from Ray et al. (EMNLP 2016) 3-class relevance + MoHoBench's four
# unanswerable types + our own answer_type field.
from scripts.harness.taxonomy import VALID_ANSWER_TYPES, VALID_RELEVANCE  # noqa: E402
VALID_UNANSWERABLE = {"", "occlusion", "out_of_frame", "indeterminate_spatial",
                      "absent_entity", "insufficient_resolution", "requires_world_knowledge"}

# --- the REPORTING axis, which this generator previously did not emit at all ------
# Without these the API refuses to approve an item and the gate fails C2.10/C2.11, so
# every question this script produced was unusable. Capability and level are independent
# of `relevance`, which is the error-analysis axis.
# THE TAXONOMY IS IMPORTED, NOT REDEFINED. It used to be declared here and ONLY here, so it
# was enforced at generation and nowhere else — build() accepted "NOT_A_CAPABILITY" and
# shipped it (round 81). Two copies of a taxonomy is two taxonomies.
from scripts.harness.taxonomy import VALID_CAPABILITIES, VALID_LEVELS  # noqa: E402
VALID_PAIR_ROLES = {"geometry", "physics", "perception"}

# What each capability actually asks, so the focus is specific rather than a label.
CAPABILITY_HINT = {
    "G1": "depth and occlusion: which object is closer, or what is in front of what",
    "G2": "relative size and distance: which of two objects is larger in real life, or farther",
    "G3": "shape and structure: the shape of an object, or how many faces or sides it has",
    "G4": "lines and angles: whether two edges are parallel or perpendicular, or roughly what angle",
    "G5": "perspective and viewpoint: whether the camera was tilted up or down, or where lines converge",
    "G6": "spatial layout: left, right, above, below, inside, or along",
    "G7": "symmetry and pattern: whether something is symmetric, or whether a pattern repeats",
    "G8": "fit and clearance: whether one thing would fit under, through or inside another",
    "P1": "material properties: whether something is rigid or flexible, heavy or light, fragile",
    "P2": "support and stability: what holds something up, or whether it would stay standing",
    "P3": "contact and containment: what touches what, or what is inside what",
    "P4": "forces and load paths: where the weight goes, or which part is in tension",
    "P5": "dynamics and prediction: what would happen if something were pushed, dropped or released",
    "P6": "light and shadow: where the light comes from, or which way shadows fall",
    "P7": "fluids, air and heat: which way a liquid would flow, or where a gas goes",
    "P8": "function and affordance: what a part is for, or how it would be used",
    "B1": "tipping and balance: where the centre of mass sits relative to the base",
    "B2": "shadows as a sun cue: which way shadows fall, and therefore where the sun is",
    "B3": "rolling and sliding: which way a surface slopes, and which way something would move",
    "B4": "passage and collision: whether a gap is wider than an object, and whether it would pass",
    "PERC": "perception only: what is present, as a control rung",
}
CAPABILITY_KEYS = ", ".join(sorted(VALID_CAPABILITIES))
LEVEL_KEYS = ", ".join(sorted(VALID_LEVELS))

# Appended to the base prompt. Braces here are literal JSON, which is why the prompt is
# assembled by concatenation rather than with .format().
TAXONOMY_KEYS = """

Also declare WHICH COMPETENCE this question tests and HOW MANY STEPS it takes. These are
separate from "relevance" and are required.

  "capability": one of """ + CAPABILITY_KEYS + """,
  "level": one of """ + LEVEL_KEYS + """,
  "pair_role": "geometry|physics|perception"   ONLY if capability starts with B, else ""

Level key:
  L1 perception only        e.g. is there a box on top
  L2 one judgement          e.g. is the forklift closer than the SUV
  L3 two linked steps       e.g. which way does the road curve after the median ends
  L4 prediction or counterfactual   e.g. would the overhead guard hit the canopy
  L5 multi-step plus outside knowledge   e.g. why is the frame triangulated

A BRIDGE item ("B") is one member of a pair on the SAME object: a geometry probe asks about
the layout, a physics probe asks the outcome. Set pair_role accordingly."""


def gen_prompt(capability: str, per_image: int = 1) -> str:
    """The base prompt, optionally focused on one capability, optionally asking for a set.

    WHY per_image EXISTS
    --------------------
    The plan needs about FOUR items per image: 2,500 images to 10,000 items in the roadmap,
    and "5 minutes per image for a 4-item set" in the cost model. This prompt asked for ONE.

    So the generator could not produce the dataset the plan describes, and reaching it would
    have meant four separate calls — **re-uploading the same image four times**. Asking for a
    set in one call sends the image once, which is the whole cost, and gets four questions
    back. Cheaper and better, not merely different.
    """
    hint = CAPABILITY_HINT.get(capability, "")
    focus = ("Focus this question specifically on " + hint + ".\n\n") if hint else ""
    body = focus + GEN_PROMPT + TAXONOMY_KEYS
    if per_image <= 1:
        return body
    return body + (

        "\n\nINSTEAD of one, write " + str(per_image) + " DISTINCT questions about this image.\n"
        "- Each must be about a DIFFERENT object, or a different property of the same object.\n"
        "- Two questions that differ only in wording are one question, and will be rejected.\n"
        "- At most ONE may be a perception control (capability PERC); the rest must test\n"
        "  reasoning, or the set is not measuring what the benchmark is for.\n\n"
        "Return ONLY this JSON object, with exactly " + str(per_image) + " entries:\n"
        '{\"questions\": [ <object with the keys above>, <object>, ... ]}'
    )


def stage1b_taxonomy(obj: dict) -> str | None:
    """Enforce the reporting axis. A model may not widen the taxonomy.

    Returns a rejection reason, or None. The same discipline as stage 04: an invalid or
    invented label is a REJECT, never a silent pass-through.
    """
    cap = str(obj.get("capability") or "").strip().upper()
    if cap not in VALID_CAPABILITIES:
        return "capability_missing_or_invalid"
    lvl = str(obj.get("level") or "").strip().upper()
    if lvl not in VALID_LEVELS:
        return "level_missing_or_invalid"
    obj["capability"] = cap
    obj["level"] = lvl
    if cap.startswith("B"):
        role = str(obj.get("pair_role") or "").strip().lower()
        if role not in VALID_PAIR_ROLES:
            return "bridge_item_without_pair_role"
        obj["pair_role"] = role
    else:
        obj["pair_role"] = ""
    return None

GEN_PROMPT = """You are writing evaluation questions about a personal photograph for a \
vision-language-model benchmark.

Given the image, write ONE question that a careful human annotator could answer by looking \
at this photo alone.

Rules:
- The answer must be visible in the image. Do not ask about anything you would need outside \
knowledge for (weather on that day, who the people are, where it was taken).
- Be specific. "What colour is the car?" beats "What is in the image?"
- Never presuppose something that is absent. If you ask about an object, it must be there.
- Prefer a question with exactly one defensible answer.

Return ONLY a JSON object with these keys:
{
  "question": "...",
  "answer": "...",              the short answer
  "answer_type": "number|yesno|choice|text",
  "choices": ["..."],           only if answer_type == "choice", else null
  "tolerance": 0,               only if answer_type == "number", else null
  "relevance": "visual_true_premise|visual_false_premise|non_visual",
  "unanswerable_reason": "",    "" or one of: occlusion, out_of_frame, indeterminate_spatial,
                                absent_entity, insufficient_resolution, requires_world_knowledge
  "why_hard": "..."             one sentence: why a VLM would get this wrong
}"""

CHECK_PROMPTS = {
    "answerability": """A human annotator must be able to answer this question by looking only at \
the image. If the question needs outside knowledge, refers to something not clearly present, or \
cannot be answered unambiguously, reply exactly: UNANSWERABLE

Otherwise reply exactly: ANSWERABLE

Question: {q}""",
    "stability_a": """Answer this question about the image in as few words as possible. \
Reply with ONLY the answer.

Question: {q}""",
    "stability_b": """Look carefully at the image and respond to the following. Give only the answer, \
no explanation, no full sentence.

{q}""",
}


# ---------------------------------------------------------------- helpers
def norm_text(s: str) -> str:
    """Aggressive normalisation for dedupe. Mirrors packages/shared normQ."""
    s = unicodedata.normalize("NFKD", str(s)).lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tokens(s: str) -> set[str]:
    return set(norm_text(s).split())


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def call_or(prompt: str, model: str, key: str, image_url: str | None = None,
            temperature: float = 0.0, retries: int = 3) -> str:
    content: list[dict] = [{"type": "text", "text": prompt}]
    if image_url:
        content.append({"type": "image_url",
                        "image_url": {"url": image_url}})
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "temperature": temperature,
        "max_tokens": 900,
    }).encode()
    for attempt in range(retries):
        try:
            req = urlreq.Request(OR_URL, data=body, headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            })
            with urlreq.urlopen(req, timeout=120) as r:
                data = json.load(r)
            return data["choices"][0]["message"]["content"]
        except Exception:
            if attempt == retries - 1:
                return ""
            time.sleep(2 ** attempt)
    return ""


def extract_json(text: str) -> dict | None:
    """Tolerate fenced code blocks and leading prose."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


# ---------------------------------------------------------------- stages
def extract_items(text: str) -> list[dict]:
    """One or more question objects from a model response.

    Accepts a bare object (the single-question form), a {"questions": [...]} wrapper, or a
    bare array — because a model asked for four will sometimes return four and sometimes
    return one, and a parse failure should mean "unusable" rather than "wrong shape".
    """
    if not text:
        return []
    m = re.search(r"[\[{].*[\]}]", text, re.S)
    if not m:
        one = extract_json(text)
        return [one] if one else []
    try:
        parsed = json.loads(m.group(0))
    except Exception:
        one = extract_json(text)
        return [one] if one else []
    if isinstance(parsed, list):
        return [x for x in parsed if isinstance(x, dict)]
    if isinstance(parsed, dict):
        inner = parsed.get("questions")
        if isinstance(inner, list):
            return [x for x in inner if isinstance(x, dict)]
        return [parsed]
    return []


def stage1_structural(obj: dict) -> str | None:
    """Return a rejection reason, or None if it passes."""
    for k in ("question", "answer", "answer_type", "relevance"):
        if not obj.get(k):
            return f"missing_field:{k}"
    at = obj.get("answer_type")
    if at not in VALID_ANSWER_TYPES:
        return f"bad_answer_type:{at}"
    rel = obj.get("relevance")
    if rel not in VALID_RELEVANCE:
        return f"bad_relevance:{rel}"
    ur = (obj.get("unanswerable_reason") or "").strip()
    if ur and ur not in VALID_UNANSWERABLE:
        return f"bad_unanswerable_reason:{ur}"
    if at == "choice" and not obj.get("choices"):
        return "choice_without_options"
    if at == "number" and obj.get("tolerance") in (None, ""):
        return "number_without_tolerance"
    q = obj["question"].strip()
    if len(q) < 12 or len(q) > 240:
        return "question_length_out_of_range"
    if q.endswith("?"):
        return None
    return "question_not_a_question"


def stage2_dedupe(q: str, pool: list[dict], thr: float = 0.72) -> str | None:
    qt = tokens(q)
    for row in pool:
        if jaccard(qt, row["_tokens"]) > thr:
            return "duplicate_of_existing"
    return None


# ---------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=40, help="how many images to attempt")
    ap.add_argument("--model", default="openai/gpt-6.1-sol-pro", help="generator")
    ap.add_argument("--verifier", default="anthropic/claude-opus-5.5", help="independent checker")
    ap.add_argument("--candidates", default=os.path.join(OUT, "candidates.json"))
    # NOT questions.jsonl. That path is the CANONICAL EXPORT (see 02_fetch_export.py),
    # and two producers writing one file would clobber each other. This script emits
    # CANDIDATES, which only become questions once a human approves them.
    ap.add_argument("--out", default=os.path.join(OUT, "generated.jsonl"))
    ap.add_argument("--capability", default="",
                    help="focus generation on one capability, e.g. B4, G1, P2")
    ap.add_argument("--per-image", type=int, default=4,
                    help="questions to ask for per image in ONE call. The plan needs about "
                         "FOUR (2,500 images -> 10,000 items; '5 minutes per image for a "
                         "4-item set'). Asking for a set sends the image once instead of four "
                         "times, which is the whole cost. 1 reproduces the old behaviour.")
    ap.add_argument("--spend", action="store_true", help=SPEND_HELP)
    ap.add_argument("--dry-run", action="store_true",
                    help="run the gauntlet on synthetic candidates, no API calls")
    args = ap.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY", "")
    os.makedirs(OUT, exist_ok=True)

    # THE SPEND REFUSAL COMES FIRST, BEFORE THE INPUT IS OPENED.
    #
    # Round 131, found by running smoke on a CLEAN CHECKOUT: the candidates file is gitignored,
    # so this died with FileNotFoundError BEFORE the refusal - and a caller could not tell an
    # unauthorised spend from a missing file. The refusal is about AUTHORISATION, so it is
    # answered whatever the files say.
    refuse_without_spend(args, "--spend", "question generation")
    with open(args.candidates, encoding="utf-8") as fh:
        cand = json.load(fh)
    images = cand["images"][: args.n]

    # A Google Drive image URL only works if the file has been link-shared.
    # The repo already has scripts/share_sync.py for exactly that. Until a file
    # is shared the call returns a 400 — so we surface it rather than guess.
    def img_url(fid: str) -> str:
        return f"https://lh3.googleusercontent.com/d/{fid}=w1600"

    pool: list[dict] = []
    if os.path.exists(args.out):
        with open(args.out, encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    row = json.loads(line)
                    row["_tokens"] = tokens(row["question"])
                    pool.append(row)

    stats = Counter()
    # The output is opened ONLY for a real run. It used to be opened before this
    # branch, so a dry run CREATED an empty output file — a dry run with a side
    # effect is not a dry run. Worse, the empty file then made the pipeline
    # orchestrator believe this stage's output existed, so the gate would run
    # against nothing and fail obscurely.
    if args.dry_run:
        for i in range(min(3, len(images))):
            obj = {
                "question": "How many people are visible in this photograph?",
                "answer": "3", "answer_type": "number", "choices": None,
                "tolerance": 0, "relevance": "visual_true_premise",
                "unanswerable_reason": "", "why_hard": "counting under clutter",
            }
            r = stage1_structural(obj)
            print(f"dry-run structural check -> {r or 'PASS'}")
            r2 = stage2_dedupe(obj["question"], pool)
            print(f"dry-run dedupe check      -> {r2 or 'PASS'}")

            # The taxonomy gate, exercised here too: a dry run that skips the newest
            # check would report PASS on a pipeline that rejects everything.
            print(f"dry-run taxonomy (unclassified) -> {stage1b_taxonomy(dict(obj)) or 'PASS'}")
            classified = dict(obj, capability="PERC", level="L1")
            print(f"dry-run taxonomy (classified)   -> {stage1b_taxonomy(classified) or 'PASS'}")
            bridge = {"capability": "B4", "level": "L4"}
            print(f"dry-run taxonomy (bare bridge)  -> {stage1b_taxonomy(bridge) or 'PASS'}")
        print("dry run: no output file was created or touched")
        return

    # THE PAID PATH STARTS HERE. Everything above is the offline stub.

    if not key:
        raise SystemExit("OPENROUTER_API_KEY not set — run with --dry-run or export the key")

    fh = open(args.out, "a", encoding="utf-8")

    for n, im in enumerate(images, 1):
        stats["attempted"] += 1
        raw = call_or(gen_prompt(args.capability), args.model, key, img_url(im["file_id"]), temperature=0.7)
        if not raw:
            stats["fail_api"] += 1
            continue
        # ONE CALL, SEVERAL QUESTIONS. The plan needs about four items per image (2,500
        # images -> 10,000 items; "5 minutes per image for a 4-item set" in costs.md), and the
        # prompt asked for ONE — so the generator could not produce the dataset the roadmap
        # describes, and reaching it would have meant four calls re-uploading the same image.
        # Sending the image once and getting a set back is cheaper, not merely different.
        items = extract_items(raw)
        if not items:
            stats["fail_parse"] += 1
            continue
        for obj in items[: args.per_image]:
            stats["items_generated"] += 1
            r = stage1_structural(obj)
            if r:
                stats[f"reject:{r}"] += 1
                continue
            r = stage1b_taxonomy(obj)
            if r:
                stats[f"reject:{r}"] += 1
                continue
            r = stage2_dedupe(obj["question"], pool)
            if r:
                stats[f"reject:{r}"] += 1
                continue

            # stage 3 — self-consistency across two framings
            a = call_or(CHECK_PROMPTS["stability_a"].format(q=obj["question"]),
                        args.model, key, img_url(im["file_id"]), temperature=0.0)
            b = call_or(CHECK_PROMPTS["stability_b"].format(q=obj["question"]),
                        args.model, key, img_url(im["file_id"]), temperature=0.0)
            if a and b and norm_text(a) != norm_text(b):
                stats["reject:unstable_across_framings"] += 1
                continue
            stats["pass_stability"] += 1

            # stage 4 — answerability, asked of a DIFFERENT model
            ab = call_or(CHECK_PROMPTS["answerability"].format(q=obj["question"]),
                         args.verifier, key, img_url(im["file_id"]), temperature=0.0)
            claimed_unanswerable = bool(obj.get("unanswerable_reason"))
            says_unanswerable = "UNANSWERABLE" in (ab or "").upper()
            if claimed_unanswerable != says_unanswerable:
                stats["reject:answerability_disagreement"] += 1
                continue
            stats["pass_answerability"] += 1

            row = dict(obj)
            row.update({
                # canonical key first, legacy alias kept so nothing downstream breaks
                "file_id": im["file_id"],
                "image_id": im["file_id"],
                "image_meta": {k: im[k] for k in ("band", "orient", "mp", "camera", "owner")},
                "generator": args.model,
                "verifier": args.verifier,
                "status": "needs_human",
                "source": "llm_candidate",
            })
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            fh.flush()
            row["_tokens"] = tokens(row["question"])
            pool.append(row)
            stats["reached_human_queue"] += 1

        if n % 10 == 0:
            print(f"[{n}/{len(images)}] {dict(stats)}")

    fh.close()
    print("\n=== gauntlet yield ===")
    for k, v in sorted(stats.items()):
        print(f"  {v:>5}  {k}")
    att = stats["attempted"]
    if att:
        print(f"\nreached human queue: "
              f"{stats['reached_human_queue']}/{att} = "
              f"{stats['reached_human_queue'] / max(att,1):.1%}")


if __name__ == "__main__":
    raise SystemExit(main())