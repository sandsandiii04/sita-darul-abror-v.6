import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, 
  RemedialExaminerStudentItem,
  ExamRemedialAttempt,
  ExamRemedialQuestion,
  ExamRemedialQuestionAssessment
} from '../../types';
import { api } from '../../api';
import { 
  RotateCcw, 
  Play, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Search, 
  Filter, 
  RefreshCcw, 
  Award, 
  ChevronRight, 
  ChevronLeft,
  ShieldCheck, 
  Users, 
  AlertTriangle,
  BookOpen,
  Send,
  X,
  Eye,
  Check
} from 'lucide-react';
import { quranService } from '../../services/quranService';

interface RemedialExamExecutionViewProps {
  user: User;
}

export const RemedialExamExecutionView: React.FC<RemedialExamExecutionViewProps> = ({ user }) => {
  const [students, setStudents] = useState<RemedialExaminerStudentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedExamType, setSelectedExamType] = useState<'ALL' | 'uts' | 'uas'>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'ALL' | 'SCHEDULED' | 'IN_PROGRESS' | 'SUBMITTED'>('ALL');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active exam session state
  const [activeSession, setActiveSession] = useState<{
    item: RemedialExaminerStudentItem;
    attempt: ExamRemedialAttempt;
    questions: ExamRemedialQuestion[];
    assessments: ExamRemedialQuestionAssessment[];
  } | null>(null);

  // Current question index in active session (0-based)
  // Last index is "Review & Submit"
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  // Mushaf Digital Viewer Modal
  const [mushafPage, setMushafPage] = useState<number | null>(null);

  // Inspect Result Modal
  const [inspectItem, setInspectItem] = useState<{
    item: RemedialExaminerStudentItem;
    attempt: any;
    questions: any[];
    assessments: any[];
  } | null>(null);

  useEffect(() => {
    loadAssignedStudents();
  }, []);

  const loadAssignedStudents = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getExaminerRemedialStudents(user);
      if (res.success && res.students) {
        setStudents(res.students);
      } else {
        setErrorMsg(res.message || 'Gagal memuat daftar santri remedial.');
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Terjadi kesalahan saat memuat data.');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      // Search
      const matchSearch = 
        s.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.nis.includes(searchQuery) ||
        (s.className && s.className.toLowerCase().includes(searchQuery.toLowerCase()));
      
      // Type
      const matchType = selectedExamType === 'ALL' || s.examType === selectedExamType;

      // Status
      let matchStatus = true;
      if (selectedStatusFilter === 'SCHEDULED') {
        matchStatus = !s.remedialAttemptStatus || s.remedialAttemptStatus === 'scheduled';
      } else if (selectedStatusFilter === 'IN_PROGRESS') {
        matchStatus = s.remedialAttemptStatus === 'in_progress' || s.remedialAttemptStatus === 'reopened';
      } else if (selectedStatusFilter === 'SUBMITTED') {
        matchStatus = s.remedialAttemptStatus === 'submitted';
      }

      return matchSearch && matchType && matchStatus;
    });
  }, [students, searchQuery, selectedExamType, selectedStatusFilter]);

  // Start or resume remedial exam
  const handleStartOrResume = async (item: RemedialExaminerStudentItem) => {
    setErrorMsg(null);
    setConflictWarning(null);
    try {
      const res = await api.startRemedialAttempt(item.remedialSessionId, user);
      if (res.success && res.attempt && res.questions && res.assessments) {
        setActiveSession({
          item,
          attempt: res.attempt,
          questions: res.questions,
          assessments: res.assessments
        });
        setCurrentQuestionIdx(0);
      } else {
        setErrorMsg(res.message || 'Gagal memulai ujian remedial.');
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Terjadi kesalahan saat memulai ujian remedial.');
    }
  };

  // Inspect submitted result
  const handleInspectResult = async (item: RemedialExaminerStudentItem) => {
    if (!item.remedialAttemptId) return;
    try {
      const res = await api.getRemedialAttemptDetail(item.remedialAttemptId, user);
      if (res.success) {
        setInspectItem({
          item,
          attempt: res.attempt,
          questions: res.questions || [],
          assessments: res.assessments || []
        });
      } else {
        setErrorMsg(res.message || 'Gagal memuat detail hasil remedial.');
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Terjadi kesalahan saat memuat hasil remedial.');
    }
  };

  // Rubric Deductions Handler
  const currentQuestion = activeSession?.questions[currentQuestionIdx];
  const currentAssessment = activeSession?.assessments.find(a => a.questionNumber === (currentQuestionIdx + 1));

  const updateAssessmentEvents = async (
    eventType: 'fluency' | 'tajwid' | 'makhraj',
    action: 'add' | 'remove',
    detail: string
  ) => {
    if (!activeSession || !currentQuestion || !currentAssessment) return;
    setConflictWarning(null);

    let updatedFluency = [...(currentAssessment.fluencyEvents || [])];
    let updatedTajwid = [...(currentAssessment.tajwidEvents || [])];
    let updatedMakhraj = [...(currentAssessment.makhrajEvents || [])];

    if (eventType === 'fluency') {
      if (action === 'add') updatedFluency.push({ type: detail });
      else {
        let idx = -1;
        for (let i = updatedFluency.length - 1; i >= 0; i--) {
          if (updatedFluency[i].type === detail) { idx = i; break; }
        }
        if (idx >= 0) updatedFluency.splice(idx, 1);
      }
    } else if (eventType === 'tajwid') {
      if (action === 'add') updatedTajwid.push({ type: detail });
      else {
        let idx = -1;
        for (let i = updatedTajwid.length - 1; i >= 0; i--) {
          if (updatedTajwid[i].type === detail) { idx = i; break; }
        }
        if (idx >= 0) updatedTajwid.splice(idx, 1);
      }
    } else if (eventType === 'makhraj') {
      if (action === 'add') updatedMakhraj.push({ type: detail });
      else {
        let idx = -1;
        for (let i = updatedMakhraj.length - 1; i >= 0; i--) {
          if (updatedMakhraj[i].type === detail) { idx = i; break; }
        }
        if (idx >= 0) updatedMakhraj.splice(idx, 1);
      }
    }

    // Save to server
    setIsSaving(true);
    try {
      const saveRes = await api.saveRemedialQuestionAssessment({
        attemptId: activeSession.attempt.id,
        questionNumber: currentAssessment.questionNumber,
        assessmentData: {
          fluencyEvents: updatedFluency,
          tajwidEvents: updatedTajwid,
          makhrajEvents: updatedMakhraj,
          notes: currentAssessment.notes || '',
          isCompleted: true
        },
        expectedVersion: currentAssessment.version,
        markCompleted: true
      }, user);

      if (saveRes.success && saveRes.assessment) {
        // Update local state
        const updatedAssessments = activeSession.assessments.map(a => {
          if (a.questionNumber === currentAssessment.questionNumber) {
            return {
              ...a,
              fluencyEvents: updatedFluency,
              tajwidEvents: updatedTajwid,
              makhrajEvents: updatedMakhraj,
              fluencyScore: saveRes.assessment!.fluencyScore ?? a.fluencyScore,
              tajwidScore: saveRes.assessment!.tajwidScore ?? a.tajwidScore,
              makhrajScore: saveRes.assessment!.makhrajScore ?? a.makhrajScore,
              questionScore: saveRes.assessment!.questionScore ?? a.questionScore,
              version: saveRes.assessment!.version ?? (a.version + 1),
              completedAt: saveRes.assessment!.completedAt ?? new Date().toISOString()
            };
          }
          return a;
        });

        setActiveSession({
          ...activeSession,
          assessments: updatedAssessments
        });
      } else if (saveRes.isConflict) {
        setConflictWarning('Data nomor soal telah diperbarui di perangkat lain. Mohon muat ulang.');
      } else {
        setErrorMsg(saveRes.message || 'Gagal menyimpan perubahan penilaian.');
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Terjadi kesalahan saat menyimpan penilaian.');
    } finally {
      setIsSaving(false);
    }
  };

  // Final Submit Remedial
  const handleSubmitExam = async () => {
    if (!activeSession) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await api.submitRemedialAttempt(activeSession.attempt.id, user);
      if (res.success) {
        setSuccessMsg(`Ujian remedial berhasil difinalisasi dengan nilai ${res.totalScore}. Status: ${res.isPassed ? 'Tuntas' : 'Belum Tuntas'}.`);
        setActiveSession(null);
        await loadAssignedStudents();
      } else {
        setErrorMsg(res.message || 'Gagal mengirim ujian remedial.');
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Terjadi kesalahan saat submit ujian remedial.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper count deductions
  const countEvents = (events: any[], type: string) => {
    return (events || []).filter(e => e.type === type).length;
  };

  // Render Active Exam Session Execution
  if (activeSession) {
    const isReviewStep = currentQuestionIdx === activeSession.questions.length;
    const isUTS = activeSession.item.examType === 'uts';
    const totalQuestions = activeSession.questions.length;

    return (
      <div className="space-y-6 max-w-5xl mx-auto pb-12">
        {/* Top Header Card */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                isUTS ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'
              }`}>
                Remedial {activeSession.item.examType.toUpperCase()}
              </span>
              <span className="text-xs font-semibold text-slate-400">•</span>
              <span className="text-xs font-semibold text-slate-600">{activeSession.item.periodName}</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-1">{activeSession.item.studentName}</h1>
            <p className="text-xs text-slate-500">
              NIS: {activeSession.item.nis} • Kelas: {activeSession.item.className || '-'} • Nilai Awal: <span className="font-semibold text-rose-600">{activeSession.item.originalScore}</span> (KKM: {activeSession.item.kkm})
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveSession(null)}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
            >
              Kembali ke Daftar
            </button>
          </div>
        </div>

        {/* Step Progression Tabs */}
        <div className="bg-white rounded-2xl p-3 shadow-sm border border-slate-200 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-max">
            {activeSession.questions.map((q, idx) => {
              const asm = activeSession.assessments.find(a => a.questionNumber === q.questionNumber);
              const isCompleted = !!asm?.completedAt;
              const isCurrent = currentQuestionIdx === idx;

              let label = isUTS ? `Soal ${q.questionNumber}` : (
                q.questionRole === 'mandatory' ? `Wajib ${q.questionNumber}` : `Acak ${q.questionNumber - 2}`
              );

              return (
                <button
                  key={q.id}
                  onClick={() => setCurrentQuestionIdx(idx)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                    isCurrent 
                      ? 'bg-emerald-700 text-white shadow-sm' 
                      : isCompleted
                        ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {isCompleted ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <span className="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[10px]">{q.questionNumber}</span>}
                  <span>{label}</span>
                </button>
              );
            })}

            {/* Review Step Tab */}
            <button
              onClick={() => setCurrentQuestionIdx(totalQuestions)}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                isReviewStep 
                  ? 'bg-slate-900 text-white shadow-sm' 
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>Review & Kirim</span>
            </button>
          </div>
        </div>

        {/* Conflict Warning */}
        {conflictWarning && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-sm flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="font-medium">{conflictWarning}</p>
          </div>
        )}

        {/* Question Scoring Workspace vs Review View */}
        {!isReviewStep && currentQuestion && currentAssessment ? (
          <div className="space-y-6">
            {/* Question Information Card */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {isUTS ? `Butir Soal #${currentQuestion.questionNumber}` : (
                    currentQuestion.questionRole === 'mandatory' 
                      ? `Soal Wajib #${currentQuestion.questionNumber}` 
                      : `Soal Acak #${currentQuestion.questionNumber - 2}`
                  )}
                </span>
                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 font-bold text-xs rounded-full">
                  Maks: {currentQuestion.maxScore} Poin
                </span>
              </div>

              {/* Coordinates Navigation (No Quran Text in DB) */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold text-slate-500">Koordinat Soal:</span>
                    <p className="font-mono text-slate-800 text-xs font-semibold mt-0.5">
                      Surah {currentQuestion.answerStartSurah} : Ayat {currentQuestion.answerStartAyah} (Kata {currentQuestion.answerStartWord})
                      {' → '}
                      Surah {currentQuestion.answerEndSurah} : Ayat {currentQuestion.answerEndAyah} (Kata {currentQuestion.answerEndWord})
                    </p>
                  </div>

                  {currentQuestion.startPage && (
                    <button
                      onClick={() => setMushafPage(currentQuestion.startPage!)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition shadow-sm"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Buka Mushaf Hal. {currentQuestion.startPage}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Rubric Scoring Controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* 1. Kelancaran (Fluency) */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900">Kelancaran</h3>
                    <span className="text-sm font-extrabold text-emerald-700">
                      {currentAssessment.fluencyScore} / {isUTS ? '12' : (currentQuestion.questionRole === 'mandatory' ? '9' : '6')}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {/* Self correction */}
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-800">Koreksi Mandiri</div>
                        <div className="text-[11px] text-slate-500">Deduksi: -0.5</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateAssessmentEvents('fluency', 'remove', 'self_correction')}
                          disabled={isSaving || countEvents(currentAssessment.fluencyEvents, 'self_correction') === 0}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 font-bold text-slate-700"
                        >-</button>
                        <span className="w-5 text-center font-bold text-slate-800">
                          {countEvents(currentAssessment.fluencyEvents, 'self_correction')}
                        </span>
                        <button
                          onClick={() => updateAssessmentEvents('fluency', 'add', 'self_correction')}
                          disabled={isSaving}
                          className="w-7 h-7 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold"
                        >+</button>
                      </div>
                    </div>

                    {/* Reminder */}
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-800">Ditegur</div>
                        <div className="text-[11px] text-slate-500">Deduksi: -1.0</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateAssessmentEvents('fluency', 'remove', 'reminder')}
                          disabled={isSaving || countEvents(currentAssessment.fluencyEvents, 'reminder') === 0}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 font-bold text-slate-700"
                        >-</button>
                        <span className="w-5 text-center font-bold text-slate-800">
                          {countEvents(currentAssessment.fluencyEvents, 'reminder')}
                        </span>
                        <button
                          onClick={() => updateAssessmentEvents('fluency', 'add', 'reminder')}
                          disabled={isSaving}
                          className="w-7 h-7 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold"
                        >+</button>
                      </div>
                    </div>

                    {/* Prompt */}
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-800">Dipancing</div>
                        <div className="text-[11px] text-slate-500">Deduksi: -2.0</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateAssessmentEvents('fluency', 'remove', 'prompt')}
                          disabled={isSaving || countEvents(currentAssessment.fluencyEvents, 'prompt') === 0}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 font-bold text-slate-700"
                        >-</button>
                        <span className="w-5 text-center font-bold text-slate-800">
                          {countEvents(currentAssessment.fluencyEvents, 'prompt')}
                        </span>
                        <button
                          onClick={() => updateAssessmentEvents('fluency', 'add', 'prompt')}
                          disabled={isSaving}
                          className="w-7 h-7 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold"
                        >+</button>
                      </div>
                    </div>

                    {/* Unable */}
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-800">Tidak Bisa</div>
                        <div className="text-[11px] text-slate-500">Deduksi: -4.0</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateAssessmentEvents('fluency', 'remove', 'unable')}
                          disabled={isSaving || countEvents(currentAssessment.fluencyEvents, 'unable') === 0}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 font-bold text-slate-700"
                        >-</button>
                        <span className="w-5 text-center font-bold text-slate-800">
                          {countEvents(currentAssessment.fluencyEvents, 'unable')}
                        </span>
                        <button
                          onClick={() => updateAssessmentEvents('fluency', 'add', 'unable')}
                          disabled={isSaving}
                          className="w-7 h-7 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold"
                        >+</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Tajwid */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900">Tajwid</h3>
                    <span className="text-sm font-extrabold text-emerald-700">
                      {currentAssessment.tajwidScore} / {isUTS ? '4' : (currentQuestion.questionRole === 'mandatory' ? '3' : '2')}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {/* Minor */}
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-800">Kesalahan Ringan</div>
                        <div className="text-[11px] text-slate-500">Deduksi: -0.5</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateAssessmentEvents('tajwid', 'remove', 'minor')}
                          disabled={isSaving || countEvents(currentAssessment.tajwidEvents, 'minor') === 0}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 font-bold text-slate-700"
                        >-</button>
                        <span className="w-5 text-center font-bold text-slate-800">
                          {countEvents(currentAssessment.tajwidEvents, 'minor')}
                        </span>
                        <button
                          onClick={() => updateAssessmentEvents('tajwid', 'add', 'minor')}
                          disabled={isSaving}
                          className="w-7 h-7 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold"
                        >+</button>
                      </div>
                    </div>

                    {/* Major */}
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-800">Kesalahan Nyata</div>
                        <div className="text-[11px] text-slate-500">Deduksi: -1.0</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateAssessmentEvents('tajwid', 'remove', 'major')}
                          disabled={isSaving || countEvents(currentAssessment.tajwidEvents, 'major') === 0}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 font-bold text-slate-700"
                        >-</button>
                        <span className="w-5 text-center font-bold text-slate-800">
                          {countEvents(currentAssessment.tajwidEvents, 'major')}
                        </span>
                        <button
                          onClick={() => updateAssessmentEvents('tajwid', 'add', 'major')}
                          disabled={isSaving}
                          className="w-7 h-7 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold"
                        >+</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Makhraj & Huruf */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900">Makhraj & Sifat</h3>
                    <span className="text-sm font-extrabold text-emerald-700">
                      {currentAssessment.makhrajScore} / {isUTS ? '4' : (currentQuestion.questionRole === 'mandatory' ? '3' : '2')}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {/* Minor */}
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-800">Kesalahan Ringan</div>
                        <div className="text-[11px] text-slate-500">Deduksi: -0.5</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateAssessmentEvents('makhraj', 'remove', 'minor')}
                          disabled={isSaving || countEvents(currentAssessment.makhrajEvents, 'minor') === 0}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 font-bold text-slate-700"
                        >-</button>
                        <span className="w-5 text-center font-bold text-slate-800">
                          {countEvents(currentAssessment.makhrajEvents, 'minor')}
                        </span>
                        <button
                          onClick={() => updateAssessmentEvents('makhraj', 'add', 'minor')}
                          disabled={isSaving}
                          className="w-7 h-7 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold"
                        >+</button>
                      </div>
                    </div>

                    {/* Major */}
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-800">Kesalahan Nyata</div>
                        <div className="text-[11px] text-slate-500">Deduksi: -1.0</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateAssessmentEvents('makhraj', 'remove', 'major')}
                          disabled={isSaving || countEvents(currentAssessment.makhrajEvents, 'major') === 0}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 font-bold text-slate-700"
                        >-</button>
                        <span className="w-5 text-center font-bold text-slate-800">
                          {countEvents(currentAssessment.makhrajEvents, 'major')}
                        </span>
                        <button
                          onClick={() => updateAssessmentEvents('makhraj', 'add', 'major')}
                          disabled={isSaving}
                          className="w-7 h-7 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold"
                        >+</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Navigation & Subtotal Card */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 flex items-center justify-between">
              <button
                onClick={() => setCurrentQuestionIdx(Math.max(0, currentQuestionIdx - 1))}
                disabled={currentQuestionIdx === 0}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-30 rounded-xl transition"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Sebelumnya</span>
              </button>

              <div className="text-center">
                <span className="text-xs font-medium text-slate-500">Skor Butir Soal Ini:</span>
                <div className="text-lg font-extrabold text-slate-900">
                  {currentAssessment.questionScore} / {currentQuestion.maxScore}
                </div>
              </div>

              <button
                onClick={() => setCurrentQuestionIdx(currentQuestionIdx + 1)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-sm"
              >
                <span>{currentQuestionIdx === totalQuestions - 1 ? 'Ke Review' : 'Selanjutnya'}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          /* Review Step Workspace */
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Review Penilaian Remedial</h2>
              <p className="text-xs text-slate-500 mt-1">
                Pastikan seluruh butir soal telah dinilai sebelum mengirimkan nilai final remedial ke database.
              </p>
            </div>

            {/* Summary Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200 text-xs">
                  <tr>
                    <th className="py-3 px-4">No Soal</th>
                    <th className="py-3 px-4">Role & Bobot</th>
                    <th className="py-3 px-4 text-center">Kelancaran</th>
                    <th className="py-3 px-4 text-center">Tajwid</th>
                    <th className="py-3 px-4 text-center">Makhraj</th>
                    <th className="py-3 px-4 text-center">Skor Soal</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {activeSession.questions.map((q, idx) => {
                    const asm = activeSession.assessments.find(a => a.questionNumber === q.questionNumber);
                    const isCompleted = !!asm?.completedAt;

                    return (
                      <tr key={q.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {isUTS ? `Soal ${q.questionNumber}` : (
                            q.questionRole === 'mandatory' ? `Wajib ${q.questionNumber}` : `Acak ${q.questionNumber - 2}`
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-medium text-slate-700">{q.maxScore} Poin</span>
                        </td>
                        <td className="py-3 px-4 text-center font-semibold text-slate-800">
                          {asm?.fluencyScore ?? 0}
                        </td>
                        <td className="py-3 px-4 text-center font-semibold text-slate-800">
                          {asm?.tajwidScore ?? 0}
                        </td>
                        <td className="py-3 px-4 text-center font-semibold text-slate-800">
                          {asm?.makhrajScore ?? 0}
                        </td>
                        <td className="py-3 px-4 text-center font-bold text-emerald-700">
                          {asm?.questionScore ?? 0}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {isCompleted ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-[10px]">
                              Selesai
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold text-[10px]">
                              Belum Dinilai
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => setCurrentQuestionIdx(idx)}
                            className="text-emerald-600 hover:text-emerald-700 font-semibold text-xs"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Total Authoritative Score Summary */}
            <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Perhitungan Total Remedial</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-extrabold text-slate-900">
                    {activeSession.assessments.reduce((sum, a) => sum + (Number(a.questionScore) || 0), 0).toFixed(2)}
                  </span>
                  <span className="text-sm font-semibold text-slate-500">/ 100</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  KKM: <span className="font-bold text-slate-700">{activeSession.item.kkm}</span> • Nilai Asli: <span className="font-bold text-rose-600">{activeSession.item.originalScore}</span>
                </p>
              </div>

              <button
                onClick={handleSubmitExam}
                disabled={isSubmitting || activeSession.assessments.some(a => !a.completedAt)}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-sm rounded-xl transition shadow-md"
              >
                <Send className="w-4 h-4" />
                <span>{isSubmitting ? 'Memproses Pengiriman...' : 'Kirim Nilai Remedial (Final)'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Coordinate / Page Helper Modal */}
        {mushafPage && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-bold text-slate-900">Rujukan Halaman Mushaf</h3>
                </div>
                <button onClick={() => setMushafPage(null)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-slate-600">
                Soal ini merujuk pada Mushaf Standar Madinah / Kemenag halaman <span className="font-bold text-emerald-700">{mushafPage}</span>.
              </p>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500">
                Gunakan Mushaf cetak atau menu Mushaf Digital pada tab Evaluasi Tahfiz untuk menyimak tilawah santri secara visual.
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => setMushafPage(null)}
                  className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-xl text-xs hover:bg-emerald-700 transition"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Examiner Assigned Students Table View
  return (
    <div className="space-y-6">
      {/* Notifications */}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <p className="font-medium">{successMsg}</p>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <p className="font-medium">{errorMsg}</p>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-50 text-emerald-700 rounded-xl">
              <RotateCcw className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-slate-900">Ujian Remedial Tahfiz</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Daftar santri remedial yang resmi ditugaskan kepada Anda sebagai penguji
          </p>
        </div>

        <button
          onClick={loadAssignedStudents}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition self-start md:self-auto"
        >
          <RefreshCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Perbarui Data</span>
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari santri remedial berdasarkan nama / NIS..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition"
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Komponen:</span>
            <button
              onClick={() => setSelectedExamType('ALL')}
              className={`px-3 py-1.5 rounded-xl font-medium transition ${
                selectedExamType === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Semua
            </button>
            <button
              onClick={() => setSelectedExamType('uts')}
              className={`px-3 py-1.5 rounded-xl font-medium transition ${
                selectedExamType === 'uts' ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
              }`}
            >
              UTS
            </button>
            <button
              onClick={() => setSelectedExamType('uas')}
              className={`px-3 py-1.5 rounded-xl font-medium transition ${
                selectedExamType === 'uas' ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
              }`}
            >
              UAS
            </button>
          </div>
        </div>
      </div>

      {/* Students List Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500">
            <RefreshCcw className="w-8 h-8 animate-spin text-emerald-600 mx-auto mb-3" />
            <p className="text-sm font-medium">Memuat daftar santri remedial...</p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-700 text-base">Tidak Ada Santri Ditugaskan</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Belum ada santri remedial yang ditugaskan kepada Anda atau sesuai dengan filter pencarian.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200 text-xs">
                <tr>
                  <th className="py-3.5 px-4 w-12 text-center">No</th>
                  <th className="py-3.5 px-4">Santri</th>
                  <th className="py-3.5 px-4">Kelas</th>
                  <th className="py-3.5 px-4 text-center">Komponen</th>
                  <th className="py-3.5 px-4 text-center">Nilai Awal vs KKM</th>
                  <th className="py-3.5 px-4 text-center">Status Remedial</th>
                  <th className="py-3.5 px-4 text-center">Nilai Remedial</th>
                  <th className="py-3.5 px-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredStudents.map((item, idx) => {
                  const isSubmitted = item.remedialAttemptStatus === 'submitted';
                  const isInProgress = item.remedialAttemptStatus === 'in_progress' || item.remedialAttemptStatus === 'reopened';
                  const isPassed = item.effectiveScore >= item.kkm;

                  return (
                    <tr key={item.remedialSessionId} className="hover:bg-slate-50/80 transition">
                      <td className="py-3.5 px-4 text-center font-medium text-slate-400">{idx + 1}</td>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{item.studentName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">NIS: {item.nis}</div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">{item.className || '-'}</td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full font-bold text-[11px] uppercase tracking-wider ${
                          item.examType === 'uts' ? 'bg-orange-50 text-orange-700 border border-orange-200' : 'bg-purple-50 text-purple-700 border border-purple-200'
                        }`}>
                          {item.examType.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="font-semibold text-rose-600">{item.originalScore}</span>
                        <span className="text-slate-400 mx-1">/</span>
                        <span className="font-semibold text-slate-700">{item.kkm}</span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {isSubmitted ? (
                          <span className={`px-2.5 py-1 rounded-full font-bold text-[11px] ${
                            isPassed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {item.derivedStatus.replace(/_/g, ' ')}
                          </span>
                        ) : isInProgress ? (
                          <span className="px-2.5 py-1 rounded-full font-bold text-[11px] bg-amber-100 text-amber-800">
                            SEDANG REMEDIAL
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full font-bold text-[11px] bg-slate-100 text-slate-700">
                            SIAP DIUJI
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {isSubmitted ? (
                          <span className="font-bold text-sm text-emerald-700">{item.remedialScore}</span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {isSubmitted ? (
                          <button
                            onClick={() => handleInspectResult(item)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition mx-auto"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Lihat Hasil</span>
                          </button>
                        ) : isInProgress ? (
                          <button
                            onClick={() => handleStartOrResume(item)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition shadow-sm mx-auto"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>Lanjutkan</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStartOrResume(item)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-sm mx-auto"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>Mulai Remedial</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inspect Result Modal */}
      {inspectItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Hasil Ujian Remedial</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {inspectItem.item.studentName} ({inspectItem.item.examType.toUpperCase()})
                </p>
              </div>
              <button onClick={() => setInspectItem(null)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-slate-400">Nilai Awal</div>
                  <div className="text-lg font-bold text-rose-600 mt-0.5">{inspectItem.item.originalScore}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-slate-400">KKM</div>
                  <div className="text-lg font-bold text-slate-700 mt-0.5">{inspectItem.item.kkm}</div>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div className="text-emerald-600">Nilai Remedial</div>
                  <div className="text-lg font-bold text-emerald-800 mt-0.5">{inspectItem.attempt.totalScore}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-slate-400">Nilai Efektif</div>
                  <div className="text-lg font-bold text-slate-900 mt-0.5">{inspectItem.attempt.totalScore}</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">No</th>
                      <th className="py-2.5 px-3 text-center">Kelancaran</th>
                      <th className="py-2.5 px-3 text-center">Tajwid</th>
                      <th className="py-2.5 px-3 text-center">Makhraj</th>
                      <th className="py-2.5 px-3 text-center">Skor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inspectItem.assessments.map(a => (
                      <tr key={a.id}>
                        <td className="py-2.5 px-3 font-semibold">Soal {a.questionNumber}</td>
                        <td className="py-2.5 px-3 text-center">{a.fluencyScore}</td>
                        <td className="py-2.5 px-3 text-center">{a.tajwidScore}</td>
                        <td className="py-2.5 px-3 text-center">{a.makhrajScore}</td>
                        <td className="py-2.5 px-3 text-center font-bold text-emerald-700">{a.questionScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setInspectItem(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
