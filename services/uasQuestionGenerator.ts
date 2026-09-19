import { 
  ExamMaterialSnapshot, 
  ExamPeriod, 
  ExamQuestionSet, 
  ExamQuestion, 
  GeneratedUASQuestion, 
  GeneratedUASQuestionSet, 
  MaterialPath, 
  MaterialPathNode, 
  MaterialZone, 
  QuranPosition, 
  QuranVerse, 
  QuranWord, 
  QuestionBankItem, 
  UASGenerationStrategy, 
  MemorizationDirection,
  QuestionSourceType
} from '../types';
import { quranService, SURAH_TOTAL_AYAHS, comparePositions } from './quranService';
import { SURAH_LIST } from '../constants';
import { md5, createPRNG } from './utsQuestionGenerator';
import { MUSHAF_604_PAGE_BOUNDARIES, PageWordBoundary } from '../constants/mushafPageBoundaries';

// ============================================================
// STANDARD 15-LINE MADINAH MUSHAF PAGE BOUNDARY LOOKUP
// Memetakan awal dan akhir setiap halaman (Halaman 1-604)
// Word-level boundaries (surah, ayah, word position)
// ============================================================
export interface PageBoundary extends PageWordBoundary {
  juzNumber?: number;
}


export class UASQuestionGenerator {
  /**
   * Mengambil nama surah dari nomor surah (1-114)
   */
  public getSurahName(surahNumber: number): string {
    if (surahNumber < 1 || surahNumber > 114) return `Surat ${surahNumber}`;
    return SURAH_LIST[surahNumber - 1] || `Surat ${surahNumber}`;
  }

  /**
   * Hitung material fingerprint (identik dengan DB function calculate_material_fingerprint)
   */
  public calculateMaterialFingerprint(snapshot: ExamMaterialSnapshot): string {
    const raw = `${snapshot.startSurah}:${snapshot.startAyah}-${snapshot.endSurah}:${snapshot.endAyah}-${snapshot.memorizationDirection || 'forward'}`;
    return md5(raw);
  }

  /**
   * Membangun MaterialPath sekuensial yang menghormati arah pedagogis hafalan
   */
  public buildMaterialPath(snapshot: ExamMaterialSnapshot): MaterialPath {
    const nodes: MaterialPathNode[] = [];
    const direction = snapshot.memorizationDirection || 'forward';
    let pedagogicalIndex = 0;

    if (direction === 'backward') {
      const startS = Math.max(snapshot.startSurah, snapshot.endSurah);
      const endS = Math.min(snapshot.startSurah, snapshot.endSurah);

      for (let s = startS; s >= endS; s--) {
        const totalAyahs = SURAH_TOTAL_AYAHS[s] || 1;
        const startA = (s === startS) ? snapshot.startAyah : 1;
        const endA = (s === endS) ? snapshot.endAyah : totalAyahs;

        const surahInfo = quranService.getSurah(s);
        const startPage = surahInfo?.startPage || 1;

        for (let a = startA; a <= endA; a++) {
          nodes.push({
            surahNumber: s,
            ayahNumber: a,
            pedagogicalIndex: pedagogicalIndex++,
            pageNumber: startPage,
            surahName: this.getSurahName(s)
          });
        }
      }
    } else {
      const startS = snapshot.startSurah;
      const endS = snapshot.endSurah;

      if (startS === endS) {
        const surahInfo = quranService.getSurah(startS);
        const startPage = surahInfo?.startPage || 1;
        const minA = Math.min(snapshot.startAyah, snapshot.endAyah);
        const maxA = Math.max(snapshot.startAyah, snapshot.endAyah);

        for (let a = minA; a <= maxA; a++) {
          nodes.push({
            surahNumber: startS,
            ayahNumber: a,
            pedagogicalIndex: pedagogicalIndex++,
            pageNumber: startPage,
            surahName: this.getSurahName(startS)
          });
        }
      } else {
        for (let s = startS; s <= endS; s++) {
          const totalAyahs = SURAH_TOTAL_AYAHS[s] || 1;
          const startA = (s === startS) ? snapshot.startAyah : 1;
          const endA = (s === endS) ? snapshot.endAyah : totalAyahs;

          const surahInfo = quranService.getSurah(s);
          const startPage = surahInfo?.startPage || 1;

          for (let a = startA; a <= endA; a++) {
            nodes.push({
              surahNumber: s,
              ayahNumber: a,
              pedagogicalIndex: pedagogicalIndex++,
              pageNumber: startPage,
              surahName: this.getSurahName(s)
            });
          }
        }
      }
    }

    return {
      nodes,
      direction,
      startSurah: snapshot.startSurah,
      startAyah: snapshot.startAyah,
      endSurah: snapshot.endSurah,
      endAyah: snapshot.endAyah,
      totalAyahs: nodes.length
    };
  }

  /**
   * Mengambil boundary kata awal dan akhir untuk halaman 1-604
   * Berdasarkan data kata Madinah Mushaf (Hafs 'an 'Asim, 604 halaman)
   */
  public async getPageWordBoundary(pageNumber: number): Promise<PageWordBoundary> {
    const clamped = Math.max(1, Math.min(604, pageNumber));
    if (MUSHAF_604_PAGE_BOUNDARIES[clamped]) {
      return MUSHAF_604_PAGE_BOUNDARIES[clamped];
    }

    // Fallback live via quranService jika di luar cache
    try {
      const verses = await quranService.getVersesByPage(clamped);
      if (verses && verses.length > 0) {
        const contentVerses = verses.filter(v => v.words && v.words.length > 0);
        const firstVerse = contentVerses[0];
        const lastVerse = contentVerses[contentVerses.length - 1];
        const firstWords = (firstVerse?.words || []).filter(w => w.charTypeName !== 'end');
        const lastWords = (lastVerse?.words || []).filter(w => w.charTypeName !== 'end');

        return {
          pageNumber: clamped,
          startSurah: firstVerse.surahNumber,
          startAyah: firstVerse.ayahNumber,
          startWord: firstWords[0]?.position || 1,
          endSurah: lastVerse.surahNumber,
          endAyah: lastVerse.ayahNumber,
          endWord: lastWords[lastWords.length - 1]?.position || 1,
          verses: contentVerses.map(v => ({ surah: v.surahNumber, ayah: v.ayahNumber }))
        };
      }
    } catch (e) {}

    // Fallback darurat jika offline mutlak
    return {
      pageNumber: clamped,
      startSurah: 1,
      startAyah: 1,
      startWord: 1,
      endSurah: 1,
      endAyah: 7,
      endWord: 9,
      verses: [{ surah: 1, ayah: 1 }]
    };
  }

  /**
   * Mengambil daftar ayat pada suatu halaman Mushaf (1-604)
   */
  public async getPageVersesList(pageNumber: number): Promise<{ surah: number; ayah: number }[]> {
    const b = await this.getPageWordBoundary(pageNumber);
    return b.verses;
  }

  /**
   * KLAUSUL 8, 9, 51: PAGE-LEVEL & WORD-LEVEL BOUNDARY VALIDATION
   * Memvalidasi apakah SATU HALAMAN MUSHAF PENUH (seluruh kata dan ayat di halaman tersebut)
   * 100% berada di dalam finalized snapshot santri.
   *
   * Sesuai audit kriteria:
   * firstWordPage >= material boundary AND lastWordPage <= material boundary
   * Menangani ayat yang melintasi dua halaman (cross-page ayah).
   */
  public async isFullPageEligible(
    pageNumber: number,
    snapshot: ExamMaterialSnapshot,
    path: MaterialPath
  ): Promise<boolean> {
    if (pageNumber < 1 || pageNumber > 604) return false;
    if (!path.nodes || path.nodes.length === 0) return false;

    // 1. Ambil word-level boundary halaman dari Mushaf authoritative metadata / QuranService
    const pageBoundary = await this.getPageWordBoundary(pageNumber);

    const firstWordPage: QuranPosition = {
      surahNumber: pageBoundary.startSurah,
      ayahNumber: pageBoundary.startAyah,
      wordPosition: pageBoundary.startWord,
      pageNumber
    };

    const lastWordPage: QuranPosition = {
      surahNumber: pageBoundary.endSurah,
      ayahNumber: pageBoundary.endAyah,
      wordPosition: pageBoundary.endWord,
      pageNumber
    };

    // 2. Hitung material boundary canonical (dalam textual Quran order: surah -> ayah -> word)
    let minSurah = 115, minAyah = 999;
    let maxSurah = 0, maxAyah = 0;
    for (const n of path.nodes) {
      if (n.surahNumber < minSurah || (n.surahNumber === minSurah && n.ayahNumber < minAyah)) {
        minSurah = n.surahNumber;
        minAyah = n.ayahNumber;
      }
      if (n.surahNumber > maxSurah || (n.surahNumber === maxSurah && n.ayahNumber > maxAyah)) {
        maxSurah = n.surahNumber;
        maxAyah = n.ayahNumber;
      }
    }

    const materialMin: QuranPosition = {
      surahNumber: minSurah,
      ayahNumber: minAyah,
      wordPosition: 1,
      pageNumber: path.nodes[0]?.pageNumber || 1
    };

    // Ambil total kata pada ayat terakhir materi untuk word-level boundary presisi
    const maxVerse = await this.getVerseSafe(maxSurah, maxAyah);
    const maxVerseWords = (maxVerse?.words || []).filter(w => w.charTypeName !== 'end');
    const maxTotalWords = Math.max(1, maxVerseWords.length);

    const materialMax: QuranPosition = {
      surahNumber: maxSurah,
      ayahNumber: maxAyah,
      wordPosition: maxTotalWords,
      pageNumber: maxVerse?.pageNumber || path.nodes[path.nodes.length - 1]?.pageNumber || 1
    };

    // 3. Word-level range check:
    // firstWordPage >= materialMin
    if (comparePositions(firstWordPage, materialMin) < 0) {
      return false;
    }

    // lastWordPage <= materialMax
    if (comparePositions(lastWordPage, materialMax) > 0) {
      return false;
    }

    // 4. Verifikasi seluruh ayat pada halaman ini ada di dalam path.nodes
    // (Mencegah celah jika materi santri tidak berurutan / melompati surat di tengah halaman)
    for (const pv of pageBoundary.verses) {
      const hasVerse = path.nodes.some(n => n.surahNumber === pv.surah && n.ayahNumber === pv.ayah);
      if (!hasVerse) {
        return false;
      }
    }

    return true;
  }

  /**
   * KLAUSUL 15: 7-ZONE STRATIFIED RANDOMIZATION
   * Membagi MaterialPath menjadi tepat 7 zona yang mewakili masing-masing ~14.28% materi
   */
  public divideIntoZones(path: MaterialPath): MaterialZone[] {
    const total = path.nodes.length;
    if (total === 0) {
      throw new Error('Materi santri kosong.');
    }

    const zones: MaterialZone[] = [];
    for (let k = 0; k < 7; k++) {
      const startIndex = Math.floor((k * total) / 7);
      const endIndex = (k === 6) ? total - 1 : Math.floor(((k + 1) * total) / 7) - 1;
      const zoneNodes = path.nodes.slice(startIndex, endIndex + 1);

      zones.push({
        zoneNumber: k + 1,
        startIndex,
        endIndex: Math.max(startIndex, endIndex),
        nodes: zoneNodes.length > 0 ? zoneNodes : [path.nodes[Math.min(startIndex, total - 1)]],
        label: `Zona ${k + 1} (${Math.round((k * 100) / 7)}% - ${Math.round(((k + 1) * 100) / 7)}%)`
      });
    }

    return zones;
  }

  /**
   * Mengambil data ayat dengan fallback aman
   */
  public async getVerseSafe(surahNumber: number, ayahNumber: number): Promise<QuranVerse | null> {
    try {
      const v = await quranService.getVerse(surahNumber, ayahNumber);
      if (v) return v;
    } catch (e) {}

    const surahInfo = quranService.getSurah(surahNumber);
    return {
      verseKey: `${surahNumber}:${ayahNumber}`,
      surahNumber,
      ayahNumber,
      pageNumber: surahInfo?.startPage || 1,
      juzNumber: quranService.getPageJuz(surahInfo?.startPage || 1),
      textUthmani: `Ayat ${ayahNumber}`,
      words: [
        { id: `${surahNumber}_${ayahNumber}_1`, surahNumber, ayahNumber, position: 1, textUthmani: 'بِسْمِ', pageNumber: surahInfo?.startPage || 1, juzNumber: 1, charTypeName: 'word' },
        { id: `${surahNumber}_${ayahNumber}_2`, surahNumber, ayahNumber, position: 2, textUthmani: 'اللَّهِ', pageNumber: surahInfo?.startPage || 1, juzNumber: 1, charTypeName: 'word' },
        { id: `${surahNumber}_${ayahNumber}_3`, surahNumber, ayahNumber, position: 3, textUthmani: 'الرَّحْمَٰنِ', pageNumber: surahInfo?.startPage || 1, juzNumber: 1, charTypeName: 'word' },
        { id: `${surahNumber}_${ayahNumber}_4`, surahNumber, ayahNumber, position: 4, textUthmani: 'الرَّحِيمِ', pageNumber: surahInfo?.startPage || 1, juzNumber: 1, charTypeName: 'word' }
      ]
    };
  }

  /**
   * Pembangkitan koordinat titik A, A', B, C untuk soal acak sambung ayat
   */
  public async buildQuestionPoints(
    targetSurah: number,
    targetAyah: number,
    preferWordPosition: number | null,
    path: MaterialPath,
    snapshot: ExamMaterialSnapshot,
    prng: () => number
  ): Promise<{
    promptStart: QuranPosition;
    promptEnd: QuranPosition;
    answerStart: QuranPosition;
    answerEnd: QuranPosition;
    startPage: number;
    endPage: number;
    metadata: Record<string, any>;
  }> {
    const targetVerse = await this.getVerseSafe(targetSurah, targetAyah);
    const words = (targetVerse?.words || []).filter(w => w.charTypeName !== 'end');
    const totalWords = Math.max(1, words.length);

    let bWord = preferWordPosition;
    if (!bWord || bWord > totalWords) {
      if (totalWords <= 3) {
        bWord = Math.min(totalWords, Math.max(1, Math.floor(prng() * totalWords) + 1));
      } else {
        const maxChoice = Math.min(totalWords - 1, Math.max(2, Math.floor(totalWords / 2) + 1));
        bWord = Math.floor(prng() * (maxChoice - 1)) + 2;
      }
    }

    const nodeIndex = path.nodes.findIndex(n => n.surahNumber === targetSurah && n.ayahNumber === targetAyah);

    const answerStart: QuranPosition = {
      surahNumber: targetSurah,
      ayahNumber: targetAyah,
      wordPosition: bWord,
      pageNumber: targetVerse?.pageNumber || 1
    };

    let promptStart: QuranPosition;
    let promptEnd: QuranPosition;

    if (bWord > 1) {
      const wordsBeforeB = bWord - 1;
      const promptLen = Math.min(wordsBeforeB, Math.floor(prng() * 4) + 3);
      const aStartWord = Math.max(1, bWord - promptLen);

      promptStart = {
        surahNumber: targetSurah,
        ayahNumber: targetAyah,
        wordPosition: aStartWord,
        pageNumber: targetVerse?.pageNumber || 1
      };
      promptEnd = {
        surahNumber: targetSurah,
        ayahNumber: targetAyah,
        wordPosition: bWord - 1,
        pageNumber: targetVerse?.pageNumber || 1
      };
    } else {
      const prevNode = (nodeIndex > 0) ? path.nodes[nodeIndex - 1] : null;
      const canTakePrev = prevNode && (
        path.direction !== 'backward' ? true : prevNode.surahNumber === targetSurah
      );

      if (canTakePrev && prevNode) {
        const prevVerse = await this.getVerseSafe(prevNode.surahNumber, prevNode.ayahNumber);
        const prevWords = (prevVerse?.words || []).filter(w => w.charTypeName !== 'end');
        const prevTotal = Math.max(1, prevWords.length);
        const promptLen = Math.min(prevTotal, Math.floor(prng() * 4) + 3);
        const aStartWord = Math.max(1, prevTotal - promptLen + 1);

        promptStart = {
          surahNumber: prevNode.surahNumber,
          ayahNumber: prevNode.ayahNumber,
          wordPosition: aStartWord,
          pageNumber: prevVerse?.pageNumber || 1
        };
        promptEnd = {
          surahNumber: prevNode.surahNumber,
          ayahNumber: prevNode.ayahNumber,
          wordPosition: prevTotal,
          pageNumber: prevVerse?.pageNumber || 1
        };
      } else {
        if (totalWords >= 2) {
          answerStart.wordPosition = 2;
          promptStart = {
            surahNumber: targetSurah,
            ayahNumber: targetAyah,
            wordPosition: 1,
            pageNumber: targetVerse?.pageNumber || 1
          };
          promptEnd = {
            surahNumber: targetSurah,
            ayahNumber: targetAyah,
            wordPosition: 1,
            pageNumber: targetVerse?.pageNumber || 1
          };
        } else {
          promptStart = { ...answerStart, wordPosition: 1 };
          promptEnd = { ...answerStart, wordPosition: 1 };
        }
      }
    }

    // Target jawaban: 20-35 kata (~3-5 baris mushaf)
    const targetWordCount = Math.floor(prng() * 15) + 20;
    let accumulatedWords = Math.max(1, totalWords - answerStart.wordPosition + 1);
    let cSurah = targetSurah;
    let cAyah = targetAyah;
    let cWord = totalWords;
    let cPage = targetVerse?.pageNumber || 1;
    let currentNodeIdx = nodeIndex;

    while (accumulatedWords < targetWordCount && currentNodeIdx < path.nodes.length - 1) {
      const nextNode = path.nodes[currentNodeIdx + 1];
      if (path.direction === 'backward' && nextNode.surahNumber !== targetSurah) {
        break; // Clamp jawaban di akhir surat pada backward material
      }

      currentNodeIdx++;
      const nextVerse = await this.getVerseSafe(nextNode.surahNumber, nextNode.ayahNumber);
      const nextWords = (nextVerse?.words || []).filter(w => w.charTypeName !== 'end');
      const nextTotal = Math.max(1, nextWords.length);

      if (accumulatedWords + nextTotal <= targetWordCount) {
        accumulatedWords += nextTotal;
        cSurah = nextNode.surahNumber;
        cAyah = nextNode.ayahNumber;
        cWord = nextTotal;
        cPage = nextVerse?.pageNumber || cPage;
      } else {
        const needed = targetWordCount - accumulatedWords;
        cSurah = nextNode.surahNumber;
        cAyah = nextNode.ayahNumber;
        cWord = Math.min(nextTotal, Math.max(1, needed));
        cPage = nextVerse?.pageNumber || cPage;
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

    return {
      promptStart,
      promptEnd,
      answerStart,
      answerEnd,
      startPage: promptStart.pageNumber,
      endPage: answerEnd.pageNumber,
      metadata: {
        surahName: this.getSurahName(targetSurah),
        endSurahName: this.getSurahName(cSurah),
        totalExpectedWords: accumulatedWords,
        answerMode: 'continuation',
        difficulty: 'medium'
      }
    };
  }

  /**
   * KLAUSUL 6, 10, 11, 12: PEMILIHAN 2 SOAL WAJIB DARI BANK SOAL
   */
  public async selectMandatoryQuestions(
    bankQuestions: QuestionBankItem[],
    snapshot: ExamMaterialSnapshot,
    path: MaterialPath,
    prng: () => number,
    minimumPageSpacing: number = 2
  ): Promise<QuestionBankItem[]> {
    // 1. Filter bank soal: aktif, mandatory, exam_type uas/generic
    const candidates = bankQuestions.filter(bq => {
      const isActive = (bq.status === 'active');
      const isMandatory = (bq.questionType === 'mandatory');
      const isExamMatch = (bq.examType === 'uas' || bq.examType === 'generic');
      return isActive && isMandatory && isExamMatch;
    });

    // 2. Filter yang 100% full-page eligible terhadap snapshot santri
    const validCandidates: QuestionBankItem[] = [];
    for (const c of candidates) {
      const pageNum = c.pageNumber || c.startPage;
      if (pageNum && await this.isFullPageEligible(pageNum, snapshot, path)) {
        validCandidates.push(c);
      }
    }

    // 3. Klausul 12: Jika < 2 kandidat valid -> THROW MANDATORY_POOL_INSUFFICIENT
    if (validCandidates.length < 2) {
      throw new Error('Soal wajib UAS yang sesuai dengan materi santri belum mencukupi. Dibutuhkan minimal 2 halaman wajib.');
    }

    // 4. Pilih 2 halaman dengan pageNumber berbeda
    // Prioritaskan yang memenuhi minimumPageSpacing jika ada
    const pairsWithSpacing: [QuestionBankItem, QuestionBankItem][] = [];
    const pairsDifferentPage: [QuestionBankItem, QuestionBankItem][] = [];

    for (let i = 0; i < validCandidates.length; i++) {
      for (let j = i + 1; j < validCandidates.length; j++) {
        const p1 = validCandidates[i].pageNumber || validCandidates[i].startPage;
        const p2 = validCandidates[j].pageNumber || validCandidates[j].startPage;
        if (p1 !== p2) {
          pairsDifferentPage.push([validCandidates[i], validCandidates[j]]);
          if (Math.abs(p1 - p2) >= minimumPageSpacing) {
            pairsWithSpacing.push([validCandidates[i], validCandidates[j]]);
          }
        }
      }
    }

    if (pairsDifferentPage.length === 0) {
      throw new Error('Soal wajib UAS yang sesuai dengan materi santri belum mencukupi. Dibutuhkan minimal 2 halaman wajib yang berbeda.');
    }

    const poolToChooseFrom = pairsWithSpacing.length > 0 ? pairsWithSpacing : pairsDifferentPage;
    const chosenIndex = Math.floor(prng() * poolToChooseFrom.length);
    return poolToChooseFrom[chosenIndex];
  }

  /**
   * KLAUSUL 47: VALIDASI LENGKAP 9 BUTIR SOAL UAS
   */
  public validateGeneratedQuestion(
    q: GeneratedUASQuestion,
    path: MaterialPath,
    snapshot: ExamMaterialSnapshot
  ): { valid: boolean; reason?: string } {
    if (q.questionNumber < 1 || q.questionNumber > 9) {
      return { valid: false, reason: 'Nomor soal harus antara 1 dan 9.' };
    }

    if (q.questionRole === 'mandatory') {
      if (q.questionNumber > 2) {
        return { valid: false, reason: 'Soal wajib hanya boleh bernomor 1 atau 2.' };
      }
      if (q.maxScore !== 15) {
        return { valid: false, reason: 'Soal wajib harus memiliki bobot skor maksimal 15.' };
      }
      if (!q.pageNumber || q.pageNumber < 1 || q.pageNumber > 604) {
        return { valid: false, reason: 'Nomor halaman soal wajib tidak valid.' };
      }
      if (comparePositions(q.answerStart, q.answerEnd) > 0) {
        return { valid: false, reason: 'Urutan kata awal dan akhir halaman wajib tidak valid.' };
      }
    } else {
      if (q.questionNumber < 3 || q.questionNumber > 9) {
        return { valid: false, reason: 'Soal acak harus bernomor antara 3 dan 9.' };
      }
      if (!q.zoneNumber || q.zoneNumber < 1 || q.zoneNumber > 7) {
        return { valid: false, reason: 'Nomor zona soal acak harus antara 1 dan 7.' };
      }
      if (q.maxScore !== 10) {
        return { valid: false, reason: 'Soal acak harus memiliki bobot skor maksimal 10.' };
      }
      if (!q.promptStart || !q.promptEnd) {
        return { valid: false, reason: 'Soal acak sambung ayat wajib memiliki prompt penguji.' };
      }
      if (comparePositions(q.promptStart, q.promptEnd) > 0) {
        return { valid: false, reason: 'Urutan A ke A\' tidak valid.' };
      }
      if (comparePositions(q.promptEnd, q.answerStart) >= 0) {
        return { valid: false, reason: 'Urutan A\' ke B tidak valid (B harus setelah A\').' };
      }
      if (comparePositions(q.answerStart, q.answerEnd) > 0) {
        return { valid: false, reason: 'Urutan B ke C tidak valid.' };
      }
    }

    return { valid: true };
  }

  /**
   * FUNGSI UTAMA: GENERATE EXACTLY 9 SOAL UAS SANTRI
   */
  public async generateUASQuestionSet(params: {
    period: ExamPeriod;
    snapshot: ExamMaterialSnapshot;
    strategy?: UASGenerationStrategy;
    seed?: string;
    bankQuestions?: QuestionBankItem[];
    actorId?: string;
  }): Promise<GeneratedUASQuestionSet> {
    const { period, snapshot, strategy = 'hybrid', bankQuestions = [], actorId } = params;

    // 1. Validasi snapshot final
    if (snapshot.status !== 'finalized') {
      throw new Error('Materi UAS santri belum difinalisasi.');
    }

    if (period.examType !== 'uas') {
      throw new Error('Generator ini khusus untuk periode ujian UAS.');
    }

    // 2. Bentuk MaterialPath semester penuh (Awal semester -> Capaian akhir semester)
    const path = this.buildMaterialPath(snapshot);
    if (path.nodes.length === 0) {
      throw new Error('Materi terlalu pendek untuk menghasilkan soal UAS.');
    }

    // 3. Inisialisasi PRNG deterministik
    const seed = params.seed || `seed_uas_${period.id}_${snapshot.studentId}_${Date.now()}`;
    const prng = createPRNG(seed);

    // 4. PEMILIHAN 2 SOAL WAJIB (Soal 1 & 2)
    const chosenMandatoryBank = await this.selectMandatoryQuestions(bankQuestions, snapshot, path, prng, 2);
    const mandatoryPages = chosenMandatoryBank.map(m => m.pageNumber || m.startPage);

    const questions: GeneratedUASQuestion[] = [];

    // Tambahkan 2 Soal Wajib ke daftar
    for (let mIdx = 0; mIdx < 2; mIdx++) {
      const mb = chosenMandatoryBank[mIdx];
      const pageNum = mb.pageNumber || mb.startPage;
      const pageBoundary = await this.getPageWordBoundary(pageNum);

      const answerStart: QuranPosition = {
        surahNumber: pageBoundary.startSurah,
        ayahNumber: pageBoundary.startAyah,
        wordPosition: pageBoundary.startWord,
        pageNumber: pageNum
      };

      const answerEnd: QuranPosition = {
        surahNumber: pageBoundary.endSurah,
        ayahNumber: pageBoundary.endAyah,
        wordPosition: pageBoundary.endWord,
        pageNumber: pageNum
      };

      questions.push({
        questionNumber: mIdx + 1,
        questionRole: 'mandatory',
        zoneNumber: null,
        sourceType: 'bank',
        questionBankId: mb.id,
        pageNumber: pageNum,
        maxScore: 15,
        promptStart: null,
        promptEnd: null,
        answerStart,
        answerEnd,
        startPage: pageNum,
        endPage: pageNum,
        metadata: {
          isFullPage: true,
          pageNumber: pageNum,
          startSurah: pageBoundary.startSurah,
          startAyah: pageBoundary.startAyah,
          endSurah: pageBoundary.endSurah,
          endAyah: pageBoundary.endAyah,
          surahName: this.getSurahName(pageBoundary.startSurah),
          endSurahName: this.getSurahName(pageBoundary.endSurah),
          notes: mb.notes || `Soal Wajib Halaman ${pageNum}`
        },
        promptTextPreview: `Bacakan Mushaf Standar Madinah Halaman ${pageNum} secara penuh.`,
        answerTextPreview: `[Halaman ${pageNum}] ${this.getSurahName(pageBoundary.startSurah)}:${pageBoundary.startAyah} s.d. ${this.getSurahName(pageBoundary.endSurah)}:${pageBoundary.endAyah}`
      });
    }

    // 5. PEMBAGIAN 7 ZONA STRATIFIKASI
    const zones = this.divideIntoZones(path);
    if (zones.length !== 7) {
      throw new Error('Pembagian zona gagal menghasilkan tepat 7 zona.');
    }

    // 6. GENERATE 7 SOAL ACAK (Soal 3 s.d. 9)
    const usedBKeys = new Set<string>();
    const makeBKey = (pos: QuranPosition) => `${pos.surahNumber}:${pos.ayahNumber}:${pos.wordPosition}`;

    for (let zIdx = 0; zIdx < 7; zIdx++) {
      const zone = zones[zIdx];
      const zoneNumber = zIdx + 1;
      const questionNumber = zIdx + 3; // 3 to 9

      // Cek apakah ada Bank Soal acak yang cocok untuk zona ini
      let chosenRandomBank: QuestionBankItem | null = null;
      if (strategy === 'hybrid' || strategy === 'bank_only') {
        const bankCandidates = bankQuestions.filter(bq => {
          if (bq.status !== 'active') return false;
          if (bq.questionType !== 'random') return false;
          if (bq.examType !== 'uas' && bq.examType !== 'generic') return false;

          const bInZone = zone.nodes.some(n => n.surahNumber === bq.answerStart.surahNumber && n.ayahNumber === bq.answerStart.ayahNumber);
          if (!bInZone) return false;

          const bPage = bq.answerStart.pageNumber || bq.startPage;
          if (mandatoryPages.includes(bPage)) return false;

          if (usedBKeys.has(makeBKey(bq.answerStart))) return false;

          return true;
        });

        if (bankCandidates.length > 0) {
          const pickIdx = Math.floor(prng() * bankCandidates.length);
          chosenRandomBank = bankCandidates[pickIdx];
        }
      }

      if (chosenRandomBank) {
        usedBKeys.add(makeBKey(chosenRandomBank.answerStart));
        questions.push({
          questionNumber,
          questionRole: 'random',
          zoneNumber,
          sourceType: 'bank',
          questionBankId: chosenRandomBank.id,
          pageNumber: chosenRandomBank.startPage,
          maxScore: 10,
          promptStart: chosenRandomBank.promptStart,
          promptEnd: chosenRandomBank.promptEnd,
          answerStart: chosenRandomBank.answerStart,
          answerEnd: chosenRandomBank.answerEnd,
          startPage: chosenRandomBank.startPage,
          endPage: chosenRandomBank.endPage,
          metadata: {
            surahName: this.getSurahName(chosenRandomBank.answerStart.surahNumber),
            endSurahName: this.getSurahName(chosenRandomBank.answerEnd.surahNumber),
            difficulty: chosenRandomBank.difficulty,
            notes: chosenRandomBank.notes
          },
          promptTextPreview: chosenRandomBank.promptText,
          answerTextPreview: chosenRandomBank.answerText
        });
        continue;
      }

      if (strategy === 'bank_only') {
        throw new Error(`Tidak ditemukan soal Bank Soal aktif untuk Zona ${zoneNumber}.`);
      }

      // 7. Pembangkitan Otomatis (Auto Candidate)
      let candidateNodes = zone.nodes.filter(n => !mandatoryPages.includes(n.pageNumber));
      let isFallbackOverlap = false;

      if (candidateNodes.length === 0) {
        candidateNodes = zone.nodes;
        isFallbackOverlap = true;
      }

      let generatedPoints: any = null;
      let attempts = 0;
      const maxAttempts = Math.min(candidateNodes.length * 3, 20);

      while (attempts < maxAttempts) {
        attempts++;
        const targetNodeIdx = Math.floor(prng() * candidateNodes.length);
        const targetNode = candidateNodes[targetNodeIdx];

        const pts = await this.buildQuestionPoints(
          targetNode.surahNumber,
          targetNode.ayahNumber,
          null,
          path,
          snapshot,
          prng
        );

        const bKey = makeBKey(pts.answerStart);
        if (!usedBKeys.has(bKey)) {
          if (isFallbackOverlap && pts.answerStart.wordPosition === 1) {
            continue;
          }

          usedBKeys.add(bKey);
          generatedPoints = pts;
          break;
        }
      }

      if (!generatedPoints) {
        const targetNode = candidateNodes[0] || zone.nodes[0];
        const pts = await this.buildQuestionPoints(
          targetNode.surahNumber,
          targetNode.ayahNumber,
          (attempts % 3) + 2,
          path,
          snapshot,
          prng
        );
        generatedPoints = pts;
        usedBKeys.add(makeBKey(pts.answerStart));
      }

      questions.push({
        questionNumber,
        questionRole: 'random',
        zoneNumber,
        sourceType: 'auto',
        questionBankId: null,
        pageNumber: generatedPoints.startPage,
        maxScore: 10,
        promptStart: generatedPoints.promptStart,
        promptEnd: generatedPoints.promptEnd,
        answerStart: generatedPoints.answerStart,
        answerEnd: generatedPoints.answerEnd,
        startPage: generatedPoints.startPage,
        endPage: generatedPoints.endPage,
        metadata: {
          ...generatedPoints.metadata,
          fallbackMandatoryOverlap: isFallbackOverlap
        },
        promptTextPreview: `QS. ${this.getSurahName(generatedPoints.promptStart.surahNumber)}:${generatedPoints.promptStart.ayahNumber}`,
        answerTextPreview: `QS. ${this.getSurahName(generatedPoints.answerStart.surahNumber)}:${generatedPoints.answerStart.ayahNumber} s.d. ${this.getSurahName(generatedPoints.answerEnd.surahNumber)}:${generatedPoints.answerEnd.ayahNumber}`
      });
    }

    // 8. VALIDASI FINAL SELURUH PAKET (EXACTLY 9 SOAL)
    if (questions.length !== 9) {
      throw new Error(`Paket soal UAS tidak valid: menghasilkan ${questions.length} soal (harus tepat 9).`);
    }

    const mandatoryCount = questions.filter(q => q.questionRole === 'mandatory').length;
    const randomCount = questions.filter(q => q.questionRole === 'random').length;
    if (mandatoryCount !== 2 || randomCount !== 7) {
      throw new Error(`Struktur soal UAS tidak valid: ${mandatoryCount} wajib dan ${randomCount} acak (harus 2 wajib & 7 acak).`);
    }

    const totalMaxScore = questions.reduce((acc, q) => acc + q.maxScore, 0);
    if (totalMaxScore !== 100) {
      throw new Error(`Total bobot soal UAS tidak valid: ${totalMaxScore} (harus 100).`);
    }

    for (const q of questions) {
      const v = this.validateGeneratedQuestion(q, path, snapshot);
      if (!v.valid) {
        throw new Error(`Validasi butir soal nomor ${q.questionNumber} gagal: ${v.reason}`);
      }
    }

    // 9. BENTUK DOKUMEN PAKET SOAL (LOCKED)
    const nowIso = new Date().toISOString();
    const setId = `eqs_uas_${period.id}_${snapshot.studentId}_v1`;

    const questionSet: ExamQuestionSet = {
      id: setId,
      examPeriodId: period.id,
      studentId: snapshot.studentId,
      materialSnapshotId: snapshot.id,
      version: 1,
      generationStrategy: strategy,
      generationSeed: seed,
      materialFingerprint: this.calculateMaterialFingerprint(snapshot),
      status: 'locked',
      generatedBy: actorId || null,
      generatedAt: nowIso,
      lockedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const finalQuestions: ExamQuestion[] = questions.map((gq) => ({
      id: `eq_uas_${setId}_q${gq.questionNumber}`,
      questionSetId: setId,
      questionNumber: gq.questionNumber,
      zoneNumber: gq.zoneNumber,
      questionRole: gq.questionRole,
      sourceType: gq.sourceType,
      questionBankId: gq.questionBankId,
      pageNumber: gq.pageNumber,
      maxScore: gq.maxScore,
      promptStartSurah: gq.promptStart?.surahNumber || null,
      promptStartAyah: gq.promptStart?.ayahNumber || null,
      promptStartWord: gq.promptStart?.wordPosition || null,
      promptEndSurah: gq.promptEnd?.surahNumber || null,
      promptEndAyah: gq.promptEnd?.ayahNumber || null,
      promptEndWord: gq.promptEnd?.wordPosition || null,
      answerStartSurah: gq.answerStart.surahNumber,
      answerStartAyah: gq.answerStart.ayahNumber,
      answerStartWord: gq.answerStart.wordPosition,
      answerEndSurah: gq.answerEnd.surahNumber,
      answerEndAyah: gq.answerEnd.ayahNumber,
      answerEndWord: gq.answerEnd.wordPosition,
      startPage: gq.startPage,
      endPage: gq.endPage,
      generatedMetadata: gq.metadata,
      createdAt: nowIso
    }));

    return {
      questionSet: { ...questionSet, questions: finalQuestions },
      questions: finalQuestions
    };
  }
}

export const uasQuestionGenerator = new UASQuestionGenerator();
