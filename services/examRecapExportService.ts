// services/examRecapExportService.ts
// Service Ekspor Rekap Nilai UTS dan UAS (CSV & Excel XML)
// SITA — Darul Abror Islamic Boarding School

import { ExaminerStudentItem } from '../types';
import { getSessionExaminers } from './uasExaminerDisplay';

export interface UASRecapSessionLike {
  id: string;
  student_id?: string;
  studentId?: string;
  session_number?: number;
  sessionNumber?: number;
  juz_number?: number;
  juzNumber?: number;
  session_type?: string;
  sessionType?: string;
  status?: string;
  score?: number | string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  submitted_at?: string | null;
  submittedAt?: string | null;
  actual_examiner_id?: string | null;
  actualExaminerId?: string | null;
  actual_examiner_name?: string | null;
  actualExaminerName?: string | null;
  examiner_history?: unknown;
  examinerHistory?: unknown;
}

export interface StudentUASRecapSummary {
  totalSessions: number;
  submittedSessions: number;
  inProgressSessions: number;
  averageScore: number | null;
  isAllSubmitted: boolean;
  isPassed: boolean;
  statusCategory: 'PASSED' | 'FAILED' | 'IN_PROGRESS' | 'NOT_STARTED';
  statusText: string;
  materialSummary: string;
  examinerSummary: string;
  lastSubmittedAt: string | null;
  sortedSessions: UASRecapSessionLike[];
}

export function computeStudentUASRecapSummary(
  student: ExaminerStudentItem,
  sessions: UASRecapSessionLike[] | undefined,
  kkm: number
): StudentUASRecapSummary {
  const activeSessions = (sessions || [])
    .filter(ss => ss && ss.status !== 'void')
    .sort((a, b) => (a.session_number ?? a.sessionNumber ?? 0) - (b.session_number ?? b.sessionNumber ?? 0));

  if (activeSessions.length > 0) {
    const doneList = activeSessions.filter(ss => ss.status === 'submitted');
    const inProgList = activeSessions.filter(ss => ss.status === 'in_progress');
    const scoredList = doneList
      .map(ss => (ss.score !== null && ss.score !== undefined && ss.score !== '' ? Number(ss.score) : null))
      .filter((v): v is number => v !== null && !Number.isNaN(v));

    const averageScore =
      scoredList.length > 0
        ? Math.round((scoredList.reduce((acc, v) => acc + v, 0) / scoredList.length) * 100) / 100
        : null;

    const isAllSubmitted = doneList.length === activeSessions.length;
    const allPass = isAllSubmitted && doneList.every(ss => Number(ss.score || 0) >= kkm);

    let statusCategory: 'PASSED' | 'FAILED' | 'IN_PROGRESS' | 'NOT_STARTED' = 'NOT_STARTED';
    let statusText = 'Belum Ujian';
    if (isAllSubmitted) {
      statusCategory = allPass ? 'PASSED' : 'FAILED';
      statusText = `${allPass ? 'LULUS' : 'TIDAK LULUS'} (${doneList.length}/${activeSessions.length})`;
    } else if (doneList.length > 0 || inProgList.length > 0) {
      statusCategory = 'IN_PROGRESS';
      statusText = doneList.length > 0
        ? `${doneList.length}/${activeSessions.length} Sesi Selesai`
        : 'Sedang Ujian';
    }

    const materialSummary = activeSessions
      .map(ss => {
        const sNum = ss.session_number ?? ss.sessionNumber ?? 1;
        const juz = ss.juz_number ?? ss.juzNumber ?? '-';
        const typeLabel = (ss.session_type ?? ss.sessionType) === 'partial_half' ? 'Parsial' : 'Juz Penuh';
        const hasScore = ss.score !== null && ss.score !== undefined && ss.score !== '';
        const scorePart = hasScore ? Number(ss.score).toFixed(2) : (ss.status === 'in_progress' ? 'Sedang Ujian' : 'Belum');
        return `S${sNum}: Juz ${juz} (${typeLabel}) = ${scorePart}`;
      })
      .join(' | ');

    const examinerSummary = activeSessions
      .map(ss => {
        const sNum = ss.session_number ?? ss.sessionNumber ?? 1;
        const exNames = getSessionExaminers(ss).map(e => e.name);
        return `S${sNum}: ${exNames.length > 0 ? exNames.join(', ') : 'Belum ada'}`;
      })
      .join(' | ');

    const timestamps = doneList
      .map(ss => ss.submitted_at || ss.submittedAt || ss.updated_at || ss.updatedAt || null)
      .filter((t): t is string => Boolean(t))
      .sort();
    const lastSubmittedAt = timestamps.length > 0 ? timestamps[timestamps.length - 1] : (student.submittedAt || null);

    return {
      totalSessions: activeSessions.length,
      submittedSessions: doneList.length,
      inProgressSessions: inProgList.length,
      averageScore,
      isAllSubmitted,
      isPassed: allPass,
      statusCategory,
      statusText,
      materialSummary,
      examinerSummary,
      lastSubmittedAt,
      sortedSessions: activeSessions
    };
  }

  // Fallback untuk UTS / UAS single-session legacy
  const isSubmitted = student.attemptStatus === 'submitted';
  const isInProgress = student.attemptStatus === 'in_progress';
  const score = isSubmitted && student.totalScore !== null && student.totalScore !== undefined ? Number(student.totalScore) : null;
  const isPassed = isSubmitted && (score || 0) >= kkm;

  let statusCategory: 'PASSED' | 'FAILED' | 'IN_PROGRESS' | 'NOT_STARTED' = 'NOT_STARTED';
  let statusText = 'Belum Ujian';
  if (isSubmitted) {
    statusCategory = isPassed ? 'PASSED' : 'FAILED';
    statusText = isPassed ? 'LULUS' : 'TIDAK LULUS';
  } else if (isInProgress) {
    statusCategory = 'IN_PROGRESS';
    statusText = 'Sedang Ujian';
  }

  const materialSummary = student.startSurahName
    ? `${student.startSurahName} : ${student.startAyah} s.d. ${student.endSurahName} : ${student.endAyah}`
    : 'Belum difinalisasi';

  const fallbackEx = getSessionExaminers(student as any).map(e => e.name);
  const examinerSummary =
    fallbackEx.length > 0
      ? fallbackEx.join(', ')
      : student.examinerName || '-';

  return {
    totalSessions: 1,
    submittedSessions: isSubmitted ? 1 : 0,
    inProgressSessions: isInProgress ? 1 : 0,
    averageScore: score,
    isAllSubmitted: isSubmitted,
    isPassed,
    statusCategory,
    statusText,
    materialSummary,
    examinerSummary,
    lastSubmittedAt: student.submittedAt || null,
    sortedSessions: []
  };
}

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
  students: ExaminerStudentItem[],
  sessionsByStudent?: Map<string, UASRecapSessionLike[]>
): string {
  const lines: string[] = [];
  const examLabel = examType.toUpperCase();
  const isMultiSessionUAS = examType === 'uas' && Boolean(sessionsByStudent && sessionsByStudent.size > 0);

  // Metadata Header
  lines.push(escapeCSVField(`SITA - DARUL ABROR ISLAMIC BOARDING SCHOOL`));
  lines.push(escapeCSVField(`REKAPITULASI NILAI ${examLabel} TAHFIZ`));
  lines.push(escapeCSVField(`Periode: ${periodName} (KKM: ${kkm})`));
  lines.push(escapeCSVField(`Tanggal Ekspor: ${new Date().toLocaleDateString('id-ID', { dateStyle: 'full' })}`));
  lines.push('');

  if (isMultiSessionUAS) {
    const headers = [
      'No',
      'NIS',
      'Nama Santri',
      'Kelas',
      'Halaqah',
      'Guru Halaqah',
      'Jumlah Sesi',
      'Sesi Selesai',
      'Rincian Materi & Nilai Per Sesi',
      'Penguji Aktual',
      'Rata-rata Nilai UAS',
      'Status Kelulusan',
      'Waktu Selesai Terakhir'
    ];
    lines.push(headers.map(escapeCSVField).join(','));

    students.forEach((s, idx) => {
      const summary = computeStudentUASRecapSummary(s, sessionsByStudent?.get(s.studentId), kkm);
      const row = [
        String(idx + 1),
        sanitizeFormulaInjection(s.studentNis || '-'),
        sanitizeFormulaInjection(s.studentName),
        sanitizeFormulaInjection(s.class || '-'),
        sanitizeFormulaInjection(s.halaqah || '-'),
        sanitizeFormulaInjection(s.teacherName || '-'),
        String(summary.totalSessions),
        String(summary.submittedSessions),
        sanitizeFormulaInjection(summary.materialSummary),
        sanitizeFormulaInjection(summary.examinerSummary),
        summary.averageScore !== null ? formatNumericCell(summary.averageScore, 2) : '',
        summary.statusText,
        summary.lastSubmittedAt ? new Date(summary.lastSubmittedAt).toLocaleString('id-ID') : '-'
      ];
      lines.push(row.map(escapeCSVField).join(','));
    });

    return '\uFEFF' + lines.join('\r\n');
  }

  // Table Header (UTS / Single-Session Legacy)
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

  return '\uFEFF' + lines.join('\r\n');
}

export function generateExamRecapExcelXML(
  examType: 'uts' | 'uas',
  periodName: string,
  kkm: number,
  students: ExaminerStudentItem[],
  sessionsByStudent?: Map<string, UASRecapSessionLike[]>
): string {
  const examLabel = examType.toUpperCase();
  const isMultiSessionUAS = examType === 'uas' && Boolean(sessionsByStudent && sessionsByStudent.size > 0);
  const escapeXML = (str: string) => {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
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
   <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/>
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
`;

  if (isMultiSessionUAS) {
    // SHEET 1: Rekap Per Santri (selaras 100% dengan tabel UI UASRecapView)
    let sheet1Rows = '';
    // SHEET 2: Rincian Per Sesi UAS (1 baris = 1 sesi, mudah di-filter/pivot di Excel)
    let sheet2Rows = '';
    let sessionRowIdx = 0;

    students.forEach((s, idx) => {
      const summary = computeStudentUASRecapSummary(s, sessionsByStudent?.get(s.studentId), kkm);
      const statusStyle =
        summary.statusCategory === 'PASSED'
          ? 'CellLulus'
          : summary.statusCategory === 'FAILED'
            ? 'CellGagal'
            : summary.statusCategory === 'IN_PROGRESS'
              ? 'CellProses'
              : 'CellCenter';

      sheet1Rows += `   <Row ss:Height="22">
    <Cell ss:StyleID="CellCenter"><Data ss:Type="Number">${idx + 1}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.studentNis || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.studentName))}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.class || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.halaqah || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.teacherName || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="Number">${summary.totalSessions}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="Number">${summary.submittedSessions}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(summary.materialSummary))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(summary.examinerSummary))}</Data></Cell>
    <Cell ss:StyleID="${summary.averageScore !== null ? 'CellNumber' : 'CellCenter'}"><Data ss:Type="${summary.averageScore !== null ? 'Number' : 'String'}">${summary.averageScore !== null ? summary.averageScore.toFixed(2) : '-'}</Data></Cell>
    <Cell ss:StyleID="${statusStyle}"><Data ss:Type="String">${escapeXML(summary.statusText)}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${summary.lastSubmittedAt ? escapeXML(new Date(summary.lastSubmittedAt).toLocaleString('id-ID')) : '-'}</Data></Cell>
   </Row>\n`;

      if (summary.sortedSessions.length > 0) {
        summary.sortedSessions.forEach(ss => {
          sessionRowIdx++;
          const sNum = ss.session_number ?? ss.sessionNumber ?? 1;
          const juz = ss.juz_number ?? ss.juzNumber ?? '-';
          const typeLabel = (ss.session_type ?? ss.sessionType) === 'partial_half' ? 'Parsial (4 Soal)' : 'Juz Penuh (9 Soal)';
          const exNames = getSessionExaminers(ss).map(e => e.name);
          const exText = exNames.length > 0 ? exNames.join(', ') : 'Belum ada';
          const hasScore = ss.score !== null && ss.score !== undefined && ss.score !== '';
          const numericScore = hasScore ? Number(ss.score) : null;
          const isSessSubmitted = ss.status === 'submitted';
          const isSessPass = isSessSubmitted && numericScore !== null && numericScore >= kkm;

          let sessStatusText = 'Belum Ujian';
          let sessStatusStyle = 'CellCenter';
          if (isSessSubmitted) {
            sessStatusText = isSessPass ? 'LULUS' : 'TIDAK LULUS';
            sessStatusStyle = isSessPass ? 'CellLulus' : 'CellGagal';
          } else if (ss.status === 'in_progress') {
            sessStatusText = 'Sedang Ujian';
            sessStatusStyle = 'CellProses';
          }

          const sessTime = ss.submitted_at || ss.submittedAt || (isSessSubmitted ? (ss.updated_at || ss.updatedAt) : null);

          sheet2Rows += `   <Row ss:Height="20">
    <Cell ss:StyleID="CellCenter"><Data ss:Type="Number">${sessionRowIdx}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.studentNis || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.studentName))}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.class || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.halaqah || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.teacherName || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="Number">${sNum}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">Juz ${escapeXML(String(juz))}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXML(typeLabel)}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(exText))}</Data></Cell>
    <Cell ss:StyleID="${numericScore !== null ? 'CellNumber' : 'CellCenter'}"><Data ss:Type="${numericScore !== null ? 'Number' : 'String'}">${numericScore !== null ? numericScore.toFixed(2) : '-'}</Data></Cell>
    <Cell ss:StyleID="${sessStatusStyle}"><Data ss:Type="String">${escapeXML(sessStatusText)}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${sessTime ? escapeXML(new Date(sessTime).toLocaleString('id-ID')) : '-'}</Data></Cell>
   </Row>\n`;
        });
      }
    });

    // SHEET 3: Rekap Per Halaqah (siap share ke Guru Halaqah)
    const halaqahMap = new Map<string, { teacherName: string; rows: Array<{ s: ExaminerStudentItem; summary: StudentUASRecapSummary }> }>();
    students.forEach(s => {
      const hKey = (s.halaqah || 'Tanpa Halaqah').trim();
      const summary = computeStudentUASRecapSummary(s, sessionsByStudent?.get(s.studentId), kkm);
      const bucket = halaqahMap.get(hKey) || { teacherName: s.teacherName || '-', rows: [] };
      if (bucket.teacherName === '-' && s.teacherName) bucket.teacherName = s.teacherName;
      bucket.rows.push({ s, summary });
      halaqahMap.set(hKey, bucket);
    });

    let sheet3Rows = '';
    let hRowNum = 0;
    Array.from(halaqahMap.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'id'))
      .forEach(([hName, bucket]) => {
        const passedCnt = bucket.rows.filter(r => r.summary.statusCategory === 'PASSED').length;
        const failedCnt = bucket.rows.filter(r => r.summary.statusCategory === 'FAILED').length;
        const validScores = bucket.rows
          .map(r => r.summary.averageScore)
          .filter((v): v is number => v !== null && !Number.isNaN(v));
        const hAvg = validScores.length > 0
          ? (validScores.reduce((acc, v) => acc + v, 0) / validScores.length).toFixed(2)
          : '-';

        sheet3Rows += `   <Row ss:Height="22">
    <Cell ss:StyleID="HeaderSubtitle" ss:MergeAcross="8"><Data ss:Type="String">${escapeXML(hName.toUpperCase())} — Pembimbing: ${escapeXML(bucket.teacherName)} | Total: ${bucket.rows.length} Santri | Lulus: ${passedCnt} | Belum Tuntas: ${failedCnt} | Rata-rata: ${hAvg}</Data></Cell>
   </Row>\n`;

        bucket.rows.forEach(({ s, summary }, localIdx) => {
          hRowNum++;
          const statusStyle =
            summary.statusCategory === 'PASSED'
              ? 'CellLulus'
              : summary.statusCategory === 'FAILED'
                ? 'CellGagal'
                : summary.statusCategory === 'IN_PROGRESS'
                  ? 'CellProses'
                  : 'CellCenter';
          sheet3Rows += `   <Row ss:Height="20">
    <Cell ss:StyleID="CellCenter"><Data ss:Type="Number">${localIdx + 1}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.studentNis || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.studentName))}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.class || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(hName))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(summary.materialSummary))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(summary.examinerSummary))}</Data></Cell>
    <Cell ss:StyleID="${summary.averageScore !== null ? 'CellNumber' : 'CellCenter'}"><Data ss:Type="${summary.averageScore !== null ? 'Number' : 'String'}">${summary.averageScore !== null ? summary.averageScore.toFixed(2) : '-'}</Data></Cell>
    <Cell ss:StyleID="${statusStyle}"><Data ss:Type="String">${escapeXML(summary.statusText)}</Data></Cell>
   </Row>\n`;
        });
        sheet3Rows += `   <Row ss:Height="8"/>\n`;
      });

    const kopDateStr = escapeXML(new Date().toLocaleDateString('id-ID', { dateStyle: 'full' }));
    const kopRows = `   <Row ss:Height="24">
    <Cell ss:StyleID="HeaderTitle"><Data ss:Type="String">PONDOK PESANTREN DARUL ABROR ISLAMIC BOARDING SCHOOL</Data></Cell>
   </Row>
   <Row ss:Height="19">
    <Cell ss:StyleID="HeaderSubtitle"><Data ss:Type="String">BAGIAN TAHSIN &amp; TAHFIDZ AL QUR'AN</Data></Cell>
   </Row>
   <Row ss:Height="16">
    <Cell><Data ss:Type="String">Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell><Data ss:Type="String">Periode: ${escapeXML(periodName)} | Standar KKM: ${kkm} | Dicetak: ${kopDateStr}</Data></Cell>
   </Row>
   <Row ss:Height="10"/>`;

    const signatureRows = `   <Row ss:Height="14"/>
   <Row ss:Height="18">
    <Cell ss:Index="8"><Data ss:Type="String">Garut, ${kopDateStr}</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell ss:Index="8"><Data ss:Type="String">Bagian Tahsin &amp; Tahfidz Al Qur'an</Data></Cell>
   </Row>
   <Row ss:Height="18">
    <Cell ss:Index="8"><Data ss:Type="String">Ma'had Darul Abror Islamic Boarding School</Data></Cell>
   </Row>
   <Row ss:Height="36"/>
   <Row ss:Height="20">
    <Cell ss:Index="8" ss:StyleID="HeaderSubtitle"><Data ss:Type="String">Parhan Mubarok, S.Ag</Data></Cell>
   </Row>`;

    return `${stylesXml} <Worksheet ss:Name="Rekap Nilai UAS">
  <Table ss:DefaultRowHeight="20">
   <Column ss:Width="35"/>
   <Column ss:Width="65"/>
   <Column ss:Width="175"/>
   <Column ss:Width="55"/>
   <Column ss:Width="95"/>
   <Column ss:Width="125"/>
   <Column ss:Width="65"/>
   <Column ss:Width="65"/>
   <Column ss:Width="260"/>
   <Column ss:Width="190"/>
   <Column ss:Width="85"/>
   <Column ss:Width="105"/>
   <Column ss:Width="125"/>

${kopRows}

   <Row ss:Height="28">
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">No</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">NIS</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Nama Santri</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Kelas</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Halaqah</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Guru Halaqah</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Total Sesi</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Selesai</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Rincian Materi &amp; Nilai Per Sesi</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Penguji Aktual</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Rata-rata UAS</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Status Kelulusan</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Waktu Submit</Data></Cell>
   </Row>
${sheet1Rows}${signatureRows}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="Rincian Per Sesi UAS">
  <Table ss:DefaultRowHeight="20">
   <Column ss:Width="35"/>
   <Column ss:Width="65"/>
   <Column ss:Width="175"/>
   <Column ss:Width="55"/>
   <Column ss:Width="95"/>
   <Column ss:Width="125"/>
   <Column ss:Width="55"/>
   <Column ss:Width="65"/>
   <Column ss:Width="110"/>
   <Column ss:Width="160"/>
   <Column ss:Width="75"/>
   <Column ss:Width="95"/>
   <Column ss:Width="125"/>

${kopRows}

   <Row ss:Height="26">
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">No</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">NIS</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Nama Santri</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Kelas</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Halaqah</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Guru Halaqah</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Sesi</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Juz</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Jenis Sesi</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Penguji Aktual</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Nilai Sesi</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Status Sesi</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Waktu Submit</Data></Cell>
   </Row>
${sheet2Rows}  </Table>
 </Worksheet>
 <Worksheet ss:Name="Rekap Per Halaqah">
  <Table ss:DefaultRowHeight="20">
   <Column ss:Width="35"/>
   <Column ss:Width="65"/>
   <Column ss:Width="175"/>
   <Column ss:Width="55"/>
   <Column ss:Width="105"/>
   <Column ss:Width="260"/>
   <Column ss:Width="185"/>
   <Column ss:Width="85"/>
   <Column ss:Width="105"/>

${kopRows}

   <Row ss:Height="26">
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">No</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">NIS</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Nama Santri</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Kelas</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Halaqah</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Rincian Materi &amp; Nilai Per Sesi</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Penguji Aktual</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Rata-rata UAS</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Status Kelulusan</Data></Cell>
   </Row>
${sheet3Rows}${signatureRows}
  </Table>
 </Worksheet>
</Workbook>`;
  }

  // UTS / Single-Session Legacy XML
  const xmlHeader = `${stylesXml} <Worksheet ss:Name="Rekap Nilai ${examLabel}">
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
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.studentNis || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.studentName))}</Data></Cell>
    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.class || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.halaqah || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.teacherName || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(s.examinerName || s.teacherName || '-'))}</Data></Cell>
    <Cell ss:StyleID="CellText"><Data ss:Type="String">${escapeXML(sanitizeFormulaInjection(materialText))}</Data></Cell>
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
