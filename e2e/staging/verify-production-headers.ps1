$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$evidenceDirectory = Join-Path $repoRoot "test-results/staging/evidence"
$fixtureFile = Join-Path $repoRoot ".e2e-live/prod-header-fixture.json"
$stdoutFile = Join-Path $repoRoot ".e2e-live/prod-api.stdout.log"
$stderrFile = Join-Path $repoRoot ".e2e-live/prod-api.stderr.log"
$databaseUrl = "postgresql://roamlog:roamlog@localhost:55432/roamlog?schema=staging_security_e2e"
$authSecret = "roamlog-staging-production-header-check-secret-32-bytes"
$apiPort = 4200
$redisPort = 46383

New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot ".e2e-live") | Out-Null

$env:DATABASE_URL = $databaseUrl
$env:ROAMLOG_LIVE_DATABASE_URL = $databaseUrl
$env:ROAMLOG_LIVE_AUTH_SECRET = $authSecret
$env:ROAMLOG_LIVE_FIXTURE_FILE = $fixtureFile

& pnpm --filter @roamlog/api exec tsx ../../tooling/scripts/e2e-auth-fixture.ts | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Unable to provision the production-header fixture."
}
$fixture = Get-Content -LiteralPath $fixtureFile -Raw | ConvertFrom-Json

$env:NODE_ENV = "production"
$env:LOG_LEVEL = "warn"
$env:API_PORT = "$apiPort"
$env:API_URL = "https://api.staging.roamlog.test"
$env:APP_URL = "https://app.staging.roamlog.test"
$env:ADMIN_URL = "https://admin.staging.roamlog.test"
$env:CORS_ORIGINS = "https://app.staging.roamlog.test,https://admin.staging.roamlog.test"
$env:REDIS_URL = "redis://127.0.0.1:$redisPort"
$env:ROAMLOG_LIVE_REDIS_PORT = "$redisPort"
$env:REDIS_PREFIX = "roamlog-staging-prod-header-check"
$env:BETTER_AUTH_SECRET = $authSecret
$env:BETTER_AUTH_URL = "https://api.staging.roamlog.test"
$env:ADMIN_2FA_ENFORCED = "true"
$env:S3_ENDPOINT = "http://127.0.0.1:49000"
$env:S3_BUCKET = "roamlog-staging-production-header-check"
$env:S3_ACCESS_KEY = "staging-production-header-check"
$env:S3_SECRET_KEY = "staging-production-header-check-secret"
$env:S3_REGION = "us-east-1"
$env:S3_FORCE_PATH_STYLE = "true"
$env:EMAIL_FROM = "Roamlog <staging-production-header-check@roamlog.test>"
$env:NEXT_TELEMETRY_DISABLED = "1"

$started = $null
$listenerPid = $null
try {
  $started = Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList @("/d", "/s", "/c", "pnpm --filter @roamlog/api exec tsx ../../e2e/live-support/start-api.ts") `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutFile `
    -RedirectStandardError $stderrFile `
    -PassThru

  $health = $null
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    try {
      $health = Invoke-WebRequest `
        -Uri "http://127.0.0.1:$apiPort/v1/health" `
        -UseBasicParsing `
        -SkipHttpErrorCheck
      if ($health.StatusCode -eq 200) {
        break
      }
    } catch {
      Start-Sleep -Milliseconds 750
    }
  }
  if ($null -eq $health -or $health.StatusCode -ne 200) {
    $stderr = Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue
    throw "Production-mode API did not become healthy. stderr: $stderr"
  }

  $headers = @{}
  foreach ($key in $health.Headers.Keys) {
    $headers[$key.ToLowerInvariant()] = ($health.Headers[$key] -join ", ")
  }
  if (-not $headers.ContainsKey("strict-transport-security")) {
    throw "Production health response is missing Strict-Transport-Security."
  }

  $sessionStatuses = @()
  for ($index = 0; $index -lt 15; $index += 1) {
    $sessionResponse = Invoke-WebRequest `
      -Uri "http://127.0.0.1:$apiPort/v1/auth/get-session" `
      -Headers @{ Origin = "https://app.staging.roamlog.test" } `
      -UseBasicParsing `
      -SkipHttpErrorCheck
    $sessionStatuses += $sessionResponse.StatusCode
  }

  $signInBody = @{
    email = $fixture.web.email
    password = $fixture.web.password
    rememberMe = $true
  } | ConvertTo-Json
  $disallowedSignIn = Invoke-WebRequest `
    -Uri "http://127.0.0.1:$apiPort/v1/auth/sign-in/email" `
    -Method Post `
    -Headers @{ Origin = "http://127.0.0.1:3100" } `
    -ContentType "application/json" `
    -Body $signInBody `
    -UseBasicParsing `
    -SkipHttpErrorCheck
  $signIn = Invoke-WebRequest `
    -Uri "http://127.0.0.1:$apiPort/v1/auth/sign-in/email" `
    -Method Post `
    -Headers @{ Origin = "https://app.staging.roamlog.test" } `
    -ContentType "application/json" `
    -Body $signInBody `
    -UseBasicParsing `
    -SkipHttpErrorCheck
  $setCookie = ($signIn.Headers["Set-Cookie"] -join "`n")
  $cookieHeader = ($setCookie -split "`n" | Select-Object -First 1).Split(";")[0]

  $crossOriginWriteBody = @{
    title = "Production CSRF probe"
    startDate = "2027-08-01"
    endDate = "2027-08-02"
    origin = "Shanghai"
    visibility = "workspace"
  } | ConvertTo-Json
  $crossOriginWrite = Invoke-WebRequest `
    -Uri "http://127.0.0.1:$apiPort/v1/workspaces/$($fixture.web.workspace.id)/trips" `
    -Method Post `
    -Headers @{ Cookie = $cookieHeader; Origin = "https://evil.example" } `
    -ContentType "application/json" `
    -Body $crossOriginWriteBody `
    -UseBasicParsing `
    -SkipHttpErrorCheck
  $createdTripId = $null
  if ($crossOriginWrite.StatusCode -eq 201) {
    $createdTripId = (($crossOriginWrite.Content | ConvertFrom-Json).id)
  }
  $cleanupStatus = $null
  if ($createdTripId) {
    $cleanup = Invoke-WebRequest `
      -Uri "http://127.0.0.1:$apiPort/v1/trips/$createdTripId" `
      -Method Delete `
      -Headers @{ Cookie = $cookieHeader; Origin = "https://app.staging.roamlog.test" } `
      -UseBasicParsing `
      -SkipHttpErrorCheck
    $cleanupStatus = $cleanup.StatusCode
  }

  $result = [ordered]@{
    checkedAt = (Get-Date).ToUniversalTime().ToString("o")
    environment = "NODE_ENV=production, HTTPS app/api origins, isolated schema staging_security_e2e"
    healthStatus = $health.StatusCode
    hsts = $headers["strict-transport-security"]
    csp = $headers["content-security-policy"]
    xFrameOptions = $headers["x-frame-options"]
    referrerPolicy = $headers["referrer-policy"]
    disallowedOriginSignInStatus = $disallowedSignIn.StatusCode
    signInStatus = $signIn.StatusCode
    setCookie = $setCookie
    secureCookiePresent = [bool]($setCookie -match "(?i)(^|;)\s*Secure\s*(;|$)")
    sameSiteLaxPresent = [bool]($setCookie -match "(?i)SameSite=Lax")
    httpOnlyPresent = [bool]($setCookie -match "(?i)HttpOnly")
    authGetSession = $sessionStatuses
    authGetSessionFirst429At = [Array]::IndexOf($sessionStatuses, 429) + 1
    crossOriginWriteStatus = $crossOriginWrite.StatusCode
    crossOriginWriteTripId = $createdTripId
    crossOriginWriteCleanupStatus = $cleanupStatus
  }
  $result | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $evidenceDirectory "production-headers.json") -Encoding utf8
  $result | ConvertTo-Json -Depth 4
} finally {
  $connection = Get-NetTCPConnection -LocalPort $apiPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($connection) {
    $listenerPid = $connection.OwningProcess
    & taskkill.exe /PID $listenerPid /T /F | Out-Null
  }
  if ($started -and -not $started.HasExited) {
    Stop-Process -Id $started.Id -Force -ErrorAction SilentlyContinue
  }

  & pnpm --filter @roamlog/api exec tsx ../../tooling/scripts/e2e-auth-fixture.ts --cleanup | Out-Null
  Remove-Item -LiteralPath $fixtureFile -Force -ErrorAction SilentlyContinue
}
