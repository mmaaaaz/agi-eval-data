#!/usr/bin/env python3
"""Build the DEMO release from the ten verified sample images.

WHAT THIS IS, AND WHAT IT IS NOT
--------------------------------
This is a 30-item DEMO release used to show the measurement machinery on real
photographs from the corpus: accuracy against a real vision model, the no-image
blind baseline, and the typographic attack track. It is NOT the curated benchmark
and no number from it may be quoted as a benchmark result.

Every question is built from the samples page's vision-verified facts
(`apps/explainer/src/content/samples.ts`, each answer re-checked on a second
full-resolution pass). The items were drafted by hand FOR THIS DEMO; the benchmark
itself is model-drafted and human-reviewed, per the project plan.

Run:
    python -m scripts.harness.make_demo_release
"""
from __future__ import annotations

from pathlib import Path

from .release import build

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "release" / "demo-samples-v1"

CLOCK = "1tS0yaqG-wTlcmVgOn5bDjsc6OViS5PNj"
TRAIN = "1yV7IsX1FQ7ZISiE_mUGa_YOouHFkFVWZ"
MUSEUM = "1yqc-Bt8wJSqDgM2OxtD2f882ktvu-G1t"
BUS = "1z6e6ZwHTyddx76RrISAsrFHpkALGsrz9"
BIKE = "1yu8m8xeg4bRh-aR9KHW-sprulkKD08r_"
STADIUM = "1ypNERjZ9A6NTGE0EeoD287u2SGOvSkP3"
SCHOOL = "1zE8yp_UQxpqk9RabJqxZ8eGbPbQtfFOs"
COFFEE = "1ygRKV_hQ_6mzu0TytvYO2lkv4OMjqPPy"
MONITORS = "1z535AFjwX-o86EFq0npf5vdmC-pjLNzB"
BAGS = "1zeo6vjQvhPyLGkuHyr7LDFY-MwIDY1fb"


def item(i, file_id, q, choices, answer, cap, level):
    return {
        "id": i,
        "file_id": file_id,
        "question": q,
        "choices": choices,
        "answer": answer,
        "answer_type": "choice",
        "capability": cap,
        "level": level,
    }


ITEMS = [
    item(1, CLOCK, "What time does the clock show?", ["10:10", "8:10", "9:50", "7:45"], "10:10", "PERC", "L2"),
    item(2, CLOCK, "How many anchors are printed around the clock face?", ["12", "10", "8", "14"], "12", "PERC", "L2"),
    item(3, CLOCK, "What is printed on the clock face behind the hands?", ["An antique world map", "A star chart", "A subway map", "A plain grid"], "An antique world map", "PERC", "L1"),
    item(4, TRAIN, "In what language is the information placard in front of the model written?", ["French", "English", "German", "Spanish"], "French", "PERC", "L1"),
    item(5, TRAIN, "How many large driving wheels are visible on this side of the locomotive?", ["3", "2", "4", "5"], "3", "PERC", "L2"),
    item(6, TRAIN, "Where is the placard, relative to the locomotive?", ["In front of it", "Behind it", "Inside the cab", "Above the boiler"], "In front of it", "G6", "L2"),
    item(7, MUSEUM, "What does the label on the wooden calculating board read?", ["BABY CALCULATOR", "CHILD COUNTER", "ABACUS JUNIOR", "TINY ADDING BOARD"], "BABY CALCULATOR", "PERC", "L1"),
    item(8, MUSEUM, "What brand is printed on the black pocket calculator?", ["EXACTUS", "BRUNSVIGA", "CURTA", "OLIVETTI"], "EXACTUS", "PERC", "L1"),
    item(9, MUSEUM, "Is the display behind glass?", ["Yes", "No"], "Yes", "PERC", "L2"),
    item(10, BUS, "What brand name is on the front of the blue truck?", ["ISUZU", "TOYOTA", "NISSAN", "HINO"], "ISUZU", "PERC", "L1"),
    item(11, BUS, "How many large passenger windows does the green bus show on this side?", ["6", "5", "7", "4"], "6", "PERC", "L2"),
    item(12, BUS, "In this photo, is the blue truck to the left or to the right of the green bus?", ["To the right", "To the left", "Directly behind", "Out of frame"], "To the right", "G6", "L2"),
    item(13, BIKE, "What brand name is printed in large letters on the frame?", ["GT", "GIANT", "TREK", "CANYON"], "GT", "PERC", "L1"),
    item(14, BIKE, "Do the bicycle's wheels appear in the photograph?", ["No", "Yes"], "No", "PERC", "L2"),
    item(15, BIKE, "What is the frame resting on?", ["A wooden slatted surface", "A glass table", "A concrete floor", "A car roof rack"], "A wooden slatted surface", "P2", "L2"),
    item(16, STADIUM, "What does the sign above the main entrance say?", ["EAGLE STADIUM", "ETIHAD STADIUM", "CAMP NOU", "KING POWER"], "EAGLE STADIUM", "PERC", "L1"),
    item(17, STADIUM, "What material is the stadium's central tower built from?", ["Brick", "Steel", "Concrete", "Timber"], "Brick", "P1", "L2"),
    item(18, STADIUM, "Which city is Eagle Stadium in?", ["Not stated in the photograph", "Liverpool", "Birmingham", "London"], "Not stated in the photograph", "PERC", "L5"),
    item(19, SCHOOL, "In which script are the signs on the building written?", ["Korean", "Japanese", "Chinese", "Thai"], "Korean", "PERC", "L1"),
    item(20, SCHOOL, "What color is the sign attached to the fence?", ["Yellow", "Blue", "White", "Red"], "Yellow", "PERC", "L2"),
    item(21, SCHOOL, "The signage is in Korean. In which country is the school most likely located?", ["South Korea", "Japan", "China", "Taiwan"], "South Korea", "PERC", "L5"),
    item(22, COFFEE, "How many cups are visible?", ["1", "2", "3", "0"], "1", "PERC", "L2"),
    item(23, COFFEE, "Is the cup made of glass or ceramic?", ["Glass", "Ceramic", "Paper", "Metal"], "Glass", "P1", "L2"),
    item(24, COFFEE, "Where does the glass cup stand?", ["On the machine's round drip tray", "On a wooden counter", "On a saucer", "On a stacked shelf"], "On the machine's round drip tray", "G6", "L2"),
    item(25, MONITORS, "What film does the mug reference?", ["The Lord of the Rings", "Star Wars", "Harry Potter", "The Matrix"], "The Lord of the Rings", "PERC", "L1"),
    item(26, MONITORS, "How many monitors are on the desk?", ["2", "1", "3", "4"], "2", "PERC", "L2"),
    item(27, MONITORS, "Is a printer visible on the desk?", ["No", "Yes"], "No", "PERC", "L2"),
    item(28, BAGS, "How many bags is the person carrying?", ["2", "1", "3", "4"], "2", "PERC", "L2"),
    item(29, BAGS, "Where is the mesh sack, relative to the person, as seen from the camera?", ["To the person's left", "To the person's right", "Directly in front", "Out of frame"], "To the person's left", "G6", "L2"),
    item(30, BAGS, "Is the person's face visible in the photograph?", ["No", "Yes"], "No", "PERC", "L2"),
]

CONSENT = {
    "basis": "the corpus owner's own public photographs (agi-eval-data.pages.dev)",
    "images_releaseable": True,
    "note": "DEMO release for methodology demonstration; not the curated benchmark.",
}
PII = {
    "pass": "manual vision review of all ten source images",
    "flags": [],
    "note": "no faces not for publication, licence plates, ID documents, home interiors "
            "(non-public) or children; the one person shown is from behind, no face",
}


def main() -> int:
    manifest = build(
        ITEMS, OUT, release_id="demo-samples-v1",
        notes="DEMO: 30 choice items over the 10 vision-verified sample images; hand-drafted "
              "for methodology demonstration only. Not the benchmark; no number quotable as a result.",
        consent=CONSENT, pii=PII,
    )
    print("wrote", OUT)
    print("n_items", manifest["n_items"], "| n_images", manifest["n_images"])
    print("groundtruth_hash", manifest["groundtruth_hash"][:16])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
