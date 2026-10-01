import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { ClipData } from './curator.js';

// Configure ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Slices the original video based on curated clip timings.
 */
export async function sliceVideo(
  videoPath: string, 
  clip: ClipData, 
  outputDir: string
): Promise<string> {
  const outputPath = path.join(outputDir, `clip_${clip.id}.mp4`);
  
  console.log(`[Slicer] Slicing video to generate clip ${clip.id} (from ${clip.start_time}s to ${clip.end_time}s)...`);
  
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .inputOptions([
        `-ss ${clip.start_time}`
      ])
      .setDuration(clip.end_time - clip.start_time)
      .output(outputPath)
      // Use original codec or copy for fast slicing. However, to ensure accurate slicing sometimes we need to re-encode,
      // but re-encoding is slower. We will use fast copy first, if it fails or inaccurate, we can switch to re-encoding.
      // -c copy is extremely fast but might not cut exactly at keyframes depending on the source.
      // For accurate cutting in Remotion (where precision matters for subtitles), we might need to re-encode.
      // Let's re-encode with high quality and fast preset to ensure frame accuracy.
      .addOutputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2', // Ensure even dimensions for Chromium compatibility
        '-c:a aac',
        '-preset fast',
        '-crf 23',
        '-movflags +faststart',
        '-r 60'
      ])
      .on('end', () => {
        console.log(`[Slicer] Slice complete: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error(`[Slicer] Error slicing video for clip ${clip.id}:`, err);
        reject(err);
      })
      .run();
  });
}
