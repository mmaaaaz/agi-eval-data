# The review gate — anatomy figure

The interactive isometric figure served at `/anatomy.html` on the explainer site.
It shows the benchmark pipeline as one machine: a 24-plate index row under a
reader lamp, a drafting head dealing 5 question cards, a press that stamps at
the inspector column, and the end gate that files ~1 plate in 10 into the closed
curated drawer (5,000 of 50,000) and the rest onto the open shelf (45,000).

## Files

- `build.mjs` — renders `the-review-gate.html` from `iso-kit.mjs` + `iso.css`.
- `iso-kit.mjs`, `iso.css` — the isometric kit from the anatomy skill
  (skills.wheresryan.sh, MIT). Local overrides for the light theme live in the
  figure's own `<style>` block inside `build.mjs`.
- `cdp-verify.mjs` — drives headless Edge over CDP: interaction checks (crank,
  ← →, idle tour), console-error scan, and true-390px screenshots.

## Rebuild

```sh
node build.mjs                                # writes the-review-gate.html here
cp the-review-gate.html ../public/anatomy.html
```

`node cdp-verify.mjs` re-runs the interaction and viewport checks against the
built page.

## Keep in sync

The figure's constants (24 plates, 5 cards per plate, 5,000 curated /
45,000 open / 50,000 corpus) mirror `src/content/facts.ts`, and the semantic
readout labels (`drawer`, `shelf`) mirror the site copy. The truthfulness guard
`scripts/factory/08_site_truthfulness.py` scans both this directory and
`public/` on every run.
