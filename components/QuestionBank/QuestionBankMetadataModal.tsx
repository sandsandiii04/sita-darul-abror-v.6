import React, { useState, useEffect } from 'react';
import { QuestionDraft, QuestionBankItem, QuestionBankMetadataInput, User } from '../../types';
import { api } from '../../api';
import { quranService, comparePositions, validateQuestionPositions } from '../../services/quranService';
import { 
  X, 
  Tag as TagIcon, 
  Plus, 
  AlertTriangle, 
  CheckCircle2, 
  BookOpen, 
  HelpCircle, 
  ExternalLink,
  Sparkles,
  ArrowRight,
  RotateCcw
} from 'lucide-react';

interface QuestionBankMetadataModalProps {
  isOpen: boolean;
  draft: QuestionDraft | null;
  user?: User;
  editingItem?: QuestionBankItem | null;
  onClose: () => void;
  onSaveSuccess: (savedItem: QuestionBankItem, actionType: 'view_bank' | 'create_another') => void;
  onViewExistingItem?: (item: QuestionBankItem) => void;
}

export const QuestionBankMetadataModal: React.FC<QuestionBankMetadataModalProps> = ({
  isOpen,
  draft,
  user,
  editingItem,
  onClose,
  onSaveSuccess,
  onViewExistingItem
}) => {
  const [examType, setExamType] = useState<'generic' | 'uts' | 'uas'>('generic');
  const [questionType, setQuestionType] = useState<'random' | 'mandatory'>('random');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [status, setStatus] = useState<'draft' | 'active' | 'archived'>('active');

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Duplicate Warning State
  const [duplicateItem, setDuplicateItem] = useState<QuestionBankItem | null>(null);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState<boolean>(false);

  // Success Confirmation State
  const [savedItemResult, setSavedItemResult] = useState<QuestionBankItem | null>(null);

  // Initialize form when draft or editingItem opens
  useEffect(() => {
    if (!isOpen) {
      setErrorMessage(null);
      setDuplicateItem(null);
      setShowDuplicateWarning(false);
      setSavedItemResult(null);
      return;
    }

    if (editingItem) {
      setExamType(editingItem.examType);
      setQuestionType(editingItem.questionType);
      setDifficulty(editingItem.difficulty);
      setTags([...editingItem.tags]);
      setNotes(editingItem.notes || '');
      setStatus(editingItem.status);
    } else if (draft) {
      setExamType('generic');
      setQuestionType('random');
      setDifficulty('medium');
      setNotes('');
      setStatus('active');

      // Generate Auto Tags
      const autoTags: string[] = [];
      const startJuz = quranService.getPageJuz(draft.startPage);
      autoTags.push(`juz-${startJuz}`);

      if (draft.crossesAyah) {
        autoTags.push('lintas-ayat');
      }
      if (draft.crossesSurah) {
        autoTags.push('lintas-surat');
      }
      if (quranService.isEndOfSurah(draft.promptEnd.surahNumber, draft.promptEnd.ayahNumber) || 
          quranService.isEndOfSurah(draft.answerEnd.surahNumber, draft.answerEnd.ayahNumber)) {
        autoTags.push('akhir-surat');
      }

      setTags(autoTags);
    }
  }, [isOpen, draft, editingItem]);

  if (!isOpen || (!draft && !editingItem)) return null;

  // Working target positions
  const activePromptStart = editingItem?.promptStart || draft?.promptStart;
  const activePromptEnd = editingItem?.promptEnd || draft?.promptEnd;
  const activeAnswerStart = editingItem?.answerStart || draft?.answerStart;
  const activeAnswerEnd = editingItem?.answerEnd || draft?.answerEnd;
  const activePromptText = editingItem?.promptText || draft?.promptText || '';
  const activeAnswerText = editingItem?.answerText || draft?.answerText || '';
  const activeAnswerMode = editingItem?.answerMode || draft?.answerMode || 'end_ayah';
  const startPage = editingItem?.startPage || draft?.startPage || 1;
  const endPage = editingItem?.endPage || draft?.endPage || 1;

  if (!activePromptStart || !activePromptEnd || !activeAnswerStart || !activeAnswerEnd) {
    return null;
  }

  const surahName = draft?.surahName || quranService.getSurah(activePromptStart.surahNumber)?.name || `Surat ${activePromptStart.surahNumber}`;
  const endSurahName = quranService.getSurah(activeAnswerEnd.surahNumber)?.name || `Surat ${activeAnswerEnd.surahNumber}`;

  // Tag Management
  const handleAddTag = () => {
    const clean = tagInput.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
    if (clean && !tags.includes(clean)) {
      setTags([...tags, clean]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  // Perform Save Action
  const executeSave = async (forceSave: boolean = false) => {
    setErrorMessage(null);

    // 1. Validasi Urutan Titik Soal
    const seqValidation = validateQuestionPositions(
      activePromptStart,
      activePromptEnd,
      activeAnswerStart,
      activeAnswerEnd
    );
    if (!seqValidation.valid) {
      setErrorMessage(seqValidation.message || "Posisi soal Al-Qur'an tidak valid.");
      return;
    }

    // 2. Validasi Bounds
    if (
      activePromptStart.surahNumber < 1 || activePromptStart.surahNumber > 114 ||
      activeAnswerEnd.surahNumber < 1 || activeAnswerEnd.surahNumber > 114 ||
      startPage < 1 || startPage > 604 || endPage < 1 || endPage > 604
    ) {
      setErrorMessage("Posisi soal Al-Qur'an tidak valid: Melebihi batasan Mushaf.");
      return;
    }

    // 3. Duplicate Detection (jika bukan forceSave dan bukan edit data yang sama)
    if (!forceSave && !editingItem) {
      const existing = await api.checkDuplicateQuestion(
        activePromptStart,
        activePromptEnd,
        activeAnswerStart,
        activeAnswerEnd,
        editingItem?.id
      );
      if (existing) {
        setDuplicateItem(existing);
        setShowDuplicateWarning(true);
        return;
      }
    }

    // 4. Construct Item
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const itemToSave: QuestionBankItem = {
        id: editingItem?.id || `qb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        examType,
        questionType,
        promptStart: { ...activePromptStart },
        promptEnd: { ...activePromptEnd },
        answerStart: { ...activeAnswerStart },
        answerEnd: { ...activeAnswerEnd },
        promptText: activePromptText,
        answerText: activeAnswerText,
        startPage,
        endPage,
        startJuz: quranService.getPageJuz(startPage),
        endJuz: quranService.getPageJuz(endPage),
        answerMode: activeAnswerMode,
        difficulty,
        tags,
        notes: notes.trim() || undefined,
        status,
        createdBy: user?.id || 'admin',
        createdAt: editingItem?.createdAt || now,
        updatedAt: now,
        archivedAt: status === 'archived' ? (editingItem?.archivedAt || now) : null
      };

      const result = await api.saveQuestionBankItem(itemToSave, user);
      if (!result.success || !result.data) {
        setErrorMessage(result.message || "Gagal menyimpan soal ke server. Draft Anda tetap tersimpan di perangkat ini.");
        return;
      }

      // Success! Show success view
      setSavedItemResult(result.data);
      setShowDuplicateWarning(false);
    } catch (err: any) {
      setErrorMessage(err?.message || "Gagal menyimpan soal ke server. Draft Anda tetap tersimpan di perangkat ini.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-gray-900/65 backdrop-blur-sm transition-opacity" 
        onClick={() => !isSaving && onClose()}
        aria-hidden="true"
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden z-10 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-emerald-50/80 to-teal-50/80">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-emerald-600 text-white rounded-xl shadow-sm">
              <BookOpen size={18} />
            </span>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800">
                Penyimpanan Permanen
              </div>
              <h3 className="font-extrabold text-base sm:text-lg text-gray-800">
                {editingItem ? 'Edit Metadata Soal' : 'Simpan ke Bank Soal'}
              </h3>
            </div>
          </div>

          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white rounded-full transition-all"
            aria-label="Tutup modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
          {/* ================= SUCCESS STATE ================= */}
          {savedItemResult ? (
            <div className="py-6 text-center space-y-4 animate-fade-in">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 size={32} />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-extrabold text-gray-800">
                  Soal Berhasil Disimpan ke Server!
                </h4>
                <p className="text-gray-500 text-xs max-w-sm mx-auto">
                  Seluruh koordinat posisi Al-Qur'an, teks acuan, dan metadata telah tersimpan secara permanen di database Supabase.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-3">
                <button
                  type="button"
                  onClick={() => onSaveSuccess(savedItemResult, 'view_bank')}
                  className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5"
                >
                  <span>Lihat Bank Soal</span>
                  <ArrowRight size={14} />
                </button>
                {!editingItem && (
                  <button
                    type="button"
                    onClick={() => onSaveSuccess(savedItemResult, 'create_another')}
                    className="w-full sm:w-auto px-5 py-2.5 bg-white hover:bg-gray-100 text-gray-700 font-bold rounded-xl border border-gray-200 transition-all flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw size={14} />
                    <span>Buat Soal Lagi</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* ================= DUPLICATE WARNING MODAL ================= */}
              {showDuplicateWarning && duplicateItem && (
                <div className="bg-amber-50 border-2 border-amber-300 p-4 rounded-2xl space-y-3 animate-fade-in">
                  <div className="flex items-center gap-2 text-amber-800 font-bold text-xs">
                    <AlertTriangle size={18} className="text-amber-600 shrink-0" />
                    <span>Soal dengan titik yang sama sudah tersedia!</span>
                  </div>
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    Ditemukan soal ID <strong>{duplicateItem.id}</strong> dengan posisi prompt dan jawaban yang persis sama di Bank Soal.
                  </p>
                  <div className="bg-white p-2.5 rounded-xl border border-amber-200 text-[11px] text-gray-700">
                    <div><strong>QS:</strong> {surahName} : {duplicateItem.promptStart.ayahNumber}</div>
                    <div className="truncate"><strong>Status:</strong> {duplicateItem.status} • <strong>Kesulitan:</strong> {duplicateItem.difficulty}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {onViewExistingItem && (
                      <button
                        type="button"
                        onClick={() => {
                          onViewExistingItem(duplicateItem);
                          onClose();
                        }}
                        className="px-3 py-1.5 bg-white hover:bg-amber-100 text-amber-800 font-bold rounded-lg border border-amber-300 transition-all text-xs"
                      >
                        Lihat Soal Existing
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowDuplicateWarning(false)}
                      className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg transition-all text-xs"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={() => executeSave(true)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg transition-all text-xs shadow-sm"
                    >
                      Simpan Tetap
                    </button>
                  </div>
                </div>
              )}

              {/* Error Banner */}
              {errorMessage && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl flex items-center gap-2 animate-shake">
                  <AlertTriangle size={15} className="text-red-600 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Form Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Jenis Soal */}
                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Jenis Soal
                  </label>
                  <select
                    value={questionType}
                    onChange={e => setQuestionType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="random">Acak (Random)</option>
                    <option value="mandatory">Wajib (Mandatory)</option>
                  </select>
                </div>

                {/* Digunakan Untuk */}
                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Digunakan Untuk
                  </label>
                  <select
                    value={examType}
                    onChange={e => setExamType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="generic">Umum (Generic)</option>
                    <option value="uts">UTS Tahfiz</option>
                    <option value="uas">UAS Tahfiz</option>
                  </select>
                </div>

                {/* Tingkat Kesulitan */}
                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Tingkat Kesulitan
                  </label>
                  <select
                    value={difficulty}
                    onChange={e => setDifficulty(e.target.value as any)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="easy">Mudah</option>
                    <option value="medium">Sedang</option>
                    <option value="hard">Sulit</option>
                  </select>
                </div>

                {/* Status Publikasi */}
                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Status Soal
                  </label>
                  <div className="flex items-center gap-4 py-2">
                    <label className="flex items-center gap-1.5 cursor-pointer font-medium text-gray-700">
                      <input
                        type="radio"
                        name="status"
                        value="draft"
                        checked={status === 'draft'}
                        onChange={() => setStatus('draft')}
                        className="text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Draft</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer font-medium text-gray-700">
                      <input
                        type="radio"
                        name="status"
                        value="active"
                        checked={status === 'active'}
                        onChange={() => setStatus('active')}
                        className="text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Aktif</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Tag Management */}
              <div className="space-y-1.5">
                <label className="block font-bold text-gray-700">
                  Tag / Label Soal
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <TagIcon size={14} className="absolute left-3 top-2.5 text-gray-400" />
                    <input
                      type="text"
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      placeholder="Tambah tag (misal: mutasyabihat, juz-29)..."
                      className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddTag}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-all flex items-center gap-1 shrink-0"
                  >
                    <Plus size={13} />
                    <span>Tambah</span>
                  </button>
                </div>

                {/* Tag Chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {tags.map(tag => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-semibold"
                    >
                      <span>#{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-emerald-600 hover:text-emerald-900 rounded-full"
                        aria-label={`Hapus tag ${tag}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Catatan Internal */}
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Catatan Penguji / Evaluasi (Opsional)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Catatan tambahan untuk soal ini..."
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Ringkasan Soal Al-Qur'an (Readonly Snapshot) */}
              <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-200 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 pb-1.5">
                  <span>Ringkasan Soal dari Mushaf</span>
                  <span className="text-emerald-700 font-mono">
                    QS. {surahName} : {activePromptStart.ayahNumber}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] text-gray-400 block font-semibold">Prompt Penguji:</span>
                  <div 
                    dir="rtl"
                    className="text-lg font-arabic text-blue-950 font-medium truncate"
                  >
                    {activePromptText}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 text-[11px] text-gray-600">
                  <span>Rentang Jawaban:</span>
                  <span className="font-bold text-emerald-800">
                    {activePromptStart.surahNumber !== activeAnswerEnd.surahNumber
                      ? `QS. ${surahName}:${activeAnswerStart.ayahNumber} → QS. ${endSurahName}:${activeAnswerEnd.ayahNumber}`
                      : `${surahName}:${activeAnswerStart.ayahNumber}–${activeAnswerEnd.ayahNumber}`}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!savedItemResult && (
          <div className="p-4 sm:p-5 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2.5">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition-all shadow-sm"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => executeSave(false)}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-1.5"
            >
              {isSaving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Menyimpan...</span>
                </>
              ) : (
                <>
                  <BookOpen size={14} />
                  <span>{editingItem ? 'Simpan Perubahan' : 'Simpan ke Bank Soal'}</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuestionBankMetadataModal;
