import React, { useState, useMemo, useEffect } from 'react';
import { 
  ExamPeriod, 
  ExamParticipant, 
  ExamMaterialSnapshot, 
  User, 
  QuestionBankItem 
} from '../../types';
import { api } from '../../api';
import { utsQuestionGenerator } from '../../services/utsQuestionGenerator';
import { 
  evaluateUTSEligibility, 
  UTSEligibilityItem, 
  UTSEligibilityStatus, 
  UTS_ELIGIBILITY_LABELS 
} from '../../services/utsBulkEligibilityService';
import { 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  X, 
  RefreshCw, 
  Lock, 
  Users, 
  Filter, 
  Search, 
  Play, 
  ArrowRight,
  ShieldAlert,
  RotateCcw
} from 'lucide-react';

interface UTSBulkGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  period: ExamPeriod;
  participants: ExamParticipant[];
  snapshots: ExamMaterialSnapshot[];
  questionSetMap: Map<string, { status: string; version: number; id: string }>;
  user: User;
  onSuccess: () => Promise<void>;
  initialClassFilter?: string;
  initialHalaqahFilter?: string;
}

interface ExecutionResultItem {
  studentId: string;
  studentName: string;
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  message: string;
}

export const UTSBulkGeneratorModal: React.FC<UTSBulkGeneratorModalProps> = ({
  isOpen,
  onClose,
  period,
  participants,
  snapshots,
  questionSetMap,
  user,
  onSuccess,
  initialClassFilter = 'all',
  initialHalaqahFilter = 'all'
}) => {
  const [selectedClass, setSelectedClass] = useState<string>(initialClassFilter);
  const [selectedHalaqah, setSelectedHalaqah] = useState<string>(initialHalaqahFilter);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Generation state
  const [isExecuting, setIsExecuting] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [currentStudentName, setCurrentStudentName] = useState<string | null>(null);
  const [executionResults, setExecutionResults] = useState<ExecutionResultItem[] | null>(null);

  // Question count from period configuration (strictly 5, 10, 15, or 20; fallback 5)
  const targetQCount = useMemo(() => {
    return [5, 10, 15, 20].includes(period.utsQuestionCount || 5) 
      ? (period.utsQuestionCount || 5) 
      : 5;
  }, [period.utsQuestionCount]);

  // Distinct classes & halaqahs
  const distinctClasses = useMemo(() => {
    const set = new Set<string>();
    participants.forEach(p => { if (p.class) set.add(p.class); });
    return Array.from(set).sort();
  }, [participants]);

  const distinctHalaqahs = useMemo(() => {
    const set = new Set<string>();
    participants.forEach(p => { if (p.halaqah) set.add(p.halaqah); });
    return Array.from(set).sort();
  }, [participants]);

  // Read-only eligibility summary (DB delta = 0)
  const eligibilitySummary = useMemo(() => {
    return evaluateUTSEligibility({
      participants,
      snapshots,
      questionSetMap,
      targetQCount,
      classFilter: selectedClass,
      halaqahFilter: selectedHalaqah
    });
  }, [participants, snapshots, questionSetMap, targetQCount, selectedClass, selectedHalaqah]);

  // Filtered item list for display
  const displayedItems = useMemo(() => {
    return eligibilitySummary.items.filter(item => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.studentName.toLowerCase().includes(q);
        const matchClass = item.studentClass.toLowerCase().includes(q);
        const matchHalaqah = item.halaqah.toLowerCase().includes(q);
        if (!matchName && !matchClass && !matchHalaqah) return false;
      }
      return true;
    });
  }, [eligibilitySummary.items, statusFilter, searchQuery]);

  // Reset execution results when modal opens or filter changes
  useEffect(() => {
    if (!isOpen) {
      setExecutionResults(null);
      setIsExecuting(false);
      setProcessedCount(0);
      setTotalToProcess(0);
      setCurrentStudentName(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Execute Bulk Generation Orchestrator
  const executeBulkGeneration = async (targetItems: UTSEligibilityItem[]) => {
    if (targetItems.length === 0) {
      alert('Tidak ada santri yang memenuhi syarat untuk dibuatkan soal.');
      return;
    }

    const confirmMsg = `Buat paket soal untuk ${targetItems.length} peserta yang siap?\n\nPaket soal yang sudah ada tidak akan ditimpa.`;
    if (!window.confirm(confirmMsg)) return;

    setIsExecuting(true);
    setTotalToProcess(targetItems.length);
    setProcessedCount(0);
    setExecutionResults(null);

    const results: ExecutionResultItem[] = [];

    try {
      // 1. Ambil Bank Soal aktif sekali saja di awal untuk efisiensi
      const bankRes = await api.getQuestionBankList({ status: 'active', examType: 'uts' });
      const bankQuestions: QuestionBankItem[] = bankRes?.data || [];

      // 2. Eksekusi per santri dengan bounded batch / isolation
      for (let i = 0; i < targetItems.length; i++) {
        const item = targetItems[i];
        setCurrentStudentName(item.studentName);

        // Jika santri ternyata sudah memiliki soal terkunci yang valid, lewati (Idempotent)
        const currentQInfo = questionSetMap.get(item.studentId);
        if (currentQInfo && currentQInfo.status === 'locked' && item.status === 'ALREADY_GENERATED') {
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: 'SKIPPED',
            message: `Soal v${currentQInfo.version} sudah aktif.`
          });
          setProcessedCount(i + 1);
          continue;
        }

        if (!item.snapshot || item.snapshot.status !== 'finalized') {
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: 'FAILED',
            message: 'Materi belum difinalisasi.'
          });
          setProcessedCount(i + 1);
          continue;
        }

        try {
          // Jalankan generator N-zone
          const genResult = await utsQuestionGenerator.generateUTSQuestionSet({
            period,
            snapshot: item.snapshot,
            strategy: 'hybrid',
            bankQuestions,
            actorId: user.id
          });

          // Simpan paket soal ke database
          const saveRes = await api.generateUTSQuestionSet({
            periodId: period.id,
            studentId: item.studentId,
            strategy: 'hybrid',
            questions: genResult.questions,
            seed: genResult.questionSet.generationSeed,
            fingerprint: genResult.questionSet.materialFingerprint
          }, user);

          if (saveRes.success) {
            results.push({
              studentId: item.studentId,
              studentName: item.studentName,
              status: saveRes.isExisting ? 'SKIPPED' : 'SUCCESS',
              message: saveRes.isExisting 
                ? 'Paket soal sudah aktif dan terkunci sebelumnya.' 
                : `Berhasil membuat ${targetQCount} soal.`
            });
          } else {
            results.push({
              studentId: item.studentId,
              studentName: item.studentName,
              status: 'FAILED',
              message: saveRes.message || 'Gagal menyimpan paket soal ke server.'
            });
          }
        } catch (genErr: any) {
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: 'FAILED',
            message: genErr?.message || 'Gagal menghasilkan butir soal.'
          });
        }

        setProcessedCount(i + 1);
      }

      setExecutionResults(results);
      // Panggil callback parent untuk memuat ulang daftar soal
      await onSuccess();
    } catch (err: any) {
      alert(`Terjadi kesalahan sistem selama proses massal: ${err?.message || 'Error tidak diketahui'}`);
    } finally {
      setIsExecuting(false);
      setCurrentStudentName(null);
    }
  };

  // Action: Generate yang Belum (Hanya yang READY)
  const handleGeneratePendingOnly = () => {
    const readyItems = eligibilitySummary.items.filter(item => item.status === 'READY');
    executeBulkGeneration(readyItems);
  };

  // Action: Generate Semua Soal yang Memenuhi Syarat
  const handleGenerateAllEligible = () => {
    // Generate Semua memproses yang READY dan secara aman melewati ALREADY_GENERATED
    const eligibleItems = eligibilitySummary.items.filter(
      item => item.status === 'READY' || item.status === 'ALREADY_GENERATED'
    );
    executeBulkGeneration(eligibleItems);
  };

  // Action: Ulangi yang Gagal
  const handleRetryFailed = () => {
    if (!executionResults) return;
    const failedIds = new Set(
      executionResults.filter(r => r.status === 'FAILED').map(r => r.studentId)
    );
    const retryItems = eligibilitySummary.items.filter(item => failedIds.has(item.studentId));
    executeBulkGeneration(retryItems);
  };

  const successCount = executionResults?.filter(r => r.status === 'SUCCESS').length || 0;
  const skippedCount = executionResults?.filter(r => r.status === 'SKIPPED').length || 0;
  const failedCount = executionResults?.filter(r => r.status === 'FAILED').length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-100 overflow-hidden my-auto flex flex-col max-h-[92vh]">
        
        {/* 1. Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="text-amber-300" size={18} />
              <h2 className="font-bold text-base sm:text-lg tracking-tight">
                Pembuatan Soal UTS Massal
              </h2>
            </div>
            <p className="text-xs text-indigo-200 mt-0.5">
              {period.name} — Konfigurasi: <strong className="text-white underline">{targetQCount} Butir Soal</strong> per santri
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isExecuting}
            className="p-1.5 rounded-lg text-indigo-200 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* 2. Body Container */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
          
          {/* A. RUNNING STATE: Progress Bar */}
          {isExecuting && (
            <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 space-y-3 animate-pulse">
              <div className="flex items-center justify-between text-xs font-bold text-indigo-900">
                <div className="flex items-center gap-2">
                  <RefreshCw size={15} className="animate-spin text-indigo-600" />
                  <span>Membuat paket soal santri...</span>
                </div>
                <span>{processedCount} / {totalToProcess} Peserta</span>
              </div>

              {/* Progress bar line */}
              <div className="w-full bg-indigo-200/80 rounded-full h-2.5 overflow-hidden">
                <div 
                  className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${totalToProcess > 0 ? (processedCount / totalToProcess) * 100 : 0}%` }}
                />
              </div>

              {currentStudentName && (
                <p className="text-[11px] text-indigo-700">
                  Sedang memproses: <strong>{currentStudentName}</strong>
                </p>
              )}
            </div>
          )}

          {/* B. COMPLETED SUMMARY STATE */}
          {executionResults && !isExecuting && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Generate Soal Selesai
                </h3>
                <span className="text-xs text-slate-500 font-medium">
                  Total: {executionResults.length} peserta
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase block">Berhasil Dibuat</span>
                  <span className="text-xl font-black text-emerald-900">{successCount}</span>
                </div>
                <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl text-center">
                  <span className="text-[10px] font-bold text-slate-600 uppercase block">Sudah Memiliki Soal</span>
                  <span className="text-xl font-black text-slate-800">{skippedCount}</span>
                </div>
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-center">
                  <span className="text-[10px] font-bold text-rose-800 uppercase block">Gagal</span>
                  <span className="text-xl font-black text-rose-900">{failedCount}</span>
                </div>
              </div>

              {failedCount > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                  <span className="text-xs text-rose-700 font-semibold">
                    Terdapat {failedCount} santri yang belum berhasil dibuatkan soal.
                  </span>
                  <button
                    onClick={handleRetryFailed}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                  >
                    <RotateCcw size={12} />
                    <span>Coba Lagi ({failedCount})</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* C. ELIGIBILITY METRICS PREVIEW CARDS */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] text-slate-500 font-bold block uppercase">Total Peserta</span>
              <span className="text-lg font-black text-slate-900">{eligibilitySummary.total}</span>
              <span className="text-[10px] text-slate-400 block mt-0.5">dalam filter aktif</span>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <span className="text-[10px] text-emerald-800 font-bold block uppercase">Siap Dibuat</span>
              <span className="text-lg font-black text-emerald-900">{eligibilitySummary.ready}</span>
              <span className="text-[10px] text-emerald-700 block mt-0.5">target utama</span>
            </div>

            <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200">
              <span className="text-[10px] text-indigo-800 font-bold block uppercase">Sudah Memiliki Soal</span>
              <span className="text-lg font-black text-indigo-900">{eligibilitySummary.alreadyGenerated}</span>
              <span className="text-[10px] text-indigo-700 block mt-0.5">akan dilewati</span>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <span className="text-[10px] text-amber-800 font-bold block uppercase">Belum Siap</span>
              <span className="text-lg font-black text-amber-900">
                {eligibilitySummary.materialNotFinal + eligibilitySummary.insufficientMaterial + eligibilitySummary.stale + eligibilitySummary.invalidMaterial}
              </span>
              <span className="text-[10px] text-amber-700 block mt-0.5">belum final / span</span>
            </div>
          </div>

          {/* D. SCOPE FILTERS & SEARCH */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
            <div className="flex items-center gap-2 flex-wrap flex-1">
              {/* Kelas Filter */}
              <select
                value={selectedClass}
                onChange={e => setSelectedClass(e.target.value)}
                disabled={isExecuting}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 outline-none"
              >
                <option value="all">Semua Kelas</option>
                {distinctClasses.map(c => (
                  <option key={c} value={c}>Kelas {c}</option>
                ))}
              </select>

              {/* Halaqah Filter */}
              <select
                value={selectedHalaqah}
                onChange={e => setSelectedHalaqah(e.target.value)}
                disabled={isExecuting}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 outline-none"
              >
                <option value="all">Semua Halaqah</option>
                {distinctHalaqahs.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>

              {/* Status Kelayakan Filter */}
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                disabled={isExecuting}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 outline-none"
              >
                <option value="all">Semua Status Kelayakan</option>
                <option value="READY">🟢 Siap Dibuat ({eligibilitySummary.ready})</option>
                <option value="ALREADY_GENERATED">🔵 Sudah Dibuat ({eligibilitySummary.alreadyGenerated})</option>
                <option value="MATERIAL_NOT_FINAL">🟡 Materi Belum Final ({eligibilitySummary.materialNotFinal})</option>
                <option value="INSUFFICIENT_MATERIAL">🔴 Materi Tidak Cukup ({eligibilitySummary.insufficientMaterial})</option>
                <option value="STALE">🟠 Perlu Ditinjau ({eligibilitySummary.stale})</option>
              </select>
            </div>

            {/* Search */}
            <div className="relative sm:w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
              <input
                type="text"
                placeholder="Cari santri..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                disabled={isExecuting}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none text-slate-800 placeholder-slate-400"
              />
            </div>
          </div>

          {/* E. PARTICIPANT PREVIEW TABLE */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-10 text-center">No</th>
                    <th className="py-2.5 px-3">Santri</th>
                    <th className="py-2.5 px-3">Kelas & Halaqah</th>
                    <th className="py-2.5 px-3 text-center">Status Kelayakan</th>
                    <th className="py-2.5 px-3">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {displayedItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400 italic">
                        Tidak ada santri yang sesuai dengan filter.
                      </td>
                    </tr>
                  ) : (
                    displayedItems.map((item, idx) => {
                      const execResult = executionResults?.find(r => r.studentId === item.studentId);

                      return (
                        <tr key={item.studentId} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2 px-3 text-center text-slate-400 font-medium">
                            {idx + 1}
                          </td>
                          <td className="py-2 px-3 font-bold text-slate-900">
                            {item.studentName}
                          </td>
                          <td className="py-2 px-3 text-slate-500">
                            Kelas {item.studentClass} • {item.halaqah}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {execResult ? (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                execResult.status === 'SUCCESS'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : execResult.status === 'SKIPPED'
                                  ? 'bg-slate-100 text-slate-700'
                                  : 'bg-rose-100 text-rose-800'
                              }`}>
                                {execResult.status === 'SUCCESS' ? '✓ Berhasil' : execResult.status === 'SKIPPED' ? 'Dilewati' : '✕ Gagal'}
                              </span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                item.status === 'READY'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : item.status === 'ALREADY_GENERATED'
                                  ? 'bg-indigo-100 text-indigo-800'
                                  : item.status === 'STALE'
                                  ? 'bg-rose-100 text-rose-800'
                                  : item.status === 'INSUFFICIENT_MATERIAL'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : 'bg-amber-100 text-amber-800'
                              }`}>
                                {item.statusLabel}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-[11px] text-slate-500">
                            {execResult ? execResult.message : item.reason}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 3. Footer Action Controls */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Lock size={13} className="text-slate-400 shrink-0" />
            <span>
              Target eksekusi: <strong className="text-slate-800">{eligibilitySummary.ready} santri siap</strong> ({targetQCount} butir/santri).
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              disabled={isExecuting}
              className="px-4 py-2 border border-slate-300 hover:bg-slate-100 active:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
            >
              {executionResults ? 'Tutup' : 'Batal'}
            </button>

            {/* Action 1: Generate yang Belum */}
            <button
              onClick={handleGeneratePendingOnly}
              disabled={isExecuting || eligibilitySummary.ready === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center gap-1.5 disabled:opacity-50"
              title="Buat soal hanya untuk santri yang materinya sudah final dan belum memiliki soal"
            >
              <Sparkles size={13} />
              <span>Generate yang Belum ({eligibilitySummary.ready})</span>
            </button>

            {/* Action 2: Generate Semua Soal */}
            <button
              onClick={handleGenerateAllEligible}
              disabled={isExecuting || eligibilitySummary.ready === 0}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-700/20 flex items-center gap-1.5 disabled:opacity-50"
              title="Proses seluruh peserta yang memenuhi syarat; soal yang sudah ada akan dilewati"
            >
              <Play size={13} fill="currentColor" />
              <span>Generate Semua Soal</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
