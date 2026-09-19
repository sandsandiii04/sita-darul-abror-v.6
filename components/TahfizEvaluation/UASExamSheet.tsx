import React, { useState, useEffect, useRef } from 'react';
import { 
  User, 
  ExamAttempt, 
  ExamQuestion, 
  ExamQuestionAssessment, 
  UASAssessmentEvent,
  FluencyEventType,
  TajwidEventType,
  MakhrajEventType
} from '../../types';
import { quranService } from '../../services/quranService';
import { 
  UAS_SCORING_CONFIG, 
  FLUENCY_BUTTONS, 
  TAJWID_BUTTONS, 
  MAKHRAJ_BUTTONS,
  calculateUASFluencyScore,
  calculateUASTajwidScore,
  calculateUASMakhrajScore,
  calculateUASQuestionScore,
  calculateUASAttemptTotalScore,
  isMandatoryQuestion,
  generateEventId
} from '../../services/uasScoringService';
import { api } from '../../api';
import { UASExamReviewModal } from './UASExamReviewModal';
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
  BookOpen,
  Layers,
  Sparkles,
  Check
} from 'lucide-react';

interface UASExamSheetProps {
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
  pageNumber?: number;
  juzNumber?: number;
  isLoading: boolean;
}

export const UASExamSheet: React.FC<UASExamSheetProps> = ({
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
  const [currentQIndex, setCurrentQIndex] = useState(0); // 0 to 8
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
  const isCurrentMandatory = isMandatoryQuestion(currentQNum, (currentQuestion as any)?.questionRole || (currentQuestion as any)?.question_role);

  const currentAssessment = assessments.find(a => a.questionNumber === currentQNum) || {
    id: '',
    examAttemptId: attempt.id,
    examQuestionId: currentQuestion?.id || '',
    questionNumber: currentQNum,
    fluencyScore: isCurrentMandatory ? 9 : 6,
    tajwidScore: isCurrentMandatory ? 3 : 2,
    makhrajScore: isCurrentMandatory ? 3 : 2,
    fluencyEvents: [],
    tajwidEvents: [],
    makhrajEvents: [],
    questionScore: isCurrentMandatory ? 15 : 10,
    notes: '',
    version: 1
  };

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load dynamic Quran texts for all 9 questions
  useEffect(() => {
    let isMounted = true;

    const loadAllTexts = async () => {
      const texts: Record<number, ReconstructedQuestionText> = {};

      for (const q of initialQuestions) {
        const startSurahInfo = quranService.getSurah(q.promptStartSurah || q.answerStartSurah);
        const endSurahInfo = quranService.getSurah(q.answerEndSurah);
        const startSurahName = startSurahInfo?.name || `Surat ${q.promptStartSurah || q.answerStartSurah}`;
        const endSurahName = endSurahInfo?.name || `Surat ${q.answerEndSurah}`;

        const isMandatory = isMandatoryQuestion(q.questionNumber, (q as any).questionRole || (q as any).question_role);
        let promptText = '...';
        let answerText = '...';
        let pageNum = (q as any).pageNumber || (q as any).page_number || q.startPage || 1;
        let juzNum = quranService.getPageJuz(pageNum);

        try {
          if (isMandatory) {
            promptText = `Bacakan Mushaf Standar Madinah Halaman ${pageNum} secara penuh (Juz ${juzNum}).`;
            try {
              const verses = await quranService.getVersesByPage(pageNum);
              if (verses && verses.length > 0) {
                answerText = verses.map(v => `${v.textUthmani} ۝${v.ayahNumber}`).join(' ');
              } else {
                answerText = `[Halaman ${pageNum}] ${startSurahName}:${q.answerStartAyah} s.d. ${endSurahName}:${q.answerEndAyah}`;
              }
            } catch (e) {
              answerText = `[Halaman ${pageNum}] ${startSurahName}:${q.answerStartAyah} s.d. ${endSurahName}:${q.answerEndAyah}`;
            }
          } else {
            if (q.promptStartSurah && q.promptStartAyah && q.promptStartWord && q.promptEndSurah && q.promptEndAyah && q.promptEndWord) {
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
            } else {
              promptText = `QS. ${startSurahName}:${q.answerStartAyah}`;
            }

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
          }
        } catch (e) {
          console.warn('Gagal memuat teks Quran UAS:', e);
        }

        texts[q.questionNumber] = {
          promptText,
          answerText,
          startSurahName,
          endSurahName,
          pageNumber: pageNum,
          juzNumber: juzNum,
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

  // Trigger debounced autosave
  const triggerAutosave = (updatedAsm: ExamQuestionAssessment) => {
    setSaveStatus('saving');
    setSaveMessage('Menyimpan perubahan...');

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.saveUASQuestionAssessment({
          attemptId: attempt.id,
          questionNumber: updatedAsm.questionNumber,
          expectedVersion: updatedAsm.version,
          markCompleted: !!updatedAsm.completedAt,
          assessmentData: {
            fluencyEvents: updatedAsm.fluencyEvents,
            tajwidEvents: updatedAsm.tajwidEvents,
            makhrajEvents: updatedAsm.makhrajEvents,
            notes: updatedAsm.notes,
            isCompleted: !!updatedAsm.completedAt
          }
        }, user);

        if (res.success) {
          setSaveStatus('saved');
          setSaveMessage('Tersimpan di Cloud');
          if (res.assessment?.version) {
            setAssessments(prev => prev.map(a => 
              a.questionNumber === updatedAsm.questionNumber 
                ? { ...a, version: res.assessment.version } 
                : a
            ));
          }
        } else if (res.isConflict) {
          setSaveStatus('error');
          setSaveMessage('Konflik versi: ' + res.message);
        } else {
          setSaveStatus('local');
          setSaveMessage(res.message || 'Tersimpan lokal');
        }
      } catch (err: any) {
        setSaveStatus('error');
        setSaveMessage('Gagal simpan: ' + (err.message || 'Koneksi terputus'));
      }
    }, 600);
  };

  // Event dispatchers for counters
  const handleAddFluency = (type: FluencyEventType) => {
    const btn = FLUENCY_BUTTONS.find(b => b.type === type);
    if (!btn) return;

    const newEvent: UASAssessmentEvent = {
      id: generateEventId('f'),
      type,
      label: btn.label,
      deduction: btn.deduction,
      timestamp: Date.now()
    };

    const newEvents = [...currentAssessment.fluencyEvents, newEvent];
    const { score: fScore } = calculateUASFluencyScore(newEvents, isCurrentMandatory);
    const qScore = calculateUASQuestionScore(fScore, currentAssessment.tajwidScore, currentAssessment.makhrajScore, isCurrentMandatory);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      fluencyEvents: newEvents,
      fluencyScore: fScore,
      questionScore: qScore,
      updatedAt: new Date().toISOString()
    };

    updateCurrentAssessmentState(updated);
  };

  const handleRemoveFluency = (eventId: string) => {
    const newEvents = currentAssessment.fluencyEvents.filter(e => e.id !== eventId);
    const { score: fScore } = calculateUASFluencyScore(newEvents, isCurrentMandatory);
    const qScore = calculateUASQuestionScore(fScore, currentAssessment.tajwidScore, currentAssessment.makhrajScore, isCurrentMandatory);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      fluencyEvents: newEvents,
      fluencyScore: fScore,
      questionScore: qScore,
      updatedAt: new Date().toISOString()
    };

    updateCurrentAssessmentState(updated);
  };

  const handleAddTajwid = (type: TajwidEventType) => {
    const btn = TAJWID_BUTTONS.find(b => b.type === type);
    if (!btn) return;

    const newEvent: UASAssessmentEvent = {
      id: generateEventId('t'),
      type,
      label: btn.label,
      deduction: btn.deduction,
      timestamp: Date.now()
    };

    const newEvents = [...currentAssessment.tajwidEvents, newEvent];
    const { score: tScore } = calculateUASTajwidScore(newEvents, isCurrentMandatory);
    const qScore = calculateUASQuestionScore(currentAssessment.fluencyScore, tScore, currentAssessment.makhrajScore, isCurrentMandatory);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      tajwidEvents: newEvents,
      tajwidScore: tScore,
      questionScore: qScore,
      updatedAt: new Date().toISOString()
    };

    updateCurrentAssessmentState(updated);
  };

  const handleRemoveTajwid = (eventId: string) => {
    const newEvents = currentAssessment.tajwidEvents.filter(e => e.id !== eventId);
    const { score: tScore } = calculateUASTajwidScore(newEvents, isCurrentMandatory);
    const qScore = calculateUASQuestionScore(currentAssessment.fluencyScore, tScore, currentAssessment.makhrajScore, isCurrentMandatory);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      tajwidEvents: newEvents,
      tajwidScore: tScore,
      questionScore: qScore,
      updatedAt: new Date().toISOString()
    };

    updateCurrentAssessmentState(updated);
  };

  const handleAddMakhraj = (type: MakhrajEventType) => {
    const btn = MAKHRAJ_BUTTONS.find(b => b.type === type);
    if (!btn) return;

    const newEvent: UASAssessmentEvent = {
      id: generateEventId('m'),
      type,
      label: btn.label,
      deduction: btn.deduction,
      timestamp: Date.now()
    };

    const newEvents = [...currentAssessment.makhrajEvents, newEvent];
    const { score: mScore } = calculateUASMakhrajScore(newEvents, isCurrentMandatory);
    const qScore = calculateUASQuestionScore(currentAssessment.fluencyScore, currentAssessment.tajwidScore, mScore, isCurrentMandatory);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      makhrajEvents: newEvents,
      makhrajScore: mScore,
      questionScore: qScore,
      updatedAt: new Date().toISOString()
    };

    updateCurrentAssessmentState(updated);
  };

  const handleRemoveMakhraj = (eventId: string) => {
    const newEvents = currentAssessment.makhrajEvents.filter(e => e.id !== eventId);
    const { score: mScore } = calculateUASMakhrajScore(newEvents, isCurrentMandatory);
    const qScore = calculateUASQuestionScore(currentAssessment.fluencyScore, currentAssessment.tajwidScore, mScore, isCurrentMandatory);

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      makhrajEvents: newEvents,
      makhrajScore: mScore,
      questionScore: qScore,
      updatedAt: new Date().toISOString()
    };

    updateCurrentAssessmentState(updated);
  };

  const handleNotesChange = (notes: string) => {
    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      notes,
      updatedAt: new Date().toISOString()
    };
    updateCurrentAssessmentState(updated);
  };

  const toggleQuestionCompleted = () => {
    const isCompletedNow = !currentAssessment.completedAt;
    const newCompletedAt = isCompletedNow ? new Date().toISOString() : null;

    const updated: ExamQuestionAssessment = {
      ...currentAssessment,
      completedAt: newCompletedAt,
      updatedAt: new Date().toISOString()
    };

    updateCurrentAssessmentState(updated, true);
  };

  const updateCurrentAssessmentState = (updated: ExamQuestionAssessment, immediateSave = false) => {
    setAssessments(prev => prev.map(a => a.questionNumber === updated.questionNumber ? updated : a));
    if (immediateSave) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      setSaveStatus('saving');
      setSaveMessage('Menyimpan status soal...');
      api.saveUASQuestionAssessment({
        attemptId: attempt.id,
        questionNumber: updated.questionNumber,
        expectedVersion: updated.version,
        markCompleted: !!updated.completedAt,
        assessmentData: {
          fluencyEvents: updated.fluencyEvents,
          tajwidEvents: updated.tajwidEvents,
          makhrajEvents: updated.makhrajEvents,
          notes: updated.notes,
          isCompleted: !!updated.completedAt
        }
      }, user).then(res => {
        if (res.success) {
          setSaveStatus('saved');
          setSaveMessage('Tersimpan di Cloud');
          if (res.assessment?.version) {
            setAssessments(prev => prev.map(a => 
              a.questionNumber === updated.questionNumber 
                ? { ...a, version: res.assessment.version } 
                : a
            ));
          }
        } else {
          setSaveStatus('local');
          setSaveMessage(res.message || 'Tersimpan lokal');
        }
      }).catch(err => {
        setSaveStatus('error');
        setSaveMessage('Gagal: ' + (err.message || 'Koneksi terputus'));
      });
    } else {
      triggerAutosave(updated);
    }
  };

  // Direct question navigation
  const navigateToQuestion = (qNum: number) => {
    const targetIdx = initialQuestions.findIndex(q => q.questionNumber === qNum);
    if (targetIdx >= 0) {
      setCurrentQIndex(targetIdx);
      setNotesOpen(false);
      setNavigationError(null);
    }
  };

  // Next Question button with auto-complete prompt
  const handleNextQuestion = async () => {
    if (!currentAssessment.completedAt) {
      // Auto-mark completed when advancing
      const updated: ExamQuestionAssessment = {
        ...currentAssessment,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      updateCurrentAssessmentState(updated, true);
    }

    if (currentQIndex < initialQuestions.length - 1) {
      setCurrentQIndex(prev => prev + 1);
      setNotesOpen(false);
      setNavigationError(null);
    } else {
      setShowReviewModal(true);
    }
  };

  const handlePrevQuestion = () => {
    if (currentQIndex > 0) {
      setCurrentQIndex(prev => prev - 1);
      setNotesOpen(false);
      setNavigationError(null);
    }
  };

  const totalCalculatedScore = calculateUASAttemptTotalScore(assessments);
  const completedCount = assessments.filter(a => !!a.completedAt).length;
  const currentText = qTexts[currentQNum] || {
    promptText: 'Memuat teks ayat...',
    answerText: 'Memuat teks rujukan...',
    startSurahName: '',
    endSurahName: '',
    isLoading: true
  };

  const maxFluency = isCurrentMandatory ? UAS_SCORING_CONFIG.mandatory.maxFluency : UAS_SCORING_CONFIG.random.maxFluency;
  const maxTajwid = isCurrentMandatory ? UAS_SCORING_CONFIG.mandatory.maxTajwid : UAS_SCORING_CONFIG.random.maxTajwid;
  const maxMakhraj = isCurrentMandatory ? UAS_SCORING_CONFIG.mandatory.maxMakhraj : UAS_SCORING_CONFIG.random.maxMakhraj;
  const maxQScore = isCurrentMandatory ? UAS_SCORING_CONFIG.mandatory.maxQuestionScore : UAS_SCORING_CONFIG.random.maxQuestionScore;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans select-none pb-12">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-slate-800/95 backdrop-blur-md border-b border-slate-700/80 px-3 sm:px-5 py-2.5 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowExitConfirm(true)}
            className="p-1.5 sm:p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700/80 transition-colors"
            title="Keluar Sesi Ujian"
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-extrabold text-white tracking-wide">
                {studentName}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Kelas {studentClass}
              </span>
              <span className="hidden sm:inline-block text-[10px] px-2 py-0.5 rounded-full font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                UAS Tahfiz
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="text-slate-300">Penguji: {user.name}</span>
              <span>•</span>
              <span className="flex items-center gap-1">
                {saveStatus === 'saving' && <RefreshCw size={11} className="animate-spin text-amber-400" />}
                {saveStatus === 'saved' && <Cloud size={11} className="text-emerald-400" />}
                {saveStatus === 'local' && <CloudOff size={11} className="text-blue-400" />}
                {saveStatus === 'error' && <AlertTriangle size={11} className="text-rose-400" />}
                <span className={saveStatus === 'saved' ? 'text-emerald-400' : 'text-slate-400'}>
                  {saveMessage}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Live Score Counter & Review Button */}
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="text-right hidden xs:block">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">Total Nilai</span>
            <div className="flex items-baseline justify-end gap-1">
              <span className="text-lg sm:text-xl font-black text-emerald-400">{totalCalculatedScore}</span>
              <span className="text-[10px] text-slate-400">/100</span>
            </div>
          </div>

          <button
            onClick={() => setShowReviewModal(true)}
            className="px-3 sm:px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 transition-all shadow-md shadow-emerald-950/40 flex items-center gap-1.5 cursor-pointer"
          >
            <Award size={15} />
            <span className="hidden sm:inline">Review & Submit</span>
            <span className="sm:hidden font-extrabold">{totalCalculatedScore}p</span>
          </button>
        </div>
      </header>

      {/* 9-Question Tab Strip */}
      <div className="bg-slate-800/60 border-b border-slate-700/60 px-3 py-2 overflow-x-auto">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-1.5 sm:gap-2">
          {initialQuestions.map((q, idx) => {
            const asm = assessments.find(a => a.questionNumber === q.questionNumber);
            const isCompleted = !!asm?.completedAt;
            const isCurrent = idx === currentQIndex;
            const isMandatory = isMandatoryQuestion(q.questionNumber, (q as any).questionRole || (q as any).question_role);

            return (
              <button
                key={q.questionNumber}
                onClick={() => navigateToQuestion(q.questionNumber)}
                className={`flex-1 min-w-[42px] py-1.5 sm:py-2 px-1 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer relative ${
                  isCurrent 
                    ? (isMandatory ? 'bg-indigo-600 text-white shadow-lg ring-2 ring-indigo-400' : 'bg-teal-600 text-white shadow-lg ring-2 ring-teal-400')
                    : isCompleted
                      ? 'bg-slate-700/80 text-emerald-300 hover:bg-slate-700 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700/60 border border-slate-700'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className="text-xs font-black">#{q.questionNumber}</span>
                  {isCompleted && (
                    <CheckCircle2 size={11} className={isCurrent ? 'text-white' : 'text-emerald-400'} />
                  )}
                </div>
                <span className="text-[9px] uppercase tracking-tighter opacity-80 mt-0.5">
                  {isMandatory ? 'Wajib' : `Z${q.zoneNumber}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Examination Sheet Area */}
      <main className="max-w-3xl w-full mx-auto p-3 sm:p-5 space-y-4 flex-1">
        {/* Question Header Card */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-lg text-xs font-black tracking-wide ${
                isCurrentMandatory 
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' 
                  : 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
              }`}>
                {isCurrentMandatory ? 'SOAL WAJIB (HALAMAN PENUH)' : `SOAL ACAK — ZONA ${currentQuestion?.zoneNumber}`}
              </span>
              <span className="text-xs text-slate-400 font-semibold">
                Maks: <span className="text-white font-bold">{maxQScore} Poin</span>
              </span>
            </div>

            {/* Complete Toggle Button */}
            <button
              onClick={toggleQuestionCompleted}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                currentAssessment.completedAt
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600'
              }`}
            >
              <CheckCircle2 size={14} className={currentAssessment.completedAt ? 'text-white' : 'text-slate-400'} />
              <span>{currentAssessment.completedAt ? 'Selesai Diuji' : 'Tandai Selesai'}</span>
            </button>
          </div>

          {/* Surah & Ayah / Page Info */}
          <div className="mt-2 text-sm text-slate-300">
            {isCurrentMandatory ? (
              <div className="flex items-center gap-2 text-indigo-300 font-bold">
                <BookOpen size={16} />
                <span>Mushaf Madinah Halaman {currentText.pageNumber || currentQuestion?.pageNumber || '-'} (Juz {currentText.juzNumber || '-'})</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-teal-300 font-bold">
                <Layers size={16} />
                <span>{currentText.startSurahName} (Ayat {currentQuestion?.promptStartAyah} s.d. {currentQuestion?.answerEndAyah})</span>
              </div>
            )}
          </div>

          {/* Prompt Box */}
          <div className="mt-3 p-3.5 rounded-xl bg-slate-900/90 border border-slate-700/80">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold mb-1">
              {isCurrentMandatory ? 'Instruksi Penguji' : 'Potongan Awal Ayat (Pemicu)'}
            </span>
            <p className="text-base sm:text-lg font-arabic text-emerald-300 leading-loose text-right dir-rtl font-medium">
              {currentText.promptText}
            </p>
          </div>

          {/* Answer Accordion Toggle */}
          <div className="mt-3">
            <button
              onClick={() => setShowAnswer(prev => ({ ...prev, [currentQNum]: !prev[currentQNum] }))}
              className="text-xs font-bold text-teal-400 hover:text-teal-300 flex items-center gap-1.5 py-1 transition-colors"
            >
              {showAnswer[currentQNum] ? <EyeOff size={14} /> : <Eye size={14} />}
              <span>{showAnswer[currentQNum] ? 'Sembunyikan Teks Lengkap' : 'Lihat Teks Lengkap Rujukan'}</span>
            </button>

            {showAnswer[currentQNum] && (
              <div className="mt-2 p-3.5 rounded-xl bg-slate-900/60 border border-teal-500/30 animate-fade-in">
                <span className="text-[10px] text-teal-400 uppercase tracking-wider block font-semibold mb-1.5">
                  {isCurrentMandatory ? `Teks Seluruh Halaman ${currentText.pageNumber}` : 'Teks Lengkap Jawaban Santri'}
                </span>
                <p className="text-sm sm:text-base font-arabic text-slate-200 leading-loose text-right dir-rtl max-h-60 overflow-y-auto pr-1">
                  {currentText.answerText}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Live Score for This Question */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 shadow-xl flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 block font-semibold">Skor Soal #{currentQNum}</span>
            <div className="flex items-center gap-3 text-xs mt-1">
              <span className="text-slate-300">
                Kelancaran: <b className="text-amber-400">{currentAssessment.fluencyScore}</b>/{maxFluency}
              </span>
              <span>•</span>
              <span className="text-slate-300">
                Tajwid: <b className="text-indigo-400">{currentAssessment.tajwidScore}</b>/{maxTajwid}
              </span>
              <span>•</span>
              <span className="text-slate-300">
                Makhraj: <b className="text-teal-400">{currentAssessment.makhrajScore}</b>/{maxMakhraj}
              </span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-2xl sm:text-3xl font-black text-white">{currentAssessment.questionScore}</span>
            <span className="text-xs text-slate-400 ml-1">/{maxQScore}</span>
          </div>
        </div>

        {/* Scoring Aspect 1: KELANCARAN */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                1. KELANCARAN HAFALAN (60%)
              </h4>
            </div>
            <div className="text-xs font-bold text-amber-400">
              {currentAssessment.fluencyScore} / {maxFluency} Poin
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FLUENCY_BUTTONS.map(btn => (
              <button
                key={btn.type}
                onClick={() => handleAddFluency(btn.type)}
                className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-all active:scale-95 cursor-pointer ${btn.btnClass}`}
              >
                <span className="text-xs font-bold">{btn.shortLabel}</span>
                <span className="text-[10px] opacity-80 mt-0.5">-{btn.deduction}p</span>
              </button>
            ))}
          </div>

          {/* Fluency Recorded Events */}
          {currentAssessment.fluencyEvents.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {currentAssessment.fluencyEvents.map(ev => (
                <span
                  key={ev.id}
                  onClick={() => handleRemoveFluency(ev.id)}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 cursor-pointer hover:bg-amber-500/30 transition-colors"
                  title="Klik untuk menghapus catatan"
                >
                  <span>{ev.label} (-{ev.deduction}p)</span>
                  <X size={11} className="hover:text-white" />
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Scoring Aspect 2: TAJWID */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
              <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                2. KAIDAH TAJWID (20%)
              </h4>
            </div>
            <div className="text-xs font-bold text-indigo-400">
              {currentAssessment.tajwidScore} / {maxTajwid} Poin
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {TAJWID_BUTTONS.map(btn => (
              <button
                key={btn.type}
                onClick={() => handleAddTajwid(btn.type)}
                className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-all active:scale-95 cursor-pointer ${btn.btnClass}`}
              >
                <span className="text-xs font-bold">{btn.label}</span>
                <span className="text-[10px] opacity-80 mt-0.5">-{btn.deduction}p</span>
              </button>
            ))}
          </div>

          {/* Tajwid Recorded Events */}
          {currentAssessment.tajwidEvents.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {currentAssessment.tajwidEvents.map(ev => (
                <span
                  key={ev.id}
                  onClick={() => handleRemoveTajwid(ev.id)}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center gap-1 cursor-pointer hover:bg-indigo-500/30 transition-colors"
                  title="Klik untuk menghapus catatan"
                >
                  <span>{ev.label} (-{ev.deduction}p)</span>
                  <X size={11} className="hover:text-white" />
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Scoring Aspect 3: MAKHRAJ */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-teal-400" />
              <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                3. MAKHRAJ & SIFAT HURUF (20%)
              </h4>
            </div>
            <div className="text-xs font-bold text-teal-400">
              {currentAssessment.makhrajScore} / {maxMakhraj} Poin
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {MAKHRAJ_BUTTONS.map(btn => (
              <button
                key={btn.type}
                onClick={() => handleAddMakhraj(btn.type)}
                className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-all active:scale-95 cursor-pointer ${btn.btnClass}`}
              >
                <span className="text-xs font-bold">{btn.label}</span>
                <span className="text-[10px] opacity-80 mt-0.5">-{btn.deduction}p</span>
              </button>
            ))}
          </div>

          {/* Makhraj Recorded Events */}
          {currentAssessment.makhrajEvents.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {currentAssessment.makhrajEvents.map(ev => (
                <span
                  key={ev.id}
                  onClick={() => handleRemoveMakhraj(ev.id)}
                  className="px-2 py-1 rounded-lg text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40 flex items-center gap-1 cursor-pointer hover:bg-teal-500/30 transition-colors"
                  title="Klik untuk menghapus catatan"
                >
                  <span>{ev.label} (-{ev.deduction}p)</span>
                  <X size={11} className="hover:text-white" />
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Examiner Notes */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 shadow-xl">
          <button
            onClick={() => setNotesOpen(!notesOpen)}
            className="w-full flex items-center justify-between text-xs font-bold text-slate-300 hover:text-white transition-colors"
          >
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-slate-400" />
              <span>Catatan Penguji untuk Soal #{currentQNum}</span>
              {currentAssessment.notes && (
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              )}
            </div>
            <span className="text-[11px] text-slate-400">{notesOpen ? 'Tutup' : 'Buka'}</span>
          </button>

          {notesOpen && (
            <div className="mt-3 animate-fade-in">
              <textarea
                value={currentAssessment.notes || ''}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Tuliskan catatan khusus santri (misal: sering ragu di awal ayat 15)..."
                rows={2}
                className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 resize-none"
              />
            </div>
          )}
        </div>

        {/* Navigation Footer */}
        <div className="pt-2 flex items-center justify-between gap-3">
          <button
            onClick={handlePrevQuestion}
            disabled={currentQIndex === 0}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1"
          >
            <ChevronLeft size={16} />
            <span>Sebelumnya</span>
          </button>

          <span className="text-xs text-slate-400 font-semibold">
            Soal {currentQNum} dari 9 ({completedCount}/9 selesai)
          </span>

          <button
            onClick={handleNextQuestion}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-teal-600 hover:bg-teal-500 transition-all shadow-md flex items-center gap-1 cursor-pointer"
          >
            <span>{currentQIndex === initialQuestions.length - 1 ? 'Review Selesai' : 'Lanjut'}</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </main>

      {/* Review & Final Submit Modal */}
      {showReviewModal && (
        <UASExamReviewModal
          studentName={studentName}
          studentClass={studentClass}
          kkm={kkm}
          questions={initialQuestions}
          assessments={assessments}
          onSubmitFinal={async () => {
            const res = await api.submitUASAttempt(attempt.id, user);
            if (res.success) {
              onFinish();
            } else {
              throw new Error(res.message || 'Gagal finalisasi ujian UAS.');
            }
          }}
          onClose={() => setShowReviewModal(false)}
          onNavigateToQuestion={(qNum) => {
            setShowReviewModal(false);
            navigateToQuestion(qNum);
          }}
        />
      )}

      {/* Exit Confirmation Modal */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-800 rounded-2xl max-w-sm w-full p-5 border border-slate-700 shadow-2xl space-y-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">Keluar dari Lembar Ujian?</h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                Seluruh nilai dan catatan event yang telah dimasukkan tersimpan secara otomatis. Anda dapat melanjutkan kembali kapan saja selama periode ujian belum ditutup.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-700">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:bg-slate-700 transition-colors"
              >
                Tetap Menilai
              </button>
              <button
                onClick={onExit}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors"
              >
                Keluar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
