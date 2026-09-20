import React, { useState, useRef, useEffect } from 'react';
import { 
  User, 
  PdfImportCandidate, 
  PdfAnalysisSummary, 
  QuestionDraft, 
  QuestionBankItem 
} from '../../types';
import { api } from '../../api';
import { quranService } from '../../services/quranService';
import { PdfQuestionParserService } from '../../services/pdfQuestionParser';
import * as pdfjsLib from 'pdfjs-dist';
import { 
  FileText, 
  UploadCloud, 
  X, 
  Check, 
  AlertTriangle, 
  CheckCircle2, 
  Layers, 
  Eye, 
  Edit3, 
  Trash2, 
  Sparkles, 
  ArrowRight, 
  RotateCcw, 
  CheckSquare, 
  Square,
  FileCheck,
  ExternalLink,
  BookOpen,
  Info
} from 'lucide-react';

interface PdfQuestionImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onSaveSuccess: () => void;
  onEditInMushafBuilder: (draft: QuestionDraft) => void;
}

export const PdfQuestionImporterModal: React.FC<PdfQuestionImporterModalProps> = ({
  isOpen,
  onClose,
  user,
  onSaveSuccess,
  onEditInMushafBuilder
}) => {
  // Wizard Steps
  const [step, setStep] = useState<'upload' | 'analyzing' | 'review' | 'success'>('upload');

  // Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Target Juz State (0 = Otomatis dari Dokumen/Header)
  const [selectedJuzTarget, setSelectedJuzTarget] = useState<number>(0);
  const [detectedFilenameJuz, setDetectedFilenameJuz] = useState<number | null>(null);

  // Analysis State
  const [analysisProgress, setAnalysisProgress] = useState<number>(0);
  const [analysisStatusText, setAnalysisStatusText] = useState<string>('');
  const [analysisSummary, setAnalysisSummary] = useState<PdfAnalysisSummary | null>(null);
  const [candidates, setCandidates] = useState<PdfImportCandidate[]>([]);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);

  // Review & Visual Verification State
  const [filterConfidence, setFilterConfidence] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [selectedPreviewCandidate, setSelectedPreviewCandidate] = useState<PdfImportCandidate | null>(null);
  const [pdfCanvasLoading, setPdfCanvasLoading] = useState<boolean>(false);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);

  // Saving State
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [savedCountResult, setSavedCountResult] = useState<number>(0);

  // Effect to render canvas crop when selectedPreviewCandidate changes
  useEffect(() => {
    if (selectedPreviewCandidate && pdfDoc && cropCanvasRef.current && selectedPreviewCandidate.cropRect) {
      PdfQuestionParserService.renderCropToCanvas(
        pdfDoc,
        selectedPreviewCandidate.pageIndex,
        selectedPreviewCandidate.cropRect,
        cropCanvasRef.current
      ).then(() => {
        setPdfCanvasLoading(false);
      }).catch(err => {
        console.error("Gagal render crop PDF:", err);
        setPdfCanvasLoading(false);
      });
    }
  }, [selectedPreviewCandidate, pdfDoc]);

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setFileError(null);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (file: File) => {
    const val = PdfQuestionParserService.validatePdfFile(file);
    if (!val.valid) {
      setFileError(val.error || 'File tidak valid.');
      setSelectedFile(null);
      setDetectedFilenameJuz(null);
      return;
    }
    setSelectedFile(file);

    // Deteksi Juz dari judul/nama file untuk membantu Admin
    const fnMatch = file.name.match(/(?:juz|juzz|j)\s*[-_.]?\s*(\d{1,2})/i);
    if (fnMatch) {
      const jNum = parseInt(fnMatch[1], 10);
      if (jNum >= 1 && jNum <= 30) {
        setDetectedFilenameJuz(jNum);
      } else {
        setDetectedFilenameJuz(null);
      }
    } else {
      setDetectedFilenameJuz(null);
    }
  };

  // Start PDF Analysis
  const handleStartAnalysis = async () => {
    if (!selectedFile) return;
    setStep('analyzing');
    setFileError(null);
    setAnalysisProgress(0);
    setAnalysisStatusText('Menyiapkan parser PDF...');

    try {
      const result = await PdfQuestionParserService.analyzePdf(
        selectedFile,
        (percent, text) => {
          setAnalysisProgress(percent);
          setAnalysisStatusText(text);
        },
        selectedJuzTarget > 0 ? selectedJuzTarget : undefined
      );

      setAnalysisSummary(result.summary);
      setCandidates(result.candidates);
      setPdfDoc(result.pdfDoc);
      setStep('review');
    } catch (err: any) {
      console.error("Gagal menganalisis PDF:", err);
      setFileError(err?.message || 'Terjadi kesalahan saat memproses PDF.');
      setStep('upload');
    }
  };

  // Toggle selection
  const handleToggleSelect = (index: number) => {
    const next = [...candidates];
    const item = next[index];
    if (item.confidence === 'low' && !item.selected) {
      alert("Kandidat dengan kecocokan rendah (Merah) tidak dapat dipilih sebelum diperbaiki via 'Edit di Mushaf'.");
      return;
    }
    item.selected = !item.selected;
    setCandidates(next);
  };

  const handleSelectAll = (select: boolean) => {
    setCandidates(candidates.map(c => {
      if (c.confidence === 'low') return { ...c, selected: false };
      return { ...c, selected: select };
    }));
  };

  // Remove candidate
  const handleRemoveCandidate = (index: number) => {
    setCandidates(candidates.filter((_, idx) => idx !== index));
  };

  // Open Visual PDF Crop Preview Modal
  const handleOpenPdfVisualCrop = async (candidate: PdfImportCandidate) => {
    setSelectedPreviewCandidate(candidate);
    setPdfCanvasLoading(true);
  };



  // Edit in Mushaf Builder
  const handleEditInMushaf = (cand: PdfImportCandidate) => {
    const surahInfo = quranService.getSurah(cand.promptStart.surahNumber);
    const draft: QuestionDraft = {
      promptStart: { ...cand.promptStart },
      promptEnd: { ...cand.promptEnd },
      answerStart: { ...cand.answerStart },
      answerEnd: { ...cand.answerEnd },
      promptText: cand.promptText,
      answerText: cand.answerText,
      startPage: cand.promptStart.pageNumber,
      endPage: cand.answerEnd.pageNumber,
      crossesAyah: cand.promptStart.ayahNumber !== cand.answerEnd.ayahNumber,
      crossesSurah: cand.promptStart.surahNumber !== cand.answerEnd.surahNumber,
      answerMode: 'end_ayah',
      surahName: surahInfo?.name || `Surat ${cand.promptStart.surahNumber}`,
      ayahDisplay: `QS. ${surahInfo?.name || ''} : ${cand.promptStart.ayahNumber}`
    };

    onClose();
    onEditInMushafBuilder(draft);
  };

  // Bulk Save to Bank Soal
  const handleBulkSave = async () => {
    const selectedList = candidates.filter(c => c.selected);
    if (selectedList.length === 0) {
      alert("Pilih minimal 1 kandidat soal untuk disimpan.");
      return;
    }

    setIsSaving(true);
    setSaveErrorMessage(null);

    try {
      const res = await api.bulkSavePdfCandidates(candidates, user);
      if (res.success) {
        setSavedCountResult(res.savedCount);
        setStep('success');
        onSaveSuccess();
      } else {
        setSaveErrorMessage(res.message || "Gagal menyimpan soal hasil impor.");
      }
    } catch (e: any) {
      setSaveErrorMessage(e?.message || "Terjadi kesalahan jaringan saat menyimpan soal.");
    } finally {
      setIsSaving(false);
    }
  };

  // Filtered review list
  const filteredCandidates = candidates.filter(c => {
    if (filterConfidence === 'all') return true;
    return c.confidence === filterConfidence;
  });

  const selectedCount = candidates.filter(c => c.selected).length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-fade-in overflow-hidden">
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border border-gray-100 flex flex-col max-h-[92vh] overflow-hidden">
        {/* ================= MODAL HEADER ================= */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-teal-700 text-white p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20 shadow-inner">
              <FileText size={22} className="text-blue-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-blue-500/30 text-blue-100 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border border-blue-400/30">
                  Tahap 8A • Bank Soal Importer
                </span>
                <span className="text-white/60 text-xs">•</span>
                <span className="text-xs text-blue-100 font-medium">Format Paket PDF</span>
              </div>
              <h3 className="text-lg font-extrabold tracking-tight">
                Import Bank Soal dari Dokumen PDF
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

        {/* ================= CONTENT CONTAINER ================= */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {/* ---------------- STEP 1: UPLOAD ---------------- */}
          {step === 'upload' && (
            <div className="space-y-6 max-w-2xl mx-auto py-4">
              <div className="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-4 text-xs text-blue-900 leading-relaxed flex items-start gap-3">
                <Info size={20} className="text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">Format Dokumen PDF yang Didukung:</strong>
                  <p className="mt-1">
                    Dioptimalkan untuk dokumen bank soal format paket (seperti <em>juz 30(2).pdf</em>: 36 halaman, 1 paket per halaman dengan 4 nomor soal dalam grid 2x2). Sistem mengekstrak lokasi ayat dan mencocokkannya ke sumber kanonikal Al-Qur'an secara aman tanpa bergantung pada teks OCR.
                  </p>
                </div>
              </div>

              {/* Drag & Drop Area */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-8 sm:p-12 text-center cursor-pointer transition-all ${
                  isDragOver 
                    ? 'border-blue-500 bg-blue-50/50 scale-[1.01]' 
                    : selectedFile 
                      ? 'border-emerald-400 bg-emerald-50/30' 
                      : 'border-gray-300 hover:border-blue-400 bg-gray-50/50 hover:bg-white'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="application/pdf,.pdf"
                  className="hidden"
                />

                {selectedFile ? (
                  <div className="space-y-3 animate-fade-in">
                    <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center shadow-sm">
                      <FileCheck size={36} />
                    </div>
                    <div>
                      <div className="text-sm font-extrabold text-gray-800">{selectedFile.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Dokumen PDF Terpilih
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                      }}
                      className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-xs font-bold transition-all"
                    >
                      Ganti File
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-16 h-16 rounded-3xl bg-blue-50 text-blue-600 mx-auto flex items-center justify-center shadow-sm">
                      <UploadCloud size={36} />
                    </div>
                    <div>
                      <div className="text-sm font-extrabold text-gray-800">
                        Klik atau seret file PDF bank soal ke sini
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Format .pdf • Maksimal 25 MB • Maksimal 60 Halaman
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Target Juz Selector */}
              <div className="bg-white border border-gray-200/90 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen size={18} className="text-blue-600" />
                    <span className="text-xs font-extrabold text-gray-800">Target Materi / Kategori Juz</span>
                  </div>
                  {detectedFilenameJuz && selectedJuzTarget === 0 && (
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-2.5 py-0.5 rounded-lg flex items-center gap-1.5 shadow-2xs">
                      <CheckCircle2 size={13} className="text-emerald-600" />
                      Terdeteksi di judul file: <strong>Juz {detectedFilenameJuz}</strong>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                      Pilihan Target Juz:
                    </label>
                    <select
                      value={selectedJuzTarget}
                      onChange={(e) => setSelectedJuzTarget(parseInt(e.target.value, 10))}
                      className="w-full text-xs font-bold border border-gray-300 rounded-xl px-3 py-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-gray-800 cursor-pointer"
                    >
                      <option value={0}>
                        🎯 Otomatis (Dari Header Halaman / Judul File)
                      </option>
                      {Array.from({ length: 30 }, (_, i) => i + 1).map((juz) => (
                        <option key={juz} value={juz}>
                          Juz {juz}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-[11px] text-gray-500 leading-relaxed bg-gray-50/80 p-2.5 rounded-xl border border-gray-100">
                    {selectedJuzTarget === 0 ? (
                      <span>
                        Sistem mendeteksi otomatis dari header halaman PDF (contoh: <em>"Kategori Juz {detectedFilenameJuz || '29'}"</em>) atau judul dokumen.
                      </span>
                    ) : (
                      <span className="text-blue-800 font-medium">
                        Kandidat soal akan dicocokkan khusus ke surat-surat kanonikal dalam <strong>Juz {selectedJuzTarget}</strong>.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {fileError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 font-medium flex items-center gap-2">
                  <AlertTriangle size={16} className="text-red-600 shrink-0" />
                  <span>{fileError}</span>
                </div>
              )}

              {/* Action Button */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-100 transition-all"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={!selectedFile}
                  onClick={handleStartAnalysis}
                  className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition-all shadow-md flex items-center gap-2"
                >
                  <span>Mulai Analisis PDF</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ---------------- STEP 2: ANALYZING PROGRESS ---------------- */}
          {step === 'analyzing' && (
            <div className="py-16 text-center space-y-6 max-w-md mx-auto">
              <div className="relative w-20 h-20 mx-auto">
                <div className="w-20 h-20 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center font-extrabold text-xs text-blue-700">
                  {analysisProgress}%
                </div>
              </div>
              <div className="space-y-1.5">
                <h4 className="text-base font-extrabold text-gray-800">
                  Menganalisis Dokumen PDF
                </h4>
                <p className="text-xs text-gray-500 font-medium">
                  {analysisStatusText}
                </p>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${analysisProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* ---------------- STEP 3: REVIEW CANDIDATES ---------------- */}
          {step === 'review' && (
            <div className="space-y-5">
              {/* Summary Stats Header */}
              {analysisSummary && (
                <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-teal-50 border border-blue-100 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-xs text-gray-500 font-medium flex items-center gap-1.5 flex-wrap">
                      <span>Dokumen: <strong className="text-gray-800">{analysisSummary.fileName}</strong> ({analysisSummary.totalPages} halaman, {analysisSummary.totalPackages} paket)</span>
                      <span className="px-2 py-0.5 bg-blue-600 text-white font-extrabold rounded-md text-[10px] shadow-2xs">
                        {analysisSummary.detectedJuz ? `Kategori: Juz ${analysisSummary.detectedJuz}` : 'Kategori: Juz 30'}
                      </span>
                    </div>
                    <div className="text-base font-extrabold text-gray-800 mt-0.5">
                      {analysisSummary.totalCandidates} Kandidat Soal Ditemukan
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-extrabold rounded-xl flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      {analysisSummary.highConfidenceCount} Cocok Tinggi
                    </span>
                    <span className="px-3 py-1 bg-amber-100 text-amber-800 text-xs font-extrabold rounded-xl flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      {analysisSummary.mediumConfidenceCount} Perlu Diperiksa
                    </span>
                    {analysisSummary.lowConfidenceCount > 0 && (
                      <span className="px-3 py-1 bg-rose-100 text-rose-800 text-xs font-extrabold rounded-xl flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                        {analysisSummary.lowConfidenceCount} Tidak Cocok
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Filter and Selection Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectAll(true)}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
                  >
                    <CheckSquare size={14} className="text-blue-600" />
                    <span>Pilih Semua</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAll(false)}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
                  >
                    <Square size={14} className="text-gray-400" />
                    <span>Batal Pilih</span>
                  </button>
                  <span className="text-xs text-gray-500 font-medium ml-2">
                    Terpilih: <strong className="text-blue-700 font-extrabold">{selectedCount}</strong> dari {candidates.length} soal
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400 font-medium">Filter:</span>
                  {(['all', 'high', 'medium', 'low'] as const).map(conf => (
                    <button
                      key={conf}
                      type="button"
                      onClick={() => setFilterConfidence(conf)}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                        filterConfidence === conf 
                          ? 'bg-blue-600 text-white shadow-sm' 
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {conf === 'all' ? 'Semua' : conf === 'high' ? '🟢 Tinggi' : conf === 'medium' ? '🟡 Periksa' : '🔴 Rendah'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Candidates Grid / List */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 max-h-[50vh] overflow-y-auto pr-1">
                {filteredCandidates.map((cand) => {
                  const globalIdx = candidates.findIndex(c => c.id === cand.id);
                  return (
                    <div 
                      key={cand.id}
                      className={`p-4 rounded-2xl border transition-all ${
                        cand.selected 
                          ? 'bg-blue-50/30 border-blue-200 shadow-sm' 
                          : 'bg-white border-gray-200 opacity-75'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={cand.selected}
                            disabled={cand.confidence === 'low'}
                            onChange={() => handleToggleSelect(globalIdx)}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 rounded-md border-gray-300 cursor-pointer"
                          />
                          <div>
                            <span className="text-[11px] font-extrabold text-blue-700 bg-blue-100/70 px-2 py-0.5 rounded-md">
                              Paket {cand.packageNumber} • Soal #{cand.questionNumber}
                            </span>
                            <span className="text-[10px] text-gray-500 ml-2 font-medium">
                              Hal {cand.pageIndex} • {cand.detectedCategory || `Juz ${cand.detectedJuz || 30}`}
                            </span>
                          </div>
                        </div>

                        {/* Confidence Badge */}
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold flex items-center gap-1 ${
                          cand.confidence === 'high' 
                            ? 'bg-emerald-100 text-emerald-800' 
                            : cand.confidence === 'medium' 
                              ? 'bg-amber-100 text-amber-800' 
                              : 'bg-rose-100 text-rose-800'
                        }`}>
                          <span>{cand.confidence === 'high' ? '🟢 Cocok Tinggi' : cand.confidence === 'medium' ? '🟡 Perlu Diperiksa' : '🔴 Tidak Cocok'}</span>
                        </span>
                      </div>

                      {/* Surah & Range Information */}
                      <div className="mt-2.5 space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-gray-800 text-sm">
                            QS. {cand.surahName} ({cand.surahNumber}) : {cand.ayahStart} s.d. {cand.ayahEnd}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 italic line-clamp-1">
                          {cand.confidenceReason}
                        </p>
                      </div>

                      {/* Quran Canonical Preview */}
                      <div className="mt-2.5 p-2.5 bg-gray-50 rounded-xl space-y-1.5 border border-gray-100">
                        <div>
                          <span className="text-[10px] font-bold text-emerald-700 uppercase">Prompt (A &rarr; A'):</span>
                          <p className="text-xs text-right font-serif text-gray-800 line-clamp-1 mt-0.5" dir="rtl">
                            {cand.promptText}
                          </p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-teal-700 uppercase">Jawaban (B &rarr; C):</span>
                          <p className="text-xs text-right font-serif text-gray-800 line-clamp-1 mt-0.5" dir="rtl">
                            {cand.answerText}
                          </p>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenPdfVisualCrop(cand)}
                          className="px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-50 rounded-lg transition-all flex items-center gap-1"
                        >
                          <Eye size={13} />
                          <span>Lihat Sumber PDF</span>
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditInMushaf(cand)}
                            className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-all flex items-center gap-1"
                            title="Buka dan koreksi batas A..A' dan B..C di Digital Mushaf Builder"
                          >
                            <Edit3 size={13} />
                            <span>Edit di Mushaf</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveCandidate(globalIdx)}
                            className="p-1 text-gray-400 hover:text-red-600 rounded-lg transition-all"
                            title="Hapus dari batch import"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {saveErrorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 font-medium flex items-center gap-2">
                  <AlertTriangle size={16} className="text-red-600 shrink-0" />
                  <span>{saveErrorMessage}</span>
                </div>
              )}

              {/* Bottom Footer Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setStep('upload')}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-all"
                >
                  &larr; Unggah File Lain
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-all"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={isSaving || selectedCount === 0}
                    onClick={handleBulkSave}
                    className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold transition-all shadow-md flex items-center gap-2"
                  >
                    {isSaving ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        <span>Menyimpan ke Server...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={16} />
                        <span>SIMPAN {selectedCount} SOAL KE BANK SOAL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ---------------- STEP 4: SUCCESS ---------------- */}
          {step === 'success' && (
            <div className="py-12 text-center space-y-5 max-w-md mx-auto">
              <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center shadow-md">
                <CheckCircle2 size={36} />
              </div>
              <div className="space-y-1.5">
                <h4 className="text-lg font-extrabold text-gray-800">
                  Import Bank Soal Berhasil!
                </h4>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Sebanyak <strong className="text-emerald-700 font-bold">{savedCountResult} butir soal</strong> berhasil disimpan ke Bank Soal dengan status <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full">Draft</span>.
                </p>
              </div>

              <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 text-xs text-left text-gray-600 space-y-1">
                <div>&bull; Soal tersimpan di database dengan tag <code>pdf_import</code>.</div>
                <div>&bull; Anda dapat mengaktifkan seluruh soal draft secara bersamaan melalui tombol <strong>⚡ Aktifkan Semua Draft</strong> di header Bank Soal.</div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-xs font-extrabold shadow-md"
              >
                Tutup dan Lihat Bank Soal
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ================= SUB-MODAL: VISUAL PDF CROP COMPARISON ================= */}
      {selectedPreviewCandidate && (
        <div className="fixed inset-0 z-60 bg-black/70 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white w-full max-w-2xl rounded-3xl p-5 space-y-4 shadow-2xl border border-gray-100">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <span className="text-[10px] font-extrabold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                  Paket {selectedPreviewCandidate.packageNumber} • Soal #{selectedPreviewCandidate.questionNumber}
                </span>
                <h4 className="text-sm font-extrabold text-gray-800 mt-1">
                  Verifikasi Visual Cuplikan PDF Asli
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPreviewCandidate(null)}
                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-gray-600">
                1. Tampilan Dokumen PDF Asli (Hasil Render Kuadran):
              </div>
              <div className="border border-gray-200 rounded-2xl overflow-hidden bg-gray-50 flex items-center justify-center min-h-[160px] p-2">
                {pdfCanvasLoading && (
                  <div className="text-xs text-gray-400 font-medium animate-pulse">
                    Memuat render kuadran PDF...
                  </div>
                )}
                <canvas 
                  ref={cropCanvasRef} 
                  className="max-w-full max-h-[220px] object-contain shadow-sm rounded-lg" 
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-bold text-gray-600">
                2. Teks Al-Qur'an Kanonikal Terverifikasi:
              </div>
              <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl space-y-1.5">
                <div className="text-xs font-bold text-emerald-800">
                  QS. {selectedPreviewCandidate.surahName} : Ayat {selectedPreviewCandidate.ayahStart} s.d. {selectedPreviewCandidate.ayahEnd}
                </div>
                <p className="text-sm text-right font-serif text-gray-800 leading-loose" dir="rtl">
                  {selectedPreviewCandidate.promptText} ... {selectedPreviewCandidate.answerText}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setSelectedPreviewCandidate(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-xs font-bold text-gray-700 rounded-xl transition-all"
              >
                Tutup Cuplikan
              </button>
              <button
                type="button"
                onClick={() => {
                  const c = selectedPreviewCandidate;
                  setSelectedPreviewCandidate(null);
                  handleEditInMushaf(c);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
              >
                <Edit3 size={14} />
                <span>Edit di Mushaf</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
