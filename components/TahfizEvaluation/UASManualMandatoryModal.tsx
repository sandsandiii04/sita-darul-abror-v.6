import React, { useState, useMemo, useRef } from 'react';
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
  const confirmInFlightRef = useRef(false);

  const sessionCoveredPages: number[] = useMemo(() => {
    const raw = (student as any).coveredPages;
    if (Array.isArray(raw) && raw.length > 0) {
      return Array.from(new Set(raw.map(Number).filter(n => Number.isFinite(n) && n >= 1 && n <= 604))).sort((a, b) => a - b);
    }
    return [];
  }, [student]);

  const snapshotObj = useMemo<ExamMaterialSnapshot | null>(() => {
    const sPage = student.startPage || (sessionCoveredPages.length > 0 ? sessionCoveredPages[0] : 1);
    const ePage = student.endPage || (sessionCoveredPages.length > 0 ? sessionCoveredPages[sessionCoveredPages.length - 1] : 1);
    const minP = Math.min(sPage, ePage);
    const maxP = Math.max(sPage, ePage);
    const startBound = MUSHAF_604_PAGE_BOUNDARIES[minP];
    const endBound = MUSHAF_604_PAGE_BOUNDARIES[maxP];
    const startSurah = student.startSurah || startBound?.startSurah;
    const endSurah = student.endSurah || endBound?.endSurah;
    if (!startSurah || !endSurah) return null;
    return {
      id: student.snapshotId || `snap_${student.studentId}`,
      examPeriodId: periodId,
      studentId: student.studentId,
      sourceType: 'automatic',
      startSurah,
      startAyah: student.startAyah || startBound?.startAyah || 1,
      endSurah,
      endAyah: student.endAyah || endBound?.endAyah || 1,
      startPage: minP,
      endPage: maxP,
      startJuz: (student as any).juzNumber || 1,
      endJuz: (student as any).juzNumber || 30,
      estimatedPages: Math.max(1, maxP - minP + 1),
      memorizationDirection: (student.memorizationDirection as any) || 'forward',
      totalRecordsAnalyzed: 1,
      status: 'finalized',
      createdAt: '',
      updatedAt: ''
    };
  }, [student, periodId, sessionCoveredPages]);

  const eligibleFullPages = useMemo(() => {
    if (sessionCoveredPages.length >= 2) {
      return sessionCoveredPages;
    }
    if (!snapshotObj) return [];
    try {
      const path = uasQuestionGenerator.buildMaterialPath(snapshotObj);
      const pathPages = Array.from(new Set(path.nodes.map(n => n.pageNumber)));
      const fullPages = getFullMushafPagesInSnapshot(snapshotObj, pathPages);
      if (fullPages.length >= 2) return fullPages;
    } catch {
      // Fallback to explicit page range below
    }
    if (snapshotObj.startPage && snapshotObj.endPage && snapshotObj.endPage > snapshotObj.startPage) {
      const range: number[] = [];
      for (let p = snapshotObj.startPage; p <= snapshotObj.endPage; p++) {
        if (MUSHAF_604_PAGE_BOUNDARIES[p]) range.push(p);
      }
      return range;
    }
    return [];
  }, [snapshotObj, sessionCoveredPages]);

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
    if (confirmInFlightRef.current) return;
    if (selectedPages.length !== 2 || !snapshotObj) {
      setErrorMsg('Pilih tepat 2 halaman penuh Mushaf Madinah yang berbeda.');
      return;
    }

    confirmInFlightRef.current = true;
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
        {
          periodId,
          studentId: student.studentId,
          uasSessionId: (student as any).uasSessionId,
          q1Payload: q1,
          q2Payload: q2
        },
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
      confirmInFlightRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-4 sm:px-5 py-4 bg-white border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-teal-50 border border-teal-200 rounded-xl shrink-0">
              <BookOpen size={18} className="text-teal-700" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm sm:text-base text-slate-900 truncate">Pilih 2 Soal Wajib</h3>
              <p className="text-xs text-slate-500 truncate">
                {student.studentName} • Kelas {student.class} • Sesi {(student as any).sessionNumber || 1} • Juz {(student as any).juzNumber || '-'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3.5">
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-900">
            Pilih tepat <strong>2 halaman penuh</strong> untuk soal wajib (15 poin per halaman).
          </div>

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {eligibleFullPages.length < 2 ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              Materi santri ini hanya memuat {eligibleFullPages.length} halaman mushaf penuh. Minimal 2 halaman penuh dibutuhkan untuk soal wajib.
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
                    className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-teal-50 border-teal-500 ring-2 ring-teal-500/20'
                        : 'bg-white border-slate-200 hover:border-teal-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900">Halaman {p}</div>
                      <div className="text-[11px] text-slate-500 truncate">{label}</div>
                    </div>
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded-full bg-teal-600 text-white text-[10px] font-bold flex items-center gap-1 shrink-0">
                        <CheckCircle2 size={12} /> Wajib {orderIdx + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 sm:px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <span className="text-xs font-semibold text-slate-600">
            Terpilih: <strong className="text-slate-900">{selectedPages.length}/2</strong> halaman {selectedPages.length > 0 ? `(${selectedPages.join(', ')})` : ''}
          </span>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl"
            >
              Batal
            </button>
            <button
              onClick={handleConfirm}
              disabled={isSaving || selectedPages.length !== 2}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-50"
            >
              <Lock size={14} />
              <span>{isSaving ? 'Menyimpan...' : 'Mulai Ujian'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
