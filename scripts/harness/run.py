"""Run a model against a frozen release, locally.

The runner never touches the live database. It fetches the image, hashes the exact
bytes it sent, asks, grades, and appends a trace row. Re-running resumes.
"""
from __future__ import annotations
import json
import time
from pathlib import Path
from typing import Callable, Iterable

from .grade import grade
from .recipe import Recipe, render_prompt
from .release import image_dimensions, image_sha256, load


def _done_keys(trace_path: Path) -> set[tuple[str, int]]:
    """(run_id, question_id) pairs that are FINISHED — meaning not errored.

    A row with an error is a failed attempt, not a result. Counting it as done made a
    transient 429 permanent: the row was in the trace, so every later run skipped the
    item and its "wrong" verdict stayed in the accuracy figure forever. A sweep has to
    be able to heal itself, or its quality depends on the network being perfect.
    """
    if not trace_path.exists():
        return set()
    out = set()
    for line in trace_path.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
            if r.get("error"):
                continue
            out.add((r["run_id"], int(r["question_id"])))
        except Exception:
            continue
    return out


def run_release(
    release_dir: str | Path,
    recipe: Recipe,
    ask: Callable[[dict, bytes, str], str],
    trace_path: str | Path,
    fetch_image: Callable[[dict], bytes],
    run_id: str | None = None,
    limit: int | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> dict:
    """ask(item, image_bytes, prompt) -> raw model text. fetch_image(item) -> bytes."""
    items, manifest = load(release_dir)
    run_id = run_id or (recipe.model.replace("/", "_") + "-" + recipe.recipe_hash()[:8])
    trace_path = Path(trace_path)
    trace_path.parent.mkdir(parents=True, exist_ok=True)

    done = _done_keys(trace_path)
    todo: Iterable[dict] = [it for it in items if (run_id, it["id"]) not in done]
    if limit is not None:
        todo = list(todo)[:limit]

    n_ok = n_new = 0
    with trace_path.open("a", encoding="utf-8") as fh:
        for it in todo:
            t0 = time.time()
            img = b""
            # The fetch is inside the try on purpose: in a 30,000-item sweep, one
            # unreachable image must become one failed row, never a dead sweep.
            try:
                img = fetch_image(it)
                prompt = render_prompt(recipe, it["question"], it.get("choices"))
                raw = ask(it, img, prompt)
                err = ""
            except Exception as e:
                raw, err = "", type(e).__name__ + ": " + str(e)[:200]
            dt = int((time.time() - t0) * 1000)
            _dims = image_dimensions(img) if img else None
            g = grade(it, raw) if not err else {"verdict": "wrong", "parse_ok": 0, "abstained": 0}
            row = {
                "run_id": run_id,
                "question_id": it["id"],
                "file_id": it["file_id"],
                # self-describing: analysis needs no join back to the release
                "capability": it.get("capability"),
                "level": it.get("level"),
                "pair_id": it.get("pair_id"),
                "pair_role": it.get("pair_role"),
                "image_edit": it.get("image_edit"),
                "model": recipe.model,
                "prompt_id": recipe.prompt_id,
                "temperature": recipe.temperature,
                "groundtruth_hash": manifest["groundtruth_hash"],
                "recipe_hash": recipe.recipe_hash(),
                "image_sha256": image_sha256(img) if img else "",
                # WHAT THE MODEL ACTUALLY SAW. The CDN resizes, so the ledger's resolution
                # is the stored file, not the input. Without these three a reader cannot
                # tell whether two runs are even comparable.
                "image_bytes": len(img) if img else 0,
                "image_w": (_dims[0] if _dims else None),
                "image_h": (_dims[1] if _dims else None),
                "pixel_budget": recipe.pixel_budget,
                "response": raw,
                "verdict": g["verdict"],
                "correct": 1 if g["verdict"] == "correct" else 0,
                "parse_ok": g["parse_ok"],
                "abstained": g["abstained"],
                "latency_ms": dt,
                "error": err,
            }
            fh.write(json.dumps(row, sort_keys=True) + "\n")
            fh.flush()
            n_new += 1
            if g["verdict"] == "correct":
                n_ok += 1
            if progress:
                progress(n_new, len(list(todo)) if not isinstance(todo, list) else len(todo))

    return {
        "run_id": run_id,
        "model": recipe.model,
        "n_new": n_new,
        "n_correct": n_ok,
        "n_already_done": len(done),
        "accuracy_new": (n_ok / n_new) if n_new else None,
        "groundtruth_hash": manifest["groundtruth_hash"],
        "recipe_hash": recipe.recipe_hash(),
    }
