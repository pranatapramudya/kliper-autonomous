import fs from 'fs';
import youtubedl from 'youtube-dl-exec';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { DeepgramClient } from '@deepgram/sdk';

// Configure ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Download a video from a URL (e.g., YouTube) to the specified output path.
 * If the URL is already a local path, it will just copy it.
 */
export async function downloadVideo(url: string, outputPath: string): Promise<string> {
  console.log(`[Transcriber] Downloading video from ${url}...`);

  let localPath = url;
  // Jika tidak ditemukan di video-engine/, cek di root folder (karena klip.ps1 pindah CWD)
  if (!fs.existsSync(localPath) && fs.existsSync(`../${url}`)) {
    localPath = `../${url}`;
  }

  if (fs.existsSync(localPath)) {
    console.log(`[Transcriber] Source is a local file (${localPath}). Copying to ${outputPath}...`);
    fs.copyFileSync(localPath, outputPath);
    return outputPath;
  }

  // Bypass YouTube bot checks if we already downloaded the video previously
  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    if (stats.size > 1024 * 1024) { // > 1MB
      console.log(`[Transcriber] Source video already exists in raw folder. Skipping download to prevent bot blocks...`);
      return outputPath;
    }
  }

  const maxRetries = 4;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Attempt 1: Bypass bot checks using iOS/Android clients without cookies
      // Attempt 2: Chrome cookies
      // Attempt 3: Edge cookies
      // Attempt 4: Manual cookies.txt
      const options: any = {
        output: outputPath,
        format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4',
        noCheckCertificates: true,
        noWarnings: true,
        ffmpegLocation: ffmpegInstaller.path,
        jsRuntimes: 'node',
        sleepRequests: 2
      };
      
      if (attempt === 2) {
        options.cookiesFromBrowser = 'chrome';
        console.log('[Transcriber] Attempting to bypass bot check using Chrome cookies...');
      } else if (attempt === 3) {
        options.cookiesFromBrowser = 'edge';
        console.log('[Transcriber] Attempting to bypass bot check using Edge cookies...');
      } else if (attempt === 4) {
        options.cookies = 'cookies.txt';
        console.log('[Transcriber] Attempting to bypass bot check using cookies.txt...');
      }
      await youtubedl(url, options);
      break; // Success
    } catch (error: any) {
      // Check if the final file somehow exists already (sometimes yt-dlp succeeds but still throws)
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 1024 * 1024) {
          console.log(`[Transcriber] Output file already exists and is >1MB despite error. Proceeding...`);
          break;
        }
      }

      // Check if the temp file was created but failed to rename
      const tempPath = outputPath.replace('.mp4', '.temp.mp4');
      if (fs.existsSync(tempPath)) {
        console.log(`[Transcriber] Found locked temp file ${tempPath}. Attempting manual rename...`);
        try {
          // Wait a bit to let file handles be released
          await new Promise(res => setTimeout(res, 3000));
          fs.renameSync(tempPath, outputPath);
          console.log(`[Transcriber] Successfully renamed temp file. Proceeding...`);
          break; // <--- INI KUNCI, KITA ANGGAP SUKSES!
        } catch (renameErr) {
          console.error(`[Transcriber] Manual rename failed:`, renameErr);
          if (attempt === maxRetries) throw error;
        }
      } else {
        console.error(`[Transcriber] yt-dlp encountered an error on attempt ${attempt}.`);
        if (error.stderr) console.error(`[Transcriber] Details: ${error.stderr.split('\n')[0].substring(0, 150)}...`);
        if (attempt === maxRetries) throw error;
        console.log(`[Transcriber] Retrying download in 3 seconds...`);
        await new Promise(res => setTimeout(res, 3000));
      }
    }
  }

  console.log(`[Transcriber] Download complete: ${outputPath}`);
  return outputPath;
}

/**
 * Extract audio from a video file, saving it as a WAV file.
 */
export async function extractAudio(videoPath: string, audioOutputPath: string): Promise<string> {
  console.log(`[Transcriber] Extracting audio from ${videoPath}...`);
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioOutputPath)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('end', () => {
        console.log(`[Transcriber] Audio extraction complete: ${audioOutputPath}`);
        resolve(audioOutputPath);
      })
      .on('error', (err) => {
        console.error(`[Transcriber] Audio extraction failed:`, err);
        reject(err);
      })
      .run();
  });
}

/**
 * Transcribe an audio file using Deepgram to get word-level timestamps
 * with speaker diarization (who said what).
 */
export async function transcribeAudio(audioPath: string): Promise<any> {
  console.log(`[Transcriber] Transcribing audio with Deepgram (Speaker Diarization ON)...`);
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY is not defined in .env');
  }

  const deepgram = new DeepgramClient({
    apiKey,
    timeoutInSeconds: 3600 // 1 hour timeout for large podcast files
  });

  const result = await deepgram.listen.v1.media.transcribeFile(
    fs.readFileSync(audioPath),
    {
      model: "nova-2",
      language: "id",
      smart_format: true,
      encoding: "linear16",
      sample_rate: 16000,
      diarize: true,       // 🎙️ Speaker diarization — tau siapa yang ngomong
      utterances: true,    // 📝 Group kata per giliran bicara
      punctuate: true,     // ✍️  Tambah tanda baca otomatis
    } as any
  ) as any;

  const rawWords = result?.results?.channels[0]?.alternatives[0]?.words || [];
  const transcript = result?.results?.channels[0]?.alternatives[0]?.transcript || "";

  // Normalize words — pastikan speaker field selalu ada
  const words = rawWords.map((w: any) => ({
    word: w.word,
    punctuated_word: w.punctuated_word || w.word,
    start: w.start,
    end: w.end,
    speaker: w.speaker ?? 0, // default ke speaker 0 jika tidak ada diarization
    confidence: w.confidence ?? 1,
  }));

  // Hitung jumlah speaker unik yang terdeteksi
  const uniqueSpeakers = new Set(words.map((w: any) => w.speaker)).size;

  if (words.length === 0) {
    console.warn(`[Transcriber] Warning: Deepgram returned no words.`);
  } else {
    console.log(`[Transcriber] ✅ Transcription complete: ${words.length} words, ${uniqueSpeakers} speaker(s) detected.`);
  }

  // Build speaker-labeled transcript for AI curator with timestamps!
  // Format: "[10s | Speaker 0]: sentence... [15s] next sentence..."
  let speakerLabeledTranscript = '';
  let currentSpeaker = -1;
  let newSentence = true;

  for (const w of words) {
    if (w.speaker !== currentSpeaker) {
      currentSpeaker = w.speaker;
      speakerLabeledTranscript += `\n[${Math.round(w.start)}s | Speaker ${currentSpeaker}]: `;
      newSentence = false;
    } else if (newSentence) {
      speakerLabeledTranscript += `[${Math.round(w.start)}s] `;
      newSentence = false;
    }

    speakerLabeledTranscript += `${w.punctuated_word} `;

    if (w.punctuated_word.match(/[.?!。？！]$/)) {
      newSentence = true;
    }
  }

  return { words, transcript: speakerLabeledTranscript.trim() || transcript, uniqueSpeakers };
}
