import { ExamParticipant, ExamMaterialSnapshot, QuestionBankItem } from '../types';
import { uasQuestionGenerator } from './uasQuestionGenerator';
import { comparePositions } from './quranService';
import { MUSHAF_604_PAGE_BOUNDARIES } from '../constants/mushafPageBoundaries';

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
  mandatoryMatchCount: number;
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
 * Evaluasi kelayakan pembuatan paket 9 soal UAS secara Read-Only (DB Delta = 0).
 * Memisahkan MATERI_TIDAK_CUKUP (termasuk rentang parsial < 2 halaman penuh) dari BANK_SOAL_KURANG.
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

  const activeMandatoryBank = (bankQuestions || []).filter(
    q =>
      q.status === 'active' &&
      (q.questionType === 'mandatory' || q.questionFormat === 'full_page') &&
      q.pageNumber &&
      q.pageNumber >= 1 &&
      q.pageNumber <= 604
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
    let mandatoryMatchCount = 0;

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
        reason = `Paket 9 soal v${qInfo.version} sudah tersimpan dan tidak akan ditimpa.`;
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
          reason = `Belum Memenuhi Syarat Materi UAS: Rentang ${estPages} halaman parsial hanya memuat ${fullPagesInMaterial} halaman mushaf penuh (dibutuhkan minimal 2 halaman penuh untuk soal wajib full_page).`;
          materiTidakCukup++;
        } else {
          const fullPageSet = new Set(fullPages);
          const matched = activeMandatoryBank.filter(q => q.pageNumber && fullPageSet.has(q.pageNumber));
          mandatoryMatchCount = matched.length;

          if (mandatoryMatchCount < 2) {
            status = 'BANK_SOAL_KURANG';
            reason = `Materi memiliki ${fullPagesInMaterial} halaman penuh yang sah, namun Bank Soal wajib full_page baru tersedia ${mandatoryMatchCount}/2 di rentang ini.`;
            bankSoalKurang++;
          } else {
            status = 'SIAP_GENERATE';
            reason = `Memenuhi syarat (${estPages} hal, ${fullPagesInMaterial} hal penuh, ${mandatoryMatchCount} soal wajib tersedia di Bank Soal).`;
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
      mandatoryMatchCount,
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
