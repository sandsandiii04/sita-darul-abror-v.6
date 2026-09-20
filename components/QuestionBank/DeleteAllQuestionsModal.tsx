import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, Check, Loader2 } from 'lucide-react';
import { QuestionBankFilter } from '../../types';

interface DeleteAllQuestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalCount: number;
  filteredCount: number;
  filter: QuestionBankFilter;
  onConfirmDeleteAll: (scope: 'all' | 'filtered') => Promise<void>;
}

export const DeleteAllQuestionsModal: React.FC<DeleteAllQuestionsModalProps> = ({
  isOpen,
  onClose,
  totalCount,
  filteredCount,
  filter,
  onConfirmDeleteAll
}) => {
  const [scope, setScope] = useState<'all' | 'filtered'>('all');
  const [confirmText, setConfirmText] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const isFilterActive = !!(
    (filter.examType && filter.examType !== 'all') ||
    (filter.status && filter.status !== 'all') ||
    (filter.questionType && filter.questionType !== 'all') ||
    (filter.difficulty && filter.difficulty !== 'all') ||
    (filter.juz && filter.juz !== 'all') ||
    (filter.surah && filter.surah !== 'all') ||
    (filter.search && filter.search.trim()) ||
    (filter.tag && filter.tag.trim())
  );

  const targetCount = scope === 'filtered' ? filteredCount : totalCount;
  const isConfirmed = confirmText.trim().toUpperCase() === 'HAPUS';

  const handleDelete = async () => {
    if (!isConfirmed || isDeleting) return;
    setIsDeleting(true);
    setErrorMsg(null);
    try {
      await onConfirmDeleteAll(scope);
      onClose();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Gagal menghapus soal. Silakan coba lagi.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in font-sans">
      <div 
        className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-rose-100 overflow-hidden animate-scale-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-rose-600 via-rose-700 to-red-800 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center backdrop-blur-md">
              <Trash2 size={20} className="text-white" />
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Hapus Semua Soal</h3>
              <p className="text-[11px] text-rose-100 font-medium">Tindakan Berisiko Tinggi (Permanent Delete)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {/* Warning Banner */}
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 flex items-start gap-3">
            <AlertTriangle className="text-rose-600 shrink-0 mt-0.5" size={20} />
            <div className="text-xs text-rose-800 leading-relaxed">
              <p className="font-bold">Peringatan: Tindakan ini tidak dapat dibatalkan!</p>
              <p className="text-[11px] text-rose-700 mt-0.5">
                Semua soal yang dipilih akan dihapus permanen dari server database Supabase serta penyimpanan lokal.
              </p>
            </div>
          </div>

          {/* Scope Selector (jika ada filter yang sedang aktif) */}
          {isFilterActive && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">Pilih Cakupan Penghapusan:</label>
              <div className="space-y-2">
                <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  scope === 'filtered' 
                    ? 'border-rose-500 bg-rose-50/50 text-slate-900' 
                    : 'border-slate-200 hover:border-slate-300 text-slate-700'
                }`}>
                  <input
                    type="radio"
                    name="delete_scope"
                    value="filtered"
                    checked={scope === 'filtered'}
                    onChange={() => setScope('filtered')}
                    className="mt-0.5 text-rose-600 focus:ring-rose-500"
                    disabled={isDeleting}
                  />
                  <div className="text-xs">
                    <span className="font-bold">Hanya Soal yang Terfilter Saat Ini</span>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Menghapus {filteredCount} soal yang sesuai dengan kriteria filter pencarian aktif.
                    </p>
                  </div>
                </label>

                <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  scope === 'all' 
                    ? 'border-rose-500 bg-rose-50/50 text-slate-900' 
                    : 'border-slate-200 hover:border-slate-300 text-slate-700'
                }`}>
                  <input
                    type="radio"
                    name="delete_scope"
                    value="all"
                    checked={scope === 'all'}
                    onChange={() => setScope('all')}
                    className="mt-0.5 text-rose-600 focus:ring-rose-500"
                    disabled={isDeleting}
                  />
                  <div className="text-xs">
                    <span className="font-bold">Seluruh Soal di Bank Soal</span>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Menghapus total {totalCount} soal di seluruh kategori (UTS, UAS, Umum).
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {!isFilterActive && (
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 text-xs text-slate-700 space-y-1">
              <div className="flex justify-between">
                <span>Total Soal Akan Dihapus:</span>
                <span className="font-extrabold text-rose-600 text-sm">{totalCount} Soal</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Mencakup seluruh status (Aktif, Draft, dan Arsip).
              </p>
            </div>
          )}

          {/* Safety Typing Verification */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
              <span>Konfirmasi Keamanan:</span>
              <span className="text-[11px] font-normal text-slate-500">
                Ketik <span className="font-extrabold text-rose-600">HAPUS</span> di bawah
              </span>
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="Ketik HAPUS untuk mengonfirmasi"
              disabled={isDeleting}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 focus:border-rose-500 focus:bg-white rounded-xl text-xs font-mono font-bold tracking-wider uppercase text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 transition-all"
            />
          </div>

          {errorMsg && (
            <div className="text-xs font-semibold text-rose-600 bg-rose-50 p-2.5 rounded-xl border border-rose-200">
              {errorMsg}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!isConfirmed || isDeleting || targetCount === 0}
              className="px-4 py-2 bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-700 hover:to-red-800 text-white font-bold rounded-xl text-xs transition-all shadow-md shadow-rose-600/20 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isDeleting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Menghapus...</span>
                </>
              ) : (
                <>
                  <Trash2 size={14} />
                  <span>Hapus {targetCount} Soal Permanen</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeleteAllQuestionsModal;
