param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PilotArguments
)
$ErrorActionPreference = 'Stop'
$credentialPath = Join-Path $env:LOCALAPPDATA 'dsh-atn\credentials\opencode-go.dpapi'
$previousKey = $env:OPENCODE_API_KEY
try {
  if (-not $env:OPENCODE_API_KEY) {
    if (-not (Test-Path -LiteralPath $credentialPath)) {
      throw 'Set OPENCODE_API_KEY or provision the current-user DPAPI credential outside the repository.'
    }
    $protectedKey = (Get-Content -LiteralPath $credentialPath -Raw).Trim() | ConvertTo-SecureString
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($protectedKey)
    try { $env:OPENCODE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer) }
  }
  & node --import tsx/esm (Join-Path $PSScriptRoot '../experiments/run.ts') @PilotArguments
  $pilotExit = $LASTEXITCODE
} finally {
  $env:OPENCODE_API_KEY = $previousKey
  Remove-Variable protectedKey -ErrorAction SilentlyContinue
}
exit $pilotExit
