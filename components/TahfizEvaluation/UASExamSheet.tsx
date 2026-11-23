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
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [pinExpiredMessage, setPinExpiredMessage] = useState<string | null>(null);
  const [isReloadingFromServer, setIsReloadingFromServer] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [isExitingSave, setIsExitingSave] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [unsavedCount, setUnsavedCount] = useState(0);

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

  const assessmentsRef = useRef<ExamQuestionAssessment[]>(initialAssessments);
  const debounceTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const saveSeqByQuestionRef = useRef<Map<number, number>>(new Map());
  const dirtyQuestionsRef = useRef<Set<number>>(new Set());
  const inFlightByQuestionRef = useRef<Map<number, Promise<boolean>>>(new Map());
  const isMountedRef = useRef(true);

  // Pulihkan cadangan penilaian offline milik penguji yang sama setelah refresh halaman
  useEffect(() => {
    const pendingList = api.getPendingUASAssessmentsForExaminer(attempt.id, user);
    if (!pendingList || pendingList.length === 0) return;

    const merged = assessmentsRef.current.map((srv) => {
      const pending = pendingList.find(p => p.questionNumber === srv.questionNumber);
      if (!pending) return srv;
      const qObj = initialQuestions.find(q => q.questionNumber === srv.questionNumber);
      const isMand = sessionType === 'partial_half'
        ? false
        : isMandatoryQuestion(srv.questionNumber, (qObj as any)?.questionRole || (qObj as any)?.question_role);
      const fEvents = pending.fluencyEvents || [];
      const tEvents = pending.tajwidEvents || [];
      const mEvents = pending.makhrajEvents || [];
      const { score: fScore } = calculateUASFluencyScore(fEvents, isMand, sessionType);
      const { score: tScore } = calculateUASTajwidScore(tEvents, isMand, sessionType);
      const { score: mScore } = calculateUASMakhrajScore(mEvents, isMand, sessionType);
      const qScore = calculateUASQuestionScore(fScore, tScore, mScore, isMand, sessionType);
      dirtyQuestionsRef.current.add(srv.questionNumber);
      return {
        ...srv,
        fluencyEvents: fEvents,
        tajwidEvents: tEvents,
        makhrajEvents: mEvents,
        fluencyScore: fScore,
        tajwidScore: tScore,
        makhrajScore: mScore,
        questionScore: qScore,
        notes: pending.notes ?? srv.notes,
        completedAt: pending.completedAt ?? srv.completedAt
      };
    });

    if (dirtyQuestionsRef.current.size > 0) {
      assessmentsRef.current = merged;
      setAssessments(merged);
      setUnsavedCount(dirtyQuestionsRef.current.size);
      setSaveStatus('local');
      setSaveMessage('Belum Tersimpan');
    }
  }, [attempt.id]);

  useEffect(() => {
    assessmentsRef.current = assessments;
  }, [assessments]);

  // Cleanup seluruh timer debounce saat unmount agar tidak terjadi leak atau state update setelah unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      debounceTimersRef.current.forEach((timer) => clearTimeout(timer));
      debounceTimersRef.current.clear();
    };
  }, []);

  const hasUnsavedChanges =
    unsavedCount > 0 || saveStatus === 'saving' || saveStatus === 'local' || saveStatus === 'error';

  // Lindungi tab dari refresh/tutup tidak sengaja saat masih ada nilai belum tersimpan
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Load dynamic Quran texts progressively (soal pertama tampil segera tanpa menunggu seluruh 9 soal)
  useEffect(() => {
    let isMounted = true;

    const loadAllTexts = async () => {
      for (const q of initialQuestions) {
        if (!isMounted) return;
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

        if (!isMounted) return;
        const reconstructed: ReconstructedQuestionText = {
          promptText,
          answerText,
          startSurahName,
          endSurahName,
          pageNumber: pageNum,
          juzNumber: juzNum,
          isLoading: false
        };
        setQTexts(prev => ({ ...prev, [q.questionNumber]: reconstructed }));
      }
    };

    loadAllTexts();

    return () => {
      isMounted = false;
    };
  }, [initialQuestions, sessionType]);

  // Serialized per-question save with generation tracking (mencegah race condition & stale overwrite)
  const saveQuestionToServer = (qNum: number): Promise<boolean> => {
    const existingTimer = debounceTimersRef.current.get(qNum);
    if (existingTimer) {
      clearTimeout(existingTimer);
      debounceTimersRef.current.delete(qNum);
    }

    const existingFlight = inFlightByQuestionRef.current.get(qNum);
    if (existingFlight) {
      return existingFlight.then(async (prevOk) => {
        if (!isMountedRef.current) return prevOk;
        if (dirtyQuestionsRef.current.has(qNum)) {
          return saveQuestionToServer(qNum);
        }
        return prevOk;
      });
    }

    const runSave = (async (): Promise<boolean> => {
      const snapshot = assessmentsRef.current.find(a => a.questionNumber === qNum);
      if (!snapshot) {
        dirtyQuestionsRef.current.delete(qNum);
        if (isMountedRef.current) setUnsavedCount(dirtyQuestionsRef.current.size);
        return true;
      }

      const sentSeq = saveSeqByQuestionRef.current.get(qNum) || 0;
      if (isMountedRef.current) {
        setSaveStatus('saving');
        setSaveMessage('Menyimpan...');
      }

      try {
        const res = await api.saveUASQuestionAssessment({
          attemptId: attempt.id,
          questionNumber: snapshot.questionNumber,
          expectedVersion: snapshot.version,
          markCompleted: !!snapshot.completedAt,
          periodId,
          uasSessionId: attempt.uasSessionId || undefined,
          assessmentData: {
            fluencyEvents: snapshot.fluencyEvents,
            tajwidEvents: snapshot.tajwidEvents,
            makhrajEvents: snapshot.makhrajEvents,
            notes: snapshot.notes,
            isCompleted: !!snapshot.completedAt
          }
        }, user);

        if (!isMountedRef.current) return Boolean(res.success);

        const latestSeq = saveSeqByQuestionRef.current.get(qNum) || 0;

        if (res.success && res.savedToServer !== false) {
          const nextVer = (res as any).version ?? res.assessment?.version;
          if (nextVer) {
            assessmentsRef.current = assessmentsRef.current.map(a =>
              a.questionNumber === qNum
                ? { ...a, version: Math.max(a.version || 1, nextVer) }
                : a
            );
            setAssessments(prev => prev.map(a =>
              a.questionNumber === qNum
                ? { ...a, version: Math.max(a.version || 1, nextVer) }
                : a
            ));
          }
          if (latestSeq === sentSeq) {
            dirtyQuestionsRef.current.delete(qNum);
          }
          setUnsavedCount(dirtyQuestionsRef.current.size);
          setConflictMessage(null);
          setPinExpiredMessage(null);

          if (dirtyQuestionsRef.current.size === 0 && inFlightByQuestionRef.current.size <= 1) {
            setSaveStatus('saved');
            setSaveMessage('Tersimpan');
          }
          return true;
        }

        if (res.isConflict) {
          setSaveStatus('error');
          setSaveMessage('Belum Tersimpan (Konflik)');
          setConflictMessage(
            res.message || 'Soal ini sudah diperbarui dari perangkat lain. Muat data terbaru dari server agar tidak saling menimpa.'
          );
          return false;
        }

        if (res.isPinExpired) {
          setSaveStatus('error');
          setSaveMessage('Belum Tersimpan (PIN habis)');
          setPinExpiredMessage(
            res.message || 'Verifikasi PIN penguji sudah kedaluwarsa. Nilai diamankan sementara di perangkat ini.'
          );
          return false;
        }

        if (res.localStorageError) {
          setSaveStatus('error');
          setSaveMessage('Belum Tersimpan (Penyimpanan penuh)');
          setNavigationError(
            res.message || 'Gagal menyimpan ke server maupun penyimpanan lokal perangkat. Jangan tutup halaman ini sebelum koneksi pulih.'
          );
          return false;
        }

        if (res.savedLocally) {
          setSaveStatus('local');
          setSaveMessage('Belum Tersimpan');
          return false;
        }

        setSaveStatus('error');
        setSaveMessage('Belum Tersimpan');
        return false;
      } catch {
        if (!isMountedRef.current) return false;
        setSaveStatus('error');
        setSaveMessage('Belum Tersimpan');
        return false;
      } finally {
        inFlightByQuestionRef.current.delete(qNum);
      }
    })();

    inFlightByQuestionRef.current.set(qNum, runSave);

    return runSave.then(async (ok) => {
      if (!isMountedRef.current) return ok;
      // Jika selama request berlangsung ada edit baru untuk soal yang sama, segera simpan snapshot terbarunya
      if (ok && dirtyQuestionsRef.current.has(qNum)) {
        return saveQuestionToServer(qNum);
      }
      return ok;
    });
  };

  // Flush seluruh soal yang masih dirty atau pending timer ke server
  const flushAllDirtyQuestions = async (): Promise<boolean> => {
    const qNums = new Set<number>([
      ...Array.from(dirtyQuestionsRef.current),
      ...Array.from(debounceTimersRef.current.keys())
    ]);
    let allOk = true;
    for (const qNum of qNums) {
      const ok = await saveQuestionToServer(qNum);
      if (!ok) allOk = false;
    }
    const syncRes = await api.syncPendingUASAssessments(attempt.id, user);
    if (!syncRes.success) {
      allOk = false;
      if (isMountedRef.current) {
        setSaveStatus('local');
        setSaveMessage('Belum Tersimpan');
      }
    } else if (allOk && dirtyQuestionsRef.current.size === 0 && isMountedRef.current) {
      setSaveStatus('saved');
      setSaveMessage('Tersimpan');
    }
    return allOk && dirtyQuestionsRef.current.size === 0;
  };

  // Pemulihan otomatis saat jaringan kembali online
  useEffect(() => {
    const handleOnline = () => {
      if (dirtyQuestionsRef.current.size > 0 || saveStatus === 'local' || saveStatus === 'error') {
        flushAllDirtyQuestions();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [saveStatus]);

  // Reload data terbaru dari server saat terjadi konflik 2 perangkat
  const handleReloadFromServer = async () => {
    if (isReloadingFromServer) return;
    setIsReloadingFromServer(true);
    try {
      const res = await api.getUASAttempt(attempt.id, user);
      if (res.success && res.assessments) {
        debounceTimersRef.current.forEach((timer) => clearTimeout(timer));
        debounceTimersRef.current.clear();
        dirtyQuestionsRef.current.clear();
        assessmentsRef.current = res.assessments;
        setAssessments(res.assessments);
        setUnsavedCount(0);
        setConflictMessage(null);
        setSaveStatus('saved');
        setSaveMessage('Tersimpan');
      } else {
        setNavigationError(res.message || 'Gagal memuat ulang data terbaru dari server.');
      }
    } catch (err: any) {
      setNavigationError(err?.message || 'Gagal menghubungi server saat memuat ulang data.');
    } finally {
      if (isMountedRef.current) setIsReloadingFromServer(false);
    }
  };

  // Trigger per-question debounced autosave (tidak membatalkan soal lain!)
  const triggerAutosave = (updatedAsm: ExamQuestionAssessment) => {
    const qNum = updatedAsm.questionNumber;
    const prevTimer = debounceTimersRef.current.get(qNum);
    if (prevTimer) {
      clearTimeout(prevTimer);
    }
    setSaveStatus('saving');
    setSaveMessage('Menyimpan...');

    const timer = setTimeout(() => {
      debounceTimersRef.current.delete(qNum);
      saveQuestionToServer(qNum);
    }, 600);
    debounceTimersRef.current.set(qNum, timer);
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
    const qNum = updated.questionNumber;
    const nextList = assessmentsRef.current.some(a => a.questionNumber === qNum)
      ? assessmentsRef.current.map(a => a.questionNumber === qNum ? updated : a)
      : [...assessmentsRef.current, updated];
    assessmentsRef.current = nextList;
    setAssessments(nextList);

    dirtyQuestionsRef.current.add(qNum);
    saveSeqByQuestionRef.current.set(qNum, (saveSeqByQuestionRef.current.get(qNum) || 0) + 1);
    setUnsavedCount(dirtyQuestionsRef.current.size);

    if (immediateSave) {
      saveQuestionToServer(qNum);
    } else {
      triggerAutosave(updated);
    }
  };

  // Flush timer soal aktif saat berpindah soal agar tidak pernah membatalkan/meninggalkan edit
  const flushCurrentQuestionIfPending = () => {
    if (debounceTimersRef.current.has(currentQNum) || dirtyQuestionsRef.current.has(currentQNum)) {
      saveQuestionToServer(currentQNum);
    }
  };

  // Direct question navigation
  const navigateToQuestion = (qNum: number) => {
    flushCurrentQuestionIfPending();
    const targetIdx = initialQuestions.findIndex(q => q.questionNumber === qNum);
    if (targetIdx >= 0) {
      setCurrentQIndex(targetIdx);
      setNotesOpen(false);
      setNavigationError(null);
    }
  };

  // Next Question button with auto-complete & double-click guard
  const handleNextQuestion = async () => {
    if (isSavingNext) return;
    setIsSavingNext(true);
    try {
      if (!currentAssessment.completedAt) {
        const updated: ExamQuestionAssessment = {
          ...currentAssessment,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        updateCurrentAssessmentState(updated, true);
      } else {
        flushCurrentQuestionIfPending();
      }

      if (currentQIndex < initialQuestions.length - 1) {
        setCurrentQIndex(prev => prev + 1);
        setNotesOpen(false);
        setNavigationError(null);
      } else {
        setShowReviewModal(true);
      }
    } finally {
      setIsSavingNext(false);
    }
  };

  const handlePrevQuestion = () => {
    flushCurrentQuestionIfPending();
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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans select-none pb-24 sm:pb-10">
      {/* Compact Light Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 px-3 sm:px-5 py-2.5">
        <div className="max-w-3xl lg:max-w-6xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => {
                setExitError(null);
                setShowExitConfirm(true);
              }}
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
                  {(saveStatus === 'local' || saveStatus === 'error') && (
                    <button
                      type="button"
                      onClick={() => flushAllDirtyQuestions()}
                      className="ml-1 px-2 py-0.5 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold"
                    >
                      Coba Simpan Ulang
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
        {(conflictMessage || pinExpiredMessage || navigationError) && (
          <div className="space-y-2">
            {conflictMessage && (
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <span className="break-words">{conflictMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={handleReloadFromServer}
                  disabled={isReloadingFromServer}
                  className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shrink-0 disabled:opacity-50"
                >
                  {isReloadingFromServer ? 'Memuat...' : 'Muat Data Terbaru'}
                </button>
              </div>
            )}
            {pinExpiredMessage && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-900 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                  <span className="break-words">{pinExpiredMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => flushAllDirtyQuestions()}
                  className="px-3 py-1.5 rounded-xl bg-white border border-rose-300 text-rose-800 hover:bg-rose-100 text-xs font-bold shrink-0"
                >
                  Coba Simpan Ulang
                </button>
              </div>
            )}
            {navigationError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-center justify-between gap-2">
                <span>{navigationError}</span>
                <button type="button" onClick={() => setNavigationError(null)} className="font-bold text-rose-500">✕</button>
              </div>
            )}
          </div>
        )}
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
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 resize-none select-text"
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
            const flushed = await flushAllDirtyQuestions();
            if (!flushed) {
              throw new Error('Masih ada penilaian yang belum tersimpan ke server. Periksa koneksi internet lalu coba simpan ulang sebelum menyelesaikan ujian.');
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
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${
              hasUnsavedChanges
                ? 'bg-rose-50 border-rose-200 text-rose-600'
                : 'bg-amber-50 border-amber-200 text-amber-600'
            }`}>
              <AlertTriangle size={20} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                {hasUnsavedChanges ? 'Ada Penilaian Belum Tersimpan' : 'Keluar dari Lembar Ujian?'}
              </h4>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {hasUnsavedChanges
                  ? 'Perubahan penilaian terakhir belum terkonfirmasi tersimpan di server. Simpan terlebih dahulu agar nilai tidak tertinggal.'
                  : 'Seluruh penilaian yang sudah diisi telah tersimpan di server. Anda dapat melanjutkan ujian kembali kapan saja.'}
              </p>
              {exitError && (
                <div className="mt-2.5 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
                  {exitError}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isExitingSave}
                onClick={() => {
                  setExitError(null);
                  setShowExitConfirm(false);
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Tetap Menilai
              </button>
              {hasUnsavedChanges ? (
                <button
                  type="button"
                  disabled={isExitingSave}
                  onClick={async () => {
                    setIsExitingSave(true);
                    setExitError(null);
                    const ok = await flushAllDirtyQuestions();
                    setIsExitingSave(false);
                    if (ok) {
                      onExit();
                    } else {
                      setExitError('Penyimpanan ke server gagal. Halaman tidak ditutup agar nilai tetap aman. Periksa koneksi lalu coba lagi.');
                    }
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50"
                >
                  {isExitingSave ? 'Menyimpan...' : 'Simpan & Keluar'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onExit}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors"
                >
                  Keluar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
