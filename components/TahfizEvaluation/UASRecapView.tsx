import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, 
  ExamPeriod, 
  ExaminerStudentItem,
  ExamQuestion,
  ExamQuestionAssessment
} from '../../types';
import { api } from '../../api';
import { UASExamReviewModal } from './UASExamReviewModal';
import { generateExamRecapCSV, generateExamRecapExcelXML } from '../../services/examRecapExportService';
import { 
  Award, 
  Calendar, 
  RefreshCcw, 
  Search, 
  Filter, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Download, 
  Printer, 
  FileSpreadsheet, 
  Users, 
  TrendingUp, 
  ChevronRight,
  BookOpen
} from 'lucide-react';

interface UASRecapViewProps {
  user: User;
}

export const UASRecapView: React.FC<UASRecapViewProps> = ({ user }) => {
  const [periods, setPeriods] = useState<ExamPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [students, setStudents] = useState<ExaminerStudentItem[]>([]);
  const [periodInfo, setPeriodInfo] = useState<{ id: string; name: string; kkm: number; status: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClass, setSelectedClass] = useState('ALL');
  const [selectedHalaqah, setSelectedHalaqah] = useState('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'ALL' | 'PASSED' | 'FAILED' | 'IN_PROGRESS' | 'NOT_STARTED'>('ALL');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Review Modal State
  const [reviewStudent, setReviewStudent] = useState<{
    student: ExaminerStudentItem;
    questions: ExamQuestion[];
    assessments: ExamQuestionAssessment[];
  } | null>(null);

  const isAdmin = user.role === 'admin';

  useEffect(() => {
    loadPeriods();
  }, []);

  const loadPeriods = async () => {
    try {
      const res = await api.getExamPeriods(user);
      if (res.success && res.data) {
        const uasPeriods = res.data.filter(p => p.examType?.toLowerCase() === 'uas');
        setPeriods(uasPeriods);

        const active = uasPeriods.find(p => p.status === 'active') || uasPeriods[0];
        if (active) {
          setSelectedPeriodId(active.id);
        }
      }
    } catch (e: any) {
      console.error('Failed to load UAS periods:', e);
    }
  };

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
        setErrorMsg(res.message || 'Gagal memuat rekap nilai UAS.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan sistem saat memuat rekap nilai UAS.');
    } finally {
      setIsLoading(false);
    }
  };

  // Open review modal
  const handleOpenReview = async (student: ExaminerStudentItem) => {
    if (!student.attemptId) return;
    try {
      const res = await api.getUASAttempt(student.attemptId, user);
      if (res.success && res.questions && res.assessments) {
        setReviewStudent({
          student,
          questions: res.questions,
          assessments: res.assessments
        });
      } else {
        alert(res.message || 'Gagal memuat rincian penilaian ujian UAS.');
      }
    } catch (err: any) {
      alert(err.message || 'Gagal memuat rincian ujian UAS.');
    }
  };

  // Export handlers
  const handleExportCSV = () => {
    if (students.length === 0) {
      alert('Tidak ada data untuk diekspor.');
      return;
    }
    const csvContent = generateExamRecapCSV(
      'uas',
      periodInfo?.name || 'Periode UAS',
      periodInfo?.kkm || 70,
      filteredStudents
    );
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Rekap_Nilai_UAS_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportExcel = () => {
    if (students.length === 0) {
      alert('Tidak ada data untuk diekspor.');
      return;
    }
    const xmlContent = generateExamRecapExcelXML(
      'uas',
      periodInfo?.name || 'Periode UAS',
      periodInfo?.kkm || 70,
      filteredStudents
    );
    const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Rekap_Nilai_UAS_${Date.now()}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  // Stats calculation
  const stats = useMemo(() => {
    const kkm = periodInfo?.kkm || 70;
    const total = students.length;
    const submittedList = students.filter(s => s.attemptStatus === 'submitted');
    const submitted = submittedList.length;
    const inProgress = students.filter(s => s.attemptStatus === 'in_progress').length;
    const notStarted = total - submitted - inProgress;

    const passedList = submittedList.filter(s => (s.totalScore || 0) >= kkm);
    const passed = passedList.length;
    const failed = submitted - passed;
    const passRate = submitted > 0 ? Math.round((passed / submitted) * 100) : 0;

    const scores = submittedList.map(s => Number(s.totalScore || 0));
    const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '0';
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;

    return {
      total,
      submitted,
      inProgress,
      notStarted,
      passed,
      failed,
      passRate,
      avgScore,
      highestScore,
      lowestScore
    };
  }, [students, periodInfo]);

  // Unique classes and halaqahs
  const classes = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => { if (s.class) set.add(s.class); });
    return Array.from(set).sort();
  }, [students]);

  const halaqahs = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => { if (s.halaqah) set.add(s.halaqah); });
    return Array.from(set).sort();
  }, [students]);

  // Filtered students
  const filteredStudents = useMemo(() => {
    const kkm = periodInfo?.kkm || 70;
    return students.filter(s => {
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = s.studentName.toLowerCase().includes(q);
        const matchNis = s.studentNis?.toLowerCase().includes(q);
        if (!matchName && !matchNis) return false;
      }

      // Class filter
      if (selectedClass !== 'ALL' && s.class !== selectedClass) return false;

      // Halaqah filter
      if (selectedHalaqah !== 'ALL' && s.halaqah !== selectedHalaqah) return false;

      // Status filter
      if (selectedStatusFilter === 'PASSED') {
        return s.attemptStatus === 'submitted' && (s.totalScore || 0) >= kkm;
      }
      if (selectedStatusFilter === 'FAILED') {
        return s.attemptStatus === 'submitted' && (s.totalScore || 0) < kkm;
      }
      if (selectedStatusFilter === 'IN_PROGRESS') {
        return s.attemptStatus === 'in_progress';
      }
      if (selectedStatusFilter === 'NOT_STARTED') {
        return s.attemptStatus !== 'submitted' && s.attemptStatus !== 'in_progress';
      }

      return true;
    });
  }, [students, searchQuery, selectedClass, selectedHalaqah, selectedStatusFilter, periodInfo]);

  return (
    <div className="space-y-5 animate-fade-in p-2 sm:p-4 max-w-7xl mx-auto">
      {/* 1. HEADER & PERIOD SELECTOR */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700 shadow-sm shrink-0">
              <Award size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">
                  Rekapitulasi Nilai UAS Tahfiz
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">
                  Modul UAS (9 Soal)
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAdmin 
                  ? 'Rekapitulasi resmi nilai ujian akhir semester (UAS) seluruh santri, status kelulusan KKM, dan ekspor data.'
                  : `Rekapitulasi nilai ujian UAS santri binaan Ustadz ${user.name}.`}
              </p>
            </div>
          </div>

          {/* Action buttons & Period select */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
              <Calendar size={15} className="text-slate-400" />
              <span>Periode:</span>
            </div>
            <select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} (KKM: {p.kkm})
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

            <div className="flex items-center gap-1">
              <button
                onClick={handleExportCSV}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors flex items-center gap-1"
                title="Ekspor CSV"
              >
                <Download size={13} />
                <span>CSV</span>
              </button>
              <button
                onClick={handleExportExcel}
                className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors flex items-center gap-1 shadow-sm"
                title="Ekspor Excel"
              >
                <FileSpreadsheet size={13} />
                <span>Excel</span>
              </button>
              <button
                onClick={handlePrint}
                className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
                title="Cetak Rekap"
              >
                <Printer size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* 2. STATS CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Peserta</span>
            <span className="text-xl font-black text-slate-800">{stats.total}</span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Santri terdaftar</span>
          </div>

          <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200/70">
            <span className="text-[10px] uppercase font-bold text-blue-700 block">Sudah Ujian</span>
            <span className="text-xl font-black text-blue-900">{stats.submitted}</span>
            <span className="text-[10px] text-blue-600 block mt-0.5">{stats.total > 0 ? Math.round((stats.submitted / stats.total) * 100) : 0}% selesai</span>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/70">
            <span className="text-[10px] uppercase font-bold text-emerald-700 block">Lulus UAS</span>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-emerald-900">{stats.passed}</span>
              <span className="text-[11px] font-bold text-emerald-600">({stats.passRate}%)</span>
            </div>
            <span className="text-[10px] text-emerald-600 block mt-0.5">Nilai &ge; KKM {periodInfo?.kkm || 70}</span>
          </div>

          <div className="p-3 rounded-xl bg-rose-50/70 border border-rose-200/70">
            <span className="text-[10px] uppercase font-bold text-rose-700 block">Belum Lulus</span>
            <span className="text-xl font-black text-rose-900">{stats.failed}</span>
            <span className="text-[10px] text-rose-600 block mt-0.5">Perlu perbaikan</span>
          </div>

          <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/70">
            <span className="text-[10px] uppercase font-bold text-amber-700 block">Rata-Rata Nilai</span>
            <span className="text-xl font-black text-amber-900">{stats.avgScore}</span>
            <span className="text-[10px] text-amber-600 block mt-0.5">Dari {stats.submitted} santri</span>
          </div>

          <div className="p-3 rounded-xl bg-purple-50/70 border border-purple-200/70">
            <span className="text-[10px] uppercase font-bold text-purple-700 block">Tertinggi / Rendah</span>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-black text-purple-900">{stats.highestScore}</span>
              <span className="text-xs text-slate-400">/</span>
              <span className="text-sm font-bold text-purple-700">{stats.lowestScore}</span>
            </div>
            <span className="text-[10px] text-purple-600 block mt-0.5">Rentang skor</span>
          </div>
        </div>
      </div>

      {/* 3. TOOLBAR: SEARCH & FILTERS */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama santri atau NIS..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 flex-wrap">
          {/* Class Filter */}
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-700 focus:outline-none"
          >
            <option value="ALL">Semua Kelas ({classes.length})</option>
            {classes.map(c => (
              <option key={c} value={c}>Kelas {c}</option>
            ))}
          </select>

          {/* Halaqah Filter */}
          <select
            value={selectedHalaqah}
            onChange={(e) => setSelectedHalaqah(e.target.value)}
            className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-700 focus:outline-none"
          >
            <option value="ALL">Semua Halaqah ({halaqahs.length})</option>
            {halaqahs.map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value as any)}
            className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-700 focus:outline-none"
          >
            <option value="ALL">Semua Status Kelulusan</option>
            <option value="PASSED">🟢 Lulus UAS (&ge; KKM)</option>
            <option value="FAILED">🔴 Belum Lulus (&lt; KKM)</option>
            <option value="IN_PROGRESS">🟡 Sedang Ujian</option>
            <option value="NOT_STARTED">⚪ Belum Ujian</option>
          </select>
        </div>
      </div>

      {/* 4. RECAP TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <RefreshCcw size={24} className="animate-spin mx-auto text-indigo-600" />
            <p className="text-xs">Memuat rekapitulasi nilai UAS...</p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <Users size={32} className="mx-auto text-slate-300" />
            <p className="text-xs font-semibold text-slate-600">Tidak ada santri yang sesuai kriteria filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3 text-center w-12">No</th>
                  <th className="py-3 px-4">Santri</th>
                  <th className="py-3 px-4">Kelas & Halaqah</th>
                  <th className="py-3 px-4">Materi Ujian UAS</th>
                  <th className="py-3 px-4">Penguji</th>
                  <th className="py-3 px-4 text-center">Status Kelulusan</th>
                  <th className="py-3 px-4 text-center">Nilai UAS</th>
                  <th className="py-3 px-4 text-center w-28">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredStudents.map((s, idx) => {
                  const isSubmitted = s.attemptStatus === 'submitted';
                  const isInProgress = s.attemptStatus === 'in_progress';
                  const kkm = periodInfo?.kkm || 70;
                  const isPassed = isSubmitted && (s.totalScore || 0) >= kkm;

                  return (
                    <tr key={s.studentId} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 text-center font-medium text-slate-400">{idx + 1}</td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        <div>{s.studentName}</div>
                        {s.studentNis && <span className="text-[10px] text-slate-400 font-normal">NIS: {s.studentNis}</span>}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md font-semibold bg-slate-100 text-slate-700 text-[11px] mr-1.5">
                          {s.class}
                        </span>
                        <span className="text-slate-600 text-xs">{s.halaqah}</span>
                      </td>
                      <td className="py-3 px-4">
                        {s.startSurahName ? (
                          <span className="font-medium text-slate-700">
                            {s.startSurahName} : {s.startAyah} s.d. {s.endSurahName} : {s.endAyah}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">Belum difinalisasi</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {s.examinerName || s.teacherName || '-'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isSubmitted ? (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            isPassed 
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                              : 'bg-rose-100 text-rose-800 border border-rose-200'
                          }`}>
                            {isPassed ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                            <span>{isPassed ? 'LULUS' : 'TIDAK LULUS'}</span>
                          </span>
                        ) : isInProgress ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            <Clock size={12} className="animate-pulse" />
                            <span>Sedang Ujian</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                            <span>Belum Ujian</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isSubmitted ? (
                          <span className={`text-base font-black ${
                            isPassed ? 'text-emerald-700' : 'text-rose-600'
                          }`}>
                            {s.totalScore}
                          </span>
                        ) : (
                          <span className="text-slate-300 font-bold">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isSubmitted ? (
                          <button
                            onClick={() => handleOpenReview(s)}
                            className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-800 text-slate-700 text-xs font-semibold transition-colors border border-slate-200 hover:border-indigo-200 inline-flex items-center gap-1"
                          >
                            <span>Rincian</span>
                            <ChevronRight size={13} />
                          </button>
                        ) : (
                          <span className="text-slate-300 text-[11px]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review Modal */}
      {reviewStudent && (
        <UASExamReviewModal
          studentName={reviewStudent.student.studentName}
          studentClass={reviewStudent.student.class}
          kkm={periodInfo?.kkm || 70}
          questions={reviewStudent.questions}
          assessments={reviewStudent.assessments}
          onSubmitFinal={async () => {}}
          onClose={() => setReviewStudent(null)}
          onNavigateToQuestion={() => {}}
          isReadOnly={true}
        />
      )}
    </div>
  );
};
