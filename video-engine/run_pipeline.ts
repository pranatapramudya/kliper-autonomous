import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';

import { downloadVideo, extractAudio, transcribeAudio } from './src/transcriber.js';
import { curateViralMoments } from './src/curator.js';
import { sliceVideo } from './src/slicer.js';
import { generateCopy, formatCopyAsText, buildTelegramCaption } from './src/copywriter.js';
import { renderClipFFmpeg } from './src/renderer.js';
import { downloadBRolls } from './src/broll.js';
import { detectVideoLayout } from './src/vision.js';
import type { ClipCopy } from './src/copywriter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config();

const PUBLIC_DIR = path.join(__dirname, 'public');
const RAW_DIR = path.join(PUBLIC_DIR, 'raw');
const OUTPUT_DIR = path.join(PUBLIC_DIR, 'output');

[PUBLIC_DIR, RAW_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

process.on('SIGINT', () => {
  console.log("\n🛑 Menerima sinyal pembatalan (Ctrl+C). Membersihkan background process...");
  try {
    execSync('taskkill /F /IM yt-dlp.exe /T', { stdio: 'ignore' });
  } catch (e) { }
  try {
    execSync('taskkill /F /IM ffmpeg.exe /T', { stdio: 'ignore' });
  } catch (e) { }
  process.exit(1);
});

// ============================================================
// Exported types untuk dipakai oleh telegram.ts
// ============================================================
export interface RenderedClip {
  clipId: number;
  title: string;
  outputPath: string;     // Path absolut ke file .mp4 final
  fileSizeBytes: number;
  telegramCaption: string; // Caption sudah diformat, siap kirim ke Telegram
}

export interface PipelineResult {
  success: boolean;
  clips: RenderedClip[];
  copyTextPath?: string;  // Path ke captions_all_clips.txt
  errorMessage?: string;
}

// ============================================================
// Core pipeline — bisa dipanggil dari CLI maupun bot Telegram
// ============================================================
export async function runPipeline(inputSource: string): Promise<PipelineResult> {
  console.log("🚀 STARTING KLIPER AUTONOMOUS PIPELINE...");
  console.log(`   Input: ${inputSource}`);

  const baseVideoPath = path.join(RAW_DIR, 'source_video.mp4');
  const audioPath = path.join(RAW_DIR, 'source_audio.wav');

  // 🗑️  AUTO-CLEAR: Hapus output lama agar tidak menumpuk
  if (fs.existsSync(OUTPUT_DIR)) {
    const oldFiles = fs.readdirSync(OUTPUT_DIR);
    if (oldFiles.length > 0) {
      console.log(`🗑️  Menghapus ${oldFiles.length} file output lama...`);
      fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 🗑️  Bersihkan sisa file raw dari eksekusi sebelumnya
  if (fs.existsSync(RAW_DIR)) {
    fs.rmSync(RAW_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(RAW_DIR, { recursive: true });

  // TAHAP 1: Ingestion & Transcription
  console.log("== [TAHAP 1] INGESTION & TRANSCRIPTION ==");
  try {
    await downloadVideo(inputSource, baseVideoPath);
  } catch (err: any) {
    console.error(`[Pipeline] Batal jalan karena download gagal total:`, err.message);
    return { success: false, clips: [], errorMessage: `Gagal download video dari URL: ${err.message}` };
  }
  await extractAudio(baseVideoPath, audioPath);

  const { words, transcript, uniqueSpeakers } = await transcribeAudio(audioPath);

  // Save transcript for debugging
  fs.writeFileSync(path.join(RAW_DIR, 'transcript.json'), JSON.stringify({ transcript, words }, null, 2));

  // TAHAP 1.5: Vision Layout Analysis
  console.log("== [TAHAP 1.5] AI VISION LAYOUT ANALYSIS ==");
  const layoutFormat = await detectVideoLayout(baseVideoPath);

  // TAHAP 2: AI Curation
  console.log("== [TAHAP 2] AI CURATION ==");

  const CAMPAIGN_BRIEF_PATH = path.join(__dirname, '..', 'campaign_brief.txt');
  let campaignContext: string | undefined = undefined;
  if (fs.existsSync(CAMPAIGN_BRIEF_PATH)) {
    campaignContext = fs.readFileSync(CAMPAIGN_BRIEF_PATH, 'utf-8');
    console.log("== CAMPAIGN BRIEF FOUND ==");
  }

  const { clips, hostSpeakerId } = await curateViralMoments(transcript, campaignContext, uniqueSpeakers);

  // AUTO-MAPPING: Pastikan Host (berdasarkan analisa AI) selalu menjadi Speaker 0
  if (hostSpeakerId !== undefined && hostSpeakerId !== 0) {
    console.log(`🔄 [Auto-Mapping] AI mendeteksi Speaker ${hostSpeakerId} sebagai Host. Mengubahnya menjadi Speaker 0...`);
    words.forEach((w: any) => {
      if (w.speaker === hostSpeakerId) w.speaker = 0;
      else if (w.speaker === 0) w.speaker = hostSpeakerId;
    });
    clips.forEach(c => {
      if (c.dominant_speaker === hostSpeakerId) c.dominant_speaker = 0;
      else if (c.dominant_speaker === 0) c.dominant_speaker = hostSpeakerId;
    });
  }

  if (clips.length === 0) {
    console.log("⚠️ No viral moments found by AI. Exiting.");
    return { success: false, clips: [], errorMessage: 'AI tidak menemukan momen viral di video ini.' };
  }

  fs.writeFileSync(path.join(RAW_DIR, 'curated_clips.json'), JSON.stringify(clips, null, 2));

  console.log(`\n======================================================`);
  console.log(`🎯 AI Kliper memutuskan untuk mengekstrak ${clips.length} klip viral!`);
  console.log(`======================================================\n`);

  // TAHAP 3: Slicing
  console.log("== [TAHAP 3] FFmpeg SLICING ==");

  const targetClips = clips;
  const renderedClips: RenderedClip[] = [];

  for (const clip of targetClips) {
    console.log(`\n--- Processing Clip ${clip.id}: "${clip.title}" ---`);

    // ═══════════════════════════════════════════════════════════════
    // SENTENCE-SNAP: Cari akhir kalimat terdekat supaya tidak
    // terpotong di tengah omongan.
    // ═══════════════════════════════════════════════════════════════
    const SENTENCE_ENDINGS = /[.?!。？！]$/;
    const SEARCH_WINDOW = 5; // cari sampai 5 detik setelah end_time

    // --- Snap END ke akhir kalimat ---
    let snappedEnd = clip.end_time;
    const wordsNearEnd = words.filter(
      (w: any) => w.end >= clip.end_time && w.end <= clip.end_time + SEARCH_WINDOW
    );
    const sentenceEndWord = wordsNearEnd.find(
      (w: any) => SENTENCE_ENDINGS.test((w.punctuated_word || w.word).trim())
    );
    if (sentenceEndWord) {
      snappedEnd = sentenceEndWord.end + 0.5;
      console.log(`   📌 End snapped: ${clip.end_time}s → ${snappedEnd.toFixed(1)}s (sentence boundary: "${sentenceEndWord.punctuated_word || sentenceEndWord.word}")`);
    } else {
      const wordsAfterEnd = words.filter(
        (w: any) => w.start >= clip.end_time && w.start <= clip.end_time + SEARCH_WINDOW
      );
      let longestGap = 0;
      let bestGapEnd = clip.end_time + 1.5;
      for (let i = 0; i < wordsAfterEnd.length - 1; i++) {
        const gap = wordsAfterEnd[i + 1].start - wordsAfterEnd[i].end;
        if (gap > longestGap) {
          longestGap = gap;
          bestGapEnd = wordsAfterEnd[i].end + 0.3;
        }
      }
      snappedEnd = bestGapEnd;
      console.log(`   📌 End snapped (gap-based): ${clip.end_time}s → ${snappedEnd.toFixed(1)}s (longest pause: ${longestGap.toFixed(2)}s)`);
    }

    // --- Snap START ke awal kalimat ---
    let snappedStart = Math.max(0, clip.start_time - 0.3);
    const wordsBeforeStart = words.filter(
      (w: any) => w.end >= clip.start_time - SEARCH_WINDOW && w.end <= clip.start_time
    );
    const lastSentenceEnd = wordsBeforeStart
      .reverse()
      .find((w: any) => SENTENCE_ENDINGS.test((w.punctuated_word || w.word).trim()));
    if (lastSentenceEnd) {
      const wordAfterSentence = words.find((w: any) => w.start > lastSentenceEnd.end);
      if (wordAfterSentence && wordAfterSentence.start <= clip.start_time + 1) {
        snappedStart = Math.max(0, wordAfterSentence.start - 0.2);
        console.log(`   📌 Start snapped: ${clip.start_time}s → ${snappedStart.toFixed(1)}s (after: "${lastSentenceEnd.punctuated_word || lastSentenceEnd.word}")`);
      }
    }

    const paddedClip = { ...clip, start_time: snappedStart, end_time: snappedEnd };
    console.log(`   ⏱️  Final clip: ${snappedStart.toFixed(1)}s → ${snappedEnd.toFixed(1)}s (${(snappedEnd - snappedStart).toFixed(1)}s)`);

    // Slice video
    await sliceVideo(baseVideoPath, paddedClip, RAW_DIR);

    // Filter timestamps for this padded clip
    const clipWords = words
      .filter((w: any) => w.start >= paddedClip.start_time && w.end <= paddedClip.end_time)
      .map((w: any) => ({
        ...w,
        start: w.start - paddedClip.start_time,
        end: w.end - paddedClip.start_time
      }));

    // Save props for Remotion
    const propsPath = path.join(RAW_DIR, `props_clip_${clip.id}.json`);
    const props = {
      clipVideoUrl: `/raw/clip_${clip.id}.mp4`,
      words: clipWords,
      title: clip.title,
      ctaText: campaignContext ? "Follow for More!" : undefined,
      uniqueSpeakers: uniqueSpeakers ?? 1,
      dominantSpeaker: clip.dominant_speaker ?? 0,
      clipDuration: paddedClip.end_time - paddedClip.start_time,
    };
    fs.writeFileSync(propsPath, JSON.stringify(props, null, 2));

    // TAHAP 3.5: AI B-ROLL CURATION
    console.log("== [TAHAP 3.5] AI B-ROLL CURATION ==");
    const brolls = await downloadBRolls(clipWords, RAW_DIR, clip.id, paddedClip.end_time - paddedClip.start_time);

    // TAHAP 4: FFmpeg Rendering
    console.log("== [TAHAP 4] FFmpeg RENDERING ==");
    const finalOutputPath = path.join(OUTPUT_DIR, `clip_${clip.id}_ready.mp4`);
    const assPath = path.join(RAW_DIR, `clip_${clip.id}.ass`);
    const slicedVideoPath = path.join(RAW_DIR, `clip_${clip.id}.mp4`);

    console.log(`🎬 Rendering clip ${clip.id} via FFmpeg...`);
    try {
      await renderClipFFmpeg({
        slicedVideoPath,
        outputPath: finalOutputPath,
        words: clipWords,
        title: clip.title,
        uniqueSpeakers: uniqueSpeakers ?? 1,
        dominantSpeaker: clip.dominant_speaker ?? 0,
        clipDuration: paddedClip.end_time - paddedClip.start_time,
        assPath,
        brolls: brolls,
        layoutFormat,
      });
      console.log(`✅ Final clip ready: ${finalOutputPath}`);

      // Catat clip yang berhasil dirender (caption akan diisi di Tahap 5)
      if (fs.existsSync(finalOutputPath)) {
        const stat = fs.statSync(finalOutputPath);
        renderedClips.push({
          clipId: clip.id,
          title: clip.title,
          outputPath: finalOutputPath,
          fileSizeBytes: stat.size,
          telegramCaption: '', // diisi setelah copywriting
        });
      }
    } catch (err) {
      console.error(`❌ Render failed for clip ${clip.id}`, err);
    }
  }

  // TAHAP 5: Generate Captions & Hashtags
  console.log("== [TAHAP 5] AI COPYWRITING — CAPTION & HASHTAG ==");
  let copyTextPath: string | undefined;
  try {
    const clipTranscripts: Record<number, string> = {};
    for (const clip of targetClips) {
      const clipWords = words
        .filter((w: any) => w.start >= clip.start_time && w.end <= clip.end_time)
        .map((w: any) => w.punctuated_word || w.word)
        .join(' ');
      clipTranscripts[clip.id] = clipWords;
    }

    const copies = await generateCopy(targetClips, clipTranscripts, campaignContext);
    const copyText = formatCopyAsText(copies);

    copyTextPath = path.join(OUTPUT_DIR, 'captions_all_clips.txt');
    fs.writeFileSync(copyTextPath, copyText, 'utf-8');
    console.log(`📋 Caption & hashtag siap copy-paste: ${copyTextPath}`);

    // Tempelkan telegramCaption ke setiap renderedClip
    for (const rc of renderedClips) {
      const copy = copies.find((c: ClipCopy) => c.clipId === rc.clipId);
      if (copy) {
        rc.telegramCaption = buildTelegramCaption(copy);
      } else {
        // Fallback minimal jika copy tidak ditemukan
        rc.telegramCaption = `🎬 KLIPER — CLIP #${rc.clipId}\n📌 ${rc.title}`;
      }
    }
  } catch (err) {
    console.error(`⚠️ Copywriting gagal (caption tidak dibuat):`, err);
    // Isi fallback caption agar bot Telegram tetap bisa mengirim
    for (const rc of renderedClips) {
      rc.telegramCaption = `🎬 KLIPER — CLIP #${rc.clipId}\n📌 ${rc.title}`;
    }
  }

  // TAHAP 6: Cleanup
  console.log("== [TAHAP 6] CLEANUP ==");
  try {
    fs.rmSync(RAW_DIR, { recursive: true, force: true });
    console.log(`🧹 Berhasil membersihkan file mentah sementara (cache video & audio)`);
  } catch (e) {
    console.error("⚠️ Gagal membersihkan file mentah:", e);
  }

  console.log("🎉 PIPELINE FINISHED SUCCESSFULLY.");
  console.log(`\n📁 Output folder: ${OUTPUT_DIR}`);
  console.log(`   • clip_N_ready.mp4  → klip video siap upload`);
  console.log(`   • captions_all_clips.txt → caption & hashtag semua platform\n`);

  return { success: true, clips: renderedClips, copyTextPath };
}

// ============================================================
// CLI Entry Point — tetap bisa dijalankan via klip.ps1
// ============================================================
const cliInput = process.argv[2];
if (cliInput) {
  runPipeline(cliInput)
    .then(() => {
      console.log('✅ Kliper pipeline process finished cleanly.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('💥 Pipeline fatal error:', err);
      process.exit(1);
    });
}
