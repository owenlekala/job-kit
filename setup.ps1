$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 24 or later, then run setup again.'
}
& node (Join-Path $PSScriptRoot 'scripts/setup.mjs') @args
exit $LASTEXITCODE
