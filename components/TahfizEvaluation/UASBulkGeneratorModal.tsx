import React, { useState, useMemo, useEffect } from 'react';
import {
  ExamPeriod,
  ExamParticipant,
  ExamMaterialSnapshot,
  User,
  QuestionBankItem
} from '../../types';
import { api } from '../../api';
import { uasQuestionGenerator } from '../../services/uasQuestionGenerator';
import {
  evaluateUASMultiSessionEligibility,
  UASEligibilityItem,
  UASEligibilityStatus
} from '../../services/uasBulkEligibilityService';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  X,
  RefreshCw,
  Lock,
  Search,
  Play,
  ShieldAlert
} from 'lucide-react';

interface UASBulkGeneratorModalProps {
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

export const UASBulkGeneratorModal: React.FC<UASBulkGeneratorModalProps> = ({
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

  const [bankQuestions, setBankQuestions] = useState<QuestionBankItem[]>([]);
  const [juzParts, setJuzParts] = useState<any[]>([]);
  const [juzSessions, setJuzSessions] = useState<any[]>([]);
  const [juzSubmissions, setJuzSubmissions] = useState<any[]>([]);
  const [juzSessionsByStudent, setJuzSessionsByStudent] = useState<Map<string, any[]>>(new Map());
  const [loadingBank, setLoadingBank] = useState(false);

  const [isExecuting, setIsExecuting] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [currentStudentName, setCurrentStudentName] = useState<string | null>(null);
  const [executionResults, setExecutionResults] = useState<ExecutionResultItem[] | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setExecutionResults(null);
      setIsExecuting(false);
      setProcessedCount(0);
      setTotalToProcess(0);
      setCurrentStudentName(null);
      return;
    }

    let cancelled = false;
    setLoadingBank(true);
    Promise.all([
      api.getQuestionBankList({ status: 'active' }),
      api.getUASJuzPartsAndSessions(period.id, user)
    ])
      .then(([res, juzRes]) => {
        if (!cancelled) {
          setBankQuestions(res?.data || []);
          const mappedParts = (juzRes?.parts || []).map((pt: any) => ({
            id: pt.id,
            examPeriodId: pt.exam_period_id || pt.examPeriodId,
            studentId: pt.student_id || pt.studentId,
            juzNumber: pt.juz_number || pt.juzNumber,
            partType: pt.part_type || pt.partType,
            coveredPages: pt.covered_pages || pt.coveredPages || [],
            coveredPagesCount: pt.covered_pages_count ?? pt.coveredPagesCount ?? 0,
            coverageRatio: Number(pt.coverage_ratio ?? pt.coverageRatio ?? 0),
            hasGap: Boolean(pt.has_gap ?? pt.hasGap),
            status: pt.status,
            reviewReason: pt.review_reason || pt.reviewReason
          }));
          setJuzParts(mappedParts);
          setJuzSubmissions((juzRes?.submissions || []).map((sb: any) => ({
            studentId: sb.student_id || sb.studentId,
            status: sb.status
          })));
          const map = new Map<string, any[]>();
          const allSess: any[] = [];
          if (juzRes?.success && Array.isArray(juzRes.sessions)) {
            juzRes.sessions.forEach((s: any) => {
              const sid = s.student_id || s.studentId;
              const obj = {
                id: s.id,
                examPeriodId: s.exam_period_id || s.examPeriodId,
                studentId: sid,
                sessionNumber: s.session_number || s.sessionNumber,
                sessionType: s.session_type || s.sessionType,
                primaryPartId: s.primary_part_id || s.primaryPartId,
                juzNumber: s.juz_number || s.juzNumber,
                supplementalParts: s.supplemental_parts || s.supplementalParts || [],
                coveredPages: s.covered_pages || s.coveredPages || [],
                startSurah: s.start_surah || s.startSurah,
                startAyah: s.start_ayah || s.startAyah,
                endSurah: s.end_surah || s.endSurah,
                endAyah: s.end_ayah || s.endAyah,
                startPage: s.start_page || s.startPage,
                endPage: s.end_page || s.endPage,
                questionSetId: s.question_set_id || s.questionSetId,
                approvalStatus: s.approval_status || s.approvalStatus,
                status: s.status
              };
              allSess.push(obj);
              const arr = map.get(sid) || [];
              arr.push(obj);
              map.set(sid, arr);
            });
          }
          setJuzSessions(allSess);
          setJuzSessionsByStudent(map);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBankQuestions([]);
          setJuzSessionsByStudent(new Map());
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingBank(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

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

  const eligibilitySummary = useMemo(() => {
    return evaluateUASMultiSessionEligibility({
      participants,
      parts: juzParts,
      sessions: juzSessions,
      submissions: juzSubmissions,
      snapshots,
      bankQuestions,
      classFilter: selectedClass,
      halaqahFilter: selectedHalaqah
    });
  }, [participants, juzParts, juzSessions, juzSubmissions, snapshots, bankQuestions, selectedClass, selectedHalaqah]);

  const displayedItems = useMemo(() => {
    return eligibilitySummary.items.filter(item => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (
          !item.studentName.toLowerCase().includes(q) &&
          !item.studentClass.toLowerCase().includes(q) &&
          !item.halaqah.toLowerCase().includes(q) &&
          !item.reason.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [eligibilitySummary.items, statusFilter, searchQuery]);

  if (!isOpen) return null;

  const readyItems = eligibilitySummary.items.filter(i => i.status === 'SIAP_GENERATE');
  const failedOrReviewCount =
    eligibilitySummary.materiBelumFinal +
    eligibilitySummary.materiPerluReview +
    eligibilitySummary.materiTidakCukup +
    eligibilitySummary.bankSoalKurang +
    eligibilitySummary.stale;

  const executeBulkGeneration = async (targetItems: UASEligibilityItem[]) => {
    if (targetItems.length === 0) {
      alert('Tidak ada santri berstatus Siap Dibuat.');
      return;
    }

    const confirmMsg = `Generate paket 9 soal UAS untuk ${targetItems.length} santri yang siap?\n\nPaket yang sudah ada dan terkunci tidak akan ditimpa.`;
    if (!window.confirm(confirmMsg)) return;

    setIsExecuting(true);
    setTotalToProcess(targetItems.length);
    setProcessedCount(0);
    setExecutionResults(null);

    const results: ExecutionResultItem[] = [];
    const seenStudentIds = new Set<string>();

    try {
      for (let i = 0; i < targetItems.length; i++) {
        const item = targetItems[i];
        setCurrentStudentName(item.studentName);

        // Cegah paket ganda dalam batch
        if (seenStudentIds.has(item.studentId)) {
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: 'SKIPPED',
            message: 'Duplikasi entri santri dalam antrean dilewati.'
          });
          setProcessedCount(i + 1);
          continue;
        }
        seenStudentIds.add(item.studentId);

        // Jangan menimpa paket yang sudah ada/difinalisasi
        const existingQ = questionSetMap.get(item.studentId);
        if (existingQ && existingQ.status !== 'stale') {
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: 'SKIPPED',
            message: `Paket 9 soal v${existingQ.version} sudah ada (${existingQ.status}).`
          });
          setProcessedCount(i + 1);
          continue;
        }

        const studentSessions = juzSessionsByStudent.get(item.studentId) || [];
        if (studentSessions.length === 0) {
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: 'FAILED',
            message: 'Menunggu Persetujuan Admin / belum ada sesi UAS yang disetujui.'
          });
          setProcessedCount(i + 1);
          continue;
        }

        try {
          let genSessions = 0;
          for (const sess of studentSessions) {
            if (sess.questionSetId) continue;
            const sessRes = await uasQuestionGenerator.generateUASSessionRandomDraft({
              period,
              session: sess,
              snapshotId: item.snapshot?.id || '',
              bankQuestions,
              actorId: user.id
            });
            const saveSessRes = await api.saveUASSessionQuestionSet(
              sess.id,
              sessRes.questionSet,
              sessRes.questions,
              user
            );
            if (!saveSessRes.success) {
              throw new Error(saveSessRes.message || `Gagal menyimpan paket Sesi ${sess.sessionNumber}.`);
            }
            genSessions++;
          }
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: genSessions > 0 ? 'SUCCESS' : 'SKIPPED',
            message: genSessions > 0
              ? `${genSessions} sesi UAS berhasil di-generate (Juz Penuh: 7 acak + 2 wajib manual penguji / Parsial: 4 acak).`
              : 'Seluruh sesi UAS santri ini sudah memiliki paket soal.'
          });
        } catch (err: any) {
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: 'FAILED',
            message: err?.message || 'Gagal membuat paket 9 soal UAS.'
          });
        }

        setProcessedCount(i + 1);
        // Yield ke event loop tiap santri agar UI tetap responsif untuk 240 santri
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      setExecutionResults(results);
      await onSuccess();
    } finally {
      setIsExecuting(false);
      setCurrentStudentName(null);
    }
  };

  const statusBadge = (status: UASEligibilityStatus) => {
    switch (status) {
      case 'SIAP_GENERATE':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'SUDAH_ADA':
        return 'bg-teal-100 text-teal-800 border-teal-200';
      case 'MENUNGGU_PERSETUJUAN_ADMIN':
      case 'MATERI_BELUM_FINAL':
        return 'bg-sky-100 text-sky-800 border-sky-200';
      case 'MATERI_PERLU_REVIEW':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'STALE':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'BANK_SOAL_KURANG':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-rose-100 text-rose-800 border-rose-200';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-teal-900 to-emerald-900 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <Sparkles size={20} className="text-amber-300" />
            </div>
            <div>
              <h3 className="font-bold text-base">Generate Soal Massal UAS (Per-Sesi Bank Soal)</h3>
              <p className="text-xs text-emerald-100">
                {period.name} — Juz Penuh: 7 soal acak Bank Soal (+ 2 wajib manual saat ujian). Parsial: 4 soal acak Bank Soal.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isExecuting}
            className="p-1.5 rounded-xl hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        {/* Summary Cards */}
        <div className="p-5 border-b border-slate-100 bg-slate-50/70 space-y-4">
          {loadingBank ? (
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <RefreshCw size={14} className="animate-spin text-teal-600" />
              <span>Memeriksa kelayakan sesi disetujui Admin & zona acak Bank Soal...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-white p-3 rounded-2xl border border-emerald-200 shadow-sm">
                <p className="text-[11px] font-semibold text-emerald-700">SIAP_GENERATE (7 / 4 Acak)</p>
                <p className="text-2xl font-black text-emerald-800">{eligibilitySummary.siapGenerate}</p>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-sky-200 shadow-sm">
                <p className="text-[11px] font-semibold text-sky-700">MENUNGGU PERSETUJUAN ADMIN</p>
                <p className="text-2xl font-black text-sky-800">{eligibilitySummary.materiBelumFinal}</p>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-amber-200 shadow-sm">
                <p className="text-[11px] font-semibold text-amber-700">MATERI_PERLU_REVIEW</p>
                <p className="text-2xl font-black text-amber-800">{eligibilitySummary.materiPerluReview + eligibilitySummary.stale}</p>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-rose-200 shadow-sm">
                <p className="text-[11px] font-semibold text-rose-700">MATERI_TIDAK_CUKUP</p>
                <p className="text-2xl font-black text-rose-800">{eligibilitySummary.materiTidakCukup}</p>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-purple-200 shadow-sm">
                <p className="text-[11px] font-semibold text-purple-700">BANK_SOAL_KURANG</p>
                <p className="text-2xl font-black text-purple-800">{eligibilitySummary.bankSoalKurang}</p>
                {eligibilitySummary.sudahAda > 0 && (
                  <p className="text-[10px] font-semibold text-teal-700 mt-0.5">+ {eligibilitySummary.sudahAda} SUDAH_ADA</p>
                )}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari santri, kelas, halaqah, alasan..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white"
              />
            </div>
            <select
              value={selectedClass}
              onChange={e => setSelectedClass(e.target.value)}
              className="text-xs border border-slate-200 rounded-xl px-2.5 py-1.5 bg-white"
            >
              <option value="all">Semua Kelas</option>
              {distinctClasses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={selectedHalaqah}
              onChange={e => setSelectedHalaqah(e.target.value)}
              className="text-xs border border-slate-200 rounded-xl px-2.5 py-1.5 bg-white"
            >
              <option value="all">Semua Halaqah</option>
              {distinctHalaqahs.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-xs border border-slate-200 rounded-xl px-2.5 py-1.5 bg-white"
            >
              <option value="all">Semua Status ({eligibilitySummary.total})</option>
              <option value="SIAP_GENERATE">SIAP_GENERATE ({eligibilitySummary.siapGenerate})</option>
              <option value="SUDAH_ADA">SUDAH_ADA ({eligibilitySummary.sudahAda})</option>
              <option value="MENUNGGU_PERSETUJUAN_ADMIN">Menunggu Persetujuan Admin ({eligibilitySummary.materiBelumFinal})</option>
              <option value="MATERI_PERLU_REVIEW">MATERI_PERLU_REVIEW ({eligibilitySummary.materiPerluReview})</option>
              <option value="MATERI_TIDAK_CUKUP">MATERI_TIDAK_CUKUP ({eligibilitySummary.materiTidakCukup})</option>
              <option value="BANK_SOAL_KURANG">BANK_SOAL_KURANG ({eligibilitySummary.bankSoalKurang})</option>
              <option value="STALE">STALE ({eligibilitySummary.stale})</option>
            </select>
          </div>
        </div>

        {/* Progress Bar */}
        {isExecuting && (
          <div className="px-6 py-3 bg-teal-50 border-b border-teal-200">
            <div className="flex items-center justify-between text-xs font-semibold text-teal-800 mb-1.5">
              <span>Memproses: {currentStudentName || '...'}</span>
              <span>{processedCount} / {totalToProcess}</span>
            </div>
            <div className="w-full bg-teal-200/70 rounded-full h-2 overflow-hidden">
              <div
                className="bg-teal-600 h-2 transition-all duration-200"
                style={{ width: `${totalToProcess > 0 ? Math.round((processedCount / totalToProcess) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Results or Preview Table */}
        <div className="flex-1 overflow-y-auto p-5">
          {executionResults ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-slate-800">Hasil Eksekusi Generator Massal UAS</h4>
                <button
                  onClick={() => setExecutionResults(null)}
                  className="text-xs font-semibold text-teal-700 hover:underline"
                >
                  Kembali ke Pratinjau
                </button>
              </div>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                {executionResults.map(res => (
                  <div key={res.studentId} className="px-4 py-2.5 flex items-center justify-between text-xs bg-white">
                    <div>
                      <span className="font-bold text-slate-800">{res.studentName}</span>
                      <p className="text-slate-500">{res.message}</p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                        res.status === 'SUCCESS'
                          ? 'bg-emerald-100 text-emerald-800'
                          : res.status === 'SKIPPED'
                          ? 'bg-slate-100 text-slate-700'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {res.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2.5 font-bold">Santri</th>
                    <th className="px-3 py-2.5 font-bold">Kelas / Halaqah</th>
                    <th className="px-3 py-2.5 font-bold">Materi</th>
                    <th className="px-3 py-2.5 font-bold">Status</th>
                    <th className="px-3 py-2.5 font-bold">Keterangan / Alasan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayedItems.map(item => (
                    <tr key={item.studentId} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2 font-semibold text-slate-800">{item.studentName}</td>
                      <td className="px-3 py-2 text-slate-600">{item.studentClass} · {item.halaqah}</td>
                      <td className="px-3 py-2 text-slate-600">{item.estimatedPages} hal</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusBadge(item.status)}`}>
                          {item.statusLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{item.reason}</td>
                    </tr>
                  ))}
                  {displayedItems.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                        Tidak ada santri yang sesuai dengan filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <ShieldAlert size={15} className="text-amber-600 shrink-0" />
            <span>
              {failedOrReviewCount > 0
                ? `${failedOrReviewCount} santri tidak akan diproses sebelum materi difinalisasi / syarat terpenuhi.`
                : 'Semua santri pada filter siap diproses.'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isExecuting}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/70 rounded-xl transition-colors"
            >
              Tutup
            </button>
            <button
              onClick={() => executeBulkGeneration(readyItems)}
              disabled={isExecuting || loadingBank || readyItems.length === 0}
              className="px-4 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              <Play size={14} />
              <span>Generate Soal UAS ({readyItems.length} Santri Siap)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
