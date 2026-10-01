# Install the H/Ai extension into VS Code from the latest GitHub release (or a local .vsix given as -Vsix).
param([string]$Vsix)
$ErrorActionPreference = 'Stop'
$url = 'https://github.com/SnapBlock/hai-browser/releases/latest/download/hai-browser.vsix'

$code = $env:CODE
if (-not $code) {
  $found = Get-Command code -ErrorAction SilentlyContinue
  if ($found) { $code = $found.Source }
  else {
    $candidates = @(
      "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
      "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd"
    )
    $code = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
}
if (-not $code) { throw "Could not find VS Code's 'code' command. Set `$env:CODE to its path." }

if (-not $Vsix) {
  $Vsix = Join-Path ([IO.Path]::GetTempPath()) 'hai-browser.vsix'
  Write-Host "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $Vsix -UseBasicParsing
}

& $code --install-extension $Vsix --force
if ($LASTEXITCODE -ne 0) { throw "VS Code could not install $Vsix" }
Write-Host "H/Ai is installed. Open (or reload) VS Code and click 'Connect Claude Code' when it asks."
