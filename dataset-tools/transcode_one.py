#!/usr/bin/env python3
"""
transcode_one.py — the single-file optimizer (plan v6 §3.1 / Task 4.2).

Pure function: bytes + source ext in → dict(new bytes, dims, codec, md5) out.
No I/O here — Drive download/upload lives in drive_io.py. Determinism is a
contract: pinned Pillow version + fixed resample/quality = same bytes forever.

Spec (plan v6):
  - JPEG-family sources: re-encode JPEG in-place (mimeType-preserving), long
    edge capped, EXIF orientation applied before resize, metadata stripped.
  - Non-JPEG sources (png/heic/gif/webp/avif/...): encode WebP sibling.
  - Never upscale; alpha preserved for WebP; CMYK/grayscale normalized;
    corrupt input raises ValueError (battery + runner treat as error row).
"""
import hashlib
import io
import os

from PIL import Image, ImageOps, ImageCms

# HEIC/HEIF + AVIF decoder registration (idempotent). The CI dry-run of
# 2026-09-05 caught this: 72 HEIC files errored as "undecodable" because
# pillow-heif was installed but never registered. Fail-soft on missing
# plugins so environments without them still process non-HEIC files.
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass
try:
    import pillow_avif  # noqa: F401  (registers AVIF on import)
except ImportError:
    pass

# ---- deterministic environment assertion --------------------------------
# Pillow 11.x writes deterministic JPEG/WebP bytes for fixed input+params.
# If the CI runner ever drifts versions, fail loudly instead of silently
# changing every output hash (plan v6 §3.1 "pinned versions are the spec").
import PIL
assert PIL.__version__.startswith("11."), f"pinned Pillow 11.x required, got {PIL.__version__}"
_JPEG_Q = None  # set per-call


def _normalize(img: Image.Image) -> Image.Image:
    """Orientation-correct + normalize to a mode the encoder handles well."""
    img = ImageOps.exif_transpose(img)  # bake rotation from EXIF orientation
    if img.mode in ("CMYK", "YCbCr", "P"):
        img = img.convert("RGB")
    elif img.mode == "I;16" or img.mode.startswith("I;16"):
        img = img.convert("I").convert("L")
    elif img.mode == "1":
        img = img.convert("L")
    return img


def _resample(img: Image.Image, cap: int, upscale: bool = False):
    """Long-edge cap, LANCZOS, never upscale. Returns (img, w, h)."""
    w, h = img.size
    long_e = max(w, h)
    if long_e > cap:
        if w >= h:
            nw, nh = cap, max(1, round(h * cap / w))
        else:
            nw, nh = max(1, round(w * cap / h)), cap
        img = img.resize((nw, nh), Image.LANCZOS)
    return img, img.size[0], img.size[1]


def transcode_one(data: bytes, ext: str, cap: int, jpeg_quality: int,
                  webp_quality: int = 75, upscale: bool = False) -> dict:
    """Optimize one image. ext: manifest-style extension without dot.

    Returns dict: data, md5, w, h, codec ('jpeg'|'webp'), size.
    Raises ValueError on undecodable input.
    """
    ext = (ext or "").lower()
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"undecodable image: {type(e).__name__}: {e}") from e

    icc = img.info.get("icc_profile")  # keep color profile if present
    img = _normalize(img)
    img, w, h = _resample(img, cap, upscale)

    jpeg_family = ext in ("jpg", "jpeg")
    buf = io.BytesIO()
    if jpeg_family:
        # In-place JPEG: grayscale stays L (smaller), everything else RGB.
        if img.mode not in ("L", "RGB"):
            img = img.convert("RGB")
        save_kw = dict(format="JPEG", quality=jpeg_quality, optimize=True,
                       progressive=True)
        if icc:
            save_kw["icc_profile"] = icc
        img.save(buf, **save_kw)
        codec = "jpeg"
    else:
        # Sibling WebP: alpha-aware, method 6 = max effort.
        if img.mode == "P":
            img = img.convert("RGBA" if "transparency" in img.info else "RGB")
        if img.mode == "LA":
            img = img.convert("RGBA")
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        save_kw = dict(format="WEBP", quality=webp_quality, method=6)
        if icc:
            save_kw["icc_profile"] = icc
        img.save(buf, **save_kw)
        codec = "webp"

    out = buf.getvalue()
    return {"data": out, "md5": hashlib.md5(out).hexdigest(),
            "w": w, "h": h, "codec": codec, "size": len(out)}


def verify_decodable(data: bytes) -> tuple:
    """Decode-proof for the battery. Returns (ok, (w, h) or None)."""
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        img2 = Image.open(io.BytesIO(data))
        img2.load()
        return True, img2.size
    except Exception:  # noqa: BLE001
        return False, None
