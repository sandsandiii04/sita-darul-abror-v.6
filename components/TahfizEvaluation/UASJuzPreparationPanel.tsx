import React, { useMemo, useState, useEffect } from 'react';
import {
  AcademicTerm,
  ExamMaterialPart,
  ExamMaterialSnapshot,
  ExamParticipant,
  ExamPeriod,
  ExamUASMaterialRevision,
  ExamUASPrepSubmission,
  ExamUASSession,
  QuestionBankItem,
  Student,
  TahfidzRecord,
  User
} from '../../types';
import { api } from '../../api';
import { analyzeStudentJuzPartsAndSessions } from '../../services/uasJuzSegmentationService';
import { evaluateUASSessionEligibility } from '../../services/uasBulkEligibilityService';
import { UASAdminApprovalPanel } from './UASAdminApprovalPanel';
import { UASAdminRevisionPanel } from './UASAdminRevisionPanel';
import { UASManualPrepModal } from './UASManualPrepModal';
import { UASMaterialRevisionModal } from './UASMaterialRevisionModal';
import {
  BookOpen,
  RefreshCw,
  Layers,
  RotateCcw,
  AlertTriangle,
  Sliders,
  Search,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Info,
  X,
  BarChart3
} from 'lucide-react';

interface UASJuzPreparationPanelProps {
  user: User;
  period: ExamPeriod;
  term: AcademicTerm;
  participants: ExamParticipant[];
  students?: Student[];
  snapshots: ExamMaterialSnapshot[];
  records: TahfidzRecord[];
  refreshKey?: number;
  onOpenPrepareQuestions?: (studentId?: string) => void;
  onSessionsUpdated?: () => void;
}

export const UASJuzPreparationPanel: React.FC<UASJuzPreparationPanelProps> = ({
  user,
  period,
  term,
  participants,
  students = [],
  snapshots,
  records,
  refreshKey = 0,
  onOpenPrepareQuestions,
  onSessionsUpdated
}) => {
  const [serverParts, setServerParts] = useState<ExamMaterialPart[]>([]);
  const [serverSessions, setServerSessions] = useState<ExamUASSession[]>([]);
  const [serverSubmissions, setServerSubmissions] = useState<ExamUASPrepSubmission[]>([]);
  const [serverRevisions, setServerRevisions] = useState<ExamUASMaterialRevision[]>([]);
  const [bankQuestions, setBankQuestions] = useState<QuestionBankItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [busyPartId, setBusyPartId] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [halaqahFilter, setHalaqahFilter] = useState<string>('ALL');
  const [teacherFilter, setTeacherFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unverified' | 'draft' | 'needs_check' | 'pending_admin' | 'approved' | 'packet_ready'>('all');
  const [sessionCountFilter, setSessionCountFilter] = useState<'all' | 'none' | 'single' | 'multi'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [fullManualStudentId, setFullManualStudentId] = useState<string | null>(null);
  const [teacherDetailStudentId, setTeacherDetailStudentId] = useState<string | null>(null);
  const [directRevisionTarget, setDirectRevisionTarget] = useState<{
    studentId: string;
    studentName: string;
    studentClass: string;
    halaqah: string;
    session: ExamUASSession;
  } | null>(null);
  const [showSyncPreview, setShowSyncPreview] = useState(false);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [showAdvancedSummary, setShowAdvancedSummary] = useState(false);
  const [showExamRules, setShowExamRules] = useState(false);
  const [activeAdminTab, setActiveAdminTab] = useState<'prep' | 'approval' | 'revisions'>('prep');
  const [manualModal, setManualModal] = useState<{
    studentId: string;
    studentName: string;
    parts: ExamMaterialPart[];
    existingSession?: ExamUASSession;
    primaryPartId: string;
    sessionType: 'full_juz' | 'partial_half';
    sessionNumber: number;
    reason: string;
    error?: string | null;
  } | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isAdmin = user.role === 'admin';
  const isTeacher = user.role === 'teacher';
  const canEditPrep = isAdmin || isTeacher;

  const loadRemote = async () => {
    const [juzRes, bankRes, revRes] = await Promise.all([
      api.getUASJuzPartsAndSessions(period.id, user),
      api.getQuestionBankList({ status: 'active', examType: 'uas' }),
      api.getUASMaterialRevisions(period.id, null, user).catch(() => ({ success: false, revisions: [] }))
    ]);
    if (revRes?.success && Array.isArray(revRes.revisions)) {
      setServerRevisions(revRes.revisions);
    }
    if (juzRes.success) {
      setServerParts(
        (juzRes.parts || []).map((p: any) => ({
          id: p.id,
          examPeriodId: p.exam_period_id,
          studentId: p.student_id,
          snapshotId: p.snapshot_id,
          partOrder: p.part_order,
          juzNumber: p.juz_number,
          partType: p.part_type,
          startSurah: p.start_surah,
          startAyah: p.start_ayah,
          endSurah: p.end_surah,
          endAyah: p.end_ayah,
          startPage: p.start_page,
          endPage: p.end_page,
          coveredPages: p.covered_pages || [],
          coveredPagesCount: p.covered_pages_count || 0,
          juzTotalPages: p.juz_total_pages || 20,
          coverageRatio: Number(p.coverage_ratio || 0),
          segments: p.segments || [],
          hasGap: !!p.has_gap,
          status: p.status,
          teacherStatus: p.teacher_status,
          approvalStatus: p.approval_status,
          manualConfirmation: !!p.manual_confirmation,
          verificationNotes: p.verification_notes,
          evidenceRatio: p.evidence_ratio !== null && p.evidence_ratio !== undefined ? Number(p.evidence_ratio) : null,
          evidenceDiffers: !!p.evidence_differs,
          source: p.source || 'auto',
          rejectedReason: p.rejected_reason,
          revisionNumber: p.revision_number,
          reviewReason: p.review_reason,
          verifiedBy: p.verified_by,
          verifiedAt: p.verified_at,
          finalizedBy: p.finalized_by,
          finalizedAt: p.finalized_at
        }))
      );
      setServerSessions(
        (juzRes.sessions || [])
          .filter((s: any) => s.status !== 'void')
          .map((s: any) => ({
          id: s.id,
          examPeriodId: s.exam_period_id,
          studentId: s.student_id,
          sessionNumber: s.session_number,
          sessionType: s.session_type,
          primaryPartId: s.primary_part_id,
          juzNumber: s.juz_number,
          supplementalParts: s.supplemental_parts || [],
          coveredPages: s.covered_pages || [],
          startSurah: s.start_surah,
          startAyah: s.start_ayah,
          endSurah: s.end_surah,
          endAyah: s.end_ayah,
          startPage: s.start_page,
          endPage: s.end_page,
          questionSetId: s.question_set_id,
          attemptId: s.attempt_id,
          source: s.source || 'auto',
          createdBy: s.created_by,
          createdByName: s.created_by_name,
          changeReason: s.change_reason,
          approvalStatus: s.approval_status,
          rejectedReason: s.rejected_reason,
          isLocked: !!s.is_locked,
          revisionNumber: s.revision_number,
          status: s.status,
          score: s.score,
          predikat: s.predikat,
          actualExaminerId: s.actual_examiner_id,
          actualExaminerName: s.actual_examiner_name,
          examinerHistory: s.examiner_history || []
        }))
      );
      setServerSubmissions(
        (juzRes.submissions || []).map((sub: any) => ({
          id: sub.id,
          examPeriodId: sub.exam_period_id,
          studentId: sub.student_id,
          teacherId: sub.teacher_id,
          teacherName: sub.teacher_name,
          halaqah: sub.halaqah,
          studentName: sub.student_name,
          studentClass: sub.student_class,
          status: sub.status,
          isException: !!sub.is_exception,
          exceptionReason: sub.exception_reason,
          revisionNumber: sub.revision_number || 1,
          fullJuzCount: sub.full_juz_count || 0,
          partialJuzCount: sub.partial_juz_count || 0,
          manualSessionCount: sub.manual_session_count || 0,
          totalSessionCount: sub.total_session_count || 0,
          hasManualOverride: !!sub.has_manual_override,
          manualConfirmation: !!sub.manual_confirmation,
          verificationNotes: sub.verification_notes,
          evidenceSummary: Array.isArray(sub.evidence_summary) ? sub.evidence_summary : [],
          submittedAt: sub.submitted_at,
          approvedBy: sub.approved_by,
          approvedByName: sub.approved_by_name,
          approvedAt: sub.approved_at,
          rejectedReason: sub.rejected_reason
        }))
      );
    }
    if (bankRes?.data) {
      setBankQuestions(bankRes.data);
    }
  };

  useEffect(() => {
    loadRemote();
  }, [period.id, refreshKey]);

  const teacherNameById = useMemo(() => {
    const map = new Map<string, string>();
    try {
      const raw = localStorage.getItem('sita_users_v1');
      if (raw) {
        const uList: User[] = JSON.parse(raw);
        uList.forEach(u => {
          if (u.id && u.name) map.set(u.id, u.name);
        });
      }
    } catch {
      // Ignore storage read errors
    }
    serverSubmissions.forEach(sub => {
      if (sub.teacherId && sub.teacherName) map.set(sub.teacherId, sub.teacherName);
    });
    return map;
  }, [serverSubmissions]);

  const studentById = useMemo(() => {
    const map = new Map<string, Student>();
    students.forEach(st => map.set(st.id, st));
    return map;
  }, [students]);

  const studentRows = useMemo(() => {
    const snapMap = new Map<string, ExamMaterialSnapshot>();
    snapshots.forEach(s => snapMap.set(s.studentId, s));

    const partsByStudent = new Map<string, ExamMaterialPart[]>();
    serverParts.forEach(p => {
      const list = partsByStudent.get(p.studentId) || [];
      list.push(p);
      partsByStudent.set(p.studentId, list);
    });

    const sessByStudent = new Map<string, ExamUASSession[]>();
    serverSessions.forEach(s => {
      const list = sessByStudent.get(s.studentId) || [];
      list.push(s);
      sessByStudent.set(s.studentId, list);
    });

    const subByStudent = new Map<string, ExamUASPrepSubmission>();
    serverSubmissions.forEach(sub => subByStudent.set(sub.studentId, sub));

    // Deduplicate participants by studentId to avoid any duplicates
    const dedupMap = new Map<string, ExamParticipant>();
    participants.forEach(p => {
      if (!dedupMap.has(p.studentId)) dedupMap.set(p.studentId, p);
    });
    const uniqueParticipants = Array.from(dedupMap.values());

    const scopedParticipants = isTeacher
      ? uniqueParticipants.filter(
          p => p.teacherId === user.id || p.halaqah?.toLowerCase().includes(user.name.toLowerCase())
        )
      : uniqueParticipants;

    // Stable deterministic sorting by studentName then studentId
    const sortedParticipants = [...scopedParticipants].sort((a, b) => {
      const nameCmp = (a.studentName || '').localeCompare(b.studentName || '', 'id', { sensitivity: 'base' });
      if (nameCmp !== 0) return nameCmp;
      return (a.studentId || '').localeCompare(b.studentId || '');
    });

    return sortedParticipants.map(p => {
      const snap = snapMap.get(p.studentId);
      const stObj = studentById.get(p.studentId);
      const existingParts = partsByStudent.get(p.studentId) || [];
      const analysis = analyzeStudentJuzPartsAndSessions({
        studentId: p.studentId,
        periodId: period.id,
        term,
        period,
        records,
        snapshotId: snap?.id || null,
        existingParts
      });

      const savedSessions = sessByStudent.get(p.studentId);
      const effectiveSessions = (savedSessions && savedSessions.length > 0) ? savedSessions : analysis.sessions;
      const sessionEligibilities = effectiveSessions.map(s => {
        const primary = analysis.parts.find(pt => pt.id === s.primaryPartId || pt.juzNumber === s.juzNumber) || null;
        return evaluateUASSessionEligibility({
          session: s,
          primaryPart: primary,
          bankQuestions
        });
      });

      const submission = subByStudent.get(p.studentId) || null;
      const subSt = submission?.status;
      const allGenerated = effectiveSessions.length > 0 && effectiveSessions.every(s => Boolean(s.questionSetId));
      const generatedCount = effectiveSessions.filter(s => Boolean(s.questionSetId)).length;
      const hasSessionCoverageMismatch = effectiveSessions.some(s => {
        const pt = analysis.parts.find(ptItem => ptItem.id === s.primaryPartId || ptItem.juzNumber === s.juzNumber);
        if (pt?.manualConfirmation || submission?.manualConfirmation) return false;
        return s.sessionType === 'full_juz' && (!pt || pt.coverageRatio < 1 || pt.hasGap || pt.partType !== 'full_juz');
      });
      const hasIssue =
        analysis.anomalies.length > 0 ||
        analysis.hasUnverifiedGaps ||
        (analysis.parts.length > 0 && analysis.needsAdminDecision) ||
        hasSessionCoverageMismatch ||
        Boolean(submission?.rejectedReason);

      const hasDraft = analysis.parts.some(pt => pt.teacherStatus === 'draft_manual') || subSt === 'draft';

      let statusKey: 'unverified' | 'draft' | 'needs_check' | 'pending_admin' | 'approved' | 'packet_ready';
      let statusLabel: string;
      let statusCls: string;

      if (subSt === 'admin_approved' && allGenerated) {
        statusKey = 'packet_ready';
        statusLabel = 'Paket Siap';
        statusCls = 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      } else if (subSt === 'admin_approved') {
        statusKey = 'approved';
        statusLabel = 'Disetujui';
        statusCls = 'bg-teal-50 text-teal-800 border border-teal-200';
      } else if (subSt === 'pending_admin_approval' || subSt === 'exception_pending') {
        statusKey = 'pending_admin';
        statusLabel = 'Menunggu Admin';
        statusCls = 'bg-sky-50 text-sky-800 border border-sky-200';
      } else if (subSt === 'rejected' || subSt === 'needs_correction' || subSt === 'stale' || hasIssue) {
        statusKey = 'needs_check';
        statusLabel = subSt === 'stale' ? 'Perlu Diperiksa Ulang' : 'Perlu Dicek';
        statusCls = 'bg-amber-50 text-amber-800 border border-amber-200';
      } else if (hasDraft) {
        statusKey = 'draft';
        statusLabel = 'Draft';
        statusCls = 'bg-slate-100 text-slate-700 border border-slate-200';
      } else {
        statusKey = 'unverified';
        statusLabel = 'Belum Diperiksa';
        statusCls = 'bg-slate-100 text-slate-600 border border-slate-200';
      }

      const resolvedTeacherName =
        submission?.teacherName ||
        (p.teacherId ? teacherNameById.get(p.teacherId) : undefined) ||
        (stObj?.teacherId ? teacherNameById.get(stObj.teacherId) : undefined) ||
        '';
      const resolvedNis = stObj?.nis || '';

      return {
        participant: p,
        studentNis: resolvedNis,
        teacherName: resolvedTeacherName,
        analysis,
        sessions: effectiveSessions,
        sessionEligibilities,
        submission,
        hasIssue,
        hasSessionCoverageMismatch,
        allGenerated,
        generatedCount,
        statusKey,
        statusLabel,
        statusCls
      };
    });
  }, [participants, snapshots, serverParts, serverSessions, serverSubmissions, period, term, records, bankQuestions, isTeacher, user.id, user.name, studentById, teacherNameById]);

  const summary = useMemo(() => {
    let totalStudents = studentRows.length;
    let needsCheckStudents = 0;
    let pendingAdminStudents = 0;
    let approvedStudents = 0;
    let totalSessions = 0;
    let fullSessions = 0;
    let partialSessions = 0;
    let multiSessionStudents = 0;
    let needsDecision = 0;
    let readyPartsCount = 0;
    let needsReviewPartsCount = 0;
    let needsDecisionPartsCount = 0;
    let uncheckedCount = 0;
    let bankShort = 0;

    studentRows.forEach(r => {
      if (r.statusKey === 'needs_check') needsCheckStudents++;
      else if (r.statusKey === 'pending_admin') pendingAdminStudents++;
      else if (r.statusKey === 'approved' || r.statusKey === 'packet_ready') approvedStudents++;

      if (r.sessions.length > 1) multiSessionStudents++;
      totalSessions += r.sessions.length;
      fullSessions += r.sessions.filter(s => s.sessionType === 'full_juz').length;
      partialSessions += r.sessions.filter(s => s.sessionType === 'partial_half').length;
      if (r.analysis.needsAdminDecision) needsDecision++;

      r.analysis.parts.forEach(pt => {
        if (pt.status === 'ready') readyPartsCount++;
        else if (pt.status === 'needs_review') needsReviewPartsCount++;
        else if (pt.status === 'needs_admin_decision') needsDecisionPartsCount++;
      });

      r.sessionEligibilities.forEach(e => {
        if (e.status === 'BANK_SOAL_KURANG') bankShort++;
        else if (e.status !== 'SIAP_GENERATE' && e.status !== 'SUDAH_ADA') uncheckedCount++;
      });
    });

    return {
      totalStudents,
      needsCheckStudents,
      pendingAdminStudents,
      approvedStudents,
      totalSessions,
      fullSessions,
      partialSessions,
      multiSessionStudents,
      needsDecision,
      readyPartsCount,
      needsReviewPartsCount,
      needsDecisionPartsCount,
      uncheckedCount,
      bankShort
    };
  }, [studentRows]);

  const distinctClasses = useMemo(
    () => Array.from(new Set(studentRows.map(r => r.participant.class).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id')),
    [studentRows]
  );
  const distinctHalaqahs = useMemo(
    () => Array.from(new Set(studentRows.map(r => r.participant.halaqah).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id')),
    [studentRows]
  );
  const distinctTeachers = useMemo(
    () => Array.from(new Set(studentRows.map(r => r.teacherName).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id')),
    [studentRows]
  );

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return studentRows.filter(r => {
      if (q) {
        const matchName = (r.participant.studentName || '').toLowerCase().includes(q);
        const matchNis = (r.studentNis || '').toLowerCase().includes(q);
        const matchClass = (r.participant.class || '').toLowerCase().includes(q);
        const matchHalaqah = (r.participant.halaqah || '').toLowerCase().includes(q);
        const matchTeacher = (r.teacherName || '').toLowerCase().includes(q);
        if (!matchName && !matchNis && !matchClass && !matchHalaqah && !matchTeacher) return false;
      }
      if (classFilter !== 'ALL' && r.participant.class !== classFilter) return false;
      if (halaqahFilter !== 'ALL' && r.participant.halaqah !== halaqahFilter) return false;
      if (teacherFilter !== 'ALL' && r.teacherName !== teacherFilter) return false;
      if (statusFilter !== 'all') {
        if (statusFilter === 'approved') {
          if (r.statusKey !== 'approved' && r.statusKey !== 'packet_ready') return false;
        } else if (r.statusKey !== statusFilter) {
          return false;
        }
      }
      if (sessionCountFilter === 'none' && r.sessions.length !== 0) return false;
      if (sessionCountFilter === 'single' && r.sessions.length !== 1) return false;
      if (sessionCountFilter === 'multi' && r.sessions.length <= 1) return false;
      return true;
    });
  }, [studentRows, searchQuery, classFilter, halaqahFilter, teacherFilter, statusFilter, sessionCountFilter]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    classFilter !== 'ALL' ||
    halaqahFilter !== 'ALL' ||
    teacherFilter !== 'ALL' ||
    statusFilter !== 'all' ||
    sessionCountFilter !== 'all';

  const resetAllFilters = () => {
    setSearchQuery('');
    setClassFilter('ALL');
    setHalaqahFilter('ALL');
    setTeacherFilter('ALL');
    setStatusFilter('all');
    setSessionCountFilter('all');
    setPage(1);
  };

  // Reset pagination to page 1 whenever filters or pageSize change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, classFilter, halaqahFilter, teacherFilter, statusFilter, sessionCountFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const paginatedRows = useMemo(
    () => filteredRows.slice(startIdx, startIdx + pageSize),
    [filteredRows, startIdx, pageSize]
  );

  const handleSyncAllToServer = async () => {
    if (!canEditPrep) return;
    setIsSyncing(true);
    setMsg(null);
    let okCount = 0;
    try {
      for (const row of studentRows) {
        if (row.analysis.parts.length === 0) continue;
        const res = await api.saveUASJuzPartsAndSessions(
          period.id,
          row.participant.studentId,
          row.analysis.parts,
          row.analysis.sessions,
          user
        );
        if (res.success) okCount++;
      }
      await loadRemote();
      onSessionsUpdated?.();
      setMsg({ type: 'success', text: `Sinkronisasi materi per juz & rencana sesi UAS selesai untuk ${okCount} santri.` });
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.message || 'Gagal menyinkronkan materi per juz.' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePartAction = async (part: ExamMaterialPart, action: 'verify' | 'finalize' | 'exclude', row: (typeof studentRows)[number]) => {
    if (!canEditPrep) return;
    if (action === 'finalize' && !isAdmin) return;
    const reasonText = action === 'verify'
      ? (isAdmin ? 'Diverifikasi oleh Admin' : 'Diverifikasi oleh Guru Halaqah')
      : undefined;
    setBusyPartId(part.id);
    setMsg(null);
    try {
      if (!serverParts.some(sp => sp.id === part.id)) {
        await api.saveUASJuzPartsAndSessions(
          period.id,
          row.participant.studentId,
          row.analysis.parts,
          row.analysis.sessions,
          user
        );
      }
      const res = await api.verifyOrFinalizeUASMaterialPart(part.id, action, reasonText, user);
      if (res.success) {
        await loadRemote();
        onSessionsUpdated?.();
        setMsg({ type: 'success', text: `Juz ${part.juzNumber} (${row.participant.studentName}) berhasil di-${action}.` });
      } else {
        setMsg({ type: 'error', text: res.message || 'Gagal memperbarui status bagian juz.' });
      }
    } finally {
      setBusyPartId(null);
    }
  };

  const openManualSessionModal = (row: (typeof studentRows)[number], existingSession?: ExamUASSession) => {
    const eligibleParts = row.analysis.parts.filter(p => p.status !== 'excluded');
    if (eligibleParts.length === 0) {
      setMsg({ type: 'error', text: 'Santri belum memiliki bagian materi juz untuk dibuatkan sesi manual.' });
      return;
    }
    const defaultPart = eligibleParts.find(p => p.id === existingSession?.primaryPartId) || eligibleParts[0];
    const nextNum = existingSession?.sessionNumber || (row.sessions.reduce((m, s) => Math.max(m, s.sessionNumber), 0) + 1);
    setManualModal({
      studentId: row.participant.studentId,
      studentName: row.participant.studentName,
      parts: eligibleParts,
      existingSession,
      primaryPartId: defaultPart.id,
      sessionType: existingSession?.sessionType || (defaultPart.partType === 'full_juz' ? 'full_juz' : 'partial_half'),
      sessionNumber: nextNum,
      reason: existingSession?.changeReason || ''
    });
  };

  const handleSaveManualSession = async () => {
    if (!manualModal) return;
    const effectiveReason = manualModal.reason.trim().length >= 5
      ? manualModal.reason.trim()
      : (isAdmin ? 'Sesi diatur oleh Admin' : 'Sesi diatur oleh Guru Halaqah');
    const row = studentRows.find(r => r.participant.studentId === manualModal.studentId);
    if (!row) return;
    // Pastikan part sudah tersimpan di server terlebih dahulu
    if (!serverParts.some(sp => sp.id === manualModal.primaryPartId)) {
      await api.saveUASJuzPartsAndSessions(
        period.id,
        row.participant.studentId,
        row.analysis.parts,
        row.analysis.sessions,
        user
      );
    }
    const part = manualModal.parts.find(p => p.id === manualModal.primaryPartId);
    const res = await api.upsertUASManualSession(
      period.id,
      manualModal.studentId,
      {
        id: manualModal.existingSession?.id || undefined,
        sessionNumber: manualModal.sessionNumber,
        sessionType: manualModal.sessionType,
        primaryPartId: manualModal.primaryPartId,
        coveredPages: part?.coveredPages || [],
        startSurah: part?.startSurah,
        startAyah: part?.startAyah,
        endSurah: part?.endSurah,
        endAyah: part?.endAyah,
        startPage: part?.startPage,
        endPage: part?.endPage
      },
      effectiveReason,
      user
    );
    if (res.success) {
      setManualModal(null);
      await loadRemote();
      onSessionsUpdated?.();
      setMsg({ type: 'success', text: `Sesi ${manualModal.studentName} berhasil disimpan.` });
    } else {
      setManualModal(m => m ? { ...m, error: res.message || 'Gagal menyimpan sesi.' } : null);
    }
  };

  const handleDeleteManualSession = async (sessionId: string, studentName: string) => {
    const res = await api.deleteUASManualSession(sessionId, 'Sesi draft dihapus Guru Halaqah', user);
    if (res.success) {
      await loadRemote();
      onSessionsUpdated?.();
      setMsg({ type: 'success', text: `Sesi draft ${studentName} berhasil dihapus.` });
    } else {
      setMsg({ type: 'error', text: res.message || 'Gagal menghapus sesi.' });
    }
  };

  const handleSubmitForApproval = async (row: (typeof studentRows)[number], isException = false) => {
    let excReason: string | undefined;
    if (isException) {
      const r = window.prompt(`Alasan pengajuan pengecualian khusus untuk ${row.participant.studentName} (min. 5 karakter):`);
      if (!r || r.trim().length < 5) return;
      excReason = r.trim();
    }
    // Sinkronkan part/sesi ke server sebelum submit jika belum ada
    const hasUnsavedParts = row.analysis.parts.some(p => !serverParts.some(sp => sp.id === p.id));
    if (row.analysis.parts.length > 0 && hasUnsavedParts) {
      await api.saveUASJuzPartsAndSessions(
        period.id,
        row.participant.studentId,
        row.analysis.parts,
        row.analysis.sessions,
        user
      );
    }
    const res = await api.submitUASPrepForApproval(period.id, row.participant.studentId, isException, excReason, user);
    if (res.success) {
      await loadRemote();
      onSessionsUpdated?.();
      setMsg({ type: 'success', text: `${row.participant.studentName} berhasil diajukan ke Admin (${res.status}).` });
    } else {
      setMsg({ type: 'error', text: res.message || 'Gagal mengirim pengajuan ke Admin.' });
    }
  };

  const handleReopenRevision = async (row: (typeof studentRows)[number]) => {
    const reason = window.prompt(`Alasan membuka revisi baru untuk ${row.participant.studentName} (min. 5 karakter):`);
    if (!reason || reason.trim().length < 5) return;
    const res = await api.reopenUASPrepRevision(period.id, row.participant.studentId, reason.trim(), user);
    if (res.success) {
      await loadRemote();
      onSessionsUpdated?.();
      setMsg({ type: 'success', text: `Revisi #${res.revisionNumber} dibuka. Silakan sesuaikan dan ajukan ulang ke Admin.` });
    } else {
      setMsg({ type: 'error', text: res.message || 'Gagal membuka revisi baru.' });
    }
  };

  const pendingApprovalCount = serverSubmissions.filter(s => s.status === 'pending_admin_approval' || s.status === 'exception_pending').length;
  const pendingRevisionCount = serverRevisions.filter(r => r.status === 'pending' || r.status === 'on_hold_in_progress').length;

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveAdminTab('prep')}
              className={`px-4 py-2 rounded-2xl text-xs font-extrabold border transition-colors ${
                activeAdminTab === 'prep' ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              1. Persiapan Materi
            </button>
            <button
              onClick={() => setActiveAdminTab('approval')}
              className={`px-4 py-2 rounded-2xl text-xs font-extrabold border transition-colors flex items-center gap-2 ${
                activeAdminTab === 'approval' ? 'bg-indigo-700 text-white border-indigo-700' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span>2. Persetujuan Guru</span>
              {pendingApprovalCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-slate-900 text-[10px] font-black">{pendingApprovalCount}</span>
              )}
            </button>
            <button
              onClick={() => setActiveAdminTab('revisions')}
              className={`px-4 py-2 rounded-2xl text-xs font-extrabold border transition-colors flex items-center gap-2 ${
                activeAdminTab === 'revisions' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span>Pengajuan Revisi Materi UAS</span>
              {pendingRevisionCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-black">{pendingRevisionCount}</span>
              )}
            </button>
            {onOpenPrepareQuestions && (
              <button
                onClick={() => onOpenPrepareQuestions()}
                className="px-4 py-2 rounded-2xl text-xs font-extrabold border border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                3. Siapkan Soal
              </button>
            )}
          </div>
        </div>
      )}

      {isAdmin && activeAdminTab === 'approval' ? (
        <UASAdminApprovalPanel
          user={user}
          period={period}
          submissions={serverSubmissions}
          parts={serverParts}
          sessions={serverSessions}
          onRefresh={loadRemote}
          onOpenStudentPrep={(sid) => setFullManualStudentId(sid)}
          onPrepareQuestions={onOpenPrepareQuestions}
        />
      ) : isAdmin && activeAdminTab === 'revisions' ? (
        <UASAdminRevisionPanel
          user={user}
          period={period}
          revisions={serverRevisions}
          onRefresh={async () => {
            await loadRemote();
            onSessionsUpdated?.();
          }}
          onPrepareReplacementPacket={(sid) => onOpenPrepareQuestions?.(sid)}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
          {/* Clean Header + Opsi Lainnya */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Layers size={18} className="text-teal-700 shrink-0" />
                <h2 className="text-base font-extrabold text-slate-900">
                  Persiapan Materi UAS
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Batas setoran: <strong className="text-slate-700">{period.materialCutoffDate}</strong>
              </p>
            </div>

            {canEditPrep && (
              <div className="relative self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setShowMoreOptions(prev => !prev)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <MoreHorizontal size={15} />
                  <span>Opsi Lainnya</span>
                </button>
                {showMoreOptions && (
                  <div className="absolute right-0 mt-1.5 w-56 bg-white rounded-2xl border border-slate-200 shadow-lg py-1.5 z-30 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMoreOptions(false);
                        setShowSyncPreview(true);
                      }}
                      disabled={isSyncing}
                      className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 font-semibold flex items-center gap-2 disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={isSyncing ? 'animate-spin text-teal-600' : 'text-teal-600'} />
                      <span>Muat Sugesti dari Setoran</span>
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowMoreOptions(false);
                          setShowAdvancedSummary(true);
                        }}
                        className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 font-semibold flex items-center gap-2"
                      >
                        <BarChart3 size={14} className="text-slate-500" />
                        <span>Ringkasan Lanjutan</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowMoreOptions(false);
                        setShowExamRules(true);
                      }}
                      className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 font-semibold flex items-center gap-2"
                    >
                      <Info size={14} className="text-slate-500" />
                      <span>Aturan Ujian UAS</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pratinjau Sugesti Setoran (hanya muncul jika diminta dari Opsi Lainnya) */}
          {showSyncPreview && canEditPrep && (
            <div className="p-4 rounded-2xl border border-teal-200 bg-teal-50/60 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-teal-950">Muat Sugesti dari Setoran</div>
                <button onClick={() => setShowSyncPreview(false)} className="text-slate-500 hover:text-slate-800 font-bold">Tutup</button>
              </div>
              <p className="text-[11px] text-teal-900">
                Menyimpan usulan materi dan sesi dari setoran hafalan sebagai draft untuk {summary.totalStudents} santri tanpa mengunci paket soal atau membuka ujian.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowSyncPreview(false)} className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold">Batal</button>
                <button
                  onClick={async () => {
                    setShowSyncPreview(false);
                    await handleSyncAllToServer();
                  }}
                  disabled={isSyncing}
                  className="px-4 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold"
                >
                  {isSyncing ? 'Memproses...' : 'Jalankan Sugesti'}
                </button>
              </div>
            </div>
          )}

          {msg && (
            <div className={`p-3 rounded-xl text-xs font-semibold border flex items-center justify-between gap-2 ${msg.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
              <span>{msg.text}</span>
              <button type="button" onClick={() => setMsg(null)} className="opacity-60 hover:opacity-100 font-bold">✕</button>
            </div>
          )}

          {/* 4 Simple Student-Level Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`p-3.5 rounded-xl border text-left transition-colors ${
                statusFilter === 'all'
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100'
              }`}
            >
              <div className="text-[11px] opacity-80 font-medium">Total Santri</div>
              <div className="text-xl font-black mt-0.5">{summary.totalStudents}</div>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('needs_check')}
              className={`p-3.5 rounded-xl border text-left transition-colors ${
                statusFilter === 'needs_check'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-amber-50/70 border-amber-200 text-amber-900 hover:bg-amber-100/70'
              }`}
            >
              <div className="text-[11px] opacity-80 font-medium">Perlu Dicek</div>
              <div className="text-xl font-black mt-0.5">{summary.needsCheckStudents}</div>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('pending_admin')}
              className={`p-3.5 rounded-xl border text-left transition-colors ${
                statusFilter === 'pending_admin'
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-sky-50/70 border-sky-200 text-sky-900 hover:bg-sky-100/70'
              }`}
            >
              <div className="text-[11px] opacity-80 font-medium">Menunggu Admin</div>
              <div className="text-xl font-black mt-0.5">{summary.pendingAdminStudents}</div>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('approved')}
              className={`p-3.5 rounded-xl border text-left transition-colors ${
                statusFilter === 'approved'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-emerald-50/70 border-emerald-200 text-emerald-900 hover:bg-emerald-100/70'
              }`}
            >
              <div className="text-[11px] opacity-80 font-medium">Disetujui</div>
              <div className="text-xl font-black mt-0.5">{summary.approvedStudents}</div>
            </button>
          </div>

          {/* Compact Filter Bar (Search + Dropdowns + Reset) */}
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 text-xs">
              <div className="relative sm:col-span-2 lg:col-span-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Cari nama atau NIS..."
                  aria-label="Cari nama atau NIS"
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>

              <select
                value={classFilter}
                onChange={e => setClassFilter(e.target.value)}
                aria-label="Filter Kelas"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              >
                <option value="ALL">Semua Kelas</option>
                {distinctClasses.map(c => (
                  <option key={c} value={c}>Kelas {c}</option>
                ))}
              </select>

              <select
                value={halaqahFilter}
                onChange={e => setHalaqahFilter(e.target.value)}
                aria-label="Filter Halaqah"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              >
                <option value="ALL">Semua Halaqah</option>
                {distinctHalaqahs.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>

              {!isTeacher && (
                <select
                  value={teacherFilter}
                  onChange={e => setTeacherFilter(e.target.value)}
                  aria-label="Filter Guru Halaqah"
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                >
                  <option value="ALL">Semua Guru</option>
                  {distinctTeachers.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as any)}
                aria-label="Filter Status Materi"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              >
                <option value="all">Semua Status</option>
                <option value="unverified">Belum Diperiksa</option>
                <option value="draft">Draft</option>
                <option value="needs_check">Perlu Dicek</option>
                <option value="pending_admin">Menunggu Admin</option>
                <option value="approved">Disetujui</option>
                <option value="packet_ready">Paket Siap</option>
              </select>

              <select
                value={sessionCountFilter}
                onChange={e => setSessionCountFilter(e.target.value as any)}
                aria-label="Filter Jumlah Sesi"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              >
                <option value="all">Semua Sesi</option>
                <option value="none">Belum Ada Sesi</option>
                <option value="single">Satu Sesi</option>
                <option value="multi">Multi-Sesi</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span>
                  {filteredRows.length === 0
                    ? '0 santri ditemukan'
                    : `Menampilkan ${startIdx + 1}–${Math.min(startIdx + pageSize, filteredRows.length)} dari ${filteredRows.length} santri`}
                </span>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold hover:bg-slate-100"
                  >
                    Reset Filter
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <span>Per halaman:</span>
                <select
                  value={pageSize}
                  onChange={e => setPageSize(Number(e.target.value))}
                  aria-label="Jumlah santri per halaman"
                  className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 font-bold"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
          </div>

          {/* Simplified Responsive Student Cards */}
          {paginatedRows.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 bg-slate-50/70 rounded-2xl border border-slate-200">
              Tidak ada santri yang sesuai.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {paginatedRows.map(row => {
                const subSt = row.submission?.status;
                const juzSummary = row.sessions.length > 0
                  ? row.sessions.map(s => `Juz ${s.juzNumber} (${s.sessionType === 'full_juz' ? 'Juz Penuh' : 'Parsial'})`).join(', ')
                  : row.analysis.parts.length > 0
                    ? row.analysis.parts.map(pt => `Juz ${pt.juzNumber}`).join(', ')
                    : 'Belum diatur';

                const primaryAction = (() => {
                  if (isAdmin && subSt === 'admin_approved' && !row.allGenerated && onOpenPrepareQuestions) {
                    return {
                      label: 'Siapkan Soal',
                      cls: 'bg-emerald-600 hover:bg-emerald-700 text-white',
                      onClick: () => onOpenPrepareQuestions(row.participant.studentId)
                    };
                  }
                  if (isAdmin && (subSt === 'pending_admin_approval' || subSt === 'exception_pending')) {
                    return {
                      label: 'Periksa',
                      cls: 'bg-teal-600 hover:bg-teal-700 text-white',
                      onClick: () => setFullManualStudentId(row.participant.studentId)
                    };
                  }
                  if (!isAdmin && subSt === 'admin_approved') {
                    return {
                      label: 'Lihat Detail',
                      cls: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300',
                      onClick: () => setTeacherDetailStudentId(row.participant.studentId)
                    };
                  }
                  if (isAdmin && subSt === 'admin_approved' && row.allGenerated) {
                    return {
                      label: 'Lihat Detail',
                      cls: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300',
                      onClick: () => setTeacherDetailStudentId(row.participant.studentId)
                    };
                  }
                  return {
                    label: 'Atur Materi & Sesi',
                    cls: 'bg-teal-600 hover:bg-teal-700 text-white',
                    onClick: () => setFullManualStudentId(row.participant.studentId)
                  };
                })();

                return (
                  <div
                    key={row.participant.studentId}
                    className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col justify-between gap-3 hover:border-slate-300 transition-colors"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-slate-900 truncate">
                            {row.participant.studentName}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {row.participant.class} • {row.participant.halaqah}
                            {row.studentNis ? ` • NIS ${row.studentNis}` : ''}
                            {isAdmin && row.teacherName ? ` • ${row.teacherName}` : ''}
                          </div>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${row.statusCls}`}>
                          {row.statusLabel}
                        </span>
                      </div>

                      <div className="text-xs text-slate-700 flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
                        <span className="font-bold text-teal-700">{row.sessions.length} Sesi</span>
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-600 truncate">{juzSummary}</span>
                      </div>

                      {row.submission?.hasManualOverride && (
                        <div>
                          <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            Ditetapkan Manual oleh Guru
                          </span>
                        </div>
                      )}

                      {row.hasIssue && (
                        <div className="text-xs text-amber-800 font-semibold flex items-center gap-1.5 pt-0.5">
                          <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                          <span>Materi perlu diperiksa.</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setTeacherDetailStudentId(row.participant.studentId)}
                        className="text-xs font-bold text-slate-600 hover:text-teal-700 py-1.5 px-2 rounded-lg hover:bg-slate-50"
                      >
                        Detail
                      </button>
                      <button
                        type="button"
                        onClick={primaryAction.onClick}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${primaryAction.cls}`}
                      >
                        {primaryAction.label}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination Footer */}
          {filteredRows.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t border-slate-100 text-xs">
              <span className="text-slate-500 font-medium">
                Halaman <strong className="text-slate-800">{safePage}</strong> dari <strong className="text-slate-800">{totalPages}</strong> ({filteredRows.length} santri)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                >
                  <ChevronLeft size={14} />
                  <span>Sebelumnya</span>
                </button>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                >
                  <span>Berikutnya</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Tambah / Edit Sesi Manual */}
      {manualModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 space-y-3 shadow-xl text-xs">
            <div className="font-extrabold text-base text-slate-900">
              {manualModal.existingSession ? 'Edit Sesi Ujian' : 'Tambah Sesi Ujian'} — {manualModal.studentName}
            </div>
            {manualModal.error && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold text-xs">
                {manualModal.error}
              </div>
            )}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Materi Juz</label>
              <select
                value={manualModal.primaryPartId}
                onChange={e => setManualModal(m => m ? { ...m, primaryPartId: e.target.value, error: null } : null)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white"
              >
                {manualModal.parts.map(pt => (
                  <option key={pt.id} value={pt.id}>
                    Juz {pt.juzNumber} — {pt.partType === 'full_juz' ? '1 Juz Penuh' : pt.partType === 'partial_half' ? 'Setengah Juz' : 'Kurang dari ½ Juz'} ({Math.round(pt.coverageRatio * 100)}%)
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Jenis Ujian</label>
                <select
                  value={manualModal.sessionType}
                  onChange={e => setManualModal(m => m ? { ...m, sessionType: e.target.value as 'full_juz' | 'partial_half', error: null } : null)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white"
                >
                  <option value="full_juz">1 Juz Penuh (9 Soal)</option>
                  <option value="partial_half">Setengah Juz / Parsial (4 Soal)</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Nomor Sesi</label>
                <input
                  type="number"
                  min={1}
                  value={manualModal.sessionNumber}
                  onChange={e => setManualModal(m => m ? { ...m, sessionNumber: Number(e.target.value) || 1, error: null } : null)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setManualModal(null)} className="px-3 py-2 rounded-xl border border-slate-300 font-bold">Batal</button>
              <button onClick={handleSaveManualSession} className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold">
                Simpan Sesi
              </button>
            </div>
          </div>
        </div>
      )}
      {fullManualStudentId && (() => {
        const targetRow = studentRows.find(r => r.participant.studentId === fullManualStudentId);
        if (!targetRow) return null;
        return (
          <UASManualPrepModal
            key={`${period.id}_${targetRow.participant.studentId}`}
            isOpen={true}
            onClose={() => setFullManualStudentId(null)}
            period={period}
            term={term}
            studentId={targetRow.participant.studentId}
            studentName={targetRow.participant.studentName}
            studentClass={targetRow.participant.class}
            halaqah={targetRow.participant.halaqah || '-'}
            teacherName={targetRow.submission?.teacherName || (isAdmin ? 'Belum diajukan Guru' : user.name)}
            records={records}
            serverParts={serverParts.filter(p => p.studentId === targetRow.participant.studentId)}
            suggestedParts={targetRow.analysis.parts}
            sessions={targetRow.sessions}
            serverSessions={serverSessions.filter(s => s.studentId === targetRow.participant.studentId && s.status !== 'void')}
            pendingRevisions={serverRevisions.filter(
              r => r.studentId === targetRow.participant.studentId && (r.status === 'pending' || r.status === 'on_hold_in_progress')
            )}
            submissionStatus={targetRow.submission?.status}
            user={user}
            onSaved={async (msgText) => {
              await loadRemote();
              onSessionsUpdated?.();
              if (msgText) setMsg({ type: 'success', text: msgText });
            }}
            onOpenRevisionsTab={
              isAdmin
                ? () => {
                    setFullManualStudentId(null);
                    setActiveAdminTab('revisions');
                  }
                : undefined
            }
          />
        );
      })()}
      {teacherDetailStudentId && (() => {
        const detailRow = studentRows.find(r => r.participant.studentId === teacherDetailStudentId);
        if (!detailRow) return null;
        return (
          <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden text-xs">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-bold text-sm text-slate-900 truncate">{detailRow.participant.studentName}</h4>
                  <p className="text-[11px] text-slate-500 truncate">
                    {detailRow.participant.class} • {detailRow.participant.halaqah}
                    {detailRow.studentNis ? ` • NIS ${detailRow.studentNis}` : ''}
                    {detailRow.teacherName ? ` • ${detailRow.teacherName}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTeacherDetailStudentId(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  aria-label="Tutup"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-3 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${detailRow.statusCls}`}>
                    {detailRow.statusLabel}
                  </span>
                  {detailRow.submission?.hasManualOverride && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                      Ditetapkan Manual oleh Guru
                    </span>
                  )}
                </div>

                {detailRow.submission?.rejectedReason && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                    Catatan Revisi Admin: {detailRow.submission.rejectedReason}
                  </div>
                )}

                {detailRow.analysis.anomalies.length > 0 && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                    <div className="font-bold">Perlu Diperiksa:</div>
                    {detailRow.analysis.anomalies.map((a, idx) => <div key={idx}>• {a}</div>)}
                  </div>
                )}

                {detailRow.submission?.evidenceSummary && detailRow.submission.evidenceSummary.length > 0 && (
                  <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-950 space-y-1.5">
                    <div className="font-bold">Perbedaan Catatan Setoran:</div>
                    {detailRow.submission.evidenceSummary.map((ev, idx) => (
                      <div key={idx} className="bg-white px-2.5 py-1.5 rounded-lg border border-amber-200 flex flex-wrap justify-between gap-1 text-[11px]">
                        <span className="font-bold">Sesi {ev.sessionNumber || idx + 1} • Juz {ev.juzNumber}</span>
                        <span>Setoran aplikasi: <strong>{Math.round((ev.evidenceRatio || 0) * 100)}%</strong></span>
                        <span className="text-teal-800">Guru: <strong>{ev.sessionType === 'full_juz' ? 'Juz Penuh' : 'Parsial'}</strong></span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="font-bold text-slate-800">Rincian Materi Per Juz ({detailRow.analysis.parts.length})</div>
                  {detailRow.analysis.parts.length === 0 ? (
                    <p className="text-slate-400 italic">Belum ada bagian materi.</p>
                  ) : (
                    detailRow.analysis.parts.map(pt => (
                      <div key={pt.id} className="p-2.5 rounded-xl border border-slate-200 bg-slate-50">
                        <div className="font-bold text-slate-800">
                          Juz {pt.juzNumber} ({pt.partType === 'full_juz' ? 'Juz Penuh' : pt.partType === 'partial_half' ? 'Parsial' : 'Kurang dari ½ Juz'})
                        </div>
                        <div className="text-[11px] text-slate-600 mt-0.5">
                          {pt.startSurahName}:{pt.startAyah} s.d. {pt.endSurahName}:{pt.endAyah} ({pt.coveredPagesCount}/{pt.juzTotalPages} hal)
                        </div>
                        {pt.reviewReason && !/^(Pengaturan materi manual|Diverifikasi oleh|Ditetapkan sesuai pemeriksaan)/i.test(pt.reviewReason) && (
                          <div className="text-[11px] text-amber-800 mt-0.5">{pt.reviewReason}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="font-bold text-slate-800">Rincian Sesi ({detailRow.sessions.length})</div>
                  {detailRow.sessions.length === 0 ? (
                    <p className="text-slate-400 italic">Belum ada sesi ujian.</p>
                  ) : (
                    detailRow.sessions.map(s => {
                      const matchedServer = serverSessions.find(ss => ss.id === s.id && ss.status !== 'void');
                      const canRequestRevision =
                        (isAdmin || isTeacher) &&
                        Boolean(matchedServer) &&
                        Boolean(
                          s.questionSetId ||
                            s.attemptId ||
                            s.isLocked ||
                            s.approvalStatus === 'admin_approved' ||
                            detailRow.submission?.status === 'admin_approved'
                        );
                      const hasPendingRev =
                        Boolean(matchedServer) &&
                        serverRevisions.some(
                          r =>
                            r.uasSessionId === matchedServer!.id &&
                            (r.status === 'pending' || r.status === 'on_hold_in_progress')
                        );
                      return (
                        <div key={s.id} className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-bold text-slate-800">
                              Sesi {s.sessionNumber} • Juz {s.juzNumber} ({s.sessionType === 'full_juz' ? 'Juz Penuh' : 'Parsial'})
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px] font-bold text-teal-700">
                              {s.status === 'submitted'
                                ? 'Selesai'
                                : s.questionSetId
                                  ? 'Paket Siap'
                                  : s.approvalStatus === 'admin_approved'
                                    ? 'Disetujui'
                                    : 'Menunggu Admin'}
                            </span>
                            {hasPendingRev ? (
                              <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-900 font-bold text-[10px]">
                                Revisi Menunggu Admin
                              </span>
                            ) : (
                              canRequestRevision && matchedServer && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTeacherDetailStudentId(null);
                                    setDirectRevisionTarget({
                                      studentId: detailRow.participant.studentId,
                                      studentName: detailRow.participant.studentName,
                                      studentClass: detailRow.participant.class,
                                      halaqah: detailRow.participant.halaqah || '-',
                                      session: matchedServer
                                    });
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px]"
                                >
                                  Ajukan Revisi Materi
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                {!isAdmin && detailRow.submission?.status === 'admin_approved' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTeacherDetailStudentId(null);
                      handleReopenRevision(detailRow);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold inline-flex items-center gap-1"
                  >
                    <RotateCcw size={13} /> Ajukan Revisi
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTeacherDetailStudentId(null)}
                    className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold"
                  >
                    Tutup
                  </button>
                )}

                <div className="flex items-center gap-2">
                  {isAdmin && detailRow.submission?.status === 'admin_approved' && !detailRow.allGenerated && onOpenPrepareQuestions && (
                    <button
                      type="button"
                      onClick={() => {
                        setTeacherDetailStudentId(null);
                        onOpenPrepareQuestions(detailRow.participant.studentId);
                      }}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                    >
                      Siapkan Soal
                    </button>
                  )}
                  {(isAdmin || detailRow.submission?.status !== 'admin_approved') && (
                    <button
                      type="button"
                      onClick={() => {
                        setTeacherDetailStudentId(null);
                        setFullManualStudentId(detailRow.participant.studentId);
                      }}
                      className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold inline-flex items-center gap-1.5"
                    >
                      <Sliders size={13} />
                      <span>Atur Materi & Sesi</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {directRevisionTarget && (
        <UASMaterialRevisionModal
          isOpen={true}
          onClose={() => setDirectRevisionTarget(null)}
          period={period}
          studentId={directRevisionTarget.studentId}
          studentName={directRevisionTarget.studentName}
          studentClass={directRevisionTarget.studentClass}
          halaqah={directRevisionTarget.halaqah}
          session={directRevisionTarget.session}
          existingSessionNumbers={serverSessions
            .filter(s => s.studentId === directRevisionTarget.studentId && s.status !== 'void')
            .map(s => s.sessionNumber)}
          user={user}
          onSubmitted={async (msgText) => {
            setDirectRevisionTarget(null);
            await loadRemote();
            onSessionsUpdated?.();
            setMsg({ type: 'success', text: msgText });
          }}
        />
      )}

      {/* Ringkasan Lanjutan Modal (diakses dari Opsi Lainnya) */}
      {showAdvancedSummary && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-slate-900">Ringkasan Lanjutan</h4>
              <button type="button" onClick={() => setShowAdvancedSummary(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[11px] text-slate-500">Total Sesi</div>
                <div className="text-lg font-black text-slate-900">{summary.totalSessions}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[11px] text-slate-500">Santri Multi-Sesi</div>
                <div className="text-lg font-black text-slate-900">{summary.multiSessionStudents}</div>
              </div>
              <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200">
                <div className="text-[11px] text-teal-700">Sesi Juz Penuh</div>
                <div className="text-lg font-black text-teal-900">{summary.fullSessions}</div>
              </div>
              <div className="p-3 rounded-xl bg-sky-50/70 border border-sky-200">
                <div className="text-[11px] text-sky-700">Sesi Parsial</div>
                <div className="text-lg font-black text-sky-900">{summary.partialSessions}</div>
              </div>
              <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 col-span-2">
                <div className="text-[11px] text-amber-800">Materi Kurang dari Setengah Juz</div>
                <div className="text-lg font-black text-amber-900">{summary.needsDecision} santri</div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Informasi kesiapan Bank Soal tersedia pada tab <strong>3. Siapkan Soal</strong>.
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={() => setShowAdvancedSummary(false)} className="px-4 py-2 rounded-xl bg-teal-600 text-white font-bold">
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aturan Ujian UAS Modal (diakses dari Opsi Lainnya) */}
      {showExamRules && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-slate-900">Aturan Ujian UAS Tahfidz</h4>
              <button type="button" onClick={() => setShowExamRules(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2 text-slate-700 leading-relaxed">
              <p><strong>Sesi Juz Penuh:</strong> 9 soal (7 soal acak × 10 poin + 2 soal wajib halaman penuh × 15 poin = 100 poin).</p>
              <p><strong>Sesi Parsial (Setengah Juz):</strong> 4 soal acak × 25 poin = 100 poin.</p>
              <p><strong>Alur Persiapan:</strong> Guru Halaqah mengatur dan mengirim materi, Admin meninjau &amp; menyetujui, lalu menyiapkan paket soal.</p>
            </div>
            <div className="flex justify-end pt-1">
              <button type="button" onClick={() => setShowExamRules(false)} className="px-4 py-2 rounded-xl bg-teal-600 text-white font-bold">
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
