import React from 'react';
import { QuestionBankFilter } from '../../types';
import { QURAN_CHAPTERS } from '../../constants';
import { Search, RotateCcw, Filter, Tag as TagIcon, X } from 'lucide-react';

interface QuestionBankFiltersProps {
  filter: QuestionBankFilter;
  onFilterChange: (newFilter: QuestionBankFilter) => void;
  onResetFilter: () => void;
}

export const QuestionBankFilters: React.FC<QuestionBankFiltersProps> = ({
  filter,
  onFilterChange,
  onResetFilter
}) => {
  const isFiltered = !!(
    filter.search ||
    (filter.questionType && filter.questionType !== 'all') ||
    (filter.examType && filter.examType !== 'all') ||
    (filter.difficulty && filter.difficulty !== 'all') ||
    (filter.juz && filter.juz !== 'all') ||
    (filter.surah && filter.surah !== 'all') ||
    filter.tag
  );

  return (
    <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3.5">
      {/* Search Input Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-3 text-gray-400" />
          <input
            type="text"
            value={filter.search || ''}
            onChange={e => onFilterChange({ ...filter, search: e.target.value })}
            placeholder="Cari soal: nama surat, 67, 67:12, Al-Mulk:12, Juz 29, tag..."
            className="w-full pl-9 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
          />
          {filter.search && (
            <button
              type="button"
              onClick={() => onFilterChange({ ...filter, search: '' })}
              className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {isFiltered && (
          <button
            type="button"
            onClick={onResetFilter}
            className="px-3.5 py-2 bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0"
            title="Reset semua filter pencarian"
          >
            <RotateCcw size={13} />
            <span>Reset Filter</span>
          </button>
        )}
      </div>

      {/* Filter Dropdown Controls */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1 text-xs">
        {/* Filter 1: Status */}
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Status
          </label>
          <select
            value={filter.status || 'active'}
            onChange={e => onFilterChange({ ...filter, status: e.target.value as any })}
            className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="active">Aktif</option>
            <option value="draft">Draft</option>
            <option value="archived">Arsip</option>
            <option value="all">Semua Status</option>
          </select>
        </div>

        {/* Filter 2: Jenis Soal */}
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Jenis Soal
          </label>
          <select
            value={filter.questionType || 'all'}
            onChange={e => onFilterChange({ ...filter, questionType: e.target.value as any })}
            className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="all">Semua Jenis</option>
            <option value="random">Acak</option>
            <option value="mandatory">Wajib</option>
          </select>
        </div>

        {/* Filter 3: Digunakan Untuk */}
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Digunakan Untuk
          </label>
          <select
            value={filter.examType || 'all'}
            onChange={e => onFilterChange({ ...filter, examType: e.target.value as any })}
            className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="all">Semua Kegunaan</option>
            <option value="generic">Umum</option>
            <option value="uts">UTS</option>
            <option value="uas">UAS</option>
          </select>
        </div>

        {/* Filter 4: Kesulitan */}
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Tingkat Kesulitan
          </label>
          <select
            value={filter.difficulty || 'all'}
            onChange={e => onFilterChange({ ...filter, difficulty: e.target.value as any })}
            className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="all">Semua Kesulitan</option>
            <option value="easy">Mudah</option>
            <option value="medium">Sedang</option>
            <option value="hard">Sulit</option>
          </select>
        </div>

        {/* Filter 5: Juz */}
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Juz Al-Qur'an
          </label>
          <select
            value={filter.juz || 'all'}
            onChange={e => onFilterChange({ ...filter, juz: e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10) })}
            className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="all">Semua Juz (1-30)</option>
            {Array.from({ length: 30 }, (_, i) => i + 1).map(j => (
              <option key={`filter-juz-${j}`} value={j}>Juz {j}</option>
            ))}
          </select>
        </div>

        {/* Filter 6: Surat */}
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
            Surat
          </label>
          <select
            value={filter.surah || 'all'}
            onChange={e => onFilterChange({ ...filter, surah: e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10) })}
            className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="all">Semua Surat</option>
            {QURAN_CHAPTERS.map(([num, name]) => (
              <option key={`filter-surah-${num}`} value={num}>
                {num}. {name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export default QuestionBankFilters;
