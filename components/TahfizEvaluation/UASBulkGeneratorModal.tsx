import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ExamPeriod,
  ExamParticipant,
  ExamMaterialSnapshot,
  User,
  QuestionBankItem,
  QuestionBankFilter
} from '../../types';
import { api } from '../../api';
import { uasQuestionGenerator } from '../../services/uasQuestionGenerator';
import {
  evaluateUASMultiSessionEligibility,
  UASEligibilityItem,
  UASEligibilityStatus,
  UASSessionEligibilityResult
} from '../../services/uasBulkEligibilityService';
import { UASBankAutoFillModal } from './UASBankAutoFillModal';
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
  ShieldAlert,
  Info,
  ExternalLink
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
  onNavigateToQuestionBank?: (filter?: Partial<QuestionBankFilter>) => void;
  initialClassFilter?: string;
  initialHalaqahFilter?: string;
  targetStudentId?: string | null;
}

interface SessionOutcomeItem {
  sessionId: string;
  sessionNumber: number;
  juzNumber: number;
  status: 'READY' | 'FAILED' | 'SKIPPED';
  message: string;
}

interface ExecutionResultItem {
  studentId: string;
  studentName: string;
  status: 'SUCCESS' | 'PARTIAL' | 'SKIPPED' | 'FAILED';
  message: string;
  sessionOutcomes?: SessionOutcomeItem[];
}

function formatFriendlyGenError(raw?: string): string {
  const txt = (raw || '').trim();
  if (!txt) return 'Gagal menyiapkan paket soal sesi. Silakan coba ulang.';
  if (/duplicate key|unique constraint|uq_exam_question_set/i.test(txt)) {
    return 'Ditemukan bentrok versi paket soal lama pada sesi ini. Silakan tekan Coba Ulang untuk memulihkan versi paket yang aman.';
  }
  if (/network|fetch|timeout|failed to fetch/i.test(txt)) {
    return 'Koneksi ke server terputus saat menyimpan paket. Silakan tekan Coba Ulang untuk memeriksa dan melengkapi sesi yang belum tersimpan.';
  }
  return txt;
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
  onNavigateToQuestionBank,
  initialClassFilter = 'all',
  initialHalaqahFilter = 'all',
  targetStudentId = null
}) => {
  const [selectedClass, setSelectedClass] = useState<string>(initialClassFilter);
  const [selectedHalaqah, setSelectedHalaqah] = useState<string>(initialHalaqahFilter);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [bankQuestions, setBankQuestions] = useState<QuestionBankItem[]>([]);
  const [isBankOfflineCache, setIsBankOfflineCache] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [juzParts, setJuzParts] = useState<any[]>([]);
  const [juzSessions, setJuzSessions] = useState<any[]>([]);
  const [juzSubmissions, setJuzSubmissions] = useState<any[]>([]);
  const [juzSessionsByStudent, setJuzSessionsByStudent] = useState<Map<string, any[]>>(new Map());
  const [loadingBank, setLoadingBank] = useState(false);

  const [detailShortageItem, setDetailShortageItem] = useState<UASEligibilityItem | null>(null);
  const [showGroupedShortage, setShowGroupedShortage] = useState(false);
  const [showAutoFillModal, setShowAutoFillModal] = useState(false);

  const [isExecuting, setIsExecuting] = useState(false);
  const inFlightRef = useRef(false);
  const [reloadTick, setReloadTick] = useState(0);
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
      setDetailShortageItem(null);
      return;
    }

    let cancelled = false;
    setLoadingBank(true);
    Promise.all([
      api.getQuestionBankList({ status: 'all' }, user),
      api.getUASJuzPartsAndSessions(period.id, user)
    ])
      .then(([res, juzRes]) => {
        if (!cancelled) {
          setBankQuestions(res?.data || []);
          setIsBankOfflineCache(Boolean(res?.isOfflineCache));
          setLastCheckedAt(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
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
            juzRes.sessions
              .filter((s: any) => s.status !== 'void' && (!s.exam_period_id || s.exam_period_id === period.id))
              .forEach((s: any) => {
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
                attemptId: s.attempt_id || s.attemptId,
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
  }, [isOpen, reloadTick, period.id]);

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

  const scopedParticipants = useMemo(() => {
    if (!targetStudentId) return participants;
    return participants.filter(p => p.studentId === targetStudentId);
  }, [participants, targetStudentId]);

  const eligibilitySummary = useMemo(() => {
    return evaluateUASMultiSessionEligibility({
      participants: scopedParticipants,
      parts: juzParts,
      sessions: juzSessions,
      submissions: juzSubmissions,
      snapshots,
      bankQuestions,
      classFilter: targetStudentId ? 'all' : selectedClass,
      halaqahFilter: targetStudentId ? 'all' : selectedHalaqah
    });
  }, [scopedParticipants, juzParts, juzSessions, juzSubmissions, snapshots, bankQuestions, selectedClass, selectedHalaqah, targetStudentId]);

  // Session-level preview breakdown — STRICTLY from filtered eligibilitySummary.sessionStats
  const sessionPreview = useMemo(() => {
    const st = eligibilitySummary.sessionStats;
    return {
      fullCount: st?.readyFullSessions ?? 0,
      partialCount: st?.readyPartialSessions ?? 0,
      toCreate: st?.readySessions ?? 0,
      alreadyHave: st?.alreadyHaveSessions ?? 0,
      unapproved: st?.waitingAdminSessions ?? 0,
      bankShort: st?.bankShortSessions ?? 0,
      totalActive: st?.totalActiveSessions ?? 0
    };
  }, [eligibilitySummary.sessionStats]);

  // Ringkasan gabungan kekurangan soal per (Juz, Zona, Rentang Halaman) agar Admin tidak menghitung ganda antar-santri
  const groupedBankShortages = useMemo(() => {
    const map = new Map<string, {
      juzNumber: number;
      zoneNumber: number;
      startPage: number;
      endPage: number;
      startRef: string;
      endRef: string;
      affectedSessions: number;
      affectedStudentIds: Set<string>;
      draftCount: number;
    }>();

    for (const item of eligibilitySummary.items) {
      if (item.status !== 'BANK_SOAL_KURANG') continue;
      for (const se of (item.sessionEligibilities || [])) {
        if (se.status !== 'BANK_SOAL_KURANG' || !se.diagnostic) continue;
        for (const mz of se.missingZones) {
          const zd = se.diagnostic.zonesDetail.find(z => z.zoneNumber === mz);
          if (!zd) continue;
          const key = `J${se.juzNumber}|Z${mz}|P${zd.startPage}-${zd.endPage}`;
          if (!map.has(key)) {
            map.set(key, {
              juzNumber: se.juzNumber,
              zoneNumber: mz,
              startPage: zd.startPage,
              endPage: zd.endPage,
              startRef: zd.startRef,
              endRef: zd.endRef,
              affectedSessions: 0,
              affectedStudentIds: new Set(),
              draftCount: zd.inactiveCount
            });
          }
          const g = map.get(key)!;
          g.affectedSessions++;
          g.affectedStudentIds.add(item.studentId);
          g.draftCount = Math.max(g.draftCount, zd.inactiveCount);
        }
      }
    }

    return Array.from(map.values())
      .map(g => ({ ...g, affectedStudents: g.affectedStudentIds.size }))
      .sort((a, b) => a.juzNumber - b.juzNumber || a.startPage - b.startPage || a.zoneNumber - b.zoneNumber);
  }, [eligibilitySummary.items]);

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

  const executeBulkGeneration = async (targetItems: UASEligibilityItem[], skipConfirm = false) => {
    if (inFlightRef.current) return;
    if (targetItems.length === 0) {
      alert('Tidak ada santri berstatus Siap Dibuat.');
      return;
    }

    if (!skipConfirm) {
      const confirmMsg = `Siapkan paket soal UAS untuk ${targetItems.length} santri yang siap?\n\nPaket sesi yang sudah valid tidak akan dibuat ulang atau ditimpa.`;
      if (!window.confirm(confirmMsg)) return;
    }

    inFlightRef.current = true;
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

        const studentSessions = (juzSessionsByStudent.get(item.studentId) || []).filter(
          s => s.status !== 'void' && s.approvalStatus === 'admin_approved'
        );
        if (studentSessions.length === 0) {
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: 'SKIPPED',
            message: 'Belum ada sesi UAS yang disetujui Admin.'
          });
          setProcessedCount(i + 1);
          continue;
        }

        // Per-session isolated generation: if 1 session fails, other sessions stay safely saved!
        let genSessions = 0;
        let skippedSessions = 0;
        const sessionOutcomes: SessionOutcomeItem[] = [];
        const failedMsgs: string[] = [];

        for (const sess of studentSessions) {
          if (sess.questionSetId || sess.attemptId) {
            skippedSessions++;
            sessionOutcomes.push({
              sessionId: sess.id,
              sessionNumber: sess.sessionNumber,
              juzNumber: sess.juzNumber,
              status: 'SKIPPED',
              message: 'Paket Soal Siap'
            });
            continue;
          }
          try {
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
              throw new Error(formatFriendlyGenError(saveSessRes.message));
            }
            genSessions++;
            sessionOutcomes.push({
              sessionId: sess.id,
              sessionNumber: sess.sessionNumber,
              juzNumber: sess.juzNumber,
              status: 'READY',
              message: 'Paket Soal Siap'
            });
          } catch (sessErr: any) {
            const friendly = formatFriendlyGenError(sessErr?.message);
            failedMsgs.push(`Sesi ${sess.sessionNumber} (Juz ${sess.juzNumber}): ${friendly}`);
            sessionOutcomes.push({
              sessionId: sess.id,
              sessionNumber: sess.sessionNumber,
              juzNumber: sess.juzNumber,
              status: 'FAILED',
              message: `Perlu Perbaikan Paket Soal — ${friendly}`
            });
          }
        }

        if (failedMsgs.length > 0 && genSessions === 0 && skippedSessions === 0) {
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: 'FAILED',
            message: failedMsgs.join(' • '),
            sessionOutcomes
          });
        } else if (failedMsgs.length > 0) {
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: 'PARTIAL',
            message: `${genSessions + skippedSessions} sesi siap, ${failedMsgs.length} sesi perlu perbaikan.`,
            sessionOutcomes
          });
        } else {
          results.push({
            studentId: item.studentId,
            studentName: item.studentName,
            status: genSessions > 0 ? 'SUCCESS' : 'SKIPPED',
            message: genSessions > 0
              ? `${genSessions} paket sesi UAS berhasil disiapkan${skippedSessions > 0 ? ` (${skippedSessions} sudah ada)` : ''}.`
              : 'Seluruh sesi UAS santri ini sudah memiliki paket soal.',
            sessionOutcomes
          });
        }

        setProcessedCount(i + 1);
        // Yield ke event loop tiap santri agar UI tetap responsif untuk 240 santri
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      setExecutionResults(results);
      setReloadTick(t => t + 1);
      await onSuccess();
    } finally {
      inFlightRef.current = false;
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
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Light Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-teal-50 border border-teal-200 rounded-xl shrink-0">
              <Sparkles size={18} className="text-teal-700" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm sm:text-base text-slate-900 truncate">Siapkan Soal UAS</h3>
              <p className="text-xs text-slate-500 truncate">
                {period.name} • Juz Penuh: 7 acak + 2 wajib • Parsial: 4 acak • Soal Bank Soal dapat digunakan ulang antar-santri
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setReloadTick(t => t + 1)}
              disabled={isExecuting || loadingBank}
              className="px-3 py-1.5 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
              title="Hitung ulang kesiapan dari data terbaru server tanpa mengubah paket atau nilai"
            >
              <RefreshCw size={13} className={loadingBank ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Periksa Ulang Kesiapan</span>
            </button>
            <button
              onClick={onClose}
              disabled={isExecuting}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 shrink-0"
              aria-label="Tutup"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="p-5 border-b border-slate-100 bg-slate-50/70 space-y-4">
          {isBankOfflineCache && !loadingBank && (
            <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" />
              <span>Menampilkan data cache Bank Soal karena koneksi server sempat terganggu. Klik <strong>Periksa Ulang Kesiapan</strong> untuk menyegarkan dari server.</span>
            </div>
          )}
          {loadingBank ? (
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <RefreshCw size={14} className="animate-spin text-teal-600" />
              <span>Memeriksa kelayakan sesi disetujui Admin &amp; zona acak Bank Soal dari server...</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  Menampilkan <strong>{eligibilitySummary.total} santri</strong> ({sessionPreview.totalActive} sesi aktif) sesuai filter.
                </span>
                {lastCheckedAt && (
                  <span>Diperiksa dari server pukul {lastCheckedAt}</span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-white p-3 rounded-2xl border border-emerald-200 shadow-sm">
                  <p className="text-[11px] font-semibold text-emerald-700">Siap Disiapkan</p>
                  <p className="text-2xl font-black text-emerald-800">
                    {eligibilitySummary.siapGenerate} <span className="text-xs font-semibold text-emerald-600">santri</span>
                  </p>
                  <p className="text-[10px] text-emerald-700 font-semibold">{sessionPreview.toCreate} sesi siap generate</p>
                </div>
                <div className="bg-white p-3 rounded-2xl border border-teal-200 shadow-sm">
                  <p className="text-[11px] font-semibold text-teal-700">Rincian Sesi Siap</p>
                  <p className="text-sm font-black text-teal-900 mt-1">{sessionPreview.fullCount} Penuh • {sessionPreview.partialCount} Parsial</p>
                  <p className="text-[10px] text-slate-500">Jumlah sesi siap (7+2 / 4 acak)</p>
                </div>
                <div className="bg-white p-3 rounded-2xl border border-sky-200 shadow-sm">
                  <p className="text-[11px] font-semibold text-sky-700">Menunggu Admin</p>
                  <p className="text-2xl font-black text-sky-800">
                    {eligibilitySummary.materiBelumFinal} <span className="text-xs font-semibold text-sky-600">santri</span>
                  </p>
                  <p className="text-[10px] text-slate-500">{sessionPreview.unapproved} sesi belum disetujui</p>
                </div>
                <div className="bg-white p-3 rounded-2xl border border-purple-200 shadow-sm">
                  <p className="text-[11px] font-semibold text-purple-700">Bank Soal Belum Cukup</p>
                  <p className="text-2xl font-black text-purple-800">
                    {eligibilitySummary.bankSoalKurang} <span className="text-xs font-semibold text-purple-600">santri</span>
                  </p>
                  <p className="text-[10px] text-purple-700 font-semibold">{sessionPreview.bankShort} sesi kurang zona soal</p>
                  {groupedBankShortages.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowGroupedShortage(v => !v)}
                        className="text-[10px] font-bold text-purple-800 underline hover:text-purple-950"
                      >
                        {showGroupedShortage ? 'Sembunyikan' : `Lihat ${groupedBankShortages.length} kebutuhan Juz/Zona`}
                      </button>
                      {user.role === 'admin' && (
                        <button
                          type="button"
                          onClick={() => setShowAutoFillModal(true)}
                          className="px-2 py-0.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-bold text-[10px] inline-flex items-center gap-1"
                        >
                          <Sparkles size={10} />
                          <span>Siapkan Kandidat Soal Otomatis</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-[11px] font-semibold text-slate-600">Sudah Ada Paket</p>
                  <p className="text-2xl font-black text-slate-800">
                    {eligibilitySummary.sudahAda} <span className="text-xs font-semibold text-slate-500">santri</span>
                  </p>
                  <p className="text-[10px] text-slate-500">{sessionPreview.alreadyHave} paket sesi (dilewati)</p>
                </div>
              </div>
              {showGroupedShortage && groupedBankShortages.length > 0 && (
                <div className="bg-white rounded-2xl border border-purple-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-2.5 bg-purple-50 border-b border-purple-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-purple-950">
                      Ringkasan Gabungan Kebutuhan Soal per Juz &amp; Zona ({groupedBankShortages.length} titik zona — 1 soal valid dapat dipakai banyak santri)
                    </span>
                    <div className="flex items-center gap-2">
                      {user.role === 'admin' && (
                        <button
                          type="button"
                          onClick={() => setShowAutoFillModal(true)}
                          className="px-2.5 py-1 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-bold text-[11px] inline-flex items-center gap-1"
                        >
                          <Sparkles size={12} />
                          <span>Siapkan Kandidat Soal Otomatis</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowGroupedShortage(false)}
                        className="text-purple-700 hover:text-purple-950 font-bold text-[11px]"
                      >
                        Tutup
                      </button>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="px-3 py-1.5 font-bold">Juz &amp; Zona</th>
                          <th className="px-3 py-1.5 font-bold">Rentang Ayat &amp; Halaman</th>
                          <th className="px-3 py-1.5 font-bold">Terdampak</th>
                          <th className="px-3 py-1.5 font-bold">Tindakan Admin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {groupedBankShortages.map(g => (
                          <tr key={`J${g.juzNumber}_Z${g.zoneNumber}_P${g.startPage}_${g.endPage}`} className="hover:bg-purple-50/40">
                            <td className="px-3 py-1.5 font-bold text-slate-900">Juz {g.juzNumber} · Zona {g.zoneNumber}</td>
                            <td className="px-3 py-1.5 text-slate-600">{g.startRef} s.d. {g.endRef} (Hal. {g.startPage}–{g.endPage})</td>
                            <td className="px-3 py-1.5 text-slate-700">
                              <strong>{g.affectedSessions} sesi</strong> ({g.affectedStudents} santri)
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {g.draftCount > 0 ? (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-[10px]">
                                    Tersedia {g.draftCount} draft (verifikasi &amp; aktifkan)
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold text-[10px]">
                                    Tambah min. +1 soal aktif
                                  </span>
                                )}
                                {onNavigateToQuestionBank && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onNavigateToQuestionBank({
                                        juz: g.juzNumber,
                                        examType: 'uas',
                                        questionType: 'random',
                                        status: g.draftCount > 0 ? 'draft' : 'active'
                                      });
                                      onClose();
                                    }}
                                    className="px-2 py-0.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold text-[10px] inline-flex items-center gap-1"
                                  >
                                    <ExternalLink size={10} />
                                    <span>Lihat Bank Soal</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
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
              <option value="SIAP_GENERATE">Siap Disiapkan ({eligibilitySummary.siapGenerate})</option>
              <option value="SUDAH_ADA">Sudah Ada Paket ({eligibilitySummary.sudahAda})</option>
              <option value="MENUNGGU_PERSETUJUAN_ADMIN">Menunggu Admin ({eligibilitySummary.materiBelumFinal})</option>
              <option value="MATERI_PERLU_REVIEW">Perlu Review ({eligibilitySummary.materiPerluReview})</option>
              <option value="MATERI_TIDAK_CUKUP">Materi Tidak Cukup ({eligibilitySummary.materiTidakCukup})</option>
              <option value="BANK_SOAL_KURANG">Bank Soal Belum Cukup ({eligibilitySummary.bankSoalKurang})</option>
              <option value="STALE">Paket Usang / Stale ({eligibilitySummary.stale})</option>
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
                  <div key={res.studentId} className="px-4 py-3 space-y-2 text-xs bg-white">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-bold text-slate-900">{res.studentName}</span>
                        <p className="text-slate-500">{res.message}</p>
                      </div>
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] shrink-0 ${
                          res.status === 'SUCCESS'
                            ? 'bg-emerald-100 text-emerald-800'
                            : res.status === 'PARTIAL'
                            ? 'bg-amber-100 text-amber-900'
                            : res.status === 'SKIPPED'
                            ? 'bg-slate-100 text-slate-700'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {res.status === 'SUCCESS'
                          ? 'Berhasil'
                          : res.status === 'PARTIAL'
                          ? 'Sebagian Berhasil'
                          : res.status === 'SKIPPED'
                          ? 'Sudah Siap'
                          : 'Perlu Perbaikan'}
                      </span>
                    </div>
                    {res.sessionOutcomes && res.sessionOutcomes.length > 0 && (
                      <div className="space-y-1 pl-2 border-l-2 border-slate-200">
                        {res.sessionOutcomes.map(so => (
                          <div key={so.sessionId} className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                            <span className="font-bold text-slate-800">Sesi {so.sessionNumber} — Juz {so.juzNumber}</span>
                            <span className={so.status === 'FAILED' ? 'text-rose-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                              {so.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {executionResults.some(r => r.status === 'FAILED' || r.status === 'PARTIAL') && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={isExecuting || loadingBank}
                    onClick={() => {
                      const failedIds = new Set(
                        executionResults.filter(r => r.status === 'FAILED' || r.status === 'PARTIAL').map(r => r.studentId)
                      );
                      const retryTargets = eligibilitySummary.items.filter(i => failedIds.has(i.studentId));
                      executeBulkGeneration(retryTargets, true);
                    }}
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold disabled:opacity-50"
                  >
                    Coba Ulang Sesi Gagal
                  </button>
                </div>
              )}
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
                      <td className="px-3 py-2 text-slate-600">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>{item.reason}</span>
                          {item.status === 'BANK_SOAL_KURANG' && (
                            <button
                              type="button"
                              onClick={() => setDetailShortageItem(item)}
                              className="px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                            >
                              <Info size={12} />
                              <span>Detail Kekurangan</span>
                            </button>
                          )}
                        </div>
                      </td>
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
              <span>Generate Soal UAS ({readyItems.length} Santri • {sessionPreview.toCreate} Sesi)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal Detail Kekurangan Bank Soal */}
      {detailShortageItem && (
        <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-purple-50/70">
              <div>
                <h4 className="font-bold text-sm text-purple-950">Detail Kekurangan Bank Soal</h4>
                <p className="text-xs text-purple-800">
                  {detailShortageItem.studentName} • Kelas {detailShortageItem.studentClass} • Halaqah {detailShortageItem.halaqah}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailShortageItem(null)}
                className="p-1.5 rounded-lg text-purple-700 hover:bg-purple-100"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-900">
                <strong>Kebijakan Resmi Bank Soal:</strong> Soal Bank Soal <strong>boleh digunakan ulang antar-santri yang berbeda</strong> (tidak habis saat dipakai santri lain). Namun dalam satu paket santri, setiap zona harus memiliki minimal 1 soal acak unik yang aktif.
              </div>

              {(detailShortageItem.sessionEligibilities || [])
                .filter((se: UASSessionEligibilityResult) => se.status === 'BANK_SOAL_KURANG')
                .map((se: UASSessionEligibilityResult) => {
                  const diag = se.diagnostic;
                  const disq = diag?.disqualifiedSummary;
                  const disqReasons: string[] = [];
                  if (disq?.inactiveCount) disqReasons.push(`${disq.inactiveCount} soal berstatus nonaktif/draft/arsip`);
                  if (disq?.outOfPageCoverageCount) disqReasons.push(`${disq.outOfPageCoverageCount} soal melintasi batas halaman sesi`);
                  if (disq?.wrongTypeCount) disqReasons.push(`${disq.wrongTypeCount} soal bertipe wajib (bukan soal acak)`);
                  if (disq?.wrongExamTypeCount) disqReasons.push(`${disq.wrongExamTypeCount} soal khusus UTS (bukan UAS/Umum)`);
                  if (disq?.invalidCoordsCount) disqReasons.push(`${disq.invalidCoordsCount} soal memiliki koordinat ayat tidak valid`);

                  return (
                    <div key={se.sessionId} className="border border-slate-200 rounded-2xl overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-900">
                            Sesi {se.sessionNumber} — Juz {se.juzNumber} ({se.sessionType === 'partial_half' ? 'Parsial · 4 Soal Acak' : 'Juz Penuh · 7 Soal Acak + 2 Wajib'})
                          </div>
                          <div className="text-[11px] text-slate-600 mt-0.5">
                            Kebutuhan: <strong>{se.requiredZones} soal acak</strong> • Tersedia: <strong>{se.coveredZones} zona valid</strong> ({diag?.totalValidUniqueInSession ?? se.coveredZones} soal unik aktif) • Kekurangan: <strong className="text-purple-800">{se.missingZones.length} zona (minimal +{se.missingZones.length} soal valid)</strong>
                          </div>
                          <div className="text-[11px] text-purple-800 font-semibold mt-0.5">
                            Zona yang kurang: Zona {se.missingZones.join(', Zona ')}
                          </div>
                        </div>
                        {onNavigateToQuestionBank && (
                          <button
                            type="button"
                            onClick={() => {
                              const preferAllStatus = Boolean(disq?.inactiveCount && disq.inactiveCount > 0);
                              onNavigateToQuestionBank({
                                juz: se.juzNumber,
                                examType: 'uas',
                                questionType: 'random',
                                status: preferAllStatus ? 'all' : 'active'
                              });
                              setDetailShortageItem(null);
                              onClose();
                            }}
                            className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-bold inline-flex items-center gap-1.5"
                          >
                            <ExternalLink size={12} />
                            <span>Lihat Bank Soal (Juz {se.juzNumber})</span>
                          </button>
                        )}
                      </div>

                      {disqReasons.length > 0 && (
                        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-900 text-[11px]">
                          <strong>Alasan soal yang ada di Juz {se.juzNumber} tidak memenuhi syarat:</strong> {disqReasons.join('; ')}.
                        </div>
                      )}

                      {diag && diag.zonesDetail.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[11px]">
                            <thead className="bg-white text-slate-500 border-b border-slate-100">
                              <tr>
                                <th className="px-3 py-2 font-bold">Zona</th>
                                <th className="px-3 py-2 font-bold">Rentang Ayat &amp; Halaman</th>
                                <th className="px-3 py-2 font-bold">Soal Unik Aktif</th>
                                <th className="px-3 py-2 font-bold">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {diag.zonesDetail.map(z => {
                                const isMissing = z.validUniqueCount === 0;
                                const zNotes: string[] = [];
                                if (z.inactiveCount > 0) zNotes.push(`${z.inactiveCount} nonaktif`);
                                if (z.outOfPageCoverageCount > 0) zNotes.push(`${z.outOfPageCoverageCount} lintas halaman`);
                                if (z.wrongTypeCount > 0) zNotes.push(`${z.wrongTypeCount} tipe wajib`);
                                if (z.wrongExamTypeCount > 0) zNotes.push(`${z.wrongExamTypeCount} khusus UTS`);
                                if (z.invalidCoordsCount > 0) zNotes.push(`${z.invalidCoordsCount} koordinat invalid`);
                                return (
                                  <tr key={z.zoneNumber} className={isMissing ? 'bg-purple-50/50' : ''}>
                                    <td className="px-3 py-1.5 font-bold text-slate-800">Zona {z.zoneNumber}</td>
                                    <td className="px-3 py-1.5 text-slate-600">
                                      {z.startRef} s.d. {z.endRef} (Hal. {z.startPage}–{z.endPage})
                                    </td>
                                    <td className="px-3 py-1.5 font-bold text-slate-800">
                                      {z.validUniqueCount} soal
                                      {zNotes.length > 0 && (
                                        <span className="block text-[10px] font-normal text-amber-700">{zNotes.join(', ')}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      {isMissing ? (
                                        <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold text-[10px]">
                                          Kurang (+1 soal)
                                        </span>
                                      ) : (
                                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                          Terpenuhi
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setDetailShortageItem(null);
                  setReloadTick(t => t + 1);
                }}
                className="px-3 py-1.5 rounded-xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-bold inline-flex items-center gap-1.5"
              >
                <RefreshCw size={12} />
                <span>Periksa Ulang Kesiapan</span>
              </button>
              <button
                type="button"
                onClick={() => setDetailShortageItem(null)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
      {showAutoFillModal && (
        <UASBankAutoFillModal
          isOpen={showAutoFillModal}
          onClose={() => setShowAutoFillModal(false)}
          sessions={juzSessions}
          eligibilityItems={eligibilitySummary.items}
          bankQuestions={bankQuestions}
          user={user}
          onActivated={async () => {
            setReloadTick(t => t + 1);
          }}
        />
      )}
    </div>
  );
};
