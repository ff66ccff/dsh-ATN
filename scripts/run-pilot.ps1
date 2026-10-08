param(
  [ValidateSet('pilot', 'shifting-evidence', 'equal-budget')]
  [string]$Experiment = 'pilot',
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
  $entryScript = if ($Experiment -eq 'shifting-evidence') { '../experiments/shifting-evidence-run.ts' } elseif ($Experiment -eq 'equal-budget') { '../experiments/equal-budget-run.ts' } else { '../experiments/run.ts' }
  & node --import tsx/esm (Join-Path $PSScriptRoot $entryScript) @PilotArguments
  $pilotExit = $LASTEXITCODE
} finally {
  $env:OPENCODE_API_KEY = $previousKey
  Remove-Variable protectedKey -ErrorAction SilentlyContinue
}
exit $pilotExit
