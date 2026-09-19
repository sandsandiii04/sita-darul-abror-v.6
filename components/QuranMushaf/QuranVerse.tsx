import React from 'react';
import { QuranVerse as IQuranVerse, QuranWord, QuranPosition } from '../../types';
import { BookOpen, Bookmark, FileText, CheckCircle2, Flag, Target } from 'lucide-react';
import { quranService, comparePositions, isPositionEqual, isPositionBetween } from '../../services/quranService';

interface QuranVerseProps {
  verses: IQuranVerse[];
  selectedVerseKey?: string;
  onSelectVerse?: (verse: IQuranVerse) => void;
  isLoading?: boolean;
  isBuilderActive?: boolean;
  promptStart?: QuranPosition;
  promptEnd?: QuranPosition;
  answerStart?: QuranPosition;
  answerEnd?: QuranPosition;
  onWordClick?: (word: QuranWord, verse: IQuranVerse) => void;
}

export const QuranVerse: React.FC<QuranVerseProps> = ({
  verses,
  selectedVerseKey,
  onSelectVerse,
  isLoading,
  isBuilderActive = false,
  promptStart,
  promptEnd,
  answerStart,
  answerEnd,
  onWordClick
}) => {
  const selectedVerse = verses.find(v => v.verseKey === selectedVerseKey) || verses[0];

  const getSurahName = (surahNum: number) => {
    return quranService.getSurah(surahNum)?.name || `Surat ${surahNum}`;
  };

  // Helper to determine styling of each word
  const getWordStatus = (word: QuranWord, verse: IQuranVerse) => {
    const pos: QuranPosition = {
      surahNumber: verse.surahNumber,
      ayahNumber: verse.ayahNumber,
      wordPosition: word.position,
      pageNumber: verse.pageNumber
    };

    const isStartPrompt = isPositionEqual(pos, promptStart);
    const isEndPrompt = isPositionEqual(pos, promptEnd);
    const inPromptRange = promptStart && promptEnd && isPositionBetween(pos, promptStart, promptEnd);

    const isStartAnswer = isPositionEqual(pos, answerStart);
    const isEndAnswer = isPositionEqual(pos, answerEnd);
    const inAnswerRange = answerStart && answerEnd && isPositionBetween(pos, answerStart, answerEnd);

    return {
      isStartPrompt,
      isEndPrompt,
      inPromptRange,
      isStartAnswer,
      isEndAnswer,
      inAnswerRange
    };
  };

  return (
    <div className="w-full space-y-4">
      {/* ================= PANEL INFORMASI AYAT TERPILIH ================= */}
      {selectedVerse && (
        <div className="bg-gradient-to-br from-emerald-900 to-teal-950 text-white p-5 rounded-2xl shadow-lg border border-emerald-800/40 relative overflow-hidden animate-fade-in">
          <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
          
          <div className="relative z-10 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/15 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2.5 py-1 rounded-lg font-bold text-xs">
                  QS. {getSurahName(selectedVerse.surahNumber)} : {selectedVerse.ayahNumber}
                </span>
                <span className="text-xs text-emerald-200 font-medium">
                  Juz {selectedVerse.juzNumber}
                </span>
              </div>
              <span className="text-xs text-emerald-300 font-mono bg-white/10 px-2.5 py-1 rounded-lg">
                Halaman {selectedVerse.pageNumber}
              </span>
            </div>

            {/* Teks Arab Uthmani Ayat Terpilih */}
            <div 
              dir="rtl"
              className="text-2xl md:text-3xl font-arabic text-emerald-50 leading-[2.2] text-right py-2 select-text font-normal"
            >
              {selectedVerse.textUthmani}
              <span className="inline-block mx-2 text-emerald-400 text-lg font-bold">
                ۝{selectedVerse.ayahNumber}
              </span>
            </div>

            <div className="text-[11px] text-emerald-300/80 flex items-center gap-1.5 pt-1">
              <CheckCircle2 size={13} className="text-emerald-400" />
              <span>
                {isBuilderActive
                  ? 'Mode penyusunan soal aktif. Klik pada kata-kata di bawah untuk memilih titik soal.'
                  : 'Ayat terpilih sebagai fokus bacaan dan fondasi evaluasi tahfiz'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ================= DAFTAR AYAT TERSTRUKTUR PADA HALAMAN ================= */}
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
          <h4 className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
            <FileText size={15} className="text-emerald-600" />
            <span>Teks Ayat Terstruktur Pada Halaman Ini ({verses.length} Ayat)</span>
          </h4>
          <span className="text-[10px] text-gray-400 font-medium">
            {isBuilderActive ? 'Klik / tap kata untuk memilih' : 'Klik ayat untuk melihat detail'}
          </span>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
            <span>Memuat struktur data ayat...</span>
          </div>
        ) : verses.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">
            Tidak ada data ayat pada halaman ini.
          </div>
        ) : (
          <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
            {verses.map((verse) => {
              const isSelected = selectedVerse?.verseKey === verse.verseKey;
              const surahName = getSurahName(verse.surahNumber);

              return (
                <div
                  key={verse.verseKey}
                  onClick={() => onSelectVerse && onSelectVerse(verse)}
                  className={`p-4 rounded-2xl border transition-all ${
                    isSelected
                      ? 'bg-emerald-50/50 border-emerald-300 shadow-sm'
                      : 'bg-gray-50/40 border-gray-100 hover:bg-gray-50 hover:border-gray-200'
                  }`}
                >
                  {/* Header Bar Ayat */}
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2.5">
                    <span className="font-bold text-emerald-800 bg-white px-2.5 py-0.5 rounded-lg border border-gray-200 text-[11px] shadow-2xs">
                      {surahName} : {verse.ayahNumber}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      Hal. {verse.pageNumber} • Juz {verse.juzNumber}
                    </span>
                  </div>

                  {/* Word-Level Representation (Interactive & Accessible) */}
                  <div 
                    dir="rtl"
                    className="text-2xl md:text-3xl font-arabic text-gray-900 leading-[2.4] text-right flex flex-wrap gap-x-2 gap-y-3 justify-start items-center select-text"
                  >
                    {verse.words && verse.words.length > 0 ? (
                      verse.words.map((w: QuranWord) => {
                        // If it's the ayah end symbol glyph
                        if (w.charTypeName === 'end') {
                          return (
                            <span 
                              key={`${verse.verseKey}-end-${w.position}`}
                              className="inline-block text-emerald-600 font-bold text-lg select-none px-1"
                            >
                              ۝{verse.ayahNumber}
                            </span>
                          );
                        }

                        const status = getWordStatus(w, verse);

                        // Highlight Class Hierarchy
                        let highlightClass = 'hover:bg-emerald-100/70 text-gray-800';
                        let markerBadge = null;

                        if (status.isStartPrompt) {
                          highlightClass = 'bg-blue-200 text-blue-950 font-bold border-2 border-blue-500 shadow-sm ring-2 ring-blue-300';
                          markerBadge = (
                            <span className="absolute -top-3 right-0 bg-blue-600 text-white text-[9px] font-extrabold px-1.5 py-0.2 rounded-full shadow-xs">
                              A
                            </span>
                          );
                        } else if (status.isEndPrompt) {
                          highlightClass = 'bg-blue-200 text-blue-950 font-bold border-2 border-blue-400 shadow-sm';
                          markerBadge = (
                            <span className="absolute -top-3 right-0 bg-blue-500 text-white text-[9px] font-extrabold px-1.5 py-0.2 rounded-full shadow-xs">
                              A'
                            </span>
                          );
                        } else if (status.inPromptRange) {
                          highlightClass = 'bg-blue-100 text-blue-900 border border-blue-200';
                        } else if (status.isStartAnswer) {
                          highlightClass = 'bg-emerald-600 text-white font-bold border-2 border-emerald-700 shadow-md ring-2 ring-emerald-300';
                          markerBadge = (
                            <span className="absolute -top-4 right-0 bg-emerald-800 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-full shadow-xs whitespace-nowrap">
                              B (Jawaban Mulai)
                            </span>
                          );
                        } else if (status.isEndAnswer) {
                          highlightClass = 'bg-amber-400 text-amber-950 font-bold border-2 border-amber-500 shadow-sm ring-2 ring-amber-300';
                          markerBadge = (
                            <span className="absolute -top-4 right-0 bg-amber-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-full shadow-xs whitespace-nowrap">
                              C (Batas Akhir)
                            </span>
                          );
                        } else if (status.inAnswerRange) {
                          highlightClass = 'bg-emerald-100 text-emerald-950 border border-emerald-200';
                        }

                        return (
                          <button
                            key={`${verse.verseKey}-w-${w.position}`}
                            type="button"
                            role="button"
                            tabIndex={0}
                            aria-label={`Pilih kata ke-${w.position} QS ${surahName} ayat ${verse.ayahNumber}: ${w.textUthmani}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onWordClick) {
                                onWordClick(w, verse);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                if (onWordClick) onWordClick(w, verse);
                              }
                            }}
                            className={`relative inline-flex items-center justify-center px-2 py-1 rounded-xl transition-all cursor-pointer select-text min-h-[38px] ${highlightClass}`}
                          >
                            {markerBadge}
                            <span>{w.textUthmani}</span>
                          </button>
                        );
                      })
                    ) : (
                      <span>{verse.textUthmani}</span>
                    )}

                    {/* Fallback Verse End Marker if not in words */}
                    {(!verse.words || !verse.words.some(w => w.charTypeName === 'end')) && (
                      <span className="inline-block text-emerald-600 text-base font-bold mx-1">
                        ۝{verse.ayahNumber}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default QuranVerse;

