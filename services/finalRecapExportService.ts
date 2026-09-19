// services/finalRecapExportService.ts
// Service Ekspor Rekap Final Evaluasi Semester (CSV & Excel XML)
// SITA — Darul Abror Islamic Boarding School (Tahap 7D)

import { FinalSemesterRecapItem, FinalSemesterMonitoringStats } from '../types';

/**
 * Sanitasi Formula Injection untuk spreadsheet (Excel / CSV)
 * Melindungi dari eksekusi formula berbahaya jika teks diawali =, +, -, @
 */
export function sanitizeFormulaInjection(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (str.length === 0) return '';
  const firstChar = str.charAt(0);
  if (['=', '+', '-', '@', '\t', '\r'].includes(firstChar)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Format sel numerik untuk ekspor
 * Jika NULL/undefined -> string kosong (BUKAN 0!)
 */
export function formatNumericCell(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined || isNaN(Number(val))) {
    return '';
  }
  return Number(val).toFixed(decimals);
}

/**
 * Escape string untuk format CSV (RFC 4180)
 */
function escapeCSVField(val: string): string {
  if (val.includes('"') || val.includes(',') || val.includes(';') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Generate string CSV lengkap
 */
export function generateFinalRecapCSV(
  items: FinalSemesterRecapItem[],
  summary?: FinalSemesterMonitoringStats,
  config?: any
): string {
  const lines: string[] = [];

  // Metadata Header
  lines.push(escapeCSVField(`SITA - DARUL ABROR ISLAMIC BOARDING SCHOOL`));
  lines.push(escapeCSVField(`REKAPITULASI NILAI TAHFIZ SEMESTER FINAL`));
  if (config) {
    lines.push(escapeCSVField(`Tahun Akademik / Semester: ${config.academicYear || ''} ${config.semester || ''}`));
    lines.push(escapeCSVField(`Periode UTS: ${config.utsPeriodName || ''} (KKM: ${config.utsKkm || 70}, Bobot: ${config.utsWeight || 40}%)`));
    lines.push(escapeCSVField(`Periode UAS: ${config.uasPeriodName || ''} (KKM: ${config.uasKkm || 70}, Bobot: ${config.uasWeight || 60}%)`));
  }
  lines.push(''); // Baris kosong pemisah

  // Header Kolom Tabel
  const headers = [
    'No',
    'NIS',
    'Nama Santri',
    'Kelas',
    'Halaqah',
    'UTS Original',
    'UTS Remedial',
    'UTS Efektif',
    'Sumber UTS',
    'Status UTS',
    'UAS Original',
    'UAS Remedial',
    'UAS Efektif',
    'Sumber UAS',
    'Status UAS',
    'Bobot UTS (%)',
    'Bobot UAS (%)',
    'Nilai Akhir Semester',
    'Status Kelulusan Semester'
  ];
  lines.push(headers.map(escapeCSVField).join(','));

  // Data Rows
  items.forEach((item, index) => {
    const row = [
      String(index + 1),
      sanitizeFormulaInjection(item.nis),
      sanitizeFormulaInjection(item.studentName),
      sanitizeFormulaInjection(item.class),
      sanitizeFormulaInjection(item.halaqah),
      formatNumericCell(item.utsOriginalScore),
      formatNumericCell(item.utsRemedialScore),
      formatNumericCell(item.utsEffectiveScore),
      item.utsEffectiveSource || 'NONE',
      item.utsStatus || 'BELUM_UJIAN',
      formatNumericCell(item.uasOriginalScore),
      formatNumericCell(item.uasRemedialScore),
      formatNumericCell(item.uasEffectiveScore),
      item.uasEffectiveSource || 'NONE',
      item.uasStatus || 'BELUM_UJIAN',
      formatNumericCell(item.utsWeight, 0),
      formatNumericCell(item.uasWeight, 0),
      formatNumericCell(item.semesterFinalScore),
      item.semesterStatus || 'BELUM_LENGKAP'
    ];
    lines.push(row.map(escapeCSVField).join(','));
  });

  // Summary Section
  if (summary) {
    lines.push('');
    lines.push(escapeCSVField('RINGKASAN EKSEKUTIF SEMESTER'));
    lines.push(`${escapeCSVField('Total Santri Evaluasi')},${summary.totalStudents || 0}`);
    lines.push(`${escapeCSVField('Tuntas (Total)')},${summary.tuntasCount || 0}`);
    lines.push(`${escapeCSVField('Tuntas via Remedial')},${summary.tuntasViaRemedialCount || 0}`);
    lines.push(`${escapeCSVField('Perlu Remedial')},${summary.perluRemedialCount || 0}`);
    lines.push(`${escapeCSVField('Sedang Remedial')},${summary.sedangRemedialCount || 0}`);
    lines.push(`${escapeCSVField('Belum Tuntas Setelah Remedial')},${summary.belumTuntasSetelahRemedialCount || 0}`);
    lines.push(`${escapeCSVField('Belum Lengkap / Belum Selesai')},${summary.belumLengkapCount || 0}`);
  }

  // Prepend UTF-8 BOM agar Excel membukanya dengan encoding UTF-8 yang sempurna
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Generate SpreadsheetML XML (Dikenal Excel sebagai berkas XML Spreadsheet resmi)
 * Mendukung multiple sheets, style warna, header beku, dan sel numerik asli.
 */
export function generateFinalRecapSpreadsheetXML(
  items: FinalSemesterRecapItem[],
  summary?: FinalSemesterMonitoringStats,
  config?: any
): string {
  const xmlEscape = (str: string) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const rowsXml: string[] = [];

  // Header Title Rows
  rowsXml.push(`
    <Row>
      <Cell ss:StyleID="HeaderTitle"><Data ss:Type="String">SITA - DARUL ABROR ISLAMIC BOARDING SCHOOL</Data></Cell>
    </Row>
    <Row>
      <Cell ss:StyleID="HeaderSubtitle"><Data ss:Type="String">REKAPITULASI NILAI TAHFIZ SEMESTER FINAL</Data></Cell>
    </Row>
    <Row>
      <Cell><Data ss:Type="String">Tahun Akademik: ${xmlEscape(config?.academicYear || '')} Semester: ${xmlEscape(config?.semester || '')}</Data></Cell>
    </Row>
    <Row>
      <Cell><Data ss:Type="String">Bobot: UTS ${config?.utsWeight || 40}% | UAS ${config?.uasWeight || 60}%</Data></Cell>
    </Row>
    <Row ss:Index="6">
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">No</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">NIS</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Nama Santri</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Kelas</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Halaqah</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">UTS Original</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">UTS Remedial</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">UTS Efektif</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Status UTS</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">UAS Original</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">UAS Remedial</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">UAS Efektif</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Status UAS</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Bobot UTS (%)</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Bobot UAS (%)</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Nilai Akhir Semester</Data></Cell>
      <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Status Kelulusan Semester</Data></Cell>
    </Row>
  `);

  // Data rows
  items.forEach((item, index) => {
    const nisSafe = xmlEscape(sanitizeFormulaInjection(item.nis));
    const nameSafe = xmlEscape(sanitizeFormulaInjection(item.studentName));
    const classSafe = xmlEscape(sanitizeFormulaInjection(item.class));
    const halaqahSafe = xmlEscape(sanitizeFormulaInjection(item.halaqah));
    const utsStatus = xmlEscape(item.utsStatus || 'BELUM_UJIAN');
    const uasStatus = xmlEscape(item.uasStatus || 'BELUM_UJIAN');
    const semStatus = xmlEscape(item.semesterStatus || 'BELUM_LENGKAP');

    const cellNumber = (val: number | null | undefined) => {
      if (val === null || val === undefined || isNaN(Number(val))) {
        return `<Cell><Data ss:Type="String"></Data></Cell>`;
      }
      return `<Cell ss:StyleID="Num2Dec"><Data ss:Type="Number">${Number(val).toFixed(2)}</Data></Cell>`;
    };

    rowsXml.push(`
      <Row>
        <Cell ss:StyleID="CenterText"><Data ss:Type="Number">${index + 1}</Data></Cell>
        <Cell ss:StyleID="CenterText"><Data ss:Type="String">${nisSafe}</Data></Cell>
        <Cell><Data ss:Type="String">${nameSafe}</Data></Cell>
        <Cell ss:StyleID="CenterText"><Data ss:Type="String">${classSafe}</Data></Cell>
        <Cell><Data ss:Type="String">${halaqahSafe}</Data></Cell>
        ${cellNumber(item.utsOriginalScore)}
        ${cellNumber(item.utsRemedialScore)}
        ${cellNumber(item.utsEffectiveScore)}
        <Cell ss:StyleID="CenterText"><Data ss:Type="String">${utsStatus}</Data></Cell>
        ${cellNumber(item.uasOriginalScore)}
        ${cellNumber(item.uasRemedialScore)}
        ${cellNumber(item.uasEffectiveScore)}
        <Cell ss:StyleID="CenterText"><Data ss:Type="String">${uasStatus}</Data></Cell>
        <Cell ss:StyleID="CenterText"><Data ss:Type="Number">${item.utsWeight || 40}</Data></Cell>
        <Cell ss:StyleID="CenterText"><Data ss:Type="Number">${item.uasWeight || 60}</Data></Cell>
        ${cellNumber(item.semesterFinalScore)}
        <Cell ss:StyleID="CenterText"><Data ss:Type="String">${semStatus}</Data></Cell>
      </Row>
    `);
  });

  // Summary sheet rows
  const summaryRowsXml: string[] = [];
  if (summary) {
    summaryRowsXml.push(`
      <Row>
        <Cell ss:StyleID="HeaderTitle"><Data ss:Type="String">RINGKASAN EKSEKUTIF EVALUASI SEMESTER</Data></Cell>
      </Row>
      <Row ss:Index="3">
        <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Indikator Evaluasi</Data></Cell>
        <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Jumlah Santri</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Total Santri Terdaftar</Data></Cell>
        <Cell ss:StyleID="CenterText"><Data ss:Type="Number">${summary.totalStudents || 0}</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Tuntas Seluruh Komponen</Data></Cell>
        <Cell ss:StyleID="CenterText"><Data ss:Type="Number">${summary.tuntasCount || 0}</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Tuntas via Ujian Remedial</Data></Cell>
        <Cell ss:StyleID="CenterText"><Data ss:Type="Number">${summary.tuntasViaRemedialCount || 0}</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Perlu Remedial (Belum Dijadwalkan)</Data></Cell>
        <Cell ss:StyleID="CenterText"><Data ss:Type="Number">${summary.perluRemedialCount || 0}</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Sedang / Dijadwalkan Remedial</Data></Cell>
        <Cell ss:StyleID="CenterText"><Data ss:Type="Number">${summary.sedangRemedialCount || 0}</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Belum Tuntas Setelah Remedial</Data></Cell>
        <Cell ss:StyleID="CenterText"><Data ss:Type="Number">${summary.belumTuntasSetelahRemedialCount || 0}</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Belum Lengkap (Belum Mengikuti UTS/UAS)</Data></Cell>
        <Cell ss:StyleID="CenterText"><Data ss:Type="Number">${summary.belumLengkapCount || 0}</Data></Cell>
      </Row>
    `);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="HeaderTitle">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="16" ss:Bold="1" ss:Color="#0F766E"/>
  </Style>
  <Style ss:ID="HeaderSubtitle">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="12" ss:Bold="1" ss:Color="#334155"/>
  </Style>
  <Style ss:ID="ColHeader">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
   </Borders>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F766E" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="CenterText">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Num2Dec">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="0.00"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Rekap Nilai Final">
  <Table ss:DefaultColumnWidth="80" ss:DefaultRowHeight="20">
   <Column ss:Width="35"/>
   <Column ss:Width="65"/>
   <Column ss:Width="160"/>
   <Column ss:Width="50"/>
   <Column ss:Width="90"/>
   <Column ss:Width="70"/>
   <Column ss:Width="70"/>
   <Column ss:Width="70"/>
   <Column ss:Width="130"/>
   <Column ss:Width="70"/>
   <Column ss:Width="70"/>
   <Column ss:Width="70"/>
   <Column ss:Width="130"/>
   <Column ss:Width="75"/>
   <Column ss:Width="75"/>
   <Column ss:Width="90"/>
   <Column ss:Width="140"/>
   ${rowsXml.join('\n')}
  </Table>
 </Worksheet>
 ${summary ? `
 <Worksheet ss:Name="Ringkasan Eksekutif">
  <Table ss:DefaultColumnWidth="120" ss:DefaultRowHeight="20">
   <Column ss:Width="250"/>
   <Column ss:Width="100"/>
   ${summaryRowsXml.join('\n')}
  </Table>
 </Worksheet>` : ''}
</Workbook>`;
}

/**
 * Trigger download file di browser
 */
export function downloadExportFile(content: string, filename: string, mimeType: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 150);
}
