# agi-eval-relay

The questions API for **agi-eval-data**, deployed as a Cloudflare Worker at
`https://agi-eval-relay.devmaaaaz.workers.dev`. D1 database: `agi-eval-questions`.

## What it serves

```
GET   /api/health              liveness
GET   /api/info                which doors are configured
GET   /api/questions           open reads
GET   /api/insights            open reads
GET   /api/changes             the authoring cursor
GET   /api/selections          the shortlist and every decision on it
POST  /api/selections          record a decision (open - proposing is crowd-sourced)
POST  /api/questions/:id/review   GATED: the reviewer door
POST  /api/runs                   GATED: the harness door
POST  /api/chat                RETIRED - see below
```

## The doors, and why an unset secret is not an open door

| door | header | secret | when unset |
| --- | --- | --- | --- |
| approval | `x-questions-code` | `QUESTIONS_CODE` | **approval is DISABLED** |
| measurement | `x-harness-code` | `HARNESS_CODE` | **ingest is DISABLED** |

**Reads and drafts are open by design.** Proposing an image and drafting a question are meant to be
crowd-sourced, so those routes carry no gate. **Approval and measurement are not**, because they
decide what the benchmark contains.

```
if (!hasCode(provided, expected)) return 401
```

**An unconfigured secret disables the privileged door. It never opens it.** This is the opposite of
the usual `if (env.SECRET && ...)` shape, which fails OPEN when the secret is missing — and that
exact bug shipped here once, in the chat route.

## What this Worker cannot do

**It cannot spend money on Cloudflare.** The bindings are `env.DB` and one rate-limit variable:
no `[ai]` binding, no gateway model, no fallback flag. The owner's rule is that the only permitted
spend is **inference on images**, and this Worker has nothing to spend with.

`POST /api/chat` is **retired** and returns **410 Gone**, after the door check, so an old client
gets a clear answer rather than a 404. Its page was deleted and its AI SDK dependency removed — the
bundle fell from 888 KiB to 184 KiB.

## Deploying

```bash
bunx --bun wrangler@4.125.0 d1 migrations apply agi-eval-questions --remote   # before the code
bunx --bun wrangler@4.125.0 deploy
```

**Migrations before code is the order that can never be wrong.** The reverse is fine only when the
change happens to be backward compatible, which is a property of the change rather than of the
pipeline.

`scripts/db/diagnose_remote.py` runs **before** the migration step in CI and names a half-applied
migration, so a failure says which file and why rather than surfacing as a bare SQLite error.

## A note for anyone writing a script that calls this

**Set a `User-Agent`.** Cloudflare blocks Python's `urllib` default with a **403**, and the body is
empty, so it reads as a refusal by the API rather than by the edge. `00b_seed_selections.py` lost
an afternoon to this.
