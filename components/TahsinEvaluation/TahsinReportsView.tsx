import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  User, 
  Student, 
  TahsinPeriod, 
  TahsinSession, 
  TahsinAttempt 
} from '../../types';
import { 
  tahsinService, 
  TAHSIN_WEIGHTS, 
  TAHSIN_CATEGORY_SCORES 
} from '../../services/tahsinService';
import { LOGO_URL } from '../../constants';
import { 
  FileText, 
  Download, 
  Printer, 
  Search, 
  Filter, 
  Award, 
  CheckCircle2, 
  AlertCircle, 
  Users, 
  GraduationCap, 
  BookOpen, 
  ChevronRight, 
  RefreshCw,
  Eye,
  Calendar,
  Layers,
  BarChart2
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

interface TahsinReportsViewProps {
  user: User;
  students: Student[];
  users?: User[];
}

type ReportTab = 'transcript' | 'class_recap' | 'halaqah_recap' | 'all_recap';

export const TahsinReportsView: React.FC<TahsinReportsViewProps> = ({
  user,
  students,
  users = []
}) => {
  const [periods, setPeriods] = useState<TahsinPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [sessions, setSessions] = useState<TahsinSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<ReportTab>('transcript');

  // Filters
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedHalaqah, setSelectedHalaqah] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'lulus' | 'remedial' | 'not_started'>('all');

  // Export State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const reportPrintRef = useRef<HTMLDivElement>(null);

  // Load periods & sessions
  const loadData = async () => {
    setIsLoading(true);
    try {
      const pList = await tahsinService.fetchPeriods();
      setPeriods(pList);
      const activeP = pList.find(p => p.status === 'active') || pList[0];
      if (activeP) {
        setSelectedPeriodId(activeP.id);
        const sList = await tahsinService.fetchSessions(activeP.id);
        setSessions(sList);
      }
    } catch (err) {
      console.error('Error loading tahsin report data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePeriodChange = async (periodId: string) => {
    setSelectedPeriodId(periodId);
    setIsLoading(true);
    try {
      const sList = await tahsinService.fetchSessions(periodId);
      setSessions(sList);
    } catch (err) {
      console.error('Error fetching sessions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedPeriod = useMemo(() => {
    return periods.find(p => p.id === selectedPeriodId) || periods[0];
  }, [periods, selectedPeriodId]);

  // Unique classes and halaqahs from students
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => { if (s.class) set.add(s.class); });
    return Array.from(set).sort();
  }, [students]);

  const availableHalaqahs = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => { if (s.halaqah) set.add(s.halaqah); });
    return Array.from(set).sort();
  }, [students]);

  // Map student sessions with full student entity
  const enrichedStudents = useMemo(() => {
    return students.map(student => {
      const session = sessions.find(s => s.studentId === student.id);
      const coverage = tahsinService.getCoverageByClass(student.class);
      return {
        student,
        session,
        coverage,
        status: session?.status || 'not_started',
        finalScore: session?.finalScore,
        predikat: session?.predikat,
        passingStatus: session?.passingStatus,
        attempts: session?.attempts || []
      };
    });
  }, [students, sessions]);

  // Set default selected student if none selected
  useEffect(() => {
    if (!selectedStudentId && enrichedStudents.length > 0) {
      const firstWithScore = enrichedStudents.find(es => es.session?.finalScore !== undefined);
      if (firstWithScore) {
        setSelectedStudentId(firstWithScore.student.id);
      } else {
        setSelectedStudentId(enrichedStudents[0].student.id);
      }
    }
  }, [enrichedStudents, selectedStudentId]);

  // Selected student data for transcript
  const currentStudentData = useMemo(() => {
    return enrichedStudents.find(es => es.student.id === selectedStudentId);
  }, [enrichedStudents, selectedStudentId]);

  const latestAttempt = useMemo(() => {
    if (!currentStudentData?.attempts || currentStudentData.attempts.length === 0) return null;
    return [...currentStudentData.attempts].sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
  }, [currentStudentData]);

  // Filtered list for student selection or class recap
  const filteredList = useMemo(() => {
    return enrichedStudents.filter(item => {
      if (selectedClass && item.student.class !== selectedClass) return false;
      if (selectedHalaqah && item.student.halaqah !== selectedHalaqah) return false;
      if (statusFilter !== 'all') {
        if (statusFilter === 'not_started' && item.status !== 'not_started') return false;
        if (statusFilter === 'lulus' && item.passingStatus !== 'lulus') return false;
        if (statusFilter === 'remedial' && item.passingStatus !== 'remedial') return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.student.name.toLowerCase().includes(q);
        const matchesNis = item.student.nis?.toLowerCase().includes(q);
        if (!matchesName && !matchesNis) return false;
      }
      return true;
    });
  }, [enrichedStudents, selectedClass, selectedHalaqah, statusFilter, searchQuery]);

  // Teacher name resolver
  const getTeacherName = (halaqahName: string) => {
    const studentInHalaqah = students.find(s => s.halaqah === halaqahName && s.teacherId);
    if (studentInHalaqah) {
      const teacher = users.find(u => u.id === studentInHalaqah.teacherId);
      if (teacher) return teacher.name;
    }
    return '-';
  };

  // PDF Export
  const handleDownloadPdf = async (customFilename?: string) => {
    if (!reportPrintRef.current) return;
    setIsExporting(true);

    try {
      const element = reportPrintRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidthMm = 210;
      const pageHeightMm = 297;
      const marginMm = 8;
      const printWidthMm = pageWidthMm - (marginMm * 2);
      
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      const imgHeightMm = (canvasHeight * printWidthMm) / canvasWidth;

      let remainingHeightMm = imgHeightMm;
      let positionYMm = marginMm;

      // First page
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', marginMm, positionYMm, printWidthMm, imgHeightMm);
      remainingHeightMm -= (pageHeightMm - marginMm * 2);

      // Subsequent pages if long
      while (remainingHeightMm > 5) {
        positionYMm = positionYMm - pageHeightMm + (marginMm * 2);
        pdf.addPage('a4', 'p');
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', marginMm, positionYMm, printWidthMm, imgHeightMm);
        remainingHeightMm -= (pageHeightMm - marginMm * 2);
      }

      const filename = customFilename || `Transkrip_Tahsin_${currentStudentData?.student.name.replace(/\s+/g, '_') || 'Santri'}.pdf`;
      pdf.save(filename);
    } catch (err) {
      console.error('Gagal mengekspor PDF:', err);
      alert('Terjadi kesalahan saat mengekspor dokumen ke PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
              <FileText size={20} />
            </span>
            <h1 className="text-xl font-bold text-gray-800">Laporan & Rekapitulasi Tahsin</h1>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Transkrip evaluasi bacaan mushaf per santri, rekapitulasi per kelas, per halaqah, dan evaluasi semester.
          </p>
        </div>

        {/* Period Selector & Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-600">Periode:</label>
            <select
              value={selectedPeriodId}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="text-xs font-semibold px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.academicYear} - {p.semester})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => handleDownloadPdf()}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold shadow-sm transition disabled:opacity-50"
          >
            <Download size={14} />
            {isExporting ? 'Membuat PDF...' : 'Unduh PDF'}
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-xs font-semibold shadow-sm transition"
          >
            <Printer size={14} />
            Cetak
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-gray-200 bg-white rounded-t-xl px-4 pt-2 gap-2 shadow-sm">
        <button
          onClick={() => setActiveTab('transcript')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'transcript'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <Award size={16} />
          Transkrip Nilai Santri
        </button>
        <button
          onClick={() => setActiveTab('class_recap')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'class_recap'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <GraduationCap size={16} />
          Rekapitulasi Per Kelas
        </button>
        <button
          onClick={() => setActiveTab('halaqah_recap')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'halaqah_recap'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <Users size={16} />
          Rekapitulasi Per Halaqah
        </button>
        <button
          onClick={() => setActiveTab('all_recap')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'all_recap'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <Layers size={16} />
          Rekapitulasi Keseluruhan
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: TRANSKRIP NILAI SANTRI                                             */}
      {/* ========================================================================= */}
      {activeTab === 'transcript' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Sidebar: Student Selector */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-3">
              <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                <Search size={14} className="text-emerald-600" />
                Pilih Santri
              </h3>

              {/* Class Filter */}
              <div>
                <label className="text-[11px] font-semibold text-gray-500">Filter Kelas:</label>
                <select
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                  className="w-full mt-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">Semua Kelas</option>
                  {availableClasses.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Search Box */}
              <div>
                <input
                  type="text"
                  placeholder="Cari nama santri / NIS..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Student Scrollable List */}
              <div className="mt-2 max-h-[500px] overflow-y-auto space-y-1.5 pr-1 divide-y divide-gray-50">
                {filteredList.length === 0 ? (
                  <p className="text-xs text-gray-400 py-4 text-center italic">Santri tidak ditemukan</p>
                ) : (
                  filteredList.map(item => {
                    const isSelected = item.student.id === selectedStudentId;
                    const hasTested = item.finalScore !== undefined;

                    return (
                      <button
                        key={item.student.id}
                        onClick={() => setSelectedStudentId(item.student.id)}
                        className={`w-full text-left p-2.5 rounded-lg transition flex items-center justify-between ${
                          isSelected
                            ? 'bg-emerald-50 border border-emerald-300 text-emerald-950 font-semibold'
                            : 'hover:bg-gray-50 text-gray-700 border border-transparent'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="text-xs font-bold truncate">{item.student.name}</p>
                          <p className="text-[10px] text-gray-500">
                            {item.student.class} • {item.student.halaqah}
                          </p>
                        </div>

                        <div className="text-right flex-shrink-0">
                          {hasTested ? (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              item.passingStatus === 'lulus' 
                                ? 'bg-emerald-100 text-emerald-800' 
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              {item.finalScore?.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-[9px] bg-gray-100 text-gray-400 px-1 py-0.5 rounded">
                              Belum
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right Area: Formal Printable Transcript Card */}
          <div className="lg:col-span-3">
            {currentStudentData ? (
              <div 
                ref={reportPrintRef}
                className="bg-white p-8 md:p-10 rounded-xl border border-gray-200 shadow-md max-w-4xl mx-auto print:shadow-none print:border-none print:p-0"
              >
                {/* Formal Kop Pondok Pesantren */}
                <div className="border-b-2 border-emerald-900 pb-3 mb-5 flex items-center gap-4">
                  <img src={LOGO_URL} alt="Logo Pesantren" className="w-16 h-16 object-contain" />
                  <div className="flex-1 text-center">
                    <h2 className="text-xl font-bold uppercase tracking-wider text-emerald-950">
                      Pondok Pesantren Darul Abror IBS
                    </h2>
                    <p className="text-xs font-bold tracking-wide text-gray-800 mt-0.5 uppercase">
                      Lajnah Tahsin & Tahfidz Al-Qur'an
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151
                    </p>
                  </div>
                  <div className="w-16"></div>
                </div>

                {/* Document Title */}
                <div className="text-center mb-6">
                  <h3 className="text-base font-extrabold uppercase tracking-wide text-gray-900 underline decoration-2 underline-offset-4">
                    Transkrip Hasil Evaluasi Ujian Tahsin Al-Qur'an
                  </h3>
                  <p className="text-xs text-gray-600 mt-1 font-semibold">
                    {selectedPeriod?.name || 'Semester Ganjil 2026/2027'} (Standar Mushaf Madinah 15 Baris)
                  </p>
                </div>

                {/* Student Info Table */}
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 mb-6 text-xs bg-gray-50 p-4 rounded-lg border border-gray-200 print:bg-white print:border-gray-300">
                  <div className="flex">
                    <span className="w-32 font-bold text-gray-600">Nama Santri</span>
                    <span className="font-semibold text-gray-900">: {currentStudentData.student.name}</span>
                  </div>
                  <div className="flex">
                    <span className="w-32 font-bold text-gray-600">Nomor Induk (NIS)</span>
                    <span className="font-semibold text-gray-900">: {currentStudentData.student.nis || '-'}</span>
                  </div>
                  <div className="flex">
                    <span className="w-32 font-bold text-gray-600">Kelas</span>
                    <span className="font-semibold text-gray-900">: {currentStudentData.student.class}</span>
                  </div>
                  <div className="flex">
                    <span className="w-32 font-bold text-gray-600">Halaqah</span>
                    <span className="font-semibold text-gray-900">: {currentStudentData.student.halaqah}</span>
                  </div>
                  <div className="flex">
                    <span className="w-32 font-bold text-gray-600">Target Materi Kelas</span>
                    <span className="font-semibold text-emerald-800">
                      : {currentStudentData.coverage.label} (Juz {currentStudentData.coverage.startJuz}–{currentStudentData.coverage.endJuz})
                    </span>
                  </div>
                  <div className="flex">
                    <span className="w-32 font-bold text-gray-600">Tanggal Ujian</span>
                    <span className="font-semibold text-gray-900">
                      : {latestAttempt?.examDate ? new Date(latestAttempt.examDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'}
                    </span>
                  </div>
                  <div className="flex">
                    <span className="w-32 font-bold text-gray-600">Penguji Tahsin</span>
                    <span className="font-semibold text-gray-900">: {latestAttempt?.examinerName || '-'}</span>
                  </div>
                  <div className="flex">
                    <span className="w-32 font-bold text-gray-600">Status Ujian</span>
                    <span className="font-semibold text-gray-900">
                      : {latestAttempt?.attemptType === 'remedial' ? `Ujian Remedial (Percobaan ke-${latestAttempt.attemptNumber})` : 'Ujian Utama'}
                    </span>
                  </div>
                </div>

                {/* Reading Passage Details */}
                {latestAttempt?.reading ? (
                  <div className="border border-emerald-200 bg-emerald-50/50 p-3.5 rounded-lg mb-6 text-xs print:bg-white print:border-gray-300">
                    <h4 className="text-[11px] font-bold text-emerald-950 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <BookOpen size={14} className="text-emerald-700" />
                      Bagian Ayat yang Diuji
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-gray-700">
                      <div>
                        <span className="text-[10px] text-gray-500 block">Surah & Ayat:</span>
                        <span className="font-bold text-gray-900">
                          {latestAttempt.reading.startSurahName} : {latestAttempt.reading.startAyah}
                          {latestAttempt.reading.endAyah !== latestAttempt.reading.startAyah ? ` - ${latestAttempt.reading.endAyah}` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-gray-500 block">Halaman Mushaf:</span>
                        <span className="font-bold text-gray-900">
                          Halaman {latestAttempt.reading.startPage}
                          {latestAttempt.reading.endPage !== latestAttempt.reading.startPage ? ` - ${latestAttempt.reading.endPage}` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-gray-500 block">Juz:</span>
                        <span className="font-bold text-gray-900">Juz {latestAttempt.reading.juzNumber || '-'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-gray-500 block">Panjang Bacaan:</span>
                        <span className="font-bold text-emerald-800">{latestAttempt.reading.pagesRead} Halaman</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-center text-xs text-yellow-800 mb-6">
                    Santri ini belum memiliki riwayat ujian tahsin pada periode ini.
                  </div>
                )}

                {/* Score Breakdown Table */}
                <div className="mb-6">
                  <h4 className="text-[11px] font-bold text-gray-800 uppercase tracking-wide mb-2">
                    Hasil Penilaian 4 Aspek Wajib
                  </h4>
                  <table className="w-full text-xs border border-gray-300 border-collapse">
                    <thead>
                      <tr className="bg-emerald-900 text-white text-center">
                        <th className="py-2 px-3 border border-gray-300 w-10">No</th>
                        <th className="py-2 px-3 border border-gray-300 text-left">Aspek Penilaian</th>
                        <th className="py-2 px-3 border border-gray-300 w-20">Bobot</th>
                        <th className="py-2 px-3 border border-gray-300 w-24">Kategori</th>
                        <th className="py-2 px-3 border border-gray-300 w-20">Nilai (0-100)</th>
                        <th className="py-2 px-3 border border-gray-300 w-24">Kontribusi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Aspek 1: Makharij */}
                      <tr>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">1</td>
                        <td className="py-2 px-3 border border-gray-300 font-semibold">
                          Makharijul & Sifat Huruf
                          <span className="block text-[10px] text-gray-500 font-normal">
                            Ketepatan makhraj, sifat jahr, hams, qalqalah, tafkhim/tarqiq
                          </span>
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">35%</td>
                        <td className="py-2 px-3 border border-gray-300 text-center capitalize">
                          {latestAttempt?.makharij.category.replace('_', ' ') || '-'}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">
                          {latestAttempt?.makharij.score ?? '-'}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold text-emerald-800">
                          {latestAttempt?.makharij.score ? (latestAttempt.makharij.score * 0.35).toFixed(2) : '-'}
                        </td>
                      </tr>

                      {/* Aspek 2: Tajwid */}
                      <tr className="bg-gray-50/50">
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">2</td>
                        <td className="py-2 px-3 border border-gray-300 font-semibold">
                          Hukum Tajwid & Mad
                          <span className="block text-[10px] text-gray-500 font-normal">
                            Hukum nun mati/tanwin, mim mati, ghunnah, mad thabi'i, mad far'i
                          </span>
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">30%</td>
                        <td className="py-2 px-3 border border-gray-300 text-center capitalize">
                          {latestAttempt?.tajwid.category.replace('_', ' ') || '-'}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">
                          {latestAttempt?.tajwid.score ?? '-'}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold text-emerald-800">
                          {latestAttempt?.tajwid.score ? (latestAttempt.tajwid.score * 0.30).toFixed(2) : '-'}
                        </td>
                      </tr>

                      {/* Aspek 3: Kelancaran */}
                      <tr>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">3</td>
                        <td className="py-2 px-3 border border-gray-300 font-semibold">
                          Kelancaran Bacaan
                          <span className="block text-[10px] text-gray-500 font-normal">
                            Keajegan tempo tartil, ketegasan harakat, tidak terbata-bata
                          </span>
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">20%</td>
                        <td className="py-2 px-3 border border-gray-300 text-center capitalize">
                          {latestAttempt?.kelancaran.category.replace('_', ' ') || '-'}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">
                          {latestAttempt?.kelancaran.score ?? '-'}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold text-emerald-800">
                          {latestAttempt?.kelancaran.score ? (latestAttempt.kelancaran.score * 0.20).toFixed(2) : '-'}
                        </td>
                      </tr>

                      {/* Aspek 4: Waqaf */}
                      <tr className="bg-gray-50/50">
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">4</td>
                        <td className="py-2 px-3 border border-gray-300 font-semibold">
                          Waqaf & Ibtida'
                          <span className="block text-[10px] text-gray-500 font-normal">
                            Ketepatan tempat berhenti, pengaturan nafas, dan cara memulai kembali
                          </span>
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">15%</td>
                        <td className="py-2 px-3 border border-gray-300 text-center capitalize">
                          {latestAttempt?.waqaf.category.replace('_', ' ') || '-'}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold">
                          {latestAttempt?.waqaf.score ?? '-'}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-center font-bold text-emerald-800">
                          {latestAttempt?.waqaf.score ? (latestAttempt.waqaf.score * 0.15).toFixed(2) : '-'}
                        </td>
                      </tr>

                      {/* Total Baris */}
                      <tr className="bg-emerald-50 font-bold">
                        <td colSpan={4} className="py-2.5 px-3 border border-gray-300 text-right uppercase text-gray-800">
                          Nilai Akhir Ujian Tahsin:
                        </td>
                        <td colSpan={2} className="py-2.5 px-3 border border-gray-300 text-center text-sm text-emerald-950 font-black">
                          {latestAttempt?.finalScore !== undefined ? latestAttempt.finalScore.toFixed(2) : '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Hasil Akhir & Predikat Badge */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                  <div className="border border-gray-200 bg-gray-50 p-3 rounded-lg text-center print:bg-white print:border-gray-300">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block">Predikat Kualitatif</span>
                    <span className="text-base font-extrabold text-emerald-900 mt-1 block">
                      {latestAttempt?.predikat || '-'}
                    </span>
                  </div>

                  <div className="border border-gray-200 bg-gray-50 p-3 rounded-lg text-center print:bg-white print:border-gray-300">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block">Status Kelulusan</span>
                    <span className={`text-base font-extrabold mt-1 block ${
                      latestAttempt?.passingStatus === 'lulus' ? 'text-emerald-700' : 'text-amber-700'
                    }`}>
                      {latestAttempt?.passingStatus === 'lulus' ? 'LULUS' : latestAttempt?.passingStatus === 'remedial' ? 'PERLU REMEDIAL' : '-'}
                    </span>
                  </div>

                  <div className="border border-gray-200 bg-gray-50 p-3 rounded-lg text-center col-span-2 md:col-span-1 print:bg-white print:border-gray-300">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block">Standar Kelulusan (KKM)</span>
                    <span className="text-xs font-bold text-gray-800 mt-1.5 block">
                      Nilai ≥ {selectedPeriod?.passingGrade || 80} (Makhraj ≥ 75, Tajwid ≥ 75)
                    </span>
                  </div>
                </div>

                {/* Catatan Kesalahan jika ada */}
                {latestAttempt?.errorCounts && (
                  <div className="mb-5 p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs print:bg-white print:border-gray-300">
                    <span className="font-bold text-gray-700 block mb-1.5 text-[11px] uppercase">
                      Pencatatan Kesalahan Bacaan:
                    </span>
                    <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
                      <div className="p-1 bg-white border border-gray-200 rounded">
                        Makhraj: <span className="font-bold">{latestAttempt.errorCounts.makhraj || 0}</span>
                      </div>
                      <div className="p-1 bg-white border border-gray-200 rounded">
                        Mad: <span className="font-bold">{latestAttempt.errorCounts.mad || 0}</span>
                      </div>
                      <div className="p-1 bg-white border border-gray-200 rounded">
                        Ghunnah: <span className="font-bold">{latestAttempt.errorCounts.ghunnah || 0}</span>
                      </div>
                      <div className="p-1 bg-white border border-gray-200 rounded">
                        Harakat: <span className="font-bold">{latestAttempt.errorCounts.harakat || 0}</span>
                      </div>
                      <div className="p-1 bg-white border border-gray-200 rounded">
                        Tajwid Lain: <span className="font-bold">{latestAttempt.errorCounts.tajwidLain || 0}</span>
                      </div>
                      <div className="p-1 bg-white border border-gray-200 rounded">
                        Waqaf: <span className="font-bold">{latestAttempt.errorCounts.waqaf || 0}</span>
                      </div>
                      <div className="p-1 bg-white border border-gray-200 rounded">
                        Kelancaran: <span className="font-bold">{latestAttempt.errorCounts.kelancaran || 0}</span>
                      </div>
                      <div className="p-1 bg-white border border-gray-200 rounded">
                        Lain-lain: <span className="font-bold">{latestAttempt.errorCounts.lainnya || 0}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Catatan Pembinaan & Evaluasi Penguji */}
                <div className="mb-6 p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs print:bg-white print:border-gray-300">
                  <span className="font-bold text-gray-700 block mb-1 text-[11px] uppercase">
                    Catatan Pembinaan & Evaluasi Penguji:
                  </span>
                  <p className="italic text-gray-700 whitespace-pre-line leading-relaxed">
                    {latestAttempt?.coachingNotes || 'Tidak ada catatan khusus. Pertahankan kualitas bacaan dan rutinkan tilawah harian.'}
                  </p>
                </div>

                {/* Riwayat Remedial jika pernah remedial */}
                {currentStudentData.attempts.length > 1 && (
                  <div className="mb-6 p-3 bg-blue-50/50 rounded-lg border border-blue-200 text-xs print:bg-white print:border-gray-300">
                    <span className="font-bold text-blue-900 block mb-2 text-[11px] uppercase flex items-center gap-1.5">
                      <RefreshCw size={13} className="text-blue-700" />
                      Riwayat Progres Ujian (Utama & Remedial)
                    </span>
                    <table className="w-full text-[11px] border border-blue-200 bg-white">
                      <thead>
                        <tr className="bg-blue-100 text-blue-950 font-bold">
                          <th className="p-1.5 border border-blue-200 text-left">Percobaan</th>
                          <th className="p-1.5 border border-blue-200 text-left">Tanggal</th>
                          <th className="p-1.5 border border-blue-200 text-left">Penguji</th>
                          <th className="p-1.5 border border-blue-200 text-center">Nilai</th>
                          <th className="p-1.5 border border-blue-200 text-center">Predikat</th>
                          <th className="p-1.5 border border-blue-200 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentStudentData.attempts.map((att, idx) => (
                          <tr key={att.id} className={idx % 2 === 1 ? 'bg-blue-50/30' : ''}>
                            <td className="p-1.5 border border-blue-200 font-semibold">
                              {att.attemptType === 'utama' ? 'Ujian Utama' : `Remedial ke-${att.attemptNumber - 1}`}
                            </td>
                            <td className="p-1.5 border border-blue-200">
                              {new Date(att.examDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="p-1.5 border border-blue-200">{att.examinerName}</td>
                            <td className="p-1.5 border border-blue-200 text-center font-bold text-emerald-800">{att.finalScore.toFixed(1)}</td>
                            <td className="p-1.5 border border-blue-200 text-center">{att.predikat}</td>
                            <td className="p-1.5 border border-blue-200 text-center font-bold">
                              <span className={att.passingStatus === 'lulus' ? 'text-emerald-700' : 'text-amber-700'}>
                                {att.passingStatus === 'lulus' ? 'Lulus' : 'Remedial'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Tanda Tangan Section */}
                <div className="signature-section mt-10 pt-4 border-t border-gray-300 grid grid-cols-2 text-center text-xs break-inside-avoid">
                  <div>
                    <p className="text-gray-500 text-[11px]">Mengetahui,</p>
                    <p className="font-bold text-gray-800 mt-0.5">Kepala Madrasah / Koordinator Tahsin</p>
                    <div className="h-20"></div>
                    <p className="font-bold underline text-gray-900">Ust. H. Ahmad Fauzi, M.Pd.</p>
                    <p className="text-[10px] text-gray-500">NIP. 19850412 201001 1 004</p>
                  </div>

                  <div>
                    <p className="text-gray-500 text-[11px]">
                      Garut, {latestAttempt?.examDate ? new Date(latestAttempt.examDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                    <p className="font-bold text-gray-800 mt-0.5">Guru Penguji Tahsin</p>
                    <div className="h-20"></div>
                    <p className="font-bold underline text-gray-900">
                      {latestAttempt?.examinerName || '( ________________________ )'}
                    </p>
                    <p className="text-[10px] text-gray-500">Penguji Resmi Tahsin SITA</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white p-12 text-center text-gray-400 rounded-xl border border-gray-100">
                Pilih santri dari daftar sebelah kiri untuk melihat transkrip nilai.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: REKAPITULASI PER KELAS                                             */}
      {/* ========================================================================= */}
      {activeTab === 'class_recap' && (
        <div className="space-y-6">
          {/* Class Selector Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <label className="text-xs font-bold text-gray-700">Pilih Kelas:</label>
              <select
                value={selectedClass || (availableClasses[0] || '')}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="text-xs font-semibold px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {availableClasses.map(c => (
                  <option key={c} value={c}>Kelas {c}</option>
                ))}
              </select>
            </div>

            <div className="text-xs text-gray-500">
              Cakupan Target: <span className="font-bold text-emerald-800">
                {tahsinService.getCoverageByClass(selectedClass || availableClasses[0] || '').label}
              </span>
            </div>
          </div>

          {/* Class Summary Stats */}
          {(() => {
            const curClass = selectedClass || availableClasses[0] || '';
            const classStudents = enrichedStudents.filter(es => es.student.class === curClass);
            const total = classStudents.length;
            const completed = classStudents.filter(es => es.status === 'completed' || es.finalScore !== undefined).length;
            const lulus = classStudents.filter(es => es.passingStatus === 'lulus').length;
            const remedial = classStudents.filter(es => es.passingStatus === 'remedial').length;
            const avgScore = completed > 0 
              ? (classStudents.reduce((acc, curr) => acc + (curr.finalScore || 0), 0) / completed)
              : 0;
            const passRate = completed > 0 ? (lulus / completed) * 100 : 0;

            return (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Total Santri</span>
                  <p className="text-xl font-black text-gray-800 mt-1">{total}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-blue-500 uppercase">Selesai Diuji</span>
                  <p className="text-xl font-black text-blue-700 mt-1">{completed}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-emerald-500 uppercase">Lulus</span>
                  <p className="text-xl font-black text-emerald-700 mt-1">{lulus}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-amber-500 uppercase">Remedial</span>
                  <p className="text-xl font-black text-amber-700 mt-1">{remedial}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-purple-500 uppercase">Rata-rata Nilai</span>
                  <p className="text-xl font-black text-purple-700 mt-1">
                    {avgScore.toFixed(1)}
                    <span className="text-[10px] text-gray-400 font-normal ml-1">({passRate.toFixed(0)}% lulus)</span>
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Class Students Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                Daftar Rekap Nilai Tahsin Kelas {selectedClass || availableClasses[0]}
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-[10px] border-b border-gray-200">
                  <tr>
                    <th className="py-3 px-3 text-center w-10">No</th>
                    <th className="py-3 px-3">NIS</th>
                    <th className="py-3 px-3">Nama Santri</th>
                    <th className="py-3 px-3">Halaqah</th>
                    <th className="py-3 px-3 text-center">Jml Hal</th>
                    <th className="py-3 px-3 text-center">Makharij (35%)</th>
                    <th className="py-3 px-3 text-center">Tajwid (30%)</th>
                    <th className="py-3 px-3 text-center">Kelancaran (20%)</th>
                    <th className="py-3 px-3 text-center">Waqaf (15%)</th>
                    <th className="py-3 px-3 text-center font-extrabold">Nilai Akhir</th>
                    <th className="py-3 px-3 text-center">Predikat</th>
                    <th className="py-3 px-3 text-center">Status</th>
                    <th className="py-3 px-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(() => {
                    const curClass = selectedClass || availableClasses[0] || '';
                    const classStudents = enrichedStudents.filter(es => es.student.class === curClass);

                    if (classStudents.length === 0) {
                      return (
                        <tr>
                          <td colSpan={13} className="py-8 text-center text-gray-400 italic">
                            Tidak ada data santri untuk kelas ini.
                          </td>
                        </tr>
                      );
                    }

                    return classStudents.map((item, idx) => {
                      const latest = item.attempts && item.attempts.length > 0
                        ? [...item.attempts].sort((a, b) => b.attemptNumber - a.attemptNumber)[0]
                        : null;

                      return (
                        <tr key={item.student.id} className="hover:bg-gray-50/60 transition">
                          <td className="py-2.5 px-3 text-center text-gray-500">{idx + 1}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-gray-600">{item.student.nis || '-'}</td>
                          <td className="py-2.5 px-3 font-bold text-gray-900">{item.student.name}</td>
                          <td className="py-2.5 px-3 text-gray-600">{item.student.halaqah}</td>
                          <td className="py-2.5 px-3 text-center font-semibold">
                            {latest?.reading?.pagesRead ? `${latest.reading.pagesRead} hal` : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center font-medium">
                            {latest?.makharij?.score ?? '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center font-medium">
                            {latest?.tajwid?.score ?? '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center font-medium">
                            {latest?.kelancaran?.score ?? '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center font-medium">
                            {latest?.waqaf?.score ?? '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center font-black text-emerald-900 text-xs">
                            {item.finalScore !== undefined ? item.finalScore.toFixed(1) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="font-semibold text-gray-700">{item.predikat || '-'}</span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {item.passingStatus === 'lulus' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                Lulus
                              </span>
                            ) : item.passingStatus === 'remedial' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                Remedial
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500">
                                Belum
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              onClick={() => {
                                setSelectedStudentId(item.student.id);
                                setActiveTab('transcript');
                              }}
                              className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded transition"
                              title="Lihat Transkrip"
                            >
                              <Eye size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: REKAPITULASI PER HALAQAH                                           */}
      {/* ========================================================================= */}
      {activeTab === 'halaqah_recap' && (
        <div className="space-y-6">
          {/* Halaqah Selector Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <label className="text-xs font-bold text-gray-700">Pilih Halaqah:</label>
              <select
                value={selectedHalaqah || (availableHalaqahs[0] || '')}
                onChange={(e) => setSelectedHalaqah(e.target.value)}
                className="text-xs font-semibold px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {availableHalaqahs.map(h => (
                  <option key={h} value={h}>Halaqah {h}</option>
                ))}
              </select>
            </div>

            <div className="text-xs text-gray-600">
              Guru Pengampu: <span className="font-bold text-emerald-900">
                {getTeacherName(selectedHalaqah || availableHalaqahs[0] || '')}
              </span>
            </div>
          </div>

          {/* Halaqah Summary Stats */}
          {(() => {
            const curHalaqah = selectedHalaqah || availableHalaqahs[0] || '';
            const halStudents = enrichedStudents.filter(es => es.student.halaqah === curHalaqah);
            const total = halStudents.length;
            const completed = halStudents.filter(es => es.status === 'completed' || es.finalScore !== undefined).length;
            const lulus = halStudents.filter(es => es.passingStatus === 'lulus').length;
            const remedial = halStudents.filter(es => es.passingStatus === 'remedial').length;
            const avgScore = completed > 0 
              ? (halStudents.reduce((acc, curr) => acc + (curr.finalScore || 0), 0) / completed)
              : 0;

            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Santri Binaan</span>
                  <p className="text-xl font-black text-gray-800 mt-1">{total}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-emerald-500 uppercase">Lulus Ujian</span>
                  <p className="text-xl font-black text-emerald-700 mt-1">{lulus}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-amber-500 uppercase">Remedial</span>
                  <p className="text-xl font-black text-amber-700 mt-1">{remedial}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-purple-500 uppercase">Rata-rata Nilai</span>
                  <p className="text-xl font-black text-purple-700 mt-1">{avgScore.toFixed(1)}</p>
                </div>
              </div>
            );
          })()}

          {/* Halaqah Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                Rekap Santri Halaqah {selectedHalaqah || availableHalaqahs[0]}
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-[10px] border-b border-gray-200">
                  <tr>
                    <th className="py-3 px-3 text-center w-10">No</th>
                    <th className="py-3 px-3">Nama Santri</th>
                    <th className="py-3 px-3">Kelas</th>
                    <th className="py-3 px-3">Target Materi</th>
                    <th className="py-3 px-3 text-center">Makharij</th>
                    <th className="py-3 px-3 text-center">Tajwid</th>
                    <th className="py-3 px-3 text-center">Kelancaran</th>
                    <th className="py-3 px-3 text-center">Waqaf</th>
                    <th className="py-3 px-3 text-center font-extrabold">Nilai Akhir</th>
                    <th className="py-3 px-3 text-center">Predikat</th>
                    <th className="py-3 px-3 text-center">Status</th>
                    <th className="py-3 px-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(() => {
                    const curHalaqah = selectedHalaqah || availableHalaqahs[0] || '';
                    const halStudents = enrichedStudents.filter(es => es.student.halaqah === curHalaqah);

                    if (halStudents.length === 0) {
                      return (
                        <tr>
                          <td colSpan={12} className="py-8 text-center text-gray-400 italic">
                            Tidak ada santri di halaqah ini.
                          </td>
                        </tr>
                      );
                    }

                    return halStudents.map((item, idx) => {
                      const latest = item.attempts && item.attempts.length > 0
                        ? [...item.attempts].sort((a, b) => b.attemptNumber - a.attemptNumber)[0]
                        : null;

                      return (
                        <tr key={item.student.id} className="hover:bg-gray-50/60 transition">
                          <td className="py-2.5 px-3 text-center text-gray-500">{idx + 1}</td>
                          <td className="py-2.5 px-3 font-bold text-gray-900">{item.student.name}</td>
                          <td className="py-2.5 px-3 text-gray-600">{item.student.class}</td>
                          <td className="py-2.5 px-3 text-emerald-800 font-medium">{item.coverage.label}</td>
                          <td className="py-2.5 px-3 text-center">{latest?.makharij?.score ?? '-'}</td>
                          <td className="py-2.5 px-3 text-center">{latest?.tajwid?.score ?? '-'}</td>
                          <td className="py-2.5 px-3 text-center">{latest?.kelancaran?.score ?? '-'}</td>
                          <td className="py-2.5 px-3 text-center">{latest?.waqaf?.score ?? '-'}</td>
                          <td className="py-2.5 px-3 text-center font-black text-emerald-950">
                            {item.finalScore !== undefined ? item.finalScore.toFixed(1) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center font-medium">{item.predikat || '-'}</td>
                          <td className="py-2.5 px-3 text-center">
                            {item.passingStatus === 'lulus' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                Lulus
                              </span>
                            ) : item.passingStatus === 'remedial' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                Remedial
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500">
                                Belum
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              onClick={() => {
                                setSelectedStudentId(item.student.id);
                                setActiveTab('transcript');
                              }}
                              className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded transition"
                              title="Lihat Transkrip"
                            >
                              <Eye size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: REKAPITULASI KESELURUHAN (SEKOLAH)                                  */}
      {/* ========================================================================= */}
      {activeTab === 'all_recap' && (
        <div className="space-y-6">
          {/* Global Summary Cards */}
          {(() => {
            const total = enrichedStudents.length;
            const completed = enrichedStudents.filter(es => es.status === 'completed' || es.finalScore !== undefined).length;
            const lulus = enrichedStudents.filter(es => es.passingStatus === 'lulus').length;
            const remedial = enrichedStudents.filter(es => es.passingStatus === 'remedial').length;
            const notStarted = total - completed;
            const passRate = completed > 0 ? (lulus / completed) * 100 : 0;
            const avgGlobal = completed > 0
              ? (enrichedStudents.reduce((acc, curr) => acc + (curr.finalScore || 0), 0) / completed)
              : 0;

            return (
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Total Santri</span>
                  <p className="text-xl font-black text-gray-800 mt-1">{total}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-blue-500 uppercase">Telah Diuji</span>
                  <p className="text-xl font-black text-blue-700 mt-1">{completed}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-emerald-500 uppercase">Lulus</span>
                  <p className="text-xl font-black text-emerald-700 mt-1">{lulus}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-amber-500 uppercase">Remedial</span>
                  <p className="text-xl font-black text-amber-700 mt-1">{remedial}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Belum Ujian</span>
                  <p className="text-xl font-black text-gray-600 mt-1">{notStarted}</p>
                </div>
                <div className="bg-white p-3.5 rounded-xl border border-gray-100 shadow-sm text-center">
                  <span className="text-[10px] font-bold text-purple-500 uppercase">Tingkat Lulus</span>
                  <p className="text-xl font-black text-purple-700 mt-1">
                    {passRate.toFixed(1)}%
                    <span className="text-[10px] text-gray-400 font-normal ml-1">(Rata: {avgGlobal.toFixed(1)})</span>
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Table per Class Breakdown */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                Rekapitulasi Capaian Ujian Tahsin Per Angkatan & Kelas
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-[10px] border-b border-gray-200">
                  <tr>
                    <th className="py-3 px-3 text-center w-10">No</th>
                    <th className="py-3 px-3">Kelas</th>
                    <th className="py-3 px-3">Cakupan Target Juz</th>
                    <th className="py-3 px-3 text-center">Jumlah Santri</th>
                    <th className="py-3 px-3 text-center">Telah Diuji</th>
                    <th className="py-3 px-3 text-center">Lulus</th>
                    <th className="py-3 px-3 text-center">Remedial</th>
                    <th className="py-3 px-3 text-center">% Kelulusan</th>
                    <th className="py-3 px-3 text-center">Rata-rata Nilai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {availableClasses.map((className, idx) => {
                    const cStudents = enrichedStudents.filter(es => es.student.class === className);
                    const total = cStudents.length;
                    const completed = cStudents.filter(es => es.status === 'completed' || es.finalScore !== undefined).length;
                    const lulus = cStudents.filter(es => es.passingStatus === 'lulus').length;
                    const remedial = cStudents.filter(es => es.passingStatus === 'remedial').length;
                    const passRate = completed > 0 ? (lulus / completed) * 100 : 0;
                    const avg = completed > 0 
                      ? (cStudents.reduce((acc, curr) => acc + (curr.finalScore || 0), 0) / completed)
                      : 0;
                    const coverage = tahsinService.getCoverageByClass(className);

                    return (
                      <tr key={className} className="hover:bg-gray-50/60 transition">
                        <td className="py-2.5 px-3 text-center text-gray-500">{idx + 1}</td>
                        <td className="py-2.5 px-3 font-bold text-gray-900">Kelas {className}</td>
                        <td className="py-2.5 px-3 text-emerald-800 font-semibold">{coverage.label}</td>
                        <td className="py-2.5 px-3 text-center font-semibold">{total}</td>
                        <td className="py-2.5 px-3 text-center text-blue-700 font-semibold">{completed}</td>
                        <td className="py-2.5 px-3 text-center text-emerald-700 font-bold">{lulus}</td>
                        <td className="py-2.5 px-3 text-center text-amber-700 font-bold">{remedial}</td>
                        <td className="py-2.5 px-3 text-center font-bold">
                          <div className="flex items-center justify-center gap-1.5">
                            <div className="w-16 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="bg-emerald-600 h-1.5 rounded-full"
                                style={{ width: `${passRate}%` }}
                              ></div>
                            </div>
                            <span className="text-[11px]">{passRate.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-black text-gray-800">
                          {avg > 0 ? avg.toFixed(1) : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default TahsinReportsView;
