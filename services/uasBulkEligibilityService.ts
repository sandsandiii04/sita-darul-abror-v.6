import { ExamParticipant, ExamMaterialSnapshot, QuestionBankItem, ExamMaterialPart, ExamUASSession, UASSessionBankDiagnostic } from '../types';
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
  diagnostic?: UASSessionBankDiagnostic;
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

  if (primaryPart && primaryPart.status !== 'finalized' && session.approvalStatus !== 'admin_approved') {
    return {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      sessionType: session.sessionType,
      juzNumber: session.juzNumber,
      status: 'MENUNGGU_PERSETUJUAN_ADMIN',
      reason: `Menunggu Persetujuan Admin (Juz ${session.juzNumber}).`,
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

  const { diagnostic, path } = uasQuestionGenerator.evaluateSessionBankCoverage(session, bankQuestions);
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
      fullPagesCount,
      diagnostic
    };
  }

  const { missingZones, coveredZones } = diagnostic;

  if (missingZones.length > 0) {
    return {
      sessionId: session.id,
      sessionNumber: session.sessionNumber,
      sessionType: session.sessionType,
      juzNumber: session.juzNumber,
      status: 'BANK_SOAL_KURANG',
      reason: `Sesi ${session.sessionNumber} (Juz ${session.juzNumber}, ${isPartial ? 'Parsial' : 'Juz Penuh'}): butuh ${requiredZones} soal acak, tersedia ${coveredZones} zona valid (kurang ${missingZones.length} soal — Zona ${missingZones.join(', Zona ')}).`,
      requiredZones,
      coveredZones,
      missingZones,
      fullPagesCount,
      diagnostic
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
    fullPagesCount,
    diagnostic
  };
}

export type UASEligibilityStatus =
  | 'SIAP_GENERATE'
  | 'SUDAH_ADA'
  | 'MENUNGGU_PERSETUJUAN_ADMIN'
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
  sessionEligibilities?: UASSessionEligibilityResult[];
}

export interface UASSessionSummaryStats {
  totalActiveSessions: number;
  readySessions: number;
  readyFullSessions: number;
  readyPartialSessions: number;
  waitingAdminSessions: number;
  bankShortSessions: number;
  alreadyHaveSessions: number;
  staleSessions: number;
  otherUnreadySessions: number;
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
  sessionStats?: UASSessionSummaryStats;
}

export const UAS_ELIGIBILITY_LABELS: Record<UASEligibilityStatus, string> = {
  SIAP_GENERATE: 'Siap Disiapkan',
  SUDAH_ADA: 'Sudah Ada Paket',
  MENUNGGU_PERSETUJUAN_ADMIN: 'Menunggu Admin',
  MATERI_BELUM_FINAL: 'Materi Belum Final',
  MATERI_PERLU_REVIEW: 'Perlu Review',
  MATERI_TIDAK_CUKUP: 'Materi Tidak Cukup',
  BANK_SOAL_KURANG: 'Bank Soal Belum Cukup',
  STALE: 'Paket Usang (Stale)'
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

/**
 * Evaluasi kelayakan generate soal UAS berbasis Sesi Per-Juz & Persetujuan Admin.
 * - Sesi Full Juz: 7 soal acak Bank Soal (10 poin) + 2 wajib manual oleh penguji saat ujian (15 poin).
 * - Sesi Parsial: 4 soal acak Bank Soal (25 poin), tanpa soal wajib.
 * - Sesi/materi yang belum disetujui Admin berstatus MENUNGGU_PERSETUJUAN_ADMIN.
 */
export function evaluateUASMultiSessionEligibility(params: {
  participants: ExamParticipant[];
  parts: ExamMaterialPart[];
  sessions: ExamUASSession[];
  submissions: Array<{ studentId: string; status: string }>;
  snapshots: ExamMaterialSnapshot[];
  bankQuestions: QuestionBankItem[];
  classFilter?: string;
  halaqahFilter?: string;
}): UASEligibilitySummary {
  const {
    participants,
    parts,
    sessions,
    submissions,
    snapshots,
    bankQuestions,
    classFilter = 'all',
    halaqahFilter = 'all'
  } = params;

  const filteredParticipants = participants.filter(p => {
    if (classFilter !== 'all' && p.class !== classFilter) return false;
    if (halaqahFilter !== 'all' && p.halaqah !== halaqahFilter) return false;
    return true;
  });

  const snapMap = new Map<string, ExamMaterialSnapshot>();
  snapshots.forEach(s => snapMap.set(s.studentId, s));

  const subMap = new Map<string, string>();
  submissions.forEach(s => subMap.set(s.studentId, s.status));

  const partsByStudent = new Map<string, ExamMaterialPart[]>();
  parts.forEach(pt => {
    const arr = partsByStudent.get(pt.studentId) || [];
    arr.push(pt);
    partsByStudent.set(pt.studentId, arr);
  });

  const sessionsByStudent = new Map<string, ExamUASSession[]>();
  sessions.forEach(s => {
    if (!s || s.status === 'void') return;
    const arr = sessionsByStudent.get(s.studentId) || [];
    arr.push(s);
    sessionsByStudent.set(s.studentId, arr);
  });

  const items: UASEligibilityItem[] = [];
  let siapGenerate = 0;
  let sudahAda = 0;
  let materiBelumFinal = 0;
  let materiPerluReview = 0;
  let materiTidakCukup = 0;
  let bankSoalKurang = 0;
  let stale = 0;

  const sessionStats: UASSessionSummaryStats = {
    totalActiveSessions: 0,
    readySessions: 0,
    readyFullSessions: 0,
    readyPartialSessions: 0,
    waitingAdminSessions: 0,
    bankShortSessions: 0,
    alreadyHaveSessions: 0,
    staleSessions: 0,
    otherUnreadySessions: 0
  };

  for (const p of filteredParticipants) {
    const snap = snapMap.get(p.studentId);
    const subStatus = subMap.get(p.studentId);
    const stParts = partsByStudent.get(p.studentId) || [];
    const stSessions = (sessionsByStudent.get(p.studentId) || []).sort((a, b) => a.sessionNumber - b.sessionNumber);
    const estPages = stParts.reduce((acc, pt) => acc + (pt.coveredPagesCount || 0), 0) || snap?.estimatedPages || 0;

    sessionStats.totalActiveSessions += stSessions.length;

    let status: UASEligibilityStatus;
    let reason: string;
    let coveredRandomZones = 0;
    let sessionEligibilities: UASSessionEligibilityResult[] = [];

    if (subStatus !== 'admin_approved') {
      status = 'MENUNGGU_PERSETUJUAN_ADMIN';
      reason = subStatus === 'pending_admin_approval'
        ? 'Menunggu Persetujuan Admin'
        : subStatus === 'needs_correction' || subStatus === 'rejected'
          ? 'Perlu Koreksi Guru sebelum Persetujuan Admin'
          : subStatus === 'stale'
            ? 'Materi berubah (STALE) — Menunggu pengajuan ulang & Persetujuan Admin'
            : 'Menunggu Persetujuan Admin (Guru Halaqah belum mengirim/disetujui)';
      materiBelumFinal++;
      stSessions.forEach(sess => {
        if (sess.questionSetId) sessionStats.alreadyHaveSessions++;
        else sessionStats.waitingAdminSessions++;
      });
    } else if (stSessions.length === 0) {
      status = 'MATERI_TIDAK_CUKUP';
      reason = 'Belum ada sesi UAS yang disusun untuk santri ini.';
      materiTidakCukup++;
    } else {
      sessionEligibilities = stSessions.map(sess => {
        const primaryPart = stParts.find(pt => pt.id === sess.primaryPartId) || null;
        return evaluateUASSessionEligibility({ session: sess, primaryPart, bankQuestions });
      });

      sessionEligibilities.forEach(se => {
        if (se.status === 'SIAP_GENERATE') {
          sessionStats.readySessions++;
          if (se.sessionType === 'full_juz') sessionStats.readyFullSessions++;
          else sessionStats.readyPartialSessions++;
        } else if (se.status === 'SUDAH_ADA') {
          sessionStats.alreadyHaveSessions++;
        } else if (se.status === 'BANK_SOAL_KURANG') {
          sessionStats.bankShortSessions++;
        } else if (se.status === 'MENUNGGU_PERSETUJUAN_ADMIN') {
          sessionStats.waitingAdminSessions++;
        } else if (se.status === 'STALE') {
          sessionStats.staleSessions++;
        } else {
          sessionStats.otherUnreadySessions++;
        }
      });

      coveredRandomZones = sessionEligibilities.reduce((acc, se) => acc + se.coveredZones, 0);

      const hasStale = sessionEligibilities.some(se => se.status === 'STALE');
      const hasBankKurang = sessionEligibilities.filter(se => se.status === 'BANK_SOAL_KURANG');
      const hasUnready = sessionEligibilities.filter(se => se.status !== 'SIAP_GENERATE' && se.status !== 'SUDAH_ADA');
      const allDone = sessionEligibilities.every(se => se.status === 'SUDAH_ADA');
      const anyReady = sessionEligibilities.some(se => se.status === 'SIAP_GENERATE');

      if (allDone) {
        status = 'SUDAH_ADA';
        reason = `Seluruh ${stSessions.length} sesi UAS sudah memiliki paket soal.`;
        sudahAda++;
      } else if (hasStale) {
        status = 'STALE';
        reason = 'Ada sesi dengan paket STALE yang perlu ditinjau.';
        stale++;
      } else if (hasBankKurang.length > 0) {
        status = 'BANK_SOAL_KURANG';
        reason = hasBankKurang.map(b => b.reason).join(' | ');
        bankSoalKurang++;
      } else if (anyReady) {
        status = 'SIAP_GENERATE';
        const readyList = sessionEligibilities.filter(se => se.status === 'SIAP_GENERATE');
        reason = `Siap generate ${readyList.length} sesi: ${readyList.map(se => `Sesi ${se.sessionNumber} Juz ${se.juzNumber} (${se.sessionType === 'partial_half' ? '4 soal acak' : '7 soal acak + 2 wajib manual'})`).join(', ')}.`;
        siapGenerate++;
      } else {
        const first = hasUnready[0];
        status = first?.status || 'MATERI_BELUM_FINAL';
        reason = first?.reason || 'Menunggu Persetujuan Admin';
        if (status === 'MATERI_PERLU_REVIEW') materiPerluReview++;
        else if (status === 'MATERI_TIDAK_CUKUP') materiTidakCukup++;
        else materiBelumFinal++;
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
      fullPagesInMaterial: estPages,
      coveredRandomZones,
      snapshot: snap,
      sessionEligibilities
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
    items,
    sessionStats
  };
}
