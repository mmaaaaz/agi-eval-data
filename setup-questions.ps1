# One-time setup for the questions/evaluation platform.
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File setup-questions.ps1
# Step 0 re-authenticates wrangler (browser opens — click Allow).

$ErrorActionPreference = "Stop"
Set-Location apps\relay

Write-Host "== 0/6 wrangler login (browser opens — click Allow) ==" -ForegroundColor Cyan
npx wrangler login
npx whoami 2>$null

Write-Host "== 1/6 creating D1 database ==" -ForegroundColor Cyan
$existing = npx wrangler d1 list 2>$null | Select-String "agi-eval-questions"
if ($existing) {
    Write-Host "database already exists — reusing it"
    $id = ([regex]::Match(($existing.Line ?? $existing.ToString()), "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")).Value
} else {
    $out = npx wrangler d1 create agi-eval-questions 2>&1 | Out-String
    $id = ([regex]::Match($out, "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")).Value
}
if (-not $id) { throw "could not determine database_id" }
Write-Host "database_id: $id"

$toml = Get-Content wrangler.toml -Raw
if ($toml -match "LOCAL-DEV-PENDING") {
    $toml = $toml -replace "LOCAL-DEV-PENDING", $id
    Set-Content wrangler.toml $toml -NoNewline
    Write-Host "wrangler.toml updated with database_id"
}

Write-Host "== 2/6 applying schema (remote) ==" -ForegroundColor Cyan
npx wrangler d1 execute agi-eval-questions --remote --file schema.sql

Write-Host "== 3/6 questions API access code ==" -ForegroundColor Cyan
$code = Read-Host "choose an access code for the questions API (contributors will paste this into settings)"
if (-not $code) { throw "code required" }
$code | npx wrangler secret put QUESTIONS_CODE

Write-Host "== 4/6 deploying relay ==" -ForegroundColor Cyan
npx wrangler deploy

Write-Host "== 5/6 building + deploying the site ==" -ForegroundColor Cyan
Set-Location ..\apps\web
npx wrangler pages deploy dist --project-name agi-eval-data --branch main --commit-dirty=true

Write-Host ""
Write-Host "== 6/6 DONE ==" -ForegroundColor Green
Write-Host "Open https://agi-eval-data.pages.dev/ask -> settings -> put your relay URL (default is fine)"
Write-Host "and paste the access code you chose into the 'access code' field."
Write-Host "Then open /contribute and /evaluate. Your code: $code"
