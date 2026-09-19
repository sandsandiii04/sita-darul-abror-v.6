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
import { UASExamSheet } from './UASExamSheet';
import { UASAssignExaminerModal } from './UASAssignExaminerModal';
import { UASReopenModal } from './UASReopenModal';
import { UASExamReviewModal } from './UASExamReviewModal';
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
  RotateCcw,
  BookOpen
} from 'lucide-react';

interface UASPelaksanaanViewProps {
  user: User;
}

export const UASPelaksanaanView: React.FC<UASPelaksanaanViewProps> = ({ user }) => {
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

  // Load available UAS periods
  useEffect(() => {
    loadPeriods();
    loadTeachers();
  }, []);

  const loadPeriods = async () => {
    try {
      const res = await api.getExamPeriods(user);
      if (res.success && res.data) {
        // Filter only UAS periods
        const uasPeriods = res.data.filter(p => p.examType?.toLowerCase() === 'uas');
        setPeriods(uasPeriods);

        // Auto select active or most recent
        const active = uasPeriods.find(p => p.status === 'active') || uasPeriods[0];
        if (active) {
          setSelectedPeriodId(active.id);
        }
      }
    } catch (e: any) {
      console.error('Failed to load UAS periods:', e);
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
      const res = await api.getExaminerUASStudents(periodId, user);
      if (res.success && res.students) {
        setStudents(res.students);
        if (res.period) {
          setPeriodInfo(res.period);
        }
      } else {
        setErrorMsg(res.message || 'Gagal memuat daftar santri UAS.');
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
      const res = await api.startUASAttempt({
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
        setErrorMsg(res.message || 'Tidak dapat memulai sesi ujian UAS.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memulai sesi ujian.');
    }
  };

  // View completed exam results
  const handleViewResult = async (student: ExaminerStudentItem) => {
    if (!student.attemptId) return;
    try {
      const res = await api.getUASAttempt(student.attemptId, user);
      if (res.success && res.assessments) {
        // Also fetch questions
        const qRes = await api.getUASQuestionSet(selectedPeriodId, student.studentId, user);
        if (qRes.success && qRes.questions) {
          setViewResultStudent({
            student,
            questions: qRes.questions,
            assessments: res.assessments
          });
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat hasil ujian.');
    }
  };

  // Handle examiner assignment
  const handleAssignExaminer = async (studentId: string, examinerId: string, reason?: string) => {
    const res = await api.assignExaminer({
      periodId: selectedPeriodId,
      studentId,
      examinerId,
      reason
    }, user);

    if (res.success) {
      loadStudents(selectedPeriodId);
    } else {
      throw new Error(res.message || 'Gagal menugaskan penguji.');
    }
  };

  // Handle reopen exam attempt
  const handleReopenExam = async (attemptId: string, reason: string) => {
    const res = await api.reopenUASAttempt({
      attemptId,
      reason
    }, user);

    if (res.success) {
      loadStudents(selectedPeriodId);
    } else {
      throw new Error(res.message || 'Gagal membuka kembali ujian UAS.');
    }
  };

  // Filtered classes list
  const classesList = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => {
      if (s.class && s.class !== '-') set.add(s.class);
    });
    return Array.from(set).sort();
  }, [students]);

  // Filtered students
  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      // Search
      const matchSearch = 
        s.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.studentNis.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.examinerName && s.examinerName.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchSearch) return false;

      // Class
      if (selectedClass !== 'ALL' && s.class !== selectedClass) return false;

      // Status
      if (selectedStatusFilter === 'READY') {
        return s.hasAssignment && s.questionSetStatus === 'locked' && !s.attemptStatus;
      }
      if (selectedStatusFilter === 'IN_PROGRESS') {
        return s.attemptStatus === 'in_progress';
      }
      if (selectedStatusFilter === 'SUBMITTED') {
        return s.attemptStatus === 'submitted';
      }
      if (selectedStatusFilter === 'NEED_QUESTIONS') {
        return !s.questionSetId || s.questionSetStatus === 'stale';
      }

      return true;
    });
  }, [students, searchQuery, selectedClass, selectedStatusFilter]);

  // Statistics counters
  const stats = useMemo(() => {
    const total = students.length;
    const submitted = students.filter(s => s.attemptStatus === 'submitted').length;
    const inProgress = students.filter(s => s.attemptStatus === 'in_progress').length;
    const ready = students.filter(s => s.hasAssignment && s.questionSetStatus === 'locked' && !s.attemptStatus).length;
    const needQuestions = students.filter(s => !s.questionSetId || s.questionSetStatus === 'stale').length;

    return { total, submitted, inProgress, ready, needQuestions };
  }, [students]);

  // If in active examination session, render full screen exam sheet
  if (activeSession) {
    return (
      <UASExamSheet
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
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-800 to-teal-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-80 h-80 bg-white/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
                <ClipboardCheck size={22} className="text-emerald-300" />
              </div>
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-300 bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-500/30">
                TAHAP 6B — PENGUJI RESMI
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Pelaksanaan & Penilaian UAS Tahfiz
            </h1>
            <p className="text-sm text-teal-100/80 mt-1 max-w-2xl leading-relaxed">
              Pengujian 9 butir soal UAS resmi (2 Wajib Halaman Penuh @15p + 7 Acak @10p = 100p) dengan counter penilaian presisi, rekapitulasi real-time, dan audit trail.
            </p>
          </div>

          {/* Period Selector */}
          <div className="bg-white/10 backdrop-blur-md p-3 rounded-2xl border border-white/20 min-w-[240px]">
            <label className="text-[11px] font-bold text-teal-200 uppercase tracking-wider block mb-1">
              Pilih Periode UAS Aktif
            </label>
            <select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              className="w-full bg-slate-900/80 text-white text-xs font-bold p-2.5 rounded-xl border border-white/20 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              {periods.length === 0 && <option value="">Tidak ada periode UAS aktif</option>}
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.status === 'active' ? '(Aktif)' : `(${p.status})`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Stats Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-white/10">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-3 border border-white/10">
            <span className="text-[11px] text-teal-200 block font-medium">Total Peserta</span>
            <span className="text-xl font-black text-white">{stats.total} Santri</span>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-3 border border-white/10">
            <span className="text-[11px] text-emerald-200 block font-medium">Siap Diuji</span>
            <span className="text-xl font-black text-emerald-300">{stats.ready} Santri</span>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-3 border border-white/10">
            <span className="text-[11px] text-amber-200 block font-medium">Sedang Berjalan</span>
            <span className="text-xl font-black text-amber-300">{stats.inProgress} Santri</span>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-3 border border-white/10">
            <span className="text-[11px] text-teal-200 block font-medium">Selesai (Submitted)</span>
            <span className="text-xl font-black text-white">{stats.submitted} Santri</span>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-between text-xs text-red-700 animate-fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-red-500 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600 font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari santri, NIS, atau penguji..."
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-slate-700 placeholder-slate-400"
            />
          </div>

          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="text-xs p-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-700 font-medium"
          >
            <option value="ALL">Semua Kelas</option>
            {classesList.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
          <button
            onClick={() => setSelectedStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              selectedStatusFilter === 'ALL'
                ? 'bg-teal-700 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Semua ({stats.total})
          </button>
          <button
            onClick={() => setSelectedStatusFilter('READY')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              selectedStatusFilter === 'READY'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Siap ({stats.ready})
          </button>
          <button
            onClick={() => setSelectedStatusFilter('IN_PROGRESS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              selectedStatusFilter === 'IN_PROGRESS'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Berjalan ({stats.inProgress})
          </button>
          <button
            onClick={() => setSelectedStatusFilter('SUBMITTED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              selectedStatusFilter === 'SUBMITTED'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Selesai ({stats.submitted})
          </button>
        </div>
      </div>

      {/* Participants Grid */}
      {isLoading ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm">
          <RefreshCcw size={32} className="animate-spin text-teal-600 mx-auto mb-3" />
          <p className="text-xs font-bold text-slate-600">Memuat data pelaksanaan UAS...</p>
        </div>
      ) : filteredStudents.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm">
          <Users size={36} className="text-slate-300 mx-auto mb-2" />
          <h4 className="text-sm font-bold text-slate-700">Tidak ada data santri</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Tidak ditemukan santri yang memenuhi kriteria filter atau belum ditugaskan kepada Anda.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStudents.map(student => {
            const hasQuestions = student.questionSetStatus === 'locked';
            const isStale = student.questionSetStatus === 'stale';
            const hasAssignment = student.hasAssignment;
            const isAssignedToMe = student.examinerId === user.id;
            const canExamine = isAdmin || isAssignedToMe;
            const isSubmitted = student.attemptStatus === 'submitted';
            const isInProgress = student.attemptStatus === 'in_progress';
            const isReady = hasQuestions && hasAssignment && !student.attemptStatus;
            const isPassed = (student.totalScore || 0) >= (periodInfo?.kkm || 75);

            return (
              <div
                key={student.studentId}
                className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Top Badge: Status */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                      Kelas {student.class}
                    </span>

                    {isSubmitted ? (
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                        <CheckCircle2 size={11} />
                        <span>Selesai (Skor: {student.totalScore})</span>
                      </span>
                    ) : isInProgress ? (
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1">
                        <Clock size={11} />
                        <span>{student.completedQuestionsCount || 0}/9 Soal Selesai</span>
                      </span>
                    ) : isReady ? (
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 flex items-center gap-1">
                        <Play size={10} />
                        <span>Siap Diuji</span>
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 flex items-center gap-1">
                        <AlertTriangle size={11} />
                        <span>Belum Siap</span>
                      </span>
                    )}
                  </div>

                  {/* Student Name & NIS */}
                  <h3 className="font-extrabold text-sm text-slate-800 tracking-tight leading-snug">
                    {student.studentName}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">NIS: {student.studentNis}</p>

                  {/* Material & Examiner Information */}
                  <div className="mt-3 space-y-1.5 text-xs">
                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 block">Materi Uji UAS:</span>
                      <span className="font-bold text-slate-700">
                        {student.startSurahName} s.d. {student.endSurahName}
                      </span>
                    </div>

                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-slate-400 block">Penguji Ditugaskan:</span>
                        <span className={`font-bold ${student.examinerName ? 'text-slate-700' : 'text-rose-500'}`}>
                          {student.examinerName || 'Belum Ditugaskan'}
                        </span>
                      </div>
                      {isAdmin && (
                        <button
                          onClick={() => setAssignModalStudent(student)}
                          className="p-1 rounded-lg text-teal-700 hover:bg-teal-50 transition-colors"
                          title="Ubah Penguji"
                        >
                          <UserCheck size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                  {isSubmitted ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleViewResult(student)}
                        className="flex-1 py-2 px-3 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Award size={14} className="text-teal-600" />
                        <span>Lihat Hasil Nilai</span>
                      </button>

                      {isAdmin && (
                        <button
                          onClick={() => setReopenModalStudent(student)}
                          className="py-2 px-3 rounded-xl text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1"
                          title="Buka Kembali Ujian"
                        >
                          <RotateCcw size={13} />
                          <span>Buka Kembali</span>
                        </button>
                      )}
                    </div>
                  ) : isInProgress ? (
                    <button
                      onClick={() => handleStartExam(student)}
                      disabled={!canExamine}
                      className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold text-white transition-all shadow-sm flex items-center justify-center gap-2 ${
                        canExamine 
                          ? 'bg-amber-600 hover:bg-amber-700 cursor-pointer' 
                          : 'bg-slate-400 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <Play size={14} />
                      <span>Lanjutkan Ujian ({student.completedQuestionsCount || 0}/9)</span>
                    </button>
                  ) : isReady ? (
                    <button
                      onClick={() => handleStartExam(student)}
                      disabled={!canExamine}
                      className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold text-white transition-all shadow-sm flex items-center justify-center gap-2 ${
                        canExamine 
                          ? 'bg-teal-600 hover:bg-teal-700 cursor-pointer' 
                          : 'bg-slate-400 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <Play size={14} />
                      <span>Mulai Ujian UAS</span>
                    </button>
                  ) : (
                    <div className="text-center py-1.5 text-[11px] text-slate-400">
                      {!hasAssignment ? 'Tugaskan penguji terlebih dahulu' : 'Soal UAS belum dibuat/stale'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {assignModalStudent && (
        <UASAssignExaminerModal
          periodId={selectedPeriodId}
          student={assignModalStudent}
          teachers={teachers}
          onAssign={handleAssignExaminer}
          onClose={() => setAssignModalStudent(null)}
        />
      )}

      {reopenModalStudent && (
        <UASReopenModal
          student={reopenModalStudent}
          onReopen={handleReopenExam}
          onClose={() => setReopenModalStudent(null)}
        />
      )}

      {viewResultStudent && (
        <UASExamReviewModal
          studentName={viewResultStudent.student.studentName}
          studentClass={viewResultStudent.student.class}
          kkm={periodInfo?.kkm || 75}
          questions={viewResultStudent.questions}
          assessments={viewResultStudent.assessments}
          onSubmitFinal={async () => {}}
          onClose={() => setViewResultStudent(null)}
          onNavigateToQuestion={() => {}}
          isReadOnly={true}
        />
      )}
    </div>
  );
};
