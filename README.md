# agi-eval-data

Live dataset ledger for an AGI benchmark on **visual & geometric reasoning** — real-world images where vision-language models fail, plus complex geometrical shape problems.

**Architecture:** immutable shell (deployed once) · volatile data (hourly bot commits) — the site never rebuilds for data changes.

```
GitHub Actions (hourly cron, secrets injected)
  ├─ scripts/drive_scan.py --ci   → metadata-only Drive scan → data/latest.json
  ├─ scripts/share_sync.py        → delta link-sharing for new images (thumbnail access)
  └─ commit & push

Cloudflare Pages  ←  deployed ONCE via wrangler (UI changes only)
  └─ fetches raw.githubusercontent.com/…/data/latest.json at load (jsDelivr fallback)

Thumbnails: lh3.googleusercontent.com/d/{fileId}=w400|w1600  (Google's CDN, zero infra on our side)
```

## Layout

```
scripts/          scanner + share-sync (Python, Drive API metadata scope only)
data/latest.json  THE artifact — overwritten hourly by the bot (v2 schema)
web/              Vite · React 19 · TanStack Router · Tailwind v4 dashboard
docs/             full deployment plan & decision log
```

## Commands

```bash
# web
cd web && bun install && bun run dev       # local dev
bun run build                              # production build → dist/
wrangler pages deploy dist --project-name agi-eval-data   # shell deploy (rare)

# data (local interactive scan w/ browser auth)
python scripts/drive_scan.py               # snapshot + report tools

# CI artifact offline from a previous snapshot
python scripts/drive_scan.py --ci --from-snapshot snapshots/snapshot_X.json
```

## Secrets (GitHub Actions → Settings → Secrets)

`DRIVE_CLIENT_ID` · `DRIVE_CLIENT_SECRET` · `DRIVE_REFRESH_TOKEN`

Never committed — enforced via `.gitignore`. OAuth consent screen must stay **In Production** (Testing-mode refresh tokens expire weekly).

---

*Metadata only — file contents are never downloaded or stored in this repo.*
