param(
    [Parameter(Mandatory=$true)][ValidateRange(1,8)][int]$Spike,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$spikeRepoRoot = Split-Path -Parent $PSScriptRoot
$spikeDefinitions = @{
    1 = @{ Package='table-engine'; Test='spike_1_codex_http_inventory_and_approval'; Gate='TABLE_LIVE_ENGINES'; Required=@() }
    2 = @{ Package='table-engine'; Test='spike_2_claude_agent_and_toolless_inventory'; Gate='TABLE_LIVE_ENGINES'; Required=@() }
    3 = @{ Package='table-paypal'; Test='spike_3_seller_second_account_authorize_capture'; Gate='TABLE_LIVE_SANDBOX'; Required=@('PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_SANDBOX_SECRET','PAYPAL_SANDBOX_MERCHANT_ID') }
    4 = @{ Package='table-paypal'; Test='spike_4_owner_payee_capture_and_void'; Gate='TABLE_LIVE_SANDBOX'; Required=@('PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_SANDBOX_SECRET','PAYPAL_SANDBOX_MERCHANT_ID') }
    5 = @{ Package='table-paypal'; Test='spike_5_return_destinations'; Gate='TABLE_LIVE_SANDBOX'; Required=@('PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_SANDBOX_SECRET','PAYPAL_SANDBOX_MERCHANT_ID') }
    6 = @{ Package='table-engine'; Test='spike_6_windows_binary_resolution'; Gate='TABLE_CLI_PROBE'; Required=@() }
    7 = @{ Package='table-market'; Test='spike_7_channel3_demo_monitor_tracking'; Gate='TABLE_LIVE_MARKET'; Required=@('CHANNEL3_API_KEY','CHANNEL3_DEMO_PRODUCT_ID') }
    8 = @{ Package='table-paypal'; Test='spike_8_invoice_create_send_paid'; Gate='TABLE_LIVE_SANDBOX'; Required=@('PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_SANDBOX_SECRET','PAYPAL_SANDBOX_MERCHANT_ID','PAYPAL_SANDBOX_INVOICE_EMAIL') }
}
$spikeDefinition = $spikeDefinitions[$Spike]
$spikeCargoArgs = @('test','-p',$spikeDefinition.Package,'--test','spikes',$spikeDefinition.Test,'--','--ignored','--exact','--nocapture','--test-threads=1')
if ($DryRun) {
    Write-Output ('./scripts/cargo.ps1 -CargoArgs @(' + (($spikeCargoArgs | ForEach-Object { "'$_'" }) -join ',') + ')')
    Write-Output ('Opt-in gate: ' + $spikeDefinition.Gate + '=1 (runner sets it only on a real run)')
    Write-Output ('Required environment names: ' + ($spikeDefinition.Required -join ', '))
    return
}
$spikeMissing = @($spikeDefinition.Required | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) })
if ($spikeMissing.Count -gt 0) { throw ('Missing environment names: ' + ($spikeMissing -join ', ')) }
$spikeStarted = [DateTimeOffset]::UtcNow.ToString('o')
$spikeEvidence = [System.Collections.Generic.List[object]]::new()
$spikeOldGate = [Environment]::GetEnvironmentVariable($spikeDefinition.Gate)
$spikeExitCode = 1
Push-Location -LiteralPath $spikeRepoRoot
try {
    [Environment]::SetEnvironmentVariable($spikeDefinition.Gate,'1')
    # Stream console output; retain ONLY explicit non-secret structured evidence.
    # Approval URLs, OAuth data and raw model/API streams are never written to files.
    & (Join-Path $PSScriptRoot 'cargo.ps1') -CargoArgs $spikeCargoArgs | ForEach-Object {
        $spikeLine = $_.ToString()
        Write-Host $spikeLine
        $spikeMarker = $spikeLine.IndexOf('TABLE_SPIKE_EVIDENCE:',[StringComparison]::Ordinal)
        if ($spikeMarker -ge 0) {
            $spikeEvidence.Add(($spikeLine.Substring($spikeMarker + 21) | ConvertFrom-Json))
        }
    }
    $spikeExitCode = $LASTEXITCODE
} finally {
    [Environment]::SetEnvironmentVariable($spikeDefinition.Gate,$spikeOldGate)
    Pop-Location
    $spikeRecord = @{ spike=$Spike; test=$spikeDefinition.Test; started_utc=$spikeStarted; completed_utc=[DateTimeOffset]::UtcNow.ToString('o'); exit_code=$spikeExitCode; evidence=@($spikeEvidence.ToArray()) }
    $spikeResultDirectory = Join-Path $spikeRepoRoot '.build/spike-results'
    New-Item -ItemType Directory -Force -Path $spikeResultDirectory | Out-Null
    $spikeTimestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff')
    $spikeResultPath = Join-Path $spikeResultDirectory ("spike-$Spike-$spikeTimestamp.json")
    $spikeRecord | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $spikeResultPath -Encoding utf8
    $spikeRelativePath = '.build/spike-results/' + (Split-Path -Leaf $spikeResultPath)
    $spikeRow = "| $spikeStarted | $Spike | $spikeExitCode | ``$spikeRelativePath`` | Owner observations still to record |"
    Add-Content -LiteralPath (Join-Path $spikeRepoRoot 'docs/build/SPIKE-RESULTS.md') -Value $spikeRow -Encoding utf8
    Write-Host "Evidence: $spikeRelativePath; index: docs/build/SPIKE-RESULTS.md"
}
exit $spikeExitCode
