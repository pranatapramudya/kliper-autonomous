Write-Host ""
Write-Host "  ✂  KLIPER MEDIA — TELEGRAM BOT COMMAND CENTER" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor DarkGray
Write-Host "  Starting Telegram Bot polling listener..." -ForegroundColor White
Write-Host "  ============================================" -ForegroundColor DarkGray
Write-Host ""

Set-Location "$PSScriptRoot\video-engine"

try {
    npm run start:bot
} finally {
    Set-Location $PSScriptRoot
}
