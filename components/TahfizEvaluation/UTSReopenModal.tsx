import React, { useState } from 'react';
import { ExaminerStudentItem } from '../../types';
import { RefreshCcw, AlertTriangle, X } from 'lucide-react';

interface UTSReopenModalProps {
  student: ExaminerStudentItem;
  onReopen: (attemptId: string, reason: string) => Promise<void>;
  onClose: () => void;
}

export const UTSReopenModal: React.FC<UTSReopenModalProps> = ({
  student,
  onReopen,
  onClose
}) => {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || reason.trim().length < 5) {
      setError('Alasan pembukaan kembali wajib diisi minimal 5 karakter.');
      return;
    }

    if (!student.attemptId) {
      setError('ID sesi ujian tidak ditemukan.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onReopen(student.attemptId, reason.trim());
      onClose();
    } catch (err: any) {
      setError(err.message || 'Gagal membuka kembali sesi ujian.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-amber-100 bg-amber-50/70 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-800">
              <RefreshCcw size={18} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Buka Kembali Ujian UTS</h3>
              <p className="text-xs text-slate-500">{student.studentName} ({student.class})</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white/60 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed flex items-start gap-2.5">
            <AlertTriangle size={17} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold mb-1">Perhatian Khusus Administrator:</p>
              <p>
                Membuka kembali ujian akan mengembalikan status sesi santri menjadi <span className="font-semibold text-amber-950">Sedang Berjalan (In Progress)</span>. 
                Penguji dapat mengubah kembali rincian kesalahan dan nilai. Tindakan ini akan dicatat ke dalam riwayat sistem.
              </p>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Alasan Pembukaan Kembali <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Koreksi kekeliruan input poin tajwid pada soal nomor 3 atas konfirmasi penguji."
              rows={3}
              required
              className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 resize-none text-slate-800"
            />
            <p className="text-[11px] text-slate-400">
              Minimal 5 karakter. Wajib dijelaskan dengan jujur dan jelas.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !reason.trim()}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 transition-all shadow-sm flex items-center gap-1.5"
            >
              <RefreshCcw size={14} className={isSubmitting ? 'animate-spin' : ''} />
              <span>{isSubmitting ? 'Memproses...' : 'Buka Kembali Sesi'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
