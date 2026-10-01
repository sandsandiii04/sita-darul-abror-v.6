import React, { useState, useMemo } from 'react';
import { User, Student, Attendance, AttendanceOpenRequest } from '../types';
import { 
  CheckCircle, XCircle, AlertCircle, Clock, Check, X, Sun, Moon, 
  Lock, QrCode, Camera, Printer, Download, Key, History, Trash2,
  Unlock, Calendar, Users, Info, ShieldCheck, Filter, ChevronRight
} from 'lucide-react';
import { ADMIN_PHONE, getLocalDateString } from '../constants';
import { QRCodeCanvas } from 'qrcode.react';
import { jsPDF } from 'jspdf';
import QRScanner from './QRScanner';

interface AttendanceProps {
  user: User;
  students: Student[];
  users: User[]; // All users to find teachers
  attendance: Attendance[];
  onMarkAttendance: (att: Attendance) => void;
  onDeleteAttendance?: (id: string) => void;
  type: 'student' | 'teacher';
  openRequests?: AttendanceOpenRequest[];
  onMarkOpenRequest?: (req: AttendanceOpenRequest) => void;
  onDeleteOpenRequest?: (id: string) => void;
  onBulkOpenAttendance?: (requests: AttendanceOpenRequest[]) => Promise<{ success: boolean; count?: number; message?: string }>;
  onBulkDeleteOpenRequests?: (ids: string[]) => Promise<{ success: boolean; count?: number; message?: string }>;
  targetDate?: string;
  targetSession?: 'pagi' | 'malam';
}

const formatWhatsAppPhone = (phone: string | undefined): string => {
  if (!phone) return '';
  let clean = phone.replace(/\D/g, '');
  if (clean.startsWith('0')) {
    clean = '62' + clean.substring(1);
  } else if (clean.startsWith('8')) {
    clean = '62' + clean;
  }
  return clean;
};

const INDO_MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

export const formatMonthYearLabel = (mStr: string) => {
  if (!mStr || !mStr.includes('-')) return mStr;
  const [y, m] = mStr.split('-');
  const idx = parseInt(m, 10) - 1;
  return `${INDO_MONTH_NAMES[idx] || m} ${y}`;
};

export const getMonthDaysCount = (mStr: string) => {
  if (!mStr || !mStr.includes('-')) return 30;
  const [y, m] = mStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

const AttendanceView: React.FC<AttendanceProps> = ({ 
  user, students, users, attendance, onMarkAttendance, onDeleteAttendance, type,
  openRequests = [], onMarkOpenRequest, onDeleteOpenRequest,
  onBulkOpenAttendance, onBulkDeleteOpenRequests,
  targetDate, targetSession
}) => {
  const adminUser = (users || []).find(u => u.role === 'admin');
  const adminPhone = adminUser?.phoneNumber ? formatWhatsAppPhone(adminUser.phoneNumber) : formatWhatsAppPhone(ADMIN_PHONE);

  const [date, setDate] = useState(targetDate || getLocalDateString());
  const [session, setSession] = useState<'pagi' | 'malam'>(targetSession || (new Date().getHours() >= 14 ? 'malam' : 'pagi'));
  const cleanSubId = (id: any) => id ? id.toString().split(' | ')[0].trim() : '';

  React.useEffect(() => {
    if (targetDate) setDate(targetDate);
  }, [targetDate]);

  React.useEffect(() => {
    if (targetSession) setSession(targetSession);
  }, [targetSession]);

  const [showAdminQR, setShowAdminQR] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [lateReason, setLateReason] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showRequestHistory, setShowRequestHistory] = useState(false);

  // State Modal Buka Absen Massal / Per Bulan (Khusus Admin)
  const [showAdminBulkOpenModal, setShowAdminBulkOpenModal] = useState(false);
  const [bulkMode, setBulkMode] = useState<'month' | 'custom'>('month');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const today = getLocalDateString();
    return today.substring(0, 7);
  });
  const [bulkStartDate, setBulkStartDate] = useState(getLocalDateString());
  const [bulkEndDate, setBulkEndDate] = useState(getLocalDateString());
  const [bulkTeacherId, setBulkTeacherId] = useState<'ALL' | string>('ALL');
  const [bulkSession, setBulkSession] = useState<'all' | 'pagi' | 'malam'>('all');
  const [bulkType, setBulkType] = useState<'student' | 'teacher'>(type);
  const [bulkReason, setBulkReason] = useState('');
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [bulkActiveTab, setBulkActiveTab] = useState<'form' | 'history'>('form');
  const [bulkNotification, setBulkNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [bulkHistoryFilterMonth, setBulkHistoryFilterMonth] = useState<string>('ALL');

  // Update bulkType jika tipe halaman absensi berubah
  React.useEffect(() => {
    setBulkType(type);
  }, [type]);

  // Fungsi pengecekan apakah guru terlambat
  const checkIsLate = (sess: 'pagi' | 'malam', targetDate: string) => {
    const todayStr = getLocalDateString();
    
    // Tanggal kemarin atau sebelumnya selalu terlambat
    if (targetDate < todayStr) return true;
    // Tanggal besok belum bisa dianggap terlambat (akan diblokir di logic lock)
    if (targetDate > todayStr) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    if (sess === 'pagi') {
      const limitMinutes = 5 * 60 + 50; // 05:50
      return currentMinutes > limitMinutes;
    } else if (sess === 'malam') {
      const limitMinutes = 18 * 60 + 50; // 18:50
      return currentMinutes > limitMinutes;
    }
    return false;
  };

  // Fungsi pengecekan batas waktu absensi
  const checkSessionLock = (sess: 'pagi' | 'malam') => {
    if (user.role === 'admin') return { locked: false, reason: '', status: 'open' };

    const todayStr = getLocalDateString();
    if (date > todayStr) {
      return { locked: true, reason: 'Belum bisa mengisi absensi untuk hari esok.', status: 'future' };
    }

    // Cari permohonan / izin buka absensi untuk guru ini pada tanggal & sesi & tipe terpilih
    // Mendukung: tanggal spesifik, bulan penuh (YYYY-MM), semua guru (ALL), semua sesi (all)
    const request = openRequests.find(r => 
      (cleanSubId(r.teacherId) === user.id || r.teacherId === 'ALL') && 
      (r.date === date || (r.date.length === 7 && date.startsWith(r.date))) && 
      (r.session === sess || (r.session as any) === 'all') && 
      r.type === type
    );

    if (request && request.status === 'approved') {
      return { locked: false, reason: '', status: 'approved', request };
    }

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // PERATURAN KHUSUS ABSENSI SANTRI
    if (type === 'student') {
      let isStudentLate = false;
      let reasonText = '';

      if (date < todayStr) {
        isStudentLate = true;
        reasonText = 'Absensi Santri terkunci karena melewati batas tanggal hari ini.';
      } else {
        const start = 4 * 60;  // 04:00 WIB
        const end = 21 * 60;   // 21:00 WIB
        if (currentMinutes > end) {
          isStudentLate = true;
          reasonText = 'Absensi Santri terkunci karena melebihi batas jam 21:00 WIB.';
        } else if (currentMinutes < start) {
          return { locked: true, reason: 'Absensi Santri belum dibuka (hanya dibuka pukul 04:00 - 21:00 WIB).', status: 'outside_hours' };
        }
      }

      if (isStudentLate) {
        if (request && request.status === 'pending') {
          return { locked: true, reason: 'Permintaan buka akses sedang menunggu persetujuan admin.', status: 'pending', request };
        } else if (request && request.status === 'rejected') {
          return { locked: true, reason: 'Permintaan buka akses ditolak oleh admin.', status: 'rejected', request };
        } else {
          return { locked: true, reason: reasonText, status: 'late' };
        }
      }

      return { locked: false, reason: '', status: 'open' };
    }

    // PERATURAN KHUSUS ABSENSI GURU (DENGAN TOLERANSI KETERLAMBATAN)
    const isLate = checkIsLate(sess, date);
    if (isLate) {
      if (request && request.status === 'pending') {
        return { locked: true, reason: 'Permintaan buka akses sedang menunggu persetujuan admin.', status: 'pending', request };
      } else if (request && request.status === 'rejected') {
        return { locked: true, reason: 'Permintaan buka akses ditolak oleh admin.', status: 'rejected', request };
      } else {
        return { locked: true, reason: 'Absensi Guru terkunci karena terlambat (melebihi batas jam pagi 05:50 / malam 18:50).', status: 'late' };
      }
    }

    // Pengecekan jam normal guru (sebelum terlambat)
    if (sess === 'pagi') {
      const start = 4 * 60 + 30; // 04:30
      const end = 12 * 60;       // 12:00
      if (currentMinutes < start || currentMinutes > end) {
        return { locked: true, reason: 'Absensi Guru Pagi hanya dibuka pukul 04:30 - 12:00 WIB.', status: 'outside_hours' };
      }
    } else if (sess === 'malam') {
      const start = 17 * 60 + 30; // 17:30
      const end = 21 * 60;        // 21:00
      if (currentMinutes < start || currentMinutes > end) {
        return { locked: true, reason: 'Absensi Guru Malam hanya dibuka pukul 17:30 - 21:00 WIB.', status: 'outside_hours' };
      }
    }

    return { locked: false, reason: '', status: 'open' };
  };

  const lockInfo = checkSessionLock(session);

  let subjectList: {id: string, name: string, subInfo?: string, phone?: string}[] = [];
  
  if (type === 'student') {
    const visibleStudents = user.role === 'teacher' 
      ? students.filter(s => s.teacherId === user.id)
      : user.role === 'parent' && user.childId
        ? students.filter(s => s.id === user.childId)
        : students; // Admin sees all

    const filteredStudents = searchQuery.trim() !== ''
      ? visibleStudents.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : visibleStudents;

    subjectList = filteredStudents.map(s => ({
      id: s.id,
      name: s.name,
      subInfo: s.class
    }));
  } else {
    if (user.role === 'teacher') {
       subjectList = [{ id: user.id, name: user.name, subInfo: 'Guru Halaqah', phone: user.phoneNumber }];
    } else if (user.role === 'admin') {
       subjectList = users.filter(u => u.role === 'teacher').map(u => ({
         id: u.id, name: u.name, subInfo: 'Guru', phone: u.phoneNumber
       }));
    }
  }

  const handleStatusClick = (subjectId: string, status: Attendance['status']): boolean => {
    if (user.role === 'parent') return false;
    if (!date) {
      alert('Mohon pilih tanggal absensi terlebih dahulu!');
      return false;
    }

    const currentLock = checkSessionLock(session);
    if (currentLock.locked && user.role !== 'admin') {
      // Allow teacher to submit sick or permission request even if locked (late)
      const isTeacherPermissionOrSick = type === 'teacher' && (status === 'sick' || status === 'permission');
      if (!isTeacherPermissionOrSick) {
        alert(currentLock.reason);
        return false;
      }
    }

    const existing = attendance.find(a => cleanSubId(a.userId) === cleanSubId(subjectId) && a.date === date && a.type === type && a.session === session);
    
    // Pembatalan: jika klik status yang sudah aktif, hapus absensi tersebut
    if (existing && existing.status === status) {
      if (onDeleteAttendance) {
        onDeleteAttendance(existing.id);
      }
      return true;
    }

    // Tanya alasan izin/sakit jika absensi diri guru
    let reasonText = '';
    if (type === 'teacher' && (status === 'sick' || status === 'permission')) {
      const promptMsg = status === 'sick' ? 'Masukkan alasan / keterangan Sakit:' : 'Masukkan alasan / keterangan Izin:';
      const userInput = prompt(promptMsg);
      if (userInput === null) return false; // User cancelled
      if (!userInput.trim()) {
        alert('Keterangan alasan wajib diisi!');
        return false;
      }
      reasonText = userInput.trim();
    }

    // Cari request yang disetujui untuk mendapatkan alasan keterlambatan
    const request = openRequests.find(r => 
      cleanSubId(r.teacherId) === user.id && 
      r.date === date && 
      r.session === session && 
      r.type === type &&
      r.status === 'approved'
    );
    const lateReasonToSave = request?.lateReason || undefined;

    // For teachers marking sick/permission, set approval to pending
    const approvalStatus = (type === 'teacher' && (status === 'sick' || status === 'permission')) ? 'pending' : undefined;
    
    // Generate ID deterministik berbasis entitas agar konsisten di semua device dan menghindari baris duplikat di database
    const cleanSubjectId = subjectId ? subjectId.toString().split(' | ')[0].trim() : '';
    const deterministicId = `att_${type}_${cleanSubjectId}_${date}_${session}`;
    const recordId = existing ? existing.id : deterministicId;

    const newRecord: Attendance = {
      id: recordId,
      userId: subjectId,
      date,
      session,
      status,
      type,
      approvalStatus: existing?.approvalStatus || approvalStatus,
      lateReason: reasonText || existing?.lateReason || lateReasonToSave
    };
    onMarkAttendance(newRecord);

    // --- WhatsApp Integration for Teacher Permissions (Magic Links) ---
    if (type === 'teacher' && (status === 'sick' || status === 'permission')) {
        const sessionLabel = session === 'pagi' ? 'Pagi' : 'Malam';
        const typeLabel = status === 'sick' ? 'Sakit' : 'Izin';
        
        // Generate Magic Links dengan ID deterministik
        const baseUrl = window.location.origin + window.location.pathname;
        const approveLink = `${baseUrl}?action=approve&id=${recordId}&name=${encodeURIComponent(user.name)}&date=${date}&session=${session}&status=${status}&reason=${encodeURIComponent(newRecord.lateReason || '')}`;
        const rejectLink = `${baseUrl}?action=reject&id=${recordId}&name=${encodeURIComponent(user.name)}&date=${date}&session=${session}&status=${status}&reason=${encodeURIComponent(newRecord.lateReason || '')}`;

        const message = `Assalamu'alaikum Admin,\n\nSaya *${user.name}* izin tidak hadir hari ini (${date}) sesi *${sessionLabel}* dikarenakan *${typeLabel}*.\n\nKeterangan: "${newRecord.lateReason}"\n\nMohon persetujuannya:\n\n✅ *SETUJUI* (Klik link ini):\n${approveLink}\n\n❌ *TOLAK* (Klik link ini):\n${rejectLink}`;
        
        // Beri jeda 300ms agar browser sempat menginisiasi antrean sinkronisasi jaringan sebelum tab dibekukan oleh WhatsApp
        setTimeout(() => {
            if (confirm("Buka WhatsApp untuk mengirim izin ke Admin?")) {
                window.open(`https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`, '_blank');
            }
        }, 300);
    }
    return true;
  };

  const handleApproval = (record: Attendance, approve: boolean, subjectPhone?: string) => {
      const updated: Attendance = {
          ...record,
          approvalStatus: approve ? 'approved' : 'rejected'
      };
      onMarkAttendance(updated);

      // --- WhatsApp Integration for Admin Approval ---
      if (subjectPhone) {
          const statusText = approve ? "DISETUJUI" : "DITOLAK";
          const sessionLabel = record.session === 'pagi' ? 'Pagi' : 'Malam';
          const message = `Assalamu'alaikum, pengajuan izin anda untuk tanggal ${record.date} sesi *${sessionLabel}* telah *${statusText}* oleh Admin.`;
          
          // Remove non-numeric characters and format for link
          const cleanPhone = formatWhatsAppPhone(subjectPhone);
          
          if (confirm(`Buka WhatsApp untuk notifikasi ke Guru (${cleanPhone})?`)) {
             window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
          }
      } else {
          alert("Nomor HP Guru tidak terdaftar, tidak bisa kirim WA otomatis.");
      }
  };

  const handleSubmitRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return alert('Mohon pilih tanggal absensi terlebih dahulu!');
    if (!lateReason.trim()) return alert('Mohon isi keterangan keterlambatan!');
    
    if (onMarkOpenRequest) {
      const existingReq = openRequests.find(r => cleanSubId(r.teacherId) === user.id && r.date === date && r.session === session && r.type === type);
      const deterministicReqId = `req_${user.id}_${date}_${session}_${type}`;

      const newReq: AttendanceOpenRequest = {
        id: existingReq ? existingReq.id : deterministicReqId,
        teacherId: user.id,
        date,
        session,
        type,
        status: 'pending',
        lateReason: lateReason.trim()
      };
      onMarkOpenRequest(newReq);
      setShowRequestModal(false);
      setLateReason('');
      
      const sessionLabel = session === 'pagi' ? 'Pagi' : 'Malam';
      const typeLabel = type === 'student' ? 'Absen Santri' : 'Absen Diri';
      
      const baseUrl = window.location.origin + window.location.pathname;
      const approveLink = `${baseUrl}?action=approveRequest&id=${newReq.id}&name=${encodeURIComponent(user.name)}&date=${date}&session=${session}&reqType=${type}&reason=${encodeURIComponent(newReq.lateReason)}`;
      const rejectLink = `${baseUrl}?action=rejectRequest&id=${newReq.id}&name=${encodeURIComponent(user.name)}&date=${date}&session=${session}&reqType=${type}&reason=${encodeURIComponent(newReq.lateReason)}`;

      const message = `Assalamu'alaikum Admin,\n\nSaya *${user.name}* memohon akses buka absensi *${typeLabel}* untuk tanggal *${date}* sesi *${sessionLabel}*.\n\nAlasan Terlambat: *${newReq.lateReason}*\n\nMohon persetujuannya:\n\n✅ *SETUJUI* (Klik link ini):\n${approveLink}\n\n❌ *TOLAK* (Klik link ini):\n${rejectLink}`;
      
      // Beri jeda 300ms agar browser sempat menginisiasi antrean sinkronisasi jaringan sebelum tab dibekukan oleh WhatsApp
      setTimeout(() => {
        if (confirm("Kirim pengajuan akses buka absen ke Admin via WhatsApp?")) {
          window.open(`https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`, '_blank');
        }
      }, 300);
    }
  };

  const handleApproveRequest = (req: AttendanceOpenRequest, approve: boolean) => {
    if (onMarkOpenRequest) {
      const updatedReq: AttendanceOpenRequest = {
        ...req,
        status: approve ? 'approved' : 'rejected'
      };
      onMarkOpenRequest(updatedReq);
      
      const teacher = users.find(u => u.id === req.teacherId);
      if (teacher?.phoneNumber) {
        const statusText = approve ? "DISETUJUI (akses dibuka)" : "DITOLAK";
        const sessionLabel = req.session === 'pagi' ? 'Pagi' : 'Malam';
        const typeLabel = req.type === 'student' ? 'Absen Santri' : 'Absen Diri';
        const message = `Assalamu'alaikum, pengajuan buka absensi *${typeLabel}* Anda untuk tanggal ${req.date} sesi *${sessionLabel}* telah *${statusText}* oleh Admin.`;
        
        const cleanPhone = formatWhatsAppPhone(teacher.phoneNumber);
        if (confirm(`Kirim notifikasi persetujuan ke Guru (${teacher.name}) via WhatsApp?`)) {
          window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
        }
      }
    }
  };

  const getStatusIcon = (status: Attendance['status']) => {
    switch (status) {
      case 'present': 
        return <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 font-black text-[11px] flex items-center justify-center border border-emerald-200 shadow-sm">H</span>;
      case 'sick': 
        return <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-black text-[11px] flex items-center justify-center border border-amber-200 shadow-sm">S</span>;
      case 'permission': 
        return <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 font-black text-[11px] flex items-center justify-center border border-sky-200 shadow-sm">I</span>;
      case 'alpha': 
        return <span className="w-6 h-6 rounded-full bg-rose-100 text-rose-700 font-black text-[11px] flex items-center justify-center border border-rose-200 shadow-sm">A</span>;
      default: 
        return <div className="w-6 h-6 rounded-full border-2 border-gray-200"></div>;
    }
  };

  const getLockedStatusDisplay = (record: Attendance) => {
    const statusText = {
        present: 'HADIR',
        alpha: 'ALPHA',
        sick: 'SAKIT',
        permission: 'IZIN'
    }[record.status];

    const approvalText = record.approvalStatus === 'pending' ? '(Menunggu Persetujuan Admin)' 
                       : record.approvalStatus === 'approved' ? '(Disetujui)' 
                       : record.approvalStatus === 'rejected' ? '(Ditolak)' 
                       : '';
    
    let bgColor = 'bg-gray-100';
    let textColor = 'text-gray-600';
    
    if (record.status === 'present') { bgColor = 'bg-green-100'; textColor = 'text-green-700'; }
    else if (record.status === 'alpha') { bgColor = 'bg-red-100'; textColor = 'text-red-700'; }
    else if (record.status === 'sick' || record.status === 'permission') {
         if (record.approvalStatus === 'pending') { bgColor = 'bg-yellow-50'; textColor = 'text-yellow-700'; }
         else if (record.approvalStatus === 'approved') { bgColor = 'bg-blue-100'; textColor = 'text-blue-700'; }
         else if (record.approvalStatus === 'rejected') { bgColor = 'bg-red-50'; textColor = 'text-red-500 line-through'; }
    }

    return (
        <div className={`w-full p-3 rounded-lg border ${bgColor} ${textColor} flex items-center justify-center gap-2 font-bold text-sm`}>
            {record.status === 'present' ? <CheckCircle size={16}/> : <Lock size={16} />}
            STATUS: {statusText} {approvalText}
        </div>
    );
  };

  const handleDownloadPDF = () => {
    const canvas = document.getElementById('qr-code-canvas') as HTMLCanvasElement;
    if (canvas) {
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({
           orientation: "portrait",
           unit: "mm",
           format: "a4"
        });
        
        pdf.setFontSize(22);
        pdf.text("QR Code Absensi Guru", 105, 30, { align: "center" });
        pdf.setFontSize(14);
        pdf.text("Sistem Informasi Tahfidz (SITA) - Darul Abror", 105, 40, { align: "center" });
        
        pdf.addImage(imgData, 'PNG', 55, 60, 100, 100);
        
        pdf.setFontSize(12);
        pdf.text("Silakan scan QR Code ini menggunakan aplikasi SITA untuk mengisi kehadiran.", 105, 180, { align: "center", maxWidth: 150 });
        
        pdf.save("QR-Absensi-Guru.pdf");
    }
  };

  // Handler Buka Absen Massal (Admin)
  const handleExecuteBulkOpen = async () => {
    setIsProcessingBulk(true);
    setBulkNotification(null);
    try {
      let startDateStr = bulkStartDate;
      let endDateStr = bulkEndDate;

      if (bulkMode === 'month') {
        const lastDay = getMonthDaysCount(selectedMonth);
        startDateStr = `${selectedMonth}-01`;
        endDateStr = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
      }

      if (startDateStr > endDateStr) {
        throw new Error('Tanggal mulai tidak boleh melebihi tanggal selesai.');
      }

      const teacherUsers = (users || []).filter(u => u.role === 'teacher');
      const targetTeachers = bulkTeacherId === 'ALL'
        ? teacherUsers
        : teacherUsers.filter(u => u.id === bulkTeacherId);

      if (targetTeachers.length === 0) {
        throw new Error('Tidak ada guru yang ditemukan sebagai target pembukaan absensi.');
      }

      const sessionsToOpen: ('pagi' | 'malam')[] = bulkSession === 'all'
        ? ['pagi', 'malam']
        : [bulkSession];

      // Generate daftar tanggal dari startDate s/d endDate
      const datesToOpen: string[] = [];
      const curr = new Date(startDateStr + 'T00:00:00');
      const end = new Date(endDateStr + 'T00:00:00');
      while (curr <= end) {
        const y = curr.getFullYear();
        const m = String(curr.getMonth() + 1).padStart(2, '0');
        const d = String(curr.getDate()).padStart(2, '0');
        datesToOpen.push(`${y}-${m}-${d}`);
        curr.setDate(curr.getDate() + 1);
      }

      const defaultReason = bulkReason.trim() || 
        (bulkMode === 'month' 
          ? `Buka akses susulan absensi ${bulkType === 'student' ? 'santri' : 'guru'} bulan ${formatMonthYearLabel(selectedMonth)} oleh Admin`
          : `Buka akses susulan absensi ${bulkType === 'student' ? 'santri' : 'guru'} (${startDateStr} s/d ${endDateStr}) oleh Admin`);

      const newRequests: AttendanceOpenRequest[] = [];
      for (const dStr of datesToOpen) {
        for (const s of sessionsToOpen) {
          for (const t of targetTeachers) {
            newRequests.push({
              id: `req_${t.id}_${dStr}_${s}_${bulkType}`,
              teacherId: t.id,
              date: dStr,
              session: s,
              type: bulkType,
              status: 'approved',
              lateReason: defaultReason,
              createdAt: new Date().toISOString()
            });
          }
        }
      }

      if (onBulkOpenAttendance) {
        const res = await onBulkOpenAttendance(newRequests);
        setBulkNotification({
          type: 'success',
          message: res?.message || `Berhasil membuka akses absensi untuk ${datesToOpen.length} hari (${newRequests.length} sesi) untuk ${targetTeachers.length} guru.`
        });
      } else if (onMarkOpenRequest) {
        newRequests.forEach(req => onMarkOpenRequest(req));
        setBulkNotification({
          type: 'success',
          message: `Berhasil membuka akses absensi untuk ${datesToOpen.length} hari (${newRequests.length} sesi).`
        });
      }
    } catch (err: any) {
      setBulkNotification({
        type: 'error',
        message: err?.message || 'Gagal memproses pembukaan absensi massal.'
      });
    } finally {
      setIsProcessingBulk(false);
    }
  };

  // Handler Kunci Kembali Massal Per Bulan (Admin)
  const handleBulkRevokeMonth = async (monthStr: string) => {
    if (!confirm(`Yakin ingin mengunci kembali semua absensi bulan ${formatMonthYearLabel(monthStr)} yang pernah dibuka?`)) {
      return;
    }
    const matching = openRequests.filter(r => 
      r.status === 'approved' && 
      r.type === bulkType &&
      r.date.startsWith(monthStr)
    );
    if (matching.length === 0) {
      alert(`Tidak ada akses absensi terbuka untuk bulan ${formatMonthYearLabel(monthStr)}.`);
      return;
    }
    const ids = matching.map(r => r.id);
    if (onBulkDeleteOpenRequests) {
      await onBulkDeleteOpenRequests(ids);
    } else if (onDeleteOpenRequest) {
      ids.forEach(id => onDeleteOpenRequest(id));
    }
    setBulkNotification({
      type: 'success',
      message: `Berhasil mengunci kembali ${ids.length} sesi absensi untuk bulan ${formatMonthYearLabel(monthStr)}.`
    });
  };

  return (
    <div className="space-y-6">
      {user.role === 'admin' && (
        <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <Unlock size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-800 text-sm">Pusat Pembukaan Akses Absen Santri (Admin)</span>
                <span className="bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Admin</span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">
                Buka kunci absensi santri susulan untuk guru halaqah 1 bulan penuh (misal: September) atau rentang tanggal tertentu.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setShowAdminBulkOpenModal(true);
              setBulkNotification(null);
            }}
            className="shrink-0 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition shadow-sm hover:shadow active:scale-95"
          >
            <Unlock size={16} />
            <span>Buka Akses Sekarang</span>
          </button>
        </div>
      )}

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
           <h2 className="font-bold text-gray-800">Absensi {type === 'student' ? 'Santri' : 'Guru'}</h2>
           <p className="text-sm text-gray-500">Pilih tanggal dan sesi halaqah</p>
        </div>
        
        <div className="flex gap-4 items-center flex-wrap justify-end">
            {user.role === 'admin' && (
                <button 
                  onClick={() => {
                    setShowAdminBulkOpenModal(true);
                    setBulkNotification(null);
                  }} 
                  className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-sm border border-emerald-500/30"
                  title="Buka akses absensi santri untuk guru secara massal (1 bulan penuh atau rentang tanggal)"
                >
                    <Unlock size={15} /> 
                    <span>Buka Akses (Bulan/Rentang)</span>
                </button>
            )}
            {user.role === 'admin' && type === 'teacher' && (
                <button onClick={() => setShowAdminQR(true)} className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-2 rounded-lg text-sm font-bold hover:bg-indigo-100">
                    <QrCode size={16} /> QR Absensi
                </button>
            )}
            {user.role === 'teacher' && type === 'teacher' && !lockInfo.locked && (
                <button onClick={() => setShowScanner(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-2 rounded-lg text-sm font-bold hover:bg-emerald-100">
                    <Camera size={16} /> Scan QR
                </button>
            )}
            <div className="flex bg-gray-100 p-1 rounded-lg">
                <button
                    onClick={() => setSession('pagi')}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                    session === 'pagi' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <Sun size={16} /> <span>Pagi</span>
                    {attendance.filter(a => cleanSubId(a.userId) && a.date === date && a.type === type && a.session === 'pagi' && a.status).length > 0 && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-orange-100 text-orange-700 rounded-full font-bold">
                        {attendance.filter(a => cleanSubId(a.userId) && a.date === date && a.type === type && a.session === 'pagi' && a.status).length}
                      </span>
                    )}
                </button>
                <button
                    onClick={() => setSession('malam')}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                    session === 'malam' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <Moon size={16} /> <span>Malam</span>
                    {attendance.filter(a => cleanSubId(a.userId) && a.date === date && a.type === type && a.session === 'malam' && a.status).length > 0 && (
                      <span className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-700 rounded-full font-bold">
                        {attendance.filter(a => cleanSubId(a.userId) && a.date === date && a.type === type && a.session === 'malam' && a.status).length}
                      </span>
                    )}
                </button>
            </div>
            
            <input 
            type="date" 
            value={date}
            onChange={(e) => setDate(e.target.value || getLocalDateString())}
            className="border rounded-lg p-2 text-sm bg-gray-50 focus:outline-primary h-10"
            />
        </div>
      </div>

      {/* Banner informasi jika absensi pada tanggal ini terbuka berkat izin Admin */}
      {lockInfo.status === 'approved' && user.role !== 'admin' && (
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-center justify-between gap-3 text-xs text-emerald-900 shadow-sm animate-fade-in">
          <div className="flex items-center gap-3">
            <span className="p-2 bg-emerald-100 text-emerald-700 rounded-xl flex-shrink-0">
              <CheckCircle size={18} />
            </span>
            <div>
              <p className="font-bold text-emerald-950 text-sm">Akses Absensi Terbuka (Izin Admin)</p>
              <p className="text-emerald-700 text-xs mt-0.5">
                Anda diizinkan mengisi dan memperbarui data absensi pada tanggal dan sesi ini: <span className="font-semibold italic">"{lockInfo.request?.lateReason || 'Dibuka oleh Admin'}"</span>.
              </p>
            </div>
          </div>
          <span className="px-3 py-1 bg-emerald-600 text-white font-extrabold rounded-lg text-[10px] uppercase tracking-wider shadow-sm flex-shrink-0">
            Terbuka
          </span>
        </div>
      )}

      {user.role === 'admin' && openRequests.filter(r => r.status === 'pending').length > 0 && (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-amber-200 bg-amber-50/10 space-y-3">
            <h3 className="font-bold text-amber-800 flex items-center gap-2 text-sm">
                <Clock className="text-amber-600" size={18} />
                Permintaan Akses Buka Absensi Terlambat ({openRequests.filter(r => r.status === 'pending').length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {openRequests.filter(r => r.status === 'pending').map(req => {
                    const teacher = users.find(u => u.id === cleanSubId(req.teacherId));
                    return (
                        <div key={req.id} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm flex flex-col justify-between gap-2 text-xs">
                            <div>
                                <div className="flex justify-between items-start gap-2">
                                    <span className="font-bold text-gray-800">{teacher?.name || 'Guru'}</span>
                                    <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-bold uppercase shrink-0">
                                        {req.session}
                                    </span>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-0.5">
                                    Tgl: {req.date} | Tipe: {req.type === 'student' ? 'Absen Santri' : 'Absen Diri'}
                                </p>
                                <div className="mt-1.5 bg-gray-50 p-1.5 rounded border text-[11px] text-gray-600 italic">
                                    Alasan: "{req.lateReason}"
                                </div>
                            </div>
                            <div className="flex gap-2 mt-1">
                                <button
                                    onClick={() => handleApproveRequest(req, true)}
                                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-1 rounded font-bold flex items-center justify-center gap-1 transition-all"
                                >
                                    <Check size={12} /> Setujui
                                </button>
                                <button
                                    onClick={() => handleApproveRequest(req, false)}
                                    className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-1 rounded font-bold flex items-center justify-center gap-1 transition-all"
                                >
                                    <X size={12} /> Tolak
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
      )}

      {user.role === 'admin' && (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-3">
          <button 
            type="button"
            onClick={() => setShowRequestHistory(!showRequestHistory)}
            className="w-full flex justify-between items-center text-left"
          >
            <h3 className="font-bold text-gray-700 flex items-center gap-2 text-sm">
                <History className="text-gray-500" size={18} />
                Riwayat Pengajuan Buka Absen Terlambat ({openRequests.length})
            </h3>
            <span className="text-xs text-emerald-600 font-bold">{showRequestHistory ? 'Sembunyikan' : 'Tampilkan'}</span>
          </button>
          
          {showRequestHistory && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse border border-gray-200">
                <thead>
                  <tr className="bg-gray-50 text-gray-700 text-[10px] uppercase font-bold">
                    <th className="p-2 border border-gray-200">Guru</th>
                    <th className="p-2 border border-gray-200 text-center">Tanggal</th>
                    <th className="p-2 border border-gray-200 text-center">Sesi</th>
                    <th className="p-2 border border-gray-200 text-center">Tipe</th>
                    <th className="p-2 border border-gray-200">Alasan</th>
                    <th className="p-2 border border-gray-200 text-center">Status</th>
                    <th className="p-2 border border-gray-200 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {openRequests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-gray-400">Tidak ada riwayat pengajuan.</td>
                    </tr>
                  ) : (
                    openRequests.map(req => {
                      const teacher = users.find(u => u.id === cleanSubId(req.teacherId));
                      return (
                        <tr key={req.id} className="hover:bg-gray-50">
                          <td className="p-2 border border-gray-200 font-semibold">{teacher?.name || 'Guru'}</td>
                          <td className="p-2 border border-gray-200 text-center">{req.date}</td>
                          <td className="p-2 border border-gray-200 text-center capitalize">{req.session}</td>
                          <td className="p-2 border border-gray-200 text-center">{req.type === 'student' ? 'Absen Santri' : 'Absen Diri'}</td>
                          <td className="p-2 border border-gray-200 italic">"{req.lateReason}"</td>
                          <td className="p-2 border border-gray-200 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                              req.status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                              req.status === 'rejected' ? 'bg-rose-100 text-rose-800' :
                              'bg-amber-100 text-amber-800'
                            }`}>
                              {req.status}
                            </span>
                          </td>
                          <td className="p-2 border border-gray-200 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                if (onDeleteOpenRequest) {
                                  onDeleteOpenRequest(req.id);
                                }
                              }}
                              className="text-rose-600 hover:text-rose-800 p-1"
                              title="Hapus Pengajuan"
                            >
                              <Trash2 size={14} className="inline" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {lockInfo.locked && user.role !== 'admin' && (
        (() => {
          const lInfo = lockInfo as any;
          if (lInfo.status === 'late') {
            return (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-3">
                  <Clock className="text-amber-600 shrink-0" size={20} />
                  <div>
                    <p className="font-bold text-sm">Absensi Terkunci (Terlambat)</p>
                    <p className="text-xs text-amber-700">{lInfo.reason}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowRequestModal(true)} 
                  className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all whitespace-nowrap"
                >
                  <Key size={14} /> Minta Akses Buka Absen
                </button>
              </div>
            );
          } else if (lInfo.status === 'pending') {
            return (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-xl flex items-center gap-3">
                <Clock className="text-yellow-600 shrink-0 mt-0.5 animate-pulse" size={20} />
                <div>
                  <p className="font-bold text-sm">Permintaan Akses Dikirim</p>
                  <p className="text-xs text-yellow-700">{lInfo.reason}</p>
                  {lInfo.request?.lateReason && (
                    <p className="text-xs italic text-yellow-600 mt-1">Alasan: "{lInfo.request.lateReason}"</p>
                  )}
                </div>
              </div>
            );
          } else if (lInfo.status === 'rejected') {
            return (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl flex items-center gap-3">
                <XCircle className="text-rose-600 shrink-0 mt-0.5" size={20} />
                <div>
                  <p className="font-bold text-sm">Permintaan Akses Ditolak</p>
                  <p className="text-xs text-rose-700">{lInfo.reason}</p>
                  {lInfo.request?.lateReason && (
                    <p className="text-xs italic text-rose-600 mt-1">Alasan awal: "{lInfo.request.lateReason}"</p>
                  )}
                </div>
              </div>
            );
          } else {
            return (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-center gap-3">
                <Clock className="text-amber-600 shrink-0" size={20} />
                <div>
                  <p className="font-bold text-sm">Absensi Terkunci</p>
                  <p className="text-xs text-amber-700">{lInfo.reason}</p>
                </div>
              </div>
            );
          }
        })()
      )}

      {type === 'student' && (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row sm:items-center gap-3 print:hidden">
          <span className="text-sm font-bold text-gray-700 shrink-0">Cari Nama Santri:</span>
          <input 
            type="text"
            placeholder="Ketik nama santri untuk mencari..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-4 py-2 border rounded-lg text-sm bg-gray-50 focus:outline-primary outline-none"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="text-xs text-red-600 hover:text-red-800 font-bold px-2 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
            >
              Bersihkan
            </button>
          )}
        </div>
      )}

      {type === 'student' && subjectList.length === 0 && (
        <div className="bg-white p-12 rounded-xl border border-dashed border-gray-200 text-center text-gray-400">
           Tidak ada santri yang cocok dengan kata kunci pencarian "{searchQuery}"
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {subjectList.map((subject) => {
          const record = attendance.find(a => cleanSubId(a.userId) === cleanSubId(subject.id) && a.date === date && a.type === type && a.session === session);
          const currentStatus = record?.status || null;
          const isPending = record?.approvalStatus === 'pending';
          
          // Logic to lock teacher input if record exists (Teacher self-attendance)
          const isTeacherSelfLocked = user.role === 'teacher' && type === 'teacher' && !!record;

          return (
            <div key={subject.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col gap-3">
               <div className="flex justify-between items-start">
                 <div>
                   <h3 className="font-bold text-gray-800">{subject.name}</h3>
                   <p className="text-xs text-gray-500">{subject.subInfo}</p>
                   {record?.lateReason && (
                     <p className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 italic mt-1 inline-block">
                       Terlambat: "{record.lateReason}"
                     </p>
                   )}
                 </div>
                 <div className="flex flex-col items-end">
                    {currentStatus && getStatusIcon(currentStatus)}
                    {isPending && type === 'teacher' && <span className="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full mt-1">Menunggu Acc</span>}
                    {record?.approvalStatus === 'approved' && type === 'teacher' && <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full mt-1">Disetujui</span>}
                    {record?.approvalStatus === 'rejected' && type === 'teacher' && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full mt-1">Ditolak</span>}
                 </div>
               </div>

               {/* Controls */}
               {isTeacherSelfLocked || (lockInfo.locked && user.role !== 'admin') ? (
                   // LOCKED VIEW
                   record ? getLockedStatusDisplay(record) : (
                      <div className="flex flex-col gap-2 w-full">
                          <div className="w-full p-2.5 rounded-lg border border-dashed border-gray-200 bg-gray-50 text-gray-400 flex items-center justify-center gap-1.5 font-bold text-xs">
                              <Lock size={14} /> ABSENSI HADIR TERKUNCI (DILUAR JAM)
                          </div>
                          {/* Show Sick and Permission buttons anyway for Teacher self-attendance */}
                          {type === 'teacher' && user.role === 'teacher' && (
                            <div className="grid grid-cols-2 gap-2 mt-1">
                              <button 
                                onClick={() => handleStatusClick(subject.id, 'sick')}
                                className="py-2.5 rounded-xl flex flex-col items-center justify-center border transition-all duration-200 bg-amber-500/10 border-amber-500/20 text-amber-700 hover:bg-amber-500 hover:text-white"
                              >
                                <span className="text-sm font-black">S</span>
                                <span className="text-[9px] font-bold mt-0.5 opacity-90">Laporkan Sakit</span>
                              </button>
                              <button 
                                onClick={() => handleStatusClick(subject.id, 'permission')}
                                className="py-2.5 rounded-xl flex flex-col items-center justify-center border transition-all duration-200 bg-sky-500/10 border-sky-500/20 text-sky-700 hover:bg-sky-500 hover:text-white"
                              >
                                <span className="text-sm font-black">I</span>
                                <span className="text-[9px] font-bold mt-0.5 opacity-90">Laporkan Izin</span>
                              </button>
                            </div>
                          )}
                      </div>
                   )
               ) : (
                   // NORMAL VIEW / ADMIN APPROVAL VIEW
                   <>
                       {user.role === 'admin' && type === 'teacher' && isPending && record ? (
                         <div className="bg-yellow-50 p-2 rounded-lg border border-yellow-100 mt-2">
                            <p className="text-xs text-yellow-800 mb-2 font-medium">Pengajuan Izin/Sakit ({session === 'pagi' ? 'Pagi' : 'Malam'}):</p>
                            <div className="flex gap-2">
                                <button 
                                  onClick={() => handleApproval(record, true, subject.phone)}
                                  className="flex-1 bg-green-500 hover:bg-green-600 text-white py-1.5 rounded text-xs font-bold flex items-center justify-center gap-1"
                                >
                                    <Check size={14} /> Setujui
                                </button>
                                <button 
                                   onClick={() => handleApproval(record, false, subject.phone)}
                                   className="flex-1 bg-red-500 hover:bg-red-600 text-white py-1.5 rounded text-xs font-bold flex items-center justify-center gap-1"
                                >
                                    <X size={14} /> Tolak
                                </button>
                            </div>
                            {onDeleteAttendance && (
                              <button 
                                onClick={() => onDeleteAttendance(record.id)}
                                className="w-full mt-2 bg-rose-50 hover:bg-rose-100 text-rose-600 py-1 rounded text-xs font-bold flex items-center justify-center gap-1 border border-rose-200 transition-all duration-200"
                              >
                                <XCircle size={12} /> Hapus Pengajuan
                              </button>
                            )}
                         </div>
                       ) : (
                         (user.role === 'teacher' || (user.role === 'admin' && type === 'student') || (user.role === 'admin' && type === 'teacher' && !isPending)) && (
                            <div className="space-y-2 mt-1">
                              <div className="grid grid-cols-4 gap-2">
                                {/* Tombol Hadir (H) */}
                                <button 
                                  onClick={() => handleStatusClick(subject.id, 'present')}
                                  className={`py-1.5 rounded-lg flex flex-col items-center justify-center border transition-all duration-200 ${
                                    currentStatus === 'present' 
                                      ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm scale-[1.03]' 
                                      : 'bg-gray-50 border-gray-100 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                                  }`}
                                  title="Hadir"
                                >
                                  <span className="text-sm font-black">H</span>
                                  <span className="text-[9px] font-bold mt-0.5 opacity-90">Hadir</span>
                                </button>

                                {/* Tombol Sakit (S) */}
                                <button 
                                  onClick={() => handleStatusClick(subject.id, 'sick')}
                                  className={`py-1.5 rounded-lg flex flex-col items-center justify-center border transition-all duration-200 ${
                                    currentStatus === 'sick' 
                                      ? 'bg-amber-500 border-amber-500 text-white shadow-sm scale-[1.03]' 
                                      : 'bg-gray-50 border-gray-100 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                                  }`}
                                  title="Sakit"
                                >
                                  <span className="text-sm font-black">S</span>
                                  <span className="text-[9px] font-bold mt-0.5 opacity-90">Sakit</span>
                                </button>

                                {/* Tombol Izin (I) */}
                                <button 
                                  onClick={() => handleStatusClick(subject.id, 'permission')}
                                  className={`py-1.5 rounded-lg flex flex-col items-center justify-center border transition-all duration-200 ${
                                    currentStatus === 'permission' 
                                      ? 'bg-sky-500 border-sky-500 text-white shadow-sm scale-[1.03]' 
                                      : 'bg-gray-50 border-gray-100 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                                  }`}
                                  title="Izin"
                                >
                                  <span className="text-sm font-black">I</span>
                                  <span className="text-[9px] font-bold mt-0.5 opacity-90">Izin</span>
                                </button>

                                {/* Tombol Alpha (A) */}
                                <button 
                                  onClick={() => handleStatusClick(subject.id, 'alpha')}
                                  className={`py-1.5 rounded-lg flex flex-col items-center justify-center border transition-all duration-200 ${
                                    currentStatus === 'alpha' 
                                      ? 'bg-rose-500 border-rose-500 text-white shadow-sm scale-[1.03]' 
                                      : 'bg-gray-50 border-gray-100 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                                  }`}
                                  title="Alpha"
                                >
                                  <span className="text-sm font-black">A</span>
                                  <span className="text-[9px] font-bold mt-0.5 opacity-90">Alpha</span>
                                </button>
                              </div>
                              {user.role === 'admin' && type === 'teacher' && record && onDeleteAttendance && (
                                <button 
                                  onClick={() => onDeleteAttendance(record.id)}
                                  className="w-full bg-rose-50 hover:bg-rose-100 text-rose-600 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 border border-rose-200 transition-all duration-200"
                                >
                                  <XCircle size={14} /> Batalkan/Hapus Absen
                                </button>
                              )}
                            </div>
                         )
                       )}
                   </>
               )}
            </div>
          );
        })}
        
        {subjectList.length === 0 && (
          <div className="col-span-full text-center py-8 text-gray-400">
            Tidak ada data untuk ditampilkan.
          </div>
        )}
      </div>

      {showAdminQR && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl relative flex flex-col items-center text-center">
                <button onClick={() => setShowAdminQR(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
                <h3 className="font-bold text-lg text-gray-800 mb-2">QR Code Absensi Guru</h3>
                <p className="text-sm text-gray-500 mb-6">Print atau tampilkan QR ini agar bisa di-scan oleh guru halaqah.</p>
                <div className="bg-white p-4 rounded-xl border-2 border-dashed border-gray-200 mb-6">
                    <QRCodeCanvas id="qr-code-canvas" value={`${window.location.origin}/?absen=guru`} size={200} level="H" />
                </div>
                <div className="flex gap-2 w-full">
                    <button onClick={() => window.print()} className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-bold flex justify-center items-center gap-2 hover:bg-indigo-700">
                        <Printer size={16} /> Print
                    </button>
                    <button onClick={handleDownloadPDF} className="flex-1 bg-green-600 text-white py-2.5 rounded-xl font-bold flex justify-center items-center gap-2 hover:bg-green-700">
                        <Download size={16} /> PDF
                    </button>
                </div>
            </div>
        </div>
      )}

      {showScanner && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl relative">
                <button onClick={() => setShowScanner(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 z-10"><X size={20}/></button>
                <h3 className="font-bold text-lg text-gray-800 mb-4 text-center">Scan QR Code Absensi</h3>
                <QRScanner 
                    onScanSuccess={(text) => {
                        if (text.trim() === "SITA_ABSENSI_GURU_TETAP" || text.includes("absen=guru")) {
                            const success = handleStatusClick(user.id, 'present');
                            if (success) {
                                setShowScanner(false);
                                alert("Absensi berhasil dicatat: HADIR.");
                            }
                        } else {
                            alert("QR Code tidak valid untuk absensi SITA.");
                        }
                    }} 
                />
            </div>
        </div>
      )}

      {showRequestModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <form onSubmit={handleSubmitRequest} className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl relative flex flex-col gap-4">
                <button type="button" onClick={() => setShowRequestModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
                <div>
                  <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                    <Key className="text-amber-500" size={18} />
                    Permohonan Buka Absen
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">Anda terlambat melakukan absensi. Silakan tuliskan alasan keterlambatan untuk meminta persetujuan Admin.</p>
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-gray-600 mb-1 tracking-wider uppercase">
                      Keterangan Keterlambatan
                    </label>
                    <textarea 
                      value={lateReason} 
                      onChange={(e) => setLateReason(e.target.value)} 
                      className="w-full border border-gray-300 rounded-xl p-3 text-xs focus:ring-2 focus:ring-amber-500 outline-none h-24" 
                      placeholder="Contoh: Terhambat macet di jalan / Listrik padam" 
                      required 
                    />
                </div>
                <div className="flex gap-2 w-full">
                    <button type="button" onClick={() => setShowRequestModal(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-xl font-bold text-xs transition-all">
                        Batal
                    </button>
                    <button type="submit" className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-xl font-bold text-xs transition-all shadow-sm">
                        Kirim Permintaan
                    </button>
                </div>
            </form>
        </div>
      )}

      {/* MODAL BUKA AKSES ABSENSI MASSAL / BULANAN (KHUSUS ADMIN) */}
      {showAdminBulkOpenModal && user.role === 'admin' && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-auto max-h-[92vh]">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-emerald-800 to-teal-900 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="p-2.5 bg-white/10 rounded-xl border border-white/20">
                  <Key className="w-5 h-5 text-emerald-300" />
                </span>
                <div>
                  <h3 className="font-bold text-base">Buka Akses Absensi Santri (Admin)</h3>
                  <p className="text-xs text-emerald-200/90 mt-0.5">
                    Izinkan guru halaqah mengisi absensi susulan per bulan penuh atau rentang tanggal
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowAdminBulkOpenModal(false)}
                className="p-1.5 rounded-xl hover:bg-white/10 text-white/80 hover:text-white transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Notification alert */}
            {bulkNotification && (
              <div className={`p-4 text-xs font-semibold flex items-center justify-between border-b ${
                bulkNotification.type === 'success' 
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}>
                <div className="flex items-center gap-2">
                  {bulkNotification.type === 'success' ? <CheckCircle size={16} className="text-emerald-600" /> : <AlertCircle size={16} className="text-rose-600" />}
                  <span>{bulkNotification.message}</span>
                </div>
                <button onClick={() => setBulkNotification(null)} className="text-slate-400 hover:text-slate-600">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Modal Tab Switcher */}
            <div className="flex border-b border-slate-200 bg-slate-50 px-5 pt-3 gap-2">
              <button
                onClick={() => setBulkActiveTab('form')}
                className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 flex items-center gap-2 ${
                  bulkActiveTab === 'form'
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Unlock size={14} />
                <span>Formulir Buka Akses</span>
              </button>
              <button
                onClick={() => setBulkActiveTab('history')}
                className={`pb-2.5 px-3 text-xs font-bold transition border-b-2 flex items-center gap-2 ${
                  bulkActiveTab === 'history'
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <History size={14} />
                <span>Daftar Akses Terbuka ({openRequests.filter(r => r.status === 'approved' && r.type === bulkType).length})</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {bulkActiveTab === 'form' ? (
                <>
                  {/* Mode Selector: Bulan Penuh vs Rentang Tanggal */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2">
                      Pilihan Cakupan Waktu
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setBulkMode('month')}
                        className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
                          bulkMode === 'month'
                            ? 'bg-emerald-50/70 border-emerald-300 text-emerald-900 shadow-sm'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Calendar className={`w-4 h-4 mt-0.5 ${bulkMode === 'month' ? 'text-emerald-600' : 'text-slate-400'}`} />
                        <div>
                          <span className="font-bold block text-xs">Bulan Penuh (Rekomendasi)</span>
                          <span className="text-[10px] text-slate-500 mt-0.5 block">
                            Buka 1 bulan utuh (misal September 30 hari penuh)
                          </span>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setBulkMode('custom')}
                        className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
                          bulkMode === 'custom'
                            ? 'bg-emerald-50/70 border-emerald-300 text-emerald-900 shadow-sm'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Clock className={`w-4 h-4 mt-0.5 ${bulkMode === 'custom' ? 'text-emerald-600' : 'text-slate-400'}`} />
                        <div>
                          <span className="font-bold block text-xs">Rentang Tanggal Kustom</span>
                          <span className="text-[10px] text-slate-500 mt-0.5 block">
                            Tentukan tanggal mulai dan selesai secara fleksibel
                          </span>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Input Waktu */}
                  {bulkMode === 'month' ? (
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <label className="font-bold text-slate-700">Pilih Bulan & Tahun:</label>
                        <input
                          type="month"
                          value={selectedMonth}
                          onChange={(e) => setSelectedMonth(e.target.value)}
                          className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                        />
                      </div>

                      {/* Quick preset buttons */}
                      <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-200 text-[11px]">
                        <span className="text-slate-400 font-medium">Jalan Pintas:</span>
                        <button
                          type="button"
                          onClick={() => setSelectedMonth('2026-09')}
                          className="px-2.5 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold transition"
                        >
                          September 2026
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const cur = getLocalDateString().substring(0, 7);
                            setSelectedMonth(cur);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold transition"
                        >
                          Bulan Ini ({formatMonthYearLabel(getLocalDateString().substring(0, 7))})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const [y, m] = getLocalDateString().substring(0, 7).split('-').map(Number);
                            const prevD = new Date(y, m - 2, 1);
                            const prevStr = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
                            setSelectedMonth(prevStr);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold transition"
                        >
                          Bulan Lalu
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Tanggal Mulai:</label>
                        <input
                          type="date"
                          value={bulkStartDate}
                          onChange={(e) => setBulkStartDate(e.target.value)}
                          className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                        />
                      </div>
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Tanggal Selesai:</label>
                        <input
                          type="date"
                          value={bulkEndDate}
                          onChange={(e) => setBulkEndDate(e.target.value)}
                          className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                        />
                      </div>
                    </div>
                  )}

                  {/* Target Guru & Sesi */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        Sasaran Guru Halaqah
                      </label>
                      <select
                        value={bulkTeacherId}
                        onChange={(e) => setBulkTeacherId(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                      >
                        <option value="ALL">🌟 Semua Guru Halaqah ({users.filter(u => u.role === 'teacher').length} Guru)</option>
                        {users.filter(u => u.role === 'teacher').map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        Sesi Halaqah
                      </label>
                      <select
                        value={bulkSession}
                        onChange={(e) => setBulkSession(e.target.value as any)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                      >
                        <option value="all">Pagi & Malam (Semua Sesi)</option>
                        <option value="pagi">Hanya Sesi Pagi</option>
                        <option value="malam">Hanya Sesi Malam</option>
                      </select>
                    </div>
                  </div>

                  {/* Tipe Absensi */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        Tipe Absensi
                      </label>
                      <select
                        value={bulkType}
                        onChange={(e) => setBulkType(e.target.value as any)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                      >
                        <option value="student">Absensi Santri (Rekomendasi)</option>
                        <option value="teacher">Absensi Guru</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        Alasan / Catatan Admin
                      </label>
                      <input
                        type="text"
                        value={bulkReason}
                        onChange={(e) => setBulkReason(e.target.value)}
                        placeholder={`Buka absen ${bulkType === 'student' ? 'santri' : 'guru'} susulan oleh Admin`}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                      />
                    </div>
                  </div>

                  {/* Ringkasan & Kalkulasi Live */}
                  {(() => {
                    const daysCount = bulkMode === 'month' 
                      ? getMonthDaysCount(selectedMonth)
                      : (bulkStartDate && bulkEndDate && bulkStartDate <= bulkEndDate
                          ? Math.round((new Date(bulkEndDate + 'T00:00:00').getTime() - new Date(bulkStartDate + 'T00:00:00').getTime()) / (1000 * 3600 * 24)) + 1
                          : 0);
                    const teachersCount = bulkTeacherId === 'ALL'
                      ? users.filter(u => u.role === 'teacher').length
                      : 1;
                    const sessionMultiplier = bulkSession === 'all' ? 2 : 1;
                    const totalSessions = daysCount * sessionMultiplier * teachersCount;

                    return (
                      <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-4 space-y-2">
                        <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
                          <ShieldCheck size={16} className="text-emerald-600" />
                          <span>Ringkasan Izin Buka Absen:</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-700 text-[11px]">
                          <div className="bg-white p-2.5 rounded-xl border border-emerald-100">
                            <span className="text-slate-400 block text-[10px]">Periode:</span>
                            <span className="font-bold text-slate-900 truncate block">
                              {bulkMode === 'month' ? formatMonthYearLabel(selectedMonth) : `${bulkStartDate} s/d ${bulkEndDate}`}
                            </span>
                          </div>
                          <div className="bg-white p-2.5 rounded-xl border border-emerald-100">
                            <span className="text-slate-400 block text-[10px]">Total Hari:</span>
                            <span className="font-bold text-slate-900">{daysCount} Hari</span>
                          </div>
                          <div className="bg-white p-2.5 rounded-xl border border-emerald-100">
                            <span className="text-slate-400 block text-[10px]">Target Guru:</span>
                            <span className="font-bold text-slate-900 truncate block">
                              {bulkTeacherId === 'ALL' ? `Semua Guru (${teachersCount})` : (users.find(u => u.id === bulkTeacherId)?.name || '1 Guru')}
                            </span>
                          </div>
                          <div className="bg-white p-2.5 rounded-xl border border-emerald-100">
                            <span className="text-slate-400 block text-[10px]">Total Sesi Dibuka:</span>
                            <span className="font-bold text-emerald-700">{totalSessions} Sesi</span>
                          </div>
                        </div>
                        <p className="text-[11px] text-emerald-800">
                          Guru halaqah dapat langsung membuka aplikasi dan mengisi absensi santri pada seluruh tanggal tersebut tanpa terkendala batas waktu.
                        </p>
                      </div>
                    );
                  })()}
                </>
              ) : (
                /* History / Manage Active Tab */
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 font-semibold">Filter Bulan:</span>
                      <select
                        value={bulkHistoryFilterMonth}
                        onChange={(e) => setBulkHistoryFilterMonth(e.target.value)}
                        className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs text-slate-700"
                      >
                        <option value="ALL">Semua Bulan</option>
                        {Array.from(new Set(openRequests.filter(r => r.status === 'approved').map(r => r.date.substring(0, 7)))).sort().reverse().map(m => (
                          <option key={m} value={m}>{formatMonthYearLabel(m)}</option>
                        ))}
                      </select>
                    </div>

                    {bulkHistoryFilterMonth !== 'ALL' && (
                      <button
                        type="button"
                        onClick={() => handleBulkRevokeMonth(bulkHistoryFilterMonth)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl border border-rose-200 transition text-xs self-start"
                      >
                        <Trash2 size={13} />
                        <span>Kunci Kembali Bulan Ini ({formatMonthYearLabel(bulkHistoryFilterMonth)})</span>
                      </button>
                    )}
                  </div>

                  {/* List of open requests */}
                  {(() => {
                    const approvedList = openRequests.filter(r => {
                      if (r.status !== 'approved' || r.type !== bulkType) return false;
                      if (bulkHistoryFilterMonth !== 'ALL' && !r.date.startsWith(bulkHistoryFilterMonth)) return false;
                      return true;
                    });

                    if (approvedList.length === 0) {
                      return (
                        <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                          Belum ada akses absensi yang dibuka untuk filter ini.
                        </div>
                      );
                    }

                    // Group by month for cleaner presentation
                    const groupedByMonth: Record<string, typeof approvedList> = {};
                    approvedList.forEach(r => {
                      const m = r.date.substring(0, 7);
                      if (!groupedByMonth[m]) groupedByMonth[m] = [];
                      groupedByMonth[m].push(r);
                    });

                    return (
                      <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                        {Object.entries(groupedByMonth).map(([monthKey, items]) => (
                          <div key={monthKey} className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                                <Calendar size={14} className="text-emerald-600" />
                                {formatMonthYearLabel(monthKey)} ({items.length} sesi terbuka)
                              </span>
                              <button
                                type="button"
                                onClick={() => handleBulkRevokeMonth(monthKey)}
                                className="text-rose-600 hover:text-rose-800 font-bold text-[11px] flex items-center gap-1"
                              >
                                <Trash2 size={12} /> Kunci Kembali
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {items.slice(0, 10).map(item => {
                                const t = users.find(u => u.id === cleanSubId(item.teacherId));
                                return (
                                  <div key={item.id} className="bg-white p-2 rounded-lg border border-slate-200/80 flex items-center justify-between text-[11px]">
                                    <div>
                                      <span className="font-semibold text-slate-800">{item.date}</span>
                                      <span className="text-slate-400 mx-1">•</span>
                                      <span className="capitalize text-slate-600">{item.session}</span>
                                      <span className="text-slate-400 mx-1">•</span>
                                      <span className="text-emerald-700 font-medium">{t?.name || 'Semua Guru'}</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => onDeleteOpenRequest && onDeleteOpenRequest(item.id)}
                                      className="text-slate-400 hover:text-rose-600 p-1"
                                      title="Kunci sesi ini"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                            {items.length > 10 && (
                              <p className="text-[10px] text-slate-500 italic text-center">
                                ...dan {items.length - 10} sesi lainnya pada bulan ini.
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {bulkActiveTab === 'form' && (
              <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAdminBulkOpenModal(false)}
                  className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-700 transition"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  onClick={handleExecuteBulkOpen}
                  disabled={isProcessingBulk}
                  className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-xl text-xs font-bold transition shadow-sm flex items-center gap-2 disabled:opacity-50"
                >
                  <Unlock size={14} className={isProcessingBulk ? 'animate-spin' : ''} />
                  <span>{isProcessingBulk ? 'Memproses Buka Absen...' : 'Buka Akses Absensi Sekarang'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceView;
