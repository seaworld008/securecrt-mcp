<# Thin PowerShell client. Commands are stored as UTF-8 JSON, not interpolated into JSON-RPC.
   Prefer persistent native MCP for agents. No retry/interrupt/acknowledgement is implicit. #>
[CmdletBinding()]
param(
    [string]$Binary = 'securecrt-mcp',
    [Parameter(Mandatory=$true)]
    [ValidateSet('sessions','screen','run','policy-check')][string]$Action,
    [string]$Session,
    [string]$InputFile,
    [string]$CommandText,
    [ValidateSet('posix','prompt','snapshot')][string]$Mode = 'posix',
    [string]$ExpectedPrompt,
    [ValidateRange(1000,3600000)][int]$TimeoutMs = 30000,
    [ValidateRange(4,65536)][int]$MaxBytes = 60000
)
$ErrorActionPreference = 'Stop'
$tempPath = $null
$code = 1
try {
    $invokeArgs = @($Action)
    if ($Action -eq 'screen') {
        if (-not $Session) { throw 'screen requires -Session' }
        $invokeArgs += @('--session', $Session)
    }
    if ($Action -in @('run','policy-check')) {
        if ($InputFile -and $CommandText) { throw 'Use -InputFile OR -CommandText, not both' }
        if (-not $InputFile) {
            if (-not $CommandText) { throw 'A command JSON file or -CommandText is required' }
            if ($Action -eq 'run' -and -not $Session) { throw 'run requires -Session with -CommandText' }
            $request = @{session=$Session; command=$CommandText; mode=$Mode; timeout_ms=$TimeoutMs; max_bytes=$MaxBytes}
            if ($ExpectedPrompt) { $request.expected_prompt = $ExpectedPrompt }
            $tempPath = [System.IO.Path]::GetTempFileName()
            [System.IO.File]::WriteAllText($tempPath, ($request | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
            $InputFile = $tempPath
        }
        $invokeArgs += @('--input', $InputFile)
    }
    & $Binary @invokeArgs
    $code = $LASTEXITCODE
} finally {
    if ($tempPath -and (Test-Path -LiteralPath $tempPath)) { Remove-Item -LiteralPath $tempPath -Force }
}
exit $code
