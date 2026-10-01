/**
 * renderer.ts — FFmpeg-based renderer (replaces Remotion)
 *
 * Menggunakan FFmpeg + ASS Karaoke subtitles untuk render
 * 10-20x lebih cepat dari pendekatan Remotion/Chromium.
 *
 * Fitur yang dipertahankan:
 * - Karaoke subtitle per-speaker (warna berbeda)
 * - Hook overlay title (3.5 detik pertama)
 * - Watermark KLIPER MEDIA
 * - 9:16 center-crop
 * - Speaker-aware colors
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import { BRollItem } from './broll.js';
import { VideoLayout } from './vision.js';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface WordForRender {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number;
}

// ─── ASS color helper ─────────────────────────────────────────────────────────
// ASS format: &HAABBGGRR  (AA=alpha, 00=opaque; BB=blue; GG=green; RR=red)
function toASS(r: number, g: number, b: number, alpha = 0): string {
  const a = alpha.toString(16).padStart(2, '0').toUpperCase();
  const rr = r.toString(16).padStart(2, '0').toUpperCase();
  const gg = g.toString(16).padStart(2, '0').toUpperCase();
  const bb = b.toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${bb}${gg}${rr}`;
}

// Active (highlighted) word color per speaker
const ACTIVE_COLOR = [
  toASS(0, 242, 254),        // SP0 HOST   → cyan neon
  toASS(255, 184, 0),        // SP1 GUEST1 → orange
  toASS(255, 46, 150),       // SP2 GUEST2 → pink neon
  toASS(196, 0, 255),        // SP3        → purple
  toASS(0, 255, 136),        // SP4        → green
];

// Dim color (upcoming word, before being spoken)
const DIM_COLOR = [
  toASS(255, 255, 255, 140), // SP0 → dim white
  toASS(255, 224, 51, 140),  // SP1 → dim yellow
  toASS(0, 242, 254, 140),   // SP2 → dim cyan
  toASS(196, 0, 255, 140),   // SP3 → dim purple
  toASS(0, 255, 136, 140),   // SP4 → dim green
];

const SPEAKER_LABELS = ['HOST', 'GUEST 1', 'GUEST 2', 'GUEST 3', 'GUEST 4'];

// ─── ASS time formatter ───────────────────────────────────────────────────────
function t(sec: number): string {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// ─── Escape special ASS characters ───────────────────────────────────────────
function esc(text: string): string {
  return text.replace(/\\/g, '').replace(/\{/g, '').replace(/\}/g, '').replace(/\n/g, ' ').trim();
}

// ─── Generate ASS subtitle file ───────────────────────────────────────────────
export function generateASS(
  words: WordForRender[],
  title: string,
  uniqueSpeakers: number,
  clipDuration: number,
): string {
  const numSP = Math.max(uniqueSpeakers, 1);

  // ── Styles ──
  let styles = 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n';

  // Hook title — professional dark card background box (alignment 8 = top center, BorderStyle 3 = opaque box)
  styles += `Style: Hook,Arial,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&HD9141414,-1,0,0,0,100,100,1,0,3,20,0,8,60,60,180,1\n`;

  // Watermark — bottom center (alignment 2)
  // MarginV=280 to clear bottom UI (playbar/captions). Color = White and Gray (3D effect).
  styles += `Style: Wm,Arial,36,${toASS(255, 255, 255, 80)},${toASS(255, 255, 255, 80)},${toASS(150, 150, 150, 80)},${toASS(0, 0, 0, 150)},-1,0,0,0,100,100,8,0,1,2,3,2,20,20,280,1\n`;

  // Speaker badge — top left (alignment 7)
  // MarginV is set to 200 to clear top UI overlays on TikTok/Reels
  styles += `Style: Badge,Arial,28,&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,-1,0,0,0,100,100,2,0,1,3,2,7,50,20,200,1\n`;

  // Per-speaker karaoke subtitle styles (alignment 2 = bottom-center)
  // MarginV is set to 750 (video height is 1920) so it appears slightly below the middle center
  for (let s = 0; s < Math.max(numSP, 5); s++) {
    const primary = ACTIVE_COLOR[s] ?? ACTIVE_COLOR[0];
    const secondary = DIM_COLOR[s] ?? DIM_COLOR[0];
    styles += `Style: SP${s},Arial,70,${primary},${secondary},&H00000000,&HCC000000,-1,0,0,0,100,100,0,0,1,5,4,2,40,40,750,1\n`;
  }

  // ── Events ──
  let events = 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';

  // Hook overlay — first 3.5 seconds (layer 10)
  const hookText = esc(title);
  events += `Dialogue: 10,${t(0)},${t(3.5)},Hook,,0,0,0,,{\\fscx85\\fscy85\\c&H0000F5FF&}⚡ KLIPER MEDIA | HIGHLIGHT\\N{\\r}${hookText}\n`;

  // Watermark — full duration after hook (layer 5)
  events += `Dialogue: 5,${t(3.5)},${t(clipDuration + 10)},Wm,,0,0,0,,KLIPER MEDIA\n`;

  // Speaker badge — track active speaker accurately for instant transitions (layer 6)
  const badgeSegments: { start: number; end: number; spk: number }[] = [];
  if (words.length > 0) {
    let currentSpk = words[0].speaker ?? 0;
    let currentStart = words[0].start;
    
    for (let i = 1; i < words.length; i++) {
      const spk = words[i].speaker ?? 0;
      if (spk !== currentSpk) {
        badgeSegments.push({ start: currentStart, end: words[i].start, spk: currentSpk });
        currentStart = words[i].start;
        currentSpk = spk;
      }
    }
    badgeSegments.push({ start: currentStart, end: words[words.length - 1].end, spk: currentSpk });
  }
  // Stitch: each segment ends exactly where the next one starts (no gap → no flicker)
  for (let i = 0; i < badgeSegments.length; i++) {
    const seg = badgeSegments[i];
    const segEnd = i < badgeSegments.length - 1
      ? badgeSegments[i + 1].start   // connect seamlessly to next segment
      : clipDuration + 1;             // last segment → hold until clip ends
    const label = SPEAKER_LABELS[seg.spk] ?? `SPEAKER ${seg.spk}`;
    const badgeColor = ACTIVE_COLOR[seg.spk] ?? ACTIVE_COLOR[0];
    const actualStart = Math.max(seg.start, 3.5);
    if (actualStart < segEnd) {
      events += `Dialogue: 6,${t(actualStart)},${t(segEnd)},Badge,,0,0,0,,{\\1c${badgeColor}\\bord3}● ${label}\n`;
    }
  }

  // Hormozi subtitles — 1-word chunks with pop-up animation (layer 0)
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const nextW = words[i + 1];
    const wordText = esc(w.punctuated_word || w.word);
    const spk = w.speaker ?? 0;
    const spkStyle = `SP${Math.min(spk, 4)}`;

    // Hormozi bounce: start at 50%, scale to 110% over 80ms, then back to 100% over 150ms
    const anim = `{\\fscx50\\fscy50\\t(0,80,\\fscx115\\fscy115)\\t(80,150,\\fscx100\\fscy100)}`;

    // Prevent overlapping if they speak very fast
    let endT = w.end + 0.15; // Give it 150ms tail so bounce finishes
    if (nextW && endT > nextW.start) {
      endT = nextW.start; // Cut it exactly when the next word starts
    }

    events += `Dialogue: 0,${t(w.start)},${t(endT)},${spkStyle},,0,0,0,,${anim}${wordText}\n`;
  }

  return `[Script Info]
Title: Kliper Media Clip
ScriptType: v4.00+
WrapStyle: 1
ScaledBorderAndShadow: yes
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
${styles}
[Events]
${events}`;
}

// ─── FFmpeg render ────────────────────────────────────────────────────────────
export async function renderClipFFmpeg(params: {
  slicedVideoPath: string;
  outputPath: string;
  words: WordForRender[];
  title: string;
  uniqueSpeakers: number;
  dominantSpeaker: number;
  clipDuration: number;
  assPath: string;
  brolls?: BRollItem[];
  layoutFormat?: VideoLayout;
}): Promise<void> {
  const { slicedVideoPath, outputPath, words, title, uniqueSpeakers, clipDuration, assPath, brolls, layoutFormat = 'MIXED' } = params;

  // Write ASS file
  const assContent = generateASS(words, title, uniqueSpeakers, clipDuration);
  fs.writeFileSync(assPath, assContent, 'utf-8');

  // Escape the ASS path for FFmpeg filter on Windows:
  const assPathFilter = assPath
    .replace(/\\/g, '/')
    .replace(/^([a-zA-Z]):/, '$1\\:');

  return new Promise((resolve, reject) => {
    let command = ffmpeg(slicedVideoPath);

    if (brolls && brolls.length > 0) {
      let filterChain: string[] = [];
      let currentOut = 'main';

      const colorGrade = `eq=saturation=1.2:contrast=1.05,unsharp=5:5:1.0:5:5:0.0`;
      let bgFilter = '';

      // --- NO ZOOM JITTER (Static crisp layout) ---
      if (layoutFormat === 'SIDE_BY_SIDE') {
        bgFilter = `[0:v]split=2[left][right];[left]crop=iw/2:ih:0:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[top];[right]crop=iw/2:ih:iw/2:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[bottom];[top][bottom]vstack=inputs=2,${colorGrade}[${currentOut}]`;
      } else if (layoutFormat === 'SINGLE_CENTERED') {
        bgFilter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${colorGrade}[${currentOut}]`;
      } else {
        // MIXED / default
        bgFilter = `[0:v]split=2[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:20,eq=brightness=-0.1[bg_blurred];[fg]scale=1080:-2[fg_scaled];[bg_blurred][fg_scaled]overlay=0:(H-h)/2,${colorGrade}[${currentOut}]`;
      }
      
      filterChain.push(bgFilter);

      // Add each B-Roll input and filter
      brolls.forEach((broll, index) => {
        command = command.input(broll.videoPath).inputOptions(['-stream_loop', '-1', '-an']);
        const inputIdx = index + 1; // [0:v] is main, [1:v] is first B-roll
        const brollScaled = `broll${inputIdx}_scaled`;
        const nextOut = `main${inputIdx}`;

        // B-Roll formatting + Crossfade Alpha (0.3s fade in, 0.3s fade out)
        const fadeFilter = `fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=${broll.duration - 0.3}:d=0.3:alpha=1`;
        // Apply fade FIRST while timestamps are at 0, THEN offset the entire stream to broll.startTime
        filterChain.push(`[${inputIdx}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuva420p,${fadeFilter},setpts=PTS-STARTPTS+${broll.startTime}/TB[${brollScaled}]`);

        // Overlay using eof_action=pass
        filterChain.push(`[${currentOut}][${brollScaled}]overlay=enable='between(t,${broll.startTime},${broll.startTime + broll.duration})':eof_action=pass[${nextOut}]`);
        currentOut = nextOut;
      });

      // Add ASS subtitles on top of everything
      filterChain.push(`[${currentOut}]ass='${assPathFilter}'[outv]`);

      // Handle Audio SFX
      let audioMixFilter = '';
      const sfxCount = brolls.filter(b => b.sfxPath).length;

      if (sfxCount > 0) {
        // Boost dan kompresi suara Host/Guest agar rata dan kencang ala TikTok (-14 LUFS)
        filterChain.push(`[0:a]loudnorm=I=-14:TP=-1.0:LRA=11,volume=1.2[main_a]`);
        let audioInputs = ['[main_a]'];
        let sfxInputIdx = brolls.length + 1; // Audio inputs start after all video inputs

        brolls.forEach((broll, index) => {
          if (broll.sfxPath) {
            command = command.input(broll.sfxPath);
            const sfxOut = `sfx${index}`;
            const startMs = Math.round(broll.startTime * 1000);
            // Turunkan volume SFX jadi 0.3 agar tidak menutupi suara orang bicara
            filterChain.push(`[${sfxInputIdx}:a]atrim=0:${broll.duration},asetpts=PTS-STARTPTS,adelay=${startMs}|${startMs},apad,volume=0.3[${sfxOut}]`);
            audioInputs.push(`[${sfxOut}]`);
            sfxInputIdx++;
          }
        });

        // Mix semua audio. Karena amix otomatis menurunkan volume sebesar 1/N, kita kalikan kembali dengan N
        audioMixFilter = `${audioInputs.join('')}amix=inputs=${audioInputs.length}:duration=first:dropout_transition=0,volume=${audioInputs.length}[outa]`;
        filterChain.push(audioMixFilter);
      } else {
        filterChain.push(`[0:a]loudnorm=I=-14:TP=-1.0:LRA=11,volume=1.2[outa]`);
      }

      command = command.complexFilter(filterChain);
      command = command.outputOptions(['-map [outv]', '-map [outa]']);

    } else {
      // ─── NO B-ROLLS BRANCH ───
      let filterChain: string[] = [];
      const colorGrade = `eq=saturation=1.2:contrast=1.05,unsharp=5:5:1.0:5:5:0.0`;
      let bgFilter = '';

      // --- NO ZOOM JITTER (Static crisp layout) ---
      if (layoutFormat === 'SIDE_BY_SIDE') {
        bgFilter = `[0:v]split=2[left][right];[left]crop=iw/2:ih:0:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[top];[right]crop=iw/2:ih:iw/2:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[bottom];[top][bottom]vstack=inputs=2,${colorGrade},ass='${assPathFilter}'[outv]`;
      } else if (layoutFormat === 'SINGLE_CENTERED') {
        bgFilter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${colorGrade},ass='${assPathFilter}'[outv]`;
      } else {
        // MIXED / default
        bgFilter = `[0:v]split=2[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:20,eq=brightness=-0.1[bg_blurred];[fg]scale=1080:-2[fg_scaled];[bg_blurred][fg_scaled]overlay=0:(H-h)/2,${colorGrade},ass='${assPathFilter}'[outv]`;
      }
      
      filterChain.push(bgFilter);

      // Boost and normalize the main audio
      filterChain.push(`[0:a]loudnorm=I=-14:TP=-1.0:LRA=11,volume=1.2[outa]`);

      command = command.complexFilter(filterChain);
      command = command.outputOptions(['-map [outv]', '-map [outa]']);
    }

    command
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset fast',
        '-crf 22',
        '-b:a 128k',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-r 60',
      ])
      .output(outputPath)
      .on('start', (cmd) => console.log(`[Renderer] 🚀 FFmpeg started\n  CMD: ${cmd}`))
      .on('stderr', (line) => {
        // Log only error-level lines from FFmpeg stderr for easier debugging
        if (line.includes('Error') || line.includes('Invalid') || line.includes('No such')) {
          console.error(`[Renderer][ffmpeg] ${line}`);
        }
      })
      .on('end', () => {
        console.log(`[Renderer] ✅ Done: ${outputPath}`);
        resolve();
      })
      .on('error', (err, stdout, stderr) => {
        console.error('[Renderer] ❌ Error:', err.message);
        if (stderr) {
          // Print last 20 lines of stderr for diagnosis
          const lines = stderr.trim().split('\n');
          console.error('[Renderer] FFmpeg stderr (last 20 lines):\n' + lines.slice(-20).join('\n'));
        }
        reject(err);
      })
      .run();
  });
}
