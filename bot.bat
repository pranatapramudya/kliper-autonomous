@echo off
setlocal
echo.
echo   KLIPER MEDIA - TELEGRAM BOT COMMAND CENTER
echo   ============================================
echo   Starting Telegram Bot polling listener...
echo   ============================================
echo.

cd /d "%~dp0video-engine"
npm run start:bot
cd /d "%~dp0"

endlocal
