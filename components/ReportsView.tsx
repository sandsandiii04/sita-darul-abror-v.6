import React, { useState, useEffect } from 'react';
import { User, Student, TahfidzRecord, Grade, Attendance, AttendanceOpenRequest } from '../types';
import { Printer, Calendar, FileText, ChevronLeft, ChevronRight, Filter, Users, UserCheck, AlertTriangle, Download, Trash2 } from 'lucide-react';
import { LOGO_URL, getLocalMonthString } from '../constants';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

interface ReportsViewProps {
  user: User;
  students: Student[];
  records: TahfidzRecord[];
  users?: User[];
  attendance: Attendance[];
  openRequests?: AttendanceOpenRequest[];
  onDeleteOpenRequest?: (id: string) => void;
}

type Period = 'weekly' | 'monthly' | 'semester' | 'yearly';
type ReportType = 'student' | 'teacher';

const ReportsView: React.FC<ReportsViewProps> = ({ user, students, records, users, attendance, openRequests = [], onDeleteOpenRequest }) => {
  const [period, setPeriod] = useState<Period>('monthly');
  const [reportType, setReportType] = useState<ReportType>('student');
  const [studentTab, setStudentTab] = useState<'hafalan' | 'absen'>('hafalan');
  
  // Bulk PDF Export States
  const [isBulkExporting, setIsBulkExporting] = useState(false);
  const [bulkStudentId, setBulkStudentId] = useState<string | null>(null);
  const [bulkExportProgress, setBulkExportProgress] = useState(0);
  
  // Filters
  const [filterClass, setFilterClass] = useState('');
  const [filterHalaqah, setFilterHalaqah] = useState('');
  const [filterStudentId, setFilterStudentId] = useState('');
  const [filterTeacherGender, setFilterTeacherGender] = useState<'' | 'L' | 'P'>('');
  const [filterStartNo, setFilterStartNo] = useState('');
  const [filterEndNo, setFilterEndNo] = useState('');
  
  // Default to current month
  const today = new Date();
  const defaultMonth = getLocalMonthString(today); // YYYY-MM
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  
  const getWeekNumber = (d: Date) => {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
  };
  const [selectedWeek, setSelectedWeek] = useState(getWeekNumber(today));

  // Semester and Year States
  const [selectedSemesterYear, setSelectedSemesterYear] = useState(today.getFullYear());
  const [selectedSemesterType, setSelectedSemesterType] = useState<'ganjil' | 'genap'>(
    today.getMonth() >= 6 ? 'ganjil' : 'genap'
  );
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());

  // Date Calculation
  let startDate: Date;
  let endDate: Date;
  let periodLabel = "";

  if (period === 'monthly') {
    const [year, month] = selectedMonth.split('-').map(Number);
    startDate = new Date(year, month - 1, 1);
    endDate = new Date(year, month, 0, 23, 59, 59);
    periodLabel = `Bulan ${startDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`;
  } else if (period === 'weekly') {
    const [year, week] = selectedWeek.split('-W').map(Number);
    const simple = new Date(year, 0, 1 + (week - 1) * 7);
    const day = simple.getDay();
    const diff = simple.getDate() - day + (day === 0 ? -6 : 1);
    startDate = new Date(simple.setDate(diff));
    endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    periodLabel = `Pekan ke-${week} (${startDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${endDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })})`;
  } else if (period === 'semester') {
    if (selectedSemesterType === 'ganjil') {
      startDate = new Date(selectedSemesterYear, 6, 1); // July 1st
      endDate = new Date(selectedSemesterYear, 11, 31, 23, 59, 59); // Dec 31st
      periodLabel = `Semester Ganjil (Jul - Des ${selectedSemesterYear})`;
    } else {
      startDate = new Date(selectedSemesterYear, 0, 1); // Jan 1st
      endDate = new Date(selectedSemesterYear, 5, 30, 23, 59, 59); // Jun 30th
      periodLabel = `Semester Genap (Jan - Jun ${selectedSemesterYear})`;
    }
  } else { // yearly
    startDate = new Date(selectedYear, 0, 1); // Jan 1st
    endDate = new Date(selectedYear, 11, 31, 23, 59, 59); // Dec 31st
    periodLabel = `Tahun ${selectedYear}`;
  }

  // Filter Students List
  let myStudents: Student[] = [];
  if (user.role === 'teacher') {
    myStudents = students.filter(s => s.teacherId === user.id);
  } else if (user.role === 'parent' && user.childId) {
    myStudents = students.filter(s => s.id === user.childId);
  } else if (user.role === 'admin') {
    myStudents = students;
  }

  // Apply Class, Halaqah and Specific Student Filter
  if (filterClass) {
    myStudents = myStudents.filter(s => s.class === filterClass);
  }
  if (filterHalaqah) {
    myStudents = myStudents.filter(s => s.halaqah === filterHalaqah);
  }
  if (filterStudentId) {
    myStudents = myStudents.filter(s => s.id === filterStudentId);
  }

  // Derived Classes for Dropdown
  const distinctClasses = Array.from(new Set(students.filter(s => {
    // Show classes relevant to the logged-in user
    if(user.role === 'teacher') return s.teacherId === user.id;
    return true; 
  }).map(s => s.class))).sort();

  // Derived Halaqahs for Dropdown
  const distinctHalaqahs = Array.from(new Set(students.filter(s => {
    // Show halaqahs relevant to the logged-in user
    if(user.role === 'teacher') return s.teacherId === user.id;
    return true;
  }).map(s => s.halaqah))).sort();


  const teacherName = user.role === 'teacher' 
    ? user.name 
    : (users?.find(u => u.id === myStudents[0]?.teacherId)?.name || 'Guru Halaqah');

  const gradeValue = (g: any) => {
    if (!g) return 0;
    const num = parseFloat(g);
    if (!isNaN(num)) return num;
    const str = g.toString().toLowerCase();
    if (str.includes('lancar bersyarat')) return 85;
    if (str.includes('lancar')) return 95;
    if (str.includes('belum lancar')) return 75;
    if (str.includes('ulang')) return 50;
    return 0;
  };

  const getPredikat = (score: number) => {
    if (score === 0) return '-';
    let finalScore = score;
    if (score <= 4.0) {
      if (score >= 3.8) finalScore = 95;
      else if (score >= 3.0) finalScore = 85;
      else if (score >= 2.0) finalScore = 75;
      else finalScore = 50;
    }
    if (finalScore >= 90) return 'ممتاز';
    if (finalScore >= 80) return 'جيد جداً';
    if (finalScore >= 70) return 'جيد';
    if (finalScore >= 60) return 'مقبول';
    return 'راسب';
  };

  const handlePrint = () => {
    window.print();
  };

  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!isExporting) return;

    const timer = setTimeout(async () => {
      const element = document.querySelector('.printable-area') as HTMLElement;
      if (!element) {
        setIsExporting(false);
        return;
      }
      try {
        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#ffffff'
        });

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 210;
        const pageHeight = 297;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        while (heightLeft > 2) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
          heightLeft -= pageHeight;
        }

        // Tentukan nama file PDF yang disesuaikan
        let fileName = `Laporan_SITA_${periodLabel.replace(/\s+/g, '_')}.pdf`;
        
        const isSingleStudent = user.role === 'parent' || !!filterStudentId;
        if (isSingleStudent && myStudents.length > 0) {
          const cleanStudentName = myStudents[0].name.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
          const cleanPeriodLabel = periodLabel.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '_');
          fileName = `Laporan_SITA_${cleanStudentName}_${cleanPeriodLabel}.pdf`;
        }

        pdf.save(fileName);
      } catch (error) {
        console.error("Gagal mendownload PDF:", error);
        alert("Gagal mengunduh PDF. Silakan gunakan tombol 'Cetak / Print' lalu pilih 'Simpan sebagai PDF'.");
      } finally {
        setIsExporting(false);
      }
    }, 150); // Delay 150ms to guarantee DOM re-render and paint before capturing

    return () => clearTimeout(timer);
  }, [isExporting, periodLabel, user.role, filterStudentId, myStudents]);

  const handleDownloadPDF = () => {
    setIsExporting(true);
  };

  const handleDownloadBulkPDF = async () => {
    if (myStudents.length === 0) return;
    setIsBulkExporting(true);
    setBulkExportProgress(0);

    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgWidth = 210;
    const pageHeight = 297;

    try {
      for (let i = 0; i < myStudents.length; i++) {
        const currentStudent = myStudents[i];
        setBulkStudentId(currentStudent.id);
        setBulkExportProgress(i + 1);

        // Wait for rendering and charts to load (e.g. 250ms)
        await new Promise((resolve) => setTimeout(resolve, 250));

        const element = document.getElementById('bulk-pdf-container');
        if (!element) continue;

        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#ffffff'
        });

        const imgData = canvas.toDataURL('image/png');
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        while (heightLeft > 2) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
          heightLeft -= pageHeight;
        }

        // If it's not the last student, add a page for the next student
        if (i < myStudents.length - 1) {
          pdf.addPage();
        }
      }

      // Tentukan nama file PDF yang disesuaikan
      let label = periodLabel.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '_');
      let halaqahName = filterHalaqah ? filterHalaqah.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '_') : 'Halaqah';
      let fileName = `Laporan_SITA_Bulk_${halaqahName}_${label}.pdf`;
      pdf.save(fileName);

    } catch (error) {
      console.error("Gagal mendownload PDF Masal:", error);
      alert("Gagal mengunduh PDF Masal. Silakan coba lagi.");
    } finally {
      setIsBulkExporting(false);
      setBulkStudentId(null);
      setBulkExportProgress(0);
    }
  };

  // --- SUB COMPONENTS ---

  const ParentReportCard = ({ studentOverride }: { studentOverride?: Student } = {}) => {
    const student = studentOverride || myStudents[0];
    if (!student) return <div className="p-8 text-center text-gray-500">Data santri tidak ditemukan atau filter tidak sesuai.</div>;

    const getTargetForClass = (className: string) => {
      const clean = className.trim().toUpperCase();
      if (clean.startsWith('7')) return { label: 'Kelas 7 SMP (Target Tahunan: 2 Juz)', target: 2 };
      if (clean.startsWith('8')) return { label: 'Kelas 8 SMP (Target Tahunan: 2 Juz)', target: 4 };
      if (clean.startsWith('9')) return { label: 'Kelas 9 SMP (Target Tahunan: 2 Juz)', target: 6 };
      if (clean.startsWith('10') || clean.startsWith('X')) return { label: 'Kelas 10 SMA (Target Kelulusan: 8 Juz)', target: 8 };
      if (clean.startsWith('11') || clean.startsWith('XI')) return { label: 'Kelas 11 SMA (Target Kelulusan: 9 Juz)', target: 9 };
      if (clean.startsWith('12') || clean.startsWith('XII')) return { label: 'Kelas 12 SMA (Target Kelulusan: 10 Juz)', target: 10 };
      return { label: 'SMP (Target Tahunan: 2 Juz)', target: 2 };
    };

    const targetInfo = getTargetForClass(student.class);
    const currentJuz = student.totalJuz || 0;
    const progressPercent = Math.min(Math.round((currentJuz / targetInfo.target) * 100), 100);

    const studentRecords = records.filter(r => {
      const rDate = new Date(r.date);
      return r.studentId === student.id && rDate >= startDate && rDate <= endDate;
    }).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const studentAtt = attendance.filter(a => {
      const aDate = new Date(a.date);
      return a.userId === student.id && a.type === 'student' && aDate >= startDate && aDate <= endDate;
    });
    
    const present = studentAtt.filter(a => a.status === 'present').length;
    const sick = studentAtt.filter(a => a.status === 'sick').length;
    const permission = studentAtt.filter(a => a.status === 'permission').length;
    const alpha = studentAtt.filter(a => a.status === 'alpha').length;
    
    const sabaqRecs = studentRecords.filter(r => r.type === 'sabaq' || r.type === 'ziyadah');
    const sabqiRecs = studentRecords.filter(r => r.type === 'sabqi');
    const manzilRecs = studentRecords.filter(r => r.type === 'manzil' || r.type === 'murojaah');

    const totalScore = studentRecords.reduce((acc, curr) => acc + gradeValue(curr.grade), 0);
    const avgScore = studentRecords.length > 0 ? (totalScore / studentRecords.length) : 0;
    // Hitung data capaian mingguan untuk santri ini
    const weeklyData = [
      { name: 'Pekan 1', sabaq: 0, murojaah: 0 },
      { name: 'Pekan 2', sabaq: 0, murojaah: 0 },
      { name: 'Pekan 3', sabaq: 0, murojaah: 0 },
      { name: 'Pekan 4', sabaq: 0, murojaah: 0 },
    ];

    studentRecords.forEach(r => {
      const rDate = new Date(r.date);
      const day = rDate.getDate();
      let weekIndex = 0;
      if (day <= 7) weekIndex = 0;
      else if (day <= 14) weekIndex = 1;
      else if (day <= 21) weekIndex = 2;
      else weekIndex = 3;

      const isSabaq = r.type === 'sabaq' || r.type === 'ziyadah';
      if (isSabaq) {
        weeklyData[weekIndex].sabaq += 1;
      } else {
        weeklyData[weekIndex].murojaah += 1;
      }
    });

    const predikat = getPredikat(avgScore);

    return (
      <div className="parent-report-card bg-white text-gray-800 p-8 md:p-12 max-w-4xl mx-auto shadow-lg print:shadow-none print:max-w-none print:w-full print:p-0 min-h-[297mm] relative flex flex-col">
        <div className="border-b-2 border-gray-800 pb-3 mb-4 flex items-center gap-4">
           <img src={LOGO_URL} alt="Logo" className="w-16 h-16 object-contain" />
           <div className="flex-1 text-center">
              <h1 className="text-2xl font-bold uppercase tracking-widest text-emerald-900">Ponpes Darul Abror IBS</h1>
              <p className="text-xs font-semibold tracking-wide mt-0.5">Lajnah Tahfidz Al-Qur'an</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151</p>
           </div>
           <div className="w-16"></div> 
        </div>

        <div className="text-center mb-4">
           <h2 className="text-lg font-bold uppercase underline decoration-2 underline-offset-4">Laporan Capaian Tahfidz</h2>
           <p className="text-xs text-gray-600 mt-1 font-medium">{periodLabel}</p>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 mb-4 text-xs">
           <div className="flex">
             <span className="w-28 font-bold text-gray-600">Nama Santri</span>
             <span className="font-semibold">: {student.name}</span>
           </div>
           <div className="flex">
             <span className="w-28 font-bold text-gray-600">Kelas</span>
             <span className="font-semibold">: {student.class}</span>
           </div>
           <div className="flex">
             <span className="w-28 font-bold text-gray-600">Nomor Induk</span>
             <span className="font-semibold">: {student.nis}</span>
           </div>
           <div className="flex">
             <span className="w-28 font-bold text-gray-600">Halaqah</span>
             <span className="font-semibold">: {student.halaqah}</span>
           </div>
        </div>

        {/* Informasi Target & Capaian Tahfidz */}
        <div className="bg-emerald-50/50 border border-emerald-100 p-3 rounded-lg mb-4 print:border-gray-300 print:bg-white">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
            <div>
              <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-wider print:text-black">Target Kelulusan Akumulatif</span>
              <h4 className="text-[11px] font-bold text-gray-800 mt-0.5">{targetInfo.label}</h4>
            </div>
            <div className="text-left sm:text-right">
              <span className="text-[9px] text-gray-500 font-bold">Pencapaian:</span>
              <span className="text-xs font-bold text-emerald-700 ml-1.5 print:text-black">{currentJuz} / {targetInfo.target} Juz</span>
            </div>
          </div>
          
          {/* Visual Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2 print:border print:border-gray-300 overflow-hidden">
            <div 
              className="bg-emerald-600 h-2 rounded-full transition-all duration-500 print:bg-gray-700" 
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
          
          <div className="flex justify-between items-center mt-1 text-[8px] font-bold text-gray-500">
            <span>0 Juz</span>
            <span className="text-emerald-700 print:text-black">{progressPercent}% Tercapai</span>
            <span>{targetInfo.target} Juz</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-3">
           <div className="border border-emerald-100 bg-emerald-50 p-2.5 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-xl font-bold text-emerald-700 print:text-black">{sabaqRecs.length}</div>
              <div className="text-[10px] font-bold text-emerald-900 uppercase mt-0.5">Sabaq</div>
           </div>
           <div className="border border-blue-100 bg-blue-50 p-2.5 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-xl font-bold text-blue-700 print:text-black">{sabqiRecs.length}</div>
              <div className="text-[10px] font-bold text-blue-900 uppercase mt-0.5">Sabqi</div>
           </div>
           <div className="border border-orange-100 bg-orange-50 p-2.5 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-xl font-bold text-orange-700 print:text-black">{manzilRecs.length}</div>
              <div className="text-[10px] font-bold text-orange-900 uppercase mt-0.5">Manzil</div>
           </div>
           <div className="border border-purple-100 bg-purple-50 p-2.5 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-xl font-bold text-purple-700 print:text-black">{predikat}</div>
              <div className="text-[10px] font-bold text-purple-900 uppercase mt-0.5">Predikat</div>
           </div>
        </div>

        {/* Attendance Stats Grid */}
        <div className="grid grid-cols-4 gap-3 mb-4">
           <div className="border border-green-100 bg-green-50 py-2 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-xl font-bold text-green-700 print:text-black">{present}</div>
              <div className="text-[9px] font-bold text-green-900 uppercase mt-0.5">Hadir</div>
           </div>
           <div className="border border-yellow-100 bg-yellow-50 py-2 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-xl font-bold text-yellow-700 print:text-black">{sick}</div>
              <div className="text-[9px] font-bold text-yellow-900 uppercase mt-0.5">Sakit</div>
           </div>
           <div className="border border-indigo-100 bg-indigo-50 py-2 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-xl font-bold text-indigo-700 print:text-black">{permission}</div>
              <div className="text-[9px] font-bold text-indigo-900 uppercase mt-0.5">Izin</div>
           </div>
           <div className="border border-red-100 bg-red-50 py-2 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-xl font-bold text-red-700 print:text-black">{alpha}</div>
              <div className="text-[9px] font-bold text-red-900 uppercase mt-0.5">Alpha</div>
           </div>
        </div>

        {/* Grafik Capaian Mingguan Santri */}
        <div className="bg-white p-3 rounded-lg border border-gray-100 mb-4 print:border-gray-300">
          <h3 className="text-xs font-bold text-gray-700 mb-2 text-center print:text-black">Grafik Capaian Setoran Bulanan (Frekuensi)</h3>
          <div className="h-36 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={9} />
                <YAxis axisLine={false} tickLine={false} fontSize={9} allowDecimals={false} />
                <Tooltip 
                  contentStyle={{ borderRadius: '6px', border: 'none', boxShadow: '0 2px 4px -1px rgb(0 0 0 / 0.05)', fontSize: '10px' }}
                />
                <Legend wrapperStyle={{ fontSize: '9px' }} />
                <Bar name="Sabaq (Setoran Baru)" dataKey="sabaq" fill="#10b981" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                <Bar name="Muroja'ah (Ulang)" dataKey="murojaah" fill="#3b82f6" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="mb-4 flex-1">
           <h3 className="text-xs font-bold text-gray-800 mb-2 border-b pb-1">
              Riwayat Setoran {period === 'weekly' || period === 'monthly' ? '(Terbaru)' : '(Lengkap)'}
           </h3>
           <table className="w-full text-xs border-collapse border border-gray-300">
             <thead>
               <tr className="bg-gray-50 print:bg-gray-100 text-[11px]">
                 <th className="border border-gray-300 p-1.5 text-center w-8">No</th>
                 <th className="border border-gray-300 p-1.5 w-20">Tanggal</th>
                 <th className="border border-gray-300 p-1.5 w-16 text-center">Jenis</th>
                 <th className="border border-gray-300 p-1.5">Hafalan</th>
                 <th className="border border-gray-300 p-1.5 text-center w-24">Predikat</th>
               </tr>
             </thead>
             <tbody>
               {studentRecords.length === 0 ? (
                 <tr><td colSpan={5} className="p-4 text-center text-gray-400">Tidak ada setoran pada periode ini.</td></tr>
               ) : (
                 (() => {
                   const displayRecords = (period === 'weekly' || period === 'monthly') ? studentRecords.slice(-12) : studentRecords;
                   return displayRecords.map((rec, idx) => (
                     <tr key={rec.id}>
                       <td className="border border-gray-300 p-1.5 text-center">{idx + 1}</td>
                       <td className="border border-gray-300 p-1.5">{new Date(rec.date).toLocaleDateString('id-ID', {day: '2-digit', month: '2-digit'})}</td>
                       <td className="border border-gray-300 p-1.5 text-center capitalize">{rec.type}</td>
                       <td className="border border-gray-300 p-1.5">
                          {rec.ayahStart > 0 ? (
                            <>
                              <span className="font-semibold">{rec.surah}</span>: {rec.ayahStart}-{rec.ayahEnd}
                              {rec.notes && <span className="text-[11px] text-gray-500 font-medium ml-1.5">({rec.notes})</span>}
                            </>
                          ) : (
                            <>
                              <span className="font-semibold">{rec.surah}</span>
                              {rec.notes && <span className="text-[11px] text-gray-500 font-medium ml-1.5">({rec.notes})</span>}
                            </>
                          )}
                        </td>
                       <td className="border border-gray-300 p-1.5 text-center">
                          {(() => {
                            const score = parseFloat(rec.grade);
                            if (!isNaN(score)) {
                              let arabic = 'راسب';
                              if (score >= 90) arabic = 'ممتاز';
                              else if (score >= 80) arabic = 'جيد جداً';
                              else if (score >= 70) arabic = 'جيد';
                              else if (score >= 60) arabic = 'مقبول';
                              
                              return (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border print:bg-transparent print:text-black print:border-none ${
                                  score >= 90 ? 'bg-green-50 text-green-700 border-green-200' :
                                  score >= 80 ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                  score >= 70 ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                  score >= 60 ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                  'bg-red-50 text-red-700 border-red-200'
                                }`}>
                                  {score} ({arabic})
                                </span>
                              );
                            }
                            return (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border print:bg-transparent print:text-black print:border-none ${
                                rec.grade === 'Lancar' ? 'bg-green-50 text-green-700 border-green-200' : 
                                rec.grade === 'Lancar Bersyarat' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : 
                                'bg-red-50 text-red-700 border-red-200'}`}>
                                {rec.grade}
                              </span>
                            );
                          })()}
                       </td>
                     </tr>
                   ));
                 })()
               )}
             </tbody>
           </table>
        </div>

        <div className="signature-section flex justify-between mt-auto pt-4 mb-4 px-2">
            <div className="text-center w-48">
               <p className="text-xs text-gray-600 mb-12">Mengetahui,</p>
               <p className="font-bold underline text-gray-800 text-xs">...................................</p>
               <p className="text-[10px] text-gray-500 font-semibold">Kabag Tahfiz Al Qur'an</p>
            </div>
            <div className="text-center w-48">
               <p className="text-xs text-gray-600 mb-12">Garut, {new Date().toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</p>
               <p className="font-bold underline text-gray-800 text-xs">{teacherName}</p>
               <p className="text-[10px] text-gray-500 font-semibold">Guru Halaqah</p>
            </div>
         </div>
      </div>
    );
  };

  const TeacherRecapTable = () => {
    const reportData = myStudents.map(student => {
      const studentRecords = records.filter(r => {
        const rDate = new Date(r.date);
        return r.studentId === student.id && rDate >= startDate && rDate <= endDate;
      });
      const sabaqRecords = studentRecords.filter(r => r.type === 'sabaq' || r.type === 'ziyadah');
      const sabqiRecords = studentRecords.filter(r => r.type === 'sabqi');
      const manzilRecords = studentRecords.filter(r => r.type === 'manzil' || r.type === 'murojaah');
      
      const totalScore = studentRecords.reduce((acc, curr) => acc + gradeValue(curr.grade), 0);
      const avgScore = studentRecords.length > 0 ? (totalScore / studentRecords.length) : 0;

      const lastZiyadah = sabaqRecords.length > 0 
        ? sabaqRecords.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
        : null;

      const studentAtt = attendance.filter(a => {
        const aDate = new Date(a.date);
        return a.userId === student.id && a.type === 'student' && aDate >= startDate && aDate <= endDate;
      });
      const present = studentAtt.filter(a => a.status === 'present').length;
      const sick = studentAtt.filter(a => a.status === 'sick').length;
      const permission = studentAtt.filter(a => a.status === 'permission').length;
      const alpha = studentAtt.filter(a => a.status === 'alpha').length;

      return {
        student,
        sabaqCount: sabaqRecords.length,
        sabqiCount: sabqiRecords.length,
        manzilCount: manzilRecords.length,
        avgScore,
        predikat: getPredikat(avgScore),
        lastAchievement: lastZiyadah ? (lastZiyadah.ayahStart > 0 ? `${lastZiyadah.surah} (${lastZiyadah.ayahStart}-${lastZiyadah.ayahEnd})` : lastZiyadah.surah) : '-',
        present, sick, permission, alpha
      };
    });

    return (
      <div className="teacher-recap-table bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden print:shadow-none print:border-none print:rounded-none">
        <div className={`${isExporting ? 'block' : 'hidden print:block'} w-full mb-6`}>
          <div className="border-b-4 border-double border-gray-800 pb-4 mb-6 flex items-center gap-6">
             <img src={LOGO_URL} alt="Logo" className="w-16 h-16 object-contain" />
             <div className="flex-1 text-center">
                <h1 className="text-2xl font-bold uppercase tracking-widest text-emerald-900">Ponpes Darul Abror IBS</h1>
                <p className="text-xs font-semibold tracking-wide mt-0.5">Lajnah Tahfidz Al-Qur'an</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151</p>
             </div>
             <div className="w-16"></div> 
          </div>
          <div className="text-center">
              <h2 className="text-base font-bold uppercase underline decoration-2 underline-offset-4">
                {studentTab === 'hafalan' ? 'Laporan Rekapitulasi Tahfidz Santri' : 'Laporan Rekapitulasi Kehadiran Santri'}
              </h2>
              <p className="text-xs font-medium mt-1">{periodLabel}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">Ustadz/Halaqah: {user.name}</p>
          </div>
        </div>

        <div className="p-0 print:p-4">
           {studentTab === 'hafalan' ? (
             <table className="w-full text-left border-collapse border border-gray-300">
               <thead>
                 <tr className="bg-gray-100 text-gray-700 text-sm print:bg-gray-200 print:text-black">
                   <th className="p-3 border border-gray-300 text-center w-12">No</th>
                   <th className="p-3 border border-gray-300">Nama Santri</th>
                   <th className="p-3 border border-gray-300 text-center">Kelas</th>
                   <th className="p-3 border border-gray-300 text-center bg-emerald-50/50">Sabaq (Ziyadah)</th>
                   <th className="p-3 border border-gray-300 text-center bg-blue-50/50">Sabqi (Murojaah)</th>
                   <th className="p-3 border border-gray-300 text-center bg-orange-50/50">Manzil (Juz)</th>
                   <th className="p-3 border border-gray-300 text-center">Rata-rata Nilai</th>
                   <th className="p-3 border border-gray-300 text-center">Predikat</th>
                   <th className="p-3 border border-gray-300">Hafalan Terakhir</th>
                 </tr>
               </thead>
               <tbody className="text-sm">
                 {reportData.length === 0 ? (
                   <tr><td colSpan={9} className="p-8 text-center text-gray-400 border border-gray-300">Tidak ada data santri.</td></tr>
                 ) : (
                   reportData.map((row, idx) => (
                     <tr key={row.student.id} className="print:text-black">
                       <td className="p-3 border border-gray-300 text-center">{idx + 1}</td>
                       <td className="p-3 border border-gray-300 font-medium">{row.student.name}</td>
                       <td className="p-3 border border-gray-300 text-center text-xs">{row.student.class}</td>
                       <td className="p-3 border border-gray-300 text-center font-semibold text-emerald-700 bg-emerald-50/30">{row.sabaqCount}x</td>
                       <td className="p-3 border border-gray-300 text-center font-semibold text-blue-700 bg-blue-50/30">{row.sabqiCount}x</td>
                       <td className="p-3 border border-gray-300 text-center font-semibold text-orange-700 bg-orange-50/30">{row.manzilCount}x</td>
                       <td className="p-3 border border-gray-300 text-center">{row.avgScore > 0 ? row.avgScore.toFixed(1) : '-'}</td>
                       <td className="p-3 border border-gray-300 text-center font-bold text-purple-700">{row.predikat}</td>
                       <td className="p-3 border border-gray-300 text-xs truncate max-w-[150px]">{row.lastAchievement}</td>
                     </tr>
                   ))
                 )}
               </tbody>
             </table>
           ) : (
             <table className="w-full text-left border-collapse border border-gray-300">
               <thead>
                 <tr className="bg-gray-100 text-gray-700 text-sm print:bg-gray-200 print:text-black">
                   <th className="p-3 border border-gray-300 text-center w-12">No</th>
                   <th className="p-3 border border-gray-300">Nama Santri</th>
                   <th className="p-3 border border-gray-300 text-center">Kelas</th>
                   <th className="p-3 border border-gray-300 text-center bg-green-50 text-green-700">Hadir</th>
                   <th className="p-3 border border-gray-300 text-center bg-amber-50 text-amber-700">Sakit</th>
                   <th className="p-3 border border-gray-300 text-center bg-sky-50 text-sky-700">Izin</th>
                   <th className="p-3 border border-gray-300 text-center bg-rose-50 text-rose-700">Alpha</th>
                   <th className="p-3 border border-gray-300 text-center font-bold text-indigo-700">Persentase</th>
                 </tr>
               </thead>
               <tbody className="text-sm">
                 {reportData.length === 0 ? (
                   <tr><td colSpan={8} className="p-8 text-center text-gray-400 border border-gray-300">Tidak ada data santri.</td></tr>
                 ) : (
                   reportData.map((row, idx) => {
                     const totalDays = row.present + row.sick + row.permission + row.alpha;
                     const attendancePercent = totalDays > 0 ? Math.round((row.present / totalDays) * 100) : 0;
                     return (
                       <tr key={row.student.id} className="print:text-black">
                         <td className="p-3 border border-gray-300 text-center">{idx + 1}</td>
                         <td className="p-3 border border-gray-300 font-medium">{row.student.name}</td>
                         <td className="p-3 border border-gray-300 text-center text-xs">{row.student.class}</td>
                         <td className="p-3 border border-gray-300 text-center font-bold text-green-700 bg-green-50 print:bg-transparent print:text-black">{row.present}</td>
                         <td className="p-3 border border-gray-300 text-center text-yellow-700 bg-amber-50 print:bg-transparent print:text-black">{row.sick}</td>
                         <td className="p-3 border border-gray-300 text-center text-indigo-700 bg-sky-50 print:bg-transparent print:text-black">{row.permission}</td>
                         <td className="p-3 border border-gray-300 text-center text-red-700 bg-rose-50 print:bg-transparent print:text-black">{row.alpha}</td>
                         <td className="p-3 border border-gray-300 text-center font-bold text-indigo-700 bg-indigo-50/30">
                           {totalDays > 0 ? `${attendancePercent}%` : '-'}
                         </td>
                       </tr>
                     );
                   })
                 )}
               </tbody>
             </table>
           )}

            {studentTab === 'hafalan' ? (
              <div className={`signature-section ${isExporting ? 'flex' : 'hidden print:flex'} justify-between mt-16 px-10`}>
                <div className="text-center w-48">
                    <p className="text-sm text-gray-600 mb-20">Mengetahui,</p>
                    <p className="font-bold underline">...................................</p>
                    <p className="text-xs text-gray-500 font-semibold">Kabag Tahfiz Al Qur'an</p>
                </div>
                <div className="text-center w-48">
                    <p className="text-sm text-gray-600 mb-20">Garut, {new Date().toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</p>
                    <p className="font-bold underline">{user.name}</p>
                    <p className="text-xs text-gray-500 font-semibold">Guru Halaqah</p>
                </div>
              </div>
            ) : (
              <div className={`signature-section ${isExporting ? 'flex' : 'hidden print:flex'} justify-end mt-16 px-10`}>
                <div className="text-center w-64">
                    <p className="text-sm text-gray-600 mb-12">Garut, {new Date().toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</p>
                    <p className="font-bold text-gray-800 text-sm">Kabag Tahfiz Al Qur'an</p>
                    <p className="text-xs text-gray-500 font-semibold mt-0.5">Ma'had Darul Abror IBS</p>
                </div>
              </div>
            )}
         </div>
      </div>
    );
  };

  const TeacherAttendanceRecap = () => {
    const teachers = users?.filter(u => u.role === 'teacher') || [];
    const maxAttendance = period === 'weekly' ? 10 : period === 'monthly' ? 40 : period === 'semester' ? 240 : period === 'yearly' ? 480 : 40;
    const periodLabelSmall = period === 'weekly' ? 'pekan' : period === 'monthly' ? 'bulan' : period === 'semester' ? 'semester' : 'tahun';
    
    const data = teachers.map(t => {
       const teacherAtt = attendance.filter(a => {
            const aDate = new Date(a.date);
            return a.userId === t.id && a.type === 'teacher' && aDate >= startDate && aDate <= endDate;
       });

       const present = teacherAtt.filter(a => a.status === 'present').length;
       const sick = teacherAtt.filter(a => a.status === 'sick').length;
       const permission = teacherAtt.filter(a => a.status === 'permission').length;
       const alpha = teacherAtt.filter(a => a.status === 'alpha').length;

       const lateCount = (openRequests || []).filter(r => 
           r.teacherId === t.id && 
           r.status === 'approved' && 
           new Date(r.date) >= startDate && 
           new Date(r.date) <= endDate
       ).length;

       return {
            name: t.name,
            phone: t.phoneNumber || '-',
            present, sick, permission, alpha, lateCount,
            gender: t.gender
       };
    });

    const getTeacherGender = (row: any): 'L' | 'P' => {
      if (row.gender) return row.gender;
      const lowerName = row.name.toLowerCase();
      if (
        lowerName.includes('ustadzah') || 
        lowerName.includes('ustz') || 
        lowerName.includes('usth') || 
        lowerName.includes('ibu') || 
        lowerName.includes('hj') ||
        lowerName.includes('hjh') ||
        lowerName.includes('perempuan')
      ) {
        return 'P';
      }
      return 'L';
    };

    let filteredData = data;
    if (filterTeacherGender) {
       filteredData = filteredData.filter(row => getTeacherGender(row) === filterTeacherGender);
    }

    const startNum = parseInt(filterStartNo) || 1;
    const endNum = parseInt(filterEndNo) || filteredData.length;
    const slicedData = filteredData.slice(startNum - 1, endNum);

    const allLateDetails = (openRequests || [])
      .filter(r => 
         r.status === 'approved' && 
         new Date(r.date) >= startDate && 
         new Date(r.date) <= endDate
      )
      .map(r => {
         const teacher = (users || []).find(u => u.id === r.teacherId);
         return {
             ...r,
             teacherName: teacher?.name || 'Guru'
         };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const visibleTeacherNames = new Set(slicedData.map(row => row.name));
    const filteredLateDetails = allLateDetails.filter(d => visibleTeacherNames.has(d.teacherName));

    return (
      <div className="teacher-attendance-recap bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden print:shadow-none print:border-none print:rounded-none">
        <div className={`${isExporting ? 'block' : 'hidden print:block'} w-full mb-6`}>
          <div className="border-b-4 border-double border-gray-800 pb-4 mb-6 flex items-center gap-6">
             <img src={LOGO_URL} alt="Logo" className="w-16 h-16 object-contain" />
             <div className="flex-1 text-center">
                <h1 className="text-2xl font-bold uppercase tracking-widest text-emerald-900">Ponpes Darul Abror IBS</h1>
                <p className="text-xs font-semibold tracking-wide mt-0.5">Lajnah Tahfidz Al-Qur'an</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151</p>
             </div>
             <div className="w-16"></div> 
          </div>
          <div className="text-center">
              <h2 className="text-base font-bold uppercase underline decoration-2 underline-offset-4">
                Laporan Kehadiran & Rekapitulasi Guru Halaqah
              </h2>
              <p className="text-xs font-medium mt-1">{periodLabel}</p>
          </div>
        </div>

         <div className="p-0 print:p-4">
             <table className="w-full text-left border-collapse border border-gray-300">
                 <thead>
                    <tr className="bg-gray-100 text-gray-700 text-sm print:bg-gray-200 print:text-black">
                       <th className="p-3 border border-gray-300 text-center w-12">No</th>
                       <th className="p-3 border border-gray-300">Nama Guru</th>
                       {!isExporting && <th className="p-3 border border-gray-300 print:hidden">Kontak</th>}
                       <th className="p-3 border border-gray-300 text-center bg-green-50">Hadir</th>
                       <th className="p-3 border border-gray-300 text-center bg-yellow-50">Sakit</th>
                       <th className="p-3 border border-gray-300 text-center bg-blue-50">Izin</th>
                       <th className="p-3 border border-gray-300 text-center bg-red-50">Alpha</th>
                       <th className="p-3 border border-gray-300 text-center bg-amber-50">Terlambat</th>
                       <th className="p-3 border border-gray-300 text-center font-bold text-indigo-700">Persentase</th>
                    </tr>
                 </thead>
                 <tbody className="text-sm">
                    {slicedData.length === 0 ? (
                       <tr><td colSpan={isExporting ? 8 : 9} className="p-8 text-center text-gray-400">Tidak ada data guru.</td></tr>
                    ) : (
                       slicedData.map((row, idx) => {
                          const totalDays = row.present + row.sick + row.permission + row.alpha;
                          const attendancePercent = Math.min(Math.round((row.present / maxAttendance) * 100), 100);
                          return (
                             <tr key={idx} className="print:text-black">
                                <td className="p-3 border border-gray-300 text-center">{idx + 1}</td>
                                <td className="p-3 border border-gray-300 font-medium">{row.name}</td>
                                {!isExporting && <td className="p-3 border border-gray-300 text-xs print:hidden">{row.phone}</td>}
                                <td className="p-3 border border-gray-300 text-center font-bold text-green-700 bg-green-50 print:bg-transparent print:text-black">{row.present}</td>
                                <td className="p-3 border border-gray-300 text-center text-yellow-700 bg-yellow-50 print:bg-transparent print:text-black">{row.sick}</td>
                                <td className="p-3 border border-gray-300 text-center text-blue-700 bg-blue-50 print:bg-transparent print:text-black">{row.permission}</td>
                                <td className="p-3 border border-gray-300 text-center text-red-700 bg-red-50 print:bg-transparent print:text-black">{row.alpha}</td>
                                <td className="p-3 border border-gray-300 text-center text-amber-700 bg-amber-50 font-bold print:bg-transparent print:text-black">{row.lateCount}x</td>
                                <td className="p-3 border border-gray-300 text-center font-bold text-indigo-700 bg-indigo-50/30">
                                   {totalDays > 0 ? `${attendancePercent}%` : '-'}
                                </td>
                             </tr>
                          );
                       })
                    )}
                 </tbody>
              </table>

              <div className="mt-3 text-[11px] text-gray-500 italic print:text-gray-700">
                * Catatan: Persentase kehadiran dihitung berdasarkan target kehadiran maksimal ({maxAttendance} kali hadir per {periodLabelSmall}). Kehadiran di atas target dihitung 100%.
              </div>

              {filteredLateDetails.length > 0 && !isExporting && (
                <div className="mt-8 print:mt-12 border-t pt-6 print:hidden">
                  <h3 className="font-bold text-gray-800 text-sm mb-3 flex items-center gap-1.5">
                    <AlertTriangle className="text-amber-500" size={16} />
                    Detail Alasan Keterlambatan Mengabsen Guru
                  </h3>
                  <table className="w-full text-left border-collapse border border-gray-300">
                    <thead>
                      <tr className="bg-gray-50 text-gray-700 text-xs print:bg-gray-200 print:text-black">
                        <th className="p-2.5 border border-gray-300 w-10 text-center">No</th>
                        <th className="p-2.5 border border-gray-300 w-36">Nama Guru</th>
                        <th className="p-2.5 border border-gray-300 w-24 text-center">Tanggal</th>
                        <th className="p-2.5 border border-gray-300 w-16 text-center">Sesi</th>
                        <th className="p-2.5 border border-gray-300 w-28 text-center">Tipe Absen</th>
                        <th className="p-2.5 border border-gray-300">Keterangan / Alasan Terlambat</th>
                        {user.role === 'admin' && (
                          <th className="p-2.5 border border-gray-300 w-16 text-center print:hidden">Aksi</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="text-xs">
                      {filteredLateDetails.map((item, idx) => (
                        <tr key={item.id || idx} className="print:text-black">
                          <td className="p-2.5 border border-gray-300 text-center">{idx + 1}</td>
                          <td className="p-2.5 border border-gray-300 font-semibold">{item.teacherName}</td>
                          <td className="p-2.5 border border-gray-300 text-center">{item.date}</td>
                          <td className="p-2.5 border border-gray-300 text-center capitalize">{item.session}</td>
                          <td className="p-2.5 border border-gray-300 text-center">{item.type === 'student' ? 'Absen Santri' : 'Absen Diri'}</td>
                          <td className="p-2.5 border border-gray-300 italic text-gray-600 print:text-black">"{item.lateReason}"</td>
                          {user.role === 'admin' && (
                            <td className="p-2.5 border border-gray-300 text-center print:hidden">
                              <button
                                type="button"
                                onClick={() => onDeleteOpenRequest && onDeleteOpenRequest(item.id)}
                                className="text-rose-600 hover:text-rose-800 transition-colors p-1"
                                title="Hapus Permohonan"
                              >
                                <Trash2 size={14} className="inline" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

             <div className={`signature-section ${isExporting ? 'flex' : 'hidden print:flex'} justify-end mt-16 px-10`}>
                <div className="text-center w-64">
                    <p className="text-sm text-gray-600 mb-12">Garut, {new Date().toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</p>
                    <p className="font-bold text-gray-800 text-sm">Kabag Tahfiz Al Qur'an</p>
                    <p className="text-xs text-gray-500 font-semibold mt-0.5">Ma'had Darul Abror IBS</p>
                </div>
             </div>
          </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* CSS Khusus untuk Merapihkan Tampilan Print / PDF */}
      <style>{`
        @media screen {
          .printable-area.exporting {
            width: 210mm !important;
            max-width: 210mm !important;
            min-height: 0 !important;
            background: white !important;
            margin: 0 auto !important;
            padding: 0 !important;
            box-shadow: none !important;
          }
          .printable-area.exporting .parent-report-card {
            width: 210mm !important;
            max-width: 210mm !important;
            min-height: 275mm !important;
            height: auto !important;
            padding: 8mm 10mm !important;
            box-shadow: none !important;
            border: none !important;
            background: white !important;
            box-sizing: border-box !important;
          }
          .printable-area.exporting .teacher-recap-table,
          .printable-area.exporting .teacher-attendance-recap {
            width: 210mm !important;
            max-width: 210mm !important;
            padding: 15mm !important;
            box-shadow: none !important;
            border: none !important;
            background: white !important;
            box-sizing: border-box !important;
          }
          #bulk-pdf-container {
            width: 210mm !important;
            max-width: 210mm !important;
            background: white !important;
          }
          #bulk-pdf-container .parent-report-card {
            width: 210mm !important;
            max-width: 210mm !important;
            min-height: 275mm !important;
            height: auto !important;
            padding: 8mm 10mm !important;
            box-shadow: none !important;
            border: none !important;
            background: white !important;
            box-sizing: border-box !important;
          }
          
          /* Kompresi spasi saat mengekspor ke PDF */
          .printable-area.exporting .parent-report-card .border-b-2 {
            margin-bottom: 6px !important;
            padding-bottom: 4px !important;
          }
          .printable-area.exporting .parent-report-card .text-center {
            margin-bottom: 6px !important;
          }
          .printable-area.exporting .parent-report-card .grid {
            margin-bottom: 6px !important;
            gap: 6px !important;
          }
          .printable-area.exporting .parent-report-card div[class*="bg-emerald-50"] {
            margin-bottom: 6px !important;
            padding: 6px 10px !important;
          }
          .printable-area.exporting .parent-report-card .h-36 {
            height: 90px !important;
            margin-bottom: 0 !important;
          }
          .printable-area.exporting .parent-report-card .bg-white.p-3 {
            margin-bottom: 6px !important;
            padding: 4px !important;
          }
          .printable-area.exporting .parent-report-card .mb-4.flex-1 {
            margin-bottom: 4px !important;
          }
          .printable-area.exporting .parent-report-card table th, 
          .printable-area.exporting .parent-report-card table td {
            padding: 3px 5px !important;
            font-size: 10px !important;
          }
          .printable-area.exporting .parent-report-card .flex.justify-between.mt-auto {
            margin-top: 4px !important;
            padding-top: 4px !important;
          }
          .printable-area.exporting .parent-report-card .mb-12,
          .printable-area.exporting .parent-report-card .mb-20 {
            margin-bottom: 8mm !important;
          }
        }
        @media print {
          /* Sembunyikan seluruh UI luar secara total agar tidak memakan ruang layout */
          aside, nav, header, footer, button, select, input, 
          .print-hidden, .print\\:hidden,
          .bg-white.p-4.md\\:p-6.rounded-xl.print\\:hidden {
            display: none !important;
          }
          
          /* Bersihkan layout pembungkus - JANGAN sertakan .flex agar layout horizontal tidak rusak */
          html, body, #root, [class*="h-screen"], [class*="overflow-y-auto"] {
            height: auto !important;
            overflow: visible !important;
            display: block !important;
            background: white !important;
          }
          
          /* Halaman utama cetak */
          .printable-area {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            background: white !important;
            color: black !important;
          }
          
          /* Pastikan card laporan memenuhi halaman dan dipadatkan */
          .parent-report-card {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 6mm 8mm !important;
            box-shadow: none !important;
            border: none !important;
            background: white !important;
            min-height: 265mm !important;
            height: auto !important;
            box-sizing: border-box !important;
          }
          
          /* Kompresi spasi cetak */
          .parent-report-card .border-b-2 {
            margin-bottom: 6px !important;
            padding-bottom: 4px !important;
          }
          .parent-report-card .text-center {
            margin-bottom: 6px !important;
          }
          .parent-report-card .grid {
            margin-bottom: 6px !important;
            gap: 6px !important;
          }
          .parent-report-card div[class*="bg-emerald-50"] {
            margin-bottom: 6px !important;
            padding: 6px 10px !important;
          }
          .parent-report-card .h-36 {
            height: 90px !important;
            margin-bottom: 0 !important;
          }
          .parent-report-card .bg-white.p-3 {
            margin-bottom: 6px !important;
            padding: 4px !important;
          }
          .parent-report-card .mb-4.flex-1 {
            margin-bottom: 4px !important;
          }
          .parent-report-card .flex.justify-between.mt-auto {
            margin-top: 4px !important;
            padding-top: 4px !important;
          }
          .parent-report-card .mb-12,
          .parent-report-card .mb-20 {
            margin-bottom: 8mm !important;
          }

          .teacher-recap-table, .teacher-attendance-recap {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
            background: white !important;
            min-height: 0 !important;
          }

          /* Aturan halaman A4 */
          @page {
            size: A4 portrait;
            margin: 1.0cm 1.2cm 1.0cm 1.2cm;
          }
          
          /* Hapus margin atas/bawah browser default */
          body {
            margin: 0 !important;
          }

          /* Kerapihan tabel */
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            page-break-inside: auto;
            margin-top: 12px;
          }
          tr {
            page-break-inside: avoid !important;
            page-break-after: auto;
          }
          thead {
            display: table-header-group !important;
          }
          th, td {
            padding: 4px 6px !important;
            border: 1px solid #4b5563 !important;
            color: black !important;
            font-size: 10px !important;
          }
          th {
            background-color: #f3f4f6 !important;
            font-weight: bold !important;
            text-align: center !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          /* Menghapus shadow & border-radius saat cetak */
          .shadow-sm, .shadow-lg, .shadow {
            box-shadow: none !important;
          }
          .rounded-xl, .rounded-lg, .rounded-2xl {
            border-radius: 0 !important;
          }
          /* Sembunyikan tombol tab laporan santri saat cetak */
          .flex.bg-gray-100.p-1.rounded-xl {
            display: none !important;
          }
          /* Menghindari tanda tangan terbelah halaman */
          .signature-section {
            page-break-inside: avoid !important;
          }
        }
      `}</style>

      <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 print:hidden flex flex-col justify-between gap-4">
         <div className="flex flex-col md:flex-row justify-between items-center gap-4">
             <div className="flex-1">
                <h2 className="text-lg font-bold text-gray-800">Laporan & Rekapitulasi</h2>
                <p className="text-sm text-gray-500">Unduh atau cetak laporan berkala</p>
             </div>
             <div className="flex flex-wrap gap-2">
                 {reportType === 'student' && (user.role === 'teacher' || user.role === 'admin') && myStudents.length > 0 && (
                    <button 
                       onClick={handleDownloadBulkPDF}
                       disabled={isBulkExporting || isExporting}
                       className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-5 py-2 rounded-lg transition-colors shadow font-medium text-sm disabled:opacity-50"
                    >
                       <Download size={16} />
                       {isBulkExporting ? `Membuat PDF (${bulkExportProgress}/${myStudents.length})...` : 'Unduh PDF Semua Santri'}
                    </button>
                 )}
                 <button 
                    onClick={handleDownloadPDF}
                    disabled={isExporting || isBulkExporting}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg transition-colors shadow font-medium text-sm disabled:opacity-50"
                 >
                    <Download size={16} />
                    {isExporting ? 'Membuat PDF...' : 'Unduh PDF'}
                 </button>
                 <button 
                    onClick={handlePrint}
                    disabled={isExporting || isBulkExporting}
                    className="flex items-center gap-2 bg-gray-800 text-white px-5 py-2 rounded-lg hover:bg-black transition-colors shadow font-medium text-sm disabled:opacity-50"
                 >
                    <Printer size={16} />
                    Cetak / Print
                 </button>
             </div>
         </div>

         {/* Filters Row */}
         <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 pt-4 border-t">
             {/* Report Type Toggle (ADMIN ONLY) */}
             {user.role === 'admin' && (
                <div className="flex flex-col gap-1">
                   <label className="text-xs font-bold text-gray-500">Jenis Laporan</label>
                   <div className="flex bg-gray-100 p-1 rounded-lg border h-9">
                        <button
                            onClick={() => setReportType('student')}
                            className={`flex-1 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1 ${reportType === 'student' ? 'bg-white shadow text-primary' : 'text-gray-500'}`}
                        >
                            <Users size={12}/> Santri
                        </button>
                        <button
                            onClick={() => setReportType('teacher')}
                            className={`flex-1 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1 ${reportType === 'teacher' ? 'bg-white shadow text-primary' : 'text-gray-500'}`}
                        >
                            <UserCheck size={12}/> Guru
                        </button>
                   </div>
                </div>
             )}

             {/* Period Toggle */}
             <div className="flex flex-col gap-1">
                 <label className="text-xs font-bold text-gray-500">Periode</label>
                 <select
                     value={period}
                     onChange={(e) => setPeriod(e.target.value as Period)}
                     className="w-full px-3 py-2 border rounded-lg text-sm bg-white h-9 focus:ring-2 focus:ring-primary outline-none"
                 >
                     <option value="weekly">Pekanan</option>
                     <option value="monthly">Bulanan</option>
                     <option value="semester">Semesteran</option>
                     <option value="yearly">Tahunan</option>
                 </select>
             </div>

             {/* Date Picker */}
             <div className="flex flex-col gap-1">
                 <label className="text-xs font-bold text-gray-500">Pilih Waktu</label>
                 {period === 'weekly' && (
                   <input 
                     type="week" 
                     value={selectedWeek}
                     onChange={(e) => setSelectedWeek(e.target.value)}
                     className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none h-9"
                   />
                 )}
                 {period === 'monthly' && (
                   <input 
                     type="month"
                     value={selectedMonth}
                     onChange={(e) => setSelectedMonth(e.target.value)}
                     className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none h-9"
                   />
                 )}
                 {period === 'semester' && (
                   <div className="flex gap-2">
                     <select
                       value={selectedSemesterType}
                       onChange={(e) => setSelectedSemesterType(e.target.value as 'ganjil' | 'genap')}
                       className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white h-9 focus:ring-2 focus:ring-primary outline-none"
                     >
                       <option value="ganjil">Ganjil (Jul-Des)</option>
                       <option value="genap">Genap (Jan-Jun)</option>
                     </select>
                     <select
                       value={selectedSemesterYear}
                       onChange={(e) => setSelectedSemesterYear(Number(e.target.value))}
                       className="w-24 px-3 py-2 border rounded-lg text-sm bg-white h-9 focus:ring-2 focus:ring-primary outline-none"
                     >
                       {Array.from({ length: 7 }, (_, i) => today.getFullYear() - 4 + i).map(y => (
                         <option key={y} value={y}>{y}</option>
                       ))}
                     </select>
                   </div>
                 )}
                 {period === 'yearly' && (
                   <select
                     value={selectedYear}
                     onChange={(e) => setSelectedYear(Number(e.target.value))}
                     className="w-full px-3 py-2 border rounded-lg text-sm bg-white h-9 focus:ring-2 focus:ring-primary outline-none"
                   >
                     {Array.from({ length: 7 }, (_, i) => today.getFullYear() - 4 + i).map(y => (
                       <option key={y} value={y}>{y}</option>
                     ))}
                   </select>
                 )}
             </div>

             {/* Student/Class Filters */}
             {reportType === 'student' && user.role !== 'parent' && (
                 <>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500">Filter Kelas</label>
                        <select 
                          value={filterClass}
                          onChange={(e) => {
                            setFilterClass(e.target.value);
                            setFilterStudentId('');
                          }}
                          className="w-full px-3 py-2 border rounded-lg text-sm bg-white h-9 focus:ring-2 focus:ring-primary outline-none"
                        >
                          <option value="">Semua Kelas</option>
                          {distinctClasses.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500">Filter Halaqah</label>
                        <select 
                          value={filterHalaqah}
                          onChange={(e) => {
                            setFilterHalaqah(e.target.value);
                            setFilterStudentId(''); // Reset selected student when changing halaqah
                          }}
                          className="w-full px-3 py-2 border rounded-lg text-sm bg-white h-9 focus:ring-2 focus:ring-primary outline-none"
                        >
                          <option value="">Semua Halaqah</option>
                          {distinctHalaqahs.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500">Pilih Santri (Opsional)</label>
                        <select 
                          value={filterStudentId}
                          onChange={(e) => setFilterStudentId(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm bg-white h-9 focus:ring-2 focus:ring-primary outline-none"
                        >
                          <option value="">Semua Santri (Rekap)</option>
                          {students
                            .filter(s => {
                              if (user.role === 'teacher' && s.teacherId !== user.id) return false;
                              if (filterClass && s.class !== filterClass) return false;
                              if (filterHalaqah && s.halaqah !== filterHalaqah) return false;
                              return true;
                            })
                            .map(s => <option key={s.id} value={s.id}>{s.name} ({s.class})</option>)
                          }
                        </select>
                    </div>
                 </>
             )}

              {/* Teacher Filters */}
              {reportType === 'teacher' && (
                  <>
                     <div className="flex flex-col gap-1">
                         <label className="text-xs font-bold text-gray-500">Gender Guru</label>
                         <select 
                           value={filterTeacherGender}
                           onChange={(e) => setFilterTeacherGender(e.target.value as '' | 'L' | 'P')}
                           className="w-full px-3 py-2 border rounded-lg text-sm bg-white h-9 focus:ring-2 focus:ring-primary outline-none animate-fade-in"
                         >
                           <option value="">Semua Gender</option>
                           <option value="L">Laki-laki (Ust.)</option>
                           <option value="P">Perempuan (Ustz.)</option>
                         </select>
                     </div>

                     <div className="flex flex-col gap-1">
                         <label className="text-xs font-bold text-gray-500">No. Urut Mulai</label>
                         <input 
                           type="number"
                           min="1"
                           placeholder="1"
                           value={filterStartNo}
                           onChange={(e) => setFilterStartNo(e.target.value)}
                           className="w-full px-3 py-2 border rounded-lg text-sm bg-white h-9 focus:ring-2 focus:ring-primary outline-none animate-fade-in"
                         />
                     </div>

                     <div className="flex flex-col gap-1">
                         <label className="text-xs font-bold text-gray-500">No. Urut Selesai</label>
                         <input 
                           type="number"
                           min="1"
                           placeholder="Semua"
                           value={filterEndNo}
                           onChange={(e) => setFilterEndNo(e.target.value)}
                           className="w-full px-3 py-2 border rounded-lg text-sm bg-white h-9 focus:ring-2 focus:ring-primary outline-none animate-fade-in"
                         />
                     </div>
                  </>
              )}
         </div>
      </div>

      {reportType === 'student' && user.role !== 'parent' && !filterStudentId && (
        <div className="flex bg-gray-100 p-1 rounded-xl max-w-[280px] border print:hidden">
          <button
            onClick={() => setStudentTab('hafalan')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              studentTab === 'hafalan' ? 'bg-white shadow text-primary' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileText size={14} /> Capaian Hafalan
          </button>
          <button
            onClick={() => setStudentTab('absen')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              studentTab === 'absen' ? 'bg-white shadow text-primary' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Calendar size={14} /> Laporan Absen
          </button>
        </div>
      )}

      <div className={`min-h-screen print:h-auto printable-area ${isExporting ? 'exporting' : ''}`}>
        {reportType === 'teacher' && user.role === 'admin' ? (
            <TeacherAttendanceRecap />
        ) : (
            (user.role === 'parent' || filterStudentId) ? <ParentReportCard /> : <TeacherRecapTable />
        )}
      </div>

      {/* Off-screen container for Bulk PDF Export */}
      {isBulkExporting && bulkStudentId && (
        <div 
          id="bulk-pdf-container" 
          style={{ position: 'absolute', left: '-9999px', top: 0 }}
        >
          <ParentReportCard 
            studentOverride={students.find(s => s.id === bulkStudentId)} 
          />
        </div>
      )}
    </div>
  );
};

export default ReportsView;
