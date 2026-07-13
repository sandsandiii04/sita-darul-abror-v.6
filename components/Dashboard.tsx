
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

const StatCard = ({ title, value, icon: Icon, color }: any) => (
  <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
    <div className={`p-4 rounded-lg ${color} text-white`}>
      <Icon size={24} />
    </div>
    <div>
      <p className="text-sm text-gray-500 mb-1">{title}</p>
      <h3 className="text-2xl font-bold text-gray-800">{value}</h3>
    </div>
  </div>
);

const Dashboard: React.FC<DashboardProps> = ({ user, students, records, exams = [], connectionError, onNavigate }) => {
  // Check connection status based on URL config AND actual fetch result
  const hasEnv = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY;
  const hasLocal = typeof window !== 'undefined' && window.localStorage.getItem('sita_supabase_url') && window.localStorage.getItem('sita_supabase_anon_key');
  const isOnline = !!(hasEnv || hasLocal) && !connectionError;

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
    <div className="space-y-6 animate-fade-in">
      {/* Connection Status Banner */}
      <div className={`flex items-center justify-between px-4 py-2 rounded-lg border gap-3 ${isOnline ? 'bg-blue-50 border-blue-100 text-blue-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
        <div className="flex items-center gap-2">
            {isOnline ? <Wifi size={16} className="text-blue-600" /> : <WifiOff size={16} className="text-red-600" />}
            <span className="font-bold text-xs">
                {isOnline ? "Mode Online" : "Mode Offline"}
            </span>
        </div>
        {!isOnline && user.role === 'admin' && (
            <button 
                onClick={() => onNavigate && onNavigate('tutorial')}
                className="flex items-center gap-1.5 bg-white px-3 py-1 rounded-md text-[10px] font-bold border border-red-200 shadow-sm text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap"
            >
                <AlertTriangle size={12} />
                Setup Database <ArrowRight size={12} />
            </button>
        )}
      </div>

      {/* Stat Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Santri" 
          value={displayStudents.length} 
          icon={Users} 
          color="bg-blue-500" 
        />
        <StatCard 
          title="Rata-rata Juz" 
          value={averageJuz} 
          icon={Book} 
          color="bg-emerald-500" 
        />
        <StatCard 
          title="Setoran Sabaq" 
          value={totalSabaq} 
          icon={TrendingUp} 
          color="bg-purple-500" 
        />
        <StatCard 
          title="Muroja'ah (Sabqi & Manzil)" 
          value={totalMurojaah} 
          icon={Calendar} 
          color="bg-orange-500" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart (Left Column) */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Grafik Capaian Mingguan (Halaman)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="pages" fill="#10b981" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column: Top Students & Recent Exams */}
        <div className="space-y-6">
            
            {/* Top Students */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Trophy className="text-yellow-500" size={20} />
                Santri Terbaik Pekan Ini
              </h3>
              <div className="space-y-4">
                {displayStudents.slice(0, 3).map((s, idx) => (
                  <div key={s.id} className="flex items-center gap-3 pb-3 border-b last:border-0 last:pb-0">
                    <div className={`
                      w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm
                      ${idx === 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}
                    `}>
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm text-gray-800">{s.name}</p>
                      <p className="text-xs text-gray-500">{s.class} - {s.totalJuz} Juz</p>
                    </div>
                  </div>
                ))}
                {displayStudents.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">Belum ada data santri.</p>
                )}
              </div>
            </div>

            {/* Recent Exams (NEW) */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Award className="text-purple-500" size={20} />
                Hasil Ujian Terbaru
              </h3>
              <div className="space-y-4">
                {recentExams.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Belum ada data ujian.</p>
                ) : (
                    recentExams.map(exam => {
                        const s = students.find(st => st.id === exam.studentId);
                        
                        // Handle display when details might be missing (data from cloud)
                        // Priority: 1. Full Details 2. Flat Juz & Category 3. Just Category
                        const displayLabel = exam.details 
                          ? `${exam.details.surat || exam.details.halaman}`
                          : exam.category;
                        
                        // Menampilkan Juz dan Kelas
                        const juzLabel = exam.juz || exam.details?.juz || '-';
                        const classLabel = s?.class || exam.class || '-';

                        return (
                            <div key={exam.id} className="border-b pb-3 last:border-0 last:pb-0">
                                <div className="flex justify-between items-start mb-1">
                                    <div>
                                      <p className="font-bold text-sm text-gray-800 truncate w-36">{s?.name}</p>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 border font-medium">Kelas {classLabel}</span>
                                        <span className="text-[10px] bg-indigo-50 px-1.5 py-0.5 rounded text-indigo-600 border border-indigo-100 font-medium">{juzLabel}</span>
                                      </div>
                                    </div>
                                    <span className={`text-xs font-bold px-2 py-1 rounded ${exam.score >= 70 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                        {exam.score}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                                    Materi: {displayLabel}
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
