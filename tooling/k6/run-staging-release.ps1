[CmdletBinding()]
param(
  [string]$DatabaseSchema = "",
  [string]$K6Executable = "",
  [switch]$SkipMigrate
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not $DatabaseSchema) {
  $DatabaseSchema = "staging_release_gate_k6_$(Get-Date -Format 'yyyyMMddHHmmss')"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$evidenceRoot = Join-Path $repoRoot "test-results/staging-release/k6"
$runtimeRoot = Join-Path $PSScriptRoot "runtime"
$fixtureFile = Join-Path $repoRoot ".e2e-live/k6-fixture.json"
$k6 = if ($K6Executable) {
  (Resolve-Path -LiteralPath $K6Executable).Path
} else {
  Join-Path $runtimeRoot "k6-v2.4.0-windows-amd64/k6.exe"
}
$tsxCli = Join-Path $repoRoot "node_modules/tsx/dist/cli.mjs"
$apiStdout = Join-Path $evidenceRoot "api.stdout.log"
$apiStderr = Join-Path $evidenceRoot "api.stderr.log"
$smokeLog = Join-Path $evidenceRoot "staging-smoke.log"
$securityLog = Join-Path $evidenceRoot "staging-security.log"
$smokeSummary = Join-Path $evidenceRoot "staging-smoke-summary.json"
$securitySummary = Join-Path $evidenceRoot "staging-security-summary.json"

if (-not (Test-Path -LiteralPath $k6)) {
  throw "k6 executable not found at $k6. Download the official Windows binary first."
}
if (-not (Test-Path -LiteralPath $tsxCli)) {
  throw "tsx CLI not found at $tsxCli. Run pnpm install first."
}

New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $fixtureFile) | Out-Null
Remove-Item -LiteralPath $smokeSummary, $securitySummary -Force -ErrorAction SilentlyContinue

$databaseUrl = "postgresql://roamlog:roamlog@localhost:55432/roamlog?schema=$DatabaseSchema"
$authSecret = "roamlog-staging-release-gate-k6-secret-at-least-32-bytes"
$apiUrl = "http://127.0.0.1:4100"
$webUrl = "http://127.0.0.1:3100"
$adminUrl = "http://127.0.0.1:3101"
$redisPrefix = "roamlog-staging-release-k6"
$sharePassword = "Roamlog-K6-Share-Aa1!"
$apiProcess = $null
$failures = @()

function Run-Pnpm {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  & pnpm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Invoke-JsonPost {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)]$Body,
    [Parameter(Mandatory = $true)][string]$Cookie,
    [Parameter(Mandatory = $true)][string]$Origin
  )
  return Invoke-RestMethod `
    -Uri $Uri `
    -Method Post `
    -Headers @{ cookie = $Cookie; origin = $Origin } `
    -ContentType "application/json" `
    -Body ($Body | ConvertTo-Json -Depth 10) `
    -TimeoutSec 60
}

try {
  if (Get-NetTCPConnection -State Listen -LocalPort 4100 -ErrorAction SilentlyContinue) {
    throw "Port 4100 is already in use; refusing to replace an existing API process."
  }

  $env:DATABASE_URL = $databaseUrl
  $env:ROAMLOG_LIVE_DATABASE_URL = $databaseUrl
  $env:ROAMLOG_LIVE_AUTH_SECRET = $authSecret
  $env:ROAMLOG_LIVE_FIXTURE_FILE = $fixtureFile
  $env:NODE_ENV = "test"
  $env:LOG_LEVEL = "warn"
  $env:API_PORT = "4100"
  $env:API_URL = $apiUrl
  $env:APP_URL = $webUrl
  $env:ADMIN_URL = $adminUrl
  $env:CORS_ORIGINS = "$webUrl,$adminUrl"
  $env:REDIS_URL = "redis://127.0.0.1:6379"
  $env:REDIS_PREFIX = $redisPrefix
  $env:BETTER_AUTH_SECRET = $authSecret
  $env:BETTER_AUTH_URL = $apiUrl
  $env:ADMIN_2FA_ENFORCED = "true"
  $env:TRUST_PROXY = "true"
  $env:S3_ENDPOINT = "http://127.0.0.1:9000"
  $env:S3_BUCKET = "roamlog-test"
  $env:S3_ACCESS_KEY = "roamlog"
  $env:S3_SECRET_KEY = "roamlog-local-secret"
  $env:S3_REGION = "us-east-1"
  $env:S3_FORCE_PATH_STYLE = "true"
  $env:SMTP_HOST = "127.0.0.1"
  $env:SMTP_PORT = "1025"
  $env:EMAIL_FROM = "Roamlog <staging-release-k6@roamlog.test>"
  $env:NEXT_TELEMETRY_DISABLED = "1"

  if (-not $SkipMigrate) {
    Run-Pnpm @("--filter", "@roamlog/db", "exec", "prisma", "migrate", "deploy")
  }
  Run-Pnpm @(
    "--filter",
    "@roamlog/api",
    "exec",
    "tsx",
    "../../tooling/scripts/e2e-auth-fixture.ts"
  )

  $apiProcess = Start-Process `
    -FilePath (Get-Command node).Source `
    -ArgumentList @(
      $tsxCli,
      "--tsconfig",
      "apps/api/tsconfig.json",
      "apps/api/src/main.ts"
    ) `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $apiStdout `
    -RedirectStandardError $apiStderr `
    -PassThru

  $deadline = (Get-Date).AddMinutes(4)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    if ($apiProcess.HasExited) {
      throw "API exited during startup. See $apiStdout and $apiStderr."
    }
    try {
      $health = Invoke-RestMethod -Uri "$apiUrl/v1/health" -TimeoutSec 3
      if ($health.status -eq "ok") {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $healthy) {
    throw "API health check timed out. See $apiStdout and $apiStderr."
  }

  $fixture = Get-Content -LiteralPath $fixtureFile -Raw | ConvertFrom-Json
  $mailpitUrl = "http://127.0.0.1:8025"
  Invoke-RestMethod `
    -Uri "$apiUrl/v1/auth/request-password-reset" `
    -Method Post `
    -Headers @{
      origin = $webUrl
      "x-forwarded-for" = "192.0.2.50"
    } `
    -ContentType "application/json" `
    -Body (
      @{
        email = $fixture.web.email
        redirectTo = "$webUrl/reset-password"
      } | ConvertTo-Json
    ) `
    -TimeoutSec 60 | Out-Null
  $mailpitDeadline = (Get-Date).AddSeconds(30)
  $mailpitMessage = $null
  while ((Get-Date) -lt $mailpitDeadline -and -not $mailpitMessage) {
    $mailbox = Invoke-RestMethod -Uri "$mailpitUrl/api/v1/messages" -TimeoutSec 10
    $mailpitMessage = $mailbox.messages |
      Where-Object {
        $recipients = @($_.To) | ForEach-Object { $_.Address }
        $_ -and
          $_.Subject -eq "重置你的 Roamlog 密码" -and
          $recipients -contains $fixture.web.email
      } |
      Select-Object -First 1
    if (-not $mailpitMessage) {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $mailpitMessage) {
    throw "Mailpit did not receive the password reset email."
  }
  $mailpitProbe = [pscustomobject]@{
    status = "delivered"
    messageId = $mailpitMessage.ID
    subject = $mailpitMessage.Subject
    recipient = $fixture.web.email
    receivedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $mailpitProbe |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $evidenceRoot "mailpit-probe.json") -Encoding UTF8

  $trip = Invoke-JsonPost `
    -Uri "$apiUrl/v1/workspaces/$($fixture.web.workspace.id)/trips" `
    -Body @{
      title = "K6 Release Gate Journey $($fixture.runId)"
      summary = "Isolated k6 staging release-gate fixture."
      status = "active"
      startDate = "2027-10-03"
      endDate = "2027-10-09"
      origin = "Shanghai"
      destinations = @("Kyoto", "Osaka")
      countryCodes = @("JP")
      tags = @("staging", "k6")
      visibility = "public_link"
    } `
    -Cookie $fixture.web.sessionCookie `
    -Origin $webUrl

  $publicShare = Invoke-JsonPost `
    -Uri "$apiUrl/v1/trips/$($trip.id)/share-links" `
    -Body @{ showBudget = $false; allowIndex = $false } `
    -Cookie $fixture.web.sessionCookie `
    -Origin $webUrl
  $passwordShare = Invoke-JsonPost `
    -Uri "$apiUrl/v1/trips/$($trip.id)/share-links" `
    -Body @{ password = $sharePassword; showBudget = $false } `
    -Cookie $fixture.web.sessionCookie `
    -Origin $webUrl

  $env:API_BASE_URL = $apiUrl
  $env:ROAMLOG_SESSION_COOKIE = $fixture.web.sessionCookie
  $env:ROAMLOG_WORKSPACE_ID = $fixture.web.workspace.id
  $env:ROAMLOG_TRIP_ID = $trip.id
  $env:ROAMLOG_SHARE_TOKEN = $publicShare.token
  $env:ROAMLOG_PASSWORD_SHARE_TOKEN = $passwordShare.token
  $env:ROAMLOG_WEB_ORIGIN = $webUrl

  & $k6 run --summary-export $smokeSummary tooling/k6/staging-smoke.js 2>&1 |
    Tee-Object -FilePath $smokeLog
  if ($LASTEXITCODE -ne 0) {
    $failures += "staging-smoke"
  }

  & $k6 run --summary-export $securitySummary tooling/k6/staging-security.js 2>&1 |
    Tee-Object -FilePath $securityLog
  if ($LASTEXITCODE -ne 0) {
    $failures += "staging-security"
  }

  [pscustomobject]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    api = $apiUrl
    databaseSchema = $DatabaseSchema
    redis = "redis://127.0.0.1:6379"
    redisPrefix = $redisPrefix
    minio = "http://127.0.0.1:9000/roamlog-test"
    mailpit = $mailpitUrl
    mailpitProbe = $mailpitProbe
    k6Version = (& $k6 version | Select-Object -First 1)
    workspaceId = $fixture.web.workspace.id
    tripId = $trip.id
    publicShareId = $publicShare.id
    passwordShareId = $passwordShare.id
    smokeSummary = $smokeSummary
    securitySummary = $securitySummary
    failures = $failures
  } | ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $evidenceRoot "k6-environment.json") -Encoding UTF8

  if ($failures.Count -gt 0) {
    throw "k6 threshold failures: $($failures -join ', ')."
  }
} finally {
  if ($apiProcess -and -not $apiProcess.HasExited) {
    Stop-Process -Id $apiProcess.Id -Force
    $apiProcess.WaitForExit(5000) | Out-Null
  }
  try {
    Run-Pnpm @(
      "--filter",
      "@roamlog/api",
      "exec",
      "tsx",
      "../../tooling/scripts/e2e-auth-fixture.ts",
      "--cleanup"
    )
  } catch {
    Write-Warning "k6 fixture cleanup failed: $($_.Exception.Message)"
  }
}
