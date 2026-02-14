$ErrorActionPreference = "Stop"

# ── Load config from deploy.env ──────────────────────────────────────────────────
$configPath = Join-Path $PSScriptRoot "deploy.env"
if (-not (Test-Path $configPath)) {
    Write-Host "Missing scripts/deploy.env — copy deploy.env.example and fill in your values." -ForegroundColor Red
    exit 1
}

$config = @{}
Get-Content $configPath | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        $config[$Matches[1].Trim()] = $Matches[2].Trim()
    }
}

$ServerHost = $config["DEPLOY_HOST"]
$Port       = $config["DEPLOY_PORT"]
$AppDir     = $config["DEPLOY_APP_DIR"]

if (-not $ServerHost -or -not $Port -or -not $AppDir) {
    Write-Host "deploy.env is incomplete — need DEPLOY_HOST, DEPLOY_PORT, DEPLOY_APP_DIR." -ForegroundColor Red
    exit 1
}

function Fail($Message) {
    Write-Host $Message -ForegroundColor Red
    exit 1
}

# 1. Ensure current branch has an upstream
git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
if ($LASTEXITCODE -ne 0) {
    Fail "Error: current branch has no upstream. Set one with: git push -u origin <branch>"
}

# 2. Ensure local branch is fully pushed
git diff --quiet HEAD '@{u}'
if ($LASTEXITCODE -ne 0) {
    Fail "Error: local branch differs from upstream. Commit and push before deploying."
}

Write-Host "[local] Branch is up to date with upstream. Starting remote deploy..." -ForegroundColor Cyan

# 3. Run deploy script on server
$remoteCommand = "cd '$AppDir' && ./scripts/deploy.sh"

ssh $ServerHost -p $Port $remoteCommand
if ($LASTEXITCODE -ne 0) {
    Fail "Error: remote deploy script failed."
}

Write-Host "[local] Remote deploy completed successfully." -ForegroundColor Green
