import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, 
  Student, 
  TahsinPeriod, 
  TahsinSession 
} from '../../types';
import { tahsinService } from '../../services/tahsinService';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  CartesianGrid, 
  Legend,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { 
  Award, 
  CheckCircle2, 
  AlertTriangle, 
  Users, 
  TrendingUp, 
  Layers, 
  Filter, 
  Calendar,
  BookOpen,
  PieChart as PieIcon,
  BarChart3
} from 'lucide-react';

interface TahsinDashboardViewProps {
  user: User;
  students: Student[];
  users?: User[];
  teachers?: User[];
  onNavigate?: (tab: string) => void;
}

export const TahsinDashboardView: React.FC<TahsinDashboardViewProps> = ({
  user,
  students,
  onNavigate
}) => {
  const [periods, setPeriods] = useState<TahsinPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [sessions, setSessions] = useState<TahsinSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filters
  const [filterClass, setFilterClass] = useState<string>('');
  const [filterHalaqah, setFilterHalaqah] = useState<string>('');

  useEffect(() => {
    const fetchAll = async () => {
      setIsLoading(true);
      try {
        const fetchedPeriods = await tahsinService.fetchPeriods();
        setPeriods(fetchedPeriods);
        const active = fetchedPeriods.find(p => p.status === 'active') || fetchedPeriods[0];
        if (active) {
          setSelectedPeriodId(active.id);
          const fetchedSessions = await tahsinService.fetchSessions(active.id);
          setSessions(fetchedSessions);
        }
      } catch (e) {
        console.error('Gagal load dashboard tahsin:', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAll();
  }, []);

  const handlePeriodChange = async (pId: string) => {
    setSelectedPeriodId(pId);
    setIsLoading(true);
    try {
      const fetched = await tahsinService.fetchSessions(pId);
      setSessions(fetched);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);

  // Filtered Sessions
  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      if (filterClass && s.classSnapshot !== filterClass) return false;
      if (filterHalaqah && s.halaqahSnapshot !== filterHalaqah) return false;
      return true;
    });
  }, [sessions, filterClass, filterHalaqah]);

  // Overall Stats
  const stats = useMemo(() => {
    return tahsinService.calculateMonitoringStats(filteredSessions);
  }, [filteredSessions]);

  // Chart 1: Rata-rata Nilai per Kelas
  const classScoreData = useMemo(() => {
    const classMap: Record<string, { total: number; sum: number; passed: number }> = {};
    filteredSessions.forEach(s => {
      const c = s.classSnapshot || 'Lainnya';
      if (!classMap[c]) classMap[c] = { total: 0, sum: 0, passed: 0 };
      if (s.finalScore !== undefined) {
        classMap[c].total += 1;
        classMap[c].sum += s.finalScore;
        if (s.passingStatus === 'lulus') classMap[c].passed += 1;
      }
    });

    return Object.entries(classMap).map(([className, val]) => ({
      name: `Kls ${className}`,
      avgScore: val.total > 0 ? Math.round((val.sum / val.total) * 10) / 10 : 0,
      passRate: val.total > 0 ? Math.round((val.passed / val.total) * 100) : 0,
      totalStudents: val.total
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredSessions]);

  // Chart 2: Distribusi Nilai per 4 Aspek Wajib
  const aspectDistributionData = useMemo(() => [
    { name: 'Makharijul Huruf (35%)', avg: stats.averageMakharij, fill: '#10b981' },
    { name: 'Tajwid (30%)', avg: stats.averageTajwid, fill: '#3b82f6' },
    { name: 'Kelancaran (20%)', avg: stats.averageKelancaran, fill: '#f59e0b' },
    { name: 'Waqaf & Ibtida (15%)', avg: stats.averageWaqaf, fill: '#8b5cf6' },
  ], [stats]);

  // Chart 3: Proporsi Kelulusan (Pie Chart)
  const pieData = useMemo(() => [
    { name: 'Lulus', value: stats.passedCount, color: '#10b981' },
    { name: 'Perlu Remedial', value: stats.remedialNeededCount, color: '#ef4444' },
    { name: 'Belum Diuji', value: stats.untestedCount, color: '#cbd5e1' },
  ], [stats]);

  // Chart 4: Perkembangan per Halaqah
  const halaqahData = useMemo(() => {
    const hMap: Record<string, { total: number; sum: number; passed: number }> = {};
    filteredSessions.forEach(s => {
      const h = s.halaqahSnapshot || 'Lainnya';
      if (!hMap[h]) hMap[h] = { total: 0, sum: 0, passed: 0 };
      if (s.finalScore !== undefined) {
        hMap[h].total += 1;
        hMap[h].sum += s.finalScore;
        if (s.passingStatus === 'lulus') hMap[h].passed += 1;
      }
    });

    return Object.entries(hMap).map(([hName, val]) => ({
      name: hName,
      avgScore: val.total > 0 ? Math.round((val.sum / val.total) * 10) / 10 : 0,
      passRate: val.total > 0 ? Math.round((val.passed / val.total) * 100) : 0,
      totalStudents: val.total
    })).sort((a, b) => b.avgScore - a.avgScore).slice(0, 10);
  }, [filteredSessions]);

  const classOptions = useMemo(() => Array.from(new Set(sessions.map(s => s.classSnapshot))).sort(), [sessions]);
  const halaqahOptions = useMemo(() => Array.from(new Set(sessions.map(s => s.halaqahSnapshot))).sort(), [sessions]);

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100">
            Pusat Analisis & Monitoring
          </span>
          <h2 className="text-xl font-extrabold text-slate-800 tracking-tight mt-1">
            Dashboard Ujian Tahsin Al-Qur'an
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pantau capaian mutu bacaan, distribusi nilai aspek, dan statistik kelulusan santri per semester.
          </p>
        </div>

        {/* Periode & Filter Controls */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto text-xs">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-500">Periode:</span>
            <select
              value={selectedPeriodId}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none"
            >
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <select
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 outline-none"
          >
            <option value="">Semua Kelas</option>
            {classOptions.map(c => <option key={c} value={c}>Kelas {c}</option>)}
          </select>

          <select
            value={filterHalaqah}
            onChange={(e) => setFilterHalaqah(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 outline-none"
          >
            <option value="">Semua Halaqah</option>
            {halaqahOptions.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
      </div>

      {/* 8 Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Total Peserta</span>
            <Users size={16} />
          </div>
          <div className="text-2xl font-black text-slate-800 mt-1">{stats.totalParticipants}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Santri terdaftar</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-emerald-600">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Sudah Diuji</span>
            <CheckCircle2 size={16} />
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-1">{stats.testedCount}</div>
          <div className="text-[10px] text-emerald-600 font-bold mt-0.5">
            {stats.totalParticipants > 0 ? Math.round((stats.testedCount / stats.totalParticipants) * 100) : 0}% terlaksana
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-teal-600">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Santri Lulus</span>
            <Award size={16} />
          </div>
          <div className="text-2xl font-black text-teal-700 mt-1">{stats.passedCount}</div>
          <div className="text-[10px] text-teal-600 font-bold mt-0.5">
            {stats.passRate}% tingkat kelulusan
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-rose-600">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Perlu Remedial</span>
            <AlertTriangle size={16} />
          </div>
          <div className="text-2xl font-black text-rose-700 mt-1">{stats.remedialNeededCount}</div>
          <div className="text-[10px] text-rose-600 font-bold mt-0.5">
            {stats.remedialCompletedCount} telah tuntas remedial
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Rata-rata Nilai</span>
            <TrendingUp size={16} />
          </div>
          <div className="text-2xl font-black text-slate-800 mt-1">{stats.averageFinalScore.toFixed(1)}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Skala 0 - 100</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-emerald-600">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Rata2 Makharij</span>
            <span className="text-[10px] font-bold bg-emerald-50 px-1 rounded">35%</span>
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-1">{stats.averageMakharij.toFixed(1)}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Target min: 75</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-blue-600">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Rata2 Tajwid</span>
            <span className="text-[10px] font-bold bg-blue-50 px-1 rounded">30%</span>
          </div>
          <div className="text-2xl font-black text-blue-700 mt-1">{stats.averageTajwid.toFixed(1)}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Target min: 75</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between text-purple-600">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Kelancaran & Waqaf</span>
            <span className="text-[10px] font-bold bg-purple-50 px-1 rounded">35%</span>
          </div>
          <div className="text-2xl font-black text-purple-700 mt-1">
            {((stats.averageKelancaran + stats.averageWaqaf) / 2).toFixed(1)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Gabungan kelancaran & waqaf</div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Chart 1: Rata-rata Nilai & Kelulusan per Kelas (7 cols) */}
        <div className="lg:col-span-7 bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-sm text-slate-800 flex items-center gap-2">
              <BarChart3 className="text-emerald-600" size={18} />
              Rata-rata Nilai Tahsin per Kelas
            </h3>
            <span className="text-xs text-slate-400 font-medium">Berdasarkan data terkini</span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={classScoreData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={11} stroke="#64748b" />
                <YAxis domain={[0, 100]} fontSize={11} stroke="#64748b" />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '11px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar name="Rata-rata Nilai" dataKey="avgScore" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar name="% Kelulusan" dataKey="passRate" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Proporsi Kelulusan (5 cols) */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-sm text-slate-800 flex items-center gap-2">
              <PieIcon className="text-teal-600" size={18} />
              Status Kelulusan Peserta
            </h3>
            <span className="text-xs text-slate-400 font-medium">{stats.testedCount} diuji</span>
          </div>

          <div className="h-64 w-full flex items-center justify-center">
            {stats.totalParticipants === 0 ? (
              <div className="text-slate-400 text-xs">Belum ada data peserta.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={50}
                    paddingAngle={4}
                    label={(entry) => `${entry.name} (${entry.value})`}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Row 2 Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Chart 3: Rata-rata Nilai 4 Aspek Wajib (6 cols) */}
        <div className="lg:col-span-6 bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 space-y-3">
          <h3 className="font-extrabold text-sm text-slate-800 flex items-center gap-2">
            <Award className="text-amber-500" size={18} />
            Rata-rata Nilai 4 Aspek Penilaian Wajib
          </h3>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aspectDistributionData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" domain={[0, 100]} fontSize={11} stroke="#64748b" />
                <YAxis dataKey="name" type="category" width={160} fontSize={11} stroke="#64748b" />
                <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px' }} />
                <Bar dataKey="avg" name="Skor Rata-rata" radius={[0, 4, 4, 0]}>
                  {aspectDistributionData.map((entry, index) => (
                    <Cell key={`cell-aspect-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 4: Capaian Nilai per Halaqah (6 cols) */}
        <div className="lg:col-span-6 bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 space-y-3">
          <h3 className="font-extrabold text-sm text-slate-800 flex items-center gap-2">
            <Layers className="text-purple-600" size={18} />
            Perkembangan Tahsin per Halaqah
          </h3>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={halaqahData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={10} stroke="#64748b" />
                <YAxis domain={[0, 100]} fontSize={10} stroke="#64748b" />
                <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px' }} />
                <Bar name="Rata-rata Nilai" dataKey="avgScore" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TahsinDashboardView;
