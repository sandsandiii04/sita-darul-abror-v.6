
import React, { useState } from 'react';
import { User, Student, TahfidzRecord, Grade, Attendance, AttendanceOpenRequest } from '../types';
import { Printer, Calendar, FileText, ChevronLeft, ChevronRight, Filter, Users, UserCheck, AlertTriangle } from 'lucide-react';
import { LOGO_URL } from '../constants';

interface ReportsViewProps {
  user: User;
  students: Student[];
  records: TahfidzRecord[];
  users?: User[];
  attendance: Attendance[];
  openRequests?: AttendanceOpenRequest[];
}

type Period = 'weekly' | 'monthly' | 'semester' | 'yearly';
type ReportType = 'student' | 'teacher';

const ReportsView: React.FC<ReportsViewProps> = ({ user, students, records, users, attendance, openRequests = [] }) => {
  const [period, setPeriod] = useState<Period>('monthly');
  const [reportType, setReportType] = useState<ReportType>('student');
  const [studentTab, setStudentTab] = useState<'hafalan' | 'absen'>('hafalan');
  
  // Filters
  const [filterClass, setFilterClass] = useState('');
  const [filterHalaqah, setFilterHalaqah] = useState('');
  const [filterStudentId, setFilterStudentId] = useState('');
  
  // Default to current month
  const today = new Date();
  const defaultMonth = today.toISOString().slice(0, 7); // YYYY-MM
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

  // --- SUB COMPONENTS ---

  const ParentReportCard = () => {
    const student = myStudents[0];
    if (!student) return <div className="p-8 text-center text-gray-500">Data santri tidak ditemukan atau filter tidak sesuai.</div>;

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
    const predikat = getPredikat(avgScore);

    return (
      <div className="bg-white text-gray-800 p-8 md:p-12 max-w-4xl mx-auto shadow-lg print:shadow-none print:max-w-none print:w-full print:p-0 min-h-[297mm] relative flex flex-col">
        <div className="border-b-4 border-double border-gray-800 pb-4 mb-6 flex items-center gap-6">
           <img src={LOGO_URL} alt="Logo" className="w-20 h-20 object-contain" />
           <div className="flex-1 text-center">
              <h1 className="text-3xl font-bold uppercase tracking-widest text-emerald-900">Ponpes Darul Abror IBS</h1>
              <p className="text-sm font-semibold tracking-wide mt-1">Lajnah Tahfidz Al-Qur'an</p>
              <p className="text-xs text-gray-500 mt-1">Jl. Raya Samarang No.216, Mekarwangi, Kec. Tarogong Kaler, Kabupaten Garut, Jawa Barat 44151</p>
           </div>
           <div className="w-20"></div> 
        </div>

        <div className="text-center mb-8">
           <h2 className="text-xl font-bold uppercase underline decoration-2 underline-offset-4">Laporan Capaian Tahfidz</h2>
           <p className="text-gray-600 mt-2 font-medium">{periodLabel}</p>
        </div>

        <div className="grid grid-cols-2 gap-x-12 gap-y-2 mb-8 text-sm">
           <div className="flex">
             <span className="w-32 font-bold text-gray-600">Nama Santri</span>
             <span className="font-semibold">: {student.name}</span>
           </div>
           <div className="flex">
             <span className="w-32 font-bold text-gray-600">Kelas</span>
             <span className="font-semibold">: {student.class}</span>
           </div>
           <div className="flex">
             <span className="w-32 font-bold text-gray-600">Nomor Induk</span>
             <span className="font-semibold">: {student.nis}</span>
           </div>
           <div className="flex">
             <span className="w-32 font-bold text-gray-600">Halaqah</span>
             <span className="font-semibold">: {student.halaqah}</span>
           </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-4">
           <div className="border border-emerald-100 bg-emerald-50 p-3 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-2xl font-bold text-emerald-700 print:text-black">{sabaqRecs.length}</div>
              <div className="text-xs font-bold text-emerald-900 uppercase mt-1">Sabaq</div>
           </div>
           <div className="border border-blue-100 bg-blue-50 p-3 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-2xl font-bold text-blue-700 print:text-black">{sabqiRecs.length}</div>
              <div className="text-xs font-bold text-blue-900 uppercase mt-1">Sabqi</div>
           </div>
           <div className="border border-orange-100 bg-orange-50 p-3 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-2xl font-bold text-orange-700 print:text-black">{manzilRecs.length}</div>
              <div className="text-xs font-bold text-orange-900 uppercase mt-1">Manzil</div>
           </div>
           <div className="border border-purple-100 bg-purple-50 p-3 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-2xl font-bold text-purple-700 print:text-black">{predikat}</div>
              <div className="text-xs font-bold text-purple-900 uppercase mt-1">Predikat</div>
           </div>
        </div>

        {/* Attendance Stats Grid */}
        <div className="grid grid-cols-4 gap-4 mb-6">
           <div className="border border-green-100 bg-green-50 py-3 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-2xl font-bold text-green-700 print:text-black">{present}</div>
              <div className="text-[10px] font-bold text-green-900 uppercase mt-1">Hadir</div>
           </div>
           <div className="border border-yellow-100 bg-yellow-50 py-3 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-2xl font-bold text-yellow-700 print:text-black">{sick}</div>
              <div className="text-[10px] font-bold text-yellow-900 uppercase mt-1">Sakit</div>
           </div>
           <div className="border border-indigo-100 bg-indigo-50 py-3 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-2xl font-bold text-indigo-700 print:text-black">{permission}</div>
              <div className="text-[10px] font-bold text-indigo-900 uppercase mt-1">Izin</div>
           </div>
           <div className="border border-red-100 bg-red-50 py-3 rounded-lg text-center print:border-gray-300 print:bg-white">
              <div className="text-2xl font-bold text-red-700 print:text-black">{alpha}</div>
              <div className="text-[10px] font-bold text-red-900 uppercase mt-1">Alpha</div>
           </div>
        </div>

        <div className="mb-6 flex-1">
           <h3 className="font-bold text-gray-800 mb-3 border-b pb-1">
              Riwayat Setoran {period === 'weekly' || period === 'monthly' ? '(Terbaru)' : '(Lengkap)'}
           </h3>
           <table className="w-full text-sm border-collapse border border-gray-300">
             <thead>
               <tr className="bg-gray-100 print:bg-gray-200">
                 <th className="border border-gray-300 p-2 text-center w-10">No</th>
                 <th className="border border-gray-300 p-2 w-24">Tanggal</th>
                 <th className="border border-gray-300 p-2 w-20 text-center">Jenis</th>
                 <th className="border border-gray-300 p-2">Hafalan</th>
                 <th className="border border-gray-300 p-2 text-center w-24">Predikat</th>
               </tr>
             </thead>
             <tbody>
               {studentRecords.length === 0 ? (
                 <tr><td colSpan={5} className="p-6 text-center text-gray-400">Tidak ada setoran pada periode ini.</td></tr>
               ) : (
                 (() => {
                   const displayRecords = (period === 'weekly' || period === 'monthly') ? studentRecords.slice(-15) : studentRecords;
                   return displayRecords.map((rec, idx) => (
                     <tr key={rec.id}>
                       <td className="border border-gray-300 p-2 text-center">{idx + 1}</td>
                       <td className="border border-gray-300 p-2">{new Date(rec.date).toLocaleDateString('id-ID', {day: '2-digit', month: '2-digit'})}</td>
                       <td className="border border-gray-300 p-2 text-center capitalize">{rec.type}</td>
                       <td className="border border-gray-300 p-2">
                          {rec.ayahStart > 0 ? (
                            <>
                              <span className="font-semibold">{rec.surah}</span>: {rec.ayahStart}-{rec.ayahEnd}
                              {rec.notes && <span className="text-xs text-gray-500 font-medium ml-2">({rec.notes})</span>}
                            </>
                          ) : (
                            <>
                              <span className="font-semibold">{rec.surah}</span>
                              {rec.notes && <span className="text-xs text-gray-500 font-medium ml-2">({rec.notes})</span>}
                            </>
                          )}
                        </td>
                       <td className="border border-gray-300 p-2 text-center">
                          {(() => {
                            const score = parseFloat(rec.grade);
                            if (!isNaN(score)) {
                              let arabic = 'راسب';
                              if (score >= 90) arabic = 'ممتاز';
                              else if (score >= 80) arabic = 'جيد جداً';
                              else if (score >= 70) arabic = 'جيد';
                              else if (score >= 60) arabic = 'مقبول';
                              
                              return (
                                <span className={`px-2 py-0.5 rounded text-xs font-bold border print:bg-transparent print:text-black print:border-none ${
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
                              <span className={`px-2 py-0.5 rounded text-xs font-medium border print:bg-transparent print:text-black print:border-none ${
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

        <div className="flex justify-end mt-auto pt-8 mb-10">
           <div className="text-center w-48">
              <p className="text-sm text-gray-600 mb-16">Garut, {new Date().toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</p>
              <p className="font-bold underline text-gray-800">{teacherName}</p>
              <p className="text-xs text-gray-500">Guru Halaqah</p>
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
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden print:shadow-none print:border-none print:rounded-none">
        <div className="hidden print:block w-full mb-6">
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

            <div className="hidden print:flex justify-end mt-16 px-10">
               <div className="text-center">
                   <p className="mb-20">Garut, {new Date().toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</p>
                   <p className="font-bold underline">{user.name}</p>
               </div>
            </div>
         </div>
      </div>
    );
  };

  const TeacherAttendanceRecap = () => {
    const teachers = users?.filter(u => u.role === 'teacher') || [];
    
    const data = teachers.map(t => {
       const teacherAtt = attendance.filter(a => {
            const aDate = new Date(a.date);
            return a.userId === t.id && a.type === 'teacher' && aDate >= startDate && aDate <= endDate;
       });

       const present = teacherAtt.filter(a => a.status === 'present').length;
       const sick = teacherAtt.filter(a => a.status === 'sick').length;
       const permission = teacherAtt.filter(a => a.status === 'permission').length;
       const alpha = teacherAtt.filter(a => a.status === 'alpha').length;

       // Hitung jumlah keterlambatan yang disetujui
       const lateCount = (openRequests || []).filter(r => 
           r.teacherId === t.id && 
           r.status === 'approved' && 
           new Date(r.date) >= startDate && 
           new Date(r.date) <= endDate
       ).length;

       return {
            name: t.name,
            phone: t.phoneNumber || '-',
            present, sick, permission, alpha, lateCount
       };
    });

    // Kumpulkan seluruh detail alasan keterlambatan untuk guru-guru pada periode terpilih
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

    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden print:shadow-none print:border-none print:rounded-none">
        <div className="hidden print:block w-full mb-6">
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
                       <th className="p-3 border border-gray-300">Kontak</th>
                       <th className="p-3 border border-gray-300 text-center bg-green-50">Hadir</th>
                       <th className="p-3 border border-gray-300 text-center bg-yellow-50">Sakit</th>
                       <th className="p-3 border border-gray-300 text-center bg-blue-50">Izin</th>
                       <th className="p-3 border border-gray-300 text-center bg-red-50">Alpha</th>
                       <th className="p-3 border border-gray-300 text-center bg-amber-50">Terlambat</th>
                       <th className="p-3 border border-gray-300 text-center">Ket</th>
                    </tr>
                 </thead>
                 <tbody className="text-sm">
                    {data.length === 0 ? (
                       <tr><td colSpan={9} className="p-8 text-center text-gray-400">Tidak ada data guru.</td></tr>
                    ) : (
                       data.map((row, idx) => (
                          <tr key={idx} className="print:text-black">
                             <td className="p-3 border border-gray-300 text-center">{idx + 1}</td>
                             <td className="p-3 border border-gray-300 font-medium">{row.name}</td>
                             <td className="p-3 border border-gray-300 text-xs">{row.phone}</td>
                             <td className="p-3 border border-gray-300 text-center font-bold text-green-700 bg-green-50 print:bg-transparent print:text-black">{row.present}</td>
                             <td className="p-3 border border-gray-300 text-center text-yellow-700 bg-yellow-50 print:bg-transparent print:text-black">{row.sick}</td>
                             <td className="p-3 border border-gray-300 text-center text-blue-700 bg-blue-50 print:bg-transparent print:text-black">{row.permission}</td>
                             <td className="p-3 border border-gray-300 text-center text-red-700 bg-red-50 print:bg-transparent print:text-black">{row.alpha}</td>
                             <td className="p-3 border border-gray-300 text-center text-amber-700 bg-amber-50 font-bold print:bg-transparent print:text-black">{row.lateCount}x</td>
                             <td className="p-3 border border-gray-300 text-center text-xs">
                                 {row.present > 0 ? `${Math.round((row.present / (row.present + row.sick + row.permission + row.alpha)) * 100)}%` : '-'}
                             </td>
                          </tr>
                       ))
                    )}
                 </tbody>
              </table>

              {/* Tabel Detail Keterangan Keterlambatan Guru */}
              {allLateDetails.length > 0 && (
                <div className="mt-8 print:mt-12 border-t pt-6">
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
                      </tr>
                    </thead>
                    <tbody className="text-xs">
                      {allLateDetails.map((item, idx) => (
                        <tr key={idx} className="print:text-black">
                          <td className="p-2.5 border border-gray-300 text-center">{idx + 1}</td>
                          <td className="p-2.5 border border-gray-300 font-semibold">{item.teacherName}</td>
                          <td className="p-2.5 border border-gray-300 text-center">{item.date}</td>
                          <td className="p-2.5 border border-gray-300 text-center capitalize">{item.session}</td>
                          <td className="p-2.5 border border-gray-300 text-center">{item.type === 'student' ? 'Absen Santri' : 'Absen Diri'}</td>
                          <td className="p-2.5 border border-gray-300 italic text-gray-600 print:text-black">"{item.lateReason}"</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="hidden print:flex justify-end mt-16 px-10">
                 <div className="text-center">
                     <p className="mb-20">Garut, {new Date().toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'})}</p>
                     <p className="font-bold underline">Kepala Pondok</p>
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
        @media print {
          /* Sembunyikan sidebar, navbar, tombol, filter, dan elemen UI lainnya */
          body * {
            visibility: hidden;
          }
          /* Hanya tampilkan area laporan */
          .printable-area, .printable-area * {
            visibility: visible;
          }
          .printable-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white !important;
            color: black !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          /* Aturan halaman A4 */
          @page {
            size: A4 portrait;
            margin: 1.5cm;
          }
          /* Merapikan tabel dan memecah halaman */
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            page-break-inside: auto;
            margin-top: 10px;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
          thead {
            display: table-header-group;
          }
          th, td {
            padding: 8px !important;
            border: 1px solid #4b5563 !important;
            color: black !important;
            font-size: 11px !important;
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
        }
      `}</style>

      <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 print:hidden flex flex-col justify-between gap-4">
         <div className="flex flex-col md:flex-row justify-between items-center gap-4">
             <div className="flex-1">
                <h2 className="text-lg font-bold text-gray-800">Laporan & Rekapitulasi</h2>
                <p className="text-sm text-gray-500">Unduh atau cetak laporan berkala</p>
             </div>
             <button 
                onClick={handlePrint}
                className="flex items-center gap-2 bg-gray-800 text-white px-6 py-2 rounded-lg hover:bg-black transition-colors shadow-lg font-medium text-sm"
             >
                <Printer size={16} />
                Cetak / PDF
             </button>
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

      <div className="min-h-screen print:h-auto printable-area">
        {reportType === 'teacher' && user.role === 'admin' ? (
            <TeacherAttendanceRecap />
        ) : (
            (user.role === 'parent' || filterStudentId) ? <ParentReportCard /> : <TeacherRecapTable />
        )}
      </div>
    </div>
  );
};

export default ReportsView;
