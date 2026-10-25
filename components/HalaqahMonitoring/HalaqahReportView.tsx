import React, { useState, useMemo } from 'react';
import { Student, TahfidzRecord, User } from '../../types';
import {
  HalaqahPeriodType,
  calculateDateRange,
  analyzeHalaqahData,
  generateTimeSeriesChartData,
  HalaqahDetailData,
  DateRange
} from '../../services/halaqahAnalyticsService';
import { HalaqahDetailModal } from './HalaqahDetailModal';
import { LOGO_URL } from '../../constants';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  Printer,
  Calendar,
  Layers,
  Users,
  BookOpen,
  TrendingUp,
  TrendingDown,
  Minus,
  Filter,
  ArrowUpDown,
  Eye,
  ArrowLeft,
  Award,
  CheckCircle,
  Clock,
  AlertCircle,
  Download,
  Loader2,
  FileText
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';

interface HalaqahReportViewProps {
  students: Student[];
  records: TahfidzRecord[];
  users?: User[];
}

type SortField = 'name' | 'teacher' | 'students' | 'setoran' | 'juz' | 'average' | 'trend';
type SortDirection = 'asc' | 'desc';

/**
 * Komponen Template Lembar Rincian Halaqah (Sesuai Format Resmi A4)
 * Digunakan untuk:
 * 1. Pratinjau Cetak Browser (Print Preview)
 * 2. Canvas Capture untuk Download File PDF (jsPDF & html2canvas)
 */
const HalaqahSheetTemplate: React.FC<{
  halaqah: HalaqahDetailData;
  dateRange: DateRange;
  isPdfCapture?: boolean;
}> = ({ halaqah, dateRange, isPdfCapture = false }) => {
  const [imgError, setImgError] = useState(false);

  const currentDateFormatted = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  return (
    <div 
      className={`halaqah-sheet-page bg-white text-gray-900 mx-auto ${
        isPdfCapture 
          ? 'w-[794px] min-h-[1123px] p-[35px_45px] box-border' 
          : 'p-6 sm:p-8 max-w-4xl shadow-sm print:shadow-none print:p-0 print:max-w-none print:w-full'
      }`}
      style={{ pageBreakAfter: 'always', breakAfter: 'page' }}
    >
      {/* KOP SURAT RESMI */}
      <div className="border-b-2 border-black pb-3 mb-4 flex items-center justify-between gap-4">
        <div className="w-16 h-16 shrink-0 flex items-center justify-center">
          {imgError ? (
            <div className="w-14 h-14 rounded-xl bg-emerald-900 text-white flex flex-col items-center justify-center font-extrabold text-[10px]">
              <span>DA</span>
              <span className="text-[7px] tracking-tight">IBS</span>
            </div>
          ) : (
            <img 
              src={LOGO_URL} 
              alt="Logo" 
              className="w-16 h-16 object-contain"
              crossOrigin="anonymous"
              onError={() => setImgError(true)} 
            />
          )}
        </div>

        <div className="flex-1 text-center">
          <h1 className="text-xl font-bold uppercase tracking-widest text-slate-950 font-serif">
            Pondok Pesantren Darul Abror IBS
          </h1>
          <p className="text-xs font-semibold tracking-wide text-slate-800 mt-0.5">
            Lajnah Tahfiz Al-Qur'an • Manajemen Halaqah
          </p>
          <p className="text-[10px] text-slate-600 mt-0.5 leading-tight">
            Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151
          </p>
        </div>

        <div className="w-16 h-16 shrink-0" />
      </div>

      {/* JUDUL LAPORAN */}
      <div className="text-center mb-4">
        <h2 className="text-base font-bold uppercase underline decoration-2 underline-offset-4 text-slate-900">
          LAPORAN PERKEMBANGAN HALAQAH: {halaqah.name.toUpperCase()}
        </h2>
        <p className="text-xs text-slate-700 mt-1 font-semibold">
          {dateRange.label}
        </p>
        <p className="text-[11px] text-slate-600 mt-0.5">
          Pembimbing: <strong>{halaqah.teacherName}</strong> • Total: <strong>{halaqah.studentsCount} Santri</strong>
        </p>
      </div>

      {/* 4 KOTAK RINGKASAN METRIK (Sesuai Persis dengan Gambar Pengguna) */}
      <div className="grid grid-cols-4 gap-2 text-xs mb-4">
        <div className="border border-slate-300 rounded-lg p-2.5 bg-slate-50/50">
          <span className="text-[9px] font-bold text-slate-500 uppercase block tracking-wider">
            TOTAL SETORAN
          </span>
          <span className="text-sm font-extrabold text-slate-900 block mt-0.5">
            {halaqah.totalSetoran}x <span className="text-[10px] font-semibold text-slate-600">({halaqah.ziyadahCount}B / {halaqah.murojaahCount}M)</span>
          </span>
        </div>

        <div className="border border-slate-300 rounded-lg p-2.5 bg-slate-50/50">
          <span className="text-[9px] font-bold text-slate-500 uppercase block tracking-wider">
            TOTAL CAPAIAN
          </span>
          <span className="text-sm font-extrabold text-slate-900 block mt-0.5">
            {halaqah.totalJuz} Juz
          </span>
        </div>

        <div className="border border-slate-300 rounded-lg p-2.5 bg-slate-50/50">
          <span className="text-[9px] font-bold text-slate-500 uppercase block tracking-wider">
            RATA-RATA JUZ
          </span>
          <span className="text-sm font-extrabold text-slate-900 block mt-0.5">
            {halaqah.averageJuz} Juz <span className="text-[10px] font-normal text-slate-600">/ santri</span>
          </span>
        </div>

        <div className="border border-slate-300 rounded-lg p-2.5 bg-slate-50/50">
          <span className="text-[9px] font-bold text-slate-500 uppercase block tracking-wider">
            TREN AKTIVITAS
          </span>
          <span className="text-sm font-extrabold text-slate-900 block mt-0.5">
            {halaqah.trend === 'up' && `Meningkat (+${halaqah.trendPercentage}%)`}
            {halaqah.trend === 'down' && `Menurun (-${halaqah.trendPercentage}%)`}
            {halaqah.trend === 'stable' && 'Stabil'}
            {halaqah.trend === 'no_data' && 'Belum Ada Data'}
          </span>
        </div>
      </div>

      {/* TABEL ANGGOTA SANTRI (Sesuai Persis dengan Gambar Pengguna) */}
      <table className="w-full text-left border-collapse border border-slate-400 text-[11px] mb-8">
        <thead>
          <tr className="bg-slate-100 text-slate-900 font-bold border-b border-slate-400">
            <th className="p-2 border border-slate-400 text-center w-8">No</th>
            <th className="p-2 border border-slate-400">Nama Santri</th>
            <th className="p-2 border border-slate-400 text-center w-14">NIS</th>
            <th className="p-2 border border-slate-400 text-center w-12">Kelas</th>
            <th className="p-2 border border-slate-400 text-center w-16">Total Juz</th>
            <th className="p-2 border border-slate-400 text-center w-16">Setoran Periode</th>
            <th className="p-2 border border-slate-400 text-center w-14">Ziyadah</th>
            <th className="p-2 border border-slate-400 text-center w-16">Muroja'ah</th>
            <th className="p-2 border border-slate-400">Setoran Terakhir</th>
          </tr>
        </thead>
        <tbody>
          {halaqah.studentsSummaries.length === 0 ? (
            <tr>
              <td colSpan={9} className="p-4 text-center text-slate-400 italic border border-slate-400">
                Tidak ada santri terdaftar di halaqah ini.
              </td>
            </tr>
          ) : (
            halaqah.studentsSummaries.map((item, idx) => (
              <tr key={item.student.id} className="border-b border-slate-300">
                <td className="p-2 border border-slate-400 text-center font-bold text-slate-700">
                  {idx + 1}
                </td>
                <td className="p-2 border border-slate-400 font-bold text-slate-900 uppercase">
                  {item.student.name}
                </td>
                <td className="p-2 border border-slate-400 text-center font-mono text-slate-700">
                  {item.student.nis || '-'}
                </td>
                <td className="p-2 border border-slate-400 text-center font-semibold text-slate-700">
                  {item.student.class || '-'}
                </td>
                <td className="p-2 border border-slate-400 text-center font-bold text-slate-900">
                  {item.totalJuz} Juz
                </td>
                <td className="p-2 border border-slate-400 text-center font-bold text-slate-900">
                  {item.setoranCount}x
                </td>
                <td className="p-2 border border-slate-400 text-center text-slate-800">
                  {item.ziyadahCount}x
                </td>
                <td className="p-2 border border-slate-400 text-center text-slate-800">
                  {item.murojaahCount}x
                </td>
                <td className="p-2 border border-slate-400 text-slate-800 text-[10px]">
                  {item.lastRecord ? (
                    <span>{item.lastRecord.surah} ({item.lastRecord.ayahStart}-{item.lastRecord.ayahEnd})</span>
                  ) : (
                    <span className="text-slate-400 italic">Belum ada</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* TANDA TANGAN RESMI */}
      <div className="flex justify-between mt-12 px-8 text-xs text-center signature-section">
        <div className="w-56">
          <p className="text-slate-600 mb-20">Mengetahui,</p>
          <p className="font-bold underline text-slate-900">...................................</p>
          <p className="text-[11px] text-slate-600 font-semibold mt-0.5">Kabag Tahfidz Al-Qur'an</p>
        </div>

        <div className="w-56">
          <p className="text-slate-600 mb-20">
            Garut, {currentDateFormatted}
          </p>
          <p className="font-bold underline text-slate-900">
            {halaqah.teacherName}
          </p>
          <p className="text-[11px] text-slate-600 font-semibold mt-0.5">
            Pembimbing Halaqah
          </p>
        </div>
      </div>
    </div>
  );
};

export const HalaqahReportView: React.FC<HalaqahReportViewProps> = ({
  students,
  records,
  users = []
}) => {
  const now = new Date();

  // Filter States
  const [filterPeriodMode, setFilterPeriodMode] = useState<'month' | 'range' | 'semester'>('month');
  const [selectedMonth, setSelectedMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  );
  const [customStartDate, setCustomStartDate] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  );
  const [customEndDate, setCustomEndDate] = useState(
    now.toISOString().split('T')[0]
  );
  const [selectedSemesterYear, setSelectedSemesterYear] = useState(now.getFullYear());
  const [selectedSemesterType, setSelectedSemesterType] = useState<'ganjil' | 'genap'>(
    now.getMonth() >= 6 ? 'ganjil' : 'genap'
  );

  const [filterHalaqah, setFilterHalaqah] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterClass, setFilterClass] = useState('');

  // Sorting
  const [sortField, setSortField] = useState<SortField>('setoran');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  // Active Detail Panel
  const [activeDetailHalaqah, setActiveDetailHalaqah] = useState<HalaqahDetailData | null>(null);

  // Modal Detail
  const [modalDetailHalaqah, setModalDetailHalaqah] = useState<HalaqahDetailData | null>(null);

  // Bulk PDF Export States
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, name: '' });
  const [bulkHalaqahToRender, setBulkHalaqahToRender] = useState<HalaqahDetailData | null>(null);

  // Single PDF Download State
  const [isSingleDownloading, setIsSingleDownloading] = useState(false);

  // Print Mode Options: 'all_sheets' (Cetak Semua Lembar Rincian) | 'recap_table' (Cetak Tabel Rekap Saja)
  const [printSheetMode, setPrintSheetMode] = useState<'all_sheets' | 'recap_table'>('all_sheets');

  // Derived Options
  const distinctHalaqahs = useMemo(() => {
    return Array.from(new Set(students.map(s => s.halaqah).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'id', { numeric: true })
    );
  }, [students]);

  const distinctClasses = useMemo(() => {
    return Array.from(new Set(students.map(s => s.class).filter(Boolean))).sort();
  }, [students]);

  const teachers = useMemo(() => {
    return users.filter(u => u && u.role === 'teacher');
  }, [users]);

  // Hitung DateRange
  const dateRange: DateRange = useMemo(() => {
    if (filterPeriodMode === 'month') {
      return calculateDateRange('monthly', { selectedMonth });
    } else if (filterPeriodMode === 'semester') {
      return calculateDateRange('semester', {
        selectedSemesterYear,
        selectedSemesterType
      });
    } else {
      return calculateDateRange('custom', {
        customStartDate,
        customEndDate
      });
    }
  }, [filterPeriodMode, selectedMonth, customStartDate, customEndDate, selectedSemesterYear, selectedSemesterType]);

  // Analisis Data
  const { overallStats, halaqahList } = useMemo(() => {
    return analyzeHalaqahData(students, records, users, dateRange, {
      halaqahName: filterHalaqah || undefined,
      teacherId: filterTeacher || undefined,
      studentClass: filterClass || undefined
    });
  }, [students, records, users, dateRange, filterHalaqah, filterTeacher, filterClass]);

  // Sorting Table
  const sortedHalaqahList = useMemo(() => {
    const list = [...halaqahList];
    list.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name, 'id', { numeric: true });
          break;
        case 'teacher':
          comparison = a.teacherName.localeCompare(b.teacherName);
          break;
        case 'students':
          comparison = a.studentsCount - b.studentsCount;
          break;
        case 'setoran':
          comparison = a.totalSetoran - b.totalSetoran;
          break;
        case 'juz':
          comparison = a.totalJuz - b.totalJuz;
          break;
        case 'average':
          comparison = a.averageJuz - b.averageJuz;
          break;
        case 'trend': {
          const score = (t: string) => (t === 'up' ? 3 : t === 'stable' ? 2 : t === 'down' ? 1 : 0);
          comparison = score(a.trend) - score(b.trend);
          break;
        }
        default:
          comparison = 0;
      }
      return sortDir === 'asc' ? comparison : -comparison;
    });
    return list;
  }, [halaqahList, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  /**
   * EKSPOR PDF MASAL (BULK) SELURUH HALAQAH
   * Menghasilkan 1 file PDF multi-halaman berisi seluruh lembar rincian halaqah
   */
  const handleDownloadBulkAllHalaqahPDF = async () => {
    if (sortedHalaqahList.length === 0) {
      alert('Tidak ada data halaqah untuk diunduh.');
      return;
    }

    setIsBulkDownloading(true);
    setBulkProgress({ current: 0, total: sortedHalaqahList.length, name: '' });

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidthMm = 210;
    const pageHeightMm = 297;

    try {
      for (let i = 0; i < sortedHalaqahList.length; i++) {
        const curHalaqah = sortedHalaqahList[i];
        setBulkHalaqahToRender(curHalaqah);
        setBulkProgress({
          current: i + 1,
          total: sortedHalaqahList.length,
          name: curHalaqah.name
        });

        // Beri waktu 200ms agar DOM ter-render sempurna
        await new Promise((resolve) => setTimeout(resolve, 200));

        const element = document.getElementById('bulk-halaqah-capture-target');
        if (!element) continue;

        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#ffffff'
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.95);

        // Jika bukan halaman pertama, tambahkan halaman baru di PDF
        if (i > 0) {
          pdf.addPage('a4', 'p');
        }

        // Terapkan dimensi 1 halaman A4 penuh
        pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
      }

      const cleanPeriod = dateRange.label
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '_');
      const filename = `Laporan_Rincian_Perkembangan_Semua_Halaqah_${cleanPeriod}.pdf`;
      pdf.save(filename);
    } catch (error) {
      console.error('Gagal mengunduh PDF Masal Halaqah:', error);
      alert('Gagal membuat file PDF. Silakan gunakan tombol "Cetak / Print PDF" sebagai alternatif.');
    } finally {
      setIsBulkDownloading(false);
      setBulkHalaqahToRender(null);
      setBulkProgress({ current: 0, total: 0, name: '' });
    }
  };

  /**
   * EKSPOR PDF SATU HALAQAH TERTENTU
   */
  const handleDownloadSingleHalaqahPDF = async (targetHalaqah: HalaqahDetailData) => {
    setIsSingleDownloading(true);
    setBulkHalaqahToRender(targetHalaqah);

    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const element = document.getElementById('bulk-halaqah-capture-target');
      if (!element) return;

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);

      const cleanName = targetHalaqah.name.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '_');
      const cleanPeriod = dateRange.label.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '_');
      pdf.save(`Laporan_Perkembangan_${cleanName}_${cleanPeriod}.pdf`);
    } catch (err) {
      console.error('Gagal download single halaqah:', err);
      alert('Gagal mengunduh PDF halaqah.');
    } finally {
      setIsSingleDownloading(false);
      setBulkHalaqahToRender(null);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Mini Chart data for detail panel
  const detailTimeSeries = useMemo(() => {
    if (!activeDetailHalaqah) return [];
    return generateTimeSeriesChartData(records, activeDetailHalaqah.students, dateRange, activeDetailHalaqah.name);
  }, [records, activeDetailHalaqah, dateRange]);

  return (
    <div className="space-y-6">
      {/* Top Action & Filter Bar (Print-Hidden) */}
      <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-200/80 print:hidden space-y-4">
        {/* Header Bar */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-md">
                Laporan Perkembangan Halaqah
              </span>
              <span className="text-xs text-slate-400 font-medium">• Rekapitulasi Rincian Menyeluruh</span>
            </div>
            <h2 className="text-lg md:text-xl font-extrabold text-slate-800">
              Laporan Aktivitas & Capaian Halaqah Tahfiz
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Periode Laporan: <strong className="text-emerald-700">{dateRange.label}</strong>
            </p>
          </div>

          {/* Action Buttons: Download Bulk, Download Single, Print */}
          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-auto">
            {/* Tombol Utama: Unduh PDF Semua Halaqah Sekaligus */}
            <button
              onClick={handleDownloadBulkAllHalaqahPDF}
              disabled={isBulkDownloading || isSingleDownloading || sortedHalaqahList.length === 0}
              className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-4 py-2.5 rounded-xl transition-all shadow-md font-bold text-xs active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
              title="Unduh seluruh lembar rincian halaqah dalam satu file PDF"
            >
              {isBulkDownloading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Membuat PDF ({bulkProgress.current}/{bulkProgress.total})...</span>
                </>
              ) : (
                <>
                  <Download size={16} />
                  <span>Unduh PDF Semua Halaqah</span>
                </>
              )}
            </button>

            {/* Tombol Unduh Halaqah Terpilih (jika ada halaqah yang aktif dibuka di panel) */}
            {activeDetailHalaqah && (
              <button
                onClick={() => handleDownloadSingleHalaqahPDF(activeDetailHalaqah)}
                disabled={isSingleDownloading || isBulkDownloading}
                className="flex items-center gap-2 bg-teal-50 text-teal-800 hover:bg-teal-100 border border-teal-200 px-3.5 py-2.5 rounded-xl transition-all font-bold text-xs"
              >
                {isSingleDownloading ? (
                  <>
                    <Loader2 size={14} className="animate-spin text-teal-700" />
                    <span>Mengunduh...</span>
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    <span>Unduh Halaqah Ini</span>
                  </>
                )}
              </button>
            )}

            {/* Tombol Cetak Browser */}
            <button
              onClick={handlePrint}
              disabled={isBulkDownloading}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2.5 rounded-xl transition-all shadow-sm font-bold text-xs active:scale-95"
            >
              <Printer size={15} />
              <span>Cetak / Print</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-1">
          {/* 1. Filter Tipe Periode */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Tipe Periode
            </label>
            <select
              value={filterPeriodMode}
              onChange={(e) => setFilterPeriodMode(e.target.value as any)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white h-9 focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="month">Bulanan</option>
              <option value="range">Rentang Tanggal</option>
              <option value="semester">Semesteran</option>
            </select>
          </div>

          {/* 2. Pilihan Waktu Periode */}
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Pilihan Waktu
            </label>
            {filterPeriodMode === 'month' && (
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white h-9 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            )}
            {filterPeriodMode === 'range' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-1/2 px-2 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold bg-white h-9 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <span className="text-slate-400 text-xs font-bold">-</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-1/2 px-2 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold bg-white h-9 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            )}
            {filterPeriodMode === 'semester' && (
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedSemesterType}
                  onChange={(e) => setSelectedSemesterType(e.target.value as any)}
                  className="flex-1 px-2.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white h-9 focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="ganjil">Ganjil (Jul - Des)</option>
                  <option value="genap">Genap (Jan - Jun)</option>
                </select>
                <select
                  value={selectedSemesterYear}
                  onChange={(e) => setSelectedSemesterYear(Number(e.target.value))}
                  className="w-24 px-2.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white h-9 focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  {Array.from({ length: 6 }, (_, i) => now.getFullYear() - 3 + i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* 3. Filter Halaqah */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Filter Halaqah
            </label>
            <select
              value={filterHalaqah}
              onChange={(e) => setFilterHalaqah(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white h-9 focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">Semua Halaqah ({distinctHalaqahs.length})</option>
              {distinctHalaqahs.map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>

          {/* 4. Filter Pembimbing */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Pembimbing
            </label>
            <select
              value={filterTeacher}
              onChange={(e) => setFilterTeacher(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white h-9 focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">Semua Pembimbing</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* 5. Filter Kelas */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Jenjang / Kelas
            </label>
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold bg-white h-9 focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">Semua Kelas</option>
              {distinctClasses.map(c => (
                <option key={c} value={c}>Kelas {c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Banner Status Unduh PDF Masal */}
        {isBulkDownloading && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex items-center justify-between text-emerald-900 animate-fade-in">
            <div className="flex items-center gap-3">
              <Loader2 size={18} className="animate-spin text-emerald-600 shrink-0" />
              <div>
                <p className="text-xs font-bold">
                  Sedang Memproses Lembar Rincian Halaqah ({bulkProgress.current} dari {bulkProgress.total})
                </p>
                <p className="text-[11px] text-emerald-700">
                  Halaqah saat ini: <strong>{bulkProgress.name}</strong>. Mohon tunggu hingga berkas PDF selesai diunduh...
                </p>
              </div>
            </div>
            <span className="text-xs font-extrabold bg-emerald-200/80 px-2.5 py-1 rounded-lg">
              {Math.round((bulkProgress.current / (bulkProgress.total || 1)) * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Ringkasan Statistik Periode Laporan (Khusus Web Display) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 print:hidden">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Halaqah Aktif</p>
          <h4 className="text-xl font-extrabold text-slate-800 mt-1">{overallStats.totalActiveHalaqah}</h4>
          <p className="text-[10px] text-slate-400">Kelompok halaqah</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Santri Aktif</p>
          <h4 className="text-xl font-extrabold text-slate-800 mt-1">{overallStats.totalActiveStudents}</h4>
          <p className="text-[10px] text-slate-400">Total santri</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Setoran Periode</p>
          <h4 className="text-xl font-extrabold text-emerald-700 mt-1">{overallStats.totalSetoranInPeriod}</h4>
          <p className="text-[10px] text-emerald-600">{overallStats.totalZiyadahInPeriod}B • {overallStats.totalMurojaahInPeriod}M</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-teal-700 uppercase tracking-wider">Total Hafalan</p>
          <h4 className="text-xl font-extrabold text-teal-800 mt-1">{overallStats.totalJuzAllHalaqah} Juz</h4>
          <p className="text-[10px] text-teal-600">Akumulasi</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Rata-rata / Santri</p>
          <h4 className="text-xl font-extrabold text-blue-800 mt-1">{overallStats.averageJuzPerStudent} Juz</h4>
          <p className="text-[10px] text-blue-600">Per santri</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tren Halaqah</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs font-bold text-emerald-700 flex items-center">
              <TrendingUp size={13} className="mr-0.5" /> {overallStats.halaqahIncreasingCount}
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-xs font-bold text-rose-700 flex items-center">
              <TrendingDown size={13} className="mr-0.5" /> {overallStats.halaqahDecreasingCount}
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-xs font-bold text-slate-600 flex items-center">
              <Minus size={13} className="mr-0.5" /> {overallStats.halaqahStableCount + overallStats.halaqahNoDataCount}
            </span>
          </div>
          <p className="text-[10px] text-slate-400">Naik • Turun • Stabil</p>
        </div>
      </div>

      {/* TAMPILAN RINCIAN PANEL JIKA DIPILIH ATAU TABEL UTAMA */}
      {activeDetailHalaqah ? (
        /* Panel Rincian Detail Halaqah */
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 md:p-7 space-y-6 shadow-sm print:hidden animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <button
                onClick={() => setActiveDetailHalaqah(null)}
                className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition-colors mb-2"
              >
                <ArrowLeft size={16} />
                <span>Kembali ke Rekapitulasi Seluruh Halaqah</span>
              </button>
              <h3 className="text-xl font-extrabold text-slate-800">
                Rincian Perkembangan: {activeDetailHalaqah.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Pembimbing: <strong className="text-slate-700">{activeDetailHalaqah.teacherName}</strong> • {activeDetailHalaqah.studentsCount} Santri • Periode {dateRange.label}
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDownloadSingleHalaqahPDF(activeDetailHalaqah)}
                disabled={isSingleDownloading}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm"
              >
                {isSingleDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                <span>Unduh PDF Halaqah Ini</span>
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-colors shadow-sm"
              >
                <Printer size={14} />
                <span>Cetak Lembar Ini</span>
              </button>
            </div>
          </div>

          {/* Pratinjau Tampilan Lembar Dokumen Rincian */}
          <div className="border border-slate-200 rounded-2xl p-2 bg-slate-50/40">
            <HalaqahSheetTemplate halaqah={activeDetailHalaqah} dateRange={dateRange} />
          </div>
        </div>
      ) : (
        /* Tabel Rekapitulasi Seluruh Halaqah */
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden print:hidden">
          <div className="p-4 px-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                <span>Rekapitulasi Seluruh Halaqah ({sortedHalaqahList.length})</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Klik baris halaqah untuk melihat rincian santri, atau gunakan tombol "Unduh PDF Semua Halaqah" di atas.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleDownloadBulkAllHalaqahPDF}
                disabled={isBulkDownloading || sortedHalaqahList.length === 0}
                className="flex items-center gap-1.5 text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-xl hover:bg-emerald-100 transition-colors"
              >
                <Download size={13} />
                <span>Unduh Semua PDF</span>
              </button>

              <div className="flex items-center gap-1 text-xs text-slate-500">
                <span className="text-[11px] font-semibold">Urutan:</span>
                <span className="font-bold text-emerald-700 uppercase">{sortField} ({sortDir})</span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-600 uppercase tracking-wider select-none">
                  <th className="py-3 px-3.5 text-center w-12">No</th>
                  <th 
                    onClick={() => toggleSort('name')}
                    className="py-3 px-3.5 cursor-pointer hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Nama Halaqah</span>
                      <ArrowUpDown size={12} className={sortField === 'name' ? 'text-emerald-600' : 'text-slate-400'} />
                    </div>
                  </th>
                  <th 
                    onClick={() => toggleSort('teacher')}
                    className="py-3 px-3.5 cursor-pointer hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Pembimbing</span>
                      <ArrowUpDown size={12} className={sortField === 'teacher' ? 'text-emerald-600' : 'text-slate-400'} />
                    </div>
                  </th>
                  <th 
                    onClick={() => toggleSort('students')}
                    className="py-3 px-3.5 text-center cursor-pointer hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Santri</span>
                      <ArrowUpDown size={12} className={sortField === 'students' ? 'text-emerald-600' : 'text-slate-400'} />
                    </div>
                  </th>
                  <th 
                    onClick={() => toggleSort('setoran')}
                    className="py-3 px-3.5 text-center bg-emerald-50/50 text-emerald-800 cursor-pointer hover:bg-emerald-100/50 transition-colors"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Setoran Periode</span>
                      <ArrowUpDown size={12} className={sortField === 'setoran' ? 'text-emerald-700' : 'text-emerald-400'} />
                    </div>
                  </th>
                  <th 
                    onClick={() => toggleSort('juz')}
                    className="py-3 px-3.5 text-center cursor-pointer hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Total Juz</span>
                      <ArrowUpDown size={12} className={sortField === 'juz' ? 'text-emerald-600' : 'text-slate-400'} />
                    </div>
                  </th>
                  <th 
                    onClick={() => toggleSort('average')}
                    className="py-3 px-3.5 text-center cursor-pointer hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Rata-rata</span>
                      <ArrowUpDown size={12} className={sortField === 'average' ? 'text-emerald-600' : 'text-slate-400'} />
                    </div>
                  </th>
                  <th className="py-3 px-3.5">Pertambahan</th>
                  <th 
                    onClick={() => toggleSort('trend')}
                    className="py-3 px-3.5 text-center cursor-pointer hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>Tren Aktivitas</span>
                      <ArrowUpDown size={12} className={sortField === 'trend' ? 'text-emerald-600' : 'text-slate-400'} />
                    </div>
                  </th>
                  <th className="py-3 px-3.5 text-center w-36">Aksi Rincian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedHalaqahList.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400 font-medium">
                      Tidak ada data halaqah yang memenuhi filter.
                    </td>
                  </tr>
                ) : (
                  sortedHalaqahList.map((h, idx) => (
                    <tr
                      key={h.name}
                      className="hover:bg-emerald-50/25 transition-colors group cursor-pointer"
                      onClick={() => setActiveDetailHalaqah(h)}
                    >
                      <td className="py-3.5 px-3.5 text-center text-slate-400 font-bold">{idx + 1}</td>
                      <td className="py-3.5 px-3.5 font-bold text-slate-800 group-hover:text-emerald-700 transition-colors">
                        {h.name}
                      </td>
                      <td className="py-3.5 px-3.5 text-slate-600 font-medium">{h.teacherName}</td>
                      <td className="py-3.5 px-3.5 text-center font-bold text-slate-700">{h.studentsCount}</td>
                      <td className="py-3.5 px-3.5 text-center bg-emerald-50/20">
                        <span className="font-extrabold text-slate-800">{h.totalSetoran}x</span>
                        <span className="block text-[10px] text-emerald-600 font-medium">
                          {h.ziyadahCount}B • {h.murojaahCount}M
                        </span>
                      </td>
                      <td className="py-3.5 px-3.5 text-center font-bold text-teal-700">{h.totalJuz} Juz</td>
                      <td className="py-3.5 px-3.5 text-center font-bold text-slate-700">{h.averageJuz} Juz</td>
                      <td className="py-3.5 px-3.5 text-slate-600 text-[11px] font-medium">{h.pertambahanHafalanInfo}</td>
                      <td className="py-3.5 px-3.5 text-center">
                        {h.trend === 'up' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <TrendingUp size={11} />
                            Meningkat {h.trendPercentage ? `(+${h.trendPercentage}%)` : ''}
                          </span>
                        )}
                        {h.trend === 'down' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                            <TrendingDown size={11} />
                            Menurun {h.trendPercentage ? `(-${h.trendPercentage}%)` : ''}
                          </span>
                        )}
                        {h.trend === 'stable' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                            <Minus size={11} /> Stabil
                          </span>
                        )}
                        {h.trend === 'no_data' && (
                          <span className="text-[10px] text-slate-400 font-medium">Belum Ada Data</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setActiveDetailHalaqah(h)}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-[11px] font-bold transition-all border border-emerald-200/80 flex items-center gap-1"
                            title="Buka Rincian Panel"
                          >
                            <Eye size={12} />
                            <span>Rincian</span>
                          </button>
                          <button
                            onClick={() => handleDownloadSingleHalaqahPDF(h)}
                            className="px-2 py-1 bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 rounded-lg text-[11px] font-bold transition-all border border-slate-200"
                            title="Unduh PDF Halaqah Ini"
                          >
                            <Download size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PRINT-ONLY OFFICIAL DOCUMENT (A4 LAYOUT) */}
      <div className="hidden print:block printable-area">
        {activeDetailHalaqah ? (
          /* Cetak Rincian Satu Halaqah Tertentu yang Sedang Dibuka */
          <HalaqahSheetTemplate halaqah={activeDetailHalaqah} dateRange={dateRange} />
        ) : (
          /* Cetak Seluruh Lembar Rincian Halaqah Secara Berurutan (Masing-masing 1 Halaman A4) */
          <div>
            {sortedHalaqahList.map((h) => (
              <HalaqahSheetTemplate key={h.name} halaqah={h} dateRange={dateRange} />
            ))}
          </div>
        )}
      </div>

      {/* OFF-SCREEN CAPTURE ELEMENT UNTUK DOWNLOAD PDF (jsPDF & html2canvas) */}
      {bulkHalaqahToRender && (
        <div 
          style={{ position: 'fixed', left: '-9999px', top: '0', zIndex: -100 }}
          aria-hidden="true"
        >
          <div id="bulk-halaqah-capture-target">
            <HalaqahSheetTemplate 
              halaqah={bulkHalaqahToRender} 
              dateRange={dateRange} 
              isPdfCapture={true} 
            />
          </div>
        </div>
      )}

      {/* Modal Detail Halaqah (Jika dibuka lewat modal) */}
      {modalDetailHalaqah && (
        <HalaqahDetailModal
          halaqah={modalDetailHalaqah}
          dateRange={dateRange}
          records={records}
          onClose={() => setModalDetailHalaqah(null)}
        />
      )}
    </div>
  );
};
