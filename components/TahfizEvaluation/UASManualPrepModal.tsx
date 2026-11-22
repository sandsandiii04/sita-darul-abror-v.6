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
  JUZ_AYAH_BOUNDARIES
} from '../../services/uasJuzSegmentationService';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
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
  submissionStatus?: string;
  user: User;
  onSaved: (msgText?: string) => Promise<void>;
}

interface DraftSessionItem {
  localId: string;
  serverId?: string;
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

const DEFAULT_MANUAL_REASON = 'Pengaturan materi manual Guru Halaqah';
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
  submissionStatus,
  user,
  onSaved
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const isLockedByAdmin = submissionStatus === 'admin_approved' && user.role !== 'admin';

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

  // Step 2 state: working list of sessions (auto-numbered by index + 1)
  const [draftSessions, setDraftSessions] = useState<DraftSessionItem[]>(() => {
    if (sessions.length > 0) {
      return [...sessions]
        .sort((a, b) => a.sessionNumber - b.sessionNumber)
        .map(s => ({
          localId: s.id,
          serverId: s.id,
          juzNumber: s.juzNumber,
          sessionType: s.sessionType,
          source: s.source || 'auto',
          isLocked: s.isLocked,
          hasAttempt: Boolean(s.attemptId),
          hasQuestionSet: Boolean(s.questionSetId)
        }));
    }
    return [];
  });

  // Track deleted server session IDs (only manual unlocked draft sessions)
  const [deletedServerSessionIds, setDeletedServerSessionIds] = useState<string[]>([]);

  // Advanced editor ("Ubah Detail") for a specific session
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [addingSessionPicker, setAddingSessionPicker] = useState<boolean>(false);

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

  // Build effective Juz parts map (merges computed parts + any server parts + customPart overrides)
  const effectivePartsByJuz = useMemo(() => {
    const map = new Map<number, ExamMaterialPart>();
    serverParts.forEach(p => {
      if (p.status !== 'excluded') map.set(p.juzNumber, p);
    });
    computedAnalysis.parts.forEach(p => {
      map.set(p.juzNumber, p);
    });
    // Apply any custom manual range overrides from draftSessions
    draftSessions.forEach(ds => {
      if (!ds.customPart) return;
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
      const prev = map.get(ds.juzNumber);
      map.set(ds.juzNumber, {
        id: prev?.id || `emp_${period.id}_${studentId}_j${ds.juzNumber}`,
        examPeriodId: period.id,
        studentId,
        snapshotId: prev?.snapshotId || null,
        partOrder: prev?.partOrder || map.size + 1,
        juzNumber: ds.juzNumber,
        partType: cov.partType,
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
        coverageRatio: cov.coverageRatio,
        segments: cov.segments,
        hasGap: cov.hasGap,
        status: cov.hasGap ? 'needs_review' : cov.coverageRatio >= 0.5 ? 'ready' : 'needs_admin_decision',
        teacherStatus: 'draft_manual'
      });
    });
    return map;
  }, [serverParts, computedAnalysis.parts, draftSessions, period.id, studentId]);

  const effectivePartsList = useMemo(
    () => Array.from(effectivePartsByJuz.values()).sort((a, b) => a.juzNumber - b.juzNumber),
    [effectivePartsByJuz]
  );

  // Juzes eligible for a NEW session (coverage >= 50% AND not already allocated to an existing session!)
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

  // Auto-populate initial sessions when moving from Step 1 -> Step 2 if no sessions exist yet
  const goToStep2 = () => {
    setFeedback(null);
    if (selectedRecordIds.length === 0 && effectivePartsList.length === 0) {
      setFeedback({ type: 'error', text: 'Pilih minimal satu setoran hafalan yang sah terlebih dahulu.' });
      return;
    }
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

  const addSessionForJuz = (juzNum: number) => {
    // Anti-duplication guard: if already exists, open Edit instead of duplicating!
    const existing = draftSessions.find(s => s.juzNumber === juzNum);
    if (existing) {
      setAddingSessionPicker(false);
      setEditingLocalId(existing.localId);
      setFeedback({ type: 'error', text: `Juz ${juzNum} sudah ada di daftar sesi. Dialihkan ke mode Ubah Detail.` });
      return;
    }
    const part = effectivePartsByJuz.get(juzNum);
    if (!part || part.coverageRatio < 0.5) {
      setFeedback({ type: 'error', text: `Cakupan Juz ${juzNum} kurang dari 50%, belum bisa dibuat sesi tersendiri.` });
      return;
    }
    setDraftSessions(prev => [
      ...prev,
      {
        localId: `new_j${juzNum}_${Date.now()}`,
        juzNumber: juzNum,
        sessionType: part.partType === 'full_juz' && !part.hasGap ? 'full_juz' : 'partial_half',
        source: 'manual'
      }
    ]);
    setAddingSessionPicker(false);
    setIsDirty(true);
    setFeedback({ type: 'success', text: `Sesi baru untuk Juz ${juzNum} ditambahkan.` });
  };

  const removeSession = (item: DraftSessionItem) => {
    if (item.hasAttempt || item.hasQuestionSet || item.isLocked) {
      setFeedback({ type: 'error', text: 'Sesi yang sudah terkunci atau memiliki paket/nilai ujian tidak dapat dihapus.' });
      return;
    }
    if (item.serverId && item.source === 'manual') {
      setDeletedServerSessionIds(prev => (prev.includes(item.serverId!) ? prev : [...prev, item.serverId!]));
    }
    setDraftSessions(prev => prev.filter(s => s.localId !== item.localId));
    if (editingLocalId === item.localId) setEditingLocalId(null);
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
      throw new Error('Belum ada materi hafalan sah yang dipilih.');
    }

    // 1. Delete removed manual draft sessions first (frees session_number / primary_part_id)
    for (const delId of deletedServerSessionIds) {
      const delRes = await api.deleteUASManualSession(delId, DEFAULT_DELETE_REASON, user);
      if (!delRes.success) {
        throw new Error(delRes.message || 'Gagal menghapus sesi draft lama.');
      }
    }

    // 2. Upsert every active Juz part
    const savedPartIdByJuz = new Map<number, string>();
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
          hasGap: pt.hasGap,
          referencedRecordIds: selectedRecordIds
        },
        DEFAULT_MANUAL_REASON,
        user
      );
      if (!res.success) {
        throw new Error(res.message || `Gagal menyimpan materi Juz ${pt.juzNumber}.`);
      }
      savedPartIdByJuz.set(pt.juzNumber, res.partId || pt.id);
    }

    // 3. If submitting, verify all saved parts BEFORE upserting sessions
    if (verifyBeforeSessions) {
      for (const partId of savedPartIdByJuz.values()) {
        const vRes = await api.verifyOrFinalizeUASMaterialPart(partId, 'verify', DEFAULT_VERIFY_REASON, user);
        if (!vRes.success) {
          throw new Error(vRes.message || 'Verifikasi materi gagal di server.');
        }
      }
    }

    // 4. Upsert every session with clean automatic sequential numbering (1, 2, 3...)
    const seenJuz = new Set<number>();
    for (let i = 0; i < draftSessions.length; i++) {
      const ds = draftSessions[i];
      if (seenJuz.has(ds.juzNumber)) {
        throw new Error(`Terdeteksi duplikasi sesi pada Juz ${ds.juzNumber}.`);
      }
      seenJuz.add(ds.juzNumber);
      if (ds.hasAttempt || ds.hasQuestionSet || ds.isLocked) continue;

      const part = effectivePartsByJuz.get(ds.juzNumber);
      const partId = savedPartIdByJuz.get(ds.juzNumber) || part?.id;
      if (!part || !partId) {
        throw new Error(`Materi Juz ${ds.juzNumber} tidak ditemukan untuk Sesi ${i + 1}.`);
      }
      const sessRes = await api.upsertUASManualSession(
        period.id,
        studentId,
        {
          id: ds.serverId || undefined,
          sessionNumber: i + 1,
          sessionType: ds.sessionType,
          primaryPartId: partId,
          juzNumber: ds.juzNumber,
          coveredPages: part.coveredPages,
          startSurah: part.startSurah,
          startAyah: part.startAyah,
          endSurah: part.endSurah,
          endAyah: part.endAyah,
          startPage: part.startPage,
          endPage: part.endPage
        },
        DEFAULT_SESSION_REASON,
        user
      );
      if (!sessRes.success) {
        throw new Error(sessRes.message || `Gagal menyimpan Sesi ${i + 1} (Juz ${ds.juzNumber}).`);
      }
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

  const editingSession = editingLocalId ? draftSessions.find(s => s.localId === editingLocalId) || null : null;
  const editingPart = editingSession ? effectivePartsByJuz.get(editingSession.juzNumber) || null : null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[95vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 bg-gradient-to-r from-teal-900 to-emerald-900 text-white flex items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-sm sm:text-base">{studentName}</h3>
            <p className="text-[11px] sm:text-xs text-emerald-100">
              {studentClass} • {halaqah} • Guru: {teacherName}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
            className="p-2 rounded-xl hover:bg-white/10"
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
            { num: 3 as const, label: '3. Periksa & Kirim' }
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
                <p className="text-[11px] text-slate-500">Nomor sesi dan jumlah soal diatur otomatis oleh sistem.</p>
              </div>

              {draftSessions.length === 0 ? (
                <div className="p-5 rounded-2xl border border-dashed border-slate-300 text-center space-y-2">
                  <p className="font-semibold text-slate-600">Belum ada sesi ujian yang ditambahkan.</p>
                  <p className="text-[11px] text-slate-500">Pastikan santri memiliki minimal ½ juz (50%) pada Langkah 1.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {draftSessions.map((sess, idx) => {
                    const part = effectivePartsByJuz.get(sess.juzNumber);
                    const pct = part ? Math.round(part.coverageRatio * 100) : 0;
                    const effPages = part ? formatEffectivePages(part.coverageRatio, part.juzTotalPages) : '0';
                    const locked = Boolean(sess.hasAttempt || sess.hasQuestionSet || sess.isLocked || isLockedByAdmin);
                    return (
                      <div key={sess.localId} className="p-4 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-[11px] font-bold text-teal-700 uppercase">Sesi {idx + 1}</div>
                            <div className="font-extrabold text-base text-slate-900">Juz {sess.juzNumber}</div>
                            <div className="text-xs font-semibold text-slate-600 mt-0.5">
                              {sess.sessionType === 'full_juz' ? '1 Juz Penuh — 9 Soal' : 'Parsial — 4 Soal'}
                              {part && <span className="text-slate-400"> • {pct}% ({effPages}/{part.juzTotalPages} hal)</span>}
                            </div>
                          </div>
                          {!locked && (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openDetailEditor(sess)}
                                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs inline-flex items-center gap-1"
                              >
                                <Sliders size={13} /> Ubah Detail
                              </button>
                              <button
                                type="button"
                                onClick={() => removeSession(sess)}
                                className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200"
                                aria-label="Hapus Sesi"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add Session Control (only shows unallocated eligible Juzes — prevents duplication!) */}
              {!isLockedByAdmin && (
                <div>
                  {unallocatedEligibleParts.length > 0 ? (
                    !addingSessionPicker ? (
                      <button
                        type="button"
                        onClick={() => setAddingSessionPicker(true)}
                        className="w-full py-3 rounded-2xl border-2 border-dashed border-teal-300 bg-teal-50/40 hover:bg-teal-50 text-teal-800 font-bold text-xs inline-flex items-center justify-center gap-1.5"
                      >
                        <Plus size={15} /> Tambah Sesi ({unallocatedEligibleParts.length} Juz Tersedia)
                      </button>
                    ) : (
                      <div className="p-3.5 rounded-2xl border border-teal-300 bg-teal-50/50 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-teal-950">Pilih Juz untuk Sesi Baru:</span>
                          <button type="button" onClick={() => setAddingSessionPicker(false)} className="text-slate-500 font-bold">Batal</button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {unallocatedEligibleParts.map(p => (
                            <button
                              key={p.juzNumber}
                              type="button"
                              onClick={() => addSessionForJuz(p.juzNumber)}
                              className="px-3 py-2 rounded-xl bg-white hover:bg-teal-700 hover:text-white border border-teal-300 font-bold text-teal-900 transition-colors"
                            >
                              + Juz {p.juzNumber} ({Math.round(p.coverageRatio * 100)}%)
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 text-center">
                      Semua juz yang memenuhi syarat sudah memiliki sesi. Gunakan tombol <strong>Ubah Detail</strong> untuk menyesuaikan sesi yang ada.
                    </div>
                  )}
                </div>
              )}

              {/* Advanced Manual Range Editor ("Ubah Detail") */}
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

                  <div>
                    <label className="font-bold text-slate-700 block mb-1">Jenis Ujian</label>
                    <select
                      value={editingSession.sessionType}
                      onChange={e => updateEditingSession(s => ({ ...s, sessionType: e.target.value as 'full_juz' | 'partial_half' }))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold"
                    >
                      <option value="full_juz" disabled={!editingPart || editingPart.partType !== 'full_juz' || editingPart.hasGap}>
                        1 Juz Penuh — 9 Soal {(!editingPart || editingPart.partType !== 'full_juz' || editingPart.hasGap) ? '(Wajib 100%)' : ''}
                      </option>
                      <option value="partial_half">Setengah Juz / Parsial — 4 Soal</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === LANGKAH 3: PERIKSA & KIRIM === */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h4 className="font-extrabold text-sm text-slate-900">Ringkasan Pengajuan UAS</h4>
                <p className="text-[11px] text-slate-500">Periksa kembali sebelum mengirim ke Admin untuk persetujuan.</p>
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
                      const pct = pt ? Math.round(pt.coverageRatio * 100) : 0;
                      const effPages = pt ? formatEffectivePages(pt.coverageRatio, pt.juzTotalPages) : '0';
                      return (
                        <div key={s.localId} className="p-3 rounded-xl bg-white border border-slate-200 flex items-center justify-between gap-2">
                          <div>
                            <div className="font-bold text-slate-900">Sesi {idx + 1} • Juz {s.juzNumber}</div>
                            {pt && (
                              <div className="text-[11px] text-slate-500">
                                {pt.startSurahName}:{pt.startAyah} – {pt.endSurahName}:{pt.endAyah} ({pct}% • {effPages}/{pt.juzTotalPages} hal)
                              </div>
                            )}
                          </div>
                          <span className="px-2 py-1 rounded-lg bg-teal-50 text-teal-800 font-bold text-[11px] shrink-0">
                            {s.sessionType === 'full_juz' ? '9 Soal' : '4 Soal'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {invalidRecords.length > 0 && (
                <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                  Perhatian: Masih ada {invalidRecords.length} catatan setoran dengan ayat tidak valid di data santri. Perbaiki di menu Ziyadah sebelum mengirim ke Admin.
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
            {step === 3 && !isLockedByAdmin && (
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
          </div>
        </div>
      </div>
    </div>
  );
};
