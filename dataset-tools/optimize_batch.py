#!/usr/bin/env python3
"""
optimize_batch.py — one batch, one transaction (plan v6 §2, Task 4.3).

Per file: fetch server truth → download → transcode → write-back (in-place
files.update for JPEG / sibling files.create for non-JPEG) → verify → journal.

Modes:
  dry   — download + transcode + full battery simulation; NO Drive writes.
  apply — real writes; every result journaled; ledger written at end.

Exit codes: 0 = all green; 3 = battery failures (halts CI queue);
            4 = driver errors; 5 = fatal setup error.

Usage:
  python dataset-tools/optimize_batch.py --batch batches/pilot-500.json [--mode dry|apply]
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import drive_io as DIO  # noqa: E402
import transcode_one as T  # noqa: E402
import battery as B  # noqa: E402

CFG = json.load(open(HERE / "config.json", encoding="utf-8"))
RUNGS = CFG["optimize"]["rungs"]
RUNG = RUNGS[CFG["optimize"].get("active_rung", 1) - 1]
CAP, JPEG_Q = RUNG["cap_long_edge"], RUNG["jpeg_quality"]
WEBP_Q = CFG["optimize"]["webp_quality"]
WORKERS = CFG["optimize"].get("workers", 4)
JOURNAL_PARENT_NAME = "Optimized Dataset"
JOURNAL_FOLDER = CFG["drive"]["journal_folder"]  # "Optimized Dataset/_journal"
JOURNAL_NAME = "progress.jsonl"
MIME_BY_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
               "heic": "image/heic", "gif": "image/gif", "webp": "image/webp",
               "avif": "image/avif"}

_ledger_lock = threading.Lock()
_stats = {"processed": 0, "skipped": 0, "errors": 0, "bytes_in": 0, "bytes_out": 0}


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str):
    print(f"[{now()}] {msg}", flush=True)


# ---------------------------------------------------------------- journal --
class Journal:
    """Append-only, local file first, synced to Drive at batch end."""

    def __init__(self, batch_id: str, mode: str):
        self.batch_id = batch_id
        self.mode = mode
        self.runs_dir = HERE / "runs" / batch_id
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.runs_dir / "results.jsonl"
        self.records: list = []
        if self.path.exists():  # resume: reload our own ledger state
            for line in self.path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    self.records.append(json.loads(line))

    def append(self, rec: dict):
        rec["ts"] = now()
        rec["run_mode"] = self.mode  # distinguish dry-run vs apply records
        self.records.append(rec)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, separators=(",", ":")) + "\n")

    def done_ids(self) -> set:
        # Only APPLY-run successes settle a file (bugfix 2026-09-05: records'
        # `mode` field is the transcode type inplace/sibling, never "apply").
        return {r["id"] for r in self.records
                if r.get("status") == "ok" and r.get("run_mode") == "apply"}

    def settled_md5(self, fid: str) -> set:
        """All post-md5s recorded for fid by successful apply runs — used to
        recognize already-optimized files even if the batch file changes."""
        return {r["post"]["md5"] for r in self.records
                if r.get("id") == fid and r.get("status") == "ok"
                and r.get("run_mode") == "apply" and r.get("post", {}).get("md5")}

    def write_ledger(self, agg: dict):
        summary = {
            "batch_id": self.batch_id, "mode": self.mode, "finished_at": now(),
            "rung": {"cap": CAP, "jpeg_quality": JPEG_Q, "webp_quality": WEBP_Q},
            "stats": _stats,
            "battery": agg,
            "verdict": "GREEN" if agg.get("ok") and _stats["errors"] == 0 else "RED",
        }
        (self.runs_dir / "verification.json").write_text(
            json.dumps(summary, indent=1), encoding="utf-8")
        return summary


# ------------------------------------------------------------- per-file op --
def process_one(im: dict, mode: str, jr=None) -> dict:
    """Full pipeline for one image. Returns a journal record."""
    fid, ext = im["id"], im["ext"]
    jpeg_family = ext in ("jpg", "jpeg")
    rec = {"batch_id": im.get("batch_id"), "id": fid, "name": im["name"],
           "ext": ext, "mode": "inplace" if jpeg_family else "sibling",
           "status": "error", "attempted_at": now()}
    t0 = time.perf_counter()
    try:
        # 1) server truth BEFORE touching anything
        meta = DIO.get_meta(fid)
        if meta.get("trashed"):
            rec["status"] = "skipped_trashed"
            rec["detail"] = "file is in trash (dedup or manual) — left untouched"
            return rec
        if meta.get("mimeType") == "image/gif" and ext == "gif":
            rec.update(status="skipped_gif", detail="animated gif pass-through")
            return rec
        pre = {"size": int(meta.get("size") or 0),
               "owner": (meta.get("owners") or [{}])[0].get("emailAddress"),
               "created": (meta.get("createdTime") or "")[:10],
               "md5": meta.get("md5Checksum"), "mime": meta.get("mimeType"),
               "version": meta.get("version")}

        # 2) download
        data = DIO.download(fid)
        rec["pre"] = pre
        rec["bytes_in"] = len(data)

        # 2b) already-optimized guard (belt & braces): if the live bytes' md5
        # matches a settled post-md5 from an earlier apply run, this file is
        # already generation-1 — never double-encode.
        settled = jr.settled_md5(fid) if jr is not None else set()
        if mode == "apply" and pre.get("md5") in settled:
            rec["pre"] = pre
            rec["status"] = "skipped_already_optimized"
            rec["detail"] = "live md5 == settled post-md5 from prior apply run"
            return rec

        # 3) transcode
        out = T.transcode_one(data, ext, cap=CAP, jpeg_quality=JPEG_Q,
                              webp_quality=WEBP_Q)
        rec["post"] = {"size": out["size"], "md5": out["md5"], "w": out["w"],
                       "h": out["h"], "codec": out["codec"],
                       "owner": pre["owner"], "created": pre["created"]}
        rec["cap"] = CAP

        # 4) write-back
        if mode == "apply":
            if jpeg_family:
                upd = DIO.update_media(fid, out["data"], "image/jpeg")
                post_owner = (upd.get("owners") or [{}])[0].get("emailAddress")
                post_created = (upd.get("createdTime") or "")[:10]
                if post_owner != pre["owner"] or post_created != pre["created"]:
                    rec["status"] = "error"
                    rec["detail"] = (f"server mutated identity after update: "
                                     f"owner {pre['owner']}->{post_owner} "
                                     f"created {pre['created']}->{post_created}")
                    return rec
                rec["post"]["owner"] = post_owner
                rec["post"]["created"] = post_created
                rec["post"]["version_after"] = upd.get("version")
                rec["new_id"] = None
            else:
                parent = (meta.get("parents") or [None])[0]
                if not parent:
                    rec["status"] = "error"; rec["detail"] = "no parent folder"
                    return rec
                new_name = (im["name"] or f"{fid}.webp").rsplit(".", 1)[0] + ".webp"
                safe_name = new_name.replace("'", "\\'")
                existing = DIO.with_retry(
                    DIO.service().files().list,
                    q=f"name='{safe_name}' and '{parent}' in parents and trashed=false",
                    fields="files(id,md5Checksum)", pageSize=2).get("files", [])
                if existing and existing[0].get("md5Checksum") == out["md5"]:
                    # idempotent re-run: our own sibling from a previous
                    # attempt exists with identical bytes — reuse it
                    rec["new_id"] = existing[0]["id"]
                    rec["reused_sibling"] = True
                else:
                    created = DIO.create_media(new_name, parent, out["data"],
                                               "image/webp")
                    rec["new_id"] = created["id"]
                    rec["post"]["owner"] = (created.get("owners") or [{}])[0].get("emailAddress")
                    rec["post"]["created"] = (created.get("createdTime") or "")[:10]
        else:
            rec["new_id"] = None  # dry: nothing written

        # 5) battery
        checks = B.check_file(rec, out["data"])
        rec["battery"] = checks
        if not all(c["ok"] for c in checks):
            bad = [c for c in checks if not c["ok"]]
            rec["status"] = "battery_failed"
            rec["detail"] = "; ".join(f"{c['name']}: {c['detail']}" for c in bad)[:400]
            return rec

        rec["status"] = "ok"
        rec["elapsed_s"] = round(time.perf_counter() - t0, 2)
        return rec

    except ValueError as e:          # undecodable → skip row, batch continues
        msg = str(e)
        # Pre-existing dataset defects (corrupt/truncated uploads): skip and
        # flag, never fail the batch — we simply must not touch these files.
        if "undecodable image" in msg:
            rec["status"] = "skipped_undecodable"
            rec["detail"] = "source undecodable (pre-existing defect) — left untouched"
            return rec
        rec["status"] = "error"
        rec["detail"] = msg[:300]
        return rec
    except Exception as e:  # noqa: BLE001
        rec["status"] = "error"
        rec["detail"] = f"{type(e).__name__}: {str(e)[:280]}"
        return rec


def run(batch_file: str, mode: str) -> int:
    batch = json.load(open(batch_file, encoding="utf-8"))
    batch_id = batch["batch_id"]
    files = batch["files"]
    for f in files:
        f["batch_id"] = batch_id
    log(f"batch {batch_id}: {len(files)} files, mode={mode}, "
        f"rung cap={CAP} q={JPEG_Q}")

    jr = Journal(batch_id, mode)
    already = jr.done_ids() if mode == "apply" else set()
    if already:
        log(f"resume: {len(already)} files already ok in ledger, skipping")
    todo = [f for f in files if f["id"] not in already]

    t0 = time.perf_counter()
    run_start = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(process_one, im, mode, jr): im for im in todo}
        for fut in cf.as_completed(futures):
            rec = fut.result()
            with _ledger_lock:
                jr.append(rec)
                _stats["processed"] += 1
                if rec["status"].startswith("skipped"):
                    _stats["skipped"] += 1
                elif rec["status"] == "ok":
                    _stats["bytes_in"] += rec.get("bytes_in", 0)
                    _stats["bytes_out"] += rec["post"]["size"]
                else:
                    _stats["errors"] += 1
                n = _stats["processed"]
                if n % 25 == 0 or n == len(todo):
                    log(f"  {n}/{len(todo)} done | ok={n-_stats['errors']-_stats['skipped']} "
                        f"err={_stats['errors']} skip={_stats['skipped']} "
                        f"| {time.perf_counter()-t0:.0f}s")

    # battery aggregates over THIS RUN's records only (the ledger file is
    # append-only across runs — aggregating the file would double-count and
    # wrongly re-judge records already settled by earlier runs)
    run_recs = [r for r in jr.records if r.get("attempted_at", "") >= run_start
                and r.get("battery")]
    agg = B.aggregate([r["battery"] for r in run_recs]) if run_recs else {"files": 0, "ok": True}
    summary = jr.write_ledger(agg)

    log(f"VERDICT {summary['verdict']} | battery files={agg.get('files')} "
        f"failed={agg.get('failed', 0)} | errors={_stats['errors']} "
        f"skipped={_stats['skipped']} | "
        f"bytes {(_stats['bytes_in'])/2**20:.0f}MB -> {(_stats['bytes_out'])/2**20:.0f}MB "
        f"({(1-_stats['bytes_out']/max(1,_stats['bytes_in'])):.1%} saved)")

    if mode == "apply" and summary["verdict"] == "GREEN":
        try:
            _sync_journal_to_drive(batch_id, jr)
        except Exception as e:  # noqa: BLE001
            log(f"WARN: journal Drive-sync failed (ledger is in git anyway): {e}")

    return 0 if summary["verdict"] == "GREEN" else 3


def _sync_journal_to_drive(batch_id: str, jr):
    """Mirror results.jsonl into Drive _journal folder (L1 record)."""
    import json as _json
    # create/find Optimized Dataset/_journal under the dataset root
    roots = DIO.with_retry(
        DIO.service().files().list,
        q="name='Optimized Dataset' and mimeType='application/vnd.google-apps.folder' "
          "and trashed=false", fields="files(id,parents)", pageSize=5)
    items = roots.get("files", [])
    if not items:
        tyd = CFG["drive"]["tyd_folder_id"]
        root_id = DIO.ensure_folder(JOURNAL_PARENT_NAME, tyd)
    else:
        root_id = items[0]["id"]
    jid = DIO.ensure_folder("_journal", root_id)
    DIO.upload_text(f"{batch_id}-results.jsonl", jid,
                    "\n".join(_json.dumps(r, separators=(",", ":")) for r in jr.records))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", required=True)
    ap.add_argument("--mode", choices=["dry", "apply"], default="dry")
    args = ap.parse_args()
    sys.exit(run(args.batch, args.mode))


if __name__ == "__main__":
    main()
