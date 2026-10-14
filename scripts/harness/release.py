"""Build and load a FROZEN release.

A release is the only thing the harness may read. It is content-addressed by a
groundtruth_hash over the answers, so a run against drifted labels is refused rather
than silently compared.
"""
from __future__ import annotations

from . import taxonomy
import hashlib
import json
from pathlib import Path

# fields a release item carries. Anything not in the source export is dropped.
ITEM_FIELDS = (
    "id", "file_id", "question", "choices", "answer", "answer_type", "tolerance",
    "capability", "level", "pair_id", "pair_role", "counterfactual_of",
    "grounding_box", "image_edit", "canary",
    # the error-analysis axis, so a release can be broken down by family, not only
    # by capability. Without these a release loses the ability to answer "which kind
    # of failure was this".
    "family", "relevance", "unanswerable_reason", "blind_passed",
)


# Bump when the digest's scope changes, so two releases hashed under different
# definitions can never be mistaken for each other.
HASH_VERSION = "v1"

# Unit separator: unambiguous even when a question contains a pipe or a newline.
_SEP = "\x1f"


def groundtruth_hash(items: list[dict]) -> str:
    """Digest over everything that determines what a CORRECT ANSWER means.

    That is the item id, the question text, the options, the answer, the answer
    type and the tolerance. Hashing only the answer was not enough: changing an
    option's text, or reversing two options, changes what a correct response is
    while leaving the answer letter identical. A run against such a release must
    be refused, so the hash has to cover it.
    """
    h = hashlib.sha256()
    h.update((HASH_VERSION + _SEP).encode("utf-8"))
    for it in sorted(items, key=lambda x: str(x["id"])):
        choices = it.get("choices") or []
        parts = [
            str(it["id"]),
            str(it.get("question") or ""),
            _SEP.join(str(c) for c in choices),
            str(it.get("answer") or ""),
            str(it.get("answer_type") or ""),
            "" if it.get("tolerance") is None else str(it.get("tolerance")),
        ]
        h.update(_SEP.join(parts).encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


def parse_choices(ch) -> list[str]:
    """Options from whatever the source stored.

    The API export emits the raw DB TEXT column, which is a JSON ARRAY STRING:
    '["Yes", "No"]'. An earlier version split a string on "|" — the legacy format — so
    EVERY choice item in a release came out with ONE option whose text was the entire
    JSON blob. The model was then shown:

        A) ["Yes, it clears", "No, it would hit", "Only if raised"]

    with a ground truth of the letter A. Every MCQ number from such a release is
    meaningless, and it fails in the direction of "the model is bad at vision", which is
    the one direction a benchmark must never fail in silently.

    Handles, in order: a real list; a JSON array string; the legacy pipe form.
    """
    if isinstance(ch, list):
        return [str(c) for c in ch if str(c).strip() != ""]
    if not isinstance(ch, str):
        return []
    s = ch.strip()
    if not s:
        return []
    if s.startswith("["):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(c) for c in parsed if str(c).strip() != ""]
        except Exception:
            pass
    return [c.strip() for c in s.split("|") if c.strip() != ""]


def release_hash(items: list[dict]) -> str:
    """Digest over EVERY field a release carries — not only the ground truth.

    WHY A SECOND HASH
    -----------------
    `groundtruth_hash` answers "are the labels I ran against the labels I meant?". It
    deliberately covers only the fields that decide what a CORRECT ANSWER is.

    But the paper's headline 2x2 is decided by `pair_id` and `pair_role`, the
    by-capability table by `capability` and `level`, and the error analysis by
    `family`. **None of those are in `groundtruth_hash`.** So a release could be edited
    to move an item between pairs, or reclassify it, and the ground-truth check would
    still pass while the published tables changed underneath.

    This hash makes a release immutable for ANALYSIS as well as for scoring. A run
    records it, and a comparison across runs that were scored on different releases is
    refused rather than quietly averaged.
    """
    h = hashlib.sha256()
    h.update(("release:" + HASH_VERSION + _SEP).encode("utf-8"))
    for it in sorted(items, key=lambda x: str(x["id"])):
        parts = [str(k) + "=" + json.dumps(it.get(k), sort_keys=True, default=str)
                 for k in ITEM_FIELDS]
        h.update(_SEP.join(parts).encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


def normalise_item(row: dict) -> dict:
    it = {k: row.get(k) for k in ITEM_FIELDS}
    # The export emits both the canonical keys and the legacy aliases: the gate
    # (scripts/factory/03_verify.py) keys items off `image_id`, and the older export
    # used `question_id`. Accept either, and fail loudly rather than silently
    # producing a release whose items have no identifiers — which would break every
    # join downstream and only surface much later.
    if it.get("id") is None:
        it["id"] = row.get("question_id")
    if not it.get("file_id"):
        it["file_id"] = row.get("image_id")
    if it.get("id") is None:
        raise ValueError("item has no id (looked for 'id' and 'question_id')")
    if not it.get("file_id"):
        raise ValueError("item has no file_id (looked for 'file_id' and 'image_id')")
    it["id"] = int(it["id"])
    it["choices"] = parse_choices(it.get("choices"))
    if it.get("tolerance") is not None:
        it["tolerance"] = float(it["tolerance"])
    return it


def build(items: list[dict], out_dir: str | Path, release_id: str, notes: str = "",
          consent: dict | None = None, pii: dict | None = None) -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    norm = [normalise_item(r) for r in items]
    norm.sort(key=lambda x: x["id"])

    # STRUCTURAL GUARD. A choice item with fewer than two options is not a
    # question — it is a bug, and it is the exact bug that produced prompts like
    # 'A) ["Yes", "No"]'. Refusing here costs one exception; discovering it after a
    # 3,000-call sweep costs the sweep.
    thin = [it["id"] for it in norm
            if str(it.get("answer_type") or "").lower() in ("choice", "mcq")
            and len(it.get("choices") or []) < 2]
    if thin:
        raise ValueError(
            "choice items with fewer than 2 options: " + ", ".join(str(i) for i in thin[:10])
            + (" (+" + str(len(thin) - 10) + " more)" if len(thin) > 10 else "")
            + ". Check how 'choices' is encoded in the source export."
        )
    blank = [it["id"] for it in norm if str(it.get("answer") or "").strip() == ""]
    if blank:
        raise ValueError("items with no ground truth: " + ", ".join(str(i) for i in blank[:10]))

    # THE TAXONOMY IS ENFORCED AT FREEZE, not only at generation.
    #
    # Round 81 measured `build()` accepting capability "NOT_A_CAPABILITY" and level "L99" without
    # complaint, and bucketing an item with no capability as "UNCLASSIFIED" — so the paper's
    # per-capability table could contain a typo, and unclassified items were AVERAGED INTO it
    # rather than refused. Generating correctly does not make the artifact correct.
    invalid = [(it.get("id"), why) for it in norm
               for why in [taxonomy.check_item(it)] if why]
    if invalid:
        detail = "; ".join(str(i) + ": " + w for i, w in invalid[:8])
        raise ValueError(
            str(len(invalid)) + " item(s) are not valid: " + detail
            + ("" if len(invalid) <= 8 else " (and " + str(len(invalid) - 8) + " more)")
            + "  -- a release is a frozen artifact and cannot be repaired after the fact.")

    with (out / "questions.jsonl").open("w", encoding="utf-8") as fh:
        for it in norm:
            fh.write(json.dumps(it, sort_keys=True) + "\n")

    gh = groundtruth_hash(norm)
    caps: dict[str, int] = {}
    for it in norm:
        k = str(it.get("capability") or "UNCLASSIFIED")
        caps[k] = caps.get(k, 0) + 1
    manifest = {
        "release_id": release_id,
        "n_items": len(norm),
        "n_images": len({it["file_id"] for it in norm}),
        "groundtruth_hash": gh,
        "release_hash": release_hash(norm),
        "hash_version": HASH_VERSION,
        "by_capability": dict(sorted(caps.items())),
        "notes": notes,
        # THE RELEASE CARRIES ITS OWN CLEARANCE.
        #
        # build_release.py CHECKED consent and PII and then printed "ALL n images have a
        # recorded right to redistribute" — while writing NOTHING about it into the release.
        # So the frozen artifact, the thing that gets published and quoted, could not be
        # audited for rights at all: the answer lived in a ledger file, not in the release.
        #
        # That is the gate guarding the BUILDER and not the ARTIFACT — the same shape as
        # --spend guarding the pipeline and not the runners (round 79).
        "consent": consent,
        "pii": pii,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def load(release_dir: str | Path, require_clearance: bool = True) -> tuple[list[dict], dict]:
    d = Path(release_dir)
    manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8-sig"))
    items = [json.loads(l) for l in (d / "questions.jsonl").read_text(encoding="utf-8-sig").splitlines() if l.strip()]
    actual = groundtruth_hash(items)
    if actual != manifest["groundtruth_hash"]:
        raise ValueError(
            "release is corrupt or was edited after freezing: manifest says "
            + manifest["groundtruth_hash"][:12] + ", items hash to " + actual[:12]
        )
    # The analysis fields too, or an edit that leaves the labels intact would pass the
    # check above while moving items between pairs and changing the headline table.
    if manifest.get("release_hash"):
        actual_rel = release_hash(items)
        if actual_rel != manifest["release_hash"]:
            raise ValueError(
                "release was edited after freezing in a way that does NOT change the "
                "ground truth (a pairing, capability or family field): manifest says "
                + manifest["release_hash"][:12] + ", items hash to " + actual_rel[:12]
            )
    # A RELEASE MUST CARRY ITS CLEARANCE, OR IT IS NOT RUN.
    #
    # A hash proves the items did not change; it says NOTHING about whether the images may be
    # used. A directory assembled by hand passes every check above, and before this it also
    # passed `load` — so the consent gate was a gate on one builder rather than on the artifact.
    if require_clearance:
        missing = [k for k in ("consent", "pii") if not manifest.get(k)]
        if missing:
            raise ValueError(
                "release carries no " + " or ".join(missing) + " record, so its images cannot be "
                "shown to have a right to be used. Build it through build_release.py, which runs "
                "the gates, or pass require_clearance=False if you know why you are bypassing.")
    return items, manifest


def image_dimensions(image_bytes: bytes) -> tuple[int, int] | None:
    """The dimensions of the bytes the MODEL was shown, or None.

    WHY THIS EXISTS
    ---------------
    The Drive CDN resizes. The harness fetches =w{pixel_budget}, default 2048, so a
    6000x4000 file the ledger calls 24 MP reaches the model as 2048x1365 — about 2.8 MP.
    Measured, not assumed: =s0 returns the true 6000x4000, the bare URL returns 1600 px.

    So the resolution a model actually saw is a property of the RUN, not of the corpus, and
    a trace that records only a hash cannot tell a reader whether two runs are comparable.
    A resolution-stratified result without the served size is not reproducible.

    Returns None rather than guessing when the format cannot be read.
    """
    if not image_bytes:
        return None
    try:
        import io
        from PIL import Image
        with Image.open(io.BytesIO(image_bytes)) as im:
            return (int(im.size[0]), int(im.size[1]))
    except Exception:
        return None


def image_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
