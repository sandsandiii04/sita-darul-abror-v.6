import React, { useState } from 'react';
import { QuranPosition } from '../../types';
import { 
  Sparkles, 
  Check, 
  ArrowRight, 
  RotateCcw, 
  Edit3, 
  Eye, 
  AlertCircle, 
  X, 
  ChevronRight, 
  CheckCircle2, 
  Compass,
  FileCheck,
  ListOrdered
} from 'lucide-react';

interface QuestionBuilderProps {
  isActive: boolean;
  currentStep: 'prompt_start' | 'prompt_end' | 'answer_start' | 'answer_end' | 'complete';
  promptStart?: QuranPosition;
  promptEnd?: QuranPosition;
  answerStart?: QuranPosition;
  answerEnd?: QuranPosition;
  answerMode: 'end_ayah' | '3_lines' | '5_lines' | 'specific_ayah' | 'manual';
  promptText: string;
  answerText: string;
  errorMessage?: string | null;
  onUseNextWordAsB: () => void;
  onSelectBManual: () => void;
  onChangeAnswerMode: (mode: 'end_ayah' | '3_lines' | '5_lines' | 'specific_ayah' | 'manual') => void;
  onApplySpecificAyah: (targetAyah: number) => void;
  onOpenPreview: () => void;
  onEditPrompt: () => void;
  onEditAnswerStart: () => void;
  onEditAnswerEnd: () => void;
  onResetAll: () => void;
  onExitBuilder: () => void;
}

export const QuestionBuilder: React.FC<QuestionBuilderProps> = ({
  isActive,
  currentStep,
  promptStart,
  promptEnd,
  answerStart,
  answerEnd,
  answerMode,
  promptText,
  answerText,
  errorMessage,
  onUseNextWordAsB,
  onSelectBManual,
  onChangeAnswerMode,
  onApplySpecificAyah,
  onOpenPreview,
  onEditPrompt,
  onEditAnswerStart,
  onEditAnswerEnd,
  onResetAll,
  onExitBuilder
}) => {
  const [specificAyahInput, setSpecificAyahInput] = useState<string>('');
  const [showSpecificInput, setShowSpecificInput] = useState<boolean>(false);

  if (!isActive) return null;

  const isPromptDone = !!promptStart && !!promptEnd;
  const isAnswerStartDone = !!answerStart;
  const isAnswerEndDone = !!answerEnd;
  const isAllDone = isPromptDone && isAnswerStartDone && isAnswerEndDone;

  const handleSpecificAyahSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ayahNum = parseInt(specificAyahInput, 10);
    if (!isNaN(ayahNum) && ayahNum > 0) {
      onApplySpecificAyah(ayahNum);
      setShowSpecificInput(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-md border-2 border-emerald-500/80 p-4 sm:p-5 space-y-4 animate-fade-in">
      {/* Top Banner Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full">
                Question Builder Mode
              </span>
              <span className="text-xs font-bold text-gray-800">
                Mode Penyusunan Soal Aktif
              </span>
            </div>
            <p className="text-[11px] text-gray-500">
              Klik/tap kata pada teks Al-Qur'an untuk menyusun potongan bacaan A, B, dan C.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAllDone && (
            <button
              type="button"
              onClick={onOpenPreview}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 animate-pulse"
            >
              <Eye size={14} />
              <span>Preview Soal</span>
            </button>
          )}

          <button
            type="button"
            onClick={onExitBuilder}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
            title="Keluar dari mode penyusunan soal"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Error Message Toast */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl flex items-center gap-2 text-xs animate-shake">
          <AlertCircle size={16} className="shrink-0 text-red-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Progress Steps Overview */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        {/* Step 1: Prompt */}
        <div className={`p-2.5 rounded-xl border transition-all ${
          isPromptDone
            ? 'bg-blue-50 border-blue-300 text-blue-900 font-bold'
            : currentStep === 'prompt_start' || currentStep === 'prompt_end'
            ? 'bg-blue-50/50 border-blue-400 ring-1 ring-blue-300 text-blue-900 font-bold'
            : 'bg-gray-50 border-gray-100 text-gray-400'
        }`}>
          <div className="flex items-center justify-center gap-1">
            <span>Prompt (A)</span>
            {isPromptDone && <Check size={13} className="text-blue-600" />}
          </div>
          <div className="text-[10px] text-gray-500 truncate mt-0.5 font-normal">
            {isPromptDone ? 'Selesai ✓' : promptStart ? 'Pilih Akhir A' : 'Pilih Awal A'}
          </div>
        </div>

        {/* Step 2: Jawaban Mulai (B) */}
        <div className={`p-2.5 rounded-xl border transition-all ${
          isAnswerStartDone
            ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-bold'
            : currentStep === 'answer_start'
            ? 'bg-emerald-50/50 border-emerald-400 ring-1 ring-emerald-300 text-emerald-900 font-bold'
            : 'bg-gray-50 border-gray-100 text-gray-400'
        }`}>
          <div className="flex items-center justify-center gap-1">
            <span>Mulai Jawaban (B)</span>
            {isAnswerStartDone && <Check size={13} className="text-emerald-600" />}
          </div>
          <div className="text-[10px] text-gray-500 truncate mt-0.5 font-normal">
            {isAnswerStartDone ? 'Selesai ✓' : isPromptDone ? 'Tentukan Titik B' : 'Menunggu Prompt'}
          </div>
        </div>

        {/* Step 3: Batas Akhir (C) */}
        <div className={`p-2.5 rounded-xl border transition-all ${
          isAnswerEndDone
            ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold'
            : currentStep === 'answer_end'
            ? 'bg-amber-50/50 border-amber-400 ring-1 ring-amber-300 text-amber-900 font-bold'
            : 'bg-gray-50 border-gray-100 text-gray-400'
        }`}>
          <div className="flex items-center justify-center gap-1">
            <span>Batas Akhir (C)</span>
            {isAnswerEndDone && <Check size={13} className="text-amber-600" />}
          </div>
          <div className="text-[10px] text-gray-500 truncate mt-0.5 font-normal">
            {isAnswerEndDone ? 'Selesai ✓' : isAnswerStartDone ? 'Tentukan Batas C' : 'Menunggu Titik B'}
          </div>
        </div>
      </div>

      {/* Active Guidance Box */}
      <div className="bg-gray-50/80 p-3.5 rounded-xl border border-gray-200">
        {!promptStart ? (
          <div className="flex items-center gap-2.5 text-xs text-gray-700">
            <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0">
              1
            </span>
            <span>
              <strong>Langkah 1:</strong> Klik/tap <strong>kata pertama</strong> yang akan dibaca oleh penguji (Titik A).
            </span>
          </div>
        ) : !promptEnd ? (
          <div className="flex items-center gap-2.5 text-xs text-gray-700">
            <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0">
              2
            </span>
            <span>
              <strong>Titik A dipilih!</strong> Sekarang klik kata terakhir potongan prompt penguji.
            </span>
          </div>
        ) : !answerStart ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-emerald-900 font-bold">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span>Prompt selesai dipilih! Tentukan titik santri mulai menjawab (Titik B):</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={onUseNextWordAsB}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs transition-all shadow-sm flex items-center gap-1"
              >
                <span>Gunakan kata berikutnya sebagai awal jawaban (Default)</span>
                <ArrowRight size={13} />
              </button>
              <button
                type="button"
                onClick={onSelectBManual}
                className="px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded-lg font-bold text-xs transition-all"
              >
                Pilih awal jawaban manual
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <Compass size={15} className="text-emerald-600" />
                <span>Batas Akhir Jawaban Santri (Titik C):</span>
              </div>
              <span className="text-[10px] text-gray-400 font-medium">
                Pilih opsi di bawah atau klik langsung kata terakhir di teks mushaf
              </span>
            </div>

            {/* Answer Mode Buttons */}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onChangeAnswerMode('end_ayah')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  answerMode === 'end_ayah'
                    ? 'bg-amber-500 text-white shadow-sm ring-1 ring-amber-300'
                    : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
                }`}
              >
                Sampai Akhir Ayat
              </button>

              <button
                type="button"
                onClick={() => onChangeAnswerMode('3_lines')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  answerMode === '3_lines'
                    ? 'bg-amber-500 text-white shadow-sm ring-1 ring-amber-300'
                    : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
                }`}
              >
                Target 3 Baris
              </button>

              <button
                type="button"
                onClick={() => onChangeAnswerMode('5_lines')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  answerMode === '5_lines'
                    ? 'bg-amber-500 text-white shadow-sm ring-1 ring-amber-300'
                    : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
                }`}
              >
                Target 5 Baris
              </button>

              <button
                type="button"
                onClick={() => {
                  onChangeAnswerMode('specific_ayah');
                  setShowSpecificInput(prev => !prev);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  answerMode === 'specific_ayah'
                    ? 'bg-amber-500 text-white shadow-sm ring-1 ring-amber-300'
                    : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
                }`}
              >
                Sampai Ayat Tertentu...
              </button>

              <button
                type="button"
                onClick={() => onChangeAnswerMode('manual')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  answerMode === 'manual'
                    ? 'bg-amber-500 text-white shadow-sm ring-1 ring-amber-300'
                    : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
                }`}
              >
                Pilih Langsung dari Teks
              </button>
            </div>

            {/* Sub-form for Specific Ayah */}
            {showSpecificInput && (
              <form onSubmit={handleSpecificAyahSubmit} className="flex items-center gap-2 pt-1">
                <input
                  type="number"
                  min={answerStart.ayahNumber}
                  value={specificAyahInput}
                  onChange={e => setSpecificAyahInput(e.target.value)}
                  placeholder={`Nomor ayat (misal: ${answerStart.ayahNumber + 1})`}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs w-56 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-all"
                >
                  Terapkan Batas
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-gray-100">
        <div className="flex flex-wrap items-center gap-1.5">
          {promptStart && (
            <button
              type="button"
              onClick={onEditPrompt}
              className="px-2.5 py-1 bg-white hover:bg-gray-100 text-gray-600 text-[11px] font-bold rounded-lg border border-gray-200 transition-all flex items-center gap-1"
            >
              <Edit3 size={12} className="text-blue-600" />
              <span>Ubah Prompt</span>
            </button>
          )}

          {answerStart && (
            <button
              type="button"
              onClick={onEditAnswerStart}
              className="px-2.5 py-1 bg-white hover:bg-gray-100 text-gray-600 text-[11px] font-bold rounded-lg border border-gray-200 transition-all flex items-center gap-1"
            >
              <Edit3 size={12} className="text-emerald-600" />
              <span>Ubah Titik Jawaban</span>
            </button>
          )}

          {answerEnd && (
            <button
              type="button"
              onClick={onEditAnswerEnd}
              className="px-2.5 py-1 bg-white hover:bg-gray-100 text-gray-600 text-[11px] font-bold rounded-lg border border-gray-200 transition-all flex items-center gap-1"
            >
              <Edit3 size={12} className="text-amber-600" />
              <span>Ubah Batas Jawaban</span>
            </button>
          )}

          {(promptStart || answerStart || answerEnd) && (
            <button
              type="button"
              onClick={onResetAll}
              className="px-2.5 py-1 bg-white hover:bg-red-50 text-red-600 text-[11px] font-bold rounded-lg border border-red-200 transition-all flex items-center gap-1"
            >
              <RotateCcw size={12} />
              <span>Reset Semua</span>
            </button>
          )}
        </div>

        {isAllDone && (
          <button
            type="button"
            onClick={onOpenPreview}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
          >
            <Eye size={14} />
            <span>Lihat Preview Soal Lengkap</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default QuestionBuilder;
