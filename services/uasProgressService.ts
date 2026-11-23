import type { ExaminerStudentItem, ExamUASSession } from '../types';

export type UASStudentProgressCode =
  | 'NOT_READY'
  | 'NOT_STARTED'
  | 'PARTIAL'
  | 'IN_PROGRESS'
  | 'COMPLETED';

export interface UASStudentProgressInfo {
  code: UASStudentProgressCode;
  label: string;
  badgeClass: string;
  totalSessions: number;
  submittedSessions: number;
  inProgressSessions: number;
  readySessions: number;
  notReadySessions: number;
  progressText: string;
}

export interface UASProgressStats {
  total: number;
  notStarted: number;
  partial: number;
  inProgress: number;
  completed: number;
  notReady: number;
}

export interface UASHalaqahOption {
  name: string;
  studentCount: number;
  completedCount: number;
  remainingCount: number;
}

const STATUS_PRIORITY: Record<UASStudentProgressCode, number> = {
  IN_PROGRESS: 0,
  PARTIAL: 1,
  NOT_STARTED: 2,
  NOT_READY: 3,
  COMPLETED: 4
};

/**
 * Mengambil sesi aktif milik santri khusus untuk periode UAS terpilih.
 * Sesi berstatus `void` dan sesi dari periode lain selalu diabaikan.
 */
export function getActiveSessionsForPeriod(
  student: ExaminerStudentItem,
  periodId?: string
): ExamUASSession[] {
  const raw = Array.isArray(student.sessions) ? student.sessions : [];
  return raw.filter((s: any) => {
    if (!s || s.status === 'void') return false;
    const sPeriodId = s.examPeriodId || s.exam_period_id;
    if (periodId && sPeriodId && sPeriodId !== periodId) return false;
    return true;
  });
}

/**
 * Menentukan apakah satu sesi sudah memiliki persetujuan & paket soal untuk mulai diuji.
 */
export function isSessionPacketReady(sess: any): boolean {
  if (!sess || sess.status === 'void') return false;
  if (sess.status === 'submitted' || sess.status === 'in_progress') return true;
  const qSetId = sess.questionSetId || sess.question_set_id;
  const approval = sess.approvalStatus || sess.approval_status;
  const isApproved = approval === 'admin_approved' || Boolean(qSetId);
  return isApproved && Boolean(qSetId);
}

/**
 * Menghitung status progres keseluruhan satu santri pada satu periode UAS.
 * Setiap santri selalu menghasilkan tepat satu status utama.
 */
export function computeStudentUASProgress(
  student: ExaminerStudentItem,
  periodId?: string
): UASStudentProgressInfo {
  const activeSessions = getActiveSessionsForPeriod(student, periodId);
  const totalSessions = activeSessions.length;

  if (totalSessions > 0) {
    const submittedSessions = activeSessions.filter(s => s.status === 'submitted').length;
    const inProgressSessions = activeSessions.filter(s => s.status === 'in_progress').length;
    const readySessions = activeSessions.filter(
      s => s.status !== 'submitted' && s.status !== 'in_progress' && isSessionPacketReady(s)
    ).length;
    const notReadySessions = totalSessions - submittedSessions - inProgressSessions - readySessions;

    const progressText = `${submittedSessions} dari ${totalSessions} sesi selesai`;

    if (inProgressSessions > 0) {
      return {
        code: 'IN_PROGRESS',
        label: submittedSessions > 0 ? `Sedang Diuji (${submittedSessions}/${totalSessions})` : 'Sedang Diuji',
        badgeClass: 'bg-amber-50 text-amber-800 border border-amber-200',
        totalSessions,
        submittedSessions,
        inProgressSessions,
        readySessions,
        notReadySessions,
        progressText
      };
    }

    if (submittedSessions === totalSessions) {
      return {
        code: 'COMPLETED',
        label: 'Selesai',
        badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        totalSessions,
        submittedSessions,
        inProgressSessions,
        readySessions,
        notReadySessions,
        progressText
      };
    }

    if (submittedSessions > 0) {
      return {
        code: 'PARTIAL',
        label: 'Sebagian Selesai',
        badgeClass: 'bg-sky-50 text-sky-800 border border-sky-200',
        totalSessions,
        submittedSessions,
        inProgressSessions,
        readySessions,
        notReadySessions,
        progressText
      };
    }

    if (readySessions > 0) {
      return {
        code: 'NOT_STARTED',
        label: 'Belum Diuji',
        badgeClass: 'bg-teal-50 text-teal-800 border border-teal-200',
        totalSessions,
        submittedSessions,
        inProgressSessions,
        readySessions,
        notReadySessions,
        progressText
      };
    }

    return {
      code: 'NOT_READY',
      label: 'Belum Siap',
      badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
      totalSessions,
      submittedSessions,
      inProgressSessions,
      readySessions,
      notReadySessions,
      progressText
    };
  }

  // Tanpa sesi multi-sesi: santri tanpa sesi tidak boleh otomatis dianggap Selesai.
  // Hanya jika benar-benar ada attempt legacy dengan attemptId yang valid.
  if (student.attemptId && student.attemptStatus === 'in_progress') {
    return {
      code: 'IN_PROGRESS',
      label: 'Sedang Diuji',
      badgeClass: 'bg-amber-50 text-amber-800 border border-amber-200',
      totalSessions: 1,
      submittedSessions: 0,
      inProgressSessions: 1,
      readySessions: 0,
      notReadySessions: 0,
      progressText: '0 dari 1 sesi selesai'
    };
  }

  if (student.attemptId && student.attemptStatus === 'submitted') {
    return {
      code: 'COMPLETED',
      label: 'Selesai',
      badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      totalSessions: 1,
      submittedSessions: 1,
      inProgressSessions: 0,
      readySessions: 0,
      notReadySessions: 0,
      progressText: '1 dari 1 sesi selesai'
    };
  }

  return {
    code: 'NOT_READY',
    label: 'Belum Siap',
    badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
    totalSessions: 0,
    submittedSessions: 0,
    inProgressSessions: 0,
    readySessions: 0,
    notReadySessions: 0,
    progressText: 'Belum ada sesi'
  };
}

/**
 * Menghitung statistik progres berbasis jumlah santri (1 santri = 1 hitungan).
 */
export function computeUASProgressStats(
  students: ExaminerStudentItem[],
  periodId?: string
): UASProgressStats {
  const stats: UASProgressStats = {
    total: students.length,
    notStarted: 0,
    partial: 0,
    inProgress: 0,
    completed: 0,
    notReady: 0
  };

  for (const s of students) {
    const { code } = computeStudentUASProgress(s, periodId);
    if (code === 'NOT_STARTED') stats.notStarted++;
    else if (code === 'PARTIAL') stats.partial++;
    else if (code === 'IN_PROGRESS') stats.inProgress++;
    else if (code === 'COMPLETED') stats.completed++;
    else stats.notReady++;
  }

  return stats;
}

/**
 * Mengambil daftar halaqah aktual yang memiliki peserta pada periode UAS terpilih.
 * Tidak menggunakan daftar hardcode.
 */
export function extractActiveHalaqahs(
  students: ExaminerStudentItem[],
  periodId?: string
): UASHalaqahOption[] {
  const map = new Map<string, { studentCount: number; completedCount: number }>();

  for (const s of students) {
    const h = String(s.halaqah || '').trim();
    if (!h || h === '-') continue;
    const entry = map.get(h) || { studentCount: 0, completedCount: 0 };
    entry.studentCount++;
    if (computeStudentUASProgress(s, periodId).code === 'COMPLETED') {
      entry.completedCount++;
    }
    map.set(h, entry);
  }

  return Array.from(map.entries())
    .map(([name, info]) => ({
      name,
      studentCount: info.studentCount,
      completedCount: info.completedCount,
      remainingCount: info.studentCount - info.completedCount
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' }));
}

/**
 * Pengurutan stabil yang memprioritaskan santri yang belum selesai.
 */
export function sortUASStudentsByPriority(
  students: ExaminerStudentItem[],
  periodId?: string
): ExaminerStudentItem[] {
  return [...students].sort((a, b) => {
    const pa = STATUS_PRIORITY[computeStudentUASProgress(a, periodId).code];
    const pb = STATUS_PRIORITY[computeStudentUASProgress(b, periodId).code];
    if (pa !== pb) return pa - pb;
    const nameCmp = (a.studentName || '').localeCompare(b.studentName || '', 'id', { sensitivity: 'base' });
    if (nameCmp !== 0) return nameCmp;
    return (a.studentId || '').localeCompare(b.studentId || '');
  });
}

/**
 * Kunci penyimpanan preferensi halaqah per (loginUser, verifiedExaminer, period).
 * Menjamin pilihan halaqah tidak bocor antar penguji berbeda.
 */
export function buildHalaqahPrefKey(
  loginUserId: string,
  examinerId: string,
  periodId: string
): string {
  return `sita_uas_halaqah_pref_v1:${loginUserId || 'anon'}:${examinerId || 'self'}:${periodId || 'none'}`;
}
