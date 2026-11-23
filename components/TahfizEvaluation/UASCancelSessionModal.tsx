import React, { useRef, useState } from 'react';
import { ExamUASSession, User } from '../../types';
import { api } from '../../api';
import { AlertTriangle, Ban, CheckCircle2, Loader2, ShieldAlert, X } from 'lucide-react';

interface UASCancelSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentName: string;
  studentClass: string;
  halaqah: string;
  session: ExamUASSession;
  hasPendingRevision: boolean;
  otherActiveSessionCount: number;
  user: User;
  onCancelled: (message: string) => Promise<void> | void;
}

export const UASCancelSessionModal: React.FC<UASCancelSessionModalProps> = ({
  isOpen,
  onClose,
  studentName,
  studentClass,
  halaqah,
  session,
  hasPendingRevision,
  otherActiveSessionCount,
  user,
  onCancelled
}) => {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const idempotencyKeyRef = useRef(
    `cancel_${session.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );

  if (!isOpen) return null;

  const isAdmin = user.role === 'admin';
  const hasAttemptOrScore =
    session.status === 'submitted' ||
    session.status === 'in_progress' ||
    Boolean(session.attemptId) ||
    (session.score !== null && session.score !== undefined);

  const packetStatusLabel = hasAttemptOrScore
    ? 'Sudah memiliki riwayat ujian / nilai (TIDAK BOLEH dibatalkan)'
    : session.questionSetId
      ? `Sudah memiliki paket soal (${session.status === 'pending_mandatory' ? 'Menunggu 2 Soal Wajib' : 'Paket Aktif'}) — belum ada attempt`
      : 'Belum memiliki paket soal';

  const handleConfirmCancel = async () => {
    if (!isAdmin || hasAttemptOrScore || inFlightRef.current) return;
    if (reason.trim().length < 5) {
      setErrorMsg('Alasan pembatalan wajib diisi minimal 5 karakter.');
      return;
    }
    if (!confirmed) {
      setErrorMsg('Centang konfirmasi eksplisit Admin sebelum membatalkan sesi.');
      return;
    }

    inFlightRef.current = true;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await api.adminCancelUASSession(
        {
          uasSessionId: session.id,
          reason: reason.trim(),
          idempotencyKey: idempotencyKeyRef.current
        },
        user
      );
      if (!res.success) {
        setErrorMsg(res.message || 'Gagal membatalkan sesi UAS.');
        return;
      }
      await onCancelled(
        res.message ||
          `Sesi ${session.sessionNumber} (Juz ${session.juzNumber}) berhasil dibatalkan. Menunggu Guru Halaqah membuat sesi baru.`
      );
      onClose();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Terjadi gangguan jaringan saat membatalkan sesi.');
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-4 border-b border-rose-200 bg-rose-50/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-rose-100 text-rose-700 shrink-0">
              <Ban size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="font-extrabold text-sm text-rose-950 truncate">
                Konfirmasi Pembatalan Sesi UAS
              </h3>
              <p className="text-[11px] text-rose-800 truncate">
                Hanya membatalkan 1 sesi ini — riwayat database &amp; sesi lain tetap aman.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="p-1.5 rounded-lg text-rose-500 hover:text-rose-800 hover:bg-white/70"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-3.5">
          {/* Detail Target Sesi */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Santri</span>
              <span className="font-bold text-slate-900 text-right">
                {studentName} ({studentClass} • {halaqah})
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Sesi Target</span>
              <span className="font-extrabold text-slate-900">
                Sesi {session.sessionNumber} — Juz {session.juzNumber} ({session.sessionType === 'full_juz' ? 'Juz Penuh' : 'Parsial'})
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Status Paket Soal</span>
              <span className="font-semibold text-slate-800 text-right">{packetStatusLabel}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Attempt / Penilaian</span>
              <span className={`font-bold ${hasAttemptOrScore ? 'text-rose-700' : 'text-emerald-700'}`}>
                {hasAttemptOrScore ? 'Ada riwayat ujian / nilai' : 'Tidak ada attempt & nilai'}
              </span>
            </div>
          </div>

          {/* Dampak Pembatalan */}
          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1.5">
            <div className="font-bold flex items-center gap-1.5">
              <ShieldAlert size={14} className="text-amber-700 shrink-0" />
              <span>Dampak Pembatalan Aman (Soft-Cancel)</span>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-[11px] leading-relaxed">
              <li>Sesi {session.sessionNumber} dinonaktifkan dengan status <strong>void</strong> (riwayat tetap tersimpan, tidak dihapus fisik).</li>
              {session.questionSetId && (
                <li>Paket soal lama ditandai <strong>stale</strong> sebagai jejak audit (tidak dihapus &amp; tidak menyentuh paket void historis).</li>
              )}
              {hasPendingRevision && (
                <li>Pengajuan revisi materi yang masih <em>Menunggu Keputusan</em> pada sesi ini akan <strong>ditutup otomatis</strong> dengan catatan audit (tidak disetujui otomatis).</li>
              )}
              {otherActiveSessionCount > 0 && (
                <li><strong>{otherActiveSessionCount} sesi aktif lain</strong> milik santri ini <strong>tetap utuh</strong> dan tidak terganggu.</li>
              )}
              <li>Guru Halaqah dapat langsung membuat sesi baru dengan materi yang benar lalu mengirim ulang untuk persetujuan Admin.</li>
              <li className="font-semibold text-rose-800">Pastikan tidak ada penguji yang sedang menyimpan nilai offline di perangkat untuk sesi ini.</li>
            </ul>
          </div>

          {hasAttemptOrScore ? (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-bold flex items-center gap-2">
              <AlertTriangle size={15} className="shrink-0" />
              <span>Sesi ini sudah memiliki attempt atau nilai ujian sehingga tidak dapat dibatalkan melalui fitur ini.</span>
            </div>
          ) : (
            <>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Alasan Pembatalan <span className="text-rose-600">*</span>
                </label>
                <textarea
                  rows={2}
                  value={reason}
                  disabled={busy}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Contoh: Salah pilih Juz 29 Parsial, seharusnya Juz 3 Parsial. Dibatalkan agar Guru input ulang."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <label className="flex items-start gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={e => setConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-rose-600"
                />
                <span className="text-[11px] text-slate-700 font-semibold leading-snug">
                  Saya sebagai Admin mengonfirmasi pembatalan <strong>hanya Sesi {session.sessionNumber} (Juz {session.juzNumber})</strong> untuk {studentName} dan sudah memastikan tidak ada ujian aktif atau nilai offline untuk sesi ini.
                </span>
              </label>
            </>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold disabled:opacity-40"
          >
            Batal
          </button>
          {!hasAttemptOrScore && (
            <button
              type="button"
              disabled={!isAdmin || busy || !confirmed || reason.trim().length < 5}
              onClick={handleConfirmCancel}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Membatalkan...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} />
                  <span>Batalkan Sesi &amp; Izinkan Input Ulang</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
