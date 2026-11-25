import React, { useMemo, useState } from 'react';
import { ExaminerStudentItem } from '../../types';
import { LOGO_URL } from '../../constants';
import {
  computeStudentUASRecapSummary,
  StudentUASRecapSummary,
  UASRecapSessionLike
} from '../../services/examRecapExportService';
import { Printer, Users, ClipboardList, X, FileText, FileSpreadsheet } from 'lucide-react';

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

function escapeXml(val: string): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeSheetName(raw: string, used: Set<string>): string {
  const cleaned = String(raw || 'Sheet')
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28) || 'Sheet';
  let candidate = cleaned;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${cleaned.slice(0, 25)}_${counter}`;
    counter++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function sanitizeFileSlug(raw: string): string {
  return String(raw || '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
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

  const buildFileBaseName = () => {
    const modeTag = audience === 'student_board' ? 'Pengumuman_UAS_Santri' : 'Rekap_UAS_Guru';
    const scopeTag =
      selectedGroupFilter !== 'ALL'
        ? sanitizeFileSlug(selectedGroupFilter)
        : effectiveGrouping === 'by_class'
          ? 'Per_Kelas'
          : effectiveGrouping === 'by_halaqah'
            ? 'Per_Halaqah'
            : 'Semua';
    const dateSlug = new Date().toISOString().slice(0, 10);
    return `${modeTag}_${scopeTag}_${dateSlug}`;
  };

  const handleDownloadWord = () => {
    if (pageGroups.length === 0) return;

    const docHeading =
      audience === 'student_board'
        ? 'PENGUMUMAN HASIL UJIAN AKHIR SEMESTER (UAS) TAHFIZ AL-QUR&#39;AN'
        : 'REKAPITULASI HASIL UJIAN AKHIR SEMESTER (UAS) PER HALAQAH';

    const sectionsHtml = pageGroups
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
            ? `<tr style="background:#065F46;color:#FFFFFF;">
                <th style="width:28pt;text-align:center;">No</th>
                <th style="text-align:left;">Nama Santri</th>
                <th style="width:42pt;text-align:center;">Kelas</th>
                <th style="width:72pt;text-align:center;">Halaqah</th>
                <th style="text-align:left;">Materi &amp; Nilai Per Sesi</th>
                <th style="width:52pt;text-align:center;">Rata-rata</th>
                <th style="width:72pt;text-align:center;">Keterangan</th>
              </tr>`
            : `<tr style="background:#065F46;color:#FFFFFF;">
                <th style="width:26pt;text-align:center;">No</th>
                <th style="width:52pt;text-align:center;">NIS</th>
                <th style="text-align:left;">Nama Santri</th>
                <th style="width:38pt;text-align:center;">Kelas</th>
                <th style="text-align:left;">Materi &amp; Nilai Per Sesi</th>
                <th style="text-align:left;">Penguji Aktual</th>
                <th style="width:48pt;text-align:center;">Rata-rata</th>
                <th style="width:70pt;text-align:center;">Status</th>
              </tr>`;

        const tableBody = grp.rows
          .map(({ student, summary }, rIdx) => {
            const bgRow = rIdx % 2 === 1 ? 'background:#F8FAFC;' : '';
            const statusBg =
              summary.statusCategory === 'PASSED'
                ? 'background:#D1FAE5;color:#065F46;'
                : summary.statusCategory === 'FAILED'
                  ? 'background:#FEE2E2;color:#991B1B;'
                  : 'background:#FEF3C7;color:#92400E;';
            const ketText =
              summary.statusCategory === 'PASSED'
                ? 'LULUS'
                : summary.statusCategory === 'FAILED'
                  ? 'REMEDIAL'
                  : summary.statusText;
            const avgDisplay = summary.averageScore !== null ? summary.averageScore.toFixed(2) : '-';

            if (audience === 'student_board') {
              return `<tr style="${bgRow}">
                <td style="text-align:center;">${rIdx + 1}</td>
                <td style="font-weight:bold;">${escapeHtml(student.studentName)}</td>
                <td style="text-align:center;">${escapeHtml(student.class || '-')}</td>
                <td style="text-align:center;">${escapeHtml(student.halaqah || '-')}</td>
                <td>${escapeHtml(summary.materialSummary)}</td>
                <td style="text-align:center;font-weight:bold;">${avgDisplay}</td>
                <td style="text-align:center;font-weight:bold;${statusBg}">${escapeHtml(ketText)}</td>
              </tr>`;
            }

            return `<tr style="${bgRow}">
              <td style="text-align:center;">${rIdx + 1}</td>
              <td style="text-align:center;">${escapeHtml(student.studentNis || '-')}</td>
              <td style="font-weight:bold;">${escapeHtml(student.studentName)}</td>
              <td style="text-align:center;">${escapeHtml(student.class || '-')}</td>
              <td>${escapeHtml(summary.materialSummary)}</td>
              <td>${escapeHtml(summary.examinerSummary)}</td>
              <td style="text-align:center;font-weight:bold;">${avgDisplay}</td>
              <td style="text-align:center;font-weight:bold;${statusBg}">${escapeHtml(summary.statusText)}</td>
            </tr>`;
          })
          .join('');

        const pageBreak =
          gIdx > 0
            ? `<br clear="all" style="mso-special-character:line-break;page-break-before:always" />`
            : '';

        return `${pageBreak}
        <table style="width:100%;border-collapse:collapse;border-bottom:3pt double #0F172A;margin-bottom:8pt;">
          <tr>
            <td style="width:60pt;border:none;text-align:center;vertical-align:middle;padding-bottom:6pt;">
              <img src="${LOGO_URL}" width="54" height="54" alt="Logo" />
            </td>
            <td style="border:none;text-align:center;vertical-align:middle;padding-bottom:6pt;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:14pt;font-weight:bold;color:#0F172A;">PONDOK PESANTREN DARUL ABROR IBS</div>
              <div style="font-size:10.5pt;font-weight:bold;color:#065F46;margin-top:1pt;">BAGIAN TAHSIN &amp; TAHFIDZ AL QUR&#39;AN</div>
              <div style="font-size:8.5pt;color:#475569;margin-top:1pt;">Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151</div>
            </td>
            <td style="width:60pt;border:none;"></td>
          </tr>
        </table>

        <div style="text-align:center;margin-bottom:8pt;">
          <div style="font-size:11pt;font-weight:bold;text-decoration:underline;">${docHeading}</div>
          <div style="font-size:9.5pt;color:#334155;margin-top:3pt;">
            <strong>${escapeHtml(grp.title)}</strong>${grp.subtitle ? ` &bull; ${escapeHtml(grp.subtitle)}` : ''} &bull; Periode: ${escapeHtml(periodName)} &bull; KKM: ${kkm}
          </div>
          ${
            audience === 'teacher_halaqah'
              ? `<div style="font-size:9pt;color:#065F46;margin-top:3pt;">Total Santri: <strong>${grp.rows.length}</strong> &bull; Lulus: <strong>${passedCount}</strong> &bull; Belum Tuntas/Remedial: <strong>${failedCount}</strong> &bull; Rata-rata: <strong>${avgStr}</strong></div>`
              : ''
          }
        </div>

        <table class="data-table">
          <thead>${tableHead}</thead>
          <tbody>${tableBody}</tbody>
        </table>

        <table style="width:100%;border-collapse:collapse;margin-top:16pt;">
          <tr>
            <td style="border:none;width:58%;"></td>
            <td style="border:none;width:42%;text-align:center;font-size:9.5pt;line-height:1.35;">
              <div>Garut, ${escapeHtml(dateText)}</div>
              <div style="font-weight:bold;">Bagian Tahsin &amp; Tahfidz Al Qur&#39;an</div>
              <div style="font-size:9pt;color:#334155;">Ma&#39;had Darul Abror Islamic Boarding School</div>
              <div style="height:42pt;">&nbsp;</div>
              <div style="font-weight:bold;text-decoration:underline;font-size:10pt;">Parhan Mubarok, S.Ag</div>
            </td>
          </tr>
        </table>`;
      })
      .join('');

    const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8" />
  <title>Hasil UAS Tahfiz - Darul Abror IBS</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page Section1 {
      size: 595.3pt 841.9pt;
      margin: 34pt 34pt 34pt 34pt;
      mso-header-margin: 20pt;
      mso-footer-margin: 20pt;
    }
    div.Section1 { page: Section1; }
    body { font-family: Calibri, Arial, sans-serif; font-size: 9.5pt; color: #0F172A; }
    table.data-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
    table.data-table th, table.data-table td { border: 0.75pt solid #94A3B8; padding: 4pt 5pt; vertical-align: middle; }
  </style>
</head>
<body>
  <div class="Section1">
    ${sectionsHtml}
  </div>
</body>
</html>`;

    const blob = new Blob(['\uFEFF', wordHtml], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${buildFileBaseName()}.doc`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadExcel = () => {
    if (pageGroups.length === 0) return;

    const usedSheetNames = new Set<string>();
    const docHeading =
      audience === 'student_board'
        ? "PENGUMUMAN HASIL UJIAN AKHIR SEMESTER (UAS) TAHFIZ AL-QUR'AN"
        : 'REKAPITULASI HASIL UJIAN AKHIR SEMESTER (UAS) PER HALAQAH';

    const worksheetsXml = pageGroups
      .map(grp => {
        const sheetName = sanitizeSheetName(grp.title, usedSheetNames);
        const passedCount = grp.rows.filter(r => r.summary.statusCategory === 'PASSED').length;
        const failedCount = grp.rows.filter(r => r.summary.statusCategory === 'FAILED').length;
        const validScores = grp.rows
          .map(r => r.summary.averageScore)
          .filter((v): v is number => v !== null && !Number.isNaN(v));
        const avgStr =
          validScores.length > 0
            ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(2)
            : '-';

        const colDefs =
          audience === 'student_board'
            ? `<Column ss:Width="35"/>
   <Column ss:Width="185"/>
   <Column ss:Width="55"/>
   <Column ss:Width="95"/>
   <Column ss:Width="270"/>
   <Column ss:Width="75"/>
   <Column ss:Width="95"/>`
            : `<Column ss:Width="35"/>
   <Column ss:Width="65"/>
   <Column ss:Width="175"/>
   <Column ss:Width="55"/>
   <Column ss:Width="255"/>
   <Column ss:Width="175"/>
   <Column ss:Width="75"/>
   <Column ss:Width="95"/>`;

        const headerCells =
          audience === 'student_board'
            ? `<Cell ss:StyleID="TableHeader"><Data ss:Type="String">No</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Nama Santri</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Kelas</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Halaqah</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Materi &amp; Nilai Per Sesi</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Rata-rata</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Keterangan</Data></Cell>`
            : `<Cell ss:StyleID="TableHeader"><Data ss:Type="String">No</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">NIS</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Nama Santri</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Kelas</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Materi &amp; Nilai Per Sesi</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Penguji Aktual</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Rata-rata</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Status</Data></Cell>`;

        const dataRowsXml = grp.rows
          .map(({ student, summary }, rIdx) => {
            const stStyle =
              summary.statusCategory === 'PASSED'
                ? 'CellLulus'
                : summary.statusCategory === 'FAILED'
                  ? 'CellGagal'
                  : 'CellProses';
            const ketText =
              audience === 'student_board'
                ? summary.statusCategory === 'PASSED'
                  ? 'LULUS'
                  : summary.statusCategory === 'FAILED'
                    ? 'REMEDIAL'
                    : summary.statusText
                : summary.statusText;

            const avgCell =
              summary.averageScore !== null
                ? `<Cell ss:StyleID="CellNumber"><Data ss:Type="Number">${summary.averageScore.toFixed(2)}</Data></Cell>`
                : `<Cell ss:StyleID="CellCenter"><Data ss:Type="String">-</Data></Cell>`;

            if (audience === 'student_board') {
              return `   <Row ss:Height="22">
    <Cell ss:StyleID="CellCenter"><Data ss:Type="Number">${rIdx + 1}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXml(student.studentName)}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXml(student.class || '-')}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXml(student.halaqah || '-')}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXml(summary.materialSummary)}</Data></Cell>
    ${avgCell}
    <Cell ss:StyleID="${stStyle}"><Data ss:Type="String">${escapeXml(ketText)}</Data></Cell>
   </Row>`;
            }

            return `   <Row ss:Height="22">
    <Cell ss:StyleID="CellCenter"><Data ss:Type="Number">${rIdx + 1}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXml(student.studentNis || '-')}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXml(student.studentName)}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXml(student.class || '-')}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXml(summary.materialSummary)}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXml(summary.examinerSummary)}</Data></Cell>
    ${avgCell}
    <Cell ss:StyleID="${stStyle}"><Data ss:Type="String">${escapeXml(ketText)}</Data></Cell>
   </Row>`;
          })
          .join('\n');

        const sigColIndex = audience === 'student_board' ? 5 : 6;

        return ` <Worksheet ss:Name="${escapeXml(sheetName)}">
  <Table ss:DefaultRowHeight="20">
   ${colDefs}
   <Row ss:Height="24">
    <Cell ss:StyleID="HeaderTitle"><Data ss:Type="String">PONDOK PESANTREN DARUL ABROR IBS</Data></Cell>
   </Row>
   <Row ss:Height="19">
    <Cell ss:StyleID="HeaderSubtitle"><Data ss:Type="String">BAGIAN TAHSIN &amp; TAHFIDZ AL QUR&apos;AN</Data></Cell>
   </Row>
   <Row ss:Height="16">
    <Cell><Data ss:Type="String">Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell ss:StyleID="HeaderSubtitle"><Data ss:Type="String">${escapeXml(docHeading)}</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell><Data ss:Type="String">${escapeXml(grp.title)}${grp.subtitle ? ` | ${escapeXml(grp.subtitle)}` : ''} | Periode: ${escapeXml(periodName)} | KKM: ${kkm}</Data></Cell>
   </Row>
   ${
     audience === 'teacher_halaqah'
       ? `<Row ss:Height="18">
    <Cell><Data ss:Type="String">Total Santri: ${grp.rows.length} | Lulus: ${passedCount} | Belum Tuntas/Remedial: ${failedCount} | Rata-rata: ${avgStr}</Data></Cell>
   </Row>`
       : ''
   }
   <Row ss:Height="8"/>
   <Row ss:Height="26">
    ${headerCells}
   </Row>
${dataRowsXml}
   <Row ss:Height="14"/>
   <Row ss:Height="18">
    <Cell ss:Index="${sigColIndex}"><Data ss:Type="String">Garut, ${escapeXml(dateText)}</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell ss:Index="${sigColIndex}"><Data ss:Type="String">Bagian Tahsin &amp; Tahfidz Al Qur&apos;an</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell ss:Index="${sigColIndex}"><Data ss:Type="String">Ma&apos;had Darul Abror Islamic Boarding School</Data></Cell>
   </Row>
   <Row ss:Height="34"/>
   <Row ss:Height="20">
    <Cell ss:Index="${sigColIndex}" ss:StyleID="HeaderSubtitle"><Data ss:Type="String">Parhan Mubarok, S.Ag</Data></Cell>
   </Row>
  </Table>
 </Worksheet>`;
      })
      .join('\n');

    const excelXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="HeaderTitle">
   <Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1" ss:Color="#047857"/>
  </Style>
  <Style ss:ID="HeaderSubtitle">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#0F172A"/>
  </Style>
  <Style ss:ID="TableHeader">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#065F46" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#064E3B"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#064E3B"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#064E3B"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#064E3B"/>
   </Borders>
  </Style>
  <Style ss:ID="CellText">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
  </Style>
  <Style ss:ID="CellCenter">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
  </Style>
  <Style ss:ID="CellNumber">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="0.00"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
  </Style>
  <Style ss:ID="CellLulus">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#065F46"/>
   <Interior ss:Color="#D1FAE5" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#A7F3D0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#A7F3D0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#A7F3D0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#A7F3D0"/>
   </Borders>
  </Style>
  <Style ss:ID="CellGagal">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#991B1B"/>
   <Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FECACA"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FECACA"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FECACA"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FECACA"/>
   </Borders>
  </Style>
  <Style ss:ID="CellProses">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#92400E"/>
   <Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FDE68A"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FDE68A"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FDE68A"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FDE68A"/>
   </Borders>
  </Style>
 </Styles>
${worksheetsXml}
</Workbook>`;

    const blob = new Blob([excelXml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${buildFileBaseName()}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
            Pilih <strong>Word (.doc)</strong> atau <strong>Excel (.xls)</strong> jika ingin mengedit manual sebelum dibagikan/ditempel.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold"
            >
              Tutup
            </button>
            <button
              type="button"
              disabled={pageGroups.length === 0}
              onClick={handleDownloadWord}
              className="px-3.5 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-extrabold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <FileText size={14} />
              <span>Word (.doc)</span>
            </button>
            <button
              type="button"
              disabled={pageGroups.length === 0}
              onClick={handleDownloadExcel}
              className="px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-extrabold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <FileSpreadsheet size={14} />
              <span>Excel (.xls)</span>
            </button>
            <button
              type="button"
              disabled={pageGroups.length === 0}
              onClick={handlePrintNow}
              className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Printer size={14} />
              <span>Cetak / PDF ({pageGroups.length} Lembar)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
