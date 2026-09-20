import * as pdfjsLib from 'pdfjs-dist';
import { 
  PdfImportCandidate, 
  PdfAnalysisSummary, 
  QuranPosition 
} from '../types';
import { quranService, SURAH_TOTAL_AYAHS, validateQuestionPositions } from './quranService';
import { QURAN_CHAPTERS } from '../constants';

// Konfigurasi worker pdfjs-dist aman untuk lingkungan Vite browser
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  // Gunakan CDN resmi cdnjs dengan fallback
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
}

// Metadata Surah Juz 30 (78 s.d. 114)
export const JUZ_30_SURAHS: Record<number, { name: string; totalAyahs: number }> = {
  78: { name: "An-Naba'", totalAyahs: 40 },
  79: { name: "An-Nazi'at", totalAyahs: 46 },
  80: { name: "'Abasa", totalAyahs: 42 },
  81: { name: "At-Takwir", totalAyahs: 29 },
  82: { name: "Al-Infitar", totalAyahs: 19 },
  83: { name: "Al-Muthaffifin", totalAyahs: 36 },
  84: { name: "Al-Insyiqaq", totalAyahs: 25 },
  85: { name: "Al-Buruj", totalAyahs: 22 },
  86: { name: "Ath-Thariq", totalAyahs: 17 },
  87: { name: "Al-A'la", totalAyahs: 19 },
  88: { name: "Al-Ghasyiyah", totalAyahs: 26 },
  89: { name: "Al-Fajr", totalAyahs: 30 },
  90: { name: "Al-Balad", totalAyahs: 20 },
  91: { name: "Asy-Syams", totalAyahs: 15 },
  92: { name: "Al-Lail", totalAyahs: 21 },
  93: { name: "Ad-Dhuha", totalAyahs: 11 },
  94: { name: "Asy-Syarh", totalAyahs: 8 },
  95: { name: "At-Tin", totalAyahs: 8 },
  96: { name: "Al-'Alaq", totalAyahs: 19 },
  97: { name: "Al-Qadr", totalAyahs: 5 },
  98: { name: "Al-Bayyinah", totalAyahs: 8 },
  99: { name: "Az-Zalzalah", totalAyahs: 8 },
  100: { name: "Al-'Adiyat", totalAyahs: 11 },
  101: { name: "Al-Qari'ah", totalAyahs: 11 },
  102: { name: "At-Takatsur", totalAyahs: 8 },
  103: { name: "Al-'Ashr", totalAyahs: 3 },
  104: { name: "Al-Humazah", totalAyahs: 9 },
  105: { name: "Al-Fil", totalAyahs: 5 },
  106: { name: "Quraisy", totalAyahs: 4 },
  107: { name: "Al-Ma'un", totalAyahs: 7 },
  108: { name: "Al-Kautsar", totalAyahs: 3 },
  109: { name: "Al-Kafirun", totalAyahs: 6 },
  110: { name: "An-Nashr", totalAyahs: 3 },
  111: { name: "Al-Lahab", totalAyahs: 5 },
  112: { name: "Al-Ikhlas", totalAyahs: 4 },
  113: { name: "Al-Falaq", totalAyahs: 5 },
  114: { name: "An-Nas", totalAyahs: 6 }
};

// Signature tokens/glyphs khusus font LPMQ IsepMisbah / Quran in Word
const PASSAGE_SIGNATURES: { surah: number; patterns: string[] }[] = [
  { surah: 78, patterns: ['', '', '', ' ', '', '', ' ', '', '', '', ' ', '', ''] },
  { surah: 79, patterns: ['', '', '', '', '', '', '', '', ' ', ' ', ' ', ' ', ' '] },
  { surah: 80, patterns: ['', '', '', ' ', '', '', ' ', '', '', ' ', ''] },
  { surah: 81, patterns: ['', '', '', '', '', '', '', '', '', '', ' '] },
  { surah: 82, patterns: ['', '', '', '', ' ', '', ' ', ' '] },
  { surah: 83, patterns: ['', '', '', '', ' ', '', '', '', ' ', '', '', ''] },
  { surah: 84, patterns: ['', '', ' ', '', '', '', '', '', ''] },
  { surah: 85, patterns: ['', '', '', '', '', ' ', ' ', '', ' '] },
  { surah: 86, patterns: ['', '', '', '', '', '', '', ''] },
  { surah: 87, patterns: ['  ', '', '', '', '', ' ', '', ''] },
  { surah: 88, patterns: ['', '', '', '', '', ' ', '', '', '', ''] },
  { surah: 89, patterns: ['', '', '', '', '', '', '', '', '', '  ', '', '', '', ' ', ' ', '', '', '', ''] },
  { surah: 90, patterns: ['', '', '', '', '', '', '', '', '', '', '', ''] },
  { surah: 91, patterns: ['', '', '', '', '', '', '', '', ' ', ''] },
  { surah: 92, patterns: ['', '', '', '', '', '', '', '', '', '', ' ', '', ''] },
  { surah: 93, patterns: ['', '', '', '', '', '', '', '', '', ''] },
  { surah: 94, patterns: ['', '', '', '', '', '', ''] },
  { surah: 95, patterns: ['', '', '', '', '', '', '', ''] },
  { surah: 96, patterns: ['', '', '', '', '', '', '', '', '', ''] },
  { surah: 97, patterns: ['', '', '', '', '', '', '', ' '] },
  { surah: 98, patterns: ['', '', '', '', '', '', '', '', '', ' ', ' ', ''] },
  { surah: 99, patterns: ['', '', '', '', '', '', ''] },
  { surah: 100, patterns: ['', '', '', '', '', ' ', '', ''] },
  { surah: 101, patterns: ['', '', '', ' ', '', ''] },
  { surah: 102, patterns: ['', '', '', '', '', ''] },
  { surah: 103, patterns: ['', '', '', ''] },
  { surah: 104, patterns: ['', '', '', '', '', '', ''] },
  { surah: 105, patterns: ['', '', '', '', '', '', ''] },
  { surah: 106, patterns: ['', '', '', '', '', ''] },
  { surah: 107, patterns: ['', '', '', '', '', '', ''] },
  { surah: 108, patterns: ['', '', '', '', '', ''] },
  { surah: 109, patterns: ['', '', '', '', '', '', ''] },
  { surah: 110, patterns: ['', '', '', '', '', '', ''] },
  { surah: 111, patterns: ['', '', '', '', ''] },
  { surah: 112, patterns: ['', '', '', '', '', '', '', '', ''] },
  { surah: 113, patterns: ['', '', '', '', ''] },
  { surah: 114, patterns: ['', '', '', '', '', '', ''] }
];

export class PdfQuestionParserService {
  /**
   * Validasi file PDF awal
   */
  public static validatePdfFile(file: File): { valid: boolean; error?: string } {
    if (!file) {
      return { valid: false, error: 'File tidak ditemukan.' };
    }
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return { valid: false, error: 'Format file tidak didukung. Harap unggah dokumen PDF (.pdf).' };
    }
    const maxSizeBytes = 25 * 1024 * 1024; // 25 MB max
    if (file.size > maxSizeBytes) {
      return { valid: false, error: 'Ukuran file melebihi batas maksimal 25 MB.' };
    }
    if (file.size < 100) {
      return { valid: false, error: 'File PDF kosong atau rusak.' };
    }
    return { valid: true };
  }

  /**
   * Ekstraksi nomor ayat dari urutan teks/items glyph LPMQ
   */
  public static extractAyahsFromItems(items: any[]): number[] {
    const ayahs: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const str = it.str;
      const match = str.match(/\uF0C7([^\uF0C8]*)\uF0C8?/);
      if (match) {
        let digits = '';
        for (const ch of match[1]) {
          const c = ch.charCodeAt(0);
          if (c >= 0xF0C9 && c <= 0xF0D2) digits += (c - 0xF0C9);
          else if (c >= 0x30 && c <= 0x39) digits += ch;
        }
        if (!str.includes('\uF0C8')) {
          for (let j = i + 1; j < Math.min(items.length, i + 6); j++) {
            const nextStr = items[j].str;
            for (const ch of nextStr) {
              const c = ch.charCodeAt(0);
              if (c >= 0xF0C9 && c <= 0xF0D2) digits += (c - 0xF0C9);
              else if (c >= 0x30 && c <= 0x39) digits += ch;
            }
            if (nextStr.includes('\uF0C8')) break;
          }
        }
        if (digits) {
          const parsed = parseInt(digits, 10);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 300) {
            ayahs.push(parsed);
          }
        }
      }
    }
    return ayahs;
  }

  /**
   * Pencocokan kandidat surah kanonikal di Juz 30
   */
  public static matchSurah(
    ayahs: number[], 
    rawText: string
  ): { surah: number; confidence: 'high' | 'medium' | 'low'; reason: string } {
    if (ayahs.length === 0) {
      return { surah: 78, confidence: 'low', reason: 'Tidak ada nomor ayat yang berhasil diekstraksi dari blok soal.' };
    }

    const minA = Math.min(...ayahs);
    const maxA = Math.max(...ayahs);

    // Filter surah dalam Juz 30 yang memiliki ayat hingga maxA
    const candidates: number[] = [];
    for (let s = 78; s <= 114; s++) {
      if (maxA <= SURAH_TOTAL_AYAHS[s]) {
        candidates.push(s);
      }
    }

    if (candidates.length === 0) {
      return { surah: 78, confidence: 'low', reason: `Nomor ayat ${maxA} melebihi jumlah ayat surat manapun di Juz 30.` };
    }

    // Skor kecocokan berdasarkan signature potongan teks Al-Qur'an
    let bestSurah: number | null = null;
    let maxScore = 0;

    for (const s of candidates) {
      const sig = PASSAGE_SIGNATURES.find(o => o.surah === s);
      if (!sig) continue;
      let score = 0;
      for (const pat of sig.patterns) {
        if (rawText.includes(pat)) {
          score += 10;
        }
      }
      if (score > maxScore) {
        maxScore = score;
        bestSurah = s;
      }
    }

    if (bestSurah && maxScore >= 10) {
      const sName = JUZ_30_SURAHS[bestSurah]?.name || quranService.getSurah(bestSurah)?.name || `Surat ${bestSurah}`;
      return { 
        surah: bestSurah, 
        confidence: 'high', 
        reason: `Cocok kanonikal pada QS ${bestSurah} (${sName}) berdasarkan kecocokan rentang ayat ${minA}..${maxA} dan signature teks.` 
      };
    }

    if (candidates.length === 1) {
      const sName = JUZ_30_SURAHS[candidates[0]]?.name || quranService.getSurah(candidates[0])?.name || `Surat ${candidates[0]}`;
      return { 
        surah: candidates[0], 
        confidence: 'high', 
        reason: `Hanya satu-satunya surat di Juz 30 yang mencakup rentang ayat ${minA}..${maxA} (QS ${candidates[0]} ${sName}).` 
      };
    }

    // Ambiguitas yang membutuhkan review Admin
    const fallbackSurah = bestSurah || candidates[0];
    return { 
      surah: fallbackSurah, 
      confidence: 'medium', 
      reason: `Rentang ayat ${minA}..${maxA} dimiliki oleh beberapa surat di Juz 30 (${candidates.join(', ')}). Harap periksa dan sesuaikan via Edit Mushaf.` 
    };
  }

  /**
   * Pipeline Utama: Parse dan Analisis Dokumen PDF
   */
  public static async analyzePdf(
    file: File,
    onProgress?: (progressPercent: number, statusText: string) => void
  ): Promise<{
    summary: PdfAnalysisSummary;
    candidates: PdfImportCandidate[];
    pdfDoc: pdfjsLib.PDFDocumentProxy;
  }> {
    const validCheck = this.validatePdfFile(file);
    if (!validCheck.valid) {
      throw new Error(validCheck.error || 'File PDF tidak valid.');
    }

    if (onProgress) onProgress(5, 'Membaca data file PDF...');
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    if (onProgress) onProgress(15, 'Membuka dokumen PDF...');
    const doc = await pdfjsLib.getDocument({ 
      data,
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true
    }).promise;

    const totalPages = doc.numPages;
    if (totalPages > 60) {
      throw new Error(`Jumlah halaman PDF (${totalPages}) melebihi batas maksimal 60 halaman.`);
    }

    const candidates: PdfImportCandidate[] = [];
    let highConfCount = 0;
    let medConfCount = 0;
    let lowConfCount = 0;

    for (let p = 1; p <= totalPages; p++) {
      const currentPercent = Math.round(15 + (p / totalPages) * 75);
      if (onProgress) onProgress(currentPercent, `Menganalisis Paket Halaman ${p} dari ${totalPages}...`);

      const page = await doc.getPage(p);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1.0 });
      const width = viewport.width;
      const height = viewport.height;
      const midX = width / 2;
      const midY = height / 2;

      // Ambil metadata Paket dari header (y >= height - 120)
      const headerItems = textContent.items.filter((it: any) => it.transform[5] >= height - 120);
      const headerText = headerItems.map((it: any) => it.str).join(' ');
      const packageMatch = headerText.match(/paket\s*(\d+)/i);
      const packageNumber = packageMatch ? parseInt(packageMatch[1], 10) : p;

      // 4 Kuadran (Grid 2x2: Q1 Top-Right, Q2 Top-Left, Q3 Bottom-Right, Q4 Bottom-Left)
      const quadrantConfigs = [
        {
          qNum: 1,
          items: textContent.items.filter((it: any) => it.transform[4] >= midX && it.transform[5] >= midY && it.transform[5] < height - 130),
          cropRect: { x: midX, y: 0, width: midX, height: midY }
        },
        {
          qNum: 2,
          items: textContent.items.filter((it: any) => it.transform[4] < midX && it.transform[5] >= midY && it.transform[5] < height - 130),
          cropRect: { x: 0, y: 0, width: midX, height: midY }
        },
        {
          qNum: 3,
          items: textContent.items.filter((it: any) => it.transform[4] >= midX && it.transform[5] < midY),
          cropRect: { x: midX, y: midY, width: midX, height: midY }
        },
        {
          qNum: 4,
          items: textContent.items.filter((it: any) => it.transform[4] < midX && it.transform[5] < midY),
          cropRect: { x: 0, y: midY, width: midX, height: midY }
        }
      ];

      for (const qc of quadrantConfigs) {
        const rawText = qc.items.map((it: any) => it.str).join('');
        const ayahs = this.extractAyahsFromItems(qc.items);
        const match = this.matchSurah(ayahs, rawText);

        const surahNumber = match.surah;
        const surahInfo = quranService.getSurah(surahNumber);
        const surahName = surahInfo?.name || JUZ_30_SURAHS[surahNumber]?.name || `Surat ${surahNumber}`;
        const surahStartPage = surahInfo?.startPage || 582;

        const ayahStart = ayahs.length > 0 ? Math.min(...ayahs) : 1;
        const ayahEnd = ayahs.length > 0 ? Math.max(...ayahs) : Math.min(SURAH_TOTAL_AYAHS[surahNumber] || 5, 5);

        // DEFAULT SPLIT RULE:
        // A = Awal ayat pertama (Kata 1)
        // A' = Akhir ayat pertama (Penguji membaca ayat pembuka)
        // B = Awal ayat kedua (Santri mulai menyambung)
        // C = Akhir ayat terakhir yang terdeteksi
        const promptStart: QuranPosition = {
          surahNumber,
          ayahNumber: ayahStart,
          wordPosition: 1,
          pageNumber: surahStartPage
        };

        let promptEnd: QuranPosition;
        let answerStart: QuranPosition;
        let answerEnd: QuranPosition;

        if (ayahEnd > ayahStart) {
          // Kasus Normal (Beberapa Ayat): Prompt adalah ayat pertama, Santri menyambung ayat ke-2 dst.
          promptEnd = {
            surahNumber,
            ayahNumber: ayahStart,
            wordPosition: 4, // default 4 kata pertama atau akhir ayat
            pageNumber: surahStartPage
          };
          answerStart = {
            surahNumber,
            ayahNumber: ayahStart + 1,
            wordPosition: 1,
            pageNumber: surahStartPage
          };
          answerEnd = {
            surahNumber,
            ayahNumber: ayahEnd,
            wordPosition: 6,
            pageNumber: surahStartPage
          };
        } else {
          // Kasus 1 Ayat Tunggal: Potong di tengah ayat
          promptEnd = {
            surahNumber,
            ayahNumber: ayahStart,
            wordPosition: 2,
            pageNumber: surahStartPage
          };
          answerStart = {
            surahNumber,
            ayahNumber: ayahStart,
            wordPosition: 3,
            pageNumber: surahStartPage
          };
          answerEnd = {
            surahNumber,
            ayahNumber: ayahStart,
            wordPosition: 8,
            pageNumber: surahStartPage
          };
        }

        // Snapshot Preview Teks dari Quran Kanonikal (Bukan Raw OCR!)
        let promptText = `QS. ${surahName} [${ayahStart}]`;
        let answerText = `QS. ${surahName} [${ayahStart < ayahEnd ? ayahStart + 1 : ayahStart}..${ayahEnd}]`;

        try {
          const prRange = await quranService.getRangeWordsAndText(promptStart, promptEnd, false);
          if (prRange && prRange.fullText.trim()) promptText = prRange.fullText.trim();
        } catch {}

        try {
          const ansRange = await quranService.getRangeWordsAndText(answerStart, answerEnd, false);
          if (ansRange && ansRange.fullText.trim()) answerText = ansRange.fullText.trim();
        } catch {}

        const conf = match.confidence;
        if (conf === 'high') highConfCount++;
        else if (conf === 'medium') medConfCount++;
        else lowConfCount++;

        candidates.push({
          id: `pdf_cand_p${p}_q${qc.qNum}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          packageNumber,
          questionNumber: qc.qNum,
          pageIndex: p,
          detectedCategory: 'Juz 30',
          surahNumber,
          surahName,
          ayahStart,
          ayahEnd,
          totalAyahsDetected: ayahs.length,
          detectedAyahNumbers: ayahs,
          promptStart,
          promptEnd,
          answerStart,
          answerEnd,
          promptText,
          answerText,
          confidence: conf,
          confidenceReason: match.reason,
          selected: conf !== 'low', // default pilih high & medium
          status: 'draft',
          difficulty: 'medium',
          cropRect: qc.cropRect
        });
      }
    }

    if (onProgress) onProgress(100, 'Analisis selesai!');

    const summary: PdfAnalysisSummary = {
      fileName: file.name,
      fileSize: file.size,
      totalPages,
      totalPackages: totalPages,
      totalCandidates: candidates.length,
      highConfidenceCount: highConfCount,
      mediumConfidenceCount: medConfCount,
      lowConfidenceCount: lowConfCount
    };

    return {
      summary,
      candidates,
      pdfDoc: doc
    };
  }

  /**
   * Render kuadran PDF ke HTML5 Canvas untuk verifikasi visual crop admin
   */
  public static async renderCropToCanvas(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    pageNumber: number,
    cropRect: { x: number; y: number; width: number; height: number },
    targetCanvas: HTMLCanvasElement
  ): Promise<void> {
    const page = await pdfDoc.getPage(pageNumber);
    const scale = 2.0; // High DPI render
    const viewport = page.getViewport({ scale });

    // Canvas sementara untuk render seluruh halaman
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = viewport.width;
    fullCanvas.height = viewport.height;
    const fullCtx = fullCanvas.getContext('2d');
    if (!fullCtx) return;

    await page.render({
      canvasContext: fullCtx,
      viewport
    }).promise;

    // Crop area kuadran ke target canvas
    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) return;

    const sx = cropRect.x * scale;
    const sy = cropRect.y * scale;
    const sWidth = cropRect.width * scale;
    const sHeight = cropRect.height * scale;

    targetCanvas.width = sWidth;
    targetCanvas.height = sHeight;

    targetCtx.drawImage(
      fullCanvas,
      sx, sy, sWidth, sHeight,
      0, 0, sWidth, sHeight
    );
  }
}
