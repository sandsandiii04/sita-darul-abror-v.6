import { ExamUASSession, QuestionBankItem, QuranPosition, QuranVerse } from '../types';
import { quranService, SURAH_TOTAL_AYAHS } from './quranService';
import { uasQuestionGenerator } from './uasQuestionGenerator';
import { UASEligibilityItem } from './uasBulkEligibilityService';

const comparePos = (a: QuranPosition, b: QuranPosition): number => {
  if (a.surahNumber !== b.surahNumber) return a.surahNumber - b.surahNumber;
  if (a.ayahNumber !== b.ayahNumber) return a.ayahNumber - b.ayahNumber;
  return (a.wordPosition || 1) - (b.wordPosition || 1);
};

export interface MissingZoneInstance {
  key: string; // studentId:S{sessionNumber}:Z{zoneNumber}
  studentId: string;
  sessionNumber: number;
  sessionType: 'full_juz' | 'partial_half';
  juzNumber: number;
  zoneNumber: number;
  startPage: number;
  endPage: number;
  coveredPageSet: Set<number>;
  verseKeys: Set<string>;
}

export interface DraftFillCandidate {
  kind: 'existing_draft';
  id: string;
  question: QuestionBankItem;
  juzNumber: number;
  actualStartPage: number;
  actualEndPage: number;
  surahLabel: string;
  zoneLabels: string[];
  helpedSessionKeys: string[];
  helpedStudentIds: string[];
  readiness: 'ready' | 'not_ready';
  notReadyReason?: string;
}

export interface AutoVerseTarget {
  juzNumber: number;
  surahNumber: number;
  ayahNumber: number;
  pageNumber: number;
  zoneLabels: string[];
  helpedSessionKeys: string[];
  helpedStudentIds: string[];
  /** Alternatif ayat lain di zona yang sama jika ayat utama terlalu pendek (<4 kata & awal surah) */
  fallbackVerses: Array<{ surahNumber: number; ayahNumber: number; pageNumber: number }>;
}

export interface NewAutoFillCandidate {
  kind: 'new_auto';
  id: string;
  juzNumber: number;
  pageNumber: number;
  surahLabel: string;
  zoneLabels: string[];
  helpedSessionKeys: string[];
  helpedStudentIds: string[];
  readiness: 'ready' | 'not_ready';
  notReadyReason?: string;
  question: QuestionBankItem | null;
}

export interface UASBankFillPlan {
  totalShortStudents: number;
  totalShortSessions: number;
  totalMissingZoneInstances: number;
  validDraftCandidates: DraftFillCandidate[];
  newVerseTargets: AutoVerseTarget[];
  uncoveredZoneCount: number;
}

export function isDraftStructurallyValidForUAS(q: QuestionBankItem): { valid: boolean; reason?: string; actualStartPage: number; actualEndPage: number } {
  if (q.status !== 'draft') {
    return { valid: false, reason: 'Status bukan draft', actualStartPage: 0, actualEndPage: 0 };
  }
  if (q.questionType !== 'random') {
    return { valid: false, reason: 'Bukan soal acak (random)', actualStartPage: 0, actualEndPage: 0 };
  }
  if (q.examType !== 'uas' && q.examType !== 'generic') {
    return { valid: false, reason: 'Tipe ujian bukan UAS/generic', actualStartPage: 0, actualEndPage: 0 };
  }
  if (!q.promptStart || !q.promptEnd || !q.answerStart || !q.answerEnd) {
    return { valid: false, reason: 'Koordinat ayat tidak lengkap', actualStartPage: 0, actualEndPage: 0 };
  }
  if (
    comparePos(q.promptStart, q.promptEnd) > 0 ||
    comparePos(q.promptEnd, q.answerStart) >= 0 ||
    comparePos(q.answerStart, q.answerEnd) > 0
  ) {
    return { valid: false, reason: 'Urutan koordinat prompt/jawaban tidak valid', actualStartPage: 0, actualEndPage: 0 };
  }
  const actualStartPage = quranService.getAyahPage(q.promptStart.surahNumber, q.promptStart.ayahNumber);
  const actualEndPage = quranService.getAyahPage(q.answerEnd.surahNumber, q.answerEnd.ayahNumber);
  if (actualStartPage < 1 || actualStartPage > 604 || actualEndPage < 1 || actualEndPage > 604 || actualStartPage > actualEndPage) {
    return { valid: false, reason: 'Halaman Mushaf di luar rentang 1–604', actualStartPage, actualEndPage };
  }
  return { valid: true, actualStartPage, actualEndPage };
}

export function makeCoordinateSignature(q: Pick<QuestionBankItem, 'promptStart' | 'promptEnd' | 'answerStart' | 'answerEnd'>): string {
  return [
    `${q.promptStart.surahNumber}:${q.promptStart.ayahNumber}:${q.promptStart.wordPosition}`,
    `${q.promptEnd.surahNumber}:${q.promptEnd.ayahNumber}:${q.promptEnd.wordPosition}`,
    `${q.answerStart.surahNumber}:${q.answerStart.ayahNumber}:${q.answerStart.wordPosition}`,
    `${q.answerEnd.surahNumber}:${q.answerEnd.ayahNumber}:${q.answerEnd.wordPosition}`
  ].join('|');
}

/**
 * Fase 1 & 2 (murni sinkron, deterministik):
 * 1. Kumpulkan seluruh zona kosong dari sesi BANK_SOAL_KURANG.
 * 2. Pilih set minimal soal `draft` yang sudah ada & valid untuk menutupi zona kosong sebanyak mungkin.
 * 3. Pilih set minimal titik ayat baru untuk menutup sisa zona kosong (set-cover).
 */
export function planUASBankFill(params: {
  sessions: ExamUASSession[];
  eligibilityItems: UASEligibilityItem[];
  bankQuestions: QuestionBankItem[];
}): UASBankFillPlan {
  const { sessions, eligibilityItems, bankQuestions } = params;

  const missingZones: MissingZoneInstance[] = [];
  const shortStudentSet = new Set<string>();
  const shortSessionSet = new Set<string>();

  for (const item of eligibilityItems) {
    if (item.status !== 'BANK_SOAL_KURANG') continue;
    for (const se of item.sessionEligibilities || []) {
      if (se.status !== 'BANK_SOAL_KURANG') continue;
      const sess = sessions.find(
        s => s.studentId === item.studentId && s.sessionNumber === se.sessionNumber && s.status !== 'void'
      );
      if (!sess) continue;

      shortStudentSet.add(item.studentId);
      shortSessionSet.add(`${item.studentId}:S${sess.sessionNumber}`);

      const cov = uasQuestionGenerator.evaluateSessionBankCoverage(sess, bankQuestions);
      const zoneCount = sess.sessionType === 'partial_half' ? 4 : 7;
      const zones = uasQuestionGenerator.divideIntoZonesCount(cov.path, zoneCount);
      const coveredPageSet = new Set(sess.coveredPages || []);

      for (const mz of cov.diagnostic.missingZones) {
        const z = zones[mz - 1];
        const zd = cov.diagnostic.zonesDetail[mz - 1];
        if (!z || !zd) continue;
        missingZones.push({
          key: `${item.studentId}:S${sess.sessionNumber}:Z${mz}`,
          studentId: item.studentId,
          sessionNumber: sess.sessionNumber,
          sessionType: sess.sessionType,
          juzNumber: sess.juzNumber,
          zoneNumber: mz,
          startPage: zd.startPage,
          endPage: zd.endPage,
          coveredPageSet,
          verseKeys: new Set(z.nodes.map(n => `${n.surahNumber}:${n.ayahNumber}`))
        });
      }
    }
  }

  const uncovered = new Set(missingZones.map(m => m.key));

  // Fase 1: Greedy set-cover menggunakan soal DRAFT yang valid di Bank Soal
  const validDrafts = bankQuestions
    .map(q => ({ q, check: isDraftStructurallyValidForUAS(q) }))
    .filter(x => x.check.valid);

  const validDraftCandidates: DraftFillCandidate[] = [];
  const pickedDraftIds = new Set<string>();

  while (uncovered.size > 0) {
    let best: { q: QuestionBankItem; actualStartPage: number; actualEndPage: number } | null = null;
    let bestCovered: MissingZoneInstance[] = [];

    for (const entry of validDrafts) {
      if (pickedDraftIds.has(entry.q.id)) continue;
      const aKey = `${entry.q.answerStart.surahNumber}:${entry.q.answerStart.ayahNumber}`;
      const pS = entry.check.actualStartPage;
      const pE = entry.check.actualEndPage;

      const covNow = missingZones.filter(
        m => uncovered.has(m.key) && m.verseKeys.has(aKey) && m.coveredPageSet.has(pS) && m.coveredPageSet.has(pE)
      );
      if (covNow.length > bestCovered.length) {
        bestCovered = covNow;
        best = { q: entry.q, actualStartPage: pS, actualEndPage: pE };
      }
    }

    if (!best || bestCovered.length === 0) break;

    pickedDraftIds.add(best.q.id);
    bestCovered.forEach(m => uncovered.delete(m.key));

    const sName = quranService.getSurah(best.q.promptStart.surahNumber)?.name || `Surah ${best.q.promptStart.surahNumber}`;
    const eName = quranService.getSurah(best.q.answerEnd.surahNumber)?.name || `Surah ${best.q.answerEnd.surahNumber}`;
    const surahLabel =
      best.q.promptStart.surahNumber === best.q.answerEnd.surahNumber
        ? `${sName} ${best.q.promptStart.ayahNumber}–${best.q.answerEnd.ayahNumber}`
        : `${sName}:${best.q.promptStart.ayahNumber} – ${eName}:${best.q.answerEnd.ayahNumber}`;

    validDraftCandidates.push({
      kind: 'existing_draft',
      id: best.q.id,
      question: {
        ...best.q,
        startPage: best.actualStartPage,
        endPage: best.actualEndPage,
        startJuz: quranService.getPageJuz(best.actualStartPage),
        endJuz: quranService.getPageJuz(best.actualEndPage)
      },
      juzNumber: quranService.getPageJuz(best.actualStartPage),
      actualStartPage: best.actualStartPage,
      actualEndPage: best.actualEndPage,
      surahLabel,
      zoneLabels: Array.from(new Set(bestCovered.map(m => `Z${m.zoneNumber} (Hal ${m.startPage}–${m.endPage})`))),
      helpedSessionKeys: Array.from(new Set(bestCovered.map(m => `${m.studentId}:S${m.sessionNumber}`))),
      helpedStudentIds: Array.from(new Set(bestCovered.map(m => m.studentId))),
      readiness: 'ready'
    });
  }

  // Fase 2: Greedy set-cover untuk sisa zona yang benar-benar belum ada di Bank Soal
  const remainingByJuz = new Map<number, MissingZoneInstance[]>();
  for (const m of missingZones) {
    if (!uncovered.has(m.key)) continue;
    const arr = remainingByJuz.get(m.juzNumber) || [];
    arr.push(m);
    remainingByJuz.set(m.juzNumber, arr);
  }

  const newVerseTargets: AutoVerseTarget[] = [];

  for (const juz of Array.from(remainingByJuz.keys()).sort((a, b) => a - b)) {
    const instList = remainingByJuz.get(juz)!;
    const juzUncovered = new Set(instList.map(m => m.key));
    const allVerses = new Set<string>();
    instList.forEach(m => m.verseKeys.forEach(vk => allVerses.add(vk)));

    while (juzUncovered.size > 0) {
      let bestVk = '';
      let bestScore = -1;
      let bestCovered: MissingZoneInstance[] = [];

      for (const vk of allVerses) {
        const [sStr, aStr] = vk.split(':');
        const s = Number(sStr);
        const a = Number(aStr);
        const p = quranService.getAyahPage(s, a);

        const covNow = instList.filter(
          m => juzUncovered.has(m.key) && m.verseKeys.has(vk) && m.coveredPageSet.has(p)
        );
        if (covNow.length === 0) continue;

        // Prefer ayat > 1 pada halaman yang sama (agar bisa sambung dari ayat sebelumnya jika ayat pendek)
        const hasPrevOnSamePage = a > 1 && quranService.getAyahPage(s, a - 1) === p;
        const score = covNow.length * 10 + (hasPrevOnSamePage ? 2 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestVk = vk;
          bestCovered = covNow;
        }
      }

      if (!bestVk || bestCovered.length === 0) break;

      const [sStr, aStr] = bestVk.split(':');
      const s = Number(sStr);
      const a = Number(aStr);
      const p = quranService.getAyahPage(s, a);

      // Kumpulkan hingga 5 ayat alternatif yang menutupi persis himpunan zona yang sama
      const coveredKeySet = new Set(bestCovered.map(m => m.key));
      const fallbacks: Array<{ surahNumber: number; ayahNumber: number; pageNumber: number }> = [];
      for (const vk of allVerses) {
        if (vk === bestVk) continue;
        const [fsStr, faStr] = vk.split(':');
        const fs = Number(fsStr);
        const fa = Number(faStr);
        const fp = quranService.getAyahPage(fs, fa);
        const coversAll = bestCovered.every(m => m.verseKeys.has(vk) && m.coveredPageSet.has(fp));
        if (coversAll) {
          fallbacks.push({ surahNumber: fs, ayahNumber: fa, pageNumber: fp });
          if (fallbacks.length >= 5) break;
        }
      }

      newVerseTargets.push({
        juzNumber: juz,
        surahNumber: s,
        ayahNumber: a,
        pageNumber: p,
        zoneLabels: Array.from(new Set(bestCovered.map(m => `Z${m.zoneNumber} (Hal ${m.startPage}–${m.endPage})`))),
        helpedSessionKeys: Array.from(new Set(bestCovered.map(m => `${m.studentId}:S${m.sessionNumber}`))),
        helpedStudentIds: Array.from(new Set(bestCovered.map(m => m.studentId))),
        fallbackVerses: fallbacks
      });

      coveredKeySet.forEach(k => {
        juzUncovered.delete(k);
        uncovered.delete(k);
      });
    }
  }

  return {
    totalShortStudents: shortStudentSet.size,
    totalShortSessions: shortSessionSet.size,
    totalMissingZoneInstances: missingZones.length,
    validDraftCandidates,
    newVerseTargets,
    uncoveredZoneCount: uncovered.size
  };
}

/**
 * Bangun 1 kandidat soal sambung-ayat dari data ayat resmi Mushaf (QuranVerse[]).
 * TIDAK PERNAH mengarang teks; mengembalikan null jika sumber ayat/kata tidak tersedia.
 */
function buildQuestionFromPageVerses(params: {
  target: { surahNumber: number; ayahNumber: number; pageNumber: number };
  pageVerses: QuranVerse[];
  juzNumber: number;
  existingSignatures: Set<string>;
}): QuestionBankItem | null {
  const { target, pageVerses, juzNumber, existingSignatures } = params;
  const targetKey = `${target.surahNumber}:${target.ayahNumber}`;
  const targetIdx = pageVerses.findIndex(v => v.verseKey === targetKey);
  if (targetIdx < 0) return null;

  const targetVerse = pageVerses[targetIdx];
  const words = (targetVerse.words || []).filter(w => w.textUthmani && w.textUthmani.trim().length > 0);
  if (words.length === 0) return null;

  let promptStart: QuranPosition;
  let promptEnd: QuranPosition;
  let answerStart: QuranPosition;
  let answerEnd: QuranPosition;
  let promptText = '';
  let answerText = '';

  const prevVerse = targetIdx > 0 ? pageVerses[targetIdx - 1] : null;
  const prevSameSurah =
    prevVerse &&
    prevVerse.surahNumber === target.surahNumber &&
    prevVerse.ayahNumber === target.ayahNumber - 1 &&
    prevVerse.words &&
    prevVerse.words.length > 0;

  const nextVerse = targetIdx + 1 < pageVerses.length ? pageVerses[targetIdx + 1] : null;
  const nextSameSurah =
    nextVerse &&
    nextVerse.surahNumber === target.surahNumber &&
    nextVerse.ayahNumber === target.ayahNumber + 1 &&
    nextVerse.words &&
    nextVerse.words.length > 0;

  if (prevSameSurah && prevVerse) {
    // Strategi A (paling alami untuk sambung ayat):
    // Prompt = ayat sebelumnya (pada halaman yang sama), Jawaban = mulai kata ke-1 ayat target (+ lanjut ke ayat berikutnya jika pendek & 1 halaman)
    const pWords = prevVerse.words.filter(w => w.textUthmani && w.textUthmani.trim().length > 0);
    const pStartWord = pWords.length > 6 ? pWords[pWords.length - 5] : pWords[0];
    const pEndWord = pWords[pWords.length - 1];
    promptStart = {
      surahNumber: prevVerse.surahNumber,
      ayahNumber: prevVerse.ayahNumber,
      wordPosition: pStartWord.position,
      pageNumber: target.pageNumber
    };
    promptEnd = {
      surahNumber: prevVerse.surahNumber,
      ayahNumber: prevVerse.ayahNumber,
      wordPosition: pEndWord.position,
      pageNumber: target.pageNumber
    };
    promptText = pWords
      .filter(w => w.position >= pStartWord.position && w.position <= pEndWord.position)
      .map(w => w.textUthmani)
      .join(' ');

    answerStart = {
      surahNumber: target.surahNumber,
      ayahNumber: target.ayahNumber,
      wordPosition: words[0].position,
      pageNumber: target.pageNumber
    };

    if (nextSameSurah && nextVerse && words.length < 10) {
      const nWords = nextVerse.words.filter(w => w.textUthmani && w.textUthmani.trim().length > 0);
      const nEndWord = nWords[nWords.length - 1];
      answerEnd = {
        surahNumber: nextVerse.surahNumber,
        ayahNumber: nextVerse.ayahNumber,
        wordPosition: nEndWord.position,
        pageNumber: target.pageNumber
      };
      answerText = `${words.map(w => w.textUthmani).join(' ')} ۝${target.ayahNumber} ${nWords.map(w => w.textUthmani).join(' ')}`;
    } else {
      const aEndWord = words[words.length - 1];
      answerEnd = {
        surahNumber: target.surahNumber,
        ayahNumber: target.ayahNumber,
        wordPosition: aEndWord.position,
        pageNumber: target.pageNumber
      };
      answerText = words.map(w => w.textUthmani).join(' ');
    }
  } else if (words.length >= 4) {
    // Strategi B (awal halaman / ayat panjang seperti Al-Mujadilah 58:1):
    // Prompt = 2–4 kata pertama ayat target, Jawaban = sisa kata ayat target (+ ayat berikutnya jika masih 1 halaman)
    const splitCount = Math.min(4, Math.max(2, Math.floor(words.length / 3)));
    const pWords = words.slice(0, splitCount);
    const aWords = words.slice(splitCount);
    if (pWords.length === 0 || aWords.length === 0) return null;

    promptStart = {
      surahNumber: target.surahNumber,
      ayahNumber: target.ayahNumber,
      wordPosition: pWords[0].position,
      pageNumber: target.pageNumber
    };
    promptEnd = {
      surahNumber: target.surahNumber,
      ayahNumber: target.ayahNumber,
      wordPosition: pWords[pWords.length - 1].position,
      pageNumber: target.pageNumber
    };
    answerStart = {
      surahNumber: target.surahNumber,
      ayahNumber: target.ayahNumber,
      wordPosition: aWords[0].position,
      pageNumber: target.pageNumber
    };
    answerEnd = {
      surahNumber: target.surahNumber,
      ayahNumber: target.ayahNumber,
      wordPosition: aWords[aWords.length - 1].position,
      pageNumber: target.pageNumber
    };
    promptText = pWords.map(w => w.textUthmani).join(' ');
    answerText = aWords.map(w => w.textUthmani).join(' ');
  } else {
    // Ayat terlalu pendek (<4 kata) dan tidak punya ayat sebelumnya pada halaman yang sama
    return null;
  }

  // Validasi ulang struktur & halaman Mushaf 604 secara ketat
  if (
    comparePos(promptStart, promptEnd) > 0 ||
    comparePos(promptEnd, answerStart) >= 0 ||
    comparePos(answerStart, answerEnd) > 0
  ) {
    return null;
  }
  const checkStartPage = quranService.getAyahPage(promptStart.surahNumber, promptStart.ayahNumber);
  const checkEndPage = quranService.getAyahPage(answerEnd.surahNumber, answerEnd.ayahNumber);
  if (checkStartPage !== target.pageNumber || checkEndPage !== target.pageNumber) {
    return null;
  }
  if (!promptText.trim() || !answerText.trim()) return null;

  const sig = makeCoordinateSignature({ promptStart, promptEnd, answerStart, answerEnd });
  if (existingSignatures.has(sig)) return null;

  const deterministicId = `qb_uas_auto_j${juzNumber}_p${target.pageNumber}_s${answerStart.surahNumber}_a${answerStart.ayahNumber}_w${answerStart.wordPosition}`;

  return {
    id: deterministicId,
    examType: 'generic',
    questionType: 'random',
    promptStart,
    promptEnd,
    answerStart,
    answerEnd,
    startPage: target.pageNumber,
    endPage: target.pageNumber,
    startJuz: juzNumber,
    endJuz: juzNumber,
    answerMode: 'end_ayah',
    difficulty: 'medium',
    status: 'active',
    tags: ['uas-auto-fill', `juz-${juzNumber}`, `hal-${target.pageNumber}`],
    promptText,
    answerText,
    createdBy: 'admin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Fase 3 (asinkron): Ambil teks Mushaf resmi dari quranService.getVersesByPage (tanpa mengarang ayat)
 * untuk seluruh target baru, dan susun daftar kandidat siap review Admin.
 */
export async function buildAutoCandidatesFromQuran(params: {
  targets: AutoVerseTarget[];
  existingBankQuestions: QuestionBankItem[];
  onProgress?: (loadedPages: number, totalPages: number) => void;
  /** Optional injector untuk unit test terisolasi */
  fetchPageVerses?: (page: number) => Promise<QuranVerse[]>;
}): Promise<NewAutoFillCandidate[]> {
  const { targets, existingBankQuestions, onProgress } = params;
  const fetcher = params.fetchPageVerses || ((p: number) => quranService.getVersesByPage(p));

  const existingSignatures = new Set(existingBankQuestions.map(makeCoordinateSignature));

  // Kumpulkan semua halaman unik yang perlu diambil
  const uniquePages = Array.from(
    new Set(targets.flatMap(t => [t.pageNumber, ...t.fallbackVerses.map(f => f.pageNumber)]))
  ).sort((a, b) => a - b);

  const pageVersesMap = new Map<number, QuranVerse[]>();
  for (let i = 0; i < uniquePages.length; i++) {
    const page = uniquePages[i];
    try {
      const verses = await fetcher(page);
      pageVersesMap.set(page, verses || []);
    } catch {
      pageVersesMap.set(page, []);
    }
    onProgress?.(i + 1, uniquePages.length);
  }

  const results: NewAutoFillCandidate[] = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const attempts = [
      { surahNumber: t.surahNumber, ayahNumber: t.ayahNumber, pageNumber: t.pageNumber },
      ...t.fallbackVerses
    ];

    let built: QuestionBankItem | null = null;
    let chosenAttempt = attempts[0];

    for (const att of attempts) {
      const verses = pageVersesMap.get(att.pageNumber) || [];
      if (verses.length === 0) continue;
      const cand = buildQuestionFromPageVerses({
        target: att,
        pageVerses: verses,
        juzNumber: t.juzNumber,
        existingSignatures
      });
      if (cand) {
        built = cand;
        chosenAttempt = att;
        existingSignatures.add(makeCoordinateSignature(cand));
        break;
      }
    }

    const sName = quranService.getSurah(chosenAttempt.surahNumber)?.name || `Surah ${chosenAttempt.surahNumber}`;
    const maxA = SURAH_TOTAL_AYAHS[chosenAttempt.surahNumber] || 1;
    const labelAyah = Math.min(maxA, chosenAttempt.ayahNumber);

    if (built) {
      const pName = quranService.getSurah(built.promptStart.surahNumber)?.name || sName;
      const surahLabel =
        built.promptStart.ayahNumber === built.answerEnd.ayahNumber
          ? `${pName} : ${built.promptStart.ayahNumber}`
          : `${pName} : ${built.promptStart.ayahNumber}–${built.answerEnd.ayahNumber}`;
      results.push({
        kind: 'new_auto',
        id: built.id,
        juzNumber: t.juzNumber,
        pageNumber: built.startPage,
        surahLabel,
        zoneLabels: t.zoneLabels,
        helpedSessionKeys: t.helpedSessionKeys,
        helpedStudentIds: t.helpedStudentIds,
        readiness: 'ready',
        question: built
      });
    } else {
      const pageVerses = pageVersesMap.get(t.pageNumber) || [];
      results.push({
        kind: 'new_auto',
        id: `not_ready_j${t.juzNumber}_p${t.pageNumber}_s${t.surahNumber}_a${t.ayahNumber}_${i}`,
        juzNumber: t.juzNumber,
        pageNumber: t.pageNumber,
        surahLabel: `${sName} : ${labelAyah}`,
        zoneLabels: t.zoneLabels,
        helpedSessionKeys: t.helpedSessionKeys,
        helpedStudentIds: t.helpedStudentIds,
        readiness: 'not_ready',
        notReadyReason:
          pageVerses.length === 0
            ? `Teks Mushaf Halaman ${t.pageNumber} belum tersedia dari server Al-Qur'an (koneksi lambat/offline).`
            : `Ayat ${sName}:${labelAyah} pada Hal. ${t.pageNumber} belum dapat dibentuk otomatis tanpa duplikasi — silakan input manual di Bank Soal.`,
        question: null
      });
    }
  }

  return results;
}
