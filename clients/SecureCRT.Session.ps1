# Dot-source this file once; the explicitly running Rust daemon retains all session state.
function Invoke-SecureCRTSession {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Binary,
        [Parameter(Mandatory=$true)]
        [ValidateSet('sessions','screen','attach','exec','exec-batch','batch-status','detach','heartbeat','status','output','acknowledge-idle','interrupt','shell-open','shell-read','shell-write','shell-close','latency','ping')]
        [string]$Action,
        [hashtable]$Request = @{}
    )
    $path = [System.IO.Path]::GetTempFileName()
    $previous = [Console]::OutputEncoding
    try {
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [Console]::OutputEncoding = $utf8
        [System.IO.File]::WriteAllText($path, ($Request | ConvertTo-Json -Depth 12 -Compress), $utf8)
        $result = & $Binary session $Action --input $path
        if ($LASTEXITCODE -ne 0) {
            throw "Daemon call failed. Inspect the original operation; do not retry automatically. $result"
        }
        return (($result -join "`n") | ConvertFrom-Json)
    }
    finally {
        [Console]::OutputEncoding = $previous
        Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
}
