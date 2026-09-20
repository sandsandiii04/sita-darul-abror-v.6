import React, { useState } from 'react';
import { 
  User, 
  QuickGeneratorOptions, 
  QuickQuestionCandidate, 
  QuestionBankItem,
  QuestionDraft
} from '../../types';
import { api } from '../../api';
import { QuickQuestionGenerator } from '../../services/quickQuestionGenerator';
import { quranService } from '../../services/quranService';
import { 
  Zap, 
  X, 
  Check, 
  RefreshCw, 
  Trash2, 
  Edit3, 
  Eye, 
  EyeOff, 
  AlertTriangle, 
  CheckCircle2, 
  Layers, 
  Sparkles,
  BookOpen,
  ArrowRight,
  Sliders
} from 'lucide-react';

interface QuickQuestionGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  existingItems: QuestionBankItem[];
  onSaveSuccess: () => void;
  onEditInMushafBuilder: (draft: QuestionDraft) => void;
}

export const QuickQuestionGeneratorModal: React.FC<QuickQuestionGeneratorModalProps> = ({
  isOpen,
  onClose,
  user,
  existingItems,
  onSaveSuccess,
  onEditInMushafBuilder
}) => {
  const [step, setStep] = useState<'config' | 'review' | 'success'>('config');

  // Generator Configuration Form State
  const [materialType, setMaterialType] = useState<'juz' | 'surah' | 'page'>('juz');
  const [juz, setJuz] = useState<number>(30);
  const [selectedSurah, setSelectedSurah] = useState<number>(78);
  const [startPage, setStartPage] = useState<number>(582);
  const [endPage, setEndPage] = useState<number>(604);
  const [count, setCount] = useState<number>(20);
  const [customCountInput, setCustomCountInput] = useState<string>('20');
  const [difficulty, setDifficulty] = useState<'mixed' | 'easy' | 'medium' | 'hard'>('mixed');
  const [spreadEvenly, setSpreadEvenly] = useState<boolean>(true);
  const [avoidExisting, setAvoidExisting] = useState<boolean>(true);
  const [avoidNearDistance, setAvoidNearDistance] = useState<boolean>(true);

  // Generation Results State
  const [candidates, setCandidates] = useState<QuickQuestionCandidate[]>([]);
  const [insufficientPool, setInsufficientPool] = useState<boolean>(false);
  const [warningMessage, setWarningMessage] = useState<string | undefined>(undefined);
  const [expandedPreviewIds, setExpandedPreviewIds] = useState<Set<string>>(new Set());

  // Loading States
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Success State Metrics
  const [savedMetrics, setSavedMetrics] = useState<{ total: number; saved: number; skipped: number }>({
    total: 0,
    saved: 0,
    skipped: 0
  });

  if (!isOpen) return null;

  // Handler: Mengubah Preset Count
  const handleSelectCountPreset = (preset: number) => {
    setCount(preset);
    setCustomCountInput(preset.toString());
  };

  const handleCustomCountChange = (val: string) => {
    setCustomCountInput(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setCount(Math.min(200, parsed));
    }
  };

  // Build current generator options
  const buildOptions = (): QuickGeneratorOptions => ({
    materialType,
    juz,
    surahNumber: selectedSurah,
    startPage,
    endPage,
    count,
    questionType: 'continuation',
    difficulty,
    spreadEvenly,
    avoidExisting,
    avoidNearDistance
  });

  // Handler: Generate Batch Kandidat
  const handleGenerate = async () => {
    setIsGenerating(true);
    setErrorMessage(null);

    const options = buildOptions();

    try {
      // 1. Pre-fetch pages ke in-memory cache untuk performa maksimal
      await QuickQuestionGenerator.prefetchMaterialPages(options);

      // 2. Eksekusi generator
      const result = await QuickQuestionGenerator.generateCandidates(options, existingItems);

      setCandidates(result.candidates);
      setInsufficientPool(result.insufficientPool);
      setWarningMessage(result.warningMessage);
      setExpandedPreviewIds(new Set()); // Reset preview
      setStep('review');
    } catch (err: any) {
      console.error("Gagal generate kandidat soal:", err);
      setErrorMessage(err?.message || "Terjadi kesalahan saat memproses pembuatan kandidat soal.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Handler: Regenerasi Tunggal (Single Candidate Replacement)
  const handleRegenerateSingle = async (index: number) => {
    setRegeneratingIndex(index);
    try {
      const options = buildOptions();

      const replacement = await QuickQuestionGenerator.regenerateSingleCandidate(
        index,
        candidates,
        options,
        existingItems
      );

      if (replacement) {
        const nextCandidates = [...candidates];
        nextCandidates[index] = replacement;
        setCandidates(nextCandidates);
      } else {
        alert("Tidak ditemukan variasi kandidat unik lain yang memenuhi kriteria pada materi ini.");
      }
    } catch (e: any) {
      alert("Gagal mengganti kandidat: " + (e?.message || "Kesalahan internal"));
    } finally {
      setRegeneratingIndex(null);
    }
  };

  // Handler: Hapus 1 Kandidat dari Review
  const handleRemoveCandidate = (index: number) => {
    const next = candidates.filter((_, idx) => idx !== index);
    setCandidates(next);
  };

  // Handler: Toggle Select Single
  const handleToggleSelect = (index: number) => {
    const next = [...candidates];
    next[index] = { ...next[index], selected: !next[index].selected };
    setCandidates(next);
  };

  // Handler: Select All / Deselect All
  const handleSelectAll = (select: boolean) => {
    setCandidates(candidates.map(c => ({ ...c, selected: select })));
  };

  // Handler: Update Difficulty Per Candidate
  const handleChangeCandidateDifficulty = (index: number, diff: 'easy' | 'medium' | 'hard') => {
    const next = [...candidates];
    next[index] = { ...next[index], difficulty: diff };
    setCandidates(next);
  };

  // Handler: Toggle Preview Snippet
  const handleTogglePreview = (id: string) => {
    const next = new Set(expandedPreviewIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedPreviewIds(next);
  };

  // Handler: Edit Candidate in Mushaf Builder
  const handleEditCandidate = (cand: QuickQuestionCandidate) => {
    const surahInfo = quranService.getSurah(cand.promptStart.surahNumber);
    const draft: QuestionDraft = {
      promptStart: { ...cand.promptStart },
      promptEnd: { ...cand.promptEnd },
      answerStart: { ...cand.answerStart },
      answerEnd: { ...cand.answerEnd },
      promptText: cand.promptText,
      answerText: cand.answerText,
      startPage: cand.pageNumber,
      endPage: cand.pageNumber,
      crossesAyah: (cand.promptStart.surahNumber !== cand.answerEnd.surahNumber) || 
                   (cand.promptStart.ayahNumber !== cand.answerEnd.ayahNumber),
      crossesSurah: cand.promptStart.surahNumber !== cand.answerEnd.surahNumber,
      answerMode: cand.answerMode,
      surahName: surahInfo?.name || `Surat ${cand.promptStart.surahNumber}`,
      ayahDisplay: `QS. ${surahInfo?.name || ''} : ${cand.promptStart.ayahNumber}`
    };

    onClose();
    onEditInMushafBuilder(draft);
  };

  // Handler: Simpan Massal (Bulk Save)
  const handleBulkSave = async () => {
    const selectedList = candidates.filter(c => c.selected);
    if (selectedList.length === 0) {
      alert("Pilih minimal 1 kandidat soal untuk disimpan.");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const res = await api.bulkSaveQuestionBankCandidates(candidates, user);
      if (res.success) {
        setSavedMetrics({
          total: candidates.length,
          saved: res.savedCount,
          skipped: res.skippedCount
        });
        setStep('success');
        onSaveSuccess();
      } else {
        setErrorMessage(res.message || "Gagal menyimpan kandidat soal ke Bank Soal.");
      }
    } catch (e: any) {
      setErrorMessage(e?.message || "Terjadi kesalahan jaringan saat menyimpan soal.");
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCount = candidates.filter(c => c.selected).length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* ================= MODAL HEADER ================= */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-inner text-amber-100">
              <Zap size={22} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-widest font-extrabold bg-white/25 px-2 py-0.5 rounded-full">
                  Quick Generator
                </span>
                <span className="text-amber-100 text-xs font-semibold">• Sambung Ayat</span>
              </div>
              <h3 className="text-lg font-extrabold tracking-tight">
                Quick Bank Soal Generator
              </h3>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* ================= ERROR BANNER ================= */}
        {errorMessage && (
          <div className="bg-red-50 border-b border-red-100 px-6 py-3 text-xs text-red-700 font-medium flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* ================= CONTENT CONTAINER ================= */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {/* ----------------- STEP 1: CONFIGURATION FORM ----------------- */}
          {step === 'config' && (
            <div className="space-y-6">
              <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 text-xs text-amber-900 leading-relaxed flex items-start gap-3">
                <Sparkles size={20} className="text-amber-600 shrink-0 mt-0.5" />
                  <strong className="font-bold">Generator Cerdas Berbasis Koordinat Mushaf:</strong> Fitur ini secara otomatis menyusun kandidat soal Sambung Ayat dengan distribusi merata, memastikan urutan koordinat A &le; A' &lt; B &le; C valid, dan mengecualikan soal yang sudah ada di Bank Soal.
              </div>

              {/* Pilihan Cakupan Materi (Juz, Surah, Halaman) */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                    <BookOpen size={14} className="text-emerald-600" />
                    <span>Pilih Cakupan Materi</span>
                  </label>
                  <div className="flex items-center bg-gray-100 p-1 rounded-xl gap-1">
                    <button
                      type="button"
                      onClick={() => setMaterialType('juz')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                        materialType === 'juz' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Per Juz
                    </button>
                    <button
                      type="button"
                      onClick={() => setMaterialType('surah')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                        materialType === 'surah' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Per Surat
                    </button>
                    <button
                      type="button"
                      onClick={() => setMaterialType('page')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                        materialType === 'page' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Range Halaman
                    </button>
                  </div>
                </div>

                {materialType === 'juz' && (
                  <select
                    value={juz}
                    onChange={(e) => setJuz(parseInt(e.target.value, 10))}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-800 bg-gray-50/50 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all"
                  >
                    {Array.from({ length: 30 }, (_, i) => i + 1).map((j) => (
                      <option key={j} value={j}>
                        Juz {j} {j === 30 ? "(Juz 'Amma: QS 78:1 s.d. 114:6)" : j === 29 ? "(Tabarak: QS 67:1 s.d. 77:50)" : j === 1 ? "(Al-Fatihah s.d. Al-Baqarah 141)" : ""}
                      </option>
                    ))}
                  </select>
                )}

                {materialType === 'surah' && (
                  <select
                    value={selectedSurah}
                    onChange={(e) => setSelectedSurah(parseInt(e.target.value, 10))}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-800 bg-gray-50/50 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all"
                  >
                    {quranService.getSurahs().map((s) => (
                      <option key={s.number} value={s.number}>
                        Surat {s.number}. {s.name} (Mulai Halaman {s.startPage})
                      </option>
                    ))}
                  </select>
                )}

                {materialType === 'page' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-gray-500 block mb-1">Halaman Awal (1 - 604)</label>
                      <input
                        type="number"
                        min={1}
                        max={604}
                        value={startPage}
                        onChange={(e) => setStartPage(Math.max(1, Math.min(604, parseInt(e.target.value, 10) || 1)))}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-800 focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-gray-500 block mb-1">Halaman Akhir (1 - 604)</label>
                      <input
                        type="number"
                        min={1}
                        max={604}
                        value={endPage}
                        onChange={(e) => setEndPage(Math.max(1, Math.min(604, parseInt(e.target.value, 10) || 1)))}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-800 focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Jumlah Kandidat */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                  <Layers size={14} className="text-amber-600" />
                  <span>Jumlah Kandidat Soal</span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {[1, 5, 10, 20, 50, 100].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleSelectCountPreset(num)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all ${
                        count === num 
                          ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {num} Soal
                    </button>
                  ))}
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="text-xs text-gray-500 font-medium">Kustom:</span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={customCountInput}
                      onChange={(e) => handleCustomCountChange(e.target.value)}
                      className="w-20 px-3 py-1.5 rounded-xl border border-gray-200 text-xs font-extrabold text-center text-gray-800 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                    />
                  </div>
                </div>
              </div>

              {/* Jenis & Tingkat Kesulitan */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-700">
                    Jenis Soal
                  </label>
                  <div className="px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-100 text-xs font-bold text-gray-600 flex items-center justify-between">
                    <span>Sambung Ayat</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-extrabold">
                      Aktif (V1)
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-700">
                    Tingkat Kesulitan
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as any)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-800 bg-white focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="mixed">Campuran (30% Mudah, 40% Sedang, 30% Sulit)</option>
                    <option value="easy">Mudah Saja (Prompt Panjang, Awal Ayat)</option>
                    <option value="medium">Sedang Saja (Prompt Normal ~3-4 Kata)</option>
                    <option value="hard">Sulit Saja (Prompt Pendek ~2 Kata)</option>
                  </select>
                </div>
              </div>

              {/* Opsi Checklist */}
              <div className="space-y-2.5 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                <div className="text-xs font-extrabold uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1.5">
                  <Sliders size={14} />
                  <span>Opsi Pemerataan & Anti-Duplikasi</span>
                </div>

                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={spreadEvenly}
                    onChange={(e) => setSpreadEvenly(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-gray-300"
                  />
                  <div className="text-xs">
                    <strong className="text-gray-800 font-bold block">Sebarkan soal secara merata</strong>
                    <span className="text-gray-500 text-[11px]">Membagi materi Juz ke dalam zona proporsional agar soal tidak menumpuk di satu surat/halaman.</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={avoidExisting}
                    onChange={(e) => setAvoidExisting(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-gray-300"
                  />
                  <div className="text-xs">
                    <strong className="text-gray-800 font-bold block">Hindari soal yang sudah ada</strong>
                    <span className="text-gray-500 text-[11px]">Memeriksa fingerprint koordinat agar tidak menduplikasi butir soal di Bank Soal.</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={avoidNearDistance}
                    onChange={(e) => setAvoidNearDistance(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-gray-300"
                  />
                  <div className="text-xs">
                    <strong className="text-gray-800 font-bold block">Hindari titik yang terlalu berdekatan</strong>
                    <span className="text-gray-500 text-[11px]">Mencegah pembuatan soal dengan jarak ≤ 2 ayat pada surat yang sama.</span>
                  </div>
                </label>
              </div>

              {/* Submit CTA */}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full py-3.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white rounded-2xl text-sm font-extrabold tracking-wide transition-all shadow-lg shadow-orange-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    <span>Menyusun {count} Kandidat Soal...</span>
                  </>
                ) : (
                  <>
                    <Zap size={18} />
                    <span>⚡ Generate {count} Kandidat Soal</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* ----------------- STEP 2: CANDIDATE REVIEW SCREEN ----------------- */}
          {step === 'review' && (
            <div className="space-y-4">
              {/* Header Info & Bulk Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
                <div>
                  <div className="text-xs text-gray-400 font-bold uppercase tracking-wider">
                    Hasil Review Generator
                  </div>
                  <h4 className="text-base font-extrabold text-gray-800 flex items-center gap-2">
                    <span>{candidates.length} Kandidat Soal</span>
                    <span className="text-gray-400">•</span>
                    <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg text-xs font-bold">
                      Juz {juz}
                    </span>
                  </h4>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectAll(true)}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    Pilih Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAll(false)}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    Batalkan Semua
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-700 flex items-center gap-1 border border-amber-200"
                  >
                    <RefreshCw size={12} className={isGenerating ? "animate-spin" : ""} />
                    <span>Generate Ulang</span>
                  </button>
                </div>
              </div>

              {/* Insufficient Pool Alert Warning */}
              {insufficientPool && warningMessage && (
                <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl text-xs text-amber-800 flex items-start gap-2.5">
                  <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <strong className="font-bold block">Peringatan Kuota Kandidat Unik:</strong>
                    <span>{warningMessage} Anda dapat melanjutkan dengan {candidates.length} kandidat yang tersedia atau kembali menyesuaikan filter.</span>
                  </div>
                </div>
              )}

              {/* Candidate Cards List */}
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {candidates.map((cand, idx) => {
                  const isPreviewOpen = expandedPreviewIds.has(cand.id);
                  const isRegeneratingThis = regeneratingIndex === idx;

                  return (
                    <div 
                      key={cand.id}
                      className={`p-3.5 sm:p-4 rounded-2xl border transition-all ${
                        cand.selected 
                          ? 'border-emerald-200 bg-emerald-50/30' 
                          : 'border-gray-200 bg-white opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={cand.selected}
                            onChange={() => handleToggleSelect(idx)}
                            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300 cursor-pointer"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-extrabold text-gray-400">
                                #{String(idx + 1).padStart(2, '0')}
                              </span>
                              <strong className="text-sm font-extrabold text-gray-800">
                                QS. {cand.surahName}
                              </strong>
                              <span className="text-xs text-gray-600 font-semibold">
                                Ayat {cand.ayahNumber}
                              </span>
                            </div>
                            <div className="text-[11px] text-gray-500 flex items-center gap-2 mt-0.5">
                              <span>Halaman {cand.pageNumber}</span>
                              <span>•</span>
                              <span>Juz {cand.juzNumber}</span>
                            </div>
                          </div>
                        </div>

                        {/* Difficulty Selector & Actions */}
                        <div className="flex items-center gap-1.5">
                          <select
                            value={cand.difficulty}
                            onChange={(e) => handleChangeCandidateDifficulty(idx, e.target.value as any)}
                            className="px-2 py-1 rounded-lg border border-gray-200 text-[11px] font-bold text-gray-700 bg-white"
                          >
                            <option value="easy">Mudah</option>
                            <option value="medium">Sedang</option>
                            <option value="hard">Sulit</option>
                          </select>

                          {/* Regenerate Single */}
                          <button
                            type="button"
                            title="Ganti kandidat ini dengan titik lain"
                            onClick={() => handleRegenerateSingle(idx)}
                            disabled={isRegeneratingThis}
                            className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 border border-amber-200/60"
                          >
                            <RefreshCw size={14} className={isRegeneratingThis ? "animate-spin" : ""} />
                          </button>

                          {/* Edit in Question Builder */}
                          <button
                            type="button"
                            title="Buka di Question Builder Mushaf"
                            onClick={() => handleEditCandidate(cand)}
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 border border-emerald-200/60"
                          >
                            <Edit3 size={14} />
                          </button>

                          {/* Delete */}
                          <button
                            type="button"
                            title="Hapus kandidat ini"
                            onClick={() => handleRemoveCandidate(idx)}
                            className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 border border-red-200/60"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Preview Toggle & Details */}
                      <div className="mt-2.5 pt-2 border-t border-gray-100/80 flex items-center justify-between text-[11px]">
                        <button
                          type="button"
                          onClick={() => handleTogglePreview(cand.id)}
                          className="text-emerald-700 hover:text-emerald-800 font-bold flex items-center gap-1"
                        >
                          {isPreviewOpen ? <EyeOff size={13} /> : <Eye size={13} />}
                          <span>{isPreviewOpen ? "Tutup Preview Soal" : "Lihat Preview Soal"}</span>
                        </button>
                        <span className="text-gray-400">Estimasi {cand.totalExpectedWords} kata</span>
                      </div>

                      {isPreviewOpen && (
                        <div className="mt-2 p-3 bg-white rounded-xl border border-gray-100 text-xs space-y-2 animate-fade-in">
                          <div>
                            <div className="text-[10px] font-extrabold uppercase text-amber-700 mb-0.5">
                              Prompt Penguji (Titik A → A'):
                            </div>
                            <div className="p-2 bg-amber-50/50 rounded-lg text-gray-800 font-serif leading-relaxed text-right text-sm" dir="rtl">
                              {cand.promptText}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-extrabold uppercase text-emerald-700 mb-0.5">
                              Sambungan Jawaban Santri (Titik B → C):
                            </div>
                            <div className="p-2 bg-emerald-50/50 rounded-lg text-gray-800 font-serif leading-relaxed text-right text-sm" dir="rtl">
                              {cand.answerText}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Bottom Sticky Action Bar */}
              <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep('config')}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50"
                >
                  ⚙️ Atur Ulang
                </button>

                <button
                  type="button"
                  onClick={handleBulkSave}
                  disabled={isSaving || selectedCount === 0}
                  className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-extrabold transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Menyimpan ke Bank Soal...</span>
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      <span>Simpan {selectedCount} ke Bank Soal</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ----------------- STEP 3: SUCCESS SCREEN ----------------- */}
          {step === 'success' && (
            <div className="py-6 text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 size={36} />
              </div>

              <div className="space-y-1">
                <h4 className="text-xl font-extrabold text-gray-800">
                  {savedMetrics.saved} Soal Berhasil Ditambahkan!
                </h4>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  Seluruh butir soal telah disimpan permanen ke Bank Soal dengan status <strong>Draft</strong> untuk kurasi lanjutan.
                </p>
              </div>

              {/* Metrics Box */}
              <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="text-[10px] uppercase font-bold text-gray-400">Total Dibuat</div>
                  <div className="text-base font-extrabold text-gray-800">{savedMetrics.total}</div>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div className="text-[10px] uppercase font-bold text-emerald-600">Disimpan</div>
                  <div className="text-base font-extrabold text-emerald-700">{savedMetrics.saved}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="text-[10px] uppercase font-bold text-gray-400">Dilewati</div>
                  <div className="text-base font-extrabold text-gray-600">{savedMetrics.skipped}</div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md"
                >
                  Lihat Bank Soal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('config');
                    setCandidates([]);
                  }}
                  className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all"
                >
                  ⚡ Generate Lagi
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
