import React from 'react';
import { ChevronLeft, ChevronRight, BookOpen, Layers, Bookmark } from 'lucide-react';
import { quranService } from '../../services/quranService';

interface MushafNavigationProps {
  currentPage: number;
  currentJuz: number;
  currentSurahNumber?: number;
  onPageChange: (newPage: number) => void;
  onJuzChange: (juzNumber: number) => void;
  onSurahChange: (surahNumber: number) => void;
}

export const MushafNavigation: React.FC<MushafNavigationProps> = ({
  currentPage,
  currentJuz,
  currentSurahNumber,
  onPageChange,
  onJuzChange,
  onSurahChange
}) => {
  const surahs = quranService.getSurahs();

  const handlePrevPage = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < 604) {
      onPageChange(currentPage + 1);
    }
  };

  const handleDirectPageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val)) {
      const clamped = Math.max(1, Math.min(604, val));
      onPageChange(clamped);
    }
  };

  return (
    <div className="w-full space-y-3">
      {/* Top Selectors Bar: Juz, Surah, Page Number */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm text-xs">
        {/* Juz Dropdown */}
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          <Layers size={16} className="text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-[10px] uppercase font-bold text-gray-400 block leading-tight">Pilih Juz</span>
            <select
              value={currentJuz}
              onChange={(e) => onJuzChange(parseInt(e.target.value, 10))}
              className="w-full bg-transparent font-bold text-gray-800 outline-none cursor-pointer text-xs"
            >
              {Array.from({ length: 30 }, (_, i) => i + 1).map((juz) => (
                <option key={juz} value={juz}>
                  Juz {juz} (Hal. {quranService.getJuzStartPage(juz)})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Surah Dropdown */}
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          <BookOpen size={16} className="text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-[10px] uppercase font-bold text-gray-400 block leading-tight">Pilih Surat</span>
            <select
              value={currentSurahNumber || ''}
              onChange={(e) => {
                const sNum = parseInt(e.target.value, 10);
                if (sNum) onSurahChange(sNum);
              }}
              className="w-full bg-transparent font-bold text-gray-800 outline-none cursor-pointer text-xs"
            >
              <option value="" disabled>Pilih Surat...</option>
              {surahs.map((surah) => (
                <option key={surah.number} value={surah.number}>
                  {surah.number}. {surah.name} (Hal. {surah.startPage})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Page Direct Selector */}
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          <Bookmark size={16} className="text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-[10px] uppercase font-bold text-gray-400 block leading-tight">Halaman (1-604)</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={604}
                value={currentPage}
                onChange={handleDirectPageInput}
                className="w-16 bg-white border border-gray-300 rounded-lg px-2 py-0.5 text-center font-bold text-emerald-700 outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
              />
              <span className="text-gray-400 text-xs font-semibold">/ 604</span>
            </div>
          </div>
        </div>
      </div>

      {/* Prev / Next Page Buttons */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={handlePrevPage}
          disabled={currentPage <= 1}
          className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-white border border-gray-200 rounded-xl text-xs md:text-sm font-bold text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
        >
          <ChevronLeft size={18} />
          <span>Halaman Sebelumnya</span>
        </button>

        <div className="hidden sm:flex items-center justify-center px-4 py-2 bg-emerald-50 text-emerald-800 rounded-xl font-mono text-xs font-bold border border-emerald-100 shrink-0">
          Hal. {currentPage} / 604
        </div>

        <button
          type="button"
          onClick={handleNextPage}
          disabled={currentPage >= 604}
          className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs md:text-sm font-bold active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-emerald-600/20"
        >
          <span>Halaman Berikutnya</span>
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
};

export default MushafNavigation;
