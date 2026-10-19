#!/usr/bin/env bash
# Deploy the site WITH the review-room snapshot.
#
# WHY THIS IS NOT IN CI: the snapshot (apps/web/public/vqa) is ~80 MB of static
# JSON generated from the private draft and gitignored on purpose. A CI checkout
# cannot build it, and a CI deploy that omits it does not fail — Pages serves the
# SPA fallback for every /vqa/* path, so the review room loads and then has no
# data, while the workflow reports success. That happened once; this script is
# the one path that can deploy safely.
#
#   bash scripts/harness/deploy_site.sh [--skip-export] [--batch full-50k]
#
# It exports, builds, REFUSES to deploy if the snapshot is missing from the
# build, deploys, and then verifies the live deployment returns JSON rather than
# the fallback shell. A verification failure exits non-zero.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

BATCH="full-50k"
SKIP_EXPORT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-export) SKIP_EXPORT=1; shift ;;
    --batch) BATCH="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

PY="${PYTHON:-python}"

if [ "$SKIP_EXPORT" -eq 0 ]; then
  echo "== export snapshot ($BATCH)"
  env -u PYTHONPATH "$PY" -m scripts.harness.export_vqa_static --batch "$BATCH"
fi

echo "== build"
(cd apps/web && bun run build)

DIST="$ROOT/apps/web/dist"
if [ ! -s "$DIST/vqa/index.json" ]; then
  echo "REFUSING: $DIST/vqa/index.json is missing or empty." >&2
  echo "A deploy without it publishes a review room with no data." >&2
  exit 1
fi

echo "== deploy"
(cd apps/web && npx wrangler pages deploy dist --project-name agi-eval-data --branch main --commit-dirty=true)

# The verification that would have caught the silent CI deploy: the live path
# must return JSON. When the edge range is unreachable, set VQA_PAGES_IP to a
# Cloudflare edge IP and the check resolves the host to it.
HOST="agi-eval-data.pages.dev"
IP="${VQA_PAGES_IP:-}"
CURL=(curl -sS -m 30)
if [ -n "$IP" ]; then CURL+=(--resolve "$HOST:443:$IP"); fi

echo "== verify"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT
"${CURL[@]}" "https://$HOST/vqa/index.json" -o "$BODY" -w 'http %{http_code}\n'
"$PY" - "$BODY" <<'PYEOF'
import json, sys
p = sys.argv[1]
raw = open(p, "rb").read()
try:
    data = json.loads(raw)
except Exception:
    sys.exit("FAILED: /vqa/index.json is not JSON — Pages is serving the SPA fallback, "
             "which means this deployment has no snapshot.")
for key in ("images", "candidates", "pages"):
    if key not in data:
        sys.exit("FAILED: snapshot index has no " + key)
print(f"ok: {data['images']} images, {data['candidates']} candidates, {len(data['pages'])} pages")
PYEOF
