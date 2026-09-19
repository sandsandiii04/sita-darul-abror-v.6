import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, 
  ExamPeriod, 
  ExaminerStudentItem, 
  ExamAttempt,
  ExamQuestion,
  ExamQuestionAssessment
} from '../../types';
import { api } from '../../api';
import { UTSExamSheet } from './UTSExamSheet';
import { UTSAssignExaminerModal } from './UTSAssignExaminerModal';
import { UTSReopenModal } from './UTSReopenModal';
import { UTSExamReviewModal } from './UTSExamReviewModal';
import { 
  ClipboardCheck, 
  Play, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Search, 
  Filter, 
  UserCheck, 
  RefreshCcw, 
  Award, 
  ChevronRight, 
  ShieldCheck, 
  Users, 
  Calendar,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';

interface UTSPelaksanaanViewProps {
  user: User;
}

export const UTSPelaksanaanView: React.FC<UTSPelaksanaanViewProps> = ({ user }) => {
  const [periods, setPeriods] = useState<ExamPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [students, setStudents] = useState<ExaminerStudentItem[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [periodInfo, setPeriodInfo] = useState<{ id: string; name: string; kkm: number; status: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClass, setSelectedClass] = useState('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'ALL' | 'READY' | 'IN_PROGRESS' | 'SUBMITTED' | 'NEED_QUESTIONS'>('ALL');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active exam session state (when testing a student)
  const [activeSession, setActiveSession] = useState<{
    student: ExaminerStudentItem;
    attempt: ExamAttempt;
    kkm: number;
    questions: ExamQuestion[];
    assessments: ExamQuestionAssessment[];
  } | null>(null);

  // Modals state
  const [assignModalStudent, setAssignModalStudent] = useState<ExaminerStudentItem | null>(null);
  const [reopenModalStudent, setReopenModalStudent] = useState<ExaminerStudentItem | null>(null);
  const [viewResultStudent, setViewResultStudent] = useState<{
    student: ExaminerStudentItem;
    questions: ExamQuestion[];
    assessments: ExamQuestionAssessment[];
  } | null>(null);

  const isAdmin = user.role === 'admin';

  // Load available UTS periods
  useEffect(() => {
    loadPeriods();
    loadTeachers();
  }, []);

  const loadPeriods = async () => {
    try {
      const res = await api.getExamPeriods(user);
      if (res.success && res.data) {
        // Filter only UTS periods
        const utsPeriods = res.data.filter(p => p.examType?.toLowerCase() === 'uts');
        setPeriods(utsPeriods);

        // Auto select active or most recent
        const active = utsPeriods.find(p => p.status === 'active') || utsPeriods[0];
        if (active) {
          setSelectedPeriodId(active.id);
        }
      }
    } catch (e: any) {
      console.error('Failed to load periods:', e);
    }
  };

  const loadTeachers = () => {
    try {
      const raw = localStorage.getItem('sita_users_v1');
      const uList: User[] = raw ? JSON.parse(raw) : [];
      const tList = uList.filter(u => u.role === 'teacher' || u.role === 'admin');
      setTeachers(tList);
    } catch (e) {}
  };

  // Load students for selected period
  useEffect(() => {
    if (selectedPeriodId) {
      loadStudents(selectedPeriodId);
    }
  }, [selectedPeriodId]);

  const loadStudents = async (periodId: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getExaminerUTSStudents(periodId, user);
      if (res.success && res.students) {
        setStudents(res.students);
        if (res.period) {
          setPeriodInfo(res.period);
        }
      } else {
        setErrorMsg(res.message || 'Gagal memuat daftar santri.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setIsLoading(false);
    }
  };

  // Start exam
  const handleStartExam = async (student: ExaminerStudentItem) => {
    setErrorMsg(null);
    try {
      const res = await api.startUTSAttempt({
        periodId: selectedPeriodId,
        studentId: student.studentId
      }, user);

      if (res.success && res.attempt && res.questions && res.assessments) {
        setActiveSession({
          student,
          attempt: res.attempt,
          kkm: res.kkm || periodInfo?.kkm || 75,
          questions: res.questions,
          assessments: res.assessments
        });
      } else {
        setErrorMsg(res.message || 'Gagal memulai ujian.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memulai ujian santri.');
    }
  };

  // View exam result for submitted student
  const handleViewResult = async (student: ExaminerStudentItem) => {
    if (!student.attemptId) return;
    try {
      const res = await api.getUTSAttempt(student.attemptId, user);
      if (res.success && res.questions && res.assessments) {
        setViewResultStudent({
          student,
          questions: res.questions,
          assessments: res.assessments
        });
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat hasil ujian.');
    }
  };

  // Assign examiner
  const handleAssignExaminer = async (studentId: string, examinerId: string, reason?: string) => {
    const res = await api.assignExaminer({
      periodId: selectedPeriodId,
      studentId,
      examinerId,
      reason
    }, user);

    if (res.success) {
      await loadStudents(selectedPeriodId);
    } else {
      throw new Error(res.message || 'Gagal menugaskan penguji.');
    }
  };

  // Reopen attempt
  const handleReopen = async (attemptId: string, reason: string) => {
    const res = await api.reopenUTSAttempt({
      attemptId,
      reason
    }, user);

    if (res.success) {
      await loadStudents(selectedPeriodId);
    } else {
      throw new Error(res.message || 'Gagal membuka kembali ujian.');
    }
  };

  // Stats calculation
  const stats = useMemo(() => {
    const total = students.length;
    const ready = students.filter(s => s.snapshotStatus === 'finalized' && s.questionSetStatus === 'locked' && !s.isStale && (!s.attemptStatus || s.attemptStatus === 'void')).length;
    const inProgress = students.filter(s => s.attemptStatus === 'in_progress').length;
    const submitted = students.filter(s => s.attemptStatus === 'submitted').length;
    const kkm = periodInfo?.kkm || 75;
    const passed = students.filter(s => s.attemptStatus === 'submitted' && (s.totalScore || 0) >= kkm).length;
    const failed = students.filter(s => s.attemptStatus === 'submitted' && (s.totalScore || 0) < kkm).length;

    return { total, ready, inProgress, submitted, passed, failed };
  }, [students, periodInfo]);

  // Unique classes
  const classes = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => {
      if (s.class) set.add(s.class);
    });
    return Array.from(set).sort();
  }, [students]);

  // Filtered students
  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = s.studentName.toLowerCase().includes(q);
        const matchNis = s.studentNis?.toLowerCase().includes(q);
        if (!matchName && !matchNis) return false;
      }

      // Class
      if (selectedClass !== 'ALL' && s.class !== selectedClass) {
        return false;
      }

      // Status
      if (selectedStatusFilter === 'READY') {
        return s.snapshotStatus === 'finalized' && s.questionSetStatus === 'locked' && !s.isStale && (!s.attemptStatus || s.attemptStatus === 'void');
      }
      if (selectedStatusFilter === 'IN_PROGRESS') {
        return s.attemptStatus === 'in_progress';
      }
      if (selectedStatusFilter === 'SUBMITTED') {
        return s.attemptStatus === 'submitted';
      }
      if (selectedStatusFilter === 'NEED_QUESTIONS') {
        return s.snapshotStatus !== 'finalized' || s.questionSetStatus !== 'locked' || s.isStale;
      }

      return true;
    });
  }, [students, searchQuery, selectedClass, selectedStatusFilter]);

  // Active exam sheet modal view
  if (activeSession) {
    return (
      <UTSExamSheet
        user={user}
        periodId={selectedPeriodId}
        studentId={activeSession.student.studentId}
        studentName={activeSession.student.studentName}
        studentClass={activeSession.student.class}
        attempt={activeSession.attempt}
        kkm={activeSession.kkm}
        initialQuestions={activeSession.questions}
        initialAssessments={activeSession.assessments}
        onFinish={() => {
          setActiveSession(null);
          loadStudents(selectedPeriodId);
        }}
        onExit={() => {
          setActiveSession(null);
          loadStudents(selectedPeriodId);
        }}
      />
    );
  }

  return (
    <div className="space-y-5 animate-fade-in p-2 sm:p-4 max-w-7xl mx-auto">
      {/* 1. HEADER & PERIOD SELECTOR */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-teal-50 border border-teal-200/80 flex items-center justify-center text-teal-700 shadow-sm shrink-0">
              <ClipboardCheck size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">
                  Pelaksanaan & Penilaian UTS Tahfiz
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">
                  Penguji
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAdmin 
                  ? 'Administrator: Memantau pelaksanaan ujian seluruh santri, atur penguji, dan kontrol koreksi nilai.' 
                  : `Ustadz/Ustadzah: Pelaksanaan pengujian santri yang ditugaskan kepada Anda.`}
              </p>
            </div>
          </div>

          {/* Period selector dropdown */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
              <Calendar size={15} className="text-slate-400" />
              <span>Periode:</span>
            </div>
            <select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.status === 'active' ? '(Aktif)' : `(${p.status})`}
                </option>
              ))}
            </select>

            <button
              onClick={() => loadStudents(selectedPeriodId)}
              className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
              title="Segarkan Data"
            >
              <RefreshCcw size={15} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* 2. STATS CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Santri</span>
            <span className="text-xl font-black text-slate-800">{stats.total}</span>
          </div>

          <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200/70">
            <span className="text-[10px] uppercase font-bold text-teal-700 block">Siap Diuji</span>
            <span className="text-xl font-black text-teal-900">{stats.ready}</span>
          </div>

          <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/70">
            <span className="text-[10px] uppercase font-bold text-amber-700 block">Sedang Berjalan</span>
            <span className="text-xl font-black text-amber-900">{stats.inProgress}</span>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/70">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-emerald-700 block">Selesai (Lulus/Total)</span>
              <span className="text-[10px] text-emerald-600 font-bold">KKM {periodInfo?.kkm || 75}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-black text-emerald-900">{stats.submitted}</span>
              <span className="text-xs text-emerald-700 font-semibold">({stats.passed} Lulus)</span>
            </div>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
          <AlertCircle size={16} className="text-red-500 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 3. SEARCH & FILTERS */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama santri atau NIS..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {/* Class Filter */}
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-700 focus:outline-none"
          >
            <option value="ALL">Semua Kelas</option>
            {classes.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value as any)}
            className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-700 focus:outline-none"
          >
            <option value="ALL">Semua Status</option>
            <option value="READY">Siap Diuji</option>
            <option value="IN_PROGRESS">Sedang Berjalan</option>
            <option value="SUBMITTED">Selesai (Submitted)</option>
            <option value="NEED_QUESTIONS">Belum Siap Soal</option>
          </select>
        </div>
      </div>

      {/* 4. STUDENTS LIST */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <RefreshCcw size={24} className="animate-spin mx-auto text-teal-600" />
            <p className="text-xs">Memuat daftar santri peserta ujian...</p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <Users size={32} className="mx-auto text-slate-300" />
            <p className="text-xs font-semibold text-slate-600">Tidak ada santri yang sesuai kriteria.</p>
            <p className="text-[11px]">Pastikan santri telah terdaftar pada periode evaluasi dan ditugaskan penguji.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredStudents.map((s) => {
              const isReady = s.snapshotStatus === 'finalized' && s.questionSetStatus === 'locked' && !s.isStale && (!s.attemptStatus || s.attemptStatus === 'void');
              const isInProgress = s.attemptStatus === 'in_progress';
              const isSubmitted = s.attemptStatus === 'submitted';
              const isNeedQuestions = !isReady && !isInProgress && !isSubmitted;
              const kkm = periodInfo?.kkm || 75;
              const isPassed = (s.totalScore || 0) >= kkm;

              return (
                <div
                  key={s.studentId}
                  className="p-3.5 sm:p-4 hover:bg-slate-50/70 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
                >
                  {/* Left: Student Identity & Material */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{s.studentName}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold bg-slate-100 text-slate-600">
                        {s.class}
                      </span>
                      {s.studentNis && (
                        <span className="text-[11px] text-slate-400">NIS: {s.studentNis}</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>
                        Halaqah: <strong className="text-slate-700">{s.halaqah || '-'}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Penguji: <strong className="text-teal-800">{s.examinerName || s.teacherName || 'Belum Ditugaskan'}</strong>
                      </span>
                      {isAdmin && (
                        <button
                          onClick={() => setAssignModalStudent(s)}
                          className="text-[10px] text-teal-700 hover:text-teal-900 font-bold underline ml-1"
                        >
                          [Ubah Penguji]
                        </button>
                      )}
                    </div>

                    {/* Material range */}
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <span className="text-slate-400">Materi:</span>
                      {s.startSurahName ? (
                        <span className="font-medium text-slate-700">
                          {s.startSurahName} : {s.startAyah} s.d. {s.endSurahName} : {s.endAyah}
                        </span>
                      ) : (
                        <span className="text-amber-600 italic font-medium">Belum difinalisasi</span>
                      )}
                    </div>
                  </div>

                  {/* Center: Status Badge & Score */}
                  <div className="flex items-center gap-3 shrink-0">
                    {isSubmitted ? (
                      <div className="text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isPassed 
                              ? 'bg-emerald-100 text-emerald-800' 
                              : 'bg-rose-100 text-rose-800'
                          }`}>
                            {isPassed ? 'LULUS' : 'TIDAK LULUS'}
                          </span>
                          <span className="text-sm sm:text-base font-black text-slate-900">
                            {s.totalScore}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">Selesai disubmit</span>
                      </div>
                    ) : isInProgress ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-50 text-amber-900 border border-amber-200">
                        <Clock size={13} className="text-amber-600 animate-pulse" />
                        <span className="text-xs font-bold">Sedang Diuji</span>
                      </div>
                    ) : isReady ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-teal-50 text-teal-800 border border-teal-200">
                        <CheckCircle2 size={13} className="text-teal-600" />
                        <span className="text-xs font-bold">Siap Diuji</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 text-slate-600 text-xs">
                        <AlertTriangle size={13} className="text-amber-600" />
                        <span>Belum Siap Soal</span>
                      </div>
                    )}

                    {/* Right: Actions Buttons */}
                    <div className="flex items-center gap-1.5">
                      {isReady && (
                        <button
                          onClick={() => handleStartExam(s)}
                          className="px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95"
                        >
                          <Play size={13} fill="currentColor" />
                          <span>Mulai Ujian</span>
                        </button>
                      )}

                      {isInProgress && (
                        <button
                          onClick={() => handleStartExam(s)}
                          className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95"
                        >
                          <RotateCcw size={13} />
                          <span>Lanjutkan</span>
                        </button>
                      )}

                      {isSubmitted && (
                        <>
                          <button
                            onClick={() => handleViewResult(s)}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-all flex items-center gap-1"
                          >
                            <Award size={13} />
                            <span>Lihat Rincian</span>
                          </button>

                          {isAdmin && (
                            <button
                              onClick={() => setReopenModalStudent(s)}
                              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-amber-50 hover:text-amber-800 text-slate-600 text-xs font-semibold transition-all border border-slate-200 hover:border-amber-300"
                              title="Buka kembali ujian untuk koreksi nilai (Admin Only)"
                            >
                              <RefreshCcw size={13} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. MODALS */}
      {assignModalStudent && (
        <UTSAssignExaminerModal
          periodId={selectedPeriodId}
          student={assignModalStudent}
          teachers={teachers}
          onAssign={handleAssignExaminer}
          onClose={() => setAssignModalStudent(null)}
        />
      )}

      {reopenModalStudent && (
        <UTSReopenModal
          student={reopenModalStudent}
          onReopen={handleReopen}
          onClose={() => setReopenModalStudent(null)}
        />
      )}

      {viewResultStudent && (
        <UTSExamReviewModal
          studentName={viewResultStudent.student.studentName}
          studentClass={viewResultStudent.student.class}
          kkm={periodInfo?.kkm || 75}
          questions={viewResultStudent.questions}
          assessments={viewResultStudent.assessments}
          onSubmitFinal={async () => {
            // Read-only modal for completed test
            setViewResultStudent(null);
          }}
          onClose={() => setViewResultStudent(null)}
          onNavigateToQuestion={() => {}}
          isReadOnly={true}
        />
      )}
    </div>
  );
};
