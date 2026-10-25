import { Student, TahfidzRecord, User } from '../types';

export type HalaqahPeriodType = 'daily' | 'weekly' | 'monthly' | 'semester' | 'custom';

export interface DateRange {
  startDate: Date;
  endDate: Date;
  label: string;
  previousStartDate: Date;
  previousEndDate: Date;
  previousLabel: string;
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

/**
 * Menghitung rentang tanggal periode berjalan dan periode pembanding sebelumnya (durasi setara).
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
    // 7 hari terakhir
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    startDate = new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);
    label = `7 Hari Terakhir (${formatDateShort(startDate)} - ${formatDateShort(endDate)})`;
  } else if (periodType === 'weekly') {
    // 4 pekan terakhir (28 hari)
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    startDate = new Date(endDate.getTime() - 27 * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);
    label = `4 Pekan Terakhir (${formatDateShort(startDate)} - ${formatDateShort(endDate)})`;
  } else if (periodType === 'monthly') {
    const monthStr = options?.selectedMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [year, month] = monthStr.split('-').map(Number);
    startDate = new Date(year, month - 1, 1, 0, 0, 0);
    endDate = new Date(year, month, 0, 23, 59, 59);
    label = `Bulan ${startDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`;
  } else if (periodType === 'semester') {
    const sYear = options?.selectedSemesterYear || now.getFullYear();
    const sType = options?.selectedSemesterType || (now.getMonth() >= 6 ? 'ganjil' : 'genap');
    if (sType === 'ganjil') {
      startDate = new Date(sYear, 6, 1, 0, 0, 0); // 1 Juli
      endDate = new Date(sYear, 11, 31, 23, 59, 59); // 31 Des
      label = `Semester Ganjil ${sYear} (Jul - Des)`;
    } else {
      startDate = new Date(sYear, 0, 1, 0, 0, 0); // 1 Jan
      endDate = new Date(sYear, 5, 30, 23, 59, 59); // 30 Jun
      label = `Semester Genap ${sYear} (Jan - Jun)`;
    }
  } else {
    // Custom date range
    if (options?.customStartDate && options?.customEndDate) {
      const [sy, sm, sd] = options.customStartDate.split('-').map(Number);
      const [ey, em, ed] = options.customEndDate.split('-').map(Number);
      startDate = new Date(sy, sm - 1, sd, 0, 0, 0);
      endDate = new Date(ey, em - 1, ed, 23, 59, 59);
      label = `${formatDateShort(startDate)} - ${formatDateShort(endDate)}`;
    } else {
      // Default ke bulan berjalan
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      label = `Bulan ${startDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`;
    }
  }

  // Hitung durasi milidetik untuk periode pembanding yang setara persis
  const durationMs = endDate.getTime() - startDate.getTime();
  const previousEndDate = new Date(startDate.getTime() - 1000);
  const previousStartDate = new Date(previousEndDate.getTime() - durationMs);
  const previousLabel = `${formatDateShort(previousStartDate)} - ${formatDateShort(previousEndDate)}`;

  return {
    startDate,
    endDate,
    label,
    previousStartDate,
    previousEndDate,
    previousLabel
  };
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Filter data setoran apakah berada dalam rentang tanggal tertentu (inklusif).
 */
export function isRecordInDateRange(recordDateStr: string, startDate: Date, endDate: Date): boolean {
  if (!recordDateStr) return false;
  // Menggunakan tanggal lokal tanpa pergeseran zona waktu
  const parts = recordDateStr.split('T')[0].split('-');
  if (parts.length !== 3) return false;
  const rDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
  return rDate >= startDate && rDate <= endDate;
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
  const currentRecords = safeRecords.filter(r => isRecordInDateRange(r.date, dateRange.startDate, dateRange.endDate));
  const previousRecords = safeRecords.filter(r => isRecordInDateRange(r.date, dateRange.previousStartDate, dateRange.previousEndDate));

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

  // Semua record santri (untuk cari last record)
  const allRecordsByStudent = new Map<string, TahfidzRecord[]>();
  for (const r of safeRecords) {
    const arr = allRecordsByStudent.get(r.studentId) || [];
    arr.push(r);
    allRecordsByStudent.set(r.studentId, arr);
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
      const sAllRecords = allRecordsByStudent.get(s.id) || [];

      // Sort sAllRecords untuk last record
      const sortedAll = [...sAllRecords].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const lastRec = sortedAll[0];

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
      if (!isRecordInDateRange(r.date, dateRange.startDate, dateRange.endDate)) continue;
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
    if (!isRecordInDateRange(r.date, dateRange.startDate, dateRange.endDate)) continue;
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
