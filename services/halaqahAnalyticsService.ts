import { Student, TahfidzRecord, User } from '../types';

export type HalaqahPeriodType = 'daily' | 'weekly' | 'monthly' | 'semester' | 'custom';

export interface DateRange {
  startDate: Date;
  endDate: Date;
  label: string;
  previousStartDate: Date;
  previousEndDate: Date;
  previousLabel: string;
  startDateStr?: string;
  endDateStrExclusive?: string;
  previousStartDateStr?: string;
  previousEndDateStrExclusive?: string;
}

export type TrendStatus = 'up' | 'down' | 'stable' | 'no_data';

export interface HalaqahStudentSummary {
  student: Student;
  totalJuz: number;
  setoranCount: number;
  ziyadahCount: number;
  murojaahCount: number;
  lastRecord?: TahfidzRecord;
  activityStatus: 'active' | 'moderate' | 'inactive';
}

export interface HalaqahDetailData {
  name: string;
  teacherId: string;
  teacherName: string;
  studentsCount: number;
  students: Student[];
  studentsSummaries: HalaqahStudentSummary[];
  totalJuz: number;
  averageJuz: number;
  // Current period stats
  totalSetoran: number;
  ziyadahCount: number;
  murojaahCount: number;
  // Previous period stats
  previousTotalSetoran: number;
  previousZiyadahCount: number;
  previousMurojaahCount: number;
  // Trend
  trend: TrendStatus;
  trendPercentage: number | null;
  // Pertambahan hafalan info
  pertambahanHafalanInfo: string;
}

export interface OverallHalaqahStats {
  totalActiveHalaqah: number;
  totalActiveStudents: number;
  totalSetoranInPeriod: number;
  totalZiyadahInPeriod: number;
  totalMurojaahInPeriod: number;
  totalJuzAllHalaqah: number;
  averageJuzPerStudent: number;
  halaqahIncreasingCount: number;
  halaqahDecreasingCount: number;
  halaqahStableCount: number;
  halaqahNoDataCount: number;
  periodLabel: string;
  previousPeriodLabel: string;
}

export function formatDateShort(d: Date): string {
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function extractJakartaDateString(dateInput: string | Date): string {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    if (trimmed.includes('T')) {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(d);
      }
      return trimmed.split('T')[0];
    }
  }
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/**
 * Menghitung rentang tanggal periode berjalan dan periode pembanding sebelumnya.
 * Untuk bulanan: awal inklusif tanggal 1 00:00:00, akhir eksklusif tanggal 1 bulan berikutnya 00:00:00 (Asia/Jakarta).
 */
export function calculateDateRange(
  periodType: HalaqahPeriodType,
  options?: {
    customStartDate?: string;
    customEndDate?: string;
    selectedMonth?: string; // YYYY-MM
    selectedWeek?: string;  // YYYY-Www
    selectedSemesterYear?: number;
    selectedSemesterType?: 'ganjil' | 'genap';
  }
): DateRange {
  const now = new Date();
  let startDate: Date;
  let endDate: Date;
  let label = '';

  if (periodType === 'daily') {
    // 7 hari terakhir (sampai besok 00:00 eksklusif)
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0);
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const displayEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    label = `7 Hari Terakhir (${formatDateShort(startDate)} - ${formatDateShort(displayEndDate)})`;

    const previousStartDate = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const previousEndDate = new Date(startDate);
    const prevDisplayEnd = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
    const previousLabel = `${formatDateShort(previousStartDate)} - ${formatDateShort(prevDisplayEnd)}`;

    return {
      startDate,
      endDate,
      label,
      previousStartDate,
      previousEndDate,
      previousLabel,
      startDateStr: formatLocalDateStr(startDate),
      endDateStrExclusive: formatLocalDateStr(endDate),
      previousStartDateStr: formatLocalDateStr(previousStartDate),
      previousEndDateStrExclusive: formatLocalDateStr(previousEndDate)
    };
  } else if (periodType === 'weekly') {
    // 4 pekan terakhir (28 hari, sampai besok 00:00 eksklusif)
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 27, 0, 0, 0);
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const displayEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    label = `4 Pekan Terakhir (${formatDateShort(startDate)} - ${formatDateShort(displayEndDate)})`;

    const previousStartDate = new Date(startDate.getTime() - 28 * 24 * 60 * 60 * 1000);
    const previousEndDate = new Date(startDate);
    const prevDisplayEnd = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
    const previousLabel = `${formatDateShort(previousStartDate)} - ${formatDateShort(prevDisplayEnd)}`;

    return {
      startDate,
      endDate,
      label,
      previousStartDate,
      previousEndDate,
      previousLabel,
      startDateStr: formatLocalDateStr(startDate),
      endDateStrExclusive: formatLocalDateStr(endDate),
      previousStartDateStr: formatLocalDateStr(previousStartDate),
      previousEndDateStrExclusive: formatLocalDateStr(previousEndDate)
    };
  } else if (periodType === 'monthly') {
    const monthStr = options?.selectedMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [year, month] = monthStr.split('-').map(Number);
    // Awal inklusif: tanggal 1 pukul 00:00:00 Asia/Jakarta
    startDate = new Date(year, month - 1, 1, 0, 0, 0);
    // Akhir eksklusif: tanggal 1 bulan berikutnya pukul 00:00:00 Asia/Jakarta
    endDate = new Date(year, month, 1, 0, 0, 0);
    label = `Bulan ${startDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`;

    // Periode pembanding kalender 1 bulan penuh sebelumnya
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const previousStartDate = new Date(prevYear, prevMonth - 1, 1, 0, 0, 0);
    const previousEndDate = new Date(prevYear, prevMonth, 1, 0, 0, 0);
    const previousLabel = `Bulan ${previousStartDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`;

    const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonthYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const endDateStrExclusive = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`;

    const previousStartDateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
    const previousEndDateStrExclusive = startDateStr;

    return {
      startDate,
      endDate,
      label,
      previousStartDate,
      previousEndDate,
      previousLabel,
      startDateStr,
      endDateStrExclusive,
      previousStartDateStr,
      previousEndDateStrExclusive
    };
  } else if (periodType === 'semester') {
    const sYear = options?.selectedSemesterYear || now.getFullYear();
    const sType = options?.selectedSemesterType || (now.getMonth() >= 6 ? 'ganjil' : 'genap');
    if (sType === 'ganjil') {
      startDate = new Date(sYear, 6, 1, 0, 0, 0); // 1 Juli
      endDate = new Date(sYear + 1, 0, 1, 0, 0, 0); // 1 Jan tahun berikutnya eksklusif
      label = `Semester Ganjil ${sYear} (Jul - Des)`;

      const previousStartDate = new Date(sYear, 0, 1, 0, 0, 0);
      const previousEndDate = new Date(sYear, 6, 1, 0, 0, 0);
      const previousLabel = `Semester Genap ${sYear} (Jan - Jun)`;

      const startDateStr = `${sYear}-07-01`;
      const endDateStrExclusive = `${sYear + 1}-01-01`;
      const previousStartDateStr = `${sYear}-01-01`;
      const previousEndDateStrExclusive = startDateStr;

      return {
        startDate,
        endDate,
        label,
        previousStartDate,
        previousEndDate,
        previousLabel,
        startDateStr,
        endDateStrExclusive,
        previousStartDateStr,
        previousEndDateStrExclusive
      };
    } else {
      startDate = new Date(sYear, 0, 1, 0, 0, 0); // 1 Jan
      endDate = new Date(sYear, 6, 1, 0, 0, 0); // 1 Juli eksklusif
      label = `Semester Genap ${sYear} (Jan - Jun)`;

      const previousStartDate = new Date(sYear - 1, 6, 1, 0, 0, 0);
      const previousEndDate = new Date(sYear, 0, 1, 0, 0, 0);
      const previousLabel = `Semester Ganjil ${sYear - 1} (Jul - Des)`;

      const startDateStr = `${sYear}-01-01`;
      const endDateStrExclusive = `${sYear}-07-01`;
      const previousStartDateStr = `${sYear - 1}-07-01`;
      const previousEndDateStrExclusive = startDateStr;

      return {
        startDate,
        endDate,
        label,
        previousStartDate,
        previousEndDate,
        previousLabel,
        startDateStr,
        endDateStrExclusive,
        previousStartDateStr,
        previousEndDateStrExclusive
      };
    }
  } else {
    // Custom date range
    if (options?.customStartDate && options?.customEndDate) {
      const [sy, sm, sd] = options.customStartDate.split('-').map(Number);
      const [ey, em, ed] = options.customEndDate.split('-').map(Number);
      startDate = new Date(sy, sm - 1, sd, 0, 0, 0);
      endDate = new Date(ey, em - 1, ed + 1, 0, 0, 0); // Akhir eksklusif
      const displayEndDate = new Date(ey, em - 1, ed, 0, 0, 0);
      label = `${formatDateShort(startDate)} - ${formatDateShort(displayEndDate)}`;

      const durationMs = endDate.getTime() - startDate.getTime();
      const previousEndDate = new Date(startDate);
      const previousStartDate = new Date(previousEndDate.getTime() - durationMs);
      const prevDisplayEnd = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
      const previousLabel = `${formatDateShort(previousStartDate)} - ${formatDateShort(prevDisplayEnd)}`;

      return {
        startDate,
        endDate,
        label,
        previousStartDate,
        previousEndDate,
        previousLabel,
        startDateStr: formatLocalDateStr(startDate),
        endDateStrExclusive: formatLocalDateStr(endDate),
        previousStartDateStr: formatLocalDateStr(previousStartDate),
        previousEndDateStrExclusive: formatLocalDateStr(previousEndDate)
      };
    } else {
      // Default ke bulan berjalan
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      startDate = new Date(year, month - 1, 1, 0, 0, 0);
      endDate = new Date(year, month, 1, 0, 0, 0);
      label = `Bulan ${startDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`;

      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;
      const previousStartDate = new Date(prevYear, prevMonth - 1, 1, 0, 0, 0);
      const previousEndDate = new Date(prevYear, prevMonth, 1, 0, 0, 0);
      const previousLabel = `Bulan ${previousStartDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`;

      const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const nextMonthYear = month === 12 ? year + 1 : year;
      const nextMonth = month === 12 ? 1 : month + 1;
      const endDateStrExclusive = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`;

      return {
        startDate,
        endDate,
        label,
        previousStartDate,
        previousEndDate,
        previousLabel,
        startDateStr,
        endDateStrExclusive,
        previousStartDateStr: `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`,
        previousEndDateStrExclusive: startDateStr
      };
    }
  }
}

/**
 * Filter data setoran apakah berada dalam rentang tanggal tertentu.
 * Default exclusiveEnd = true (eksklusif di batas akhir tanggal).
 */
export function isRecordInDateRange(
  recordDateStr: string,
  startDate: Date | string,
  endDate: Date | string,
  exclusiveEnd = true
): boolean {
  if (!recordDateStr) return false;
  const recDate = extractJakartaDateString(recordDateStr);
  if (!recDate) return false;

  const startStr = typeof startDate === 'string'
    ? extractJakartaDateString(startDate)
    : formatLocalDateStr(startDate);
  const endStr = typeof endDate === 'string'
    ? extractJakartaDateString(endDate)
    : formatLocalDateStr(endDate);

  if (exclusiveEnd) {
    return recDate >= startStr && recDate < endStr;
  }
  return recDate >= startStr && recDate <= endStr;
}

/**
 * Memeriksa apakah tipe setoran adalah hafalan baru (sabaq / ziyadah)
 */
export function isNewHafalan(type: string): boolean {
  const t = (type || '').toLowerCase();
  return t === 'sabaq' || t === 'ziyadah';
}

/**
 * Memeriksa apakah tipe setoran adalah muroja'ah (sabqi / manzil / murojaah)
 */
export function isMurojaah(type: string): boolean {
  const t = (type || '').toLowerCase();
  return t === 'sabqi' || t === 'manzil' || t === 'murojaah';
}

/**
 * Analisis lengkap data setiap halaqah dengan aman dan murni membaca data (tanpa mutasi).
 */
export function analyzeHalaqahData(
  students: Student[],
  records: TahfidzRecord[],
  users: User[] = [],
  dateRange: DateRange,
  filters?: {
    halaqahName?: string;
    teacherId?: string;
    studentClass?: string;
  }
): {
  overallStats: OverallHalaqahStats;
  halaqahList: HalaqahDetailData[];
} {
  const safeStudents = (students || []).filter(Boolean);
  const safeRecords = (records || []).filter(Boolean);
  const teachers = (users || []).filter(u => u && u.role === 'teacher');

  // Filter students jika ada filter kelas atau halaqah
  let filteredStudents = safeStudents;
  if (filters?.studentClass) {
    filteredStudents = filteredStudents.filter(s => s.class === filters.studentClass);
  }
  if (filters?.teacherId) {
    filteredStudents = filteredStudents.filter(s => s.teacherId === filters.teacherId);
  }
  if (filters?.halaqahName) {
    filteredStudents = filteredStudents.filter(s => s.halaqah === filters.halaqahName);
  }

  // Dapatkan seluruh nama halaqah yang unik (dan tidak kosong)
  const distinctHalaqahNames = Array.from(
    new Set(filteredStudents.map(s => s.halaqah).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));

  // Setoran periode berjalan dan periode sebelumnya yang sudah difilter waktu
  const currentRecords = safeRecords.filter(r =>
    isRecordInDateRange(
      r.date,
      dateRange.startDateStr || dateRange.startDate,
      dateRange.endDateStrExclusive || dateRange.endDate,
      true
    )
  );
  const previousRecords = safeRecords.filter(r =>
    isRecordInDateRange(
      r.date,
      dateRange.previousStartDateStr || dateRange.previousStartDate,
      dateRange.previousEndDateStrExclusive || dateRange.previousEndDate,
      true
    )
  );

  // Buat map cepat untuk pencarian record berdasarkan studentId
  const currentRecordsByStudent = new Map<string, TahfidzRecord[]>();
  for (const r of currentRecords) {
    const arr = currentRecordsByStudent.get(r.studentId) || [];
    arr.push(r);
    currentRecordsByStudent.set(r.studentId, arr);
  }

  const previousRecordsByStudent = new Map<string, TahfidzRecord[]>();
  for (const r of previousRecords) {
    const arr = previousRecordsByStudent.get(r.studentId) || [];
    arr.push(r);
    previousRecordsByStudent.set(r.studentId, arr);
  }

  const halaqahList: HalaqahDetailData[] = [];
  let totalJuzAllHalaqah = 0;
  let totalActiveStudents = 0;
  let totalSetoranInPeriod = 0;
  let totalZiyadahInPeriod = 0;
  let totalMurojaahInPeriod = 0;

  let halaqahIncreasingCount = 0;
  let halaqahDecreasingCount = 0;
  let halaqahStableCount = 0;
  let halaqahNoDataCount = 0;

  for (const halaqahName of distinctHalaqahNames) {
    const studentsInHalaqah = filteredStudents.filter(s => s.halaqah === halaqahName);
    const studentsCount = studentsInHalaqah.length;
    if (studentsCount === 0) continue;

    totalActiveStudents += studentsCount;

    // Cari guru/muhafiz dari data santri di halaqah
    const primaryTeacherId = studentsInHalaqah.find(s => s.teacherId)?.teacherId || '';
    const teacherUser = teachers.find(t => t.id === primaryTeacherId);
    const teacherName = teacherUser?.name || (primaryTeacherId ? `Ustadz (ID: ${primaryTeacherId})` : 'Belum Ditentukan');

    // Total juz halaqah
    const halaqahTotalJuz = studentsInHalaqah.reduce((acc, s) => {
      const val = typeof s.totalJuz === 'number' ? s.totalJuz : parseFloat(s.totalJuz as any) || 0;
      return acc + val;
    }, 0);
    totalJuzAllHalaqah += halaqahTotalJuz;

    const averageJuz = studentsCount > 0 ? halaqahTotalJuz / studentsCount : 0;

    // Setoran periode berjalan untuk halaqah ini
    let halaqahTotalSetoran = 0;
    let halaqahZiyadah = 0;
    let halaqahMurojaah = 0;

    // Setoran periode sebelumnya
    let prevTotalSetoran = 0;
    let prevZiyadah = 0;
    let prevMurojaah = 0;

    // Summaries per santri dalam halaqah
    const studentsSummaries: HalaqahStudentSummary[] = [];

    for (const s of studentsInHalaqah) {
      const sRecords = currentRecordsByStudent.get(s.id) || [];
      const sPrevRecords = previousRecordsByStudent.get(s.id) || [];

      // Setoran terakhir HANYA dalam rentang periode laporan yang dipilih (bukan sepanjang waktu)
      const sortedPeriodRecords = [...sRecords].sort((a, b) => {
        const dateDiff = (b.date || '').localeCompare(a.date || '');
        if (dateDiff !== 0) return dateDiff;
        if (b.createdAt && a.createdAt) {
          const createdDiff = b.createdAt.localeCompare(a.createdAt);
          if (createdDiff !== 0) return createdDiff;
        }
        return (b.id || '').localeCompare(a.id || '');
      });
      const lastRec = sortedPeriodRecords[0];

      const sZiyadah = sRecords.filter(r => isNewHafalan(r.type)).length;
      const sMurojaah = sRecords.filter(r => isMurojaah(r.type)).length;
      const sSetoran = sRecords.length;

      halaqahTotalSetoran += sSetoran;
      halaqahZiyadah += sZiyadah;
      halaqahMurojaah += sMurojaah;

      prevTotalSetoran += sPrevRecords.length;
      prevZiyadah += sPrevRecords.filter(r => isNewHafalan(r.type)).length;
      prevMurojaah += sPrevRecords.filter(r => isMurojaah(r.type)).length;

      // Status keaktifan santri dalam periode terpilih
      let actStatus: 'active' | 'moderate' | 'inactive' = 'inactive';
      if (sSetoran >= 4) {
        actStatus = 'active';
      } else if (sSetoran >= 1) {
        actStatus = 'moderate';
      }

      studentsSummaries.push({
        student: s,
        totalJuz: typeof s.totalJuz === 'number' ? s.totalJuz : parseFloat(s.totalJuz as any) || 0,
        setoranCount: sSetoran,
        ziyadahCount: sZiyadah,
        murojaahCount: sMurojaah,
        lastRecord: lastRec,
        activityStatus: actStatus
      });
    }

    // Urutkan santri summary berdasarkan total setoran descending lalu nama
    studentsSummaries.sort((a, b) => {
      if (b.setoranCount !== a.setoranCount) {
        return b.setoranCount - a.setoranCount;
      }
      return (a.student.name || '').localeCompare(b.student.name || '');
    });

    totalSetoranInPeriod += halaqahTotalSetoran;
    totalZiyadahInPeriod += halaqahZiyadah;
    totalMurojaahInPeriod += halaqahMurojaah;

    // Hitung indikator tren perkembangan aktivitas
    let trend: TrendStatus = 'no_data';
    let trendPercentage: number | null = null;

    if (halaqahTotalSetoran === 0 && prevTotalSetoran === 0) {
      trend = 'no_data';
      halaqahNoDataCount++;
    } else if (prevTotalSetoran === 0 && halaqahTotalSetoran > 0) {
      trend = 'up';
      trendPercentage = 100;
      halaqahIncreasingCount++;
    } else if (halaqahTotalSetoran > prevTotalSetoran) {
      trend = 'up';
      trendPercentage = Math.round(((halaqahTotalSetoran - prevTotalSetoran) / prevTotalSetoran) * 100);
      halaqahIncreasingCount++;
    } else if (halaqahTotalSetoran < prevTotalSetoran) {
      trend = 'down';
      trendPercentage = Math.round(((prevTotalSetoran - halaqahTotalSetoran) / prevTotalSetoran) * 100);
      halaqahDecreasingCount++;
    } else {
      trend = 'stable';
      trendPercentage = 0;
      halaqahStableCount++;
    }

    // Pertambahan hafalan info
    let pertambahanInfo = '';
    if (halaqahZiyadah > 0) {
      pertambahanInfo = `+${halaqahZiyadah} setoran baru`;
    } else if (halaqahTotalSetoran > 0) {
      pertambahanInfo = `${halaqahMurojaah} setoran muroja'ah`;
    } else {
      pertambahanInfo = 'Belum ada setoran';
    }

    halaqahList.push({
      name: halaqahName,
      teacherId: primaryTeacherId,
      teacherName,
      studentsCount,
      students: studentsInHalaqah,
      studentsSummaries,
      totalJuz: Math.round(halaqahTotalJuz * 10) / 10,
      averageJuz: Math.round(averageJuz * 10) / 10,
      totalSetoran: halaqahTotalSetoran,
      ziyadahCount: halaqahZiyadah,
      murojaahCount: halaqahMurojaah,
      previousTotalSetoran: prevTotalSetoran,
      previousZiyadahCount: prevZiyadah,
      previousMurojaahCount: prevMurojaah,
      trend,
      trendPercentage,
      pertambahanHafalanInfo: pertambahanInfo
    });
  }

  // Ringkasan Keseluruhan
  const averageJuzPerStudent = totalActiveStudents > 0
    ? Math.round((totalJuzAllHalaqah / totalActiveStudents) * 10) / 10
    : 0;

  const overallStats: OverallHalaqahStats = {
    totalActiveHalaqah: halaqahList.length,
    totalActiveStudents,
    totalSetoranInPeriod,
    totalZiyadahInPeriod,
    totalMurojaahInPeriod,
    totalJuzAllHalaqah: Math.round(totalJuzAllHalaqah * 10) / 10,
    averageJuzPerStudent,
    halaqahIncreasingCount,
    halaqahDecreasingCount,
    halaqahStableCount,
    halaqahNoDataCount,
    periodLabel: dateRange.label,
    previousPeriodLabel: dateRange.previousLabel
  };

  return {
    overallStats,
    halaqahList
  };
}

/**
 * Mempersiapkan data time-series per sub-periode (misal per hari/pekan) untuk grafik tren Dashboard.
 */
export function generateTimeSeriesChartData(
  records: TahfidzRecord[],
  students: Student[],
  dateRange: DateRange,
  selectedHalaqahName?: string
): Array<{ label: string; ziyadah: number; murojaah: number; total: number }> {
  const safeRecords = (records || []).filter(Boolean);
  const targetStudentIds = new Set(
    selectedHalaqahName
      ? students.filter(s => s.halaqah === selectedHalaqahName).map(s => s.id)
      : students.map(s => s.id)
  );

  const durationDays = Math.ceil(
    (dateRange.endDate.getTime() - dateRange.startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Jika durasi <= 14 hari: breakdown harian
  if (durationDays <= 14) {
    const daysMap = new Map<string, { label: string; ziyadah: number; murojaah: number; total: number }>();
    const cur = new Date(dateRange.startDate);
    while (cur <= dateRange.endDate) {
      const key = cur.toISOString().split('T')[0];
      const lbl = cur.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
      daysMap.set(key, { label: lbl, ziyadah: 0, murojaah: 0, total: 0 });
      cur.setDate(cur.getDate() + 1);
    }

    for (const r of safeRecords) {
      if (!targetStudentIds.has(r.studentId)) continue;
      if (!isRecordInDateRange(r.date, dateRange.startDateStr || dateRange.startDate, dateRange.endDateStrExclusive || dateRange.endDate, true)) continue;
      const key = (r.date || '').split('T')[0];
      const item = daysMap.get(key);
      if (item) {
        item.total += 1;
        if (isNewHafalan(r.type)) item.ziyadah += 1;
        else item.murojaah += 1;
      }
    }

    return Array.from(daysMap.values());
  }

  // Jika durasi > 14 hari: breakdown 4 segmen pekan (Pekan 1 - 4)
  const weeks = [
    { label: 'Pekan 1', ziyadah: 0, murojaah: 0, total: 0 },
    { label: 'Pekan 2', ziyadah: 0, murojaah: 0, total: 0 },
    { label: 'Pekan 3', ziyadah: 0, murojaah: 0, total: 0 },
    { label: 'Pekan 4', ziyadah: 0, murojaah: 0, total: 0 }
  ];

  const totalMs = dateRange.endDate.getTime() - dateRange.startDate.getTime();
  const segmentMs = totalMs / 4;

  for (const r of safeRecords) {
    if (!targetStudentIds.has(r.studentId)) continue;
    if (!isRecordInDateRange(r.date, dateRange.startDateStr || dateRange.startDate, dateRange.endDateStrExclusive || dateRange.endDate, true)) continue;
    const parts = r.date.split('T')[0].split('-');
    const rDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
    const offset = rDate.getTime() - dateRange.startDate.getTime();
    let idx = Math.floor(offset / segmentMs);
    if (idx < 0) idx = 0;
    if (idx > 3) idx = 3;

    weeks[idx].total += 1;
    if (isNewHafalan(r.type)) weeks[idx].ziyadah += 1;
    else weeks[idx].murojaah += 1;
  }

  return weeks;
}
