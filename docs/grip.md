# grip.md — GRIP geometric-reasoning site (grip-eval)

The **third site** in this repo: a lean, backend-free-browsing explorer for the
GRIP-Benchmark-34 suite (34 sub-benchmarks · 100,000 synthetic images · 500,000
ground-truthed questions, 5 difficulty levels each, independently validated).

Live upstream (read-only source of truth): https://github.com/bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset
Design doc: `plan-germetrical.md` · Plan: `.hermes/plans/2026-08-30_152730-grip-website-implementation-v3.md`

---

## Facts (verified 2026-08-30)

| Fact | Detail |
|---|---|
| Image hosting | `media.githubusercontent.com/media/bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset/main/<path>` — LFS blobs, anonymous, CORS `*`. **raw.githubusercontent serves LFS pointer text for these paths — never use it for images.** |
| Local suite download | `Geomatric-Reasoning-Benchmark-Dataset-main/` — gitignored, read-only source data (LFS pointer stubs; JSON/annotations are real) |
| Artifact | `data/grip/tree.json` (index, ~100 KB) + `data/grip/{slug}.json` ×34 (detail ≈2 MB brotli), committed like `data/metro.json` |
| Overrides | `data/grip-overrides/{slug}/{sampleId}.json` — patch files with from-assertions; applied at scan time; upstream mirror at `data/overrides/` (written by grip-sync worker, one atomic commit per sync) |
| Sync | `apps/grip-sync` Worker + KV stages edits → explicit "Sync N → 1 commit" via Git Data API to upstream `main` (user-approved) |

## Commands

```bash
bun run data:grip      # scan suite → data/grip/* → copy to apps/grip-web/public/data
bun run check:grip     # validate artifacts + overrides (exit-code; CI-able)
bun run dev:grip-web   # site on localhost:5175
```

## Environment (only the sync worker needs credentials)

Copy `docs/grip-env.example` → `apps/grip-sync/.dev.vars` (gitignored), or set in prod:

```bash
npx wrangler secret put GRIP_GITHUB_PAT --name grip-sync
npx wrangler secret put GRIP_ACCESS_CODE --name grip-sync
```

**Token type matters:** a *classic* PAT with `repo` scope from `mmaaaaz`
(collaborator-write on the upstream repo). Fine-grained PATs cannot reach
another user's repo even as collaborator — do not use them here.
Create: https://github.com/settings/tokens/new?scopes=repo&description=grip-sync

## Editing / sync flow

1. Edit a question's text/GT/format or a scene value on the sample page → staged
   (KV + localStorage mirror). Nothing is published.
2. `/project` → Sync panel: shows staged patches + upstream-drift check.
3. Explicit **Sync N edits → 1 commit** → worker writes all override files to
   upstream `data/overrides/` in ONE atomic commit → KV cleared.
4. Re-bake: locally `bun run data:grip && git commit data/grip`, or dispatch
   `sync-grip.yml` (re-clones upstream, rescans, commits artifacts).
5. Conflict path: if upstream `main` moved after an edit was staged, sync returns
   a conflict report; re-assert or drop each stale patch. A stale `from` in any
   committed override fails `check:grip` hard — stale edits never land silently.
