# ✂️ Kliper Autonomous Engine

> Pipeline Otomatis Kurasi & Pemotongan Video Podcast/Long-form menjadi Klip Vertikal (9:16) Potensi Viral untuk TikTok, Shorts, dan Reels — menggunakan **FFmpeg**, **Remotion**, **Gemini AI**, dan **Telegram Bot Command Center**.

---

## 🚀 Cara Pakai

Kliper Autonomous dapat dijalankan dengan **2 Mode Fleksibel**:

---

### Mode 1: Terminal Langsung (CLI)

Gunakan jika Anda ingin langsung memotong video tertentu via terminal PC:

```powershell
# PowerShell (recommended)
.\klip.ps1 "https://www.youtube.com/watch?v=..."

# CMD
klip.bat "https://www.youtube.com/watch?v=..."
```

Engine berjalan otomatis dari awal (download, transkrip, potong, render, buat copywriting) sampai selesai.

---

### Mode 2: Telegram Bot Command Center (Remote Autopilot) 🤖✨

Ubah PC lokal Anda menjadi mesin pabrik konten yang dikendalikan dari jarak jauh lewat Telegram (PC menyala di rumah, Anda cukup kirim link dari HP di mana saja):

#### 1. Jalankan Bot di Terminal PC
Buka terminal dan jalankan bot listener (mode polling, tanpa perlu setting webhook / server publik):

```powershell
# Opsi A: Dari root folder (PowerShell)
.\bot.ps1

# Opsi B: Dari root folder (CMD)
bot.bat

# Opsi C: Dari folder video-engine
cd video-engine
npm run start:bot
```

Saat bot online, terminal akan menampilkan status standby dan bot mengirimkan notifikasi sapaan ke grup Telegram Anda:

```
  ✂  KLIPER MEDIA AUTONOMOUS — TELEGRAM BOT
  ============================================
  Chat ID  : -100xxxxxxxxxx
  Mode     : Polling (no server needed)
  Status   : ✅ Online — Universal Link Support aktif!
  ============================================

  💡 Commands:
     • Paste URL apapun  → mulai pipeline otomatis
     • /resend           → kirim ulang video dari folder output
```

#### 2. Cara Pakai di Grup Telegram

| Aksi | Cara Menggunakan | Keterangan |
|------|------------------|------------|
| 🔗 **Kirim Link Universal** | Paste link URL apa saja ke grup | Mendukung YouTube, Instagram Reels, TikTok, X (Twitter), Twitch, dll. Engine otomatis mendownload, mentranskrip, memotong, merender klip vertikal, dan membuat caption. |
| 🔄 **Kirim Ulang Hasil** | Ketik `/resend` di grup | Mengirim ulang semua file video `.mp4` dan copywriting AI yang ada di folder output tanpa memproses ulang pipeline. |

#### 3. Keunggulan UX Telegram Bot Kliper
- 📱 **Pesan Copywriting Terpisah (1-Tap Copy):** Video dikirim bersih tanpa caption media. Teks copywriting (TikTok/Reels/Shorts) dikirim tepat setelah video sebagai pesan teks mandiri berlabel `🎬 Klip 1`, `🎬 Klip 2`, dll., sehingga Anda dapat menyalinnya di HP dalam 1 kali tap.
- 🧹 **Teks Bersih:** Bebas dari sampah karakter garis pembatas (`====` atau `----`).
- 🔒 **Aman (Security Whitelist):** Bot hanya merespons Chat ID grup yang telah Anda daftarkan di `.env`.
- ⏱️ **Concurrency Lock:** Mencegah pipeline bentrok jika ada anggota grup yang mengirim link lain saat video sedang diproses.

---

### Platform yang Didukung (Universal Extractor)

Engine ditenagai oleh `yt-dlp` yang mendukung **1000+ platform**:

```powershell
# YouTube (Video panjang, Shorts, Live)
.\klip.ps1 "https://www.youtube.com/watch?v=..."

# Instagram Reels
.\klip.ps1 "https://www.instagram.com/reel/..."

# TikTok
.\klip.ps1 "https://www.tiktok.com/@user/video/..."

# X / Twitter
.\klip.ps1 "https://twitter.com/.../status/..."

# Twitch VOD
.\klip.ps1 "https://www.twitch.tv/videos/..."

# File Lokal di PC
.\klip.ps1 "C:\Videos\podcast.mp4"
```

> 💡 **Tip**: Jika muncul error ExecutionPolicy di PowerShell saat pertama kali menjalankan script, jalankan perintah ini sekali:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

---

## 📦 Output

Setelah pipeline selesai (baik via CLI maupun Telegram), semua hasil tersimpan di `video-engine\public\output\`:

```
output/
├── clip_1_ready.mp4          ← Klip vertikal 9:16 siap upload (subtitle Hormozi-style)
├── clip_2_ready.mp4
├── clip_3_ready.mp4
├── ...
└── captions_all_clips.txt    ← File rangkuman caption + hashtag TikTok/YT/IG
```

**Auto-Clear:** Output lama otomatis dibersihkan setiap kali URL baru diproses agar ruang disk tetap hemat.

---

## ⚡ Setup (Hanya Sekali)

### 1. Isi Environment Variables (`.env`)

Salin file `.env.example` menjadi `.env` di root project:

```env
# AI APIs
GEMINI_API_KEY=your_gemini_api_key_here
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Opsional: Pexels API untuk aset b-roll
PEXELS_API_KEY=your_pexels_api_key_here

# Telegram Bot Command Center
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_CHAT_ID=your_group_chat_id_here
```

| Key | Cara Mendapatkan |
|-----|------------------|
| `GEMINI_API_KEY` | Dapatkan gratis di [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| `DEEPGRAM_API_KEY` | Buat akun & ambil key di [console.deepgram.com](https://console.deepgram.com/) |
| `TELEGRAM_BOT_TOKEN` | Chat [@BotFather](https://t.me/BotFather) di Telegram → kirim `/newbot` → salin HTTP API Token |
| `TELEGRAM_CHAT_ID` | Masukkan bot ke grup Telegram Anda, jadikan Admin. Buka browser: `https://api.telegram.org/bot<TOKEN>/getUpdates` lalu salin `chat.id` (berupa angka minus, misal `-100xxxxxxxxxx`) |

### 2. Install Dependencies

```bash
cd video-engine
npm install
```

---

## 📁 Struktur Proyek

```
kliper-autonomous/
├── klip.ps1                     ← 🟢 Entry point CLI utama (PowerShell)
├── klip.bat                     ← 🟢 Entry point CLI utama (CMD)
├── bot.ps1                      ← 🤖 Runner Telegram Bot (PowerShell)
├── bot.bat                      ← 🤖 Runner Telegram Bot (CMD)
├── .env                         ← API Keys (Gemini, Deepgram, Telegram)
├── .env.example                 ← Template konfigurasi env
├── campaign_brief.txt           ← Opsional: brief campaign untuk arahan kurasi AI
└── video-engine/
    ├── run_pipeline.ts          ← Orchestrator pipeline pemrosesan video
    ├── package.json             ← Script runner (npm run dev, start:bot, dll.)
    ├── src/
    │   ├── telegram.ts          ← 🤖 Telegram Bot listener (polling, router, delivery)
    │   ├── transcriber.ts       ← Download + Transkripsi (Deepgram Nova-2 + Diarization)
    │   ├── curator.ts           ← AI Content Strategist (Gemini 3.6 Flash)
    │   ├── slicer.ts            ← Pemotong video frame-accurate (FFmpeg)
    │   ├── copywriter.ts        ← Generator caption + hashtag (Gemini 3.6 Flash)
    │   ├── KliperComposition.tsx← Renderer klip Remotion (9:16, subtitle, animated hook)
    │   ├── Root.tsx             ← Remotion root component
    │   └── index.ts             ← Remotion entry point
    └── public/
        └── output/              ← ✅ Folder hasil akhir (video .mp4 + caption)
```

---

## 🎬 Alur Pipeline Otomatis

```
Input URL (via CLI atau Pesan Telegram)
      │
      ▼
┌─────────────────────────────────────────┐
│ TAHAP 0 — Auto-Clear                    │
│ Hapus output lama otomatis              │
│ Bersihkan cache raw sebelumnya          │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ TAHAP 1 — Ingestion & Transcription     │
│ yt-dlp download video terbaik           │
│ FFmpeg ekstrak audio 16kHz WAV          │
│ Deepgram: transkrip + speaker detection │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ TAHAP 2 — AI Curation (Gemini)          │
│ Kurasi 5–10 momen viral terkuat         │
│ Hook tajam di 3 detik awal              │
│ Speaker-aware untuk podcast multi-orang │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ TAHAP 3 — FFmpeg Slicing                │
│ Potong segmen klip presisi tinggi       │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ TAHAP 4 — Remotion Rendering 1080x1920  │
│ Hook overlay judul (3.5 detik pertama)  │
│ Subtitle gaya Hormozi/CapCut (word pop) │
│ Speaker badge + palet neon per orang    │
│ Progress bar + gradient scrim           │
│ Watermark identitas KLIPER MEDIA        │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ TAHAP 5 — AI Copywriting                │
│ Gemini generate copywriting & hashtag   │
│ Khusus TikTok, Shorts, dan Reels        │
│ Simpan ke captions_all_clips.txt        │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ TAHAP 6 — Cleanup                       │
│ Hapus video mentah besar otomatis       │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ TAHAP 7 — Telegram Auto-Delivery        │
│ (Khusus Mode Telegram Bot)              │
│ Kirim video MP4 langsung ke grup        │
│ Kirim copywriting terpisah per klip     │
└─────────────────────────────────────────┘
```

---

## 🌟 Fitur Utama

### 🤖 Telegram Bot Command Center
- **Local Polling**: Berjalan di komputer lokal tanpa perlu IP publik, port forwarding, atau domain webhook.
- **Pemisahan Video & Teks**: Video dikirim tanpa tertimpa caption panjang; copywriting dikirim sebagai teks mandiri agar langsung dapat di-copy di smartphone dalam 1 tap.
- **Sanitasi Format Otomatis**: Menghilangkan sisa garis ascii/unicode divider, memastikan tampilan rapi dengan penomoran klip (`🎬 Klip 1`, `🎬 Klip 2`, ...).
- **Perintah `/resend`**: Ambil ulang semua video yang sudah dirender kapan saja tanpa proses ulang.

### 🎙️ Speaker Diarization & Neon Subtitle
Deteksi otomatis siapa yang berbicara secara per kata:
- Warna teks subtitle berganti dinamis mengikuti giliran bicara setiap orang.
- **Speaker badge** (HOST / GUEST 1 / GUEST 2) responsif di layar.
- AI Curator mengutamakan interaksi dialog antar pembicara untuk video podcast.

| Speaker | Warna Idle | Warna Aktif |
|---------|-----------|-------------|
| HOST (0) | Putih | Cyan Neon |
| GUEST 1 (1) | Kuning | Oranye Neon |
| GUEST 2 (2) | Cyan | Pink Neon |

### ⚡ Animated Hook Overlay
Judul hook tampil pop-in di area atas/tengah layar selama **3.5 detik pertama** video untuk menghentikan scrolling audiens.

### ✨ Subtitle Hormozi / CapCut-Style
Kata aktif membesar (scale 1.18x) dengan efek glow neon, sementara kata sebelumnya fade 50% untuk memudahkan mata audiens mengikuti pesan.

### 📋 AI Multi-Platform Copywriting
Setiap klip dilengkapi copywriting yang dioptimasi untuk karakteristik tiap platform:
- **TikTok**: Hook to-the-point + 5–8 hashtag viral.
- **YouTube Shorts**: Judul SEO-friendly + ajakan subscribe.
- **Instagram Reels**: Narasi storytelling + pemantik diskusi di kolom komentar.

---

## 📦 Tech Stack

| Layer | Komponen / Library |
|-------|--------------------|
| Runner / CLI | `klip.ps1`, `klip.bat`, `bot.ps1`, `bot.bat` |
| Bot Remote | `node-telegram-bot-api` (Long Polling Mode) |
| Video Ingestion | `yt-dlp` via `youtube-dl-exec` |
| Audio Processing | `fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg` |
| Speech-to-Text | Deepgram `nova-2` (Speaker Diarization + Word Timestamps) |
| AI Intelligence | Google Gemini 3.6 Flash (`@google/generative-ai`) |
| Video Rendering | Remotion 4.x (React 19, TypeScript, 1080×1920, 30fps) |
| Tipografi | Montserrat (`@remotion/google-fonts`) |

---

## 🗂️ Campaign Brief (Opsional)

Buat file `campaign_brief.txt` di root directory jika Anda ingin mengarahkan AI untuk fokus pada topik, pesan produk, atau penawaran tertentu.
Jika file ini tersedia, engine secara otomatis:
1. Menyeleksi momen yang memiliki korelasi kuat dengan brief kampanye Anda.
2. Menyematkan **CTA Layer** khusus pada klip video hasil akhir.
