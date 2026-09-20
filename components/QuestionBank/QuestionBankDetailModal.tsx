import React, { useState } from 'react';
import { QuestionBankItem } from '../../types';
import { quranService } from '../../services/quranService';
import { 
  X, 
  Eye, 
  EyeOff, 
  Edit3, 
  Copy, 
  Archive, 
  RotateCcw, 
  Sparkles, 
  BookOpen, 
  FileText, 
  Layers, 
  Compass,
  CheckCircle2,
  Tag as TagIcon,
  Trash2
} from 'lucide-react';

interface QuestionBankDetailModalProps {
  isOpen: boolean;
  item: QuestionBankItem | null;
  onClose: () => void;
  onEditMetadata: (item: QuestionBankItem) => void;
  onEditFromMushaf: (item: QuestionBankItem) => void;
  onDuplicate: (item: QuestionBankItem) => void;
  onArchive: (item: QuestionBankItem) => void;
  onRestore: (item: QuestionBankItem) => void;
  onDelete?: (item: QuestionBankItem) => void;
}

export const QuestionBankDetailModal: React.FC<QuestionBankDetailModalProps> = ({
  isOpen,
  item,
  onClose,
  onEditMetadata,
  onEditFromMushaf,
  onDuplicate,
  onArchive,
  onRestore,
  onDelete
}) => {
  const [viewMode, setViewMode] = useState<'detail' | 'examiner'>('detail');
  const [showAnswerInSimulation, setShowAnswerInSimulation] = useState<boolean>(false);

  if (!isOpen || !item) return null;

  const surahName = quranService.getSurah(item.promptStart.surahNumber)?.name || `Surat ${item.promptStart.surahNumber}`;
  const endSurahName = quranService.getSurah(item.answerEnd.surahNumber)?.name || `Surat ${item.answerEnd.surahNumber}`;

  const difficultyLabels: Record<string, { label: string; color: string }> = {
    easy: { label: 'Mudah', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    medium: { label: 'Sedang', color: 'bg-blue-100 text-blue-800 border-blue-200' },
    hard: { label: 'Sulit', color: 'bg-rose-100 text-rose-800 border-rose-200' }
  };

  const examTypeLabels: Record<string, string> = {
    generic: 'Umum',
    uts: 'UTS',
    uas: 'UAS'
  };

  const questionTypeLabels: Record<string, string> = {
    random: 'Acak',
    mandatory: 'Wajib'
  };

  const isCrossSurah = item.promptStart.surahNumber !== item.answerEnd.surahNumber;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-gray-900/65 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden z-10 flex flex-col max-h-[92vh]">
        {/* Header Bar */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-emerald-50/70 to-teal-50/70">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-emerald-600 text-white rounded-xl shadow-sm">
              <BookOpen size={18} />
            </span>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800">
                Bank Soal Tahfiz
              </div>
              <h3 className="font-extrabold text-base sm:text-lg text-gray-800">
                {viewMode === 'detail' ? `Detail Soal: QS. ${surahName} : ${item.promptStart.ayahNumber}` : 'Simulasi Tampilan Penguji'}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle Examiner Simulation */}
            <button
              type="button"
              onClick={() => {
                setViewMode(prev => prev === 'detail' ? 'examiner' : 'detail');
                setShowAnswerInSimulation(false);
              }}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm ${
                viewMode === 'examiner'
                  ? 'bg-purple-600 hover:bg-purple-700 text-white ring-2 ring-purple-300'
                  : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
              }`}
            >
              <Sparkles size={14} />
              <span className="hidden sm:inline">
                {viewMode === 'detail' ? 'Preview sebagai Penguji' : 'Kembali ke Detail'}
              </span>
              <span className="sm:hidden">
                {viewMode === 'detail' ? 'Penguji' : 'Detail'}
              </span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white rounded-full transition-all"
              aria-label="Tutup detail soal"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-xs">
          {viewMode === 'detail' ? (
            /* ================= DETAIL VIEW ================= */
            <>
              {/* Badges Overview */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50/50 p-3.5 rounded-2xl border border-emerald-100">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 font-bold text-gray-700">
                    {questionTypeLabels[item.questionType] || item.questionType}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 font-bold text-gray-700">
                    {examTypeLabels[item.examType] || item.examType}
                  </span>
                  <span className={`px-2.5 py-1 rounded-lg font-bold border ${difficultyLabels[item.difficulty]?.color || 'bg-gray-100 text-gray-700'}`}>
                    {difficultyLabels[item.difficulty]?.label || item.difficulty}
                  </span>
                  <span className={`px-2.5 py-1 rounded-lg font-bold ${
                    item.status === 'active' 
                      ? 'bg-emerald-600 text-white' 
                      : item.status === 'archived'
                      ? 'bg-gray-400 text-white'
                      : 'bg-amber-500 text-white'
                  }`}>
                    {item.status === 'active' ? 'Aktif' : item.status === 'archived' ? 'Arsip' : 'Draft'}
                  </span>
                </div>

                <div className="text-[11px] text-gray-400 font-mono">
                  ID: {item.id}
                </div>
              </div>

              {/* 1. Prompt Penguji */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-blue-700">
                  <span className="w-5 h-5 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center text-[10px]">
                    A
                  </span>
                  <span>PROMPT PENGUJI</span>
                </div>
                <div className="p-4 sm:p-5 rounded-2xl bg-blue-50/40 border border-blue-200 text-right">
                  <div 
                    dir="rtl"
                    className="text-2xl sm:text-3xl font-arabic text-blue-950 leading-[2.3] font-medium"
                  >
                    {item.promptText}
                  </div>
                </div>
              </div>

              {/* 2. Jawaban Lengkap (B -> C) */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-emerald-800">
                  <CheckCircle2 size={15} className="text-emerald-600" />
                  <span>JAWABAN LENGKAP SANTRI (B → C)</span>
                </div>
                <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50/40 border border-emerald-200 text-right">
                  <div 
                    dir="rtl"
                    className="text-2xl sm:text-3xl font-arabic text-emerald-950 leading-[2.3] font-normal"
                  >
                    {item.answerText}
                  </div>
                </div>
              </div>

              {/* 3. Posisi Struktural Al-Qur'an (Source of Truth) */}
              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-gray-600 uppercase tracking-wider">
                  <Compass size={14} className="text-gray-400" />
                  <span>Posisi Al-Qur'an (Source of Truth):</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="bg-white p-3 rounded-xl border border-gray-100 space-y-1">
                    <span className="text-[10px] text-blue-600 font-bold block uppercase">Prompt Penguji</span>
                    <div className="font-bold text-gray-800">
                      QS. {surahName} : {item.promptStart.ayahNumber}
                    </div>
                    <div className="text-[11px] text-gray-500 font-mono">
                      Kata ke-{item.promptStart.wordPosition} → ke-{item.promptEnd.wordPosition}
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-gray-100 space-y-1">
                    <span className="text-[10px] text-emerald-600 font-bold block uppercase">Jawaban Santri</span>
                    <div className="font-bold text-gray-800">
                      {isCrossSurah
                        ? `QS. ${surahName}:${item.answerStart.ayahNumber} → QS. ${endSurahName}:${item.answerEnd.ayahNumber}`
                        : `QS. ${surahName}:${item.answerStart.ayahNumber}–${item.answerEnd.ayahNumber}`}
                    </div>
                    <div className="text-[11px] text-gray-500 font-mono">
                      Mulai Kata ke-{item.answerStart.wordPosition} → Batas Kata ke-{item.answerEnd.wordPosition}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-gray-200/60 text-[11px] text-gray-500">
                  <span>Halaman Mushaf: <strong>Hal. {item.startPage === item.endPage ? item.startPage : `${item.startPage}–${item.endPage}`}</strong></span>
                  <span>Juz: <strong>Juz {item.startJuz === item.endJuz ? item.startJuz : `${item.startJuz}–${item.endJuz}`}</strong></span>
                  <span>Metode: <strong>{item.answerMode}</strong></span>
                </div>
              </div>

              {/* 4. Tags & Catatan */}
              <div className="space-y-2">
                {item.tags && item.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TagIcon size={13} className="text-gray-400" />
                    {item.tags.map(t => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-[10px] font-semibold"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {item.notes && (
                  <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-amber-900 text-xs">
                    <strong className="block text-[10px] text-amber-700 uppercase font-extrabold mb-0.5">Catatan Penguji:</strong>
                    <span>{item.notes}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ================= SIMULASI PENGUJI ================= */
            <div className="space-y-5">
              <div className="bg-purple-50 border border-purple-200 p-4 rounded-2xl flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-extrabold uppercase text-purple-700 tracking-wider">
                    Simulasi Layar Penguji Ujian
                  </div>
                  <div className="text-sm font-extrabold text-purple-950 mt-0.5">
                    QS. {surahName} : Ayat {item.promptStart.ayahNumber}
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-white text-purple-700 rounded-lg text-xs font-bold border border-purple-200 shadow-sm">
                  Mode Penguji
                </span>
              </div>

              {/* Prompt Card */}
              <div className="p-5 sm:p-6 rounded-2xl bg-white border-2 border-blue-200 shadow-sm text-center space-y-3">
                <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-extrabold text-xs tracking-wider">
                  BACAKAN KEPADA SANTRI:
                </span>
                <div 
                  dir="rtl"
                  className="text-3xl sm:text-4xl font-arabic text-blue-950 leading-[2.3] py-2"
                >
                  {item.promptText}
                </div>
                <p className="text-xs text-gray-400 italic">
                  Santri melanjutkan dari titik B (kata pertama jawaban).
                </p>
              </div>

              {/* Answer Card with Peek Toggle */}
              <div className="space-y-3">
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowAnswerInSimulation(prev => !prev)}
                    className={`px-5 py-2.5 rounded-2xl font-bold text-xs flex items-center gap-2 transition-all shadow-md ${
                      showAnswerInSimulation
                        ? 'bg-amber-600 hover:bg-amber-700 text-white ring-2 ring-amber-300'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-300'
                    }`}
                  >
                    {showAnswerInSimulation ? (
                      <>
                        <EyeOff size={16} />
                        <span>🙈 Sembunyikan Jawaban</span>
                      </>
                    ) : (
                      <>
                        <Eye size={16} />
                        <span>👁 Tampilkan Jawaban Acuan</span>
                      </>
                    )}
                  </button>
                </div>

                {showAnswerInSimulation ? (
                  <div className="p-5 sm:p-6 rounded-2xl bg-emerald-50/70 border border-emerald-300 text-right space-y-3 animate-fade-in">
                    <div className="flex items-center justify-between border-b border-emerald-200 pb-2">
                      <span className="text-xs font-bold text-emerald-800">
                        Kunci Jawaban Sambung Ayat:
                      </span>
                      <span className="text-[10px] text-emerald-600 font-mono">
                        QS. {surahName}
                      </span>
                    </div>

                    <div 
                      dir="rtl"
                      className="text-2xl sm:text-3xl font-arabic text-emerald-950 leading-[2.3]"
                    >
                      {item.answerText}
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-300 text-gray-400 text-xs">
                    Jawaban acuan sedang disembunyikan. Tekan tombol di atas untuk membuka kunci jawaban saat menguji santri.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onEditMetadata(item);
                onClose();
              }}
              className="px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition-all flex items-center gap-1.5 shadow-sm"
              title="Edit metadata (jenis, kesulitan, tag, catatan)"
            >
              <Edit3 size={13} className="text-blue-600" />
              <span>Edit Metadata</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onEditFromMushaf(item);
                onClose();
              }}
              className="px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition-all flex items-center gap-1.5 shadow-sm"
              title="Ubah titik A-B-C langsung dari Mushaf Digital"
            >
              <Compass size={13} className="text-emerald-600" />
              <span>Edit Titik dari Mushaf</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onDuplicate(item);
                onClose();
              }}
              className="px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition-all flex items-center gap-1.5 shadow-sm"
              title="Duplikasi soal ini menjadi draft baru"
            >
              <Copy size={13} className="text-purple-600" />
              <span>Duplikasi</span>
            </button>

            {item.status === 'archived' ? (
              <button
                type="button"
                onClick={() => {
                  onRestore(item);
                  onClose();
                }}
                className="px-3 py-1.5 bg-white hover:bg-emerald-50 text-emerald-700 text-xs font-bold rounded-xl border border-emerald-200 transition-all flex items-center gap-1.5 shadow-sm"
                title="Pulihkan soal dari arsip"
              >
                <RotateCcw size={13} />
                <span>Pulihkan</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Arsipkan soal ini? Soal yang diarsipkan tidak akan muncul di daftar Aktif.')) {
                    onArchive(item);
                    onClose();
                  }
                }}
                className="px-3 py-1.5 bg-white hover:bg-amber-50 text-amber-700 text-xs font-bold rounded-xl border border-amber-200 transition-all flex items-center gap-1.5 shadow-sm"
                title="Arsipkan soal"
              >
                <Archive size={13} />
                <span>Arsipkan</span>
              </button>
            )}

            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Hapus soal ini secara permanen dari Bank Soal? Tindakan ini tidak dapat dibatalkan.')) {
                    onDelete(item);
                    onClose();
                  }
                }}
                className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-600 text-xs font-bold rounded-xl border border-rose-200 transition-all flex items-center gap-1.5 shadow-sm"
                title="Hapus soal permanen"
              >
                <Trash2 size={13} />
                <span>Hapus</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuestionBankDetailModal;
