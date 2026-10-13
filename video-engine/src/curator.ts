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
    model: "gemini-3.5-flash",
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
Anda adalah seorang TikTok & YouTube Shorts Content Strategist tingkat dewa yang sudah menghasilkan ratusan konten viral berpenonton jutaan views. Tugas Anda adalah menganalisis transkrip dari podcast/video berdurasi panjang dan mengekstrak HANYA momen-momen yang benar-benar berpotensi viral (FYP) tinggi. 

ATURAN JUMLAH KLIP (KUALITAS POWERFUL > KUANTITAS): 
Anda HARUS menghasilkan TEPAT 5 klip terbaik (tidak boleh kurang, tidak boleh lebih). Jangan asal potong dan JANGAN pilih klip biasa/filler! HANYA pilih 5 momen PALING EMOSIONAL, PALING MENOHOK, PALING KONTROVERSIAL/INSIGHTFUL, dan PALING BERPOTENSI MEMICU DEBAT/FYP MASIF (10K+ sampai 100K+ views). Masing-masing klip berdurasi 30-60 detik (sweet spot 35-50 detik).

WAJIB: Anda HARUS berpikir dan bernalar secara mendalam dari awal hingga akhir video untuk benar-benar menangkap intisari (essence) terdalam dari obrolan tersebut. Klip yang Anda pilih HARUS memiliki muatan yang kuat untuk memancing reaksi emosional audiens (merinding, marah, relate, terharu, atau tercerahkan).

${speakerContext}${campaignInstruction}
KRITERIA KLIP VIRAL (WAJIB DIPENUHI - STANDAR TINGGI FYP):
1. THE HOOK (PALING KRUSIAL - DETIK 0 SAMPAI 3): 3 detik PERTAMA klip harus LANGSUNG MENGUNCI perhatian penonton. Wajib berupa salah satu dari:
   - Pernyataan kontroversial, provokatif, atau mengejutkan (contoh: "Ini alasan kenapa generasi muda sekarang hopeless...", "Kuliah itu scam kalau...", "Gue hampir hancur karena hal ini...")
   - Opini kontraintuitif yang menabrak pemikiran umum orang banyak.
   - Angka ekstrem atau fakta tak terduga (contoh: "Gue hilang 5 Milyar dalam semalam...", "Umur 20 udah punya 1 M...")
   - Pertanyaan menusuk rasa penasaran / emosi.
   - LARANGAN KERAS: JANGAN pilih klip yang dimulai dengan sapaan ("halo", "hai", "oke jadi"), basa-basi tongkrongan santai ("ehm", "mobil lu apa", "jadi begini"), atau pembukaan kronologis lambat ("tahun 2015 gua..."). Potong langsung ke inti punchline yang paling meledak!
2. UNIVERSAL RELATABILITY & RESONANCE (FORMULA MENANG 10K+ VIEWS):
   - Prioritaskan topik yang menyentuh ranah MASSIF & RELATABLE bagi jutaan penonton (mindset sukses/gagal, realita karier/finansial, masalah generasi muda/Gen Z/Millennial, attention span/gadget, unwritten rules kehidupan, atau pelajaran pahit).
   - HINDARI topik yang terlalu teknis, segmented, atau rumit (seperti teori coding rumit, regulasi hukum spesifik, atau matematika/istilah sempit yang membuat orang awam langsung swipe pergi).
3. DEEP ESSENCE & HIGH ENGAGEMENT: Isi klip harus memicu perdebatan sengit di kolom komentar, share ke teman, atau bookmark. Klip yang memancing opini pro & kontra terbukti mendapatkan bobot watch time dan share tertinggi.
4. STANDALONE & NATURAL ENDING: Penonton baru harus bisa paham 100% tanpa konteks luar. Klip HARUS berakhir di kalimat yang utuh dan berkesan (punchline penutup).

INSTRUKSI EKSTRAKSI (TIMESTAMPS & TITLE):
- \`title\` (Maksimal 7 kata): Buatlah judul (Hook Text) yang SANGAT TAJAM, PROVOKATIF, BERBENTUK PERTANYAAN EMOSIONAL ATAU PERNYATAAN MENOHOK (contoh: "Kenapa Generasi Muda Sekarang Hopeless?", "Alasan Kenapa Orang Rajin Tetap Miskin"). Judul ini teks pertama yang dilihat penonton di layar! Boleh memoles agar CTR tinggi asalkan konteks akurat.
- Tentukan \`start_time\` (dalam detik) tepat di awal kata punchline/hook tanpa jeda kosong.
- Tentukan \`end_time\` (dalam detik) WAJIB jatuh di AKHIR KALIMAT YANG UTUH - setelah tanda titik (.), tanda tanya (?), atau tanda seru (!). DILARANG KERAS memotong di tengah kalimat.
- Durasi (end_time - start_time) wajib 30 hingga 60 detik (sweet spot 35-50 detik).
- Distribusikan 5 klip terbaik ini dari momen-momen puncak obrolan sepanjang video.
- Isi \`dominant_speaker\` dengan angka Speaker ID (0, 1, 2, dst) yang paling banyak berbicara di klip tersebut.
- Wajib isi \`host_speaker_id\` (di luar array klip) dengan angka Speaker ID yang berperan sebagai Host / Pewawancara di video ini.

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
      console.warn(`[Curator] Gemini attempt ${attempt} warning: ${error.message || error}`);
      if (attempt === maxRetries) {
        const groqKey = process.env.GROQ_API_KEY;
        if (groqKey) {
          console.log(`[Curator] ⚡ Activating high-speed Groq fallback (zero-delay)...`);
          try {
            const halfIdx = Math.floor(transcriptText.length / 2);
            const chunk1 = transcriptText.substring(0, halfIdx);
            const chunk2 = transcriptText.substring(halfIdx);

            const callGroq = async (chunk: string, count: number, startId: number) => {
              const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: "openai/gpt-oss-120b",
                  messages: [
                    { role: "system", content: `Anda adalah TikTok Content Strategist tingkat dewa. Pilih TEPAT ${count} momen viral (durasi 30-60s) dari transkrip berikut. Wajib prioritaskan hook tajam dan topik universal yang relate. Outputkan STRICT JSON: {"clips": [{"id": ${startId}, "title": "Judul (Maks 7 kata)", "start_time": 10, "end_time": 45, "viral_reasoning": "Alasan", "dominant_speaker": 0}], "host_speaker_id": 0}` },
                    { role: "user", content: chunk }
                  ],
                  response_format: { type: "json_object" }
                })
              });
              const resData = await res.json();
              const parsed = JSON.parse(resData.choices?.[0]?.message?.content || '{}');
              return parsed.clips || [];
            };

            const [clips1, clips2] = await Promise.all([
              callGroq(chunk1, 3, 1),
              callGroq(chunk2, 2, 4)
            ]);

            const merged: ClipData[] = [...clips1, ...clips2].slice(0, 5).map((c: any, i: number) => ({
              id: i + 1,
              title: c.title || `Klip Viral ${i + 1}`,
              start_time: Number(c.start_time),
              end_time: Number(c.end_time),
              viral_reasoning: c.viral_reasoning || "High viral potential",
              dominant_speaker: c.dominant_speaker ?? 0
            }));

            if (merged.length > 0) {
              console.log(`[Curator] 🚀 Groq fallback succeeded: ${merged.length} viral clips curated!`);
              return { clips: merged, hostSpeakerId: 0 };
            }
          } catch (groqErr: any) {
            console.error(`[Curator] Groq fallback error:`, groqErr.message || groqErr);
          }
        }
        console.error(`[Curator] Failed to curate viral moments after ${maxRetries} attempts:`, error);
        throw error;
      }
      const isRateLimit = error?.message?.includes('429') || error?.status === 429;
      const waitTime = isRateLimit ? 10000 : 3000;
      console.warn(`[Curator] Waiting ${waitTime / 1000}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  return { clips: [] };
}
