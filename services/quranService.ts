import { QuranSurah, QuranVerse, QuranWord, QuranPage, QuranPosition, QuestionDraft } from '../types';
import { QURAN_CHAPTERS } from '../constants';

// Mapping total ayahs for all 114 Surahs in standard Madinah Mushaf (Total: 6236 ayahs)
export const SURAH_TOTAL_AYAHS: Record<number, number> = {
  1: 7, 2: 286, 3: 200, 4: 176, 5: 120, 6: 165, 7: 206, 8: 75, 9: 129, 10: 109,
  11: 123, 12: 111, 13: 43, 14: 52, 15: 99, 16: 128, 17: 111, 18: 110, 19: 98, 20: 135,
  21: 112, 22: 78, 23: 118, 24: 64, 25: 77, 26: 227, 27: 93, 28: 88, 29: 69, 30: 60,
  31: 34, 32: 30, 33: 73, 34: 54, 35: 45, 36: 83, 37: 182, 38: 88, 39: 75, 40: 85,
  41: 54, 42: 53, 43: 89, 44: 59, 45: 37, 46: 35, 47: 38, 48: 29, 49: 18, 50: 45,
  51: 60, 52: 49, 53: 62, 54: 55, 55: 78, 56: 96, 57: 29, 58: 22, 59: 24, 60: 13,
  61: 14, 62: 11, 63: 11, 64: 18, 65: 12, 66: 12, 67: 30, 68: 52, 69: 52, 70: 44,
  71: 28, 72: 28, 73: 20, 74: 56, 75: 40, 76: 31, 77: 50, 78: 40, 79: 46, 80: 42,
  81: 29, 82: 19, 83: 36, 84: 25, 85: 22, 86: 17, 87: 19, 88: 26, 89: 30, 90: 20,
  91: 15, 92: 21, 93: 11, 94: 8, 95: 8, 96: 19, 97: 5, 98: 8, 99: 8, 100: 11,
  101: 11, 102: 8, 103: 3, 104: 9, 105: 5, 106: 4, 107: 7, 108: 3, 109: 6, 110: 3,
  111: 5, 112: 4, 113: 5, 114: 6
};

// Position comparison in mushaf order
export function comparePositions(p1: QuranPosition, p2: QuranPosition): number {
  if (p1.surahNumber !== p2.surahNumber) {
    return p1.surahNumber - p2.surahNumber;
  }
  if (p1.ayahNumber !== p2.ayahNumber) {
    return p1.ayahNumber - p2.ayahNumber;
  }
  return p1.wordPosition - p2.wordPosition;
}

export function isPositionEqual(p1?: QuranPosition, p2?: QuranPosition): boolean {
  if (!p1 || !p2) return false;
  return (
    p1.surahNumber === p2.surahNumber &&
    p1.ayahNumber === p2.ayahNumber &&
    p1.wordPosition === p2.wordPosition
  );
}

export function isPositionBetween(target: QuranPosition, start?: QuranPosition, end?: QuranPosition): boolean {
  if (!start || !end) return false;
  return comparePositions(target, start) >= 0 && comparePositions(target, end) <= 0;
}

// Strict sequence validator: promptStart <= promptEnd < answerStart <= answerEnd
export function validateQuestionPositions(
  promptStart: QuranPosition,
  promptEnd: QuranPosition,
  answerStart: QuranPosition,
  answerEnd: QuranPosition
): { valid: boolean; message?: string } {
  if (comparePositions(promptStart, promptEnd) > 0) {
    return { valid: false, message: 'Urutan titik soal tidak valid: Titik awal prompt harus sebelum atau sama dengan akhir prompt.' };
  }
  if (comparePositions(promptEnd, answerStart) >= 0) {
    return { valid: false, message: 'Urutan titik soal tidak valid: Titik awal jawaban (B) harus berada setelah prompt penguji.' };
  }
  if (comparePositions(answerStart, answerEnd) > 0) {
    return { valid: false, message: 'Urutan titik soal tidak valid: Batas akhir jawaban (C) harus setelah atau sama dengan awal jawaban (B).' };
  }
  return { valid: true };
}

// Mapping 30 Juz to their starting pages in standard 15-line Madinah Mushaf (604 pages)
export const JUZ_START_PAGES: Record<number, number> = {
  1: 1, 2: 22, 3: 42, 4: 62, 5: 82, 6: 102, 7: 121, 8: 142, 9: 162, 10: 182,
  11: 201, 12: 222, 13: 242, 14: 262, 15: 282, 16: 302, 17: 322, 18: 342, 19: 362, 20: 382,
  21: 402, 22: 422, 23: 442, 24: 462, 25: 482, 26: 502, 27: 522, 28: 542, 29: 562, 30: 582
};

export interface SearchResult {
  type: 'surah' | 'verse' | 'page' | 'juz';
  pageNumber: number;
  surahNumber?: number;
  ayahNumber?: number;
  juzNumber?: number;
  label: string;
  description: string;
}

export interface RangeSegment {
  surahNumber: number;
  surahName: string;
  ayahNumber: number;
  words: QuranWord[];
  textUthmani: string;
  isNewSurah: boolean;
  showBasmalah: boolean;
}

export interface RangeResult {
  fullText: string;
  words: QuranWord[];
  segments: RangeSegment[];
  startPage: number;
  endPage: number;
  crossesAyah: boolean;
  crossesSurah: boolean;
}

class QuranService {
  private pageCache = new Map<number, QuranVerse[]>();
  private verseCache = new Map<string, QuranVerse>();
  private prefetchQueue = new Set<number>();

  // 1. Get all Surahs list
  public getSurahs(): QuranSurah[] {
    return QURAN_CHAPTERS.map(([num, name, startPage]) => ({
      number: num,
      name,
      startPage
    }));
  }

  // 2. Get specific Surah info
  public getSurah(surahNumber: number): QuranSurah | undefined {
    const chapter = QURAN_CHAPTERS.find(([num]) => num === surahNumber);
    if (!chapter) return undefined;
    return {
      number: chapter[0],
      name: chapter[1],
      startPage: chapter[2]
    };
  }

  // 3. Get Juz starting page
  public getJuzStartPage(juzNumber: number): number {
    const clamped = Math.max(1, Math.min(30, juzNumber));
    return JUZ_START_PAGES[clamped] || 1;
  }

  // 4. Determine which Juz a page belongs to
  public getPageJuz(pageNumber: number): number {
    const clamped = Math.max(1, Math.min(604, pageNumber));
    for (let j = 30; j >= 1; j--) {
      if (clamped >= JUZ_START_PAGES[j]) {
        return j;
      }
    }
    return 1;
  }

  // 5. Get Verses by Page (with In-Memory Cache and Background Prefetching)
  public async getVersesByPage(pageNumber: number): Promise<QuranVerse[]> {
    const clampedPage = Math.max(1, Math.min(604, pageNumber));

    // Check memory cache first
    if (this.pageCache.has(clampedPage)) {
      return this.pageCache.get(clampedPage)!;
    }

    try {
      const url = `https://api.quran.com/api/v4/verses/by_page/${clampedPage}?words=true&word_fields=text_uthmani,location,line_number,page_number&fields=text_uthmani,chapter_id`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status} saat mengambil data halaman ${clampedPage}`);
      }

      const data = await response.json();
      const rawVerses = data.verses || [];

      const parsedVerses: QuranVerse[] = rawVerses.map((v: any) => {
        const [surahNumStr, ayahNumStr] = (v.verse_key || '1:1').split(':');
        const surahNumber = parseInt(surahNumStr, 10);
        const ayahNumber = parseInt(ayahNumStr, 10);

        const words: QuranWord[] = (v.words || []).map((w: any) => ({
          id: w.id,
          surahNumber,
          ayahNumber,
          position: w.position,
          textUthmani: w.text_uthmani || w.text || '',
          pageNumber: w.page_number || clampedPage,
          juzNumber: v.juz_number || this.getPageJuz(clampedPage),
          lineNumber: w.line_number,
          charTypeName: w.char_type_name,
          translation: w.translation?.text,
          transliteration: w.transliteration?.text
        }));

        const verseObj: QuranVerse = {
          verseKey: v.verse_key || `${surahNumber}:${ayahNumber}`,
          surahNumber,
          ayahNumber,
          pageNumber: v.page_number || clampedPage,
          juzNumber: v.juz_number || this.getPageJuz(clampedPage),
          textUthmani: v.text_uthmani || words.map(w => w.textUthmani).join(' '),
          words
        };

        // Cache single verse
        this.verseCache.set(verseObj.verseKey, verseObj);
        return verseObj;
      });

      // Save to page cache
      this.pageCache.set(clampedPage, parsedVerses);

      // Trigger background prefetch for adjacent pages (previous & next)
      this.triggerPrefetch(clampedPage);

      return parsedVerses;
    } catch (err: any) {
      console.warn(`[QuranService] Gagal memuat data ayat halaman ${clampedPage}:`, err.message);
      throw err;
    }
  }

  // 6. Get single verse by Surah and Ayah number
  public async getVerse(surahNumber: number, ayahNumber: number): Promise<QuranVerse | null> {
    const key = `${surahNumber}:${ayahNumber}`;
    if (this.verseCache.has(key)) {
      return this.verseCache.get(key)!;
    }

    try {
      const url = `https://api.quran.com/api/v4/verses/by_key/${key}?words=true&word_fields=text_uthmani,location,line_number,page_number&fields=text_uthmani,chapter_id`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const v = data.verse;
      if (!v) return null;

      const words: QuranWord[] = (v.words || []).map((w: any) => ({
        id: w.id,
        surahNumber,
        ayahNumber,
        position: w.position,
        textUthmani: w.text_uthmani || w.text || '',
        pageNumber: v.page_number,
        juzNumber: v.juz_number,
        lineNumber: w.line_number,
        charTypeName: w.char_type_name
      }));

      const verseObj: QuranVerse = {
        verseKey: key,
        surahNumber,
        ayahNumber,
        pageNumber: v.page_number,
        juzNumber: v.juz_number,
        textUthmani: v.text_uthmani || words.map(w => w.textUthmani).join(' '),
        words
      };

      this.verseCache.set(key, verseObj);
      return verseObj;
    } catch (e) {
      return null;
    }
  }

  // 7. Get words of a specific verse (supporting word-level selection)
  public async getWordsByVerse(surahNumber: number, ayahNumber: number): Promise<QuranWord[]> {
    const verse = await this.getVerse(surahNumber, ayahNumber);
    return verse?.words || [];
  }

  // 7a. Check if this ayah is the end of the surah
  public isEndOfSurah(surahNumber: number, ayahNumber: number): boolean {
    const total = SURAH_TOTAL_AYAHS[surahNumber];
    return total !== undefined && ayahNumber >= total;
  }

  // 7b. Get the position of the last content word of an ayah
  public async getLastWordPositionOfAyah(surahNumber: number, ayahNumber: number): Promise<QuranPosition | null> {
    const verse = await this.getVerse(surahNumber, ayahNumber);
    if (!verse || !verse.words || verse.words.length === 0) return null;
    const contentWords = verse.words.filter(w => w.charTypeName !== 'end');
    const lastWord = contentWords.length > 0 ? contentWords[contentWords.length - 1] : verse.words[verse.words.length - 1];
    return {
      surahNumber,
      ayahNumber,
      wordPosition: lastWord.position,
      pageNumber: verse.pageNumber,
      lineNumber: lastWord.lineNumber
    };
  }

  // 7c. Find the immediately following word in mushaf order
  public async getNextWordPosition(pos: QuranPosition): Promise<QuranPosition | null> {
    const curVerse = await this.getVerse(pos.surahNumber, pos.ayahNumber);
    const contentWords = (curVerse?.words || []).filter(w => w.charTypeName !== 'end');
    
    // Check if next word exists within same ayah
    const nextInAyah = contentWords.find(w => w.position > pos.wordPosition);
    if (nextInAyah) {
      return {
        surahNumber: pos.surahNumber,
        ayahNumber: pos.ayahNumber,
        wordPosition: nextInAyah.position,
        pageNumber: curVerse?.pageNumber || pos.pageNumber,
        lineNumber: nextInAyah.lineNumber
      };
    }

    // Otherwise, advance to next ayah in surah
    const totalInSurah = SURAH_TOTAL_AYAHS[pos.surahNumber] || 1;
    if (pos.ayahNumber < totalInSurah) {
      const nextAyah = pos.ayahNumber + 1;
      const nextVerse = await this.getVerse(pos.surahNumber, nextAyah);
      const nextContentWords = (nextVerse?.words || []).filter(w => w.charTypeName !== 'end');
      const firstWord = nextContentWords[0] || nextVerse?.words?.[0];
      return {
        surahNumber: pos.surahNumber,
        ayahNumber: nextAyah,
        wordPosition: firstWord?.position || 1,
        pageNumber: nextVerse?.pageNumber || pos.pageNumber,
        lineNumber: firstWord?.lineNumber
      };
    }

    // Otherwise, advance to next surah (ayah 1)
    if (pos.surahNumber < 114) {
      const nextSurah = pos.surahNumber + 1;
      const nextSurahVerse = await this.getVerse(nextSurah, 1);
      const nextContentWords = (nextSurahVerse?.words || []).filter(w => w.charTypeName !== 'end');
      const firstWord = nextContentWords[0] || nextSurahVerse?.words?.[0];
      return {
        surahNumber: nextSurah,
        ayahNumber: 1,
        wordPosition: firstWord?.position || 1,
        pageNumber: nextSurahVerse?.pageNumber || pos.pageNumber,
        lineNumber: firstWord?.lineNumber
      };
    }

    return null;
  }

  // 7d. Fetch entire structured range of words and text from startPos to endPos
  public async getRangeWordsAndText(
    startPos: QuranPosition,
    endPos: QuranPosition,
    showBasmalah: boolean = true
  ): Promise<RangeResult> {
    const allWords: QuranWord[] = [];
    const segments: RangeSegment[] = [];
    let startPage = startPos.pageNumber;
    let endPage = endPos.pageNumber;

    for (let s = startPos.surahNumber; s <= endPos.surahNumber; s++) {
      const surahInfo = this.getSurah(s);
      const surahName = surahInfo?.name || `Surat ${s}`;
      const totalAyahs = SURAH_TOTAL_AYAHS[s] || 1;
      const startAyah = (s === startPos.surahNumber) ? startPos.ayahNumber : 1;
      const endAyah = (s === endPos.surahNumber) ? endPos.ayahNumber : totalAyahs;

      for (let a = startAyah; a <= endAyah; a++) {
        const verse = await this.getVerse(s, a);
        if (!verse) continue;

        if (s === startPos.surahNumber && a === startPos.ayahNumber) {
          startPage = verse.pageNumber;
        }
        if (s === endPos.surahNumber && a === endPos.ayahNumber) {
          endPage = verse.pageNumber;
        }

        const isFirstAyahInSurah = (a === 1);
        const isNewSurah = (s !== startPos.surahNumber && isFirstAyahInSurah);
        // Surah 9 (At-Taubah) does not start with Basmalah
        const needBasmalah = isNewSurah && showBasmalah && s !== 9;

        const contentWords = (verse.words || []).filter(w => w.charTypeName !== 'end');

        const wordsInRange = contentWords.filter(w => {
          const wPos: QuranPosition = {
            surahNumber: s,
            ayahNumber: a,
            wordPosition: w.position,
            pageNumber: verse.pageNumber
          };
          return comparePositions(wPos, startPos) >= 0 && comparePositions(wPos, endPos) <= 0;
        });

        if (wordsInRange.length > 0) {
          allWords.push(...wordsInRange);
          const ayahText = wordsInRange.map(w => w.textUthmani).join(' ');
          segments.push({
            surahNumber: s,
            surahName,
            ayahNumber: a,
            words: wordsInRange,
            textUthmani: ayahText,
            isNewSurah,
            showBasmalah: needBasmalah
          });
        }
      }
    }

    const fullText = segments
      .map(seg => `${seg.textUthmani} ۝${seg.ayahNumber}`)
      .join(' ');

    const crossesAyah = (startPos.surahNumber !== endPos.surahNumber) || (startPos.ayahNumber !== endPos.ayahNumber);
    const crossesSurah = (startPos.surahNumber !== endPos.surahNumber);

    return {
      fullText,
      words: allWords,
      segments,
      startPage,
      endPage,
      crossesAyah,
      crossesSurah
    };
  }

  // 8. Get verses by Juz (fetches starting page of that juz)
  public async getVersesByJuz(juzNumber: number): Promise<QuranVerse[]> {
    const startPage = this.getJuzStartPage(juzNumber);
    return this.getVersesByPage(startPage);
  }

  // 9. Intelligent Search Parser
  // Supports: "Al-Mulk", "67", "Al-Mulk 12", "Al-Mulk:12", "67:12", "Juz 29", "Halaman 562", "Hal 562"
  public async searchQuran(query: string): Promise<SearchResult | null> {
    if (!query || !query.trim()) return null;
    const clean = query.trim().toLowerCase();

    // Case 1: "Juz X" or "JuzX"
    const juzMatch = clean.match(/^juz\s*(\d{1,2})$/);
    if (juzMatch) {
      const juzNum = parseInt(juzMatch[1], 10);
      if (juzNum >= 1 && juzNum <= 30) {
        const page = this.getJuzStartPage(juzNum);
        return {
          type: 'juz',
          pageNumber: page,
          juzNumber: juzNum,
          label: `Juz ${juzNum}`,
          description: `Membuka halaman pertama Juz ${juzNum} (Halaman ${page})`
        };
      }
    }

    // Case 2: "Halaman X" or "Hal X" or single number 1-604
    const halMatch = clean.match(/^(?:halaman|hal)?\s*(\d{1,3})$/);
    if (halMatch) {
      const pageNum = parseInt(halMatch[1], 10);
      if (pageNum >= 1 && pageNum <= 604) {
        return {
          type: 'page',
          pageNumber: pageNum,
          label: `Halaman ${pageNum}`,
          description: `Membuka Mushaf Halaman ${pageNum} (Juz ${this.getPageJuz(pageNum)})`
        };
      }
    }

    // Case 3: "SurahName:Ayat" or "SurahName Ayat" or "SurahNum:Ayat" (e.g. "Al-Mulk:12", "Al-Mulk 12", "67:12")
    const verseColonMatch = clean.match(/^(.+?)[\s:]+(\d{1,3})$/);
    if (verseColonMatch) {
      const surahPart = verseColonMatch[1].trim();
      const ayahNum = parseInt(verseColonMatch[2], 10);

      const foundSurah = this.findSurahByQuery(surahPart);
      if (foundSurah) {
        // Fetch verse to get exact page
        const verse = await this.getVerse(foundSurah.number, ayahNum);
        const targetPage = verse ? verse.pageNumber : foundSurah.startPage;
        return {
          type: 'verse',
          pageNumber: targetPage,
          surahNumber: foundSurah.number,
          ayahNumber: ayahNum,
          juzNumber: verse?.juzNumber || this.getPageJuz(targetPage),
          label: `QS. ${foundSurah.name} : ${ayahNum}`,
          description: `Membuka QS. ${foundSurah.name} Ayat ${ayahNum} pada Halaman ${targetPage}`
        };
      }
    }

    // Case 4: Surah Name or Surah Number alone (e.g. "Al-Mulk" or "67")
    const foundSurah = this.findSurahByQuery(clean);
    if (foundSurah) {
      return {
        type: 'surah',
        pageNumber: foundSurah.startPage,
        surahNumber: foundSurah.number,
        juzNumber: this.getPageJuz(foundSurah.startPage),
        label: `Surah ${foundSurah.name}`,
        description: `Membuka awal Surah ${foundSurah.name} (Halaman ${foundSurah.startPage})`
      };
    }

    return null;
  }

  // Helper to match surah by name, slug, or number
  private findSurahByQuery(q: string): QuranSurah | undefined {
    const surahs = this.getSurahs();
    // Check number
    const num = parseInt(q, 10);
    if (!isNaN(num) && num >= 1 && num <= 114) {
      return surahs.find(s => s.number === num);
    }

    // Normalize query string (remove punctuation like apostrophe and hyphens)
    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normQ = normalize(q);

    return surahs.find(s => {
      const normName = normalize(s.name);
      return normName === normQ || normName.includes(normQ);
    });
  }

  // Background Prefetcher (Non-blocking)
  private triggerPrefetch(currentPage: number): void {
    const targets = [currentPage - 1, currentPage + 1].filter(p => p >= 1 && p <= 604 && !this.pageCache.has(p) && !this.prefetchQueue.has(p));
    for (const p of targets) {
      this.prefetchQueue.add(p);
      // Small timeout to give main thread priority
      setTimeout(async () => {
        try {
          await this.getVersesByPage(p);
        } catch (e) {
          // ignore background prefetch errors
        } finally {
          this.prefetchQueue.delete(p);
        }
      }, 400);
    }
  }
}

export const quranService = new QuranService();
export default quranService;
