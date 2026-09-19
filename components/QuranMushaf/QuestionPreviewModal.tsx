import React, { useState } from 'react';
import { QuestionDraft, QuranPosition, User } from '../../types';
import { RangeResult, RangeSegment } from '../../services/quranService';
import { 
  X, 
  Eye, 
  EyeOff, 
  RotateCcw, 
  Edit3, 
  CheckCircle2, 
  FileText, 
  BookOpen, 
  Layers, 
  HelpCircle, 
  Sparkles,
  ArrowRight,
  BookmarkPlus
} from 'lucide-react';

interface QuestionPreviewModalProps {
  isOpen: boolean;
  draft: QuestionDraft | null;
  rangeResult: RangeResult | null;
  user?: User;
  onClose: () => void;
  onEditPrompt: () => void;
  onEditAnswerStart: () => void;
  onEditAnswerEnd: () => void;
  onResetAll: () => void;
  onSaveToBankSoal?: () => void;
}

export const QuestionPreviewModal: React.FC<QuestionPreviewModalProps> = ({
  isOpen,
  draft,
  rangeResult,
  user,
  onClose,
  onEditPrompt,
  onEditAnswerStart,
  onEditAnswerEnd,
  onResetAll,
  onSaveToBankSoal
}) => {
  const [viewMode, setViewMode] = useState<'standard' | 'examiner'>('standard');
  const [showAnswerInSimulation, setShowAnswerInSimulation] = useState<boolean>(false);

  if (!isOpen || !draft) return null;

  const surahName = draft.surahName || `Surat ${draft.promptStart.surahNumber}`;
  const ayahPrompt = draft.promptStart.ayahNumber;
  const answerRangeDisplay = draft.crossesSurah
    ? `QS. ${surahName}:${draft.answerStart.ayahNumber} → QS. ${rangeResult?.segments[rangeResult.segments.length - 1]?.surahName || ''}:${draft.answerEnd.ayahNumber}`
    : draft.crossesAyah
    ? `${surahName}:${draft.answerStart.ayahNumber}–${draft.answerEnd.ayahNumber}`
    : `${surahName}:${draft.answerStart.ayahNumber}`;

  const modeLabels: Record<string, string> = {
    end_ayah: 'Sampai Akhir Ayat',
    '3_lines': 'Target 3 Baris',
    '5_lines': 'Target 5 Baris',
    specific_ayah: 'Sampai Ayat Tertentu',
    manual: 'Pilih Langsung (Manual Kata)'
  };

  // First word of answer
  const firstAnswerWord = rangeResult?.words[0]?.textUthmani || '...';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 animate-fade-in">
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
                Rancangan Soal Sambung Ayat
              </div>
              <h3 className="font-extrabold text-base sm:text-lg text-gray-800">
                {viewMode === 'standard' ? 'Preview Soal Al-Qur’an' : 'Simulasi Tampilan Penguji'}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle Mode Button */}
            <button
              type="button"
              onClick={() => {
                setViewMode(prev => prev === 'standard' ? 'examiner' : 'standard');
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
                {viewMode === 'standard' ? 'Preview Tampilan Penguji' : 'Kembali ke Preview Standar'}
              </span>
              <span className="sm:hidden">
                {viewMode === 'standard' ? 'Penguji' : 'Standar'}
              </span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white rounded-full transition-all"
              aria-label="Tutup preview"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {viewMode === 'standard' ? (
            /* ================= MODE PREVIEW STANDAR (ADMIN) ================= */
            <>
              {/* Surah & Ayah Badge */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50/60 p-3.5 rounded-2xl border border-emerald-100">
                <div>
                  <span className="text-xs text-emerald-700 font-semibold block">Fokus Soal:</span>
                  <span className="text-sm sm:text-base font-extrabold text-emerald-950">
                    QS. {surahName} : {ayahPrompt}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-gray-500 block">Metode Batas:</span>
                  <span className="text-xs font-bold text-gray-700 bg-white px-2.5 py-1 rounded-lg border border-gray-200">
                    {modeLabels[draft.answerMode] || draft.answerMode}
                  </span>
                </div>
              </div>

              {/* 1. Bagian Dibaca Penguji */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-blue-700">
                  <span className="w-5 h-5 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center text-[10px]">
                    A
                  </span>
                  <span>BAGIAN DIBACA PENGUJI (PROMPT)</span>
                </div>
                <div className="p-4 sm:p-5 rounded-2xl bg-blue-50/50 border border-blue-200 text-right">
                  <div 
                    dir="rtl"
                    className="text-2xl sm:text-3xl font-arabic text-blue-950 leading-[2.2] font-medium"
                  >
                    {draft.promptText}
                  </div>
                </div>
              </div>

              {/* 2. Santri Mulai Dari */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-emerald-700">
                  <span className="w-5 h-5 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-[10px]">
                    B
                  </span>
                  <span>SANTRI MULAI DARI</span>
                </div>
                <div className="p-3 sm:p-4 rounded-xl bg-emerald-50/50 border border-emerald-200 flex items-center justify-between">
                  <div className="text-xs font-medium text-emerald-900">
                    Kata awal yang harus dilanjutkan santri:
                  </div>
                  <div 
                    dir="rtl"
                    className="text-xl sm:text-2xl font-arabic text-emerald-950 font-bold px-3 py-1 bg-white rounded-lg border border-emerald-300 shadow-sm"
                  >
                    {firstAnswerWord}...
                  </div>
                </div>
              </div>

              {/* 3. Jawaban Lengkap (B -> C) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-emerald-800">
                    <CheckCircle2 size={15} className="text-emerald-600" />
                    <span>JAWABAN LENGKAP SANTRI (B → C)</span>
                  </div>
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-md">
                    {rangeResult?.words.length || 0} Kata
                  </span>
                </div>

                <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-emerald-50/40 via-white to-emerald-50/20 border border-emerald-200 text-right space-y-4">
                  {rangeResult && rangeResult.segments.length > 0 ? (
                    rangeResult.segments.map((seg, idx) => (
                      <div key={`seg-${seg.surahNumber}-${seg.ayahNumber}-${idx}`} className="space-y-2">
                        {/* New Surah Header if crossed */}
                        {seg.isNewSurah && (
                          <div className="py-2.5 my-3 bg-emerald-100 text-emerald-900 rounded-xl text-center border border-emerald-300">
                            <span className="font-bold text-xs uppercase tracking-wider block">
                              Surat Baru: QS. {seg.surahName}
                            </span>
                            {seg.showBasmalah && (
                              <div 
                                dir="rtl"
                                className="text-lg font-arabic text-emerald-950 pt-1"
                              >
                                بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ
                              </div>
                            )}
                          </div>
                        )}

                        <div 
                          dir="rtl"
                          className="text-2xl sm:text-3xl font-arabic text-emerald-950 leading-[2.3] font-normal"
                        >
                          {seg.textUthmani}
                          <span className="inline-block text-emerald-600 text-base font-bold mx-2">
                            ۝{seg.ayahNumber}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div 
                      dir="rtl"
                      className="text-2xl font-arabic text-emerald-950 leading-[2.2]"
                    >
                      {draft.answerText}
                    </div>
                  )}
                </div>
              </div>

              {/* 4. Detail Ringkasan */}
              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 text-xs space-y-2">
                <div className="font-extrabold text-gray-700 uppercase tracking-wider text-[11px] mb-2 flex items-center gap-1.5">
                  <FileText size={14} className="text-gray-500" />
                  <span>Detail Struktur Soal:</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 block text-[10px]">Surat</span>
                    <span className="font-bold text-gray-800">{surahName}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 block text-[10px]">Ayat Prompt</span>
                    <span className="font-bold text-blue-700">Ayat {ayahPrompt}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 block text-[10px]">Rentang Jawaban</span>
                    <span className="font-bold text-emerald-700">{answerRangeDisplay}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 block text-[10px]">Halaman Mushaf</span>
                    <span className="font-bold text-gray-800">
                      {draft.startPage === draft.endPage ? `Hal. ${draft.startPage}` : `Hal. ${draft.startPage}–${draft.endPage}`}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* ================= MODE SIMULASI PENGUJI ================= */
            <div className="space-y-5">
              <div className="bg-purple-50 border border-purple-200 p-4 rounded-2xl flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-extrabold uppercase text-purple-700 tracking-wider">
                    Simulasi Layar Penguji Ujian
                  </div>
                  <div className="text-sm font-extrabold text-purple-950 mt-0.5">
                    QS. {surahName} : Ayat {ayahPrompt}
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
                  {draft.promptText}
                </div>
                <p className="text-xs text-gray-400 italic">
                  Santri diharapkan menyambung bacaan dari titik B.
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
                        Kunci Jawaban Sambung Ayat ({rangeResult?.words.length || 0} Kata):
                      </span>
                      <span className="text-[10px] text-emerald-600 font-mono">
                        {answerRangeDisplay}
                      </span>
                    </div>

                    {rangeResult && rangeResult.segments.length > 0 ? (
                      rangeResult.segments.map((seg, idx) => (
                        <div key={`sim-seg-${seg.surahNumber}-${seg.ayahNumber}-${idx}`} className="space-y-2">
                          {seg.isNewSurah && (
                            <div className="py-2 my-2 bg-emerald-200 text-emerald-900 rounded-lg text-center font-bold text-xs">
                              Surat Baru: QS. {seg.surahName}
                            </div>
                          )}
                          <div 
                            dir="rtl"
                            className="text-2xl sm:text-3xl font-arabic text-emerald-950 leading-[2.3]"
                          >
                            {seg.textUthmani}
                            <span className="inline-block text-emerald-600 text-base font-bold mx-2">
                              ۝{seg.ayahNumber}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div 
                        dir="rtl"
                        className="text-2xl font-arabic text-emerald-950 leading-[2.2]"
                      >
                        {draft.answerText}
                      </div>
                    )}
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

        {/* Footer Action Bar */}
        <div className="p-4 sm:p-5 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onEditPrompt();
                onClose();
              }}
              className="px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition-all flex items-center gap-1.5 shadow-sm"
              title="Ubah titik prompt"
            >
              <Edit3 size={13} className="text-blue-600" />
              <span>Ubah Prompt</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onEditAnswerStart();
                onClose();
              }}
              className="px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition-all flex items-center gap-1.5 shadow-sm"
              title="Ubah titik B"
            >
              <Edit3 size={13} className="text-emerald-600" />
              <span>Ubah Titik Jawaban</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onEditAnswerEnd();
                onClose();
              }}
              className="px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition-all flex items-center gap-1.5 shadow-sm"
              title="Ubah titik C"
            >
              <Edit3 size={13} className="text-amber-600" />
              <span>Ubah Batas Jawaban</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (window.confirm('Reset semua titik pilihan soal ini?')) {
                  onResetAll();
                  onClose();
                }
              }}
              className="px-3 py-1.5 bg-white hover:bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-200 transition-all flex items-center gap-1.5 shadow-sm"
              title="Reset seluruh pilihan"
            >
              <RotateCcw size={13} />
              <span>Reset Semua</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {user?.role === 'admin' && onSaveToBankSoal && (
              <button
                type="button"
                onClick={onSaveToBankSoal}
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5"
              >
                <BookmarkPlus size={15} />
                <span>Simpan ke Bank Soal</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition-all shadow-sm"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuestionPreviewModal;
