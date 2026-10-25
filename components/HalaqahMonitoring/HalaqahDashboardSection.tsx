import React, { useState, useMemo } from 'react';
import { Student, TahfidzRecord, User } from '../../types';
import {
  HalaqahPeriodType,
  calculateDateRange,
  analyzeHalaqahData,
  generateTimeSeriesChartData,
  HalaqahDetailData
} from '../../services/halaqahAnalyticsService';
import { HalaqahDetailModal } from './HalaqahDetailModal';
import {
  Layers,
  Users,
  BookOpen,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  Award,
  ChevronRight,
  Filter,
  BarChart3,
  LineChart as LineChartIcon,
  HelpCircle,
  ArrowUpRight,
  ArrowDownRight,
  Eye,
  CheckCircle2,
  Clock
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  AreaChart,
  Area
} from 'recharts';

interface HalaqahDashboardSectionProps {
  students: Student[];
  records: TahfidzRecord[];
  users?: User[];
  onNavigateToReports?: () => void;
}

export const HalaqahDashboardSection: React.FC<HalaqahDashboardSectionProps> = ({
  students,
  records,
  users = [],
  onNavigateToReports
}) => {
  // Period State
  const [periodType, setPeriodType] = useState<HalaqahPeriodType>('monthly');
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  );
  const [selectedSemesterYear, setSelectedSemesterYear] = useState(now.getFullYear());
  const [selectedSemesterType, setSelectedSemesterType] = useState<'ganjil' | 'genap'>(
    now.getMonth() >= 6 ? 'ganjil' : 'genap'
  );

  // Chart View Mode
  const [chartMode, setChartMode] = useState<'halaqah_bar' | 'time_series' | 'comparison' | 'juz_distribution'>('halaqah_bar');

  // Search & Filter
  const [searchHalaqah, setSearchHalaqah] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('all');

  // Modal Detail State
  const [selectedDetailHalaqah, setSelectedDetailHalaqah] = useState<HalaqahDetailData | null>(null);

  // Hitung rentang tanggal aktif
  const dateRange = useMemo(() => {
    return calculateDateRange(periodType, {
      selectedMonth,
      selectedSemesterYear,
      selectedSemesterType
    });
  }, [periodType, selectedMonth, selectedSemesterYear, selectedSemesterType]);

  // Analisis data halaqah
  const { overallStats, halaqahList } = useMemo(() => {
    return analyzeHalaqahData(students, records, users, dateRange, {
      teacherId: filterTeacher !== 'all' ? filterTeacher : undefined
    });
  }, [students, records, users, dateRange, filterTeacher]);

  // Filter halaqah berdasarkan pencarian
  const filteredHalaqahList = useMemo(() => {
    if (!searchHalaqah.trim()) return halaqahList;
    const q = searchHalaqah.toLowerCase().trim();
    return halaqahList.filter(
      h => h.name.toLowerCase().includes(q) || h.teacherName.toLowerCase().includes(q)
    );
  }, [halaqahList, searchHalaqah]);

  // Chart Data: Bar Chart per Halaqah
  const halaqahBarData = useMemo(() => {
    return halaqahList.slice(0, 10).map(h => ({
      name: h.name.length > 12 ? `${h.name.substring(0, 11)}...` : h.name,
      fullName: h.name,
      ziyadah: h.ziyadahCount,
      murojaah: h.murojaahCount,
      total: h.totalSetoran,
      juz: h.totalJuz,
      averageJuz: h.averageJuz
    }));
  }, [halaqahList]);

  // Chart Data: Comparison with Previous Period
  const comparisonData = useMemo(() => {
    return halaqahList.slice(0, 8).map(h => ({
      name: h.name.length > 10 ? `${h.name.substring(0, 9)}...` : h.name,
      fullName: h.name,
      berjalan: h.totalSetoran,
      sebelumnya: h.previousTotalSetoran
    }));
  }, [halaqahList]);

  // Chart Data: Time-series
  const timeSeriesData = useMemo(() => {
    return generateTimeSeriesChartData(records, students, dateRange);
  }, [records, students, dateRange]);

  // Distinct teachers untuk dropdown
  const teachers = useMemo(() => {
    return (users || []).filter(u => u && u.role === 'teacher');
  }, [users]);

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-5 sm:p-7 space-y-7 animate-fade-in">
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-5 bg-gradient-to-b from-emerald-600 to-teal-600 rounded-full" />
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-100">
              Monitoring Eksklusif Admin
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-800 tracking-tight">
            MONITORING PERKEMBANGAN HALAQAH
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Pantau aktivitas setoran, capaian juz, dan tren perkembangan seluruh halaqah secara menyeluruh dan real-time.
          </p>
        </div>

        {/* Periode Controls */}
        <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-200/80 self-start lg:self-auto">
          <button
            onClick={() => setPeriodType('daily')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              periodType === 'daily'
                ? 'bg-white text-emerald-800 shadow-sm border border-emerald-100'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Harian (7 Hari)
          </button>
          <button
            onClick={() => setPeriodType('weekly')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              periodType === 'weekly'
                ? 'bg-white text-emerald-800 shadow-sm border border-emerald-100'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Mingguan (4 Pekan)
          </button>
          <button
            onClick={() => setPeriodType('monthly')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              periodType === 'monthly'
                ? 'bg-white text-emerald-800 shadow-sm border border-emerald-100'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Bulanan
          </button>
          <button
            onClick={() => setPeriodType('semester')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              periodType === 'semester'
                ? 'bg-white text-emerald-800 shadow-sm border border-emerald-100'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Semester
          </button>

          {/* Sub-selectors */}
          {periodType === 'monthly' && (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-2.5 py-1 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500"
            />
          )}

          {periodType === 'semester' && (
            <div className="flex items-center gap-1">
              <select
                value={selectedSemesterType}
                onChange={(e) => setSelectedSemesterType(e.target.value as any)}
                className="bg-white border border-slate-200 rounded-xl px-2 py-1 text-xs font-semibold text-slate-700 outline-none"
              >
                <option value="ganjil">Ganjil (Jul-Des)</option>
                <option value="genap">Genap (Jan-Jun)</option>
              </select>
              <select
                value={selectedSemesterYear}
                onChange={(e) => setSelectedSemesterYear(Number(e.target.value))}
                className="bg-white border border-slate-200 rounded-xl px-2 py-1 text-xs font-semibold text-slate-700 outline-none"
              >
                {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Info Periode Aktif */}
      <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-50/70 px-4 py-2 rounded-xl border border-slate-200/60">
        <div className="flex items-center gap-1.5">
          <Calendar size={14} className="text-emerald-600" />
          <span>Periode Analisis: <strong className="text-slate-800">{overallStats.periodLabel}</strong></span>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-[11px] text-slate-400">
          <span>Pembanding sebelumnya:</span>
          <span className="font-medium text-slate-600">{overallStats.previousPeriodLabel}</span>
        </div>
      </div>

      {/* A. Ringkasan Statistik (7 Kartu Sesuai Instruksi) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 sm:gap-4">
        {/* 1. Total Halaqah Aktif */}
        <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200/80 rounded-2xl p-4 shadow-sm hover:shadow transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Halaqah Aktif</span>
            <Layers size={16} className="text-indigo-600" />
          </div>
          <h3 className="text-2xl font-extrabold text-slate-800">
            {overallStats.totalActiveHalaqah}
          </h3>
          <p className="text-[10px] text-slate-400 mt-0.5">Kelompok halaqah</p>
        </div>

        {/* 2. Total Santri Aktif */}
        <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200/80 rounded-2xl p-4 shadow-sm hover:shadow transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Santri Aktif</span>
            <Users size={16} className="text-blue-600" />
          </div>
          <h3 className="text-2xl font-extrabold text-slate-800">
            {overallStats.totalActiveStudents}
          </h3>
          <p className="text-[10px] text-slate-400 mt-0.5">Santri terdaftar</p>
        </div>

        {/* 3. Jumlah Setoran Periode */}
        <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200/80 rounded-2xl p-4 shadow-sm hover:shadow transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Total Setoran</span>
            <CheckCircle2 size={16} className="text-emerald-600" />
          </div>
          <h3 className="text-2xl font-extrabold text-emerald-700">
            {overallStats.totalSetoranInPeriod}
          </h3>
          <p className="text-[10px] text-emerald-600/80 mt-0.5 font-medium truncate" title={`${overallStats.totalZiyadahInPeriod} Baru • ${overallStats.totalMurojaahInPeriod} Muroja'ah`}>
            {overallStats.totalZiyadahInPeriod} Baru • {overallStats.totalMurojaahInPeriod} Mur.
          </p>
        </div>

        {/* 4. Total Capaian Hafalan (Juz) */}
        <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200/80 rounded-2xl p-4 shadow-sm hover:shadow transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Total Hafalan</span>
            <BookOpen size={16} className="text-teal-600" />
          </div>
          <h3 className="text-2xl font-extrabold text-slate-800">
            {overallStats.totalJuzAllHalaqah} <span className="text-xs font-bold text-teal-700">Juz</span>
          </h3>
          <p className="text-[10px] text-slate-400 mt-0.5">Akumulasi seluruhnya</p>
        </div>

        {/* 5. Rata-rata Capaian Juz per Santri */}
        <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200/80 rounded-2xl p-4 shadow-sm hover:shadow transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Rata-rata Juz</span>
            <Award size={16} className="text-amber-600" />
          </div>
          <h3 className="text-2xl font-extrabold text-slate-800">
            {overallStats.averageJuzPerStudent} <span className="text-xs font-bold text-amber-700">Juz</span>
          </h3>
          <p className="text-[10px] text-slate-400 mt-0.5">Per santri aktif</p>
        </div>

        {/* 6. Jumlah Halaqah Meningkat */}
        <div className="bg-gradient-to-br from-emerald-50/70 to-white border border-emerald-200/80 rounded-2xl p-4 shadow-sm hover:shadow transition-all">
          <div className="flex items-center justify-between text-emerald-700 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Tren Meningkat</span>
            <TrendingUp size={16} className="text-emerald-600" />
          </div>
          <h3 className="text-2xl font-extrabold text-emerald-700">
            {overallStats.halaqahIncreasingCount}
          </h3>
          <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">Aktivitas naik ↑</p>
        </div>

        {/* 7. Jumlah Halaqah Menurun / Stagnan */}
        <div className="bg-gradient-to-br from-rose-50/60 to-white border border-rose-200/70 rounded-2xl p-4 shadow-sm hover:shadow transition-all">
          <div className="flex items-center justify-between text-rose-700 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider">Menurun/Stagnan</span>
            <TrendingDown size={16} className="text-rose-500" />
          </div>
          <h3 className="text-2xl font-extrabold text-rose-700">
            {overallStats.halaqahDecreasingCount + overallStats.halaqahStableCount + overallStats.halaqahNoDataCount}
          </h3>
          <p className="text-[10px] text-rose-600 font-medium mt-0.5 truncate" title={`${overallStats.halaqahDecreasingCount} turun, ${overallStats.halaqahStableCount} stabil, ${overallStats.halaqahNoDataCount} pasif`}>
            {overallStats.halaqahDecreasingCount} turun • {overallStats.halaqahStableCount + overallStats.halaqahNoDataCount} pasif
          </p>
        </div>
      </div>

      {/* B. Grafik Perkembangan Interaktif */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
              <BarChart3 className="text-emerald-600" size={18} />
              Grafik Perkembangan Aktivitas & Capaian Halaqah
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Visualisasi perbandingan setoran, tren waktu, dan distribusi hafalan antarhalaqah
            </p>
          </div>

          {/* Segmented Control Mode Grafik */}
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-600 self-start sm:self-auto overflow-x-auto max-w-full">
            <button
              onClick={() => setChartMode('halaqah_bar')}
              className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                chartMode === 'halaqah_bar'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'hover:text-slate-900'
              }`}
            >
              Setoran Halaqah
            </button>
            <button
              onClick={() => setChartMode('comparison')}
              className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                chartMode === 'comparison'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'hover:text-slate-900'
              }`}
            >
              Komparasi Periode
            </button>
            <button
              onClick={() => setChartMode('time_series')}
              className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                chartMode === 'time_series'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'hover:text-slate-900'
              }`}
            >
              Tren dari Waktu ke Waktu
            </button>
            <button
              onClick={() => setChartMode('juz_distribution')}
              className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                chartMode === 'juz_distribution'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'hover:text-slate-900'
              }`}
            >
              Capaian Juz
            </button>
          </div>
        </div>

        {/* Tampilan Kontainer Chart */}
        <div className="h-72 w-full">
          {chartMode === 'halaqah_bar' && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={halaqahBarData} margin={{ top: 10, right: 10, left: -20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                  allowDecimals={false}
                />
                <Tooltip 
                  formatter={(value: any, name: string) => [
                    `${value} setoran`,
                    name === 'ziyadah' ? 'Ziyadah (Baru)' : 'Muroja\'ah'
                  ]}
                  labelFormatter={(label, payload) => {
                    const full = payload?.[0]?.payload?.fullName;
                    return full ? `Halaqah: ${full}` : `Halaqah: ${label}`;
                  }}
                  contentStyle={{ 
                    borderRadius: '16px', 
                    border: '1px solid #f1f5f9', 
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)',
                    fontSize: '12px'
                  }}
                />
                <Legend 
                  verticalAlign="top" 
                  align="right"
                  wrapperStyle={{ paddingBottom: '10px', fontSize: '12px', fontWeight: 600 }}
                  formatter={(value) => value === 'ziyadah' ? 'Ziyadah (Baru)' : 'Muroja\'ah'}
                />
                <Bar dataKey="ziyadah" fill="#10b981" radius={[4, 4, 0, 0]} barSize={24} stackId="a" />
                <Bar dataKey="murojaah" fill="#0ea5e9" radius={[4, 4, 0, 0]} barSize={24} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          )}

          {chartMode === 'comparison' && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData} margin={{ top: 10, right: 10, left: -20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                  allowDecimals={false}
                />
                <Tooltip 
                  formatter={(value: any, name: string) => [
                    `${value} setoran`,
                    name === 'berjalan' ? 'Periode Berjalan' : 'Periode Sebelumnya'
                  ]}
                  labelFormatter={(label, payload) => {
                    const full = payload?.[0]?.payload?.fullName;
                    return full ? `Halaqah: ${full}` : `Halaqah: ${label}`;
                  }}
                  contentStyle={{ 
                    borderRadius: '16px', 
                    border: '1px solid #f1f5f9', 
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)',
                    fontSize: '12px'
                  }}
                />
                <Legend 
                  verticalAlign="top" 
                  align="right"
                  wrapperStyle={{ paddingBottom: '10px', fontSize: '12px', fontWeight: 600 }}
                  formatter={(value) => value === 'berjalan' ? 'Periode Berjalan' : 'Periode Sebelumnya'}
                />
                <Bar dataKey="berjalan" fill="#10b981" radius={[4, 4, 0, 0]} barSize={16} />
                <Bar dataKey="sebelumnya" fill="#94a3b8" radius={[4, 4, 0, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {chartMode === 'time_series' && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeriesData} margin={{ top: 10, right: 10, left: -20, bottom: 10 }}>
                <defs>
                  <linearGradient id="colorZiyadah" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorMurojaah" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="label" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                  allowDecimals={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '16px', 
                    border: '1px solid #f1f5f9', 
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)',
                    fontSize: '12px'
                  }}
                />
                <Legend 
                  verticalAlign="top" 
                  align="right"
                  wrapperStyle={{ paddingBottom: '10px', fontSize: '12px', fontWeight: 600 }}
                  formatter={(value) => value === 'ziyadah' ? 'Ziyadah' : 'Muroja\'ah'}
                />
                <Area type="monotone" dataKey="ziyadah" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorZiyadah)" />
                <Area type="monotone" dataKey="murojaah" stroke="#0ea5e9" strokeWidth={2.5} fillOpacity={1} fill="url(#colorMurojaah)" />
              </AreaChart>
            </ResponsiveContainer>
          )}

          {chartMode === 'juz_distribution' && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={halaqahBarData} margin={{ top: 10, right: 10, left: -20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                />
                <Tooltip 
                  formatter={(value: any, name: string) => [
                    `${value} Juz`,
                    name === 'juz' ? 'Total Juz Halaqah' : 'Rata-rata Juz/Santri'
                  ]}
                  labelFormatter={(label, payload) => {
                    const full = payload?.[0]?.payload?.fullName;
                    return full ? `Halaqah: ${full}` : `Halaqah: ${label}`;
                  }}
                  contentStyle={{ 
                    borderRadius: '16px', 
                    border: '1px solid #f1f5f9', 
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)',
                    fontSize: '12px'
                  }}
                />
                <Legend 
                  verticalAlign="top" 
                  align="right"
                  wrapperStyle={{ paddingBottom: '10px', fontSize: '12px', fontWeight: 600 }}
                  formatter={(value) => value === 'juz' ? 'Total Capaian (Juz)' : 'Rata-rata per Santri (Juz)'}
                />
                <Bar dataKey="juz" fill="#14b8a6" radius={[4, 4, 0, 0]} barSize={20} />
                <Bar dataKey="averageJuz" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* C. Ringkasan Setiap Halaqah */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
              <span className="w-1.5 h-4 bg-emerald-600 rounded-full" />
              Daftar Ringkasan Setiap Halaqah ({filteredHalaqahList.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Klik pada baris atau tombol "Rincian" untuk membuka evaluasi terperinci tiap anggota halaqah
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Cari halaqah / ustadz..."
              value={searchHalaqah}
              onChange={(e) => setSearchHalaqah(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-medium outline-none focus:border-emerald-500 w-44 sm:w-56"
            />
            {teachers.length > 0 && (
              <select
                value={filterTeacher}
                onChange={(e) => setFilterTeacher(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-medium outline-none focus:border-emerald-500"
              >
                <option value="all">Semua Guru</option>
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Tabel Ringkasan Halaqah */}
        <div className="border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                  <th className="py-3.5 px-4 text-center w-12">No</th>
                  <th className="py-3.5 px-4">Nama Halaqah</th>
                  <th className="py-3.5 px-4">Muhafiz / Muhafizah</th>
                  <th className="py-3.5 px-4 text-center">Santri</th>
                  <th className="py-3.5 px-4 text-center bg-emerald-50/40 text-emerald-800">Setoran Periode</th>
                  <th className="py-3.5 px-4 text-center">Total Juz</th>
                  <th className="py-3.5 px-4 text-center">Rata-rata</th>
                  <th className="py-3.5 px-4">Pertambahan</th>
                  <th className="py-3.5 px-4 text-center">Tren Aktivitas</th>
                  <th className="py-3.5 px-4 text-center w-24">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-sans">
                {filteredHalaqahList.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-slate-400 font-medium">
                      Tidak ada data halaqah yang sesuai dengan filter.
                    </td>
                  </tr>
                ) : (
                  filteredHalaqahList.map((h, idx) => (
                    <tr
                      key={h.name}
                      onClick={() => setSelectedDetailHalaqah(h)}
                      className="hover:bg-emerald-50/30 cursor-pointer transition-colors group"
                    >
                      <td className="py-3.5 px-4 text-center text-slate-400 font-bold">
                        {idx + 1}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-800 group-hover:text-emerald-700 transition-colors">
                        {h.name}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 font-medium">
                        {h.teacherName}
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                        {h.studentsCount}
                      </td>
                      <td className="py-3.5 px-4 text-center bg-emerald-50/20">
                        <span className="font-extrabold text-slate-800">
                          {h.totalSetoran}x
                        </span>
                        <span className="block text-[10px] text-emerald-600 font-medium">
                          {h.ziyadahCount}B • {h.murojaahCount}M
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-teal-700">
                        {h.totalJuz} Juz
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                        {h.averageJuz} Juz
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 font-medium text-[11px]">
                        {h.pertambahanHafalanInfo}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {h.trend === 'up' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <TrendingUp size={12} />
                            Meningkat {h.trendPercentage ? `(+${h.trendPercentage}%)` : ''}
                          </span>
                        )}
                        {h.trend === 'down' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                            <TrendingDown size={12} />
                            Menurun {h.trendPercentage ? `(-${h.trendPercentage}%)` : ''}
                          </span>
                        )}
                        {h.trend === 'stable' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                            <Minus size={12} />
                            Stabil
                          </span>
                        )}
                        {h.trend === 'no_data' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                            Belum Ada Data
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setSelectedDetailHalaqah(h)}
                          className="px-2.5 py-1 bg-white hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 text-emerald-700 rounded-lg text-[11px] font-bold transition-all shadow-2xs flex items-center gap-1 mx-auto"
                        >
                          <Eye size={12} />
                          <span>Rincian</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tombol Akses Cepat ke Halaman Laporan Lengkap */}
        {onNavigateToReports && (
          <div className="pt-2 flex justify-end">
            <button
              onClick={onNavigateToReports}
              className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition-colors"
            >
              <span>Buka Laporan Perkembangan Halaqah Terperinci</span>
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Modal Detail Halaqah */}
      {selectedDetailHalaqah && (
        <HalaqahDetailModal
          halaqah={selectedDetailHalaqah}
          dateRange={dateRange}
          records={records}
          onClose={() => setSelectedDetailHalaqah(null)}
          onNavigateToReports={onNavigateToReports}
        />
      )}
    </div>
  );
};
