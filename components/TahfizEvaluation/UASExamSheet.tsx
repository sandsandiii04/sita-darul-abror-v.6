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
  getQuestionMaxScores,
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
  const [saveMessage, setSaveMessage] = useState<string>('Tersimpan');
  const [isSavingNext, setIsSavingNext] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const sessionType = attempt.sessionType || (initialQuestions.length === 4 ? 'partial_half' : 'full_juz');
  const totalQuestionsCount = initialQuestions.length || (sessionType === 'partial_half' ? 4 : 9);
  const currentQuestion = initialQuestions[currentQIndex];
  const currentQNum = currentQuestion?.questionNumber || (currentQIndex + 1);
  const isCurrentMandatory = sessionType === 'partial_half'
    ? false
    : isMandatoryQuestion(currentQNum, (currentQuestion as any)?.questionRole || (currentQuestion as any)?.question_role);
  const currentMax = getQuestionMaxScores(currentQNum, (currentQuestion as any)?.questionRole || (currentQuestion as any)?.question_role, sessionType);

  const currentAssessment = assessments.find(a => a.questionNumber === currentQNum) || {
    id: '',
    examAttemptId: attempt.id,
    examQuestionId: currentQuestion?.id || '',
    questionNumber: currentQNum,
    fluencyScore: currentMax.maxFluency,
    tajwidScore: currentMax.maxTajwid,
    makhrajScore: currentMax.maxMakhraj,
    fluencyEvents: [],
    tajwidEvents: [],
    makhrajEvents: [],
    questionScore: currentMax.maxQuestionScore,
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

        const isMandatory = sessionType === 'partial_half'
          ? false
          : isMandatoryQuestion(q.questionNumber, (q as any).questionRole || (q as any).question_role);
        let promptText = '...';
        let answerText = '...';
        let pageNum = (q as any).pageNumber || (q as any).page_number || q.startPage || 1;
        let juzNum = quranService.getPageJuz(pageNum);

        try {
          if (isMandatory) {
            promptText = `Bacakan halaman ini secara penuh.`;
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
    setSaveMessage('Menyimpan...');

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
          setSaveMessage('Tersimpan');
          const nextVer = (res as any).version ?? res.assessment?.version;
          if (nextVer) {
            setAssessments(prev => prev.map(a => 
              a.questionNumber === updatedAsm.questionNumber 
                ? { ...a, version: nextVer } 
                : a
            ));
          }
        } else if (res.isConflict) {
          setSaveStatus('error');
          setSaveMessage('Konflik data. Muat ulang halaman.');
        } else if (res.savedLocally) {
          setSaveStatus('local');
          setSaveMessage('Tersimpan lokal');
        } else {
          setSaveStatus('error');
          setSaveMessage(res.message || 'Gagal menyimpan');
        }
      } catch (err: any) {
        setSaveStatus('error');
        setSaveMessage('Koneksi terputus');
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
    const { score: fScore } = calculateUASFluencyScore(newEvents, isCurrentMandatory, sessionType);
    const qScore = calculateUASQuestionScore(fScore, currentAssessment.tajwidScore, currentAssessment.makhrajScore, isCurrentMandatory, sessionType);

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
    const { score: fScore } = calculateUASFluencyScore(newEvents, isCurrentMandatory, sessionType);
    const qScore = calculateUASQuestionScore(fScore, currentAssessment.tajwidScore, currentAssessment.makhrajScore, isCurrentMandatory, sessionType);

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
    const { score: tScore } = calculateUASTajwidScore(newEvents, isCurrentMandatory, sessionType);
    const qScore = calculateUASQuestionScore(currentAssessment.fluencyScore, tScore, currentAssessment.makhrajScore, isCurrentMandatory, sessionType);

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
    const { score: tScore } = calculateUASTajwidScore(newEvents, isCurrentMandatory, sessionType);
    const qScore = calculateUASQuestionScore(currentAssessment.fluencyScore, tScore, currentAssessment.makhrajScore, isCurrentMandatory, sessionType);

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
    const { score: mScore } = calculateUASMakhrajScore(newEvents, isCurrentMandatory, sessionType);
    const qScore = calculateUASQuestionScore(currentAssessment.fluencyScore, currentAssessment.tajwidScore, mScore, isCurrentMandatory, sessionType);

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
    const { score: mScore } = calculateUASMakhrajScore(newEvents, isCurrentMandatory, sessionType);
    const qScore = calculateUASQuestionScore(currentAssessment.fluencyScore, currentAssessment.tajwidScore, mScore, isCurrentMandatory, sessionType);

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
      setSaveMessage('Menyimpan...');
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
          setSaveMessage('Tersimpan');
          const nextVer = (res as any).version ?? res.assessment?.version;
          if (nextVer) {
            setAssessments(prev => prev.map(a => 
              a.questionNumber === updated.questionNumber 
                ? { ...a, version: nextVer } 
                : a
            ));
          }
        } else if (res.isConflict) {
          setSaveStatus('error');
          setSaveMessage('Konflik data. Muat ulang halaman.');
        } else if (res.savedLocally) {
          setSaveStatus('local');
          setSaveMessage('Tersimpan lokal');
        } else {
          setSaveStatus('error');
          setSaveMessage(res.message || 'Gagal menyimpan');
        }
      }).catch(() => {
        setSaveStatus('error');
        setSaveMessage('Koneksi terputus');
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

  const maxFluency = currentMax.maxFluency;
  const maxTajwid = currentMax.maxTajwid;
  const maxMakhraj = currentMax.maxMakhraj;
  const maxQScore = currentMax.maxQuestionScore;
  const sessionNum = attempt.sessionNumber || attempt.attemptNumber || 1;
  const displayJuz = currentText.juzNumber || (attempt as any).juzNumber || quranService.getPageJuz((currentQuestion as any)?.pageNumber || currentQuestion?.startPage || 1);
  const mandatoryOrder = isCurrentMandatory
    ? initialQuestions.filter((q, idx) =>
        idx <= currentQIndex &&
        isMandatoryQuestion(q.questionNumber, (q as any).questionRole || (q as any).question_role)
      ).length || 1
    : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans select-none pb-8">
      {/* Compact Light Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 px-3 sm:px-5 py-2.5">
        <div className="max-w-3xl lg:max-w-6xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setShowExitConfirm(true)}
              className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
              title="Keluar Sesi Ujian"
              aria-label="Keluar Sesi Ujian"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-bold text-slate-900 truncate leading-tight">
                {studentName}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 mt-0.5">
                <span className="font-semibold text-slate-700">Juz {displayJuz}</span>
                <span>•</span>
                <span>Sesi {sessionNum}</span>
                <span>•</span>
                <span className="font-semibold text-teal-700">
                  {currentQIndex + 1} dari {totalQuestionsCount}
                </span>
                <span>•</span>
                <span className="inline-flex items-center gap-1">
                  {saveStatus === 'saving' && <RefreshCw size={11} className="animate-spin text-amber-600" />}
                  {saveStatus === 'saved' && <Cloud size={11} className="text-emerald-600" />}
                  {saveStatus === 'local' && <CloudOff size={11} className="text-amber-600" />}
                  {saveStatus === 'error' && <AlertTriangle size={11} className="text-rose-600" />}
                  <span
                    className={
                      saveStatus === 'saved'
                        ? 'text-emerald-700 font-medium'
                        : saveStatus === 'local'
                          ? 'text-amber-700 font-semibold'
                          : saveStatus === 'error'
                            ? 'text-rose-700 font-semibold'
                            : 'text-slate-500'
                    }
                  >
                    {saveMessage}
                  </span>
                  {saveStatus === 'local' && (
                    <button
                      type="button"
                      onClick={async () => {
                        setSaveStatus('saving');
                        setSaveMessage('Menyinkronkan...');
                        const syncRes = await api.syncPendingUASAssessments(attempt.id, user);
                        if (syncRes.success) {
                          setSaveStatus('saved');
                          setSaveMessage('Tersimpan');
                        } else {
                          setSaveStatus('local');
                          setSaveMessage('Belum sync');
                        }
                      }}
                      className="ml-1 px-2 py-0.5 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold"
                    >
                      Sinkronkan
                    </button>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Live Score & Finish Button */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right hidden sm:block">
              <span className="text-[10px] text-slate-500 block font-medium leading-none">Total Nilai</span>
              <div className="flex items-baseline justify-end gap-0.5 mt-0.5">
                <span className="text-lg font-extrabold text-teal-700">{totalCalculatedScore}</span>
                <span className="text-[11px] text-slate-400">/100</span>
              </div>
            </div>

            <button
              onClick={() => setShowReviewModal(true)}
              className="px-3 sm:px-4 py-2 rounded-xl text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Award size={15} />
              <span className="hidden sm:inline">Selesaikan Ujian</span>
              <span className="sm:hidden">{totalCalculatedScore}/100</span>
            </button>
          </div>
        </div>
      </header>

      {/* Question Navigation Strip */}
      <div className="bg-white border-b border-slate-200 px-3 py-2 overflow-x-auto">
        <div className="max-w-3xl lg:max-w-6xl mx-auto flex items-center gap-1.5 sm:gap-2">
          {initialQuestions.map((q, idx) => {
            const asm = assessments.find(a => a.questionNumber === q.questionNumber);
            const isCompleted = !!asm?.completedAt;
            const hasActivity = Boolean(
              asm &&
                ((asm.fluencyEvents && asm.fluencyEvents.length > 0) ||
                  (asm.tajwidEvents && asm.tajwidEvents.length > 0) ||
                  (asm.makhrajEvents && asm.makhrajEvents.length > 0) ||
                  (asm.notes && asm.notes.trim().length > 0))
            );
            const isNeedsCheck = !isCompleted && hasActivity;
            const isCurrent = idx === currentQIndex;
            const isMandatory = sessionType === 'partial_half'
              ? false
              : isMandatoryQuestion(q.questionNumber, (q as any).questionRole || (q as any).question_role);

            return (
              <button
                key={q.questionNumber}
                onClick={() => navigateToQuestion(q.questionNumber)}
                className={`flex-1 min-w-[46px] py-2 px-1.5 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer ${
                  isCurrent
                    ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                    : isCompleted
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                      : isNeedsCheck
                        ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-0.5">
                  <span className="text-xs font-bold">{q.questionNumber}</span>
                  {isCompleted && (
                    <CheckCircle2 size={11} className={isCurrent ? 'text-white' : 'text-emerald-600'} />
                  )}
                </div>
                <span className={`text-[9px] font-semibold mt-0.5 ${isCurrent ? 'text-teal-50' : 'text-slate-500'}`}>
                  {isMandatory ? 'Wajib' : `Z${q.zoneNumber}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Examination Sheet Area: 1-col on mobile/tablet, 2-col (60% Left Question / 40% Right Sticky Scoring) on desktop >= lg */}
      <main className="max-w-3xl lg:max-w-6xl w-full mx-auto p-3 sm:p-5 space-y-4 flex-1">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* LEFT COLUMN (Desktop ~60%): SOAL & CATATAN */}
          <section data-testid="uas-question-column" className="lg:col-span-7 space-y-3.5 min-w-0">
            {/* Question Card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                      isCurrentMandatory
                        ? 'bg-teal-50 text-teal-800 border-teal-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {isCurrentMandatory ? `Soal Wajib ${mandatoryOrder}` : `Soal Acak ${currentQNum} • Zona ${currentQuestion?.zoneNumber}`}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    Maks <strong className="text-slate-800">{maxQScore}</strong> poin
                  </span>
                </div>

                {/* Complete Toggle Button (mobile/tablet quick access; also available in desktop right panel) */}
                <button
                  onClick={toggleQuestionCompleted}
                  className={`lg:hidden px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer border ${
                    currentAssessment.completedAt
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  <CheckCircle2 size={14} className={currentAssessment.completedAt ? 'text-white' : 'text-slate-400'} />
                  <span>{currentAssessment.completedAt ? 'Selesai' : 'Tandai Selesai'}</span>
                </button>
              </div>

              {/* Page / Surah Reference */}
              <div className="text-sm sm:text-base font-bold text-slate-800 flex items-center gap-2">
                {isCurrentMandatory ? (
                  <>
                    <BookOpen size={16} className="text-teal-600 shrink-0" />
                    <span>
                      Halaman {currentText.pageNumber || (currentQuestion as any)?.pageNumber || '-'} • Juz {currentText.juzNumber || displayJuz}
                    </span>
                  </>
                ) : (
                  <>
                    <Layers size={16} className="text-teal-600 shrink-0" />
                    <span>
                      {currentText.startSurahName} • Ayat {currentQuestion?.promptStartAyah}–{currentQuestion?.answerEndAyah}
                    </span>
                  </>
                )}
              </div>

              {/* Prompt / Instruction Box */}
              {isCurrentMandatory ? (
                <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                  Bacakan halaman ini secara penuh.
                </p>
              ) : (
                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] text-slate-500 block font-semibold mb-1.5">
                    Potongan Awal Ayat
                  </span>
                  <p
                    dir="rtl"
                    className="text-lg sm:text-xl lg:text-2xl font-arabic text-slate-900 leading-[2.2] text-right font-medium"
                  >
                    {currentText.promptText}
                  </p>
                </div>
              )}

              {/* Answer / Mushaf Full Text Toggle */}
              <div>
                <button
                  onClick={() => setShowAnswer(prev => ({ ...prev, [currentQNum]: !prev[currentQNum] }))}
                  className="px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {showAnswer[currentQNum] ? <EyeOff size={14} /> : <Eye size={14} />}
                  <span>{showAnswer[currentQNum] ? 'Sembunyikan Teks' : 'Tampilkan Teks'}</span>
                </button>

                {showAnswer[currentQNum] && (
                  <div className="mt-2.5 p-4 rounded-xl bg-amber-50/40 border border-slate-200 animate-fade-in">
                    <p
                      dir="rtl"
                      className="text-lg sm:text-xl lg:text-2xl font-arabic text-slate-900 leading-[2.3] text-right max-h-72 lg:max-h-none overflow-y-auto lg:overflow-visible overscroll-contain pr-1"
                    >
                      {currentText.answerText}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Examiner Notes */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <button
                onClick={() => setNotesOpen(!notesOpen)}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-700 hover:text-slate-900 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className="text-slate-400" />
                  <span>Catatan Soal {currentQNum}</span>
                  {currentAssessment.notes && (
                    <span className="w-2 h-2 rounded-full bg-teal-600" />
                  )}
                </div>
                <span className="text-[11px] text-slate-500">{notesOpen ? 'Tutup' : 'Tambah'}</span>
              </button>

              {notesOpen && (
                <div className="mt-3 animate-fade-in">
                  <textarea
                    value={currentAssessment.notes || ''}
                    onChange={(e) => handleNotesChange(e.target.value)}
                    placeholder="Catatan singkat penguji (opsional)..."
                    rows={2}
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 resize-none"
                  />
                </div>
              )}
            </div>
          </section>

          {/* RIGHT COLUMN (Desktop ~40%): STICKY PENILAIAN */}
          <aside
            data-testid="uas-scoring-column"
            className="lg:col-span-5 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto space-y-3 min-w-0"
          >
            {/* Live Score + Save Status + Tandai Selesai */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-sm space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs text-slate-500 block font-semibold">Nilai Soal {currentQNum}</span>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] mt-0.5 text-slate-600">
                    <span>Kelancaran <strong className="text-slate-900">{currentAssessment.fluencyScore}</strong>/{maxFluency}</span>
                    <span>Tajwid <strong className="text-slate-900">{currentAssessment.tajwidScore}</strong>/{maxTajwid}</span>
                    <span>Makhraj <strong className="text-slate-900">{currentAssessment.makhrajScore}</strong>/{maxMakhraj}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-2xl sm:text-3xl font-black text-teal-700">{currentAssessment.questionScore}</span>
                  <span className="text-xs text-slate-400 ml-0.5">/{maxQScore}</span>
                </div>
              </div>

              <div className="hidden lg:flex items-center justify-between gap-2 pt-2.5 border-t border-slate-100">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  {saveStatus === 'saving' && <RefreshCw size={12} className="animate-spin text-amber-600" />}
                  {saveStatus === 'saved' && <Cloud size={12} className="text-emerald-600" />}
                  {saveStatus === 'local' && <CloudOff size={12} className="text-amber-600" />}
                  {saveStatus === 'error' && <AlertTriangle size={12} className="text-rose-600" />}
                  <span className={saveStatus === 'saved' ? 'text-emerald-700' : saveStatus === 'error' ? 'text-rose-700' : 'text-slate-600'}>
                    {saveMessage}
                  </span>
                </span>
                <button
                  onClick={toggleQuestionCompleted}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer border ${
                    currentAssessment.completedAt
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  <CheckCircle2 size={14} className={currentAssessment.completedAt ? 'text-white' : 'text-slate-400'} />
                  <span>{currentAssessment.completedAt ? 'Selesai' : 'Tandai Selesai'}</span>
                </button>
              </div>
            </div>

            {/* Scoring Aspect 1: Kelancaran */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-sm space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="text-xs sm:text-sm font-bold text-slate-800">
                  Kelancaran
                </h4>
                <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                  {currentAssessment.fluencyScore} / {maxFluency}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-2">
                {FLUENCY_BUTTONS.map(btn => (
                  <button
                    key={btn.type}
                    onClick={() => handleAddFluency(btn.type)}
                    className={`min-h-[48px] p-2 rounded-xl border bg-white flex flex-col items-center justify-center transition-all active:scale-95 cursor-pointer ${btn.btnClass}`}
                  >
                    <span className="text-xs font-bold">{btn.shortLabel}</span>
                    <span className="text-[11px] opacity-80 mt-0.5">-{btn.deduction}</span>
                  </button>
                ))}
              </div>

              {currentAssessment.fluencyEvents.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {currentAssessment.fluencyEvents.map(ev => (
                    <button
                      type="button"
                      key={ev.id}
                      onClick={() => handleRemoveFluency(ev.id)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-900 border border-amber-200 flex items-center gap-1 cursor-pointer hover:bg-amber-100 transition-colors"
                      title="Klik untuk menghapus catatan"
                    >
                      <span>{ev.label} (-{ev.deduction})</span>
                      <X size={12} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Scoring Aspect 2: Tajwid */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-sm space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="text-xs sm:text-sm font-bold text-slate-800">
                  Tajwid
                </h4>
                <div className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                  {currentAssessment.tajwidScore} / {maxTajwid}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {TAJWID_BUTTONS.map(btn => (
                  <button
                    key={btn.type}
                    onClick={() => handleAddTajwid(btn.type)}
                    className={`min-h-[48px] p-2 rounded-xl border bg-white flex flex-col items-center justify-center transition-all active:scale-95 cursor-pointer ${btn.btnClass}`}
                  >
                    <span className="text-xs font-bold">{btn.label}</span>
                    <span className="text-[11px] opacity-80 mt-0.5">-{btn.deduction}</span>
                  </button>
                ))}
              </div>

              {currentAssessment.tajwidEvents.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {currentAssessment.tajwidEvents.map(ev => (
                    <button
                      type="button"
                      key={ev.id}
                      onClick={() => handleRemoveTajwid(ev.id)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50 text-indigo-900 border border-indigo-200 flex items-center gap-1 cursor-pointer hover:bg-indigo-100 transition-colors"
                      title="Klik untuk menghapus catatan"
                    >
                      <span>{ev.label} (-{ev.deduction})</span>
                      <X size={12} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Scoring Aspect 3: Makhraj */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-sm space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="text-xs sm:text-sm font-bold text-slate-800">
                  Makhraj
                </h4>
                <div className="text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2.5 py-0.5 rounded-full">
                  {currentAssessment.makhrajScore} / {maxMakhraj}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {MAKHRAJ_BUTTONS.map(btn => (
                  <button
                    key={btn.type}
                    onClick={() => handleAddMakhraj(btn.type)}
                    className={`min-h-[48px] p-2 rounded-xl border bg-white flex flex-col items-center justify-center transition-all active:scale-95 cursor-pointer ${btn.btnClass}`}
                  >
                    <span className="text-xs font-bold">{btn.label}</span>
                    <span className="text-[11px] opacity-80 mt-0.5">-{btn.deduction}</span>
                  </button>
                ))}
              </div>

              {currentAssessment.makhrajEvents.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {currentAssessment.makhrajEvents.map(ev => (
                    <button
                      type="button"
                      key={ev.id}
                      onClick={() => handleRemoveMakhraj(ev.id)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-teal-50 text-teal-900 border border-teal-200 flex items-center gap-1 cursor-pointer hover:bg-teal-100 transition-colors"
                      title="Klik untuk menghapus catatan"
                    >
                      <span>{ev.label} (-{ev.deduction})</span>
                      <X size={12} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* Navigation Footer */}
        <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-2">
          <button
            onClick={handlePrevQuestion}
            disabled={currentQIndex === 0}
            className="px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <ChevronLeft size={16} />
            <span>Sebelumnya</span>
          </button>

          <span className="text-xs text-slate-500 font-semibold text-center">
            {completedCount}/{totalQuestionsCount} selesai
          </span>

          <button
            onClick={handleNextQuestion}
            className="px-4 sm:px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <span>{currentQIndex === initialQuestions.length - 1 ? 'Selesaikan Ujian' : 'Berikutnya'}</span>
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
          sessionType={sessionType}
          onSubmitFinal={async () => {
            const syncRes = await api.syncPendingUASAssessments(attempt.id, user);
            if (!syncRes.success) {
              throw new Error(syncRes.message || 'Masih ada penilaian lokal yang belum tersinkron ke server. Periksa koneksi internet dan coba lagi.');
            }
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 border border-slate-200 shadow-xl space-y-4">
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">Keluar dari Lembar Ujian?</h4>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Penilaian yang sudah diisi tersimpan otomatis. Anda dapat melanjutkan ujian kembali kapan saja.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors"
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
