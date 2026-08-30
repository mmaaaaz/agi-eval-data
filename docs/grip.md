# grip.md — GRIP geometric-reasoning site (grip-eval)

The **third site** in this repo: a lean explorer for the GRIP-Benchmark-34 suite
(34 sub-benchmarks · 100,000 synthetic images · 500,000 ground-truthed questions,
5 difficulty levels each, independently validated).

Live: https://grip-eval.pages.dev
Upstream (single source of truth): https://github.com/bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset
Design doc: `plan-germetrical.md` · Plans: `.hermes/plans/*grip*`

---

## Data flow (verified 2026-08-30)

```
bilal's repo  = SINGLE SOURCE OF TRUTH
  ├── Dataset/*/annotations.jsonl ──► grip_fetch.py (hourly CI) ──► .grip-cache/
  ├── data/overrides/*.json ────────┘                                │
  │        ▲ sync: worker, 1 atomic commit from KV drafts            │ bake
  │        │                                                         ▼
  └── images (LFS) ──► hotlinked to browser (never stored here)   data/grip/*.json.gz
                                                                   (committed, derived)
                                                                        │ push
                                                                        ▼
                                                   Pages path-filter auto-redeploys
```

| Piece | Detail |
|---|---|
| Image hosting | `media.githubusercontent.com/media/bilaljawaid980/…` — LFS blobs, anonymous, CORS `*`. **raw.githubusercontent serves LFS pointer text — never use it for images.** |
| Artifacts | `data/grip/tree.json` (index) + `data/grip/{slug}.json.gz` ×34, committed; mirrored to `apps/grip-web/public/data/grip/` by `grip_sync_public.py` |
| Overrides | ONE durable home: `data/overrides/{slug}/{id}.json` on the upstream repo (committed by grip-sync). KV holds only un-synced drafts. Applied at bake time with from-assertions |
| Re-bake | `.github/workflows/grip-rebake.yml` — hourly :07 + `workflow_dispatch` (force option) + `repository_dispatch` fired by the worker after each sync. Skips when upstream HEAD == `bakedFromCommit`. Failure opens an issue (tripwire) |
| Staleness | `bakedFromCommit` in `tree.json` records the upstream SHA the artifacts were built from. The site can lag ≤1h but never silently forever |

## Commands

```bash
bun run data:grip      # fetch (if upstream moved) → scan → validate → copy to public/
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

The same PAT also dispatches `grip-rebake` on this repo after each sync
(classic `repo` scope is account-wide, so no extra token is needed).

## Editing / sync lifecycle

1. **Stage** — edit a question/scene value on a sample page → patch JSON
   (`{field, from?, to}` + author/reason) stored in worker KV + browser localStorage.
   Nothing published; the "edited" badge is site-side only.
2. **Sync** — `/project` → "sync N edits → 1 commit". Worker checks each patch's
   `baseCommitAtEdit` against upstream HEAD (mismatch = `conflict`, nothing pushed),
   then writes all patches as blobs → one tree → one commit → one ref update on
   upstream `data/overrides/`. KV drafts cleared.
3. **Re-bake** — the worker dispatches `grip-rebake`; CI fetches upstream
   (annotations + overrides), bakes, validates, commits `data/grip/**`, pushes —
   the Pages path-filter redeploys the site automatically.
4. **Conflicts** — if upstream moved between staging and sync, the sync returns a
   conflict report. A stale `from` in any committed override also fails
   `bun run check:grip` hard. Stale edits never land silently.

## Notes

- `Geomatric-Reasoning-Benchmark-Dataset-main/` (local download) is no longer used
  by the pipeline — safe to delete. `.grip-cache/` is the transient fetch cache.
- Subsuite annotations (`sample_test/`…) are pre-retrofit 4-question snapshots:
  browsable, flagged `legacy`, excluded from the canonical 100k/500k counts.
- Force a re-bake: Actions → grip-rebake → Run workflow → `force=true`.
