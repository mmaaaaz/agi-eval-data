#!/usr/bin/env python3
"""Regenerate web/public/og.png (1200x630 social card) from current data/latest.json."""
from PIL import Image, ImageDraw, ImageFont
import json, pathlib

d = None
p = pathlib.Path(__file__).parent.parent / "data" / "latest.json"
if p.exists():
    d = json.loads(p.read_text())
c = d["meta"]["counts"] if d else {"imagesUnique": 0}
owners = len(d["owners"]) if d else 0

W, H = 1200, 630
img = Image.new("RGB", (W, H), "#050505")
dr = ImageDraw.Draw(img)

for x in range(0, W, 60):
    dr.line([(x, 0), (x, H)], fill="#0d0d0d", width=1)
for y in range(0, H, 60):
    dr.line([(0, y), (W, y)], fill="#0d0d0d", width=1)


def F(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


mono_s = F("C:/Windows/Fonts/consola.ttf", 20)
mono_b = F("C:/Windows/Fonts/consolab.ttf", 26)
big = F("C:/Windows/Fonts/segoeuib.ttf", 92)
med = F("C:/Windows/Fonts/segoeuisl.ttf", 34)

tx, ty = 90, 150
dr.polygon([(tx + 70, ty), (tx + 140, ty + 120), (tx, ty + 120)], outline="#ededed", width=6)
dr.ellipse([tx + 58, ty + 82, tx + 82, ty + 106], fill="#0070f3")

dr.text((90, 330), "agi-eval-data", font=big, fill="#ededed")
dr.text((94, 440), "real-world images where vision models fail", font=med, fill="#a1a1a1")
dr.text((94, 488), "+ complex geometric reasoning problems", font=med, fill="#a1a1a1")

# stat chips — text measured, chips sized to content
stats = [(f"{c['imagesUnique']:,}", "unique images"), (str(owners), "contributors"), ("hourly", "live sync")]
x = 94
for val, lab in stats:
    vw = dr.textlength(val, font=mono_b)
    lw = dr.textlength(lab, font=mono_s)
    cw = int(vw + lw + 44)
    dr.rounded_rectangle([x, 548, x + cw, 600], radius=10, outline="#262626", width=2, fill="#0a0a0a")
    dr.text((x + 18, 560), val, font=mono_b, fill="#0070f3")
    dr.text((x + 18 + vw + 14, 566), lab, font=mono_s, fill="#666")
    x += cw + 20

dr.ellipse([W - 110, 80, W - 86, 104], fill="#ee0000")

out = pathlib.Path(__file__).parent.parent / "web" / "public" / "og.png"
img.save(out, optimize=True)
print(f"og.png written: {out} ({out.stat().st_size // 1024} KB)")
