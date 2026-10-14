"""Fetch the exact image bytes a model was shown, with a local cache.

Costs nothing: the images already live in Drive, the cache is content-addressed and
safe to delete, and it is never committed.
"""
from __future__ import annotations
import hashlib
import io
import pathlib
import urllib.request

DEFAULT_TEMPLATE = "https://lh3.googleusercontent.com/d/{file_id}=w{pixel_budget}"

# A budget of 0 or less means "the stored original" and fetches =s0. The CDN's bare URL and
# =w{budget} both RESIZE, so without this the harness could never show a model more than the
# budget — and an image the ledger calls 24 MP would reach it at 2.8 MP. Measured: =s0 returns
# 6000x4000 for a file the bare URL returns at 1600x1067.
ORIGINAL_TEMPLATE = "https://lh3.googleusercontent.com/d/{file_id}=s0"


def url_for(file_id: str, url_template: str, pixel_budget: int) -> str:
    if pixel_budget <= 0:
        return ORIGINAL_TEMPLATE.format(file_id=file_id)
    return url_template.format(file_id=file_id, pixel_budget=pixel_budget)


def make_fetcher(
    cache_dir: str | pathlib.Path,
    url_template: str = DEFAULT_TEMPLATE,
    pixel_budget: int = 2048,
    timeout: int = 30,
):
    """Return fetch(item) -> bytes.

    The same CDN URL the site uses, so the model sees what a reader sees. The
    harness then hashes the returned bytes, which makes the run auditable even if
    the Drive file is later replaced.
    """
    cache = pathlib.Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)

    def fetch(item: dict) -> bytes:
        url = url_for(item["file_id"], url_template, pixel_budget)
        key = hashlib.sha256(url.encode("utf-8")).hexdigest()[:20]
        path = cache / (key + ".img")
        if path.exists():
            return path.read_bytes()
        req = urllib.request.Request(url, headers={"User-Agent": "benchmark-harness/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        if not data:
            raise ValueError("empty image for " + str(item.get("file_id")))
        path.write_bytes(data)
        return data

    return fetch


def make_stub_fetcher(pixel_budget: int = 2048):
    """Deterministic synthetic bytes, derived from the file id.

    A dry run must touch nothing: no Drive, no quota, no network. This makes the
    full pipeline - release, fetch, prompt, run, grade, trace, analyse - hermetic and
    repeatable, which is what lets it be tested before any money is spent.
    """

    cache: dict[str, bytes] = {}

    def fetch(item: dict) -> bytes:
        """A REAL, tiny JPEG, deterministic from the file id.

        IT USED TO RETURN 256 BYTES OF HASH NOISE. That is fine for testing the plumbing and
        useless for testing anything that DECODES the image. Three things failed on it, and
        every failure looked like a failure of the CODE rather than of the fixture:

          - the crop attack (new) errored on every cropped row
          - `image_dimensions` returned None, so `image_w` and `image_h` were always null
          - the tagger's dry run was exercised against bytes no image library can open

        A dry run must touch nothing — no Drive, no quota, no network — AND still exercise the
        real path. Those are not in conflict: this makes a valid image locally. The same file
        id always yields the same bytes, so `image_sha256` stays meaningful.
        """
        fid = str(item.get("file_id", ""))
        if fid in cache:
            return cache[fid]
        from PIL import Image
        h = hashlib.sha256((fid + ":" + str(pixel_budget)).encode("utf-8")).digest()
        w, ht = 96 + h[0] % 32, 72 + h[1] % 32
        im = Image.new("RGB", (w, ht))
        px = im.load()
        for y in range(ht):
            for x in range(w):
                px[x, y] = (h[(x + y) % 32], h[(x * 3 + y) % 32], h[(x + y * 7) % 32])
        out = io.BytesIO()
        im.save(out, format="JPEG", quality=80)
        data = out.getvalue()
        cache[fid] = data
        return data

    return fetch
