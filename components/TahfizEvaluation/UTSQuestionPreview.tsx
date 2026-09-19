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
  FileText 
} from 'lucide-react';

interface UTSQuestionPreviewProps {
  user: User;
  student: Student;
  snapshot: ExamMaterialSnapshot;
  questionSet: ExamQuestionSet;
  questions: ExamQuestion[];
  isStale?: boolean;
  onClose: () => void;
  onRegenerate?: (reason: string) => Promise<void>;
}

interface ReconstructedQuestion {
  question: ExamQuestion;
  promptText: string;
  answerText: string;
  startSurahName: string;
  endSurahName: string;
  isLoading: boolean;
}

export const UTSQuestionPreview: React.FC<UTSQuestionPreviewProps> = ({
  user,
  student,
  snapshot,
  questionSet,
  questions,
  isStale = false,
  onClose,
  onRegenerate
}) => {
  const [reconstructed, setReconstructed] = useState<ReconstructedQuestion[]>([]);
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

      const items: ReconstructedQuestion[] = [];
      for (const q of questions) {
        const startSurahInfo = quranService.getSurah(q.promptStartSurah);
        const endSurahInfo = quranService.getSurah(q.answerEndSurah);
        const startSurahName = startSurahInfo?.name || `Surat ${q.promptStartSurah}`;
        const endSurahName = endSurahInfo?.name || `Surat ${q.answerEndSurah}`;

        let promptText = '...';
        let answerText = '...';

        try {
          // Rekonstruksi prompt (A .. A')
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

          // Rekonstruksi jawaban (B .. C)
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
          answerText = aRes.fullText || `${endSurahName} ayat ${q.answerStartAyah} s.d. ${q.answerEndAyah}`;
        } catch (err) {
          console.warn('Gagal merekonstruksi teks soal:', err);
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

  const handleConfirmRegenerate = async () => {
    if (!regenerateReason.trim()) {
      setErrorMsg('Wajib mencantumkan alasan pembuatan ulang soal.');
      return;
    }
    if (!onRegenerate) return;

    setIsSubmittingRegenerate(true);
    setErrorMsg(null);
    try {
      await onRegenerate(regenerateReason);
      setShowRegenerateModal(false);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Gagal meregenerate soal.');
    } finally {
      setIsSubmittingRegenerate(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header Modal */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-800 to-teal-800 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/10 rounded-2xl">
              <Layers size={22} className="text-emerald-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black tracking-tight">
                  SOAL UTS TAHFIZ — {student.name}
                </h2>
                <span className="px-2 py-0.5 bg-emerald-700/80 border border-emerald-500/50 rounded-full text-[10px] font-extrabold uppercase">
                  Versi {questionSet.version}
                </span>
                {isStale || questionSet.status === 'stale' ? (
                  <span className="px-2 py-0.5 bg-rose-500/90 text-white rounded-full text-[10px] font-black inline-flex items-center gap-1">
                    <AlertTriangle size={10} /> Kedaluwarsa (Stale)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-indigo-500/90 text-white rounded-full text-[10px] font-bold inline-flex items-center gap-1">
                    <Lock size={10} /> Terkunci (Locked)
                  </span>
                )}
              </div>
              <p className="text-xs text-emerald-100 mt-0.5">
                Kelas {student.class} • {student.halaqah} • Strategi: <strong>{questionSet.generationStrategy.toUpperCase()}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-emerald-200 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Info Banner Materi */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-emerald-600" />
            <span className="font-semibold text-slate-700">Rentang Hafalan Snapshot:</span>
            <strong className="text-slate-900">
              {snapshot.startSurahName} {snapshot.startAyah}
            </strong>
            <ArrowRight size={12} className="text-slate-400" />
            <strong className="text-slate-900">
              {snapshot.endSurahName} {snapshot.endAyah}
            </strong>
            <span className="text-slate-400">
              (Arah: {snapshot.memorizationDirection === 'backward' ? 'Mundur / Juz 30' : 'Maju'})
            </span>
          </div>

          <div className="text-[11px] text-slate-500">
            Dibuat pada: {new Date(questionSet.generatedAt).toLocaleString('id-ID')}
          </div>
        </div>

        {/* Stale Warning Banner */}
        {(isStale || questionSet.status === 'stale') && (
          <div className="p-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between text-xs text-amber-900">
            <div className="flex items-center gap-2.5">
              <AlertTriangle size={18} className="text-amber-600 shrink-0" />
              <div>
                <strong className="font-bold block">Materi Ujian Santri Telah Berubah!</strong>
                <p className="text-amber-700">
                  Snapshot materi santri telah diubah/dibuka kembali setelah soal ini dibuat. Soal ini dinyatakan <strong>stale</strong> dan harus di-generate ulang sebelum pelaksanaan ujian.
                </p>
              </div>
            </div>
            {isAdmin && onRegenerate && (
              <button
                onClick={() => setShowRegenerateModal(true)}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs shrink-0 shadow-sm"
              >
                Regenerate Sekarang
              </button>
            )}
          </div>
        )}

        {/* Content: 5 Zona Soal */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4 bg-slate-50/40">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Distribusi 5 Soal UTS (1 Soal per Zona Materi)
            </h3>
            {isLoadingTexts && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700">
                <RefreshCw size={12} className="animate-spin" />
                <span>Memuat teks mushaf...</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            {questions.map((q) => {
              const recon = reconstructed.find(r => r.question.id === q.id);
              const startSurahName = recon?.startSurahName || `Surat ${q.promptStartSurah}`;
              const endSurahName = recon?.endSurahName || `Surat ${q.answerEndSurah}`;

              return (
                <div
                  key={q.id}
                  className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden p-4 space-y-3 transition-all hover:border-emerald-300 hover:shadow-md"
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2.5 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-xl bg-emerald-100 text-emerald-800 font-black text-xs flex items-center justify-center">
                        #{q.questionNumber}
                      </span>
                      <div>
                        <strong className="text-xs font-black text-slate-900 block">
                          Zona {q.zoneNumber} Materi
                        </strong>
                        <span className="text-[10px] text-slate-400">
                          {q.zoneNumber === 1 && 'Cakupan 0% - 20% (Awal Materi)'}
                          {q.zoneNumber === 2 && 'Cakupan 20% - 40%'}
                          {q.zoneNumber === 3 && 'Cakupan 40% - 60% (Tengah Materi)'}
                          {q.zoneNumber === 4 && 'Cakupan 60% - 80%'}
                          {q.zoneNumber === 5 && 'Cakupan 80% - 100% (Akhir Materi)'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {q.sourceType === 'bank' ? (
                        <span className="px-2.5 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-[10px] rounded-full inline-flex items-center gap-1">
                          <FileText size={10} /> Bank Soal
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-[10px] rounded-full inline-flex items-center gap-1">
                          <Sparkles size={10} /> Auto-Generate
                        </span>
                      )}

                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 font-semibold text-[10px] rounded-md">
                        Mushaf Hal {q.startPage || 1} {q.endPage && q.endPage !== q.startPage ? `- ${q.endPage}` : ''}
                      </span>
                    </div>
                  </div>

                  {/* Section A: Prompt Penguji (A .. A') */}
                  <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-100 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-emerald-900 flex items-center gap-1">
                        <span>A–A' : Prompt Dibacakan Penguji</span>
                      </span>
                      <span className="text-emerald-700 font-medium">
                        QS. {startSurahName} : {q.promptStartAyah} (Kata {q.promptStartWord}) s.d. {q.promptEndAyah} (Kata {q.promptEndWord})
                      </span>
                    </div>
                    <p className="text-right text-base font-serif text-slate-800 leading-relaxed font-semibold pt-1">
                      {recon?.promptText || 'Memuat teks...'}
                    </p>
                  </div>

                  {/* Section B & C: Sambung Ayat & Jawaban Acuan (B .. C) */}
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-900 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span>Titik B (Mulai Santri) ➔ Titik C (Batas Acuan)</span>
                      </span>
                      <span className="text-slate-600 font-medium">
                        Mulai: QS. {startSurahName} : {q.answerStartAyah} (Kata {q.answerStartWord})
                      </span>
                    </div>

                    <div className="text-right text-base font-serif text-slate-700 leading-relaxed pt-1">
                      {recon?.answerText || 'Memuat teks acuan jawaban...'}
                    </div>

                    <div className="pt-1.5 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-400">
                      <span>Batas Akhir (C): QS. {endSurahName} Ayat {q.answerEndAyah} Kata {q.answerEndWord}</span>
                      <span>Target: ~3–5 baris ({q.generatedMetadata?.totalExpectedWords || 25} kata)</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
          <div>
            {!isAdmin && (
              <span className="text-xs text-slate-500 flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-teal-600" />
                <span>Mode Pratinjau Penguji (Guru Halaqah)</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isAdmin && onRegenerate && (
              <button
                onClick={() => setShowRegenerateModal(true)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5"
              >
                <RefreshCw size={14} className="text-amber-600" />
                <span>Generate Ulang (Regenerate)</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white rounded-xl font-bold text-xs shadow-md shadow-emerald-700/20 transition-all"
            >
              Tutup Pratinjau
            </button>
          </div>
        </div>
      </div>

      {/* Modal Konfirmasi Regenerate (Admin Only) */}
      {showRegenerateModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/70">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-2.5 text-amber-800">
              <div className="p-2 bg-amber-100 rounded-xl">
                <RefreshCw size={20} className="text-amber-600" />
              </div>
              <div>
                <h4 className="font-bold text-sm">Generate Ulang Soal UTS</h4>
                <p className="text-xs text-slate-500">Santri: <strong>{student.name}</strong></p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Soal lama (Versi {questionSet.version}) akan dibatalkan (<strong>status: void</strong>) dan digantikan dengan soal baru (<strong>Versi {questionSet.version + 1}</strong>). Tindakan ini akan dicatat ke dalam log audit evaluasi.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                Alasan Generate Ulang <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="Contoh: Titik soal terlalu dekat dengan ayat musykilat / santri sakit / materi baru..."
                value={regenerateReason}
                onChange={(e) => setRegenerateReason(e.target.value)}
                className="w-full p-2.5 text-xs border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              />
            </div>

            {errorMsg && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-medium">
                {errorMsg}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRegenerateModal(false)}
                disabled={isSubmittingRegenerate}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmRegenerate}
                disabled={isSubmittingRegenerate || !regenerateReason.trim()}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSubmittingRegenerate && <RefreshCw size={12} className="animate-spin" />}
                <span>Konfirmasi Regenerate</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
