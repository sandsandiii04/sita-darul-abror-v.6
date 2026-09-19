import React, { useState, useEffect } from 'react';
import { 
  ExamQuestionSet, 
  ExamQuestion, 
  ExamMaterialSnapshot, 
  Student, 
  User 
} from '../../types';
import { quranService } from '../../services/quranService';
import { 
  Lock, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowRight, 
  RefreshCw, 
  X, 
  BookOpen, 
  ShieldCheck, 
  Layers, 
  FileText,
  BookMarked
} from 'lucide-react';

interface UASQuestionPreviewProps {
  user: User;
  student: Student;
  snapshot: ExamMaterialSnapshot;
  questionSet: ExamQuestionSet;
  questions: ExamQuestion[];
  isStale?: boolean;
  onClose: () => void;
  onRegenerate?: (reason: string) => Promise<void>;
}

interface ReconstructedUASQuestion {
  question: ExamQuestion;
  promptText: string;
  answerText: string;
  startSurahName: string;
  endSurahName: string;
  isLoading: boolean;
}

export const UASQuestionPreview: React.FC<UASQuestionPreviewProps> = ({
  user,
  student,
  snapshot,
  questionSet,
  questions,
  isStale = false,
  onClose,
  onRegenerate
}) => {
  const [reconstructed, setReconstructed] = useState<ReconstructedUASQuestion[]>([]);
  const [isLoadingTexts, setIsLoadingTexts] = useState(true);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [regenerateReason, setRegenerateReason] = useState('');
  const [isSubmittingRegenerate, setIsSubmittingRegenerate] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isAdmin = user.role === 'admin';

  // Rekonstruksi teks ayat secara dinamis via QuranService
  useEffect(() => {
    let isMounted = true;
    const loadTexts = async () => {
      setIsLoadingTexts(true);

      const items: ReconstructedUASQuestion[] = [];
      for (const q of questions) {
        const startSurahInfo = quranService.getSurah(q.promptStartSurah || q.answerStartSurah);
        const endSurahInfo = quranService.getSurah(q.answerEndSurah);
        const startSurahName = startSurahInfo?.name || `Surat ${q.promptStartSurah || q.answerStartSurah}`;
        const endSurahName = endSurahInfo?.name || `Surat ${q.answerEndSurah}`;

        let promptText = '...';
        let answerText = '...';

        try {
          if (q.questionRole === 'mandatory') {
            // Soal Wajib: Rekonstruksi 1 halaman penuh
            const pageNum = q.pageNumber || q.startPage || 1;
            promptText = `Bacakan Mushaf Standar Madinah Halaman ${pageNum} secara penuh (Juz ${quranService.getPageJuz(pageNum)}).`;

            try {
              const verses = await quranService.getVersesByPage(pageNum);
              if (verses && verses.length > 0) {
                answerText = verses.map(v => v.textUthmani).join(' ۝ ');
              } else {
                answerText = `[Halaman ${pageNum}] ${startSurahName}:${q.answerStartAyah} s.d. ${endSurahName}:${q.answerEndAyah}`;
              }
            } catch (e) {
              answerText = `[Halaman ${pageNum}] ${startSurahName}:${q.answerStartAyah} s.d. ${endSurahName}:${q.answerEndAyah}`;
            }
          } else {
            // Soal Acak: Sambung Ayat A..A' -> B..C
            if (q.promptStartSurah && q.promptStartAyah && q.promptStartWord && q.promptEndSurah && q.promptEndAyah && q.promptEndWord) {
              const pStart = {
                surahNumber: q.promptStartSurah,
                ayahNumber: q.promptStartAyah,
                wordPosition: q.promptStartWord,
                pageNumber: q.startPage || 1
              };
              const pEnd = {
                surahNumber: q.promptEndSurah,
                ayahNumber: q.promptEndAyah,
                wordPosition: q.promptEndWord,
                pageNumber: q.startPage || 1
              };
              const pRes = await quranService.getRangeWordsAndText(pStart, pEnd, false);
              promptText = pRes.fullText || `${startSurahName} ayat ${q.promptStartAyah}`;
            } else {
              promptText = `QS. ${startSurahName}:${q.answerStartAyah}`;
            }

            const aStart = {
              surahNumber: q.answerStartSurah,
              ayahNumber: q.answerStartAyah,
              wordPosition: q.answerStartWord,
              pageNumber: q.startPage || 1
            };
            const aEnd = {
              surahNumber: q.answerEndSurah,
              ayahNumber: q.answerEndAyah,
              wordPosition: q.answerEndWord,
              pageNumber: q.endPage || 1
            };
            const aRes = await quranService.getRangeWordsAndText(aStart, aEnd, false);
            answerText = aRes.fullText || `${endSurahName} ayat ${q.answerEndAyah}`;
          }
        } catch (err) {
          console.warn(`Gagal merekonstruksi teks soal nomor ${q.questionNumber}:`, err);
          promptText = `QS. ${startSurahName}:${q.answerStartAyah}`;
          answerText = `[Ayat Al-Qur'an ${endSurahName}:${q.answerEndAyah}]`;
        }

        items.push({
          question: q,
          promptText,
          answerText,
          startSurahName,
          endSurahName,
          isLoading: false
        });
      }

      if (isMounted) {
        setReconstructed(items);
        setIsLoadingTexts(false);
      }
    };

    loadTexts();

    return () => {
      isMounted = false;
    };
  }, [questions]);

  const handleRegenerateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regenerateReason.trim()) {
      setErrorMsg('Alasan perubahan paket soal wajib diisi.');
      return;
    }

    if (!onRegenerate) return;

    try {
      setIsSubmittingRegenerate(true);
      setErrorMsg(null);
      await onRegenerate(regenerateReason.trim());
      setShowRegenerateModal(false);
      setRegenerateReason('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal meregenerasi paket soal UAS.');
    } finally {
      setIsSubmittingRegenerate(false);
    }
  };

  const mandatoryItems = reconstructed.filter(r => r.question.questionRole === 'mandatory');
  const randomItems = reconstructed.filter(r => r.question.questionRole === 'random');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-emerald-50/50 dark:bg-emerald-950/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  Paket 9 Soal UAS — {student.name}
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300">
                  <Lock className="w-3 h-3" /> Terkunci (v{questionSet.version})
                </span>
                {isStale && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-3 h-3" /> Materi Berubah (Stale)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                NIS: {student.nis || '-'} • Kelas: {student.class || '-'} • Halaqah: {student.halaqah || '-'} • Total: 9 Soal (Bobot 100)
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Snapshot Banner */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-1.5 font-medium">
              <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
              Batas Semester: <strong className="text-slate-800 dark:text-slate-100">{snapshot.startSurahName} ayat {snapshot.startAyah}</strong> s.d. <strong className="text-slate-800 dark:text-slate-100">{snapshot.endSurahName} ayat {snapshot.endAyah}</strong>
            </span>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">•</span>
            <span className="font-medium">
              Arah Progresi: <strong className="capitalize text-slate-800 dark:text-slate-100">{snapshot.memorizationDirection || 'forward'}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              2 Wajib (30) + 7 Acak (70) = 100 Poin
            </span>
          </div>
        </div>

        {/* Modal Body: Daftar 9 Soal */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {isLoadingTexts ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-600 mb-3" />
              <p className="text-sm font-medium">Memuat dan merekonstruksi teks Mushaf Al-Qur'an...</p>
            </div>
          ) : (
            <>
              {/* SEKSI 1: SOAL WAJIB */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-lg bg-emerald-600 text-white">
                    <BookMarked className="w-4 h-4" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                    Bagian 1: Soal Wajib (2 Halaman Penuh — Bobot 2 × 15 = 30 Poin)
                  </h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {mandatoryItems.map((item) => {
                    const q = item.question;
                    const pageNum = q.pageNumber || q.startPage || 1;
                    return (
                      <div 
                        key={q.id}
                        className="rounded-xl border-2 border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 space-y-3 relative overflow-hidden"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center">
                              {q.questionNumber}
                            </span>
                            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                              SOAL WAJIB {q.questionNumber}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-600 text-white">
                            15 Poin
                          </span>
                        </div>

                        <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                            Instruksi Penguji:
                          </p>
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                            {item.promptText}
                          </p>
                        </div>

                        <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                            <span>Teks Mushaf Halaman {pageNum}:</span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              Juz {quranService.getPageJuz(pageNum)}
                            </span>
                          </div>
                          <p className="font-arabic text-base sm:text-lg leading-loose text-right text-slate-800 dark:text-slate-100 max-h-36 overflow-y-auto px-1 py-0.5">
                            {item.answerText}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SEKSI 2: SOAL ACAK 7 ZONA */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-lg bg-blue-600 text-white">
                    <Layers className="w-4 h-4" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                    Bagian 2: Soal Acak Sambung Ayat (7 Zona — Bobot 7 × 10 = 70 Poin)
                  </h4>
                </div>

                <div className="space-y-3">
                  {randomItems.map((item) => {
                    const q = item.question;
                    return (
                      <div 
                        key={q.id}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 p-4 hover:border-slate-300 dark:hover:border-slate-700 transition"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                              {q.questionNumber}
                            </span>
                            <span className="text-xs font-bold text-blue-800 dark:text-blue-300">
                              Zona {q.zoneNumber} (~{Math.round(((q.zoneNumber || 1) - 1) * 100 / 7)}% - ~{Math.round((q.zoneNumber || 1) * 100 / 7)}%)
                            </span>
                            <span className="text-slate-300 dark:text-slate-700">•</span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {item.startSurahName} ayat {q.answerStartAyah} (Kata ke-{q.answerStartWord})
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {q.sourceType === 'bank' ? (
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                                Bank Soal
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                Otomatis
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300">
                              10 Poin
                            </span>
                          </div>
                        </div>

                        {/* Prompt & Answer */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-100 dark:border-slate-800/80">
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                              Prompt Penguji (Titik A .. A')
                            </span>
                            <p className="font-arabic text-base leading-loose text-right text-slate-800 dark:text-slate-100">
                              {item.promptText}
                            </p>
                          </div>

                          <div className="bg-emerald-50/40 dark:bg-emerald-950/20 p-3 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                            <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block mb-1">
                              Acuan Sambung Santri (Titik B .. C)
                            </span>
                            <p className="font-arabic text-base leading-loose text-right text-slate-800 dark:text-slate-100">
                              {item.answerText}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Karakteristik: 2 Wajib Halaman Penuh + 7 Acak 7-Zona • Seed: <code className="text-slate-700 dark:text-slate-300 font-mono">{questionSet.generationSeed.slice(0, 16)}...</code>
          </div>

          <div className="flex items-center gap-2">
            {isAdmin && onRegenerate && (
              <button
                onClick={() => setShowRegenerateModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/50 border border-amber-300 dark:border-amber-800/60 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Regenerate Soal (Admin)
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white dark:bg-slate-700 dark:hover:bg-slate-600 transition"
            >
              Tutup Pratinjau
            </button>
          </div>
        </div>

      </div>

      {/* Modal Dialog Input Alasan Regenerate */}
      {showRegenerateModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center gap-2.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-5 h-5" />
              <h4 className="font-bold text-base text-slate-800 dark:text-slate-100">
                Regenerate Soal UAS Santri
              </h4>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Tindakan ini akan membatalkan paket soal versi saat ini (<code className="font-mono">v{questionSet.version}</code>) dan menghasilkan 9 soal baru (2 Wajib + 7 Acak) dengan nomor versi berikutnya. Alasan pembuatan ulang wajib dicatat dalam log audit.
            </p>

            {errorMsg && (
              <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleRegenerateSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alasan Regenerasi (Wajib)
                </label>
                <textarea
                  value={regenerateReason}
                  onChange={(e) => setRegenerateReason(e.target.value)}
                  placeholder="Contoh: Perubahan materi santri setelah revisi guru / Koordinator memperbarui Bank Soal wajib..."
                  className="w-full h-24 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRegenerateModal(false)}
                  disabled={isSubmittingRegenerate}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRegenerate || !regenerateReason.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 transition"
                >
                  {isSubmittingRegenerate ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Memproses...
                    </>
                  ) : (
                    'Konfirmasi Regenerate'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
