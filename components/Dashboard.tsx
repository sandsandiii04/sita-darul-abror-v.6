
import React from 'react';
import { User, Student, TahfidzRecord, Exam } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Trophy, Book, Calendar, TrendingUp, Users, Wifi, WifiOff, AlertTriangle, Award, ArrowRight } from 'lucide-react';

interface DashboardProps {
  user: User;
  students: Student[];
  records: TahfidzRecord[];
  exams?: Exam[];
  connectionError?: string | null;
  onNavigate?: (tab: string) => void;
}

const StatCard = ({ title, value, icon: Icon, gradient, shadowColor }: any) => (
  <div className="bg-white p-5 rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-premium hover:-translate-y-1 transition-all duration-300 flex items-center gap-4">
    <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${gradient} text-white flex items-center justify-center shadow-lg ${shadowColor} shrink-0`}>
      <Icon size={24} />
    </div>
    <div className="min-w-0">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">{title}</p>
      <h3 className="text-2xl font-extrabold text-slate-800 tracking-tight mt-0.5">{value}</h3>
    </div>
  </div>
);

const Dashboard: React.FC<DashboardProps> = ({ user, students, records, exams = [], connectionError, onNavigate }) => {
  // Check connection status based on URL config AND actual fetch result
  const isOnline = !connectionError;

  // Simple data processing for chart
  const weeklyData = [
    { name: 'Sen', pages: 2 },
    { name: 'Sel', pages: 3 },
    { name: 'Rab', pages: 2.5 },
    { name: 'Kam', pages: 4 },
    { name: 'Jum', pages: 1 },
    { name: 'Sab', pages: 0 },
    { name: 'Ahad', pages: 0 },
  ];

  const totalSabaq = records.filter(r => r.type === 'sabaq' || r.type === 'ziyadah').length;
  const totalMurojaah = records.filter(r => r.type === 'sabqi' || r.type === 'manzil' || r.type === 'murojaah').length;
  
  let displayStudents = students;
  let displayExams = exams;

  if (user.role === 'teacher') {
    displayStudents = students.filter(s => s.teacherId === user.id);
    displayExams = exams.filter(e => displayStudents.some(s => s.id === e.studentId));
  } else if (user.role === 'parent' && user.childId) {
    displayStudents = students.filter(s => s.id === user.childId);
    displayExams = exams.filter(e => e.studentId === user.childId);
  }

  const averageJuz = displayStudents.length > 0 
    ? (displayStudents.reduce((acc, curr) => acc + curr.totalJuz, 0) / displayStudents.length).toFixed(1)
    : 0;
  
  // Get recent exams (top 5)
  const recentExams = displayExams
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      {/* Connection Status Banner */}
      <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl border gap-3 ${isOnline ? 'bg-emerald-50/50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
        <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="font-bold text-xs tracking-wide">
                {isOnline ? "Server Terhubung (Cloud Terintegrasi)" : "Koneksi Bermasalah (Offline Mode)"}
            </span>
        </div>
        {!isOnline && user.role === 'admin' && (
            <button 
                onClick={() => onNavigate && onNavigate('tutorial')}
                className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg text-[10px] font-bold border border-red-200 shadow-sm text-red-600 hover:bg-red-50 transition-all active:scale-95 whitespace-nowrap"
            >
                <AlertTriangle size={12} />
                <span>Konfigurasi Supabase</span>
                <ArrowRight size={12} />
            </button>
        )}
      </div>

      {/* Stat Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <StatCard 
          title="Total Santri" 
          value={displayStudents.length} 
          icon={Users} 
          gradient="from-blue-500 to-indigo-600"
          shadowColor="shadow-blue-500/10" 
        />
        <StatCard 
          title="Rata-rata Juz" 
          value={`${averageJuz} Juz`} 
          icon={Book} 
          gradient="from-emerald-500 to-teal-600"
          shadowColor="shadow-emerald-500/10" 
        />
        <StatCard 
          title="Setoran Sabaq" 
          value={totalSabaq} 
          icon={TrendingUp} 
          gradient="from-purple-500 to-indigo-600"
          shadowColor="shadow-purple-500/10" 
        />
        <StatCard 
          title="Muroja'ah (Sabqi & Manzil)" 
          value={totalMurojaah} 
          icon={Calendar} 
          gradient="from-orange-500 to-amber-600"
          shadowColor="shadow-orange-500/10" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart (Left Column) */}
        <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-200/60 shadow-sm">
          <h3 className="text-base font-extrabold text-slate-800 mb-6 flex items-center gap-2">
            <span className="w-1.5 h-4 bg-emerald-600 rounded-full" />
            Grafik Capaian Mingguan (Halaman)
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '16px', 
                    border: '1px solid #f1f5f9', 
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)',
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '12px'
                  }}
                />
                <Bar dataKey="pages" fill="#10b981" radius={[6, 6, 0, 0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column: Top Students & Recent Exams */}
        <div className="space-y-6">
            
            {/* Top Students */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-sm">
              <h3 className="text-base font-extrabold text-slate-800 mb-5 flex items-center gap-2">
                <Trophy className="text-amber-500" size={18} />
                Santri Terbaik Pekan Ini
              </h3>
              <div className="space-y-3.5">
                {displayStudents.slice(0, 3).map((s, idx) => (
                  <div key={s.id} className="flex items-center gap-3 pb-3 border-b border-slate-100 last:border-0 last:pb-0">
                    <div className={`
                      w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0
                      ${idx === 0 
                        ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                        : idx === 1 
                        ? 'bg-slate-100 text-slate-700 border border-slate-200/50' 
                        : 'bg-orange-50/50 text-orange-700 border border-orange-200/30'}
                    `}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-xs text-slate-800 truncate leading-snug">{s.name}</p>
                      <p className="text-[10px] text-slate-500 font-semibold mt-0.5">Kelas {s.class} • <span className="text-emerald-600 font-bold">{s.totalJuz} Juz</span></p>
                    </div>
                  </div>
                ))}
                {displayStudents.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-6 font-medium">Belum ada data santri.</p>
                )}
              </div>
            </div>

            {/* Recent Exams */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-sm">
              <h3 className="text-base font-extrabold text-slate-800 mb-5 flex items-center gap-2">
                <Award className="text-purple-500" size={18} />
                Hasil Ujian Terbaru
              </h3>
              <div className="space-y-4">
                {recentExams.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6 font-medium">Belum ada data ujian.</p>
                ) : (
                    recentExams.map(exam => {
                        const s = students.find(st => st.id === exam.studentId);
                        
                        const displayLabel = exam.details 
                          ? `${exam.details.surat || exam.details.halaman}`
                          : exam.category;
                        
                        const juzLabel = exam.juz || exam.details?.juz || '-';
                        const classLabel = s?.class || exam.class || '-';
                        const isPassed = exam.score >= 70;

                        return (
                            <div key={exam.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                                <div className="flex justify-between items-start gap-2 mb-1">
                                    <div className="min-w-0">
                                      <p className="font-bold text-xs text-slate-800 truncate leading-snug">{s?.name}</p>
                                      <div className="flex items-center gap-1.5 mt-1">
                                        <span className="text-[9px] bg-slate-50 px-1.5 py-0.5 rounded-md text-slate-500 border border-slate-200/60 font-bold uppercase">Kelas {classLabel}</span>
                                        <span className="text-[9px] bg-indigo-50 px-1.5 py-0.5 rounded-md text-indigo-700 border border-indigo-100/80 font-bold uppercase">{juzLabel}</span>
                                      </div>
                                    </div>
                                    <span className={`text-xs font-extrabold px-2.5 py-1 rounded-xl shrink-0 ${
                                      isPassed 
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                                        : 'bg-red-50 text-red-700 border border-red-100'
                                    }`}>
                                        {exam.score}
                                    </span>
                                </div>
                                <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1 mt-1.5 truncate">
                                    Materi: <span className="text-slate-600">{displayLabel}</span>
                                </p>
                            </div>
                        )
                    })
                )}
              </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
