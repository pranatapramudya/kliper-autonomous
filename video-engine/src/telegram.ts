/**
 * Kliper Autonomous — Telegram Bot Command Center
 * ================================================
 * Jalankan: npm run start:bot
 *
 * Cara pakai:
 *   1. Pastikan .env sudah diisi TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID.
 *   2. Jalankan `npm run start:bot` di terminal, biarkan berjalan.
 *   3. Kirim link YouTube ke grup Telegram. Bot akan otomatis:
 *      a. Mengakui link masuk.
 *      b. Menjalankan seluruh pipeline (transkrip → potong → render → caption).
 *      c. Mengirimkan kembali semua klip video ke grup beserta caption AI.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import * as dotenv from 'dotenv';

// node-telegram-bot-api v0.66.x adalah CommonJS — gunakan createRequire
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TelegramBot = require('node-telegram-bot-api') as typeof import('node-telegram-bot-api');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env dari root project (satu level di atas video-engine/)
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ============================================================
// Validasi environment variables wajib
// ============================================================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID_RAW = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN tidak ditemukan di .env! Bot tidak bisa dijalankan.');
  process.exit(1);
}
if (!CHAT_ID_RAW) {
  console.error('❌ TELEGRAM_CHAT_ID tidak ditemukan di .env! Bot tidak tahu ke mana harus mengirim.');
  process.exit(1);
}

const ALLOWED_CHAT_ID = parseInt(CHAT_ID_RAW, 10);
const TELEGRAM_MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB — batas Telegram Bot API

// Path ke folder output (video-engine/public/output/)
// __dirname = video-engine/src/ → naik satu level = video-engine/
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'output');

// ============================================================
// Inisialisasi Bot (mode polling — no server/webhook needed)
// ============================================================
const bot = new (TelegramBot as any)(BOT_TOKEN, { polling: true });

// ============================================================
// Concurrency Lock — mencegah pipeline berjalan bersamaan
// ============================================================
let isProcessing = false;
let processingUrl: string | null = null;

// ============================================================
// Regex: Deteksi semua valid URL (http/https)
// yt-dlp mendukung universal extractor, jadi semua link diterima.
// ============================================================
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

// ============================================================
// Helper: Kirim pesan aman (handle Markdown parse errors)
// ============================================================
async function sendMessage(chatId: number, text: string, options?: Record<string, unknown>): Promise<void> {
  try {
    await bot.sendMessage(chatId, text, options);
  } catch (err: any) {
    // Jika Markdown gagal, coba kirim sebagai plain text
    try {
      const plain = text.replace(/[*_`\[\]()~>#+=|{}.!\\]/g, '');
      await bot.sendMessage(chatId, plain);
    } catch (e2) {
      console.error('[Bot] Gagal mengirim pesan:', e2);
    }
  }
}

// ============================================================
// Helper: Format ukuran file agar mudah dibaca manusia
// ============================================================
function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================
// Helper: Parse captions_all_clips.txt → Map<clipNumber, captionText>
//
// Format file (dari formatCopyAsText di copywriter.ts):
//   ════════...════════
//   CLIP 1
//   ════════...════════
//   ▶️ YOUTUBE SHORTS
//   ...
//   📱 TIKTOK / INSTAGRAM REELS
//   ...
//   ════════...════════
//   CLIP 2
//   ...
//
// Strategi: split berdasarkan header "CLIP N" (angka), lalu
// ekstrak bagian TikTok/Reels dari setiap blok untuk dikirim.
// Map key = clipNumber (1-based, sesuai nama file clip_1_ready.mp4)
// ============================================================
function parseCaptionsFile(captionsPath: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!fs.existsSync(captionsPath)) {
    console.log('[Bot] captions_all_clips.txt tidak ditemukan, lanjut tanpa caption.');
    return map;
  }

  try {
    const raw = fs.readFileSync(captionsPath, 'utf-8');

    // Split seluruh teks berdasarkan pola "CLIP N" (N = angka)
    // Regex ini mendeteksi baris yang isinya HANYA "CLIP" + spasi + angka
    const clipHeaderRegex = /^CLIP\s+(\d+)\s*$/gm;

    // Kumpulkan semua posisi header beserta clip-number-nya
    const headers: Array<{ clipNum: number; index: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = clipHeaderRegex.exec(raw)) !== null) {
      headers.push({ clipNum: parseInt(match[1], 10), index: match.index });
    }

    console.log(`[Bot] parseCaptionsFile: ditemukan ${headers.length} header klip → ${headers.map(h => `CLIP ${h.clipNum}`).join(', ')}`);

    for (let hi = 0; hi < headers.length; hi++) {
      const { clipNum, index } = headers[hi];
      // Ambil teks dari header ini sampai header berikutnya (atau akhir file)
      const blockEnd = hi + 1 < headers.length ? headers[hi + 1].index : raw.length;
      const block = raw.slice(index, blockEnd);

      // Dari blok ini, ambil bagian TIKTOK / INSTAGRAM REELS
      // (mulai dari baris "📱 TIKTOK..." hingga akhir blok)
      const tiktokMarker = '📱 TIKTOK / INSTAGRAM REELS';
      const tiktokStart = block.indexOf(tiktokMarker);

      let captionText: string;
      if (tiktokStart !== -1) {
        // Ambil semua teks setelah marker TikTok, buang separator ────
        captionText = block
          .slice(tiktokStart + tiktokMarker.length)
          .replace(/^\s*[─\-]{4,}\s*$/gm, '')  // hapus baris separator ────
          .trim();
      } else {
        // Fallback: ambil seluruh blok (tanpa baris ═ dan judul CLIP N)
        captionText = block
          .replace(/^═+.*$/gm, '')               // hapus baris ════
          .replace(/^CLIP\s+\d+\s*$/m, '')        // hapus baris "CLIP N"
          .trim();
      }

      // Sanitasi universal: bersihkan sisa garis pembatas apa pun
      captionText = captionText
        .replace(/^[═=─\-]{4,}\s*$/gm, '')       // hapus baris yg isinya hanya karakter garis
        .replace(/\n{3,}/g, '\n\n')              // kompres 3+ baris kosong jadi 2
        .trim();

      // Telegram message max 4096 karakter
      if (captionText.length > 4000) {
        captionText = captionText.substring(0, 3997) + '...';
      }

      console.log(`[Bot]   CLIP ${clipNum}: ${captionText.length} chars — preview: "${captionText.substring(0, 80).replace(/\n/g, '↵')}"`);
      map.set(clipNum, captionText);
    }
  } catch (e) {
    console.warn('[Bot] Gagal membaca/parsing captions_all_clips.txt:', e);
  }

  return map;
}

// ============================================================
// Helper: Ekstrak clip number dari nama file
// "clip_3_ready.mp4" → 3
// ============================================================
function extractClipNumber(fileName: string): number | null {
  const m = fileName.match(/clip_(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ============================================================
// Helper: Kirim semua .mp4 dari sebuah folder ke Telegram
// Video dikirim tanpa caption; copywriting dikirim sebagai
// pesan teks TERPISAH setelahnya (mudah di-copy di Telegram).
// Dipakai oleh: pipeline auto-send & command /resend
// ============================================================
async function sendVideoFiles(chatId: number, folderPath: string): Promise<void> {
  // Pastikan folder ada
  if (!fs.existsSync(folderPath)) {
    await sendMessage(chatId, '📂 Folder output tidak ditemukan. Belum ada video yang dirender.');
    return;
  }

  // Kumpulkan semua .mp4, urutkan (clip_1 < clip_2 < ...)
  const allFiles = fs.readdirSync(folderPath);
  const mp4Files = allFiles
    .filter(f => f.toLowerCase().endsWith('.mp4'))
    .sort()
    .map(f => path.join(folderPath, f));

  if (mp4Files.length === 0) {
    await sendMessage(chatId, '📂 Belum ada video yang siap di folder output.');
    return;
  }

  // Parse caption file (Map<clipNumber, teks>)
  const captionsPath = path.join(folderPath, 'captions_all_clips.txt');
  const captionMap = parseCaptionsFile(captionsPath);

  await sendMessage(
    chatId,
    `📤 *Mengirim ${mp4Files.length} video dari folder output...*`,
    { parse_mode: 'Markdown' }
  );

  for (let i = 0; i < mp4Files.length; i++) {
    const videoPath = mp4Files[i];
    const fileName = path.basename(videoPath);
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;

    // Cocokkan caption berdasarkan clip number dari nama file
    const clipNum = extractClipNumber(fileName);
    const copyText = clipNum !== null ? captionMap.get(clipNum) : undefined;

    console.log(`[Bot] Mengirim ${fileName} (${formatBytes(fileSize)}) — clipNum=${clipNum}, hasCopy=${!!copyText}`);

    if (fileSize >= TELEGRAM_MAX_VIDEO_SIZE) {
      // ── File terlalu besar: kirim notifikasi + teks copy ──
      const sizeNote = `📦 *${fileName}*\n⚠️ _File terlalu besar (${formatBytes(fileSize)} > 50 MB). Ambil manual di PC Anda._`;
      await sendMessage(chatId, sizeNote, { parse_mode: 'Markdown' });
      if (copyText) {
        await sendMessage(chatId, copyText);
      }
    } else {
      // ── Langkah 1: Kirim video (tanpa caption) ──────────────
      try {
        const videoStream = fs.createReadStream(videoPath);
        await bot.sendVideo(chatId, videoStream, { supports_streaming: true });
        console.log(`[Bot] ✅ ${fileName} berhasil dikirim.`);
      } catch (err: any) {
        console.error(`[Bot] ❌ Gagal mengirim ${fileName}:`, err?.message);
        await sendMessage(
          chatId,
          `⚠️ *Gagal kirim video ${fileName}*\nError: \`${err?.message}\``,
          { parse_mode: 'Markdown' }
        );
      }

      // ── Langkah 2: Kirim copywriting sebagai pesan terpisah ─
      if (copyText) {
        // Prefix label nomor klip agar user tahu teks ini milik video mana
        const labeledText = `🎬 *Klip ${clipNum ?? i + 1}*\n\n${copyText}`;
        // Sedikit jeda agar urutan pesan di Telegram tidak tertukar
        await new Promise(resolve => setTimeout(resolve, 800));
        await sendMessage(chatId, labeledText, { parse_mode: 'Markdown' });
      }
    }

    // Jeda antar klip untuk menghindari Telegram flood limit
    if (i < mp4Files.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  await sendMessage(
    chatId,
    `✅ *Selesai! ${mp4Files.length} video berhasil dikirim.*`,
    { parse_mode: 'Markdown' }
  );
}

// ============================================================
// Core: Jalankan pipeline dan kirim hasilnya ke Telegram
// ============================================================
async function runPipelineAndNotify(url: string, chatId: number): Promise<void> {
  // Import pipeline secara dinamis agar tidak circular dependency
  const { runPipeline } = await import('../run_pipeline.js');

  let result;
  try {
    result = await runPipeline(url);
  } catch (err: any) {
    console.error('[Bot] Pipeline error:', err);
    await sendMessage(
      chatId,
      `❌ *Pipeline Gagal!*\n\nError: \`${err?.message ?? 'Unknown error'}\`\n\nCek terminal untuk detail lengkap.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (!result.success || result.clips.length === 0) {
    await sendMessage(
      chatId,
      `⚠️ *Pipeline selesai, tapi tidak ada klip yang berhasil dirender.*\n\n${result.errorMessage ?? 'AI mungkin tidak menemukan momen viral di video ini.'}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Kirim ringkasan dulu
  await sendMessage(
    chatId,
    `✅ *Pipeline selesai!* Mengirimkan *${result.clips.length} klip* ke grup...\n\n_Mohon tunggu, proses upload bisa memakan waktu beberapa menit._`,
    { parse_mode: 'Markdown' }
  );

  // Kirim semua klip menggunakan helper terpusat sendVideoFiles()
  // (menggunakan OUTPUT_DIR yang sudah berisi file hasil render)
  await sendVideoFiles(chatId, OUTPUT_DIR);

  await sendMessage(
    chatId,
    `🎉 *Pipeline selesai!* Total *${result.clips.length} klip* dari:\n_${url}_`,
    { parse_mode: 'Markdown' }
  );
}

// ============================================================
// Command Listener: /resend
// Kirim ulang semua .mp4 yang ada di folder public/output/
// ============================================================
bot.onText(/^\/resend(@\S+)?$/, async (msg: any) => {
  const chatId: number = msg.chat.id;
  const fromUser: string = msg.from?.username ?? msg.from?.first_name ?? 'Unknown';

  // Security: Whitelist
  if (chatId !== ALLOWED_CHAT_ID) {
    console.warn(`[Bot] /resend dari chat tidak diizinkan (chatId: ${chatId}). Diabaikan.`);
    return;
  }

  console.log(`[Bot] /resend diterima dari @${fromUser}. Membaca folder: ${OUTPUT_DIR}`);

  await sendMessage(
    chatId,
    `🔄 *Mencari video di folder output...*\n_Path: \`${OUTPUT_DIR}\`_`,
    { parse_mode: 'Markdown' }
  );

  try {
    await sendVideoFiles(chatId, OUTPUT_DIR);
  } catch (err: any) {
    console.error('[Bot] Error saat /resend:', err);
    await sendMessage(
      chatId,
      `❌ *Gagal mengirim ulang video.*\nError: \`${err?.message}\``,
      { parse_mode: 'Markdown' }
    );
  }
});

// ============================================================
// Event Listener: Pesan Masuk (YouTube URL detector)
// ============================================================
bot.on('message', async (msg: any) => {
  const chatId: number = msg.chat.id;
  const text: string = msg.text ?? '';
  const fromUser: string = msg.from?.username ?? msg.from?.first_name ?? 'Unknown';

  // ── Security: Whitelist ──────────────────────────────────
  if (chatId !== ALLOWED_CHAT_ID) {
    console.warn(`[Bot] Pesan dari chat tidak diizinkan (chatId: ${chatId}). Diabaikan.`);
    return;
  }

  // ── Abaikan command (sudah ditangani oleh onText di atas) ─
  if (text.startsWith('/')) return;

  // ── Deteksi URL valid (http/https) ───────────────────────
  const matches = text.match(URL_REGEX);
  if (!matches || matches.length === 0) {
    // Bukan link YouTube — abaikan, jangan spam grup
    return;
  }

  const youtubeUrl = matches[0];
  console.log(`[Bot] Link YouTube diterima dari @${fromUser}: ${youtubeUrl}`);

  // ── Concurrency Lock ─────────────────────────────────────
  if (isProcessing) {
    await sendMessage(
      chatId,
      `⏳ *Bot sedang sibuk memproses:*\n\`${processingUrl}\`\n\nSilakan kirim link baru setelah selesai. 🙏`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // ── Mulai Processing ─────────────────────────────────────
  isProcessing = true;
  processingUrl = youtubeUrl;

  await sendMessage(
    chatId,
    `🚀 *Kliper menerima link dari @${fromUser}!*\n\n` +
    `🔗 \`${youtubeUrl}\`\n\n` +
    `_Proses dimulai: transkrip → potong → render → caption..._\n` +
    `_Estimasi: 5–30 menit tergantung durasi video._`,
    { parse_mode: 'Markdown' }
  );

  try {
    await runPipelineAndNotify(youtubeUrl, chatId);
  } catch (err: any) {
    console.error('[Bot] Uncaught error di runPipelineAndNotify:', err);
    await sendMessage(
      chatId,
      `🔥 *Error tidak terduga!*\n\n\`${err?.message ?? err}\`\n\nCek terminal untuk detail.`,
      { parse_mode: 'Markdown' }
    );
  } finally {
    isProcessing = false;
    processingUrl = null;
    console.log('[Bot] 🔓 Lock dibebaskan. Bot siap menerima link baru.');
  }
});

// ============================================================
// Event Listener: Error Polling
// ============================================================
bot.on('polling_error', (err: Error) => {
  console.error('[Bot] Polling error:', err.message);
});

// ============================================================
// Startup
// ============================================================
console.log('');
console.log('  ✂  KLIPER MEDIA AUTONOMOUS — TELEGRAM BOT');
console.log('  ============================================');
console.log(`  Chat ID  : ${ALLOWED_CHAT_ID}`);
console.log('  Mode     : Polling (no server needed)');
console.log('  Status   : ✅ Online — Universal Link Support aktif!');
console.log('  ============================================');
console.log('');
console.log('  💡 Commands:');
console.log('     • Paste URL apapun  → mulai pipeline otomatis');
console.log('     • /resend           → kirim ulang video dari folder output');
console.log(`  📁 Output    : ${OUTPUT_DIR}`);
console.log('');


// Kirim notifikasi ke grup bahwa bot online
(async () => {
  try {
    await bot.sendMessage(
      ALLOWED_CHAT_ID,
      `✅ <b>Kliper Autonomous Bot Online!</b> 🚀\n\nMesin pabrik konten sudah <i>standby</i>.\n\n📌 <b>Cara Pakai:</b>\n🔗 <b>Kirim Link Universal</b> → Paste link dari YouTube, Instagram Reels, TikTok, X (Twitter), atau Twitch. Bot akan otomatis download, memotong klip, menambahkan subtitle Hormozi, dan membuat copywriting!\n🔄 <b>/resend</b> → Kirim ulang semua video &amp; caption hasil render terakhir dari folder tanpa proses ulang.\n\nKirim link video panjang sekarang untuk mulai produksi! 👇`,
      { parse_mode: 'HTML' }
    );
    console.log('[Bot] Notifikasi startup berhasil dikirim ke grup.');
  } catch (err: any) {
    console.warn('[Bot] Gagal mengirim notifikasi startup:', err?.message);
    console.warn('[Bot] Pastikan bot sudah dijadikan Admin di grup!');
  }
})();
