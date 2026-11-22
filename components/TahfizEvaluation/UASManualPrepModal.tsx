import React, { useMemo, useRef, useState } from 'react';
import {
  AcademicTerm,
  ExamMaterialPart,
  ExamPeriod,
  ExamUASSession,
  TahfidzRecord,
  User
} from '../../types';
import { api } from '../../api';
import { quranService, SURAH_TOTAL_AYAHS } from '../../services/quranService';
import { materialDetectionService } from '../../services/materialDetectionService';
import {
  analyzeStudentJuzPartsAndSessions,
  computeManualJuzPartCoverage,
  JUZ_AYAH_BOUNDARIES,
  JUZ_PAGE_RANGES
} from '../../services/uasJuzSegmentationService';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  Edit3,
  Plus,
  Save,
  Send,
  Sliders,
  Trash2,
  X
} from 'lucide-react';

interface UASManualPrepModalProps {
  isOpen: boolean;
  onClose: () => void;
  period: ExamPeriod;
  term: Pick<AcademicTerm, 'startDate'>;
  studentId: string;
  studentName: string;
  studentClass: string;
  halaqah: string;
  teacherName: string;
  records: TahfidzRecord[];
  serverParts: ExamMaterialPart[];
  suggestedParts: ExamMaterialPart[];
  sessions: ExamUASSession[];
  serverSessions?: ExamUASSession[];
  submissionStatus?: string;
  user: User;
  onSaved: (msgText?: string) => Promise<void>;
}

interface DraftSessionItem {
  localId: string;
  serverId?: string;
  originalSessionNumber?: number;
  juzNumber: number;
  sessionType: 'full_juz' | 'partial_half';
  source: 'auto' | 'manual';
  isLocked?: boolean;
  hasAttempt?: boolean;
  hasQuestionSet?: boolean;
  customPart?: {
    startSurah: number;
    startAyah: number;
    endSurah: number;
    endAyah: number;
    hasExtraSeg: boolean;
    extraStartSurah: number;
    extraStartAyah: number;
    extraEndSurah: number;
    extraEndAyah: number;
  };
}

const DEFAULT_MANUAL_REASON = 'Ditetapkan sesuai pemeriksaan guru';
const DEFAULT_VERIFY_REASON = 'Diverifikasi oleh Guru Halaqah';
const DEFAULT_SESSION_REASON = 'Sesi diatur oleh Guru Halaqah';
const DEFAULT_DELETE_REASON = 'Sesi draft dihapus Guru Halaqah';

function formatEffectivePages(ratio: number, juzTotalPages: number): string {
  const eff = ratio * juzTotalPages;
  const rounded = Math.round(eff * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1).replace('.', ',');
}

function isRecordInvalid(rec: TahfidzRecord): { invalid: boolean; reason?: string } {
  const rawSurah = (rec.surah || '').trim();
  const sNum = materialDetectionService.getSurahNumber(rawSurah);
  if (sNum === 1 && !rawSurah.toLowerCase().includes('fatihah')) {
    return { invalid: true, reason: `Surah "${rec.surah}" tidak dikenali` };
  }
  const maxA = SURAH_TOTAL_AYAHS[sNum] || 286;
  if (rec.ayahStart < 1 || (rec.ayahEnd > 0 && rec.ayahStart > rec.ayahEnd)) {
    return { invalid: true, reason: `Rentang ayat terbalik (${rec.ayahStart}-${rec.ayahEnd})` };
  }
  if (rec.ayahEnd > maxA) {
    return { invalid: true, reason: `Ayat ${rec.ayahEnd} melebihi batas ${rec.surah} (maks ${maxA})` };
  }
  return { invalid: false };
}

export const UASManualPrepModal: React.FC<UASManualPrepModalProps> = ({
  isOpen,
  onClose,
  period,
  term,
  studentId,
  studentName,
  studentClass,
  halaqah,
  teacherName,
  records,
  serverParts,
  sessions,
  serverSessions,
  submissionStatus,
  user,
  onSaved
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const isAdmin = user.role === 'admin';
  const isLockedByAdmin = submissionStatus === 'admin_approved' && !isAdmin;

  const buildFullJuzPart = (juzNum: number, prevId?: string, order = 1): ExamMaterialPart => {
    const b = JUZ_AYAH_BOUNDARIES[juzNum] || { startSurah: 78, startAyah: 1, endSurah: 114, endAyah: 6 };
    const pr = JUZ_PAGE_RANGES[juzNum] || { startPage: 582, endPage: 604, totalPages: 23 };
    const pages = Array.from({ length: pr.totalPages }, (_, i) => pr.startPage + i);
    return {
      id: prevId || `emp_${period.id}_${studentId}_j${juzNum}`,
      examPeriodId: period.id,
      studentId,
      snapshotId: null,
      partOrder: order,
      juzNumber: juzNum,
      partType: 'full_juz',
      startSurah: b.startSurah,
      startAyah: b.startAyah,
      endSurah: b.endSurah,
      endAyah: b.endAyah,
      startSurahName: quranService.getSurah(b.startSurah)?.name || `Surah ${b.startSurah}`,
      endSurahName: quranService.getSurah(b.endSurah)?.name || `Surah ${b.endSurah}`,
      startPage: pr.startPage,
      endPage: pr.endPage,
      coveredPages: pages,
      coveredPagesCount: pr.totalPages,
      juzTotalPages: pr.totalPages,
      coverageRatio: 1,
      segments: [{
        startSurah: b.startSurah,
        startAyah: b.startAyah,
        endSurah: b.endSurah,
        endAyah: b.endAyah,
        startPage: pr.startPage,
        endPage: pr.endPage,
        pages
      }],
      hasGap: false,
      status: 'ready',
      teacherStatus: 'draft_manual',
      manualConfirmation: true
    };
  };

  // Filter relevant semester records (sabaq/ziyadah <= cutoff)
  const relevantRecords = useMemo(() => {
    return materialDetectionService.filterRelevantRecords(
      records,
      studentId,
      term.startDate,
      period.materialCutoffDate
    );
  }, [records, studentId, term.startDate, period.materialCutoffDate]);

  const recordStatusList = useMemo(() => {
    return relevantRecords.map(rec => ({
      rec,
      ...isRecordInvalid(rec)
    }));
  }, [relevantRecords]);

  const validRecords = useMemo(() => recordStatusList.filter(r => !r.invalid).map(r => r.rec), [recordStatusList]);
  const invalidRecords = useMemo(() => recordStatusList.filter(r => r.invalid), [recordStatusList]);

  // Step 1 state: selected valid record IDs (default: all valid records selected so teacher can review/uncheck)
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>(() => validRecords.map(r => r.id));
  const [showAnomalyDetail, setShowAnomalyDetail] = useState(false);

  // Step 2 state: working list of active (non-void) sessions
  const [draftSessions, setDraftSessions] = useState<DraftSessionItem[]>(() => {
    const activeSessions = sessions.filter(s => s.status !== 'void' && (!s.examPeriodId || s.examPeriodId === period.id));
    if (activeSessions.length > 0) {
      return [...activeSessions]
        .sort((a, b) => a.sessionNumber - b.sessionNumber)
        .map(s => {
          const isPersistedOnServer =
            serverSessions !== undefined
              ? serverSessions.some(ss => ss.id === s.id && ss.status !== 'void' && ss.examPeriodId === period.id)
              : Boolean(s.questionSetId || s.attemptId || s.isLocked || s.source === 'manual');
          return {
            localId: s.id,
            serverId: isPersistedOnServer ? s.id : undefined,
            originalSessionNumber: isPersistedOnServer ? s.sessionNumber : undefined,
            juzNumber: s.juzNumber,
            sessionType: s.sessionType,
            source: s.source || 'auto',
            isLocked: s.isLocked,
            hasAttempt: Boolean(s.attemptId),
            hasQuestionSet: Boolean(s.questionSetId)
          };
        });
    }
    return [];
  });

  // Track deleted server session IDs (only manual unlocked draft sessions)
  const [deletedServerSessionIds, setDeletedServerSessionIds] = useState<string[]>([]);

  // Advanced editor ("Ubah Detail") & manual add-session picker
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [addingSessionPicker, setAddingSessionPicker] = useState<boolean>(false);
  const [newJuzNum, setNewJuzNum] = useState<number>(30);
  const [newSessionType, setNewSessionType] = useState<'full_juz' | 'partial_half'>('full_juz');

  // Guru Halaqah manual confirmation when declared material differs from app records
  const [manualConfirmation, setManualConfirmation] = useState<boolean>(() =>
    serverParts.some(p => Boolean(p.manualConfirmation))
  );
  const [verificationNotes, setVerificationNotes] = useState<string>(
    () => serverParts.find(p => p.verificationNotes)?.verificationNotes || ''
  );
  const [showDiffDetail, setShowDiffDetail] = useState<boolean>(false);

  // Dirty tracking & in-flight lock
  const [isDirty, setIsDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlightRef = useRef(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Selected records analysis (auto-computes per-Juz parts from ONLY teacher-selected valid records!)
  const selectedRecords = useMemo(() => {
    const idSet = new Set(selectedRecordIds);
    return validRecords.filter(r => idSet.has(r.id));
  }, [validRecords, selectedRecordIds]);

  const computedAnalysis = useMemo(() => {
    return analyzeStudentJuzPartsAndSessions({
      studentId,
      periodId: period.id,
      term,
      period,
      records: selectedRecords,
      existingParts: serverParts
    });
  }, [studentId, period, term, selectedRecords, serverParts]);

  // App records evidence map (strictly from valid app records — reference only, never blocks Guru!)
  const appEvidenceByJuz = useMemo(() => {
    const map = new Map<number, ExamMaterialPart>();
    computedAnalysis.parts.forEach(p => map.set(p.juzNumber, p));
    return map;
  }, [computedAnalysis.parts]);

  // Build effective Juz parts map (merges computed parts + server parts + Guru/Admin manual session overrides)
  const effectivePartsByJuz = useMemo(() => {
    const map = new Map<number, ExamMaterialPart>();
    serverParts.forEach(p => {
      if (p.status !== 'excluded') map.set(p.juzNumber, p);
    });
    computedAnalysis.parts.forEach(p => {
      const existing = map.get(p.juzNumber);
      // Respect prior manual_confirmation part instead of overwriting with auto detection!
      if (existing?.manualConfirmation) return;
      map.set(p.juzNumber, p);
    });
    // Apply Guru/Admin manual session declarations (full_juz or custom range or manual Juz)
    draftSessions.forEach(ds => {
      const prev = map.get(ds.juzNumber);
      if (ds.sessionType === 'full_juz' && !ds.customPart) {
        map.set(ds.juzNumber, buildFullJuzPart(ds.juzNumber, prev?.id, prev?.partOrder || map.size + 1));
        return;
      }
      if (ds.customPart) {
        const cp = ds.customPart;
        const ranges = [{ startSurah: cp.startSurah, startAyah: cp.startAyah, endSurah: cp.endSurah, endAyah: cp.endAyah }];
        if (cp.hasExtraSeg) {
          ranges.push({
            startSurah: cp.extraStartSurah,
            startAyah: cp.extraStartAyah,
            endSurah: cp.extraEndSurah,
            endAyah: cp.extraEndAyah
          });
        }
        const cov = computeManualJuzPartCoverage({ juzNumber: ds.juzNumber, ranges });
        map.set(ds.juzNumber, {
          id: prev?.id || `emp_${period.id}_${studentId}_j${ds.juzNumber}`,
          examPeriodId: period.id,
          studentId,
          snapshotId: prev?.snapshotId || null,
          partOrder: prev?.partOrder || map.size + 1,
          juzNumber: ds.juzNumber,
          partType: ds.sessionType === 'full_juz' ? 'full_juz' : cov.partType,
          startSurah: cov.startSurah,
          startAyah: cov.startAyah,
          endSurah: cov.endSurah,
          endAyah: cov.endAyah,
          startSurahName: quranService.getSurah(cov.startSurah)?.name || `Surah ${cov.startSurah}`,
          endSurahName: quranService.getSurah(cov.endSurah)?.name || `Surah ${cov.endSurah}`,
          startPage: cov.startPage,
          endPage: cov.endPage,
          coveredPages: cov.coveredPages,
          coveredPagesCount: cov.coveredPagesCount,
          juzTotalPages: cov.juzTotalPages,
          coverageRatio: ds.sessionType === 'full_juz' ? 1 : cov.coverageRatio,
          segments: cov.segments,
          hasGap: ds.sessionType === 'full_juz' ? false : cov.hasGap,
          status: 'ready',
          teacherStatus: 'draft_manual',
          manualConfirmation: prev?.manualConfirmation
        });
        return;
      }
      if (!prev) {
        // Manually added Juz with partial_half default (half Juz Mushaf boundaries)
        const full = buildFullJuzPart(ds.juzNumber, undefined, map.size + 1);
        map.set(ds.juzNumber, {
          ...full,
          partType: ds.sessionType === 'full_juz' ? 'full_juz' : 'partial_half',
          coverageRatio: ds.sessionType === 'full_juz' ? 1 : 0.5
        });
      }
    });
    return map;
  }, [serverParts, computedAnalysis.parts, draftSessions, period.id, studentId]);

  const effectivePartsList = useMemo(
    () => Array.from(effectivePartsByJuz.values()).sort((a, b) => a.juzNumber - b.juzNumber),
    [effectivePartsByJuz]
  );

  // Compute differences between app deposit records and Guru's declared sessions
  const materialDifferences = useMemo(() => {
    const diffs: Array<{ juzNumber: number; appLabel: string; teacherLabel: string }> = [];
    const seen = new Set<number>();
    draftSessions.forEach(ds => {
      if (seen.has(ds.juzNumber)) return;
      seen.add(ds.juzNumber);
      const appPt = appEvidenceByJuz.get(ds.juzNumber);
      const appPct = appPt ? Math.round(appPt.coverageRatio * 100) : 0;
      const appIsFull = Boolean(appPt && appPt.partType === 'full_juz' && appPt.coverageRatio >= 1 && !appPt.hasGap);
      if (ds.sessionType === 'full_juz' && (!appIsFull || invalidRecords.length > 0)) {
        diffs.push({
          juzNumber: ds.juzNumber,
          appLabel: appPt ? `${appPct}% (${formatEffectivePages(appPt.coverageRatio, appPt.juzTotalPages)}/${appPt.juzTotalPages} hal)` : 'Belum tercatat di setoran aplikasi',
          teacherLabel: '1 Juz Penuh — 9 Soal'
        });
      } else if (ds.sessionType === 'partial_half' && (!appPt || appPt.coverageRatio < 0.5)) {
        diffs.push({
          juzNumber: ds.juzNumber,
          appLabel: appPt ? `${appPct}%` : 'Belum tercatat di setoran aplikasi',
          teacherLabel: 'Parsial — 4 Soal'
        });
      }
    });
    return diffs;
  }, [draftSessions, appEvidenceByJuz, invalidRecords.length]);

  const hasDifference = materialDifferences.length > 0 || invalidRecords.length > 0;

  // Unallocated Juzes detected from records (quick suggestions in + Tambah Sesi)
  const allocatedJuzSet = useMemo(() => new Set(draftSessions.map(s => s.juzNumber)), [draftSessions]);
  const unallocatedEligibleParts = useMemo(
    () => effectivePartsList.filter(p => p.coverageRatio >= 0.5 && !allocatedJuzSet.has(p.juzNumber)),
    [effectivePartsList, allocatedJuzSet]
  );

  if (!isOpen) return null;

  const handleRequestClose = () => {
    if (busy) return;
    if (isDirty) {
      const ok = window.confirm('Ada perubahan yang belum disimpan. Yakin ingin menutup?');
      if (!ok) return;
    }
    onClose();
  };

  const toggleRecord = (recId: string) => {
    if (isLockedByAdmin) return;
    setSelectedRecordIds(prev => (prev.includes(recId) ? prev.filter(id => id !== recId) : [...prev, recId]));
    setIsDirty(true);
    setFeedback(null);
  };

  const selectAllValid = () => {
    if (isLockedByAdmin) return;
    setSelectedRecordIds(validRecords.map(r => r.id));
    setIsDirty(true);
    setFeedback(null);
  };

  const clearAllRecords = () => {
    if (isLockedByAdmin) return;
    setSelectedRecordIds([]);
    setIsDirty(true);
    setFeedback(null);
  };

  // Move from Step 1 -> Step 2 (always allowed so Guru/Admin can add manual sessions even if records are empty!)
  const goToStep2 = () => {
    setFeedback(null);
    if (draftSessions.length === 0) {
      const autoEligible = effectivePartsList.filter(p => p.coverageRatio >= 0.5);
      if (autoEligible.length > 0) {
        setDraftSessions(
          autoEligible.map(p => ({
            localId: `new_j${p.juzNumber}_${Date.now()}`,
            juzNumber: p.juzNumber,
            sessionType: p.partType === 'full_juz' && !p.hasGap ? 'full_juz' : 'partial_half',
            source: 'manual'
          }))
        );
        setIsDirty(true);
      }
    }
    setStep(2);
  };

  const addSessionForJuz = (juzNum: number, chosenType?: 'full_juz' | 'partial_half') => {
    const existing = draftSessions.find(s => s.juzNumber === juzNum);
    const part = effectivePartsByJuz.get(juzNum);
    const b = JUZ_AYAH_BOUNDARIES[juzNum] || { startSurah: 78, startAyah: 1, endSurah: 114, endAyah: 6 };
    const finalType: 'full_juz' | 'partial_half' =
      chosenType || (part && part.partType === 'full_juz' && !part.hasGap ? 'full_juz' : 'partial_half');
    const newId = `new_j${juzNum}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    if (existing) {
      // Allow splitting one Juz into >1 session with a distinct editable range!
      setDraftSessions(prev => [
        ...prev,
        {
          localId: newId,
          juzNumber: juzNum,
          sessionType: 'partial_half',
          source: 'manual',
          customPart: {
            startSurah: b.startSurah,
            startAyah: b.startAyah,
            endSurah: b.endSurah,
            endAyah: b.endAyah,
            hasExtraSeg: false,
            extraStartSurah: b.startSurah,
            extraStartAyah: 1,
            extraEndSurah: b.startSurah,
            extraEndAyah: 10
          }
        }
      ]);
      setAddingSessionPicker(false);
      setEditingLocalId(newId);
      setIsDirty(true);
      setFeedback({ type: 'success', text: `Sesi tambahan Juz ${juzNum} dibuat. Atur rentang surah/ayat yang berbeda dari sesi sebelumnya.` });
      return;
    }

    setDraftSessions(prev => [
      ...prev,
      {
        localId: newId,
        juzNumber: juzNum,
        sessionType: finalType,
        source: 'manual'
      }
    ]);
    setAddingSessionPicker(false);
    setIsDirty(true);
    setFeedback({ type: 'success', text: `Sesi baru Juz ${juzNum} (${finalType === 'full_juz' ? '1 Juz Penuh' : 'Parsial'}) ditambahkan.` });
  };

  const removeSession = (item: DraftSessionItem, displayIndex: number) => {
    if (item.hasAttempt || item.hasQuestionSet || item.isLocked) {
      setFeedback({ type: 'error', text: 'Sesi ini sudah memiliki soal atau riwayat ujian. Hubungi Admin untuk melakukan perubahan.' });
      return;
    }
    const ok = window.confirm(`Hapus Sesi ${displayIndex + 1} (Juz ${item.juzNumber}) dari rencana ujian ${studentName}?`);
    if (!ok) return;
    if (item.serverId) {
      setDeletedServerSessionIds(prev => (prev.includes(item.serverId!) ? prev : [...prev, item.serverId!]));
    }
    setDraftSessions(prev => prev.filter(s => s.localId !== item.localId));
    if (editingLocalId === item.localId) setEditingLocalId(null);
    setIsDirty(true);
    setFeedback({ type: 'success', text: `Sesi ${displayIndex + 1} (Juz ${item.juzNumber}) dihapus dari daftar. Klik Simpan untuk menerapkan.` });
  };

  const moveSession = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= draftSessions.length) return;
    const cur = draftSessions[index];
    const target = draftSessions[targetIdx];
    if (cur.hasAttempt || cur.hasQuestionSet || cur.isLocked || target.hasAttempt || target.hasQuestionSet || target.isLocked) {
      setFeedback({ type: 'error', text: 'Sesi ini sudah memiliki soal atau riwayat ujian. Hubungi Admin untuk melakukan perubahan.' });
      return;
    }
    setDraftSessions(prev => {
      const next = [...prev];
      const tmp = next[index];
      next[index] = next[targetIdx];
      next[targetIdx] = tmp;
      return next;
    });
    setIsDirty(true);
    setFeedback(null);
  };

  const openDetailEditor = (item: DraftSessionItem) => {
    const part = effectivePartsByJuz.get(item.juzNumber);
    const b = JUZ_AYAH_BOUNDARIES[item.juzNumber] || { startSurah: 1, startAyah: 1, endSurah: 1, endAyah: 7 };
    if (!item.customPart) {
      setDraftSessions(prev =>
        prev.map(s =>
          s.localId === item.localId
            ? {
                ...s,
                customPart: {
                  startSurah: part?.startSurah || b.startSurah,
                  startAyah: part?.startAyah || b.startAyah,
                  endSurah: part?.endSurah || b.endSurah,
                  endAyah: part?.endAyah || b.endAyah,
                  hasExtraSeg: false,
                  extraStartSurah: b.startSurah,
                  extraStartAyah: 1,
                  extraEndSurah: b.startSurah,
                  extraEndAyah: 10
                }
              }
            : s
        )
      );
    }
    setEditingLocalId(item.localId);
    setFeedback(null);
  };

  const updateEditingSession = (updater: (item: DraftSessionItem) => DraftSessionItem) => {
    if (!editingLocalId) return;
    setDraftSessions(prev => prev.map(s => (s.localId === editingLocalId ? updater(s) : s)));
    setIsDirty(true);
  };

  /**
   * Persist all draft parts, deletions, (optional verification), and sessions to PostgreSQL safely.
   * When verifyBeforeSessions=true (used by "Periksa & Kirim ke Admin"), parts are verified
   * BEFORE upserting sessions so server-side session validation succeeds even on gap-verified parts.
   */
  const persistAllChanges = async (verifyBeforeSessions = false): Promise<string[]> => {
    if (effectivePartsList.length === 0) {
      throw new Error('Belum ada materi hafalan yang ditetapkan.');
    }
    if (hasDifference) {
      if (!manualConfirmation) {
        throw new Error('Catatan setoran aplikasi berbeda dengan materi yang ditetapkan. Centang "Tetapkan Sesuai Pemeriksaan Guru" terlebih dahulu.');
      }
    }

    // 1. Delete removed REAL server draft sessions first (frees session_number)
    const pendingDeletes = Array.from(new Set(deletedServerSessionIds));
    for (const delId of pendingDeletes) {
      const delRes = await api.deleteUASManualSession(delId, DEFAULT_DELETE_REASON, user);
      if (delRes.success) {
        // Immediately remove confirmed deletion so partial failures never retry deleted IDs
        setDeletedServerSessionIds(prev => prev.filter(id => id !== delId));
      } else {
        const msgLower = (delRes.message || '').toLowerCase();
        // If session was already deleted/voided on server in a prior retry, safely drop stale ID
        if (msgLower.includes('sesi tidak ditemukan')) {
          setDeletedServerSessionIds(prev => prev.filter(id => id !== delId));
          continue;
        }
        throw new Error(delRes.message || 'Gagal menghapus sesi draft lama.');
      }
    }

    // 2. Upsert every active Juz part (with explicit manual_confirmation & standard verification_notes)
    const savedPartIdByJuz = new Map<number, string>();
    const activeNotes = verificationNotes.trim() || (isAdmin ? 'Ditetapkan sesuai pemeriksaan Admin' : DEFAULT_MANUAL_REASON);
    for (let idx = 0; idx < effectivePartsList.length; idx++) {
      const pt = effectivePartsList[idx];
      const res = await api.upsertUASManualPart(
        period.id,
        studentId,
        {
          id: pt.id,
          partOrder: idx + 1,
          juzNumber: pt.juzNumber,
          partType: pt.partType,
          startSurah: pt.startSurah,
          startAyah: pt.startAyah,
          endSurah: pt.endSurah,
          endAyah: pt.endAyah,
          startPage: pt.startPage,
          endPage: pt.endPage,
          coveredPages: pt.coveredPages,
          coveredPagesCount: pt.coveredPagesCount,
          juzTotalPages: pt.juzTotalPages,
          coverageRatio: pt.coverageRatio,
          segments: pt.segments,
          hasGap: manualConfirmation ? false : pt.hasGap,
          manualConfirmation: Boolean(manualConfirmation || hasDifference),
          verificationNotes: activeNotes,
          referencedRecordIds: selectedRecordIds
        },
        activeNotes,
        user
      );
      if (!res.success) {
        throw new Error(res.message || `Gagal menyimpan materi Juz ${pt.juzNumber}.`);
      }
      savedPartIdByJuz.set(pt.juzNumber, res.partId || pt.id);
    }

    // 3. If submitting & not already verified via manual_confirmation, verify parts
    if (verifyBeforeSessions && !manualConfirmation) {
      for (const partId of savedPartIdByJuz.values()) {
        const vRes = await api.verifyOrFinalizeUASMaterialPart(partId, 'verify', DEFAULT_VERIFY_REASON, user);
        if (!vRes.success) {
          throw new Error(vRes.message || 'Verifikasi materi gagal di server.');
        }
      }
    }

    // 4. Upsert every editable session, preserving locked/used session numbers & identities
    const reservedNumbers = new Set<number>(
      draftSessions
        .filter(ds => (ds.hasAttempt || ds.hasQuestionSet || ds.isLocked) && ds.originalSessionNumber)
        .map(ds => ds.originalSessionNumber!)
    );
    let nextFreeNum = 1;
    const allocSessionNumber = () => {
      while (reservedNumbers.has(nextFreeNum)) nextFreeNum += 1;
      const chosen = nextFreeNum;
      reservedNumbers.add(chosen);
      nextFreeNum += 1;
      return chosen;
    };

    const seenRangeKeys = new Set<string>();
    const preparedSessions: Array<{
      ds: DraftSessionItem;
      assignedNum: number;
      partId: string;
      sStartSurah: number;
      sStartAyah: number;
      sEndSurah: number;
      sEndAyah: number;
      sStartPage: number;
      sEndPage: number;
      sCoveredPages: number[];
    }> = [];

    for (let i = 0; i < draftSessions.length; i++) {
      const ds = draftSessions[i];
      if (ds.hasAttempt || ds.hasQuestionSet || ds.isLocked) continue;

      const assignedNum = allocSessionNumber();
      const part = effectivePartsByJuz.get(ds.juzNumber);
      const partId = savedPartIdByJuz.get(ds.juzNumber) || part?.id;
      if (!part || !partId) {
        throw new Error(`Materi Juz ${ds.juzNumber} tidak ditemukan untuk Sesi ${assignedNum}.`);
      }

      let sStartSurah = part.startSurah;
      let sStartAyah = part.startAyah;
      let sEndSurah = part.endSurah;
      let sEndAyah = part.endAyah;
      let sStartPage = part.startPage;
      let sEndPage = part.endPage;
      let sCoveredPages = part.coveredPages;

      if (ds.customPart) {
        const cp = ds.customPart;
        const cov = computeManualJuzPartCoverage({
          juzNumber: ds.juzNumber,
          ranges: [{ startSurah: cp.startSurah, startAyah: cp.startAyah, endSurah: cp.endSurah, endAyah: cp.endAyah }]
        });
        sStartSurah = cov.startSurah;
        sStartAyah = cov.startAyah;
        sEndSurah = cov.endSurah;
        sEndAyah = cov.endAyah;
        sStartPage = cov.startPage;
        sEndPage = cov.endPage;
        sCoveredPages = cov.coveredPages;
      }

      const rangeKey = `${ds.juzNumber}:${sStartSurah}:${sStartAyah}:${sEndSurah}:${sEndAyah}`;
      if (seenRangeKeys.has(rangeKey)) {
        throw new Error(`Terdeteksi dua sesi dengan cakupan yang sama persis pada Juz ${ds.juzNumber}. Ubah rentang salah satu sesi jika ingin membagi juz.`);
      }
      seenRangeKeys.add(rangeKey);
      preparedSessions.push({
        ds,
        assignedNum,
        partId,
        sStartSurah,
        sStartAyah,
        sEndSurah,
        sEndAyah,
        sStartPage,
        sEndPage,
        sCoveredPages
      });
    }

    // 4a. If reordering existing server sessions causes session_number swap collision (e.g. S1 <-> S2),
    // temporarily park colliding existing sessions at high numbers (1000+i) before assigning final numbers.
    const existingServerNums = new Map<string, number>();
    preparedSessions.forEach(item => {
      if (item.ds.serverId && item.ds.originalSessionNumber) {
        existingServerNums.set(item.ds.serverId, item.ds.originalSessionNumber);
      }
    });
    const needsReorderPark = preparedSessions.some(item => {
      if (!item.ds.serverId || item.ds.originalSessionNumber === item.assignedNum) return false;
      for (const [otherId, otherNum] of existingServerNums.entries()) {
        if (otherId !== item.ds.serverId && otherNum === item.assignedNum) return true;
      }
      return false;
    });

    if (needsReorderPark) {
      for (let i = 0; i < preparedSessions.length; i++) {
        const item = preparedSessions[i];
        if (!item.ds.serverId) continue;
        const parkRes = await api.upsertUASManualSession(
          period.id,
          studentId,
          {
            id: item.ds.serverId,
            sessionNumber: 1000 + i,
            sessionType: item.ds.sessionType,
            primaryPartId: item.partId,
            juzNumber: item.ds.juzNumber,
            coveredPages: item.sCoveredPages,
            startSurah: item.sStartSurah,
            startAyah: item.sStartAyah,
            endSurah: item.sEndSurah,
            endAyah: item.sEndAyah,
            startPage: item.sStartPage,
            endPage: item.sEndPage
          },
          isAdmin ? 'Sesi disesuaikan oleh Admin' : activeNotes,
          user
        );
        if (!parkRes.success) {
          throw new Error(parkRes.message || 'Gagal mengatur ulang urutan sesi.');
        }
      }
    }

    // 4b. Upsert every session with its final sequential session_number and sync serverId back to local state
    const updatedServerMeta = new Map<string, { serverId: string; sessionNumber: number }>();
    for (const item of preparedSessions) {
      const sessRes = await api.upsertUASManualSession(
        period.id,
        studentId,
        {
          id: item.ds.serverId || undefined,
          sessionNumber: item.assignedNum,
          sessionType: item.ds.sessionType,
          primaryPartId: item.partId,
          juzNumber: item.ds.juzNumber,
          coveredPages: item.sCoveredPages,
          startSurah: item.sStartSurah,
          startAyah: item.sStartAyah,
          endSurah: item.sEndSurah,
          endAyah: item.sEndAyah,
          startPage: item.sStartPage,
          endPage: item.sEndPage
        },
        isAdmin ? 'Sesi disesuaikan oleh Admin' : activeNotes,
        user
      );
      if (!sessRes.success) {
        throw new Error(sessRes.message || `Gagal menyimpan Sesi ${item.assignedNum} (Juz ${item.ds.juzNumber}).`);
      }
      const resolvedId = sessRes.sessionId || item.ds.serverId;
      if (resolvedId) {
        updatedServerMeta.set(item.ds.localId, { serverId: resolvedId, sessionNumber: item.assignedNum });
      }
    }

    if (updatedServerMeta.size > 0) {
      setDraftSessions(prev =>
        prev.map(s => {
          const meta = updatedServerMeta.get(s.localId);
          return meta ? { ...s, serverId: meta.serverId, originalSessionNumber: meta.sessionNumber } : s;
        })
      );
    }

    setDeletedServerSessionIds([]);
    return Array.from(savedPartIdByJuz.values());
  };

  const handleSaveTemporary = async () => {
    if (inFlightRef.current || isLockedByAdmin) return;
    inFlightRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      await persistAllChanges();
      setIsDirty(false);
      await onSaved();
      setFeedback({ type: 'success', text: 'Draft materi dan sesi berhasil disimpan sementara.' });
    } catch (e: any) {
      setFeedback({ type: 'error', text: e?.message || 'Gagal menyimpan sementara.' });
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  const handleVerifyAndSubmit = async () => {
    if (inFlightRef.current || isLockedByAdmin) return;
    if (draftSessions.length === 0) {
      setFeedback({ type: 'error', text: 'Belum ada sesi ujian yang diatur. Tambahkan sesi di Langkah 2.' });
      return;
    }
    inFlightRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      // 1..4. Save parts -> verify parts -> save sessions atomically
      await persistAllChanges(true);

      // 5. Submit to Admin for approval
      const subRes = await api.submitUASPrepForApproval(period.id, studentId, false, undefined, user);
      if (!subRes.success) {
        throw new Error(subRes.message || 'Pengajuan ke Admin ditolak oleh server.');
      }

      setIsDirty(false);
      await onSaved(`${studentName} berhasil diverifikasi dan dikirim ke Admin.`);
      onClose();
    } catch (e: any) {
      setFeedback({ type: 'error', text: e?.message || 'Gagal mengirim pengajuan ke Admin.' });
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  const handleAdminApprove = async () => {
    if (inFlightRef.current || !isAdmin) return;
    if (draftSessions.length === 0) {
      setFeedback({ type: 'error', text: 'Belum ada sesi ujian untuk disetujui.' });
      return;
    }
    inFlightRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      if (isDirty || deletedServerSessionIds.length > 0 || submissionStatus !== 'pending_admin_approval') {
        await persistAllChanges(true);
        const subRes = await api.submitUASPrepForApproval(period.id, studentId, false, undefined, user);
        if (!subRes.success) throw new Error(subRes.message || 'Validasi pengajuan gagal.');
      }
      const res = await api.adminBulkDecideUASPrep(period.id, [studentId], 'approve', 'Disetujui Admin melalui pemeriksaan detail', user);
      if (!res.success || (res.failedCount || 0) > 0 || (res.skippedCount || 0) > 0) {
        const firstReason = res.results?.[0]?.reason || res.message || 'Persetujuan ditolak oleh validasi server.';
        throw new Error(firstReason);
      }
      setIsDirty(false);
      await onSaved(`${studentName} berhasil disetujui Admin.`);
      onClose();
    } catch (e: any) {
      setFeedback({ type: 'error', text: e?.message || 'Gagal menyetujui pengajuan.' });
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  const handleAdminReturnToTeacher = async () => {
    if (inFlightRef.current || !isAdmin) return;
    const reason = window.prompt(`Alasan mengembalikan materi ${studentName} ke Guru Halaqah (min. 5 karakter):`, 'Mohon periksa kembali cakupan hafalan dan susunan sesi.');
    if (!reason || reason.trim().length < 5) return;
    inFlightRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api.adminBulkDecideUASPrep(period.id, [studentId], 'reject', reason.trim(), user);
      if (!res.success) throw new Error(res.message || 'Gagal mengembalikan pengajuan.');
      setIsDirty(false);
      await onSaved(`Pengajuan ${studentName} dikembalikan ke Guru Halaqah.`);
      onClose();
    } catch (e: any) {
      setFeedback({ type: 'error', text: e?.message || 'Gagal mengembalikan pengajuan.' });
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  const editingSession = editingLocalId ? draftSessions.find(s => s.localId === editingLocalId) || null : null;
  const editingPart = editingSession ? effectivePartsByJuz.get(editingSession.juzNumber) || null : null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[95vh] flex flex-col overflow-hidden">
        {/* Light Header */}
        <div className="px-4 sm:px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-bold text-sm sm:text-base text-slate-900 truncate">{studentName}</h3>
            <p className="text-[11px] sm:text-xs text-slate-500 truncate">
              {studentClass} • {halaqah} • Guru: {teacherName}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        {/* 3-Step Indicator */}
        <div className="px-4 sm:px-6 py-2.5 bg-slate-50 border-b border-slate-200 grid grid-cols-3 gap-2 text-[11px] sm:text-xs">
          {[
            { num: 1 as const, label: '1. Pilih Hafalan' },
            { num: 2 as const, label: '2. Atur Sesi' },
            { num: 3 as const, label: isAdmin ? '3. Periksa & Setujui' : '3. Periksa & Kirim' }
          ].map(s => (
            <button
              key={s.num}
              type="button"
              onClick={() => {
                setFeedback(null);
                if (s.num === 2) goToStep2();
                else setStep(s.num);
              }}
              className={`py-2 px-2 rounded-xl font-bold text-center transition-colors ${
                step === s.num
                  ? 'bg-teal-700 text-white shadow-sm'
                  : step > s.num
                    ? 'bg-emerald-100 text-emerald-900'
                    : 'bg-white border border-slate-200 text-slate-500'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Scrollable Step Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 text-xs">
          {/* === LANGKAH 1: PILIH HAFALAN === */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-extrabold text-sm text-slate-900">Pilih Setoran Hafalan Semester Ini</h4>
                  <p className="text-[11px] text-slate-500">Centang setoran yang akan diujikan. Sistem menghitung juz &amp; cakupan otomatis.</p>
                </div>
                {validRecords.length > 0 && !isLockedByAdmin && (
                  <div className="flex gap-1.5">
                    <button type="button" onClick={selectAllValid} className="px-2.5 py-1.5 rounded-lg bg-teal-50 text-teal-800 font-bold border border-teal-200">
                      Pilih Semua
                    </button>
                    <button type="button" onClick={clearAllRecords} className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 font-bold">
                      Kosongkan
                    </button>
                  </div>
                )}
              </div>

              {invalidRecords.length > 0 && (
                <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold inline-flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                      Ada {invalidRecords.length} setoran tidak valid (tidak bisa dipilih).
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAnomalyDetail(v => !v)}
                      className="px-2 py-1 rounded-lg bg-white border border-amber-300 font-bold text-[11px]"
                    >
                      {showAnomalyDetail ? 'Tutup Detail' : 'Lihat Detail'}
                    </button>
                  </div>
                  {showAnomalyDetail && (
                    <div className="pt-1 space-y-1 text-[11px] text-rose-800">
                      {invalidRecords.map(({ rec, reason }) => (
                        <div key={rec.id}>• {rec.date}: {rec.surah} {rec.ayahStart}-{rec.ayahEnd} ({reason})</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Checklist of Valid Records */}
              <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-2xl bg-white">
                {validRecords.length === 0 ? (
                  <div className="p-4 text-center text-rose-600 font-semibold">
                    Belum ada setoran hafalan baru yang sah pada semester ini.
                  </div>
                ) : (
                  validRecords.map(rec => {
                    const checked = selectedRecordIds.includes(rec.id);
                    return (
                      <label
                        key={rec.id}
                        className={`flex items-center justify-between gap-3 p-3 cursor-pointer transition-colors ${
                          checked ? 'bg-teal-50/50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isLockedByAdmin}
                            onChange={() => toggleRecord(rec.id)}
                            className="w-4 h-4 accent-teal-700 rounded"
                          />
                          <span>
                            <span className="font-bold text-slate-900 block">{rec.surah} ({rec.ayahStart}–{rec.ayahEnd})</span>
                            <span className="text-[11px] text-slate-500">{rec.date}</span>
                          </span>
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">Sah</span>
                      </label>
                    );
                  })
                )}
              </div>

              {/* Live Auto-Detected Material Preview */}
              <div className="space-y-2">
                <div className="font-bold text-slate-700">Ringkasan Materi Terpilih ({effectivePartsList.length} Juz):</div>
                {effectivePartsList.length === 0 ? (
                  <p className="text-slate-400 italic">Pilih setoran di atas untuk melihat cakupan materi.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {effectivePartsList.map(pt => {
                      const pct = Math.round(pt.coverageRatio * 100);
                      const effPages = formatEffectivePages(pt.coverageRatio, pt.juzTotalPages);
                      return (
                        <div key={pt.juzNumber} className="p-3 rounded-2xl border border-teal-200 bg-teal-50/40 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-sm text-teal-950">Juz {pt.juzNumber}</span>
                            <span className="px-2 py-0.5 rounded-lg bg-white border border-teal-200 font-bold text-[10px] text-teal-800">
                              {pt.partType === 'full_juz' && !pt.hasGap
                                ? '1 Juz Penuh (9 Soal)'
                                : pt.coverageRatio >= 0.5
                                  ? 'Parsial (4 Soal)'
                                  : 'Tambahan (< ½ Juz)'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-700">
                            {pt.startSurahName}:{pt.startAyah} – {pt.endSurahName}:{pt.endAyah}
                          </div>
                          <div className="text-[11px] font-bold text-teal-800">
                            Cakupan: {pct}% ({effPages} / {pt.juzTotalPages} hal)
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* === LANGKAH 2: ATUR SESI === */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h4 className="font-extrabold text-sm text-slate-900">Susunan Sesi Ujian</h4>
                <p className="text-[11px] text-slate-500">Tambah, ubah, atau hapus sesi sesuai hafalan santri. Nomor sesi diatur otomatis.</p>
              </div>

              {draftSessions.length === 0 ? (
                <div className="p-5 rounded-2xl border border-dashed border-slate-300 text-center space-y-2">
                  <p className="font-semibold text-slate-700">Belum ada sesi ujian.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {draftSessions.map((sess, idx) => {
                    const part = effectivePartsByJuz.get(sess.juzNumber);
                    const locked = Boolean(sess.hasAttempt || sess.hasQuestionSet || sess.isLocked || isLockedByAdmin);
                    const startName = sess.customPart
                      ? `${quranService.getSurah(sess.customPart.startSurah)?.name || `Surah ${sess.customPart.startSurah}`}:${sess.customPart.startAyah}`
                      : part ? `${part.startSurahName}:${part.startAyah}` : '';
                    const endName = sess.customPart
                      ? `${quranService.getSurah(sess.customPart.endSurah)?.name || `Surah ${sess.customPart.endSurah}`}:${sess.customPart.endAyah}`
                      : part ? `${part.endSurahName}:${part.endAyah}` : '';
                    return (
                      <div key={sess.localId} className="p-4 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-extrabold text-sm sm:text-base text-slate-900">
                              Sesi {idx + 1} — Juz {sess.juzNumber}
                            </div>
                            <div className="text-xs font-semibold text-slate-600 mt-0.5">
                              {sess.sessionType === 'full_juz' ? 'Juz Penuh — 9 Soal' : 'Parsial — 4 Soal'}
                            </div>
                            {startName && endName && (
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {startName} s.d. {endName}
                              </div>
                            )}
                          </div>
                          {!locked ? (
                            <div className="flex items-center gap-1.5 shrink-0">
                              {draftSessions.length > 1 && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    onClick={() => moveSession(idx, -1)}
                                    title="Naikkan urutan sesi"
                                    aria-label={`Naikkan Sesi ${idx + 1}`}
                                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-30"
                                  >
                                    <ArrowUp size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={idx === draftSessions.length - 1}
                                    onClick={() => moveSession(idx, 1)}
                                    title="Turunkan urutan sesi"
                                    aria-label={`Turunkan Sesi ${idx + 1}`}
                                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-30"
                                  >
                                    <ArrowDown size={13} />
                                  </button>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => openDetailEditor(sess)}
                                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs inline-flex items-center gap-1"
                              >
                                <Sliders size={13} /> Ubah
                              </button>
                              <button
                                type="button"
                                onClick={() => removeSession(sess, idx)}
                                className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs inline-flex items-center gap-1"
                              >
                                <Trash2 size={13} /> Hapus
                              </button>
                            </div>
                          ) : (
                            (sess.hasAttempt || sess.hasQuestionSet || sess.isLocked) && (
                              <div className="w-full text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-1">
                                Sesi ini sudah memiliki soal atau riwayat ujian. Hubungi Admin untuk melakukan perubahan.
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ALWAYS-VISIBLE Add Session Control (supports any Juz 1-30 & manual session creation!) */}
              {!isLockedByAdmin && (
                <div>
                  {!addingSessionPicker ? (
                    <button
                      type="button"
                      onClick={() => setAddingSessionPicker(true)}
                      className="w-full py-3 rounded-2xl border-2 border-dashed border-teal-400 bg-teal-50/50 hover:bg-teal-50 text-teal-900 font-extrabold text-xs inline-flex items-center justify-center gap-1.5"
                    >
                      <Plus size={16} /> Tambah Sesi
                    </button>
                  ) : (
                    <div className="p-4 rounded-2xl border-2 border-teal-300 bg-teal-50/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-teal-950">Tambah Sesi Ujian Baru</span>
                        <button type="button" onClick={() => setAddingSessionPicker(false)} className="text-slate-500 font-bold">Batal</button>
                      </div>

                      {unallocatedEligibleParts.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-bold text-slate-600">Pilihan Cepat dari Catatan Setoran:</div>
                          <div className="flex flex-wrap gap-2">
                            {unallocatedEligibleParts.map(p => (
                              <button
                                key={p.juzNumber}
                                type="button"
                                onClick={() => addSessionForJuz(p.juzNumber)}
                                className="px-3 py-2 rounded-xl bg-white hover:bg-teal-700 hover:text-white border border-teal-300 font-bold text-teal-900 transition-colors"
                              >
                                + Juz {p.juzNumber}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="pt-2 border-t border-teal-200/70 space-y-2.5">
                        <div className="text-[11px] font-bold text-slate-700">Atau Pilih Juz Secara Manual (Juz 1–30):</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <select
                            aria-label="Pilih Juz Manual"
                            value={newJuzNum}
                            onChange={e => setNewJuzNum(Number(e.target.value))}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                          >
                            {Array.from({ length: 30 }, (_, i) => 30 - i).map(j => (
                              <option key={j} value={j}>
                                Juz {j}{allocatedJuzSet.has(j) ? ' (Bagi rentang baru)' : ''}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="Pilih Jenis Sesi Manual"
                            value={newSessionType}
                            onChange={e => setNewSessionType(e.target.value as 'full_juz' | 'partial_half')}
                            className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-800"
                          >
                            <option value="full_juz">1 Juz Penuh — 9 Soal</option>
                            <option value="partial_half">Parsial — 4 Soal</option>
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => addSessionForJuz(newJuzNum, newSessionType)}
                          className="w-full py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5"
                        >
                          <Plus size={14} /> Tambahkan Sesi Juz {newJuzNum}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Manual Session Editor ("Ubah") */}
              {editingSession && editingSession.customPart && (
                <div className="p-4 rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-indigo-950 inline-flex items-center gap-1.5">
                      <Edit3 size={14} /> Ubah Detail — Juz {editingSession.juzNumber}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingLocalId(null)}
                      className="px-2.5 py-1 rounded-lg bg-white border border-indigo-200 font-bold text-indigo-800"
                    >
                      Selesai
                    </button>
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 block mb-1">Jenis Ujian</label>
                    <select
                      aria-label="Jenis Ujian Sesi"
                      value={editingSession.sessionType}
                      onChange={e => {
                        const nextType = e.target.value as 'full_juz' | 'partial_half';
                        const b = JUZ_AYAH_BOUNDARIES[editingSession.juzNumber] || { startSurah: 78, startAyah: 1, endSurah: 114, endAyah: 6 };
                        updateEditingSession(s => ({
                          ...s,
                          sessionType: nextType,
                          customPart: nextType === 'full_juz'
                            ? { ...s.customPart!, startSurah: b.startSurah, startAyah: b.startAyah, endSurah: b.endSurah, endAyah: b.endAyah, hasExtraSeg: false }
                            : s.customPart
                        }));
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold"
                    >
                      <option value="full_juz">1 Juz Penuh — 9 Soal</option>
                      <option value="partial_half">Setengah Juz / Parsial — 4 Soal</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="col-span-2">
                        <label className="font-bold text-slate-700 block mb-1">Surah Awal</label>
                        <select
                          value={editingSession.customPart.startSurah}
                          onChange={e => updateEditingSession(s => ({ ...s, customPart: { ...s.customPart!, startSurah: Number(e.target.value) } }))}
                          className="w-full px-2 py-2 rounded-xl border border-slate-200 bg-white"
                        >
                          {Object.keys(SURAH_TOTAL_AYAHS).map(num => (
                            <option key={num} value={num}>{num}. {quranService.getSurah(Number(num))?.name || `Surah ${num}`}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Ayat</label>
                        <input
                          type="number"
                          min={1}
                          max={SURAH_TOTAL_AYAHS[editingSession.customPart.startSurah] || 286}
                          value={editingSession.customPart.startAyah}
                          onChange={e => updateEditingSession(s => ({ ...s, customPart: { ...s.customPart!, startAyah: Math.max(1, Number(e.target.value) || 1) } }))}
                          className="w-full px-2 py-2 rounded-xl border border-slate-200 bg-white"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="col-span-2">
                        <label className="font-bold text-slate-700 block mb-1">Surah Akhir</label>
                        <select
                          value={editingSession.customPart.endSurah}
                          onChange={e => updateEditingSession(s => ({ ...s, customPart: { ...s.customPart!, endSurah: Number(e.target.value) } }))}
                          className="w-full px-2 py-2 rounded-xl border border-slate-200 bg-white"
                        >
                          {Object.keys(SURAH_TOTAL_AYAHS).map(num => (
                            <option key={num} value={num}>{num}. {quranService.getSurah(Number(num))?.name || `Surah ${num}`}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Ayat</label>
                        <input
                          type="number"
                          min={1}
                          max={SURAH_TOTAL_AYAHS[editingSession.customPart.endSurah] || 286}
                          value={editingSession.customPart.endAyah}
                          onChange={e => updateEditingSession(s => ({ ...s, customPart: { ...s.customPart!, endAyah: Math.max(1, Number(e.target.value) || 1) } }))}
                          className="w-full px-2 py-2 rounded-xl border border-slate-200 bg-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === LANGKAH 3: PERIKSA & KIRIM / SETUJUI === */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h4 className="font-extrabold text-sm text-slate-900">Ringkasan Pengajuan UAS</h4>
                <p className="text-[11px] text-slate-500">
                  {isAdmin ? 'Periksa materi dan sesi santri sebelum menyetujui atau mengembalikan ke guru.' : 'Periksa kembali sebelum mengirim ke Admin untuk persetujuan.'}
                </p>
              </div>

              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-slate-500">Nama Santri</span>
                  <span className="font-bold text-slate-900">{studentName} ({studentClass})</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-slate-500">Total Sesi Ujian</span>
                  <span className="font-bold text-teal-800">{draftSessions.length} Sesi</span>
                </div>
                <div className="space-y-2">
                  <span className="text-slate-500 font-semibold block">Rincian Sesi:</span>
                  {draftSessions.length === 0 ? (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                      Belum ada sesi ujian. Kembali ke Langkah 2 untuk menambahkan sesi.
                    </div>
                  ) : (
                    draftSessions.map((s, idx) => {
                      const pt = effectivePartsByJuz.get(s.juzNumber);
                      return (
                        <div key={s.localId} className="p-3 rounded-xl bg-white border border-slate-200 flex items-center justify-between gap-2">
                          <div>
                            <div className="font-bold text-slate-900">Sesi {idx + 1} • Juz {s.juzNumber}</div>
                            {pt && (
                              <div className="text-[11px] text-slate-500">
                                {pt.startSurahName}:{pt.startAyah} s.d. {pt.endSurahName}:{pt.endAyah}
                              </div>
                            )}
                          </div>
                          <span className="px-2 py-1 rounded-lg bg-teal-50 text-teal-800 font-bold text-[11px] shrink-0">
                            {s.sessionType === 'full_juz' ? '1 Juz Penuh — 9 Soal' : 'Parsial — 4 Soal'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Clean Difference Notice + Guru Manual Confirmation (NEVER blocks Guru!) */}
              {hasDifference && (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-amber-950 inline-flex items-center gap-1.5">
                      <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                      Catatan setoran aplikasi berbeda dengan materi yang ditetapkan guru.
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowDiffDetail(v => !v)}
                      className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 font-bold text-[11px] text-amber-900"
                    >
                      {showDiffDetail ? 'Tutup Perbedaan' : 'Lihat Perbedaan'}
                    </button>
                  </div>

                  {showDiffDetail && (
                    <div className="p-3 rounded-xl bg-white border border-amber-200 space-y-1.5 text-[11px]">
                      {materialDifferences.map(d => (
                        <div key={d.juzNumber} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-b border-slate-100 last:border-0 pb-1 last:pb-0">
                          <span className="font-bold text-slate-800">Juz {d.juzNumber}</span>
                          <span className="text-slate-500">Catatan aplikasi: <strong>{d.appLabel}</strong></span>
                          <span className="text-teal-800">Penetapan guru: <strong>{d.teacherLabel}</strong></span>
                        </div>
                      ))}
                      {invalidRecords.length > 0 && (
                        <div className="text-amber-800 pt-1">
                          • Terdapat {invalidRecords.length} catatan setoran aplikasi dengan format ayat belum rapi (tidak menghalangi penetapan manual guru).
                        </div>
                      )}
                    </div>
                  )}

                  {!isLockedByAdmin && (
                    <div className="pt-1">
                      <label className="flex items-start gap-2.5 cursor-pointer bg-white p-3 rounded-xl border border-amber-200">
                        <input
                          type="checkbox"
                          checked={manualConfirmation}
                          onChange={e => {
                            setManualConfirmation(e.target.checked);
                            setIsDirty(true);
                          }}
                          className="w-4 h-4 mt-0.5 accent-teal-700 rounded shrink-0"
                        />
                        <span className="text-xs text-slate-800">
                          <strong className="block text-teal-950">Tetapkan Sesuai Pemeriksaan Guru</strong>
                          <span className="text-[11px] text-slate-500">
                            Saya menyatakan materi dan sesi di atas sudah diperiksa dan sesuai hafalan santri yang sebenarnya.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Feedback Banner (always visible above footer) */}
        {feedback && (
          <div className="px-4 sm:px-6 py-2.5 border-t border-slate-100 bg-white text-xs">
            <div className={`p-2.5 rounded-xl font-semibold border ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              {feedback.text}
            </div>
          </div>
        )}

        {/* Footer Controls */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => { setFeedback(null); setStep((step - 1) as 1 | 2); }}
                className="px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold text-xs inline-flex items-center gap-1"
              >
                <ArrowLeft size={14} /> Kembali
              </button>
            )}
            {!isLockedByAdmin && (
              <button
                type="button"
                disabled={busy || effectivePartsList.length === 0}
                onClick={handleSaveTemporary}
                className="px-3.5 py-2.5 rounded-xl bg-white border border-teal-300 text-teal-800 font-bold text-xs inline-flex items-center gap-1 disabled:opacity-40"
              >
                <Save size={14} /> Simpan Sementara
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step === 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={goToStep2}
                className="px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs inline-flex items-center gap-1.5"
              >
                Lanjut <ArrowRight size={14} />
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => { setFeedback(null); setStep(3); }}
                className="px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs inline-flex items-center gap-1.5"
              >
                Lanjut <ArrowRight size={14} />
              </button>
            )}
            {step === 3 && !isLockedByAdmin && !isAdmin && (
              <button
                type="button"
                disabled={busy || draftSessions.length === 0}
                onClick={handleVerifyAndSubmit}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
              >
                {busy ? <CheckCircle2 size={14} className="animate-pulse" /> : <Send size={14} />}
                {busy ? 'Memproses...' : 'Periksa & Kirim ke Admin'}
              </button>
            )}
            {step === 3 && isAdmin && (
              <>
                {submissionStatus === 'pending_admin_approval' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleAdminReturnToTeacher}
                    className="px-3.5 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs disabled:opacity-40"
                  >
                    Kembalikan ke Guru
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy || draftSessions.length === 0}
                  onClick={handleAdminApprove}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs inline-flex items-center gap-1.5 disabled:opacity-40"
                >
                  <CheckCircle2 size={14} /> {busy ? 'Memproses...' : 'Setujui Pengajuan'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
