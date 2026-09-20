// services/examRecapExportService.ts
// Service Ekspor Rekap Nilai UTS dan UAS (CSV & Excel XML)
// SITA — Darul Abror Islamic Boarding School

import { ExaminerStudentItem } from '../types';

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

export function formatNumericCell(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined || isNaN(Number(val))) {
    return '';
  }
  return Number(val).toFixed(decimals);
}

function escapeCSVField(val: string): string {
  if (val.includes('"') || val.includes(',') || val.includes(';') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function generateExamRecapCSV(
  examType: 'uts' | 'uas',
  periodName: string,
  kkm: number,
  students: ExaminerStudentItem[]
): string {
  const lines: string[] = [];
  const examLabel = examType.toUpperCase();

  // Metadata Header
  lines.push(escapeCSVField(`SITA - DARUL ABROR ISLAMIC BOARDING SCHOOL`));
  lines.push(escapeCSVField(`REKAPITULASI NILAI ${examLabel} TAHFIZ`));
  lines.push(escapeCSVField(`Periode: ${periodName} (KKM: ${kkm})`));
  lines.push(escapeCSVField(`Tanggal Ekspor: ${new Date().toLocaleDateString('id-ID', { dateStyle: 'full' })}`));
  lines.push('');

  // Table Header
  const headers = [
    'No',
    'NIS',
    'Nama Santri',
    'Kelas',
    'Halaqah',
    'Guru Halaqah',
    'Penguji',
    `Materi Ujian ${examLabel}`,
    `Nilai ${examLabel}`,
    'Status Kelulusan',
    'Waktu Selesai'
  ];
  lines.push(headers.map(escapeCSVField).join(','));

  // Rows
  students.forEach((s, idx) => {
    const isSubmitted = s.attemptStatus === 'submitted';
    const score = isSubmitted ? (s.totalScore ?? '') : '';
    let statusText = 'Belum Ujian';
    if (s.attemptStatus === 'in_progress') statusText = 'Sedang Ujian';
    else if (isSubmitted) {
      statusText = (s.totalScore || 0) >= kkm ? 'LULUS' : 'TIDAK LULUS';
    }

    const materialText = s.startSurahName 
      ? `${s.startSurahName} : ${s.startAyah} s.d. ${s.endSurahName} : ${s.endAyah}`
      : 'Belum difinalisasi';

    const row = [
      String(idx + 1),
      sanitizeFormulaInjection(s.studentNis || '-'),
      sanitizeFormulaInjection(s.studentName),
      sanitizeFormulaInjection(s.class || '-'),
      sanitizeFormulaInjection(s.halaqah || '-'),
      sanitizeFormulaInjection(s.teacherName || '-'),
      sanitizeFormulaInjection(s.examinerName || s.teacherName || '-'),
      sanitizeFormulaInjection(materialText),
      isSubmitted ? formatNumericCell(s.totalScore, 2) : '',
      statusText,
      s.submittedAt ? new Date(s.submittedAt).toLocaleString('id-ID') : '-'
    ];
    lines.push(row.map(escapeCSVField).join(','));
  });

  return lines.join('\r\n');
}

export function generateExamRecapExcelXML(
  examType: 'uts' | 'uas',
  periodName: string,
  kkm: number,
  students: ExaminerStudentItem[]
): string {
  const examLabel = examType.toUpperCase();
  const escapeXML = (str: string) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const xmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
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
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="HeaderSubtitle">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#334155"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
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
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
  </Style>
  <Style ss:ID="CellCenter">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
  </Style>
  <Style ss:ID="CellNumber">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="0.00"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
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
 </Styles>
 <Worksheet ss:Name="Rekap Nilai ${examLabel}">
  <Table ss:DefaultRowHeight="20">
   <Column ss:Width="35"/>
   <Column ss:Width="65"/>
   <Column ss:Width="180"/>
   <Column ss:Width="55"/>
   <Column ss:Width="95"/>
   <Column ss:Width="130"/>
   <Column ss:Width="130"/>
   <Column ss:Width="180"/>
   <Column ss:Width="75"/>
   <Column ss:Width="90"/>
   <Column ss:Width="120"/>

   <Row ss:Height="24">
    <Cell ss:StyleID="HeaderTitle"><Data ss:Type="String">SITA - DARUL ABROR ISLAMIC BOARDING SCHOOL</Data></Cell>
   </Row>
   <Row ss:Height="20">
    <Cell ss:StyleID="HeaderSubtitle"><Data ss:Type="String">REKAPITULASI NILAI ${examLabel} TAHFIZ AL-QUR'AN</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell><Data ss:Type="String">Periode: ${escapeXML(periodName)} | Standar KKM: ${kkm}</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell><Data ss:Type="String">Dicetak pada: ${escapeXML(new Date().toLocaleDateString('id-ID', { dateStyle: 'full' }))}</Data></Cell>
   </Row>
   <Row ss:Height="10"/>

   <Row ss:Height="26">
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">No</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">NIS</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Nama Santri</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Kelas</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Halaqah</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Guru Halaqah</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Penguji</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Materi Ujian ${examLabel}</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Nilai ${examLabel}</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Status</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Waktu Submit</Data></Cell>
   </Row>
`;

  let rowsXml = '';
  students.forEach((s, idx) => {
    const isSubmitted = s.attemptStatus === 'submitted';
    const isPassed = isSubmitted && (s.totalScore || 0) >= kkm;
    let statusStyle = 'CellCenter';
    let statusText = 'Belum Ujian';

    if (s.attemptStatus === 'in_progress') {
      statusText = 'Sedang Ujian';
    } else if (isSubmitted) {
      statusText = isPassed ? 'LULUS' : 'TIDAK LULUS';
      statusStyle = isPassed ? 'CellLulus' : 'CellGagal';
    }

    const materialText = s.startSurahName 
      ? `${s.startSurahName} : ${s.startAyah} s.d. ${s.endSurahName} : ${s.endAyah}`
      : 'Belum difinalisasi';

    rowsXml += `   <Row ss:Height="20">
    <Cell ss:StyleID="CellCenter"><Data ss:Type="Number">${idx + 1}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXML(s.studentNis || '-')}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(s.studentName)}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXML(s.class || '-')}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(s.halaqah || '-')}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(s.teacherName || '-')}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(s.examinerName || s.teacherName || '-')}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(materialText)}</Data></Cell>
    <Cell ss:StyleID="${isSubmitted ? 'CellNumber' : 'CellCenter'}"><Data ss:Type="${isSubmitted ? 'Number' : 'String'}">${isSubmitted ? (s.totalScore ?? 0) : '-'}</Data></Cell>
    <Cell ss:StyleID="${statusStyle}"><Data ss:Type="String">${escapeXML(statusText)}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${s.submittedAt ? escapeXML(new Date(s.submittedAt).toLocaleString('id-ID')) : '-'}</Data></Cell>
   </Row>\n`;
  });

  const xmlFooter = `  </Table>
 </Worksheet>
</Workbook>`;

  return xmlHeader + rowsXml + xmlFooter;
}
