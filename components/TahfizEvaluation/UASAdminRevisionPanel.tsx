import React, { useMemo, useState } from 'react';
import {
  ExamPeriod,
  ExamUASMaterialRevision,
  UASMaterialRevisionSnapshot,
  User
} from '../../types';
import { api } from '../../api';
import { quranService } from '../../services/quranService';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  X,
  XCircle
} from 'lucide-react';

interface UASAdminRevisionPanelProps {
  user: User;
  period: ExamPeriod;
  revisions: ExamUASMaterialRevision[];
  onRefresh: () => Promise<void> | void;
  onPrepareReplacementPacket?: (studentId: string) => void;
}

function formatMaterialSummary(m?: UASMaterialRevisionSnapshot | null): string {
  if (!m) return '-';
  const s1 = quranService.getSurah(m.startSurah)?.name || `Surah ${m.startSurah}`;
  const s2 = quranService.getSurah(m.endSurah)?.name || `Surah ${m.endSurah}`;
  const kind = m.sessionType === 'partial_half' ? 'Parsial (4 Soal)' : 'Juz Penuh (9 Soal)';
  return `Sesi ${m.sessionNumber} • Juz ${m.juzNumber} • ${kind} (${s1}:${m.startAyah}–${s2}:${m.endAyah}, Hal. ${m.startPage}–${m.endPage})`;
}

function packetStatusBadge(status?: string): { label: string; cls: string } {
  switch (status) {
    case 'submitted':
      return { label: 'Sudah Dinilai (Submitted)', cls: 'bg-rose-100 text-rose-800 border-rose-200' };
    case 'in_progress':
      return { label: 'Ujian Berlangsung', cls: 'bg-amber-100 text-amber-900 border-amber-200' };
    case 'unused_packet':
      return { label: 'Paket Ada (Belum Dipakai)', cls: 'bg-sky-100 text-sky-800 border-sky-200' };
    default:
      return { label: 'Belum Ada Paket', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
  }
}

function attemptStatusLabel(status?: string): string {
  switch (status) {
    case 'submitted':
      return 'Submitted / Bernilai';
    case 'in_progress':
      return 'Sedang Berjalan (in_progress)';
    default:
      return 'Belum Ada Attempt';
  }
}

function revisionStatusBadge(status: ExamUASMaterialRevision['status']): { label: string; cls: string } {
  switch (status) {
    case 'pending':
      return { label: 'Menunggu Keputusan', cls: 'bg-amber-100 text-amber-900 border-amber-200' };
    case 'approved':
      return { label: 'Disetujui & Diterapkan', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
    case 'rejected':
      return { label: 'Ditolak', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
    case 'on_hold_in_progress':
      return { label: 'Ditahan (Ujian Berlangsung)', cls: 'bg-orange-100 text-orange-900 border-orange-200' };
    case 'needs_academic_decision':
      return { label: 'Memerlukan Keputusan Akademik', cls: 'bg-rose-100 text-rose-800 border-rose-200' };
    default:
      return { label: status, cls: 'bg-slate-100 text-slate-700 border-slate-200' };
  }
}

export const UASAdminRevisionPanel: React.FC<UASAdminRevisionPanelProps> = ({
  user,
  period,
  revisions,
  onRefresh,
  onPrepareReplacementPacket
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRevision, setSelectedRevision] = useState<ExamUASMaterialRevision | null>(null);
  const [decisionReason, setDecisionReason] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  const isAdmin = user.role === 'admin';

  const kpi = useMemo(() => {
    return {
      total: revisions.length,
      pending: revisions.filter(r => r.status === 'pending').length,
      approved: revisions.filter(r => r.status === 'approved').length,
      heldOrAcademic: revisions.filter(r => r.status === 'on_hold_in_progress' || r.status === 'needs_academic_decision').length,
      rejected: revisions.filter(r => r.status === 'rejected').length
    };
  }, [revisions]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return revisions.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q) {
        const hay = [
          r.studentName || '',
          r.studentNis || '',
          r.studentClass || '',
          r.halaqah || '',
          r.requestedByName || '',
          r.reason || ''
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [revisions, statusFilter, searchQuery]);

  if (!isAdmin) {
    return (
      <div className="p-6 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 text-xs font-semibold flex items-center gap-2">
        <ShieldAlert size={16} />
        <span>Akses ditolak: Hanya Admin yang berwenang meninjau dan memutuskan pengajuan revisi materi UAS.</span>
      </div>
    );
  }

  const executeDecision = async (
    rev: ExamUASMaterialRevision,
    decision: 'approve' | 'reject' | 'mark_academic_decision'
  ) => {
    if (isProcessing) return;
    const cleanReason = decisionReason.trim();
    if (decision === 'reject' && cleanReason.length < 5) {
      setFeedback({ type: 'error', text: 'Alasan penolakan wajib diisi minimal 5 karakter.' });
      return;
    }

    const livePacket = rev.livePacketStatus || rev.oldPacketStatus;
    if (decision === 'approve') {
      const confirmText = livePacket === 'unused_packet'
        ? `Setujui revisi materi untuk ${rev.studentName || rev.studentId}?\n\nPaket soal lama (belum digunakan) akan dinonaktifkan sebagai riwayat audit (stale), materi baru akan diterapkan, dan Anda perlu menggenerate paket pengganti secara eksplisit.`
        : `Setujui dan terapkan revisi materi untuk ${rev.studentName || rev.studentId}?`;
      if (!window.confirm(confirmText)) return;
    }

    setIsProcessing(true);
    setFeedback(null);
    const decisionIdemKey = `dec_${rev.id}_${decision}_${user.id}`;
    try {
      const res = await api.decideUASMaterialRevision(
        {
          revisionId: rev.id,
          decision,
          reason: cleanReason || undefined,
          idempotencyKey: decisionIdemKey
        },
        user
      );
      if (!res.success) {
        setFeedback({
          type: res.blockedCondition ? 'warning' : 'error',
          text: res.message || 'Keputusan revisi tidak dapat diterapkan.'
        });
      } else {
        setFeedback({
          type: 'success',
          text: res.message || 'Keputusan revisi berhasil disimpan.'
        });
        setDecisionReason('');
        setSelectedRevision(null);
      }
      await onRefresh();
    } catch (e: any) {
      setFeedback({ type: 'error', text: e?.message || 'Gagal memproses keputusan revisi.' });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-bold text-sm sm:text-base text-slate-900">Pengajuan Revisi Materi UAS</h4>
          <p className="text-xs text-slate-500">
            Periode: {period.name} • Tinjau usulan revisi dari Guru Halaqah dengan perlindungan paket, attempt, dan nilai historis.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRefresh()}
          className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 inline-flex items-center gap-1.5"
        >
          <RefreshCw size={13} />
          <span>Muat Ulang</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3 rounded-2xl border border-amber-200 shadow-sm">
          <p className="text-[11px] font-semibold text-amber-700">Menunggu Keputusan</p>
          <p className="text-2xl font-black text-amber-800">{kpi.pending}</p>
        </div>
        <div className="bg-white p-3 rounded-2xl border border-emerald-200 shadow-sm">
          <p className="text-[11px] font-semibold text-emerald-700">Disetujui</p>
          <p className="text-2xl font-black text-emerald-800">{kpi.approved}</p>
        </div>
        <div className="bg-white p-3 rounded-2xl border border-rose-200 shadow-sm">
          <p className="text-[11px] font-semibold text-rose-700">Ditahan / Keputusan Akademik</p>
          <p className="text-2xl font-black text-rose-800">{kpi.heldOrAcademic}</p>
        </div>
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-[11px] font-semibold text-slate-600">Ditolak</p>
          <p className="text-2xl font-black text-slate-800">{kpi.rejected}</p>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-semibold flex items-start justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : feedback.type === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Cari santri, NIS, kelas, halaqah, guru, alasan..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-xl px-2.5 py-1.5 bg-white"
        >
          <option value="all">Semua Status ({kpi.total})</option>
          <option value="pending">Menunggu Keputusan ({kpi.pending})</option>
          <option value="approved">Disetujui ({kpi.approved})</option>
          <option value="on_hold_in_progress">Ditahan (Ujian Berlangsung)</option>
          <option value="needs_academic_decision">Memerlukan Keputusan Akademik</option>
          <option value="rejected">Ditolak ({kpi.rejected})</option>
        </select>
      </div>

      {/* Table */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2.5 font-bold">Santri &amp; Guru</th>
                <th className="px-3 py-2.5 font-bold">Materi Lama → Baru</th>
                <th className="px-3 py-2.5 font-bold">Kondisi Paket &amp; Attempt</th>
                <th className="px-3 py-2.5 font-bold">Status Permohonan</th>
                <th className="px-3 py-2.5 font-bold text-right">Tindakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(rev => {
                const pkt = packetStatusBadge(rev.livePacketStatus || rev.oldPacketStatus);
                const st = revisionStatusBadge(rev.status);
                const needsReplacement = rev.status === 'approved' && !rev.replacementQuestionSetId;
                return (
                  <tr key={rev.id} className="hover:bg-slate-50/70 align-top">
                    <td className="px-3 py-3 space-y-0.5">
                      <div className="font-bold text-slate-900">{rev.studentName || rev.studentId}</div>
                      <div className="text-[11px] text-slate-500">
                        NIS: {rev.studentNis || '-'} • {rev.studentClass || '-'} • Halaqah {rev.halaqah || '-'}
                      </div>
                      <div className="text-[11px] text-slate-600">
                        Pengaju: <strong>{rev.requestedByName}</strong>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(rev.requestedAt).toLocaleString('id-ID')}
                      </div>
                    </td>
                    <td className="px-3 py-3 space-y-1 max-w-xs">
                      <div className="text-[11px] text-slate-500">
                        <span className="font-bold text-slate-700">Lama:</span> {formatMaterialSummary(rev.oldMaterial)}
                      </div>
                      <div className="text-[11px] text-teal-900 font-semibold">
                        <span className="font-bold">Baru:</span> {formatMaterialSummary(rev.proposedMaterial)}
                      </div>
                      <div className="text-[11px] text-slate-600 italic bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                        &ldquo;{rev.reason}&rdquo;
                      </div>
                    </td>
                    <td className="px-3 py-3 space-y-1">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold ${pkt.cls}`}>
                        {pkt.label}
                      </span>
                      <div className="text-[11px] text-slate-600">
                        Attempt: {attemptStatusLabel(rev.liveAttemptStatus || rev.oldAttemptStatus)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Approval awal: {rev.oldApprovalStatus || '-'}
                      </div>
                      {rev.replacementQuestionSetId && (
                        <div className="text-[10px] text-emerald-700 font-bold">
                          Paket pengganti: {rev.replacementQuestionSetId}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 space-y-1">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold ${st.cls}`}>
                        {st.label}
                      </span>
                      {rev.decidedByName && (
                        <div className="text-[10px] text-slate-500">
                          Oleh {rev.decidedByName}
                        </div>
                      )}
                      {rev.decisionReason && (
                        <div className="text-[10px] text-slate-600">{rev.decisionReason}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right space-y-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRevision(rev);
                          setDecisionReason('');
                          setFeedback(null);
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold inline-flex items-center gap-1"
                      >
                        <Eye size={12} />
                        <span>Detail</span>
                      </button>
                      {needsReplacement && onPrepareReplacementPacket && (
                        <div>
                          <button
                            type="button"
                            onClick={() => onPrepareReplacementPacket(rev.studentId)}
                            className="px-2.5 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-bold inline-flex items-center gap-1"
                          >
                            <Sparkles size={12} />
                            <span>Siapkan Paket Pengganti</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    Belum ada pengajuan revisi materi UAS yang sesuai filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail & Decision Modal */}
      {selectedRevision && (() => {
        const liveAttempt = selectedRevision.liveAttemptStatus || selectedRevision.oldAttemptStatus || 'none';
        const livePacket = selectedRevision.livePacketStatus || selectedRevision.oldPacketStatus || 'none';
        const isSubmitted = liveAttempt === 'submitted' || livePacket === 'submitted';
        const isInProgress = !isSubmitted && (liveAttempt === 'in_progress' || livePacket === 'in_progress');
        const isCanDecide = selectedRevision.status === 'pending' || selectedRevision.status === 'on_hold_in_progress';

        return (
          <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
                <div>
                  <h4 className="font-bold text-sm text-slate-900">Detail Pengajuan Revisi Materi UAS</h4>
                  <p className="text-xs text-slate-500">
                    {selectedRevision.studentName} (NIS {selectedRevision.studentNis || '-'}) • {selectedRevision.studentClass} • Halaqah {selectedRevision.halaqah}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRevision(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 space-y-1">
                    <div className="text-[10px] font-bold uppercase text-slate-500">Materi Lama</div>
                    <div className="font-bold text-slate-900">{formatMaterialSummary(selectedRevision.oldMaterial)}</div>
                  </div>
                  <div className="p-3.5 rounded-2xl border border-teal-200 bg-teal-50/70 space-y-1">
                    <div className="text-[10px] font-bold uppercase text-teal-800">Materi Baru (Usulan)</div>
                    <div className="font-bold text-teal-950">{formatMaterialSummary(selectedRevision.proposedMaterial)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500">Guru Pengaju</div>
                    <div className="font-bold text-slate-800 mt-0.5">{selectedRevision.requestedByName}</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500">Approval Sebelumnya</div>
                    <div className="font-bold text-slate-800 mt-0.5">{selectedRevision.oldApprovalStatus || '-'}</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500">Status Paket (Live)</div>
                    <div className="font-bold text-slate-800 mt-0.5">{packetStatusBadge(livePacket).label}</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500">Status Attempt (Live)</div>
                    <div className="font-bold text-slate-800 mt-0.5">{attemptStatusLabel(liveAttempt)}</div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Alasan Revisi Guru</div>
                  <p className="text-slate-800 mt-0.5">{selectedRevision.reason}</p>
                </div>

                {isSubmitted && (
                  <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-2">
                    <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">Ujian Sudah Submitted / Bernilai (Kondisi 4)</div>
                      <p className="mt-0.5">
                        Materi, soal, nilai, dan identitas penguji dilindungi. Sistem tidak mengizinkan reset attempt, penghapusan nilai, atau penggantian materi otomatis. Admin hanya dapat menandai sebagai <strong>Memerlukan Keputusan Akademik</strong> atau menolak pengajuan.
                      </p>
                    </div>
                  </div>
                )}

                {isInProgress && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">Revisi membutuhkan penanganan Admin karena ujian sedang berlangsung (Kondisi 3)</div>
                      <p className="mt-0.5">
                        Sesi dan paket aktif tidak boleh diganti saat attempt masih berjalan. Pelaksanaan revisi ditahan sampai status ujian aman.
                      </p>
                    </div>
                  </div>
                )}

                {isCanDecide && (
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Catatan / Alasan Keputusan Admin {isSubmitted ? '(opsional untuk Keputusan Akademik, wajib jika menolak)' : '(wajib jika menolak)'}
                    </label>
                    <textarea
                      rows={2}
                      value={decisionReason}
                      onChange={e => setDecisionReason(e.target.value)}
                      placeholder="Tuliskan catatan keputusan Admin untuk audit trail..."
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white"
                    />
                  </div>
                )}
              </div>

              <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setSelectedRevision(null)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-200/70 text-xs font-bold"
                >
                  Tutup
                </button>
                {isCanDecide && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => executeDecision(selectedRevision, 'reject')}
                      className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <XCircle size={14} className="text-rose-600" />
                      <span>Tolak Revisi</span>
                    </button>
                    {isSubmitted ? (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => executeDecision(selectedRevision, 'mark_academic_decision')}
                        className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <ShieldAlert size={14} />
                        <span>Tandai Memerlukan Keputusan Akademik</span>
                      </button>
                    ) : isInProgress ? (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => executeDecision(selectedRevision, 'mark_academic_decision')}
                        className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Clock size={14} />
                        <span>Tandai Penanganan Khusus</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => executeDecision(selectedRevision, 'approve')}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <CheckCircle2 size={14} />
                        <span>{isProcessing ? 'Memproses...' : 'Setujui & Terapkan Revisi'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
