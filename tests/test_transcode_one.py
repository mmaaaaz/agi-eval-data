"""TDD tests for dataset-tools/transcode_one.py — the single-file transcoder."""
import hashlib
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "dataset-tools"))
import transcode_one as T


def jpeg_bytes(w, h, quality=90, exif_orientation=None):
    """Deterministic synthetic gradient JPEG."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    for x in range(0, w, max(1, w // 32)):
        for y in range(h):
            px[x, y] = (x % 256, y % 256, (x + y) % 256)
    if exif_orientation:
        exif = Image.Exif()
        exif[274] = exif_orientation  # orientation tag
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, exif=exif)
        return buf.getvalue()
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def png_bytes(w, h, alpha=False):
    img = Image.new("RGBA" if alpha else "RGB", (w, h), (10, 200, 30, 128) if alpha else (10, 200, 30))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class TestJpegInPlace:
    def test_downscales_to_cap(self):
        out = T.transcode_one(jpeg_bytes(4000, 3000), "jpg", cap=1568, jpeg_quality=75)
        im = Image.open(io.BytesIO(out["data"]))
        assert max(im.size) == 1568
        assert out["w"] == 1568 and out["h"] == 1176

    def test_no_upscale(self):
        out = T.transcode_one(jpeg_bytes(800, 600), "jpg", cap=1568, jpeg_quality=75)
        assert (out["w"], out["h"]) == (800, 600)

    def test_output_is_jpeg_mime_stable(self):
        out = T.transcode_one(jpeg_bytes(2000, 1500), "jpg", cap=1568, jpeg_quality=75)
        assert out["codec"] == "jpeg"
        im = Image.open(io.BytesIO(out["data"]))
        assert im.format == "JPEG"

    def test_metadata_stripped(self):
        out = T.transcode_one(jpeg_bytes(2000, 1500, exif_orientation=1), "jpg", cap=1568, jpeg_quality=75)
        im = Image.open(io.BytesIO(out["data"]))
        assert not im.getexif()

    def test_exif_orientation_applied(self):
        # orientation 6 = rotate 90 CW to display; stored 2000x1000 => displayed 1000x2000
        out = T.transcode_one(jpeg_bytes(2000, 1000, exif_orientation=6), "jpg", cap=1568, jpeg_quality=75)
        assert out["h"] > out["w"], "portrait-after-orientation expected, got %sx%s" % (out["w"], out["h"])

    def test_deterministic(self):
        src = jpeg_bytes(3000, 2000)
        a = T.transcode_one(src, "jpg", cap=1568, jpeg_quality=75)
        b = T.transcode_one(src, "jpg", cap=1568, jpeg_quality=75)
        assert hashlib.md5(a["data"]).hexdigest() == hashlib.md5(b["data"]).hexdigest()

    def test_size_shrinks_for_camera_jpeg(self):
        src = jpeg_bytes(4000, 3000, quality=92)
        out = T.transcode_one(src, "jpg", cap=1568, jpeg_quality=75)
        assert len(out["data"]) < len(src)

    def test_md5_reported(self):
        out = T.transcode_one(jpeg_bytes(1000, 800), "jpg", cap=1568, jpeg_quality=75)
        assert out["md5"] == hashlib.md5(out["data"]).hexdigest()


class TestNonJpegSiblings:
    def test_png_becomes_webp(self):
        out = T.transcode_one(png_bytes(2000, 1500), "png", cap=1568, jpeg_quality=75)
        assert out["codec"] == "webp"
        im = Image.open(io.BytesIO(out["data"]))
        assert im.format == "WEBP"
        assert max(im.size) == 1568

    def test_alpha_preserved(self):
        out = T.transcode_one(png_bytes(1000, 800, alpha=True), "png", cap=1568, jpeg_quality=75)
        im = Image.open(io.BytesIO(out["data"]))
        assert im.mode in ("RGBA", "LA"), "alpha channel lost"

    def test_heic_ext_routed_to_webp(self):
        out = T.transcode_one(png_bytes(1000, 800), "heic", cap=1568, jpeg_quality=75)
        assert out["codec"] == "webp"


class TestEdgeCases:
    def test_cmyk_jpeg_converted(self):
        img = Image.new("CMYK", (800, 600), (10, 20, 30, 0))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        out = T.transcode_one(buf.getvalue(), "jpg", cap=1568, jpeg_quality=75)
        im = Image.open(io.BytesIO(out["data"]))
        assert im.mode == "RGB"

    def test_grayscale_jpeg(self):
        img = Image.new("L", (800, 600), 128)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        out = T.transcode_one(buf.getvalue(), "jpg", cap=1568, jpeg_quality=75)
        im = Image.open(io.BytesIO(out["data"]))
        assert im.format == "JPEG"

    def test_extreme_aspect_ratio(self):
        out = T.transcode_one(jpeg_bytes(4500, 720), "jpg", cap=1568, jpeg_quality=75)
        assert max(out["w"], out["h"]) <= 1568
        assert min(out["w"], out["h"]) >= 200  # sanity: not collapsed

    def test_corrupt_raises_valueerror(self):
        with pytest.raises(ValueError):
            T.transcode_one(b"not an image at all", "jpg", cap=1568, jpeg_quality=75)

    def test_under_cap_dimensions_exact(self):
        out = T.transcode_one(jpeg_bytes(1500, 1000), "jpg", cap=1568, jpeg_quality=75)
        assert (out["w"], out["h"]) == (1500, 1000)
