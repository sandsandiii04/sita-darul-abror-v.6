import React, { useMemo, useRef, useState } from 'react';
import {
  ExamPeriod,
  ExamUASSession,
  UASMaterialRevisionSnapshot,
  UASSessionType,
  User
} from '../../types';
import { api } from '../../api';
import {
  computeManualJuzPartCoverage,
  JUZ_AYAH_BOUNDARIES,
  JUZ_PAGE_RANGES
} from '../../services/uasJuzSegmentationService';
import { quranService, SURAH_TOTAL_AYAHS } from '../../services/quranService';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileEdit,
  Send,
  ShieldAlert,
  X
} from 'lucide-react';

interface UASMaterialRevisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  period: ExamPeriod;
  studentId: string;
  studentName: string;
  studentClass: string;
  halaqah: string;
  session: ExamUASSession;
  existingSessionNumbers: number[];
  user: User;
  onSubmitted: (message: string) => Promise<void> | void;
}

export const UASMaterialRevisionModal: React.FC<UASMaterialRevisionModalProps> = ({
  isOpen,
  onClose,
  period,
  studentId,
  studentName,
  studentClass,
  halaqah,
  session,
  existingSessionNumbers,
  user,
  onSubmitted
}) => {
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [proposedJuz, setProposedJuz] = useState<number>(session.juzNumber);
  const [proposedType, setProposedType] = useState<UASSessionType>(session.sessionType);
  const [proposedSessionNumber, setProposedSessionNumber] = useState<number>(session.sessionNumber);

  const initialBounds = JUZ_AYAH_BOUNDARIES[session.juzNumber] || { startSurah: 1, startAyah: 1, endSurah: 2, endAyah: 141 };
  const [startSurah, setStartSurah] = useState<number>(session.startSurah || initialBounds.startSurah);
  const [startAyah, setStartAyah] = useState<number>(session.startAyah || initialBounds.startAyah);
  const [endSurah, setEndSurah] = useState<number>(session.endSurah || initialBounds.endSurah);
  const [endAyah, setEndAyah] = useState<number>(session.endAyah || initialBounds.endAyah);
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Idempotency key unik per form session agar klik ganda / retry timeout tidak menciptakan duplikasi
  const idempotencyKeyRef = useRef<string>(
    `rev_${period.id}_${studentId}_${session.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );

  const handleJuzChange = (newJuz: number) => {
    setProposedJuz(newJuz);
    const b = JUZ_AYAH_BOUNDARIES[newJuz];
    if (b) {
      setStartSurah(b.startSurah);
      setStartAyah(b.startAyah);
      setEndSurah(b.endSurah);
      setEndAyah(b.endAyah);
    }
    setErrorMsg(null);
  };

  const surahsInProposedJuz = useMemo(() => {
    const b = JUZ_AYAH_BOUNDARIES[proposedJuz];
    if (!b) return [];
    const list: Array<{ number: number; name: string; minAyah: number; maxAyah: number }> = [];
    for (let s = b.startSurah; s <= b.endSurah; s++) {
      const total = SURAH_TOTAL_AYAHS[s] || 1;
      list.push({
        number: s,
        name: quranService.getSurah(s)?.name || `Surah ${s}`,
        minAyah: s === b.startSurah ? b.startAyah : 1,
        maxAyah: s === b.endSurah ? b.endAyah : total
      });
    }
    return list;
  }, [proposedJuz]);

  const proposedMaterial = useMemo<UASMaterialRevisionSnapshot>(() => {
    const b = JUZ_AYAH_BOUNDARIES[proposedJuz] || { startSurah: 1, startAyah: 1, endSurah: 2, endAyah: 141 };
    const pr = JUZ_PAGE_RANGES[proposedJuz] || { startPage: 1, endPage: 20, totalPages: 20 };

    if (proposedType === 'full_juz') {
      const pages = Array.from({ length: pr.totalPages }, (_, i) => pr.startPage + i);
      return {
        sessionNumber: proposedSessionNumber,
        juzNumber: proposedJuz,
        sessionType: 'full_juz',
        startSurah: b.startSurah,
        startAyah: b.startAyah,
        endSurah: b.endSurah,
        endAyah: b.endAyah,
        startPage: pr.startPage,
        endPage: pr.endPage,
        coveredPages: pages
      };
    }

    const cov = computeManualJuzPartCoverage({
      juzNumber: proposedJuz,
      ranges: [{ startSurah, startAyah, endSurah, endAyah }]
    });
    const pages = cov.coveredPages.length > 0
      ? cov.coveredPages
      : Array.from({ length: Math.max(1, Math.ceil(pr.totalPages / 2)) }, (_, i) => pr.startPage + i);
    return {
      sessionNumber: proposedSessionNumber,
      juzNumber: proposedJuz,
      sessionType: 'partial_half',
      startSurah: cov.startSurah || startSurah,
      startAyah: cov.startAyah || startAyah,
      endSurah: cov.endSurah || endSurah,
      endAyah: cov.endAyah || endAyah,
      startPage: cov.startPage || pages[0],
      endPage: cov.endPage || pages[pages.length - 1],
      coveredPages: pages
    };
  }, [proposedJuz, proposedType, proposedSessionNumber, startSurah, startAyah, endSurah, endAyah]);

  if (!isOpen) return null;

  const isSubmitted = session.status === 'submitted' || session.score !== null && session.score !== undefined;
  const isInProgress = !isSubmitted && (session.status === 'in_progress' || Boolean(session.attemptId));
  const hasUnusedPacket = !isSubmitted && !isInProgress && Boolean(session.questionSetId);

  const impactNotice = isSubmitted
    ? {
        tone: 'rose' as const,
        title: 'Ujian Sudah Selesai / Bernilai',
        body: 'Pengajuan tetap dicatat untuk ditinjau Admin, namun sistem TIDAK akan mengubah materi aktif, paket soal, penguji, atau nilai historis secara otomatis. Kasus akan ditandai sebagai "Memerlukan Keputusan Akademik".'
      }
    : isInProgress
      ? {
          tone: 'amber' as const,
          title: 'Ujian Sedang Berlangsung',
          body: 'Revisi membutuhkan penanganan khusus Admin karena ujian sedang berlangsung. Sesi dan paket aktif tidak akan diubah atau dihentikan secara otomatis.'
        }
      : hasUnusedPacket
        ? {
            tone: 'sky' as const,
            title: 'Paket Soal Sudah Digenerate (Belum Ada Penilaian)',
            body: 'Jika Admin menyetujui revisi ini, paket soal lama akan dinonaktifkan sebagai riwayat audit (tidak dihapus) dan Admin perlu menggenerate paket pengganti berdasarkan materi baru.'
          }
        : {
            tone: 'emerald' as const,
            title: 'Sudah Disetujui Admin (Belum Ada Paket Soal)',
            body: 'Jika Admin menyetujui revisi ini, materi baru akan diterapkan dengan jejak audit lengkap dan langsung menjadi dasar generator paket soal.'
          };

  const validateBeforeReview = (): boolean => {
    setErrorMsg(null);
    if (reason.trim().length < 5) {
      setErrorMsg('Alasan revisi wajib diisi minimal 5 karakter.');
      return false;
    }
    if (proposedSessionNumber < 1) {
      setErrorMsg('Nomor sesi usulan harus minimal 1.');
      return false;
    }
    if (proposedSessionNumber !== session.sessionNumber && existingSessionNumbers.includes(proposedSessionNumber)) {
      setErrorMsg(`Nomor Sesi ${proposedSessionNumber} sudah digunakan oleh sesi aktif lain pada santri ini.`);
      return false;
    }
    if (
      proposedType === 'partial_half' &&
      (startSurah > endSurah || (startSurah === endSurah && startAyah > endAyah))
    ) {
      setErrorMsg('Rentang surah dan ayat usulan tidak valid (awal melebihi akhir).');
      return false;
    }
    if (proposedMaterial.coveredPages.length === 0) {
      setErrorMsg('Rentang materi usulan tidak memiliki cakupan halaman yang valid.');
      return false;
    }
    const isUnchanged =
      proposedMaterial.juzNumber === session.juzNumber &&
      proposedMaterial.sessionType === session.sessionType &&
      proposedMaterial.sessionNumber === session.sessionNumber &&
      proposedMaterial.startSurah === session.startSurah &&
      proposedMaterial.startAyah === session.startAyah &&
      proposedMaterial.endSurah === session.endSurah &&
      proposedMaterial.endAyah === session.endAyah;
    if (isUnchanged) {
      setErrorMsg('Materi usulan masih sama persis dengan materi aktif saat ini. Ubah Juz, jenis sesi, atau rentang materi terlebih dahulu.');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await api.requestUASMaterialRevision(
        {
          periodId: period.id,
          studentId,
          uasSessionId: session.id,
          proposedMaterial,
          reason: reason.trim(),
          idempotencyKey: idempotencyKeyRef.current
        },
        user
      );
      if (!res.success) {
        setErrorMsg(res.message || 'Gagal mengirim pengajuan revisi materi.');
        return;
      }
      await onSubmitted(
        res.message || 'Pengajuan revisi materi berhasil dikirim ke Admin. Sesi lama tetap berlaku sampai disetujui.'
      );
      onClose();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Terjadi kesalahan saat mengirim pengajuan revisi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatSurahAyah = (s: number, a: number) => `${quranService.getSurah(s)?.name || `Surah ${s}`}:${a}`;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-amber-50/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-amber-100 text-amber-800 shrink-0">
              <FileEdit size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm sm:text-base text-slate-900 truncate">
                Ajukan Revisi Materi UAS
              </h3>
              <p className="text-xs text-slate-600 truncate">
                {studentName} • Kelas {studentClass} • Halaqah {halaqah} • Sesi {session.sessionNumber}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/80"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Active Material Summary */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Materi Aktif Saat Ini</div>
            <div className="flex flex-wrap items-center gap-2 text-slate-900 font-bold text-sm">
              <span>Sesi {session.sessionNumber}</span>
              <span>•</span>
              <span>Juz {session.juzNumber}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-200 text-slate-800">
                {session.sessionType === 'partial_half' ? 'Parsial (4 Soal Acak)' : 'Juz Penuh (7 Acak + 2 Wajib)'}
              </span>
            </div>
            <div className="text-slate-600">
              Rentang: {formatSurahAyah(session.startSurah, session.startAyah)} s.d. {formatSurahAyah(session.endSurah, session.endAyah)} (Hal. {session.startPage}–{session.endPage})
            </div>
          </div>

          {/* Impact Info */}
          <div
            className={`p-3.5 rounded-2xl border flex items-start gap-2.5 ${
              impactNotice.tone === 'rose'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : impactNotice.tone === 'amber'
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : impactNotice.tone === 'sky'
                    ? 'bg-sky-50 border-sky-200 text-sky-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <ShieldAlert size={16} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">{impactNotice.title}</div>
              <p className="mt-0.5 leading-relaxed">{impactNotice.body}</p>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {step === 'form' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Juz Usulan</label>
                  <select
                    value={proposedJuz}
                    onChange={e => handleJuzChange(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white"
                  >
                    {Array.from({ length: 30 }, (_, i) => i + 1).map(j => (
                      <option key={j} value={j}>Juz {j}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Jenis Sesi Usulan</label>
                  <select
                    value={proposedType}
                    onChange={e => setProposedType(e.target.value as UASSessionType)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white"
                  >
                    <option value="full_juz">Juz Penuh (7 Acak + 2 Wajib)</option>
                    <option value="partial_half">Parsial (4 Soal Acak)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Nomor Urut Sesi</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={proposedSessionNumber}
                    onChange={e => setProposedSessionNumber(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white"
                  />
                </div>
              </div>

              {proposedType === 'partial_half' && surahsInProposedJuz.length > 0 && (
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-3">
                  <div className="font-bold text-slate-800">Rentang Materi Parsial (Juz {proposedJuz})</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Surah Awal</label>
                      <select
                        value={startSurah}
                        onChange={e => {
                          const s = Number(e.target.value);
                          setStartSurah(s);
                          const info = surahsInProposedJuz.find(x => x.number === s);
                          if (info) setStartAyah(info.minAyah);
                        }}
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white"
                      >
                        {surahsInProposedJuz.map(s => (
                          <option key={s.number} value={s.number}>{s.number}. {s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ayat Awal</label>
                      <input
                        type="number"
                        min={1}
                        max={SURAH_TOTAL_AYAHS[startSurah] || 286}
                        value={startAyah}
                        onChange={e => setStartAyah(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Surah Akhir</label>
                      <select
                        value={endSurah}
                        onChange={e => {
                          const s = Number(e.target.value);
                          setEndSurah(s);
                          const info = surahsInProposedJuz.find(x => x.number === s);
                          if (info) setEndAyah(info.maxAyah);
                        }}
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white"
                      >
                        {surahsInProposedJuz.map(s => (
                          <option key={s.number} value={s.number}>{s.number}. {s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Ayat Akhir</label>
                      <input
                        type="number"
                        min={1}
                        max={SURAH_TOTAL_AYAHS[endSurah] || 286}
                        value={endAyah}
                        onChange={e => setEndAyah(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white"
                      />
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-600">
                    Cakupan halaman terhitung: <strong>{proposedMaterial.coveredPages.length} halaman</strong> (Hal. {proposedMaterial.startPage}–{proposedMaterial.endPage}).
                  </div>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Alasan Revisi <span className="text-rose-600">*</span>
                </label>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Contoh: Salah memilih Juz 28, seharusnya Juz 27 sesuai hasil pemeriksaan hafalan."
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Alasan wajib jelas (minimal 5 karakter) agar Admin dapat memverifikasi dan mencatat audit trail.
                </p>
              </div>
            </div>
          ) : (
            /* Step Konfirmasi */
            <div className="space-y-3">
              <div className="font-bold text-slate-800">Periksa Kembali Usulan Revisi Sebelum Dikirim</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50">
                  <div className="text-[10px] font-bold uppercase text-slate-500 mb-1">Materi Lama (Aktif)</div>
                  <div className="font-bold text-slate-900">Sesi {session.sessionNumber} — Juz {session.juzNumber}</div>
                  <div className="text-slate-600 mt-0.5">
                    {session.sessionType === 'partial_half' ? 'Parsial (4 Soal)' : 'Juz Penuh (9 Soal)'}
                  </div>
                  <div className="text-slate-600 mt-0.5">
                    {formatSurahAyah(session.startSurah, session.startAyah)} s.d. {formatSurahAyah(session.endSurah, session.endAyah)} (Hal. {session.startPage}–{session.endPage})
                  </div>
                </div>
                <div className="p-3.5 rounded-2xl border border-amber-300 bg-amber-50/70">
                  <div className="text-[10px] font-bold uppercase text-amber-800 mb-1">Materi Baru (Usulan)</div>
                  <div className="font-bold text-amber-950">Sesi {proposedMaterial.sessionNumber} — Juz {proposedMaterial.juzNumber}</div>
                  <div className="text-amber-900 mt-0.5">
                    {proposedMaterial.sessionType === 'partial_half' ? 'Parsial (4 Soal)' : 'Juz Penuh (9 Soal)'}
                  </div>
                  <div className="text-amber-900 mt-0.5">
                    {formatSurahAyah(proposedMaterial.startSurah, proposedMaterial.startAyah)} s.d. {formatSurahAyah(proposedMaterial.endSurah, proposedMaterial.endAyah)} (Hal. {proposedMaterial.startPage}–{proposedMaterial.endPage})
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] font-bold uppercase text-slate-500">Alasan Revisi</div>
                <p className="text-slate-800 mt-0.5">{reason.trim()}</p>
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-teal-600 shrink-0" />
                <span>Sesi aktif saat ini TIDAK akan langsung berubah. Pengajuan akan masuk ke antrean Persetujuan Revisi Admin.</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          {step === 'confirm' ? (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setStep('form')}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold"
            >
              Kembali Ubah
            </button>
          ) : (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-200/70 text-xs font-bold"
            >
              Batal
            </button>
          )}

          {step === 'form' ? (
            <button
              type="button"
              onClick={() => {
                if (validateBeforeReview()) setStep('confirm');
              }}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <span>Periksa Usulan</span>
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSubmit}
              className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Send size={14} />
              <span>{isSubmitting ? 'Mengirim...' : 'Kirim Pengajuan ke Admin'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
