# LIVE DEPLOYMENT PLAN — agi-eval-data
### Immutable shell (Cloudflare Pages, deployed once) · volatile data (public GitHub, fetched at runtime)
_Vite · React 19 · TanStack Router · Tailwind v4 · Geist. Minimal Vercel flavor._
> **STATUS (2026-08-25):** Deployed and running. One deviation from "Infra unused" below: `/ask` now uses a Cloudflare Worker relay (`agi-eval-relay`) holding a pooled Vercel AI Gateway key. Everything else holds. Live state: `HANDOFF.md`.

---

## 0. LOCKED DECISIONS

| Question | Decision |
|---|---|
| Architecture | **Deploy-once static shell + runtime JSON fetch** — no data-driven redeploys, ever |
| Data host | `raw.githubusercontent.com/{owner}/agi-eval-data/main/data/latest.json` (public repo, CORS ✅, gzip ✅); fallback `cdn.jsdelivr.net/gh/…@main`; final fallback: styled error + retry |
| Sync trigger | GitHub Actions cron **`0 * * * *` (hourly)** + `workflow_dispatch` |
| Cadence rationale | public repo ⇒ unlimited Actions minutes ⇒ quota no longer constrains; hourly matches measured upload rhythm; sub-hourly rejected (GitHub scheduler drift would make countdown dishonest) |
| Site deploy | `wrangler pages deploy dist --project-name agi-eval-data` — run manually only when UI changes (~few×/month max) |
| Repo visibility | **PUBLIC** — real contributor names included (accepted) |
| Thumbnails | Direct Google CDN hotlink `lh3.googleusercontent.com/d/{id}=w400` / `=w1600`; requires link-shared files (automated delta in CI + one-time bootstrap) |
| Credentials | GitHub Actions Secrets only; `.gitignore`: token.json, client_secret.json; OAuth app published to Production |
| Infra unused | Workers, R2, Access, Pages functions — zero |
| Name | **agi-eval-data** → repo + `agi-eval-data.pages.dev` |

---

## 1. Free-tier budget audit

| Resource | Free limit | Usage | Verdict |
|---|---|---|---|
| GitHub Actions (public) | **unlimited min** | 24 runs/day × ~2–3 min | ✅ |
| Google Drive API | 12k q/min | listing + delta share pass | ✅ |
| CF Pages deployments | 500/mo | ~2–5/mo (UI-only changes) | ✅ ~99% headroom |
| raw.githubusercontent serving | generous Fastly-backed | team traffic | ✅ |
| Workers / R2 / Access | — | not used | ✅ |

---

## 2. Architecture

```
┌──────────────── GitHub PUBLIC repo: agi-eval-data ────────────────┐
│                                                                    │
│   ⏰ cron 0 * * * *                      manual pushes anytime    │
│        │                                  │                        │
│        ▼                                  ▼                        │
│   Actions runner (secrets injected as env):                       │
│     1. drive_scan.py --ci  → data/latest.json                     │
│     2. share_sync.py       → shared=false images:                 │
│          permissions.create(anyone:reader), delta only            │
│     3. commit + push main                                         │
│                                                                   │
└──────────────┬────────────────────────────────────────────────────┘
               │
               ▼
   raw.githubusercontent.com/…/data/latest.json      (volatile data)
               ▲                    ▲
               │ fetch @load        │ fallback
   ┌───────────┴────────────────────┴─────────────┐
   │  CF Pages: agi-eval-data.pages.dev           │
   │  immutable shell — deployed ONCE via wrangler│
   │  no functions · no workers · no rebuilds     │
   └──────────────────────────────────────────────┘

Browser <img>: lh3.googleusercontent.com/d/{id}=w400|w1600 (Google's edge)
```

Separation of concerns: **shell changes rarely & deliberately; data changes hourly & automatically.** Neither touches the other.

---

## 3. Runtime data layer (new — core of the design)

Load sequence:
1. Check `Cache Storage` (`agi-eval-data-v1`) → cached `latest.json`? → **paint instantly** (stale-while-revalidate), show "updated Xm ago" pill
2. Background fetch fresh copy (stream reader → determinate progress)
3. On newer `meta.scannedAt`: swap data, animate counts, update pill; else keep silent
4. First visit (no cache): full-screen loader — wordmark shimmer + thin progress bar (% from stream bytes) → crossfade to app
5. Fetch failure: try jsDelivr fallback → styled error card + retry button (with cached data shown if any)

Constants shipped in `meta`: `cron: "0 * * * *"`, so the nav chip computes **next sync top-of-hour in visitor tz**; STALE pill past 90 min.

URL: filters/state in search params (Zod-validated) — shareable views.

---

## 4. Data pipeline

```
scripts/drive_scan.py     # --ci headless refresh-token auth
scripts/share_sync.py     # delta link-sharing (files.list 'shared' flag)
data/latest.json          # overwritten hourly; single source of truth
.github/workflows/sync.yml
web/                      # the app
```

`latest.json` v2 contract: `{version, meta:{scannedAt,cron,counts{all,imagesRaw,imagesUnique,dupCopies,videos,bytes}}, files:[[name,ext,size,day,ownerEmail,md5,kind]…], owners:{email:displayName}, dupGroups[…]}` — array-packed (<~1 MB gzipped).

Bootstrap (one-time, workflow_dispatch): bulk-share existing images (~21 k calls, ~35 min, resumable checkpoint committed).

Failure alerting: failed run → auto-issue `sync-failed`; site STALE pill independent second alarm. Bot commits daily ⇒ 60-day workflow auto-disable never triggers.

Git growth: single overwritten JSON ≈ tens of MB/year — acceptable; quarterly orphan-branch squash documented if ever needed.

---

## 5. Thumbnails — direct Google CDN (unchanged)

- Images link-shared `anyone-with-link → reader` (unguessable 33-char IDs gate access)
- Grid `…/d/{id}=w400`, lightbox `=w1600`; videos excluded (film-icon tile)
- Any load failure → neutral placeholder; layout never breaks

---

## 6. App architecture

Vite · React 19 · TanStack Router (file routes, Zod search params) · Tailwind v4 · @tanstack/react-virtual · Geist Sans/Mono self-hosted.

Routes
```
/                       01 Overview — hero unique count, hairline stat rows, 28-day sparkline, recent strip
/gallery                02 — virtualized grid, sticky filters, lightbox (=w1600)
/contributors           03 — ranked hairline table
/contributors/$email    ↳ stats, day-wise bars, personal gallery
/duplicates             04 — groups by wasted bytes, expandable copies, jump-to-gallery
/project                05 — AGI visual+geometric reasoning benchmark writeup placeholder
*                       404
```

Design tokens: bg `#000` · panel `#0a0a0a` · border `#262626/#404040 hover` · fg `#ededed` · muted `#a1a1a1/#666` · accent `#0070f3` sparing · danger `#ee0000` · Geist Mono uppercase micro-labels · tabular numerals · numbered eyebrows (`01 — OVERVIEW`) · 150 ms ease-out hovers. Loader: wordmark shimmer + determinate stream-progress bar. No decorative gradients/glassmorphism/emoji.

Correctness checklist
- [ ] SWR cache behind feature-detect (`caches` in window); graceful no-cache fallback
- [ ] Zod validation on all search params; invalid → defaults
- [ ] Virtualizer survives resize/filter churn without scroll jumps
- [ ] ThumbImage: shimmer → fade → placeholder
- [ ] Lightbox keyboard ←/→/Esc + focus trap + aria labels
- [ ] Empty states for every filter combo; `?`-day rows only under "all time"
- [ ] Route-level code splitting; countdown post-mount, resync on visibilitychange

---

## 7. Deployment runbook

1. Local: publish OAuth consent → Production
2. Create public repo `agi-eval-data`; push scaffold
3. GH Secrets: `DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN`
4. Dispatch `bootstrap` → bulk-share completes (~35 min, checkpoint-resumable)
5. Local: `wrangler whoami` (= devmaaaaz@gmail.com) → `pnpm build && wrangler pages deploy dist --project-name agi-eval-data`
6. Smoke tests: hourly cron lands on time; site picks up new `scannedAt` within ≤10 min (raw CDN TTL ~5 min); thumbs render; dupes page matches CSV; countdown honest
7. README badge → hands-off. Future UI edits: local change → `wrangler pages deploy` again (deliberate, rare)

---

## 8. Risks

| Risk | L | Mitigation |
|---|---|---|
| Refresh-token expiry | eliminated | Production status |
| raw.githubusercontent outage/blip | low | jsDelivr fallback → cached data → error card with retry |
| lh3 throttle/change | low-med | placeholder tiles; stats unaffected regardless |
| GH cron drift | occasional | "~next sync" labeling; hourly granularity keeps promise honest |
| Benchmark contamination (IDs public) | accepted | team accepted publicity; originals still gated by unguessable IDs + partial-res thumbs only |
| Git history growth | low | tens of MB/year; squash path documented |
