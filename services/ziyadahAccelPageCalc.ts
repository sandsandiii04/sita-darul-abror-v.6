// services/ziyadahAccelPageCalc.ts
// Mesin Validasi Mushaf 604 Halaman, Deteksi Overlap/Celah Ayat, & Kalkulasi Rekap Ziyadah Akselerasi
// SITA — Darul Abror Islamic Boarding School

import {
  TahfidzRecord,
  ZiyadahAccelEventMetrics,
  ZiyadahAccelGroupProgress,
  ZiyadahAccelParticipant,
  ZiyadahAccelRangeItem,
  ZiyadahAccelSession,
  ZiyadahAccelSessionProgress,
  ZiyadahAccelStudentSessionCell,
  ZiyadahAccelStudentSummaryRow,
  ZiyadahAccelSubmission
} from '../types';
import { quranService, SURAH_TOTAL_AYAHS } from './quranService';
import { MUSHAF_604_PAGE_BOUNDARIES } from '../constants/mushafPageBoundaries';
import { MaterialDetectionService } from './materialDetectionService';

const materialDetector = new MaterialDetectionService();

export const QUARTER_PAGE_QUICK_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Memastikan jumlah halaman positif & tepat kelipatan 0,25 halaman Mushaf.
 */
export function isValidQuarterPage(val: number | null | undefined): boolean {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return false;
  const n = Number(val);
  if (n <= 0 || n > 604) return false;
  const scaled = Math.round(n * 100);
  return Math.abs(n * 100 - scaled) < 1e-6 && scaled % 25 === 0;
}

export function formatPagesIndo(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '-';
  const fixed = round2(Number(val));
  const str = Number.isInteger(fixed)
    ? fixed.toFixed(0)
    : fixed % 0.5 === 0
    ? fixed.toFixed(1)
    : fixed.toFixed(2);
  return str.replace('.', ',');
}

export interface RangePageEvaluation {
  valid: boolean;
  errorMessage?: string;
  surahNumber: number;
  surahName: string;
  ayahStart: number;
  ayahEnd: number;
  startPage: number;
  endPage: number;
  juzNumber: number;
  endJuzNumber: number;
  touchedPages: number[];
  exactFullPagesCount: number;
  maxPageSpan: number;
}

/**
 * Memvalidasi 1 rentang (Surah, Ayat Mulai .. Ayat Akhir) terhadap Mushaf Madinah 604 Halaman.
 * TIDAK menebak pecahan baris secara semu: menghitung halaman utuh yang tertutup penuh vs bentang halaman maksimum.
 */
export function evaluateSingleQuranRange(
  surahNumber: number,
  ayahStart: number,
  ayahEnd: number,
  selectedJuzHint?: number | null
): RangePageEvaluation {
  const sNum = Number(surahNumber);
  const aStart = Number(ayahStart);
  const aEnd = Number(ayahEnd);

  if (!Number.isInteger(sNum) || sNum < 1 || sNum > 114) {
    return {
      valid: false,
      errorMessage: 'Nomor surah harus berada di antara 1 sampai 114.',
      surahNumber: sNum || 1,
      surahName: '-',
      ayahStart: aStart || 1,
      ayahEnd: aEnd || 1,
      startPage: 1,
      endPage: 1,
      juzNumber: 1,
      endJuzNumber: 1,
      touchedPages: [],
      exactFullPagesCount: 0,
      maxPageSpan: 0
    };
  }

  const surahInfo = quranService.getSurah(sNum);
  const surahName = surahInfo?.name || `Surah ${sNum}`;
  const maxAyah = SURAH_TOTAL_AYAHS[sNum] || 1;

  if (!Number.isInteger(aStart) || !Number.isInteger(aEnd) || aStart < 1) {
    return {
      valid: false,
      errorMessage: `Nomor ayat pada ${surahName} minimal dimulai dari ayat 1.`,
      surahNumber: sNum,
      surahName,
      ayahStart: aStart,
      ayahEnd: aEnd,
      startPage: 1,
      endPage: 1,
      juzNumber: 1,
      endJuzNumber: 1,
      touchedPages: [],
      exactFullPagesCount: 0,
      maxPageSpan: 0
    };
  }

  if (aEnd < aStart) {
    return {
      valid: false,
      errorMessage: `Ayat akhir (${aEnd}) tidak boleh lebih kecil dari ayat awal (${aStart}) pada ${surahName}.`,
      surahNumber: sNum,
      surahName,
      ayahStart: aStart,
      ayahEnd: aEnd,
      startPage: 1,
      endPage: 1,
      juzNumber: 1,
      endJuzNumber: 1,
      touchedPages: [],
      exactFullPagesCount: 0,
      maxPageSpan: 0
    };
  }

  if (aEnd > maxAyah) {
    return {
      valid: false,
      errorMessage: `Surah ${surahName} hanya memiliki ${maxAyah} ayat (input: ayat ${aEnd}).`,
      surahNumber: sNum,
      surahName,
      ayahStart: aStart,
      ayahEnd: aEnd,
      startPage: 1,
      endPage: 1,
      juzNumber: 1,
      endJuzNumber: 1,
      touchedPages: [],
      exactFullPagesCount: 0,
      maxPageSpan: 0
    };
  }

  // Cari halaman pertama dan terakhir yang benar-benar memuat ayat dalam rentang ini pada MUSHAF_604_PAGE_BOUNDARIES
  const touchedPages: number[] = [];
  let exactFullPagesCount = 0;

  for (let p = 1; p <= 604; p++) {
    const b = MUSHAF_604_PAGE_BOUNDARIES[p];
    if (!b || !b.verses) continue;
    let hasAnyInRange = false;
    let allPageVersesInRange = b.verses.length > 0;

    for (const v of b.verses) {
      const inRange = v.surah === sNum && v.ayah >= aStart && v.ayah <= aEnd;
      if (inRange) hasAnyInRange = true;
      else allPageVersesInRange = false;
    }

    if (hasAnyInRange) {
      touchedPages.push(p);
      // Halaman dianggap tertutup utuh oleh 1 rentang ini jika seluruh ayat di halaman tsb termasuk
      // dan batas kata awal/akhir halaman tidak terpotong di tengah ayat luar
      if (allPageVersesInRange) {
        exactFullPagesCount += 1;
      }
    }
  }

  const startPage = touchedPages.length > 0 ? touchedPages[0] : quranService.getAyahPage(sNum, aStart);
  const endPage = touchedPages.length > 0 ? touchedPages[touchedPages.length - 1] : quranService.getAyahPage(sNum, aEnd);
  const juzNumber = quranService.getPageJuz(startPage);
  const endJuzNumber = quranService.getPageJuz(endPage);

  if (selectedJuzHint && selectedJuzHint >= 1 && selectedJuzHint <= 30) {
    if (selectedJuzHint < juzNumber || selectedJuzHint > endJuzNumber) {
      // Hanya beri validasi ketat jika Juz yang dipilih tidak bersinggungan sama sekali dengan halaman rentang ayat
      return {
        valid: false,
        errorMessage: `${surahName} ayat ${aStart}–${aEnd} berada di Juz ${
          juzNumber === endJuzNumber ? juzNumber : `${juzNumber}–${endJuzNumber}`
        } (Hal. ${startPage}–${endPage}), tidak sesuai dengan pilihan Juz ${selectedJuzHint}.`,
        surahNumber: sNum,
        surahName,
        ayahStart: aStart,
        ayahEnd: aEnd,
        startPage,
        endPage,
        juzNumber,
        endJuzNumber,
        touchedPages,
        exactFullPagesCount,
        maxPageSpan: touchedPages.length || Math.max(1, endPage - startPage + 1)
      };
    }
  }

  return {
    valid: true,
    surahNumber: sNum,
    surahName,
    ayahStart: aStart,
    ayahEnd: aEnd,
    startPage,
    endPage,
    juzNumber,
    endJuzNumber,
    touchedPages,
    exactFullPagesCount,
    maxPageSpan: touchedPages.length || Math.max(1, endPage - startPage + 1)
  };
}

export interface SubmissionValidationAnalysis {
  valid: boolean;
  blockingError?: string;
  normalizedRanges: ZiyadahAccelRangeItem[];
  touchedPagesSet: number[];
  maxPossiblePagesSpan: number;
  systemSuggestedPages: number | null;
  hasExactDuplicate: boolean;
  duplicateMessage?: string;
  hasPartialOverlap: boolean;
  overlapMessages: string[];
  hasAyahGap: boolean;
  gapMessages: string[];
  hasPageSpanMismatch: boolean;
  pageSpanWarning?: string;
  clientFlags: string[];
}

/**
 * Memeriksa kesinambungan ayat & antarsurah secara konservatif:
 * Bila referensi Mushaf tidak cukup membuktikan ketiadaan celah ayat (surah sebelumnya belum selesai
 * di ayat terakhir, surah baru tidak mulai dari ayat 1, melompati surah di antaranya, atau melompat
 * mundur tanpa arah hafalan backward), kembalikan kode flag verifikasi dan pesan peringatan jelas.
 */
export function evaluateVerseContinuity(params: {
  prevSurah: number;
  prevSurahName?: string;
  prevAyahEnd: number;
  curSurah: number;
  curSurahName?: string;
  curAyahStart: number;
  directionHint?: 'forward' | 'backward' | 'single_surah' | 'unknown' | null;
  contextLabel: string;
}): { flag: string; message: string } | null {
  const {
    prevSurah,
    prevAyahEnd,
    curSurah,
    curAyahStart,
    directionHint = 'forward',
    contextLabel
  } = params;
  const prevInfo = quranService.getSurah(prevSurah);
  const curInfo = quranService.getSurah(curSurah);
  const prevTotalVerses = SURAH_TOTAL_AYAHS[prevSurah] || 0;
  if (!prevInfo || !curInfo || prevTotalVerses <= 0) return null;

  const prevName = params.prevSurahName || prevInfo.name;
  const curName = params.curSurahName || curInfo.name;
  const dir = directionHint || 'forward';

  if (curSurah === prevSurah) {
    if (curAyahStart > prevAyahEnd + 1) {
      return {
        flag: 'AYAH_GAP_DETECTED',
        message: `${contextLabel}: Terdapat celah ayat pada ${curName} (berhenti di ayat ${prevAyahEnd}, lalu melompat ke ayat ${curAyahStart}; ayat ${prevAyahEnd + 1}–${curAyahStart - 1} belum tercatat).`
      };
    }
    return null;
  }

  if (curSurah === prevSurah + 1) {
    if (dir === 'backward') {
      return {
        flag: 'CROSS_SURAH_UNVERIFIED_JUMP',
        message: `${contextLabel}: Arah hafalan peserta tercatat mundur (Juz 30→29), tetapi setoran berpindah maju dari ${prevName} ke ${curName}. Perlu verifikasi Koordinator.`
      };
    }
    if (prevAyahEnd === prevTotalVerses && curAyahStart === 1) {
      return null;
    }
    const details: string[] = [];
    if (prevAyahEnd < prevTotalVerses) {
      details.push(`${prevName} baru sampai ayat ${prevAyahEnd}/${prevTotalVerses}`);
    }
    if (curAyahStart > 1) {
      details.push(`${curName} dimulai dari ayat ${curAyahStart} (ayat 1–${curAyahStart - 1} terlewat)`);
    }
    return {
      flag: 'CROSS_SURAH_GAP',
      message: `${contextLabel}: Terdapat celah kesinambungan antarsurah (${details.join(' dan ')}). Ditandai untuk verifikasi Koordinator.`
    };
  }

  if (curSurah === prevSurah - 1) {
    if (dir === 'backward') {
      if (prevAyahEnd === prevTotalVerses && curAyahStart === 1) {
        return null;
      }
      const details: string[] = [];
      if (prevAyahEnd < prevTotalVerses) {
        details.push(`${prevName} baru sampai ayat ${prevAyahEnd}/${prevTotalVerses}`);
      }
      if (curAyahStart > 1) {
        details.push(`${curName} dimulai dari ayat ${curAyahStart} (ayat 1–${curAyahStart - 1} terlewat)`);
      }
      return {
        flag: 'CROSS_SURAH_GAP',
        message: `${contextLabel}: Terdapat celah kesinambungan antarsurah mundur (${details.join(' dan ')}). Ditandai untuk verifikasi Koordinator.`
      };
    }
    return {
      flag: 'CROSS_SURAH_UNVERIFIED_JUMP',
      message: `${contextLabel}: Perpindahan mundur dari ${prevName} ke ${curName} tidak dapat dipastikan bebas celah tanpa arah hafalan mundur. Ditandai untuk verifikasi Koordinator.`
    };
  }

  return {
    flag: 'CROSS_SURAH_UNVERIFIED_JUMP',
    message: `${contextLabel}: Lompatan antarsurah dari ${prevName} (Surah ${prevSurah}) ke ${curName} (Surah ${curSurah}) melewati surah di antaranya sehingga memerlukan verifikasi Koordinator.`
  };
}

/**
 * Menganalisis keseluruhan daftar rentang pada form penguji terhadap:
 * 1. Validitas surah, ayat, dan juz
 * 2. Duplikasi penuh / subset (DITOLAK agar tidak pernah dihitung ganda)
 * 3. Tumpang tindih sebagian / partial overlap intra-sesi maupun lintas sesi (DITANDAI needs_verification tanpa potong proporsi ayat!)
 * 4. Celah ayat / ayah gap & kesinambungan antarsurah baik intra-sesi maupun terhadap sesi/baseline sebelumnya (DITANDAI needs_verification)
 * 5. Kewajaran jumlah halaman konfirmasi penguji terhadap halaman Mushaf yang disentuh
 */
export function analyzeSubmissionRangesAndPages(params: {
  draftRanges: Array<{
    juzNumber?: number | null;
    surahNumber: number;
    ayahStart: number;
    ayahEnd: number;
  }>;
  confirmedPages: number | null;
  previousSubmissionsForStudent: ZiyadahAccelSubmission[];
  currentSessionId: string;
  participantBaseline?: {
    surah?: number | null;
    ayah?: number | null;
  };
  directionHint?: 'forward' | 'backward' | 'single_surah' | 'unknown' | null;
}): SubmissionValidationAnalysis {
  const {
    draftRanges,
    confirmedPages,
    previousSubmissionsForStudent,
    currentSessionId,
    participantBaseline,
    directionHint
  } = params;

  if (!draftRanges || draftRanges.length === 0) {
    return {
      valid: false,
      blockingError: 'Tambahkan minimal 1 rentang surah dan ayat yang disetorkan.',
      normalizedRanges: [],
      touchedPagesSet: [],
      maxPossiblePagesSpan: 0,
      systemSuggestedPages: null,
      hasExactDuplicate: false,
      hasPartialOverlap: false,
      overlapMessages: [],
      hasAyahGap: false,
      gapMessages: [],
      hasPageSpanMismatch: false,
      clientFlags: []
    };
  }

  const normalizedRanges: ZiyadahAccelRangeItem[] = [];
  const allTouchedPages = new Set<number>();
  const allFullPages = new Set<number>();
  const overlapMessages: string[] = [];
  const gapMessages: string[] = [];
  const clientFlags = new Set<string>();
  let hasExactDuplicate = false;
  let duplicateMessage: string | undefined;
  let hasPartialOverlap = false;

  // Kumpulkan seluruh rentang aktif dari sesi-sesi lain milik santri yang sama
  const priorRanges: Array<{
    sessionId: string;
    surahNumber: number;
    surahName: string;
    ayahStart: number;
    ayahEnd: number;
  }> = [];

  for (const sub of previousSubmissionsForStudent || []) {
    if (sub.sessionId === currentSessionId) continue;
    if (sub.fulfillmentStatus !== 'submitted') continue;
    for (const r of sub.ranges || []) {
      priorRanges.push({
        sessionId: sub.sessionId,
        surahNumber: r.surahNumber,
        surahName: r.surahNameSnapshot,
        ayahStart: r.ayahStart,
        ayahEnd: r.ayahEnd
      });
    }
  }

  for (let i = 0; i < draftRanges.length; i++) {
    const raw = draftRanges[i];
    const evalRes = evaluateSingleQuranRange(
      raw.surahNumber,
      raw.ayahStart,
      raw.ayahEnd,
      raw.juzNumber
    );

    if (!evalRes.valid) {
      return {
        valid: false,
        blockingError: `Rentang #${i + 1}: ${evalRes.errorMessage}`,
        normalizedRanges: [],
        touchedPagesSet: [],
        maxPossiblePagesSpan: 0,
        systemSuggestedPages: null,
        hasExactDuplicate: false,
        hasPartialOverlap: false,
        overlapMessages: [],
        hasAyahGap: false,
        gapMessages: [],
        hasPageSpanMismatch: false,
        clientFlags: []
      };
    }

    evalRes.touchedPages.forEach(p => allTouchedPages.add(p));

    // Cek terhadap rentang sebelumnya di dalam form yang sama (intra-sesi)
    let rangeOverlapFlag = false;
    let rangeOverlapDetail: string | null = null;

    for (let j = 0; j < normalizedRanges.length; j++) {
      const prev = normalizedRanges[j];
      if (prev.surahNumber === evalRes.surahNumber) {
        const isSubset =
          evalRes.ayahStart >= prev.ayahStart && evalRes.ayahEnd <= prev.ayahEnd;
        const isSupersetEq =
          evalRes.ayahStart === prev.ayahStart && evalRes.ayahEnd === prev.ayahEnd;

        if (isSubset || isSupersetEq) {
          hasExactDuplicate = true;
          duplicateMessage = `Rentang #${i + 1} (${evalRes.surahName} ${evalRes.ayahStart}–${evalRes.ayahEnd}) duplikat/tercakup penuh di dalam Rentang #${j + 1} (${prev.ayahStart}–${prev.ayahEnd}).`;
        } else if (Math.max(evalRes.ayahStart, prev.ayahStart) <= Math.min(evalRes.ayahEnd, prev.ayahEnd)) {
          hasPartialOverlap = true;
          rangeOverlapFlag = true;
          const ovStart = Math.max(evalRes.ayahStart, prev.ayahStart);
          const ovEnd = Math.min(evalRes.ayahEnd, prev.ayahEnd);
          rangeOverlapDetail = `Tumpang tindih ayat ${ovStart}–${ovEnd} dengan Rentang #${j + 1}`;
          overlapMessages.push(
            `${evalRes.surahName} ayat ${ovStart}–${ovEnd} beririsan antara Rentang #${j + 1} dan Rentang #${i + 1}.`
          );
          clientFlags.add('OVERLAP_INTRA_SESSION');
        }
      }
    }

    // Cek kesinambungan berurutan antar-rentang di dalam sesi yang sama (intra-sesi: sama surah maupun antarsurah)
    if (normalizedRanges.length > 0) {
      const immediatePrev = normalizedRanges[normalizedRanges.length - 1];
      const intraCont = evaluateVerseContinuity({
        prevSurah: immediatePrev.surahNumber,
        prevSurahName: immediatePrev.surahNameSnapshot,
        prevAyahEnd: immediatePrev.ayahEnd,
        curSurah: evalRes.surahNumber,
        curSurahName: evalRes.surahName,
        curAyahStart: evalRes.ayahStart,
        directionHint,
        contextLabel: `Rentang #${normalizedRanges.length}→#${i + 1}`
      });
      if (intraCont) {
        gapMessages.push(intraCont.message);
        clientFlags.add(intraCont.flag);
      }
    }

    // Cek terhadap rentang di sesi-sesi terdahulu kegiatan yang sama
    for (const pr of priorRanges) {
      if (pr.surahNumber === evalRes.surahNumber) {
        if (evalRes.ayahStart >= pr.ayahStart && evalRes.ayahEnd <= pr.ayahEnd) {
          hasExactDuplicate = true;
          duplicateMessage = `${evalRes.surahName} ayat ${evalRes.ayahStart}–${evalRes.ayahEnd} sudah pernah disetorkan pada sesi sebelumnya (${pr.surahName} ${pr.ayahStart}–${pr.ayahEnd}) sehingga tidak boleh dihitung dua kali.`;
        } else if (Math.max(evalRes.ayahStart, pr.ayahStart) <= Math.min(evalRes.ayahEnd, pr.ayahEnd)) {
          hasPartialOverlap = true;
          rangeOverlapFlag = true;
          const ovStart = Math.max(evalRes.ayahStart, pr.ayahStart);
          const ovEnd = Math.min(evalRes.ayahEnd, pr.ayahEnd);
          rangeOverlapDetail = `Beririsan dengan sesi terdahulu (${pr.surahName} ayat ${ovStart}–${ovEnd})`;
          overlapMessages.push(
            `${evalRes.surahName} ayat ${ovStart}–${ovEnd} tumpang tindih dengan setoran sesi sebelumnya (${pr.ayahStart}–${pr.ayahEnd}).`
          );
          clientFlags.add('OVERLAP_PREVIOUS_SESSION');
        }
      }
    }

    normalizedRanges.push({
      rangeOrder: i + 1,
      juzNumber: raw.juzNumber || evalRes.juzNumber,
      surahNumber: evalRes.surahNumber,
      surahNameSnapshot: evalRes.surahName,
      ayahStart: evalRes.ayahStart,
      ayahEnd: evalRes.ayahEnd,
      startPage: evalRes.startPage,
      endPage: evalRes.endPage,
      overlapFlag: rangeOverlapFlag,
      overlapDetail: rangeOverlapDetail
    });
  }

  // Cek kesinambungan (sama surah maupun antarsurah) antara batas akhir sesi sah sebelumnya
  // (atau baseline harian bila belum ada sesi sebelumnya) dengan rentang pertama sesi ini
  const firstRange = normalizedRanges[0];
  if (firstRange) {
    if (priorRanges.length > 0) {
      const latestPrior = priorRanges[priorRanges.length - 1];
      const priorCont = evaluateVerseContinuity({
        prevSurah: latestPrior.surahNumber,
        prevSurahName: latestPrior.surahName,
        prevAyahEnd: latestPrior.ayahEnd,
        curSurah: firstRange.surahNumber,
        curSurahName: firstRange.surahNameSnapshot,
        curAyahStart: firstRange.ayahStart,
        directionHint,
        contextLabel: 'Kesinambungan dari sesi sebelumnya'
      });
      if (priorCont) {
        gapMessages.push(priorCont.message);
        clientFlags.add(priorCont.flag);
      }
    } else if (participantBaseline?.surah && participantBaseline?.ayah) {
      const baseCont = evaluateVerseContinuity({
        prevSurah: participantBaseline.surah,
        prevAyahEnd: participantBaseline.ayah,
        curSurah: firstRange.surahNumber,
        curSurahName: firstRange.surahNameSnapshot,
        curAyahStart: firstRange.ayahStart,
        directionHint,
        contextLabel: 'Kesinambungan dari batas hafalan awal'
      });
      if (baseCont) {
        gapMessages.push(baseCont.message);
        clientFlags.add(baseCont.flag);
      }
    }
  }

  // Hitung halaman Mushaf yang seluruh ayatnya tercakup gabungan rentang sesi ini
  const touchedPagesArr = Array.from(allTouchedPages).sort((a, b) => a - b);
  for (const p of touchedPagesArr) {
    const b = MUSHAF_604_PAGE_BOUNDARIES[p];
    if (!b || !b.verses || b.verses.length === 0) continue;
    const allCovered = b.verses.every(v =>
      normalizedRanges.some(
        nr => nr.surahNumber === v.surah && v.ayah >= nr.ayahStart && v.ayah <= nr.ayahEnd
      )
    );
    if (allCovered) {
      allFullPages.add(p);
    }
  }

  const maxPossiblePagesSpan = touchedPagesArr.length;
  const systemSuggestedPages =
    allFullPages.size > 0 && allFullPages.size === touchedPagesArr.length
      ? allFullPages.size
      : null;

  let hasPageSpanMismatch = false;
  let pageSpanWarning: string | undefined;

  if (confirmedPages !== null && confirmedPages !== undefined) {
    if (!isValidQuarterPage(confirmedPages)) {
      return {
        valid: false,
        blockingError: 'Jumlah halaman harus lebih dari 0 dan berkelipatan 0,25 halaman (contoh: 0,25 | 0,5 | 0,75 | 1 | 1,25 | 1,5).',
        normalizedRanges,
        touchedPagesSet: touchedPagesArr,
        maxPossiblePagesSpan,
        systemSuggestedPages,
        hasExactDuplicate,
        duplicateMessage,
        hasPartialOverlap,
        overlapMessages,
        hasAyahGap: gapMessages.length > 0,
        gapMessages,
        hasPageSpanMismatch: false,
        clientFlags: Array.from(clientFlags)
      };
    }

    if (maxPossiblePagesSpan > 0 && confirmedPages > maxPossiblePagesSpan) {
      hasPageSpanMismatch = true;
      pageSpanWarning = `Rentang ayat hanya menyentuh ${maxPossiblePagesSpan} halaman Mushaf (Hal. ${touchedPagesArr[0]}–${touchedPagesArr[touchedPagesArr.length - 1]}), tetapi jumlah halaman diisi ${formatPagesIndo(confirmedPages)} halaman. Setoran akan ditandai untuk verifikasi Koordinator.`;
      clientFlags.add('PAGE_SPAN_MISMATCH');
    }
  }

  if (hasExactDuplicate) {
    return {
      valid: false,
      blockingError: duplicateMessage || 'Terdeteksi rentang ayat duplikat yang sudah pernah disetorkan.',
      normalizedRanges,
      touchedPagesSet: touchedPagesArr,
      maxPossiblePagesSpan,
      systemSuggestedPages,
      hasExactDuplicate: true,
      duplicateMessage,
      hasPartialOverlap,
      overlapMessages,
      hasAyahGap: gapMessages.length > 0,
      gapMessages,
      hasPageSpanMismatch,
      pageSpanWarning,
      clientFlags: Array.from(clientFlags)
    };
  }

  return {
    valid: true,
    normalizedRanges,
    touchedPagesSet: touchedPagesArr,
    maxPossiblePagesSpan,
    systemSuggestedPages,
    hasExactDuplicate: false,
    hasPartialOverlap,
    overlapMessages,
    hasAyahGap: gapMessages.length > 0,
    gapMessages,
    hasPageSpanMismatch,
    pageSpanWarning,
    clientFlags: Array.from(clientFlags)
  };
}

/**
 * Membaca referensi batas hafalan harian terakhir santri (READ-ONLY dari tabel records sabaq/ziyadah).
 * TIDAK pernah menggabungkan atau menulis balik ke setoran harian.
 */
export function extractStudentDailyBaseline(
  studentId: string,
  allDailyRecords: TahfidzRecord[]
): {
  baselineSurah: number | null;
  baselineAyah: number | null;
  baselinePage: number | null;
  baselineLabel: string;
  directionHint: 'forward' | 'backward' | 'single_surah' | 'unknown';
} {
  const sabaqRecords = (allDailyRecords || [])
    .filter(r => {
      if (!r || r.studentId !== studentId) return false;
      const t = String(r.type || '').toLowerCase();
      return t === 'sabaq' || t === 'ziyadah';
    })
    .sort((a, b) => {
      const dCmp = String(a.date || '').localeCompare(String(b.date || ''));
      if (dCmp !== 0) return dCmp;
      return String(a.createdAt || a.id || '').localeCompare(String(b.createdAt || b.id || ''));
    });

  if (sabaqRecords.length === 0) {
    return {
      baselineSurah: null,
      baselineAyah: null,
      baselinePage: null,
      baselineLabel: 'Belum ada riwayat sabaq harian',
      directionHint: 'unknown'
    };
  }

  const last = sabaqRecords[sabaqRecords.length - 1];
  const sNum = materialDetector.getSurahNumber(last.surah);
  const sName = quranService.getSurah(sNum)?.name || last.surah;
  const maxAyah = SURAH_TOTAL_AYAHS[sNum] || 1;
  const aEnd = Math.max(1, Math.min(maxAyah, Number(last.ayahEnd || last.ayahStart || 1)));
  const page = quranService.getAyahPage(sNum, aEnd);

  let forward = 0;
  let backward = 0;
  for (let i = 1; i < sabaqRecords.length; i++) {
    const prevS = materialDetector.getSurahNumber(sabaqRecords[i - 1].surah);
    const curS = materialDetector.getSurahNumber(sabaqRecords[i].surah);
    if (curS > prevS) forward++;
    else if (curS < prevS) backward++;
  }

  const directionHint =
    forward > backward ? 'forward' : backward > forward ? 'backward' : 'single_surah';

  return {
    baselineSurah: sNum,
    baselineAyah: aEnd,
    baselinePage: page,
    baselineLabel: `${sName} : ${last.ayahStart || 1}–${aEnd} (Hal. ${page} • ${last.date})`,
    directionHint
  };
}

export function formatRangesCompact(ranges: ZiyadahAccelRangeItem[] | undefined): string {
  if (!ranges || ranges.length === 0) return '-';
  return ranges
    .map(r => `${r.surahNameSnapshot} : ${r.ayahStart}–${r.ayahEnd}`)
    .join('; ');
}

/**
 * Menghitung seluruh metrik Dashboard, Matriks Koordinator, & Rekap Akhir Peserta
 * berdasarkan ID santri resmi (bukan kemiripan nama), memisahkan santri unik vs kewajiban setoran,
 * dan menerapkan kebijakan:
 * - Nilai NULL tidak pernah dihitung sebagai 0
 * - Nilai 0 yang sah dari penguji tetap dihitung
 * - Setoran 'needs_verification' ditahan dari Total Halaman Unik sampai diverifikasi Koordinator
 * - Menyediakan Rata-rata per Santri (Metode 1 - Laporan Akhir) & Rata-rata Seluruh Setoran (Metode 2 - Dashboard)
 */
export function computeZiyadahAccelAnalytics(params: {
  participants: ZiyadahAccelParticipant[];
  sessions: ZiyadahAccelSession[];
  submissions: ZiyadahAccelSubmission[];
}): {
  metrics: ZiyadahAccelEventMetrics;
  studentRows: ZiyadahAccelStudentSummaryRow[];
} {
  const activeParticipants = (params.participants || [])
    .filter(p => p.participantStatus === 'active')
    .sort((a, b) => a.studentNameSnapshot.localeCompare(b.studentNameSnapshot, 'id'));

  const validSessions = (params.sessions || [])
    .filter(s => s.status !== 'cancelled')
    .sort((a, b) => a.sessionNumber - b.sessionNumber);

  const subLookup = new Map<string, ZiyadahAccelSubmission>();
  for (const sub of params.submissions || []) {
    subLookup.set(`${sub.sessionId}__${sub.participantId}`, sub);
  }

  const activeSess =
    validSessions.find(s => s.status === 'active') ||
    validSessions.find(s => s.status === 'scheduled') ||
    null;

  let totalSubmittedObligations = 0;
  let totalAbsentObligations = 0;
  let totalNotSubmittedObligations = 0;
  let needsVerifySubmissionsCount = 0;
  const needsVerifyStudentSet = new Set<string>();

  let grandSubmittedPages = 0;
  let grandUniqueVerifiedPages = 0;
  let grandUnverifiedPages = 0;

  let allScoredSubmissionsSum = 0;
  let allScoredSubmissionsCount = 0;

  const studentRows: ZiyadahAccelStudentSummaryRow[] = [];

  for (const part of activeParticipants) {
    const cells: ZiyadahAccelStudentSessionCell[] = [];
    let stSubmittedCount = 0;
    let stScoredCount = 0;
    let stScoreSum = 0;
    let stAbsentCount = 0;
    let stPendingCount = 0;
    let stNeedsVerifyCount = 0;
    let stSubmittedPages = 0;
    let stUniqueVerifiedPages = 0;
    let stUnverifiedPages = 0;
    const perSessionTexts: string[] = [];

    for (const sess of validSessions) {
      const sub = subLookup.get(`${sess.id}__${part.id}`);
      const fStatus = sub?.fulfillmentStatus || (sess.status === 'closed' ? 'pending_examiner_input' : 'waiting_turn');
      const vStatus = sub?.verificationStatus || 'clean';

      let cellConfirmed: number | null = null;
      let cellUnique = 0;
      let cellUnverified = 0;
      let cellScore: number | null = null;
      let rangeText = '-';

      if (fStatus === 'submitted' && sub) {
        stSubmittedCount += 1;
        totalSubmittedObligations += 1;

        cellConfirmed = sub.confirmedPages !== null && sub.confirmedPages !== undefined ? Number(sub.confirmedPages) : 0;
        stSubmittedPages += cellConfirmed;
        grandSubmittedPages += cellConfirmed;

        if (vStatus === 'clean' || vStatus === 'verified_approved') {
          cellUnique =
            sub.approvedUniquePages !== null && sub.approvedUniquePages !== undefined
              ? Number(sub.approvedUniquePages)
              : cellConfirmed;
          stUniqueVerifiedPages += cellUnique;
          grandUniqueVerifiedPages += cellUnique;
        } else if (vStatus === 'needs_verification') {
          cellUnverified = cellConfirmed;
          stUnverifiedPages += cellUnverified;
          grandUnverifiedPages += cellUnverified;
          stNeedsVerifyCount += 1;
          needsVerifySubmissionsCount += 1;
          needsVerifyStudentSet.add(part.studentId);
        }

        // Nilai NULL tidak dihitung sebagai 0; nilai 0 yang sah tetap dihitung!
        if (sub.score !== null && sub.score !== undefined && !Number.isNaN(Number(sub.score))) {
          cellScore = round2(Number(sub.score));
          if (vStatus !== 'verified_rejected') {
            stScoreSum += cellScore;
            stScoredCount += 1;
            allScoredSubmissionsSum += cellScore;
            allScoredSubmissionsCount += 1;
          }
        }

        rangeText = formatRangesCompact(sub.ranges);
        if (rangeText !== '-') {
          perSessionTexts.push(`S${sess.sessionNumber}: ${rangeText}`);
        }
      } else if (fStatus === 'absent') {
        stAbsentCount += 1;
        totalAbsentObligations += 1;
        rangeText = 'Tidak Hadir';
      } else if (fStatus !== 'cancelled') {
        stPendingCount += 1;
        totalNotSubmittedObligations += 1;
      }

      cells.push({
        sessionId: sess.id,
        sessionNumber: sess.sessionNumber,
        sessionName: sess.name,
        submission: sub,
        fulfillmentStatus: fStatus,
        verificationStatus: vStatus,
        confirmedPages: cellConfirmed,
        uniqueVerifiedPages: round2(cellUnique),
        unverifiedPages: round2(cellUnverified),
        score: cellScore,
        rangeSummaryText: rangeText,
        examinerName: sub?.recordedByNameSnapshot || null
      });
    }

    const avgScore = stScoredCount > 0 ? round2(stScoreSum / stScoredCount) : null;
    const closedSessionsCount = validSessions.filter(s => s.status === 'closed').length;
    const isLagging =
      closedSessionsCount > 0 &&
      cells.some((c, idx) => validSessions[idx].status === 'closed' && c.fulfillmentStatus !== 'submitted');

    studentRows.push({
      participantId: part.id,
      studentId: part.studentId,
      studentName: part.studentNameSnapshot,
      nis: part.nisSnapshot,
      className: part.classSnapshot,
      halaqah: part.halaqahSnapshot,
      halaqahTeacherName: part.halaqahTeacherNameSnapshot || '-',
      baselineLabel: part.baselineLabel || '-',
      cells,
      totalSessionsExpected: validSessions.length,
      submittedSessionCount: stSubmittedCount,
      scoredSessionCount: stScoredCount,
      absentSessionCount: stAbsentCount,
      pendingSessionCount: stPendingCount,
      needsVerificationCount: stNeedsVerifyCount,
      totalSubmittedPages: round2(stSubmittedPages),
      totalUniqueVerifiedPages: round2(stUniqueVerifiedPages),
      totalUnverifiedPages: round2(stUnverifiedPages),
      averageScore: avgScore,
      combinedRangesText: perSessionTexts.length > 0 ? perSessionTexts.join(' | ') : '-',
      isCompleteAllSessions: validSessions.length > 0 && stSubmittedCount === validSessions.length,
      isLagging
    });
  }

  // Metode 1: Rata-rata dari nilai rata-rata santri yang memiliki nilai sah
  const scoredStudents = studentRows.filter(r => r.averageScore !== null);
  const averageScoreByStudent =
    scoredStudents.length > 0
      ? round2(scoredStudents.reduce((acc, r) => acc + (r.averageScore || 0), 0) / scoredStudents.length)
      : null;

  // Metode 2: Rata-rata seluruh setoran sesi yang bernilai sah
  const averageScoreBySubmission =
    allScoredSubmissionsCount > 0
      ? round2(allScoredSubmissionsSum / allScoredSubmissionsCount)
      : null;

  // Breakdown per Sesi
  const sessionProgress: ZiyadahAccelSessionProgress[] = validSessions.map(sess => {
    let submittedCount = 0;
    let waitingTurnCount = 0;
    let calledNotSubmittedCount = 0;
    let absentCount = 0;
    let pendingExaminerInputCount = 0;
    let needsVerificationCount = 0;
    let sessUniquePages = 0;
    let sessScoreSum = 0;
    let sessScoreCnt = 0;

    for (const row of studentRows) {
      const cell = row.cells.find(c => c.sessionId === sess.id);
      if (!cell) continue;
      switch (cell.fulfillmentStatus) {
        case 'submitted':
          submittedCount += 1;
          sessUniquePages += cell.uniqueVerifiedPages;
          if (cell.verificationStatus === 'needs_verification') needsVerificationCount += 1;
          if (cell.score !== null && cell.verificationStatus !== 'verified_rejected') {
            sessScoreSum += cell.score;
            sessScoreCnt += 1;
          }
          break;
        case 'called_not_submitted':
          calledNotSubmittedCount += 1;
          break;
        case 'absent':
          absentCount += 1;
          break;
        case 'pending_examiner_input':
          pendingExaminerInputCount += 1;
          break;
        case 'waiting_turn':
        default:
          waitingTurnCount += 1;
          break;
      }
    }

    return {
      sessionId: sess.id,
      sessionNumber: sess.sessionNumber,
      sessionName: sess.name,
      sessionDate: sess.sessionDate,
      status: sess.status,
      totalParticipants: activeParticipants.length,
      submittedCount,
      waitingTurnCount,
      calledNotSubmittedCount,
      absentCount,
      pendingExaminerInputCount,
      needsVerificationCount,
      totalUniquePages: round2(sessUniquePages),
      averageSessionScore: sessScoreCnt > 0 ? round2(sessScoreSum / sessScoreCnt) : null
    };
  });

  // Breakdown per Kelas & Halaqah
  const buildGroupBreakdown = (keyGetter: (r: ZiyadahAccelStudentSummaryRow) => string): ZiyadahAccelGroupProgress[] => {
    const map = new Map<string, ZiyadahAccelStudentSummaryRow[]>();
    for (const row of studentRows) {
      const k = keyGetter(row) || '-';
      const arr = map.get(k) || [];
      arr.push(row);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'id', { numeric: true }))
      .map(([groupKey, rows]) => {
        const withScore = rows.filter(r => r.averageScore !== null);
        return {
          groupKey,
          participantCount: rows.length,
          totalObligations: rows.length * validSessions.length,
          submittedObligations: rows.reduce((a, r) => a + r.submittedSessionCount, 0),
          absentObligations: rows.reduce((a, r) => a + r.absentSessionCount, 0),
          totalUniqueVerifiedPages: round2(rows.reduce((a, r) => a + r.totalUniqueVerifiedPages, 0)),
          averageScoreByStudent:
            withScore.length > 0
              ? round2(withScore.reduce((a, r) => a + (r.averageScore || 0), 0) / withScore.length)
              : null
        };
      });
  };

  const activeSessStats = activeSess
    ? sessionProgress.find(sp => sp.sessionId === activeSess.id)
    : null;

  const metrics: ZiyadahAccelEventMetrics = {
    uniqueParticipantsCount: activeParticipants.length,
    activeSessionsCount: validSessions.filter(s => s.status === 'active').length,
    totalSessionsCount: validSessions.length,
    currentActiveSessionId: activeSess?.id || null,
    currentActiveSessionName: activeSess?.name || null,

    activeSessionSubmittedStudents: activeSessStats?.submittedCount || 0,
    activeSessionPendingStudents: activeSessStats
      ? activeSessStats.waitingTurnCount +
        activeSessStats.calledNotSubmittedCount +
        activeSessStats.pendingExaminerInputCount
      : 0,
    activeSessionAbsentStudents: activeSessStats?.absentCount || 0,

    totalObligationsCount: activeParticipants.length * validSessions.length,
    submittedObligationsCount: totalSubmittedObligations,
    notSubmittedObligationsCount: totalNotSubmittedObligations,
    absentObligationsCount: totalAbsentObligations,
    needsVerificationSubmissionsCount: needsVerifySubmissionsCount,
    needsVerificationStudentsCount: needsVerifyStudentSet.size,

    totalSubmittedPages: round2(grandSubmittedPages),
    totalUniqueVerifiedPages: round2(grandUniqueVerifiedPages),
    totalUnverifiedPages: round2(grandUnverifiedPages),
    averageScoreByStudent,
    studentsWithScoreCount: scoredStudents.length,
    averageScoreBySubmission,
    validScoredSubmissionsCount: allScoredSubmissionsCount,

    sessionProgress,
    classProgress: buildGroupBreakdown(r => r.className),
    halaqahProgress: buildGroupBreakdown(r => r.halaqah)
  };

  return { metrics, studentRows };
}
