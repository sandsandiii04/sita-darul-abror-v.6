import React, { useState, useEffect, useCallback } from 'react';
import { User, QuestionBankItem, QuestionBankFilter, QuestionDraft } from '../../types';
import { api } from '../../api';
import { quranService } from '../../services/quranService';
import QuestionBankFilters from './QuestionBankFilters';
import QuestionBankTable from './QuestionBankTable';
import QuestionBankDetailModal from './QuestionBankDetailModal';
import QuestionBankMetadataModal from './QuestionBankMetadataModal';
import { QuickQuestionGeneratorModal } from './QuickQuestionGeneratorModal';
import { 
  BookMarked, 
  PlusCircle, 
  ShieldAlert, 
  Layers, 
  CheckCircle2, 
  FileEdit, 
  Sparkles, 
  Shuffle, 
  CheckSquare,
  RefreshCw,
  Archive,
  AlertTriangle,
  Zap,
  Trash2
} from 'lucide-react';
import DeleteAllQuestionsModal from './DeleteAllQuestionsModal';

interface QuestionBankViewProps {
  user?: User;
  onNavigateToMushafBuilder: (draftToRestore?: QuestionDraft | null) => void;
}

export const QuestionBankView: React.FC<QuestionBankViewProps> = ({
  user,
  onNavigateToMushafBuilder
}) => {
  const isAdmin = user?.role === 'admin';

  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<QuestionBankFilter>({
    status: 'active',
    questionType: 'all',
    examType: 'all',
    difficulty: 'all',
    juz: 'all',
    surah: 'all'
  });

  // Modals state
  const [selectedDetailItem, setSelectedDetailItem] = useState<QuestionBankItem | null>(null);
  const [editingMetadataItem, setEditingMetadataItem] = useState<QuestionBankItem | null>(null);
  const [isQuickGeneratorOpen, setIsQuickGeneratorOpen] = useState<boolean>(false);
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState<boolean>(false);

  // Load items from API (Supabase with localStorage fallback)
  const loadQuestionBank = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    try {
      const res = await api.getQuestionBankList(filter, user);
      if (res.success) {
        setItems(res.data);
      }
    } catch (e) {
      console.error("Gagal memuat daftar Bank Soal:", e);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, filter, user]);

  useEffect(() => {
    loadQuestionBank();
  }, [loadQuestionBank]);

  // Authorization Check
  if (!isAdmin) {
    return (
      <div className="bg-white p-8 sm:p-12 rounded-3xl border border-red-100 shadow-sm text-center max-w-lg mx-auto my-12 space-y-4 animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto shadow-sm">
          <ShieldAlert size={36} />
        </div>
        <div className="space-y-1">
          <h3 className="font-extrabold text-lg text-gray-800">
            Akses Ditolak
          </h3>
          <p className="text-xs text-gray-500">
            Anda tidak memiliki akses ke Bank Soal. Fitur ini khusus diperuntukkan bagi Administrator.
          </p>
        </div>
      </div>
    );
  }

  // Summary Metrics Calculation
  const totalCount = items.length;
  const activeCount = items.filter(q => q.status === 'active' && q.syncStatus !== 'failed').length;
  const draftCount = items.filter(q => q.status === 'draft').length;
  const mandatoryCount = items.filter(q => q.questionType === 'mandatory' && q.status === 'active').length;
  const randomCount = items.filter(q => q.questionType === 'random' && q.status === 'active').length;
  const unsyncedItems = items.filter(q => q.syncStatus === 'failed' || q.syncStatus === 'pending');

  // Convert QuestionBankItem to QuestionDraft for Mushaf Round-trip
  const convertBankItemToDraft = (bankItem: QuestionBankItem): QuestionDraft => {
    const surahInfo = quranService.getSurah(bankItem.promptStart.surahNumber);
    return {
      promptStart: { ...bankItem.promptStart },
      promptEnd: { ...bankItem.promptEnd },
      answerStart: { ...bankItem.answerStart },
      answerEnd: { ...bankItem.answerEnd },
      promptText: bankItem.promptText,
      answerText: bankItem.answerText,
      startPage: bankItem.startPage,
      endPage: bankItem.endPage,
      crossesAyah: (bankItem.promptStart.surahNumber !== bankItem.answerEnd.surahNumber) || 
                   (bankItem.promptStart.ayahNumber !== bankItem.answerEnd.ayahNumber),
      crossesSurah: bankItem.promptStart.surahNumber !== bankItem.answerEnd.surahNumber,
      answerMode: bankItem.answerMode,
      surahName: surahInfo?.name || `Surat ${bankItem.promptStart.surahNumber}`,
      ayahDisplay: `QS. ${surahInfo?.name || ''} : ${bankItem.promptStart.ayahNumber}`
    };
  };

  // Handlers
  const handleEditFromMushaf = (item: QuestionBankItem) => {
    const draft = convertBankItemToDraft(item);
    onNavigateToMushafBuilder(draft);
  };

  const handleDuplicate = async (item: QuestionBankItem) => {
    // Buat draft tiruan dengan status draft dan id baru
    const clonedDraft = convertBankItemToDraft(item);
    onNavigateToMushafBuilder(clonedDraft);
  };

  const handleArchive = async (item: QuestionBankItem) => {
    try {
      const res = await api.archiveQuestionBankItem(item.id, user);
      if (res.success) {
        loadQuestionBank();
      } else {
        alert(res.message || "Gagal mengarsipkan soal.");
      }
    } catch (e: any) {
      alert("Terjadi kesalahan saat mengarsipkan soal.");
    }
  };

  const handleRestore = async (item: QuestionBankItem) => {
    try {
      const res = await api.restoreQuestionBankItem(item.id, user);
      if (res.success) {
        loadQuestionBank();
      } else {
        alert(res.message || "Gagal memulihkan soal.");
      }
    } catch (e: any) {
      alert("Terjadi kesalahan saat memulihkan soal.");
    }
  };

  const handleRetrySync = async (item: QuestionBankItem) => {
    try {
      const res = await api.saveQuestionBankItem(item, user);
      if (res.success) {
        alert("Soal berhasil disinkronkan ke server Supabase!");
        loadQuestionBank();
      } else {
        alert(res.message || "Gagal sinkronisasi ke server.");
      }
    } catch (e: any) {
      alert("Gagal sinkronisasi: " + (e?.message || "Kesalahan jaringan."));
    }
  };

  const handleDelete = async (item: QuestionBankItem) => {
    try {
      const res = await api.deleteQuestionBankItem(item.id, user);
      if (res.success) {
        loadQuestionBank();
      } else {
        alert(res.message || "Gagal menghapus soal.");
      }
    } catch (e: any) {
      alert("Terjadi kesalahan saat menghapus soal.");
    }
  };

  const handleActivateItem = async (item: QuestionBankItem) => {
    try {
      const res = await api.activateQuestionBankItem(item.id, user);
      if (res.success) {
        loadQuestionBank();
      } else {
        alert(res.message || "Gagal mengaktifkan soal.");
      }
    } catch (e: any) {
      alert("Terjadi kesalahan saat mengaktifkan soal.");
    }
  };

  const handleBulkActivateDrafts = async () => {
    const isFilteredExamType = filter.examType && filter.examType !== 'all';
    const confirmMsg = isFilteredExamType 
      ? `Aktifkan semua ${draftCount} soal draft untuk tipe ujian "${filter.examType.toUpperCase()}"?`
      : `Aktifkan seluruh ${draftCount} soal draft menjadi status Aktif sehingga siap digunakan untuk ujian?`;
    
    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await api.bulkActivateDraftQuestions({
        examType: isFilteredExamType ? filter.examType : undefined
      }, user);
      if (res.success) {
        alert(res.message || "Semua soal draft berhasil diaktifkan.");
        loadQuestionBank();
      } else {
        alert(res.message || "Gagal mengaktifkan soal draft.");
      }
    } catch (e: any) {
      alert("Terjadi kesalahan saat mengaktifkan soal draft.");
    }
  };

  const handleConfirmDeleteAll = async (scope: 'all' | 'filtered') => {
    let options: { examType?: string; status?: string } | undefined = undefined;
    if (scope === 'filtered') {
      options = {
        examType: filter.examType && filter.examType !== 'all' ? filter.examType : undefined,
        status: filter.status && filter.status !== 'all' ? filter.status : undefined
      };
    }

    const res = await api.deleteAllQuestionBankItems(options, user);
    if (res.success) {
      alert(res.message || "Semua soal berhasil dihapus.");
      loadQuestionBank();
    } else {
      throw new Error(res.message || "Gagal menghapus semua soal.");
    }
  };

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      {/* ================= HEADER SECTION ================= */}
      <div className="bg-white p-5 lg:p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-emerald-50 text-emerald-700 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border border-emerald-200">
              Evaluasi Tahfiz
            </span>
            <span className="text-gray-300">•</span>
            <span className="text-xs text-gray-400 font-medium">Penyimpanan Soal Permanen</span>
          </div>
          <h2 className="text-xl md:text-2xl font-extrabold text-gray-800 tracking-tight flex items-center gap-2 mt-1">
            <BookMarked className="text-emerald-600" size={26} />
            <span>Bank Soal Tahfiz</span>
          </h2>
          <p className="text-xs md:text-sm text-gray-500 mt-1">
            Kelola koleksi soal tahfiz yang dibuat dari Mushaf Digital secara terpusat dan permanen.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {draftCount > 0 && (
            <button
              type="button"
              onClick={handleBulkActivateDrafts}
              className="px-3.5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5"
              title="Aktifkan seluruh soal berstatus draft menjadi aktif sekaligus"
            >
              <CheckCircle2 size={16} />
              <span>⚡ Aktifkan Semua Draft ({draftCount})</span>
            </button>
          )}
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => setIsDeleteAllModalOpen(true)}
              className="px-3.5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-800 rounded-xl text-xs font-bold transition-all border border-rose-200 flex items-center gap-1.5 shadow-sm"
              title="Hapus semua soal sekaligus"
            >
              <Trash2 size={16} />
              <span>Hapus Semua Soal</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsQuickGeneratorOpen(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2"
          >
            <Zap size={16} />
            <span>⚡ Generate Otomatis</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateToMushafBuilder(null)}
            className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2"
          >
            <PlusCircle size={16} />
            <span>+ Buat Soal dari Mushaf</span>
          </button>
        </div>
      </div>

      {/* ================= SUMMARY CARDS ================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Total Soal */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-50 text-gray-600 flex items-center justify-center font-bold">
            <Layers size={20} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Soal</div>
            <div className="text-lg font-extrabold text-gray-800">{totalCount}</div>
          </div>
        </div>

        {/* Soal Aktif */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Soal Aktif</div>
            <div className="text-lg font-extrabold text-emerald-600">{activeCount}</div>
          </div>
        </div>

        {/* Draft */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <FileEdit size={20} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Draft</div>
            <div className="text-lg font-extrabold text-amber-600">{draftCount}</div>
          </div>
        </div>

        {/* Soal Wajib */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
            <CheckSquare size={20} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Soal Wajib</div>
            <div className="text-lg font-extrabold text-purple-700">{mandatoryCount}</div>
          </div>
        </div>

        {/* Soal Acak */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 col-span-2 sm:col-span-1">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <Shuffle size={20} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Soal Acak</div>
            <div className="text-lg font-extrabold text-blue-700">{randomCount}</div>
          </div>
        </div>
      </div>

      {/* ================= FILTERS & SEARCH TOOLBAR ================= */}
      <QuestionBankFilters
        filter={filter}
        onFilterChange={newFilter => setFilter(newFilter)}
        onResetFilter={() => setFilter({
          status: 'active',
          questionType: 'all',
          examType: 'all',
          difficulty: 'all',
          juz: 'all',
          surah: 'all',
          search: '',
          tag: ''
        })}
      />

      {/* ================= UNSYNCED WARNING BANNER ================= */}
      {unsyncedItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 shadow-sm animate-fade-in">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
            <div>
              <div className="font-extrabold text-xs">
                {unsyncedItems.length} Draft Soal Belum Tersimpan Permanen di Server
              </div>
              <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                Draft Anda tetap tersimpan aman di perangkat lokal ini. Klik tombol di kanan untuk mencoba mengirim ulang ke server database Supabase.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              for (const it of unsyncedItems) {
                await api.saveQuestionBankItem(it, user);
              }
              loadQuestionBank();
            }}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition-colors shrink-0 shadow-sm self-end sm:self-center"
          >
            Sinkronkan Semua
          </button>
        </div>
      )}

      {/* ================= TABLE / LIST VIEW ================= */}
      <QuestionBankTable
        items={items}
        isLoading={isLoading}
        onViewDetail={item => setSelectedDetailItem(item)}
        onEditMetadata={item => setEditingMetadataItem(item)}
        onEditFromMushaf={handleEditFromMushaf}
        onDuplicate={handleDuplicate}
        onArchive={handleArchive}
        onRestore={handleRestore}
        onDelete={handleDelete}
        onActivate={handleActivateItem}
        onRetrySync={handleRetrySync}
      />

      {/* ================= DETAIL MODAL ================= */}
      <QuestionBankDetailModal
        isOpen={!!selectedDetailItem}
        item={selectedDetailItem}
        onClose={() => setSelectedDetailItem(null)}
        onEditMetadata={item => {
          setSelectedDetailItem(null);
          setEditingMetadataItem(item);
        }}
        onEditFromMushaf={item => {
          setSelectedDetailItem(null);
          handleEditFromMushaf(item);
        }}
        onDuplicate={item => {
          setSelectedDetailItem(null);
          handleDuplicate(item);
        }}
        onArchive={item => {
          handleArchive(item);
          setSelectedDetailItem(null);
        }}
        onRestore={item => {
          handleRestore(item);
          setSelectedDetailItem(null);
        }}
        onDelete={item => {
          handleDelete(item);
          setSelectedDetailItem(null);
        }}
      />

      {/* ================= EDIT METADATA MODAL ================= */}
      <QuestionBankMetadataModal
        isOpen={!!editingMetadataItem}
        draft={null}
        editingItem={editingMetadataItem}
        user={user}
        onClose={() => setEditingMetadataItem(null)}
        onSaveSuccess={() => {
          setEditingMetadataItem(null);
          loadQuestionBank();
        }}
      />

      {/* ================= DELETE ALL QUESTIONS MODAL ================= */}
      <DeleteAllQuestionsModal
        isOpen={isDeleteAllModalOpen}
        onClose={() => setIsDeleteAllModalOpen(false)}
        totalCount={items.length}
        filteredCount={items.length}
        filter={filter}
        onConfirmDeleteAll={handleConfirmDeleteAll}
      />

      {/* ================= QUICK BANK SOAL GENERATOR MODAL ================= */}
      {user && (
        <QuickQuestionGeneratorModal
          isOpen={isQuickGeneratorOpen}
          onClose={() => setIsQuickGeneratorOpen(false)}
          user={user}
          existingItems={items}
          onSaveSuccess={() => {
            loadQuestionBank();
          }}
          onEditInMushafBuilder={(draft) => {
            setIsQuickGeneratorOpen(false);
            onNavigateToMushafBuilder(draft);
          }}
        />
      )}
    </div>
  );
};

export default QuestionBankView;
