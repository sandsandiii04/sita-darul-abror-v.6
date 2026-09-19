import React, { useState } from 'react';
import { ExamMaterialSnapshot, ExamParticipant, Student, TahfidzRecord, User } from '../../types';
import { SetoranHistoryModal } from './SetoranHistoryModal';
import { MaterialOverrideModal } from './MaterialOverrideModal';
import { 
  X, 
  CheckCircle2, 
  AlertTriangle, 
  Lock, 
  Edit3, 
  History, 
  BookOpen, 
  Layers, 
  ArrowRight, 
  Unlock,
  AlertCircle
} from 'lucide-react';

interface MaterialVerificationModalProps {
  user: User;
  participant: ExamParticipant;
  student: Student;
  snapshot: ExamMaterialSnapshot;
  records: TahfidzRecord[];
  startDate: string;
  cutoffDate: string;
  onClose: () => void;
  onVerify: () => void;
  onFinalize: () => void;
  onOverride: (updatedData: Partial<ExamMaterialSnapshot>, reason: string) => void;
  onReopen: (reason: string) => void;
}

export const MaterialVerificationModal: React.FC<MaterialVerificationModalProps> = ({
  user,
  participant,
  student,
  snapshot,
  records,
  startDate,
  cutoffDate,
  onClose,
  onVerify,
  onFinalize,
  onOverride,
  onReopen
}) => {
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [showReopenPrompt, setShowReopenPrompt] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenError, setReopenError] = useState<string | null>(null);

  const isFinalized = snapshot.status === 'finalized';
  const isAdmin = user.role === 'admin';
  const isTeacher = user.role === 'teacher';

  const relevantRecords = records.filter(r => {
    if (r.studentId !== student.id) return false;
    if (r.type !== 'sabaq' && r.type !== 'ziyadah') return false;
    if (!r.date) return false;
    return r.date >= startDate && r.date <= cutoffDate;
  });

  const handleReopenSubmit = () => {
    if (!reopenReason.trim()) {
      setReopenError('Wajib mencantumkan alasan pembukaan kembali materi.');
      return;
    }
    onReopen(reopenReason.trim());
    setShowReopenPrompt(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-700 to-teal-800 px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <BookOpen size={20} className="text-emerald-100" />
            </div>
            <div>
              <h3 className="font-bold text-base">Verifikasi Materi Ujian Santri</h3>
              <p className="text-xs text-emerald-100">
                {participant.studentName || student.name} &bull; Kelas {participant.class || student.class} &bull; {participant.halaqah || student.halaqah}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-emerald-100 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Status Badge & Anomaly Notice */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Status Saat Ini:</span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold border inline-flex items-center gap-1.5 ${
                  snapshot.status === 'finalized'
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
                    : snapshot.status === 'ready'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : snapshot.status === 'needs_review'
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                {snapshot.status === 'finalized' ? (
                  <>
                    <Lock size={13} /> Final / Terkunci
                  </>
                ) : snapshot.status === 'ready' ? (
                  <>
                    <CheckCircle2 size={13} className="text-emerald-600" /> Siap / Terverifikasi
                  </>
                ) : snapshot.status === 'needs_review' ? (
                  <>
                    <AlertTriangle size={13} className="text-amber-600" /> Perlu Verifikasi
                  </>
                ) : (
                  <>Belum Siap</>
                )}
              </span>
            </div>

            <span className="text-[11px] font-semibold text-slate-400">
              Sumber: {snapshot.sourceType === 'manual_override' ? 'Koreksi Manual' : 'Deteksi Otomatis'}
            </span>
          </div>

          {/* Anomaly Review Reason Alert */}
          {snapshot.reviewReason && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-bold">Catatan Anomali Deteksi:</strong>
                <span>{snapshot.reviewReason}</span>
              </div>
            </div>
          )}

          {/* Manual Override Reason Alert */}
          {snapshot.overrideReason && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-start gap-2">
              <Edit3 size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-bold">Alasan Koreksi Manual:</strong>
                <span>{snapshot.overrideReason}</span>
              </div>
            </div>
          )}

          {/* Analysis Chronology Cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Setoran Awal Semester
              </span>
              <p className="text-xs font-bold text-slate-800">
                {snapshot.startSurahName} ayat {snapshot.startAyah}
              </p>
              <span className="text-[11px] text-slate-500 block mt-0.5">
                Tanggal: {snapshot.firstRecordDate || '-'}
              </span>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Capaian Terakhir (Cutoff)
              </span>
              <p className="text-xs font-bold text-slate-800">
                {snapshot.endSurahName} ayat {snapshot.endAyah}
              </p>
              <span className="text-[11px] text-slate-500 block mt-0.5">
                Tanggal: {snapshot.lastRecordDate || '-'}
              </span>
            </div>
          </div>

          {/* Target Exam Material Card */}
          <div className="p-5 bg-gradient-to-br from-emerald-50 to-teal-50/40 rounded-2xl border border-emerald-200/80">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider">
                Materi Ujian Ditetapkan
              </span>
              <span className="px-2.5 py-0.5 bg-emerald-200/60 text-emerald-800 rounded-full text-xs font-bold">
                Estimasi {snapshot.estimatedPages} Halaman
              </span>
            </div>

            <div className="flex items-center gap-3 my-2">
              <div className="flex-1 bg-white p-3 rounded-xl border border-emerald-100 shadow-sm text-center">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block">Dari</span>
                <strong className="text-sm font-bold text-slate-900 block">
                  {snapshot.startSurahName}
                </strong>
                <span className="text-xs text-emerald-700 font-semibold">Ayat {snapshot.startAyah}</span>
              </div>

              <div className="p-2 bg-emerald-100/60 rounded-full text-emerald-700">
                <ArrowRight size={18} />
              </div>

              <div className="flex-1 bg-white p-3 rounded-xl border border-emerald-100 shadow-sm text-center">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block">Sampai</span>
                <strong className="text-sm font-bold text-slate-900 block">
                  {snapshot.endSurahName}
                </strong>
                <span className="text-xs text-emerald-700 font-semibold">Ayat {snapshot.endAyah}</span>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-slate-600 pt-2 border-t border-emerald-200/60">
              <span>Mushaf Madinah: <strong>Halaman {snapshot.startPage || 1} s/d {snapshot.endPage || 1}</strong></span>
              <span>Cakupan Juz: <strong>Juz {snapshot.startJuz || 1} - {snapshot.endJuz || 1}</strong></span>
              <span>Arah Hafalan: <strong>{snapshot.memorizationDirection === 'backward' ? 'Mundur (Juz 30)' : 'Maju'}</strong></span>
            </div>
          </div>

          {/* Quick Buttons for Inspection */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistoryModal(true)}
              className="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5"
            >
              <History size={14} />
              <span>Lihat Riwayat Setoran ({relevantRecords.length})</span>
            </button>

            {!isFinalized && (
              <button
                onClick={() => setShowOverrideModal(true)}
                className="flex-1 py-2 px-3 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5"
              >
                <Edit3 size={14} />
                <span>Koreksi Materi Manual</span>
              </button>
            )}
          </div>

          {/* Reopen prompt for finalized items */}
          {showReopenPrompt && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-rose-800 font-bold text-xs">
                <Unlock size={16} />
                <span>Buka Kembali Materi Final (Khusus Admin)</span>
              </div>
              <p className="text-[11px] text-rose-700">
                Membuka kembali materi akan mengubah status dari <strong>Final</strong> menjadi <strong>Siap (Ready)</strong> agar dapat dikoreksi. Alasan pembukaan akan dicatat di log audit.
              </p>
              {reopenError && (
                <p className="text-[11px] text-rose-800 font-semibold">{reopenError}</p>
              )}
              <textarea
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Tuliskan alasan pembukaan kembali..."
                rows={2}
                className="w-full px-3 py-2 text-xs border border-rose-300 rounded-lg outline-none bg-white"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowReopenPrompt(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleReopenSubmit}
                  className="px-3 py-1.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg"
                >
                  Konfirmasi Buka Kembali
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <div>
            {isFinalized && isAdmin && !showReopenPrompt && (
              <button
                onClick={() => setShowReopenPrompt(true)}
                className="px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 rounded-xl transition-all flex items-center gap-1.5 border border-rose-200"
              >
                <Unlock size={14} />
                <span>Buka Kembali Materi</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Tutup
            </button>

            {!isFinalized && (
              <>
                <button
                  onClick={onVerify}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5"
                >
                  <CheckCircle2 size={14} />
                  <span>Setujui (Siap)</span>
                </button>
                <button
                  onClick={onFinalize}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5"
                >
                  <Lock size={14} />
                  <span>Finalisasi Santri</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sub Modals */}
      {showHistoryModal && (
        <SetoranHistoryModal
          student={student}
          records={relevantRecords}
          startDate={startDate}
          cutoffDate={cutoffDate}
          onClose={() => setShowHistoryModal(false)}
        />
      )}

      {showOverrideModal && (
        <MaterialOverrideModal
          user={user}
          student={student}
          snapshot={snapshot}
          onClose={() => setShowOverrideModal(false)}
          onSaved={(updatedData, reason) => {
            setShowOverrideModal(false);
            onOverride(updatedData, reason);
          }}
        />
      )}
    </div>
  );
};
