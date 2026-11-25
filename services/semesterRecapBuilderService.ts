// services/semesterRecapBuilderService.ts
// Layanan Otoritatif Rekap Semester & Rekap Final Tahfiz (Lintas-Term & Multi-Sesi UAS)
// SITA — Darul Abror Islamic Boarding School

import {
  AcademicTerm,
  ComponentExamStatus,
  EffectiveScoreSource,
  EvaluationTimelineEvent,
  ExamPeriod,
  ExaminerStudentItem,
  FinalComponentStatus,
  FinalSemesterMonitoringStats,
  FinalSemesterRecapItem,
  FinalSemesterRecapResponse,
  FinalSemesterStatus,
  RemedialCandidateItem,
  RemedialCandidatesResponse,
  RemedialExaminerStudentItem,
  RemedialSessionStatus,
  SemesterEvaluationConfig,
  SemesterRecapResponse,
  SemesterRecapStatus,
  SemesterRecapSummary,
  SemesterRemedialCandidate,
  SemesterStudentRecap,
  StudentEvaluationHistoryResponse
} from '../types';
import { computeStudentUASRecapSummary, UASRecapSessionLike } from './examRecapExportService';
import { getSessionExaminers } from './uasExaminerDisplay';

const JUNK_TERM_ID_REGEX = /^(live_|debug_|test_term|term_test|term_s\d|term_supp|term_103)/i;
const JUNK_PERIOD_ID_REGEX = /^(live_|debug_|test_|period_s\d|period_supp|period_103)/i;

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

export function normalizeSemesterKey(academicYear?: string, semester?: string): string {
  return `${(academicYear || '').trim().toLowerCase()}__${(semester || '').trim().toLowerCase()}`;
}

export function isJunkAcademicTerm(term: AcademicTerm, referencedTermIds?: Set<string>): boolean {
  if (!term) return true;
  if (term.status === 'active') return false;
  if (referencedTermIds?.has(term.id)) return false;
  if ((term as any).createdBy === 'test') return true;
  if (JUNK_TERM_ID_REGEX.test(term.id)) return true;
  return false;
}

/**
 * Menyaring baris duplikat / data uji historis pada academic_terms
 * sehingga setiap pasangan (Tahun Akademik, Semester) tampil bersih satu kali di dropdown.
 */
export function deduplicateCleanAcademicTerms(
  terms: AcademicTerm[],
  periods: ExamPeriod[] = []
): AcademicTerm[] {
  const referencedTermIds = new Set<string>(
    (periods || []).map(p => p.academicTermId).filter(Boolean)
  );

  const validTerms = (terms || []).filter(t => !isJunkAcademicTerm(t, referencedTermIds));
  const sourceList = validTerms.length > 0 ? validTerms : (terms || []);

  const grouped = new Map<string, AcademicTerm[]>();
  for (const t of sourceList) {
    const key = normalizeSemesterKey(t.academicYear, t.semester);
    const arr = grouped.get(key) || [];
    arr.push(t);
    grouped.set(key, arr);
  }

  const canonical: AcademicTerm[] = [];
  grouped.forEach(group => {
    const sorted = [...group].sort((a, b) => {
      const rankStatus = (s: string) => (s === 'active' ? 0 : s === 'completed' ? 1 : 2);
      const statusDiff = rankStatus(a.status) - rankStatus(b.status);
      if (statusDiff !== 0) return statusDiff;

      const aRef = referencedTermIds.has(a.id) ? 0 : 1;
      const bRef = referencedTermIds.has(b.id) ? 0 : 1;
      if (aRef !== bRef) return aRef - bRef;

      const aTime = a.updatedAt || a.createdAt || '';
      const bTime = b.updatedAt || b.createdAt || '';
      return bTime.localeCompare(aTime);
    });
    canonical.push(sorted[0]);
  });

  return canonical.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    const yearCmp = (b.academicYear || '').localeCompare(a.academicYear || '');
    if (yearCmp !== 0) return yearCmp;
    if (a.semester !== b.semester) {
      return a.semester === 'genap' ? -1 : 1;
    }
    return 0;
  });
}

/**
 * Mengembalikan seluruh ID academic_terms yang memiliki (academicYear, semester) yang sama
 * dengan term yang dipilih. Mengatasi kondisi di mana UTS dan UAS dibuat pada dua baris term berbeda
 * untuk tahun ajaran & semester yang sama (misal 2026/2027 Ganjil).
 */
export function getSameSemesterTermIds(
  selectedTermId: string | undefined,
  allTerms: AcademicTerm[]
): { targetTerm: AcademicTerm | undefined; matchingTermIds: Set<string> } {
  const cleanList = deduplicateCleanAcademicTerms(allTerms);
  const targetTerm =
    (selectedTermId ? allTerms.find(t => t.id === selectedTermId) : undefined) ||
    allTerms.find(t => t.status === 'active') ||
    cleanList[0] ||
    allTerms[0];

  const matchingTermIds = new Set<string>();
  if (targetTerm) {
    matchingTermIds.add(targetTerm.id);
    const targetKey = normalizeSemesterKey(targetTerm.academicYear, targetTerm.semester);
    for (const t of allTerms) {
      if (normalizeSemesterKey(t.academicYear, t.semester) === targetKey) {
        matchingTermIds.add(t.id);
      }
    }
  } else if (selectedTermId) {
    matchingTermIds.add(selectedTermId);
  }

  return { targetTerm, matchingTermIds };
}

/**
 * Mengambil daftar periode ujian (UTS & UAS) yang relevan dengan semester terpilih
 * dengan mencocokkan seluruh baris academic_terms berpasangan (academicYear, semester) yang sama.
 */
export function getPeriodsForAcademicTerm(
  selectedTermId: string | undefined,
  allTerms: AcademicTerm[],
  allPeriods: ExamPeriod[]
): ExamPeriod[] {
  const { targetTerm, matchingTermIds } = getSameSemesterTermIds(selectedTermId, allTerms);
  const matched = (allPeriods || []).filter(p => {
    if (JUNK_PERIOD_ID_REGEX.test(p.id)) return false;
    if (matchingTermIds.has(p.academicTermId)) return true;
    // Fallback pencocokan nama jika academicTermId yatim (orphan)
    if (targetTerm && !allTerms.some(t => t.id === p.academicTermId)) {
      const lowerName = (p.name || '').toLowerCase();
      const hasYear = lowerName.includes((targetTerm.academicYear || '').toLowerCase());
      const hasSem = lowerName.includes((targetTerm.semester || '').toLowerCase());
      return hasYear && hasSem;
    }
    return false;
  });

  const rankPeriodStatus = (s?: string) => {
    switch (s) {
      case 'active':
      case 'ongoing':
        return 0;
      case 'completed':
        return 1;
      case 'preparation':
        return 2;
      default:
        return 3;
    }
  };

  return matched.sort((a, b) => {
    const exactA = a.academicTermId === selectedTermId ? 0 : 1;
    const exactB = b.academicTermId === selectedTermId ? 0 : 1;
    if (exactA !== exactB) return exactA - exactB;

    const stDiff = rankPeriodStatus(a.status) - rankPeriodStatus(b.status);
    if (stDiff !== 0) return stDiff;

    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

export interface ResolvedSemesterPair {
  success: boolean;
  message?: string;
  configId: string;
  configName: string;
  targetTerm: AcademicTerm;
  utsPeriod: ExamPeriod;
  uasPeriod: ExamPeriod;
  utsWeight: number;
  uasWeight: number;
}

export function filterConfigsForTerm(
  selectedTermId: string | undefined,
  allTerms: AcademicTerm[],
  allConfigs: SemesterEvaluationConfig[]
): SemesterEvaluationConfig[] {
  if (!selectedTermId) return allConfigs;
  const { targetTerm, matchingTermIds } = getSameSemesterTermIds(selectedTermId, allTerms);
  const targetKey = targetTerm ? normalizeSemesterKey(targetTerm.academicYear, targetTerm.semester) : '';

  return (allConfigs || []).filter(c => {
    if (matchingTermIds.has(c.academicTermId)) return true;
    if (targetKey && c.academicYear && c.semester) {
      return normalizeSemesterKey(c.academicYear, c.semester) === targetKey;
    }
    return false;
  });
}

export function resolveSemesterPeriodPair(params: {
  academicTermId?: string;
  configId?: string;
  utsPeriodId?: string;
  uasPeriodId?: string;
  allTerms: AcademicTerm[];
  allPeriods: ExamPeriod[];
  allConfigs: SemesterEvaluationConfig[];
}): ResolvedSemesterPair | { success: false; message: string } {
  const { allTerms, allPeriods, allConfigs } = params;
  const { targetTerm } = getSameSemesterTermIds(params.academicTermId, allTerms);

  if (!targetTerm) {
    return { success: false, message: 'Semester akademik tidak ditemukan.' };
  }

  let utsPeriod: ExamPeriod | undefined;
  let uasPeriod: ExamPeriod | undefined;
  let configId = '';
  let configName = 'Standar Evaluasi Semester';
  let utsWeight = 40;
  let uasWeight = 60;

  if (params.configId) {
    const cfg = allConfigs.find(c => c.id === params.configId);
    if (cfg) {
      utsPeriod = allPeriods.find(p => p.id === cfg.utsPeriodId);
      uasPeriod = allPeriods.find(p => p.id === cfg.uasPeriodId);
      configId = cfg.id;
      configName = cfg.name || configName;
      utsWeight = Number(cfg.utsWeight ?? 40);
      uasWeight = Number(cfg.uasWeight ?? 60);
    }
  }

  if ((!utsPeriod || !uasPeriod) && params.utsPeriodId && params.uasPeriodId) {
    utsPeriod = allPeriods.find(p => p.id === params.utsPeriodId);
    uasPeriod = allPeriods.find(p => p.id === params.uasPeriodId);
    if (!utsPeriod || !uasPeriod) {
      return { success: false, message: 'Periode UTS atau UAS yang dipilih tidak ditemukan.' };
    }
    const matchedCfg = allConfigs.find(
      c => c.utsPeriodId === utsPeriod!.id && c.uasPeriodId === uasPeriod!.id
    );
    if (matchedCfg) {
      configId = matchedCfg.id;
      configName = matchedCfg.name || configName;
      utsWeight = Number(matchedCfg.utsWeight ?? 40);
      uasWeight = Number(matchedCfg.uasWeight ?? 60);
    }
  }

  if (!utsPeriod || !uasPeriod) {
    const termConfigs = filterConfigsForTerm(targetTerm.id, allTerms, allConfigs);
    if (termConfigs.length > 0) {
      const cfg = termConfigs[0];
      const cfgUts = allPeriods.find(p => p.id === cfg.utsPeriodId);
      const cfgUas = allPeriods.find(p => p.id === cfg.uasPeriodId);
      if (cfgUts && cfgUas) {
        utsPeriod = cfgUts;
        uasPeriod = cfgUas;
        configId = cfg.id;
        configName = cfg.name || configName;
        utsWeight = Number(cfg.utsWeight ?? 40);
        uasWeight = Number(cfg.uasWeight ?? 60);
      }
    }
  }

  if (!utsPeriod || !uasPeriod) {
    const semPeriods = getPeriodsForAcademicTerm(targetTerm.id, allTerms, allPeriods);
    const utsCandidates = semPeriods.filter(p => (p.examType || '').toLowerCase() === 'uts');
    const uasCandidates = semPeriods.filter(p => (p.examType || '').toLowerCase() === 'uas');

    if (utsCandidates.length === 0 || uasCandidates.length === 0) {
      const missingLabel =
        utsCandidates.length === 0 && uasCandidates.length === 0
          ? 'UTS dan UAS'
          : utsCandidates.length === 0
          ? 'UTS'
          : 'UAS';
      return {
        success: false,
        message: `Semester ${targetTerm.academicYear} (${targetTerm.semester === 'ganjil' ? 'Ganjil' : 'Genap'}) belum memiliki periode ${missingLabel}.`
      };
    }

    utsPeriod = utsPeriod || utsCandidates[0];
    uasPeriod = uasPeriod || uasCandidates[0];

    const matchedCfg = allConfigs.find(
      c => c.utsPeriodId === utsPeriod!.id && c.uasPeriodId === uasPeriod!.id
    );
    if (matchedCfg) {
      configId = matchedCfg.id;
      configName = matchedCfg.name || configName;
      utsWeight = Number(matchedCfg.utsWeight ?? 40);
      uasWeight = Number(matchedCfg.uasWeight ?? 60);
    } else {
      configId = `auto_${targetTerm.id}`;
    }
  }

  return {
    success: true,
    configId,
    configName,
    targetTerm,
    utsPeriod,
    uasPeriod,
    utsWeight,
    uasWeight
  };
}

function groupActiveUASSessionsByStudent(rawSessions: any[] | undefined): Map<string, UASRecapSessionLike[]> {
  const map = new Map<string, UASRecapSessionLike[]>();
  for (const sess of rawSessions || []) {
    if (!sess || sess.status === 'void') continue;
    const sid = sess.student_id || sess.studentId;
    if (!sid) continue;
    const arr = map.get(sid) || [];
    arr.push(sess);
    map.set(sid, arr);
  }
  map.forEach((arr, sid) => {
    arr.sort((a, b) => (a.session_number ?? a.sessionNumber ?? 0) - (b.session_number ?? b.sessionNumber ?? 0));
    map.set(sid, arr);
  });
  return map;
}

function dedupeStudentsById(students: ExaminerStudentItem[] | undefined): Map<string, ExaminerStudentItem> {
  const map = new Map<string, ExaminerStudentItem>();
  for (const st of students || []) {
    if (!st || !st.studentId) continue;
    const existing = map.get(st.studentId);
    if (!existing) {
      map.set(st.studentId, st);
    } else if (existing.attemptStatus !== 'submitted' && st.attemptStatus === 'submitted') {
      map.set(st.studentId, st);
    }
  }
  return map;
}

interface ComputedUASStudentResult {
  score: number | null;
  status: ComponentExamStatus;
  remedialEligible: boolean;
  isPassed: boolean;
  attemptId: string | null;
  questionSetId: string;
  materialSnapshotId?: string;
  submittedAt: string | null;
  examinerName: string | null;
  remedialOriginalScore: number | null;
  totalSessions: number;
  submittedSessions: number;
  sessionSummaryText?: string;
  sortedSessions: UASRecapSessionLike[];
}

function evaluateStudentUAS(
  studentId: string,
  uasStudent: ExaminerStudentItem | undefined,
  uasSessions: UASRecapSessionLike[] | undefined,
  uasKkm: number
): ComputedUASStudentResult {
  const activeSessions = (uasSessions || []).filter(s => s && s.status !== 'void');

  if (activeSessions.length > 0) {
    const fallbackStudent: ExaminerStudentItem = uasStudent || {
      studentId,
      studentName: '',
      studentNis: '',
      class: '-',
      halaqah: '-',
      teacherId: '',
      hasAssignment: true
    };
    const summary = computeStudentUASRecapSummary(fallbackStudent, activeSessions, uasKkm);

    let score: number | null = null;
    let status: ComponentExamStatus = 'NOT_STARTED';
    let remedialEligible = false;

    if (summary.isAllSubmitted && summary.averageScore !== null) {
      score = summary.averageScore;
      status = summary.isPassed ? 'TUNTAS' : 'PERLU_REMEDIAL';
      remedialEligible = !summary.isPassed;
    } else if (summary.statusCategory === 'IN_PROGRESS') {
      score = null;
      status = 'IN_PROGRESS';
      remedialEligible = false;
    } else {
      score = null;
      status = 'NOT_STARTED';
      remedialEligible = false;
    }

    const doneSessions = summary.sortedSessions.filter(s => s.status === 'submitted');
    const failedSess =
      doneSessions.find(s => Number(s.score ?? 0) < uasKkm) ||
      doneSessions[0] ||
      summary.sortedSessions[0];

    const primaryAttemptId =
      (failedSess as any)?.attempt_id ||
      (failedSess as any)?.attemptId ||
      uasStudent?.attemptId ||
      null;
    const primaryQSetId =
      (failedSess as any)?.question_set_id ||
      (failedSess as any)?.questionSetId ||
      uasStudent?.questionSetId ||
      '';

    const failedSessionScore =
      failedSess && failedSess.score !== null && failedSess.score !== undefined && failedSess.score !== ''
        ? round2(Number(failedSess.score))
        : score;

    const remedialOrigScore =
      score !== null && failedSessionScore !== null
        ? Math.min(score, failedSessionScore)
        : score;

    return {
      score,
      status,
      remedialEligible,
      isPassed: summary.isPassed,
      attemptId: primaryAttemptId,
      questionSetId: primaryQSetId,
      materialSnapshotId: uasStudent?.snapshotId,
      submittedAt: summary.lastSubmittedAt,
      examinerName: summary.examinerSummary || uasStudent?.actualExaminerName || uasStudent?.examinerName || null,
      remedialOriginalScore: remedialOrigScore,
      totalSessions: summary.totalSessions,
      submittedSessions: summary.submittedSessions,
      sessionSummaryText: summary.materialSummary,
      sortedSessions: summary.sortedSessions
    };
  }

  // Fallback untuk UAS 1-sesi (legacy)
  let score: number | null = null;
  let status: ComponentExamStatus = 'NOT_STARTED';
  let remedialEligible = false;
  let isPassed = false;

  if (
    uasStudent?.attemptStatus === 'submitted' &&
    uasStudent.totalScore !== null &&
    uasStudent.totalScore !== undefined
  ) {
    score = round2(Number(uasStudent.totalScore));
    isPassed = score >= uasKkm;
    status = isPassed ? 'TUNTAS' : 'PERLU_REMEDIAL';
    remedialEligible = !isPassed;
  } else if (
    uasStudent?.attemptStatus === 'in_progress' ||
    (uasStudent?.attemptStatus as string | undefined) === 'reopened'
  ) {
    status = 'IN_PROGRESS';
  }

  return {
    score,
    status,
    remedialEligible,
    isPassed,
    attemptId: uasStudent?.attemptId || null,
    questionSetId: uasStudent?.questionSetId || '',
    materialSnapshotId: uasStudent?.snapshotId,
    submittedAt: uasStudent?.submittedAt || null,
    examinerName: uasStudent?.actualExaminerName || uasStudent?.examinerName || null,
    remedialOriginalScore: score,
    totalSessions: uasStudent?.attemptStatus === 'submitted' ? 1 : 0,
    submittedSessions: uasStudent?.attemptStatus === 'submitted' ? 1 : 0,
    sessionSummaryText: undefined,
    sortedSessions: []
  };
}

/**
 * Membangun respons Rekap Semester Tahfiz (Tahap 7A) secara akurat
 * mendukung pasangan UTS/UAS lintas-baris academic_terms dan multi-sesi UAS.
 */
export function buildSemesterTahfizRecapFromLiveData(params: {
  pair: ResolvedSemesterPair;
  utsStudents: ExaminerStudentItem[];
  uasStudents: ExaminerStudentItem[];
  uasRawSessions: any[];
}): SemesterRecapResponse {
  const { pair, utsStudents, uasStudents, uasRawSessions } = params;
  const { targetTerm, utsPeriod, uasPeriod, configName, utsWeight, uasWeight } = pair;

  const utsKkm = Number(utsPeriod.kkm ?? 70);
  const uasKkm = Number(uasPeriod.kkm ?? 70);

  const utsMap = dedupeStudentsById(utsStudents);
  const uasMap = dedupeStudentsById(uasStudents);
  const uasSessionsMap = groupActiveUASSessionsByStudent(uasRawSessions);

  const allStudentIds = new Set<string>();
  utsMap.forEach((_, sid) => allStudentIds.add(sid));
  uasMap.forEach((_, sid) => allStudentIds.add(sid));
  uasSessionsMap.forEach((_, sid) => allStudentIds.add(sid));

  const sortedStudentIds = Array.from(allStudentIds).sort((a, b) => {
    const nameA = uasMap.get(a)?.studentName || utsMap.get(a)?.studentName || a;
    const nameB = uasMap.get(b)?.studentName || utsMap.get(b)?.studentName || b;
    return nameA.localeCompare(nameB, 'id');
  });

  const recap: SemesterStudentRecap[] = [];
  const remedialCandidates: SemesterRemedialCandidate[] = [];

  for (const sid of sortedStudentIds) {
    const utsSt = utsMap.get(sid);
    const uasSt = uasMap.get(sid);
    const meta = uasSt || utsSt;
    if (!meta) continue;

    const studentName = meta.studentName || '-';
    const studentNis = meta.studentNis || utsSt?.studentNis || '';
    const className = meta.class || utsSt?.class || '-';
    const halaqah = meta.halaqah || utsSt?.halaqah || '-';

    // 1. Komponen UTS
    let utsScore: number | null = null;
    let utsStatus: ComponentExamStatus = 'NOT_STARTED';
    let utsEligible = false;

    if (
      utsSt?.attemptStatus === 'submitted' &&
      utsSt.totalScore !== null &&
      utsSt.totalScore !== undefined
    ) {
      utsScore = round2(Number(utsSt.totalScore));
      utsStatus = utsScore >= utsKkm ? 'TUNTAS' : 'PERLU_REMEDIAL';
      utsEligible = utsScore < utsKkm;
    } else if (
      utsSt?.attemptStatus === 'in_progress' ||
      (utsSt?.attemptStatus as string | undefined) === 'reopened'
    ) {
      utsStatus = 'IN_PROGRESS';
    }

    // 2. Komponen UAS (Multi-Sesi Otoritatif)
    const uasEval = evaluateStudentUAS(sid, uasSt, uasSessionsMap.get(sid), uasKkm);

    // 3. Kontribusi & Nilai Semester
    let utsContrib: number | null = null;
    let uasContrib: number | null = null;
    let semScore: number | null = null;
    let semStatus: SemesterRecapStatus = 'INCOMPLETE';

    if (utsScore !== null && uasEval.score !== null) {
      utsContrib = round2(utsScore * (utsWeight / 100));
      uasContrib = round2(uasEval.score * (uasWeight / 100));
      semScore = round2((utsScore * (utsWeight / 100)) + (uasEval.score * (uasWeight / 100)));
      semStatus = utsStatus === 'TUNTAS' && uasEval.status === 'TUNTAS' ? 'TUNTAS' : 'PERLU_REMEDIAL';
    }

    recap.push({
      studentId: sid,
      studentName,
      studentNis,
      className,
      halaqah,
      uts: {
        periodId: utsPeriod.id,
        attemptId: utsSt?.attemptId || null,
        originalScore: utsScore,
        kkm: utsKkm,
        status: utsStatus,
        remedialEligible: utsEligible,
        materialSnapshotId: utsSt?.snapshotId,
        examinerSummary: utsSt?.actualExaminerName || utsSt?.examinerName || undefined
      },
      uas: {
        periodId: uasPeriod.id,
        attemptId: uasEval.attemptId,
        originalScore: uasEval.score,
        kkm: uasKkm,
        status: uasEval.status,
        remedialEligible: uasEval.remedialEligible,
        materialSnapshotId: uasEval.materialSnapshotId,
        totalSessions: uasEval.totalSessions,
        submittedSessions: uasEval.submittedSessions,
        sessionSummaryText: uasEval.sessionSummaryText,
        examinerSummary: uasEval.examinerName || undefined
      },
      semester: {
        utsWeight,
        uasWeight,
        utsContribution: utsContrib,
        uasContribution: uasContrib,
        score: semScore,
        status: semStatus
      }
    });

    if (utsEligible && utsScore !== null) {
      remedialCandidates.push({
        studentId: sid,
        studentName,
        className,
        halaqah,
        examPeriodId: utsPeriod.id,
        examType: 'uts',
        originalAttemptId: utsSt?.attemptId || '',
        originalQuestionSetId: utsSt?.questionSetId || '',
        originalScore: utsScore,
        kkm: utsKkm,
        materialSnapshotId: utsSt?.snapshotId || '',
        eligibilityReason: 'ORIGINAL_SCORE_BELOW_KKM'
      });
    }

    if (uasEval.remedialEligible && uasEval.remedialOriginalScore !== null) {
      remedialCandidates.push({
        studentId: sid,
        studentName,
        className,
        halaqah,
        examPeriodId: uasPeriod.id,
        examType: 'uas',
        originalAttemptId: uasEval.attemptId || '',
        originalQuestionSetId: uasEval.questionSetId || '',
        originalScore: uasEval.remedialOriginalScore,
        kkm: uasKkm,
        materialSnapshotId: uasEval.materialSnapshotId || '',
        eligibilityReason: 'ORIGINAL_SCORE_BELOW_KKM'
      });
    }
  }

  const summary: SemesterRecapSummary = {
    totalStudents: recap.length,
    tuntasCount: recap.filter(r => r.semester.status === 'TUNTAS').length,
    perluRemedialCount: recap.filter(r => r.semester.status === 'PERLU_REMEDIAL').length,
    incompleteCount: recap.filter(r => r.semester.status === 'INCOMPLETE').length,
    utsRemedialCount: recap.filter(r => r.uts.status === 'PERLU_REMEDIAL').length,
    uasRemedialCount: recap.filter(r => r.uas.status === 'PERLU_REMEDIAL').length,
    belumUtsCount: recap.filter(r => r.uts.status === 'NOT_STARTED').length,
    belumUasCount: recap.filter(r => r.uas.status === 'NOT_STARTED').length
  };

  return {
    success: true,
    config: {
      academicTermId: targetTerm.id,
      academicYear: targetTerm.academicYear,
      semester: targetTerm.semester,
      configName,
      utsPeriodId: utsPeriod.id,
      utsPeriodName: utsPeriod.name,
      utsKkm,
      utsWeight,
      uasPeriodId: uasPeriod.id,
      uasPeriodName: uasPeriod.name,
      uasKkm,
      uasWeight
    },
    summary,
    recap,
    remedialCandidates
  };
}

/**
 * Membangun daftar kandidat remedial (Tahap 7B) yang digabung dengan sesi remedial aktif di server.
 */
export function buildRemedialCandidatesFromLiveData(params: {
  recapResponse: SemesterRecapResponse;
  remedialStudents: RemedialExaminerStudentItem[];
  examPeriodIdFilter?: string;
}): RemedialCandidatesResponse {
  const { recapResponse, remedialStudents, examPeriodIdFilter } = params;
  if (!recapResponse.success || !recapResponse.config) {
    return {
      success: false,
      message: recapResponse.message || 'Gagal memuat rekap kandidat remedial.'
    };
  }

  const cfg = recapResponse.config;
  const nisByStudent = new Map<string, string>();
  const halaqahByStudent = new Map<string, string>();
  const classByStudent = new Map<string, string>();
  for (const r of recapResponse.recap || []) {
    if (r.studentNis) nisByStudent.set(r.studentId, r.studentNis);
    if (r.halaqah) halaqahByStudent.set(r.studentId, r.halaqah);
    if (r.className) classByStudent.set(r.studentId, r.className);
  }

  const remSessionMap = new Map<string, RemedialExaminerStudentItem>();
  for (const rs of remedialStudents || []) {
    if (!rs || rs.sessionStatus === 'invalid' || rs.sessionStatus === 'stale') continue;
    remSessionMap.set(`${rs.examPeriodId}_${rs.studentId}`, rs);
  }

  const candidatesMap = new Map<string, RemedialCandidateItem>();

  for (const rc of recapResponse.remedialCandidates || []) {
    if (examPeriodIdFilter && rc.examPeriodId !== examPeriodIdFilter) continue;
    const key = `${rc.examPeriodId}_${rc.studentId}`;
    const existing = remSessionMap.get(key);
    const isLocked =
      existing?.questionSetStatus === 'locked' || existing?.sessionStatus === 'locked';

    candidatesMap.set(key, {
      studentId: rc.studentId,
      studentName: rc.studentName,
      studentNis: nisByStudent.get(rc.studentId) || existing?.nis || '',
      className: rc.className,
      halaqah: rc.halaqah,
      examType: rc.examType,
      originalPeriodId: rc.examPeriodId,
      originalPeriodName: rc.examType === 'uts' ? cfg.utsPeriodName : cfg.uasPeriodName,
      originalAttemptId: existing?.originalAttemptId || rc.originalAttemptId,
      originalQuestionSetId: rc.originalQuestionSetId,
      originalScore: rc.originalScore,
      kkm: rc.kkm,
      materialSnapshotId: rc.materialSnapshotId || 'finalized',
      remedialSessionId: existing?.remedialSessionId || null,
      generationStatus: (isLocked
        ? 'locked'
        : (existing?.sessionStatus as RemedialSessionStatus) || 'eligible'),
      remedialQuestionSetId: existing?.remedialQuestionSetId || null,
      remedialVersion: 1,
      isPackageReady: Boolean(isLocked),
      questionCount: existing?.questionCount || (rc.examType === 'uts' ? 5 : 9)
    });
  }

  // Sertakan sesi remedial yang sudah dibuat sebelumnya pada UTS/UAS semester ini
  for (const rs of remedialStudents || []) {
    if (!rs || rs.sessionStatus === 'invalid' || rs.sessionStatus === 'stale') continue;
    if (rs.examPeriodId !== cfg.utsPeriodId && rs.examPeriodId !== cfg.uasPeriodId) continue;
    if (examPeriodIdFilter && rs.examPeriodId !== examPeriodIdFilter) continue;

    const key = `${rs.examPeriodId}_${rs.studentId}`;
    if (!candidatesMap.has(key)) {
      const isLocked = rs.questionSetStatus === 'locked' || rs.sessionStatus === 'locked';
      candidatesMap.set(key, {
        studentId: rs.studentId,
        studentName: rs.studentName,
        studentNis: rs.nis || nisByStudent.get(rs.studentId) || '',
        className: rs.className || classByStudent.get(rs.studentId) || '-',
        halaqah: halaqahByStudent.get(rs.studentId) || '-',
        examType: rs.examType,
        originalPeriodId: rs.examPeriodId,
        originalPeriodName: rs.periodName,
        originalAttemptId: rs.originalAttemptId,
        originalQuestionSetId: '',
        originalScore: round2(Number(rs.originalScore ?? 0)),
        kkm: Number(rs.kkm ?? (rs.examType === 'uts' ? cfg.utsKkm : cfg.uasKkm)),
        materialSnapshotId: 'finalized',
        remedialSessionId: rs.remedialSessionId,
        generationStatus: (isLocked ? 'locked' : (rs.sessionStatus as RemedialSessionStatus) || 'eligible'),
        remedialQuestionSetId: rs.remedialQuestionSetId,
        remedialVersion: 1,
        isPackageReady: Boolean(isLocked),
        questionCount: rs.questionCount
      });
    }
  }

  const candidates = Array.from(candidatesMap.values()).sort((a, b) =>
    a.studentName.localeCompare(b.studentName, 'id')
  );
  const readyCount = candidates.filter(c => c.isPackageReady).length;

  return {
    success: true,
    summary: {
      totalCandidates: candidates.length,
      readyCount,
      pendingCount: candidates.length - readyCount
    },
    candidates
  };
}

/**
 * Membangun Rekap Nilai Final & Statistik Monitoring Semester (Tahap 7D)
 * dengan dukungan penuh multi-sesi UAS & riwayat remedial.
 */
export function buildSemesterFinalRecapFromLiveData(params: {
  pair: ResolvedSemesterPair;
  utsStudents: ExaminerStudentItem[];
  uasStudents: ExaminerStudentItem[];
  uasRawSessions: any[];
  remedialStudents: RemedialExaminerStudentItem[];
  classFilter?: string;
  statusFilter?: string;
  searchFilter?: string;
}): FinalSemesterRecapResponse {
  const {
    pair,
    utsStudents,
    uasStudents,
    uasRawSessions,
    remedialStudents,
    classFilter,
    statusFilter,
    searchFilter
  } = params;
  const { targetTerm, utsPeriod, uasPeriod, configId, configName, utsWeight, uasWeight } = pair;

  const utsKkm = Number(utsPeriod.kkm ?? 70);
  const uasKkm = Number(uasPeriod.kkm ?? 70);
  const termDisplayName = `${targetTerm.academicYear} — Semester ${
    targetTerm.semester === 'ganjil' ? 'Ganjil' : 'Genap'
  }`;

  const utsMap = dedupeStudentsById(utsStudents);
  const uasMap = dedupeStudentsById(uasStudents);
  const uasSessionsMap = groupActiveUASSessionsByStudent(uasRawSessions);

  const remMap = new Map<string, RemedialExaminerStudentItem>();
  for (const rs of remedialStudents || []) {
    if (!rs || rs.sessionStatus === 'invalid' || rs.sessionStatus === 'stale') continue;
    remMap.set(`${rs.examPeriodId}_${rs.studentId}`, rs);
  }

  const allStudentIds = new Set<string>();
  utsMap.forEach((_, sid) => allStudentIds.add(sid));
  uasMap.forEach((_, sid) => allStudentIds.add(sid));
  uasSessionsMap.forEach((_, sid) => allStudentIds.add(sid));

  const sortedStudentIds = Array.from(allStudentIds).sort((a, b) => {
    const nameA = uasMap.get(a)?.studentName || utsMap.get(a)?.studentName || a;
    const nameB = uasMap.get(b)?.studentName || utsMap.get(b)?.studentName || b;
    return nameA.localeCompare(nameB, 'id');
  });

  const stats: FinalSemesterMonitoringStats = {
    totalStudents: 0,
    tuntasCount: 0,
    perluRemedialCount: 0,
    sedangRemedialCount: 0,
    tuntasViaRemedialCount: 0,
    belumTuntasSetelahRemedialCount: 0,
    belumLengkapCount: 0,

    utsNotStartedCount: 0,
    utsInProgressCount: 0,
    utsSubmittedCount: 0,

    uasNotStartedCount: 0,
    uasInProgressCount: 0,
    uasSubmittedCount: 0,

    remedialNeedsCount: 0,
    remedialScheduledCount: 0,
    remedialInProgressCount: 0,
    remedialSubmittedCount: 0,
    remedialBelowKkmCount: 0
  };

  const recapItems: FinalSemesterRecapItem[] = [];
  const searchNorm = (searchFilter || '').trim().toLowerCase();

  for (const sid of sortedStudentIds) {
    const utsSt = utsMap.get(sid);
    const uasSt = uasMap.get(sid);
    const meta = uasSt || utsSt;
    if (!meta) continue;

    const studentName = meta.studentName || '-';
    const nis = meta.studentNis || utsSt?.studentNis || '-';
    const stClass = meta.class || utsSt?.class || '-';
    const halaqah = meta.halaqah || utsSt?.halaqah || '-';

    if (classFilter && classFilter !== 'ALL' && stClass !== classFilter) {
      continue;
    }

    stats.totalStudents += 1;

    // A. Evaluasi UTS + Remedial UTS
    let utsOrigScore: number | null = null;
    let utsOrigAttemptId: string | null = null;
    let utsOrigSubmittedAt: string | null = null;
    let utsOrigExaminer: string | null = null;

    if (
      utsSt?.attemptStatus === 'submitted' &&
      utsSt.totalScore !== null &&
      utsSt.totalScore !== undefined
    ) {
      utsOrigScore = round2(Number(utsSt.totalScore));
      utsOrigAttemptId = utsSt.attemptId || null;
      utsOrigSubmittedAt = utsSt.submittedAt || null;
      utsOrigExaminer = utsSt.actualExaminerName || utsSt.examinerName || null;
      stats.utsSubmittedCount += 1;
    } else if (
      utsSt?.attemptStatus === 'in_progress' ||
      (utsSt?.attemptStatus as string | undefined) === 'reopened'
    ) {
      utsOrigAttemptId = utsSt.attemptId || null;
      stats.utsInProgressCount += 1;
    } else {
      stats.utsNotStartedCount += 1;
    }

    const utsRem = remMap.get(`${utsPeriod.id}_${sid}`);
    let utsRemSessId: string | null = null;
    let utsRemAttId: string | null = null;
    let utsRemScore: number | null = null;
    let utsRemSubmittedAt: string | null = null;
    let utsRemExaminer: string | null = null;
    const utsRemAttStatus = utsRem?.remedialAttemptStatus || null;

    if (utsRem) {
      utsRemSessId = utsRem.remedialSessionId;
      utsRemAttId = utsRem.remedialAttemptId || null;
      utsRemExaminer = utsRem.examinerName || null;
      if (
        utsRemAttStatus === 'submitted' &&
        utsRem.remedialScore !== null &&
        utsRem.remedialScore !== undefined
      ) {
        utsRemScore = round2(Number(utsRem.remedialScore));
        utsRemSubmittedAt = utsRem.remedialSubmittedAt || null;
        stats.remedialSubmittedCount += 1;
      } else if (utsRemAttStatus === 'in_progress' || utsRemAttStatus === 'reopened') {
        stats.remedialInProgressCount += 1;
      } else {
        stats.remedialScheduledCount += 1;
      }
    }

    let utsEffScore: number | null = null;
    let utsEffSource: EffectiveScoreSource = 'NONE';
    let utsStatus: FinalComponentStatus = 'BELUM_UJIAN';

    if (utsRemScore !== null) {
      utsEffScore = utsRemScore;
      utsEffSource = 'REMEDIAL';
      if (utsRemScore >= utsKkm) {
        utsStatus = 'TUNTAS_MELALUI_REMEDIAL';
      } else {
        utsStatus = 'BELUM_TUNTAS_SETELAH_REMEDIAL';
        stats.remedialBelowKkmCount += 1;
      }
    } else if (utsOrigScore !== null) {
      utsEffScore = utsOrigScore;
      utsEffSource = 'ORIGINAL';
      if (utsOrigScore >= utsKkm) {
        utsStatus = 'TUNTAS';
      } else if (!utsRemSessId) {
        utsStatus = 'PERLU_REMEDIAL';
        stats.remedialNeedsCount += 1;
      } else if (utsRemAttStatus === 'in_progress' || utsRemAttStatus === 'reopened') {
        utsStatus = 'SEDANG_REMEDIAL';
      } else {
        utsStatus = 'REMEDIAL_DIJADWALKAN';
      }
    }

    // B. Evaluasi UAS Multi-Sesi + Remedial UAS
    const uasEval = evaluateStudentUAS(sid, uasSt, uasSessionsMap.get(sid), uasKkm);
    const uasOrigScore = uasEval.score;
    const uasOrigAttemptId = uasEval.attemptId;
    const uasOrigSubmittedAt = uasEval.submittedAt;
    const uasOrigExaminer = uasEval.examinerName;

    if (uasEval.status === 'TUNTAS' || uasEval.status === 'PERLU_REMEDIAL') {
      stats.uasSubmittedCount += 1;
    } else if (uasEval.status === 'IN_PROGRESS') {
      stats.uasInProgressCount += 1;
    } else {
      stats.uasNotStartedCount += 1;
    }

    const uasRem = remMap.get(`${uasPeriod.id}_${sid}`);
    let uasRemSessId: string | null = null;
    let uasRemAttId: string | null = null;
    let uasRemScore: number | null = null;
    let uasRemSubmittedAt: string | null = null;
    let uasRemExaminer: string | null = null;
    const uasRemAttStatus = uasRem?.remedialAttemptStatus || null;

    if (uasRem) {
      uasRemSessId = uasRem.remedialSessionId;
      uasRemAttId = uasRem.remedialAttemptId || null;
      uasRemExaminer = uasRem.examinerName || null;
      if (
        uasRemAttStatus === 'submitted' &&
        uasRem.remedialScore !== null &&
        uasRem.remedialScore !== undefined
      ) {
        uasRemScore = round2(Number(uasRem.remedialScore));
        uasRemSubmittedAt = uasRem.remedialSubmittedAt || null;
        stats.remedialSubmittedCount += 1;
      } else if (uasRemAttStatus === 'in_progress' || uasRemAttStatus === 'reopened') {
        stats.remedialInProgressCount += 1;
      } else {
        stats.remedialScheduledCount += 1;
      }
    }

    let uasEffScore: number | null = null;
    let uasEffSource: EffectiveScoreSource = 'NONE';
    let uasStatus: FinalComponentStatus = 'BELUM_UJIAN';

    if (uasRemScore !== null) {
      uasEffScore = uasRemScore;
      uasEffSource = 'REMEDIAL';
      if (uasRemScore >= uasKkm) {
        uasStatus = 'TUNTAS_MELALUI_REMEDIAL';
      } else {
        uasStatus = 'BELUM_TUNTAS_SETELAH_REMEDIAL';
        stats.remedialBelowKkmCount += 1;
      }
    } else if (uasOrigScore !== null) {
      uasEffScore = uasOrigScore;
      uasEffSource = 'ORIGINAL';
      if (uasEval.isPassed) {
        uasStatus = 'TUNTAS';
      } else if (!uasRemSessId) {
        uasStatus = 'PERLU_REMEDIAL';
        stats.remedialNeedsCount += 1;
      } else if (uasRemAttStatus === 'in_progress' || uasRemAttStatus === 'reopened') {
        uasStatus = 'SEDANG_REMEDIAL';
      } else {
        uasStatus = 'REMEDIAL_DIJADWALKAN';
      }
    }

    // C. Perhitungan Akhir Nilai & Status Semester
    const hasRemedial = Boolean(utsRemSessId || uasRemSessId);
    const hasActiveRemedial = Boolean(
      utsRemAttStatus === 'in_progress' ||
        utsRemAttStatus === 'reopened' ||
        uasRemAttStatus === 'in_progress' ||
        uasRemAttStatus === 'reopened'
    );
    const passedViaRemedial =
      utsStatus === 'TUNTAS_MELALUI_REMEDIAL' || uasStatus === 'TUNTAS_MELALUI_REMEDIAL';

    const semesterFinalScore =
      utsEffScore !== null && uasEffScore !== null
        ? round2((utsEffScore * (utsWeight / 100)) + (uasEffScore * (uasWeight / 100)))
        : null;

    let semesterStatus: FinalSemesterStatus = 'BELUM_LENGKAP';

    if (utsEffScore === null || uasEffScore === null) {
      semesterStatus = 'BELUM_LENGKAP';
      stats.belumLengkapCount += 1;
    } else if (utsStatus === 'SEDANG_REMEDIAL' || uasStatus === 'SEDANG_REMEDIAL') {
      semesterStatus = 'SEDANG_REMEDIAL';
      stats.sedangRemedialCount += 1;
    } else if (
      utsStatus === 'PERLU_REMEDIAL' ||
      uasStatus === 'PERLU_REMEDIAL' ||
      utsStatus === 'REMEDIAL_DIJADWALKAN' ||
      uasStatus === 'REMEDIAL_DIJADWALKAN'
    ) {
      semesterStatus = 'PERLU_REMEDIAL';
      stats.perluRemedialCount += 1;
    } else if (
      utsStatus === 'BELUM_TUNTAS_SETELAH_REMEDIAL' ||
      uasStatus === 'BELUM_TUNTAS_SETELAH_REMEDIAL'
    ) {
      semesterStatus = 'BELUM_TUNTAS_SETELAH_REMEDIAL';
      stats.belumTuntasSetelahRemedialCount += 1;
    } else if (
      (utsStatus === 'TUNTAS' || utsStatus === 'TUNTAS_MELALUI_REMEDIAL') &&
      (uasStatus === 'TUNTAS' || uasStatus === 'TUNTAS_MELALUI_REMEDIAL')
    ) {
      semesterStatus = 'TUNTAS';
      stats.tuntasCount += 1;
      if (passedViaRemedial) {
        stats.tuntasViaRemedialCount += 1;
      }
    } else {
      semesterStatus = 'PERLU_REMEDIAL';
      stats.perluRemedialCount += 1;
    }

    // Filter status & pencarian untuk baris tabel
    let matchesStatus = true;
    if (statusFilter && statusFilter !== 'ALL') {
      if (statusFilter === 'TUNTAS') {
        matchesStatus = semesterStatus === 'TUNTAS';
      } else if (statusFilter === 'TUNTAS_VIA_REMEDIAL') {
        matchesStatus = semesterStatus === 'TUNTAS' && passedViaRemedial;
      } else {
        matchesStatus = semesterStatus === statusFilter;
      }
    }

    if (matchesStatus && searchNorm) {
      const matchName = studentName.toLowerCase().includes(searchNorm);
      const matchNis = nis.toLowerCase().includes(searchNorm);
      if (!matchName && !matchNis) {
        matchesStatus = false;
      }
    }

    if (matchesStatus) {
      recapItems.push({
        studentId: sid,
        nis,
        studentName,
        class: stClass,
        halaqah,
        academicTermId: targetTerm.id,
        academicTermName: termDisplayName,

        utsPeriodId: utsPeriod.id,
        utsPeriodName: utsPeriod.name,
        utsKkm,
        utsOriginalAttemptId: utsOrigAttemptId,
        utsOriginalScore: utsOrigScore,
        utsOriginalSubmittedAt: utsOrigSubmittedAt,
        utsOriginalExaminerName: utsOrigExaminer,

        utsRemedialSessionId: utsRemSessId,
        utsRemedialAttemptId: utsRemAttId,
        utsRemedialScore: utsRemScore,
        utsRemedialSubmittedAt: utsRemSubmittedAt,
        utsRemedialExaminerName: utsRemExaminer,

        utsEffectiveScore: utsEffScore,
        utsEffectiveSource: utsEffSource,
        utsStatus,

        uasPeriodId: uasPeriod.id,
        uasPeriodName: uasPeriod.name,
        uasKkm,
        uasOriginalAttemptId: uasOrigAttemptId,
        uasOriginalScore: uasOrigScore,
        uasOriginalSubmittedAt: uasOrigSubmittedAt,
        uasOriginalExaminerName: uasOrigExaminer,
        uasSessionSummary: uasEval.sessionSummaryText,
        uasTotalSessions: uasEval.totalSessions,
        uasSubmittedSessions: uasEval.submittedSessions,

        uasRemedialSessionId: uasRemSessId,
        uasRemedialAttemptId: uasRemAttId,
        uasRemedialScore: uasRemScore,
        uasRemedialSubmittedAt: uasRemSubmittedAt,
        uasRemedialExaminerName: uasRemExaminer,

        uasEffectiveScore: uasEffScore,
        uasEffectiveSource: uasEffSource,
        uasStatus,

        utsWeight,
        uasWeight,

        semesterFinalScore,
        semesterStatus,

        hasRemedial: hasRemedial || passedViaRemedial,
        hasActiveRemedial
      });
    }
  }

  return {
    success: true,
    config: {
      id: configId,
      name: configName,
      academicTermId: targetTerm.id,
      academicYear: targetTerm.academicYear,
      semester: targetTerm.semester,
      utsPeriodId: utsPeriod.id,
      utsPeriodName: utsPeriod.name,
      utsKkm,
      uasPeriodId: uasPeriod.id,
      uasPeriodName: uasPeriod.name,
      uasKkm,
      utsWeight,
      uasWeight
    },
    summary: stats,
    recap: recapItems
  };
}

/**
 * Membangun detail evaluasi & timeline aktivitas per santri (Tahap 7D Modal Detail)
 * termasuk rincian setiap sesi UAS multi-juz.
 */
export function buildStudentEvaluationHistoryFromLiveData(params: {
  studentId: string;
  finalRecap: FinalSemesterRecapResponse;
  uasRawSessions: any[];
}): StudentEvaluationHistoryResponse {
  const { studentId, finalRecap, uasRawSessions } = params;
  if (!finalRecap.success || !finalRecap.recap) {
    return {
      success: false,
      message: finalRecap.message || 'Gagal memuat riwayat evaluasi santri.'
    };
  }

  const item = finalRecap.recap.find(r => r.studentId === studentId);
  if (!item) {
    return {
      success: false,
      message: 'Data evaluasi santri tidak ditemukan pada semester ini.'
    };
  }

  const timeline: EvaluationTimelineEvent[] = [];

  if (item.utsOriginalScore !== null) {
    timeline.push({
      id: `tl_uts_${item.utsOriginalAttemptId || studentId}`,
      action: 'SUBMIT_UTS',
      actionLabel: `Ujian UTS Selesai — Nilai ${item.utsOriginalScore.toFixed(2)}`,
      actorId: 'examiner',
      actorName: item.utsOriginalExaminerName || 'Penguji UTS',
      actorRole: 'Penguji',
      reason: `Periode: ${item.utsPeriodName} (KKM ${item.utsKkm})`,
      createdAt: item.utsOriginalSubmittedAt || new Date().toISOString()
    });
  }

  const studentUASSessions = (uasRawSessions || [])
    .filter(s => s && s.status !== 'void' && (s.student_id || s.studentId) === studentId)
    .sort((a, b) => (a.session_number ?? a.sessionNumber ?? 0) - (b.session_number ?? b.sessionNumber ?? 0));

  if (studentUASSessions.length > 0) {
    for (const sess of studentUASSessions) {
      const sNum = sess.session_number ?? sess.sessionNumber ?? 1;
      const juz = sess.juz_number ?? sess.juzNumber ?? '-';
      const typeLabel = (sess.session_type ?? sess.sessionType) === 'partial_half' ? 'Parsial' : 'Juz Penuh';
      const exNames = getSessionExaminers(sess).map(e => e.name).join(', ') || 'Penguji UAS';
      if (sess.status === 'submitted' && sess.score !== null && sess.score !== undefined) {
        timeline.push({
          id: `tl_uas_sess_${sess.id}`,
          action: 'SUBMIT_UAS_SESSION',
          actionLabel: `UAS Sesi ${sNum} (Juz ${juz} • ${typeLabel}) — Nilai ${Number(sess.score).toFixed(2)}`,
          actorId: 'examiner',
          actorName: exNames,
          actorRole: 'Penguji UAS',
          reason: `Periode: ${item.uasPeriodName} (KKM ${item.uasKkm})`,
          createdAt: sess.submitted_at || sess.submittedAt || sess.updated_at || sess.updatedAt || new Date().toISOString()
        });
      } else if (sess.status === 'in_progress') {
        timeline.push({
          id: `tl_uas_sess_prog_${sess.id}`,
          action: 'START_UAS_SESSION',
          actionLabel: `UAS Sesi ${sNum} (Juz ${juz} • ${typeLabel}) — Sedang Berlangsung`,
          actorId: 'examiner',
          actorName: exNames,
          actorRole: 'Penguji UAS',
          createdAt: sess.updated_at || sess.updatedAt || new Date().toISOString()
        });
      }
    }
  } else if (item.uasOriginalScore !== null) {
    timeline.push({
      id: `tl_uas_${item.uasOriginalAttemptId || studentId}`,
      action: 'SUBMIT_UAS',
      actionLabel: `Ujian UAS Selesai — Nilai ${item.uasOriginalScore.toFixed(2)}`,
      actorId: 'examiner',
      actorName: item.uasOriginalExaminerName || 'Penguji UAS',
      actorRole: 'Penguji',
      reason: `Periode: ${item.uasPeriodName} (KKM ${item.uasKkm})`,
      createdAt: item.uasOriginalSubmittedAt || new Date().toISOString()
    });
  }

  if (item.utsRemedialScore !== null) {
    timeline.push({
      id: `tl_rem_uts_${item.utsRemedialAttemptId || studentId}`,
      action: 'SUBMIT_REMEDIAL_UTS',
      actionLabel: `Remedial UTS Selesai — Nilai ${item.utsRemedialScore.toFixed(2)}`,
      actorId: 'examiner',
      actorName: item.utsRemedialExaminerName || 'Penguji Remedial',
      actorRole: 'Penguji Remedial',
      createdAt: item.utsRemedialSubmittedAt || new Date().toISOString()
    });
  }

  if (item.uasRemedialScore !== null) {
    timeline.push({
      id: `tl_rem_uas_${item.uasRemedialAttemptId || studentId}`,
      action: 'SUBMIT_REMEDIAL_UAS',
      actionLabel: `Remedial UAS Selesai — Nilai ${item.uasRemedialScore.toFixed(2)}`,
      actorId: 'examiner',
      actorName: item.uasRemedialExaminerName || 'Penguji Remedial',
      actorRole: 'Penguji Remedial',
      createdAt: item.uasRemedialSubmittedAt || new Date().toISOString()
    });
  }

  timeline.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  return {
    success: true,
    student: {
      id: item.studentId,
      name: item.studentName,
      nis: item.nis,
      class: item.class,
      halaqah: item.halaqah
    },
    config: finalRecap.config,
    recap: item,
    timeline
  };
}
