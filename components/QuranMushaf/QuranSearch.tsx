import React, { useState } from 'react';
import { Search, X, Sparkles, ArrowRight } from 'lucide-react';
import { quranService, SearchResult } from '../../services/quranService';

interface QuranSearchProps {
  onSearchResult: (result: SearchResult) => void;
}

export const QuranSearch: React.FC<QuranSearchProps> = ({ onSearchResult }) => {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSearchSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setFeedback(null);

    try {
      const result = await quranService.searchQuran(query);
      if (result) {
        onSearchResult(result);
        setFeedback(`Ditemukan: ${result.label} (${result.description})`);
      } else {
        setFeedback('Format pencarian tidak dikenali atau surat tidak ditemukan.');
      }
    } catch (err: any) {
      setFeedback('Terjadi kesalahan saat mencari.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleQuickChipClick = async (sample: string) => {
    setQuery(sample);
    setIsSearching(true);
    setFeedback(null);
    try {
      const result = await quranService.searchQuran(sample);
      if (result) {
        onSearchResult(result);
        setFeedback(`Ditemukan: ${result.label}`);
      }
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="w-full space-y-2">
      <form onSubmit={handleSearchSubmit} className="relative flex items-center">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={17} />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFeedback(null);
          }}
          placeholder='Cari: "Al-Mulk", "67:12", "Al-Mulk 12", "Juz 29", "Halaman 562"...'
          className="w-full pl-10 pr-24 py-2.5 bg-white border border-gray-200 rounded-xl text-xs md:text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all shadow-sm"
        />

        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setFeedback(null);
              }}
              className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              title="Hapus pencarian"
            >
              <X size={15} />
            </button>
          )}
          <button
            type="submit"
            disabled={!query.trim() || isSearching}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-50 transition-all flex items-center gap-1"
          >
            <span>Cari</span>
            <ArrowRight size={13} />
          </button>
        </div>
      </form>

      {/* Feedback Message */}
      {feedback && (
        <div className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
          feedback.startsWith('Ditemukan') 
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
            : 'bg-amber-50 text-amber-700 border border-amber-100'
        }`}>
          {feedback}
        </div>
      )}

      {/* Quick Example Chips */}
      <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-gray-400 pt-0.5">
        <span className="flex items-center gap-1 text-gray-500 font-semibold">
          <Sparkles size={12} className="text-amber-500" /> Contoh:
        </span>
        {['Al-Mulk', '67:12', 'Al-Baqarah 255', 'Juz 30', 'Halaman 562'].map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => handleQuickChipClick(chip)}
            className="bg-gray-100 hover:bg-emerald-50 hover:text-emerald-700 text-gray-600 px-2 py-0.5 rounded-md font-medium transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
};

export default QuranSearch;
