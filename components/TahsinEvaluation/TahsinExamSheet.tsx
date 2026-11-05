import React, { useState, useEffect } from 'react';
import { 
  User, 
  Student, 
  TahsinPeriod, 
  TahsinSession, 
  TahsinAttempt, 
  TahsinCategoryScore,
  TahsinErrorCounters,
  TahsinReadingLocation
} from '../../types';
import { 
  tahsinService, 
  TAHSIN_CATEGORY_SCORES, 
  TAHSIN_WEIGHTS 
} from '../../services/tahsinService';
import { quranService } from '../../services/quranService';
import { MushafPage } from '../QuranMushaf/MushafPage';
import { QURAN_CHAPTERS } from '../../constants';
import { 
  BookOpen, 
  Shuffle, 
  CheckCircle2, 
  AlertTriangle, 
  Save, 
  Award, 
  ChevronLeft, 
  ChevronRight, 
  Maximize2, 
  Minimize2, 
  Plus, 
  Minus, 
  FileText, 
  Info, 
  HelpCircle,
  RotateCcw,
  Sparkles,
  ArrowLeft,
  Sliders,
  Check
} from 'lucide-react';

interface TahsinExamSheetProps {
  user: User;
  period: TahsinPeriod;
  session: TahsinSession;
  student: Student;
  attemptToEdit?: TahsinAttempt | null;
  attemptNumber?: number;
  attemptType?: 'utama' | 'remedial';
  onBack: () => void;
  onSuccess: () => void;
}

export const TahsinExamSheet: React.FC<TahsinExamSheetProps> = ({
  user,
  period,
  session,
  student,
  attemptToEdit,
  attemptNumber = 1,
  attemptType = 'utama',
  onBack,
  onSuccess
}) => {
  const coverage = tahsinService.getCoverageByClass(student.class);

  // Active Tab on Mobile ('mushaf' vs 'scoring')
  const [activeMobileTab, setActiveMobileTab] = useState<'mushaf' | 'scoring'>('scoring');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Reading Location States
  const [reading, setReading] = useState<TahsinReadingLocation>(() => {
    if (attemptToEdit?.reading) return attemptToEdit.reading;
    return tahsinService.generateRandomReading(student.class, 1);
  });

  const [currentPage, setCurrentPage] = useState<number>(() => reading.startPage || coverage.startPage);
  const [pagesRead, setPagesRead] = useState<number>(() => reading.pagesRead || 1);
  const [showManualModal, setShowManualModal] = useState<boolean>(false);
  const [showReRandomizeModal, setShowReRandomizeModal] = useState<boolean>(false);
  const [randomizeReason, setRandomizeReason] = useState<string>('');

  // Manual Pick States
  const [manualSurah, setManualSurah] = useState<number>(reading.startSurah || 1);
  const [manualAyah, setManualAyah] = useState<number>(reading.startAyah || 1);
  const [manualError, setManualError] = useState<string | null>(null);

  // 4 Aspek Penilaian
  const [categoryMakharij, setCategoryMakharij] = useState<TahsinCategoryScore | null>(() => attemptToEdit?.makharij.category || null);
  const [scoreMakharij, setScoreMakharij] = useState<number>(() => attemptToEdit?.makharij.score ?? 0);
  const [customMakharij, setCustomMakharij] = useState<boolean>(Boolean(attemptToEdit?.makharij.isCustomScore));

  const [categoryTajwid, setCategoryTajwid] = useState<TahsinCategoryScore | null>(() => attemptToEdit?.tajwid.category || null);
  const [scoreTajwid, setScoreTajwid] = useState<number>(() => attemptToEdit?.tajwid.score ?? 0);
  const [customTajwid, setCustomTajwid] = useState<boolean>(Boolean(attemptToEdit?.tajwid.isCustomScore));

  const [categoryKelancaran, setCategoryKelancaran] = useState<TahsinCategoryScore | null>(() => attemptToEdit?.kelancaran.category || null);
  const [scoreKelancaran, setScoreKelancaran] = useState<number>(() => attemptToEdit?.kelancaran.score ?? 0);
  const [customKelancaran, setCustomKelancaran] = useState<boolean>(Boolean(attemptToEdit?.kelancaran.isCustomScore));

  const [categoryWaqaf, setCategoryWaqaf] = useState<TahsinCategoryScore | null>(() => attemptToEdit?.waqaf.category || null);
  const [scoreWaqaf, setScoreWaqaf] = useState<number>(() => attemptToEdit?.waqaf.score ?? 0);
  const [customWaqaf, setCustomWaqaf] = useState<boolean>(Boolean(attemptToEdit?.waqaf.isCustomScore));

  // Mode Detail (Custom numeric override)
  const [showDetailMode, setShowDetailMode] = useState<boolean>(false);

  // Kesalahan Berat
  const [hasCriticalError, setHasCriticalError] = useState<boolean>(() => Boolean(attemptToEdit?.hasCriticalError));
  const [criticalErrorReason, setCriticalErrorReason] = useState<string>(() => attemptToEdit?.criticalErrorReason || '');

  // Pencatatan Kesalahan Opsional
  const [showErrorCounters, setShowErrorCounters] = useState<boolean>(() => Boolean(attemptToEdit?.errorCounts && Object.values(attemptToEdit.errorCounts).some(v => v > 0)));
  const [errorCounters, setErrorCounters] = useState<TahsinErrorCounters>(() => {
    return attemptToEdit?.errorCounts || {
      makhraj: 0,
      mad: 0,
      ghunnah: 0,
      harakat: 0,
      tajwidLain: 0,
      waqaf: 0,
      kelancaran: 0,
      lainnya: 0
    };
  });

  const [coachingNotes, setCoachingNotes] = useState<string>(() => attemptToEdit?.coachingNotes || '');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showConfirmFinalModal, setShowConfirmFinalModal] = useState<boolean>(false);

  // Sinkronisasi Halaman saat reading berubah
  useEffect(() => {
    if (reading.startPage) {
      setCurrentPage(reading.startPage);
    }
  }, [reading]);

  // Handler Pemilihan Kategori Cepat
  const handleSelectCategory = (aspect: 'makharij' | 'tajwid' | 'kelancaran' | 'waqaf', cat: TahsinCategoryScore) => {
    const defaultScore = TAHSIN_CATEGORY_SCORES[cat];
    if (aspect === 'makharij') {
      setCategoryMakharij(cat);
      setScoreMakharij(defaultScore);
      setCustomMakharij(false);
    } else if (aspect === 'tajwid') {
      setCategoryTajwid(cat);
      setScoreTajwid(defaultScore);
      setCustomTajwid(false);
    } else if (aspect === 'kelancaran') {
      setCategoryKelancaran(cat);
      setScoreKelancaran(defaultScore);
      setCustomKelancaran(false);
    } else if (aspect === 'waqaf') {
      setCategoryWaqaf(cat);
      setScoreWaqaf(defaultScore);
      setCustomWaqaf(false);
    }
  };

  // Live Calculations
  const finalScore = tahsinService.calculateScore(scoreMakharij, scoreTajwid, scoreKelancaran, scoreWaqaf);
  const predikatInfo = tahsinService.getPredikat(finalScore);
  const isCompleteForm = categoryMakharij !== null && categoryTajwid !== null && categoryKelancaran !== null && categoryWaqaf !== null;
  const passingStatus = tahsinService.evaluatePassing(
    finalScore, 
    scoreMakharij, 
    scoreTajwid, 
    hasCriticalError, 
    period.passingGrade, 
    period.minMakharij, 
    period.minTajwid
  );

  // Acak Ulang Generator
  const handleReRandomize = () => {
    const newReading = tahsinService.generateRandomReading(student.class, pagesRead, randomizeReason);
    setReading(newReading);
    setShowReRandomizeModal(false);
    setRandomizeReason('');
  };

  // Terapkan Pilihan Manual
  const handleApplyManual = () => {
    const result = tahsinService.createManualReading(manualSurah, manualAyah, pagesRead, student.class);
    if (!result.valid || !result.reading) {
      setManualError(result.message || 'Pilihan bacaan tidak valid.');
      return;
    }
    setReading(result.reading);
    setShowManualModal(false);
    setManualError(null);
  };

  // Update Error Counter
  const handleCounterChange = (key: keyof TahsinErrorCounters, delta: number) => {
    setErrorCounters(prev => ({
      ...prev,
      [key]: Math.max(0, (prev[key] || 0) + delta)
    }));
  };

  // Simpan Draft / Selesaikan Ujian
  const handleSave = async (isFinal: boolean) => {
    if (pagesRead < 0.5) {
      alert('Panjang bacaan minimal 0.5 (setengah) halaman.');
      return;
    }

    if (isFinal) {
      if (!isCompleteForm) {
        alert('Seluruh 4 aspek penilaian wajib diisi sebelum ujian disahkan.');
        return;
      }
      if (hasCriticalError && !criticalErrorReason.trim()) {
        alert('Harap masukkan alasan kesalahan berat berulang.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const attemptId = attemptToEdit?.id || `ta_${session.id}_${attemptNumber}_${Date.now()}`;
      
      const newAttempt: TahsinAttempt = {
        id: attemptId,
        sessionId: session.id,
        attemptNumber,
        attemptType,
        examinerId: user.id,
        examinerName: user.name,
        examDate: attemptToEdit?.examDate || new Date().toISOString().split('T')[0],
        reading: {
          ...reading,
          pagesRead
        },
        makharij: {
          score: scoreMakharij,
          category: categoryMakharij || 'cukup',
          isCustomScore: customMakharij
        },
        tajwid: {
          score: scoreTajwid,
          category: categoryTajwid || 'cukup',
          isCustomScore: customTajwid
        },
        kelancaran: {
          score: scoreKelancaran,
          category: categoryKelancaran || 'cukup',
          isCustomScore: customKelancaran
        },
        waqaf: {
          score: scoreWaqaf,
          category: categoryWaqaf || 'cukup',
          isCustomScore: customWaqaf
        },
        finalScore,
        predikat: predikatInfo.predikat,
        predikatArabic: predikatInfo.arabic,
        hasCriticalError,
        criticalErrorReason: hasCriticalError ? criticalErrorReason : undefined,
        passingStatus: isFinal ? passingStatus : 'belum_selesai',
        errorCounts: errorCounters,
        coachingNotes: coachingNotes.trim() || undefined,
        status: isFinal ? 'finalized' : 'draft',
        finalizedAt: isFinal ? new Date().toISOString() : undefined,
        createdAt: attemptToEdit?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await tahsinService.saveAttempt(session, newAttempt, isFinal);
      alert(isFinal ? 'Ujian Tahsin berhasil disahkan!' : 'Draft ujian berhasil disimpan.');
      onSuccess();
    } catch (e: any) {
      console.error('Gagal menyimpan ujian tahsin:', e);
      alert(`Terjadi kesalahan: ${e.message || 'Gagal menyimpan data.'}`);
    } finally {
      setIsSubmitting(false);
      setShowConfirmFinalModal(false);
    }
  };

  const categories: { key: TahsinCategoryScore; label: string; score: number }[] = [
    { key: 'sangat_baik', label: 'Sangat Baik', score: 95 },
    { key: 'baik', label: 'Baik', score: 85 },
    { key: 'cukup', label: 'Cukup', score: 75 },
    { key: 'kurang', label: 'Kurang', score: 65 },
    { key: 'sangat_kurang', label: 'Sangat Kurang', score: 50 },
  ];

  return (
    <div className={`space-y-4 ${isFullscreen ? 'fixed inset-0 z-50 bg-slate-100 p-4 overflow-y-auto' : ''}`}>
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 hover:bg-slate-100 text-slate-500 rounded-xl transition-colors"
            title="Kembali ke Daftar Peserta"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-slate-800">{student.name}</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100">
                {student.class}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 border border-teal-100">
                {student.halaqah}
              </span>
              {attemptType === 'remedial' && (
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200 uppercase">
                  Remedial #{attemptNumber - 1}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Cakupan: <strong className="text-emerald-700">{coverage.label}</strong> • Penguji: <strong>{user.name}</strong> • Periode: {period.name}
            </p>
          </div>
        </div>

        {/* Live Score Display in Header */}
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200/60 p-2.5 rounded-xl self-start md:self-auto">
          <div className="text-right">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nilai Akhir</div>
            <div className="text-lg font-black text-slate-800">
              {isCompleteForm ? finalScore.toFixed(2) : '--'}
            </div>
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <div>
            <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-extrabold border ${isCompleteForm ? predikatInfo.bg + ' ' + predikatInfo.color + ' ' + predikatInfo.border : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
              {isCompleteForm ? predikatInfo.predikat : 'Belum Lengkap'}
            </span>
          </div>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors ml-1"
            title={isFullscreen ? 'Keluar Layar Penuh' : 'Mode Layar Penuh'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Mobile Tab Toggle */}
      <div className="md:hidden flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
        <button
          onClick={() => setActiveMobileTab('scoring')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeMobileTab === 'scoring' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Award size={14} /> Lembar Penilaian
        </button>
        <button
          onClick={() => setActiveMobileTab('mushaf')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeMobileTab === 'mushaf' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <BookOpen size={14} /> Al-Qur'an Digital (Hal. {currentPage})
        </button>
      </div>

      {/* Main Dual-Pane Workspace */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
        {/* LEFT PANE: Al-Qur'an Digital (7 cols on desktop) */}
        <div className={`md:col-span-7 space-y-3 ${activeMobileTab === 'mushaf' ? 'block' : 'hidden md:block'}`}>
          {/* Reading Location & Generator Action Bar */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                  Lokasi Bacaan Ujian
                </span>
                <h3 className="text-sm font-extrabold text-slate-800 mt-1">
                  {reading.startSurahName} (Ayat {reading.startAyah} s.d. Ayat {reading.endAyah})
                </h3>
                <p className="text-xs text-slate-500">
                  Halaman {reading.startPage} {reading.startPage !== reading.endPage ? `– ${reading.endPage}` : ''} • Juz {reading.juzNumber}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowReRandomizeModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl border border-emerald-200 transition-colors"
                >
                  <Shuffle size={14} /> Acak Bacaan
                </button>
                <button
                  type="button"
                  onClick={() => setShowManualModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 transition-colors"
                >
                  <Sliders size={14} /> Pilih Manual
                </button>
              </div>
            </div>

            {/* Input & Konfirmasi Panjang Bacaan */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-600">Panjang Bacaan:</span>
                <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200">
                  {[0.5, 1, 1.5, 2, 3].map(val => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setPagesRead(val)}
                      className={`px-2 py-0.5 rounded-lg font-bold text-xs transition-colors ${
                        pagesRead === val ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200/60'
                      }`}
                    >
                      {val} Hal
                    </button>
                  ))}
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={pagesRead}
                    onChange={(e) => setPagesRead(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                    className="w-14 px-1.5 py-0.5 bg-white border border-slate-200 rounded text-center font-bold text-xs text-slate-700"
                    title="Input halaman custom"
                  />
                </div>
              </div>

              {pagesRead < 0.5 && (
                <span className="text-[11px] font-bold text-rose-600 flex items-center gap-1">
                  <AlertTriangle size={12} /> Min. ½ halaman
                </span>
              )}
            </div>
          </div>

          {/* Mushaf Viewer Container */}
          <div className="bg-white rounded-2xl p-3 shadow-sm border border-slate-200/80">
            {/* Quick Page Navigator */}
            <div className="flex items-center justify-between mb-3 px-2">
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.min(604, p + 1))} // Mushaf RTL: Next is lower number or physically left
                className="flex items-center gap-1 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors"
                title="Halaman Sebelumnya (RTL)"
              >
                <ChevronLeft size={16} /> Sebelumnya
              </button>

              <div className="text-center font-bold text-xs text-slate-700">
                Halaman {currentPage} dari 604
              </div>

              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="flex items-center gap-1 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors"
                title="Halaman Berikutnya (RTL)"
              >
                Berikutnya <ChevronRight size={16} />
              </button>
            </div>

            {/* Embedded Mushaf Digital Component */}
            <MushafPage 
              pageNumber={currentPage} 
              juzNumber={quranService.getPageJuz(currentPage)} 
            />
          </div>
        </div>

        {/* RIGHT PANE: Lembar Penilaian Tahsin (5 cols on desktop) */}
        <div className={`md:col-span-5 space-y-4 ${activeMobileTab === 'scoring' ? 'block' : 'hidden md:block'}`}>
          {/* Card Aspek Penilaian Wajib */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/80 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-extrabold text-sm text-slate-800 flex items-center gap-2">
                <Award className="text-emerald-600" size={18} />
                Penilaian 4 Aspek Wajib
              </h3>
              <button
                type="button"
                onClick={() => setShowDetailMode(!showDetailMode)}
                className="text-[11px] font-bold text-slate-500 hover:text-emerald-700 flex items-center gap-1"
              >
                <Sliders size={12} /> {showDetailMode ? 'Mode Cepat' : 'Mode Detail'}
              </button>
            </div>

            {/* 1. Makharijul Huruf (35%) */}
            <div className="space-y-2 p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
              <div className="flex items-center justify-between text-xs">
                <span className="font-extrabold text-slate-800">
                  1. Makharijul & Sifat Huruf <span className="text-emerald-700 font-black">(35%)</span>
                </span>
                <span className="font-bold text-slate-600">
                  Skor: <strong className="text-emerald-700 text-sm font-black">{scoreMakharij}</strong>
                </span>
              </div>

              {/* 5 Tombol Cepat */}
              <div className="grid grid-cols-5 gap-1">
                {categories.map(cat => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => handleSelectCategory('makharij', cat.key)}
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-bold transition-all text-center border ${
                      categoryMakharij === cat.key && !customMakharij
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div>{cat.label}</div>
                    <div className="opacity-80 text-[9px]">{cat.score}</div>
                  </button>
                ))}
              </div>

              {showDetailMode && (
                <div className="flex items-center gap-2 pt-1.5 text-xs">
                  <span className="text-[11px] text-slate-500">Skor Manual:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={scoreMakharij}
                    onChange={(e) => {
                      setScoreMakharij(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)));
                      setCustomMakharij(true);
                    }}
                    className="w-16 px-2 py-0.5 bg-white border border-slate-300 rounded text-center font-bold text-xs text-slate-800"
                  />
                </div>
              )}
            </div>

            {/* 2. Tajwid (30%) */}
            <div className="space-y-2 p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
              <div className="flex items-center justify-between text-xs">
                <span className="font-extrabold text-slate-800">
                  2. Tajwid <span className="text-emerald-700 font-black">(30%)</span>
                </span>
                <span className="font-bold text-slate-600">
                  Skor: <strong className="text-emerald-700 text-sm font-black">{scoreTajwid}</strong>
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1">
                {categories.map(cat => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => handleSelectCategory('tajwid', cat.key)}
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-bold transition-all text-center border ${
                      categoryTajwid === cat.key && !customTajwid
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div>{cat.label}</div>
                    <div className="opacity-80 text-[9px]">{cat.score}</div>
                  </button>
                ))}
              </div>

              {showDetailMode && (
                <div className="flex items-center gap-2 pt-1.5 text-xs">
                  <span className="text-[11px] text-slate-500">Skor Manual:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={scoreTajwid}
                    onChange={(e) => {
                      setScoreTajwid(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)));
                      setCustomTajwid(true);
                    }}
                    className="w-16 px-2 py-0.5 bg-white border border-slate-300 rounded text-center font-bold text-xs text-slate-800"
                  />
                </div>
              )}
            </div>

            {/* 3. Kelancaran Bacaan (20%) */}
            <div className="space-y-2 p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
              <div className="flex items-center justify-between text-xs">
                <span className="font-extrabold text-slate-800">
                  3. Kelancaran Bacaan <span className="text-emerald-700 font-black">(20%)</span>
                </span>
                <span className="font-bold text-slate-600">
                  Skor: <strong className="text-emerald-700 text-sm font-black">{scoreKelancaran}</strong>
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1">
                {categories.map(cat => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => handleSelectCategory('kelancaran', cat.key)}
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-bold transition-all text-center border ${
                      categoryKelancaran === cat.key && !customKelancaran
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div>{cat.label}</div>
                    <div className="opacity-80 text-[9px]">{cat.score}</div>
                  </button>
                ))}
              </div>

              {showDetailMode && (
                <div className="flex items-center gap-2 pt-1.5 text-xs">
                  <span className="text-[11px] text-slate-500">Skor Manual:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={scoreKelancaran}
                    onChange={(e) => {
                      setScoreKelancaran(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)));
                      setCustomKelancaran(true);
                    }}
                    className="w-16 px-2 py-0.5 bg-white border border-slate-300 rounded text-center font-bold text-xs text-slate-800"
                  />
                </div>
              )}
            </div>

            {/* 4. Waqaf & Ibtida' (15%) */}
            <div className="space-y-2 p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
              <div className="flex items-center justify-between text-xs">
                <span className="font-extrabold text-slate-800">
                  4. Waqaf & Ibtida' <span className="text-emerald-700 font-black">(15%)</span>
                </span>
                <span className="font-bold text-slate-600">
                  Skor: <strong className="text-emerald-700 text-sm font-black">{scoreWaqaf}</strong>
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1">
                {categories.map(cat => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => handleSelectCategory('waqaf', cat.key)}
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-bold transition-all text-center border ${
                      categoryWaqaf === cat.key && !customWaqaf
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div>{cat.label}</div>
                    <div className="opacity-80 text-[9px]">{cat.score}</div>
                  </button>
                ))}
              </div>

              {showDetailMode && (
                <div className="flex items-center gap-2 pt-1.5 text-xs">
                  <span className="text-[11px] text-slate-500">Skor Manual:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={scoreWaqaf}
                    onChange={(e) => {
                      setScoreWaqaf(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)));
                      setCustomWaqaf(true);
                    }}
                    className="w-16 px-2 py-0.5 bg-white border border-slate-300 rounded text-center font-bold text-xs text-slate-800"
                  />
                </div>
              )}
            </div>

            {/* Pemeriksaan Kesalahan Berat Berulang */}
            <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-900 flex items-center gap-1.5">
                  <AlertTriangle size={15} className="text-amber-600" />
                  Kesalahan Berat Berulang?
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setHasCriticalError(false)}
                    className={`px-3 py-1 rounded-lg font-bold text-xs transition-colors ${
                      !hasCriticalError ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    Tidak
                  </button>
                  <button
                    type="button"
                    onClick={() => setHasCriticalError(true)}
                    className={`px-3 py-1 rounded-lg font-bold text-xs transition-colors ${
                      hasCriticalError ? 'bg-rose-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    Ya
                  </button>
                </div>
              </div>

              {hasCriticalError && (
                <div className="space-y-1 pt-1">
                  <label className="text-[11px] font-bold text-rose-800">Alasan Kesalahan Berat:</label>
                  <input
                    type="text"
                    value={criticalErrorReason}
                    onChange={(e) => setCriticalErrorReason(e.target.value)}
                    placeholder="Contoh: Lahn Jali berulang pada makhraj Ha & 'Ain..."
                    className="w-full px-2.5 py-1.5 bg-white border border-rose-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-rose-500/20"
                  />
                </div>
              )}
            </div>

            {/* Ringkasan Kelulusan & Predikat */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status Kelulusan</span>
                  <div className="text-sm font-black mt-0.5">
                    {isCompleteForm ? (
                      passingStatus === 'lulus' ? (
                        <span className="text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 size={16} /> LULUS
                        </span>
                      ) : (
                        <span className="text-rose-700 flex items-center gap-1">
                          <AlertTriangle size={16} /> PERLU REMEDIAL
                        </span>
                      )
                    ) : (
                      <span className="text-slate-400">Belum Lengkap</span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Predikat</span>
                  <div className="text-sm font-black text-slate-800 mt-0.5">
                    {isCompleteForm ? `${predikatInfo.predikat} (${predikatInfo.arabic})` : '-'}
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-slate-500 italic border-t border-slate-200 pt-1.5">
                * Syarat Lulus: Nilai Akhir ≥ {period.passingGrade}, Makharij ≥ {period.minMakharij}, Tajwid ≥ {period.minTajwid}, & tanpa kesalahan berat.
              </div>
            </div>

            {/* Pencatatan Kesalahan Opsional (Accordion) */}
            <div className="border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setShowErrorCounters(!showErrorCounters)}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-700 hover:text-emerald-700 py-1"
              >
                <span className="flex items-center gap-1.5">
                  <FileText size={15} />
                  Pencatatan Kesalahan Opsional
                </span>
                <span className="text-[11px] text-slate-400 font-normal">
                  {showErrorCounters ? 'Sembunyikan ▲' : 'Tampilkan ▼'}
                </span>
              </button>

              {showErrorCounters && (
                <div className="mt-3 space-y-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 animate-fade-in text-xs">
                  <p className="text-[11px] text-slate-500 italic">
                    Gunakan tombol cepat di bawah untuk mencatat frekuensi kesalahan santri. Nilai tidak otomatis terpotong.
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'makhraj', label: 'Makhraj' },
                      { key: 'mad', label: 'Mad (Panjang)' },
                      { key: 'ghunnah', label: 'Ghunnah' },
                      { key: 'harakat', label: 'Harakat' },
                      { key: 'tajwidLain', label: 'Tajwid Lain' },
                      { key: 'waqaf', label: 'Waqaf / Ibtida' },
                      { key: 'kelancaran', label: 'Kelancaran' },
                      { key: 'lainnya', label: 'Lain-lain' },
                    ].map(item => (
                      <div key={item.key} className="flex items-center justify-between bg-white p-2 rounded-lg border border-slate-200">
                        <span className="font-semibold text-slate-700">{item.label}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleCounterChange(item.key as keyof TahsinErrorCounters, -1)}
                            className="p-1 hover:bg-slate-100 text-slate-500 rounded"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="font-mono font-bold w-5 text-center text-slate-800">
                            {errorCounters[item.key as keyof TahsinErrorCounters] || 0}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCounterChange(item.key as keyof TahsinErrorCounters, 1)}
                            className="p-1 hover:bg-slate-100 text-emerald-600 rounded"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Catatan Pembinaan */}
                  <div className="space-y-1 pt-1">
                    <label className="text-[11px] font-bold text-slate-700">Catatan Pembinaan (Opsional):</label>
                    <textarea
                      rows={2}
                      value={coachingNotes}
                      onChange={(e) => setCoachingNotes(e.target.value)}
                      placeholder="Masukkan arahan atau catatan perbaikan untuk santri..."
                      className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Tombol Aksi Simpan / Sahkan */}
            <div className="pt-2 flex flex-col sm:flex-row gap-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleSave(false)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors flex items-center justify-center gap-2"
              >
                <Save size={15} /> Simpan Draft
              </button>

              <button
                type="button"
                disabled={isSubmitting || !isCompleteForm}
                onClick={() => setShowConfirmFinalModal(true)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Check size={16} /> Sahkan Hasil Ujian
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL 1: Konfirmasi Pengesahan Ujian */}
      {showConfirmFinalModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fade-in border border-slate-100">
            <div className="flex items-center gap-3 text-emerald-800">
              <div className="p-3 bg-emerald-50 rounded-xl">
                <CheckCircle2 size={24} className="text-emerald-600" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-slate-800">Konfirmasi Pengesahan Ujian</h3>
                <p className="text-xs text-slate-500">Hasil ujian akan disahkan dan dicatat resmi ke sistem.</p>
              </div>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-slate-500">Santri:</span><span className="font-bold text-slate-800">{student.name}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Panjang Bacaan:</span><span className="font-bold text-slate-800">{pagesRead} Halaman</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Nilai Akhir:</span><span className="font-bold text-emerald-700 text-sm">{finalScore.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Predikat:</span><span className="font-bold text-slate-800">{predikatInfo.predikat}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Status:</span><span className={`font-black ${passingStatus === 'lulus' ? 'text-emerald-700' : 'text-rose-700'}`}>{passingStatus === 'lulus' ? 'LULUS' : 'PERLU REMEDIAL'}</span></div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmFinalModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleSave(true)}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20"
              >
                {isSubmitting ? 'Menyimpan...' : 'Ya, Sahkan Sekarang'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Acak Ulang Bacaan */}
      {showReRandomizeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4 animate-fade-in border border-slate-100">
            <h3 className="font-extrabold text-sm text-slate-800 flex items-center gap-2">
              <Shuffle size={16} className="text-emerald-600" />
              Acak Ulang Bacaan Santri
            </h3>
            <p className="text-xs text-slate-500">
              Sistem akan memilih lokasi bacaan baru secara acak dalam cakupan <strong>{coverage.label}</strong>.
            </p>

            <div className="space-y-1 text-xs">
              <label className="font-bold text-slate-600">Alasan Acak Ulang (Opsional):</label>
              <input
                type="text"
                value={randomizeReason}
                onChange={(e) => setRandomizeReason(e.target.value)}
                placeholder="Contoh: Permintaan santri, teks terlalu pendek..."
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:bg-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowReRandomizeModal(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleReRandomize}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
              >
                Acak Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Pilih Bacaan Manual */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 animate-fade-in border border-slate-100">
            <h3 className="font-extrabold text-sm text-slate-800 flex items-center gap-2">
              <Sliders size={16} className="text-emerald-600" />
              Pilih Lokasi Bacaan Manual
            </h3>
            <p className="text-xs text-slate-500">
              Pilih surah dan ayat awal. Sistem akan memverifikasi apakah berada dalam cakupan <strong>{coverage.label}</strong>.
            </p>

            {manualError && (
              <div className="p-2.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">
                {manualError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-600">Pilih Surah:</label>
                <select
                  value={manualSurah}
                  onChange={(e) => setManualSurah(parseInt(e.target.value))}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none font-medium"
                >
                  {QURAN_CHAPTERS.map(([num, name]) => (
                    <option key={num} value={num}>
                      {num}. {name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-600">Ayat Awal:</label>
                <input
                  type="number"
                  min="1"
                  value={manualAyah}
                  onChange={(e) => setManualAyah(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none font-bold"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowManualModal(false); setManualError(null); }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleApplyManual}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
              >
                Terapkan Bacaan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TahsinExamSheet;
