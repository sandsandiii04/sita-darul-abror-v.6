import { 
  ExamMaterialSnapshot, 
  ExamPeriod, 
  ExamQuestionSet, 
  ExamQuestion, 
  GeneratedUTSQuestion, 
  GeneratedUTSQuestionSet, 
  MaterialPath, 
  MaterialPathNode, 
  MaterialZone, 
  QuranPosition, 
  QuranVerse, 
  QuranWord, 
  QuestionBankItem, 
  UTSGenerationStrategy, 
  MemorizationDirection,
  QuestionSourceType
} from '../types';
import { quranService, SURAH_TOTAL_AYAHS, comparePositions } from './quranService';
import { SURAH_LIST } from '../constants';

// ============================================================
// COMPACT STANDARD RFC 1321 MD5 IMPLEMENTATION
// Menghasilkan hash MD5 32-karakter heksadesimal yang 100% identik
// dengan fungsi md5() bawaan PostgreSQL di Supabase.
// ============================================================
export function md5(string: string): string {
  function md5cycle(x: number[], k: number[]) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);

    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);

    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);

    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);

    x[0] = add32(a, x[0]);
    x[1] = add32(b, x[1]);
    x[2] = add32(c, x[2]);
    x[3] = add32(d, x[3]);
  }

  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & c) | ((~b) & d), a, b, x, s, t);
  }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & d) | (c & (~d)), a, b, x, s, t);
  }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(c ^ (b | (~d)), a, b, x, s, t);
  }
  function add32(a: number, b: number) {
    return (a + b) & 0xFFFFFFFF;
  }

  function md51(s: string) {
    const n = s.length;
    let state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= s.length; i += 64) {
      md5cycle(state, md5blk(s.substring(i - 64, i)));
    }
    s = s.substring(i - 64);
    let tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < s.length; i++) {
      tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    }
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) {
      md5cycle(state, tail);
      for (i = 0; i < 16; i++) tail[i] = 0;
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }

  function md5blk(s: string) {
    let md5blks: number[] = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i) +
        (s.charCodeAt(i + 1) << 8) +
        (s.charCodeAt(i + 2) << 16) +
        (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }

  function rhex(n: number) {
    let s = '', j = 0;
    for (; j < 4; j++) {
      s += hex_chr[(n >> (j * 8 + 4)) & 0x0F] + hex_chr[(n >> (j * 8)) & 0x0F];
    }
    return s;
  }

  const hex_chr = '0123456789abcdef'.split('');
  const x = md51(string);
  return rhex(x[0]) + rhex(x[1]) + rhex(x[2]) + rhex(x[3]);
}

// ============================================================
// DETERMINISTIC SEEDED PSEUDO-RANDOM NUMBER GENERATOR (Mulberry32)
// Menjamin hasil random yang sama jika seed sama (Locked & Multi-device Safe)
// ============================================================
export function createPRNG(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export class UTSQuestionGenerator {
  /**
   * Helper nama surah
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
   * 8. REPRESENTASI MATERIAL PATH (Respecting Pedagogical Order)
   * Menyusun urutan sekuensial ayat dari AWAL semester sampai AKHIR capaian.
   * Forward: startSurah:startAyah -> endSurah:endAyah (Quran order)
   * Backward: startSurah:startAyah -> endSurah:endAyah (Surah mundur: e.g. An-Nas 114 -> An-Naba 78)
   */
  public buildMaterialPath(snapshot: ExamMaterialSnapshot): MaterialPath {
    const nodes: MaterialPathNode[] = [];
    const direction = snapshot.memorizationDirection || 'forward';
    let pedagogicalIndex = 0;

    if (direction === 'backward') {
      // PROGRESI MUNDUR: Surat diurutkan mundur dari startSurah ke endSurah
      // Di dalam setiap surat, ayat berurutan maju dari ayat awal ke ayat akhir surat
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
            pageNumber: startPage, // perkiraan awal, akan diperbarui saat fetch ayat
            surahName: this.getSurahName(s)
          });
        }
      }
    } else {
      // PROGRESI MAJU / SINGLE SURAH:
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
   * 4. KONSEP 5 ZONA (Stratified Randomization)
   * Membagi MaterialPath menjadi tepat 5 zona yang mewakili masing-masing ~20% materi.
   */
  public divideIntoZones(path: MaterialPath): MaterialZone[] {
    const total = path.nodes.length;
    if (total === 0) {
      throw new Error('Materi santri kosong.');
    }

    const zones: MaterialZone[] = [];
    for (let k = 0; k < 5; k++) {
      const startIndex = Math.floor((k * total) / 5);
      const endIndex = (k === 4) ? total - 1 : Math.floor(((k + 1) * total) / 5) - 1;
      const zoneNodes = path.nodes.slice(startIndex, endIndex + 1);

      zones.push({
        zoneNumber: k + 1,
        startIndex,
        endIndex: Math.max(startIndex, endIndex),
        nodes: zoneNodes.length > 0 ? zoneNodes : [path.nodes[Math.min(startIndex, total - 1)]],
        label: `Zona ${k + 1} (${Math.round((k * 20))}% - ${Math.round(((k + 1) * 20))}%)`
      });
    }

    return zones;
  }

  /**
   * Cek apakah posisi struktural berada dalam rentang materi snapshot
   */
  public isPositionWithinMaterial(
    pos: QuranPosition,
    snapshot: ExamMaterialSnapshot,
    path: MaterialPath
  ): boolean {
    return path.nodes.some(n => n.surahNumber === pos.surahNumber && n.ayahNumber === pos.ayahNumber);
  }

  /**
   * Mengambil data ayat dengan fallback aman
   */
  public async getVerseSafe(surahNumber: number, ayahNumber: number): Promise<QuranVerse | null> {
    try {
      const v = await quranService.getVerse(surahNumber, ayahNumber);
      if (v) return v;
    } catch (e) {}

    // Fallback sintetis jika koneksi offline
    const surahInfo = quranService.getSurah(surahNumber);
    return {
      verseKey: `${surahNumber}:${ayahNumber}`,
      surahNumber,
      ayahNumber,
      pageNumber: surahInfo?.startPage || 1,
      juzNumber: quranService.getPageJuz(surahInfo?.startPage || 1),
      textUthmani: `Ayat ${ayahNumber}`,
      words: [
        {
          id: `${surahNumber}_${ayahNumber}_1`,
          surahNumber,
          ayahNumber,
          position: 1,
          textUthmani: 'بِسْمِ',
          pageNumber: surahInfo?.startPage || 1,
          juzNumber: 1,
          charTypeName: 'word'
        },
        {
          id: `${surahNumber}_${ayahNumber}_2`,
          surahNumber,
          ayahNumber,
          position: 2,
          textUthmani: 'اللَّهِ',
          pageNumber: surahInfo?.startPage || 1,
          juzNumber: 1,
          charTypeName: 'word'
        },
        {
          id: `${surahNumber}_${ayahNumber}_3`,
          surahNumber,
          ayahNumber,
          position: 3,
          textUthmani: 'الرَّحْمَٰنِ',
          pageNumber: surahInfo?.startPage || 1,
          juzNumber: 1,
          charTypeName: 'word'
        },
        {
          id: `${surahNumber}_${ayahNumber}_4`,
          surahNumber,
          ayahNumber,
          position: 4,
          textUthmani: 'الرَّحِيمِ',
          pageNumber: surahInfo?.startPage || 1,
          juzNumber: 1,
          charTypeName: 'word'
        }
      ]
    };
  }

  /**
   * 10, 11, 12, 13, 14: BANGKITKAN PROMPT DAN JAWABAN (A, A', B, C)
   * Titik B: Titik mulai sambung ayat.
   * Prompt A..A': 3–7 kata sebelum B (clamped ke batas awal materi).
   * Jawaban B..C: target 3–5 baris / ~20–35 kata (clamped ke batas akhir materi).
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

    // Tentukan titik B (Kata mulai melanjutkan)
    let bWord = preferWordPosition;
    if (!bWord || bWord > totalWords) {
      if (totalWords <= 3) {
        // Jika ayat sangat pendek (1-3 kata), B adalah kata pertama atau kedua
        bWord = Math.min(totalWords, Math.max(1, Math.floor(prng() * totalWords) + 1));
      } else {
        // Pilih antara kata 2 s.d. tengah ayat
        const maxChoice = Math.min(totalWords - 1, Math.max(2, Math.floor(totalWords / 2) + 1));
        bWord = Math.floor(prng() * (maxChoice - 1)) + 2;
      }
    }

    const nodeIndex = path.nodes.findIndex(n => n.surahNumber === targetSurah && n.ayahNumber === targetAyah);
    const isFirstNode = (nodeIndex <= 0);
    const isLastNode = (nodeIndex >= path.nodes.length - 1);

    // Titik B
    const answerStart: QuranPosition = {
      surahNumber: targetSurah,
      ayahNumber: targetAyah,
      wordPosition: bWord,
      pageNumber: targetVerse?.pageNumber || 1
    };

    // PROMPT: A .. A'
    // Default 3-7 kata sebelum B
    let promptStart: QuranPosition;
    let promptEnd: QuranPosition;

    if (bWord > 1) {
      // B ada di tengah ayat: prompt diambil dari awal/sebelum B pada ayat yang sama
      const wordsBeforeB = bWord - 1;
      const promptLen = Math.min(wordsBeforeB, Math.floor(prng() * 4) + 3); // 3-6 kata
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
      // B adalah kata 1 (awal ayat): Prompt diambil dari ayat sebelumnya jika ada dalam materi
      const prevNode = (nodeIndex > 0) ? path.nodes[nodeIndex - 1] : null;
      // Pada backward memorization, prevNode bisa berasal dari surat setelahnya dalam mushaf (misal 114 sebelum 113).
      // Bacaan Al-Qur'an tidak boleh mundur surat, jadi prompt hanya boleh lintas ayat jika masih di surat yang sama.
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
        // Jika ayat ini adalah ayat pertama materi santri atau awal surat pada mode backward:
        // B harus digeser minimal ke kata 2 agar prompt memiliki ruang di dalam materi
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
          // Kasus fallback ekstrim (1 kata)
          promptStart = { ...answerStart, wordPosition: 1 };
          promptEnd = { ...answerStart, wordPosition: 1 };
        }
      }
    }

    // JAWABAN: B .. C (Target ~3-5 baris mushaf atau ekuivalen 20-35 kata)
    // Hitung maju sepanjang MaterialPath hingga tercapai target atau mentok batas materi
    const targetWordCount = Math.floor(prng() * 15) + 20; // 20 - 34 kata
    let accumulatedWords = Math.max(1, totalWords - answerStart.wordPosition + 1);
    let cSurah = targetSurah;
    let cAyah = targetAyah;
    let cWord = totalWords;
    let cPage = targetVerse?.pageNumber || 1;
    let currentNodeIdx = nodeIndex;

    while (accumulatedWords < targetWordCount && currentNodeIdx < path.nodes.length - 1) {
      const nextNode = path.nodes[currentNodeIdx + 1];
      // Pada backward memorization, ayat berikutnya di path bisa memiliki nomor surat lebih rendah (misal 113 setelah 114).
      // Santri melafalkan jawaban maju dalam surat, tidak melompat mundur nomor surat!
      if (path.direction === 'backward' && nextNode.surahNumber !== targetSurah) {
        break; // Clamp jawaban pada batas akhir surat ini
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
        // Sisa kata di ayat ini
        const needed = targetWordCount - accumulatedWords;
        cSurah = nextNode.surahNumber;
        cAyah = nextNode.ayahNumber;
        cWord = Math.min(nextTotal, Math.max(1, needed));
        cPage = nextVerse?.pageNumber || cPage;
        accumulatedWords += cWord;
        break;
      }
    }

    // CLAMPING: Pastikan Titik C TIDAK MELEWATI batas akhir snapshot materi!
    if (path.direction === 'backward') {
      if (cSurah !== targetSurah) {
        cSurah = targetSurah;
        cAyah = targetAyah;
        cWord = totalWords;
      }
    } else {
      const lastNode = path.nodes[path.nodes.length - 1];
      if (currentNodeIdx >= path.nodes.length - 1) {
        // Pastikan cSurah dan cAyah tidak melebihi lastNode
        cSurah = lastNode.surahNumber;
        cAyah = lastNode.ayahNumber;
        const lastVerse = await this.getVerseSafe(lastNode.surahNumber, lastNode.ayahNumber);
        const lastWords = (lastVerse?.words || []).filter(w => w.charTypeName !== 'end');
        cWord = Math.min(cWord, Math.max(1, lastWords.length));
        cPage = lastVerse?.pageNumber || cPage;
      }
    }

    const answerEnd: QuranPosition = {
      surahNumber: cSurah,
      ayahNumber: cAyah,
      wordPosition: cWord,
      pageNumber: cPage
    };

    const startPage = Math.min(promptStart.pageNumber, answerStart.pageNumber);
    const endPage = Math.max(answerStart.pageNumber, answerEnd.pageNumber);

    return {
      promptStart,
      promptEnd,
      answerStart,
      answerEnd,
      startPage,
      endPage,
      metadata: {
        surahName: this.getSurahName(targetSurah),
        endSurahName: this.getSurahName(cSurah),
        totalExpectedWords: accumulatedWords,
        answerMode: '3_to_5_lines'
      }
    };
  }

  /**
   * 18, 19, 20: HYBRID STRATEGY DENGAN BANK SOAL
   * Mencari soal dari Bank Soal yang aktif, generic/uts, random,
   * dan seluruh A..C berada di dalam material snapshot pada zona k.
   */
  public findValidBankQuestionsForZone(
    zone: MaterialZone,
    snapshot: ExamMaterialSnapshot,
    path: MaterialPath,
    bankQuestions: QuestionBankItem[]
  ): QuestionBankItem[] {
    if (!bankQuestions || bankQuestions.length === 0) return [];

    return bankQuestions.filter(bq => {
      // 1. Validasi status (wajib 'active' sesuai schema existing) & tipe ujian (uts atau generic)
      if (bq.status !== 'active') return false;
      if (bq.examType !== 'uts' && bq.examType !== 'generic') return false;
      if (bq.questionType !== 'random') return false;

      // 2. Cek apakah titik B (answerStart) berada di dalam interval Zona k
      const bInZone = zone.nodes.some(n => 
        n.surahNumber === bq.answerStart.surahNumber && 
        n.ayahNumber === bq.answerStart.ayahNumber
      );
      if (!bInZone) return false;

      // 3. Validasi bahwa SELURUH koordinat A, A', B, C berada di dalam materi snapshot (pedagogical order)
      const aInMaterial = this.isPositionWithinMaterial(bq.promptStart, snapshot, path);
      const aEndInMaterial = this.isPositionWithinMaterial(bq.promptEnd, snapshot, path);
      const bInMaterial = this.isPositionWithinMaterial(bq.answerStart, snapshot, path);
      const cInMaterial = this.isPositionWithinMaterial(bq.answerEnd, snapshot, path);

      if (!aInMaterial || !aEndInMaterial || !bInMaterial || !cInMaterial) return false;

      // 4. Validasi urutan struktural internal: A <= A' < B <= C
      if (comparePositions(bq.promptStart, bq.promptEnd) > 0) return false;
      if (comparePositions(bq.promptEnd, bq.answerStart) >= 0) return false;
      if (comparePositions(bq.answerStart, bq.answerEnd) > 0) return false;

      // 5. Pada materi backward, pembacaan harus tetap maju dan tidak boleh melompati surat di luar path
      if (path.direction === 'backward' && bq.answerStart.surahNumber !== bq.answerEnd.surahNumber) {
        // Cek bahwa seluruh surat antara answerStart dan answerEnd ada dalam path
        for (let s = bq.answerStart.surahNumber; s <= bq.answerEnd.surahNumber; s++) {
          if (!path.nodes.some(n => n.surahNumber === s)) return false;
        }
      }

      return true;
    });
  }

  /**
   * 43, 44: VALIDASI 14-POINT SOAL DAN SET
   */
  public validateGeneratedQuestion(
    q: GeneratedUTSQuestion,
    path: MaterialPath,
    snapshot: ExamMaterialSnapshot
  ): { valid: boolean; reason?: string } {
    // 1. Zone 1-5
    if (q.zoneNumber < 1 || q.zoneNumber > 5) return { valid: false, reason: 'Nomor zona harus antara 1 dan 5.' };
    // 2. Question number 1-5
    if (q.questionNumber < 1 || q.questionNumber > 5) return { valid: false, reason: 'Nomor soal harus antara 1 dan 5.' };
    // 3. A <= A'
    if (comparePositions(q.promptStart, q.promptEnd) > 0) return { valid: false, reason: 'Urutan A ke A\' tidak valid.' };
    // 4. A' < B
    if (comparePositions(q.promptEnd, q.answerStart) >= 0) return { valid: false, reason: 'Urutan A\' ke B tidak valid (B harus setelah A\').' };
    // 5. B <= C
    if (comparePositions(q.answerStart, q.answerEnd) > 0) return { valid: false, reason: 'Urutan B ke C tidak valid.' };
    // 6. Seluruh range dalam snapshot
    if (!this.isPositionWithinMaterial(q.promptStart, snapshot, path)) return { valid: false, reason: 'Titik awal prompt di luar batas materi santri.' };
    if (!this.isPositionWithinMaterial(q.answerEnd, snapshot, path)) return { valid: false, reason: 'Titik akhir jawaban di luar batas materi santri.' };
    // 7. Koordinat valid
    if (q.promptStart.surahNumber < 1 || q.promptStart.surahNumber > 114) return { valid: false, reason: 'Nomor surah prompt tidak valid.' };
    if (q.answerEnd.surahNumber < 1 || q.answerEnd.surahNumber > 114) return { valid: false, reason: 'Nomor surah jawaban tidak valid.' };

    return { valid: true };
  }

  /**
   * FUNGSI UTAMA: GENERATE 5 SOAL UTS SANTRI
   */
  public async generateUTSQuestionSet(params: {
    period: ExamPeriod;
    snapshot: ExamMaterialSnapshot;
    strategy?: UTSGenerationStrategy;
    seed?: string;
    bankQuestions?: QuestionBankItem[];
    actorId?: string;
  }): Promise<GeneratedUTSQuestionSet> {
    const { period, snapshot, strategy = 'hybrid', bankQuestions = [], actorId } = params;

    // 1. BLOCK JIKA BELUM FINAL
    if (snapshot.status !== 'finalized') {
      throw new Error('Materi UTS santri belum difinalisasi.');
    }

    if (period.examType !== 'uts') {
      throw new Error('Generator ini khusus untuk periode ujian UTS.');
    }

    // 2. BENTUK MATERIAL PATH
    const path = this.buildMaterialPath(snapshot);
    if (path.nodes.length === 0) {
      throw new Error('Materi terlalu pendek untuk menghasilkan 5 titik soal berbeda.');
    }

    // 23. MATERIAL SANGAT PENDEK
    // Jika ayat kurang dari 3 dan total estimasi kata < 15, tidak cukup untuk 5 soal sambung ayat
    if (path.nodes.length < 3) {
      let totalEstWords = 0;
      for (const n of path.nodes) {
        const v = await this.getVerseSafe(n.surahNumber, n.ayahNumber);
        totalEstWords += (v?.words || []).length;
      }
      if (totalEstWords < 15) {
        throw new Error('Materi terlalu pendek untuk menghasilkan 5 titik soal berbeda.');
      }
    }

    // 3. DIVIDE INTO 5 ZONES
    const zones = this.divideIntoZones(path);
    if (zones.length !== 5) {
      throw new Error('Pembagian zona gagal menghasilkan tepat 5 zona.');
    }

    // 4. RANDOM SEED DETERMINISTIK
    const seed = params.seed || `seed_${period.id}_${snapshot.studentId}_${Date.now()}`;
    const prng = createPRNG(seed);

    // 5. GENERATE 1 SOAL PER ZONA DENGAN JAMINAN UNIQUE B (WORD-LEVEL)
    const generatedQuestions: GeneratedUTSQuestion[] = [];
    const usedBKeys = new Set<string>();

    const makeBKey = (pos: QuranPosition) => `${pos.surahNumber}:${pos.ayahNumber}:${pos.wordPosition}`;

    for (let i = 0; i < 5; i++) {
      const zone = zones[i];
      const zoneNum = i + 1;

      // Cek kandidat dari Bank Soal
      let chosenFromBank: QuestionBankItem | null = null;
      if (strategy === 'hybrid' || strategy === 'bank_only') {
        const validBankCandidates = this.findValidBankQuestionsForZone(zone, snapshot, path, bankQuestions)
          .filter(bq => !usedBKeys.has(makeBKey(bq.answerStart)));

        if (validBankCandidates.length > 0) {
          if (strategy === 'bank_only') {
            const pickIdx = Math.floor(prng() * validBankCandidates.length);
            chosenFromBank = validBankCandidates[pickIdx];
          } else {
            // Pada mode hybrid: beri probabilitas 50% untuk mengambil bank jika ada
            if (prng() > 0.4) {
              const pickIdx = Math.floor(prng() * validBankCandidates.length);
              chosenFromBank = validBankCandidates[pickIdx];
            }
          }
        } else if (strategy === 'bank_only') {
          throw new Error(`Tidak ditemukan soal Bank Soal yang valid untuk Zona ${zoneNum}.`);
        }
      }

      let q: GeneratedUTSQuestion | null = null;

      if (chosenFromBank) {
        q = {
          questionNumber: zoneNum,
          zoneNumber: zoneNum,
          sourceType: 'bank',
          questionBankId: chosenFromBank.id,
          promptStart: chosenFromBank.promptStart,
          promptEnd: chosenFromBank.promptEnd,
          answerStart: chosenFromBank.answerStart,
          answerEnd: chosenFromBank.answerEnd,
          startPage: chosenFromBank.startPage,
          endPage: chosenFromBank.endPage,
          metadata: {
            surahName: this.getSurahName(chosenFromBank.promptStart.surahNumber),
            endSurahName: this.getSurahName(chosenFromBank.answerEnd.surahNumber),
            totalExpectedWords: chosenFromBank.totalExpectedWords || 25,
            answerMode: chosenFromBank.answerMode,
            source: 'bank_soal'
          }
          // preview text tidak disimpan permanen, direkonstruksi on demand via QuranService
        };
      } else {
        // AUTO-GENERATE DARI ZONA
        // Cari kombinasi node dan word position dalam zona yang belum pernah terpakai sebagai titik B
        let attempts = 0;
        const maxAttempts = 30;

        while (attempts < maxAttempts && !q) {
          attempts++;
          const targetNode = zone.nodes[Math.floor(prng() * zone.nodes.length)];
          const targetVerse = await this.getVerseSafe(targetNode.surahNumber, targetNode.ayahNumber);
          const totalWordsInVerse = Math.max(1, (targetVerse?.words || []).filter(w => w.charTypeName !== 'end').length);

          // Coba beberapa opsi wordPosition di ayat ini jika ayat panjang
          const candidateWordPositions = [1];
          if (totalWordsInVerse >= 6) {
            candidateWordPositions.push(Math.floor(totalWordsInVerse / 2) + 1);
          }
          if (totalWordsInVerse >= 12) {
            candidateWordPositions.push(Math.floor(totalWordsInVerse * 0.75) + 1);
          }

          for (const candWord of candidateWordPositions) {
            const testBKey = `${targetNode.surahNumber}:${targetNode.ayahNumber}:${candWord}`;
            if (!usedBKeys.has(testBKey)) {
              const points = await this.buildQuestionPoints(
                targetNode.surahNumber,
                targetNode.ayahNumber,
                candWord > 1 ? candWord : null,
                path,
                snapshot,
                prng
              );

              const currentBKey = makeBKey(points.answerStart);
              if (!usedBKeys.has(currentBKey)) {
                q = {
                  questionNumber: zoneNum,
                  zoneNumber: zoneNum,
                  sourceType: 'auto',
                  questionBankId: null,
                  promptStart: points.promptStart,
                  promptEnd: points.promptEnd,
                  answerStart: points.answerStart,
                  answerEnd: points.answerEnd,
                  startPage: points.startPage,
                  endPage: points.endPage,
                  metadata: points.metadata
                };
                break;
              }
            }
          }
        }
      }

      if (!q) {
        throw new Error('Materi terlalu pendek untuk menghasilkan 5 titik soal berbeda.');
      }

      // Validasi individu
      const val = this.validateGeneratedQuestion(q, path, snapshot);
      if (!val.valid) {
        throw new Error(`Validasi soal Zona ${zoneNum} gagal: ${val.reason}`);
      }

      const currentBKey = makeBKey(q.answerStart);
      if (usedBKeys.has(currentBKey)) {
        throw new Error('Materi terlalu pendek untuk menghasilkan 5 titik soal berbeda.');
      }

      usedBKeys.add(currentBKey);
      generatedQuestions.push(q);
    }

    // 6. VALIDASI AKHIR PAKET SOAL (44. SET VALIDATION)
    if (generatedQuestions.length !== 5) {
      throw new Error(`Jumlah soal tidak tepat 5 (ditemukan ${generatedQuestions.length}).`);
    }

    const uniqueBCount = new Set(
      generatedQuestions.map(q => makeBKey(q.answerStart))
    ).size;

    // Strict Unique B: Dilarang keras menduplikasi B atau membuat posisi palsu
    if (uniqueBCount < 5) {
      throw new Error('Materi terlalu pendek untuk menghasilkan 5 titik soal berbeda.');
    }

    const materialFingerprint = this.calculateMaterialFingerprint(snapshot);
    const setId = `eqs_${period.id}_${snapshot.studentId}_v1`;

    const questionSet: ExamQuestionSet = {
      id: setId,
      examPeriodId: period.id,
      studentId: snapshot.studentId,
      materialSnapshotId: snapshot.id,
      version: 1,
      generationStrategy: strategy,
      generationSeed: seed,
      materialFingerprint,
      status: 'locked',
      generatedBy: actorId || null,
      generatedAt: new Date().toISOString(),
      lockedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const finalQuestions: ExamQuestion[] = generatedQuestions.map(g => ({
      id: `eq_${setId}_q${g.questionNumber}`,
      questionSetId: setId,
      questionNumber: g.questionNumber,
      zoneNumber: g.zoneNumber,
      sourceType: g.sourceType,
      questionBankId: g.questionBankId || null,
      promptStartSurah: g.promptStart.surahNumber,
      promptStartAyah: g.promptStart.ayahNumber,
      promptStartWord: g.promptStart.wordPosition,
      promptEndSurah: g.promptEnd.surahNumber,
      promptEndAyah: g.promptEnd.ayahNumber,
      promptEndWord: g.promptEnd.wordPosition,
      answerStartSurah: g.answerStart.surahNumber,
      answerStartAyah: g.answerStart.ayahNumber,
      answerStartWord: g.answerStart.wordPosition,
      answerEndSurah: g.answerEnd.surahNumber,
      answerEndAyah: g.answerEnd.ayahNumber,
      answerEndWord: g.answerEnd.wordPosition,
      startPage: g.startPage,
      endPage: g.endPage,
      generatedMetadata: g.metadata || {},
      createdAt: new Date().toISOString()
    }));

    return {
      questionSet,
      questions: finalQuestions
    };
  }

  /**
   * 35. TEST / DEVELOPER DIAGNOSTIC FUNCTION
   * Menghasilkan simulasi 5 zona untuk keperluan audit distribusi sebelum UI dibuat.
   */
  public async simulateDistribution(
    snapshot: ExamMaterialSnapshot,
    strategy: UTSGenerationStrategy = 'hybrid',
    seed?: string
  ) {
    const mockPeriod: ExamPeriod = {
      id: snapshot.examPeriodId || 'mock_period',
      academicTermId: 'mock_term',
      name: 'Simulasi UTS',
      examType: 'uts',
      materialCutoffDate: new Date().toISOString().split('T')[0],
      kkm: 75,
      targetClasses: [],
      targetHalaqahs: [],
      status: 'preparation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const path = this.buildMaterialPath(snapshot);
    const zones = this.divideIntoZones(path);
    const result = await this.generateUTSQuestionSet({
      period: mockPeriod,
      snapshot,
      strategy,
      seed
    });

    return {
      pathSummary: {
        totalAyahs: path.totalAyahs,
        direction: path.direction,
        start: `${this.getSurahName(path.startSurah)} ${path.startAyah}`,
        end: `${this.getSurahName(path.endSurah)} ${path.endAyah}`
      },
      zones: zones.map(z => ({
        zoneNumber: z.zoneNumber,
        label: z.label,
        ayahsCount: z.nodes.length,
        firstAyah: `${z.nodes[0]?.surahName} ${z.nodes[0]?.ayahNumber}`,
        lastAyah: `${z.nodes[z.nodes.length - 1]?.surahName} ${z.nodes[z.nodes.length - 1]?.ayahNumber}`
      })),
      questions: result.questions.map(q => {
        // Hitung persentil posisi B di dalam MaterialPath
        const nodeIdx = path.nodes.findIndex(
          n => n.surahNumber === q.answerStartSurah && n.ayahNumber === q.answerStartAyah
        );
        const percentile = path.totalAyahs > 1 ? ((nodeIdx / (path.totalAyahs - 1)) * 100).toFixed(1) : '100';

        return {
          questionNumber: q.questionNumber,
          zoneNumber: q.zoneNumber,
          sourceType: q.sourceType,
          promptRange: `QS. ${this.getSurahName(q.promptStartSurah)} ${q.promptStartAyah}:${q.promptStartWord} -> ${q.promptEndAyah}:${q.promptEndWord}`,
          answerStart: `QS. ${this.getSurahName(q.answerStartSurah)} ${q.answerStartAyah}:${q.answerStartWord}`,
          answerEnd: `QS. ${this.getSurahName(q.answerEndSurah)} ${q.answerEndAyah}:${q.answerEndWord}`,
          pages: `Hal ${q.startPage} - ${q.endPage}`,
          percentileInPath: `${percentile}%`
        };
      })
    };
  }
}

export const utsQuestionGenerator = new UTSQuestionGenerator();
export default utsQuestionGenerator;
