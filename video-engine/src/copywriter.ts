import { GoogleGenerativeAI } from '@google/generative-ai';
import { ClipData } from './curator.js';

export interface ClipCopy {
  clipId: number;
  title: string;
  tiktok: { caption: string; hashtags: string };
  youtube_shorts: { caption: string; hashtags: string };
  instagram_reels: { caption: string; hashtags: string };
}

export async function generateCopy(
  clips: ClipData[],
  clipTranscripts: Record<number, string>,
  campaignContext?: string
): Promise<ClipCopy[]> {
  console.log(`[Copywriter] Generating captions & hashtags for ${clips.length} clips...`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not defined in .env');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash-lite',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          copies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                clip_id: { type: 'integer' },
                tiktok_caption: { type: 'string' },
                tiktok_hashtags: { type: 'string' },
                youtube_caption: { type: 'string' },
                youtube_hashtags: { type: 'string' },
                instagram_caption: { type: 'string' },
                instagram_hashtags: { type: 'string' },
              },
              required: ['clip_id', 'tiktok_caption', 'tiktok_hashtags', 'youtube_caption', 'youtube_hashtags', 'instagram_caption', 'instagram_hashtags'],
            },
          },
        },
        required: ['copies'],
      } as any,
    },
  });

  const campaignNote = campaignContext ? `\nCatatan Campaign: ${campaignContext.substring(0, 300)}...\n` : '';

  const clipsInfo = clips.map(c => `
[CLIP ${c.id}]
Judul: ${c.title}
Alasan Viral: ${c.viral_reasoning}
Transkrip: ${clipTranscripts[c.id] ?? '(tidak tersedia)'}
`).join('\n---\n');

  const prompt = `
Anda adalah seorang Social Media Copywriter viral terbaik di Indonesia yang spesialis TikTok, YouTube Shorts, dan Instagram Reels.
Tugas: Buat caption dan hashtag SIAP PAKAI (tinggal copy-paste tanpa edit) untuk setiap klip berikut.
${campaignNote}
PANDUAN CAPTION:
- WAJIB AKURAT: Pastikan caption 100% nyambung dan akurat dengan isi *Transkrip* klip. JANGAN mengarang fakta, janji berlebihan, atau menulis hal yang tidak dibicarakan di dalam klip.

TikTok Caption:
- Maksimal 150 karakter di baris pertama (visible sebelum "lihat lagi")
- Hook teks memancing, emoji 1-2, gaya Gen Z casual â€” BUKAN formal
- Boleh pertanyaan retoris atau cliffhanger

YouTube Shorts Caption:
- 2-3 kalimat, SEO-friendly (masukkan kata kunci yang dicari)
- Akhiri dengan: "Subscribe biar ga ketinggalan"

Instagram Reels Caption:
- 3-5 kalimat storytelling, pakai line break antar paragraf
- Akhiri dengan pertanyaan ke audiens untuk trigger komentar

PANDUAN HASHTAG:
- TikTok: 5-8 hashtag mix niche + broad, format: #kata
- YouTube: 3-5 hashtag relevan di akhir deskripsi
- Instagram: 15-20 hashtag mix niche + broad + branded, satu baris

Data klip:
${clipsInfo}

Buat copy yang terasa NATURAL seperti creator asli, bukan bot atau iklan.
`;

  let data: any = null;
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) console.log(`[Copywriter] Retrying (Attempt ${attempt}/${maxRetries})...`);
      const result = await model.generateContent(prompt);
      data = JSON.parse(result.response.text());
      break;
    } catch (error: any) {
      if (attempt === maxRetries) {
        console.error(`[Copywriter] Failed after ${maxRetries} attempts:`, error);
        throw error;
      }
      const isRateLimit = error?.message?.includes('429') || error?.status === 429;
      const waitTime = isRateLimit ? 65000 : 5000;
      console.warn(`[Copywriter] AI Error on attempt ${attempt}: ${error.message || error}. Waiting ${waitTime / 1000} seconds before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  if (!data || !data.copies) {
    throw new Error('[Copywriter] Failed to generate copy data');
  }

  const copies: ClipCopy[] = data.copies.map((c: any) => {
    const clip = clips.find(cl => cl.id === c.clip_id);
    return {
      clipId: c.clip_id,
      title: clip?.title ?? `Clip ${c.clip_id}`,
      tiktok: { caption: c.tiktok_caption, hashtags: c.tiktok_hashtags },
      youtube_shorts: { caption: c.youtube_caption, hashtags: c.youtube_hashtags },
      instagram_reels: { caption: c.instagram_caption, hashtags: c.instagram_hashtags },
    };
  });

  console.log(`[Copywriter] âœ… Copy generated for ${copies.length} clips.`);
  return copies;
}

export function formatCopyAsText(copies: ClipCopy[]): string {
  return copies.map(c => `
${'═'.repeat(60)}
CLIP ${c.clipId}
${'═'.repeat(60)}

▶️ YOUTUBE SHORTS
────────────────────────────────────────
Judul: ${c.title}

Deskripsi:
${c.youtube_shorts.caption}

${c.youtube_shorts.hashtags}

📱 TIKTOK / INSTAGRAM REELS
────────────────────────────────────────
${c.tiktok.caption}

${c.tiktok.hashtags}

`).join('\n');
}

/**
 * Format ClipCopy menjadi caption siap kirim ke Telegram.
 * Telegram caption limit: 1024 karakter.
 * Format: 🎬 Judul\n\nCaption TikTok\n\nHashtag TikTok
 */
export function buildTelegramCaption(copy: ClipCopy): string {
  const TELEGRAM_CAPTION_LIMIT = 1024;

  const title = `🎬 *KLIPER — CLIP #${copy.clipId}*\n📌 ${copy.title}`;
  const caption = copy.tiktok.caption;
  const hashtags = copy.tiktok.hashtags;

  // Gabungkan semua bagian
  let full = `${title}\n\n${caption}\n\n${hashtags}`;

  // Truncate jika melebihi limit Telegram
  if (full.length > TELEGRAM_CAPTION_LIMIT) {
    const suffix = '...\n\n' + hashtags;
    const allowedBody = TELEGRAM_CAPTION_LIMIT - title.length - suffix.length - 4;
    full = `${title}\n\n${caption.substring(0, Math.max(0, allowedBody))}${suffix}`;
  }

  return full;
}
