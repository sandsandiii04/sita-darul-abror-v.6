import React, { useState, useEffect, useMemo } from 'react';
import { AcademicTerm, ExamPeriod, ExamParticipant, ExamMaterialSnapshot, Student, TahfidzRecord, User, ExamQuestionSet, ExamQuestion } from '../../types';
import { api } from '../../api';
import { materialDetectionService } from '../../services/materialDetectionService';
import { utsQuestionGenerator } from '../../services/utsQuestionGenerator';
import { uasQuestionGenerator } from '../../services/uasQuestionGenerator';
import { MaterialTable } from './MaterialTable';
import { MaterialVerificationModal } from './MaterialVerificationModal';
import { UTSQuestionPreview } from './UTSQuestionPreview';
import { UASQuestionPreview } from './UASQuestionPreview';
import { 
  BookOpen, 
  CheckCircle2, 
  AlertTriangle, 
  Lock, 
  Sparkles, 
  Users, 
  RefreshCw, 
  Calendar, 
  ShieldCheck,
  Award,
  AlertCircle
} from 'lucide-react';

interface MaterialPreparationProps {
  user: User;
  students: Student[];
  records: TahfidzRecord[];
  initialPeriodId?: string | null;
  onNavigateToPeriods: () => void;
}

export const MaterialPreparation: React.FC<MaterialPreparationProps> = ({
  user,
  students,
  records,
  initialPeriodId,
  onNavigateToPeriods
}) => {
  const [examPeriods, setExamPeriods] = useState<ExamPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(initialPeriodId || '');
  const [academicTerms, setAcademicTerms] = useState<AcademicTerm[]>([]);
  const [participants, setParticipants] = useState<ExamParticipant[]>([]);
  const [snapshots, setSnapshots] = useState<ExamMaterialSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Selected for verification modal
  const [activeModalItem, setActiveModalItem] = useState<{
    participant: ExamParticipant;
    student: Student;
    snapshot: ExamMaterialSnapshot;
  } | null>(null);

  // Tahap 5A: State Soal UTS
  const [questionSetsSummary, setQuestionSetsSummary] = useState<Array<{
    studentId: string;
    questionSetId?: string | null;
    status?: string | null;
    version?: number | null;
    hasQuestions: boolean;
  }>>([]);
  const [activeQuestionPreview, setActiveQuestionPreview] = useState<{
    student: Student;
    snapshot: ExamMaterialSnapshot;
    questionSet: ExamQuestionSet;
    questions: ExamQuestion[];
    isStale?: boolean;
  } | null>(null);
  const [isGeneratingStudentId, setIsGeneratingStudentId] = useState<string | null>(null);

  const questionSetMap = useMemo(() => {
    const map = new Map<string, { status: string; version: number; id: string }>();
    questionSetsSummary.forEach(q => {
      if (q.questionSetId && q.status) {
        map.set(q.studentId, {
          status: q.status,
          version: q.version || 1,
          id: q.questionSetId
        });
      }
    });
    return map;
  }, [questionSetsSummary]);

  const isAdmin = user.role === 'admin';
  const isTeacher = user.role === 'teacher';

  // Load periods & terms on mount
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        const termsRes = await api.getAcademicTerms(user);
        if (termsRes.success && termsRes.data) {
          setAcademicTerms(termsRes.data);
        }

        const periodsRes = await api.getExamPeriods(user);
        if (periodsRes.success && periodsRes.data) {
          setExamPeriods(periodsRes.data);
          if (!selectedPeriodId && periodsRes.data.length > 0) {
            setSelectedPeriodId(initialPeriodId || periodsRes.data[0].id);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  // Sync initialPeriodId when prop changes
  useEffect(() => {
    if (initialPeriodId && initialPeriodId !== selectedPeriodId) {
      setSelectedPeriodId(initialPeriodId);
    }
  }, [initialPeriodId]);

  // Selected period object
  const currentPeriod = useMemo(() => {
    return examPeriods.find(p => p.id === selectedPeriodId) || examPeriods[0] || null;
  }, [examPeriods, selectedPeriodId]);

  const currentTerm = useMemo(() => {
    if (!currentPeriod) return academicTerms[0] || null;
    return academicTerms.find(t => t.id === currentPeriod.academicTermId) || academicTerms[0] || null;
  }, [academicTerms, currentPeriod]);

  // Load evaluation data for selected period
  const loadPeriodData = async (periodId: string) => {
    if (!periodId) return;
    setIsLoading(true);
    try {
      const res = await api.getTahfizEvaluationData(periodId, user);
      if (res.success && res.data && res.data.participants && res.data.participants.length > 0) {
        setParticipants(res.data.participants || []);
        setSnapshots(res.data.materialSnapshots || []);
      } else {
        // Fallback: If no participants yet in DB, synthesize from students based on role / targets
        synthesizeData(periodId);
      }
      await loadQuestionSets(periodId);
    } catch (e) {
      console.warn("Falling back to local synthesized data:", e);
      synthesizeData(periodId);
      await loadQuestionSets(periodId);
    } finally {
      setIsLoading(false);
    }
  };

  const loadQuestionSets = async (periodId: string) => {
    try {
      const res = await api.getPeriodQuestionSetsSummary(periodId, user);
      if (res.success && res.data) {
        setQuestionSetsSummary(res.data);
      }
    } catch (e) {
      console.warn("loadQuestionSets error:", e);
    }
  };

  const synthesizeData = (periodId: string) => {
    const period = examPeriods.find(p => p.id === periodId) || api.getLocalExamPeriods().find(p => p.id === periodId);
    if (!period) return;
    const term = academicTerms.find(t => t.id === period.academicTermId) || academicTerms[0] || api.getLocalAcademicTerms()[0];

    // Filter students by teacher if teacher role, or by targetClasses / targetHalaqahs
    let eligibleStudents = students;
    if (isTeacher) {
      eligibleStudents = students.filter(s => s.teacherId === user.id || s.halaqah?.toLowerCase().includes(user.name.toLowerCase()));
    } else if (period.targetClasses && period.targetClasses.length > 0) {
      eligibleStudents = students.filter(s => period.targetClasses!.includes(s.class));
    } else if (period.targetHalaqahs && period.targetHalaqahs.length > 0) {
      eligibleStudents = students.filter(s => period.targetHalaqahs!.includes(s.halaqah));
    }

    const syntheticParticipants: ExamParticipant[] = eligibleStudents.map(s => ({
      id: `part_${periodId}_${s.id}`,
      examPeriodId: periodId,
      studentId: s.id,
      studentName: s.name,
      class: s.class,
      halaqah: s.halaqah,
      teacherId: s.teacherId,
      status: 'registered'
    }));

    const syntheticSnapshots: ExamMaterialSnapshot[] = eligibleStudents.map(s => {
      const det = materialDetectionService.analyzeStudentMaterial(
        s.id,
        periodId,
        term,
        period,
        records
      );
      return {
        id: `snap_${periodId}_${s.id}`,
        ...det.snapshot,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });

    setParticipants(syntheticParticipants);
    setSnapshots(syntheticSnapshots);

    // Save to cache
    api.saveLocalEvaluationData(periodId, {
      period,
      academicTerm: term,
      participants: syntheticParticipants,
      materialSnapshots: syntheticSnapshots,
      auditLogs: []
    });
  };

  useEffect(() => {
    if (selectedPeriodId) {
      loadPeriodData(selectedPeriodId);
    }
  }, [selectedPeriodId]);

  // Metrics
  const metrics = useMemo(() => {
    const total = participants.length;
    let finalized = 0;
    let ready = 0;
    let needsReview = 0;
    let notReady = 0;
    let questionsGenerated = 0;

    const snapMap = new Map<string, ExamMaterialSnapshot>();
    snapshots.forEach(s => snapMap.set(s.studentId, s));

    participants.forEach(p => {
      const s = snapMap.get(p.studentId);
      const st = s?.status || 'not_ready';
      if (st === 'finalized') {
        finalized++;
        const q = questionSetMap.get(p.studentId);
        if (q && q.status === 'locked') questionsGenerated++;
      } else if (st === 'ready') ready++;
      else if (st === 'needs_review') needsReview++;
      else notReady++;
    });

    const percentFinal = total > 0 ? Math.round((finalized / total) * 100) : 0;
    return { total, finalized, ready, needsReview, notReady, percentFinal, questionsGenerated };
  }, [participants, snapshots, questionSetMap]);

  // Tahap 5A & 6A: Generator & Preview Handlers
  const handleGenerateQuestions = async (
    participant: ExamParticipant,
    student: Student,
    snapshot: ExamMaterialSnapshot
  ) => {
    if (!currentPeriod) return;
    const isUAS = currentPeriod.examType === 'uas';
    const examLabel = isUAS ? 'UAS' : 'UTS';
    const qCount = isUAS ? 9 : 5;

    if (snapshot.status !== 'finalized') {
      setStatusMessage({ type: 'error', text: `Materi ${examLabel} santri belum difinalisasi.` });
      return;
    }

    setIsGeneratingStudentId(student.id);
    setStatusMessage({ type: 'info', text: `Men-generate ${qCount} soal ${examLabel} untuk ${student.name}...` });

    try {
      const bankRes = await api.getQuestionBankList({ status: 'active', examType: isUAS ? 'uas' : 'uts' });
      const bankQuestions = bankRes?.data || [];

      if (isUAS) {
        const result = await uasQuestionGenerator.generateUASQuestionSet({
          period: currentPeriod,
          snapshot,
          strategy: 'hybrid',
          bankQuestions,
          actorId: user.id
        });

        const saveRes = await api.generateUASQuestionSet({
          periodId: currentPeriod.id,
          studentId: student.id,
          strategy: 'hybrid',
          questions: result.questions as any,
          seed: result.questionSet.generationSeed
        }, user);

        if (saveRes.success && saveRes.questionSet && saveRes.questions) {
          setStatusMessage({ type: 'success', text: `9 Soal UAS untuk ${student.name} berhasil dibuat dan dikunci.` });
          await loadQuestionSets(currentPeriod.id);
          setActiveQuestionPreview({
            student,
            snapshot,
            questionSet: saveRes.questionSet,
            questions: saveRes.questions,
            isStale: false
          });
        } else {
          setStatusMessage({ type: 'error', text: saveRes.message || 'Gagal menyimpan soal UAS.' });
        }
      } else {
        const result = await utsQuestionGenerator.generateUTSQuestionSet({
          period: currentPeriod,
          snapshot,
          strategy: 'hybrid',
          bankQuestions,
          actorId: user.id
        });

        const saveRes = await api.generateUTSQuestionSet({
          periodId: currentPeriod.id,
          studentId: student.id,
          strategy: 'hybrid',
          questions: result.questions,
          seed: result.questionSet.generationSeed,
          fingerprint: result.questionSet.materialFingerprint
        }, user);

        if (saveRes.success && saveRes.questionSet && saveRes.questions) {
          setStatusMessage({ type: 'success', text: `5 Soal UTS untuk ${student.name} berhasil dibuat dan dikunci.` });
          await loadQuestionSets(currentPeriod.id);
          setActiveQuestionPreview({
            student,
            snapshot,
            questionSet: saveRes.questionSet,
            questions: saveRes.questions,
            isStale: false
          });
        } else {
          setStatusMessage({ type: 'error', text: saveRes.message || 'Gagal menyimpan soal UTS.' });
        }
      }
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: e?.message || `Gagal men-generate soal ${examLabel}.` });
    } finally {
      setIsGeneratingStudentId(null);
    }
  };

  const handleOpenQuestionPreview = async (
    participant: ExamParticipant,
    student: Student,
    snapshot: ExamMaterialSnapshot
  ) => {
    if (!currentPeriod) return;
    const isUAS = currentPeriod.examType === 'uas';
    const examLabel = isUAS ? 'UAS' : 'UTS';
    setStatusMessage({ type: 'info', text: `Memuat soal ${examLabel} ${student.name}...` });
    try {
      const res = isUAS 
        ? await api.getUASQuestionSet(currentPeriod.id, student.id, user)
        : await api.getUTSQuestionSet(currentPeriod.id, student.id, user);

      if (res.success && res.hasQuestionSet && res.questionSet && res.questions) {
        setStatusMessage(null);
        setActiveQuestionPreview({
          student,
          snapshot,
          questionSet: res.questionSet,
          questions: res.questions,
          isStale: res.isStale
        });
      } else {
        setStatusMessage({ type: 'error', text: res.message || `Soal ${examLabel} belum dibuat untuk santri ini.` });
      }
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: e?.message || `Gagal memuat soal ${examLabel}.` });
    }
  };

  const handleRegenerateFromPreview = async (reason: string) => {
    if (!activeQuestionPreview || !currentPeriod) return;
    const { student, snapshot } = activeQuestionPreview;
    const isUAS = currentPeriod.examType === 'uas';

    const bankRes = await api.getQuestionBankList({ status: 'active', examType: isUAS ? 'uas' : 'uts' });
    const bankQuestions = bankRes?.data || [];

    if (isUAS) {
      const result = await uasQuestionGenerator.generateUASQuestionSet({
        period: currentPeriod,
        snapshot,
        strategy: 'hybrid',
        bankQuestions,
        actorId: user.id
      });

      const regenRes = await api.regenerateUASQuestionSet({
        periodId: currentPeriod.id,
        studentId: student.id,
        strategy: 'hybrid',
        questions: result.questions as any,
        seed: result.questionSet.generationSeed,
        reason
      }, user);

      if (regenRes.success && regenRes.questionSet && regenRes.questions) {
        setStatusMessage({ type: 'success', text: `Soal UAS ${student.name} berhasil di-generate ulang (Versi ${regenRes.questionSet.version}).` });
        await loadQuestionSets(currentPeriod.id);
        setActiveQuestionPreview({
          student,
          snapshot,
          questionSet: regenRes.questionSet,
          questions: regenRes.questions,
          isStale: false
        });
      } else {
        throw new Error(regenRes.message || 'Gagal melakukan generate ulang.');
      }
    } else {
      const result = await utsQuestionGenerator.generateUTSQuestionSet({
        period: currentPeriod,
        snapshot,
        strategy: 'hybrid',
        bankQuestions,
        actorId: user.id
      });

      const regenRes = await api.regenerateUTSQuestionSet({
        periodId: currentPeriod.id,
        studentId: student.id,
        strategy: 'hybrid',
        questions: result.questions,
        seed: result.questionSet.generationSeed,
        fingerprint: result.questionSet.materialFingerprint,
        reason
      }, user);

      if (regenRes.success && regenRes.questionSet && regenRes.questions) {
        setStatusMessage({ type: 'success', text: `Soal UTS ${student.name} berhasil di-generate ulang (Versi ${regenRes.questionSet.version}).` });
        await loadQuestionSets(currentPeriod.id);
        setActiveQuestionPreview({
          student,
          snapshot,
          questionSet: regenRes.questionSet,
          questions: regenRes.questions,
          isStale: false
        });
      } else {
        throw new Error(regenRes.message || 'Gagal melakukan generate ulang.');
      }
    }
  };

  // Verification & Override handlers
  const handleVerify = async (snapshotId: string) => {
    if (!activeModalItem) return;
    setStatusMessage({ type: 'info', text: 'Memverifikasi materi...' });
    const res = await api.verifyOrOverrideMaterialSnapshot(snapshotId, 'verify', activeModalItem.snapshot, '', user);
    if (res.success) {
      setSnapshots(prev => prev.map(s => s.id === snapshotId ? { ...s, status: 'ready', verifiedBy: user.id, verifiedAt: new Date().toISOString() } : s));
      setStatusMessage({ type: 'success', text: 'Materi berhasil diverifikasi dan berstatus Siap.' });
      setActiveModalItem(null);
    } else {
      setStatusMessage({ type: 'error', text: res.message || 'Gagal memverifikasi materi.' });
    }
  };

  const handleFinalize = async (snapshotId: string) => {
    if (!activeModalItem) return;
    setStatusMessage({ type: 'info', text: 'Memfinalisasi materi santri...' });
    const res = await api.verifyOrOverrideMaterialSnapshot(snapshotId, 'finalize', activeModalItem.snapshot, '', user);
    if (res.success) {
      setSnapshots(prev => prev.map(s => s.id === snapshotId ? { ...s, status: 'finalized', finalizedBy: user.id, finalizedAt: new Date().toISOString() } : s));
      setStatusMessage({ type: 'success', text: 'Materi santri berhasil difinalisasi (Terkunci).' });
      setActiveModalItem(null);
    } else {
      setStatusMessage({ type: 'error', text: res.message || 'Gagal memfinalisasi materi.' });
    }
  };

  const handleOverride = async (snapshotId: string, updatedData: Partial<ExamMaterialSnapshot>, reason: string) => {
    setStatusMessage({ type: 'info', text: 'Menyimpan koreksi materi...' });
    const res = await api.verifyOrOverrideMaterialSnapshot(snapshotId, 'override', updatedData, reason, user);
    if (res.success) {
      setSnapshots(prev => prev.map(s => s.id === snapshotId ? { ...s, ...updatedData, status: 'ready', overrideReason: reason, verifiedBy: user.id, verifiedAt: new Date().toISOString() } as ExamMaterialSnapshot : s));
      setStatusMessage({ type: 'success', text: 'Koreksi materi manual berhasil disimpan.' });
      setActiveModalItem(null);
    } else {
      setStatusMessage({ type: 'error', text: res.message || 'Gagal menyimpan koreksi.' });
    }
  };

  const handleReopen = async (snapshotId: string, reason: string) => {
    setStatusMessage({ type: 'info', text: 'Membuka kembali materi...' });
    const res = await api.reopenMaterialSnapshot(snapshotId, reason, user);
    if (res.success) {
      setSnapshots(prev => prev.map(s => s.id === snapshotId ? { ...s, status: 'ready', finalizedBy: null, finalizedAt: null } : s));
      setStatusMessage({ type: 'success', text: 'Materi berhasil dibuka kembali untuk revisi.' });
      setActiveModalItem(null);
    } else {
      setStatusMessage({ type: 'error', text: res.message || 'Gagal membuka kembali materi.' });
    }
  };

  const handleBulkFinalize = async () => {
    if (!selectedPeriodId) return;
    if (metrics.ready === 0) {
      alert('Tidak ada santri dengan status Siap (Ready) yang dapat difinalisasi massal.');
      return;
    }
    const confirmMsg = `Finalisasi massal akan mengunci ${metrics.ready} santri yang sudah berstatus Siap (Ready).\n\nSantri dengan status 'Perlu Verifikasi' (${metrics.needsReview}) atau 'Belum Siap' (${metrics.notReady}) TIDAK akan ikut terkunci.\n\nLanjutkan?`;
    if (!window.confirm(confirmMsg)) return;

    setStatusMessage({ type: 'info', text: 'Melakukan finalisasi massal...' });
    const res = await api.bulkFinalizeMaterialSnapshots(selectedPeriodId, user);
    if (res.success) {
      setSnapshots(prev => prev.map(s => s.status === 'ready' ? { ...s, status: 'finalized', finalizedBy: user.id, finalizedAt: new Date().toISOString() } : s));
      setStatusMessage({
        type: 'success',
        text: res.message || `${metrics.ready} santri berstatus Siap berhasil difinalisasi!`
      });
    } else {
      setStatusMessage({ type: 'error', text: res.message || 'Gagal melakukan finalisasi massal.' });
    }
  };

  const handleRegenerate = async () => {
    if (!currentPeriod || !currentTerm) return;
    setStatusMessage({ type: 'info', text: 'Menganalisis ulang seluruh setoran santri...' });
    try {
      const snapMap = new Map<string, ExamMaterialSnapshot>();
      snapshots.forEach(s => snapMap.set(s.studentId, s));

      const updatedSnapshots = participants.map(p => {
        const existing = snapMap.get(p.studentId);
        // Do not overwrite finalized snapshots!
        if (existing && existing.status === 'finalized') {
          return existing;
        }
        const det = materialDetectionService.analyzeStudentMaterial(
          p.studentId,
          selectedPeriodId,
          currentTerm,
          currentPeriod,
          records
        );
        return {
          id: existing?.id || `snap_${selectedPeriodId}_${p.studentId}`,
          ...det.snapshot,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        } as ExamMaterialSnapshot;
      });

      const res = await api.saveMaterialSnapshotsBatch(selectedPeriodId, updatedSnapshots, user);
      if (res.success) {
        setSnapshots(updatedSnapshots);
        setStatusMessage({
          type: 'success',
          text: `Deteksi selesai: ${res.savedCount || updatedSnapshots.length} santri diperbarui (${res.skippedFinalizedCount || 0} final dilindungi).`
        });
      }
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: e?.message || 'Gagal memperbarui deteksi.' });
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold">
              Tahap 4 Evaluasi Tahfiz
            </span>
            <span className="text-xs text-slate-500">
              {isAdmin ? 'Akses Admin & Penguji' : `Halaqah ${user.name}`}
            </span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Persiapan Materi Ujian UTS/UAS
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Verifikasi dan finalisasi rentang hafalan santri hasil deteksi otomatis dari data setoran sabaq.
          </p>
        </div>

        {/* Period Selector & Actions */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {examPeriods.length > 0 && (
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
              <Calendar size={15} className="text-slate-400" />
              <select
                value={selectedPeriodId}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                className="text-xs font-bold text-slate-800 bg-transparent outline-none cursor-pointer"
              >
                {examPeriods.map(p => (
                  <option key={p.id} value={p.id}>
                    [{p.examType.toUpperCase()}] {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isAdmin && (
            <>
              <button
                onClick={handleRegenerate}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
                title="Jalankan ulang deteksi sabaq untuk santri yang belum difinalisasi"
              >
                <Sparkles size={14} className="text-amber-500" />
                <span>Deteksi Ulang</span>
              </button>

              <button
                onClick={handleBulkFinalize}
                disabled={metrics.ready === 0}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                <Lock size={14} />
                <span>Finalisasi Semua yang Siap ({metrics.ready})</span>
              </button>
            </>
          )}

          <button
            onClick={onNavigateToPeriods}
            className="px-3.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors border border-emerald-200"
          >
            Daftar Periode
          </button>
        </div>
      </div>

      {/* Notification status */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-medium flex items-center justify-between transition-all ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : statusMessage.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-teal-50 border-teal-200 text-teal-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            ) : statusMessage.type === 'error' ? (
              <AlertCircle size={16} className="text-rose-600 shrink-0" />
            ) : (
              <RefreshCw size={16} className="text-teal-600 animate-spin shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-slate-600 font-bold ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Teacher Halaqah Banner */}
      {isTeacher && (
        <div className="p-4 bg-gradient-to-r from-teal-800 to-emerald-800 rounded-2xl text-white shadow-md flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/10 rounded-xl">
              <ShieldCheck size={24} className="text-emerald-300" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Mode Verifikasi Guru Halaqah</h3>
              <p className="text-xs text-emerald-100">
                Menampilkan {participants.length} santri binaan Ustadz <strong>{user.name}</strong>. Silakan periksa usulan materi, koreksi jika perlu, dan lakukan verifikasi.
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-xs text-emerald-200 block">Progress Finalisasi</span>
            <strong className="text-lg font-black">{metrics.percentFinal}%</strong>
          </div>
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Total Peserta</span>
          <div className="flex items-baseline gap-1 mt-1">
            <h3 className="text-2xl font-black text-slate-900">{metrics.total}</h3>
            <span className="text-xs text-slate-400">Santri</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-indigo-200/80 shadow-sm bg-gradient-to-br from-indigo-50/40 to-white">
          <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">Final / Terkunci</span>
          <div className="flex items-baseline gap-1 mt-1">
            <h3 className="text-2xl font-black text-indigo-900">{metrics.finalized}</h3>
            <span className="text-xs font-bold text-indigo-600">({metrics.percentFinal}%)</span>
          </div>
        </div>

        {currentPeriod?.examType === 'uts' && (
          <div className="bg-white p-4 rounded-2xl border border-teal-200/80 shadow-sm bg-gradient-to-br from-teal-50/40 to-white">
            <span className="text-[10px] font-bold text-teal-700 uppercase tracking-wider block">Soal UTS Dibuat</span>
            <div className="flex items-baseline gap-1 mt-1">
              <h3 className="text-2xl font-black text-teal-900">{metrics.questionsGenerated}</h3>
              <span className="text-xs font-bold text-teal-600">/ {metrics.finalized} Final</span>
            </div>
          </div>
        )}

        <div className="bg-white p-4 rounded-2xl border border-emerald-200/80 shadow-sm bg-gradient-to-br from-emerald-50/40 to-white">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Siap (Ready)</span>
          <div className="flex items-baseline gap-1 mt-1">
            <h3 className="text-2xl font-black text-emerald-900">{metrics.ready}</h3>
            <span className="text-xs text-emerald-600">Santri</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-amber-200/80 shadow-sm bg-gradient-to-br from-amber-50/40 to-white">
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Perlu Verifikasi</span>
          <div className="flex items-baseline gap-1 mt-1">
            <h3 className="text-2xl font-black text-amber-900">{metrics.needsReview}</h3>
            <span className="text-xs text-amber-600">Anomali</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Belum Siap</span>
          <div className="flex items-baseline gap-1 mt-1">
            <h3 className="text-2xl font-black text-slate-700">{metrics.notReady}</h3>
            <span className="text-xs text-slate-400">0 Setoran</span>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden flex shadow-inner">
        <div 
          className="bg-indigo-600 h-full transition-all duration-500" 
          style={{ width: `${metrics.percentFinal}%` }}
          title={`Final: ${metrics.percentFinal}%`}
        />
        <div 
          className="bg-emerald-500 h-full transition-all duration-500" 
          style={{ width: `${metrics.total > 0 ? (metrics.ready / metrics.total) * 100 : 0}%` }}
          title={`Siap: ${metrics.ready}`}
        />
        <div 
          className="bg-amber-400 h-full transition-all duration-500" 
          style={{ width: `${metrics.total > 0 ? (metrics.needsReview / metrics.total) * 100 : 0}%` }}
          title={`Perlu Verifikasi: ${metrics.needsReview}`}
        />
      </div>

      {/* Table Section */}
      <MaterialTable
        user={user}
        participants={participants}
        snapshots={snapshots}
        students={students}
        questionSetMap={questionSetMap}
        isUTSPeriod={currentPeriod?.examType === 'uts'}
        examType={currentPeriod?.examType || 'uts'}
        onOpenVerificationModal={(p, s, snap) => setActiveModalItem({ participant: p, student: s, snapshot: snap })}
        onOpenQuestionPreview={handleOpenQuestionPreview}
        onGenerateQuestions={handleGenerateQuestions}
      />

      {/* Verification Modal */}
      {activeModalItem && currentPeriod && currentTerm && (
        <MaterialVerificationModal
          user={user}
          participant={activeModalItem.participant}
          student={activeModalItem.student}
          snapshot={activeModalItem.snapshot}
          records={records}
          startDate={currentTerm.startDate}
          cutoffDate={currentPeriod.materialCutoffDate}
          onClose={() => setActiveModalItem(null)}
          onVerify={() => handleVerify(activeModalItem.snapshot.id)}
          onFinalize={() => handleFinalize(activeModalItem.snapshot.id)}
          onOverride={(updated, reason) => handleOverride(activeModalItem.snapshot.id, updated, reason)}
          onReopen={(reason) => handleReopen(activeModalItem.snapshot.id, reason)}
        />
      )}

      {/* UAS Question 9-Item Preview Modal */}
      {activeQuestionPreview && currentPeriod?.examType === 'uas' && (
        <UASQuestionPreview
          user={user}
          student={activeQuestionPreview.student}
          snapshot={activeQuestionPreview.snapshot}
          questionSet={activeQuestionPreview.questionSet}
          questions={activeQuestionPreview.questions}
          isStale={activeQuestionPreview.isStale}
          onClose={() => setActiveQuestionPreview(null)}
          onRegenerate={isAdmin ? handleRegenerateFromPreview : undefined}
        />
      )}

      {/* UTS Question 5-Zone Preview Modal */}
      {activeQuestionPreview && currentPeriod?.examType !== 'uas' && (
        <UTSQuestionPreview
          user={user}
          student={activeQuestionPreview.student}
          snapshot={activeQuestionPreview.snapshot}
          questionSet={activeQuestionPreview.questionSet}
          questions={activeQuestionPreview.questions}
          isStale={activeQuestionPreview.isStale}
          onClose={() => setActiveQuestionPreview(null)}
          onRegenerate={isAdmin ? handleRegenerateFromPreview : undefined}
        />
      )}
    </div>
  );
};
