@echo off
setlocal

if "%~1"=="" (
    echo.
    echo   KLIPER MEDIA AUTONOMOUS ENGINE
    echo   ============================================
    echo   Usage  : klip.bat ^<url-atau-path-file^>
    echo   Contoh : klip.bat "https://youtu.be/abc123"
    echo   Lokal  : klip.bat "C:\Videos\podcast.mp4"
    echo.
    exit /b 1
)

echo.
echo   KLIPER MEDIA AUTONOMOUS ENGINE
echo   ============================================
echo   Input  : %~1
echo   Output : video-engine\public\output\
echo   ============================================
echo.

cd /d "%~dp0video-engine"
npx tsx run_pipeline.ts %1
cd /d "%~dp0"

endlocal
