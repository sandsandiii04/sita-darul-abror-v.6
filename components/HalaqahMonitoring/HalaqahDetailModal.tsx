import React, { useMemo } from 'react';
import { HalaqahDetailData, DateRange, generateTimeSeriesChartData } from '../../services/halaqahAnalyticsService';
import { TahfidzRecord, Student } from '../../types';
import { X, Users, BookOpen, TrendingUp, TrendingDown, Minus, Calendar, Award, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface HalaqahDetailModalProps {
  halaqah: HalaqahDetailData | null;
  dateRange: DateRange;
  records: TahfidzRecord[];
  onClose: () => void;
  onNavigateToReports?: () => void;
}

export const HalaqahDetailModal: React.FC<HalaqahDetailModalProps> = ({
  halaqah,
  dateRange,
  records,
  onClose,
  onNavigateToReports
}) => {
  if (!halaqah) return null;

  // Mini Chart data for this halaqah
  const timeSeriesData = useMemo(() => {
    return generateTimeSeriesChartData(records, halaqah.students, dateRange, halaqah.name);
  }, [records, halaqah, dateRange]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div 
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden my-auto animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="bg-gradient-to-r from-emerald-800 via-teal-800 to-emerald-900 text-white p-5 sm:p-6 shrink-0 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-start justify-between gap-4 relative z-10">
            <div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/30 text-emerald-100 border border-emerald-400/30 px-2.5 py-0.5 rounded-full">
                  Rincian Perkembangan Halaqah
                </span>
                <span className="text-xs text-emerald-200 font-medium flex items-center gap-1">
                  <Calendar size={13} />
                  {dateRange.label}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                {halaqah.name}
              </h2>
              <p className="text-xs sm:text-sm text-emerald-100/90 mt-0.5 flex items-center gap-2">
                <span>Pembimbing: <strong className="text-white">{halaqah.teacherName}</strong></span>
                <span>•</span>
                <span>{halaqah.studentsCount} Santri Terdaftar</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-colors shrink-0"
              title="Tutup"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1">
          {/* Kartu Ringkasan Rekapitulasi */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-4">
              <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Total Setoran</p>
              <h4 className="text-2xl font-extrabold text-emerald-950 mt-1">
                {halaqah.totalSetoran} <span className="text-xs font-semibold text-emerald-700">kali</span>
              </h4>
              <p className="text-[10px] text-emerald-600 mt-1 font-medium">
                {halaqah.ziyadahCount} Ziyadah • {halaqah.murojaahCount} Murojaah
              </p>
            </div>

            <div className="bg-teal-50/60 border border-teal-100 rounded-2xl p-4">
              <p className="text-[10px] font-bold text-teal-700 uppercase tracking-wider">Total Capaian</p>
              <h4 className="text-2xl font-extrabold text-teal-950 mt-1">
                {halaqah.totalJuz} <span className="text-xs font-semibold text-teal-700">Juz</span>
              </h4>
              <p className="text-[10px] text-teal-600 mt-1 font-medium">
                Akumulasi seluruh santri
              </p>
            </div>

            <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-4">
              <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Rata-rata / Santri</p>
              <h4 className="text-2xl font-extrabold text-blue-950 mt-1">
                {halaqah.averageJuz} <span className="text-xs font-semibold text-blue-700">Juz</span>
              </h4>
              <p className="text-[10px] text-blue-600 mt-1 font-medium">
                Rata-rata hafalan santri
              </p>
            </div>

            <div className="bg-purple-50/60 border border-purple-100 rounded-2xl p-4">
              <p className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">Tren Aktivitas</p>
              <div className="flex items-center gap-1.5 mt-1">
                {halaqah.trend === 'up' && (
                  <>
                    <TrendingUp className="text-emerald-600" size={20} />
                    <span className="text-base font-extrabold text-emerald-700">
                      Meningkat (+{halaqah.trendPercentage}%)
                    </span>
                  </>
                )}
                {halaqah.trend === 'down' && (
                  <>
                    <TrendingDown className="text-rose-600" size={20} />
                    <span className="text-base font-extrabold text-rose-700">
                      Menurun (-{halaqah.trendPercentage}%)
                    </span>
                  </>
                )}
                {halaqah.trend === 'stable' && (
                  <>
                    <Minus className="text-blue-600" size={20} />
                    <span className="text-base font-extrabold text-blue-700">Stabil</span>
                  </>
                )}
                {halaqah.trend === 'no_data' && (
                  <span className="text-xs font-bold text-slate-500">Belum ada data</span>
                )}
              </div>
              <p className="text-[10px] text-purple-600 mt-1 font-medium truncate" title={`Periode lalu: ${halaqah.previousTotalSetoran} setoran`}>
                Periode lalu: {halaqah.previousTotalSetoran} setoran
              </p>
            </div>
          </div>

          {/* Grafik Mini Perkembangan Waktu */}
          <div className="bg-slate-50/70 border border-slate-200/70 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                Grafik Aktivitas Setoran dalam Periode
              </h4>
              <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm"></span> Ziyadah
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-teal-400 rounded-sm"></span> Muroja'ah
                </span>
              </div>
            </div>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeSeriesData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="label" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                    allowDecimals={false}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '12px', 
                      border: '1px solid #e2e8f0', 
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                      fontSize: '11px'
                    }}
                  />
                  <Bar dataKey="ziyadah" name="Ziyadah" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} barSize={24} />
                  <Bar dataKey="murojaah" name="Murojaah" stackId="a" fill="#2dd4bf" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabel Anggota Santri */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-extrabold text-slate-800">
                  Perkembangan Santri ({halaqah.studentsSummaries.length})
                </h4>
                <p className="text-[11px] text-slate-500">
                  Daftar capaian hafalan dan keaktifan setoran masing-masing santri di halaqah ini
                </p>
              </div>
              <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                Diurutkan: Setoran Terbanyak
              </span>
            </div>

            <div className="border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                      <th className="py-3 px-3.5 text-center w-12">No</th>
                      <th className="py-3 px-3.5">Nama Santri</th>
                      <th className="py-3 px-3.5 text-center">Kelas</th>
                      <th className="py-3 px-3.5 text-center">Total Juz</th>
                      <th className="py-3 px-3.5 text-center bg-emerald-50/40 text-emerald-800">Setoran Periode</th>
                      <th className="py-3 px-3.5 text-center">Ziyadah</th>
                      <th className="py-3 px-3.5 text-center">Muroja'ah</th>
                      <th className="py-3 px-3.5">Setoran Terakhir</th>
                      <th className="py-3 px-3.5 text-center">Aktivitas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {halaqah.studentsSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-400 font-medium">
                          Tidak ada santri di halaqah ini.
                        </td>
                      </tr>
                    ) : (
                      halaqah.studentsSummaries.map((item, idx) => {
                        const last = item.lastRecord;
                        return (
                          <tr key={item.student.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-3.5 text-center text-slate-400 font-bold">
                              {idx + 1}
                            </td>
                            <td className="py-3 px-3.5 font-bold text-slate-800">
                              {item.student.name}
                              <span className="block text-[10px] text-slate-400 font-mono font-normal">
                                NIS: {item.student.nis || '-'}
                              </span>
                            </td>
                            <td className="py-3 px-3.5 text-center">
                              <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-[10px]">
                                {item.student.class || '-'}
                              </span>
                            </td>
                            <td className="py-3 px-3.5 text-center">
                              <span className="font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-100">
                                {item.totalJuz} Juz
                              </span>
                            </td>
                            <td className="py-3 px-3.5 text-center font-extrabold text-slate-800 bg-emerald-50/20">
                              {item.setoranCount}x
                            </td>
                            <td className="py-3 px-3.5 text-center text-emerald-700 font-semibold">
                              {item.ziyadahCount}x
                            </td>
                            <td className="py-3 px-3.5 text-center text-teal-700 font-semibold">
                              {item.murojaahCount}x
                            </td>
                            <td className="py-3 px-3.5 text-slate-600 text-[11px] max-w-[180px]">
                              {last ? (
                                <div>
                                  <span className="font-semibold text-slate-800 block truncate" title={`${last.surah} (Ayat ${last.ayahStart}-${last.ayahEnd})`}>
                                    {last.surah} ({last.ayahStart}-{last.ayahEnd})
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    {last.date} • Nilai: {last.grade || '-'}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">Belum ada</span>
                              )}
                            </td>
                            <td className="py-3 px-3.5 text-center">
                              {item.activityStatus === 'active' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <CheckCircle size={10} /> Aktif
                                </span>
                              )}
                              {item.activityStatus === 'moderate' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                  <Clock size={10} /> Sedang
                                </span>
                              )}
                              {item.activityStatus === 'inactive' && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                                  <AlertCircle size={10} /> Pasif
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Modal */}
        <div className="bg-slate-50 border-t border-slate-100 p-4 px-6 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-slate-400">
            * Data setoran dihitung murni berdasarkan catatan riwayat resmi SITA.
          </p>
          <div className="flex items-center gap-2">
            {onNavigateToReports && (
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && dateRange?.startDateStr) {
                    sessionStorage.setItem('sita_report_selected_month', dateRange.startDateStr.substring(0, 7));
                  }
                  onClose();
                  onNavigateToReports();
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
              >
                Buka di Laporan Halaqah
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
