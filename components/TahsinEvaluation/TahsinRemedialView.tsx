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
  RotateCcw, 
  Search, 
  Filter, 
  CheckCircle2, 
  AlertTriangle, 
  Award, 
  History, 
  Play, 
  Layers, 
  FileText,
  TrendingUp,
  ArrowRight
} from 'lucide-react';

interface TahsinRemedialViewProps {
  user: User;
  students: Student[];
  teachers?: User[];
  users?: User[];
}

export const TahsinRemedialView: React.FC<TahsinRemedialViewProps> = ({
  user,
  students,
  teachers = [],
  users
}) => {
  const [periods, setPeriods] = useState<TahsinPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [sessions, setSessions] = useState<TahsinSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterClass, setFilterClass] = useState<string>('');

  // Active Remedial Exam Sheet
  const [activeSession, setActiveSession] = useState<TahsinSession | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState<TahsinSession | null>(null);

  const loadData = async () => {
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
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [students]);

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);

  // Remedial Sessions: Santri yang belum lulus / sedang remedial / selesai remedial
  const remedialSessions = useMemo(() => {
    return sessions.filter(session => {
      // Hanya tampilkan yang memiliki riwayat ujian dan perlu remedial atau memiliki >1 attempts
      const attempts = session.attempts || [];
      const hasFailed = session.passingStatus === 'remedial' || session.status === 'remedial_needed';
      const hasMultipleAttempts = attempts.length > 1;

      if (!hasFailed && !hasMultipleAttempts) return false;

      // Teacher authorization
      if (user.role === 'teacher') {
        const studentObj = students.find(s => s.id === session.studentId);
        const isMyStudent = studentObj?.teacherId === user.id || session.examinerId === user.id;
        if (!isMyStudent) return false;
      }

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = session.studentNameSnapshot.toLowerCase().includes(q);
        const studentObj = students.find(s => s.id === session.studentId);
        const matchesNis = studentObj?.nis.includes(q);
        if (!matchesName && !matchesNis) return false;
      }

      // Class filter
      if (filterClass && session.classSnapshot !== filterClass) return false;

      return true;
    });
  }, [sessions, user, searchQuery, filterClass, students]);

  const classOptions = useMemo(() => Array.from(new Set(sessions.map(s => s.classSnapshot))).sort(), [sessions]);

  // Handler Buka Lembar Ujian Remedial Baru
  const handleStartRemedial = (session: TahsinSession) => {
    setActiveSession(session);
  };

  if (activeSession) {
    const studentObj = students.find(s => s.id === activeSession.studentId)!;
    const nextAttemptNum = (activeSession.latestAttemptNumber || 1) + 1;
    return (
      <TahsinExamSheet
        user={user}
        period={selectedPeriod!}
        session={activeSession}
        student={studentObj}
        attemptNumber={nextAttemptNum}
        attemptType="remedial"
        onBack={() => setActiveSession(null)}
        onSuccess={() => {
          setActiveSession(null);
          loadData();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-800 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-100">
            Sistem Pembinaan & Perbaikan
          </span>
          <h2 className="text-xl font-extrabold text-slate-800 tracking-tight mt-1 flex items-center gap-2">
            <RotateCcw className="text-rose-600" size={22} />
            Ujian Remedial Tahsin Al-Qur'an
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Kelola santri yang belum mencapai standar KKM kelulusan dengan bacaan baru tanpa menghapus rekam jejak nilai sebelumnya.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto text-xs">
          <span className="font-bold text-slate-500">Periode:</span>
          <select
            value={selectedPeriodId}
            onChange={(e) => {
              setSelectedPeriodId(e.target.value);
              tahsinService.fetchSessions(e.target.value).then(setSessions);
            }}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none"
          >
            {periods.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 flex flex-col sm:flex-row gap-3 text-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari santri remedial..."
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white text-xs font-medium"
          />
        </div>

        <select
          value={filterClass}
          onChange={(e) => setFilterClass(e.target.value)}
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-medium outline-none"
        >
          <option value="">Semua Kelas</option>
          {classOptions.map(c => <option key={c} value={c}>Kelas {c}</option>)}
        </select>
      </div>

      {/* Remedial Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-slate-600 border-b border-slate-200 text-[11px] font-bold">
                <th className="p-3 text-center w-12">No</th>
                <th className="p-3">Nama Santri</th>
                <th className="p-3 text-center">Kelas</th>
                <th className="p-3">Halaqah</th>
                <th className="p-3 text-center">Nilai Ujian Utama</th>
                <th className="p-3 text-center">Nilai Remedial Terakhir</th>
                <th className="p-3 text-center">Aspek Belum Tuntas</th>
                <th className="p-3 text-center">Status Sekarang</th>
                <th className="p-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {remedialSessions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    Tidak ada santri yang membutuhkan remedial pada periode ini.
                  </td>
                </tr>
              ) : (
                remedialSessions.map((session, idx) => {
                  const attempts = (session.attempts || []).sort((a, b) => a.attemptNumber - b.attemptNumber);
                  const firstAttempt = attempts[0];
                  const latestAttempt = attempts[attempts.length - 1];

                  // Identifikasi aspek yang belum memenuhi KKM
                  const failedAspects: string[] = [];
                  if (firstAttempt) {
                    if (firstAttempt.makharij.score < (selectedPeriod?.minMakharij || 75)) failedAspects.push('Makharij');
                    if (firstAttempt.tajwid.score < (selectedPeriod?.minTajwid || 75)) failedAspects.push('Tajwid');
                    if (firstAttempt.kelancaran.score < 70) failedAspects.push('Kelancaran');
                    if (firstAttempt.waqaf.score < 70) failedAspects.push('Waqaf');
                    if (firstAttempt.hasCriticalError) failedAspects.push('Kesalahan Berat');
                  }

                  const isResolved = latestAttempt && latestAttempt.passingStatus === 'lulus' && attempts.length > 1;

                  return (
                    <tr key={session.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3 text-center text-slate-400 font-bold">{idx + 1}</td>
                      <td className="p-3">
                        <div className="font-extrabold text-slate-800">{session.studentNameSnapshot}</div>
                        <div className="text-[10px] text-slate-400">Total Percobaan: {attempts.length}x</div>
                      </td>
                      <td className="p-3 text-center font-bold text-slate-600">{session.classSnapshot}</td>
                      <td className="p-3 font-medium text-slate-600">{session.halaqahSnapshot}</td>
                      <td className="p-3 text-center">
                        {firstAttempt ? (
                          <div className="font-mono font-bold text-slate-700">
                            {firstAttempt.finalScore.toFixed(1)}
                            <span className="text-[10px] text-rose-600 block font-normal">({firstAttempt.predikat})</span>
                          </div>
                        ) : '-'}
                      </td>
                      <td className="p-3 text-center">
                        {attempts.length > 1 && latestAttempt ? (
                          <div className="font-mono font-bold text-emerald-700">
                            {latestAttempt.finalScore.toFixed(1)}
                            <span className="text-[10px] text-emerald-600 block font-normal">({latestAttempt.predikat})</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">Belum diuji ulang</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex flex-wrap justify-center gap-1">
                          {failedAspects.map(asp => (
                            <span key={asp} className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[9px] font-bold">
                              {asp}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        {isResolved ? (
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black inline-flex items-center gap-1">
                            <CheckCircle2 size={12} /> TUNTAS (LULUS)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-black inline-flex items-center gap-1">
                            <AlertTriangle size={12} /> PERLU REMEDIAL
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleStartRemedial(session)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-all shadow-sm"
                            title="Lakukan Remedial Baru dengan Bacaan Baru"
                          >
                            <Play size={12} /> Uji Remedial
                          </button>
                          <button
                            onClick={() => setShowHistoryModal(session)}
                            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
                            title="Lihat Riwayat & Progres Nilai"
                          >
                            <History size={16} />
                          </button>
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

      {/* MODAL: Riwayat & Progres Nilai Remedial */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-fade-in border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-base text-slate-800 flex items-center gap-2">
                  <TrendingUp className="text-emerald-600" size={18} />
                  Perkembangan Nilai Remedial
                </h3>
                <p className="text-xs text-slate-500">Santri: <strong>{showHistoryModal.studentNameSnapshot}</strong> ({showHistoryModal.classSnapshot})</p>
              </div>
              <button
                onClick={() => setShowHistoryModal(null)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              {(showHistoryModal.attempts || []).map((att) => (
                <div key={att.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-slate-800">
                      {att.attemptType === 'utama' ? '1. Ujian Utama' : `Percobaan #${att.attemptNumber} (Remedial)`}
                    </span>
                    <span className={`px-2 py-0.5 rounded font-black text-[10px] ${
                      att.passingStatus === 'lulus' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}>
                      {att.passingStatus === 'lulus' ? 'LULUS' : 'REMEDIAL'}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-500">
                    Tanggal: {att.examDate} • Penguji: {att.examinerName}
                  </div>

                  <div className="text-[11px] text-emerald-800 font-medium bg-emerald-50/50 p-2 rounded-lg border border-emerald-100">
                    Bacaan: {att.reading.startSurahName} ({att.reading.startAyah}-{att.reading.endAyah}), Hal. {att.reading.startPage} ({att.reading.pagesRead} Hal)
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] pt-1">
                    <div className="bg-white p-1.5 rounded border border-slate-200">
                      <div className="text-slate-400">Makharij</div>
                      <div className="font-bold text-slate-800 mt-0.5">{att.makharij.score}</div>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-slate-200">
                      <div className="text-slate-400">Tajwid</div>
                      <div className="font-bold text-slate-800 mt-0.5">{att.tajwid.score}</div>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-slate-200">
                      <div className="text-slate-400">Kelancaran</div>
                      <div className="font-bold text-slate-800 mt-0.5">{att.kelancaran.score}</div>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-slate-200">
                      <div className="text-slate-400">Waqaf</div>
                      <div className="font-bold text-slate-800 mt-0.5">{att.waqaf.score}</div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-1 border-t border-slate-200 text-xs">
                    <span className="font-bold text-slate-600">Nilai Akhir:</span>
                    <span className="font-black text-emerald-700 text-sm">{att.finalScore.toFixed(2)} ({att.predikat})</span>
                  </div>

                  {att.coachingNotes && (
                    <div className="text-[11px] text-slate-600 bg-white p-2 rounded border border-slate-200 italic">
                      "{att.coachingNotes}"
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TahsinRemedialView;
