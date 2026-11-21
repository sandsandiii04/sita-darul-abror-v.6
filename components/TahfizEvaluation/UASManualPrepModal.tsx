import React, { useMemo, useState } from 'react';
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
import { computeManualJuzPartCoverage, JUZ_AYAH_BOUNDARIES } from '../../services/uasJuzSegmentationService';
import { BookOpen, CheckCircle2, Edit3, Plus, Send, Sparkles, Trash2, X } from 'lucide-react';

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
  suggestedParts,
  sessions,
  submissionStatus,
  user,
  onSaved
}) => {
  const initialPart = serverParts[0] || suggestedParts[0];
  const initJuz = initialPart?.juzNumber || 30;
  const initBound = JUZ_AYAH_BOUNDARIES[initJuz] || { startSurah: 78, startAyah: 1, endSurah: 114, endAyah: 6 };

  const [juzNumber, setJuzNumber] = useState<number>(initJuz);
  const [startSurah, setStartSurah] = useState<number>(initialPart?.startSurah || initBound.startSurah);
  const [startAyah, setStartAyah] = useState<number>(initialPart?.startAyah || initBound.startAyah);
  const [endSurah, setEndSurah] = useState<number>(initialPart?.endSurah || initBound.endSurah);
  const [endAyah, setEndAyah] = useState<number>(initialPart?.endAyah || initBound.endAyah);

  const [hasExtraSeg, setHasExtraSeg] = useState<boolean>(false);
  const [extraStartSurah, setExtraStartSurah] = useState<number>(initBound.startSurah);
  const [extraStartAyah, setExtraStartAyah] = useState<number>(1);
  const [extraEndSurah, setExtraEndSurah] = useState<number>(initBound.startSurah);
  const [extraEndAyah, setExtraEndAyah] = useState<number>(10);

  const [sessionType, setSessionType] = useState<'full_juz' | 'partial_half'>(
    initialPart?.partType === 'full_juz' ? 'full_juz' : 'partial_half'
  );
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionNumber, setSessionNumber] = useState<number>(sessions.length + 1);
  const [notes, setNotes] = useState<string>(initialPart?.verificationNotes || initialPart?.reviewReason || '');
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  const relevantRecords = useMemo(() => {
    return materialDetectionService.filterRelevantRecords(
      records,
      studentId,
      term.startDate,
      period.materialCutoffDate
    );
  }, [records, studentId, term.startDate, period.materialCutoffDate]);

  const liveCoverage = useMemo(() => {
    const ranges = [{ startSurah, startAyah, endSurah, endAyah }];
    if (hasExtraSeg) {
      ranges.push({
        startSurah: extraStartSurah,
        startAyah: extraStartAyah,
        endSurah: extraEndSurah,
        endAyah: extraEndAyah
      });
    }
    return computeManualJuzPartCoverage({ juzNumber, ranges });
  }, [juzNumber, startSurah, startAyah, endSurah, endAyah, hasExtraSeg, extraStartSurah, extraStartAyah, extraEndSurah, extraEndAyah]);

  if (!isOpen) return null;

  const isLockedByAdmin = submissionStatus === 'admin_approved' && user.role !== 'admin';
  const currentPartId = `emp_${period.id}_${studentId}_j${juzNumber}`;
  const existingServerPart = serverParts.find(p => p.id === currentPartId || p.juzNumber === juzNumber);

  const handleJuzChange = (newJuz: number) => {
    setJuzNumber(newJuz);
    const existing = serverParts.find(p => p.juzNumber === newJuz) || suggestedParts.find(p => p.juzNumber === newJuz);
    const b = JUZ_AYAH_BOUNDARIES[newJuz] || { startSurah: 1, startAyah: 1, endSurah: 1, endAyah: 7 };
    setStartSurah(existing?.startSurah || b.startSurah);
    setStartAyah(existing?.startAyah || b.startAyah);
    setEndSurah(existing?.endSurah || b.endSurah);
    setEndAyah(existing?.endAyah || b.endAyah);
    setExtraStartSurah(b.startSurah);
    setExtraEndSurah(b.startSurah);
    setSessionType(existing?.partType === 'full_juz' ? 'full_juz' : 'partial_half');
  };

  const applySuggestion = (part: ExamMaterialPart) => {
    setJuzNumber(part.juzNumber);
    setStartSurah(part.startSurah);
    setStartAyah(part.startAyah);
    setEndSurah(part.endSurah);
    setEndAyah(part.endAyah);
    setSessionType(part.partType === 'full_juz' ? 'full_juz' : 'partial_half');
    setLocalSuccess(`Sugesti Juz ${part.juzNumber} dimuat ke form. Silakan periksa & simpan manual.`);
    setLocalError(null);
  };

  const buildPartPayload = () => ({
    id: existingServerPart?.id || currentPartId,
    partOrder: serverParts.length + 1,
    juzNumber,
    partType: liveCoverage.partType,
    startSurah: liveCoverage.startSurah,
    startAyah: liveCoverage.startAyah,
    endSurah: liveCoverage.endSurah,
    endAyah: liveCoverage.endAyah,
    startPage: liveCoverage.startPage,
    endPage: liveCoverage.endPage,
    coveredPages: liveCoverage.coveredPages,
    coveredPagesCount: liveCoverage.coveredPagesCount,
    juzTotalPages: liveCoverage.juzTotalPages,
    coverageRatio: liveCoverage.coverageRatio,
    segments: liveCoverage.segments,
    hasGap: liveCoverage.hasGap,
    referencedRecordIds: selectedRecordIds
  });

  const handleSaveDraft = async (): Promise<string | null> => {
    setLocalError(null);
    setLocalSuccess(null);
    if (liveCoverage.coveredPagesCount === 0) {
      setLocalError('Rentang surah/ayat tidak menghasilkan cakupan halaman pada Juz ini.');
      return null;
    }
    setBusy(true);
    try {
      const res = await api.upsertUASManualPart(
        period.id,
        studentId,
        buildPartPayload(),
        notes.trim() || 'Pengaturan materi manual Guru Halaqah',
        user
      );
      if (!res.success) {
        setLocalError(res.message || 'Gagal menyimpan draft materi manual.');
        return null;
      }
      setLocalSuccess(`Draft materi Juz ${juzNumber} berhasil disimpan.`);
      await onSaved();
      return res.partId || currentPartId;
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSession = async () => {
    setLocalError(null);
    setLocalSuccess(null);
    if (notes.trim().length < 5) {
      setLocalError('Catatan Guru Halaqah wajib diisi minimal 5 karakter sebelum menambah/mengubah sesi.');
      return;
    }
    const partId = existingServerPart?.id || (await handleSaveDraft());
    if (!partId) return;

    setBusy(true);
    try {
      const res = await api.upsertUASManualSession(
        period.id,
        studentId,
        {
          id: editingSessionId || undefined,
          sessionNumber,
          sessionType,
          primaryPartId: partId,
          juzNumber,
          coveredPages: liveCoverage.coveredPages,
          startSurah: liveCoverage.startSurah,
          startAyah: liveCoverage.startAyah,
          endSurah: liveCoverage.endSurah,
          endAyah: liveCoverage.endAyah,
          startPage: liveCoverage.startPage,
          endPage: liveCoverage.endPage
        },
        notes.trim(),
        user
      );
      if (!res.success) {
        setLocalError(res.message || 'Gagal menyimpan sesi manual.');
        return;
      }
      setEditingSessionId(null);
      setSessionNumber(sessions.length + 2);
      setLocalSuccess(`Sesi ${sessionNumber} (Juz ${juzNumber}) berhasil disimpan.`);
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyMaterial = async () => {
    setLocalError(null);
    setLocalSuccess(null);
    if (notes.trim().length < 5) {
      setLocalError('Catatan pemeriksaan Guru Halaqah wajib diisi minimal 5 karakter untuk verifikasi.');
      return;
    }
    const partId = existingServerPart?.id || (await handleSaveDraft());
    if (!partId) return;

    setBusy(true);
    try {
      const res = await api.verifyOrFinalizeUASMaterialPart(partId, 'verify', notes.trim(), user);
      if (!res.success) {
        setLocalError(res.message || 'Verifikasi materi gagal.');
        return;
      }
      setLocalSuccess(`Materi Juz ${juzNumber} berhasil diverifikasi Guru Halaqah.`);
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSession = async (sessId: string) => {
    setLocalError(null);
    setBusy(true);
    try {
      const res = await api.deleteUASManualSession(sessId, notes.trim() || 'Hapus sesi draft manual', user);
      if (!res.success) {
        setLocalError(res.message || 'Gagal menghapus sesi.');
        return;
      }
      setLocalSuccess('Sesi draft berhasil dihapus.');
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitAdmin = async () => {
    setLocalError(null);
    setBusy(true);
    try {
      const res = await api.submitUASPrepForApproval(period.id, studentId, false, undefined, user);
      if (!res.success) {
        setLocalError(res.message || 'Gagal mengirim pengajuan ke Admin.');
        return;
      }
      await onSaved(`${studentName} berhasil dikirim untuk persetujuan Admin.`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const pct = (liveCoverage.coverageRatio * 100).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[94vh] flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-4 bg-gradient-to-r from-teal-900 to-emerald-900 text-white flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm sm:text-base">Atur Materi & Sesi Manual</h3>
            <p className="text-[11px] sm:text-xs text-emerald-100">
              {studentName} ({studentClass}) • {halaqah} • Guru: {teacherName}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
          {localError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">{localError}</div>
          )}
          {localSuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">{localSuccess}</div>
          )}

          {/* Riwayat Setoran Semester Berjalan (Bukti Sah) */}
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-slate-800 inline-flex items-center gap-1.5">
                <BookOpen size={14} className="text-teal-700" />
                Riwayat Setoran Sabaq/Ziyadah Semester Berjalan ({relevantRecords.length} catatan)
              </span>
              {suggestedParts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {suggestedParts.map(sp => (
                    <button
                      key={sp.juzNumber}
                      type="button"
                      onClick={() => applySuggestion(sp)}
                      className="px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 font-bold text-[10px] inline-flex items-center gap-1"
                    >
                      <Sparkles size={10} /> Sugesti Juz {sp.juzNumber}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="max-h-28 overflow-y-auto divide-y divide-slate-200/70 bg-white rounded-xl border border-slate-200 px-2.5 py-1">
              {relevantRecords.length === 0 ? (
                <p className="py-2 text-rose-600 font-semibold">Belum ada setoran sabaq/ziyadah sampai cutoff ({period.materialCutoffDate || '-'}).</p>
              ) : (
                relevantRecords.map(rec => {
                  const sNum = materialDetectionService.getSurahNumber(rec.surah || '');
                  const maxA = SURAH_TOTAL_AYAHS[sNum] || 286;
                  const isBad = rec.ayahStart < 1 || rec.ayahEnd > maxA || (rec.ayahEnd > 0 && rec.ayahStart > rec.ayahEnd);
                  const checked = selectedRecordIds.includes(rec.id);
                  return (
                    <label key={rec.id} className="py-1.5 flex items-center justify-between gap-2 cursor-pointer">
                      <span className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedRecordIds(prev =>
                              prev.includes(rec.id) ? prev.filter(x => x !== rec.id) : [...prev, rec.id]
                            )
                          }
                        />
                        <span className="font-semibold text-slate-800">{rec.date}</span>
                        <span className="text-slate-600">{rec.surah} {rec.ayahStart}-{rec.ayahEnd} ({rec.type})</span>
                      </span>
                      {isBad ? (
                        <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[10px]">Ayat Invalid</span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">Sah</span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Form Input Batas Materi Manual */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Juz yang Akan Diuji</label>
              <select
                value={juzNumber}
                onChange={e => handleJuzChange(Number(e.target.value))}
                disabled={isLockedByAdmin}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold"
              >
                {Array.from({ length: 30 }, (_, i) => i + 1).map(j => (
                  <option key={j} value={j}>Juz {j}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-bold text-slate-700 block mb-1">Jenis Sesi</label>
              <select
                value={sessionType}
                onChange={e => setSessionType(e.target.value as 'full_juz' | 'partial_half')}
                disabled={isLockedByAdmin}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold"
              >
                <option value="full_juz">Juz Penuh (7 Acak + 2 Wajib Manual)</option>
                <option value="partial_half">Parsial &ge; 50% (4 Acak)</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="font-bold text-slate-700 block mb-1">Surah Awal</label>
                <select
                  value={startSurah}
                  onChange={e => setStartSurah(Number(e.target.value))}
                  disabled={isLockedByAdmin}
                  className="w-full px-2.5 py-2 rounded-xl border border-slate-200 bg-white"
                >
                  {Object.keys(SURAH_TOTAL_AYAHS).map(num => (
                    <option key={num} value={num}>{num}. {quranService.getSurah(Number(num))?.name || `Surah ${num}`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Ayat Awal</label>
                <input
                  type="number"
                  min={1}
                  max={SURAH_TOTAL_AYAHS[startSurah] || 286}
                  value={startAyah}
                  onChange={e => setStartAyah(Math.max(1, Number(e.target.value) || 1))}
                  disabled={isLockedByAdmin}
                  className="w-full px-2.5 py-2 rounded-xl border border-slate-200"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="font-bold text-slate-700 block mb-1">Surah Akhir</label>
                <select
                  value={endSurah}
                  onChange={e => setEndSurah(Number(e.target.value))}
                  disabled={isLockedByAdmin}
                  className="w-full px-2.5 py-2 rounded-xl border border-slate-200 bg-white"
                >
                  {Object.keys(SURAH_TOTAL_AYAHS).map(num => (
                    <option key={num} value={num}>{num}. {quranService.getSurah(Number(num))?.name || `Surah ${num}`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Ayat Akhir</label>
                <input
                  type="number"
                  min={1}
                  max={SURAH_TOTAL_AYAHS[endSurah] || 286}
                  value={endAyah}
                  onChange={e => setEndAyah(Math.max(1, Number(e.target.value) || 1))}
                  disabled={isLockedByAdmin}
                  className="w-full px-2.5 py-2 rounded-xl border border-slate-200"
                />
              </div>
            </div>
          </div>

          {/* Segmen Tambahan Opsional */}
          <div className="space-y-2">
            <label className="inline-flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={hasExtraSeg} onChange={e => setHasExtraSeg(e.target.checked)} />
              Tambahkan Segmen Tambahan (jika hafalan dalam Juz {juzNumber} tidak kontinu)
            </label>
            {hasExtraSeg && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <label className="font-semibold block mb-1">Surah Awal 2</label>
                  <select value={extraStartSurah} onChange={e => setExtraStartSurah(Number(e.target.value))} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white">
                    {Object.keys(SURAH_TOTAL_AYAHS).map(num => <option key={num} value={num}>{num}. {quranService.getSurah(Number(num))?.name || `Surah ${num}`}</option>)}
                  </select>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Ayat Awal 2</label>
                  <input type="number" min={1} value={extraStartAyah} onChange={e => setExtraStartAyah(Math.max(1, Number(e.target.value) || 1))} className="w-full px-2 py-1.5 rounded-lg border border-slate-200" />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Surah Akhir 2</label>
                  <select value={extraEndSurah} onChange={e => setExtraEndSurah(Number(e.target.value))} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 bg-white">
                    {Object.keys(SURAH_TOTAL_AYAHS).map(num => <option key={num} value={num}>{num}. {quranService.getSurah(Number(num))?.name || `Surah ${num}`}</option>)}
                  </select>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Ayat Akhir 2</label>
                  <input type="number" min={1} value={extraEndAyah} onChange={e => setExtraEndAyah(Math.max(1, Number(e.target.value) || 1))} className="w-full px-2 py-1.5 rounded-lg border border-slate-200" />
                </div>
              </div>
            )}
          </div>

          {/* Cakupan Panjang Mushaf */}
          <div className="p-3 rounded-2xl bg-teal-50 border border-teal-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-bold text-teal-900">Cakupan Panjang Mushaf: </span>
              <span className="font-black text-teal-800">{liveCoverage.coveredPagesCount}/{liveCoverage.juzTotalPages} hal ({pct}%)</span>
              <span className="ml-2 text-teal-700">• Hal {liveCoverage.startPage}–{liveCoverage.endPage}</span>
            </div>
            <span className="px-2 py-0.5 rounded-lg bg-white border border-teal-200 font-bold text-teal-800">
              {liveCoverage.partType === 'full_juz' ? 'Juz Penuh (100%)' : liveCoverage.partType === 'partial_half' ? 'Parsial (>=50%)' : 'Kurang dari 50%'}
            </span>
          </div>

          {/* Catatan Guru & Nomor Sesi */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-3">
              <label className="font-bold text-slate-700 block mb-1">Catatan Guru Halaqah (Wajib min. 5 karakter untuk Verifikasi/Sesi)</label>
              <textarea
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Contoh: Setoran Juz 30 lengkap dan kontinu telah diperiksa..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200"
              />
            </div>
            <div>
              <label className="font-bold text-slate-700 block mb-1">Nomor Sesi</label>
              <input
                type="number"
                min={1}
                value={sessionNumber}
                onChange={e => setSessionNumber(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 font-bold"
              />
            </div>
          </div>

          {/* Daftar Sesi Santri Saat Ini */}
          {sessions.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-bold text-slate-700">Daftar Sesi Santri ({sessions.length}):</p>
              <div className="space-y-1.5">
                {sessions.map(s => (
                  <div key={s.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-slate-800">Sesi {s.sessionNumber} • Juz {s.juzNumber}</span>
                      <span className="ml-2 text-slate-500">({s.sessionType === 'full_juz' ? 'Juz Penuh' : 'Parsial'} • {s.source})</span>
                    </div>
                    {!isLockedByAdmin && !s.attemptId && !s.questionSetId && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSessionId(s.id);
                            setSessionNumber(s.sessionNumber);
                            setSessionType(s.sessionType);
                            handleJuzChange(s.juzNumber);
                          }}
                          className="px-2 py-1 rounded-lg bg-white border border-slate-200 font-bold text-slate-700 inline-flex items-center gap-1"
                        >
                          <Edit3 size={11} /> Edit Sesi
                        </button>
                        {s.source === 'manual' && (
                          <button
                            type="button"
                            onClick={() => handleDeleteSession(s.id)}
                            className="px-2 py-1 rounded-lg bg-rose-50 border border-rose-200 font-bold text-rose-700 inline-flex items-center gap-1"
                          >
                            <Trash2 size={11} /> Hapus Sesi Draft
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy || isLockedByAdmin}
            onClick={handleSaveDraft}
            className="px-3 py-2 rounded-xl bg-white border border-slate-300 text-slate-800 font-bold text-xs disabled:opacity-40"
          >
            Simpan Draft
          </button>
          <button
            type="button"
            disabled={busy || isLockedByAdmin}
            onClick={handleSaveSession}
            className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs inline-flex items-center gap-1 disabled:opacity-40"
          >
            <Plus size={13} /> {editingSessionId ? 'Simpan Perubahan Sesi' : 'Tambah Sesi'}
          </button>
          <button
            type="button"
            disabled={busy || isLockedByAdmin}
            onClick={handleVerifyMaterial}
            className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs inline-flex items-center gap-1 disabled:opacity-40"
          >
            <CheckCircle2 size={13} /> Verifikasi Materi
          </button>
          <button
            type="button"
            disabled={busy || isLockedByAdmin}
            onClick={handleSubmitAdmin}
            className="px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs inline-flex items-center gap-1 disabled:opacity-40"
          >
            <Send size={13} /> Kirim ke Admin
          </button>
        </div>
      </div>
    </div>
  );
};
