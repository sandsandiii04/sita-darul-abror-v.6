import React, { useState } from 'react';
import { ExamQuestion, ExamQuestionAssessment } from '../../types';
import { CheckCircle2, AlertCircle, Award, ArrowLeft, Send, ShieldAlert, BookOpen, Layers } from 'lucide-react';
import { calculateUASAttemptTotalScore, isMandatoryQuestion, UAS_SCORING_CONFIG } from '../../services/uasScoringService';

interface UASExamReviewModalProps {
  studentName: string;
  studentClass: string;
  kkm: number;
  questions: ExamQuestion[];
  assessments: ExamQuestionAssessment[];
  onSubmitFinal: () => Promise<void>;
  onClose: () => void;
  onNavigateToQuestion: (qNumber: number) => void;
  isReadOnly?: boolean;
}

export const UASExamReviewModal: React.FC<UASExamReviewModalProps> = ({
  studentName,
  studentClass,
  kkm,
  questions,
  assessments,
  onSubmitFinal,
  onClose,
  onNavigateToQuestion,
  isReadOnly = false
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completedCount = assessments.filter(a => !!a.completedAt).length;
  const isAllCompleted = completedCount === 9;
  const incompleteQuestions = questions.filter(q => {
    const asm = assessments.find(a => a.questionNumber === q.questionNumber);
    return !asm?.completedAt;
  });

  const totalScore = calculateUASAttemptTotalScore(assessments);
  const isPassed = totalScore >= kkm;

  const handleSubmit = async () => {
    if (!isAllCompleted) {
      setError(`Tidak dapat submit: Baru ${completedCount} dari 9 butir soal yang diselesaikan.`);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmitFinal();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Gagal mengirim hasil ujian UAS.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-100 overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-emerald-800 to-teal-900 text-white flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Award className="text-emerald-300" size={18} />
              <h3 className="font-bold text-sm tracking-wide">
                {isReadOnly ? 'Hasil Nilai Ujian UAS' : 'Review & Submit Nilai UAS'}
              </h3>
            </div>
            <p className="text-xs text-teal-200 mt-0.5 font-medium">
              {studentName} — Kelas {studentClass}
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-teal-200 block uppercase tracking-wider font-semibold">Total Nilai</span>
            <span className="text-2xl font-black text-white">{totalScore}</span>
            <span className="text-xs text-teal-200">/100</span>
          </div>
        </div>

        {/* Completion & Readiness Status Banner */}
        {!isReadOnly && (
          <div className={`p-3 px-4 flex items-center justify-between border-b ${
            isAllCompleted
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}>
            <div className="flex items-center gap-2.5">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-white shrink-0 ${
                isAllCompleted ? 'bg-emerald-600' : 'bg-amber-600'
              }`}>
                {isAllCompleted ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              </div>
              <div>
                <div className="text-xs font-bold flex items-center gap-2">
                  <span>{isAllCompleted ? 'SIAP SUBMIT (9/9 SOAL SELESAI)' : `BELUM LENGKAP: ${completedCount}/9 SELESAI`}</span>
                </div>
                <p className="text-[11px] opacity-80 mt-0.5">
                  {isAllCompleted 
                    ? 'Seluruh 9 butir soal telah diuji dan dikonfirmasi selesai.' 
                    : `Soal belum selesai: Soal ${incompleteQuestions.map(q => q.questionNumber).join(', ')}. Klik butir soal di bawah untuk menilai.`}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Score Summary Banner */}
        <div className={`p-3 px-4 flex items-center justify-between border-b ${
          isPassed 
            ? 'bg-teal-50/70 border-teal-200 text-teal-900' 
            : 'bg-rose-50 border-rose-200 text-rose-900'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-white shrink-0 ${
              isPassed ? 'bg-teal-700' : 'bg-rose-600'
            }`}>
              {isPassed ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            </div>
            <div>
              <div className="text-xs font-bold flex items-center gap-1.5">
                <span>{isPassed ? 'MEMENUHI KKM' : 'DI BAWAH KKM'}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-white/70 border border-current">
                  KKM: {kkm}
                </span>
              </div>
              <p className="text-[11px] opacity-80 mt-0.5">
                {isPassed 
                  ? 'Santri memenuhi nilai ambang batas KKM UAS.' 
                  : 'Santri belum mencapai KKM dan direkomendasikan penguatan materi.'}
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable Questions List */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>Rincian 9 Butir Soal UAS</span>
            <span className="text-[11px] text-slate-400 font-normal">Klik butir soal untuk membuka</span>
          </div>

          {questions.map((q) => {
            const asm = assessments.find(a => a.questionNumber === q.questionNumber);
            const isCompleted = !!asm?.completedAt;
            const isMandatory = isMandatoryQuestion(q.questionNumber, (q as any).questionRole || (q as any).question_role);
            const maxScore = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxQuestionScore : UAS_SCORING_CONFIG.random.maxQuestionScore;
            const maxFluency = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxFluency : UAS_SCORING_CONFIG.random.maxFluency;
            const maxTajwid = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxTajwid : UAS_SCORING_CONFIG.random.maxTajwid;
            const maxMakhraj = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxMakhraj : UAS_SCORING_CONFIG.random.maxMakhraj;

            const fluency = asm?.fluencyScore ?? maxFluency;
            const tajwid = asm?.tajwidScore ?? maxTajwid;
            const makhraj = asm?.makhrajScore ?? maxMakhraj;
            const qScore = asm?.questionScore ?? (fluency + tajwid + makhraj);
            const notes = asm?.notes;
            const pageNum = (q as any).pageNumber || (q as any).page_number || q.startPage;

            return (
              <div
                key={q.questionNumber}
                onClick={() => onNavigateToQuestion(q.questionNumber)}
                className={`p-3.5 rounded-xl border transition-all space-y-2 cursor-pointer ${
                  isCompleted 
                    ? 'border-slate-200 bg-slate-50/50 hover:border-teal-400 hover:bg-teal-50/20' 
                    : 'border-amber-300 bg-amber-50/40 hover:border-amber-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-lg font-bold text-xs flex items-center justify-center ${
                      isCompleted 
                        ? (isMandatory ? 'bg-indigo-700 text-white' : 'bg-teal-700 text-white') 
                        : 'bg-amber-600 text-white'
                    }`}>
                      {q.questionNumber}
                    </span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-800">
                          {isMandatory 
                            ? `Soal Wajib (Halaman ${pageNum || '-'})` 
                            : `Soal Acak — Zona ${q.zoneNumber}`}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                          isMandatory ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-600'
                        }`}>
                          Maks {maxScore}p
                        </span>
                      </div>
                      {!isMandatory && q.promptStartSurah && (
                        <span className="text-[10px] text-slate-500">
                          QS. {q.promptStartSurah}:{q.promptStartAyah}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Question Completion & Score Badge */}
                  <div className="flex items-center gap-2">
                    {isCompleted ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                        <CheckCircle2 size={11} />
                        <span>Selesai — {qScore}/{maxScore}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 flex items-center gap-1">
                        <AlertCircle size={11} />
                        <span>Belum Selesai (Preview: {qScore}/{maxScore})</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Sub Scores */}
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-slate-500 block text-[10px]">Kelancaran</span>
                    <span className="font-bold text-slate-800">{fluency} / {maxFluency}</span>
                    {asm?.fluencyEvents?.length ? (
                      <span className="text-[10px] text-rose-600 block mt-0.5">
                        {asm.fluencyEvents.length} catatan
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-600 block mt-0.5">Sempurna</span>
                    )}
                  </div>

                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-slate-500 block text-[10px]">Tajwid</span>
                    <span className="font-bold text-slate-800">{tajwid} / {maxTajwid}</span>
                    {asm?.tajwidEvents?.length ? (
                      <span className="text-[10px] text-indigo-600 block mt-0.5">
                        {asm.tajwidEvents.length} catatan
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-600 block mt-0.5">Sempurna</span>
                    )}
                  </div>

                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-slate-500 block text-[10px]">Makhraj</span>
                    <span className="font-bold text-slate-800">{makhraj} / {maxMakhraj}</span>
                    {asm?.makhrajEvents?.length ? (
                      <span className="text-[10px] text-teal-600 block mt-0.5">
                        {asm.makhrajEvents.length} catatan
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-600 block mt-0.5">Sempurna</span>
                    )}
                  </div>
                </div>

                {notes && (
                  <p className="text-[11px] text-slate-600 italic bg-white p-2 rounded-lg border border-slate-200/80">
                    "{notes}"
                  </p>
                )}
              </div>
            );
          })}

          {!isReadOnly && (
            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-900 leading-relaxed flex items-start gap-2 mt-4">
              <ShieldAlert size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Konfirmasi Penguncian Nilai UAS:</p>
                <p className="text-[11px] mt-0.5">
                  Setelah tombol submit ditekan, server akan menghitung ulang seluruh skor dari catatan event dan mengunci sesi ujian UAS secara permanen.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-colors flex items-center gap-1.5"
          >
            <ArrowLeft size={14} />
            <span>{isReadOnly ? 'Tutup' : 'Kembali ke Soal'}</span>
          </button>

          {!isReadOnly && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !isAllCompleted}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-md flex items-center gap-2 ${
                isAllCompleted 
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 cursor-pointer' 
                  : 'bg-slate-400 cursor-not-allowed opacity-60'
              }`}
            >
              <Send size={14} className={isSubmitting ? 'animate-spin' : ''} />
              <span>
                {isSubmitting 
                  ? 'Menyimpan...' 
                  : isAllCompleted 
                    ? 'Selesaikan Ujian' 
                    : `Belum Lengkap (${completedCount}/9 Soal)`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
