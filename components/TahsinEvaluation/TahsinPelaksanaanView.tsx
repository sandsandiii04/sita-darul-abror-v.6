import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, 
  Student, 
  TahsinPeriod, 
  TahsinSession, 
  TahsinAttempt 
} from '../../types';
import { tahsinService } from '../../services/tahsinService';
import { TahsinExamSheet } from './TahsinExamSheet';
import { 
  Search, 
  Filter, 
  BookOpen, 
  Award, 
  CheckCircle2, 
  AlertTriangle, 
  Play, 
  Clock, 
  Layers, 
  Users, 
  ChevronRight,
  RotateCcw,
  RefreshCw
} from 'lucide-react';

interface TahsinPelaksanaanViewProps {
  user: User;
  students: Student[];
  teachers?: User[];
  users?: User[];
}

export const TahsinPelaksanaanView: React.FC<TahsinPelaksanaanViewProps> = ({
  user,
  students,
  teachers,
  users
}) => {
  const allTeachers = teachers || users || [];
  const [periods, setPeriods] = useState<TahsinPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [sessions, setSessions] = useState<TahsinSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterClass, setFilterClass] = useState<string>('');
  const [filterHalaqah, setFilterHalaqah] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Active Session for Exam Sheet
  const [activeSession, setActiveSession] = useState<TahsinSession | null>(null);
  const [activeAttemptToEdit, setActiveAttemptToEdit] = useState<TahsinAttempt | null>(null);
  const [activeAttemptType, setActiveAttemptType] = useState<'utama' | 'remedial'>('utama');
  const [activeAttemptNumber, setActiveAttemptNumber] = useState<number>(1);

  // Load Periods
  const loadData = async () => {
    setIsLoading(true);
    try {
      const fetchedPeriods = await tahsinService.fetchPeriods();
      setPeriods(fetchedPeriods);

      const activePeriod = fetchedPeriods.find(p => p.status === 'active') || fetchedPeriods[0];
      if (activePeriod) {
        setSelectedPeriodId(activePeriod.id);
        const fetchedSessions = await tahsinService.fetchSessions(activePeriod.id);
        if (fetchedSessions.length === 0) {
          // Inisialisasi otomatis jika belum ada peserta
          const initialized = tahsinService.initializeSessionsForPeriod(activePeriod, students, allTeachers);
          setSessions(initialized);
        } else {
          setSessions(fetchedSessions);
        }
      }
    } catch (e) {
      console.error('Gagal memuat data pelaksanaan tahsin:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [students]);

  // Handle Period Change
  const handlePeriodChange = async (newPeriodId: string) => {
    setSelectedPeriodId(newPeriodId);
    setIsLoading(true);
    try {
      const targetPeriod = periods.find(p => p.id === newPeriodId);
      const fetched = await tahsinService.fetchSessions(newPeriodId);
      if (fetched.length === 0 && targetPeriod) {
        const initialized = tahsinService.initializeSessionsForPeriod(targetPeriod, students, allTeachers);
        setSessions(initialized);
      } else {
        setSessions(fetched);
      }
    } catch (e) {
      console.error('Gagal ganti periode:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);

  // Filter List Peserta
  const filteredSessions = useMemo(() => {
    return sessions.filter(session => {
      // 1. Role Authorization: Teacher only sees their assigned students/halaqah
      if (user.role === 'teacher') {
        const studentObj = students.find(s => s.id === session.studentId);
        const isMyStudent = studentObj?.teacherId === user.id || session.examinerId === user.id;
        if (!isMyStudent) return false;
      }

      // 2. Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = session.studentNameSnapshot.toLowerCase().includes(q);
        const studentObj = students.find(s => s.id === session.studentId);
        const matchesNis = studentObj?.nis.includes(q);
        if (!matchesName && !matchesNis) return false;
      }

      // 3. Class filter
      if (filterClass && session.classSnapshot !== filterClass) {
        return false;
      }

      // 4. Halaqah filter
      if (filterHalaqah && session.halaqahSnapshot !== filterHalaqah) {
        return false;
      }

      // 5. Status filter
      if (filterStatus === 'not_started' && session.status !== 'not_started') return false;
      if (filterStatus === 'draft' && session.status !== 'draft') return false;
      if (filterStatus === 'lulus' && (session.status !== 'completed' || session.passingStatus !== 'lulus')) return false;
      if (filterStatus === 'remedial' && (session.status !== 'remedial_needed' && session.passingStatus !== 'remedial')) return false;

      return true;
    });
  }, [sessions, user, searchQuery, filterClass, filterHalaqah, filterStatus, students]);

  // Derived options for filter dropdowns
  const classOptions = useMemo(() => Array.from(new Set(sessions.map(s => s.classSnapshot))).sort(), [sessions]);
  const halaqahOptions = useMemo(() => Array.from(new Set(sessions.map(s => s.halaqahSnapshot))).sort(), [sessions]);

  // Progress Stats
  const completedCount = sessions.filter(s => s.status === 'completed' || s.status === 'remedial_needed').length;
  const progressPercent = sessions.length > 0 ? Math.round((completedCount / sessions.length) * 100) : 0;

  // Trigger Uji Santri
  const handleStartExam = (session: TahsinSession, type: 'utama' | 'remedial' = 'utama') => {
    const student = students.find(s => s.id === session.studentId);
    if (!student) {
      alert('Data santri tidak ditemukan.');
      return;
    }

    const attempts = session.attempts || [];
    let attemptToEdit: TahsinAttempt | null = null;
    let nextAttemptNum = 1;

    if (type === 'remedial') {
      nextAttemptNum = (session.latestAttemptNumber || 1) + 1;
    } else {
      if (attempts.length > 0) {
        attemptToEdit = attempts[0];
        nextAttemptNum = 1;
      }
    }

    setActiveSession(session);
    setActiveAttemptToEdit(attemptToEdit);
    setActiveAttemptType(type);
    setActiveAttemptNumber(nextAttemptNum);
  };

  // If in active exam mode, render the Exam Sheet
  if (activeSession) {
    const studentObj = students.find(s => s.id === activeSession.studentId)!;
    return (
      <TahsinExamSheet
        user={user}
        period={selectedPeriod!}
        session={activeSession}
        student={studentObj}
        attemptToEdit={activeAttemptToEdit}
        attemptNumber={activeAttemptNumber}
        attemptType={activeAttemptType}
        onBack={() => {
          setActiveSession(null);
          setActiveAttemptToEdit(null);
        }}
        onSuccess={() => {
          setActiveSession(null);
          setActiveAttemptToEdit(null);
          loadData();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Banner & Periode Selector */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100">
            Modul Evaluasi Tahsin Al-Qur'an
          </span>
          <h2 className="text-xl font-extrabold text-slate-800 tracking-tight mt-1">
            Pelaksanaan Ujian Tahsin
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Evaluasi kualitas bacaan santri dengan mushaf Al-Qur'an secara objektif dan terstruktur.
          </p>
        </div>

        {/* Periode Selector */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <label className="text-xs font-bold text-slate-500">Periode:</label>
          <select
            value={selectedPeriodId}
            onChange={(e) => handlePeriodChange(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            {periods.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.status.toUpperCase()})
              </option>
            ))}
          </select>
          <button
            onClick={loadData}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors"
            title="Refresh Data"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Progress & Quick Stats Card */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase">Total Peserta</div>
          <div className="text-xl font-black text-slate-800 mt-0.5">{sessions.length}</div>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase">Sudah Diuji</div>
          <div className="text-xl font-black text-emerald-700 mt-0.5">{completedCount}</div>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase">Belum Diuji</div>
          <div className="text-xl font-black text-amber-700 mt-0.5">{sessions.length - completedCount}</div>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase">Progres Ujian</div>
          <div className="text-xl font-black text-teal-700 mt-0.5">{progressPercent}%</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama atau NIS..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white text-xs font-medium"
            />
          </div>

          {/* Filter Kelas */}
          <div>
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white font-medium"
            >
              <option value="">Semua Kelas</option>
              {classOptions.map(c => <option key={c} value={c}>Kelas {c}</option>)}
            </select>
          </div>

          {/* Filter Halaqah */}
          <div>
            <select
              value={filterHalaqah}
              onChange={(e) => setFilterHalaqah(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white font-medium"
            >
              <option value="">Semua Halaqah</option>
              {halaqahOptions.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>

          {/* Filter Status */}
          <div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white font-medium"
            >
              <option value="all">Semua Status</option>
              <option value="not_started">Belum Diuji</option>
              <option value="draft">Draft Tersimpan</option>
              <option value="lulus">Lulus</option>
              <option value="remedial">Perlu Remedial</option>
            </select>
          </div>
        </div>
      </div>

      {/* Participants Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-slate-600 border-b border-slate-200 text-[11px] font-bold">
                <th className="p-3 text-center w-12">No</th>
                <th className="p-3">Nama Santri</th>
                <th className="p-3 text-center">Kelas</th>
                <th className="p-3">Halaqah</th>
                <th className="p-3 text-center">Cakupan Juz</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-center">Nilai Akhir</th>
                <th className="p-3 text-center">Predikat</th>
                <th className="p-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    Tidak ada peserta ujian tahsin yang sesuai dengan filter.
                  </td>
                </tr>
              ) : (
                filteredSessions.map((session, idx) => {
                  const coverageRule = tahsinService.getCoverageByClass(session.classSnapshot);
                  const isCompleted = session.status === 'completed' || session.status === 'remedial_needed';
                  const isRemedial = session.passingStatus === 'remedial' || session.status === 'remedial_needed';

                  return (
                    <tr key={session.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3 text-center text-slate-400 font-bold">{idx + 1}</td>
                      <td className="p-3">
                        <div className="font-extrabold text-slate-800">{session.studentNameSnapshot}</div>
                        <div className="text-[10px] text-slate-400">Percobaan #{session.latestAttemptNumber || 1}</div>
                      </td>
                      <td className="p-3 text-center font-bold text-slate-600">
                        {session.classSnapshot}
                      </td>
                      <td className="p-3 font-medium text-slate-600">
                        {session.halaqahSnapshot}
                      </td>
                      <td className="p-3 text-center">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-100 text-[10px] font-bold">
                          Juz {session.targetJuzStart}–{session.targetJuzEnd}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {session.status === 'not_started' && (
                          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-bold text-[10px]">
                            Belum Diuji
                          </span>
                        )}
                        {session.status === 'draft' && (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 font-bold text-[10px]">
                            Draft
                          </span>
                        )}
                        {session.status === 'completed' && session.passingStatus === 'lulus' && (
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] flex items-center justify-center gap-1">
                            <CheckCircle2 size={12} /> Lulus
                          </span>
                        )}
                        {isRemedial && (
                          <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[10px] flex items-center justify-center gap-1">
                            <AlertTriangle size={12} /> Perlu Remedial
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center font-black text-slate-800">
                        {session.finalScore !== undefined ? session.finalScore.toFixed(2) : '-'}
                      </td>
                      <td className="p-3 text-center font-bold text-slate-600">
                        {session.predikat || '-'}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {session.status === 'not_started' && (
                            <button
                              onClick={() => handleStartExam(session, 'utama')}
                              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-all shadow-sm"
                            >
                              <Play size={12} /> Uji
                            </button>
                          )}

                          {session.status === 'draft' && (
                            <button
                              onClick={() => handleStartExam(session, 'utama')}
                              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs transition-all shadow-sm"
                            >
                              <Clock size={12} /> Lanjut Draft
                            </button>
                          )}

                          {session.status === 'completed' && (
                            <button
                              onClick={() => handleStartExam(session, 'utama')}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
                            >
                              Lihat Nilai
                            </button>
                          )}

                          {isRemedial && (
                            <button
                              onClick={() => handleStartExam(session, 'remedial')}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-all shadow-sm"
                              title="Lakukan Ujian Remedial Baru"
                            >
                              <RotateCcw size={12} /> Remedial
                            </button>
                          )}
                        </div>
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
  );
};

export default TahsinPelaksanaanView;
