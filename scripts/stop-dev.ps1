# Stops every GroundCheck dev server (server.ts) process tree on Windows.
# Finds node processes running this project's server.ts, walks up to the top-most
# wrapper (npm / npx / tsx cli) that is also running server.ts, and tree-kills it.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$all = @(Get-CimInstance Win32_Process)
$byId = @{}
foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }

function Test-ServerTs($proc) { return $proc -and $proc.CommandLine -and $proc.CommandLine -match 'server\.ts' }

# Children launched by tsx carry the project path (node_modules\tsx loader) in their command line.
$repoPattern = [regex]::Escape($repo)
$roots = @{}
foreach ($p in $all) {
  if ((Test-ServerTs $p) -and $p.CommandLine -match $repoPattern) {
    $top = $p
    while ($true) {
      $parent = $byId[[int]$top.ParentProcessId]
      if (Test-ServerTs $parent) { $top = $parent } else { break }
    }
    $roots[[int]$top.ProcessId] = $true
  }
}

if ($roots.Count -eq 0) { Write-Output 'No GroundCheck dev server running.'; exit 0 }
foreach ($id in $roots.Keys) {
  Write-Output "Stopping server.ts process tree rooted at PID $id"
  & taskkill /PID $id /T /F | Out-Null
}
Start-Sleep -Milliseconds 500
$left = @(Get-CimInstance Win32_Process | Where-Object { (Test-ServerTs $_) -and $_.CommandLine -match $repoPattern })
if ($left.Count -gt 0) { Write-Output "Still running: $($left.ProcessId -join ', ')"; exit 1 }
Write-Output 'All GroundCheck dev servers stopped.'
