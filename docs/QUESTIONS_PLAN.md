# QUESTIONS PLAN — benchmark question authoring on the web

_Request (2026-08-25): group images, add ~5+ questions per image, securely, no duplicates, contributors contribute via the website, must persist, work with the dataset on the web. Auth model TBD ("right now we're making the dataset")._

---

## 1. Recommended architecture (verdict first)

**Cloudflare D1 (SQLite) + the existing relay Worker as the API + a `/contribute` route on the site, gated by Cloudflare Access (email OTP).** Approved questions export as `data/questions.jsonl` into the repo — the benchmark artifact stays git-native.

```
/contribute (Pages, gated by Cloudflare Access email OTP — free ≤50 users)
   │  fetch + Access JWT (or access code in v1)
   ▼
relay worker /api/questions/*  ──►  D1 (SQLite, free tier)
   │                                  UNIQUE(file_id, qnorm)  ← dedupe at the DB level
   ▼
"Publish" action → GET /api/questions/export.jsonl
   → committed by the hourly bot or a workflow_dispatch job → data/questions.jsonl in-repo
```

Why this fits the project's constraints exactly:
- **$0**: D1 free = 5M row-reads/day, 100k row-writes/day, 5 GB storage. A 45k-image dataset with 5–10 questions each ≈ 300k rows — ~2% of the storage cap, writes are human-scale.
- **No new vendor**: same Cloudflare account, same Worker that already exists.
- **Persist + queryable**: real schema, real constraints — dedupe enforced by the DB, not by hope.
- **Dataset-native export**: questions land in the repo as JSONL (VQA-style), versioned, reviewable, consumable by any eval harness without a runtime DB dependency.

## 2. Alternatives considered

| Option | Verdict | Why not / why |
|---|---|---|
| **D1 + Worker (recommended)** | ✅ | Real schema + UNIQUE dedupe; free tier dwarfs our write volume; same platform |
| GitHub-as-DB (commit JSON via API) | ⚠️ later | Versioned + reviewable, but no dedupe constraints, slow UX (commit per question), rate limits, needs a PAT with repo scope in the Worker |
| Cloudflare KV | ❌ | No queries, no unique constraints, no partial updates — dedupe would be app-level only |
| Supabase/Firebase | ❌ | New vendor + accounts; free tiers fine but against the single-platform simplicity |
| Google Sheets/Forms | ❌ | No integrity, no dedupe, miserable at 200k rows |

## 3. Schema (D1)

```sql
CREATE TABLE questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     TEXT NOT NULL,             -- Drive file id (joins to data/latest.json)
  contributor TEXT NOT NULL,             -- email (from Access) or chosen display name
  question    TEXT NOT NULL,
  qnorm       TEXT NOT NULL,             -- normalized: lowercase, trimmed, collapsed ws, strip ?/punct
  category    TEXT NOT NULL DEFAULT 'general',
             -- taxonomy: counting | spatial | perspective | occlusion | mirror_symmetry |
             --           shadow | pattern_completion | geometric | color | general
  answer_type TEXT NOT NULL DEFAULT 'text',   -- text | number | choice | yesno
  answer      TEXT,                      -- ground truth (may be empty at draft stage)
  choices     TEXT,                      -- JSON array for choice type
  difficulty  TEXT CHECK (difficulty IN ('easy','medium','hard')) DEFAULT 'medium',
  status      TEXT NOT NULL DEFAULT 'approved', -- approved | rejected (edit trail later)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(file_id, qnorm)
);
CREATE INDEX idx_questions_file ON questions(file_id);
CREATE INDEX idx_questions_contrib ON questions(contributor);

CREATE TABLE image_groups (            -- "group these images" — named sets for question batches
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE image_group_members (
  group_id INTEGER NOT NULL REFERENCES image_groups(id) ON DELETE CASCADE,
  file_id  TEXT NOT NULL,
  PRIMARY KEY (group_id, file_id)
);
```

**Dedupe strategy (three layers)**
1. `UNIQUE(file_id, qnorm)` — hard DB guarantee; a duplicate INSERT fails.
2. Client pre-check: `GET /api/questions/check?file_id=…&q=…` returns near-matches (same normalized prefix / token-overlap ≥ 0.8) so contributors see "almost identical question exists" *before* submitting.
3. Normalization: lowercase, strip punctuation/?s, collapse whitespace, trim — kills trivial variants ("How many dogs?" vs "how many dogs").

## 4. Gating (the "not openly" requirement)

| Option | Effort | Identity | Recommendation |
|---|---|---|---|
| **Cloudflare Access** on `/contribute/*` + `/api/questions/*` | S | real email via OTP, free ≤50 users | **target state** — zero code for auth; Worker verifies the `Cf-Access-Jwt-Assertion` header (1 small JWT check with the team's cert) |
| Shared access code (relay's existing `ACCESS_CODE` pattern) | XS | none (shared secret) | **v1 stopgap** if Access setup is unwanted that day — same pattern /ask already supports |

Either way the API is closed by default: no valid gate → 401. Spam/abuse surface ≈ zero.

## 5. The `/contribute` UX (works "with the dataset on the web")

- **Work queue**: default view = images with the fewest approved questions ("needs 5"), pulling from `latest.json` (client) + question counts (API). Contributors don't hunt for images; the queue feeds them.
- **Authoring form** per image: question, category (taxonomy chips), answer type, answer, choices (if choice), difficulty. Live dupe warning as they type (debounced `check` call).
- **Group mode**: create a named group, multi-select images (reuses gallery selection patterns), then author per-image questions within the group context.
- **Progress dashboard**: per-contributor count, per-image fill level, and a **category × contributor coverage matrix** — this *is* RECOMMENDATIONS #1 (task taxonomy) finally materialized: thin categories are visible instantly.
- Everything reads the same `latest.json` the rest of the site uses — thumbnails via the existing Google CDN pattern, no image bytes stored by us.

## 6. Export format (VQA-compatible JSONL)

One line per question — a superset of VQA v2's `questions`+`annotations` pair so standard loaders work:

```json
{"question_id": 1, "image_id": "<drive-file-id>", "question": "...", "category": "counting", "answer_type": "number", "answer": "3", "choices": null, "difficulty": "medium", "contributor": "email", "created_at": "2026-08-25T12:00:00Z"}
```

Publish flow v1: an authenticated `GET /api/questions/export.jsonl` streams all approved rows; the hourly bot (or `workflow_dispatch`) commits it to `data/questions.jsonl`. Later: CI-side validation (schema check + dedupe re-check + image-id referential check against `latest.json`) before the commit lands.

## 7. Phasing

| Phase | Scope | Effort |
|---|---|---|
| **Q1** | D1 schema + Worker CRUD API (add/check/count/export) + access-code gate + `/contribute` route (queue → form → live dupe check → persist) | 1 session |
| **Q2** | Cloudflare Access email-OTP gate (replaces shared code) + group tables + group mode | ½ session |
| **Q3** | Coverage matrix page + export-to-repo automation (bot commits `data/questions.jsonl`) | ½–1 session |
| **Q4** | Review flow (pending→approved), edit history, eval-harness loader | later |

## 8. Decisions requested from the owner

1. Gate choice for v1: shared access code now + Access later (recommended), or Access from day one?
2. Contributor identity: Access email (recommended) vs free-typed name?
3. Review flow needed immediately, or trust contributors at this stage (recommended: trust now, `status` column already reserves the flow)?
4. Answer required at submission, or allowed empty at draft? (recommended: required for `number`/`choice`, optional for `text`)
