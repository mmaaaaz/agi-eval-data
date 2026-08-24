# QUESTIONS PLAN v2 — Drive-as-filesystem + benchmark question authoring

_Request evolution (2026-08-25): instead of building a taxonomy tree editor, use **Drive folders themselves** as the organization — the website becomes a remote control for Drive, and the 10-min scan is the 2-way sync. Questions + ground truth attach to images; organization lives where the files already live._

---

## 1. Core model: Drive is the single source of truth

```
                 ┌──────────────────────────────────────────────┐
                 │  GOOGLE DRIVE  (the file system + taxonomy)  │
                 │  dataset/                                    │
                 │   ├─ geometric/2d/symmetry/   ← real folders │
                 │   ├─ spatial/occlusion/                      │
                 │   └─ counting/clutter/                       │
                 └──────────┬───────────────────────┬───────────┘
        web moves (owner's  │                       │  Drive-native
        browser, OAuth)     │                       │  reorganization
                            ▼                       ▼  (both directions work)
                 ┌──────────────────────────────────────────────┐
                 │  10-min scan → artifact v4                   │
                 │  files rows gain folder id + folders[] tree  │
                 └────────────────────┬─────────────────────────┘
                                      ▼
        site renders organization everywhere (gallery folder filter,
        coverage by folder) — no shadow copies, no sync conflicts
                                      ▼
        /contribute: questions + ground truth → D1 (dedupe enforced)
                                      ▼
        export → data/questions.jsonl committed to the repo
```

**Why there is no "2-way sync problem"**: the website never keeps its own copy of the organization. Every move on the web is a *real Drive operation* performed with the user's own Google token. Every Drive-native reorganization shows up in the next scan. Drive is the truth; the site is a client; the artifact is the read model. Conflicts are structurally impossible.

**Why the tree editor dies**: folders ARE the tree. Creating a category = creating a folder. Moving images between categories = Drive moves. Renaming = folder rename (1 call). Everyone already understands folders; Drive's own UI can also be used side-by-side.

## 2. The one real tradeoff (stated honestly)

With a DB tree, re-classifying 500 images = one UPDATE. With folders, it = 500 Drive calls. **Measured against our reality**: moves batch 100 per round-trip, quota is 12,000 queries/min — reorganizing the entire 45k-image dataset costs ~4 minutes of quota and a few minutes of wall time, then ≤10 min to appear on the site. Taxonomy evolution is slower but perfectly feasible at this scale. If the taxonomy ever starts churning daily at scale, we revisit — that's a good problem.

Secondary tradeoff: Drive folders are single-parent (a file in one folder). Drive technically supports multi-parent; keep single-parent v1 for sanity.

## 3. Feasibility (verified against Google's docs)

| Mechanism | Status |
|---|---|
| Move = `files.update(fileId, {addParents: [new], removeParents: [old]})` | ✅ official v3 pattern |
| Folder create = `files.create({name, mimeType: folder})` | ✅ trivial |
| Scope | `drive.metadata` ("view and manage metadata") covers parent changes + folder create — no content access, downloads still impossible |
| Browser-direct calls | ✅ Google Identity Services `tokenClient` issues an access token in the browser; Drive REST is CORS-open for OAuth bearer tokens (official JS quickstart works exactly this way) |
| Scanner capture | `files.list` already returns `parents[]` — add to FIELDS + one folder-listing pass; artifact bumps to **v4** (`folders: [[id, name, parentId]]`, files rows gain folder id) |
| Batch | 100 ops per batch request; progress bar in UI; client-side undo log (previous parent kept in memory for the session) |

**Security posture change, stated plainly**: today everything is read-only (`drive.metadata.readonly`). The organize feature introduces **write-capable metadata tokens — but only in the owner's own browser, for the owner's own files, short-lived (~1 h), never stored on any server**. The CI secrets stay read-only forever (a leaked CI secret still can't modify Drive). The UI never exposes delete; Drive trash is recoverable for 30 days regardless. Operations run as the owner's Google account → Drive's own audit log applies.

## 4. Architecture

- **Artifact v4** (scanner change): folder tree + per-file folder id. Everything downstream (gallery folder filter, coverage by folder, contribute picker) reads it from `latest.json` — zero denormalization, zero D1 folder state.
- **/organize** (owner-only via Access): tree browser → "Unsorted" inbox view (files not yet in a taxonomy folder) → multi-select → move (batched, progress, undo) → create folder/rename. Runs via the owner's Google token in-browser.
- **/contribute** (Access-gated, all contributors): work queue → image → question form. Category = the image's **current folder path**, picked from the artifact (cascading picker over the folder tree, read-only). Deep nesting = nested folders.
- **D1** stores questions + ground truth + groups ONLY:

```sql
CREATE TABLE questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     TEXT NOT NULL,
  contributor TEXT NOT NULL,             -- Access email
  question    TEXT NOT NULL,
  qnorm       TEXT NOT NULL,             -- lowercase, punct-stripped, ws-collapsed
  answer_type TEXT NOT NULL DEFAULT 'text',   -- text | number | choice | yesno
  answer      TEXT,                      -- ground truth
  choices     TEXT,                      -- JSON array (choice type)
  difficulty  TEXT CHECK (difficulty IN ('easy','medium','hard')) DEFAULT 'medium',
  status      TEXT NOT NULL DEFAULT 'approved', -- approved | draft (unanswered text) | rejected
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(file_id, qnorm)
);
CREATE INDEX idx_questions_file ON questions(file_id);
CREATE INDEX idx_questions_contrib ON questions(contributor);

CREATE TABLE image_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE image_group_members (
  group_id INTEGER NOT NULL REFERENCES image_groups(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  PRIMARY KEY (group_id, file_id)
);
```

Note what's gone vs v1: **no categories table, no tree editor** — folder path comes from the artifact at render/export time. Coverage matrix = folder × contributor, aggregatable at any depth via path prefix.

- **Dedupe (3 layers, unchanged)**: `UNIQUE(file_id, qnorm)` hard constraint → live near-match check while typing → normalization.
- **Export**: `data/questions.jsonl`, VQA-v2-superset lines, now with the image's folder path stamped at export time:

```json
{"question_id": 1, "image_id": "<drive-id>", "question": "...", "answer": "3", "answer_type": "number", "folder": "geometric/2d/symmetry", "difficulty": "medium", "contributor": "email", "created_at": "..."}
```

- **Gating**: Access email-OTP, 30-day sessions; **owner-only for /organize**, contributors for /contribute (Access groups: `owners` vs `contributors`). Contributor emails auto-sync from Drive owners (scan → Access API merge, idempotent).

## 5. UX walkthrough

**Owner (organize)**: open /organize → Access check (once/30 days) → Google consent popup (once, drive.metadata) → see the folder tree + "Unsorted (1,204)" inbox → select 40 images → drag to `geometric/2d/symmetry` → progress bar → done; site reflects it within ≤10 min. Mistake? Undo button (session log) or fix in Drive directly.

**Contributor (author)**: open /contribute → Access check → queue shows images with <5 questions, filtered to any folder they choose → pick image → write question → cascading folder path is shown (read-only context) → choose answer type → type ground truth → live "nearly identical exists" check → submit → saved to D1 instantly.

**Everyone**: /contribute dashboard — per-image fill levels, per-contributor totals, folder × contributor coverage matrix.

## 6. Phasing

| Phase | Scope | Effort |
|---|---|---|
| **Q1** | Scanner v4 (folders + per-file folder) + artifact bump + D1 schema + questions API (add/check/count/export) + Access gate (shared-code stopgap optional) + /contribute (queue → form → dupe check → persist) | 1–1.5 sessions |
| **Q2** | /organize: GIS browser token, tree browser, create folder, batched moves + undo (owner-only) | 1 session |
| **Q3** | Coverage matrix (folder × contributor) + export automation (bot commits `data/questions.jsonl`) | ½–1 session |
| **Q4** | Multi-parent folders, curator role for organizers, review flow, eval-harness loader | later |

## 7. Decisions — answered + one new

1. ~~Gate~~ → Access from day one, 30-day sessions. ✅
2. ~~Identity~~ → Access email, auto-synced from Drive owners. ✅
3. ~~Taxonomy~~ → **Drive folders** (this doc). ✅
4. ~~Answers~~ → required for number/yesno/choice; text may go to `draft` ("needs answers" queue); only answered rows export. ✅
5. **NEW — who organizes?** Recommendation: **owner-only** for /organize v1 (your Google token, your Drive, zero permission changes). Contributors keep uploading exactly as today. Opening organize to trusted curators later = share the folders + add them to an Access `curators` group.
6. **NEW — scope**: `drive.metadata` (metadata read-write, no content access). If any call turns out to need more, fallback is full `drive` scope on the same consent screen — decide at build time, start least-privilege.
