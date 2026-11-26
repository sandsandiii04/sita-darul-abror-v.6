// services/ziyadahAccelExportService.ts
// Layanan Cetak & Ekspor Resmi SITA Darul Abror (Perbaikan B-07 & Keputusan Admin A.3):
// - Mendukung 6 mode laporan + filter Sesi, Santri, Kelas, dan Halaqah secara konsisten di SEMUA format
// - Nama penandatangan mengikuti konfigurasi Admin pada kegiatan (tidak dipaksa hardcode)
// - Format .doc menggunakan Word-HTML ber-komentar kondisional MSO A4 Portrait (selaras UAS SITA)
// - Format .xls menggunakan XML SpreadsheetML 2003 dengan sanitasi nama sheet & sel numerik
// - Format CSV menggunakan UTF-8 dengan BOM (\uFEFF) & proteksi injeksi formula

import {
  ZiyadahAccelEvent,
  ZiyadahAccelEventMetrics,
  ZiyadahAccelSession,
  ZiyadahAccelStudentSummaryRow
} from '../types';
import { LOGO_URL } from '../constants';
import { sanitizeFormulaInjection } from './finalRecapExportService';
import { formatPagesIndo, round2 } from './ziyadahAccelPageCalc';

export type ZiyadahReportMode =
  | 'overall'
  | 'per_session'
  | 'per_student'
  | 'per_class'
  | 'per_halaqah'
  | 'archive';

export interface ZiyadahReportFilterOptions {
  mode: ZiyadahReportMode;
  selectedSessionId?: string;
  selectedStudentId?: string;
  selectedClass?: string;
  selectedHalaqah?: string;
}

function escHtml(val: any): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escXml(val: any): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatScoreCell(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '-';
  return Number(val).toFixed(2);
}

function sanitizeSheetName(raw: string, used: Set<string>): string {
  const cleaned =
    String(raw || 'Sheet')
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

export function sanitizeSlug(raw: string): string {
  return String(raw || 'Laporan')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 45);
}

function triggerBlobDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function formatFulfillmentStatusIndo(
  fulfillmentStatus: string | undefined,
  verificationStatus?: string
): string {
  if (fulfillmentStatus === 'submitted') {
    if (verificationStatus === 'needs_verification') return 'Perlu Verifikasi';
    if (verificationStatus === 'verified_rejected') return 'Ditolak Verifikasi';
    return 'Sudah Setor';
  }
  if (fulfillmentStatus === 'absent') return 'Tidak Hadir';
  if (fulfillmentStatus === 'called_not_submitted') return 'Belum Menyetor';
  if (fulfillmentStatus === 'pending_examiner_input') return 'Belum Diinput';
  return 'Belum Giliran';
}

export interface ReportSectionGroup {
  groupTitle: string;
  groupSubtitle?: string;
  rows: ZiyadahAccelStudentSummaryRow[];
  groupParticipantCount: number;
  groupTotalUniquePages: number;
  groupAverageScore: number | null;
}

function computeRowsSubtotal(
  rows: ZiyadahAccelStudentSummaryRow[],
  targetSessionId?: string
): { participantCount: number; totalUniquePages: number; averageScore: number | null } {
  if (targetSessionId) {
    let pages = 0;
    let scoreSum = 0;
    let scoreCnt = 0;
    for (const r of rows) {
      const c = r.cells.find(x => x.sessionId === targetSessionId);
      if (c && c.fulfillmentStatus === 'submitted') {
        pages += c.uniqueVerifiedPages;
        if (c.score !== null && c.verificationStatus !== 'verified_rejected') {
          scoreSum += c.score;
          scoreCnt += 1;
        }
      }
    }
    return {
      participantCount: rows.length,
      totalUniquePages: round2(pages),
      averageScore: scoreCnt > 0 ? round2(scoreSum / scoreCnt) : null
    };
  }

  const totalUniquePages = round2(rows.reduce((acc, r) => acc + r.totalUniqueVerifiedPages, 0));
  const withScore = rows.filter(r => r.averageScore !== null);
  const averageScore =
    withScore.length > 0
      ? round2(withScore.reduce((acc, r) => acc + (r.averageScore || 0), 0) / withScore.length)
      : null;

  return {
    participantCount: rows.length,
    totalUniquePages,
    averageScore
  };
}

export function buildReportGroups(
  filter: ZiyadahReportFilterOptions,
  rows: ZiyadahAccelStudentSummaryRow[],
  sessions?: ZiyadahAccelSession[]
): ReportSectionGroup[] {
  const { mode, selectedSessionId, selectedStudentId, selectedClass, selectedHalaqah } = filter;

  if (mode === 'per_student') {
    const filtered =
      selectedStudentId && selectedStudentId !== 'ALL'
        ? rows.filter(
            r => r.studentId === selectedStudentId || r.participantId === selectedStudentId
          )
        : rows;
    return filtered.map(r => {
      const sub = computeRowsSubtotal([r]);
      return {
        groupTitle: `${r.studentName} (NIS: ${r.nis})`,
        groupSubtitle: `Kelas ${r.className} • ${r.halaqah} • Pembimbing: ${r.halaqahTeacherName}`,
        rows: [r],
        groupParticipantCount: 1,
        groupTotalUniquePages: sub.totalUniquePages,
        groupAverageScore: sub.averageScore
      };
    });
  }

  if (mode === 'per_class') {
    const map = new Map<string, ZiyadahAccelStudentSummaryRow[]>();
    for (const r of rows) {
      const k = r.className || 'Tanpa Kelas';
      if (selectedClass && selectedClass !== 'ALL' && k !== selectedClass) continue;
      const arr = map.get(k) || [];
      arr.push(r);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'id', { numeric: true }))
      .map(([cls, list]) => {
        const sub = computeRowsSubtotal(list);
        return {
          groupTitle: `Kelas ${cls}`,
          groupSubtitle: `Jumlah Peserta Kelas ${cls}: ${list.length} Santri`,
          rows: list,
          groupParticipantCount: sub.participantCount,
          groupTotalUniquePages: sub.totalUniquePages,
          groupAverageScore: sub.averageScore
        };
      });
  }

  if (mode === 'per_halaqah') {
    const map = new Map<string, ZiyadahAccelStudentSummaryRow[]>();
    for (const r of rows) {
      const k = r.halaqah || 'Tanpa Halaqah';
      if (selectedHalaqah && selectedHalaqah !== 'ALL' && k !== selectedHalaqah) continue;
      const arr = map.get(k) || [];
      arr.push(r);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'id', { numeric: true }))
      .map(([hlq, list]) => {
        const tName = list.find(
          x => x.halaqahTeacherName && x.halaqahTeacherName !== '-'
        )?.halaqahTeacherName;
        const sub = computeRowsSubtotal(list);
        return {
          groupTitle: hlq,
          groupSubtitle: tName
            ? `Pembimbing Halaqah: ${tName} • ${list.length} Santri`
            : `${list.length} Santri`,
          rows: list,
          groupParticipantCount: sub.participantCount,
          groupTotalUniquePages: sub.totalUniquePages,
          groupAverageScore: sub.averageScore
        };
      });
  }

  if (mode === 'per_session') {
    const validSess = (sessions || []).filter(s => s.status !== 'cancelled');
    const targetSess = validSess.find(s => s.id === selectedSessionId) || validSess[0];
    const sub = computeRowsSubtotal(rows, targetSess?.id);
    return [
      {
        groupTitle: targetSess
          ? `Rekapitulasi ${targetSess.name} (${targetSess.sessionDate})`
          : 'Rekapitulasi Per Sesi',
        groupSubtitle: targetSess ? `Status Sesi: ${targetSess.status.toUpperCase()}` : undefined,
        rows,
        groupParticipantCount: sub.participantCount,
        groupTotalUniquePages: sub.totalUniquePages,
        groupAverageScore: sub.averageScore
      }
    ];
  }

  const sub = computeRowsSubtotal(rows);
  return [
    {
      groupTitle:
        mode === 'archive'
          ? 'Rekapitulasi Arsip Terfinalisasi (Immutable)'
          : 'Rekapitulasi Seluruh Peserta Kegiatan',
      rows,
      groupParticipantCount: sub.participantCount,
      groupTotalUniquePages: sub.totalUniquePages,
      groupAverageScore: sub.averageScore
    }
  ];
}

function resolveSignerDisplay(event: ZiyadahAccelEvent): {
  city: string;
  title: string;
  nameDisplay: string;
} {
  const city = (event.signerCity || 'Garut').trim() || 'Garut';
  const title =
    (event.signerTitle ?? '').trim() ||
    "Bagian Tahsin & Tahfidz Al Qur'an Ma'had Darul Abror Islamic Boarding School";
  const rawName = (event.signerName ?? '').trim();
  const nameDisplay = rawName || '( ........................................ )';
  return { city, title, nameDisplay };
}

function buildOfficialKopHtml(logoUrl: string, isWordDoc: boolean = false): string {
  if (isWordDoc) {
    return `
      <table style="width:527pt;table-layout:fixed;border-collapse:collapse;margin:0 auto 8pt auto;">
        <tr>
          <td style="width:54pt;border:none;border-bottom:2.25pt double #0F172A;text-align:center;vertical-align:middle;padding:0 0 6pt 0;">
            <img src="${escHtml(logoUrl)}" width="48" height="48" alt="Logo" />
          </td>
          <td style="width:419pt;border:none;border-bottom:2.25pt double #0F172A;text-align:center;vertical-align:middle;padding:0 4pt 6pt 4pt;">
            <p class="kop-title">PONDOK PESANTREN DARUL ABROR IBS</p>
            <p class="kop-sub">BAGIAN TAHSIN &amp; TAHFIDZ AL QUR&#39;AN</p>
            <p class="kop-addr">Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151</p>
          </td>
          <td style="width:54pt;border:none;border-bottom:2.25pt double #0F172A;padding:0 0 6pt 0;">&nbsp;</td>
        </tr>
      </table>
    `;
  }

  return `
    <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:3px double #0F172A; padding-bottom:10px; margin-bottom:14px;">
      <div style="width:68px; text-align:center;">
        <img src="${escHtml(logoUrl)}" alt="Logo" style="width:58px; height:58px; object-fit:contain;" />
      </div>
      <div style="flex:1; text-align:center;">
        <div style="font-family:'Times New Roman',Georgia,serif; font-size:17px; font-weight:800; color:#0F172A; letter-spacing:0.5px;">
          PONDOK PESANTREN DARUL ABROR IBS
        </div>
        <div style="font-size:12px; font-weight:700; color:#047857; margin-top:2px; letter-spacing:0.4px;">
          BAGIAN TAHSIN &amp; TAHFIDZ AL QUR'AN
        </div>
        <div style="font-size:10px; color:#475569; margin-top:2px;">
          Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151
        </div>
      </div>
      <div style="width:68px;"></div>
    </div>
  `;
}

function buildSignatureHtml(
  event: ZiyadahAccelEvent,
  printDateStr: string,
  isWordDoc: boolean = false
): string {
  const { city, title, nameDisplay } = resolveSignerDisplay(event);

  if (isWordDoc) {
    return `
      <table style="width:527pt;table-layout:fixed;border-collapse:collapse;margin:14pt auto 0 auto;">
        <tr>
          <td style="border:none;width:307pt;">&nbsp;</td>
          <td style="border:none;width:220pt;text-align:center;vertical-align:top;">
            <p class="sig-line">${escHtml(city)}, ${escHtml(printDateStr)}</p>
            <p class="sig-role">${escHtml(title)}</p>
            <p style="margin:0;line-height:38pt;font-size:1pt;">&nbsp;</p>
            <p class="sig-name">${escHtml(nameDisplay)}</p>
          </td>
        </tr>
      </table>
    `;
  }

  return `
    <div style="display:flex; justify-content:flex-end; margin-top:22px; page-break-inside:avoid;">
      <div style="width:280px; text-align:center; font-size:11px; color:#0F172A; line-height:1.45;">
        <div>${escHtml(city)}, ${escHtml(printDateStr)}</div>
        <div style="font-weight:700; margin-top:2px;">${escHtml(title)}</div>
        <div style="height:56px;"></div>
        <div style="font-weight:800; text-decoration:underline;">${escHtml(nameDisplay)}</div>
      </div>
    </div>
  `;
}

export function buildZiyadahPrintableHtml(params: {
  filter: ZiyadahReportFilterOptions;
  event: ZiyadahAccelEvent;
  metrics: ZiyadahAccelEventMetrics;
  sessions: ZiyadahAccelSession[];
  rows: ZiyadahAccelStudentSummaryRow[];
  printDateStr?: string;
}): string {
  const { filter, event, sessions, rows } = params;
  const printDateStr =
    params.printDateStr ||
    new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

  const validSessions = sessions.filter(s => s.status !== 'cancelled');
  const targetSession =
    filter.mode === 'per_session'
      ? validSessions.find(s => s.id === filter.selectedSessionId) || validSessions[0]
      : undefined;

  const groups = buildReportGroups(filter, rows, sessions);

  const pagesHtml = groups
    .map((grp, grpIdx) => {
      const pageBreakStyle = grpIdx > 0 ? 'page-break-before: always; padding-top: 8px;' : '';

      let tableHtml = '';
      if (filter.mode === 'per_session' && targetSession) {
        const bodyRows = grp.rows
          .map((r, idx) => {
            const cell = r.cells.find(c => c.sessionId === targetSession.id);
            const statusLabel = formatFulfillmentStatusIndo(
              cell?.fulfillmentStatus,
              cell?.verificationStatus
            );

            return `
              <tr>
                <td style="text-align:center;">${idx + 1}</td>
                <td style="font-weight:700;">${escHtml(r.studentName)}</td>
                <td style="text-align:center;">${escHtml(r.className)}</td>
                <td>${escHtml(cell?.rangeSummaryText || '-')}</td>
                <td style="text-align:center; font-weight:700;">${formatPagesIndo(cell?.confirmedPages ?? null)}</td>
                <td style="text-align:center; font-weight:700;">${formatScoreCell(cell?.score ?? null)}</td>
                <td style="text-align:center;">${escHtml(statusLabel)}</td>
              </tr>
            `;
          })
          .join('');

        tableHtml = `
          <table class="report-table">
            <thead>
              <tr>
                <th style="width:34px;">No</th>
                <th style="width:175px;">Nama Lengkap Santri</th>
                <th style="width:52px;">Kelas</th>
                <th>Surah dan Ayat (${escHtml(targetSession.name)})</th>
                <th style="width:78px;">Jumlah Halaman</th>
                <th style="width:68px;">Nilai Sesi</th>
                <th style="width:92px;">Status</th>
              </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
        `;
      } else if (filter.mode === 'per_student' && grp.rows[0]) {
        const st = grp.rows[0];
        const sessRows = st.cells
          .map(
            (c, i) => `
              <tr>
                <td style="text-align:center;">${i + 1}</td>
                <td style="font-weight:700;">${escHtml(c.sessionName)}</td>
                <td>${escHtml(c.rangeSummaryText)}</td>
                <td style="text-align:center; font-weight:700;">${formatPagesIndo(c.confirmedPages)}</td>
                <td style="text-align:center; font-weight:700;">${formatScoreCell(c.score)}</td>
                <td>${escHtml(c.examinerName || '-')}</td>
              </tr>
            `
          )
          .join('');

        tableHtml = `
          <table class="report-table">
            <thead>
              <tr>
                <th style="width:36px;">No</th>
                <th style="width:110px;">Sesi</th>
                <th>Rincian Surah dan Ayat</th>
                <th style="width:85px;">Halaman</th>
                <th style="width:75px;">Nilai</th>
                <th style="width:130px;">Penguji</th>
              </tr>
            </thead>
            <tbody>
              ${sessRows}
              <tr style="background:#ECFDF5; font-weight:800;">
                <td colspan="3" style="text-align:right;">TOTAL HALAMAN UNIK &amp; RATA-RATA NILAI (${st.scoredSessionCount}/${st.totalSessionsExpected} Sesi)</td>
                <td style="text-align:center;">${formatPagesIndo(st.totalUniqueVerifiedPages)} Hal</td>
                <td style="text-align:center;">${formatScoreCell(st.averageScore)}</td>
                <td style="text-align:center;">${st.isCompleteAllSessions ? 'Lengkap' : `${st.submittedSessionCount}/${st.totalSessionsExpected} Sesi`}</td>
              </tr>
            </tbody>
          </table>
        `;
      } else {
        const bodyRows = grp.rows
          .map((r, idx) => {
            const completeness = r.isCompleteAllSessions
              ? `Lengkap (${r.submittedSessionCount}/${r.totalSessionsExpected})`
              : `${r.submittedSessionCount}/${r.totalSessionsExpected} Sesi`;
            return `
              <tr>
                <td style="text-align:center;">${idx + 1}</td>
                <td style="font-weight:700;">${escHtml(r.studentName)}</td>
                <td style="text-align:center;">${escHtml(r.className)}</td>
                <td style="font-size:9.5px; line-height:1.35;">${escHtml(r.combinedRangesText)}</td>
                <td style="text-align:center; font-weight:700;">${formatPagesIndo(r.totalUniqueVerifiedPages)}</td>
                <td style="text-align:center; font-weight:800;">${formatScoreCell(r.averageScore)}</td>
                <td style="text-align:center; font-size:9.5px;">${escHtml(completeness)}</td>
              </tr>
            `;
          })
          .join('');

        tableHtml = `
          <table class="report-table">
            <thead>
              <tr>
                <th style="width:32px;">No</th>
                <th style="width:165px;">Nama Lengkap Santri</th>
                <th style="width:48px;">Kelas</th>
                <th>Rincian Surah dan Ayat</th>
                <th style="width:74px;">Jumlah Halaman</th>
                <th style="width:74px;">Nilai Rata-rata</th>
                <th style="width:84px;">Kelengkapan</th>
              </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
        `;
      }

      return `
        <section style="${pageBreakStyle}">
          ${buildOfficialKopHtml(LOGO_URL, false)}
          <div style="text-align:center; margin-bottom:10px;">
            <div style="font-size:13px; font-weight:800; text-decoration:underline; color:#0F172A; text-transform:uppercase;">
              LAPORAN HASIL ${escHtml(event.name)}
            </div>
            <div style="font-size:10.5px; color:#334155; margin-top:3px; font-weight:600;">
              ${escHtml(grp.groupTitle)} ${grp.groupSubtitle ? `• ${escHtml(grp.groupSubtitle)}` : ''}
            </div>
            <div style="font-size:10px; color:#475569; margin-top:2px;">
              Tahun Ajaran ${escHtml(event.academicYear)} (${event.semester === 'ganjil' ? 'Semester Ganjil' : 'Semester Genap'})
              • Pelaksanaan: ${escHtml(event.startDate)} s.d. ${escHtml(event.endDate)}
              • Peserta Bagian Ini: <strong>${grp.groupParticipantCount} Santri</strong>
              • Total Ziyadah Unik: <strong>${formatPagesIndo(grp.groupTotalUniquePages)} Halaman</strong>
              • Rata-rata Nilai: <strong>${formatScoreCell(grp.groupAverageScore)}</strong>
            </div>
          </div>
          ${tableHtml}
          ${buildSignatureHtml(event, printDateStr, false)}
        </section>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8" />
      <title>Laporan ${escHtml(event.name)}</title>
      <style>
        @page { size: A4 portrait; margin: 12mm 11mm; }
        body { font-family: Arial, Helvetica, sans-serif; color: #0F172A; margin: 0; padding: 14px; background: #fff; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
        .report-table thead { display: table-header-group; }
        .report-table tr { page-break-inside: avoid; }
        .report-table th {
          background: #065F46; color: #FFFFFF; font-weight: 700; text-align: center;
          padding: 6px 5px; border: 1px solid #064E3B; font-size: 10px;
        }
        .report-table td {
          padding: 5px 6px; border: 1px solid #CBD5E1; vertical-align: middle;
        }
        .report-table tbody tr:nth-child(even) { background: #F8FAFC; }
        @media print {
          body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      ${pagesHtml}
      <script>
        window.onload = function() {
          setTimeout(function() { window.print(); }, 350);
        };
      </script>
    </body>
    </html>`;
}

export function openZiyadahOfficialPrintPDF(params: {
  filter: ZiyadahReportFilterOptions;
  event: ZiyadahAccelEvent;
  metrics: ZiyadahAccelEventMetrics;
  sessions: ZiyadahAccelSession[];
  rows: ZiyadahAccelStudentSummaryRow[];
}): void {
  const win = window.open('', '_blank', 'width=1080,height=800');
  if (!win) {
    alert('Pop-up diblokir oleh browser. Izinkan pop-up untuk mencetak / menyimpan PDF laporan resmi.');
    return;
  }
  win.document.open();
  win.document.write(buildZiyadahPrintableHtml(params));
  win.document.close();
}

/**
 * Menghasilkan HTML MSO Word (.doc) A4 Portrait yang selaras 100% dengan filter laporan & standar UAS SITA
 */
export function generateZiyadahWordHtml(params: {
  filter: ZiyadahReportFilterOptions;
  event: ZiyadahAccelEvent;
  metrics: ZiyadahAccelEventMetrics;
  sessions: ZiyadahAccelSession[];
  rows: ZiyadahAccelStudentSummaryRow[];
  printDateStr?: string;
}): string {
  const { filter, event, sessions, rows } = params;
  const printDateStr =
    params.printDateStr ||
    new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

  const validSessions = sessions.filter(s => s.status !== 'cancelled');
  const targetSession =
    filter.mode === 'per_session'
      ? validSessions.find(s => s.id === filter.selectedSessionId) || validSessions[0]
      : undefined;

  const groups = buildReportGroups(filter, rows, sessions);

  const sectionsHtml = groups
    .map((grp, idx) => {
      const brk =
        idx > 0
          ? `<br clear="all" style="mso-special-character:line-break;page-break-before:always" />`
          : '';

      let tableHtml = '';
      if (filter.mode === 'per_session' && targetSession) {
        const trs = grp.rows
          .map((r, i) => {
            const cell = r.cells.find(c => c.sessionId === targetSession.id);
            const stText = formatFulfillmentStatusIndo(
              cell?.fulfillmentStatus,
              cell?.verificationStatus
            );
            return `<tr>
              <td style="text-align:center;">${i + 1}</td>
              <td style="font-weight:bold;">${escHtml(r.studentName)}</td>
              <td style="text-align:center;">${escHtml(r.className)}</td>
              <td>${escHtml(cell?.rangeSummaryText || '-')}</td>
              <td style="text-align:center;font-weight:bold;">${formatPagesIndo(cell?.confirmedPages ?? null)}</td>
              <td style="text-align:center;font-weight:bold;">${formatScoreCell(cell?.score ?? null)}</td>
              <td style="text-align:center;">${escHtml(stText)}</td>
            </tr>`;
          })
          .join('');

        tableHtml = `<table class="data-table" style="width:527pt;table-layout:fixed;border-collapse:collapse;margin:0 auto;">
          <thead>
            <tr>
              <th style="width:24pt;background:#065F46;color:#FFFFFF;">No</th>
              <th style="width:130pt;background:#065F46;color:#FFFFFF;">Nama Lengkap Santri</th>
              <th style="width:36pt;background:#065F46;color:#FFFFFF;">Kelas</th>
              <th style="width:177pt;background:#065F46;color:#FFFFFF;">Surah dan Ayat (${escHtml(targetSession.name)})</th>
              <th style="width:52pt;background:#065F46;color:#FFFFFF;">Halaman</th>
              <th style="width:48pt;background:#065F46;color:#FFFFFF;">Nilai</th>
              <th style="width:60pt;background:#065F46;color:#FFFFFF;">Status</th>
            </tr>
          </thead>
          <tbody>${trs}</tbody>
        </table>`;
      } else if (filter.mode === 'per_student' && grp.rows[0]) {
        const st = grp.rows[0];
        const trs = st.cells
          .map(
            (c, i) => `<tr>
              <td style="text-align:center;">${i + 1}</td>
              <td style="font-weight:bold;">${escHtml(c.sessionName)}</td>
              <td>${escHtml(c.rangeSummaryText)}</td>
              <td style="text-align:center;font-weight:bold;">${formatPagesIndo(c.confirmedPages)}</td>
              <td style="text-align:center;font-weight:bold;">${formatScoreCell(c.score)}</td>
              <td>${escHtml(c.examinerName || '-')}</td>
            </tr>`
          )
          .join('');

        tableHtml = `<table class="data-table" style="width:527pt;table-layout:fixed;border-collapse:collapse;margin:0 auto;">
          <thead>
            <tr>
              <th style="width:24pt;background:#065F46;color:#FFFFFF;">No</th>
              <th style="width:80pt;background:#065F46;color:#FFFFFF;">Sesi</th>
              <th style="width:213pt;background:#065F46;color:#FFFFFF;">Rincian Surah dan Ayat</th>
              <th style="width:55pt;background:#065F46;color:#FFFFFF;">Halaman</th>
              <th style="width:55pt;background:#065F46;color:#FFFFFF;">Nilai</th>
              <th style="width:100pt;background:#065F46;color:#FFFFFF;">Penguji</th>
            </tr>
          </thead>
          <tbody>
            ${trs}
            <tr style="background:#ECFDF5;font-weight:bold;">
              <td colspan="3" style="text-align:right;">TOTAL HALAMAN UNIK &amp; RATA-RATA (${st.scoredSessionCount}/${st.totalSessionsExpected} Sesi)</td>
              <td style="text-align:center;">${formatPagesIndo(st.totalUniqueVerifiedPages)} Hal</td>
              <td style="text-align:center;">${formatScoreCell(st.averageScore)}</td>
              <td style="text-align:center;">${st.submittedSessionCount}/${st.totalSessionsExpected} Sesi</td>
            </tr>
          </tbody>
        </table>`;
      } else {
        const trs = grp.rows
          .map(
            (r, i) => `<tr>
              <td style="text-align:center;">${i + 1}</td>
              <td style="font-weight:bold;">${escHtml(r.studentName)}</td>
              <td style="text-align:center;">${escHtml(r.className)}</td>
              <td>${escHtml(r.combinedRangesText)}</td>
              <td style="text-align:center;font-weight:bold;">${formatPagesIndo(r.totalUniqueVerifiedPages)}</td>
              <td style="text-align:center;font-weight:bold;">${formatScoreCell(r.averageScore)}</td>
              <td style="text-align:center;">${r.submittedSessionCount}/${r.totalSessionsExpected} Sesi</td>
            </tr>`
          )
          .join('');

        tableHtml = `<table class="data-table" style="width:527pt;table-layout:fixed;border-collapse:collapse;margin:0 auto;">
          <thead>
            <tr>
              <th style="width:24pt;background:#065F46;color:#FFFFFF;">No</th>
              <th style="width:125pt;background:#065F46;color:#FFFFFF;">Nama Lengkap Santri</th>
              <th style="width:36pt;background:#065F46;color:#FFFFFF;">Kelas</th>
              <th style="width:190pt;background:#065F46;color:#FFFFFF;">Surah dan Ayat</th>
              <th style="width:52pt;background:#065F46;color:#FFFFFF;">Jml Hal</th>
              <th style="width:50pt;background:#065F46;color:#FFFFFF;">Rata-rata</th>
              <th style="width:50pt;background:#065F46;color:#FFFFFF;">Sesi</th>
            </tr>
          </thead>
          <tbody>${trs}</tbody>
        </table>`;
      }

      return `${brk}
        ${buildOfficialKopHtml(LOGO_URL, true)}
        <div style="width:527pt;margin:6pt auto 6pt auto;text-align:center;">
          <p class="doc-title">LAPORAN HASIL ${escHtml(event.name.toUpperCase())}</p>
          <p class="doc-meta"><strong>${escHtml(grp.groupTitle)}</strong>${grp.groupSubtitle ? ` &bull; ${escHtml(grp.groupSubtitle)}` : ''}</p>
          <p class="doc-summary">TA ${escHtml(event.academicYear)} (${event.semester === 'ganjil' ? 'Ganjil' : 'Genap'}) &bull; Peserta: <strong>${grp.groupParticipantCount}</strong> &bull; Total Ziyadah Unik: <strong>${formatPagesIndo(grp.groupTotalUniquePages)} Hal</strong> &bull; Rata-rata Nilai: <strong>${formatScoreCell(grp.groupAverageScore)}</strong></p>
        </div>
        ${tableHtml}
        ${buildSignatureHtml(event, printDateStr, true)}`;
    })
    .join('');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8" />
  <title>Laporan ${escHtml(event.name)}</title>
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
      mso-page-orientation: portrait;
      margin: 34pt 34pt 34pt 34pt;
      mso-header-margin: 18pt;
      mso-footer-margin: 18pt;
    }
    div.Section1 { page: Section1; width: 527pt; margin: 0 auto; }
    body { font-family: Calibri, Arial, sans-serif; font-size: 8.5pt; color: #0F172A; margin: 0; padding: 0; }
    p { margin: 0; padding: 0; mso-para-margin-top: 0pt; mso-para-margin-bottom: 0pt; }
    .kop-title { font-family: Georgia, 'Times New Roman', serif; font-size: 13pt; font-weight: bold; color: #0F172A; line-height: 1.15; }
    .kop-sub { font-size: 9.5pt; font-weight: bold; color: #065F46; line-height: 1.2; margin-top: 1pt; }
    .kop-addr { font-size: 7.5pt; color: #475569; line-height: 1.2; margin-top: 1pt; }
    .doc-title { font-size: 10.5pt; font-weight: bold; text-decoration: underline; color: #0F172A; line-height: 1.25; }
    .doc-meta { font-size: 8.5pt; color: #334155; line-height: 1.25; margin-top: 2pt; }
    .doc-summary { font-size: 8pt; color: #065F46; line-height: 1.25; margin-top: 2pt; }
    table.data-table { width: 527pt; table-layout: fixed; border-collapse: collapse; font-size: 8pt; }
    table.data-table th { border: 0.5pt solid #064E3B; padding: 4pt 4pt; vertical-align: middle; font-weight: bold; }
    table.data-table td { border: 0.5pt solid #94A3B8; padding: 3.5pt 4pt; vertical-align: middle; word-wrap: break-word; line-height: 1.2; }
    .sig-line { font-size: 8.5pt; color: #0F172A; line-height: 1.3; }
    .sig-role { font-size: 8.5pt; font-weight: bold; color: #0F172A; line-height: 1.3; }
    .sig-name { font-size: 9pt; font-weight: bold; text-decoration: underline; color: #0F172A; line-height: 1.3; }
  </style>
</head>
<body>
  <div class="Section1">${sectionsHtml}</div>
</body>
</html>`;
}

export function downloadZiyadahWordDoc(params: {
  filter: ZiyadahReportFilterOptions;
  event: ZiyadahAccelEvent;
  metrics: ZiyadahAccelEventMetrics;
  sessions: ZiyadahAccelSession[];
  rows: ZiyadahAccelStudentSummaryRow[];
}): void {
  const docHtml = generateZiyadahWordHtml(params);
  triggerBlobDownload(
    '\uFEFF' + docHtml,
    `Laporan_Ziyadah_Akselerasi_${sanitizeSlug(params.filter.mode)}_${sanitizeSlug(params.event.name)}.doc`,
    'application/msword;charset=utf-8'
  );
}

/**
 * Menghasilkan XML SpreadsheetML (.xls) yang mematuhi filter aktif:
 * - Selalu menyertakan Sheet Ringkasan Kegiatan
 * - Jika mode per_session / per_student / per_class / per_halaqah: menyertakan Worksheet khusus sesuai filter
 * - Menyertakan Matriks Sesi 1..N atas baris terfilter
 */
export function generateZiyadahExcelXML(params: {
  filter?: ZiyadahReportFilterOptions;
  event: ZiyadahAccelEvent;
  metrics: ZiyadahAccelEventMetrics;
  sessions: ZiyadahAccelSession[];
  rows: ZiyadahAccelStudentSummaryRow[];
}): string {
  const { event, metrics, sessions, rows } = params;
  const filter: ZiyadahReportFilterOptions = params.filter || { mode: 'overall' };
  const validSessions = sessions
    .filter(s => s.status !== 'cancelled')
    .sort((a, b) => a.sessionNumber - b.sessionNumber);
  const usedSheetNames = new Set<string>();
  const { city, title, nameDisplay } = resolveSignerDisplay(event);

  const numCell = (v: number | null | undefined) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) {
      return `<Cell ss:StyleID="CenterBorder"><Data ss:Type="String">-</Data></Cell>`;
    }
    return `<Cell ss:StyleID="Num2Dec"><Data ss:Type="Number">${Number(v).toFixed(2)}</Data></Cell>`;
  };

  const groups = buildReportGroups(filter, rows, sessions);
  const filteredFlatRows = Array.from(
    new Map(groups.flatMap(g => g.rows).map(r => [r.participantId, r])).values()
  );

  // Sheet 1: Ringkasan Kegiatan
  const summarySheetName = sanitizeSheetName('Ringkasan Kegiatan', usedSheetNames);
  const sheet1Xml = `
  <Worksheet ss:Name="${escXml(summarySheetName)}">
   <Table>
    <Column ss:Width="265"/><Column ss:Width="130"/>
    <Row><Cell ss:StyleID="Title"><Data ss:Type="String">PONDOK PESANTREN DARUL ABROR IBS — BAGIAN TAHSIN &amp; TAHFIDZ AL QUR&apos;AN</Data></Cell></Row>
    <Row><Cell ss:StyleID="Subtitle"><Data ss:Type="String">RINGKASAN EKSEKUTIF: ${escXml(event.name)} (Mode: ${escXml(filter.mode.toUpperCase())})</Data></Cell></Row>
    <Row><Cell><Data ss:Type="String">Tahun Ajaran: ${escXml(event.academicYear)} (${event.semester === 'ganjil' ? 'Ganjil' : 'Genap'}) | Tanggal: ${escXml(event.startDate)} s.d. ${escXml(event.endDate)}</Data></Cell></Row>
    <Row ss:Index="5">
      <Cell ss:StyleID="Header"><Data ss:Type="String">Indikator Kegiatan</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">Nilai / Capaian</Data></Cell>
    </Row>
    <Row><Cell ss:StyleID="CellBorder"><Data ss:Type="String">Jumlah Peserta Unik Kegiatan</Data></Cell><Cell ss:StyleID="CenterBorder"><Data ss:Type="Number">${metrics.uniqueParticipantsCount}</Data></Cell></Row>
    <Row><Cell ss:StyleID="CellBorder"><Data ss:Type="String">Jumlah Peserta Sesuai Filter Laporan</Data></Cell><Cell ss:StyleID="CenterBorder"><Data ss:Type="Number">${filteredFlatRows.length}</Data></Cell></Row>
    <Row><Cell ss:StyleID="CellBorder"><Data ss:Type="String">Jumlah Sesi Pelaksanaan</Data></Cell><Cell ss:StyleID="CenterBorder"><Data ss:Type="Number">${metrics.totalSessionsCount}</Data></Cell></Row>
    <Row><Cell ss:StyleID="CellBorder"><Data ss:Type="String">Total Kewajiban Setoran (Peserta x Sesi)</Data></Cell><Cell ss:StyleID="CenterBorder"><Data ss:Type="Number">${metrics.totalObligationsCount}</Data></Cell></Row>
    <Row><Cell ss:StyleID="CellBorder"><Data ss:Type="String">Kewajiban Sudah Menyetor</Data></Cell><Cell ss:StyleID="CenterBorder"><Data ss:Type="Number">${metrics.submittedObligationsCount}</Data></Cell></Row>
    <Row><Cell ss:StyleID="CellBorder"><Data ss:Type="String">Kewajiban Tidak Hadir</Data></Cell><Cell ss:StyleID="CenterBorder"><Data ss:Type="Number">${metrics.absentObligationsCount}</Data></Cell></Row>
    <Row><Cell ss:StyleID="CellBorder"><Data ss:Type="String">Setoran Memerlukan Verifikasi</Data></Cell><Cell ss:StyleID="CenterBorder"><Data ss:Type="Number">${metrics.needsVerificationSubmissionsCount}</Data></Cell></Row>
    <Row><Cell ss:StyleID="CellBorder"><Data ss:Type="String">Total Halaman Ziyadah Unik Terverifikasi</Data></Cell>${numCell(metrics.totalUniqueVerifiedPages)}</Row>
    <Row><Cell ss:StyleID="CellBorder"><Data ss:Type="String">Rata-rata Nilai Akhir Peserta (Metode Santri)</Data></Cell>${numCell(metrics.averageScoreByStudent)}</Row>
    <Row><Cell ss:StyleID="CellBorder"><Data ss:Type="String">Rata-rata Seluruh Setoran Sesi (Metode Setoran)</Data></Cell>${numCell(metrics.averageScoreBySubmission)}</Row>
    <Row ss:Index="17"><Cell><Data ss:Type="String">${escXml(city)} — ${escXml(title)}: ${escXml(nameDisplay)}</Data></Cell></Row>
   </Table>
  </Worksheet>`;

  // Sheet Data Utama Sesuai Mode & Filter
  let mainSheetsXml = '';
  const targetSession =
    filter.mode === 'per_session'
      ? validSessions.find(s => s.id === filter.selectedSessionId) || validSessions[0]
      : undefined;

  if (filter.mode === 'per_session' && targetSession) {
    const sName = sanitizeSheetName(targetSession.name, usedSheetNames);
    const body = filteredFlatRows
      .map((r, idx) => {
        const c = r.cells.find(x => x.sessionId === targetSession.id);
        const stLabel = formatFulfillmentStatusIndo(c?.fulfillmentStatus, c?.verificationStatus);
        return `
          <Row>
            <Cell ss:StyleID="CenterBorder"><Data ss:Type="Number">${idx + 1}</Data></Cell>
            <Cell ss:StyleID="CenterBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(r.nis))}</Data></Cell>
            <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(r.studentName))}</Data></Cell>
            <Cell ss:StyleID="CenterBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(r.className))}</Data></Cell>
            <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(r.halaqah))}</Data></Cell>
            <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(c?.rangeSummaryText || '-'))}</Data></Cell>
            ${numCell(c?.confirmedPages ?? null)}
            ${numCell(c?.score ?? null)}
            <Cell ss:StyleID="CenterBorder"><Data ss:Type="String">${escXml(stLabel)}</Data></Cell>
            <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(c?.examinerName || '-'))}</Data></Cell>
          </Row>`;
      })
      .join('');

    mainSheetsXml = `
    <Worksheet ss:Name="${escXml(sName)}">
     <Table>
      <Column ss:Width="35"/><Column ss:Width="75"/><Column ss:Width="175"/><Column ss:Width="55"/><Column ss:Width="95"/><Column ss:Width="250"/><Column ss:Width="80"/><Column ss:Width="75"/><Column ss:Width="95"/><Column ss:Width="125"/>
      <Row><Cell ss:StyleID="Title"><Data ss:Type="String">REKAP ${escXml(targetSession.name.toUpperCase())} — ${escXml(event.name.toUpperCase())}</Data></Cell></Row>
      <Row ss:Index="3">
       <Cell ss:StyleID="Header"><Data ss:Type="String">No</Data></Cell>
       <Cell ss:StyleID="Header"><Data ss:Type="String">NIS</Data></Cell>
       <Cell ss:StyleID="Header"><Data ss:Type="String">Nama Lengkap Santri</Data></Cell>
       <Cell ss:StyleID="Header"><Data ss:Type="String">Kelas</Data></Cell>
       <Cell ss:StyleID="Header"><Data ss:Type="String">Halaqah</Data></Cell>
       <Cell ss:StyleID="Header"><Data ss:Type="String">Surah dan Ayat</Data></Cell>
       <Cell ss:StyleID="Header"><Data ss:Type="String">Halaman</Data></Cell>
       <Cell ss:StyleID="Header"><Data ss:Type="String">Nilai Sesi</Data></Cell>
       <Cell ss:StyleID="Header"><Data ss:Type="String">Status</Data></Cell>
       <Cell ss:StyleID="Header"><Data ss:Type="String">Penguji</Data></Cell>
      </Row>
      ${body}
     </Table>
    </Worksheet>`;
  } else if (filter.mode === 'per_student') {
    mainSheetsXml = groups
      .map(grp => {
        const st = grp.rows[0];
        if (!st) return '';
        const sName = sanitizeSheetName(st.studentName, usedSheetNames);
        const sRows = st.cells
          .map(
            (c, i) => `
            <Row>
              <Cell ss:StyleID="CenterBorder"><Data ss:Type="Number">${i + 1}</Data></Cell>
              <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(c.sessionName))}</Data></Cell>
              <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(c.rangeSummaryText))}</Data></Cell>
              ${numCell(c.confirmedPages)}
              ${numCell(c.score)}
              <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(c.examinerName || '-'))}</Data></Cell>
            </Row>`
          )
          .join('');

        return `
        <Worksheet ss:Name="${escXml(sName)}">
         <Table>
          <Column ss:Width="35"/><Column ss:Width="105"/><Column ss:Width="260"/><Column ss:Width="80"/><Column ss:Width="75"/><Column ss:Width="140"/>
          <Row><Cell ss:StyleID="Title"><Data ss:Type="String">${escXml(grp.groupTitle)}</Data></Cell></Row>
          <Row><Cell ss:StyleID="Subtitle"><Data ss:Type="String">${escXml(grp.groupSubtitle || '')}</Data></Cell></Row>
          <Row ss:Index="4">
           <Cell ss:StyleID="Header"><Data ss:Type="String">No</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Sesi</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Surah dan Ayat</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Halaman</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Nilai</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Penguji</Data></Cell>
          </Row>
          ${sRows}
          <Row>
           <Cell ss:StyleID="Subtitle"><Data ss:Type="String"></Data></Cell>
           <Cell ss:StyleID="Subtitle"><Data ss:Type="String">TOTAL / RATA-RATA</Data></Cell>
           <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${st.submittedSessionCount}/${st.totalSessionsExpected} Sesi</Data></Cell>
           ${numCell(st.totalUniqueVerifiedPages)}
           ${numCell(st.averageScore)}
           <Cell ss:StyleID="CellBorder"><Data ss:Type="String"></Data></Cell>
          </Row>
         </Table>
        </Worksheet>`;
      })
      .join('');
  } else {
    mainSheetsXml = groups
      .map(grp => {
        const sheetTitle =
          groups.length === 1 && (filter.mode === 'overall' || filter.mode === 'archive')
            ? 'Rekap Akhir Peserta'
            : grp.groupTitle;
        const sName = sanitizeSheetName(sheetTitle, usedSheetNames);
        const body = grp.rows
          .map(
            (r, idx) => `
            <Row>
              <Cell ss:StyleID="CenterBorder"><Data ss:Type="Number">${idx + 1}</Data></Cell>
              <Cell ss:StyleID="CenterBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(r.nis))}</Data></Cell>
              <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(r.studentName))}</Data></Cell>
              <Cell ss:StyleID="CenterBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(r.className))}</Data></Cell>
              <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(r.halaqah))}</Data></Cell>
              <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(r.combinedRangesText))}</Data></Cell>
              ${numCell(r.totalUniqueVerifiedPages)}
              ${numCell(r.averageScore)}
              <Cell ss:StyleID="CenterBorder"><Data ss:Type="String">${r.submittedSessionCount}/${r.totalSessionsExpected} Sesi</Data></Cell>
            </Row>`
          )
          .join('');

        return `
        <Worksheet ss:Name="${escXml(sName)}">
         <Table>
          <Column ss:Width="35"/><Column ss:Width="80"/><Column ss:Width="180"/><Column ss:Width="55"/><Column ss:Width="105"/><Column ss:Width="280"/><Column ss:Width="85"/><Column ss:Width="85"/><Column ss:Width="85"/>
          <Row><Cell ss:StyleID="Title"><Data ss:Type="String">LAPORAN AKHIR ${escXml(event.name.toUpperCase())} — ${escXml(grp.groupTitle.toUpperCase())}</Data></Cell></Row>
          <Row><Cell ss:StyleID="Subtitle"><Data ss:Type="String">Peserta: ${grp.groupParticipantCount} | Total Halaman Unik: ${grp.groupTotalUniquePages.toFixed(2)} | Rata-rata: ${formatScoreCell(grp.groupAverageScore)}</Data></Cell></Row>
          <Row ss:Index="4">
           <Cell ss:StyleID="Header"><Data ss:Type="String">No</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">NIS</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Nama Lengkap Santri</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Kelas</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Halaqah</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Surah dan Ayat</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Jumlah Halaman</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Nilai Rata-rata</Data></Cell>
           <Cell ss:StyleID="Header"><Data ss:Type="String">Kelengkapan Sesi</Data></Cell>
          </Row>
          ${body}
         </Table>
        </Worksheet>`;
      })
      .join('');
  }

  // Sheet Terakhir: Matriks Sesi Dinamis 1..N (atas peserta sesuai filter)
  const matrixSheetName = sanitizeSheetName('Matriks Sesi', usedSheetNames);
  const matrixSessionHeaders = validSessions
    .map(
      s => `
      <Cell ss:StyleID="Header"><Data ss:Type="String">${escXml(s.name)} (Materi)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">${escXml(s.name)} (Hal)</Data></Cell>
      <Cell ss:StyleID="Header"><Data ss:Type="String">${escXml(s.name)} (Nilai)</Data></Cell>
    `
    )
    .join('');

  const matrixBody = filteredFlatRows
    .map((r, idx) => {
      const sessCols = validSessions
        .map(s => {
          const c = r.cells.find(x => x.sessionId === s.id);
          return `
            <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(c?.rangeSummaryText || '-'))}</Data></Cell>
            ${numCell(c?.confirmedPages ?? null)}
            ${numCell(c?.score ?? null)}
          `;
        })
        .join('');

      return `
        <Row>
          <Cell ss:StyleID="CenterBorder"><Data ss:Type="Number">${idx + 1}</Data></Cell>
          <Cell ss:StyleID="CellBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(r.studentName))}</Data></Cell>
          <Cell ss:StyleID="CenterBorder"><Data ss:Type="String">${escXml(sanitizeFormulaInjection(r.className))}</Data></Cell>
          ${sessCols}
          ${numCell(r.totalUniqueVerifiedPages)}
          ${numCell(r.averageScore)}
        </Row>
      `;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#0F172A"/>
  </Style>
  <Style ss:ID="Title"><Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1" ss:Color="#065F46"/></Style>
  <Style ss:ID="Subtitle"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#334155"/></Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#064E3B"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#064E3B"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#064E3B"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#064E3B"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#065F46" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CellBorder">
   <Alignment ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
  </Style>
  <Style ss:ID="CenterBorder" ss:Parent="CellBorder">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Num2Dec" ss:Parent="CellBorder">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="0.00"/>
  </Style>
 </Styles>
 ${sheet1Xml}
 ${mainSheetsXml}
 <Worksheet ss:Name="${escXml(matrixSheetName)}">
  <Table>
   <Row><Cell ss:StyleID="Title"><Data ss:Type="String">MATRIKS MONITORING SESI — ${escXml(event.name.toUpperCase())}</Data></Cell></Row>
   <Row ss:Index="3">
    <Cell ss:StyleID="Header"><Data ss:Type="String">No</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Nama Santri</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Kelas</Data></Cell>
    ${matrixSessionHeaders}
    <Cell ss:StyleID="Header"><Data ss:Type="String">Total Halaman Unik</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Rata-rata Nilai</Data></Cell>
   </Row>
   ${matrixBody}
  </Table>
 </Worksheet>
</Workbook>`;
}

export function downloadZiyadahExcel(params: {
  filter?: ZiyadahReportFilterOptions;
  event: ZiyadahAccelEvent;
  metrics: ZiyadahAccelEventMetrics;
  sessions: ZiyadahAccelSession[];
  rows: ZiyadahAccelStudentSummaryRow[];
}): void {
  const xml = generateZiyadahExcelXML(params);
  const modeSlug = sanitizeSlug(params.filter?.mode || 'overall');
  triggerBlobDownload(
    xml,
    `Rekap_Ziyadah_Akselerasi_${modeSlug}_${sanitizeSlug(params.event.name)}.xls`,
    'application/vnd.ms-excel;charset=utf-8'
  );
}

/**
 * Menghasilkan CSV UTF-8 (+BOM \uFEFF) yang mematuhi filter aktif (Per Sesi, Per Santri, Per Kelas, Per Halaqah, Overall)
 */
export function generateZiyadahCSV(params: {
  filter?: ZiyadahReportFilterOptions;
  event: ZiyadahAccelEvent;
  sessions?: ZiyadahAccelSession[];
  rows: ZiyadahAccelStudentSummaryRow[];
}): string {
  const filter: ZiyadahReportFilterOptions = params.filter || { mode: 'overall' };
  const escCsv = (v: string) =>
    v.includes('"') || v.includes(',') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;

  const groups = buildReportGroups(filter, params.rows, params.sessions);
  const filteredFlatRows = Array.from(
    new Map(groups.flatMap(g => g.rows).map(r => [r.participantId, r])).values()
  );

  const lines: string[] = [];
  lines.push(escCsv("PONDOK PESANTREN DARUL ABROR IBS - BAGIAN TAHSIN & TAHFIDZ AL QUR'AN"));
  lines.push(escCsv(`LAPORAN: ${params.event.name} (${filter.mode.toUpperCase()})`));
  lines.push('');

  const validSessions = (params.sessions || []).filter(s => s.status !== 'cancelled');
  const targetSession =
    filter.mode === 'per_session'
      ? validSessions.find(s => s.id === filter.selectedSessionId) || validSessions[0]
      : undefined;

  if (filter.mode === 'per_session' && targetSession) {
    lines.push(
      [
        'No',
        'NIS',
        'Nama Lengkap Santri',
        'Kelas',
        'Halaqah',
        'Sesi',
        'Surah dan Ayat',
        'Jumlah Halaman',
        'Nilai Sesi',
        'Status',
        'Penguji'
      ]
        .map(escCsv)
        .join(',')
    );

    filteredFlatRows.forEach((r, i) => {
      const c = r.cells.find(x => x.sessionId === targetSession.id);
      lines.push(
        [
          String(i + 1),
          sanitizeFormulaInjection(r.nis),
          sanitizeFormulaInjection(r.studentName),
          sanitizeFormulaInjection(r.className),
          sanitizeFormulaInjection(r.halaqah),
          sanitizeFormulaInjection(targetSession.name),
          sanitizeFormulaInjection(c?.rangeSummaryText || '-'),
          c?.confirmedPages !== null && c?.confirmedPages !== undefined
            ? c.confirmedPages.toFixed(2)
            : '',
          c?.score !== null && c?.score !== undefined ? c.score.toFixed(2) : '',
          formatFulfillmentStatusIndo(c?.fulfillmentStatus, c?.verificationStatus),
          sanitizeFormulaInjection(c?.examinerName || '-')
        ]
          .map(escCsv)
          .join(',')
      );
    });
  } else if (filter.mode === 'per_student') {
    lines.push(
      [
        'No',
        'NIS',
        'Nama Lengkap Santri',
        'Kelas',
        'Sesi',
        'Surah dan Ayat',
        'Halaman Sesi',
        'Nilai Sesi',
        'Penguji'
      ]
        .map(escCsv)
        .join(',')
    );
    let counter = 1;
    filteredFlatRows.forEach(r => {
      r.cells.forEach(c => {
        lines.push(
          [
            String(counter++),
            sanitizeFormulaInjection(r.nis),
            sanitizeFormulaInjection(r.studentName),
            sanitizeFormulaInjection(r.className),
            sanitizeFormulaInjection(c.sessionName),
            sanitizeFormulaInjection(c.rangeSummaryText),
            c.confirmedPages !== null ? c.confirmedPages.toFixed(2) : '',
            c.score !== null ? c.score.toFixed(2) : '',
            sanitizeFormulaInjection(c.examinerName || '-')
          ]
            .map(escCsv)
            .join(',')
        );
      });
    });
  } else {
    lines.push(
      [
        'No',
        'NIS',
        'Nama Lengkap Santri',
        'Kelas',
        'Halaqah',
        'Surah dan Ayat',
        'Jumlah Halaman Unik',
        'Nilai Rata-rata',
        'Sesi Dinilai',
        'Total Sesi'
      ]
        .map(escCsv)
        .join(',')
    );

    filteredFlatRows.forEach((r, i) => {
      lines.push(
        [
          String(i + 1),
          sanitizeFormulaInjection(r.nis),
          sanitizeFormulaInjection(r.studentName),
          sanitizeFormulaInjection(r.className),
          sanitizeFormulaInjection(r.halaqah),
          sanitizeFormulaInjection(r.combinedRangesText),
          r.totalUniqueVerifiedPages.toFixed(2),
          r.averageScore !== null ? r.averageScore.toFixed(2) : '',
          String(r.scoredSessionCount),
          String(r.totalSessionsExpected)
        ]
          .map(escCsv)
          .join(',')
      );
    });
  }

  return '\uFEFF' + lines.join('\r\n');
}

export function downloadZiyadahCSV(params: {
  filter?: ZiyadahReportFilterOptions;
  event: ZiyadahAccelEvent;
  sessions?: ZiyadahAccelSession[];
  rows: ZiyadahAccelStudentSummaryRow[];
}): void {
  const csv = generateZiyadahCSV(params);
  const modeSlug = sanitizeSlug(params.filter?.mode || 'overall');
  triggerBlobDownload(
    csv,
    `Rekap_Ziyadah_Akselerasi_${modeSlug}_${sanitizeSlug(params.event.name)}.csv`,
    'text/csv;charset=utf-8'
  );
}
