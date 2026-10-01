param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Url
)

if (-not $Url) {
    Write-Host ""
    Write-Host "  KLIPER MEDIA" -ForegroundColor Cyan
    Write-Host "  ============================================" -ForegroundColor DarkGray
    Write-Host "  Usage  : .\klip.ps1 <url-atau-path-file>" -ForegroundColor Yellow
    Write-Host "  Contoh : .\klip.ps1 `"https://youtu.be/abc123`"" -ForegroundColor Yellow
    Write-Host "  Lokal  : .\klip.ps1 `"C:\Videos\podcast.mp4`"" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "  ✂  KLIPER MEDIA AUTONOMOUS ENGINE" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor DarkGray
Write-Host "  Input  : $Url" -ForegroundColor White
Write-Host "  Output : .\video-engine\public\output\" -ForegroundColor White
Write-Host "  ============================================" -ForegroundColor DarkGray
Write-Host ""

Set-Location "$PSScriptRoot\video-engine"

try {
    npx tsx run_pipeline.ts $Url
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "  [ERROR] Pipeline selesai dengan error. Cek log di atas." -ForegroundColor Red
    }
} finally {
    Set-Location $PSScriptRoot
}
