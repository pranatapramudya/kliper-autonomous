import { GoogleGenerativeAI } from '@google/generative-ai';

export interface ClipData {
  id: number;
  title: string;
  start_time: number;
  end_time: number;
  viral_reasoning: string;
  dominant_speaker?: number; // Speaker ID yang paling banyak ngomong di klip ini
}

export interface CurationResult {
  clips: ClipData[];
  hostSpeakerId?: number;
}

/**
 * Uses Gemini to act as a TikTok Content Strategist and find the most viral moments
 * from the provided transcript.
 */
export async function curateViralMoments(transcriptText: string, campaignContext?: string, uniqueSpeakers?: number): Promise<CurationResult> {
  console.log(`[Curator] Starting AI curation to find viral moments... (${uniqueSpeakers ?? 1} speaker(s) detected)`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined in .env');
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  // Using gemini-1.5-flash as the fast and efficient model (Gemini 3.6 Flash as mentioned in PRD is likely a typo for gemini-1.5-flash or just a future version name, we'll use gemini-1.5-flash)
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash-lite",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          host_speaker_id: { type: "integer", description: "The ID of the speaker who is the main host or interviewer." },
          clips: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                title: { type: "string" },
                start_time: { type: "number" },
                end_time: { type: "number" },
                viral_reasoning: { type: "string" },
                dominant_speaker: { type: "integer" }
              },
              required: ["id", "title", "start_time", "end_time", "viral_reasoning"]
            }
          }
        },
        required: ["host_speaker_id", "clips"]
      } as any
    }
  });

  const campaignInstruction = campaignContext
    ? `\nPERHATIAN: Anda wajib menyelaraskan pilihan klip Anda dengan Brief Campaign berikut:\n\n${campaignContext}\n\nINSTRUKSI KHUSUS BRIEF:\n1. Baca bagian [NARASI CAMPAIGN] untuk mencari angle obrolan yang paling relevan.\n2. Anda DILARANG KERAS memilih klip yang melanggar poin-poin di bagian [ATURAN WAJIB].\n3. Pastikan klip yang dipilih memiliki ruang/konteks yang pas untuk disematkan [CALL TO ACTION] di akhir video.\n`
    : "";

  const speakerContext = uniqueSpeakers && uniqueSpeakers > 1
    ? `\nINFO PENTING: Video ini adalah PODCAST/WAWANCARA dengan ${uniqueSpeakers} orang. Transkrip sudah dilabeli [Speaker 0], [Speaker 1], dst. ATURAN WAJIB: Fokuskan klip pada ISI "DAGING" pembicaraan (insight penting, lucu, atau kontroversial). Jika memungkinkan, HINDARI membuang-buang durasi untuk sapaan/basa-basi Host. Langsung potong saat pembahasan memanas atau langsung ke poin utamanya.\n`
    : '';

const prompt = `
Anda adalah seorang TikTok & YouTube Shorts Content Strategist tingkat dewa yang sudah menghasilkan ratusan konten viral. Tugas Anda adalah menganalisis transkrip dari podcast/video berdurasi panjang dan mengekstrak HANYA momen-momen yang benar-benar berpotensi viral (FYP). 

ATURAN JUMLAH KLIP: 
Anda HARUS menghasilkan TEPAT 9 klip (tidak boleh kurang, tidak boleh lebih). Pilih 9 momen terbaik dari video. Masing-masing klip berdurasi 30-60 detik.

WAJIB: Anda HARUS berpikir dan bernalar secara mendalam dari awal hingga akhir video untuk benar-benar menangkap intisari (essence) terdalam dari obrolan tersebut. Jangan asal memotong! Klip yang Anda pilih HARUS memiliki muatan yang kuat untuk memancing reaksi emosional audiens (entah itu merinding, marah, terharu, atau merasa sangat tercerahkan).

${speakerContext}${campaignInstruction}
KRITERIA KLIP VIRAL (WAJIB DIPENUHI — TIDAK BISA KOMPROMI):
1. THE HOOK (PALING KRUSIAL): 3 detik PERTAMA klip harus LANGSUNG MENGUNCI perhatian penonton. Wajib berupa salah satu dari:
   - Pernyataan kontroversial atau mengejutkan (contoh: "Ini yang tidak pernah diajarkan sekolah...", "Gue hampir bangkrut karena ini...")
   - Angka atau fakta yang tidak terduga (contoh: "Gue bayar Rp 500 juta buat belajar ini...")
   - Pertanyaan retoris yang memicu rasa ingin tahu (contoh: "Kenapa orang sukses tidak pernah cerita soal ini?")
   - LARANGAN KERAS: JANGAN pilih klip yang dimulai dengan sapaan ("halo", "hai", "oke jadi"), basa-basi ("ehm", "jadi begini"), atau kalimat transisi yang tidak standalone.
2. DEEP ESSENCE, HIGH EMOTION & COMEDY: Isi klip harus memicu muatan emosional tinggi (marah, terharu, takjub), memancing perdebatan sengit, momen SANGAT LUCU/KOMEDI yang bikin ngakak, atau mengungkapkan insight eksklusif (daging) yang mengubah cara pandang penonton. Ambil interaksi obrolan yang padat, potong basa-basi yang tidak perlu.
3. STANDALONE: Penonton yang belum pernah tahu channel ini harus bisa sepenuhnya memahami dan menikmati klip tanpa konteks tambahan.
4. VIRALITY SCORE: Prioritaskan momen yang akan membuat penonton men-share klip ke teman mereka atau menyimpan (bookmark).

INSTRUKSI EKSTRAKSI (TIMESTAMPS & TITLE):
- \`title\` (Maksimal 7 kata): Buatlah judul (Hook Text) yang SANGAT TAJAM, PROVOKATIF, dan BIKIN PENASARAN. Ambil intisari paling "menohok" dari ucapan subjek, dan ubah menjadi kalimat Hook yang sangat kuat (punchy). Judul ini adalah teks raksasa pertama yang dilihat penonton di layar! Boleh meringkas atau memoles kata-kata aslinya agar lebih dramatis dan memancing klik (CTR tinggi), asalkan konteksnya tetap akurat dan tidak berbohong. Contoh: "Ternyata Ini Rahasia Besarnya..." atau "Gue Hampir Hancur Karena Hal Ini".
- Tentukan \`start_time\` (dalam detik) tepat sebelum subjek melontarkan kalimat hook-nya (kalimat yang paling mengejutkan/kontroversial).
- Tentukan \`end_time\` (dalam detik) WAJIB jatuh di AKHIR KALIMAT YANG UTUH — setelah titik (.), tanda tanya (?), atau tanda seru (!). DILARANG KERAS memotong di tengah kalimat. Jika argumen belum selesai, perpanjang sampai kalimat penutup yang natural.
- Pastikan durasi (end_time - start_time) berada di kisaran 30 hingga 60 detik. Boleh sedikit lebih panjang (max 70 detik) jika diperlukan untuk menyelesaikan kalimat terakhir.
- Distribusikan klip secara merata di sepanjang video agar mencakup beragam momen menarik, BUKAN hanya dari bagian awal.
- Isi \`dominant_speaker\` dengan angka Speaker ID (0, 1, 2, dst) yang paling banyak berbicara di klip tersebut.
- Wajib isi \`host_speaker_id\` (di luar array klip) dengan angka Speaker ID yang berperan sebagai Host / Pewawancara / Pemilik Podcast di video ini secara keseluruhan.

Berikut adalah transkrip videonya:
---
${transcriptText}
---
  `;

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[Curator] Retrying AI curation (Attempt ${attempt}/${maxRetries})...`);
      }
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const data = JSON.parse(responseText);

      if (data.clips && data.clips.length > 0) {
        console.log(`[Curator] Successfully curated ${data.clips.length} viral clips. (Detected Host: Speaker ${data.host_speaker_id})`);
        return { clips: data.clips, hostSpeakerId: data.host_speaker_id };
      } else {
        console.warn(`[Curator] Warning: AI returned 0 clips.`);
        return { clips: [] };
      }
    } catch (error: any) {
      if (attempt === maxRetries) {
        console.error(`[Curator] Failed to curate viral moments after ${maxRetries} attempts:`, error);
        throw error;
      }
      const isRateLimit = error?.message?.includes('429') || error?.status === 429;
      const waitTime = isRateLimit ? 65000 : 5000; // Tunggu 65 detik jika kena limit
      console.warn(`[Curator] AI Error on attempt ${attempt}: ${error.message || error}. Waiting ${waitTime / 1000} seconds before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  return { clips: [] };
}
