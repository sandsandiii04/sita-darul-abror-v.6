import React, { useMemo, useState } from 'react';
import { ExaminerStudentItem } from '../../types';
import { LOGO_URL } from '../../constants';
import {
  computeStudentUASRecapSummary,
  StudentUASRecapSummary,
  UASRecapSessionLike
} from '../../services/examRecapExportService';
import { Printer, Users, ClipboardList, X } from 'lucide-react';

interface UASRecapPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  periodName: string;
  kkm: number;
  students: ExaminerStudentItem[];
  sessionsByStudent: Map<string, UASRecapSessionLike[]>;
}

type PrintAudience = 'student_board' | 'teacher_halaqah';
type StudentGrouping = 'by_class' | 'by_halaqah' | 'combined';

interface PrintPageGroup {
  title: string;
  subtitle?: string;
  rows: Array<{ student: ExaminerStudentItem; summary: StudentUASRecapSummary }>;
}

function escapeHtml(val: string): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const UASRecapPrintModal: React.FC<UASRecapPrintModalProps> = ({
  isOpen,
  onClose,
  periodName,
  kkm,
  students,
  sessionsByStudent
}) => {
  const [audience, setAudience] = useState<PrintAudience>('student_board');
  const [studentGrouping, setStudentGrouping] = useState<StudentGrouping>('by_class');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('ALL');

  const enriched = useMemo(() => {
    return [...students]
      .sort((a, b) => (a.studentName || '').localeCompare(b.studentName || '', 'id'))
      .map(student => ({
        student,
        summary: computeStudentUASRecapSummary(student, sessionsByStudent.get(student.studentId), kkm)
      }));
  }, [students, sessionsByStudent, kkm]);

  const effectiveGrouping: StudentGrouping =
    audience === 'teacher_halaqah' ? 'by_halaqah' : studentGrouping;

  const availableFilterValues = useMemo(() => {
    if (effectiveGrouping === 'combined') return [];
    const set = new Set<string>();
    enriched.forEach(({ student }) => {
      const key =
        effectiveGrouping === 'by_class'
          ? (student.class || 'Tanpa Kelas').trim()
          : (student.halaqah || 'Tanpa Halaqah').trim();
      set.add(key);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'id'));
  }, [enriched, effectiveGrouping]);

  const pageGroups = useMemo<PrintPageGroup[]>(() => {
    if (effectiveGrouping === 'combined') {
      return [
        {
          title: 'Daftar Seluruh Santri',
          rows: enriched
        }
      ];
    }

    const map = new Map<string, Array<{ student: ExaminerStudentItem; summary: StudentUASRecapSummary }>>();
    enriched.forEach(item => {
      const key =
        effectiveGrouping === 'by_class'
          ? (item.student.class || 'Tanpa Kelas').trim()
          : (item.student.halaqah || 'Tanpa Halaqah').trim();
      if (selectedGroupFilter !== 'ALL' && key !== selectedGroupFilter) return;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'id'))
      .map(([key, rows]) => {
        const teacherName = rows.find(r => r.student.teacherName)?.student.teacherName;
        return {
          title: effectiveGrouping === 'by_class' ? `Kelas ${key}` : key,
          subtitle:
            effectiveGrouping === 'by_halaqah' && teacherName
              ? `Pembimbing: ${teacherName}`
              : undefined,
          rows
        };
      });
  }, [enriched, effectiveGrouping, selectedGroupFilter]);

  if (!isOpen) return null;

  const dateText = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const handlePrintNow = () => {
    const win = window.open('', '_blank', 'width=1024,height=768');
    if (!win) {
      alert('Pop-up diblokir browser. Izinkan pop-up untuk mencetak / menyimpan PDF.');
      return;
    }

    const docHeading =
      audience === 'student_board'
        ? 'PENGUMUMAN HASIL UJIAN AKHIR SEMESTER (UAS) TAHFIZ AL-QUR&#39;AN'
        : 'REKAPITULASI HASIL UJIAN AKHIR SEMESTER (UAS) PER HALAQAH';

    const pagesHtml = pageGroups
      .map((grp, gIdx) => {
        const passedCount = grp.rows.filter(r => r.summary.statusCategory === 'PASSED').length;
        const failedCount = grp.rows.filter(r => r.summary.statusCategory === 'FAILED').length;
        const validScores = grp.rows
          .map(r => r.summary.averageScore)
          .filter((v): v is number => v !== null && !Number.isNaN(v));
        const avgStr =
          validScores.length > 0
            ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(2)
            : '-';

        const tableHead =
          audience === 'student_board'
            ? `<tr>
                <th style="width:32px;">No</th>
                <th style="text-align:left;">Nama Santri</th>
                <th style="width:55px;">Kelas</th>
                <th style="width:95px;">Halaqah</th>
                <th style="text-align:left;">Materi &amp; Nilai Per Sesi</th>
                <th style="width:68px;">Rata-rata</th>
                <th style="width:95px;">Keterangan</th>
              </tr>`
            : `<tr>
                <th style="width:30px;">No</th>
                <th style="width:65px;">NIS</th>
                <th style="text-align:left;">Nama Santri</th>
                <th style="width:50px;">Kelas</th>
                <th style="text-align:left;">Materi &amp; Nilai Per Sesi</th>
                <th style="text-align:left;">Penguji Aktual</th>
                <th style="width:62px;">Rata-rata</th>
                <th style="width:90px;">Status</th>
              </tr>`;

        const tableBody = grp.rows
          .map(({ student, summary }, rIdx) => {
            const badgeClass =
              summary.statusCategory === 'PASSED'
                ? 'badge-pass'
                : summary.statusCategory === 'FAILED'
                  ? 'badge-fail'
                  : 'badge-wait';
            const ketText =
              summary.statusCategory === 'PASSED'
                ? 'LULUS'
                : summary.statusCategory === 'FAILED'
                  ? 'REMEDIAL'
                  : summary.statusText;
            const avgDisplay = summary.averageScore !== null ? summary.averageScore.toFixed(2) : '-';

            if (audience === 'student_board') {
              return `<tr>
                <td class="center">${rIdx + 1}</td>
                <td class="bold">${escapeHtml(student.studentName)}</td>
                <td class="center">${escapeHtml(student.class || '-')}</td>
                <td class="center">${escapeHtml(student.halaqah || '-')}</td>
                <td>${escapeHtml(summary.materialSummary)}</td>
                <td class="center bold">${avgDisplay}</td>
                <td class="center"><span class="badge ${badgeClass}">${escapeHtml(ketText)}</span></td>
              </tr>`;
            }

            return `<tr>
              <td class="center">${rIdx + 1}</td>
              <td class="center">${escapeHtml(student.studentNis || '-')}</td>
              <td class="bold">${escapeHtml(student.studentName)}</td>
              <td class="center">${escapeHtml(student.class || '-')}</td>
              <td>${escapeHtml(summary.materialSummary)}</td>
              <td>${escapeHtml(summary.examinerSummary)}</td>
              <td class="center bold">${avgDisplay}</td>
              <td class="center"><span class="badge ${badgeClass}">${escapeHtml(summary.statusText)}</span></td>
            </tr>`;
          })
          .join('');

        return `
        <section class="print-page ${gIdx < pageGroups.length - 1 ? 'page-break' : ''}">
          <header class="kop">
            <img src="${LOGO_URL}" alt="Logo" class="kop-logo" onerror="this.style.display='none'" />
            <div class="kop-text">
              <div class="kop-title">PONDOK PESANTREN DARUL ABROR IBS</div>
              <div class="kop-sub">BAGIAN TAHSIN &amp; TAHFIDZ AL QUR&#39;AN</div>
              <div class="kop-addr">Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151</div>
            </div>
            <div class="kop-spacer"></div>
          </header>

          <div class="doc-title-block">
            <div class="doc-title">${docHeading}</div>
            <div class="doc-meta">
              <strong>${escapeHtml(grp.title)}</strong>${grp.subtitle ? ` &bull; ${escapeHtml(grp.subtitle)}` : ''} &bull; Periode: ${escapeHtml(periodName)} &bull; KKM: ${kkm}
            </div>
            ${
              audience === 'teacher_halaqah'
                ? `<div class="doc-summary">Total Santri: <strong>${grp.rows.length}</strong> &bull; Lulus: <strong>${passedCount}</strong> &bull; Belum Tuntas/Remedial: <strong>${failedCount}</strong> &bull; Rata-rata: <strong>${avgStr}</strong></div>`
                : ''
            }
          </div>

          <table>
            <thead>${tableHead}</thead>
            <tbody>${tableBody}</tbody>
          </table>

          <div class="signature-wrap">
            <div class="signature-box">
              <div>Garut, ${escapeHtml(dateText)}</div>
              <div class="sig-role">Bagian Tahsin &amp; Tahfidz Al Qur&#39;an</div>
              <div class="sig-org">Ma&#39;had Darul Abror Islamic Boarding School</div>
              <div class="sig-space"></div>
              <div class="sig-name">Parhan Mubarok, S.Ag</div>
            </div>
          </div>
        </section>`;
      })
      .join('');

    win.document.open();
    win.document.write(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <title>Hasil UAS Tahfiz - Darul Abror IBS</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; color: #0f172a; margin: 0; padding: 0; font-size: 11px; }
    .print-page { width: 100%; }
    .page-break { page-break-after: always; break-after: page; }
    .kop { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 3px double #0f172a; padding-bottom: 8px; margin-bottom: 12px; }
    .kop-logo { width: 58px; height: 58px; object-fit: contain; flex-shrink: 0; }
    .kop-spacer { width: 58px; flex-shrink: 0; }
    .kop-text { flex: 1; text-align: center; }
    .kop-title { font-family: Georgia, 'Times New Roman', serif; font-size: 16px; font-weight: 800; letter-spacing: 1px; color: #0f172a; }
    .kop-sub { font-size: 12px; font-weight: 700; color: #065f46; margin-top: 2px; letter-spacing: 0.4px; }
    .kop-addr { font-size: 9.5px; color: #475569; margin-top: 2px; }
    .doc-title-block { text-align: center; margin-bottom: 10px; }
    .doc-title { font-size: 13px; font-weight: 800; text-decoration: underline; text-underline-offset: 3px; }
    .doc-meta { font-size: 10.5px; color: #334155; margin-top: 4px; }
    .doc-summary { font-size: 10px; color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; display: inline-block; padding: 3px 10px; border-radius: 6px; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10px; }
    th, td { border: 1px solid #94a3b8; padding: 4px 6px; vertical-align: middle; }
    th { background: #065f46; color: #ffffff; font-weight: 700; text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tbody tr:nth-child(even) { background: #f8fafc; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .badge { display: inline-block; padding: 1.5px 6px; border-radius: 4px; font-size: 9px; font-weight: 800; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .badge-pass { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
    .badge-fail { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    .badge-wait { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
    .signature-wrap { display: flex; justify-content: flex-end; margin-top: 18px; page-break-inside: avoid; break-inside: avoid; }
    .signature-box { width: 250px; text-align: center; font-size: 10.5px; line-height: 1.4; }
    .sig-role { font-weight: 700; margin-top: 2px; }
    .sig-org { font-size: 10px; color: #334155; }
    .sig-space { height: 54px; }
    .sig-name { font-weight: 800; text-decoration: underline; text-underline-offset: 3px; font-size: 11px; }
  </style>
</head>
<body>
  ${pagesHtml}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 250);
    };
  </script>
</body>
</html>`);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-emerald-700 to-teal-700 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-white/15 shrink-0">
              <Printer size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="font-extrabold text-sm sm:text-base truncate">
                Cetak / Simpan PDF Hasil UAS (Kop Resmi Tahfiz)
              </h3>
              <p className="text-[11px] text-emerald-100 truncate">
                Siap tempel untuk Santri maupun share per Halaqah ke Guru Halaqah.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/15 text-white/90"
          >
            <X size={18} />
          </button>
        </div>

        {/* Controls */}
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                setAudience('student_board');
                setSelectedGroupFilter('ALL');
              }}
              className={`p-3 rounded-2xl border text-left transition-all flex items-start gap-2.5 ${
                audience === 'student_board'
                  ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <ClipboardList size={18} className="text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-extrabold text-slate-900">Pengumuman Ditempel (Untuk Santri)</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  NIS &amp; nama Penguji disembunyikan agar ringkas &amp; rapi untuk mading.
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setAudience('teacher_halaqah');
                setSelectedGroupFilter('ALL');
              }}
              className={`p-3 rounded-2xl border text-left transition-all flex items-start gap-2.5 ${
                audience === 'teacher_halaqah'
                  ? 'bg-teal-50 border-teal-600 ring-1 ring-teal-600'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <Users size={18} className="text-teal-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-extrabold text-slate-900">Rekap Per Halaqah (Share ke Guru)</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  1 halaman = 1 Halaqah lengkap dengan NIS, Penguji Aktual &amp; ringkasan lulus.
                </div>
              </div>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {audience === 'student_board' && (
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-600">Kelompokkan:</span>
                <select
                  value={studentGrouping}
                  onChange={e => {
                    setStudentGrouping(e.target.value as StudentGrouping);
                    setSelectedGroupFilter('ALL');
                  }}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-semibold text-slate-800"
                >
                  <option value="by_class">Per Kelas (1 Halaman / Kelas)</option>
                  <option value="by_halaqah">Per Halaqah (1 Halaman / Halaqah)</option>
                  <option value="combined">Gabungan (Semua Santri)</option>
                </select>
              </div>
            )}

            {effectiveGrouping !== 'combined' && availableFilterValues.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-slate-600">
                  Pilih {effectiveGrouping === 'by_class' ? 'Kelas' : 'Halaqah'}:
                </span>
                <select
                  value={selectedGroupFilter}
                  onChange={e => setSelectedGroupFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-semibold text-slate-800"
                >
                  <option value="ALL">
                    Semua ({availableFilterValues.length} {effectiveGrouping === 'by_class' ? 'Kelas' : 'Halaqah'})
                  </option>
                  {availableFilterValues.map(v => (
                    <option key={v} value={v}>
                      {effectiveGrouping === 'by_class' ? `Kelas ${v}` : v}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <span className="ml-auto text-[11px] font-bold text-teal-800">
              Total: {pageGroups.length} lembar cetak
            </span>
          </div>
        </div>

        {/* Live Preview of First Page */}
        <div className="flex-1 overflow-y-auto p-5 bg-slate-100/80">
          {pageGroups.length === 0 ? (
            <div className="p-8 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
              Tidak ada data santri untuk dicetak.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-300 shadow-sm p-6 max-w-3xl mx-auto space-y-4">
              {/* Preview Kop */}
              <div className="border-b-4 border-double border-slate-900 pb-3 flex items-center justify-between gap-3">
                <img
                  src={LOGO_URL}
                  alt="Logo Darul Abror IBS"
                  className="w-14 h-14 object-contain shrink-0"
                />
                <div className="flex-1 text-center">
                  <div className="font-serif font-extrabold text-base sm:text-lg tracking-wider text-slate-950">
                    PONDOK PESANTREN DARUL ABROR IBS
                  </div>
                  <div className="font-bold text-xs text-emerald-800">
                    BAGIAN TAHSIN &amp; TAHFIDZ AL QUR&apos;AN
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151
                  </div>
                </div>
                <div className="w-14 shrink-0" />
              </div>

              <div className="text-center">
                <div className="font-extrabold text-xs sm:text-sm underline underline-offset-4 text-slate-900">
                  {audience === 'student_board'
                    ? "PENGUMUMAN HASIL UJIAN AKHIR SEMESTER (UAS) TAHFIZ AL-QUR'AN"
                    : 'REKAPITULASI HASIL UJIAN AKHIR SEMESTER (UAS) PER HALAQAH'}
                </div>
                <div className="text-[11px] text-slate-600 mt-1">
                  <strong>{pageGroups[0].title}</strong>
                  {pageGroups[0].subtitle ? ` • ${pageGroups[0].subtitle}` : ''} • {periodName} • KKM: {kkm}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[11px] border-collapse border border-slate-300">
                  <thead>
                    <tr className="bg-emerald-800 text-white">
                      <th className="border border-slate-300 px-2 py-1.5">No</th>
                      {audience === 'teacher_halaqah' && (
                        <th className="border border-slate-300 px-2 py-1.5">NIS</th>
                      )}
                      <th className="border border-slate-300 px-2 py-1.5 text-left">Nama Santri</th>
                      <th className="border border-slate-300 px-2 py-1.5">Kelas</th>
                      {audience === 'student_board' && (
                        <th className="border border-slate-300 px-2 py-1.5">Halaqah</th>
                      )}
                      <th className="border border-slate-300 px-2 py-1.5 text-left">Materi &amp; Nilai Per Sesi</th>
                      {audience === 'teacher_halaqah' && (
                        <th className="border border-slate-300 px-2 py-1.5 text-left">Penguji Aktual</th>
                      )}
                      <th className="border border-slate-300 px-2 py-1.5">Rata-rata</th>
                      <th className="border border-slate-300 px-2 py-1.5">
                        {audience === 'student_board' ? 'Keterangan' : 'Status'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageGroups[0].rows.slice(0, 8).map(({ student, summary }, i) => (
                      <tr key={student.studentId} className={i % 2 === 1 ? 'bg-slate-50' : ''}>
                        <td className="border border-slate-300 px-2 py-1 text-center">{i + 1}</td>
                        {audience === 'teacher_halaqah' && (
                          <td className="border border-slate-300 px-2 py-1 text-center">{student.studentNis || '-'}</td>
                        )}
                        <td className="border border-slate-300 px-2 py-1 font-bold text-slate-900">{student.studentName}</td>
                        <td className="border border-slate-300 px-2 py-1 text-center">{student.class || '-'}</td>
                        {audience === 'student_board' && (
                          <td className="border border-slate-300 px-2 py-1 text-center">{student.halaqah || '-'}</td>
                        )}
                        <td className="border border-slate-300 px-2 py-1">{summary.materialSummary}</td>
                        {audience === 'teacher_halaqah' && (
                          <td className="border border-slate-300 px-2 py-1">{summary.examinerSummary}</td>
                        )}
                        <td className="border border-slate-300 px-2 py-1 text-center font-bold">
                          {summary.averageScore !== null ? summary.averageScore.toFixed(2) : '-'}
                        </td>
                        <td className="border border-slate-300 px-2 py-1 text-center font-bold">
                          {audience === 'student_board'
                            ? summary.statusCategory === 'PASSED'
                              ? 'LULUS'
                              : summary.statusCategory === 'FAILED'
                                ? 'REMEDIAL'
                                : summary.statusText
                            : summary.statusText}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pageGroups[0].rows.length > 8 && (
                  <div className="text-center text-[10px] text-slate-400 italic mt-1">
                    ... menampilkan 8 dari {pageGroups[0].rows.length} santri pada pratinjau lembar 1 (semua {pageGroups.length} lembar tercetak lengkap).
                  </div>
                )}
              </div>

              {/* Preview Tanda Tangan */}
              <div className="flex justify-end pt-3">
                <div className="w-64 text-center text-[11px] leading-snug">
                  <div>Garut, {dateText}</div>
                  <div className="font-bold mt-0.5">Bagian Tahsin &amp; Tahfidz Al Qur&apos;an</div>
                  <div className="text-[10px] text-slate-600">Ma&apos;had Darul Abror Islamic Boarding School</div>
                  <div className="h-12" />
                  <div className="font-extrabold underline underline-offset-4 text-slate-950">
                    Parhan Mubarok, S.Ag
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            Tips: Pada dialog cetak, pilih <strong>Save as PDF</strong> untuk dibagikan via WhatsApp ke Guru Halaqah.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold"
            >
              Tutup
            </button>
            <button
              type="button"
              disabled={pageGroups.length === 0}
              onClick={handlePrintNow}
              className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Printer size={14} />
              <span>Cetak / Simpan PDF ({pageGroups.length} Lembar)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
