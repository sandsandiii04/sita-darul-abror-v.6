import { ExamParticipant, ExamMaterialSnapshot, QuestionBankItem, ExamMaterialPart, ExamUASSession } from '../types';
import { uasQuestionGenerator } from './uasQuestionGenerator';
import { comparePositions } from './quranService';
import { MUSHAF_604_PAGE_BOUNDARIES } from '../constants/mushafPageBoundaries';

export interface UASSessionEligibilityResult {
  sessionId: string;
  sessionNumber: number;
  sessionType: 'full_juz' | 'partial_half';
  juzNumber: number;
  status: UASEligibilityStatus;
  reason: string;
  requiredZones: 4 | 7;
  coveredZones: number;
  missingZones: number[];
  fullPagesCount: number;
}

/**
 * Evaluasi kelayakan satu sesi UAS (Penuh 9 soal / Setengah Juz 4 soal)
 * terhadap daftar bagian materi & Bank Soal aktif.
 */
export function evaluateUASSessionEligibility(params: {
  session: ExamUASSession;
  primaryPart?: ExamMaterialPart | null;
  bankQuestions: QuestionBankItem[];
}): UASSessionEligibilityResult {
  const { session, primaryPart, bankQuestions } = params;
  const isPartial = session.sessionType === 'partial_half';
  const requiredZones: 4 | 7 = isPartial ? 4 : 7;

  if (primaryPart?.status === 'needs_admin_decision') {
    return {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      sessionType: session.sessionType,
      juzNumber: session.juzNumber,
      status: 'MATERI_TIDAK_CUKUP',
      reason: primaryPart.reviewReason || 'Materi kurang dari setengah juz; memerlukan keputusan Admin.',
      requiredZones,
      coveredZones: 0,
      missingZones: Array.from({ length: requiredZones }, (_, i) => i + 1),
      fullPagesCount: 0
    };
  }

  if (primaryPart?.status === 'needs_review') {
    return {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      sessionType: session.sessionType,
      juzNumber: session.juzNumber,
      status: 'MATERI_PERLU_REVIEW',
      reason: primaryPart.reviewReason || 'Terdapat lompatan/ketidak-kontinuan yang wajib diverifikasi Admin.',
      requiredZones,
      coveredZones: 0,
      missingZones: Array.from({ length: requiredZones }, (_, i) => i + 1),
      fullPagesCount: 0
    };
  }

  if (primaryPart && primaryPart.status !== 'finalized') {
    return {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      sessionType: session.sessionType,
      juzNumber: session.juzNumber,
      status: 'MATERI_BELUM_FINAL',
      reason: `Bagian Juz ${session.juzNumber} belum difinalisasi Admin.`,
      requiredZones,
      coveredZones: 0,
      missingZones: Array.from({ length: requiredZones }, (_, i) => i + 1),
      fullPagesCount: 0
    };
  }

  if (session.questionSetId) {
    return {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      sessionType: session.sessionType,
      juzNumber: session.juzNumber,
      status: session.questionSetStatus === 'stale' ? 'STALE' : 'SUDAH_ADA',
      reason: session.questionSetStatus === 'stale'
        ? `Paket Sesi ${session.sessionNumber} berstatus STALE.`
        : `Paket Sesi ${session.sessionNumber} (${isPartial ? '4 soal' : '7 draft + 2 wajib'}) sudah tersedia.`,
      requiredZones,
      coveredZones: requiredZones,
      missingZones: [],
      fullPagesCount: session.coveredPages.length
    };
  }

  const coveredSet = new Set(session.coveredPages || []);
  const fullPagesCount = session.coveredPages.filter(p => Boolean(MUSHAF_604_PAGE_BOUNDARIES[p])).length;
  if (!isPartial && fullPagesCount < 2) {
    return {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      sessionType: session.sessionType,
      juzNumber: session.juzNumber,
      status: 'MATERI_TIDAK_CUKUP',
      reason: `Sesi penuh membutuhkan minimal 2 halaman penuh (tersedia ${fullPagesCount}).`,
      requiredZones,
      coveredZones: 0,
      missingZones: [1, 2, 3, 4, 5, 6, 7],
      fullPagesCount
    };
  }

  const path = uasQuestionGenerator.buildMaterialPathForCoveredPages(session.coveredPages);
  if (path.nodes.length < requiredZones) {
    return {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      sessionType: session.sessionType,
      juzNumber: session.juzNumber,
      status: 'MATERI_TIDAK_CUKUP',
      reason: `Cakupan ayat (${path.nodes.length}) kurang untuk ${requiredZones} zona.`,
      requiredZones,
      coveredZones: 0,
      missingZones: Array.from({ length: requiredZones }, (_, i) => i + 1),
      fullPagesCount
    };
  }

  const zones = uasQuestionGenerator.divideIntoZonesCount(path, requiredZones);
  const activeRandomBank = (bankQuestions || []).filter(
    q =>
      q.status === 'active' &&
      q.questionType === 'random' &&
      (q.examType === 'uas' || q.examType === 'generic') &&
      q.promptStart && q.promptEnd && q.answerStart && q.answerEnd &&
      comparePositions(q.promptStart, q.promptEnd) <= 0 &&
      comparePositions(q.promptEnd, q.answerStart) < 0 &&
      comparePositions(q.answerStart, q.answerEnd) <= 0
  );

  const missingZones: number[] = [];
  let coveredZones = 0;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const ok = activeRandomBank.some(bq =>
      coveredSet.has(bq.startPage) &&
      coveredSet.has(bq.endPage) &&
      z.nodes.some(n => n.surahNumber === bq.answerStart.surahNumber && n.ayahNumber === bq.answerStart.ayahNumber)
    );
    if (ok) coveredZones++;
    else missingZones.push(i + 1);
  }

  if (missingZones.length > 0) {
    return {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      sessionType: session.sessionType,
      juzNumber: session.juzNumber,
      status: 'BANK_SOAL_KURANG',
      reason: `Bank Soal Sesi ${session.sessionNumber} (Juz ${session.juzNumber}) kurang pada zona: ${missingZones.join(', ')}.`,
      requiredZones,
      coveredZones,
      missingZones,
      fullPagesCount
    };
  }

  return {
    sessionId: session.id,
    sessionNumber: session.sessionNumber,
    sessionType: session.sessionType,
    juzNumber: session.juzNumber,
    status: 'SIAP_GENERATE',
    reason: `Siap generate Sesi ${session.sessionNumber} (${isPartial ? '4/4 zona x 25 poin' : '7/7 zona + 2 wajib'}).`,
    requiredZones,
    coveredZones,
    missingZones: [],
    fullPagesCount
  };
}

export type UASEligibilityStatus =
  | 'SIAP_GENERATE'
  | 'SUDAH_ADA'
  | 'MATERI_BELUM_FINAL'
  | 'MATERI_PERLU_REVIEW'
  | 'MATERI_TIDAK_CUKUP'
  | 'BANK_SOAL_KURANG'
  | 'STALE';

export interface UASEligibilityItem {
  studentId: string;
  studentName: string;
  studentClass: string;
  halaqah: string;
  status: UASEligibilityStatus;
  statusLabel: string;
  reason: string;
  estimatedPages: number;
  fullPagesInMaterial: number;
  coveredRandomZones: number;
  questionSetVersion?: number;
  snapshot?: ExamMaterialSnapshot;
}

export interface UASEligibilitySummary {
  total: number;
  siapGenerate: number;
  sudahAda: number;
  materiBelumFinal: number;
  materiPerluReview: number;
  materiTidakCukup: number;
  bankSoalKurang: number;
  stale: number;
  items: UASEligibilityItem[];
}

export const UAS_ELIGIBILITY_LABELS: Record<UASEligibilityStatus, string> = {
  SIAP_GENERATE: 'SIAP_GENERATE',
  SUDAH_ADA: 'SUDAH_ADA',
  MATERI_BELUM_FINAL: 'MATERI_BELUM_FINAL',
  MATERI_PERLU_REVIEW: 'MATERI_PERLU_REVIEW',
  MATERI_TIDAK_CUKUP: 'MATERI_TIDAK_CUKUP',
  BANK_SOAL_KURANG: 'BANK_SOAL_KURANG',
  STALE: 'STALE'
};

/**
 * Hitung daftar halaman Mushaf Madinah penuh (100% utuh dari kata awal hingga kata akhir halaman)
 * yang berada di dalam rentang materi santri.
 */
export function getFullMushafPagesInSnapshot(snap: ExamMaterialSnapshot, pathPages: number[]): number[] {
  const minPos = { surahNumber: snap.startSurah, ayahNumber: snap.startAyah, wordPosition: 1, pageNumber: snap.startPage };
  const maxPos = { surahNumber: snap.endSurah, ayahNumber: snap.endAyah, wordPosition: 999, pageNumber: snap.endPage };
  const loPos = comparePositions(minPos, maxPos) <= 0 ? minPos : maxPos;
  const hiPos = comparePositions(minPos, maxPos) <= 0 ? maxPos : minPos;

  const fullPages: number[] = [];
  for (const p of pathPages) {
    const b = MUSHAF_604_PAGE_BOUNDARIES[p];
    if (!b) continue;
    const pStart = { surahNumber: b.startSurah, ayahNumber: b.startAyah, wordPosition: b.startWord || 1, pageNumber: p };
    const pEnd = { surahNumber: b.endSurah, ayahNumber: b.endAyah, wordPosition: b.endWord || 1, pageNumber: p };
    if (comparePositions(pStart, loPos) >= 0 && comparePositions(pEnd, hiPos) <= 0) {
      fullPages.push(p);
    }
  }
  return fullPages;
}

/**
 * Evaluasi kelayakan pembuatan draft 7 soal acak UAS dari Bank Soal (Read-Only, DB Delta = 0).
 * 2 soal wajib halaman penuh dipilih manual oleh penguji saat pelaksanaan ujian.
 */
export function evaluateUASEligibility(params: {
  participants: ExamParticipant[];
  snapshots: ExamMaterialSnapshot[];
  questionSetMap: Map<string, { status: string; version: number; id: string }>;
  bankQuestions: QuestionBankItem[];
  classFilter?: string;
  halaqahFilter?: string;
}): UASEligibilitySummary {
  const {
    participants,
    snapshots,
    questionSetMap,
    bankQuestions,
    classFilter = 'all',
    halaqahFilter = 'all'
  } = params;

  const filteredParticipants = participants.filter(p => {
    if (classFilter !== 'all' && p.class !== classFilter) return false;
    if (halaqahFilter !== 'all' && p.halaqah !== halaqahFilter) return false;
    return true;
  });

  const snapshotMap = new Map<string, ExamMaterialSnapshot>();
  snapshots.forEach(s => snapshotMap.set(s.studentId, s));

  const activeRandomBank = (bankQuestions || []).filter(
    q =>
      q.status === 'active' &&
      q.questionType === 'random' &&
      (q.examType === 'uas' || q.examType === 'generic') &&
      q.promptStart &&
      q.promptEnd &&
      q.answerStart &&
      q.answerEnd &&
      comparePositions(q.promptStart, q.promptEnd) <= 0 &&
      comparePositions(q.promptEnd, q.answerStart) < 0 &&
      comparePositions(q.answerStart, q.answerEnd) <= 0
  );

  const items: UASEligibilityItem[] = [];
  let siapGenerate = 0;
  let sudahAda = 0;
  let materiBelumFinal = 0;
  let materiPerluReview = 0;
  let materiTidakCukup = 0;
  let bankSoalKurang = 0;
  let stale = 0;

  for (const p of filteredParticipants) {
    const snap = snapshotMap.get(p.studentId);
    const qInfo = questionSetMap.get(p.studentId);
    const estPages = snap?.estimatedPages || 0;

    let status: UASEligibilityStatus;
    let reason: string;
    let fullPagesInMaterial = 0;
    let coveredRandomZones = 0;

    if (!snap || snap.status === 'not_ready' || snap.totalRecordsAnalyzed === 0) {
      status = 'MATERI_TIDAK_CUKUP';
      reason = 'Belum Memenuhi Syarat Materi UAS: Belum ditemukan setoran sabaq/ziyadah semester berjalan.';
      materiTidakCukup++;
    } else if (snap.status === 'needs_review') {
      status = 'MATERI_PERLU_REVIEW';
      reason = `Perlu verifikasi Admin sebelum finalisasi (${snap.reviewReason || 'terdeteksi lompatan/anomali'}).`;
      materiPerluReview++;
    } else if (snap.status !== 'finalized') {
      status = 'MATERI_BELUM_FINAL';
      reason = 'Snapshot materi berstatus siap, namun belum difinalisasi Admin.';
      materiBelumFinal++;
    } else if (qInfo) {
      if (qInfo.status === 'stale') {
        status = 'STALE';
        reason = 'Materi berubah setelah paket dibuat; paket lama berstatus STALE dan perlu ditinjau.';
        stale++;
      } else {
        status = 'SUDAH_ADA';
        reason = qInfo.status === 'pending_mandatory'
          ? `Draft 7 soal acak v${qInfo.version} sudah siap (menunggu pilihan manual 2 soal wajib oleh penguji).`
          : `Paket 9 soal v${qInfo.version} sudah terkunci dan tidak akan ditimpa.`;
        sudahAda++;
      }
    } else if (estPages < 2) {
      status = 'MATERI_TIDAK_CUKUP';
      reason = `Belum Memenuhi Syarat Materi UAS: Hafalan baru semester ini hanya ${estPages} halaman (minimal 2 halaman penuh).`;
      materiTidakCukup++;
    } else {
      try {
        const path = uasQuestionGenerator.buildMaterialPath(snap);
        const pathPages = Array.from(new Set(path.nodes.map(n => n.pageNumber)));
        const fullPages = getFullMushafPagesInSnapshot(snap, pathPages);
        fullPagesInMaterial = fullPages.length;

        if (pathPages.length < 2 || path.nodes.length < 7) {
          status = 'MATERI_TIDAK_CUKUP';
          reason = `Belum Memenuhi Syarat Materi UAS: Cakupan terlalu sempit (${pathPages.length} halaman, ${path.nodes.length} ayat) untuk 7 zona acak.`;
          materiTidakCukup++;
        } else if (fullPagesInMaterial < 2) {
          status = 'MATERI_TIDAK_CUKUP';
          reason = `Belum Memenuhi Syarat Materi UAS: Rentang ${estPages} halaman parsial hanya memuat ${fullPagesInMaterial} halaman mushaf penuh (dibutuhkan minimal 2 halaman penuh untuk pilihan wajib penguji).`;
          materiTidakCukup++;
        } else {
          const zones = uasQuestionGenerator.divideIntoZones(path);
          const minPos = { surahNumber: snap.startSurah, ayahNumber: snap.startAyah, wordPosition: 1, pageNumber: snap.startPage };
          const maxPos = { surahNumber: snap.endSurah, ayahNumber: snap.endAyah, wordPosition: 999, pageNumber: snap.endPage };
          const loPos = comparePositions(minPos, maxPos) <= 0 ? minPos : maxPos;
          const hiPos = comparePositions(minPos, maxPos) <= 0 ? maxPos : minPos;

          const missingZones: number[] = [];
          for (let z = 0; z < zones.length; z++) {
            const zone = zones[z];
            const hasCandidate = activeRandomBank.some(bq => {
              if (comparePositions(bq.promptStart, loPos) < 0 || comparePositions(bq.answerEnd, hiPos) > 0) return false;
              return zone.nodes.some(n => n.surahNumber === bq.answerStart.surahNumber && n.ayahNumber === bq.answerStart.ayahNumber);
            });
            if (hasCandidate) coveredRandomZones++;
            else missingZones.push(z + 1);
          }

          if (zones.length !== 7 || missingZones.length > 0) {
            status = 'BANK_SOAL_KURANG';
            reason = `Bank Soal UAS belum mencukupi untuk materi/zona santri ini (zona kosong: ${missingZones.join(', ')}).`;
            bankSoalKurang++;
          } else {
            status = 'SIAP_GENERATE';
            reason = `Memenuhi syarat (${estPages} hal, ${fullPagesInMaterial} hal penuh untuk pilihan wajib, 7/7 zona Bank Soal acak tersedia).`;
            siapGenerate++;
          }
        }
      } catch (err: any) {
        status = 'MATERI_PERLU_REVIEW';
        reason = err?.message || 'Rentang materi perlu ditinjau karena tidak dapat dipetakan ke jalur mushaf.';
        materiPerluReview++;
      }
    }

    items.push({
      studentId: p.studentId,
      studentName: p.studentName,
      studentClass: p.class,
      halaqah: p.halaqah || '-',
      status,
      statusLabel: UAS_ELIGIBILITY_LABELS[status],
      reason,
      estimatedPages: estPages,
      fullPagesInMaterial,
      coveredRandomZones,
      questionSetVersion: qInfo?.version,
      snapshot: snap
    });
  }

  return {
    total: filteredParticipants.length,
    siapGenerate,
    sudahAda,
    materiBelumFinal,
    materiPerluReview,
    materiTidakCukup,
    bankSoalKurang,
    stale,
    items
  };
}
