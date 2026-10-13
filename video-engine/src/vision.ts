import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { GoogleGenerativeAI } from '@google/generative-ai';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type VideoLayout = 'SIDE_BY_SIDE' | 'SINGLE_CENTERED' | 'MIXED';

export async function detectVideoLayout(videoPath: string): Promise<VideoLayout> {
  console.log(`[Vision] Analyzing video layout for optimal framing...`);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Vision] GEMINI_API_KEY not defined, defaulting to MIXED layout.');
    return 'SINGLE_CENTERED';
  }

  try {
    // 1. Get video duration
    const duration = await new Promise<number>((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata.format.duration || 60); // Default to 60s if unknown
      });
    });

    // 2. Extract 3 frames (25%, 50%, 75%)
    const framePaths: string[] = [];
    const base64Frames: string[] = [];
    const timestamps = [duration * 0.25, duration * 0.50, duration * 0.75];

    for (let i = 0; i < timestamps.length; i++) {
      const framePath = path.join(__dirname, '..', 'public', 'raw', `layout_frame_${i}_${Date.now()}.jpg`);
      framePaths.push(framePath);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(videoPath)
          .seekInput(timestamps[i])
          .outputOptions(['-vframes 1', '-q:v 2'])
          .output(framePath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });

      const imageBuffer = fs.readFileSync(framePath);
      base64Frames.push(imageBuffer.toString('base64'));
      fs.unlinkSync(framePath); // Clean up immediately
    }

    // 3. Send to Gemini 3.5 Flash Vision
    console.log(`[Vision] Analyzing 3 frames with Gemini 3.5 Flash Vision...`);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

    const prompt = `Analyze these 3 frames from a video for short-form vertical video (TikTok/Reels 9:16).
We need the best layout to maximize watch time and avoid ugly letterbox black/blurry bars:
- SIDE_BY_SIDE: If two people are visible in a podcast table / discussion setup (we will split top/bottom so both faces are close-up and vertical).
- SINGLE_CENTERED: If a single person/speaker is prominent or centered (we will crop to full-screen vertical portrait).
- MIXED: Only if the video is extremely chaotic multicam where neither format fits.

IMPORTANT: Strongly prefer SINGLE_CENTERED or SIDE_BY_SIDE so the screen is completely filled vertically with human faces and expressions.
Return ONLY a strict JSON object: {"layout": "SINGLE_CENTERED"} (or "SIDE_BY_SIDE" or "MIXED"). No markdown, no extra text.`;

    const promptParts = [
      { text: prompt },
      ...base64Frames.map(b64 => ({
        inlineData: { mimeType: "image/jpeg", data: b64 }
      }))
    ];

    let responseText = '';
    try {
      const result = await model.generateContent(promptParts);
      responseText = result.response.text().trim();
    } catch (error: any) {
      console.warn(`[Vision] Vision API not responding (${error.message || error}), fast-fallback to SINGLE_CENTERED.`);
      return 'SINGLE_CENTERED';
    }
    // Clean response just in case
    const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

    let layout: VideoLayout = 'MIXED';
    try {
      const data = JSON.parse(cleanText);
      if (data.layout && ['SIDE_BY_SIDE', 'SINGLE_CENTERED', 'MIXED'].includes(data.layout)) {
        layout = data.layout as VideoLayout;
      }
    } catch (e) {
      console.warn(`[Vision] Failed to parse JSON from Gemini: ${responseText}. Defaulting to MIXED.`);
    }

    console.log(`[Vision] AI determined optimal layout: ${layout}`);
    return layout;

  } catch (error) {
    console.error(`[Vision] Error detecting layout, defaulting to SINGLE_CENTERED:`, error);
    return 'MIXED';
  }
}
