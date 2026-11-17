[CmdletBinding()]
param(
  [ValidateSet("start", "status", "stop", "clean", "reset", "download")]
  [string]$Action = "status",
  [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$script:RuntimeRoot = Join-Path $PSScriptRoot "runtime"
$script:BinRoot = Join-Path $script:RuntimeRoot "bin"
$script:DataRoot = Join-Path $script:RuntimeRoot "data"
$script:DownloadRoot = Join-Path $script:RuntimeRoot "downloads"
$script:LogRoot = Join-Path $script:RuntimeRoot "logs"
$script:PidRoot = Join-Path $script:RuntimeRoot "pids"
$script:SourceRoot = Join-Path $script:RuntimeRoot "src"
$script:DotEnv = @{}
$script:MinioCommunityTag = "RELEASE.2025-09-07T16-13-09Z"

function Initialize-Directories {
  foreach ($directory in @(
      $script:RuntimeRoot,
      $script:BinRoot,
      $script:DataRoot,
      $script:DownloadRoot,
      $script:LogRoot,
      $script:PidRoot,
      $script:SourceRoot
    )) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }
}

function Import-LocalEnvironment {
  $path = Join-Path $script:RepoRoot ".env.local"
  if (-not (Test-Path -LiteralPath $path)) {
    return
  }
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match "^\s*#" -or $line -notmatch "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$") {
      continue
    }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $script:DotEnv[$name] = $value
  }
}

function Get-Setting {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowNull()][string]$Default = $null
  )
  $runtimeValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($runtimeValue)) {
    return $runtimeValue
  }
  if ($script:DotEnv.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace($script:DotEnv[$Name])) {
    return $script:DotEnv[$Name]
  }
  return $Default
}

function Get-PortSetting {
  param(
    [Parameter(Mandatory = $true)][string]$PrimaryName,
    [Parameter(Mandatory = $true)][string]$FallbackName,
    [Parameter(Mandatory = $true)][int]$Default
  )
  $value = Get-Setting -Name $PrimaryName
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = Get-Setting -Name $FallbackName
  }
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Default
  }
  return [int]$value
}

function Get-StagingSettings {
  return [pscustomobject]@{
    MinioPort = Get-PortSetting "STAGING_MINIO_PORT" "MINIO_PORT" 9000
    MinioConsolePort = Get-PortSetting "STAGING_MINIO_CONSOLE_PORT" "MINIO_CONSOLE_PORT" 9001
    MailpitSmtpPort = Get-PortSetting "STAGING_MAILPIT_SMTP_PORT" "MAILPIT_SMTP_PORT" 1025
    MailpitUiPort = Get-PortSetting "STAGING_MAILPIT_UI_PORT" "MAILPIT_UI_PORT" 8025
    RedisPort = Get-PortSetting "STAGING_REDIS_PORT" "REDIS_PORT" 6379
    MinioUser = Get-Setting "MINIO_ROOT_USER" (Get-Setting "S3_ACCESS_KEY" "roamlog")
    MinioPassword = Get-Setting "MINIO_ROOT_PASSWORD" (Get-Setting "S3_SECRET_KEY" "roamlog-local-secret")
  }
}

function Get-PidPath {
  param([Parameter(Mandatory = $true)][string]$Name)
  return Join-Path $script:PidRoot "$Name.json"
}

function Read-PidState {
  param([Parameter(Mandatory = $true)][string]$Name)
  $path = Get-PidPath $Name
  if (-not (Test-Path -LiteralPath $path)) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Write-PidState {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][hashtable]$Ports
  )
  $state = [ordered]@{
    name = $Name
    pid = $ProcessId
    executable = $Executable
    ports = $Ports
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Get-PidPath $Name) -Encoding UTF8
}

function Get-RunningProcess {
  param([AllowNull()]$State)
  if (-not $State -or -not $State.pid) {
    return $null
  }
  try {
    return Get-Process -Id ([int]$State.pid) -ErrorAction Stop
  } catch {
    return $null
  }
}

function Test-HttpHealth {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$TimeoutSeconds = 3
  )
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  } catch {
    return $false
  }
}

function Test-TcpPort {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutMilliseconds = 1000
  )
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync("127.0.0.1", $Port)
    return $task.Wait($TimeoutMilliseconds) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Test-RedisPing {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutMilliseconds = 1000
  )
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync("127.0.0.1", $Port)
    if (-not $task.Wait($TimeoutMilliseconds) -or -not $client.Connected) {
      return $false
    }
    $stream = $client.GetStream()
    $bytes = [System.Text.Encoding]::ASCII.GetBytes("PING`r`n")
    $stream.Write($bytes, 0, $bytes.Length)
    $buffer = New-Object byte[] 64
    $readTask = $stream.ReadAsync($buffer, 0, $buffer.Length)
    if (-not $readTask.Wait($TimeoutMilliseconds)) {
      return $false
    }
    $response = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $readTask.Result)
    return $response.Trim() -eq "+PONG"
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-PortOwner {
  param([Parameter(Mandatory = $true)][int]$Port)
  try {
    return Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
      Select-Object -First 1
  } catch {
    return $null
  }
}

function Assert-PortAvailable {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$ServiceName,
    [AllowNull()]$ExpectedState
  )
  $owner = Get-PortOwner $Port
  if (-not $owner) {
    return
  }
  if ($ExpectedState -and [int]$owner.OwningProcess -eq [int]$ExpectedState.pid) {
    return
  }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($owner.OwningProcess)" -ErrorAction SilentlyContinue
  $details = if ($process) {
    "pid=$($process.ProcessId) name=$($process.Name) command=$($process.CommandLine)"
  } else {
    "pid=$($owner.OwningProcess)"
  }
  throw "Port $Port required by $ServiceName is already in use by an unrelated process ($details)."
}

function Start-ManagedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [hashtable]$Environment = @{}
  )
  $stdout = Join-Path $script:LogRoot "$Name.stdout.log"
  $stderr = Join-Path $script:LogRoot "$Name.stderr.log"
  $previous = @{}
  foreach ($key in $Environment.Keys) {
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], "Process")
  }
  try {
    return Start-Process `
      -FilePath $Executable `
      -ArgumentList $Arguments `
      -WorkingDirectory $WorkingDirectory `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -PassThru
  } finally {
    foreach ($key in $previous.Keys) {
      [Environment]::SetEnvironmentVariable($key, $previous[$key], "Process")
    }
  }
}

function Get-LogTail {
  param([Parameter(Mandatory = $true)][string]$Name)
  $parts = @()
  foreach ($suffix in @("stdout", "stderr")) {
    $path = Join-Path $script:LogRoot "$Name.$suffix.log"
    if (Test-Path -LiteralPath $path) {
      $tail = Get-Content -LiteralPath $path -Tail 20 -ErrorAction SilentlyContinue
      if ($tail) {
        $parts += "[$suffix]`n$($tail -join "`n")"
      }
    }
  }
  return $parts -join "`n"
}

function Invoke-Download {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Invoke-WebRequest -Uri $Uri -OutFile $Destination -UseBasicParsing -TimeoutSec 600
}

function Get-MinioVersion {
  param([Parameter(Mandatory = $true)][string]$Executable)
  try {
    return (& $Executable --version 2>&1 | Out-String).Trim()
  } catch {
    return $null
  }
}

function Test-CommunityMinio {
  param([Parameter(Mandatory = $true)][string]$Executable)
  $version = Get-MinioVersion $Executable
  if (-not $version) {
    return $false
  }
  return $version -notmatch "AIStor" -and $version -match "AGPL"
}

function Ensure-MinioSource {
  $source = Join-Path $script:SourceRoot "minio-community"
  $goMod = Join-Path $source "go.mod"
  if (Test-Path -LiteralPath $goMod) {
    return $source
  }
  if (Test-Path -LiteralPath $source) {
    $resolved = [System.IO.Path]::GetFullPath($source)
    if (-not $resolved.StartsWith($script:RuntimeRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove a source path outside the staging runtime: $resolved"
    }
    Remove-Item -LiteralPath $source -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $script:SourceRoot | Out-Null
  $tag = Get-Setting "MINIO_COMMUNITY_SOURCE_TAG" $script:MinioCommunityTag
  if (Get-Command git -ErrorAction SilentlyContinue) {
    & git clone --depth 1 --branch $tag https://github.com/minio/minio.git $source
    if ($LASTEXITCODE -ne 0) {
      throw "git clone of MinIO community source failed with exit code $LASTEXITCODE."
    }
    return $source
  }

  $archive = Join-Path $script:DownloadRoot "minio-community-source.zip"
  Invoke-Download "https://github.com/minio/minio/archive/refs/tags/$tag.zip" $archive
  $expanded = Join-Path $script:SourceRoot "minio-community-expanded"
  Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
  $candidate = Get-ChildItem -LiteralPath $expanded -Recurse -Filter "go.mod" |
    Where-Object { $_.DirectoryName -match "minio-" } |
    Select-Object -First 1
  if (-not $candidate) {
    throw "Downloaded MinIO archive did not contain go.mod."
  }
  Move-Item -LiteralPath $candidate.DirectoryName -Destination $source
  return $source
}

function Ensure-Minio {
  $binary = Join-Path $script:BinRoot "minio.exe"
  if ((Test-Path -LiteralPath $binary) -and (Test-CommunityMinio $binary)) {
    return $binary
  }
  if ($SkipDownload) {
    throw "MinIO community binary is missing at $binary and -SkipDownload was supplied."
  }

  $override = Get-Setting "MINIO_BINARY_URL"
  if (-not [string]::IsNullOrWhiteSpace($override)) {
    $download = Join-Path $script:DownloadRoot "minio-override.exe"
    Invoke-Download $override $download
    if (-not (Test-CommunityMinio $download)) {
      throw "MINIO_BINARY_URL did not provide a licensed community MinIO build. AIStor binaries deny S3 without a license."
    }
    Move-Item -LiteralPath $download -Destination $binary -Force
    return $binary
  }

  if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "Go is required to build the pinned MinIO community release ($script:MinioCommunityTag). Install Go or set MINIO_BINARY_URL to a licensed community MinIO Windows binary."
  }

  $source = Ensure-MinioSource
  $buildLog = Join-Path $script:LogRoot "minio-build.log"
  $previousGoOs = $env:GOOS
  $previousGoArch = $env:GOARCH
  $previousCgo = $env:CGO_ENABLED
  try {
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    $env:CGO_ENABLED = "0"
    Push-Location $source
    try {
      & go build -buildvcs=false -trimpath -o $binary . *> $buildLog
      if ($LASTEXITCODE -ne 0) {
        throw "MinIO community build failed with exit code $LASTEXITCODE. See $buildLog."
      }
    } finally {
      Pop-Location
    }
  } finally {
    $env:GOOS = $previousGoOs
    $env:GOARCH = $previousGoArch
    $env:CGO_ENABLED = $previousCgo
  }
  if (-not (Test-CommunityMinio $binary)) {
    throw "Built MinIO binary did not report a community AGPL license. See $buildLog."
  }
  return $binary
}

function Ensure-Mailpit {
  $binary = Join-Path $script:BinRoot "mailpit\mailpit.exe"
  if (Test-Path -LiteralPath $binary) {
    return $binary
  }
  if ($SkipDownload) {
    throw "Mailpit binary is missing at $binary and -SkipDownload was supplied."
  }
  $release = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/axllent/mailpit/releases/latest" `
    -Headers @{ "User-Agent" = "Roamlog-Staging"; "Accept" = "application/vnd.github+json" } `
    -TimeoutSec 60
  $asset = $release.assets | Where-Object { $_.name -eq "mailpit-windows-amd64.zip" } | Select-Object -First 1
  if (-not $asset) {
    throw "Mailpit release $($release.tag_name) has no mailpit-windows-amd64.zip asset."
  }
  $archive = Join-Path $script:DownloadRoot "mailpit-windows-amd64.zip"
  Invoke-Download $asset.browser_download_url $archive
  $target = Join-Path $script:BinRoot "mailpit"
  Expand-Archive -LiteralPath $archive -DestinationPath $target -Force
  if (-not (Test-Path -LiteralPath $binary)) {
    throw "Mailpit archive did not contain mailpit.exe."
  }
  return $binary
}

function Ensure-Redis {
  $binary = Join-Path $script:BinRoot "redis\redis-server.exe"
  if (Test-Path -LiteralPath $binary) {
    return $binary
  }
  $existing = Get-ChildItem -LiteralPath (Join-Path $script:BinRoot "redis") -Recurse -Filter "redis-server.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($existing) {
    return $existing.FullName
  }
  if ($SkipDownload) {
    throw "Redis binary is missing at $binary and -SkipDownload was supplied."
  }
  $release = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/redis-windows/redis-windows/releases/latest" `
    -Headers @{ "User-Agent" = "Roamlog-Staging"; "Accept" = "application/vnd.github+json" } `
    -TimeoutSec 60
  $asset = $release.assets | Where-Object { $_.name -match "Windows-x64-msys2\.zip$" } | Select-Object -First 1
  if (-not $asset) {
    throw "Redis Windows release $($release.tag_name) has no Windows-x64-msys2.zip asset."
  }
  $archive = Join-Path $script:DownloadRoot "redis-windows.zip"
  Invoke-Download $asset.browser_download_url $archive
  $target = Join-Path $script:BinRoot "redis"
  Expand-Archive -LiteralPath $archive -DestinationPath $target -Force
  $discovered = Get-ChildItem -LiteralPath $target -Recurse -Filter "redis-server.exe" | Select-Object -First 1
  if (-not $discovered) {
    throw "Redis archive did not contain redis-server.exe."
  }
  return $discovered.FullName
}

function Start-MinioService {
  param([Parameter(Mandatory = $true)]$Settings)
  $state = Read-PidState "minio"
  $process = Get-RunningProcess $state
  if ($process -and (Test-HttpHealth "http://127.0.0.1:$($Settings.MinioPort)/minio/health/live")) {
    return $state
  }
  if ($state -and -not $process) {
    Remove-Item -LiteralPath (Get-PidPath "minio") -Force -ErrorAction SilentlyContinue
  }
  Assert-PortAvailable $Settings.MinioPort "MinIO API" $state
  Assert-PortAvailable $Settings.MinioConsolePort "MinIO console" $state
  $binary = Ensure-Minio
  $data = Join-Path $script:DataRoot "minio"
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  $started = Start-ManagedProcess `
    -Name "minio" `
    -Executable $binary `
    -Arguments @(
      "server",
      $data,
      "--address", "127.0.0.1:$($Settings.MinioPort)",
      "--console-address", "127.0.0.1:$($Settings.MinioConsolePort)"
    ) `
    -WorkingDirectory $script:RepoRoot `
    -Environment @{
      MINIO_ROOT_USER = $Settings.MinioUser
      MINIO_ROOT_PASSWORD = $Settings.MinioPassword
      MINIO_BROWSER_REDIRECT_URL = "http://127.0.0.1:$($Settings.MinioConsolePort)"
      MINIO_API_CORS_ALLOW_ORIGIN = (Get-Setting "CORS_ORIGINS" "http://localhost:3000,http://localhost:3001")
    }
  Write-PidState "minio" $started.Id $binary @{
    api = $Settings.MinioPort
    console = $Settings.MinioConsolePort
  }
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if ($started.HasExited) {
      throw "MinIO exited during startup.`n$(Get-LogTail 'minio')"
    }
    if (Test-HttpHealth "http://127.0.0.1:$($Settings.MinioPort)/minio/health/live") {
      return (Read-PidState "minio")
    }
    Start-Sleep -Milliseconds 500
  }
  Stop-Process -Id $started.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Get-PidPath "minio") -Force -ErrorAction SilentlyContinue
  throw "MinIO health check timed out on port $($Settings.MinioPort).`n$(Get-LogTail 'minio')"
}

function Start-MailpitService {
  param([Parameter(Mandatory = $true)]$Settings)
  $state = Read-PidState "mailpit"
  $process = Get-RunningProcess $state
  if (
    $process -and
    (Test-HttpHealth "http://127.0.0.1:$($Settings.MailpitUiPort)/livez") -and
    (Test-TcpPort $Settings.MailpitSmtpPort)
  ) {
    return $state
  }
  if ($state -and -not $process) {
    Remove-Item -LiteralPath (Get-PidPath "mailpit") -Force -ErrorAction SilentlyContinue
  }
  Assert-PortAvailable $Settings.MailpitUiPort "Mailpit UI" $state
  Assert-PortAvailable $Settings.MailpitSmtpPort "Mailpit SMTP" $state
  $binary = Ensure-Mailpit
  $database = Join-Path $script:DataRoot "mailpit.db"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $database) | Out-Null
  $started = Start-ManagedProcess `
    -Name "mailpit" `
    -Executable $binary `
    -Arguments @(
      "--listen", "127.0.0.1:$($Settings.MailpitUiPort)",
      "--smtp", "127.0.0.1:$($Settings.MailpitSmtpPort)",
      "--database", $database,
      "--disable-version-check"
    ) `
    -WorkingDirectory (Split-Path -Parent $binary)
  Write-PidState "mailpit" $started.Id $binary @{
    ui = $Settings.MailpitUiPort
    smtp = $Settings.MailpitSmtpPort
  }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if ($started.HasExited) {
      throw "Mailpit exited during startup.`n$(Get-LogTail 'mailpit')"
    }
    if (
      (Test-HttpHealth "http://127.0.0.1:$($Settings.MailpitUiPort)/livez") -and
      (Test-TcpPort $Settings.MailpitSmtpPort)
    ) {
      return (Read-PidState "mailpit")
    }
    Start-Sleep -Milliseconds 300
  }
  Stop-Process -Id $started.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Get-PidPath "mailpit") -Force -ErrorAction SilentlyContinue
  throw "Mailpit health check timed out.`n$(Get-LogTail 'mailpit')"
}

function Start-RedisService {
  param([Parameter(Mandatory = $true)]$Settings)
  $state = Read-PidState "redis"
  $process = Get-RunningProcess $state
  if ($process -and (Test-RedisPing $Settings.RedisPort)) {
    return $state
  }
  if ($state -and -not $process) {
    Remove-Item -LiteralPath (Get-PidPath "redis") -Force -ErrorAction SilentlyContinue
  }
  Assert-PortAvailable $Settings.RedisPort "Redis" $state
  $server = Ensure-Redis
  $data = Join-Path $script:DataRoot "redis"
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  $log = (Join-Path $script:LogRoot "redis.log").Replace("\", "/")
  $redisDir = $data.Replace("\", "/")
  $redisHome = Split-Path -Parent $server
  $config = Join-Path $redisHome "redis.staging.conf"
  @(
    "bind 127.0.0.1",
    "protected-mode yes",
    "port $($Settings.RedisPort)",
    "timeout 0",
    "tcp-keepalive 300",
    "daemonize no",
    "databases 16",
    "dir `"$redisDir`"",
    "dbfilename dump.rdb",
    "appendonly yes",
    "appendfilename `"appendonly.aof`"",
    "save 60 1",
    "loglevel notice",
    "logfile `"$log`""
  ) | Set-Content -LiteralPath $config -Encoding ASCII
  $started = Start-ManagedProcess `
    -Name "redis" `
    -Executable $server `
    -Arguments @("redis.staging.conf") `
    -WorkingDirectory $redisHome
  Write-PidState "redis" $started.Id $server @{ redis = $Settings.RedisPort }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if ($started.HasExited) {
      throw "Redis exited during startup.`n$(Get-LogTail 'redis')"
    }
    if (Test-RedisPing $Settings.RedisPort) {
      return (Read-PidState "redis")
    }
    Start-Sleep -Milliseconds 300
  }
  Stop-Process -Id $started.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Get-PidPath "redis") -Force -ErrorAction SilentlyContinue
  throw "Redis readiness check timed out.`n$(Get-LogTail 'redis')"
}

function Initialize-StagingBucket {
  param([Parameter(Mandatory = $true)]$Settings)
  $script = Join-Path $PSScriptRoot "bootstrap-bucket.mjs"
  $previousEndpoint = [Environment]::GetEnvironmentVariable("S3_ENDPOINT", "Process")
  $previousAccess = [Environment]::GetEnvironmentVariable("S3_ACCESS_KEY", "Process")
  $previousSecret = [Environment]::GetEnvironmentVariable("S3_SECRET_KEY", "Process")
  try {
    [Environment]::SetEnvironmentVariable("S3_ENDPOINT", "http://127.0.0.1:$($Settings.MinioPort)", "Process")
    [Environment]::SetEnvironmentVariable("S3_ACCESS_KEY", $Settings.MinioUser, "Process")
    [Environment]::SetEnvironmentVariable("S3_SECRET_KEY", $Settings.MinioPassword, "Process")
    $output = & node $script 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Bucket bootstrap failed with exit code $LASTEXITCODE.`n$($output -join "`n")"
    }
    return (($output -join "`n") | ConvertFrom-Json)
  } finally {
    [Environment]::SetEnvironmentVariable("S3_ENDPOINT", $previousEndpoint, "Process")
    [Environment]::SetEnvironmentVariable("S3_ACCESS_KEY", $previousAccess, "Process")
    [Environment]::SetEnvironmentVariable("S3_SECRET_KEY", $previousSecret, "Process")
  }
}

function Get-ServiceStatus {
  param([Parameter(Mandatory = $true)]$Settings)
  $services = @(
    [pscustomobject]@{
      name = "minio"
      ports = @($Settings.MinioPort, $Settings.MinioConsolePort)
      pid = (Read-PidState "minio").pid
      healthy = Test-HttpHealth "http://127.0.0.1:$($Settings.MinioPort)/minio/health/live"
      endpoint = "http://127.0.0.1:$($Settings.MinioPort)"
      console = "http://127.0.0.1:$($Settings.MinioConsolePort)"
      log = (Join-Path $script:LogRoot "minio.stdout.log")
    },
    [pscustomobject]@{
      name = "mailpit"
      ports = @($Settings.MailpitUiPort, $Settings.MailpitSmtpPort)
      pid = (Read-PidState "mailpit").pid
      healthy = (Test-HttpHealth "http://127.0.0.1:$($Settings.MailpitUiPort)/livez") -and (Test-TcpPort $Settings.MailpitSmtpPort)
      endpoint = "http://127.0.0.1:$($Settings.MailpitUiPort)"
      smtp = "127.0.0.1:$($Settings.MailpitSmtpPort)"
      log = (Join-Path $script:LogRoot "mailpit.stdout.log")
    },
    [pscustomobject]@{
      name = "redis"
      ports = @($Settings.RedisPort)
      pid = (Read-PidState "redis").pid
      healthy = Test-RedisPing $Settings.RedisPort
      endpoint = "redis://127.0.0.1:$($Settings.RedisPort)"
      ping = if (Test-RedisPing $Settings.RedisPort) { "PONG" } else { $null }
      log = (Join-Path $script:LogRoot "redis.log")
    }
  )
  return [pscustomobject]@{
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    runtimeRoot = $script:RuntimeRoot
    services = $services
  }
}

function Stop-ManagedService {
  param([Parameter(Mandatory = $true)][string]$Name)
  $state = Read-PidState $Name
  if (-not $state) {
    return $false
  }
  $process = Get-RunningProcess $state
  if ($process) {
    $processPath = $null
    try {
      $processPath = $process.Path
    } catch {
      $processPath = $null
    }
    if ($processPath -and -not $processPath.StartsWith($script:RuntimeRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to stop ${Name}: recorded process $($process.Id) is outside the staging runtime."
    }
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit(5000)
  }
  Remove-Item -LiteralPath (Get-PidPath $Name) -Force -ErrorAction SilentlyContinue
  return $true
}

function Remove-SafeRuntimeDirectory {
  param([Parameter(Mandatory = $true)][string]$Name)
  $target = Join-Path $script:RuntimeRoot $Name
  if (-not (Test-Path -LiteralPath $target)) {
    return
  }
  $resolved = [System.IO.Path]::GetFullPath($target)
  $rootPrefix = $script:RuntimeRoot.TrimEnd("\") + "\"
  if (-not $resolved.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove path outside staging runtime: $resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

Initialize-Directories
Import-LocalEnvironment
$staging = Get-StagingSettings

switch ($Action) {
  "download" {
    $result = [ordered]@{
      minio = (Ensure-Minio)
      mailpit = (Ensure-Mailpit)
      redis = (Ensure-Redis)
    }
    $result | ConvertTo-Json -Depth 5
  }
  "start" {
    if (-not $SkipDownload) {
      [void](Ensure-Minio)
      [void](Ensure-Mailpit)
      [void](Ensure-Redis)
    }
    [void](Start-MinioService $staging)
    [void](Start-MailpitService $staging)
    [void](Start-RedisService $staging)
    $bucket = Initialize-StagingBucket $staging
    $status = Get-ServiceStatus $staging
    [pscustomobject]@{
      status = if ($status.services.healthy -contains $false) { "degraded" } else { "ok" }
      action = "start"
      bucket = $bucket
      services = $status
    } | ConvertTo-Json -Depth 10
    if ($status.services.healthy -contains $false) {
      exit 1
    }
  }
  "status" {
    $status = Get-ServiceStatus $staging
    [pscustomobject]@{
      status = if ($status.services.healthy -contains $false) { "degraded" } else { "ok" }
      action = "status"
      services = $status
    } | ConvertTo-Json -Depth 10
    if ($status.services.healthy -contains $false) {
      exit 1
    }
  }
  "stop" {
    $stopped = @()
    foreach ($name in @("redis", "mailpit", "minio")) {
      if (Stop-ManagedService $name) {
        $stopped += $name
      }
    }
    [pscustomobject]@{ action = "stop"; stopped = $stopped } | ConvertTo-Json -Depth 5
  }
  "clean" {
    foreach ($name in @("redis", "mailpit", "minio")) {
      [void](Stop-ManagedService $name)
    }
    foreach ($name in @("data", "logs", "pids")) {
      Remove-SafeRuntimeDirectory $name
    }
    Initialize-Directories
    [pscustomobject]@{
      action = "clean"
      removed = @("data", "logs", "pids")
      retained = @("bin", "downloads", "src")
    } | ConvertTo-Json -Depth 5
  }
  "reset" {
    foreach ($name in @("redis", "mailpit", "minio")) {
      [void](Stop-ManagedService $name)
    }
    foreach ($name in @("data", "logs", "pids")) {
      Remove-SafeRuntimeDirectory $name
    }
    Initialize-Directories
    if (-not $SkipDownload) {
      [void](Ensure-Minio)
      [void](Ensure-Mailpit)
      [void](Ensure-Redis)
    }
    [void](Start-MinioService $staging)
    [void](Start-MailpitService $staging)
    [void](Start-RedisService $staging)
    $bucket = Initialize-StagingBucket $staging
    $status = Get-ServiceStatus $staging
    [pscustomobject]@{
      status = if ($status.services.healthy -contains $false) { "degraded" } else { "ok" }
      action = "reset"
      bucket = $bucket
      services = $status
    } | ConvertTo-Json -Depth 10
    if ($status.services.healthy -contains $false) {
      exit 1
    }
  }
}
