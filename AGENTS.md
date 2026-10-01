# kliper-autonomous — AI Agent Context

## Apa ini?
Video affiliate pipeline otomatis milik PJTech. Generate konten video affiliate → upload ke platform. Dijalankan sebagai subprocess oleh `pjtech-autonomous` via `kliper-orchestrator.ts`.

## Arsitektur
```
bot.ps1 / klip.ps1    ← Launcher
video-engine/         ← Engine produksi video (Remotion)
src/                  ← Pipeline utama
```

## Integrasi dengan pjtech-autonomous
- Dipanggil via `kliper-orchestrator.ts` di `pjtech-autonomous/video-engine/src/`
- Jangan jalankan standalone kecuali testing
- Notif hasil dikirim ke `TELEGRAM_GROUP_ID` via parent orchestrator

## Rules untuk Agent
1. Repo ini adalah **sibling** dari `pjtech-autonomous` di `D:\Coding\`
2. Shared `.env` dari `pjtech-autonomous` root (Telegram token, API keys)
3. Cek `klip.ps1` untuk startup behavior
