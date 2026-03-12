# Deploy n8n workflow(s) via database (safe, no "1" suffix problem)
#
# Usage:
#   ./scripts/deploy.ps1                                  -- deploy all workflows
#   ./scripts/deploy.ps1 02-video-factory-a2e-product.json   -- deploy one file
#
# Windows PowerShell version

param([string]$File = "")

$CONTAINER = "content-factory-n8n"
$SCRIPT    = "deploy-db-inner.js"
$SCRIPT_SRC = Join-Path $PSScriptRoot $SCRIPT
$SCRIPT_DST = "/tmp/deploy-db.js"
$WF_DIR = "/home/node/workflows"

if (-not (Test-Path $SCRIPT_SRC)) {
    Write-Error "Script not found: $SCRIPT_SRC"
    exit 1
}

# Copy the deploy script into the container
docker cp $SCRIPT_SRC "${CONTAINER}:${SCRIPT_DST}" | Out-Null

if ($File -ne "") {
    Write-Host "Deploying: $File"
    docker exec $CONTAINER node $SCRIPT_DST "$WF_DIR/$File"
} else {
    # Deploy all .json files
    $files = Get-ChildItem (Join-Path $PSScriptRoot "..\workflows\*.json") | Select-Object -ExpandProperty Name
    Write-Host "Deploying ALL $($files.Count) workflows..."
    $args_str = ($files | ForEach-Object { "$WF_DIR/$_" }) -join " "
    $cmd = "node $SCRIPT_DST $args_str"
    docker exec $CONTAINER sh -c $cmd
}

Write-Host "`nRestarting n8n to reload workflows..."
docker restart $CONTAINER | Out-Null
Write-Host "Waiting for n8n to start..."
Start-Sleep -Seconds 20
$health = Invoke-RestMethod "http://localhost:5678/healthz" -ErrorAction SilentlyContinue
if ($health.status -eq "ok") {
    Write-Host "n8n is running. Done!"
} else {
    Write-Host "n8n health check returned: $health"
}
