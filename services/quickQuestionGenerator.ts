import { 
  QuranPosition, 
  QuranVerse, 
  QuranWord, 
  QuickGeneratorOptions, 
  QuickQuestionCandidate, 
  QuestionBankItem 
} from '../types';
import { quranService, SURAH_TOTAL_AYAHS, comparePositions, validateQuestionPositions } from './quranService';
import { QURAN_CHAPTERS } from '../constants';

// ============================================================
// BATAS KANONIKAL 30 JUZ AL-QUR'AN (STANDAR MUSHAF MADINAH)
// ============================================================
export interface JuzBoundary {
  juz: number;
  startSurah: number;
  startAyah: number;
  endSurah: number;
  endAyah: number;
  startPage: number;
  endPage: number;
}

export const CANONICAL_JUZ_BOUNDARIES: Record<number, JuzBoundary> = {
  1:  { juz: 1,  startSurah: 1,  startAyah: 1,  endSurah: 2,   endAyah: 141, startPage: 1,   endPage: 21 },
  2:  { juz: 2,  startSurah: 2,  startAyah: 142, endSurah: 2,  endAyah: 252, startPage: 22,  endPage: 41 },
  3:  { juz: 3,  startSurah: 2,  startAyah: 253, endSurah: 3,  endAyah: 92,  startPage: 42,  endPage: 61 },
  4:  { juz: 4,  startSurah: 3,  startAyah: 93,  endSurah: 4,  endAyah: 23,  startPage: 62,  endPage: 81 },
  5:  { juz: 5,  startSurah: 4,  startAyah: 24,  endSurah: 4,  endAyah: 147, startPage: 82,  endPage: 101 },
  6:  { juz: 6,  startSurah: 4,  startAyah: 148, endSurah: 5,  endAyah: 81,  startPage: 102, endPage: 120 },
  7:  { juz: 7,  startSurah: 5,  startAyah: 82,  endSurah: 6,  endAyah: 110, startPage: 121, endPage: 141 },
  8:  { juz: 8,  startSurah: 6,  startAyah: 111, endSurah: 7,  endAyah: 87,  startPage: 142, endPage: 161 },
  9:  { juz: 9,  startSurah: 7,  startAyah: 88,  endSurah: 8,  endAyah: 40,  startPage: 162, endPage: 181 },
  10: { juz: 10, startSurah: 8,  startAyah: 41,  endSurah: 9,  endAyah: 92,  startPage: 182, endPage: 200 },
  11: { juz: 11, startSurah: 9,  startAyah: 93,  endSurah: 11, endAyah: 5,   startPage: 201, endPage: 221 },
  12: { juz: 12, startSurah: 11, startAyah: 6,   endSurah: 12, endAyah: 52,  startPage: 222, endPage: 241 },
  13: { juz: 13, startSurah: 12, startAyah: 53,  endSurah: 14, endAyah: 52,  startPage: 242, endPage: 261 },
  14: { juz: 14, startSurah: 15, startAyah: 1,   endSurah: 16, endAyah: 128, startPage: 262, endPage: 281 },
  15: { juz: 15, startSurah: 17, startAyah: 1,   endSurah: 18, endAyah: 74,  startPage: 282, endPage: 301 },
  16: { juz: 16, startSurah: 18, startAyah: 75,  endSurah: 20, endAyah: 135, startPage: 302, endPage: 321 },
  17: { juz: 17, startSurah: 21, startAyah: 1,   endSurah: 22, endAyah: 78,  startPage: 322, endPage: 341 },
  18: { juz: 18, startSurah: 23, startAyah: 1,   endSurah: 25, endAyah: 20,  startPage: 342, endPage: 361 },
  19: { juz: 19, startSurah: 25, startAyah: 21,  endSurah: 27, endAyah: 55,  startPage: 362, endPage: 381 },
  20: { juz: 20, startSurah: 27, startAyah: 56,  endSurah: 29, endAyah: 45,  startPage: 382, endPage: 401 },
  21: { juz: 21, startSurah: 29, startAyah: 46,  endSurah: 33, endAyah: 30,  startPage: 402, endPage: 421 },
  22: { juz: 22, startSurah: 33, startAyah: 31,  endSurah: 36, endAyah: 27,  startPage: 422, endPage: 441 },
  23: { juz: 23, startSurah: 36, startAyah: 28,  endSurah: 39, endAyah: 31,  startPage: 442, endPage: 461 },
  24: { juz: 24, startSurah: 39, startAyah: 32,  endSurah: 41, endAyah: 46,  startPage: 462, endPage: 481 },
  25: { juz: 25, startSurah: 41, startAyah: 47,  endSurah: 45, endAyah: 37,  startPage: 482, endPage: 501 },
  26: { juz: 26, startSurah: 46, startAyah: 1,   endSurah: 51, endAyah: 30,  startPage: 502, endPage: 521 },
  27: { juz: 27, startSurah: 51, startAyah: 31,  endSurah: 57, endAyah: 29,  startPage: 522, endPage: 541 },
  28: { juz: 28, startSurah: 58, startAyah: 1,   endSurah: 66, endAyah: 12,  startPage: 542, endPage: 561 },
  29: { juz: 29, startSurah: 67, startAyah: 1,   endSurah: 77, endAyah: 50,  startPage: 562, endPage: 581 },
  30: { juz: 30, startSurah: 78, startAyah: 1,   endSurah: 114, endAyah: 6,  startPage: 582, endPage: 604 }
};

export interface GenerationResult {
  candidates: QuickQuestionCandidate[];
  requestedCount: number;
  availableCount: number;
  insufficientPool: boolean;
  warningMessage?: string;
}

interface AyahAnchor {
  surahNumber: number;
  ayahNumber: number;
  pageNumber: number;
  juzNumber: number;
}

// Fingerprint generator kanonikal 12 koordinat
export function buildQuestionFingerprint(
  aSurah: number, aAyah: number, aWord: number,
  aeSurah: number, aeAyah: number, aeWord: number,
  bSurah: number, bAyah: number, bWord: number,
  cSurah: number, cAyah: number, cWord: number
): string {
  return `${aSurah}:${aAyah}:${aWord}_${aeSurah}:${aeAyah}:${aeWord}_${bSurah}:${bAyah}:${bWord}_${cSurah}:${cAyah}:${cWord}`;
}

export function getCandidateFingerprint(c: QuickQuestionCandidate): string {
  return buildQuestionFingerprint(
    c.promptStart.surahNumber, c.promptStart.ayahNumber, c.promptStart.wordPosition,
    c.promptEnd.surahNumber, c.promptEnd.ayahNumber, c.promptEnd.wordPosition,
    c.answerStart.surahNumber, c.answerStart.ayahNumber, c.answerStart.wordPosition,
    c.answerEnd.surahNumber, c.answerEnd.ayahNumber, c.answerEnd.wordPosition
  );
}

export class QuickQuestionGenerator {
  // Ambil daftar seluruh ayat yang berada di dalam Juz tertentu
  public static getAllAyahsInJuz(juzNumber: number): AyahAnchor[] {
    const boundary = CANONICAL_JUZ_BOUNDARIES[juzNumber];
    if (!boundary) return [];

    const anchors: AyahAnchor[] = [];

    for (let s = boundary.startSurah; s <= boundary.endSurah; s++) {
      const totalAyahs = SURAH_TOTAL_AYAHS[s] || 1;
      const startA = (s === boundary.startSurah) ? boundary.startAyah : 1;
      const endA = (s === boundary.endSurah) ? boundary.endAyah : totalAyahs;

      // Estimasi halaman awal surat dari QURAN_CHAPTERS
      const chapter = QURAN_CHAPTERS.find(([num]) => num === s);
      const surahStartPage = chapter ? chapter[2] : boundary.startPage;

      for (let a = startA; a <= endA; a++) {
        // Page approximation proporsional jika belum di-fetch
        const pageApprox = Math.min(
          boundary.endPage,
          Math.max(boundary.startPage, surahStartPage + Math.floor((a - 1) / Math.max(1, Math.ceil(totalAyahs / Math.max(1, boundary.endPage - surahStartPage + 1)))))
        );

        anchors.push({
          surahNumber: s,
          ayahNumber: a,
          pageNumber: pageApprox,
          juzNumber
        });
      }
    }

    return anchors;
  }

  // Ambil daftar seluruh ayat yang berada di dalam Surat tertentu
  public static getAllAyahsInSurah(surahNumber: number): AyahAnchor[] {
    const totalAyahs = SURAH_TOTAL_AYAHS[surahNumber] || 1;
    const chapter = QURAN_CHAPTERS.find(([num]) => num === surahNumber);
    const surahStartPage = chapter ? chapter[2] : 1;
    const juzNumber = quranService.getPageJuz(surahStartPage);

    const anchors: AyahAnchor[] = [];
    for (let a = 1; a <= totalAyahs; a++) {
      anchors.push({
        surahNumber,
        ayahNumber: a,
        pageNumber: surahStartPage,
        juzNumber
      });
    }
    return anchors;
  }

  // Ambil daftar seluruh ayat yang berada di dalam rentang halaman
  public static async getAllAyahsInPageRange(startPage: number, endPage: number): Promise<AyahAnchor[]> {
    const anchors: AyahAnchor[] = [];
    const minP = Math.max(1, Math.min(604, startPage));
    const maxP = Math.max(minP, Math.min(604, endPage));

    for (let p = minP; p <= maxP; p++) {
      const verses = await quranService.getVersesByPage(p);
      for (const v of verses) {
        anchors.push({
          surahNumber: v.surahNumber,
          ayahNumber: v.ayahNumber,
          pageNumber: p,
          juzNumber: v.juzNumber
        });
      }
    }
    return anchors;
  }

  // Pre-fetch halaman untuk materi yang dipilih ke in-memory cache
  public static async prefetchMaterialPages(options: QuickGeneratorOptions): Promise<void> {
    const pages: number[] = [];
    if (options.materialType === 'surah' && options.surahNumber) {
      const chapter = QURAN_CHAPTERS.find(([num]) => num === options.surahNumber);
      const startP = chapter ? chapter[2] : 1;
      // Fetch ~3 halaman sekitar surat
      for (let p = startP; p <= Math.min(604, startP + 2); p++) pages.push(p);
    } else if (options.materialType === 'page' && options.startPage && options.endPage) {
      const minP = Math.min(options.startPage, options.endPage);
      const maxP = Math.max(options.startPage, options.endPage);
      for (let p = minP; p <= maxP; p++) pages.push(p);
    } else {
      const boundary = CANONICAL_JUZ_BOUNDARIES[options.juz];
      if (boundary) {
        for (let p = boundary.startPage; p <= boundary.endPage; p++) pages.push(p);
      }
    }

    const batchSize = 4;
    for (let i = 0; i < pages.length; i += batchSize) {
      const batch = pages.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(p => Promise.race([
        quranService.getVersesByPage(p),
        new Promise<any>(resolve => setTimeout(() => resolve([]), 2500))
      ])));
    }
  }

  // Pre-fetch seluruh halaman untuk Juz tertentu ke in-memory cache
  public static async prefetchJuzPages(juzNumber: number): Promise<void> {
    const boundary = CANONICAL_JUZ_BOUNDARIES[juzNumber];
    if (!boundary) return;

    // Batasi concurrent request ke quranService agar hemat bandwidth dan mencegah rate-limit
    const pages: number[] = [];
    for (let p = boundary.startPage; p <= boundary.endPage; p++) {
      pages.push(p);
    }

    // Eksekusi secara batch 4 halaman sekaligus dengan timeout pengaman 2.5s per batch
    const batchSize = 4;
    for (let i = 0; i < pages.length; i += batchSize) {
      const batch = pages.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(p => Promise.race([
        quranService.getVersesByPage(p),
        new Promise<any>(resolve => setTimeout(() => resolve([]), 2500))
      ])));
    }
  }

  // Helper mengambil verse secara aman (mengutamakan cache, fallback API + synthetic offline guard)
  private static async getVerseSafe(surahNumber: number, ayahNumber: number): Promise<QuranVerse | null> {
    try {
      const v = await Promise.race([
        quranService.getVerse(surahNumber, ayahNumber),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 1500))
      ]);
      if (v) return v;
    } catch {}

    const surahInfo = quranService.getSurah(surahNumber);
    const pageNum = surahInfo?.startPage || 1;
    return {
      verseKey: `${surahNumber}:${ayahNumber}`,
      surahNumber,
      ayahNumber,
      pageNumber: pageNum,
      juzNumber: quranService.getPageJuz(pageNum),
      textUthmani: `Ayat ${ayahNumber}`,
      words: [
        { id: `${surahNumber}_${ayahNumber}_1`, surahNumber, ayahNumber, position: 1, textUthmani: 'وَالضُّحَىٰ', pageNumber: pageNum, juzNumber: 30, lineNumber: 1, charTypeName: 'word' },
        { id: `${surahNumber}_${ayahNumber}_2`, surahNumber, ayahNumber, position: 2, textUthmani: 'وَاللَّيْلِ', pageNumber: pageNum, juzNumber: 30, lineNumber: 1, charTypeName: 'word' },
        { id: `${surahNumber}_${ayahNumber}_3`, surahNumber, ayahNumber, position: 3, textUthmani: 'إِذَا', pageNumber: pageNum, juzNumber: 30, lineNumber: 1, charTypeName: 'word' },
        { id: `${surahNumber}_${ayahNumber}_4`, surahNumber, ayahNumber, position: 4, textUthmani: 'سَجَىٰ', pageNumber: pageNum, juzNumber: 30, lineNumber: 1, charTypeName: 'word' },
        { id: `${surahNumber}_${ayahNumber}_5`, surahNumber, ayahNumber, position: 5, textUthmani: 'مَا', pageNumber: pageNum, juzNumber: 30, lineNumber: 1, charTypeName: 'word' }
      ]
    };
  }

  // Konstruksi titik-titik soal Sambung Ayat (A..A', B..C)
  public static async constructSambungAyatCandidate(
    anchor: AyahAnchor,
    difficultyTarget: 'easy' | 'medium' | 'hard',
    boundary: JuzBoundary
  ): Promise<QuickQuestionCandidate | null> {
    const targetVerse = await this.getVerseSafe(anchor.surahNumber, anchor.ayahNumber);
    const contentWords = (targetVerse?.words || []).filter(w => w.charTypeName !== 'end');
    const totalWords = Math.max(1, contentWords.length);
    const pageNum = targetVerse?.pageNumber || anchor.pageNumber;

    // Tentukan Titik B berdasarkan Tingkat Kesulitan
    let bWord = 1;
    let promptLen = 3;

    if (difficultyTarget === 'easy') {
      // MUDAH: B di awal ayat (kata 1 atau 2), prompt panjang 4-6 kata
      if (totalWords <= 3) {
        bWord = 1;
      } else {
        bWord = Math.min(2, totalWords);
      }
      promptLen = Math.min(6, Math.max(4, bWord > 1 ? bWord - 1 : 4));
    } else if (difficultyTarget === 'hard') {
      // SULIT: B di tengah ayat (kata 3 atau lebih), prompt pendek 2-3 kata
      if (totalWords > 4) {
        bWord = Math.floor(totalWords / 2) + 1;
      } else {
        bWord = Math.min(totalWords, Math.max(1, totalWords - 1));
      }
      promptLen = Math.min(3, Math.max(2, bWord > 1 ? bWord - 1 : 2));
    } else {
      // SEDANG: B di kata ke-2 atau ke-3, prompt 3-4 kata
      if (totalWords >= 4) {
        bWord = 2;
      } else {
        bWord = 1;
      }
      promptLen = Math.min(4, Math.max(3, bWord > 1 ? bWord - 1 : 3));
    }

    // Inisialisasi Answer Start (Titik B)
    const answerStart: QuranPosition = {
      surahNumber: anchor.surahNumber,
      ayahNumber: anchor.ayahNumber,
      wordPosition: bWord,
      pageNumber: pageNum
    };

    // PROMPT: A .. A'
    let promptStart: QuranPosition;
    let promptEnd: QuranPosition;

    if (bWord > 1) {
      // B berada di tengah ayat: Prompt diambil dari kata sebelum B pada ayat yang sama
      const aStartWord = Math.max(1, bWord - promptLen);
      promptStart = {
        surahNumber: anchor.surahNumber,
        ayahNumber: anchor.ayahNumber,
        wordPosition: aStartWord,
        pageNumber: pageNum
      };
      promptEnd = {
        surahNumber: anchor.surahNumber,
        ayahNumber: anchor.ayahNumber,
        wordPosition: bWord - 1,
        pageNumber: pageNum
      };
    } else {
      // B adalah kata ke-1 (awal ayat): Prompt diambil dari ayat sebelumnya jika masih dalam surat & Juz yang sama
      const canTakePrev = (anchor.ayahNumber > 1) && 
        !(anchor.surahNumber === boundary.startSurah && anchor.ayahNumber <= boundary.startAyah);

      if (canTakePrev) {
        const prevAyah = anchor.ayahNumber - 1;
        const prevVerse = await this.getVerseSafe(anchor.surahNumber, prevAyah);
        const prevWords = (prevVerse?.words || []).filter(w => w.charTypeName !== 'end');
        const prevTotal = Math.max(1, prevWords.length);
        const pLen = Math.min(prevTotal, promptLen);
        const aStartWord = Math.max(1, prevTotal - pLen + 1);

        promptStart = {
          surahNumber: anchor.surahNumber,
          ayahNumber: prevAyah,
          wordPosition: aStartWord,
          pageNumber: prevVerse?.pageNumber || pageNum
        };
        promptEnd = {
          surahNumber: anchor.surahNumber,
          ayahNumber: prevAyah,
          wordPosition: prevTotal,
          pageNumber: prevVerse?.pageNumber || pageNum
        };
      } else {
        // Ayat ini adalah ayat pertama surat: Geser B ke kata 2 (jika kata >= 2) agar prompt dapat ditempatkan di kata 1
        if (totalWords >= 2) {
          answerStart.wordPosition = 2;
          promptStart = {
            surahNumber: anchor.surahNumber,
            ayahNumber: anchor.ayahNumber,
            wordPosition: 1,
            pageNumber: pageNum
          };
          promptEnd = {
            surahNumber: anchor.surahNumber,
            ayahNumber: anchor.ayahNumber,
            wordPosition: 1,
            pageNumber: pageNum
          };
        } else {
          // Ayat sangat pendek (hanya 1 kata): Tidak ideal untuk sambung ayat mandiri
          return null;
        }
      }
    }

    // JAWABAN: B .. C (Target ~15-30 kata lanjutan atau 1-2 ayat berikutnya)
    const targetWordCount = (difficultyTarget === 'easy') ? 15 : (difficultyTarget === 'hard') ? 30 : 22;
    let accumulatedWords = Math.max(1, totalWords - answerStart.wordPosition + 1);
    let cSurah = anchor.surahNumber;
    let cAyah = anchor.ayahNumber;
    let cWord = totalWords;
    let cPage = pageNum;

    const totalInSurah = SURAH_TOTAL_AYAHS[anchor.surahNumber] || 1;
    let nextA = anchor.ayahNumber;

    while (accumulatedWords < targetWordCount && nextA < totalInSurah) {
      // Cek apakah ayat berikutnya masih dalam batas Juz
      if (anchor.surahNumber === boundary.endSurah && nextA >= boundary.endAyah) {
        break;
      }

      nextA++;
      const nextV = await this.getVerseSafe(anchor.surahNumber, nextA);
      const nextW = (nextV?.words || []).filter(w => w.charTypeName !== 'end');
      const nextTotal = Math.max(1, nextW.length);

      if (accumulatedWords + nextTotal <= targetWordCount) {
        accumulatedWords += nextTotal;
        cAyah = nextA;
        cWord = nextTotal;
        cPage = nextV?.pageNumber || cPage;
      } else {
        const needed = targetWordCount - accumulatedWords;
        cAyah = nextA;
        cWord = Math.min(nextTotal, Math.max(1, needed));
        cPage = nextV?.pageNumber || cPage;
        accumulatedWords += cWord;
        break;
      }
    }

    const answerEnd: QuranPosition = {
      surahNumber: cSurah,
      ayahNumber: cAyah,
      wordPosition: cWord,
      pageNumber: cPage
    };

    // Validasi Integritas Posisi Struktural Al-Qur'an (A <= A' < B <= C)
    const valResult = validateQuestionPositions(promptStart, promptEnd, answerStart, answerEnd);
    if (!valResult.valid) {
      return null;
    }

    // Ambil Teks untuk Preview (Menggunakan QuranService)
    let promptText = '';
    let answerText = '';

    try {
      const promptRange = await quranService.getRangeWordsAndText(promptStart, promptEnd, false);
      promptText = promptRange.fullText.trim();
    } catch {
      promptText = `[QS. ${anchor.surahNumber}:${promptStart.ayahNumber}:${promptStart.wordPosition} s.d. ${promptEnd.ayahNumber}:${promptEnd.wordPosition}]`;
    }

    try {
      const answerRange = await quranService.getRangeWordsAndText(answerStart, answerEnd, false);
      answerText = answerRange.fullText.trim();
    } catch {
      answerText = `[QS. ${anchor.surahNumber}:${answerStart.ayahNumber}:${answerStart.wordPosition} s.d. ${answerEnd.ayahNumber}:${answerEnd.wordPosition}]`;
    }

    const surahInfo = quranService.getSurah(anchor.surahNumber);
    const surahName = surahInfo?.name || `Surat ${anchor.surahNumber}`;
    const id = `qb_cand_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    return {
      id,
      surahNumber: anchor.surahNumber,
      surahName,
      ayahNumber: anchor.ayahNumber,
      pageNumber: pageNum,
      juzNumber: anchor.juzNumber,
      promptStart,
      promptEnd,
      answerStart,
      answerEnd,
      promptText,
      answerText,
      totalExpectedWords: accumulatedWords,
      difficulty: difficultyTarget,
      answerMode: 'end_ayah',
      selected: true,
      status: 'draft'
    };
  }

  // Engine Utama: Generate Batch Kandidat Soal
  public static async generateCandidates(
    options: QuickGeneratorOptions,
    existingBankItems: QuestionBankItem[] = []
  ): Promise<GenerationResult> {
    let allAnchors: AyahAnchor[] = [];
    let boundary: JuzBoundary;

    if (options.materialType === 'surah' && options.surahNumber) {
      const sNum = options.surahNumber;
      allAnchors = this.getAllAyahsInSurah(sNum);
      const sInfo = quranService.getSurah(sNum);
      const sPage = sInfo?.startPage || 1;
      boundary = {
        juz: quranService.getPageJuz(sPage),
        startSurah: sNum,
        startAyah: 1,
        endSurah: sNum,
        endAyah: SURAH_TOTAL_AYAHS[sNum] || 1,
        startPage: sPage,
        endPage: Math.min(604, sPage + 3)
      };
    } else if (options.materialType === 'page' && options.startPage && options.endPage) {
      const minP = Math.min(options.startPage, options.endPage);
      const maxP = Math.max(options.startPage, options.endPage);
      allAnchors = await this.getAllAyahsInPageRange(minP, maxP);
      boundary = {
        juz: quranService.getPageJuz(minP),
        startSurah: allAnchors[0]?.surahNumber || 1,
        startAyah: allAnchors[0]?.ayahNumber || 1,
        endSurah: allAnchors[allAnchors.length - 1]?.surahNumber || 114,
        endAyah: allAnchors[allAnchors.length - 1]?.ayahNumber || 6,
        startPage: minP,
        endPage: maxP
      };
    } else {
      // Default: Juz
      const juzBoundary = CANONICAL_JUZ_BOUNDARIES[options.juz];
      if (!juzBoundary) {
        return {
          candidates: [],
          requestedCount: options.count,
          availableCount: 0,
          insufficientPool: true,
          warningMessage: `Juz ${options.juz} tidak valid.`
        };
      }
      boundary = juzBoundary;
      allAnchors = this.getAllAyahsInJuz(options.juz);
    }

    if (allAnchors.length === 0) {
      return {
        candidates: [],
        requestedCount: options.count,
        availableCount: 0,
        insufficientPool: true,
        warningMessage: `Tidak ditemukan ayat pada materi yang dipilih.`
      };
    }

    // 2. Buat Set Fingerprint Soal Eksisting untuk Duplicate Avoidance
    const existingFingerprints = new Set<string>();
    if (options.avoidExisting) {
      for (const item of existingBankItems) {
        if (item.promptStart && item.promptEnd && item.answerStart && item.answerEnd) {
          const fp = buildQuestionFingerprint(
            item.promptStart.surahNumber, item.promptStart.ayahNumber, item.promptStart.wordPosition,
            item.promptEnd.surahNumber, item.promptEnd.ayahNumber, item.promptEnd.wordPosition,
            item.answerStart.surahNumber, item.answerStart.ayahNumber, item.answerStart.wordPosition,
            item.answerEnd.surahNumber, item.answerEnd.ayahNumber, item.answerEnd.wordPosition
          );
          existingFingerprints.add(fp);
        }
      }
    }

    // 3. Menyiapkan Array Zonasi Jika "Sebarkan soal secara merata" Aktif
    const targetCount = Math.max(1, Math.min(200, options.count));
    const generatedCandidates: QuickQuestionCandidate[] = [];
    const batchFingerprints = new Set<string>();
    const chosenAnchorPositions: { surah: number; ayah: number }[] = [];

    // Helper cek jarak antar anchor (Near-Distance Avoidance: jarak <= 2 ayat pada surat yang sama)
    const isNearDistanceViolation = (surah: number, ayah: number): boolean => {
      if (!options.avoidNearDistance) return false;
      return chosenAnchorPositions.some(pos => 
        pos.surah === surah && Math.abs(pos.ayah - ayah) <= 2
      );
    };

    // Helper menentukan target difficulty untuk indeks tertentu
    const getTargetDifficulty = (index: number): 'easy' | 'medium' | 'hard' => {
      if (options.difficulty === 'easy') return 'easy';
      if (options.difficulty === 'hard') return 'hard';
      if (options.difficulty === 'medium') return 'medium';
      // Mode 'mixed' (Campuran): 30% Mudah, 40% Sedang, 30% Sulit
      const mod = index % 10;
      if (mod < 3) return 'easy';
      if (mod < 7) return 'medium';
      return 'hard';
    };

    // 4. Pembagian Zonasi
    // Buat salinan anchor yang dapat diacak atau dibagi rata
    let eligibleAnchors = [...allAnchors];

    if (options.spreadEvenly) {
      const zoneCount = targetCount;
      const zoneSize = eligibleAnchors.length / zoneCount;

      for (let z = 0; z < zoneCount; z++) {
        const zoneStart = Math.floor(z * zoneSize);
        const zoneEnd = Math.min(eligibleAnchors.length, Math.floor((z + 1) * zoneSize));
        const zoneAnchors = eligibleAnchors.slice(zoneStart, Math.max(zoneStart + 1, zoneEnd));

        // Cari anchor valid di dalam zona ini
        let candidateFound = false;
        // Acak sedikit urutan kandidat dalam zona agar tidak selalu mengambil ayat pertama zona
        const shuffledZone = [...zoneAnchors].sort(() => Math.random() - 0.5);

        for (const anchor of shuffledZone) {
          if (isNearDistanceViolation(anchor.surahNumber, anchor.ayahNumber)) {
            continue;
          }

          const diff = getTargetDifficulty(generatedCandidates.length);
          const cand = await this.constructSambungAyatCandidate(anchor, diff, boundary);
          if (!cand) continue;

          const fp = getCandidateFingerprint(cand);
          if (batchFingerprints.has(fp) || existingFingerprints.has(fp)) {
            continue;
          }

          // Sukses menemukan kandidat untuk zona ini!
          batchFingerprints.add(fp);
          chosenAnchorPositions.push({ surah: anchor.surahNumber, ayah: anchor.ayahNumber });
          generatedCandidates.push(cand);
          candidateFound = true;
          break;
        }
      }
    } else {
      // Non-spread evenly: Acak seluruh pool anchor
      const shuffledAnchors = [...eligibleAnchors].sort(() => Math.random() - 0.5);

      for (const anchor of shuffledAnchors) {
        if (generatedCandidates.length >= targetCount) break;

        if (isNearDistanceViolation(anchor.surahNumber, anchor.ayahNumber)) {
          continue;
        }

        const diff = getTargetDifficulty(generatedCandidates.length);
        const cand = await this.constructSambungAyatCandidate(anchor, diff, boundary);
        if (!cand) continue;

        const fp = getCandidateFingerprint(cand);
        if (batchFingerprints.has(fp) || existingFingerprints.has(fp)) {
          continue;
        }

        batchFingerprints.add(fp);
        chosenAnchorPositions.push({ surah: anchor.surahNumber, ayah: anchor.ayahNumber });
        generatedCandidates.push(cand);
      }
    }

    // 5. Penanganan Kolam Kurang (Insufficient Pool Handling)
    const availableCount = generatedCandidates.length;
    const isInsufficient = availableCount < targetCount;

    return {
      candidates: generatedCandidates,
      requestedCount: targetCount,
      availableCount,
      insufficientPool: isInsufficient,
      warningMessage: isInsufficient 
        ? `Materi yang dipilih hanya memiliki ${availableCount} kandidat unik sesuai kriteria (diminta: ${targetCount}).`
        : undefined
    };
  }

  // Regenerasi Tunggal 1 Kandidat (Single Replacement)
  public static async regenerateSingleCandidate(
    targetIndex: number,
    currentCandidates: QuickQuestionCandidate[],
    options: QuickGeneratorOptions,
    existingBankItems: QuestionBankItem[] = []
  ): Promise<QuickQuestionCandidate | null> {
    if (targetIndex < 0 || targetIndex >= currentCandidates.length) {
      return null;
    }

    let boundary: JuzBoundary;
    let allAnchors: AyahAnchor[] = [];

    if (options.materialType === 'surah' && options.surahNumber) {
      const sNum = options.surahNumber;
      allAnchors = this.getAllAyahsInSurah(sNum);
      const sInfo = quranService.getSurah(sNum);
      const sPage = sInfo?.startPage || 1;
      boundary = {
        juz: quranService.getPageJuz(sPage),
        startSurah: sNum,
        startAyah: 1,
        endSurah: sNum,
        endAyah: SURAH_TOTAL_AYAHS[sNum] || 1,
        startPage: sPage,
        endPage: Math.min(604, sPage + 3)
      };
    } else if (options.materialType === 'page' && options.startPage && options.endPage) {
      const minP = Math.min(options.startPage, options.endPage);
      const maxP = Math.max(options.startPage, options.endPage);
      allAnchors = await this.getAllAyahsInPageRange(minP, maxP);
      boundary = {
        juz: quranService.getPageJuz(minP),
        startSurah: allAnchors[0]?.surahNumber || 1,
        startAyah: allAnchors[0]?.ayahNumber || 1,
        endSurah: allAnchors[allAnchors.length - 1]?.surahNumber || 114,
        endAyah: allAnchors[allAnchors.length - 1]?.ayahNumber || 6,
        startPage: minP,
        endPage: maxP
      };
    } else {
      const juzBoundary = CANONICAL_JUZ_BOUNDARIES[options.juz];
      if (!juzBoundary) return null;
      boundary = juzBoundary;
      allAnchors = this.getAllAyahsInJuz(options.juz);
    }
    const existingFingerprints = new Set<string>();

    if (options.avoidExisting) {
      for (const item of existingBankItems) {
        if (item.promptStart && item.promptEnd && item.answerStart && item.answerEnd) {
          const fp = buildQuestionFingerprint(
            item.promptStart.surahNumber, item.promptStart.ayahNumber, item.promptStart.wordPosition,
            item.promptEnd.surahNumber, item.promptEnd.ayahNumber, item.promptEnd.wordPosition,
            item.answerStart.surahNumber, item.answerStart.ayahNumber, item.answerStart.wordPosition,
            item.answerEnd.surahNumber, item.answerEnd.ayahNumber, item.answerEnd.wordPosition
          );
          existingFingerprints.add(fp);
        }
      }
    }

    // Fingerprint dari kandidat lain di dalam batch saat ini (kecuali yang sedang diganti)
    const otherBatchFingerprints = new Set<string>();
    const otherPositions: { surah: number; ayah: number }[] = [];

    currentCandidates.forEach((c, idx) => {
      if (idx !== targetIndex) {
        otherBatchFingerprints.add(getCandidateFingerprint(c));
        otherPositions.push({ surah: c.surahNumber, ayah: c.ayahNumber });
      }
    });

    const isNearViolation = (surah: number, ayah: number): boolean => {
      if (!options.avoidNearDistance) return false;
      return otherPositions.some(p => p.surah === surah && Math.abs(p.ayah - ayah) <= 2);
    };

    // Prioritaskan tingkat kesulitan yang sama dengan kandidat yang sedang diganti
    const currentDifficulty = currentCandidates[targetIndex].difficulty;

    // Acak pool ayat untuk mencari kandidat pengganti unik
    const shuffledAnchors = [...allAnchors].sort(() => Math.random() - 0.5);

    for (const anchor of shuffledAnchors) {
      if (isNearViolation(anchor.surahNumber, anchor.ayahNumber)) {
        continue;
      }

      const replacement = await this.constructSambungAyatCandidate(anchor, currentDifficulty, boundary);
      if (!replacement) continue;

      const fp = getCandidateFingerprint(replacement);
      if (otherBatchFingerprints.has(fp) || existingFingerprints.has(fp)) {
        continue;
      }

      // Berhasil menemukan pengganti yang valid dan non-duplikat!
      return replacement;
    }

    return null;
  }
}
