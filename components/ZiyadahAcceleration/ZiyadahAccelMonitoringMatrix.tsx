import React, { useEffect, useMemo, useState } from 'react';
import {
  ZiyadahAccelAuditLog,
  ZiyadahAccelSession,
  ZiyadahAccelStudentSessionCell,
  ZiyadahAccelStudentSummaryRow
} from '../../types';
import { formatPagesIndo } from '../../services/ziyadahAccelPageCalc';
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Eye,
  X,
  ShieldCheck,
  Clock
} from 'lucide-react';

interface ZiyadahAccelMonitoringMatrixProps {
  sessions: ZiyadahAccelSession[];
  rows: ZiyadahAccelStudentSummaryRow[];
  auditLogs: ZiyadahAccelAuditLog[];
  isLocked: boolean;
  onRefresh: () => Promise<void>;
  onVerifySubmission: (params: {
    submissionId: string;
    decision: 'approve' | 'reject';
    approvedUniquePages?: number;
    correctedScore?: number;
    note?: string;
  }) => Promise<void>;
}

export const ZiyadahAccelMonitoringMatrix: React.FC<ZiyadahAccelMonitoringMatrixProps> = ({
  sessions,
  rows,
  auditLogs,
  isLocked,
  onRefresh,
  onVerifySubmission
}) => {
  const validSessions = useMemo(
    () => sessions.filter(s => s.status !== 'cancelled').sort((a, b) => a.sessionNumber - b.sessionNumber),
    [sessions]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [filterClass, setFilterClass] = useState('ALL');
  const [filterHalaqah, setFilterHalaqah] = useState('ALL');
  const [filterExaminer, setFilterExaminer] = useState('ALL');
  const [filterSessionId, setFilterSessionId] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState<
    'ALL' | 'NEEDS_VERIFY' | 'LAGGING' | 'COMPLETE' | 'INCOMPLETE'
  >('ALL');

  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [autoRefresh45s, setAutoRefresh45s] = useState<boolean>(false);

  // Modal Detail & Verifikasi
  const [detailRow, setDetailRow] = useState<ZiyadahAccelStudentSummaryRow | null>(null);
  const [verifyCell, setVerifyCell] = useState<{
    studentName: string;
    cell: ZiyadahAccelStudentSessionCell;
  } | null>(null);
  const [verifyPagesInput, setVerifyPagesInput] = useState<string>('1');
  const [verifyScoreInput, setVerifyScoreInput] = useState<string>('85');
  const [verifyNote, setVerifyNote] = useState<string>('');
  const [verifyErrorMsg, setVerifyErrorMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Refresh berkala terkontrol (45 detik) HANYA saat tab browser terlihat (tidak membebani Supabase)
  useEffect(() => {
    if (!autoRefresh45s) return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        onRefresh();
      }
    }, 45000);
    return () => clearInterval(timer);
  }, [autoRefresh45s, onRefresh]);

  const distinctClasses = useMemo(
    () => Array.from(new Set(rows.map(r => r.className))).sort(),
    [rows]
  );
  const distinctHalaqahs = useMemo(
    () => Array.from(new Set(rows.map(r => r.halaqah))).sort(),
    [rows]
  );
  const distinctExaminers = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r =>
      r.cells.forEach(c => {
        if (c.examinerName) s.add(c.examinerName);
      })
    );
    return Array.from(s).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter(r => {
      if (filterClass !== 'ALL' && r.className !== filterClass) return false;
      if (filterHalaqah !== 'ALL' && r.halaqah !== filterHalaqah) return false;
      if (
        filterExaminer !== 'ALL' &&
        !r.cells.some(c => c.examinerName === filterExaminer)
      ) {
        return false;
      }
      if (filterSessionId !== 'ALL') {
        const targetCell = r.cells.find(c => c.sessionId === filterSessionId);
        if (!targetCell) return false;
        if (filterStatus === 'INCOMPLETE' && targetCell.fulfillmentStatus === 'submitted') {
          return false;
        }
      }
      if (filterStatus === 'NEEDS_VERIFY' && r.needsVerificationCount === 0) return false;
      if (filterStatus === 'LAGGING' && !r.isLagging) return false;
      if (filterStatus === 'COMPLETE' && !r.isCompleteAllSessions) return false;
      if (filterStatus === 'INCOMPLETE' && r.isCompleteAllSessions) return false;

      if (q) {
        const mName = r.studentName.toLowerCase().includes(q);
        const mNis = r.nis.toLowerCase().includes(q);
        if (!mName && !mNis) return false;
      }
      return true;
    });
  }, [
    rows,
    searchQuery,
    filterClass,
    filterHalaqah,
    filterExaminer,
    filterSessionId,
    filterStatus
  ]);

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(filteredRows.length / pageSize)) : 1;
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    if (pageSize <= 0) return filteredRows;
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  const openVerifyModal = (studentName: string, cell: ZiyadahAccelStudentSessionCell) => {
    if (!cell.submission) return;
    setVerifyErrorMsg(null);
    setVerifyCell({ studentName, cell });
    setVerifyPagesInput(String(cell.confirmedPages ?? 1));
    setVerifyScoreInput(String(cell.score ?? 85));
    setVerifyNote(cell.submission.verificationNote || '');
  };

  // PERBAIKAN B-06: Normalisasi koma desimal Indonesia ("1,25" -> 1.25) dan validasi kelipatan 0,25 halaman
  const handleConfirmVerify = async (decision: 'approve' | 'reject') => {
    if (!verifyCell?.cell.submission) return;
    setVerifyErrorMsg(null);

    const parsedPages = parseFloat(verifyPagesInput.replace(',', '.').trim());
    const parsedScore = parseFloat(verifyScoreInput.replace(',', '.').trim());

    if (decision === 'approve') {
      if (Number.isNaN(parsedPages) || parsedPages < 0 || parsedPages > 604) {
        setVerifyErrorMsg('Jumlah halaman disetujui harus antara 0 sampai 604.');
        return;
      }
      const scaled = Math.round(parsedPages * 100);
      if (Math.abs(parsedPages * 100 - scaled) > 1e-6 || scaled % 25 !== 0) {
        setVerifyErrorMsg('Jumlah halaman unik yang disetujui harus kelipatan 0,25 halaman (contoh: 0,25 | 0,5 | 0,75 | 1 | 1,25).');
        return;
      }
    }

    if (Number.isNaN(parsedScore) || parsedScore < 0 || parsedScore > 100) {
      setVerifyErrorMsg('Nilai sah harus berada pada rentang 0 sampai 100.');
      return;
    }

    setVerifying(true);
    try {
      await onVerifySubmission({
        submissionId: verifyCell.cell.submission.id,
        decision,
        approvedUniquePages: decision === 'approve' ? parsedPages : 0,
        correctedScore: parsedScore,
        note: verifyNote
      });
      setVerifyCell(null);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter & Kontrol Monitoring */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Cari nama santri atau NIS..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer font-medium text-slate-700">
              <input
                type="checkbox"
                checked={autoRefresh45s}
                onChange={e => setAutoRefresh45s(e.target.checked)}
              />
              <span>Auto-Refresh (45 dtk)</span>
            </label>
            <button
              type="button"
              onClick={onRefresh}
              className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Perbarui
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
          <select
            value={filterClass}
            onChange={e => {
              setFilterClass(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50"
          >
            <option value="ALL">Semua Kelas</option>
            {distinctClasses.map(c => (
              <option key={c} value={c}>
                Kelas {c}
              </option>
            ))}
          </select>

          <select
            value={filterHalaqah}
            onChange={e => {
              setFilterHalaqah(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50"
          >
            <option value="ALL">Semua Halaqah</option>
            {distinctHalaqahs.map(h => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>

          <select
            value={filterExaminer}
            onChange={e => {
              setFilterExaminer(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50"
          >
            <option value="ALL">Semua Penguji</option>
            {distinctExaminers.map(ex => (
              <option key={ex} value={ex}>
                {ex}
              </option>
            ))}
          </select>

          <select
            value={filterSessionId}
            onChange={e => {
              setFilterSessionId(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50"
          >
            <option value="ALL">Semua Sesi ({validSessions.length})</option>
            {validSessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={e => {
              setFilterStatus(e.target.value as any);
              setCurrentPage(1);
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
          >
            <option value="ALL">Semua Status Peserta</option>
            <option value="NEEDS_VERIFY">Memerlukan Verifikasi</option>
            <option value="LAGGING">Tertinggal Sesi Ditutup</option>
            <option value="INCOMPLETE">Belum Lengkap Semua Sesi</option>
            <option value="COMPLETE">Lengkap Seluruh Sesi</option>
          </select>
        </div>
      </div>

      {/* Tabel Matriks Dinamis Peserta x Sesi */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-gradient-to-r from-teal-900 to-emerald-900 text-white font-bold uppercase text-[11px]">
              <tr>
                <th className="py-3.5 px-3 text-center w-10">No</th>
                <th className="py-3.5 px-4 min-w-[180px]">Nama Santri</th>
                <th className="py-3.5 px-3 text-center">Kelas</th>
                {validSessions.map(s => (
                  <th key={s.id} className="py-3.5 px-3 text-center min-w-[135px] border-l border-white/10">
                    <div>{s.name}</div>
                    <div className="text-[10px] font-normal text-emerald-200">{s.status}</div>
                  </th>
                ))}
                <th className="py-3.5 px-3 text-center bg-emerald-950/60 min-w-[105px]">
                  Total Halaman
                </th>
                <th className="py-3.5 px-3 text-center bg-teal-950/60 min-w-[95px]">
                  Rata-rata Nilai
                </th>
                <th className="py-3.5 px-3 text-center w-20">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6 + validSessions.length}
                    className="py-12 text-center text-slate-400"
                  >
                    Tidak ada peserta yang sesuai dengan filter.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row, idx) => (
                  <tr key={row.participantId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-3 text-center font-mono text-slate-400">
                      {(safePage - 1) * (pageSize || filteredRows.length) + idx + 1}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        <span>{row.studentName}</span>
                        {row.isLagging && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">
                            Tertinggal
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {row.halaqah} • NIS: {row.nis}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-bold">
                        {row.className}
                      </span>
                    </td>

                    {row.cells.map(cell => (
                      <td
                        key={cell.sessionId}
                        className="py-2.5 px-3 text-center border-l border-slate-100 align-middle"
                      >
                        {cell.fulfillmentStatus === 'submitted' ? (
                          <div className="space-y-0.5">
                            <div className="font-mono font-bold text-slate-900">
                              {formatPagesIndo(cell.confirmedPages)} Hal •{' '}
                              <span className="text-teal-800">
                                {cell.score !== null ? cell.score.toFixed(0) : '-'}
                              </span>
                            </div>
                            <div
                              className="text-[10px] text-slate-500 truncate max-w-[140px] mx-auto"
                              title={cell.rangeSummaryText}
                            >
                              {cell.rangeSummaryText}
                            </div>
                            {cell.verificationStatus === 'needs_verification' ? (
                              <button
                                type="button"
                                onClick={() => openVerifyModal(row.studentName, cell)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-[10px] font-bold"
                              >
                                <AlertTriangle className="w-3 h-3" /> Verifikasi!
                              </button>
                            ) : cell.verificationStatus === 'verified_approved' ? (
                              <span className="inline-block text-[10px] text-emerald-700 font-semibold">
                                ✓ Terverifikasi
                              </span>
                            ) : cell.verificationStatus === 'verified_rejected' ? (
                              <span className="inline-block text-[10px] text-rose-700 font-semibold">
                                ✕ Ditolak
                              </span>
                            ) : null}
                          </div>
                        ) : cell.fulfillmentStatus === 'absent' ? (
                          <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                            Tidak Hadir
                          </span>
                        ) : cell.fulfillmentStatus === 'called_not_submitted' ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold">
                            Belum Menyetor
                          </span>
                        ) : cell.fulfillmentStatus === 'pending_examiner_input' ? (
                          <span className="px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 text-[10px] font-semibold">
                            Belum Diinput
                          </span>
                        ) : (
                          <span className="text-slate-300 text-[11px]">Belum Giliran</span>
                        )}
                      </td>
                    ))}

                    <td className="py-3 px-3 text-center bg-emerald-50/40 font-mono">
                      <div className="font-extrabold text-emerald-900 text-sm">
                        {formatPagesIndo(row.totalUniqueVerifiedPages)}
                      </div>
                      {row.totalUnverifiedPages > 0 && (
                        <div className="text-[10px] text-amber-700 font-semibold">
                          +{formatPagesIndo(row.totalUnverifiedPages)} verif
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-3 text-center bg-teal-50/40 font-mono">
                      <div className="font-extrabold text-teal-950 text-sm">
                        {row.averageScore !== null ? row.averageScore.toFixed(2) : '-'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        ({row.scoredSessionCount}/{row.totalSessionsExpected} sesi)
                      </div>
                    </td>

                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => setDetailRow(row)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
                        title="Lihat Detail Perkembangan Santri"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Pagination */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="text-slate-600">
            Menampilkan <strong>{paginatedRows.length}</strong> dari{' '}
            <strong>{filteredRows.length}</strong> peserta
          </div>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white"
            >
              <option value={25}>25 / halaman</option>
              <option value={50}>50 / halaman</option>
              <option value={0}>Semua</option>
            </select>
            {pageSize > 0 && totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 disabled:opacity-40 font-bold"
                >
                  ‹
                </button>
                <span className="px-2 font-mono">
                  {safePage}/{totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 disabled:opacity-40 font-bold"
                >
                  ›
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Verifikasi Overlap / Celah Ayat Koordinator */}
      {verifyCell && verifyCell.cell.submission && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-800 font-extrabold text-sm">
                <ShieldCheck className="w-5 h-5 text-amber-600" />
                <span>Verifikasi Setoran Koordinator</span>
              </div>
              <button
                type="button"
                onClick={() => setVerifyCell(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs space-y-1.5">
              <div>
                <strong>Santri:</strong> {verifyCell.studentName} ({verifyCell.cell.sessionName})
              </div>
              <div>
                <strong>Materi:</strong> {verifyCell.cell.rangeSummaryText}
              </div>
              <div>
                <strong>Input Penguji:</strong> {formatPagesIndo(verifyCell.cell.confirmedPages)}{' '}
                Halaman • Nilai {verifyCell.cell.score} ({verifyCell.cell.examinerName || '-'})
              </div>
              <div>
                <strong>Alasan Verifikasi:</strong>{' '}
                {verifyCell.cell.submission.verificationFlags.join(', ')}
              </div>
            </div>

            {!isLocked && (
              <>
                {verifyErrorMsg && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                    {verifyErrorMsg}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Halaman Unik Disetujui (Kelipatan 0,25)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={verifyPagesInput}
                      onChange={e => setVerifyPagesInput(e.target.value)}
                      placeholder="Contoh: 1,25"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Nilai Sah (0–100)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={verifyScoreInput}
                      onChange={e => setVerifyScoreInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Catatan Verifikasi Koordinator
                  </label>
                  <input
                    type="text"
                    value={verifyNote}
                    onChange={e => setVerifyNote(e.target.value)}
                    placeholder="Contoh: Disetujui 1,00 halaman baru setelah dikurangi irisan..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={verifying}
                    onClick={() => handleConfirmVerify('reject')}
                    className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold"
                  >
                    Tolak Setoran
                  </button>
                  <button
                    type="button"
                    disabled={verifying}
                    onClick={() => handleConfirmVerify('approve')}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Setujui Halaman Unik
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal Detail Perkembangan & Audit Santri */}
      {detailRow && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-gradient-to-r from-teal-800 to-emerald-900 text-white flex items-center justify-between">
              <div>
                <h4 className="text-base font-bold">{detailRow.studentName}</h4>
                <p className="text-xs text-emerald-100">
                  Kelas {detailRow.className} • {detailRow.halaqah} • NIS: {detailRow.nis}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailRow(null)}
                className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div className="text-slate-500">Total Halaman Unik</div>
                  <div className="text-lg font-extrabold text-emerald-900 font-mono mt-0.5">
                    {formatPagesIndo(detailRow.totalUniqueVerifiedPages)} Hal
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-teal-50 border border-teal-200">
                  <div className="text-slate-500">Rata-rata Nilai</div>
                  <div className="text-lg font-extrabold text-teal-900 font-mono mt-0.5">
                    {detailRow.averageScore !== null ? detailRow.averageScore.toFixed(2) : '-'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Kelengkapan Sesi</div>
                  <div className="text-lg font-extrabold text-slate-800 font-mono mt-0.5">
                    {detailRow.submittedSessionCount}/{detailRow.totalSessionsExpected}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-bold text-slate-800 uppercase tracking-wider">
                  Perkembangan Dari Sesi Pertama Sampai Terakhir
                </div>
                {detailRow.cells.map(c => (
                  <div
                    key={c.sessionId}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{c.sessionName}</div>
                      <div className="text-slate-600 mt-0.5">{c.rangeSummaryText}</div>
                      {c.examinerName && (
                        <div className="text-[11px] text-slate-400">Penguji: {c.examinerName}</div>
                      )}
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <div className="font-bold text-emerald-800">
                        {formatPagesIndo(c.confirmedPages)} Hal
                      </div>
                      <div className="text-slate-700">
                        Nilai: {c.score !== null ? c.score.toFixed(2) : '-'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Riwayat Audit Terkait Santri Ini */}
              {auditLogs.filter(a => a.studentId === detailRow.studentId).length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="font-bold text-slate-700 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Riwayat Audit Perubahan Setoran</span>
                  </div>
                  {auditLogs
                    .filter(a => a.studentId === detailRow.studentId)
                    .slice(0, 8)
                    .map(a => (
                      <div key={a.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px]">
                        <div className="flex justify-between font-semibold text-slate-800">
                          <span>{a.actionType}</span>
                          <span className="font-mono text-slate-400">
                            {new Date(a.createdAt).toLocaleString('id-ID')}
                          </span>
                        </div>
                        <div className="text-slate-500">
                          Oleh: {a.actorNameSnapshot} {a.reason ? `• Alasan: "${a.reason}"` : ''}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
