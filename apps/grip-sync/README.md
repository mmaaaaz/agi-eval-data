# grip-sync worker

Stages GRIP override edits in KV and syncs them to the upstream dataset repo
(`bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset`) as **one atomic commit**
via the GitHub Git Data API. Zero D1, zero SDKs.

## Setup

1. `npx wrangler kv namespace create GRIP_EDITS` → put the id in `wrangler.toml`.
2. Secrets:
   ```bash
   npx wrangler secret put GRIP_GITHUB_PAT --name grip-sync
   npx wrangler secret put GRIP_ACCESS_CODE --name grip-sync
   ```
   Token: **classic PAT** with `repo` scope from `mmaaaaz` (fine-grained tokens
   cannot reach another user's repo, even as collaborator).
   See `docs/grip-env.example` for the full guide.
3. Local dev: copy `.dev.vars.example` → `.dev.vars`, then `npx wrangler dev`.

## Endpoints

| Method | Path | Gate | Purpose |
|---|---|---|---|
| GET | `/api/edits?slug=X` | public | list staged edits |
| PUT | `/api/edits/:slug/:sampleId` | access code | stage an override patch |
| DELETE | `/api/edits/:slug/:sampleId` | access code | drop a staged edit |
| GET | `/api/sync/status` | public | staged count + upstream SHA + drift check |
| POST | `/api/sync` | access code | sync all staged → 1 commit |

## Sync algorithm

GET upstream `main` → list `ov:*` → drift check (`baseCommitAtEdit` must equal
current HEAD, else `conflict`) → PUT blobs (`data/overrides/{slug}/{id}.json`) →
POST tree (base_tree = HEAD) → POST commit → PATCH ref (single atomic move) →
clear KV → bump `site:artifactVersion`.
