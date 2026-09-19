import React from 'react';
import { QuranWord, QuranPosition } from '../../types';
import { X, Sparkles, Check, ArrowRight, CornerDownLeft, Target, Flag } from 'lucide-react';
import { comparePositions } from '../../services/quranService';

interface WordActionSheetProps {
  word: QuranWord | null;
  surahName: string;
  isOpen: boolean;
  currentStep: 'prompt_start' | 'prompt_end' | 'answer_start' | 'answer_end' | 'complete';
  promptStart?: QuranPosition;
  promptEnd?: QuranPosition;
  answerStart?: QuranPosition;
  answerEnd?: QuranPosition;
  onSetAsPromptStart: (word: QuranWord) => void;
  onSetAsPromptEnd: (word: QuranWord) => void;
  onSetAsAnswerStart: (word: QuranWord) => void;
  onSetAsAnswerEnd: (word: QuranWord) => void;
  onClose: () => void;
}

export const WordActionSheet: React.FC<WordActionSheetProps> = ({
  word,
  surahName,
  isOpen,
  currentStep,
  promptStart,
  promptEnd,
  answerStart,
  answerEnd,
  onSetAsPromptStart,
  onSetAsPromptEnd,
  onSetAsAnswerStart,
  onSetAsAnswerEnd,
  onClose
}) => {
  if (!isOpen || !word) return null;

  const currentWordPos: QuranPosition = {
    surahNumber: word.surahNumber,
    ayahNumber: word.ayahNumber,
    wordPosition: word.position,
    pageNumber: word.pageNumber
  };

  // Validations for button states
  const canSetAsPromptEnd = !!promptStart && comparePositions(currentWordPos, promptStart) >= 0;
  const canSetAsAnswerStart = !promptEnd || comparePositions(currentWordPos, promptEnd) > 0;
  const canSetAsAnswerEnd = !!answerStart && comparePositions(currentWordPos, answerStart) >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal / Bottom Sheet */}
      <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-100 overflow-hidden z-10 flex flex-col max-h-[90vh]">
        {/* Handle bar on mobile */}
        <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto my-2.5 sm:hidden" />

        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="font-extrabold text-sm text-gray-800 tracking-tight">
              Tentukan Titik Soal dari Kata
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-all"
            aria-label="Tutup pilihan kata"
          >
            <X size={18} />
          </button>
        </div>

        {/* Word Display Box */}
        <div className="p-5 bg-gradient-to-br from-emerald-50 via-teal-50/50 to-white text-center border-b border-gray-100">
          <div className="inline-block px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-[11px] font-bold mb-2">
            QS. {surahName} : {word.ayahNumber} • Kata ke-{word.position}
          </div>
          
          <div 
            dir="rtl"
            className="text-4xl md:text-5xl font-arabic text-emerald-950 font-medium py-3 text-center"
          >
            {word.textUthmani}
          </div>

          {word.translation && (
            <p className="text-xs text-gray-500 italic mt-1 max-w-md mx-auto">
              "{word.translation}"
            </p>
          )}
        </div>

        {/* Action Options */}
        <div className="p-4 sm:p-5 space-y-2.5 overflow-y-auto">
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1">
            Pilih Peran Kata Ini:
          </div>

          {/* Action 1: Awal Prompt (A) */}
          <button
            type="button"
            onClick={() => {
              onSetAsPromptStart(word);
              onClose();
            }}
            className={`w-full p-3.5 rounded-2xl flex items-center justify-between border transition-all text-left ${
              currentStep === 'prompt_start'
                ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-300'
                : 'bg-white hover:bg-blue-50/60 border-gray-200 text-gray-800'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className={`w-8 h-8 rounded-xl font-bold flex items-center justify-center text-sm ${
                currentStep === 'prompt_start' ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'
              }`}>
                A
              </span>
              <div>
                <div className="font-bold text-sm">Tetapkan sebagai Awal Prompt (A)</div>
                <div className={`text-[11px] ${currentStep === 'prompt_start' ? 'text-blue-100' : 'text-gray-500'}`}>
                  Mulai bacaan penguji dari kata ini
                </div>
              </div>
            </div>
            <ArrowRight size={18} className={currentStep === 'prompt_start' ? 'text-white' : 'text-gray-400'} />
          </button>

          {/* Action 2: Akhir Prompt */}
          <button
            type="button"
            disabled={!canSetAsPromptEnd}
            onClick={() => {
              onSetAsPromptEnd(word);
              onClose();
            }}
            className={`w-full p-3.5 rounded-2xl flex items-center justify-between border transition-all text-left ${
              !canSetAsPromptEnd
                ? 'opacity-40 bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                : currentStep === 'prompt_end'
                ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-300'
                : 'bg-white hover:bg-blue-50/60 border-gray-200 text-gray-800'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className={`w-8 h-8 rounded-xl font-bold flex items-center justify-center text-sm ${
                currentStep === 'prompt_end' ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'
              }`}>
                A'
              </span>
              <div>
                <div className="font-bold text-sm">Tetapkan sebagai Akhir Prompt</div>
                <div className={`text-[11px] ${currentStep === 'prompt_end' ? 'text-blue-100' : 'text-gray-500'}`}>
                  Batas akhir potongan bacaan penguji
                </div>
              </div>
            </div>
            <CornerDownLeft size={18} className={currentStep === 'prompt_end' ? 'text-white' : 'text-gray-400'} />
          </button>

          {/* Action 3: Awal Jawaban (B) */}
          <button
            type="button"
            disabled={!canSetAsAnswerStart}
            onClick={() => {
              onSetAsAnswerStart(word);
              onClose();
            }}
            className={`w-full p-3.5 rounded-2xl flex items-center justify-between border transition-all text-left ${
              !canSetAsAnswerStart
                ? 'opacity-40 bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                : currentStep === 'answer_start'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-300'
                : 'bg-white hover:bg-emerald-50/60 border-gray-200 text-gray-800'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className={`w-8 h-8 rounded-xl font-bold flex items-center justify-center text-sm ${
                currentStep === 'answer_start' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'
              }`}>
                B
              </span>
              <div>
                <div className="font-bold text-sm">Tetapkan sebagai Awal Jawaban (B)</div>
                <div className={`text-[11px] ${currentStep === 'answer_start' ? 'text-emerald-100' : 'text-gray-500'}`}>
                  Titik santri mulai menjawab bacaan
                </div>
              </div>
            </div>
            <Target size={18} className={currentStep === 'answer_start' ? 'text-white' : 'text-gray-400'} />
          </button>

          {/* Action 4: Batas Akhir Jawaban (C) */}
          <button
            type="button"
            disabled={!canSetAsAnswerEnd}
            onClick={() => {
              onSetAsAnswerEnd(word);
              onClose();
            }}
            className={`w-full p-3.5 rounded-2xl flex items-center justify-between border transition-all text-left ${
              !canSetAsAnswerEnd
                ? 'opacity-40 bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                : currentStep === 'answer_end'
                ? 'bg-amber-500 text-white border-amber-500 shadow-md ring-2 ring-amber-300'
                : 'bg-white hover:bg-amber-50/60 border-gray-200 text-gray-800'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className={`w-8 h-8 rounded-xl font-bold flex items-center justify-center text-sm ${
                currentStep === 'answer_end' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
              }`}>
                C
              </span>
              <div>
                <div className="font-bold text-sm">Tetapkan sebagai Akhir Jawaban (C)</div>
                <div className={`text-[11px] ${currentStep === 'answer_end' ? 'text-amber-100' : 'text-gray-500'}`}>
                  Batas akhir panjang jawaban santri
                </div>
              </div>
            </div>
            <Flag size={18} className={currentStep === 'answer_end' ? 'text-white' : 'text-gray-400'} />
          </button>

          {/* Cancel */}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 mt-1 text-center font-bold text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-all"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  );
};

export default WordActionSheet;
