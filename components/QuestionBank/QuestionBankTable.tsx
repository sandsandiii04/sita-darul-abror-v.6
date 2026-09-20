import React, { useState } from 'react';
import { QuestionBankItem } from '../../types';
import { quranService } from '../../services/quranService';
import { 
  Eye, 
  Edit3, 
  Copy, 
  Archive, 
  RotateCcw, 
  ChevronLeft, 
  ChevronRight, 
  BookOpen, 
  Compass, 
  Tag as TagIcon,
  Sparkles,
  Trash2,
  CheckCircle2
} from 'lucide-react';

interface QuestionBankTableProps {
  items: QuestionBankItem[];
  isLoading: boolean;
  onViewDetail: (item: QuestionBankItem) => void;
  onEditMetadata: (item: QuestionBankItem) => void;
  onEditFromMushaf: (item: QuestionBankItem) => void;
  onDuplicate: (item: QuestionBankItem) => void;
  onArchive: (item: QuestionBankItem) => void;
  onRestore: (item: QuestionBankItem) => void;
  onDelete?: (item: QuestionBankItem) => void;
  onActivate?: (item: QuestionBankItem) => void;
  onRetrySync?: (item: QuestionBankItem) => void;
}

export const QuestionBankTable: React.FC<QuestionBankTableProps> = ({
  items,
  isLoading,
  onViewDetail,
  onEditMetadata,
  onEditFromMushaf,
  onDuplicate,
  onArchive,
  onRestore,
  onDelete,
  onActivate,
  onRetrySync
}) => {
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(currentPage, totalPages);
  const startIndex = (clampedPage - 1) * pageSize;
  const paginatedItems = items.slice(startIndex, startIndex + pageSize);

  const getSurahName = (num: number) => {
    return quranService.getSurah(num)?.name || `Surat ${num}`;
  };

  const difficultyBadges: Record<string, { label: string; color: string }> = {
    easy: { label: 'Mudah', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    medium: { label: 'Sedang', color: 'bg-blue-50 text-blue-700 border-blue-200' },
    hard: { label: 'Sulit', color: 'bg-rose-50 text-rose-700 border-rose-200' }
  };

  const statusBadges: Record<string, { label: string; color: string }> = {
    active: { label: 'Aktif', color: 'bg-emerald-600 text-white' },
    draft: { label: 'Draft', color: 'bg-amber-500 text-white' },
    archived: { label: 'Arsip', color: 'bg-gray-400 text-white' }
  };

  const formatDate = (iso: string) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch (e) {
      return iso;
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
        <div className="w-7 h-7 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        <span>Memuat data Bank Soal...</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
          <BookOpen size={24} />
        </div>
        <div className="text-gray-800 font-bold text-sm">Tidak ada soal yang ditemukan</div>
        <p className="text-xs text-gray-500 max-w-sm mx-auto">
          Belum ada soal pada filter ini. Buat rancangan soal baru langsung dari Mushaf Digital.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ================= DESKTOP TABLE VIEW ================= */}
      <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-100 text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                <th className="py-3.5 px-4">QS / Ayat</th>
                <th className="py-3.5 px-4">Preview Prompt & Jawaban</th>
                <th className="py-3.5 px-3">Jenis</th>
                <th className="py-3.5 px-3">Juz</th>
                <th className="py-3.5 px-3">Kesulitan</th>
                <th className="py-3.5 px-3">Tag</th>
                <th className="py-3.5 px-3">Status</th>
                <th className="py-3.5 px-3">Diubah</th>
                <th className="py-3.5 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {paginatedItems.map(item => {
                const surahName = getSurahName(item.promptStart.surahNumber);
                const endSurahName = getSurahName(item.answerEnd.surahNumber);
                const diffBadge = difficultyBadges[item.difficulty] || difficultyBadges.medium;
                const statBadge = statusBadges[item.status] || statusBadges.active;

                const ayahDisplay = item.promptStart.surahNumber !== item.answerEnd.surahNumber
                  ? `QS. ${surahName}:${item.promptStart.ayahNumber} → ${endSurahName}:${item.answerEnd.ayahNumber}`
                  : item.promptStart.ayahNumber !== item.answerEnd.ayahNumber
                  ? `QS. ${surahName}:${item.promptStart.ayahNumber}–${item.answerEnd.ayahNumber}`
                  : `QS. ${surahName}:${item.promptStart.ayahNumber}`;

                return (
                  <tr key={item.id} className="hover:bg-emerald-50/30 transition-colors">
                    {/* 1. QS / Ayat */}
                    <td className="py-3.5 px-4 font-bold text-gray-900 whitespace-nowrap">
                      <div>{surahName} : {item.promptStart.ayahNumber}</div>
                      <div className="text-[10px] text-gray-400 font-normal">
                        Hal. {item.startPage}
                      </div>
                    </td>

                    {/* 2. Preview Prompt */}
                    <td className="py-3.5 px-4 max-w-xs">
                      <div 
                        dir="rtl"
                        className="text-base font-arabic text-blue-950 font-medium truncate"
                      >
                        "{item.promptText}"
                      </div>
                      <div className="text-[10px] text-gray-400 truncate mt-0.5">
                        Jwb: {item.answerText.substring(0, 40)}...
                      </div>
                    </td>

                    {/* 3. Jenis */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md font-bold text-[10px] bg-gray-100 text-gray-700">
                        {item.questionType === 'mandatory' ? 'Wajib' : 'Acak'}
                      </span>
                    </td>

                    {/* 4. Juz */}
                    <td className="py-3.5 px-3 font-semibold text-gray-600 whitespace-nowrap">
                      Juz {item.startJuz}
                    </td>

                    {/* 5. Kesulitan */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] border ${diffBadge.color}`}>
                        {diffBadge.label}
                      </span>
                    </td>

                    {/* 6. Tag */}
                    <td className="py-3.5 px-3 max-w-[140px]">
                      <div className="flex flex-wrap gap-1">
                        {item.tags && item.tags.length > 0 ? (
                          item.tags.slice(0, 2).map(t => (
                            <span key={t} className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                              #{t}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-300 text-[10px]">-</span>
                        )}
                        {item.tags && item.tags.length > 2 && (
                          <span className="text-[9px] text-gray-400 font-bold">+{item.tags.length - 2}</span>
                        )}
                      </div>
                    </td>

                    {/* 7. Status & Sinkronisasi */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <div className="flex flex-col gap-1 items-start">
                        <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${statBadge.color}`}>
                          {statBadge.label}
                        </span>
                        {item.syncStatus === 'saved' && (
                          <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            Server ✓
                          </span>
                        )}
                        {item.syncStatus === 'failed' && (
                          <span className="text-[9px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200" title={item.syncError || 'Gagal simpan server'}>
                            Gagal Cloud ⚠️
                          </span>
                        )}
                        {item.syncStatus === 'pending' && (
                          <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            Pending ⏳
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 8. Tanggal */}
                    <td className="py-3.5 px-3 text-[11px] text-gray-400 whitespace-nowrap">
                      {formatDate(item.updatedAt)}
                    </td>

                    {/* 9. Aksi */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {(item.syncStatus === 'failed' || item.syncStatus === 'pending') && onRetrySync && (
                          <button
                            type="button"
                            onClick={() => onRetrySync(item)}
                            className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-100 rounded-lg transition-all border border-amber-200"
                            title="Coba sinkronkan ke server sekarang"
                          >
                            <RotateCcw size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onViewDetail(item)}
                          className="p-1.5 text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-all"
                          title="Lihat detail soal"
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditMetadata(item)}
                          className="p-1.5 text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-all"
                          title="Edit metadata soal"
                        >
                          <Edit3 size={15} />
                        </button>
                        {item.status === 'draft' && onActivate && (
                          <button
                            type="button"
                            onClick={() => onActivate(item)}
                            className="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-all"
                            title="Aktifkan soal ini"
                          >
                            <CheckCircle2 size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDuplicate(item)}
                          className="p-1.5 text-gray-500 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-all"
                          title="Duplikasi soal"
                        >
                          <Copy size={15} />
                        </button>
                        {item.status === 'archived' ? (
                          <button
                            type="button"
                            onClick={() => onRestore(item)}
                            className="p-1.5 text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-all"
                            title="Pulihkan dari arsip"
                          >
                            <RotateCcw size={15} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm('Arsipkan soal ini?')) {
                                onArchive(item);
                              }
                            }}
                            className="p-1.5 text-gray-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-all"
                            title="Arsipkan soal"
                          >
                            <Archive size={15} />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Hapus soal "${item.promptText.substring(0, 35)}..." secara permanen? Tindakan ini tidak dapat dibatalkan.`)) {
                                onDelete(item);
                              }
                            }}
                            className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                            title="Hapus soal permanen"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= MOBILE CARD LIST VIEW ================= */}
      <div className="md:hidden space-y-3">
        {paginatedItems.map(item => {
          const surahName = getSurahName(item.promptStart.surahNumber);
          const diffBadge = difficultyBadges[item.difficulty] || difficultyBadges.medium;
          const statBadge = statusBadges[item.status] || statusBadges.active;

          return (
            <div 
              key={`mob-${item.id}`} 
              className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3"
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                <span className="font-extrabold text-sm text-gray-900">
                  QS. {surahName} : {item.promptStart.ayahNumber}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] border ${diffBadge.color}`}>
                    {diffBadge.label}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${statBadge.color}`}>
                    {statBadge.label}
                  </span>
                </div>
              </div>

              {/* Arabic Prompt Preview */}
              <div 
                dir="rtl"
                className="text-xl font-arabic text-blue-950 font-medium py-1 text-right"
              >
                "{item.promptText}"
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-500 pt-1">
                <span>Juz {item.startJuz} • Hal. {item.startPage}</span>
                <div className="flex items-center gap-1.5">
                  {item.syncStatus === 'saved' && (
                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      Server ✓
                    </span>
                  )}
                  {item.syncStatus === 'failed' && (
                    <span className="text-[9px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                      Gagal Cloud ⚠️
                    </span>
                  )}
                  <span className="bg-gray-100 px-2 py-0.5 rounded text-[10px] font-bold">
                    {item.questionType === 'mandatory' ? 'Wajib' : 'Acak'}
                  </span>
                </div>
              </div>

              {item.tags && item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {item.tags.map(t => (
                    <span key={t} className="text-[10px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-gray-100">
                {(item.syncStatus === 'failed' || item.syncStatus === 'pending') && onRetrySync && (
                  <button
                    type="button"
                    onClick={() => onRetrySync(item)}
                    className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold text-xs rounded-xl transition-all flex items-center gap-1 border border-amber-200"
                    title="Sinkronkan ke server"
                  >
                    <RotateCcw size={13} />
                    <span>Sinkronkan</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onViewDetail(item)}
                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl transition-all flex items-center gap-1"
                >
                  <Eye size={13} />
                  <span>Lihat</span>
                </button>
                <button
                  type="button"
                  onClick={() => onEditMetadata(item)}
                  className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-xl transition-all flex items-center gap-1"
                >
                  <Edit3 size={13} />
                  <span>Edit</span>
                </button>
                {item.status === 'draft' && onActivate && (
                  <button
                    type="button"
                    onClick={() => onActivate(item)}
                    className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl transition-all flex items-center gap-1 border border-emerald-200"
                    title="Aktifkan soal"
                  >
                    <CheckCircle2 size={13} />
                    <span>Aktifkan</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDuplicate(item)}
                  className="p-1.5 text-gray-500 hover:text-purple-700 hover:bg-purple-50 rounded-xl"
                  title="Duplikasi"
                >
                  <Copy size={15} />
                </button>
                {item.status === 'archived' ? (
                  <button
                    type="button"
                    onClick={() => onRestore(item)}
                    className="p-1.5 text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl"
                    title="Pulihkan"
                  >
                    <RotateCcw size={15} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Arsipkan soal ini?')) onArchive(item);
                    }}
                    className="p-1.5 text-gray-500 hover:text-amber-700 hover:bg-amber-50 rounded-xl"
                    title="Arsipkan"
                  >
                    <Archive size={15} />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Hapus soal "${item.promptText.substring(0, 35)}..." secara permanen?`)) {
                        onDelete(item);
                      }
                    }}
                    className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                    title="Hapus permanen"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ================= PAGINATION CONTROLS ================= */}
      <div className="bg-white p-3.5 rounded-2xl shadow-sm border border-gray-100 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-gray-500">
          <span>Menampilkan</span>
          <select
            value={pageSize}
            onChange={e => {
              setPageSize(parseInt(e.target.value, 10));
              setCurrentPage(1);
            }}
            className="px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span>dari <strong>{items.length}</strong> total soal</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={clampedPage <= 1}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft size={16} />
          </button>

          <span className="px-3 py-1 font-bold text-gray-700">
            Hal. {clampedPage} / {totalPages}
          </span>

          <button
            type="button"
            disabled={clampedPage >= totalPages}
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuestionBankTable;
