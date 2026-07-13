
import React, { useState } from 'react';
import { User, Student, Attendance, AttendanceOpenRequest } from '../types';
import { CheckCircle, XCircle, AlertCircle, Clock, Check, X, Sun, Moon, Lock, QrCode, Camera, Printer, Download, Key } from 'lucide-react';
import { ADMIN_PHONE } from '../constants';
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
}

const AttendanceView: React.FC<AttendanceProps> = ({ 
  user, students, users, attendance, onMarkAttendance, onDeleteAttendance, type,
  openRequests = [], onMarkOpenRequest
}) => {
  const adminUser = (users || []).find(u => u.role === 'admin');
  const adminPhone = adminUser?.phoneNumber ? adminUser.phoneNumber.replace(/\D/g, '') : ADMIN_PHONE;

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [session, setSession] = useState<'pagi' | 'malam'>('pagi');
  const [showAdminQR, setShowAdminQR] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [lateReason, setLateReason] = useState('');

  // Fungsi pengecekan apakah guru terlambat
  const checkIsLate = (sess: 'pagi' | 'malam', targetDate: string) => {
    const todayStr = new Date().toISOString().split('T')[0];
    
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

    const todayStr = new Date().toISOString().split('T')[0];
    if (date > todayStr) {
      return { locked: true, reason: 'Belum bisa mengisi absensi untuk hari esok.', status: 'future' };
    }

    // Cari permohonan buka absensi untuk guru ini pada tanggal & sesi terpilih
    const request = openRequests.find(r => 
      r.teacherId === user.id && 
      r.date === date && 
      r.session === sess && 
      r.type === type
    );

    if (request && request.status === 'approved') {
      return { locked: false, reason: '', status: 'approved' };
    }

    const isLate = checkIsLate(sess, date);
    if (isLate) {
      if (request && request.status === 'pending') {
        return { locked: true, reason: 'Permintaan buka akses sedang menunggu persetujuan admin.', status: 'pending', request };
      } else if (request && request.status === 'rejected') {
        return { locked: true, reason: 'Permintaan buka akses ditolak oleh admin.', status: 'rejected', request };
      } else {
        return { locked: true, reason: 'Absensi terkunci karena terlambat (melebihi batas jam pagi 05:50 / malam 18:50).', status: 'late' };
      }
    }

    // Pengecekan jam normal (seperti jam buka awal dan batas akhir sesi)
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    if (sess === 'pagi') {
      const start = 4 * 60 + 30; // 04:30
      const end = 12 * 60;       // 12:00
      if (currentMinutes < start || currentMinutes > end) {
        return { locked: true, reason: 'Absensi Pagi hanya dibuka pukul 04:30 - 12:00 WIB.', status: 'outside_hours' };
      }
    } else if (sess === 'malam') {
      const start = 17 * 60 + 30; // 17:30
      const end = 21 * 60;        // 21:00
      if (currentMinutes < start || currentMinutes > end) {
        return { locked: true, reason: 'Absensi Malam hanya dibuka pukul 17:30 - 21:00 WIB.', status: 'outside_hours' };
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

    subjectList = visibleStudents.map(s => ({
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

  const handleStatusClick = (subjectId: string, status: Attendance['status']) => {
    if (user.role === 'parent') return;

    const currentLock = checkSessionLock(session);
    if (currentLock.locked && user.role !== 'admin') {
      alert(currentLock.reason);
      return;
    }

    // Cari request yang disetujui untuk mendapatkan alasan keterlambatan
    const request = openRequests.find(r => 
      r.teacherId === user.id && 
      r.date === date && 
      r.session === session && 
      r.type === type &&
      r.status === 'approved'
    );
    const lateReasonToSave = request?.lateReason || undefined;

    const existing = attendance.find(a => a.userId === subjectId && a.date === date && a.type === type && a.session === session);
    
    // For teachers marking sick/permission, set approval to pending
    const approvalStatus = (type === 'teacher' && (status === 'sick' || status === 'permission')) ? 'pending' : undefined;
    
    // Generate a consistent ID so the link works (in a real DB this comes from backend)
    const recordId = existing ? existing.id : Math.random().toString(36).substr(2, 9);

    const newRecord: Attendance = {
      id: recordId,
      userId: subjectId,
      date,
      session,
      status,
      type,
      approvalStatus: existing?.approvalStatus || approvalStatus,
      lateReason: existing?.lateReason || lateReasonToSave
    };
    onMarkAttendance(newRecord);

    // --- WhatsApp Integration for Teacher Permissions (Magic Links) ---
    if (type === 'teacher' && (status === 'sick' || status === 'permission')) {
        const sessionLabel = session === 'pagi' ? 'Pagi' : 'Malam';
        const typeLabel = status === 'sick' ? 'Sakit' : 'Izin';
        
        // Generate Magic Links
        const baseUrl = window.location.origin + window.location.pathname;
        const approveLink = `${baseUrl}?action=approve&id=${recordId}&name=${encodeURIComponent(user.name)}&date=${date}&session=${session}`;
        const rejectLink = `${baseUrl}?action=reject&id=${recordId}&name=${encodeURIComponent(user.name)}&date=${date}&session=${session}`;

        const message = `Assalamu'alaikum Admin,\n\nSaya *${user.name}* izin tidak hadir hari ini (${date}) sesi *${sessionLabel}* dikarenakan *${typeLabel}*.\n\nMohon persetujuannya:\n\n✅ *SETUJUI* (Klik link ini):\n${approveLink}\n\n❌ *TOLAK* (Klik link ini):\n${rejectLink}`;
        
        if (confirm("Buka WhatsApp untuk mengirim izin ke Admin?")) {
            window.open(`https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`, '_blank');
        }
    }
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
          
          // Remove non-numeric characters for link
          const cleanPhone = subjectPhone.replace(/\D/g, '');
          
          if (confirm(`Buka WhatsApp untuk notifikasi ke Guru (${cleanPhone})?`)) {
             window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
          }
      } else {
          alert("Nomor HP Guru tidak terdaftar, tidak bisa kirim WA otomatis.");
      }
  };

  const handleSubmitRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lateReason.trim()) return alert('Mohon isi keterangan keterlambatan!');
    
    if (onMarkOpenRequest) {
      const newReq: AttendanceOpenRequest = {
        id: 'req_' + Math.random().toString(36).substr(2, 9),
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
      const message = `Assalamu'alaikum Admin,\n\nSaya *${user.name}* memohon akses buka absensi *${typeLabel}* untuk tanggal *${date}* sesi *${sessionLabel}*.\n\nAlasan Terlambat: *${newReq.lateReason}*\n\nMohon persetujuannya di sistem SITA Darul Abror.`;
      
      if (confirm("Kirim pengajuan akses buka absen ke Admin via WhatsApp?")) {
        window.open(`https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`, '_blank');
      }
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
        
        const cleanPhone = teacher.phoneNumber.replace(/\D/g, '');
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

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
           <h2 className="font-bold text-gray-800">Absensi {type === 'student' ? 'Santri' : 'Guru'}</h2>
           <p className="text-sm text-gray-500">Pilih tanggal dan sesi halaqah</p>
        </div>
        
        <div className="flex gap-4 items-center flex-wrap justify-end">
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
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    session === 'pagi' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <Sun size={16} /> Pagi
                </button>
                <button
                    onClick={() => setSession('malam')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    session === 'malam' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <Moon size={16} /> Malam
                </button>
            </div>
            
            <input 
            type="date" 
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border rounded-lg p-2 text-sm bg-gray-50 focus:outline-primary h-10"
            />
        </div>
      </div>

      {user.role === 'admin' && openRequests.filter(r => r.status === 'pending').length > 0 && (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-amber-200 bg-amber-50/10 space-y-3">
            <h3 className="font-bold text-amber-800 flex items-center gap-2 text-sm">
                <Clock className="text-amber-600" size={18} />
                Permintaan Akses Buka Absensi Terlambat ({openRequests.filter(r => r.status === 'pending').length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {openRequests.filter(r => r.status === 'pending').map(req => {
                    const teacher = users.find(u => u.id === req.teacherId);
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {subjectList.map((subject) => {
          const record = attendance.find(a => a.userId === subject.id && a.date === date && a.type === type && a.session === session);
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
                      <div className="w-full p-2.5 rounded-lg border border-dashed border-gray-200 bg-gray-50 text-gray-400 flex items-center justify-center gap-1.5 font-bold text-xs">
                          <Lock size={14} /> ABSENSI TERKUNCI (DILUAR JAM)
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
                        if (text === "SITA_ABSENSI_GURU_TETAP") {
                            handleStatusClick(user.id, 'present');
                            setShowScanner(false);
                            alert("Absensi berhasil dicatat: HADIR.");
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
    </div>
  );
};

export default AttendanceView;
