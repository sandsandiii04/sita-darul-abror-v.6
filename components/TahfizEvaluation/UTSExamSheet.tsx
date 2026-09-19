import React, { useState, useEffect, useRef } from 'react';
import { 
  User, 
  ExamAttempt, 
  ExamQuestion, 
  ExamQuestionAssessment, 
  UTSAssessmentEvent,
  FluencyEventType,
  TajwidEventType,
  MakhrajEventType
} from '../../types';
import { quranService } from '../../services/quranService';
import { 
  UTS_SCORING_CONFIG, 
  FLUENCY_BUTTONS, 
  TAJWID_BUTTONS, 
  MAKHRAJ_BUTTONS,
  calculateFluencyScore,
  calculateTajwidScore,
  calculateMakhrajScore,
  calculateQuestionScore,
  calculateAttemptTotalScore,
  generateEventId
} from '../../services/utsScoringService';
import { api } from '../../api';
import { UTSExamReviewModal } from './UTSExamReviewModal';
import { 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  Cloud, 
  CloudOff, 
  RefreshCw, 
  Eye, 
  EyeOff, 
  MessageSquare, 
  Send, 
  X, 
  AlertTriangle,
  Award,
  BookOpen
} from 'lucide-react';

interface UTSExamSheetProps {
  user: User;
  periodId: string;
  studentId: string;
  studentName: string;
  studentClass: string;
  attempt: ExamAttempt;
  kkm: number;
  initialQuestions: ExamQuestion[];
  initialAssessments: ExamQuestionAssessment[];
  onFinish: () => void;
  onExit: () => void;
}

interface ReconstructedQuestionText {
  promptText: string;
  answerText: string;
  startSurahName: string;
  endSurahName: string;
  isLoading: boolean;
}

export const UTSExamSheet: React.FC<UTSExamSheetProps> = ({
  user,
  periodId,
  studentId,
  studentName,
  studentClass,
  attempt,
  kkm,
  initialQuestions,
  initialAssessments,
  onFinish,
  onExit
}) => {
  const [currentQIndex, setCurrentQIndex] = useState(0); // 0 to 4
  const [assessments, setAssessments] = useState<ExamQuestionAssessment[]>(initialAssessments);
  const [qTexts, setQTexts] = useState<Record<number, ReconstructedQuestionText>>({});
  const [showAnswer, setShowAnswer] = useState<Record<number, boolean>>({});
  const [notesOpen, setNotesOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'local' | 'error'>('saved');
  const [saveMessage, setSaveMessage] = useState<string>('Tersimpan di Cloud');
  const [isSavingNext, setIsSavingNext] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const currentQuestion = initialQuestions[currentQIndex];
  const currentQNum = currentQuestion?.questionNumber || (currentQIndex + 1);
  const currentAssessment = assessments.find(a => a.questionNumber === currentQNum) || {
    id: '',
    examAttemptId: attempt.id,
    examQuestionId: currentQuestion?.id || '',
    questionNumber: currentQNum,
    fluencyScore: 12,
    tajwidScore: 4,
    makhrajScore: 4,
    fluencyEvents: [],
    tajwidEvents: [],
    makhrajEvents: [],
    questionScore: 20,
    notes: '',
    version: 1
  };

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load dynamic Quran texts for all 5 questions
  useEffect(() => {
    let isMounted = true;

    const loadAllTexts = async () => {
      const texts: Record<number, ReconstructedQuestionText> = {};

      for (const q of initialQuestions) {
        const startSurahInfo = quranService.getSurah(q.promptStartSurah);
        const endSurahInfo = quranService.getSurah(q.answerEndSurah);
        const startSurahName = startSurahInfo?.name || `Surat ${q.promptStartSurah}`;
        const endSurahName = endSurahInfo?.name || `Surat ${q.answerEndSurah}`;

        let promptText = '...';
        let answerText = '...';

        try {
          const pStart = {
            surahNumber: q.promptStartSurah,
            ayahNumber: q.promptStartAyah,
            wordPosition: q.promptStartWord,
            pageNumber: q.startPage || 1
          };
          const pEnd = {
            surahNumber: q.promptEndSurah,
            ayahNumber: q.promptEndAyah,
            wordPosition: q.promptEndWord,
            pageNumber: q.startPage || 1
          };
          const pRes = await quranService.getRangeWordsAndText(pStart, pEnd, false);
          promptText = pRes.fullText || `${startSurahName} ayat ${q.promptStartAyah}`;

          const aStart = {
            surahNumber: q.answerStartSurah,
            ayahNumber: q.answerStartAyah,
            wordPosition: q.answerStartWord,
            pageNumber: q.startPage || 1
          };
          const aEnd = {
            surahNumber: q.answerEndSurah,
            ayahNumber: q.answerEndAyah,
            wordPosition: q.answerEndWord,
            pageNumber: q.endPage || 1
          };
          const aRes = await quranService.getRangeWordsAndText(aStart, aEnd, false);
          answerText = aRes.fullText || `${endSurahName} ayat ${q.answerStartAyah} s.d. ${q.answerEndAyah}`;
        } catch (e) {
          console.warn('Gagal memuat teks Quran soal:', e);
        }

        texts[q.questionNumber] = {
          promptText,
          answerText,
          startSurahName,
          endSurahName,
          isLoading: false
        };
      }

      if (isMounted) {
        setQTexts(texts);
      }
    };

    loadAllTexts();

    return () => {
      isMounted = false;
    };
  }, [initialQuestions]);

  // Trigger debounced autosave (for counter taps)
  const triggerAutosave = (updatedAsm: ExamQuestionAssessment) => {
    setSaveStatus('saving');
    setSaveMessage('Menyimpan perubahan...');

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.saveUTSQuestionAssessment({
          attemptId: attempt.id,
          questionNumber: updatedAsm.questionNumber,
          expectedVersion: updatedAsm.version,
          markCompleted: !!updatedAsm.completedAt,
          assessmentData: {
            fluencyEvents: updatedAsm.fluencyEvents,
            tajwidEvents: updatedAsm.tajwidEvents,
            makhrajEvents: updatedAsm.makhrajEvents,
            notes: updatedAsm.notes || '',
            isCompleted: !!updatedAsm.completedAt
          }
        }, user);

        if (res.success) {
          setSaveStatus('saved');
          setSaveMessage('Tersimpan di Cloud');
          if (res.assessment) {
            setAssessments(prev => prev.map(a => 
              a.questionNumber === updatedAsm.questionNumber 
                ? { 
                    ...a, 
                    version: res.assessment.version ?? a.version, 
                    completedAt: res.assessment.completedAt !== undefined ? res.assessment.completedAt : a.completedAt 
                  } 
                : a
            ));
          }
        } else {
          setSaveStatus('error');
          setSaveMessage('Belum tersimpan ke server ⚠️');
          if (res.isConflict) {
            setNavigationError('Data ujian telah diperbarui di sesi lain. Muat ulang untuk sinkronisasi.');
          }
        }
      } catch (err) {
        setSaveStatus('error');
        setSaveMessage('Belum tersimpan ke server ⚠️');
      }
    }, 800);
  };

  // Immediate flush save when clicking "Simpan & Berikutnya" or "Simpan & Review"
  const handleSaveAndNext = async (isFinal = false) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setIsSavingNext(true);
    setNavigationError(null);
    setSaveStatus('saving');
    setSaveMessage('Menyimpan ke server...');

    try {
      const res = await api.saveUTSQuestionAssessment({
        attemptId: attempt.id,
        questionNumber: currentAssessment.questionNumber,
        expectedVersion: currentAssessment.version,
        markCompleted: true,
        assessmentData: {
          fluencyEvents: currentAssessment.fluencyEvents,
          tajwidEvents: currentAssessment.tajwidEvents,
          makhrajEvents: currentAssessment.makhrajEvents,
          notes: currentAssessment.notes || '',
          isCompleted: true
        }
      }, user);

      if (!res.success) {
        // Gagal menyimpan: JANGAN set completed_at. JANGAN pindah soal.
        setSaveStatus('error');
        setSaveMessage('Belum tersimpan ke server ⚠️');
        setNavigationError(res.message || 'Gagal menyimpan. Coba lagi sebelum melanjutkan.');
        setIsSavingNext(false);
        return;
      }

      // Berhasil: Server-confirmed!
      setSaveStatus('saved');
      setSaveMessage('Tersimpan di Cloud');

      // Update state dengan completed_at dan version dari server
      const serverCompletedAt = res.assessment?.completedAt || new Date().toISOString();
      const serverVersion = res.assessment?.version ?? (currentAssessment.version ? currentAssessment.version + 1 : 2);

      const updated: ExamQuestionAssessment = {
        ...currentAssessment,
        completedAt: serverCompletedAt,
        version: serverVersion
      };
      updateAssessmentState(updated);

      setIsSavingNext(false);

      if (isFinal) {
        setShowReviewModal(true);
      } else {
        setCurrentQIndex(prev => Math.min(4, prev + 1));
      }
    } catch (err: any) {
      setSaveStatus('error');
      setSaveMessage('Belum tersimpan ke server ⚠️');
      setNavigationError(err.message || 'Gagal menyimpan. Coba lagi sebelum melanjutkan.');
      setIsSavingNext(false);
    }
  };

  // Add Fluency Event
  const handleAddFluency = (type: FluencyEventType, deduction: number, label: string) => {
    const newEvent: UTSAssessmentEvent = {
      id: generateEventId('fe'),
      type,
      label,
      deduction,
      timestamp: Date.now()
    };

    const newEvents = [...currentAssessment.fluencyEvents, newEvent];
    const { score: fScore } = calculateFluencyScore(newEvents);
    const qScore = calculateQuestionScore(fScore, currentAssessment.tajwidScore, currentAssessment.makhrajScore);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      fluencyEvents: newEvents,
      fluencyScore: fScore,
      questionScore: qScore
    };

    updateAssessmentState(updated);
    triggerAutosave(updated);
  };

  // Remove Fluency Event
  const handleRemoveFluency = (eventId: string) => {
    const newEvents = currentAssessment.fluencyEvents.filter(e => e.id !== eventId);
    const { score: fScore } = calculateFluencyScore(newEvents);
    const qScore = calculateQuestionScore(fScore, currentAssessment.tajwidScore, currentAssessment.makhrajScore);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      fluencyEvents: newEvents,
      fluencyScore: fScore,
      questionScore: qScore
    };

    updateAssessmentState(updated);
    triggerAutosave(updated);
  };

  // Add Tajwid Event
  const handleAddTajwid = (type: TajwidEventType, deduction: number, label: string) => {
    const newEvent: UTSAssessmentEvent = {
      id: generateEventId('te'),
      type,
      label,
      deduction,
      timestamp: Date.now()
    };

    const newEvents = [...currentAssessment.tajwidEvents, newEvent];
    const { score: tScore } = calculateTajwidScore(newEvents);
    const qScore = calculateQuestionScore(currentAssessment.fluencyScore, tScore, currentAssessment.makhrajScore);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      tajwidEvents: newEvents,
      tajwidScore: tScore,
      questionScore: qScore
    };

    updateAssessmentState(updated);
    triggerAutosave(updated);
  };

  // Remove Tajwid Event
  const handleRemoveTajwid = (eventId: string) => {
    const newEvents = currentAssessment.tajwidEvents.filter(e => e.id !== eventId);
    const { score: tScore } = calculateTajwidScore(newEvents);
    const qScore = calculateQuestionScore(currentAssessment.fluencyScore, tScore, currentAssessment.makhrajScore);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      tajwidEvents: newEvents,
      tajwidScore: tScore,
      questionScore: qScore
    };

    updateAssessmentState(updated);
    triggerAutosave(updated);
  };

  // Add Makhraj Event
  const handleAddMakhraj = (type: MakhrajEventType, deduction: number, label: string) => {
    const newEvent: UTSAssessmentEvent = {
      id: generateEventId('me'),
      type,
      label,
      deduction,
      timestamp: Date.now()
    };

    const newEvents = [...currentAssessment.makhrajEvents, newEvent];
    const { score: mScore } = calculateMakhrajScore(newEvents);
    const qScore = calculateQuestionScore(currentAssessment.fluencyScore, currentAssessment.tajwidScore, mScore);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      makhrajEvents: newEvents,
      makhrajScore: mScore,
      questionScore: qScore
    };

    updateAssessmentState(updated);
    triggerAutosave(updated);
  };

  // Remove Makhraj Event
  const handleRemoveMakhraj = (eventId: string) => {
    const newEvents = currentAssessment.makhrajEvents.filter(e => e.id !== eventId);
    const { score: mScore } = calculateMakhrajScore(newEvents);
    const qScore = calculateQuestionScore(currentAssessment.fluencyScore, currentAssessment.tajwidScore, mScore);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      makhrajEvents: newEvents,
      makhrajScore: mScore,
      questionScore: qScore
    };

    updateAssessmentState(updated);
    triggerAutosave(updated);
  };

  // Notes update
  const handleNotesChange = (val: string) => {
    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      notes: val
    };
    updateAssessmentState(updated);
    triggerAutosave(updated);
  };

  const updateAssessmentState = (updated: ExamQuestionAssessment) => {
    setAssessments(prev => {
      const idx = prev.findIndex(a => a.questionNumber === updated.questionNumber);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [...prev, updated];
    });
  };

  // Handle final submit
  const handleFinalSubmit = async () => {
    const res = await api.submitUTSAttempt(attempt.id, user);
    if (!res.success) {
      throw new Error(res.message || 'Gagal mengirim nilai.');
    }
    onFinish();
  };

  const currentCumulative = calculateAttemptTotalScore(assessments);
  const textInfo = qTexts[currentQNum];

  return (
    <div className="fixed inset-0 z-40 bg-slate-100 flex flex-col overflow-hidden font-sans">
      {/* 1. STICKY TOP HEADER */}
      <header className="bg-white border-b border-slate-200 px-3 py-2.5 sm:px-5 shrink-0 shadow-sm z-20">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
          {/* Left: Student info & Exit */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setShowExitConfirm(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
              title="Keluar Sesi"
            >
              <X size={20} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xs sm:text-sm font-black text-slate-800 truncate leading-tight">
                  {studentName}
                </h1>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold shrink-0">
                  {studentClass}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>{saveMessage}</span>
              </div>
            </div>
          </div>

          {/* Right: Live Scores */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Soal ini */}
            <div className="text-right px-2.5 py-1 rounded-xl bg-teal-50/80 border border-teal-200/60">
              <span className="text-[9px] text-teal-700 font-bold uppercase block leading-none">Nilai Soal</span>
              <span className="text-sm sm:text-base font-black text-teal-900 leading-tight">
                {currentAssessment.questionScore}
              </span>
              <span className="text-[10px] text-teal-600">/20</span>
            </div>

            {/* Total Akumulasi */}
            <div className="text-right px-2.5 py-1 rounded-xl bg-slate-900 text-white shadow-sm">
              <span className="text-[9px] text-slate-300 font-bold uppercase block leading-none">Total Nilai</span>
              <span className="text-sm sm:text-base font-black text-emerald-400 leading-tight">
                {currentCumulative}
              </span>
              <span className="text-[10px] text-slate-400">/100</span>
            </div>
          </div>
        </div>

        {/* Question Stepper Buttons */}
        <div className="max-w-3xl mx-auto pt-2.5 flex items-center justify-between gap-1.5">
          {initialQuestions.map((q, idx) => {
            const isCurrent = idx === currentQIndex;
            const asm = assessments.find(a => a.questionNumber === q.questionNumber);
            const isCompleted = !!asm?.completedAt;
            const score = asm?.questionScore ?? 20;

            return (
              <button
                key={q.questionNumber}
                onClick={() => {
                  setNavigationError(null);
                  setCurrentQIndex(idx);
                }}
                className={`flex-1 py-1.5 px-1 rounded-xl border text-center transition-all ${
                  isCurrent
                    ? 'bg-teal-700 text-white border-teal-800 shadow-sm ring-2 ring-teal-500/30'
                    : isCompleted
                    ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-900'
                    : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                <div className="text-[11px] font-black leading-tight flex items-center justify-center gap-1">
                  {isCompleted && <CheckCircle2 size={11} className={isCurrent ? 'text-emerald-200' : 'text-emerald-600'} />}
                  <span>Soal {q.questionNumber}</span>
                </div>
                <div className={`text-[10px] leading-none mt-0.5 ${isCurrent ? 'opacity-90' : isCompleted ? 'text-emerald-700 font-bold' : 'text-amber-600'}`}>
                  {isCompleted ? `${score}p` : 'Belum Selesai'}
                </div>
              </button>
            );
          })}
        </div>
      </header>

      {/* 2. SCROLLABLE BODY (Mobile-first responsive container) */}
      <main className="flex-1 overflow-y-auto p-3 sm:p-5 max-w-3xl mx-auto w-full space-y-3.5 pb-24">
        {/* Error Alert Banner if save fails */}
        {navigationError && (
          <div className="p-3 bg-red-50 border border-red-300 rounded-xl flex items-center justify-between text-xs text-red-800 animate-shake">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-600 shrink-0" />
              <span className="font-semibold">{navigationError}</span>
            </div>
            <button
              type="button"
              onClick={() => handleSaveAndNext(currentQIndex === 4)}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-[11px] shrink-0 transition-colors"
            >
              Coba Lagi
            </button>
          </div>
        )}
        {/* CARD 1: QURAN PROMPT CARD */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3.5 sm:p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                Zona {currentQuestion.zoneNumber}
              </span>
              <span className="font-bold text-slate-800">
                QS. {textInfo?.startSurahName || `Surat ${currentQuestion.promptStartSurah}`}
              </span>
            </div>
            <div className="text-slate-500 text-[11px]">
              Ayat {currentQuestion.promptStartAyah} (Hal. {currentQuestion.startPage || '-'})
            </div>
          </div>

          {/* Section A: Prompt Penguji (A .. A') */}
          <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/70 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-emerald-800 font-bold tracking-wide">
              <span>PROMPT AWAL (DIBACAKAN PENGUJI)</span>
              <span>QS. {textInfo?.startSurahName} : {currentQuestion.promptStartAyah}</span>
            </div>
            <p 
              className="text-right text-lg sm:text-xl font-serif text-slate-900 leading-loose pt-1 font-semibold"
              dir="rtl"
            >
              {textInfo?.promptText || 'Memuat lafazh ayat...'}
            </p>
          </div>

          {/* Section B & C: Collapsible Continuation Reference (B .. C) */}
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/60">
            <button
              type="button"
              onClick={() => setShowAnswer(prev => ({ ...prev, [currentQNum]: !prev[currentQNum] }))}
              className="w-full p-2.5 px-3 flex items-center justify-between text-xs font-bold text-slate-700 hover:bg-slate-100/80 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <BookOpen size={14} className="text-teal-700" />
                <span>Titik Sambung Santri (B ➔ C)</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-teal-700 font-semibold">
                {showAnswer[currentQNum] ? (
                  <>
                    <EyeOff size={13} />
                    <span>Sembunyikan Acuan</span>
                  </>
                ) : (
                  <>
                    <Eye size={13} />
                    <span>Tampilkan Acuan Jawaban</span>
                  </>
                )}
              </div>
            </button>

            {showAnswer[currentQNum] && (
              <div className="p-3 border-t border-slate-200 bg-white space-y-1.5 animate-fade-in">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Mulai: QS. {textInfo?.startSurahName}:{currentQuestion.answerStartAyah} (Kata {currentQuestion.answerStartWord})</span>
                  <span>Batas (C): QS. {textInfo?.endSurahName}:{currentQuestion.answerEndAyah}</span>
                </div>
                <p 
                  className="text-right text-base sm:text-lg font-serif text-slate-800 leading-relaxed font-normal pt-1"
                  dir="rtl"
                >
                  {textInfo?.answerText || 'Memuat teks acuan sambungan...'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* CARD 2: QUICK-TAP COUNTERS */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3.5 sm:p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">
              Input Kesalahan & Deduksi
            </h2>
            <span className="text-[11px] text-slate-400">
              Nilai otomatis berkurang saat tombol ditekan
            </span>
          </div>

          {/* 1. KELANCARAN (Max 12) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                <span className="text-xs font-bold text-slate-800">1. Kelancaran (Fashahah)</span>
              </div>
              <span className="text-xs font-black text-amber-900 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                {currentAssessment.fluencyScore} / 12
              </span>
            </div>

            {/* Touch Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {FLUENCY_BUTTONS.map(btn => (
                <button
                  key={btn.type}
                  onClick={() => handleAddFluency(btn.type, btn.deduction, btn.label)}
                  className={`p-2.5 rounded-xl border text-left active:scale-95 transition-all shadow-xs flex flex-col justify-between min-h-[64px] ${btn.btnClass}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-bold leading-tight">{btn.shortLabel}</span>
                    <span className="text-[11px] font-black opacity-90">-{btn.deduction}</span>
                  </div>
                  <span className="text-[9px] opacity-70 line-clamp-1 mt-1">{btn.label}</span>
                </button>
              ))}
            </div>

            {/* Event Chips List */}
            {currentAssessment.fluencyEvents.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {currentAssessment.fluencyEvents.map((ev, i) => (
                  <span
                    key={ev.id || i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-300"
                  >
                    <span>{ev.label} (-{ev.deduction})</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFluency(ev.id)}
                      className="hover:bg-amber-200 rounded p-0.5 text-amber-950 transition-colors"
                      title="Batalkan / Hapus"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <hr className="border-slate-100" />

          {/* 2. TAJWID (Max 4) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                <span className="text-xs font-bold text-slate-800">2. Kaidah Tajwid</span>
              </div>
              <span className="text-xs font-black text-indigo-900 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                {currentAssessment.tajwidScore} / 4
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {TAJWID_BUTTONS.map(btn => (
                <button
                  key={btn.type}
                  onClick={() => handleAddTajwid(btn.type, btn.deduction, btn.label)}
                  className={`p-2.5 rounded-xl border text-left active:scale-95 transition-all shadow-xs flex flex-col justify-between min-h-[58px] ${btn.btnClass}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-bold leading-tight">{btn.shortLabel}</span>
                    <span className="text-[11px] font-black opacity-90">-{btn.deduction}</span>
                  </div>
                  <span className="text-[9px] opacity-70 line-clamp-1 mt-1">{btn.description}</span>
                </button>
              ))}
            </div>

            {currentAssessment.tajwidEvents.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {currentAssessment.tajwidEvents.map((ev, i) => (
                  <span
                    key={ev.id || i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium bg-indigo-50 text-indigo-900 border border-indigo-300"
                  >
                    <span>{ev.label} (-{ev.deduction})</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTajwid(ev.id)}
                      className="hover:bg-indigo-200 rounded p-0.5 text-indigo-950 transition-colors"
                      title="Batalkan / Hapus"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <hr className="border-slate-100" />

          {/* 3. MAKHRAJ & SIFAT HURUF (Max 4) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                <span className="text-xs font-bold text-slate-800">3. Makhraj & Sifat Huruf</span>
              </div>
              <span className="text-xs font-black text-teal-900 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200">
                {currentAssessment.makhrajScore} / 4
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {MAKHRAJ_BUTTONS.map(btn => (
                <button
                  key={btn.type}
                  onClick={() => handleAddMakhraj(btn.type, btn.deduction, btn.label)}
                  className={`p-2.5 rounded-xl border text-left active:scale-95 transition-all shadow-xs flex flex-col justify-between min-h-[58px] ${btn.btnClass}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-bold leading-tight">{btn.shortLabel}</span>
                    <span className="text-[11px] font-black opacity-90">-{btn.deduction}</span>
                  </div>
                  <span className="text-[9px] opacity-70 line-clamp-1 mt-1">{btn.description}</span>
                </button>
              ))}
            </div>

            {currentAssessment.makhrajEvents.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {currentAssessment.makhrajEvents.map((ev, i) => (
                  <span
                    key={ev.id || i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium bg-teal-50 text-teal-900 border border-teal-300"
                  >
                    <span>{ev.label} (-{ev.deduction})</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMakhraj(ev.id)}
                      className="hover:bg-teal-200 rounded p-0.5 text-teal-950 transition-colors"
                      title="Batalkan / Hapus"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <hr className="border-slate-100" />

          {/* 4. CATATAN PENGUJI */}
          <div>
            <button
              type="button"
              onClick={() => setNotesOpen(!notesOpen)}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-teal-700 transition-colors"
            >
              <MessageSquare size={14} />
              <span>{notesOpen ? 'Tutup Catatan Soal Ini' : 'Tambah Catatan Penguji (Opsional)'}</span>
              {currentAssessment.notes && !notesOpen && (
                <span className="w-2 h-2 rounded-full bg-teal-600"></span>
              )}
            </button>

            {notesOpen && (
              <div className="mt-2 animate-fade-in">
                <textarea
                  value={currentAssessment.notes || ''}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  placeholder="Catatan penguji untuk santri pada butir soal ini (misal: panjang mad thabi'i kurang konsisten di baris kedua)..."
                  rows={2}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-slate-800"
                />
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 3. STICKY BOTTOM ACTION BAR */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-2.5 sm:p-3 shadow-lg z-30">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setCurrentQIndex(prev => Math.max(0, prev - 1))}
            disabled={currentQIndex === 0}
            className="px-3 sm:px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-white transition-all flex items-center gap-1"
          >
            <ChevronLeft size={16} />
            <span className="hidden sm:inline">Sebelumnya</span>
          </button>

          <div className="text-center">
            <span className="text-xs font-black text-slate-800">
              Soal {currentQNum} dari 5
            </span>
          </div>

          {currentQIndex < 4 ? (
            <button
              type="button"
              onClick={() => handleSaveAndNext(false)}
              disabled={isSavingNext}
              className="px-4 sm:px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>{isSavingNext ? 'Menyimpan...' : `Simpan & Lanjut Soal ${currentQNum + 1}`}</span>
              <ChevronRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSaveAndNext(true)}
              disabled={isSavingNext}
              className="px-5 sm:px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 disabled:opacity-50 text-white text-xs font-black shadow-md transition-all flex items-center gap-2 cursor-pointer"
            >
              <Send size={15} />
              <span>{isSavingNext ? 'Menyimpan...' : 'Simpan & Review Selesai'}</span>
            </button>
          )}
        </div>
      </footer>

      {/* 4. MODALS */}
      {showReviewModal && (
        <UTSExamReviewModal
          studentName={studentName}
          studentClass={studentClass}
          kkm={kkm}
          questions={initialQuestions}
          assessments={assessments}
          onSubmitFinal={handleFinalSubmit}
          onClose={() => setShowReviewModal(false)}
          onNavigateToQuestion={(qNum) => {
            setCurrentQIndex(qNum - 1);
            setShowReviewModal(false);
          }}
        />
      )}

      {showExitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-3 text-amber-800">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Tinggalkan Layar Ujian?</h3>
                <p className="text-xs text-slate-500">Progres penilaian Anda sudah tersimpan otomatis.</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Anda dapat melanjutkan kembali penilaian santri ini kapan saja selama periode ujian belum ditutup.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Lanjut Menilai
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExitConfirm(false);
                  onExit();
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-800 hover:bg-slate-900"
              >
                Keluar ke Daftar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
