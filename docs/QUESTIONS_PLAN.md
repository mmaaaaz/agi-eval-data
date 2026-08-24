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
   → committed by the sync bot (every 10 min) or a workflow_dispatch job → data/questions.jsonl in-repo
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
CREATE TABLE categories (            -- deeply nested taxonomy tree (owner-curated)
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  path      TEXT NOT NULL,           -- materialized path 'geometry/2d/symmetry' for display
  created_by TEXT,
  UNIQUE(parent_id, name)
);
CREATE INDEX idx_categories_parent ON categories(parent_id);

CREATE TABLE questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     TEXT NOT NULL,             -- Drive file id (joins to data/latest.json)
  contributor TEXT NOT NULL,             -- email (from Access)
  question    TEXT NOT NULL,
  qnorm       TEXT NOT NULL,             -- normalized: lowercase, trimmed, collapsed ws, strip ?/punct
  category_id INTEGER REFERENCES categories(id),
  answer_type TEXT NOT NULL DEFAULT 'text',   -- text | number | choice | yesno
  answer      TEXT,                      -- ground truth
  choices     TEXT,                      -- JSON array for choice type
  difficulty  TEXT CHECK (difficulty IN ('easy','medium','hard')) DEFAULT 'medium',
  status      TEXT NOT NULL DEFAULT 'approved', -- approved | draft (unanswered text) | rejected
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(file_id, qnorm)
);
CREATE INDEX idx_questions_file ON questions(file_id);
CREATE INDEX idx_questions_contrib ON questions(contributor);
CREATE INDEX idx_questions_cat ON questions(category_id);

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
- **Authoring form** per image: question, **cascading category picker** (top-level → sub → sub-sub, from the taxonomy tree; owner can add custom nodes anywhere in the tree), answer type, answer, choices (if choice), difficulty. Live dupe warning as they type (debounced `check` call).
- **Taxonomy management**: an owner-only tree editor — create/rename/move category nodes to any depth (the dataset's 3–4 top categories with deep nesting). Questions always attach to a leaf; the coverage matrix can aggregate at ANY depth via the materialized `path`.
- **Group mode**: create a named group, multi-select images (reuses gallery selection patterns), then author per-image questions within the group context.
- **Progress dashboard**: per-contributor count, per-image fill level, and a **category × contributor coverage matrix** — this *is* RECOMMENDATIONS #1 (task taxonomy) finally materialized: thin categories are visible instantly.
- Everything reads the same `latest.json` the rest of the site uses — thumbnails via the existing Google CDN pattern, no image bytes stored by us.

## 6. Export format (VQA-compatible JSONL)

One line per question — a superset of VQA v2's `questions`+`annotations` pair so standard loaders work:

```json
{"question_id": 1, "image_id": "<drive-file-id>", "question": "...", "category": "counting", "answer_type": "number", "answer": "3", "choices": null, "difficulty": "medium", "contributor": "email", "created_at": "2026-08-25T12:00:00Z"}
```

Publish flow v1: an authenticated `GET /api/questions/export.jsonl` streams all approved rows; the sync bot (every 10 min, or `workflow_dispatch`) commits it to `data/questions.jsonl`. Later: CI-side validation (schema check + dedupe re-check + image-id referential check against `latest.json`) before the commit lands.

## 7. Phasing

| Phase | Scope | Effort |
|---|---|---|
| **Q1** | D1 schema + Worker CRUD API (add/check/count/export) + access-code gate + `/contribute` route (queue → form → live dupe check → persist) | 1 session |
| **Q2** | Cloudflare Access email-OTP gate (replaces shared code) + group tables + group mode | ½ session |
| **Q3** | Coverage matrix page + export-to-repo automation (bot commits `data/questions.jsonl`) | ½–1 session |
| **Q4** | Review flow (pending→approved), edit history, eval-harness loader | later |
## 8. Decisions (resolved 2026-08-25)

1. **Gate**: Cloudflare Access from day one. Session = 30 days (industry standard for a low-risk internal tool — contributors stay logged in across weeks; logout via the Access logout URL). Configurable per app in the Zero Trust dashboard.
2. **Contributor identity = Access email, auto-synced from Drive**: the hourly scan already extracts owner emails from Drive. A new `scripts/access_sync.py` CI step (after `drive_scan.py`) upserts any NEW owner emails into the Access application's allow-list via the Cloudflare API — a contributor who adds images is automatically allowed into `/contribute`. Requires 3 secrets: `CF_API_TOKEN` (Access:Edit), `CF_ACCOUNT_ID`, `CF_ACCESS_APP_ID`. Idempotent merge (never removes existing entries).
3. **Taxonomy**: deeply nested tree (3–4 top categories, arbitrary depth), owner-curated via a tree editor; questions attach to leaves; `path` column enables coverage aggregation at any depth. Custom nodes allowed anywhere.
4. **Answers at submit — explained plainly**: every benchmark question needs a ground-truth answer to be evaluable. Rule: for **number / yes-no / choice** questions the answer is known at authoring time → **required**. For open **text** questions a contributor may submit without an answer → the question is stored as `status='draft'` and appears in a "needs answers" queue; **only answered questions are exported**, so the published dataset never contains a question without ground truth.

## 9. Sync cadence side-note (2026-08-25)

The data sync cron moved from hourly to **every 10 minutes** (`*/10 * * * *`). Feasibility check: public repo ⇒ unlimited Actions minutes; Drive read quota is trivial at this cadence; the existing change-detection step commits **only when content actually changed**, so empty runs add zero commits. Commit-history growth stays proportional to real upload activity (git delta-compresses the append-mostly JSON well); if repo size ever bothers anyone, the documented monthly orphan-branch squash is the release valve. Effective site freshness floors at ~10–15 min because raw.githubusercontent's CDN TTL is ~5 min.
