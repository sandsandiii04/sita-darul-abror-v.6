import React, { useEffect, useMemo, useState } from 'react';
import {
  User,
  ZiyadahAccelEvent,
  ZiyadahAccelEventMetrics,
  ZiyadahAccelFinalSnapshot,
  ZiyadahAccelSession,
  ZiyadahAccelStudentSummaryRow
} from '../../types';
import { LOGO_URL } from '../../constants';
import { formatPagesIndo } from '../../services/ziyadahAccelPageCalc';
import {
  buildReportGroups,
  downloadZiyadahCSV,
  downloadZiyadahExcel,
  downloadZiyadahWordDoc,
  formatFulfillmentStatusIndo,
  openZiyadahOfficialPrintPDF,
  ZiyadahReportFilterOptions,
  ZiyadahReportMode
} from '../../services/ziyadahAccelExportService';
import {
  Printer,
  FileSpreadsheet,
  FileText,
  Download,
  Lock,
  RotateCcw,
  ShieldCheck,
  Archive,
  Info
} from 'lucide-react';

interface ZiyadahAccelReportsViewProps {
  user: User;
  event: ZiyadahAccelEvent;
  liveMetrics: ZiyadahAccelEventMetrics;
  liveRows: ZiyadahAccelStudentSummaryRow[];
  sessions: ZiyadahAccelSession[];
  finalSnapshot?: ZiyadahAccelFinalSnapshot | null;
  onFinalizeEvent: (reason?: string) => Promise<void>;
  onReopenEvent: (reason: string) => Promise<void>;
}

export const ZiyadahAccelReportsView: React.FC<ZiyadahAccelReportsViewProps> = ({
  user,
  event,
  liveMetrics,
  liveRows,
  sessions,
  finalSnapshot,
  onFinalizeEvent,
  onReopenEvent
}) => {
  const isFinalized = event.status === 'finalized' && Boolean(finalSnapshot);
  const validSessions = useMemo(() => {
    if (
      isFinalized &&
      Array.isArray(finalSnapshot?.frozenSessionMatrix) &&
      finalSnapshot!.frozenSessionMatrix.length > 0
    ) {
      return [...finalSnapshot!.frozenSessionMatrix].sort(
        (a, b) => a.sessionNumber - b.sessionNumber
      );
    }
    return sessions
      .filter(s => s.status !== 'cancelled')
      .sort((a, b) => a.sessionNumber - b.sessionNumber);
  }, [isFinalized, finalSnapshot, sessions]);

  const [reportMode, setReportMode] = useState<ZiyadahReportMode>(
    isFinalized ? 'archive' : 'overall'
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string>(validSessions[0]?.id || '');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('ALL');
  const [selectedClass, setSelectedClass] = useState<string>('ALL');
  const [selectedHalaqah, setSelectedHalaqah] = useState<string>('ALL');
  const [processingLock, setProcessingLock] = useState(false);

  const effectiveMetrics: ZiyadahAccelEventMetrics =
    isFinalized && finalSnapshot?.frozenSummary ? finalSnapshot.frozenSummary : liveMetrics;
  const effectiveRows: ZiyadahAccelStudentSummaryRow[] =
    isFinalized && Array.isArray(finalSnapshot?.frozenStudentRows)
      ? finalSnapshot!.frozenStudentRows
      : liveRows;

  useEffect(() => {
    if (validSessions.length > 0 && !validSessions.some(s => s.id === selectedSessionId)) {
      setSelectedSessionId(validSessions[0].id);
    }
  }, [validSessions, selectedSessionId]);

  const distinctClasses = useMemo(
    () =>
      Array.from(new Set(effectiveRows.map(r => r.className || 'Tanpa Kelas'))).sort((a, b) =>
        a.localeCompare(b, 'id', { numeric: true })
      ),
    [effectiveRows]
  );

  const distinctHalaqahs = useMemo(
    () =>
      Array.from(new Set(effectiveRows.map(r => r.halaqah || 'Tanpa Halaqah'))).sort((a, b) =>
        a.localeCompare(b, 'id', { numeric: true })
      ),
    [effectiveRows]
  );

  const activeFilter = useMemo<ZiyadahReportFilterOptions>(
    () => ({
      mode: reportMode,
      selectedSessionId,
      selectedStudentId,
      selectedClass,
      selectedHalaqah
    }),
    [reportMode, selectedSessionId, selectedStudentId, selectedClass, selectedHalaqah]
  );

  // PERBAIKAN B-07: Pratinjau di layar menggunakan buildReportGroups yang SAMA PERSIS dengan PDF/Word/Excel/CSV!
  const previewGroups = useMemo(
    () => buildReportGroups(activeFilter, effectiveRows, validSessions),
    [activeFilter, effectiveRows, validSessions]
  );

  const targetSessionForPreview = useMemo(
    () =>
      reportMode === 'per_session'
        ? validSessions.find(s => s.id === selectedSessionId) || validSessions[0]
        : undefined,
    [reportMode, validSessions, selectedSessionId]
  );

  const printDateStr = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const signerNameDisplay =
    (event.signerName ?? '').trim() || '( ........................................ )';
  const signerTitleDisplay =
    (event.signerTitle ?? '').trim() ||
    "Bagian Tahsin & Tahfidz Al Qur'an Ma'had Darul Abror Islamic Boarding School";

  return (
    <div className="space-y-5">
      {/* Bar Kontrol Jenis Laporan, Filter, Ekspor, & Finalisasi */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              <span>Pusat Laporan Resmi &amp; Arsip Ziyadah Akselerasi</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Seluruh pratinjau layar dan isi file ekspor mengikuti filter mode, sesi, santri, kelas, atau halaqah yang dipilih.
            </p>
          </div>

          {/* Tombol Ekspor Resmi */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={previewGroups.length === 0}
              onClick={() =>
                openZiyadahOfficialPrintPDF({
                  filter: activeFilter,
                  event,
                  metrics: effectiveMetrics,
                  sessions: validSessions,
                  rows: effectiveRows
                })
              }
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm"
            >
              <Printer className="w-3.5 h-3.5" /> Cetak / PDF Resmi
            </button>

            <button
              type="button"
              disabled={previewGroups.length === 0}
              onClick={() =>
                downloadZiyadahWordDoc({
                  filter: activeFilter,
                  event,
                  metrics: effectiveMetrics,
                  sessions: validSessions,
                  rows: effectiveRows
                })
              }
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm"
            >
              <FileText className="w-3.5 h-3.5" /> Word (.doc)
            </button>

            <button
              type="button"
              disabled={previewGroups.length === 0}
              onClick={() =>
                downloadZiyadahExcel({
                  filter: activeFilter,
                  event,
                  metrics: effectiveMetrics,
                  sessions: validSessions,
                  rows: effectiveRows
                })
              }
              className="px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> Excel (.xls)
            </button>

            <button
              type="button"
              disabled={previewGroups.length === 0}
              onClick={() =>
                downloadZiyadahCSV({
                  filter: activeFilter,
                  event,
                  sessions: validSessions,
                  rows: effectiveRows
                })
              }
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-bold flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" /> CSV (UTF-8)
            </button>
          </div>
        </div>

        {/* Pilihan 6 Jenis Laporan + Sub-Filter Spesifik + Tombol Finalisasi / Reopen */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(
              [
                ['overall', '1. Keseluruhan'],
                ['per_session', '2. Per Sesi'],
                ['per_student', '3. Per Santri'],
                ['per_class', '4. Per Kelas'],
                ['per_halaqah', '5. Per Halaqah'],
                ['archive', '6. Arsip Finalized']
              ] as const
            ).map(([code, label]) => (
              <button
                key={code}
                type="button"
                onClick={() => setReportMode(code)}
                className={`px-3 py-1.5 rounded-xl font-bold transition ${
                  reportMode === code
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}

            {reportMode === 'per_session' && (
              <select
                value={selectedSessionId}
                onChange={e => setSelectedSessionId(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white font-semibold"
              >
                {validSessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.sessionDate})
                  </option>
                ))}
              </select>
            )}

            {reportMode === 'per_student' && (
              <select
                value={selectedStudentId}
                onChange={e => setSelectedStudentId(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white font-semibold max-w-[230px]"
              >
                <option value="ALL">Semua Santri (Per Kartu)</option>
                {effectiveRows.map(r => (
                  <option key={r.studentId} value={r.studentId}>
                    {r.studentName} ({r.className})
                  </option>
                ))}
              </select>
            )}

            {reportMode === 'per_class' && (
              <select
                value={selectedClass}
                onChange={e => setSelectedClass(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white font-semibold"
              >
                <option value="ALL">Semua Kelas</option>
                {distinctClasses.map(c => (
                  <option key={c} value={c}>
                    Kelas {c}
                  </option>
                ))}
              </select>
            )}

            {reportMode === 'per_halaqah' && (
              <select
                value={selectedHalaqah}
                onChange={e => setSelectedHalaqah(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white font-semibold"
              >
                <option value="ALL">Semua Halaqah</option>
                {distinctHalaqahs.map(h => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            {event.status !== 'finalized' ? (
              <button
                type="button"
                disabled={processingLock || effectiveRows.length === 0}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Finalisasi kegiatan "${event.name}" sekarang?\n\nPastikan seluruh sesi telah ditutup (Closed) dan tidak ada verifikasi tertunda. Seluruh nilai, ayat, halaman, dan snapshot kelas/halaqah akan dikunci secara otoritatif.`
                    )
                  ) {
                    return;
                  }
                  setProcessingLock(true);
                  try {
                    await onFinalizeEvent('Finalisasi resmi laporan akhir kegiatan');
                  } finally {
                    setProcessingLock(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm"
              >
                <Lock className="w-3.5 h-3.5" /> Finalisasi &amp; Kunci Arsip
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-bold">
                  <Archive className="w-3.5 h-3.5" /> Terfinalisasi (Snapshot Immutable Aktif)
                </span>
                {user.role === 'admin' && (
                  <button
                    type="button"
                    disabled={processingLock}
                    onClick={async () => {
                      const reason = window.prompt(
                        'Masukkan alasan resmi pembukaan kembali (reopen) kegiatan terfinalisasi untuk audit log:'
                      );
                      if (!reason || !reason.trim()) return;
                      setProcessingLock(true);
                      try {
                        await onReopenEvent(reason.trim());
                      } finally {
                        setProcessingLock(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Buka Kembali (Admin)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Informasi Teknis Jujur Format Ekspor SITA (Keputusan Admin A.3) */}
        <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
          <span>
            <strong>Catatan Format File:</strong> Sama seperti modul UAS SITA, ekspor <code>.xls</code> menggunakan standar ringan <em>Microsoft Office XML SpreadsheetML</em> (multi-sheet siap edit; pilih <em>Yes</em> bila MS Excel mengonfirmasi ekstensi) dan <code>.doc</code> menggunakan <em>Word-HTML A4 Portrait</em>. Untuk hasil cetak permanen ber-kop utuh, gunakan tombol <strong>Cetak / PDF Resmi</strong>. Nama penandatangan diatur melalui ikon ⚙️ Pengaturan Kegiatan.
          </span>
        </div>
      </div>

      {isFinalized && finalSnapshot && (
        <div className="max-w-5xl mx-auto p-3.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-900 text-xs flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
          <span>
            Menampilkan data arsip terfinalisasi yang telah diverifikasi server (Snapshot v{finalSnapshot.snapshotVersion}{' '}
            oleh <strong>{finalSnapshot.finalizedByName}</strong> pada{' '}
            {new Date(finalSnapshot.finalizedAt).toLocaleString('id-ID')}).
          </span>
        </div>
      )}

      {/* Pratinjau Dokumen Resmi Ber-Kop Darul Abror (Sinkron Penuh dengan Mode & Filter!) */}
      <div className="space-y-6 max-w-5xl mx-auto">
        {previewGroups.length === 0 ? (
          <div className="bg-white p-10 rounded-2xl border border-slate-200 text-center text-xs text-slate-400">
            Tidak ada data peserta yang cocok dengan filter laporan saat ini.
          </div>
        ) : (
          previewGroups.map((grp, grpIdx) => (
            <div
              key={`${grp.groupTitle}_${grpIdx}`}
              className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-5"
            >
              {/* Kop Surat Resmi */}
              <div className="flex items-center justify-between border-b-4 border-double border-slate-900 pb-4">
                <img
                  src={LOGO_URL}
                  alt="Logo Darul Abror"
                  className="w-16 h-16 object-contain"
                />
                <div className="text-center flex-1 px-4">
                  <h2 className="font-serif text-lg sm:text-xl font-extrabold text-slate-900 tracking-wide">
                    PONDOK PESANTREN DARUL ABROR IBS
                  </h2>
                  <p className="text-xs sm:text-sm font-bold text-emerald-700 mt-0.5">
                    BAGIAN TAHSIN &amp; TAHFIDZ AL QUR&apos;AN
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151
                  </p>
                </div>
                <div className="w-16" />
              </div>

              {/* Judul & Subtotal Spesifik Grup */}
              <div className="text-center space-y-1">
                <h3 className="text-sm sm:text-base font-extrabold underline uppercase text-slate-900">
                  LAPORAN HASIL {event.name}
                </h3>
                <p className="text-xs font-bold text-slate-700">
                  {grp.groupTitle} {grp.groupSubtitle ? `• ${grp.groupSubtitle}` : ''}
                </p>
                <p className="text-xs text-slate-600">
                  Tahun Ajaran <strong>{event.academicYear}</strong> (Semester{' '}
                  {event.semester === 'ganjil' ? 'Ganjil' : 'Genap'}) • Pelaksanaan:{' '}
                  <strong>
                    {event.startDate} s.d. {event.endDate}
                  </strong>
                </p>
                <div className="inline-flex flex-wrap items-center justify-center gap-3 text-xs bg-emerald-50/70 border border-emerald-200 px-4 py-1.5 rounded-full text-emerald-950 font-semibold mt-1">
                  <span>Peserta Bagian Ini: {grp.groupParticipantCount} Santri</span>
                  <span>•</span>
                  <span>
                    Total Ziyadah Unik: {formatPagesIndo(grp.groupTotalUniquePages)} Halaman
                  </span>
                  <span>•</span>
                  <span>
                    Rata-rata Nilai:{' '}
                    {grp.groupAverageScore !== null ? grp.groupAverageScore.toFixed(2) : '-'}
                  </span>
                </div>
              </div>

              {/* Tabel Dinamis Sesuai Mode Laporan */}
              <div className="overflow-x-auto">
                {reportMode === 'per_session' && targetSessionForPreview ? (
                  <table className="w-full text-xs border-collapse border border-slate-300">
                    <thead>
                      <tr className="bg-emerald-800 text-white font-bold text-center">
                        <th className="border border-emerald-900 py-2.5 px-2 w-10">No</th>
                        <th className="border border-emerald-900 py-2.5 px-3 text-left">
                          Nama Lengkap Santri
                        </th>
                        <th className="border border-emerald-900 py-2.5 px-2 w-16">Kelas</th>
                        <th className="border border-emerald-900 py-2.5 px-3 text-left">
                          Surah dan Ayat ({targetSessionForPreview.name})
                        </th>
                        <th className="border border-emerald-900 py-2.5 px-2 w-24">Halaman</th>
                        <th className="border border-emerald-900 py-2.5 px-2 w-20">Nilai Sesi</th>
                        <th className="border border-emerald-900 py-2.5 px-2 w-28">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grp.rows.map((r, idx) => {
                        const cell = r.cells.find(
                          c => c.sessionId === targetSessionForPreview.id
                        );
                        return (
                          <tr key={r.participantId} className="even:bg-slate-50">
                            <td className="border border-slate-300 py-2 px-2 text-center font-mono">
                              {idx + 1}
                            </td>
                            <td className="border border-slate-300 py-2 px-3 font-bold text-slate-900">
                              {r.studentName}
                            </td>
                            <td className="border border-slate-300 py-2 px-2 text-center font-semibold">
                              {r.className}
                            </td>
                            <td className="border border-slate-300 py-2 px-3 text-[11px]">
                              {cell?.rangeSummaryText || '-'}
                            </td>
                            <td className="border border-slate-300 py-2 px-2 text-center font-mono font-bold text-emerald-900">
                              {formatPagesIndo(cell?.confirmedPages ?? null)}
                            </td>
                            <td className="border border-slate-300 py-2 px-2 text-center font-mono font-extrabold text-slate-900">
                              {cell?.score !== null && cell?.score !== undefined
                                ? cell.score.toFixed(2)
                                : '-'}
                            </td>
                            <td className="border border-slate-300 py-2 px-2 text-center text-[11px] font-semibold">
                              {formatFulfillmentStatusIndo(
                                cell?.fulfillmentStatus,
                                cell?.verificationStatus
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : reportMode === 'per_student' && grp.rows[0] ? (
                  <table className="w-full text-xs border-collapse border border-slate-300">
                    <thead>
                      <tr className="bg-emerald-800 text-white font-bold text-center">
                        <th className="border border-emerald-900 py-2.5 px-2 w-10">No</th>
                        <th className="border border-emerald-900 py-2.5 px-3 text-left w-32">
                          Sesi
                        </th>
                        <th className="border border-emerald-900 py-2.5 px-3 text-left">
                          Rincian Surah dan Ayat
                        </th>
                        <th className="border border-emerald-900 py-2.5 px-2 w-24">Halaman</th>
                        <th className="border border-emerald-900 py-2.5 px-2 w-24">Nilai</th>
                        <th className="border border-emerald-900 py-2.5 px-3 text-left w-36">
                          Penguji
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {grp.rows[0].cells.map((c, idx) => (
                        <tr key={c.sessionId} className="even:bg-slate-50">
                          <td className="border border-slate-300 py-2 px-2 text-center font-mono">
                            {idx + 1}
                          </td>
                          <td className="border border-slate-300 py-2 px-3 font-bold text-slate-900">
                            {c.sessionName}
                          </td>
                          <td className="border border-slate-300 py-2 px-3 text-[11px]">
                            {c.rangeSummaryText}
                          </td>
                          <td className="border border-slate-300 py-2 px-2 text-center font-mono font-bold text-emerald-900">
                            {formatPagesIndo(c.confirmedPages)}
                          </td>
                          <td className="border border-slate-300 py-2 px-2 text-center font-mono font-extrabold text-slate-900">
                            {c.score !== null ? c.score.toFixed(2) : '-'}
                          </td>
                          <td className="border border-slate-300 py-2 px-3 text-[11px]">
                            {c.examinerName || '-'}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-emerald-50 font-extrabold">
                        <td
                          colSpan={3}
                          className="border border-slate-300 py-2 px-3 text-right text-emerald-950"
                        >
                          TOTAL HALAMAN UNIK &amp; RATA-RATA ({grp.rows[0].scoredSessionCount}/
                          {grp.rows[0].totalSessionsExpected} Sesi)
                        </td>
                        <td className="border border-slate-300 py-2 px-2 text-center font-mono text-emerald-900">
                          {formatPagesIndo(grp.rows[0].totalUniqueVerifiedPages)} Hal
                        </td>
                        <td className="border border-slate-300 py-2 px-2 text-center font-mono text-slate-900">
                          {grp.rows[0].averageScore !== null
                            ? grp.rows[0].averageScore.toFixed(2)
                            : '-'}
                        </td>
                        <td className="border border-slate-300 py-2 px-3 text-center text-[11px]">
                          {grp.rows[0].submittedSessionCount}/{grp.rows[0].totalSessionsExpected}{' '}
                          Sesi
                        </td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-xs border-collapse border border-slate-300">
                    <thead>
                      <tr className="bg-emerald-800 text-white font-bold text-center">
                        <th className="border border-emerald-900 py-2.5 px-2 w-10">No</th>
                        <th className="border border-emerald-900 py-2.5 px-3 text-left">
                          Nama Lengkap Santri
                        </th>
                        <th className="border border-emerald-900 py-2.5 px-2 w-16">Kelas</th>
                        <th className="border border-emerald-900 py-2.5 px-3 text-left">
                          Surah dan Ayat
                        </th>
                        <th className="border border-emerald-900 py-2.5 px-2 w-28">
                          Jumlah Halaman
                        </th>
                        <th className="border border-emerald-900 py-2.5 px-2 w-28">
                          Nilai Rata-rata
                        </th>
                        <th className="border border-emerald-900 py-2.5 px-2 w-28">Kelengkapan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grp.rows.map((r, idx) => (
                        <tr key={r.participantId} className="even:bg-slate-50">
                          <td className="border border-slate-300 py-2 px-2 text-center font-mono">
                            {idx + 1}
                          </td>
                          <td className="border border-slate-300 py-2 px-3 font-bold text-slate-900">
                            {r.studentName}
                          </td>
                          <td className="border border-slate-300 py-2 px-2 text-center font-semibold">
                            {r.className}
                          </td>
                          <td className="border border-slate-300 py-2 px-3 text-[11px] leading-relaxed">
                            {r.combinedRangesText}
                          </td>
                          <td className="border border-slate-300 py-2 px-2 text-center font-mono font-bold text-emerald-900">
                            {formatPagesIndo(r.totalUniqueVerifiedPages)}
                          </td>
                          <td className="border border-slate-300 py-2 px-2 text-center font-mono font-extrabold text-slate-900">
                            {r.averageScore !== null ? r.averageScore.toFixed(2) : '-'}
                          </td>
                          <td className="border border-slate-300 py-2 px-2 text-center text-[11px]">
                            {r.submittedSessionCount}/{r.totalSessionsExpected} Sesi
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Blok Tanda Tangan Resmi (Mengikuti Konfigurasi Admin) */}
              <div className="flex justify-end pt-4">
                <div className="w-72 text-center text-xs text-slate-900 space-y-1">
                  <div>
                    {event.signerCity || 'Garut'}, {printDateStr}
                  </div>
                  <div className="font-bold leading-snug">{signerTitleDisplay}</div>
                  <div className="h-14" />
                  <div className="font-extrabold underline">{signerNameDisplay}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
