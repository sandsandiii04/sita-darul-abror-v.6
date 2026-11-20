import React, { useState, useMemo } from 'react';
import { ExaminerStudentItem, ExamMaterialSnapshot, User } from '../../types';
import { api } from '../../api';
import { uasQuestionGenerator } from '../../services/uasQuestionGenerator';
import { getFullMushafPagesInSnapshot } from '../../services/uasBulkEligibilityService';
import { MUSHAF_604_PAGE_BOUNDARIES } from '../../constants/mushafPageBoundaries';
import { materialDetectionService } from '../../services/materialDetectionService';
import { BookOpen, CheckCircle2, X, AlertCircle, Lock } from 'lucide-react';

interface UASManualMandatoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  periodId: string;
  student: ExaminerStudentItem;
  onSuccessStartExam: () => void;
}

export const UASManualMandatoryModal: React.FC<UASManualMandatoryModalProps> = ({
  isOpen,
  onClose,
  user,
  periodId,
  student,
  onSuccessStartExam
}) => {
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const snapshotObj = useMemo<ExamMaterialSnapshot | null>(() => {
    if (!student.startSurah || !student.endSurah) return null;
    const minP = Math.min(student.startPage || 1, student.endPage || 1);
    const maxP = Math.max(student.startPage || 1, student.endPage || 1);
    return {
      id: student.snapshotId || `snap_${student.studentId}`,
      examPeriodId: periodId,
      studentId: student.studentId,
      sourceType: 'automatic',
      startSurah: student.startSurah,
      startAyah: student.startAyah || 1,
      endSurah: student.endSurah,
      endAyah: student.endAyah || 1,
      startPage: student.startPage || minP,
      endPage: student.endPage || maxP,
      startJuz: 1,
      endJuz: 30,
      estimatedPages: Math.max(1, maxP - minP + 1),
      memorizationDirection: (student.memorizationDirection as any) || 'forward',
      totalRecordsAnalyzed: 1,
      status: 'finalized',
      createdAt: '',
      updatedAt: ''
    };
  }, [student, periodId]);

  const eligibleFullPages = useMemo(() => {
    if (!snapshotObj) return [];
    try {
      const path = uasQuestionGenerator.buildMaterialPath(snapshotObj);
      const pathPages = Array.from(new Set(path.nodes.map(n => n.pageNumber)));
      return getFullMushafPagesInSnapshot(snapshotObj, pathPages);
    } catch {
      return [];
    }
  }, [snapshotObj]);

  if (!isOpen) return null;

  const togglePage = (p: number) => {
    setErrorMsg(null);
    setSelectedPages(prev => {
      if (prev.includes(p)) return prev.filter(x => x !== p);
      if (prev.length >= 2) return [prev[1], p];
      return [...prev, p];
    });
  };

  const handleConfirm = async () => {
    if (selectedPages.length !== 2 || !snapshotObj) {
      setErrorMsg('Pilih tepat 2 halaman penuh Mushaf Madinah yang berbeda.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      const bankRes = await api.getQuestionBankList({ status: 'active' }).catch(() => ({ data: [] }));
      const bankQuestions = bankRes?.data || [];

      const q1 = await uasQuestionGenerator.buildManualMandatoryQuestion({
        questionNumber: 1,
        pageNumber: selectedPages[0],
        snapshot: snapshotObj,
        bankQuestions
      });
      const q2 = await uasQuestionGenerator.buildManualMandatoryQuestion({
        questionNumber: 2,
        pageNumber: selectedPages[1],
        snapshot: snapshotObj,
        bankQuestions
      });

      const res = await api.selectUASMandatoryPages(
        { periodId, studentId: student.studentId, q1Payload: q1, q2Payload: q2 },
        user
      );
      if (!res.success) {
        setErrorMsg(res.message || 'Gagal menyimpan pilihan 2 soal wajib.');
        return;
      }

      onSuccessStartExam();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Terjadi kesalahan saat memvalidasi halaman wajib.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-900 to-teal-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <BookOpen size={20} className="text-amber-300" />
            </div>
            <div>
              <h3 className="font-bold text-base">Pilih 2 Soal Wajib Halaman Penuh</h3>
              <p className="text-xs text-indigo-100">
                {student.studentName} ({student.class}) — {student.startSurahName}:{student.startAyah} s.d. {student.endSurahName}:{student.endAyah}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={isSaving} className="p-1.5 rounded-xl hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900">
            Pilih tepat <strong>2 halaman penuh</strong> dari materi sah semester berjalan di bawah ini (15 poin/halaman, total 30 poin + 7 soal acak Bank Soal = 100 poin). Halaman parsial atau di luar materi tidak ditampilkan.
          </div>

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {eligibleFullPages.length < 2 ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900">
              Materi santri ini hanya memuat {eligibleFullPages.length} halaman mushaf penuh. Minimal 2 halaman penuh dibutuhkan untuk soal wajib UAS.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {eligibleFullPages.map(p => {
                const b = MUSHAF_604_PAGE_BOUNDARIES[p];
                const isSelected = selectedPages.includes(p);
                const orderIdx = selectedPages.indexOf(p);
                const label = b
                  ? `${materialDetectionService.getSurahName(b.startSurah)}:${b.startAyah} – ${materialDetectionService.getSurahName(b.endSurah)}:${b.endAyah}`
                  : `Halaman ${p}`;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePage(p)}
                    className={`p-3 rounded-2xl border text-left transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500/20'
                        : 'bg-white border-slate-200 hover:border-indigo-300'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800">Halaman {p} (15 Poin)</div>
                      <div className="text-[11px] text-slate-500">{label}</div>
                    </div>
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center gap-1">
                        <CheckCircle2 size={12} /> Wajib {orderIdx + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-600">
            Terpilih: <strong>{selectedPages.length} / 2</strong> halaman ({selectedPages.join(', ') || '-'})
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl"
            >
              Batal
            </button>
            <button
              onClick={handleConfirm}
              disabled={isSaving || selectedPages.length !== 2}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              <Lock size={14} />
              <span>{isSaving ? 'Menyimpan...' : 'Pilih Soal Wajib & Mulai Ujian'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
