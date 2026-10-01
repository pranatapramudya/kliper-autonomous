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
    return 'MIXED';
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
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

    const prompt = `Analyze these 3 frames from a video. Does the layout consistently show two people side-by-side (SIDE_BY_SIDE), a single centered person (SINGLE_CENTERED), or a mix of wide and tight shots (MIXED)? Return ONLY a strict JSON object: {"layout": "SIDE_BY_SIDE"} (or the other options). No markdown, no extra text.`;

    const promptParts = [
      { text: prompt },
      ...base64Frames.map(b64 => ({
        inlineData: { mimeType: "image/jpeg", data: b64 }
      }))
    ];

    let responseText = '';
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) console.log(`[Vision] Retrying (Attempt ${attempt}/${maxRetries})...`);
        const result = await model.generateContent(promptParts);
        responseText = result.response.text().trim();
        break;
      } catch (error: any) {
        if (attempt === maxRetries) throw error;
        const isRateLimit = error?.message?.includes('429') || error?.status === 429;
        const waitTime = isRateLimit ? 65000 : 5000;
        console.warn(`[Vision] AI Error on attempt ${attempt}: ${error.message || error}. Waiting ${waitTime / 1000} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
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
    console.error(`[Vision] Error detecting layout, defaulting to MIXED:`, error);
    return 'MIXED';
  }
}
