import React, { useState, useEffect, useCallback } from 'react';
import { User, QuranVerse as IQuranVerse, QuranWord, QuranPosition, QuestionDraft } from '../../types';
import { 
  quranService, 
  SearchResult, 
  RangeResult, 
  comparePositions, 
  validateQuestionPositions, 
  SURAH_TOTAL_AYAHS 
} from '../../services/quranService';
import MushafPage from './MushafPage';
import MushafNavigation from './MushafNavigation';
import QuranSearch from './QuranSearch';
import QuranVerse from './QuranVerse';
import QuestionBuilder from './QuestionBuilder';
import QuestionPreviewModal from './QuestionPreviewModal';
import WordActionSheet from './WordActionSheet';
import QuestionBankMetadataModal from '../QuestionBank/QuestionBankMetadataModal';
import { 
  BookMarked, 
  Eye, 
  Layers, 
  AlertCircle, 
  RefreshCw, 
  Monitor, 
  PlusCircle, 
  Sparkles, 
  ArrowRight,
  Info
} from 'lucide-react';

interface MushafDigitalProps {
  user?: User;
  initialPage?: number;
  initialDraft?: QuestionDraft | null;
  onNavigateToBankSoal?: () => void;
}

export const MushafDigital: React.FC<MushafDigitalProps> = ({ 
  user, 
  initialPage = 1,
  initialDraft = null,
  onNavigateToBankSoal
}) => {
  const isAdmin = user?.role === 'admin';

  const [currentPage, setCurrentPage] = useState<number>(() => {
    return Math.max(1, Math.min(604, initialPage));
  });

  const [currentJuz, setCurrentJuz] = useState<number>(() => {
    return quranService.getPageJuz(initialPage);
  });

  const [currentSurahNumber, setCurrentSurahNumber] = useState<number | undefined>(1);
  const [pageVerses, setPageVerses] = useState<IQuranVerse[]>([]);
  const [selectedVerseKey, setSelectedVerseKey] = useState<string | undefined>(undefined);
  const [isLoadingVerses, setIsLoadingVerses] = useState<boolean>(false);
  const [versesError, setVersesError] = useState<string | null>(null);

  // Layout View Modes: 'dual' (Bersanding), 'visual' (Mushaf Image Saja), 'data' (Teks Ayat Saja)
  const [viewMode, setViewMode] = useState<'dual' | 'visual' | 'data'>('dual');

  // ================= QUESTION BUILDER STATES (LOCAL REACT STATE) =================
  const [isBuilderActive, setIsBuilderActive] = useState<boolean>(false);
  const [builderStep, setBuilderStep] = useState<
    'prompt_start' | 'prompt_end' | 'answer_start' | 'answer_end' | 'complete'
  >('prompt_start');

  const [promptStart, setPromptStart] = useState<QuranPosition | undefined>(undefined);
  const [promptEnd, setPromptEnd] = useState<QuranPosition | undefined>(undefined);
  const [answerStart, setAnswerStart] = useState<QuranPosition | undefined>(undefined);
  const [answerEnd, setAnswerEnd] = useState<QuranPosition | undefined>(undefined);
  const [answerMode, setAnswerMode] = useState<'end_ayah' | '3_lines' | '5_lines' | 'specific_ayah' | 'manual'>('end_ayah');

  const [promptText, setPromptText] = useState<string>('');
  const [answerText, setAnswerText] = useState<string>('');
  const [builderError, setBuilderError] = useState<string | null>(null);

  // Word Action Sheet (Responsive Tap/Click)
  const [actionSheetWord, setActionSheetWord] = useState<QuranWord | null>(null);
  const [isActionSheetOpen, setIsActionSheetOpen] = useState<boolean>(false);

  // Preview Modal
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [draftResult, setDraftResult] = useState<QuestionDraft | null>(null);
  const [rangeResult, setRangeResult] = useState<RangeResult | null>(null);

  // Question Bank Metadata Modal
  const [isMetadataModalOpen, setIsMetadataModalOpen] = useState<boolean>(false);

  // Restore draft if provided from Bank Soal
  useEffect(() => {
    if (initialDraft) {
      setIsBuilderActive(true);
      setPromptStart(initialDraft.promptStart);
      setPromptEnd(initialDraft.promptEnd);
      setAnswerStart(initialDraft.answerStart);
      setAnswerEnd(initialDraft.answerEnd);
      setAnswerMode(initialDraft.answerMode);
      setPromptText(initialDraft.promptText);
      setAnswerText(initialDraft.answerText);
      setCurrentPage(initialDraft.startPage);
      setBuilderStep('complete');
      setDraftResult(initialDraft);
    }
  }, [initialDraft]);

  // End of Surah Notification
  const [endOfSurahDialog, setEndOfSurahDialog] = useState<{
    isOpen: boolean;
    currentSurahNumber: number;
    currentSurahName: string;
    nextSurahNumber: number;
    nextSurahName: string;
  } | null>(null);

  // Load structured verses data when page changes
  const loadPageData = useCallback(async (page: number) => {
    setIsLoadingVerses(true);
    setVersesError(null);

    try {
      const verses = await quranService.getVersesByPage(page);
      setPageVerses(verses);

      if (verses.length > 0) {
        setCurrentSurahNumber(verses[0].surahNumber);
        setCurrentJuz(verses[0].juzNumber);
        if (!selectedVerseKey || !verses.some(v => v.verseKey === selectedVerseKey)) {
          setSelectedVerseKey(verses[0].verseKey);
        }
      }
    } catch (err: any) {
      setVersesError('Data teks ayat Al-Qur’an belum dapat dimuat dari server. Periksa koneksi internet lalu coba kembali.');
    } finally {
      setIsLoadingVerses(false);
    }
  }, [selectedVerseKey]);

  useEffect(() => {
    loadPageData(currentPage);
  }, [currentPage, loadPageData]);

  // Handlers for Navigation
  const handlePageChange = (newPage: number) => {
    const clamped = Math.max(1, Math.min(604, newPage));
    setCurrentPage(clamped);
    setCurrentJuz(quranService.getPageJuz(clamped));
  };

  const handleJuzChange = (newJuz: number) => {
    const targetPage = quranService.getJuzStartPage(newJuz);
    setCurrentJuz(newJuz);
    setCurrentPage(targetPage);
  };

  const handleSurahChange = (surahNumber: number) => {
    const surah = quranService.getSurah(surahNumber);
    if (surah) {
      setCurrentSurahNumber(surahNumber);
      setCurrentPage(surah.startPage);
      setCurrentJuz(quranService.getPageJuz(surah.startPage));
    }
  };

  const handleSearchResult = (result: SearchResult) => {
    handlePageChange(result.pageNumber);
    if (result.type === 'verse' && result.surahNumber && result.ayahNumber) {
      setSelectedVerseKey(`${result.surahNumber}:${result.ayahNumber}`);
    }
  };

  const handleSelectVerse = (verse: IQuranVerse) => {
    setSelectedVerseKey(verse.verseKey);
  };

  // ================= QUESTION BUILDER ACTIONS =================
  const handleEnterBuilderMode = () => {
    if (!isAdmin) {
      alert('Akses Ditolak: Fitur pembuatan soal hanya diperuntukkan bagi Administrator.');
      return;
    }
    setIsBuilderActive(true);
    setBuilderStep('prompt_start');
    setBuilderError(null);
  };

  const handleExitBuilderMode = () => {
    setIsBuilderActive(false);
    setIsActionSheetOpen(false);
    setIsPreviewOpen(false);
  };

  const handleWordClick = (word: QuranWord, verse: IQuranVerse) => {
    if (!isBuilderActive || !isAdmin) return;
    setActionSheetWord(word);
    setIsActionSheetOpen(true);
  };

  // 1. Set Awal Prompt (A)
  const handleSetPromptStart = async (word: QuranWord) => {
    if (!isAdmin) return;
    const pos: QuranPosition = {
      surahNumber: word.surahNumber,
      ayahNumber: word.ayahNumber,
      wordPosition: word.position,
      pageNumber: word.pageNumber
    };
    setPromptStart(pos);
    setPromptEnd(undefined);
    setAnswerStart(undefined);
    setAnswerEnd(undefined);
    setPromptText(word.textUthmani);
    setAnswerText('');
    setRangeResult(null);
    setDraftResult(null);
    setBuilderStep('prompt_end');
    setBuilderError(null);
  };

  // 2. Set Akhir Prompt (promptEnd)
  const handleSetPromptEnd = async (word: QuranWord) => {
    if (!isAdmin || !promptStart) return;
    const pos: QuranPosition = {
      surahNumber: word.surahNumber,
      ayahNumber: word.ayahNumber,
      wordPosition: word.position,
      pageNumber: word.pageNumber
    };

    if (comparePositions(pos, promptStart) < 0) {
      setBuilderError('Urutan titik soal tidak valid: Akhir prompt tidak boleh sebelum awal prompt.');
      return;
    }

    setPromptEnd(pos);
    setBuilderStep('answer_start');
    setBuilderError(null);

    // Fetch prompt full text
    try {
      const pRes = await quranService.getRangeWordsAndText(promptStart, pos, false);
      setPromptText(pRes.fullText);
    } catch (e) {
      setPromptText(word.textUthmani);
    }

    // Check if prompt is at end of surah
    if (quranService.isEndOfSurah(pos.surahNumber, pos.ayahNumber) && pos.surahNumber < 114) {
      const curSurah = quranService.getSurah(pos.surahNumber);
      const nextSurah = quranService.getSurah(pos.surahNumber + 1);
      setEndOfSurahDialog({
        isOpen: true,
        currentSurahNumber: pos.surahNumber,
        currentSurahName: curSurah?.name || `Surat ${pos.surahNumber}`,
        nextSurahNumber: pos.surahNumber + 1,
        nextSurahName: nextSurah?.name || `Surat ${pos.surahNumber + 1}`
      });
    }
  };

  // 3. Set Awal Jawaban (Titik B)
  const handleSetAnswerStart = async (word: QuranWord) => {
    if (!isAdmin) return;
    const pos: QuranPosition = {
      surahNumber: word.surahNumber,
      ayahNumber: word.ayahNumber,
      wordPosition: word.position,
      pageNumber: word.pageNumber
    };

    if (promptEnd && comparePositions(pos, promptEnd) <= 0) {
      setBuilderError('Urutan titik soal tidak valid: Awal jawaban (B) harus setelah potongan prompt penguji.');
      return;
    }

    setAnswerStart(pos);
    setBuilderStep('answer_end');
    setBuilderError(null);

    // Auto set C based on current answerMode
    if (answerMode === 'end_ayah') {
      const lastWord = await quranService.getLastWordPositionOfAyah(pos.surahNumber, pos.ayahNumber);
      if (lastWord) {
        handleSetAnswerEndPosition(lastWord, pos);
      }
    }
  };

  // 4. Default B: Next Word in sequence
  const handleUseNextWordAsB = async () => {
    if (!isAdmin || !promptEnd) return;
    try {
      const nextPos = await quranService.getNextWordPosition(promptEnd);
      if (nextPos) {
        setAnswerStart(nextPos);
        setBuilderStep('answer_end');
        setBuilderError(null);

        // Auto calculate C to end of that ayah if mode is end_ayah
        if (answerMode === 'end_ayah') {
          const lastWord = await quranService.getLastWordPositionOfAyah(nextPos.surahNumber, nextPos.ayahNumber);
          if (lastWord) {
            handleSetAnswerEndPosition(lastWord, nextPos);
          }
        }
      }
    } catch (e) {
      setBuilderError('Gagal menentukan kata berikutnya secara otomatis. Silakan pilih secara manual.');
    }
  };

  // 5. Set Akhir Jawaban (Titik C)
  const handleSetAnswerEndPosition = async (endPos: QuranPosition, customStart?: QuranPosition) => {
    const start = customStart || answerStart;
    if (!isAdmin || !start || !promptStart || !promptEnd) return;

    const validation = validateQuestionPositions(promptStart, promptEnd, start, endPos);
    if (!validation.valid) {
      setBuilderError(validation.message || 'Urutan titik soal tidak valid.');
      return;
    }

    setAnswerEnd(endPos);
    setBuilderStep('complete');
    setBuilderError(null);

    try {
      const res = await quranService.getRangeWordsAndText(start, endPos, true);
      setRangeResult(res);
      setAnswerText(res.fullText);

      const surahInfo = quranService.getSurah(promptStart.surahNumber);
      const draft: QuestionDraft = {
        promptStart,
        promptEnd,
        answerStart: start,
        answerEnd: endPos,
        promptText,
        answerText: res.fullText,
        startPage: promptStart.pageNumber,
        endPage: endPos.pageNumber,
        crossesAyah: res.crossesAyah,
        crossesSurah: res.crossesSurah,
        answerMode,
        surahName: surahInfo?.name || `Surat ${promptStart.surahNumber}`,
        ayahDisplay: `QS. ${surahInfo?.name || ''} : ${promptStart.ayahNumber}`
      };
      setDraftResult(draft);
    } catch (e) {
      setBuilderError('Gagal memuat kelanjutan teks ayat.');
    }
  };

  const handleSetAnswerEndFromWord = (word: QuranWord) => {
    const pos: QuranPosition = {
      surahNumber: word.surahNumber,
      ayahNumber: word.ayahNumber,
      wordPosition: word.position,
      pageNumber: word.pageNumber
    };
    handleSetAnswerEndPosition(pos);
  };

  // Change Answer Mode (end_ayah, 3_lines, 5_lines, specific_ayah, manual)
  const handleChangeAnswerMode = async (mode: 'end_ayah' | '3_lines' | '5_lines' | 'specific_ayah' | 'manual') => {
    setAnswerMode(mode);
    if (!answerStart) return;

    if (mode === 'end_ayah') {
      const lastWord = await quranService.getLastWordPositionOfAyah(answerStart.surahNumber, answerStart.ayahNumber);
      if (lastWord) {
        handleSetAnswerEndPosition(lastWord);
      }
    } else if (mode === '3_lines' || mode === '5_lines') {
      // In Madinah Mushaf, an ayah typically has 1-2 lines. Target 3-5 lines roughly maps to +1 or +2 ayahs.
      const targetAyahAdd = mode === '3_lines' ? 1 : 2;
      const totalAyahs = SURAH_TOTAL_AYAHS[answerStart.surahNumber] || 1;
      const targetAyah = Math.min(totalAyahs, answerStart.ayahNumber + targetAyahAdd);
      const lastWord = await quranService.getLastWordPositionOfAyah(answerStart.surahNumber, targetAyah);
      if (lastWord) {
        handleSetAnswerEndPosition(lastWord);
      }
    }
  };

  const handleApplySpecificAyah = async (targetAyah: number) => {
    if (!answerStart) return;
    const totalAyahs = SURAH_TOTAL_AYAHS[answerStart.surahNumber] || 1;
    const clampedAyah = Math.max(answerStart.ayahNumber, Math.min(totalAyahs, targetAyah));
    const lastWord = await quranService.getLastWordPositionOfAyah(answerStart.surahNumber, clampedAyah);
    if (lastWord) {
      handleSetAnswerEndPosition(lastWord);
    }
  };

  // Reset & Edit helpers
  const handleEditPrompt = () => {
    setBuilderStep('prompt_end');
    setAnswerStart(undefined);
    setAnswerEnd(undefined);
    setDraftResult(null);
  };

  const handleEditAnswerStart = () => {
    setBuilderStep('answer_start');
    setAnswerStart(undefined);
    setAnswerEnd(undefined);
    setDraftResult(null);
  };

  const handleEditAnswerEnd = () => {
    setBuilderStep('answer_end');
    setAnswerEnd(undefined);
    setDraftResult(null);
  };

  const handleResetAll = () => {
    setPromptStart(undefined);
    setPromptEnd(undefined);
    setAnswerStart(undefined);
    setAnswerEnd(undefined);
    setPromptText('');
    setAnswerText('');
    setDraftResult(null);
    setRangeResult(null);
    setBuilderStep('prompt_start');
    setBuilderError(null);
  };

  const currentSurahName = quranService.getSurah(currentSurahNumber || 1)?.name || `Surat ${currentSurahNumber}`;

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
            <span className="text-xs text-gray-400 font-medium">Mushaf Digital & Question Selector</span>
          </div>
          <h2 className="text-xl md:text-2xl font-extrabold text-gray-800 tracking-tight flex items-center gap-2 mt-1">
            <BookMarked className="text-emerald-600" size={26} />
            <span>Mushaf Digital</span>
          </h2>
          <p className="text-xs md:text-sm text-gray-500 mt-1">
            Baca mushaf dan susun rancangan soal sambung ayat langsung dari teks Al-Qur'an secara interaktif.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Admin-only Button: Buat Soal dari Mushaf */}
          {isAdmin && (
            <button
              type="button"
              onClick={isBuilderActive ? handleExitBuilderMode : handleEnterBuilderMode}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-sm ${
                isBuilderActive
                  ? 'bg-emerald-700 hover:bg-emerald-800 text-white ring-2 ring-emerald-400'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white'
              }`}
            >
              <PlusCircle size={16} />
              <span>{isBuilderActive ? 'Tutup Builder Soal' : '+ Buat Soal dari Mushaf'}</span>
            </button>
          )}

          {/* View Mode Toggle */}
          <div className="flex bg-gray-100 p-1 rounded-xl text-xs font-semibold shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('dual')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === 'dual' ? 'bg-white text-emerald-800 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
              title="Tampilan Bersanding (Mushaf & Teks Ayat)"
            >
              <Monitor size={14} />
              <span className="hidden sm:inline">Bersanding</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('visual')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === 'visual' ? 'bg-white text-emerald-800 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
              title="Hanya Tampilan Visual Mushaf"
            >
              <Eye size={14} />
              <span>Mushaf</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('data')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === 'data' ? 'bg-white text-emerald-800 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
              title="Hanya Tampilan Teks Ayat Terstruktur"
            >
              <Layers size={14} />
              <span>Teks Ayat</span>
            </button>
          </div>
        </div>
      </div>

      {/* ================= QUESTION BUILDER PANEL (IF ACTIVE) ================= */}
      {isBuilderActive && isAdmin && (
        <QuestionBuilder
          isActive={isBuilderActive}
          currentStep={builderStep}
          promptStart={promptStart}
          promptEnd={promptEnd}
          answerStart={answerStart}
          answerEnd={answerEnd}
          answerMode={answerMode}
          promptText={promptText}
          answerText={answerText}
          errorMessage={builderError}
          onUseNextWordAsB={handleUseNextWordAsB}
          onSelectBManual={() => setBuilderStep('answer_start')}
          onChangeAnswerMode={handleChangeAnswerMode}
          onApplySpecificAyah={handleApplySpecificAyah}
          onOpenPreview={() => setIsPreviewOpen(true)}
          onEditPrompt={handleEditPrompt}
          onEditAnswerStart={handleEditAnswerStart}
          onEditAnswerEnd={handleEditAnswerEnd}
          onResetAll={handleResetAll}
          onExitBuilder={handleExitBuilderMode}
        />
      )}

      {/* ================= SEARCH & CONTROLS TOOLBAR ================= */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <QuranSearch onSearchResult={handleSearchResult} />
        <MushafNavigation
          currentPage={currentPage}
          currentJuz={currentJuz}
          currentSurahNumber={currentSurahNumber}
          onPageChange={handlePageChange}
          onJuzChange={handleJuzChange}
          onSurahChange={handleSurahChange}
        />
      </div>

      {/* ================= ERROR BANNER ================= */}
      {versesError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl flex items-center justify-between gap-3 animate-fade-in text-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle size={18} className="text-amber-600 shrink-0" />
            <span>{versesError}</span>
          </div>
          <button
            type="button"
            onClick={() => loadPageData(currentPage)}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold transition-all shadow-sm"
          >
            <RefreshCw size={13} />
            <span>Coba Lagi</span>
          </button>
        </div>
      )}

      {/* ================= END OF SURAH TRANSITION BANNER ================= */}
      {endOfSurahDialog?.isOpen && (
        <div className="bg-emerald-50 border-2 border-emerald-400 text-emerald-950 p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in shadow-md">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
              <Sparkles size={18} />
            </span>
            <div>
              <div className="font-extrabold text-sm text-emerald-900">
                Anda berada di akhir QS. {endOfSurahDialog.currentSurahName}.
              </div>
              <p className="text-xs text-emerald-700 mt-0.5">
                Ingin melanjutkan penyusunan soal ke surat berikutnya (QS. {endOfSurahDialog.nextSurahName})?
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              type="button"
              onClick={() => setEndOfSurahDialog(null)}
              className="px-3.5 py-1.5 bg-white hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold border border-gray-200 transition-all"
            >
              Berhenti di Surat Ini
            </button>
            <button
              type="button"
              onClick={() => {
                handleSurahChange(endOfSurahDialog.nextSurahNumber);
                setEndOfSurahDialog(null);
              }}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1"
            >
              <span>Lanjut ke QS. {endOfSurahDialog.nextSurahName}</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ================= MAIN CONTENT LAYOUT ================= */}
      {viewMode === 'dual' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Visual Mushaf Page */}
          <div className="lg:col-span-7 xl:col-span-7 flex justify-center">
            <MushafPage pageNumber={currentPage} juzNumber={currentJuz} />
          </div>

          {/* Right Column: Selected Ayah Panel & Structured Verses List */}
          <div className="lg:col-span-5 xl:col-span-5 space-y-4">
            <QuranVerse
              verses={pageVerses}
              selectedVerseKey={selectedVerseKey}
              onSelectVerse={handleSelectVerse}
              isLoading={isLoadingVerses}
              isBuilderActive={isBuilderActive}
              promptStart={promptStart}
              promptEnd={promptEnd}
              answerStart={answerStart}
              answerEnd={answerEnd}
              onWordClick={handleWordClick}
            />
          </div>
        </div>
      ) : viewMode === 'visual' ? (
        <div className="flex justify-center">
          <MushafPage pageNumber={currentPage} juzNumber={currentJuz} />
        </div>
      ) : (
        <div className="max-w-3xl mx-auto">
          <QuranVerse
            verses={pageVerses}
            selectedVerseKey={selectedVerseKey}
            onSelectVerse={handleSelectVerse}
            isLoading={isLoadingVerses}
            isBuilderActive={isBuilderActive}
            promptStart={promptStart}
            promptEnd={promptEnd}
            answerStart={answerStart}
            answerEnd={answerEnd}
            onWordClick={handleWordClick}
          />
        </div>
      )}

      {/* ================= WORD ACTION SHEET (MODAL / BOTTOM SHEET) ================= */}
      <WordActionSheet
        word={actionSheetWord}
        surahName={currentSurahName}
        isOpen={isActionSheetOpen}
        currentStep={builderStep}
        promptStart={promptStart}
        promptEnd={promptEnd}
        answerStart={answerStart}
        answerEnd={answerEnd}
        onSetAsPromptStart={handleSetPromptStart}
        onSetAsPromptEnd={handleSetPromptEnd}
        onSetAsAnswerStart={handleSetAnswerStart}
        onSetAsAnswerEnd={handleSetAnswerEndFromWord}
        onClose={() => setIsActionSheetOpen(false)}
      />

      {/* ================= PREVIEW MODAL ================= */}
      <QuestionPreviewModal
        isOpen={isPreviewOpen}
        draft={draftResult}
        rangeResult={rangeResult}
        user={user}
        onClose={() => setIsPreviewOpen(false)}
        onEditPrompt={handleEditPrompt}
        onEditAnswerStart={handleEditAnswerStart}
        onEditAnswerEnd={handleEditAnswerEnd}
        onResetAll={handleResetAll}
        onSaveToBankSoal={() => setIsMetadataModalOpen(true)}
      />

      {/* ================= QUESTION BANK METADATA MODAL ================= */}
      <QuestionBankMetadataModal
        isOpen={isMetadataModalOpen}
        draft={draftResult}
        user={user}
        onClose={() => setIsMetadataModalOpen(false)}
        onSaveSuccess={(savedItem, actionType) => {
          setIsMetadataModalOpen(false);
          setIsPreviewOpen(false);
          if (actionType === 'view_bank' && onNavigateToBankSoal) {
            onNavigateToBankSoal();
          } else if (actionType === 'create_another') {
            handleResetAll();
          }
        }}
      />
    </div>
  );
};

export default MushafDigital;
