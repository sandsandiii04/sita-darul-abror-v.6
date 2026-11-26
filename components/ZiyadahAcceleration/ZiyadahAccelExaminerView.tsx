import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  User,
  ZiyadahAccelAbsenceReason,
  ZiyadahAccelEvent,
  ZiyadahAccelFulfillmentStatus,
  ZiyadahAccelParticipant,
  ZiyadahAccelSession,
  ZiyadahAccelSessionExaminer,
  ZiyadahAccelSubmission
} from '../../types';
import { quranService, SURAH_TOTAL_AYAHS } from '../../services/quranService';
import {
  analyzeSubmissionRangesAndPages,
  formatPagesIndo,
  formatRangesCompact,
  QUARTER_PAGE_QUICK_OPTIONS
} from '../../services/ziyadahAccelPageCalc';
import {
  generateIdempotencyKey,
  ziyadahAccelService
} from '../../services/ziyadahAccelService';
import {
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  ChevronLeft,
  Save,
  Search,
  Clock,
  UserX,
  Info,
  ShieldCheck,
  UserCheck
} from 'lucide-react';

/**
 * Helper murni (mudah diuji unit-test) untuk menentukan saran kelanjutan surah & ayat
 * secara kronologis berdasarkan sessionNumber naik dan arah hafalan santri (Perbaikan B-08).
 */
export function suggestNextQuranRangeForParticipant(params: {
  participant: ZiyadahAccelParticipant;
  priorSubmissionsSortedBySession: ZiyadahAccelSubmission[];
  currentSessionId: string;
}): { juzNumber: number; surahNumber: number; ayahStart: number; ayahEnd: number } {
  const { participant, priorSubmissionsSortedBySession, currentSessionId } = params;
  const submittedPriors = priorSubmissionsSortedBySession.filter(
    s =>
      s.sessionId !== currentSessionId &&
      s.fulfillmentStatus === 'submitted' &&
      s.ranges &&
      s.ranges.length > 0
  );

  const lastSubmitted =
    submittedPriors.length > 0 ? submittedPriors[submittedPriors.length - 1] : undefined;

  let initSurah = participant.baselineSurah || 78;
  let initAyahStart = participant.baselineAyah ? participant.baselineAyah + 1 : 1;

  if (lastSubmitted && lastSubmitted.ranges.length > 0) {
    const lastR = lastSubmitted.ranges[lastSubmitted.ranges.length - 1];
    initSurah = lastR.surahNumber;
    initAyahStart = lastR.ayahEnd + 1;
  }

  const maxInSurah = SURAH_TOTAL_AYAHS[initSurah] || 1;
  if (initAyahStart > maxInSurah) {
    if (participant.memorizationDirectionHint === 'backward') {
      initSurah = initSurah > 1 ? initSurah - 1 : 114;
    } else {
      initSurah = initSurah < 114 ? initSurah + 1 : 1;
    }
    initAyahStart = 1;
  }

  const nextMax = SURAH_TOTAL_AYAHS[initSurah] || 1;
  const initAyahEnd = Math.min(nextMax, initAyahStart + 9);
  const initPage = quranService.getAyahPage(initSurah, initAyahStart);
  const initJuz = quranService.getPageJuz(initPage);

  return {
    juzNumber: initJuz,
    surahNumber: initSurah,
    ayahStart: initAyahStart,
    ayahEnd: initAyahEnd
  };
}

interface ZiyadahAccelExaminerViewProps {
  user: User;
  actorUserId: string;
  actorName: string;
  isSharedAccount: boolean;
  isCoordinator: boolean;
  event: ZiyadahAccelEvent;
  sessions: ZiyadahAccelSession[];
  sessionExaminers: ZiyadahAccelSessionExaminer[];
  participants: ZiyadahAccelParticipant[];
  submissions: ZiyadahAccelSubmission[];
  onSubmissionSaved: () => Promise<void>;
  onSwitchSharedExaminer?: () => void;
}

const ALL_SURAHS = quranService.getSurahs();

export const ZiyadahAccelExaminerView: React.FC<ZiyadahAccelExaminerViewProps> = ({
  user,
  actorUserId,
  actorName,
  isSharedAccount,
  isCoordinator,
  event,
  sessions,
  sessionExaminers,
  participants,
  submissions,
  onSubmissionSaved,
  onSwitchSharedExaminer
}) => {
  const availableSessions = useMemo(() => {
    const valid = sessions
      .filter(s => s.status !== 'cancelled')
      .sort((a, b) => a.sessionNumber - b.sessionNumber);
    if (isCoordinator) return valid;
    return valid.filter(s =>
      sessionExaminers.some(se => se.sessionId === s.id && se.examinerUserId === actorUserId)
    );
  }, [sessions, sessionExaminers, isCoordinator, actorUserId]);

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [queueSearch, setQueueSearch] = useState('');
  const [queueFilter, setQueueFilter] = useState<'ALL' | 'PENDING' | 'SUBMITTED' | 'ABSENT'>('ALL');
  const [draftTick, setDraftTick] = useState<number>(0);

  const [activeParticipant, setActiveParticipant] = useState<ZiyadahAccelParticipant | null>(null);
  const [showRefHistory, setShowRefHistory] = useState(true);
  const [filterSurahsByJuz, setFilterSurahsByJuz] = useState(false);

  // Form states
  const [fulfillmentStatus, setFulfillmentStatus] =
    useState<ZiyadahAccelFulfillmentStatus>('submitted');
  const [absenceReason, setAbsenceReason] = useState<ZiyadahAccelAbsenceReason>('sick');
  const [rangesDraft, setRangesDraft] = useState<
    Array<{ juzNumber: number; surahNumber: number; ayahStart: number; ayahEnd: number }>
  >([{ juzNumber: 30, surahNumber: 78, ayahStart: 1, ayahEnd: 10 }]);
  const [confirmedPagesInput, setConfirmedPagesInput] = useState<string>('1');
  const [scoreInput, setScoreInput] = useState<string>('85');
  const [examinerNotes, setExaminerNotes] = useState<string>('');
  const [correctionReason, setCorrectionReason] = useState<string>('');

  // PERBAIKAN B-05: Hanya simpan draft lokal apabila penguji benar-benar mengedit (isDirty) atau gagal kirim!
  const [isFormDirty, setIsFormDirty] = useState<boolean>(false);
  const [hasUnsavedLocalDraft, setHasUnsavedLocalDraft] = useState<boolean>(false);
  const [draftRestoredNotice, setDraftRestoredNotice] = useState<boolean>(false);

  // Confirmation & Concurrency protection
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingRegularDone, setTogglingRegularDone] = useState(false);
  const submittingLockRef = useRef(false);
  const pendingIdempotencyKeyRef = useRef<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (availableSessions.length > 0) {
      const currentOk = availableSessions.some(s => s.id === selectedSessionId);
      if (!currentOk) {
        const activeOne =
          availableSessions.find(s => s.status === 'active') || availableSessions[0];
        setSelectedSessionId(activeOne.id);
      }
    }
  }, [availableSessions, selectedSessionId]);

  const selectedSession = useMemo(
    () => availableSessions.find(s => s.id === selectedSessionId) || null,
    [availableSessions, selectedSessionId]
  );

  const myAssignment = useMemo(() => {
    if (!selectedSession) return undefined;
    return sessionExaminers.find(
      se => se.sessionId === selectedSession.id && se.examinerUserId === actorUserId
    );
  }, [selectedSession, sessionExaminers, actorUserId]);

  const pendingDraftIds = useMemo(() => {
    if (!selectedSession) return new Set<string>();
    return ziyadahAccelService.getPendingDraftParticipantIds(actorUserId, selectedSession.id);
  }, [actorUserId, selectedSession, draftTick, activeParticipant]);

  // Filter peserta sesuai penugasan penguji (konsisten dgn B-09 server!) & urutkan per kelompok majelis
  const sessionQueueItems = useMemo(() => {
    if (!selectedSession) return [];

    const eligibleParts = participants.filter(p => {
      if (p.participantStatus !== 'active') return false;
      if (isCoordinator) return true;
      if (!myAssignment) return false;
      if (myAssignment.canExamineAll) return true;
      if (
        myAssignment.assignedParticipantIds?.length > 0 &&
        myAssignment.assignedParticipantIds.includes(p.id)
      ) {
        return true;
      }
      if (
        myAssignment.assignedClasses?.length > 0 &&
        myAssignment.assignedClasses.includes(p.classSnapshot)
      ) {
        return true;
      }
      if (
        myAssignment.assignedHalaqahs?.length > 0 &&
        myAssignment.assignedHalaqahs.includes(p.halaqahSnapshot)
      ) {
        return true;
      }
      return false;
    });

    return eligibleParts
      .map(part => {
        const sub = submissions.find(
          s => s.sessionId === selectedSession.id && s.participantId === part.id
        );
        // Jika submission ditugaskan spesifik ke penguji lain dan user bukan koordinator, sembunyikan dari antrean majelis ini
        if (
          !isCoordinator &&
          sub?.assignedExaminerId &&
          sub.assignedExaminerId !== actorUserId
        ) {
          return null;
        }
        return {
          participant: part,
          submission: sub,
          queueOrder: sub?.queueOrder ?? 999,
          status: sub?.fulfillmentStatus || 'waiting_turn',
          hasLocalDraft: pendingDraftIds.has(part.id)
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => {
        if (a.queueOrder !== b.queueOrder) return a.queueOrder - b.queueOrder;
        return a.participant.studentNameSnapshot.localeCompare(
          b.participant.studentNameSnapshot,
          'id'
        );
      });
  }, [
    selectedSession,
    participants,
    submissions,
    myAssignment,
    isCoordinator,
    actorUserId,
    pendingDraftIds
  ]);

  const filteredQueueItems = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return sessionQueueItems.filter(item => {
      if (queueFilter === 'SUBMITTED' && item.status !== 'submitted') return false;
      if (queueFilter === 'ABSENT' && item.status !== 'absent') return false;
      if (
        queueFilter === 'PENDING' &&
        (item.status === 'submitted' || item.status === 'absent')
      ) {
        return false;
      }
      if (q) {
        const mName = item.participant.studentNameSnapshot.toLowerCase().includes(q);
        const mNis = item.participant.nisSnapshot.toLowerCase().includes(q);
        const mCls = item.participant.classSnapshot.toLowerCase().includes(q);
        if (!mName && !mNis && !mCls) return false;
      }
      return true;
    });
  }, [sessionQueueItems, queueSearch, queueFilter]);

  const getPriorSubmissionsForStudent = (studentId: string) => {
    return submissions
      .filter(s => s.studentId === studentId)
      .sort((a, b) => {
        const sa = sessions.find(x => x.id === a.sessionId)?.sessionNumber || 0;
        const sb = sessions.find(x => x.id === b.sessionId)?.sessionNumber || 0;
        return sa - sb;
      });
  };

  const studentPriorSubmissions = useMemo(() => {
    if (!activeParticipant) return [];
    return getPriorSubmissionsForStudent(activeParticipant.studentId);
  }, [activeParticipant, submissions, sessions]);

  const currentExistingSubmission = useMemo(() => {
    if (!activeParticipant || !selectedSession) return undefined;
    return submissions.find(
      s => s.sessionId === selectedSession.id && s.participantId === activeParticipant.id
    );
  }, [activeParticipant, selectedSession, submissions]);

  const openStudentForm = (part: ZiyadahAccelParticipant) => {
    if (!selectedSession) return;
    setFeedbackBanner(null);
    pendingIdempotencyKeyRef.current = null;
    setCorrectionReason('');
    setIsFormDirty(false);

    const existing = submissions.find(
      s => s.sessionId === selectedSession.id && s.participantId === part.id
    );
    const localDraft = ziyadahAccelService.loadLocalDraft(actorUserId, selectedSession.id, part.id);

    if (localDraft) {
      setFulfillmentStatus(localDraft.fulfillmentStatus);
      setAbsenceReason(localDraft.absenceReason || 'sick');
      setRangesDraft(localDraft.ranges);
      setConfirmedPagesInput(localDraft.confirmedPagesInput);
      setScoreInput(localDraft.scoreInput);
      setExaminerNotes(localDraft.examinerNotes);
      setDraftRestoredNotice(true);
      setHasUnsavedLocalDraft(true);
    } else if (existing && existing.fulfillmentStatus !== 'waiting_turn') {
      setDraftRestoredNotice(false);
      setHasUnsavedLocalDraft(false);
      setFulfillmentStatus(existing.fulfillmentStatus);
      setAbsenceReason(existing.absenceReason || 'sick');
      if (existing.ranges && existing.ranges.length > 0) {
        setRangesDraft(
          existing.ranges.map(r => ({
            juzNumber: r.juzNumber,
            surahNumber: r.surahNumber,
            ayahStart: r.ayahStart,
            ayahEnd: r.ayahEnd
          }))
        );
      }
      setConfirmedPagesInput(
        existing.confirmedPages !== null ? String(existing.confirmedPages) : '1'
      );
      setScoreInput(existing.score !== null ? String(existing.score) : '85');
      setExaminerNotes(existing.examinerNotes || '');
    } else {
      setDraftRestoredNotice(false);
      setHasUnsavedLocalDraft(false);
      setFulfillmentStatus('submitted');
      setAbsenceReason('sick');

      // PERBAIKAN B-08: Urutkan riwayat berdasarkan sessionNumber naik & patuhi memorizationDirectionHint!
      const sortedPriors = getPriorSubmissionsForStudent(part.studentId);
      const suggested = suggestNextQuranRangeForParticipant({
        participant: part,
        priorSubmissionsSortedBySession: sortedPriors,
        currentSessionId: selectedSession.id
      });

      setRangesDraft([suggested]);
      setConfirmedPagesInput('1');
      setScoreInput('85');
      setExaminerNotes('');
    }

    setActiveParticipant(part);
  };

  // PERBAIKAN B-05: Tulis ke localStorage HANYA apabila penguji benar-benar sudah mengedit (isFormDirty === true)!
  useEffect(() => {
    if (!activeParticipant || !selectedSession || !isFormDirty) return;
    ziyadahAccelService.saveLocalDraft(actorUserId, {
      sessionId: selectedSession.id,
      participantId: activeParticipant.id,
      fulfillmentStatus,
      absenceReason,
      confirmedPagesInput,
      scoreInput,
      examinerNotes,
      ranges: rangesDraft,
      savedAt: new Date().toISOString()
    });
    setHasUnsavedLocalDraft(true);
    setDraftTick(t => t + 1);
  }, [
    isFormDirty,
    activeParticipant,
    selectedSession,
    fulfillmentStatus,
    absenceReason,
    confirmedPagesInput,
    scoreInput,
    examinerNotes,
    rangesDraft,
    actorUserId
  ]);

  const parsedConfirmedPages = useMemo(() => {
    const clean = confirmedPagesInput.replace(',', '.').trim();
    const num = parseFloat(clean);
    return Number.isNaN(num) ? null : num;
  }, [confirmedPagesInput]);

  const parsedScore = useMemo(() => {
    const clean = scoreInput.replace(',', '.').trim();
    const num = parseFloat(clean);
    return Number.isNaN(num) ? null : num;
  }, [scoreInput]);

  const liveValidation = useMemo(() => {
    if (!activeParticipant || !selectedSession || fulfillmentStatus !== 'submitted') {
      return null;
    }
    const sessNumMap = new Map(sessions.map(s => [s.id, s.sessionNumber]));
    const orderedPriors = [...studentPriorSubmissions]
      .filter(sub => {
        const sn = sessNumMap.get(sub.sessionId);
        return sn === undefined || sn < selectedSession.sessionNumber;
      })
      .sort((a, b) => (sessNumMap.get(a.sessionId) || 0) - (sessNumMap.get(b.sessionId) || 0));

    return analyzeSubmissionRangesAndPages({
      draftRanges: rangesDraft,
      confirmedPages: parsedConfirmedPages,
      previousSubmissionsForStudent: orderedPriors,
      currentSessionId: selectedSession.id,
      participantBaseline: {
        surah: activeParticipant.baselineSurah,
        ayah: activeParticipant.baselineAyah
      },
      directionHint: activeParticipant.memorizationDirectionHint
    });
  }, [
    activeParticipant,
    selectedSession,
    sessions,
    fulfillmentStatus,
    rangesDraft,
    parsedConfirmedPages,
    studentPriorSubmissions
  ]);

  const handleOpenConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackBanner(null);

    if (fulfillmentStatus === 'submitted') {
      if (!liveValidation || !liveValidation.valid) {
        setFeedbackBanner({
          type: 'error',
          text: liveValidation?.blockingError || 'Periksa kembali input surah, ayat, dan halaman.'
        });
        return;
      }
      if (parsedScore === null || parsedScore < 0 || parsedScore > 100) {
        setFeedbackBanner({
          type: 'error',
          text: 'Nilai wajib diisi antara 0 sampai 100.'
        });
        return;
      }
    }

    if (
      currentExistingSubmission?.fulfillmentStatus === 'submitted' &&
      correctionReason.trim().length < 3
    ) {
      setFeedbackBanner({
        type: 'error',
        text: 'Alasan koreksi wajib diisi (minimal 3 karakter) untuk mengubah setoran yang sudah tersimpan.'
      });
      return;
    }

    setShowConfirmModal(true);
  };

  const handleExecuteSave = async () => {
    if (!activeParticipant || !selectedSession || submittingLockRef.current) return;
    submittingLockRef.current = true;
    setIsSubmitting(true);

    if (!pendingIdempotencyKeyRef.current) {
      pendingIdempotencyKeyRef.current = generateIdempotencyKey('za_setoran');
    }

    try {
      const res = await ziyadahAccelService.submitSetoran({
        user,
        sessionId: selectedSession.id,
        participantId: activeParticipant.id,
        fulfillmentStatus,
        confirmedPages: fulfillmentStatus === 'submitted' ? parsedConfirmedPages : null,
        systemSuggestedPages:
          fulfillmentStatus === 'submitted'
            ? liveValidation?.systemSuggestedPages ?? null
            : null,
        score: fulfillmentStatus === 'submitted' ? parsedScore : null,
        absenceReason: fulfillmentStatus === 'absent' ? absenceReason : null,
        examinerNotes: examinerNotes.trim() || null,
        correctionReason: correctionReason.trim() || null,
        ranges: fulfillmentStatus === 'submitted' ? liveValidation?.normalizedRanges || [] : [],
        clientFlags: fulfillmentStatus === 'submitted' ? liveValidation?.clientFlags || [] : [],
        expectedVersion: currentExistingSubmission?.version ?? null,
        idempotencyKey: pendingIdempotencyKeyRef.current
      });

      setShowConfirmModal(false);

      if (res.success) {
        ziyadahAccelService.clearLocalDraft(actorUserId, selectedSession.id, activeParticipant.id);
        setIsFormDirty(false);
        setHasUnsavedLocalDraft(false);
        setDraftTick(t => t + 1);
        pendingIdempotencyKeyRef.current = null;
        await onSubmissionSaved();
        setFeedbackBanner({
          type: res.verificationStatus === 'needs_verification' ? 'warning' : 'success',
          text: res.message || 'Setoran berhasil disimpan ke server.'
        });
        setActiveParticipant(null);
      } else {
        // Pastikan draft tersimpan ke localStorage saat pengiriman ke server gagal/timeout!
        ziyadahAccelService.saveLocalDraft(actorUserId, {
          sessionId: selectedSession.id,
          participantId: activeParticipant.id,
          fulfillmentStatus,
          absenceReason,
          confirmedPagesInput,
          scoreInput,
          examinerNotes,
          ranges: rangesDraft,
          savedAt: new Date().toISOString(),
          lastError: res.message || 'Gagal kirim ke server'
        });
        setHasUnsavedLocalDraft(true);
        setDraftTick(t => t + 1);

        if (res.pinRequired && onSwitchSharedExaminer) {
          onSwitchSharedExaminer();
          return;
        }
        if (!res.isTimeout) {
          pendingIdempotencyKeyRef.current = null;
        }
        if (res.errorCode === 'VERSION_CONFLICT') {
          await onSubmissionSaved();
        }
        setFeedbackBanner({
          type: 'error',
          text: res.message || 'Gagal menyimpan setoran ke server. Draft tetap diamankan di perangkat ini.'
        });
      }
    } finally {
      setIsSubmitting(false);
      submittingLockRef.current = false;
    }
  };

  const handleToggleRegularDone = async () => {
    if (!selectedSession || !myAssignment || togglingRegularDone) return;
    setTogglingRegularDone(true);
    try {
      const nextVal = !myAssignment.regularFinishConfirmed;
      const res = await ziyadahAccelService.confirmRegularQueueDone({
        user,
        sessionId: selectedSession.id,
        examinerUserId: myAssignment.examinerUserId,
        confirmed: nextVal
      });
      if (res.success) {
        await onSubmissionSaved();
      } else {
        setFeedbackBanner({ type: 'error', text: res.message || 'Gagal mengubah status antrean.' });
      }
    } finally {
      setTogglingRegularDone(false);
    }
  };

  if (availableSessions.length === 0) {
    return (
      <div className="bg-white p-10 rounded-2xl border border-slate-200 text-center space-y-2">
        <Clock className="w-10 h-10 text-slate-300 mx-auto" />
        <h3 className="text-sm font-bold text-slate-800">Belum Ada Sesi Ujian Ditugaskan</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Penguji <strong>{actorName}</strong> belum memiliki penugasan sesi aktif pada kegiatan ini.
        </p>
      </div>
    );
  }

  const effectiveRegularOffset =
    myAssignment?.regularQueueOffset ?? selectedSession?.regularQueueOffset ?? 0;

  // =========================================================================
  // MODE 1: FORM SETORAN PENGUJI MOBILE-FIRST (SAAT PESERTA DIPILIH)
  // =========================================================================
  if (activeParticipant && selectedSession) {
    const priorDonePages = studentPriorSubmissions
      .filter(s => s.sessionId !== selectedSession.id && s.fulfillmentStatus === 'submitted')
      .reduce((acc, s) => acc + (Number(s.confirmedPages) || 0), 0);

    const queueOrderInGroup = currentExistingSubmission?.queueOrder || 1;
    const estTurnNum = effectiveRegularOffset + queueOrderInGroup;

    const canSubmitBySessionState =
      event.status !== 'finalized' &&
      event.status !== 'cancelled' &&
      (selectedSession.status === 'active' || isCoordinator);

    return (
      <div className="max-w-xl mx-auto space-y-4">
        {/* Top Mobile Bar */}
        <div className="bg-gradient-to-r from-emerald-800 to-teal-900 text-white p-4 rounded-2xl shadow-md flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setActiveParticipant(null)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold"
          >
            <ChevronLeft className="w-4 h-4" /> Daftar Antrean
          </button>
          <div className="text-right">
            <div className="text-xs font-extrabold">{selectedSession.name}</div>
            <div className="text-[11px] text-emerald-200">
              Penguji: {actorName} {isSharedAccount ? '(PIN)' : ''}
            </div>
          </div>
        </div>

        {/* Indikator Tegas Status Penyimpanan Server vs Draft Lokal (B-05) */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-bold bg-white border-slate-200">
          <div className="flex items-center gap-2">
            {hasUnsavedLocalDraft ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                <span>DRAFT LOKAL — BELUM TERSIMPAN DI SERVER</span>
              </span>
            ) : currentExistingSubmission?.fulfillmentStatus === 'submitted' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Tersimpan Resmi di Server (v{currentExistingSubmission.version})</span>
              </span>
            ) : (
              <span className="text-slate-500">Belum ada setoran tersimpan di server</span>
            )}
          </div>

          {hasUnsavedLocalDraft && (
            <button
              type="button"
              onClick={() => {
                ziyadahAccelService.clearLocalDraft(
                  actorUserId,
                  selectedSession.id,
                  activeParticipant.id
                );
                setIsFormDirty(false);
                setHasUnsavedLocalDraft(false);
                setDraftRestoredNotice(false);
                setDraftTick(t => t + 1);
                openStudentForm(activeParticipant);
              }}
              className="text-[11px] text-rose-600 hover:underline"
            >
              Buang Draft Lokal
            </button>
          )}
        </div>

        {/* Kartu Identitas Otomatis Santri */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-bold mb-1">
                Urutan Akselerasi #{queueOrderInGroup}
                {effectiveRegularOffset > 0
                  ? ` • Est. Giliran Majelis #${estTurnNum} (Setelah ${effectiveRegularOffset} Reguler)`
                  : ' • Giliran Terakhir Majelis'}
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                {activeParticipant.studentNameSnapshot}
              </h3>
              <p className="text-xs text-slate-500">
                Kelas <strong>{activeParticipant.classSnapshot}</strong> •{' '}
                {activeParticipant.halaqahSnapshot} • NIS: {activeParticipant.nisSnapshot}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRefHistory(!showRefHistory)}
              className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold"
            >
              {showRefHistory ? 'Tutup Info' : 'Lihat Riwayat'}
            </button>
          </div>

          {showRefHistory && (
            <div className="pt-2 border-t border-slate-100 text-xs space-y-1.5 bg-slate-50/70 p-3 rounded-xl">
              <div className="font-bold text-slate-700 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-teal-600" />
                <span>Referensi Kesinambungan Hafalan</span>
              </div>
              <div className="text-slate-600">
                • <strong>Batas Sabaq Harian:</strong>{' '}
                {activeParticipant.baselineLabel || 'Belum tercatat'}
              </div>
              <div className="text-slate-600">
                • <strong>Total Sesi Terdahulu:</strong> {formatPagesIndo(priorDonePages)} Halaman
              </div>
              {studentPriorSubmissions
                .filter(
                  s => s.sessionId !== selectedSession.id && s.fulfillmentStatus === 'submitted'
                )
                .map(ps => {
                  const sObj = sessions.find(x => x.id === ps.sessionId);
                  return (
                    <div key={ps.id} className="text-[11px] text-emerald-800 font-medium">
                      • <strong>{sObj?.name || 'Sesi Sebelumnya'}:</strong>{' '}
                      {formatRangesCompact(ps.ranges)} ({formatPagesIndo(ps.confirmedPages)} Hal •
                      Nilai {ps.score})
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {draftRestoredNotice && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs font-semibold">
            Perhatian: Menampilkan draft lokal yang belum terkirim ke server. Klik &quot;Lanjut Konfirmasi Simpan&quot; agar tersimpan resmi di server.
          </div>
        )}

        {feedbackBanner && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-semibold flex items-start gap-2 ${
              feedbackBanner.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : feedbackBanner.type === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{feedbackBanner.text}</span>
          </div>
        )}

        {/* Form Utama Mobile-First */}
        <form
          onSubmit={handleOpenConfirmation}
          className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4"
        >
          {/* Pilihan Status Kewajiban Setoran */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wider">
              Status Kehadiran &amp; Setoran Sesi Ini
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsFormDirty(true);
                  setFulfillmentStatus('submitted');
                }}
                className={`py-2.5 px-2 rounded-xl text-xs font-bold border transition ${
                  fulfillmentStatus === 'submitted'
                    ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                Menyetor
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsFormDirty(true);
                  setFulfillmentStatus('called_not_submitted');
                }}
                className={`py-2.5 px-2 rounded-xl text-xs font-bold border transition ${
                  fulfillmentStatus === 'called_not_submitted'
                    ? 'bg-amber-600 text-white border-amber-700 shadow-sm'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                Belum Siap Setor
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsFormDirty(true);
                  setFulfillmentStatus('absent');
                }}
                className={`py-2.5 px-2 rounded-xl text-xs font-bold border transition ${
                  fulfillmentStatus === 'absent'
                    ? 'bg-rose-600 text-white border-rose-700 shadow-sm'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                Tidak Hadir
              </button>
            </div>
          </div>

          {fulfillmentStatus === 'absent' && (
            <div className="p-3.5 rounded-xl bg-rose-50/60 border border-rose-200 space-y-2">
              <label className="block text-xs font-bold text-rose-900">
                Keterangan Ketidakhadiran (Nilai &amp; Halaman tetap NULL, bukan 0)
              </label>
              <select
                value={absenceReason}
                onChange={e => {
                  setIsFormDirty(true);
                  setAbsenceReason(e.target.value as ZiyadahAccelAbsenceReason);
                }}
                className="w-full px-3 py-2.5 rounded-xl border border-rose-200 bg-white text-xs font-semibold"
              >
                <option value="sick">Sakit</option>
                <option value="permission">Izin Resmi</option>
                <option value="alpha">Tanpa Keterangan (Alpha)</option>
                <option value="other">Lainnya</option>
              </select>
            </div>
          )}

          {fulfillmentStatus === 'submitted' && (
            <>
              {/* Rincian Multi-Rentang Surah & Ayat */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Rentang Surah &amp; Ayat ({rangesDraft.length} Rentang)
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filterSurahsByJuz}
                        onChange={e => setFilterSurahsByJuz(e.target.checked)}
                      />
                      <span>Filter Surah per Juz</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsFormDirty(true);
                        const last = rangesDraft[rangesDraft.length - 1];
                        const nextSurah = last
                          ? activeParticipant.memorizationDirectionHint === 'backward'
                            ? Math.max(1, last.surahNumber - 1)
                            : Math.min(114, last.surahNumber + 1)
                          : 78;
                        const nextPage = quranService.getAyahPage(nextSurah, 1);
                        setRangesDraft(prev => [
                          ...prev,
                          {
                            juzNumber: quranService.getPageJuz(nextPage),
                            surahNumber: nextSurah,
                            ayahStart: 1,
                            ayahEnd: Math.min(SURAH_TOTAL_AYAHS[nextSurah] || 1, 10)
                          }
                        ]);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold"
                    >
                      <Plus className="w-3.5 h-3.5" /> Tambah Rentang
                    </button>
                  </div>
                </div>

                {rangesDraft.map((rng, idx) => {
                  const maxAyah = SURAH_TOTAL_AYAHS[rng.surahNumber] || 1;
                  const startPg = quranService.getAyahPage(rng.surahNumber, rng.ayahStart || 1);
                  const endPg = quranService.getAyahPage(rng.surahNumber, rng.ayahEnd || 1);

                  const surahOptions = filterSurahsByJuz
                    ? ALL_SURAHS.filter(s => {
                        const sStartJuz = quranService.getPageJuz(quranService.getAyahPage(s.number, 1));
                        const sEndJuz = quranService.getPageJuz(
                          quranService.getAyahPage(s.number, SURAH_TOTAL_AYAHS[s.number] || 1)
                        );
                        return (
                          s.number === rng.surahNumber ||
                          (rng.juzNumber >= sStartJuz && rng.juzNumber <= sEndJuz)
                        );
                      })
                    : ALL_SURAHS;

                  return (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-700">
                          Rentang Ziyadah #{idx + 1}
                        </span>
                        {rangesDraft.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsFormDirty(true);
                              setRangesDraft(prev => prev.filter((_, i) => i !== idx));
                            }}
                            className="text-rose-500 hover:text-rose-700 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                            Juz
                          </label>
                          <select
                            value={rng.juzNumber}
                            onChange={e => {
                              setIsFormDirty(true);
                              const j = parseInt(e.target.value) || 1;
                              setRangesDraft(prev =>
                                prev.map((x, i) => (i === idx ? { ...x, juzNumber: j } : x))
                              );
                            }}
                            className="w-full px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold"
                          >
                            {Array.from({ length: 30 }, (_, k) => k + 1).map(j => (
                              <option key={j} value={j}>
                                Juz {j}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                            Surah (Maks {maxAyah} Ayat)
                          </label>
                          <select
                            value={rng.surahNumber}
                            onChange={e => {
                              setIsFormDirty(true);
                              const sNum = parseInt(e.target.value) || 1;
                              const sMax = SURAH_TOTAL_AYAHS[sNum] || 1;
                              const pg = quranService.getAyahPage(sNum, 1);
                              const autoJuz = quranService.getPageJuz(pg);
                              setRangesDraft(prev =>
                                prev.map((x, i) =>
                                  i === idx
                                    ? {
                                        juzNumber: autoJuz,
                                        surahNumber: sNum,
                                        ayahStart: 1,
                                        ayahEnd: Math.min(sMax, 10)
                                      }
                                    : x
                                )
                              );
                            }}
                            className="w-full px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold"
                          >
                            {surahOptions.map(s => (
                              <option key={s.number} value={s.number}>
                                {s.number}. {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                            Ayat Awal
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={maxAyah}
                            value={rng.ayahStart || ''}
                            onChange={e => {
                              setIsFormDirty(true);
                              const val = parseInt(e.target.value) || 1;
                              const pg = quranService.getAyahPage(rng.surahNumber, val);
                              const autoJuz = quranService.getPageJuz(pg);
                              setRangesDraft(prev =>
                                prev.map((x, i) =>
                                  i === idx
                                    ? {
                                        ...x,
                                        juzNumber: autoJuz,
                                        ayahStart: val,
                                        ayahEnd: Math.max(val, x.ayahEnd)
                                      }
                                    : x
                                )
                              );
                            }}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-mono font-bold"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                            Ayat Akhir (1–{maxAyah})
                          </label>
                          <input
                            type="number"
                            min={rng.ayahStart || 1}
                            max={maxAyah}
                            value={rng.ayahEnd || ''}
                            onChange={e => {
                              setIsFormDirty(true);
                              const val = parseInt(e.target.value) || 1;
                              setRangesDraft(prev =>
                                prev.map((x, i) => (i === idx ? { ...x, ayahEnd: val } : x))
                              );
                            }}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-mono font-bold"
                            required
                          />
                        </div>
                      </div>

                      <div className="text-[11px] text-teal-800 font-medium">
                        Posisi Mushaf Madinah: <strong>Hal. {startPg}</strong>
                        {endPg !== startPg ? ` s.d. Hal. ${endPg}` : ''} • Juz{' '}
                        {quranService.getPageJuz(startPg)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Indikator Live Validasi Overlap / Celah Ayat / Saran Halaman */}
              {liveValidation && !liveValidation.valid && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                  {liveValidation.blockingError}
                </div>
              )}

              {liveValidation && liveValidation.valid && (
                <div className="space-y-2">
                  {liveValidation.overlapMessages.map((msg, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold flex items-start gap-2"
                    >
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                      <span>
                        <strong>Tumpang Tindih Terdeteksi:</strong> {msg} (Jika tetap disimpan, setoran ditandai <em>Memerlukan Verifikasi Koordinator</em> tanpa pemotongan proporsi panjang ayat otomatis).
                      </span>
                    </div>
                  ))}
                  {liveValidation.gapMessages.map((msg, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-800 text-xs flex items-start gap-2"
                    >
                      <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                      <span>{msg}</span>
                    </div>
                  ))}
                  {liveValidation.pageSpanWarning && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs">
                      {liveValidation.pageSpanWarning}
                    </div>
                  )}
                </div>
              )}

              {/* Input Jumlah Halaman Ziyadah (Kelipatan 0,25 Halaman) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Jumlah Ziyadah Dikonfirmasi Penguji (Kelipatan 0,25 Hal)
                  </label>
                  {liveValidation?.systemSuggestedPages && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsFormDirty(true);
                        setConfirmedPagesInput(String(liveValidation.systemSuggestedPages));
                      }}
                      className="text-[11px] font-bold text-emerald-700 underline"
                    >
                      Gunakan Referensi Halaman Utuh: {formatPagesIndo(liveValidation.systemSuggestedPages)} Hal
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {QUARTER_PAGE_QUICK_OPTIONS.map(opt => {
                    const active = parsedConfirmedPages === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setIsFormDirty(true);
                          setConfirmedPagesInput(String(opt));
                        }}
                        className={`px-3 py-2 rounded-xl text-xs font-mono font-bold border transition ${
                          active
                            ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {formatPagesIndo(opt)}
                      </button>
                    );
                  })}
                </div>

                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  max="604"
                  value={confirmedPagesInput}
                  onChange={e => {
                    setIsFormDirty(true);
                    setConfirmedPagesInput(e.target.value);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white font-mono text-base font-extrabold text-emerald-900"
                  placeholder="Contoh: 0.75 atau 1.5"
                  required
                />
                {liveValidation && liveValidation.touchedPagesSet.length > 0 && (
                  <p className="text-[11px] text-slate-500">
                    Referensi Mushaf (bukan halaman terverifikasi otomatis): Rentang ayat menyentuh{' '}
                    <strong>{liveValidation.maxPossiblePagesSpan} halaman</strong> (Hal.{' '}
                    {liveValidation.touchedPagesSet[0]}
                    {liveValidation.touchedPagesSet.length > 1
                      ? `–${liveValidation.touchedPagesSet[liveValidation.touchedPagesSet.length - 1]}`
                      : ''}
                    ).
                  </p>
                )}
              </div>

              {/* Input Nilai 0 - 100 */}
              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-1.5">
                  Nilai Setoran (0 – 100)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  value={scoreInput}
                  onChange={e => {
                    setIsFormDirty(true);
                    setScoreInput(e.target.value);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white font-mono text-lg font-extrabold text-slate-900"
                  required
                />
              </div>
            </>
          )}

          {/* Catatan Penguji */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Catatan Penguji (Opsional)
            </label>
            <textarea
              rows={2}
              value={examinerNotes}
              onChange={e => {
                setIsFormDirty(true);
                setExaminerNotes(e.target.value);
              }}
              placeholder="Catatan kelancaran, tajwid, atau makhraj..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs outline-none"
            />
          </div>

          {currentExistingSubmission?.fulfillmentStatus === 'submitted' && (
            <div>
              <label className="block text-xs font-bold text-amber-800 mb-1">
                Alasan Koreksi Nilai / Setoran (Wajib • Tercatat pada Audit Log)
              </label>
              <input
                type="text"
                value={correctionReason}
                onChange={e => setCorrectionReason(e.target.value)}
                placeholder="Contoh: Perbaikan salah ketik batas ayat akhir..."
                className="w-full px-3 py-2 rounded-xl border border-amber-300 bg-amber-50/40 text-xs outline-none"
                required
              />
            </div>
          )}

          {!canSubmitBySessionState ? (
            <div className="p-3 rounded-xl bg-slate-100 text-slate-600 text-xs text-center font-semibold">
              Sesi ini berstatus {selectedSession.status.toUpperCase()} — penginputan telah dikunci.
            </div>
          ) : (
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md"
            >
              <Save className="w-4 h-4" />
              <span>Lanjut Konfirmasi Simpan ke Server</span>
            </button>
          )}
        </form>

        {/* Modal Konfirmasi Sebelum Simpan */}
        {showConfirmModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4 border border-slate-200">
              <div className="flex items-center gap-2 text-emerald-800 font-extrabold text-sm">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <span>Konfirmasi Penyimpanan Resmi ke Server</span>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                <div>
                  <span className="text-slate-500">Penguji Pencatat: </span>
                  <strong className="text-emerald-900">{actorName}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Santri: </span>
                  <strong className="text-slate-900">
                    {activeParticipant.studentNameSnapshot} ({activeParticipant.classSnapshot})
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">Sesi: </span>
                  <strong>{selectedSession.name}</strong>
                </div>
                {fulfillmentStatus === 'submitted' ? (
                  <>
                    <div>
                      <span className="text-slate-500">Materi: </span>
                      <strong>{formatRangesCompact(liveValidation?.normalizedRanges)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Jumlah Ziyadah: </span>
                      <strong className="text-emerald-700 font-mono">
                        {formatPagesIndo(parsedConfirmedPages)} Halaman
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Nilai: </span>
                      <strong className="text-teal-800 font-mono text-sm">
                        {parsedScore?.toFixed(2)}
                      </strong>
                    </div>
                    {(liveValidation?.clientFlags.length || 0) > 0 && (
                      <div className="text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200 font-semibold mt-1">
                        Catatan: Setoran ini memiliki penanda verifikasi (
                        {liveValidation?.clientFlags.join(', ')}) untuk ditinjau Koordinator.
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    <span className="text-slate-500">Status Dicatat: </span>
                    <strong className="uppercase text-rose-700">
                      {fulfillmentStatus === 'absent'
                        ? `TIDAK HADIR (${absenceReason.toUpperCase()})`
                        : 'DIPANGGIL — BELUM MENYETOR'}
                    </strong>
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setShowConfirmModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"
                >
                  Periksa Kembali
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleExecuteSave}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold shadow-sm"
                >
                  {isSubmitting ? 'Menyimpan ke Server...' : 'Ya, Simpan Resmi'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // MODE 2: DAFTAR ANTREAN GILIRAN PESERTA PADA SESI AKTIF (PER MAJELIS)
  // =========================================================================
  const pendingDraftsCount = sessionQueueItems.filter(i => i.hasLocalDraft).length;

  return (
    <div className="space-y-4">
      {/* Banner Peringatan Tegas Jika Ada Draft Lokal Belum Masuk Server (Perbaikan B-05) */}
      {pendingDraftsCount > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-950 text-xs font-bold flex items-start gap-2.5 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <div>
            <div>
              PERHATIAN: Terdapat {pendingDraftsCount} Draft Setoran Lokal yang BELUM Tersimpan di Server!
            </div>
            <p className="font-normal text-amber-900 mt-0.5">
              Draft lokal hanya tersimpan sementara di perangkat ini (tidak dihitung oleh Koordinator). Buka kartu peserta berlabel kuning di bawah lalu klik <strong>Ya, Simpan Resmi</strong> saat koneksi stabil.
            </p>
          </div>
        </div>
      )}

      {feedbackBanner && (
        <div
          className={`p-4 rounded-2xl border text-xs font-bold flex items-center justify-between ${
            feedbackBanner.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : feedbackBanner.type === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span>{feedbackBanner.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-slate-400 hover:text-slate-700 ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* Bar Pemilih Sesi, Info Majelis, & Status Selesai Setoran Reguler (A.4) */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-600" />
              <span>
                Antrean Majelis Penguji: {actorName}
                {myAssignment?.groupLabel ? ` (${myAssignment.groupLabel})` : ''}
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              {isSharedAccount
                ? 'Login via Akun Bersama UJIAN (Terverifikasi PIN Individual)'
                : 'Login via Akun Pribadi SITA'}
              {effectiveRegularOffset > 0
                ? ` • Giliran akselerasi dimulai setelah estimasi ${effectiveRegularOffset} santri reguler`
                : ' • Giliran terakhir setelah setoran santri reguler selesai'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isSharedAccount && onSwitchSharedExaminer && (
              <button
                type="button"
                onClick={onSwitchSharedExaminer}
                className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-bold flex items-center gap-1"
              >
                <UserCheck className="w-3.5 h-3.5" /> Ganti PIN
              </button>
            )}
            <select
              value={selectedSessionId}
              onChange={e => setSelectedSessionId(e.target.value)}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 outline-none"
            >
              {availableSessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.sessionDate}) — {s.status.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Konfirmasi Eksplisit Selesainya Setoran Reguler di Majelis Penguji (A.4) */}
        {myAssignment && selectedSession?.status === 'active' && (
          <div
            className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
              myAssignment.regularFinishConfirmed
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                : 'bg-indigo-50/70 border-indigo-200 text-indigo-950'
            }`}
          >
            <div>
              <strong>Status Giliran Majelis: </strong>
              {myAssignment.regularFinishConfirmed
                ? 'Setoran santri reguler telah dikonfirmasi selesai — Giliran peserta akselerasi sedang berlangsung.'
                : 'Pastikan setoran santri reguler di majelis Anda selesai lebih dulu sebelum memanggil giliran peserta akselerasi.'}
            </div>
            <button
              type="button"
              disabled={togglingRegularDone}
              onClick={handleToggleRegularDone}
              className={`px-3 py-1.5 rounded-xl font-bold shrink-0 transition ${
                myAssignment.regularFinishConfirmed
                  ? 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
              }`}
            >
              {myAssignment.regularFinishConfirmed
                ? 'Batalkan Tanda Selesai Reguler'
                : 'Konfirmasi Setoran Reguler Selesai'}
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={queueSearch}
              onChange={e => setQueueSearch(e.target.value)}
              placeholder="Cari nama santri, NIS, atau kelas..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs outline-none"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {(
              [
                ['ALL', 'Semua'],
                ['PENDING', 'Belum Setor'],
                ['SUBMITTED', 'Sudah Setor'],
                ['ABSENT', 'Tidak Hadir']
              ] as const
            ).map(([code, label]) => (
              <button
                key={code}
                type="button"
                onClick={() => setQueueFilter(code)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                  queueFilter === code
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Kartu Antrean Mobile-Friendly */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filteredQueueItems.map(({ participant, submission, queueOrder, status, hasLocalDraft }) => {
          const estNum = effectiveRegularOffset + queueOrder;
          return (
            <div
              key={participant.id}
              onClick={() => openStudentForm(participant)}
              className={`cursor-pointer bg-white p-4 rounded-2xl border shadow-sm transition flex items-center justify-between gap-3 ${
                hasLocalDraft
                  ? 'border-amber-400 bg-amber-50/20 hover:border-amber-500'
                  : 'border-slate-200 hover:border-emerald-400'
              }`}
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono text-[11px] font-bold">
                    Aksel #{queueOrder}
                    {effectiveRegularOffset > 0 ? ` (Est. #${estNum})` : ''}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold">
                    Kelas {participant.classSnapshot}
                  </span>
                  {hasLocalDraft && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold">
                      ⚠ Draft Belum Disimpan ke Server
                    </span>
                  )}
                </div>
                <div className="font-extrabold text-sm text-slate-900 truncate">
                  {participant.studentNameSnapshot}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {status === 'submitted' && submission
                    ? `${formatRangesCompact(submission.ranges)} • ${formatPagesIndo(
                        submission.confirmedPages
                      )} Hal • Nilai ${submission.score}`
                    : `${participant.halaqahSnapshot} • Batas: ${
                        participant.baselineLabel || '-'
                      }`}
                </div>
              </div>

              <div className="shrink-0 text-right">
                {status === 'submitted' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Selesai
                  </span>
                ) : status === 'absent' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold">
                    <UserX className="w-3.5 h-3.5" /> Absen
                  </span>
                ) : status === 'called_not_submitted' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold">
                    Dipanggil
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-sm">
                    Input Setoran
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
