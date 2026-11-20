import React, { useMemo, useState } from 'react';
import {
  ExamMaterialPart,
  ExamPeriod,
  ExamUASPrepAuditLog,
  ExamUASPrepSubmission,
  ExamUASSession,
  User
} from '../../types';
import { api } from '../../api';
import {
  CheckSquare,
  Square,
  ShieldCheck,
  XCircle,
  Eye,
  AlertTriangle,
  Clock,
  FileCheck2,
  CheckCircle2
} from 'lucide-react';

interface UASAdminApprovalPanelProps {
  user: User;
  period: ExamPeriod;
  submissions: ExamUASPrepSubmission[];
  parts: ExamMaterialPart[];
  sessions: ExamUASSession[];
  onRefresh: () => Promise<void> | void;
}

const PAGE_SIZE = 25;

export const UASAdminApprovalPanel: React.FC<UASAdminApprovalPanelProps> = ({
  user,
  period,
  submissions,
  parts,
  sessions,
  onRefresh
}) => {
  const [halaqahFilter, setHalaqahFilter] = useState('all');
  const [teacherFilter, setTeacherFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewModal, setPreviewModal] = useState<{
    mode: 'selected' | 'all_eligible';
    targetIds: string[];
    totalSessions: number;
    excludedCount: number;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [report, setReport] = useState<{
    approvedCount: number;
    alreadyApprovedCount: number;
    skippedCount: number;
    failedCount: number;
    results: Array<{ studentId: string; studentName?: string; outcome: string; reason: string }>;
  } | null>(null);
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null);
  const [detailLogs, setDetailLogs] = useState<ExamUASPrepAuditLog[]>([]);

  const isEligibleForBulkApprove = (sub: ExamUASPrepSubmission): boolean => {
    if (sub.status !== 'pending_admin_approval' || sub.isException) return false;
    const stuParts = parts.filter(p => p.studentId === sub.studentId && p.status !== 'excluded');
    const hasBlockedPart = stuParts.some(
      p => p.status === 'needs_review' || p.status === 'needs_admin_decision' || p.teacherStatus === 'stale' || p.teacherStatus === 'needs_correction'
    );
    return !hasBlockedPart;
  };

  const kpi = useMemo(() => {
    const total = submissions.length;
    const pending = submissions.filter(s => s.status === 'pending_admin_approval').length;
    const eligible = submissions.filter(isEligibleForBulkApprove).length;
    const needsFix = submissions.filter(s => ['needs_correction', 'rejected', 'stale'].includes(s.status)).length;
    const exceptions = submissions.filter(s => s.status === 'exception_pending' || s.isException).length;
    const approved = submissions.filter(s => s.status === 'admin_approved').length;
    return { total, pending, eligible, needsFix, exceptions, approved };
  }, [submissions, parts]);

  const distinctHalaqahs = useMemo(
    () => Array.from(new Set(submissions.map(s => s.halaqah).filter(Boolean) as string[])).sort(),
    [submissions]
  );
  const distinctTeachers = useMemo(
    () => Array.from(new Set(submissions.map(s => s.teacherName).filter(Boolean))).sort(),
    [submissions]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return submissions.filter(s => {
      if (halaqahFilter !== 'all' && s.halaqah !== halaqahFilter) return false;
      if (teacherFilter !== 'all' && s.teacherName !== teacherFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (q) {
        const hit =
          (s.studentName || '').toLowerCase().includes(q) ||
          (s.halaqah || '').toLowerCase().includes(q) ||
          s.teacherName.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [submissions, halaqahFilter, teacherFilter, statusFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPageRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const eligibleInFilter = useMemo(() => filtered.filter(isEligibleForBulkApprove), [filtered, parts]);

  const toggleOne = (sid: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

  const selectCurrentPage = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      currentPageRows.forEach(r => next.add(r.studentId));
      return next;
    });
  };

  const selectAllEligibleInFilter = () => {
    setSelectedIds(new Set(eligibleInFilter.map(r => r.studentId)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const openApprovePreview = (mode: 'selected' | 'all_eligible') => {
    const rawIds = mode === 'all_eligible' ? eligibleInFilter.map(r => r.studentId) : Array.from(selectedIds);
    const eligibleSet = new Set(submissions.filter(isEligibleForBulkApprove).map(r => r.studentId));
    const targetIds = rawIds.filter(id => eligibleSet.has(id));
    const excludedCount = rawIds.length - targetIds.length;
    const totalSessions = submissions
      .filter(s => targetIds.includes(s.studentId))
      .reduce((acc, s) => acc + (s.totalSessionCount || 0), 0);

    setPreviewModal({ mode, targetIds, totalSessions, excludedCount });
  };

  const executeBulkApprove = async () => {
    if (!previewModal || previewModal.targetIds.length === 0) return;
    setIsProcessing(true);
    try {
      const res = await api.adminBulkDecideUASPrep(
        period.id,
        previewModal.targetIds,
        'approve',
        'Persetujuan massal Admin',
        user
      );
      if (res.success) {
        setReport({
          approvedCount: res.approvedCount || 0,
          alreadyApprovedCount: res.alreadyApprovedCount || 0,
          skippedCount: res.skippedCount || 0,
          failedCount: res.failedCount || 0,
          results: res.results || []
        });
        setPreviewModal(null);
        clearSelection();
        await onRefresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedIds.size === 0) return;
    const reason = window.prompt(`Masukkan alasan penolakan untuk ${selectedIds.size} santri terpilih (min. 5 karakter):`);
    if (!reason || reason.trim().length < 5) return;
    setIsProcessing(true);
    try {
      const res = await api.adminBulkDecideUASPrep(period.id, Array.from(selectedIds), 'reject', reason.trim(), user);
      if (res.success) {
        setReport({
          approvedCount: res.approvedCount || 0,
          alreadyApprovedCount: res.alreadyApprovedCount || 0,
          skippedCount: res.skippedCount || 0,
          failedCount: res.failedCount || 0,
          results: res.results || []
        });
        clearSelection();
        await onRefresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const openDetail = async (studentId: string) => {
    setDetailStudentId(studentId);
    const res = await api.getUASPrepAuditLogs(period.id, studentId, user);
    if (res.success && res.logs) {
      setDetailLogs(
        res.logs.map((l: any) => ({
          id: l.id,
          examPeriodId: l.exam_period_id,
          studentId: l.student_id,
          actorId: l.actor_id,
          actorName: l.actor_name,
          actorRole: l.actor_role,
          action: l.action,
          targetId: l.target_id,
          reason: l.reason,
          details: l.details,
          createdAt: l.created_at
        }))
      );
    } else {
      setDetailLogs([]);
    }
  };

  const detailSub = detailStudentId ? submissions.find(s => s.studentId === detailStudentId) : null;
  const detailParts = detailStudentId ? parts.filter(p => p.studentId === detailStudentId) : [];
  const detailSessions = detailStudentId ? sessions.filter(s => s.studentId === detailStudentId) : [];

  return (
    <div className="bg-white rounded-3xl border border-indigo-200/80 shadow-sm p-5 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck2 size={18} className="text-indigo-700" />
            <h2 className="text-base font-extrabold text-slate-900">Persetujuan Materi &amp; Sesi UAS (Admin)</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Tinjau pengajuan dari Guru Halaqah, setujui satu per satu atau massal dengan checkbox yang aman &amp; idempoten.
          </p>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
          <div className="text-[10px] text-slate-500">Total Pengajuan</div>
          <div className="text-lg font-black text-slate-900">{kpi.total}</div>
        </div>
        <div className="p-3 rounded-2xl bg-sky-50 border border-sky-200 text-sky-900">
          <div className="text-[10px]">Menunggu Persetujuan</div>
          <div className="text-lg font-black">{kpi.pending}</div>
        </div>
        <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900">
          <div className="text-[10px]">Layak Disetujui</div>
          <div className="text-lg font-black">{kpi.eligible}</div>
        </div>
        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900">
          <div className="text-[10px]">Perlu Koreksi</div>
          <div className="text-lg font-black">{kpi.needsFix}</div>
        </div>
        <div className="p-3 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900">
          <div className="text-[10px]">Pengajuan Pengecualian</div>
          <div className="text-lg font-black">{kpi.exceptions}</div>
        </div>
        <div className="p-3 rounded-2xl bg-teal-50 border border-teal-200 text-teal-900">
          <div className="text-[10px]">Sudah Disetujui</div>
          <div className="text-lg font-black">{kpi.approved}</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
        <input
          type="text"
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
          placeholder="Cari nama santri atau guru..."
          className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={halaqahFilter}
          onChange={e => { setHalaqahFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white"
        >
          <option value="all">Semua Halaqah</option>
          {distinctHalaqahs.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <select
          value={teacherFilter}
          onChange={e => { setTeacherFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white"
        >
          <option value="all">Semua Guru Pengaju</option>
          {distinctTeachers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white"
        >
          <option value="all">Semua Status</option>
          <option value="pending_admin_approval">Menunggu Admin</option>
          <option value="exception_pending">Pengecualian</option>
          <option value="admin_approved">Disetujui</option>
          <option value="rejected">Ditolak / Koreksi</option>
          <option value="stale">Stale (Perlu Verifikasi Ulang)</option>
        </select>
      </div>

      {/* Bulk Checkbox Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={selectCurrentPage} className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 font-semibold hover:bg-slate-100">
            Pilih Halaman Ini ({currentPageRows.length})
          </button>
          <button onClick={selectAllEligibleInFilter} className="px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-300 text-indigo-800 font-bold hover:bg-indigo-100">
            Pilih Semua yang Layak dalam Filter ({eligibleInFilter.length})
          </button>
          {selectedIds.size > 0 && (
            <button onClick={clearSelection} className="px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 font-semibold">
              Batal Pilih ({selectedIds.size})
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => openApprovePreview('selected')}
            disabled={selectedIds.size === 0 || isProcessing}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-40"
          >
            Setujui Terpilih ({selectedIds.size})
          </button>
          <button
            onClick={() => openApprovePreview('all_eligible')}
            disabled={eligibleInFilter.length === 0 || isProcessing}
            className="px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold disabled:opacity-40"
          >
            Setujui Semua yang Layak ({eligibleInFilter.length})
          </button>
          <button
            onClick={handleBulkReject}
            disabled={selectedIds.size === 0 || isProcessing}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold disabled:opacity-40"
          >
            Tolak Terpilih
          </button>
        </div>
      </div>

      {/* Execution Report */}
      {report && (
        <div className="p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/70 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-bold text-emerald-900">
              Laporan Persetujuan Massal: {report.approvedCount} diproses • {report.alreadyApprovedCount} sudah disetujui • {report.skippedCount} dilewati • {report.failedCount} gagal
            </div>
            <button onClick={() => setReport(null)} className="text-slate-500 hover:text-slate-800 font-bold">Tutup</button>
          </div>
          <div className="max-h-36 overflow-y-auto space-y-1">
            {report.results.map((r, i) => (
              <div key={i} className="text-[11px] text-slate-700">
                <strong>{r.studentName || r.studentId}</strong>: [{r.outcome}] — {r.reason}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submissions Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-2xl">
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3 w-8"></th>
              <th className="py-2.5 px-3">Santri</th>
              <th className="py-2.5 px-3">Guru Pengaju</th>
              <th className="py-2.5 px-3">Rincian Sesi</th>
              <th className="py-2.5 px-3">Status Pengajuan</th>
              <th className="py-2.5 px-3">Tgl Pengajuan</th>
              <th className="py-2.5 px-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {currentPageRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400">
                  Belum ada pengajuan materi &amp; sesi UAS dari Guru Halaqah.
                </td>
              </tr>
            ) : (
              currentPageRows.map(sub => {
                const checked = selectedIds.has(sub.studentId);
                const eligible = isEligibleForBulkApprove(sub);
                return (
                  <tr key={sub.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3">
                      <button onClick={() => toggleOne(sub.studentId)} aria-label={`Pilih ${sub.studentName || sub.studentId}`}>
                        {checked ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} className="text-slate-400" />}
                      </button>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-800">{sub.studentName || sub.studentId}</div>
                      <div className="text-[11px] text-slate-400">{sub.studentClass || '-'} • {sub.halaqah || '-'}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 font-semibold">{sub.teacherName}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-800">{sub.totalSessionCount} Total Sesi</div>
                      <div className="text-[10px] text-slate-500">
                        {sub.fullJuzCount} penuh • {sub.partialJuzCount} parsial • {sub.manualSessionCount} manual
                      </div>
                    </td>
                    <td className="py-2.5 px-3 space-y-1">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                        sub.status === 'admin_approved' ? 'bg-emerald-100 text-emerald-800'
                          : sub.status === 'pending_admin_approval' ? 'bg-sky-100 text-sky-800'
                          : sub.status === 'exception_pending' ? 'bg-indigo-100 text-indigo-800'
                          : sub.status === 'rejected' || sub.status === 'needs_correction' ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {sub.status}
                      </span>
                      <div className="text-[10px] text-slate-500">
                        {eligible ? 'Layak persetujuan massal' : sub.isException ? 'Pengecualian (tinjau manual)' : 'Tidak masuk massal otomatis'}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-slate-500">
                      {sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString('id-ID') : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => openDetail(sub.studentId)}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold inline-flex items-center gap-1"
                      >
                        <Eye size={12} />
                        <span>Detail</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Halaman {page} dari {totalPages} ({filtered.length} data)</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 rounded border border-slate-200 disabled:opacity-40">Prev</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 rounded border border-slate-200 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {/* Preview Dialog */}
      {previewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 space-y-4 shadow-xl text-xs">
            <div className="font-extrabold text-base text-slate-900">Pratinjau Persetujuan Massal Admin</div>
            <div className="space-y-1.5 text-slate-700">
              <div>• Santri layak yang akan disetujui: <strong>{previewModal.targetIds.length} santri</strong></div>
              <div>• Total sesi yang akan dikunci: <strong>{previewModal.totalSessions} sesi</strong></div>
              {previewModal.excludedCount > 0 && (
                <div className="text-amber-700 font-semibold">
                  • {previewModal.excludedCount} santri dilewati otomatis karena berstatus pengecualian / perlu koreksi / belum siap.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPreviewModal(null)} className="px-3 py-2 rounded-xl border border-slate-300 font-bold">Batal</button>
              <button
                onClick={executeBulkApprove}
                disabled={isProcessing || previewModal.targetIds.length === 0}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-40"
              >
                {isProcessing ? 'Memproses...' : `Setujui ${previewModal.targetIds.length} Santri`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailSub && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">{detailSub.studentName || detailSub.studentId}</h3>
                <div className="text-slate-500">{detailSub.studentClass} • {detailSub.halaqah} • Pengaju: {detailSub.teacherName}</div>
              </div>
              <button onClick={() => setDetailStudentId(null)} className="text-slate-500 hover:text-slate-900 font-bold">Tutup</button>
            </div>

            {detailSub.isException && (
              <div className="p-3 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900">
                <strong>Pengajuan Pengecualian Khusus:</strong> {detailSub.exceptionReason}
              </div>
            )}

            <div className="space-y-2">
              <div className="font-bold text-slate-800">Bagian Materi Per Juz ({detailParts.length})</div>
              {detailParts.map(pt => (
                <div key={pt.id} className="p-2.5 rounded-xl border border-slate-200 bg-slate-50">
                  <div className="font-bold">Juz {pt.juzNumber} ({pt.partType}) — [{pt.status} / {pt.teacherStatus}]</div>
                  <div className="text-slate-600">Catatan Verifikasi Guru: {pt.verificationNotes || pt.reviewReason || '-'}</div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="font-bold text-slate-800">Rencana Sesi ({detailSessions.length})</div>
              {detailSessions.map(s => (
                <div key={s.id} className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 flex justify-between">
                  <div>
                    <div className="font-bold">Sesi {s.sessionNumber}: Juz {s.juzNumber} ({s.sessionType}) [{s.source || 'auto'}]</div>
                    {s.changeReason && <div className="text-slate-500">Alasan Manual: {s.changeReason}</div>}
                  </div>
                  <span className="font-bold text-slate-700">{s.approvalStatus || s.status}</span>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <div className="font-bold text-slate-800">Riwayat Audit ({detailLogs.length})</div>
              <div className="max-h-36 overflow-y-auto space-y-1 border border-slate-200 rounded-xl p-2">
                {detailLogs.map(l => (
                  <div key={l.id} className="text-[11px] text-slate-600">
                    [{new Date(l.createdAt).toLocaleString('id-ID')}] <strong>{l.actorName}</strong> ({l.action}): {l.reason || '-'}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                onClick={async () => {
                  const r = window.prompt('Alasan penolakan (min. 5 karakter):');
                  if (!r || r.trim().length < 5) return;
                  await api.adminBulkDecideUASPrep(period.id, [detailSub.studentId], 'reject', r.trim(), user);
                  setDetailStudentId(null);
                  await onRefresh();
                }}
                className="px-3 py-2 rounded-xl bg-rose-600 text-white font-bold"
              >
                Tolak Pengajuan
              </button>
              <button
                onClick={async () => {
                  await api.adminBulkDecideUASPrep(
                    period.id,
                    [detailSub.studentId],
                    detailSub.isException ? 'approve_manual_exception' : 'approve',
                    'Disetujui manual dari Detail Admin',
                    user
                  );
                  setDetailStudentId(null);
                  await onRefresh();
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold"
              >
                {detailSub.isException ? 'Setujui Pengecualian Manual' : 'Setujui Santri Ini'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
