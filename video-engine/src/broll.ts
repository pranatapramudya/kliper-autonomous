import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { execSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

export interface BRollItem {
  videoPath: string;
  sfxPath: string;
  startTime: number;
  duration: number;
}

/**
 * Downloads multiple B-Roll videos and SFX based on the provided time-coded transcript.
 * Returns an array of successfully downloaded BRollItem objects.
 */
export async function downloadBRolls(
  clipWords: any[],
  outputDir: string,
  clipId: number,
  clipDuration: number
): Promise<BRollItem[]> {
  console.log(`[B-Roll] Starting AI B-Roll curation for clip ${clipId}...`);

  const geminiKey = process.env.GEMINI_API_KEY;
  const pexelsKey = process.env.PEXELS_API_KEY;

  if (!geminiKey || !pexelsKey) {
    console.error('[B-Roll] Missing GEMINI_API_KEY or PEXELS_API_KEY. Skipping B-Roll.');
    return [];
  }

  // Generate time-coded transcript context
  const timeCodedText = clipWords.map((w: any) => `[${w.start.toFixed(1)}s] ${w.punctuated_word || w.word}`).join(' ');

  // Generate search keywords using Gemini
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash-lite",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          brolls: {
            type: "array",
            description: "List of B-Rolls and SFX to overlay on the clip.",
            items: {
              type: "object",
              properties: {
                keyword: { type: "string", description: "Pexels search term, max 2 words (e.g. 'falling money')" },
                sfx_keyword: { type: "string", description: "Sound effect search term (e.g. 'cash register', 'swoosh', 'sad violin')" },
                start_time: { type: "number", description: "Exact start time in seconds based on the time-coded text" },
                duration: { type: "number", description: "Duration in seconds (e.g. 2.0 to 4.0)" }
              },
              required: ["keyword", "sfx_keyword", "start_time", "duration"]
            }
          }
        },
        required: ["brolls"]
      } as any
    }
  });

  const prompt = `
Anda adalah seorang Video Editor profesional.
Tugas Anda adalah membaca potongan transkrip video yang dilengkapi stempel waktu (timestamp) berikut.
Tentukan di mana B-Roll (Stock Footage) dan Efek Suara (SFX) harus muncul.

ATURAN:
1. Hasilkan MAKSIMAL 1-2 B-Roll per klip (jika klip pendek <10 detik, cukup 1 B-Roll).
2. 'keyword': Hanya 1-3 kata bahasa Inggris untuk mencari video di Pexels (misal: "money falling", "sad person").
3. 'sfx_keyword': Kata kunci efek suara yang cocok, gunakan bahasa Inggris (misal: "cash register", "whoosh", "heartbeat").
4. 'start_time': Waktu mulai (detik) sesuai timestamp kata terpenting di transkrip. Jangan menumpuk B-Roll di waktu yang sama.
5. 'duration': Durasi B-Roll (biasanya 2.0 - 4.0 detik).

Transkrip Time-Coded:
"${timeCodedText}"
  `;

  let brollDefs: any[] = [];
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[B-Roll] Retrying AI B-Roll generation (Attempt ${attempt}/${maxRetries})...`);
      }
      const result = await model.generateContent(prompt);
      const data = JSON.parse(result.response.text());
      if (data.brolls && Array.isArray(data.brolls)) {
        brollDefs = data.brolls;
        break; // Success, exit retry loop
      }
    } catch (error: any) {
      if (attempt === maxRetries) {
        console.error(`[B-Roll] Failed to generate B-Roll definitions from Gemini after ${maxRetries} attempts:`, error);
        return [];
      }
      const isRateLimit = error?.message?.includes('429') || error?.status === 429;
      const waitTime = isRateLimit ? 65000 : 5000;
      console.warn(`[B-Roll] AI Error on attempt ${attempt}: ${error.message || error}. Waiting ${waitTime / 1000} seconds before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  console.log(`[B-Roll] Gemini suggested ${brollDefs.length} B-Roll(s) for clip ${clipId}.`);

  const downloadedItems: BRollItem[] = [];

  for (let i = 0; i < brollDefs.length; i++) {
    const def = brollDefs[i];
    console.log(`\n  ► Processing B-Roll ${i + 1}/${brollDefs.length}: "${def.keyword}" with SFX "${def.sfx_keyword}" at ${def.start_time}s`);

    // 1. Download Video from Pexels
    let videoUrl: string | null = null;
    try {
      const pexelsUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(def.keyword)}&per_page=5`;
      const pResponse = await fetch(pexelsUrl, { headers: { 'Authorization': pexelsKey } });
      if (pResponse.ok) {
        const pData = await pResponse.json();
        if (pData.videos && pData.videos.length > 0) {
          const video = pData.videos[0];
          const files = video.video_files.sort((a: any, b: any) => b.height - a.height);
          if (files.length > 0) videoUrl = files[0].link;
        }
      }
    } catch (e) {
      console.error(`  [B-Roll] Error fetching Pexels video:`, e);
    }

    if (!videoUrl) {
      console.log(`  [B-Roll] No suitable video found for "${def.keyword}". Skipping this B-Roll.`);
      continue;
    }

    const brollPath = path.join(outputDir, `clip_${clipId}_broll_${i}.mp4`);
    const sfxPath = path.join(outputDir, `clip_${clipId}_sfx_${i}.mp3`);

    try {
      // Cleanup existing files if present
      if (fs.existsSync(brollPath)) fs.unlinkSync(brollPath);
      if (fs.existsSync(sfxPath)) fs.unlinkSync(sfxPath);

      // Download Video File
      const vResponse = await fetch(videoUrl);
      if (vResponse.ok && vResponse.body) {
        const fileStream = fs.createWriteStream(brollPath, { flags: 'wx' });
        // @ts-ignore
        await finished(Readable.fromWeb(vResponse.body).pipe(fileStream));
        console.log(`  ✅ Video downloaded: ${path.basename(brollPath)}`);
      } else {
        throw new Error('Video fetch failed.');
      }

      let sfxSuccess = false;
      try {
        // Generate a crisp, satisfying "UI click/snap" sound effect locally using FFmpeg
        const crispClick = `anoisesrc=d=0.025:c=pink:r=44100:a=1.0,highpass=f=2000,afade=t=out:st=0.005:d=0.02`;
        const whooshCmd = `"${ffmpegInstaller.path}" -f lavfi -i "${crispClick}" -y "${sfxPath}"`;
        execSync(whooshCmd, { stdio: 'ignore' });
        console.log(`  ✅ Transition SFX generated: ${path.basename(sfxPath)}`);
        sfxSuccess = true;
      } catch (sfxErr: any) {
        console.warn(`  ⚠️ Failed to generate transition SFX: ${sfxErr.message.split('\\n')[0]}`);
      }

      downloadedItems.push({
        videoPath: brollPath,
        sfxPath: sfxSuccess ? sfxPath : '',
        startTime: def.start_time,
        duration: def.duration
      });

    } catch (e: any) {
      console.error(`  ❌ Failed to download video for "${def.keyword}":`, e.message);
    }
  }

  return downloadedItems;
}
