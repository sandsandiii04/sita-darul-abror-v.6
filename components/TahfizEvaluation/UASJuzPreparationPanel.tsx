import React, { useMemo, useState, useEffect } from 'react';
import {
  AcademicTerm,
  ExamMaterialPart,
  ExamMaterialSnapshot,
  ExamParticipant,
  ExamPeriod,
  ExamUASPrepSubmission,
  ExamUASSession,
  QuestionBankItem,
  TahfidzRecord,
  User
} from '../../types';
import { api } from '../../api';
import { analyzeStudentJuzPartsAndSessions } from '../../services/uasJuzSegmentationService';
import { evaluateUASSessionEligibility } from '../../services/uasBulkEligibilityService';
import { UASAdminApprovalPanel } from './UASAdminApprovalPanel';
import { UASManualPrepModal } from './UASManualPrepModal';
import { BookOpen, RefreshCw, ShieldCheck, Layers, Ban, Plus, Send, RotateCcw, Trash2, Edit3, AlertTriangle, Sliders } from 'lucide-react';

interface UASJuzPreparationPanelProps {
  user: User;
  period: ExamPeriod;
  term: AcademicTerm;
  participants: ExamParticipant[];
  snapshots: ExamMaterialSnapshot[];
  records: TahfidzRecord[];
  onSessionsUpdated?: () => void;
}

export const UASJuzPreparationPanel: React.FC<UASJuzPreparationPanelProps> = ({
  user,
  period,
  term,
  participants,
  snapshots,
  records,
  onSessionsUpdated
}) => {
  const [serverParts, setServerParts] = useState<ExamMaterialPart[]>([]);
  const [serverSessions, setServerSessions] = useState<ExamUASSession[]>([]);
  const [serverSubmissions, setServerSubmissions] = useState<ExamUASPrepSubmission[]>([]);
  const [bankQuestions, setBankQuestions] = useState<QuestionBankItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [busyPartId, setBusyPartId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'multi_session' | 'needs_review' | 'needs_decision' | 'bank_short'>('all');
  const [teacherStatusFilter, setTeacherStatusFilter] = useState<'all' | 'unverified' | 'draft' | 'verified' | 'pending_admin' | 'approved'>('all');
  const [fullManualStudentId, setFullManualStudentId] = useState<string | null>(null);
  const [teacherDetailStudentId, setTeacherDetailStudentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSyncPreview, setShowSyncPreview] = useState(false);
  const [isBulkFinalizing, setIsBulkFinalizing] = useState(false);
  const [activeAdminTab, setActiveAdminTab] = useState<'prep' | 'approval'>('prep');
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
    const [juzRes, bankRes] = await Promise.all([
      api.getUASJuzPartsAndSessions(period.id, user),
      api.getQuestionBankList({ status: 'active', examType: 'uas' })
    ]);
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
          verificationNotes: p.verification_notes,
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
        (juzRes.sessions || []).map((s: any) => ({
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
  }, [period.id]);

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

    const scopedParticipants = isTeacher
      ? participants.filter(
          p => p.teacherId === user.id || p.halaqah?.toLowerCase().includes(user.name.toLowerCase())
        )
      : participants;

    return scopedParticipants.map(p => {
      const snap = snapMap.get(p.studentId);
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

      return {
        participant: p,
        analysis,
        sessions: effectiveSessions,
        sessionEligibilities,
        submission: subByStudent.get(p.studentId) || null
      };
    });
  }, [participants, snapshots, serverParts, serverSessions, serverSubmissions, period, term, records, bankQuestions, isTeacher, user.id, user.name]);

  const summary = useMemo(() => {
    let totalSessions = 0;
    let fullSessions = 0;
    let partialSessions = 0;
    let multiSessionStudents = 0;
    let needsReview = 0;
    let needsDecision = 0;
    let readyPartsCount = 0;
    let needsReviewPartsCount = 0;
    let needsDecisionPartsCount = 0;
    let finalizedPartsCount = 0;
    let eligibleToCheck = 0;
    let checkedCount = 0;
    let uncheckedCount = 0;
    let bankSufficientCount = 0;
    let bankShort = 0;
    let emptyZonesInChecked = 0;

    studentRows.forEach(r => {
      if (r.sessions.length > 1) multiSessionStudents++;
      totalSessions += r.sessions.length;
      fullSessions += r.sessions.filter(s => s.sessionType === 'full_juz').length;
      partialSessions += r.sessions.filter(s => s.sessionType === 'partial_half').length;
      if (r.analysis.hasUnverifiedGaps || r.analysis.anomalies.length > 0) needsReview++;
      if (r.analysis.needsAdminDecision) needsDecision++;

      r.analysis.parts.forEach(pt => {
        if (pt.status === 'ready') readyPartsCount++;
        else if (pt.status === 'needs_review') needsReviewPartsCount++;
        else if (pt.status === 'needs_admin_decision') needsDecisionPartsCount++;
        else if (pt.status === 'finalized') finalizedPartsCount++;
      });

      r.sessionEligibilities.forEach(e => {
        if (e.status === 'SIAP_GENERATE' || e.status === 'SUDAH_ADA' || e.status === 'BANK_SOAL_KURANG') {
          eligibleToCheck++;
          checkedCount++;
          if (e.status === 'BANK_SOAL_KURANG') {
            bankShort++;
            emptyZonesInChecked += e.missingZones.length;
          } else {
            bankSufficientCount++;
          }
        } else {
          uncheckedCount++;
        }
      });
    });

    return {
      totalSessions,
      fullSessions,
      partialSessions,
      multiSessionStudents,
      needsReview,
      needsDecision,
      readyPartsCount,
      needsReviewPartsCount,
      needsDecisionPartsCount,
      finalizedPartsCount,
      eligibleToCheck,
      checkedCount,
      uncheckedCount,
      bankSufficientCount,
      bankShort,
      emptyZonesInChecked
    };
  }, [studentRows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return studentRows.filter(r => {
      if (q) {
        const matchName = r.participant.studentName.toLowerCase().includes(q);
        const matchClass = (r.participant.class || '').toLowerCase().includes(q);
        const matchHalaqah = (r.participant.halaqah || '').toLowerCase().includes(q);
        if (!matchName && !matchClass && !matchHalaqah) return false;
      }
      if (filterMode === 'multi_session') return r.sessions.length > 1;
      if (filterMode === 'needs_review') return r.analysis.hasUnverifiedGaps || r.analysis.anomalies.length > 0;
      if (filterMode === 'needs_decision') return r.analysis.needsAdminDecision;
      if (filterMode === 'bank_short') return r.sessionEligibilities.some(e => e.status === 'BANK_SOAL_KURANG');
      if (teacherStatusFilter !== 'all') {
        const subSt = r.submission?.status;
        const hasVerified = r.analysis.parts.length > 0 && r.analysis.parts.every(p => Boolean(p.verifiedAt) || p.teacherStatus === 'teacher_verified' || p.teacherStatus === 'admin_approved');
        const hasManualDraft = r.analysis.parts.some(p => p.teacherStatus === 'draft_manual');
        if (teacherStatusFilter === 'approved') return subSt === 'admin_approved';
        if (teacherStatusFilter === 'pending_admin') return subSt === 'pending_admin_approval' || subSt === 'exception_pending';
        if (teacherStatusFilter === 'verified') return hasVerified && subSt !== 'admin_approved' && subSt !== 'pending_admin_approval';
        if (teacherStatusFilter === 'draft') return (hasManualDraft || subSt === 'draft' || subSt === 'needs_correction' || subSt === 'rejected') && !hasVerified;
        if (teacherStatusFilter === 'unverified') return !hasVerified && subSt !== 'admin_approved' && subSt !== 'pending_admin_approval';
      }
      return true;
    });
  }, [studentRows, filterMode, teacherStatusFilter, searchQuery]);

  const isPartFinalizable = (pt: ExamMaterialPart): { ok: boolean; reason?: string } => {
    if (pt.status === 'finalized') return { ok: false, reason: 'Sudah difinalisasi.' };
    if (pt.status === 'excluded') return { ok: false, reason: 'Bagian materi dikecualikan (excluded).' };
    if (pt.status === 'needs_review') return { ok: false, reason: 'Wajib Verifikasi terlebih dahulu sebelum Finalisasi.' };
    if (pt.status === 'needs_admin_decision') return { ok: false, reason: 'Cakupan < 0,5 juz memerlukan keputusan Admin sebelum Finalisasi.' };
    if (pt.hasGap && !pt.verifiedAt) return { ok: false, reason: 'Terdapat segmen lompatan yang belum diverifikasi.' };
    if (pt.coverageRatio <= 0) return { ok: false, reason: 'Cakupan materi tidak sah (0%).' };
    return { ok: true };
  };

  const handleBulkFinalizeReady = async () => {
    if (!isAdmin) return;
    const eligibleParts: Array<{ part: ExamMaterialPart; row: (typeof studentRows)[number] }> = [];
    studentRows.forEach(row => {
      row.analysis.parts.forEach(pt => {
        if (pt.status === 'ready' && isPartFinalizable(pt).ok && serverParts.some(sp => sp.id === pt.id)) {
          eligibleParts.push({ part: pt, row });
        }
      });
    });
    if (eligibleParts.length === 0) {
      setMsg({ type: 'error', text: 'Tidak ada bagian materi berstatus Siap (ready) yang sudah disinkronkan untuk difinalisasi. Bagian needs_review dan needs_admin_decision dilewati.' });
      return;
    }
    setIsBulkFinalizing(true);
    setMsg(null);
    let ok = 0;
    let skipped = 0;
    try {
      for (const item of eligibleParts) {
        const res = await api.verifyOrFinalizeUASMaterialPart(item.part.id, 'finalize', undefined, user);
        if (res.success) ok++;
        else skipped++;
      }
      await loadRemote();
      onSessionsUpdated?.();
      setMsg({ type: 'success', text: `Finalisasi massal selesai: ${ok} bagian juz disahkan, ${skipped} dilewati/ditolak server.` });
    } finally {
      setIsBulkFinalizing(false);
    }
  };

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

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveAdminTab('prep')}
            className={`px-4 py-2 rounded-2xl text-xs font-extrabold border transition-colors ${
              activeAdminTab === 'prep' ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Persiapan Materi Per Juz
          </button>
          <button
            onClick={() => setActiveAdminTab('approval')}
            className={`px-4 py-2 rounded-2xl text-xs font-extrabold border transition-colors flex items-center gap-2 ${
              activeAdminTab === 'approval' ? 'bg-indigo-700 text-white border-indigo-700' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span>Persetujuan Materi &amp; Sesi UAS</span>
            {pendingApprovalCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-slate-900 text-[10px] font-black">{pendingApprovalCount}</span>
            )}
          </button>
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
        />
      ) : (
    <div className="bg-white rounded-3xl border border-teal-200/80 shadow-sm p-5 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-teal-700" />
            <h2 className="text-base font-extrabold text-slate-900">
              {isTeacher ? 'Persiapan Materi UAS — Guru Halaqah' : 'Persiapan Materi Per Juz & Multi-Sesi UAS'}
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {isTeacher
              ? `Cutoff: ${period.materialCutoffDate} • Atur materi juz, susun sesi, verifikasi setoran, lalu kirim ke Admin.`
              : <>Cutoff materi: <strong>{period.materialCutoffDate}</strong> • 1 Juz Penuh = 9 soal (7 Bank Soal + 2 wajib manual) • Setengah Juz = 4 soal Bank Soal (4×25 = 100 poin).</>
            }
          </p>
        </div>

        {canEditPrep && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowSyncPreview(prev => !prev)}
              disabled={isSyncing}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 ${
                isTeacher
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                  : 'bg-teal-700 hover:bg-teal-800 text-white shadow-sm'
              } disabled:opacity-50`}
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
              <span>{isSyncing ? 'Menyinkronkan...' : (isTeacher ? 'Muat Sugesti Setoran' : 'Muat Sugesti dari Setoran')}</span>
            </button>
          </div>
        )}
      </div>

      {showSyncPreview && canEditPrep && (
        <div className="p-4 rounded-2xl border border-teal-300 bg-teal-50/70 space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="font-extrabold text-teal-950">Pratinjau Sebelum Sinkronisasi Materi Per Juz &amp; Sesi</div>
            <button onClick={() => setShowSyncPreview(false)} className="text-slate-500 hover:text-slate-800 font-bold">Tutup</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="p-2.5 rounded-xl bg-white border border-teal-100">
              <div className="text-[10px] text-slate-500">Bagian Valid (ready)</div>
              <div className="text-sm font-black text-emerald-700">{summary.readyPartsCount}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-white border border-amber-200">
              <div className="text-[10px] text-slate-500">Bagian needs_review</div>
              <div className="text-sm font-black text-amber-700">{summary.needsReviewPartsCount}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-white border border-indigo-200">
              <div className="text-[10px] text-slate-500">Keputusan Admin</div>
              <div className="text-sm font-black text-indigo-700">{summary.needsDecisionPartsCount}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-white border border-slate-200">
              <div className="text-[10px] text-slate-500">Sesi Penuh (9 soal)</div>
              <div className="text-sm font-black text-slate-800">{summary.fullSessions}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-white border border-slate-200">
              <div className="text-[10px] text-slate-500">Sesi Parsial (4 soal)</div>
              <div className="text-sm font-black text-slate-800">{summary.partialSessions}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-white border border-rose-200">
              <div className="text-[10px] text-slate-500">Bank Kurang / Blm Periksa</div>
              <div className="text-sm font-black text-rose-700">{summary.bankShort} / {summary.uncheckedCount}</div>
            </div>
          </div>
          <p className="text-[11px] text-teal-900">
            Sinkronisasi hanya menyimpan data persiapan (termasuk status <strong>needs_review</strong> untuk diperbaiki Admin). Sinkronisasi <strong>tidak</strong> otomatis memfinalisasi materi, <strong>tidak</strong> mengunci paket soal, dan <strong>tidak</strong> membuat attempt ujian.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowSyncPreview(false)} className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold">Batal</button>
            <button
              onClick={async () => {
                setShowSyncPreview(false);
                await handleSyncAllToServer();
              }}
              disabled={isSyncing}
              className="px-4 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold"
            >
              Konfirmasi &amp; Jalankan Sinkronisasi
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div className={`p-3 rounded-2xl text-xs font-semibold border ${msg.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      {/* Summary Chips (Admin only — Guru Halaqah uses simple status tabs below) */}
      {!isTeacher && (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
        <button onClick={() => setFilterMode('all')} className={`p-3 rounded-2xl border text-left ${filterMode === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 border-slate-200'}`}>
          <div className="text-[10px] opacity-75">Total Sesi Direncanakan</div>
          <div className="text-lg font-black">{summary.totalSessions}</div>
          <div className="text-[10px] opacity-75">{summary.fullSessions} penuh • {summary.partialSessions} ½ juz</div>
        </button>
        <button onClick={() => setFilterMode('multi_session')} className={`p-3 rounded-2xl border text-left ${filterMode === 'multi_session' ? 'bg-teal-700 text-white border-teal-700' : 'bg-teal-50/70 border-teal-200 text-teal-900'}`}>
          <div className="text-[10px] opacity-80">Santri Multi-Sesi</div>
          <div className="text-lg font-black">{summary.multiSessionStudents}</div>
          <div className="text-[10px] opacity-80">&gt; 1 sesi UAS</div>
        </button>
        <button onClick={() => setFilterMode('needs_review')} className={`p-3 rounded-2xl border text-left ${filterMode === 'needs_review' ? 'bg-amber-600 text-white border-amber-600' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          <div className="text-[10px] opacity-80">Perlu Verifikasi (Anomali/Gap)</div>
          <div className="text-lg font-black">{summary.needsReview}</div>
          <div className="text-[10px] opacity-80">{summary.needsReviewPartsCount} bagian juz</div>
        </button>
        <button onClick={() => setFilterMode('needs_decision')} className={`p-3 rounded-2xl border text-left ${filterMode === 'needs_decision' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 border-indigo-200 text-indigo-900'}`}>
          <div className="text-[10px] opacity-80">&lt; 0,5 Juz</div>
          <div className="text-lg font-black">{summary.needsDecision}</div>
          <div className="text-[10px] opacity-80">Perlu keputusan Admin</div>
        </button>
        <div className="p-3 rounded-2xl border text-left bg-slate-50 border-slate-200 text-slate-800">
          <div className="text-[10px] text-slate-500">Pemeriksaan Bank Soal</div>
          <div className="text-lg font-black">{summary.checkedCount}/{summary.totalSessions}</div>
          <div className="text-[10px] text-slate-500">
            {summary.uncheckedCount} belum diperiksa • {summary.bankSufficientCount} cukup
          </div>
        </div>
        <button onClick={() => setFilterMode('bank_short')} className={`p-3 rounded-2xl border text-left ${filterMode === 'bank_short' ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
          <div className="text-[10px] opacity-80">Bank Soal Kurang</div>
          <div className="text-lg font-black">{summary.checkedCount === 0 ? '-' : summary.bankShort}</div>
          <div className="text-[10px] opacity-80">
            {summary.checkedCount === 0
              ? 'Belum diperiksa (materi belum final)'
              : `${summary.emptyZonesInChecked} zona kosong pada ${summary.checkedCount} sesi diperiksa`}
          </div>
        </button>
      </div>
      )}

      {/* Simplified Teacher Status Tabs (Section E) */}
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {[
          { id: 'all', label: 'Semua' },
          { id: 'unverified', label: 'Belum Diperiksa' },
          { id: 'draft', label: 'Draft Materi' },
          { id: 'verified', label: 'Sudah Diverifikasi' },
          { id: 'pending_admin', label: 'Menunggu Admin' },
          { id: 'approved', label: 'Disetujui' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setTeacherStatusFilter(tab.id as any)}
            className={`px-3 py-1.5 rounded-xl font-bold border transition-colors ${
              teacherStatusFilter === tab.id
                ? 'bg-teal-700 text-white border-teal-700'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Cari nama santri, kelas, atau halaqah..."
          className="w-full sm:w-80 px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <div className="text-[11px] text-slate-500">
          Menampilkan {Math.min(60, filteredRows.length)} dari {filteredRows.length} santri
        </div>
      </div>

      {/* Simplified Mobile-Friendly Cards for Guru Halaqah */}
      {isTeacher ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredRows.slice(0, 60).map(row => {
            const subSt = row.submission?.status;
            const hasParts = row.analysis.parts.length > 0;
            const allVerified = hasParts && row.analysis.parts.every(p => Boolean(p.verifiedAt) || p.teacherStatus === 'teacher_verified' || p.teacherStatus === 'admin_approved');
            const firstUnverifiedValidPart = row.analysis.parts.find(p => {
              const hasBad = /(melebihi batas|terbalik|anomali|tidak valid|tidak dikenali)/i.test(p.reviewReason || '');
              return !p.verifiedAt && p.status !== 'excluded' && !hasBad;
            });
            const hasIssue =
              row.analysis.anomalies.length > 0 ||
              row.analysis.hasUnverifiedGaps ||
              row.analysis.needsAdminDecision ||
              Boolean(row.submission?.rejectedReason);

            const statusBadge =
              subSt === 'admin_approved'
                ? { label: 'Disetujui Admin', cls: 'bg-emerald-100 text-emerald-800' }
                : subSt === 'pending_admin_approval' || subSt === 'exception_pending'
                  ? { label: 'Menunggu Admin', cls: 'bg-sky-100 text-sky-800' }
                  : subSt === 'rejected' || subSt === 'needs_correction'
                    ? { label: 'Perlu Revisi', cls: 'bg-rose-100 text-rose-800' }
                    : allVerified
                      ? { label: 'Sudah Diverifikasi', cls: 'bg-teal-100 text-teal-800' }
                      : row.analysis.parts.some(p => p.teacherStatus === 'draft_manual')
                        ? { label: 'Draft Materi', cls: 'bg-indigo-100 text-indigo-800' }
                        : { label: 'Belum Diperiksa', cls: 'bg-amber-100 text-amber-800' };

            return (
              <div key={row.participant.studentId} className="p-4 rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm text-slate-900">{row.participant.studentName}</div>
                      <div className="text-xs text-slate-500">{row.participant.class} • {row.participant.halaqah}</div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${statusBadge.cls}`}>
                      {statusBadge.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 pt-1">
                    <span className="font-semibold text-slate-500">Materi:</span>
                    {!hasParts ? (
                      <span className="text-slate-400 italic">Belum diatur</span>
                    ) : (
                      row.analysis.parts.map(pt => (
                        <span key={pt.id} className="px-2 py-0.5 rounded-lg bg-slate-100 font-bold text-slate-800">
                          Juz {pt.juzNumber} ({pt.partType === 'full_juz' ? '1 Juz Penuh' : pt.partType === 'partial_half' ? 'Setengah Juz' : '< ½ Juz'})
                        </span>
                      ))
                    )}
                  </div>

                  <div className="text-xs text-slate-700">
                    <span className="font-semibold text-slate-500">Jumlah Sesi: </span>
                    <span className="font-bold text-teal-700">{row.sessions.length} Sesi</span>
                    {row.sessions.length > 0 && (
                      <span className="text-slate-500 ml-1.5">
                        ({row.sessions.map(s => `S${s.sessionNumber}: Juz ${s.juzNumber}`).join(', ')})
                      </span>
                    )}
                  </div>

                  {hasIssue && (
                    <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-2 text-xs text-amber-900">
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                        {row.submission?.rejectedReason
                          ? 'Pengajuan perlu diperbaiki.'
                          : row.analysis.anomalies.length > 0
                            ? 'Perlu periksa data setoran.'
                            : 'Ada catatan materi yang perlu dicek.'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setTeacherDetailStudentId(row.participant.studentId)}
                        className="px-2 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold text-[11px] shrink-0 hover:bg-amber-100"
                      >
                        Lihat Detail
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                  {subSt !== 'admin_approved' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setFullManualStudentId(row.participant.studentId)}
                        className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold inline-flex items-center gap-1"
                      >
                        <Sliders size={13} /> Atur Materi
                      </button>
                      <button
                        type="button"
                        onClick={() => openManualSessionModal(row)}
                        className="px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-bold inline-flex items-center gap-1"
                      >
                        <Plus size={13} /> Tambah Sesi
                      </button>
                      {firstUnverifiedValidPart && (
                        <button
                          type="button"
                          onClick={() => handlePartAction(firstUnverifiedValidPart, 'verify', row)}
                          disabled={busyPartId === firstUnverifiedValidPart.id}
                          className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-bold disabled:opacity-40"
                        >
                          Verifikasi
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleSubmitForApproval(row, false)}
                        className="px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold inline-flex items-center gap-1"
                      >
                        <Send size={13} /> Kirim ke Admin
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleReopenRevision(row)}
                        className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold inline-flex items-center gap-1"
                      >
                        <RotateCcw size={13} /> Ajukan Revisi Baru
                      </button>
                      <button
                        type="button"
                        onClick={() => setTeacherDetailStudentId(row.participant.studentId)}
                        className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold"
                      >
                        Lihat Detail
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {filteredRows.length === 0 && (
            <div className="col-span-full py-8 text-center text-xs text-slate-400">
              Tidak ada santri yang sesuai dengan filter.
            </div>
          )}
        </div>
      ) : (
      /* Per-Student Juz Parts Table (Admin full view) */
      <div className="overflow-x-auto border border-slate-200 rounded-2xl">
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3">Santri</th>
              <th className="py-2.5 px-3">Bagian Materi Per Juz (Setoran Sah)</th>
              <th className="py-2.5 px-3">Rencana Sesi &amp; Kelayakan Bank Soal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.slice(0, 60).map(row => (
              <tr key={row.participant.studentId} className="align-top hover:bg-slate-50/70">
                <td className="py-3 px-3 w-48 space-y-1">
                  <div className="font-bold text-slate-800">{row.participant.studentName}</div>
                  <div className="text-[11px] text-slate-400">{row.participant.class} • {row.participant.halaqah}</div>
                  <div className="text-[10px] font-semibold text-teal-700">{row.sessions.length} Sesi UAS</div>
                  {row.submission && (
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      row.submission.status === 'admin_approved' ? 'bg-emerald-100 text-emerald-800'
                        : row.submission.status === 'pending_admin_approval' ? 'bg-sky-100 text-sky-800'
                        : row.submission.status === 'exception_pending' ? 'bg-indigo-100 text-indigo-800'
                        : row.submission.status === 'rejected' ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {row.submission.status} (rev #{row.submission.revisionNumber})
                    </span>
                  )}
                  {row.submission?.rejectedReason && (
                    <div className="text-[10px] text-rose-700 font-semibold">Ditolak: {row.submission.rejectedReason}</div>
                  )}
                </td>
                <td className="py-3 px-3 space-y-1.5">
                  {row.analysis.anomalies.length > 0 && (
                    <div className="p-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-[10px] space-y-0.5">
                      <div className="font-bold flex items-center gap-1">
                        <AlertTriangle size={12} />
                        <span>Anomali Data Setoran Guru (Dilewati agar tidak membuat cakupan palsu):</span>
                      </div>
                      {row.analysis.anomalies.map((a, idx) => (
                        <div key={idx}>• {a}</div>
                      ))}
                    </div>
                  )}
                  {row.analysis.parts.length === 0 ? (
                    <span className="text-slate-400 italic">Belum ada setoran sabaq/ziyadah semester berjalan.</span>
                  ) : (
                    row.analysis.parts.map(pt => {
                      const finCheck = isPartFinalizable(pt);
                      return (
                      <div key={pt.id} className="p-2 rounded-xl border border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 font-bold text-slate-800">
                            <BookOpen size={12} className="text-teal-600" />
                            <span>Juz {pt.juzNumber}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                              {pt.partType === 'full_juz' ? 'Penuh' : pt.partType === 'partial_half' ? 'Setengah Juz' : 'Tambahan < 0,5 Juz'}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              pt.status === 'finalized' ? 'bg-emerald-100 text-emerald-800'
                                : pt.status === 'needs_review' ? 'bg-amber-100 text-amber-800'
                                : pt.status === 'needs_admin_decision' ? 'bg-indigo-100 text-indigo-800'
                                : pt.status === 'excluded' ? 'bg-slate-200 text-slate-500'
                                : 'bg-sky-100 text-sky-800'
                            }`}>
                              {pt.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 mt-0.5">
                            {pt.startSurahName}:{pt.startAyah} s.d. {pt.endSurahName}:{pt.endAyah} ({pt.coveredPagesCount}/{pt.juzTotalPages} hal sah{pt.hasGap ? ` • ${pt.segments.length} segmen` : ''})
                          </div>
                          {pt.reviewReason && (
                            <div className="text-[10px] text-amber-700 mt-0.5">{pt.reviewReason}</div>
                          )}
                          {!finCheck.ok && pt.status !== 'finalized' && pt.status !== 'excluded' && (
                            <div className="text-[10px] text-rose-700 mt-0.5 font-semibold">Finalisasi dikunci: {finCheck.reason}</div>
                          )}
                        </div>
                        {canEditPrep && pt.status !== 'finalized' && pt.teacherStatus !== 'admin_approved' && (
                          <div className="flex items-center gap-1">
                            {(pt.status === 'needs_review' || pt.status === 'needs_admin_decision' || !pt.verifiedAt) && (() => {
                              const hasDataAnomaly = /(melebihi batas|terbalik|anomali|tidak valid|tidak dikenali)/i.test(pt.reviewReason || '');
                              return (
                                <button
                                  onClick={() => handlePartAction(pt, 'verify', row)}
                                  disabled={busyPartId === pt.id || hasDataAnomaly}
                                  title={hasDataAnomaly ? 'Perbaiki record setoran sumber yang tidak valid terlebih dahulu' : 'Verifikasi cakupan materi yang sudah diperiksa'}
                                  className="px-2 py-1 text-[10px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Verifikasi
                                </button>
                              );
                            })()}
                            {isAdmin && (
                              <button
                                onClick={() => handlePartAction(pt, 'finalize', row)}
                                disabled={busyPartId === pt.id || !finCheck.ok}
                                title={finCheck.reason || 'Finalisasi bagian juz ini'}
                                className="px-2 py-1 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <ShieldCheck size={11} />
                                <span>Finalisasi</span>
                              </button>
                            )}
                            <button
                              onClick={() => handlePartAction(pt, 'exclude', row)}
                              disabled={busyPartId === pt.id}
                              className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg"
                              title="Kecualikan bagian ini"
                            >
                              <Ban size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    );})
                  )}
                </td>
                <td className="py-3 px-3 space-y-1.5 w-80">
                  {row.sessionEligibilities.length === 0 ? (
                    <span className="text-[11px] text-indigo-700 font-semibold">{row.analysis.summaryReason}</span>
                  ) : (
                    row.sessionEligibilities.map(se => {
                      const sessObj = row.sessions.find(s => s.id === se.sessionId);
                      const isManual = sessObj?.source === 'manual';
                      const canEditSess = canEditPrep && isManual && !sessObj?.isLocked && !sessObj?.questionSetId && !sessObj?.attemptId && row.submission?.status !== 'admin_approved';
                      return (
                      <div key={se.sessionId} className="p-2 rounded-xl border border-slate-200 bg-slate-50/70">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-800">
                            Sesi {se.sessionNumber} • Juz {se.juzNumber} ({se.sessionType === 'full_juz' ? '9 Soal' : '4 Soal'})
                            <span className={`ml-1 text-[9px] px-1 py-0.5 rounded ${isManual ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200 text-slate-600'}`}>
                              {isManual ? 'manual' : 'auto'}
                            </span>
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            se.status === 'SIAP_GENERATE' || se.status === 'SUDAH_ADA'
                              ? 'bg-emerald-100 text-emerald-800'
                              : se.status === 'BANK_SOAL_KURANG'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {se.status === 'BANK_SOAL_KURANG' ? `Bank Kurang (${se.coveredZones}/${se.requiredZones})` : se.status}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{se.reason}</div>
                        {canEditSess && sessObj && (
                          <div className="flex items-center gap-1 mt-1">
                            <button onClick={() => openManualSessionModal(row, sessObj)} className="px-1.5 py-0.5 rounded bg-white border border-slate-300 text-[10px] font-bold text-slate-700 inline-flex items-center gap-1">
                              <Edit3 size={10} /> Edit
                            </button>
                            <button onClick={() => handleDeleteManualSession(sessObj.id, row.participant.studentName)} className="px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-[10px] font-bold text-rose-700 inline-flex items-center gap-1">
                              <Trash2 size={10} /> Batal
                            </button>
                          </div>
                        )}
                      </div>
                    );})
                  )}
                  {canEditPrep && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {row.submission?.status !== 'admin_approved' ? (
                        <>
                          <button
                            onClick={() => setFullManualStudentId(row.participant.studentId)}
                            className="px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold inline-flex items-center gap-1"
                          >
                            <Sliders size={11} /> Atur Materi & Sesi Manual
                          </button>
                          <button
                            onClick={() => openManualSessionModal(row)}
                            className="px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10px] font-bold inline-flex items-center gap-1"
                          >
                            <Plus size={11} /> Tambah Sesi Manual
                          </button>
                          <button
                            onClick={() => handleSubmitForApproval(row, false)}
                            className="px-2 py-1 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-[10px] font-bold inline-flex items-center gap-1"
                          >
                            <Send size={11} /> Kirim untuk Persetujuan Admin
                          </button>
                          {(row.analysis.hasUnverifiedGaps || row.analysis.needsAdminDecision || row.analysis.anomalies.length > 0) && (
                            <button
                              onClick={() => handleSubmitForApproval(row, true)}
                              className="px-2 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 text-[10px] font-bold"
                            >
                              Ajukan Pengecualian
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={() => handleReopenRevision(row)}
                          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold inline-flex items-center gap-1"
                        >
                          <RotateCcw size={11} /> Ajukan Revisi Baru
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filteredRows.length > 60 && (
              <tr>
                <td colSpan={3} className="py-2 px-3 text-center text-[11px] text-slate-500 bg-slate-50">
                  Menampilkan 60 dari {filteredRows.length} santri. Gunakan filter di atas untuk menyaring.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
            isOpen={true}
            onClose={() => setFullManualStudentId(null)}
            period={period}
            term={term}
            studentId={targetRow.participant.studentId}
            studentName={targetRow.participant.studentName}
            studentClass={targetRow.participant.class}
            halaqah={targetRow.participant.halaqah || '-'}
            teacherName={user.name}
            records={records}
            serverParts={serverParts.filter(p => p.studentId === targetRow.participant.studentId)}
            suggestedParts={targetRow.analysis.parts}
            sessions={targetRow.sessions}
            submissionStatus={targetRow.submission?.status}
            user={user}
            onSaved={async (msgText) => {
              await loadRemote();
              onSessionsUpdated?.();
              if (msgText) setMsg({ type: 'success', text: msgText });
            }}
          />
        );
      })()}
      {teacherDetailStudentId && (() => {
        const detailRow = studentRows.find(r => r.participant.studentId === teacherDetailStudentId);
        if (!detailRow) return null;
        return (
          <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h4 className="font-extrabold text-sm text-slate-900">Detail Materi — {detailRow.participant.studentName}</h4>
                  <p className="text-[11px] text-slate-500">{detailRow.participant.class} • {detailRow.participant.halaqah}</p>
                </div>
                <button onClick={() => setTeacherDetailStudentId(null)} className="px-2.5 py-1 rounded-lg bg-slate-100 font-bold text-slate-700">Tutup</button>
              </div>
              {detailRow.submission?.rejectedReason && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                  Catatan Revisi Admin: {detailRow.submission.rejectedReason}
                </div>
              )}
              {detailRow.analysis.anomalies.length > 0 && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 space-y-1">
                  <div className="font-bold">Anomali Data Setoran:</div>
                  {detailRow.analysis.anomalies.map((a, idx) => <div key={idx}>• {a}</div>)}
                </div>
              )}
              <div className="space-y-1.5">
                <div className="font-bold text-slate-700">Rincian Bagian Juz:</div>
                {detailRow.analysis.parts.length === 0 ? (
                  <p className="text-slate-400 italic">Belum ada bagian materi.</p>
                ) : (
                  detailRow.analysis.parts.map(pt => (
                    <div key={pt.id} className="p-2 rounded-xl border border-slate-200 bg-slate-50">
                      <div className="font-bold text-slate-800">
                        Juz {pt.juzNumber}: {pt.startSurahName}:{pt.startAyah} s.d. {pt.endSurahName}:{pt.endAyah} ({pt.coveredPagesCount}/{pt.juzTotalPages} hal)
                      </div>
                      {pt.reviewReason && !/^(Pengaturan materi manual|Diverifikasi oleh)/i.test(pt.reviewReason) && (
                        <div className="text-[11px] text-amber-800 mt-0.5">{pt.reviewReason}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setTeacherDetailStudentId(null);
                    setFullManualStudentId(detailRow.participant.studentId);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-teal-700 text-white font-bold"
                >
                  Atur Materi &amp; Sesi Manual
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
