import {
  AcademicTerm,
  ExamMaterialPart,
  ExamPeriod,
  ExamUASSession,
  TahfidzRecord,
  UASMaterialPartStatus,
  UASMaterialPartType,
  UASMaterialSegment
} from '../types';
import { MUSHAF_604_PAGE_BOUNDARIES } from '../constants/mushafPageBoundaries';
import { JUZ_START_PAGES, SURAH_TOTAL_AYAHS, quranService } from './quranService';
import { materialDetectionService } from './materialDetectionService';

export interface JuzPageRange {
  juzNumber: number;
  startPage: number;
  endPage: number;
  totalPages: number;
}

export interface JuzAyahBoundary {
  juzNumber: number;
  startSurah: number;
  startAyah: number;
  endSurah: number;
  endAyah: number;
}

/**
 * Batas ayat eksak 30 Juz standar Mushaf Madinah (Hafs 'an 'Asim),
 * termasuk juz yang dimulai atau berakhir di tengah halaman.
 */
export const JUZ_AYAH_BOUNDARIES: Record<number, JuzAyahBoundary> = {
  1: { juzNumber: 1, startSurah: 1, startAyah: 1, endSurah: 2, endAyah: 141 },
  2: { juzNumber: 2, startSurah: 2, startAyah: 142, endSurah: 2, endAyah: 252 },
  3: { juzNumber: 3, startSurah: 2, startAyah: 253, endSurah: 3, endAyah: 92 },
  4: { juzNumber: 4, startSurah: 3, startAyah: 93, endSurah: 4, endAyah: 23 },
  5: { juzNumber: 5, startSurah: 4, startAyah: 24, endSurah: 4, endAyah: 147 },
  6: { juzNumber: 6, startSurah: 4, startAyah: 148, endSurah: 5, endAyah: 81 },
  7: { juzNumber: 7, startSurah: 5, startAyah: 82, endSurah: 6, endAyah: 110 },
  8: { juzNumber: 8, startSurah: 6, startAyah: 111, endSurah: 7, endAyah: 87 },
  9: { juzNumber: 9, startSurah: 7, startAyah: 88, endSurah: 8, endAyah: 40 },
  10: { juzNumber: 10, startSurah: 8, startAyah: 41, endSurah: 9, endAyah: 92 },
  11: { juzNumber: 11, startSurah: 9, startAyah: 93, endSurah: 11, endAyah: 5 },
  12: { juzNumber: 12, startSurah: 11, startAyah: 6, endSurah: 12, endAyah: 52 },
  13: { juzNumber: 13, startSurah: 12, startAyah: 53, endSurah: 14, endAyah: 52 },
  14: { juzNumber: 14, startSurah: 15, startAyah: 1, endSurah: 16, endAyah: 128 },
  15: { juzNumber: 15, startSurah: 17, startAyah: 1, endSurah: 18, endAyah: 74 },
  16: { juzNumber: 16, startSurah: 18, startAyah: 75, endSurah: 20, endAyah: 135 },
  17: { juzNumber: 17, startSurah: 21, startAyah: 1, endSurah: 22, endAyah: 78 },
  18: { juzNumber: 18, startSurah: 23, startAyah: 1, endSurah: 25, endAyah: 20 },
  19: { juzNumber: 19, startSurah: 25, startAyah: 21, endSurah: 27, endAyah: 55 },
  20: { juzNumber: 20, startSurah: 27, startAyah: 56, endSurah: 29, endAyah: 45 },
  21: { juzNumber: 21, startSurah: 29, startAyah: 46, endSurah: 33, endAyah: 30 },
  22: { juzNumber: 22, startSurah: 33, startAyah: 31, endSurah: 36, endAyah: 27 },
  23: { juzNumber: 23, startSurah: 36, startAyah: 28, endSurah: 39, endAyah: 31 },
  24: { juzNumber: 24, startSurah: 39, startAyah: 32, endSurah: 41, endAyah: 46 },
  25: { juzNumber: 25, startSurah: 41, startAyah: 47, endSurah: 45, endAyah: 37 },
  26: { juzNumber: 26, startSurah: 46, startAyah: 1, endSurah: 51, endAyah: 30 },
  27: { juzNumber: 27, startSurah: 51, startAyah: 31, endSurah: 57, endAyah: 29 },
  28: { juzNumber: 28, startSurah: 58, startAyah: 1, endSurah: 66, endAyah: 12 },
  29: { juzNumber: 29, startSurah: 67, startAyah: 1, endSurah: 77, endAyah: 50 },
  30: { juzNumber: 30, startSurah: 78, startAyah: 1, endSurah: 114, endAyah: 6 }
};

export const JUZ_PAGE_RANGES: Record<number, JuzPageRange> = (() => {
  const map: Record<number, JuzPageRange> = {};
  for (let j = 1; j <= 30; j++) {
    const startPage = JUZ_START_PAGES[j];
    const endPage = j < 30 ? JUZ_START_PAGES[j + 1] - 1 : 604;
    map[j] = {
      juzNumber: j,
      startPage,
      endPage,
      totalPages: endPage - startPage + 1
    };
  }
  return map;
})();

export interface StudentJuzAnalysisResult {
  studentId: string;
  periodId: string;
  parts: ExamMaterialPart[];
  sessions: ExamUASSession[];
  hasUnverifiedGaps: boolean;
  needsAdminDecision: boolean;
  anomalies: string[];
  summaryReason: string;
}

interface JuzAyahRef {
  surah: number;
  ayah: number;
  key: string;
  page: number;
  pageWeight: number;
}

const VERSE_PAGE_WEIGHT_CACHE = new Map<string, number>();

/**
 * Menghitung bobot panjang hafalan tiap ayat dalam satuan halaman Mushaf Madinah (15 baris = 1.0 halaman),
 * berdasarkan kepadatan ayat per halaman pada MUSHAF_604_PAGE_BOUNDARIES.
 * Ayat panjang (sedikit ayat/halaman) berbobot jauh lebih besar daripada ayat pendek.
 */
export function getVersePageWeight(surah: number, ayah: number): number {
  const key = `${surah}:${ayah}`;
  if (VERSE_PAGE_WEIGHT_CACHE.has(key)) return VERSE_PAGE_WEIGHT_CACHE.get(key)!;

  let totalWeight = 0;
  for (let p = 1; p <= 604; p++) {
    const b = MUSHAF_604_PAGE_BOUNDARIES[p];
    if (!b || !b.verses || b.verses.length === 0) continue;
    if (b.verses.some(v => v.surah === surah && v.ayah === ayah)) {
      totalWeight += 1 / b.verses.length;
    }
  }
  const w = totalWeight > 0 ? totalWeight : 0.05;
  VERSE_PAGE_WEIGHT_CACHE.set(key, w);
  return w;
}

const JUZ_AYAH_LIST_CACHE = new Map<number, JuzAyahRef[]>();

/**
 * Menghasilkan daftar seluruh ayat dalam satu juz secara berurutan sesuai Mushaf Madinah
 * beserta bobot panjang hafalannya (satuan halaman Mushaf Madinah).
 */
export function getJuzAyahList(juzNumber: number): JuzAyahRef[] {
  if (JUZ_AYAH_LIST_CACHE.has(juzNumber)) {
    return JUZ_AYAH_LIST_CACHE.get(juzNumber)!;
  }
  const b = JUZ_AYAH_BOUNDARIES[juzNumber];
  if (!b) return [];
  const list: JuzAyahRef[] = [];
  for (let s = b.startSurah; s <= b.endSurah; s++) {
    const maxA = SURAH_TOTAL_AYAHS[s] || 1;
    const fromA = s === b.startSurah ? b.startAyah : 1;
    const toA = s === b.endSurah ? b.endAyah : maxA;
    for (let a = fromA; a <= toA; a++) {
      list.push({
        surah: s,
        ayah: a,
        key: `${s}:${a}`,
        page: quranService.getAyahPage(s, a),
        pageWeight: getVersePageWeight(s, a)
      });
    }
  }
  JUZ_AYAH_LIST_CACHE.set(juzNumber, list);
  return list;
}

/**
 * Menentukan juz dari nomor halaman Mushaf Madinah (1..604).
 */
export function getJuzForPage(pageNumber: number): number {
  const clamped = Math.max(1, Math.min(604, pageNumber));
  for (let j = 30; j >= 1; j--) {
    if (clamped >= JUZ_START_PAGES[j]) return j;
  }
  return 1;
}

/**
 * Mengelompokkan halaman terurut menjadi segmen-segmen kontinu.
 */
export function buildSegmentsFromPages(pages: number[]): UASMaterialSegment[] {
  if (!pages || pages.length === 0) return [];
  const sorted = Array.from(new Set(pages.filter(p => p >= 1 && p <= 604))).sort((a, b) => a - b);
  if (sorted.length === 0) return [];

  const groups: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      groups[groups.length - 1].push(sorted[i]);
    } else {
      groups.push([sorted[i]]);
    }
  }

  return groups.map((grp, idx) => {
    const firstP = grp[0];
    const lastP = grp[grp.length - 1];
    const bFirst = MUSHAF_604_PAGE_BOUNDARIES[firstP];
    const bLast = MUSHAF_604_PAGE_BOUNDARIES[lastP];
    const startSurah = bFirst?.startSurah || 1;
    const startAyah = bFirst?.startAyah || 1;
    const endSurah = bLast?.endSurah || startSurah;
    const endAyah = bLast?.endAyah || startAyah;
    return {
      startSurah,
      startAyah,
      endSurah,
      endAyah,
      startPage: firstP,
      endPage: lastP,
      startSurahName: materialDetectionService.getSurahName(startSurah),
      endSurahName: materialDetectionService.getSurahName(endSurah),
      pages: grp,
      hasGap: idx > 0
    };
  });
}

/**
 * Membangun segmen-segmen kontinu berdasarkan indeks ayat dalam satu juz.
 */
function buildAyahSegments(juzAyahs: JuzAyahRef[], coveredIndices: number[]): UASMaterialSegment[] {
  if (coveredIndices.length === 0) return [];
  const groups: number[][] = [[coveredIndices[0]]];
  for (let i = 1; i < coveredIndices.length; i++) {
    if (coveredIndices[i] === coveredIndices[i - 1] + 1) {
      groups[groups.length - 1].push(coveredIndices[i]);
    } else {
      groups.push([coveredIndices[i]]);
    }
  }

  return groups.map((grp, idx) => {
    const first = juzAyahs[grp[0]];
    const last = juzAyahs[grp[grp.length - 1]];
    const pages = Array.from(new Set(grp.map(i => juzAyahs[i].page))).sort((a, b) => a - b);
    return {
      startSurah: first.surah,
      startAyah: first.ayah,
      endSurah: last.surah,
      endAyah: last.ayah,
      startPage: first.page,
      endPage: last.page,
      startSurahName: materialDetectionService.getSurahName(first.surah),
      endSurahName: materialDetectionService.getSurahName(last.surah),
      pages,
      hasGap: idx > 0
    };
  });
}

/**
 * Membangun daftar bagian materi per juz dan sesi UAS dari setoran sah semester berjalan
 * (`sabaq` / `ziyadah`, term.startDate <= date <= period.materialCutoffDate).
 *
 * Kebijakan akademik resmi:
 * 1. Juz penuh HANYA apabila 100% cakupan ayat juz telah disetorkan & kontinu (90%/95%/99% TIDAK penuh).
 * 2. Cakupan 50% s.d. < 100% merupakan materi parsial untuk sesi 4 soal (4x25 = 100 poin).
 * 3. Materi < 50% menjadi tambahan kecil (dapat digabung dengan sesi sebelumnya yang sah, atau needs_admin_decision jika berdiri sendiri).
 * 4. Halaman yang hanya disentuh sebagian TIDAK dianggap satu halaman penuh.
 * 5. Tidak menghitung ayat ganda akibat setoran tumpang tindih.
 * 6. Lompatan ayat/halaman disimpan sebagai segmen terpisah (hasGap=true, needs_review).
 */
export function analyzeStudentJuzPartsAndSessions(params: {
  studentId: string;
  periodId: string;
  term: Pick<AcademicTerm, 'startDate'>;
  period: Pick<ExamPeriod, 'materialCutoffDate'>;
  records: TahfidzRecord[];
  snapshotId?: string | null;
  existingParts?: ExamMaterialPart[];
}): StudentJuzAnalysisResult {
  const { studentId, periodId, term, period, records, snapshotId = null, existingParts = [] } = params;

  const relevantRecords = materialDetectionService.filterRelevantRecords(
    records,
    studentId,
    term.startDate,
    period.materialCutoffDate
  );

  if (relevantRecords.length === 0) {
    return {
      studentId,
      periodId,
      parts: [],
      sessions: [],
      hasUnverifiedGaps: false,
      needsAdminDecision: true,
      anomalies: [],
      summaryReason: 'Belum ditemukan setoran sabaq/ziyadah pada semester berjalan sampai cutoff.'
    };
  }

  // Kumpulkan himpunan unik ayat ("surah:ayah") — deduplikasi setoran tumpang tindih
  const coveredAyahSet = new Set<string>();
  const anomalies: string[] = [];
  const anomaliesByJuz = new Map<number, string[]>();

  const pushJuzAnomaly = (juzNum: number, msg: string) => {
    anomalies.push(msg);
    const list = anomaliesByJuz.get(juzNum) || [];
    list.push(msg);
    anomaliesByJuz.set(juzNum, list);
  };

  for (const r of relevantRecords) {
    const rawSurah = (r.surah || '').trim();
    const sNum = materialDetectionService.getSurahNumber(rawSurah);
    if (sNum === 1 && !rawSurah.toLowerCase().includes('fatihah')) {
      anomalies.push(`Surah tidak dikenali pada ${r.date} ("${r.surah}" ${r.ayahStart}-${r.ayahEnd})`);
      continue;
    }
    const maxAyah = SURAH_TOTAL_AYAHS[sNum] || 286;
    const startA = Math.max(1, r.ayahStart || 1);
    const endA = Math.max(1, r.ayahEnd || startA);
    const clampedPage = quranService.getAyahPage(sNum, Math.min(maxAyah, Math.max(1, startA)));
    const approxJuz = getJuzForPage(clampedPage);
    if (r.ayahStart > r.ayahEnd && r.ayahEnd > 0) {
      pushJuzAnomaly(approxJuz, `Ayat terbalik pada ${r.date} (${r.surah} ${r.ayahStart}-${r.ayahEnd})`);
      continue;
    }
    if (endA > maxAyah || startA > maxAyah) {
      pushJuzAnomaly(approxJuz, `Ayat melebihi batas ${r.surah} pada ${r.date} (${startA}-${endA} > maks ${maxAyah})`);
      continue;
    }
    for (let a = startA; a <= endA; a++) {
      coveredAyahSet.add(`${sNum}:${a}`);
    }
  }

  const existingByJuz = new Map<number, ExamMaterialPart>();
  existingParts.forEach(ep => existingByJuz.set(ep.juzNumber, ep));

  const parts: ExamMaterialPart[] = [];
  let orderCounter = 1;

  for (let juz = 1; juz <= 30; juz++) {
    const juzAyahs = getJuzAyahList(juz);
    if (juzAyahs.length === 0) continue;

    const coveredIndices: number[] = [];
    for (let idx = 0; idx < juzAyahs.length; idx++) {
      if (coveredAyahSet.has(juzAyahs[idx].key)) {
        coveredIndices.push(idx);
      }
    }
    if (coveredIndices.length === 0) continue;

    const totalAyahsInJuz = juzAyahs.length;
    const totalJuzWeight = juzAyahs.reduce((acc, item) => acc + item.pageWeight, 0);
    const coveredWeight = coveredIndices.reduce((acc, idx) => acc + juzAyahs[idx].pageWeight, 0);
    const lengthCoverageRatio = totalJuzWeight > 0
      ? Number((coveredWeight / totalJuzWeight).toFixed(4))
      : Number((coveredIndices.length / totalAyahsInJuz).toFixed(4));
    const segments = buildAyahSegments(juzAyahs, coveredIndices);
    const hasGap = segments.length > 1;

    // Halaman penuh: HANYA halaman di mana 100% ayat pada halaman tersebut disetorkan
    const touchedPages = Array.from(new Set(coveredIndices.map(i => juzAyahs[i].page))).sort((a, b) => a - b);
    const fullPages: number[] = [];
    for (const p of touchedPages) {
      const b = MUSHAF_604_PAGE_BOUNDARIES[p];
      if (!b || !b.verses || b.verses.length === 0) continue;
      const allVersesOnPageCovered = b.verses.every(v => coveredAyahSet.has(`${v.surah}:${v.ayah}`));
      if (allVersesOnPageCovered) {
        fullPages.push(p);
      }
    }

    const juzRange = JUZ_PAGE_RANGES[juz];
    // Strict 100% cakupan hafalan juz & kontinu -> full_juz
    let partType: UASMaterialPartType;
    if (coveredIndices.length === totalAyahsInJuz && !hasGap) {
      partType = 'full_juz';
    } else if (lengthCoverageRatio >= 0.5) {
      partType = 'partial_half';
    } else {
      partType = 'minor_addition';
    }

    const firstSeg = segments[0];
    const lastSeg = segments[segments.length - 1];
    const existing = existingByJuz.get(juz);
    const juzAnomalies = anomaliesByJuz.get(juz) || [];

    let status: UASMaterialPartStatus = existing?.status || 'ready';
    let reviewReason = existing?.reviewReason || null;
    if (!existing) {
      if (hasGap || juzAnomalies.length > 0) {
        status = 'needs_review';
        reviewReason = [
          hasGap
            ? `Terdapat ${segments.length} segmen tidak kontinu di Juz ${juz} (${coveredIndices.length}/${totalAyahsInJuz} ayat, ${fullPages.length} hal sah).`
            : '',
          ...juzAnomalies
        ]
          .filter(Boolean)
          .join(' ');
      } else if (partType === 'minor_addition') {
        status = 'ready';
        reviewReason = `Tambahan materi < 50% pada Juz ${juz} (${coveredWeight.toFixed(1)}/${totalJuzWeight.toFixed(1)} hal, ${(lengthCoverageRatio * 100).toFixed(1)}%).`;
      } else if (partType === 'partial_half') {
        reviewReason = `Materi parsial Juz ${juz}: ${coveredWeight.toFixed(1)}/${totalJuzWeight.toFixed(1)} hal (${(lengthCoverageRatio * 100).toFixed(1)}%, ${fullPages.length} hal sah).`;
      }
    }

    parts.push({
      id: existing?.id || `emp_${periodId}_${studentId}_j${juz}`,
      examPeriodId: periodId,
      studentId,
      snapshotId,
      partOrder: orderCounter++,
      juzNumber: juz,
      partType,
      startSurah: firstSeg.startSurah,
      startAyah: firstSeg.startAyah,
      endSurah: lastSeg.endSurah,
      endAyah: lastSeg.endAyah,
      startPage: firstSeg.startPage,
      endPage: lastSeg.endPage,
      startSurahName: firstSeg.startSurahName,
      endSurahName: lastSeg.endSurahName,
      coveredPages: fullPages,
      coveredPagesCount: fullPages.length,
      juzTotalPages: juzRange.totalPages,
      coverageRatio: lengthCoverageRatio,
      segments,
      hasGap,
      status,
      reviewReason,
      verifiedBy: existing?.verifiedBy || null,
      verifiedAt: existing?.verifiedAt || null,
      finalizedBy: existing?.finalizedBy || null,
      finalizedAt: existing?.finalizedAt || null
    });
  }

  // Bentuk Sesi UAS dari parts yang tidak excluded
  const activeParts = parts.filter(p => p.status !== 'excluded');
  const fullParts = activeParts.filter(p => p.partType === 'full_juz');
  const partialHalfParts = activeParts.filter(p => p.partType === 'partial_half');
  const minorParts = activeParts.filter(p => p.partType === 'minor_addition');

  const sessions: ExamUASSession[] = [];
  let sessionCounter = 1;

  // 1. Setiap juz penuh (100%) -> 1 sesi penuh (9 soal)
  // 2. Setiap juz parsial (50%..99%) -> 1 sesi parsial (4 soal)
  // Dua bagian 0,5 juz pada juz berbeda TETAP menjadi 2 sesi parsial terpisah!
  const sessionOwners = [...fullParts, ...partialHalfParts].sort((a, b) => a.partOrder - b.partOrder);
  for (const part of sessionOwners) {
    const validTouchedPages = Array.from(new Set(part.segments.flatMap(sg => sg.pages))).sort((a, b) => a - b);
    sessions.push({
      id: `uas_sess_${periodId}_${studentId}_s${sessionCounter}`,
      examPeriodId: periodId,
      studentId,
      sessionNumber: sessionCounter++,
      sessionType: part.partType === 'full_juz' ? 'full_juz' : 'partial_half',
      primaryPartId: part.id,
      juzNumber: part.juzNumber,
      supplementalParts: [],
      coveredPages: part.partType === 'full_juz' ? [...part.coveredPages] : validTouchedPages,
      startSurah: part.startSurah,
      startAyah: part.startAyah,
      endSurah: part.endSurah,
      endAyah: part.endAyah,
      startPage: part.startPage,
      endPage: part.endPage,
      startSurahName: part.startSurahName,
      endSurahName: part.endSurahName,
      status: 'planned'
    });
  }

  // 3. Tangani tambahan < 50% (minor_addition)
  let needsAdminDecision = false;
  if (minorParts.length > 0) {
    if (sessions.length > 0) {
      // Kebijakan: materi < 50% menjadi tambahan kecil yang digabung ke sesi sebelumnya yang memenuhi syarat
      // (tetap tercatat terpisah di supplementalParts, dan TIDAK mengubah sesi menjadi penuh jika bukan 100%)
      const targetSession = sessions[sessions.length - 1];
      targetSession.supplementalParts.push(...minorParts);
    } else {
      // Tidak ada sesi sebelumnya yang memenuhi syarat -> wajib needs_admin_decision
      needsAdminDecision = true;
      parts.forEach(p => {
        if (p.status === 'ready') {
          p.status = 'needs_admin_decision';
          p.reviewReason = `Cakupan materi < 50% per juz (${(p.coverageRatio * 100).toFixed(1)}%) tanpa sesi juz penuh/parsial sebelumnya. Memerlukan keputusan Admin.`;
        }
      });
    }
  }

  const hasUnverifiedGaps = parts.some(p => p.status === 'needs_review');
  let summaryReason = `${sessions.length} sesi UAS (${sessions.filter(s => s.sessionType === 'full_juz').length} penuh 9 soal, ${sessions.filter(s => s.sessionType === 'partial_half').length} parsial 4 soal).`;
  if (needsAdminDecision) {
    summaryReason = `Total materi baru < 50% per juz tanpa sesi sebelumnya yang memenuhi syarat. Perlu keputusan Admin.`;
  } else if (hasUnverifiedGaps) {
    summaryReason += ' Terdapat segmen tidak kontinu yang wajib diverifikasi Admin.';
  }

  return {
    studentId,
    periodId,
    parts,
    sessions,
    hasUnverifiedGaps,
    needsAdminDecision,
    anomalies,
    summaryReason
  };
}

/**
 * Menghitung cakupan Mushaf Madinah secara presisi untuk input manual Guru Halaqah
 * berdasarkan batas surah/ayat utama dan segmen tambahan opsional.
 */
export function computeManualJuzPartCoverage(params: {
  juzNumber: number;
  ranges: Array<{ startSurah: number; startAyah: number; endSurah: number; endAyah: number }>;
}): {
  startSurah: number;
  startAyah: number;
  endSurah: number;
  endAyah: number;
  startPage: number;
  endPage: number;
  coveredPages: number[];
  coveredPagesCount: number;
  juzTotalPages: number;
  coverageRatio: number;
  partType: UASMaterialPartType;
  segments: UASMaterialSegment[];
  hasGap: boolean;
} {
  const { juzNumber, ranges } = params;
  const juzAyahs = getJuzAyahList(juzNumber);
  const juzTotalWeight = juzAyahs.reduce((sum, a) => sum + a.pageWeight, 0) || 1;
  const juzPageRange = JUZ_PAGE_RANGES[juzNumber] || { startPage: 1, endPage: 20, totalPages: 20 };

  const inRange = (s: number, a: number, r: { startSurah: number; startAyah: number; endSurah: number; endAyah: number }) => {
    const pos = s * 1000 + a;
    const lo = r.startSurah * 1000 + r.startAyah;
    const hi = r.endSurah * 1000 + r.endAyah;
    return pos >= lo && pos <= hi;
  };

  const matched = juzAyahs.filter(ay => ranges.some(r => inRange(ay.surah, ay.ayah, r)));
  if (matched.length === 0) {
    return {
      startSurah: ranges[0]?.startSurah || 1,
      startAyah: ranges[0]?.startAyah || 1,
      endSurah: ranges[0]?.endSurah || 1,
      endAyah: ranges[0]?.endAyah || 1,
      startPage: juzPageRange.startPage,
      endPage: juzPageRange.startPage,
      coveredPages: [],
      coveredPagesCount: 0,
      juzTotalPages: juzPageRange.totalPages,
      coverageRatio: 0,
      partType: 'minor_addition',
      segments: [],
      hasGap: false
    };
  }

  const coveredWeight = matched.reduce((sum, a) => sum + a.pageWeight, 0);
  const coverageRatio = Math.min(1, Number((coveredWeight / juzTotalWeight).toFixed(4)));
  const isFull = matched.length === juzAyahs.length;
  const coveredPages = Array.from(new Set(matched.map(m => m.page))).sort((a, b) => a - b);
  const segments = buildSegmentsFromPages(coveredPages);
  const hasGap = segments.length > 1;
  const partType: UASMaterialPartType = isFull
    ? 'full_juz'
    : coverageRatio >= 0.5
      ? 'partial_half'
      : 'minor_addition';

  const first = matched[0];
  const last = matched[matched.length - 1];
  return {
    startSurah: first.surah,
    startAyah: first.ayah,
    endSurah: last.surah,
    endAyah: last.ayah,
    startPage: first.page,
    endPage: last.page,
    coveredPages,
    coveredPagesCount: coveredPages.length,
    juzTotalPages: juzPageRange.totalPages,
    coverageRatio,
    partType,
    segments,
    hasGap
  };
}
