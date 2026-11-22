import React, { useState, useRef } from 'react';
import { ExamQuestion, ExamQuestionAssessment, UASSessionType } from '../../types';
import { SessionExaminerEntry } from '../../services/uasExaminerDisplay';
import { CheckCircle2, AlertCircle, Award, ArrowLeft, Send, ShieldAlert, BookOpen, Layers } from 'lucide-react';
import { calculateUASAttemptTotalScore, isMandatoryQuestion, getQuestionMaxScores } from '../../services/uasScoringService';

interface UASExamReviewModalProps {
  studentName: string;
  studentClass: string;
  kkm: number;
  questions: ExamQuestion[];
  assessments: ExamQuestionAssessment[];
  sessionType?: UASSessionType;
  examiners?: SessionExaminerEntry[];
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
  sessionType,
  examiners,
  onSubmitFinal,
  onClose,
  onNavigateToQuestion,
  isReadOnly = false
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const resolvedSessionType: UASSessionType =
    sessionType || (questions.length === 4 ? 'partial_half' : 'full_juz');
  const expectedTotal = questions.length || (resolvedSessionType === 'partial_half' ? 4 : 9);
  const completedCount = assessments.filter(a => !!a.completedAt).length;
  const isAllCompleted = completedCount === expectedTotal;
  const incompleteQuestions = questions.filter(q => {
    const asm = assessments.find(a => a.questionNumber === q.questionNumber);
    return !asm?.completedAt;
  });

  const totalScore = calculateUASAttemptTotalScore(assessments);
  const isPassed = totalScore >= kkm;

  const handleSubmit = async () => {
    if (submitInFlightRef.current) return;
    if (!isAllCompleted) {
      setError(`Tidak dapat submit: Baru ${completedCount} dari ${expectedTotal} butir soal yang diselesaikan.`);
      return;
    }

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmitFinal();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Gagal mengirim hasil ujian UAS.');
      setIsSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Light Header */}
        <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
              <Award size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-slate-900 truncate">
                {isReadOnly ? 'Hasil Nilai UAS' : 'Konfirmasi Nilai UAS'}
              </h3>
              <p className="text-xs text-slate-500 truncate">
                {studentName} • Kelas {studentClass}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-[10px] text-slate-500 block font-semibold">Total Nilai</span>
            <span className="text-2xl font-black text-teal-700">{totalScore}</span>
            <span className="text-xs text-slate-400">/100</span>
          </div>
        </div>

        {/* Completion & Readiness Status Banner */}
        {!isReadOnly && (
          <div className={`px-4 py-2.5 flex items-center justify-between border-b ${
            isAllCompleted
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}>
            <div className="flex items-center gap-2.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0 ${
                isAllCompleted ? 'bg-emerald-600' : 'bg-amber-500'
              }`}>
                {isAllCompleted ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              </div>
              <div>
                <div className="text-xs font-bold">
                  {isAllCompleted ? `Semua soal selesai (${expectedTotal}/${expectedTotal})` : `${completedCount} dari ${expectedTotal} soal selesai`}
                </div>
                {!isAllCompleted && (
                  <p className="text-[11px] opacity-85">
                    Belum selesai: Soal {incompleteQuestions.map(q => q.questionNumber).join(', ')}. Klik soal di bawah untuk melengkapi.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Score Summary Banner */}
        <div className={`px-4 py-2.5 flex items-center justify-between border-b ${
          isPassed 
            ? 'bg-teal-50/70 border-teal-200 text-teal-900' 
            : 'bg-rose-50 border-rose-200 text-rose-900'
        }`}>
          <div className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0 ${
              isPassed ? 'bg-teal-600' : 'bg-rose-600'
            }`}>
              {isPassed ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            </div>
            <div className="text-xs font-bold flex items-center gap-2 flex-wrap">
              <span>{isPassed ? 'Memenuhi KKM' : 'Di Bawah KKM'}</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-white border border-current/20">
                KKM {kkm}
              </span>
            </div>
          </div>
        </div>

        {/* Scrollable Questions List */}
        <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
          {examiners && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-snug">
              {examiners.length === 0 ? (
                <div>
                  Penguji: <span className="text-slate-400 font-medium">Belum ada</span>
                </div>
              ) : examiners.length === 1 ? (
                <div className="break-words whitespace-normal">
                  Penguji: <strong className="text-slate-800">{examiners[0].name}</strong>
                </div>
              ) : (
                <div>
                  <div className="text-slate-500 font-medium">Penguji:</div>
                  <ol className="mt-1 space-y-0.5 pl-4 list-decimal text-slate-800 font-semibold">
                    {examiners.map((ex, idx) => (
                      <li key={ex.id || `${ex.name}-${idx}`} className="break-words whitespace-normal">
                        {ex.name}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-rose-500" />
              <span>{error}</span>
            </div>
          )}

          <div className="text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
            <span>Rincian {expectedTotal} Soal</span>
            {!isReadOnly && <span className="text-[11px] text-slate-400 font-normal">Klik soal untuk ubah</span>}
          </div>

          {questions.map((q) => {
            const asm = assessments.find(a => a.questionNumber === q.questionNumber);
            const isCompleted = !!asm?.completedAt;
            const isMandatory = resolvedSessionType === 'partial_half'
              ? false
              : isMandatoryQuestion(q.questionNumber, (q as any).questionRole || (q as any).question_role);
            const qMax = getQuestionMaxScores(q.questionNumber, (q as any).questionRole || (q as any).question_role, resolvedSessionType);
            const maxScore = qMax.maxQuestionScore;
            const maxFluency = qMax.maxFluency;
            const maxTajwid = qMax.maxTajwid;
            const maxMakhraj = qMax.maxMakhraj;

            const fluency = asm?.fluencyScore ?? maxFluency;
            const tajwid = asm?.tajwidScore ?? maxTajwid;
            const makhraj = asm?.makhrajScore ?? maxMakhraj;
            const qScore = asm?.questionScore ?? (fluency + tajwid + makhraj);
            const notes = asm?.notes;
            const assessedByName = String((asm as any)?.assessedByName || (asm as any)?.assessed_by_name || '').trim();
            const pageNum = (q as any).pageNumber || (q as any).page_number || q.startPage;

            return (
              <div
                key={q.questionNumber}
                onClick={() => !isReadOnly && onNavigateToQuestion(q.questionNumber)}
                className={`p-3 rounded-xl border transition-all space-y-2 ${!isReadOnly ? 'cursor-pointer' : ''} ${
                  isCompleted 
                    ? 'border-slate-200 bg-white hover:border-teal-300' 
                    : 'border-amber-200 bg-amber-50/40 hover:border-amber-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-6 h-6 rounded-lg font-bold text-xs flex items-center justify-center shrink-0 ${
                      isCompleted 
                        ? 'bg-teal-600 text-white' 
                        : 'bg-amber-500 text-white'
                    }`}>
                      {q.questionNumber}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-800 break-words">
                        {isMandatory 
                          ? `Soal Wajib • Halaman ${pageNum || '-'}` 
                          : `Soal Acak • Zona ${q.zoneNumber}`}
                      </div>
                      {assessedByName && (
                        <div className="text-[11px] text-slate-500 break-words">
                          Penguji: <span className="font-semibold text-slate-700">{assessedByName}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Question Completion & Score Badge */}
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold shrink-0 ${
                    isCompleted
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}>
                    {isCompleted ? `${qScore}/${maxScore}` : `Belum (${qScore}/${maxScore})`}
                  </span>
                </div>

                {/* Sub Scores */}
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
                    <span className="text-slate-500 block text-[10px]">Kelancaran</span>
                    <span className="font-bold text-slate-800">{fluency}/{maxFluency}</span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
                    <span className="text-slate-500 block text-[10px]">Tajwid</span>
                    <span className="font-bold text-slate-800">{tajwid}/{maxTajwid}</span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
                    <span className="text-slate-500 block text-[10px]">Makhraj</span>
                    <span className="font-bold text-slate-800">{makhraj}/{maxMakhraj}</span>
                  </div>
                </div>

                {notes && (
                  <p className="text-[11px] text-slate-600 italic bg-slate-50 p-2 rounded-lg border border-slate-200/80">
                    "{notes}"
                  </p>
                )}
              </div>
            );
          })}

          {!isReadOnly && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2 mt-2">
              <ShieldAlert size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                Setelah diselesaikan, nilai ujian akan disimpan dan dikunci.
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
          >
            <ArrowLeft size={14} />
            <span>{isReadOnly ? 'Tutup' : 'Kembali'}</span>
          </button>

          {!isReadOnly && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !isAllCompleted}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-colors flex items-center gap-2 ${
                isAllCompleted 
                  ? 'bg-teal-600 hover:bg-teal-700 cursor-pointer' 
                  : 'bg-slate-300 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Send size={14} className={isSubmitting ? 'animate-spin' : ''} />
              <span>
                {isSubmitting 
                  ? 'Menyimpan...' 
                  : isAllCompleted 
                    ? 'Selesaikan Ujian' 
                    : `Belum Lengkap (${completedCount}/${expectedTotal})`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
