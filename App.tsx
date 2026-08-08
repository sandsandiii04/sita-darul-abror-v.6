
import React, { useState, useEffect } from 'react';
import { User, Role, Student, TahfidzRecord, Attendance, Exam, AttendanceOpenRequest } from './types';
import { MOCK_USERS, MOCK_STUDENTS, MOCK_RECORDS, MOCK_ATTENDANCE, MOCK_EXAMS, LOGO_URL, GOOGLE_SCRIPT_URL, getLocalDateString } from './constants';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import TahfidzLog from './components/TahfidzLog';
import AttendanceView from './components/Attendance';
import ExamView from './components/ExamView';
import AdminPanel from './components/AdminPanel';
import ReportsView from './components/ReportsView';
import ProfileSettings from './components/ProfileSettings';
import TutorialGuide from './components/TutorialGuide';
import { User as UserIcon, Lock, AlertCircle, ArrowRight, CheckCircle2, XCircle, Loader2, WifiOff, Camera, X, Sun, Moon, Check, Wifi, RefreshCw, AlertTriangle } from 'lucide-react';
import QRScanner from './components/QRScanner';
import { api } from './api';

const LoginScreen = ({ onLogin, users, students, isLoadingData, connectionError, onQuickAttendance, onOpenDbConfig }: { onLogin: (user: User) => void, users: User[], students: Student[], isLoadingData: boolean, connectionError: string | null, onQuickAttendance: (att: Attendance) => void, onOpenDbConfig: () => void }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showQuickScan, setShowQuickScan] = useState(false);
  const [scanStep, setScanStep] = useState(0);
  const [quickUserId, setQuickUserId] = useState('');
  const [quickSession, setQuickSession] = useState<'pagi'|'malam'>('pagi');

  const teachers = users.filter(u => u.role === 'teacher');

  useEffect(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('absen') === 'guru') {
          setShowQuickScan(true);
          setScanStep(1); // Langsung ke form pilih nama
      }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.login(username, password);
      if (res.success && res.data) {
        onLogin(res.data);
      } else {
        setError(res.message || 'Username atau password salah.');
      }
    } catch (err: any) {
      setError('Gagal menghubungi server login.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Decorative Blur Orbs */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-teal-500/10 blur-[120px] pointer-events-none" />

      <div className="bg-white/95 backdrop-blur-xl p-8 md:p-10 rounded-3xl shadow-premium shadow-black/20 w-full max-w-md border border-white/20 relative z-10 transition-all duration-300 hover:shadow-glow/10">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 relative bg-slate-50/50 rounded-2xl p-2 flex items-center justify-center border border-slate-100 shadow-sm overflow-hidden">
             <img 
                src={LOGO_URL} 
                alt="Logo" 
                className="w-full h-full object-contain" 
                onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn-icons-png.flaticon.com/512/3063/3063206.png'; }} 
             />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Darul Abror IBS</h1>
          <p className="text-emerald-600 font-semibold text-xs tracking-wider uppercase mt-1">Sistem Informasi Tahfidz</p>
        </div>

        {connectionError && (
            <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 mb-6 flex items-start gap-3">
                <WifiOff className="text-orange-500 shrink-0 mt-0.5" size={18} />
                <div className="flex-1">
                    <h3 className="font-bold text-orange-800 text-xs">Mode Offline</h3>
                    <p className="text-[11px] text-orange-600 mt-0.5 leading-relaxed">
                      {connectionError === 'no_url' ? "Database belum dikonfigurasi." : "Gagal sinkron data cloud."}
                    </p>
                    {connectionError === 'no_url' && (
                      <button 
                        type="button"
                        onClick={onOpenDbConfig}
                        className="mt-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 underline block text-left"
                      >
                        Hubungkan ke Supabase Sekarang
                      </button>
                    )}
                </div>
            </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
            <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Username / NIS</label>
                <div className="relative group">
                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
                <input 
                  type="text" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)} 
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all duration-200 text-sm placeholder:text-slate-400 font-medium" 
                  placeholder="Username atau NIS" 
                  required 
                />
                </div>
            </div>
            <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Password</label>
                <div className="relative group">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
                <input 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all duration-200 text-sm placeholder:text-slate-400 font-medium" 
                  placeholder="Password" 
                  required 
                />
                </div>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 border border-red-100 p-3 rounded-xl text-xs flex items-center gap-2 animate-fade-in font-medium">
                <AlertCircle size={14} className="shrink-0" />
                {error}
              </div>
            )}

            <button 
              type="submit" 
              disabled={isLoadingData && !users.length} 
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl transition-all duration-300 transform hover:scale-[1.01] active:scale-[0.99] hover:shadow-lg hover:shadow-emerald-600/20 flex items-center justify-center gap-2 mt-6 disabled:opacity-70 disabled:hover:scale-100"
            >
                {isLoadingData && !users.length ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> 
                    <span>Memuat...</span>
                  </>
                ) : (
                  <>
                    <span>Masuk Sistem</span> 
                    <ArrowRight size={18} />
                  </>
                )}
            </button>
        </form>

        <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-slate-100"></div>
            <span className="flex-shrink-0 mx-4 text-[10px] text-slate-400 font-bold tracking-widest uppercase">Atau</span>
            <div className="flex-grow border-t border-slate-100"></div>
        </div>

        <button 
            type="button" 
            onClick={() => { setShowQuickScan(true); setScanStep(0); }}
            className="w-full bg-indigo-50/50 hover:bg-indigo-50 active:bg-indigo-100/70 text-indigo-700 border border-indigo-100 font-bold py-3.5 rounded-xl transition-all duration-300 transform hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
        >
            <Camera size={18} /> Absen Cepat (Scan QR)
        </button>

        <div className="mt-8 text-center border-t border-slate-100 pt-6">
          <p className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">© 2025. Darul Abror IBS V.1</p>
          <button 
            type="button"
            onClick={onOpenDbConfig}
            className="text-[11px] text-emerald-600 hover:text-emerald-700 font-bold mt-2.5 hover:underline transition-all block mx-auto py-1 px-3 rounded-lg hover:bg-emerald-50/50 w-fit"
          >
            ⚙️ Pengaturan Database (Supabase)
          </button>
        </div>
      </div>

      {/* QUICK SCAN MODAL */}
      {showQuickScan && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex flex-col items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl relative animate-fade-in border border-slate-100">
                <button 
                  onClick={() => setShowQuickScan(false)} 
                  className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 hover:bg-slate-100 p-1.5 rounded-full"
                >
                  <X size={18}/>
                </button>
                
                {scanStep === 0 && (
                    <>
                        <h3 className="font-extrabold text-lg text-slate-800 mb-4 text-center">Scan QR Code Absensi</h3>
                        <div className="overflow-hidden rounded-2xl border border-slate-100">
                          <QRScanner 
                              onScanSuccess={(text) => {
                                  console.log("Berhasil scan:", text);
                                  if (text.trim() === "SITA_ABSENSI_GURU_TETAP" || text.includes("absen=guru")) {
                                      setScanStep(1); // Proceed to form
                                  } else {
                                      alert(`QR Code tidak valid: ${text}`);
                                  }
                              }} 
                          />
                        </div>
                    </>
                )}

                {scanStep === 1 && (
                    <div className="space-y-4">
                        <div className="text-center mb-4">
                            <CheckCircle2 size={44} className="mx-auto text-green-500 mb-2" />
                            <h3 className="font-extrabold text-lg text-slate-800">QR Code Valid!</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Silakan pilih nama Anda untuk absensi hadir.</p>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Nama Guru</label>
                            <select 
                                className="w-full border border-slate-200 bg-slate-50 rounded-xl p-3 text-sm font-medium focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 focus:bg-white outline-none transition-all"
                                value={quickUserId}
                                onChange={(e) => setQuickUserId(e.target.value)}
                            >
                                <option value="">-- Pilih Nama --</option>
                                {teachers.map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Sesi Halaqah</label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setQuickSession('pagi')}
                                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold transition-all border ${
                                        quickSession === 'pagi' 
                                          ? 'bg-orange-50 text-orange-600 border-orange-200 shadow-sm' 
                                          : 'bg-slate-50 text-slate-500 border-slate-200/60 hover:bg-slate-100'
                                    }`}
                                >
                                    <Sun size={14} /> Pagi
                                </button>
                                <button
                                    onClick={() => setQuickSession('malam')}
                                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold transition-all border ${
                                        quickSession === 'malam' 
                                          ? 'bg-indigo-50 text-indigo-600 border-indigo-200 shadow-sm' 
                                          : 'bg-slate-50 text-slate-500 border-slate-200/60 hover:bg-slate-100'
                                    }`}
                                >
                                    <Moon size={14} /> Malam
                                </button>
                            </div>
                        </div>

                        <button 
                            onClick={() => {
                                if (!quickUserId) return alert("Pilih nama Anda terlebih dahulu!");
                                const att: Attendance = {
                                    id: 'att_' + Math.random().toString(36).substr(2, 9),
                                    userId: quickUserId,
                                    date: getLocalDateString(),
                                    session: quickSession,
                                    status: 'present',
                                    type: 'teacher'
                                };
                                onQuickAttendance(att);
                                setShowQuickScan(false);
                                setQuickUserId('');
                                
                                // Clean up URL if it was accessed via direct link
                                if (window.location.search.includes('absen=guru')) {
                                    window.history.replaceState({}, document.title, window.location.pathname);
                                }
                                
                                alert("Berhasil! Kehadiran Anda telah dicatat.");
                            }}
                            disabled={!quickUserId}
                            className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl transition-all duration-300 flex justify-center items-center gap-2 disabled:opacity-50 disabled:hover:from-emerald-600 shadow-lg shadow-emerald-600/10 mt-4"
                        >
                            <Check size={18} /> Simpan Kehadiran
                        </button>
                    </div>
                )}
            </div>
        </div>
      )}
    </div>
  );
};

const useStickyState = <T,>(defaultValue: T, key: string): [T, React.Dispatch<React.SetStateAction<T>>] => {
  const [value, setValue] = useState<T>(() => {
    const stickyValue = window.localStorage.getItem(key);
    return stickyValue !== null ? JSON.parse(stickyValue) : defaultValue;
  });
  useEffect(() => { window.localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue];
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(() => {
      const savedUser = window.localStorage.getItem('sita_current_user_v1');
      return savedUser ? JSON.parse(savedUser) : null;
  });
  const [activeTab, setActiveTab] = useState(() => window.localStorage.getItem('sita_active_tab_v1') || 'dashboard');

  useEffect(() => {
    if (user) {
      window.localStorage.setItem('sita_current_user_v1', JSON.stringify(user));
      const parentTabs = ['dashboard', 'ziyadah', 'murojaah', 'exam', 'attendance_student', 'reports', 'profile'];
      const teacherTabs = ['dashboard', 'ziyadah', 'murojaah', 'attendance_student', 'exam', 'reports', 'attendance_self', 'profile'];
      
      if (user.role === 'parent' && !parentTabs.includes(activeTab)) {
        setActiveTab('dashboard');
      } else if (user.role === 'teacher' && !teacherTabs.includes(activeTab)) {
        setActiveTab('dashboard');
      }
    } else {
      window.localStorage.removeItem('sita_current_user_v1');
    }
  }, [user, activeTab]);

  useEffect(() => { window.localStorage.setItem('sita_active_tab_v1', activeTab); }, [activeTab]);
  
  const [users, setUsers] = useStickyState<User[]>(MOCK_USERS, 'sita_users_v1');
  const [students, setStudents] = useStickyState<Student[]>(MOCK_STUDENTS, 'sita_students_v1');
  const [records, setRecords] = useStickyState<TahfidzRecord[]>(MOCK_RECORDS, 'sita_records_v1');
  const [attendance, setAttendance] = useStickyState<Attendance[]>(MOCK_ATTENDANCE, 'sita_attendance_v1');
  const [exams, setExams] = useStickyState<Exam[]>(MOCK_EXAMS, 'sita_exams_v1');
  const [attendanceOpenRequests, setAttendanceOpenRequests] = useStickyState<AttendanceOpenRequest[]>([], 'sita_attendance_open_requests_v1');

  const [isLoadingData, setIsLoadingData] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [showDbConfig, setShowDbConfig] = useState(false);

  const [queueLength, setQueueLength] = useState(api.getQueueLength());
  const [failedQueueLength, setFailedQueueLength] = useState(0);
  const [isSyncing, setIsSyncing] = useState(api.isSyncing());
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    // Ambil jumlah antrean gagal awal
    try {
      const q = localStorage.getItem('sita_failed_queue_v2');
      if (q) setFailedQueueLength(JSON.parse(q).length);
    } catch (e) {}

    const unsubscribe = api.subscribe((len, syncing, lastError, failedLen) => {
      setQueueLength(len);
      setIsSyncing(syncing);
      setSyncError(lastError);
      setFailedQueueLength(failedLen);
    });
    return unsubscribe;
  }, []);

  // Handle WhatsApp approval/rejection magic links
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const id = params.get('id');
    
    if ((action === 'approve' || action === 'reject') && id && attendance.length > 0) {
      if (!user || user.role !== 'admin') {
        alert("Akses Ditolak: Hanya Admin yang dapat menyetujui atau menolak pengajuan ini! Silakan login sebagai Admin.");
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        const targetAtt = attendance.find(a => a.id === id);
        if (targetAtt) {
          if (targetAtt.approvalStatus !== 'approved' && targetAtt.approvalStatus !== 'rejected') {
            const updatedStatus = action === 'approve' ? 'approved' : 'rejected';
            const updatedAtt: Attendance = {
              ...targetAtt,
              approvalStatus: updatedStatus
            };
            
            // Update state
            setAttendance(prev => prev.map(a => a.id === id ? updatedAtt : a));
            
            // Sync to cloud
            const teacher = users.find(u => u.id === targetAtt.userId);
            api.send('markAttendance', {
              ...updatedAtt,
              userId: teacher ? `${teacher.id} | ${teacher.name}` : targetAtt.userId,
              class: 'GURU'
            });
            
            alert(`Absensi Guru ${params.get('name') || ''} telah berhasil ${action === 'approve' ? 'DISETUJUI' : 'DITOLAK'}!`);
          }
          // Clear query parameters
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    }

    // Magic links untuk buka akses absen terlambat
    if ((action === 'approveRequest' || action === 'rejectRequest') && id && attendanceOpenRequests.length > 0) {
      if (!user || user.role !== 'admin') {
        alert("Akses Ditolak: Hanya Admin yang dapat menyetujui atau menolak permohonan ini! Silakan login sebagai Admin.");
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        const targetReq = attendanceOpenRequests.find(r => r.id === id);
        if (targetReq) {
          if (targetReq.status === 'pending') {
            const updatedStatus = action === 'approveRequest' ? 'approved' : 'rejected';
            const updatedReq: AttendanceOpenRequest = {
              ...targetReq,
              status: updatedStatus
            };
            
            // Update state
            setAttendanceOpenRequests(prev => prev.map(r => r.id === id ? updatedReq : r));
            
            // Sync to cloud
            const teacher = users.find(u => u.id === targetReq.teacherId);
            api.send('addAttendanceOpenRequest', {
              ...updatedReq,
              teacherId: teacher ? `${teacher.id} | ${teacher.name}` : targetReq.teacherId
            });
            
            alert(`Permintaan akses absen Guru ${params.get('name') || ''} telah berhasil ${action === 'approveRequest' ? 'DISETUJUI' : 'DITOLAK'}!`);
          }
          // Clear query parameters
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    }
  }, [attendance, attendanceOpenRequests, user, users]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      api.processQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      api.processQueue();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const cleanId = (id: any) => {
      if (id === null || id === undefined) return '';
      return id.toString().split(' | ')[0].trim();
  };

  useEffect(() => {
     const fetchData = async (isSilent = false) => {
        // api.ts will fall back to default credentials if neither env nor local storage variables are defined
        // so we don't block the data loading logic.
        if (!isSilent) setIsLoadingData(true);
        try {
            const data = await api.load(user);
            if (data) {
               setUsers(data.users || []);
               setStudents(data.students || []);
               
               setRecords(data.records ? data.records.map((r: any) => ({ ...r, studentId: cleanId(r.studentId) })) : []);
               setAttendance(data.attendance ? data.attendance.map((a: any) => ({ ...a, userId: cleanId(a.userId) })) : []);
               setExams(data.exams ? data.exams.map((e: any) => ({ ...e, studentId: cleanId(e.studentId) })) : []);
               setAttendanceOpenRequests(data.openRequests || []);
               
               setConnectionError(null);
            } else if (!isSilent) setConnectionError('fetch_failed');
        } catch (e) {
            if (!isSilent) setConnectionError('fetch_failed');
        } finally {
            if (!isSilent) setIsLoadingData(false);
        }
     };
     
     fetchData(false);
     
     // Set polling interval 30 detik untuk sinkronisasi data real-time secara background (silent)
     const intervalId = setInterval(() => {
        if (typeof navigator !== 'undefined' && navigator.onLine) {
           fetchData(true);
        }
     }, 30000);
     
     return () => clearInterval(intervalId);
  }, [user, setUsers, setStudents, setRecords, setAttendance, setExams, setAttendanceOpenRequests]);

  const handleAddRecord = (newRecord: TahfidzRecord) => {
    setRecords(prev => [newRecord, ...prev]);
    const student = students.find(s => s.id === newRecord.studentId);
    api.send('addRecord', { 
        ...newRecord, 
        studentId: student ? `${student.id} | ${student.name}` : newRecord.studentId,
        class: student?.class || '-'
    });
  };

  const handleUpdateRecord = (updatedRecord: TahfidzRecord) => {
    setRecords(prev => prev.map(r => r.id === updatedRecord.id ? updatedRecord : r));
    const student = students.find(s => s.id === updatedRecord.studentId);
    api.send('addRecord', { 
        ...updatedRecord, 
        studentId: student ? `${student.id} | ${student.name}` : updatedRecord.studentId,
        class: student?.class || '-'
    });
  };

  const handleDeleteRecord = (id: string) => {
    if (confirm('Hapus data ini?')) {
      setRecords(prev => prev.filter(r => r.id !== id));
      api.send('deleteData', { id, sheetName: 'Records' });
    }
  };

  const handleDeleteAttendance = (id: string) => {
    if (confirm('Batalkan/Hapus absensi ini?')) {
      setAttendance(prev => prev.filter(a => a.id !== id));
      api.send('deleteData', { id, sheetName: 'Attendance' });
    }
  };

  const handleDeleteOpenRequest = (id: string) => {
    if (confirm('Hapus permohonan buka absen terlambat ini?')) {
      setAttendanceOpenRequests(prev => prev.filter(r => r.id !== id));
      api.send('deleteData', { id, sheetName: 'AttendanceOpenRequests' });
    }
  };

  const handleMarkAttendance = (newAtt: Attendance) => {
    setAttendance(prev => {
        const exists = prev.findIndex(a => a.userId === newAtt.userId && a.date === newAtt.date && a.type === newAtt.type && a.session === newAtt.session);
        if (exists >= 0) {
          const updated = [...prev];
          updated[exists] = newAtt;
          return updated;
        }
        return [...prev, newAtt];
    });
    
    const target = newAtt.type === 'student' ? students.find(s => s.id === newAtt.userId) : users.find(u => u.id === newAtt.userId);
    api.send('markAttendance', {
        ...newAtt,
        userId: target ? `${target.id} | ${target.name}` : newAtt.userId,
        class: (newAtt.type === 'student' ? (target as Student)?.class : 'GURU') || '-'
    });
  };

  const handleMarkAttendanceOpenRequest = (newReq: AttendanceOpenRequest) => {
    setAttendanceOpenRequests(prev => {
        const exists = prev.findIndex(r => r.id === newReq.id);
        if (exists >= 0) {
          const updated = [...prev];
          updated[exists] = newReq;
          return updated;
        }
        return [newReq, ...prev];
    });
    
    const teacher = users.find(u => u.id === newReq.teacherId);
    api.send('addAttendanceOpenRequest', {
        ...newReq,
        teacherId: teacher ? `${teacher.id} | ${teacher.name}` : newReq.teacherId
    });
  };

  const handleAddExam = (newExam: Exam) => {
    setExams(prev => [newExam, ...prev]);
    const student = students.find(s => s.id === newExam.studentId);
    api.send('addExam', {
        ...newExam,
        studentId: student ? `${student.id} | ${student.name}` : newExam.studentId,
        studentName: student ? student.name : '-',
        class: student?.class || '-'
    });
  };

  const handleDeleteUser = (id: string) => {
    if(confirm("Hapus user ini?")) {
        setUsers(prev => prev.filter(u => u.id !== id));
        api.send('deleteData', { id, sheetName: 'Users' });
    }
  };

  const handleDeleteStudent = (id: string) => {
    if(confirm("Hapus santri ini?")) {
        setStudents(prev => prev.filter(s => s.id !== id));
        api.send('deleteData', { id, sheetName: 'Students' });
    }
  };

  const handleUpdateUser = (updatedUser: User) => {
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
    api.send('addUser', updatedUser);
  };

  const handleUpdateStudent = (updatedStudent: Student) => {
    setStudents(prev => prev.map(s => s.id === updatedStudent.id ? updatedStudent : s));
    api.send('addStudent', updatedStudent);
  };

  const handleDeleteExam = (id: string) => {
    if(confirm("Hapus data ujian?")) {
        setExams(prev => prev.filter(e => e.id !== id));
        api.send('deleteData', { id, sheetName: 'Exams' });
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard user={user!} students={students} records={records} exams={exams} connectionError={connectionError} onNavigate={setActiveTab} />;
      case 'ziyadah': return <TahfidzLog key="ziyadah" user={user!} students={students} records={records} onAddRecord={handleAddRecord} onDeleteRecord={handleDeleteRecord} onUpdateRecord={handleUpdateRecord} onUpdateStudent={handleUpdateStudent} defaultTab="sabaq" allowedTabs={['sabaq']} />;
      case 'murojaah': return <TahfidzLog key="murojaah" user={user!} students={students} records={records} onAddRecord={handleAddRecord} onDeleteRecord={handleDeleteRecord} onUpdateRecord={handleUpdateRecord} onUpdateStudent={handleUpdateStudent} defaultTab="sabqi" allowedTabs={['sabqi', 'manzil']} />;
      case 'master_data': return <AdminPanel users={users} students={students} onAddUser={(u) => { setUsers(prev => [...prev, u]); api.send('addUser', u); }} onDeleteUser={handleDeleteUser} onUpdateUser={handleUpdateUser} onAddStudent={(s) => { setStudents(prev => [...prev, s]); api.send('addStudent', s); }} onDeleteStudent={handleDeleteStudent} onUpdateStudent={handleUpdateStudent} onBulkAddStudents={(s) => { setStudents(prev => [...prev, ...s]); s.forEach(item => api.send('addStudent', item)); }} onBulkAddUsers={(u) => { setUsers(prev => [...prev, ...u]); u.forEach(item => api.send('addUser', item)); }} onBulkAddRecords={(r) => { setRecords(prev => [...r, ...prev]); r.forEach(item => { const student = students.find(st => st.id === item.studentId); api.send('addRecord', { ...item, studentId: student ? `${student.id} | ${student.name}` : item.studentId, class: student?.class || '-' }); }); }} />;
      case 'reports': return <ReportsView user={user!} students={students} records={records} users={users} attendance={attendance} openRequests={attendanceOpenRequests} onDeleteOpenRequest={handleDeleteOpenRequest} />;
      case 'attendance_student': return <AttendanceView user={user!} students={students} users={users} attendance={attendance} onMarkAttendance={handleMarkAttendance} onDeleteAttendance={handleDeleteAttendance} type="student" openRequests={attendanceOpenRequests} onMarkOpenRequest={handleMarkAttendanceOpenRequest} onDeleteOpenRequest={handleDeleteOpenRequest} />;
      case 'attendance_teacher': case 'attendance_self': return <AttendanceView user={user!} students={students} users={users} attendance={attendance} onMarkAttendance={handleMarkAttendance} onDeleteAttendance={handleDeleteAttendance} type="teacher" openRequests={attendanceOpenRequests} onMarkOpenRequest={handleMarkAttendanceOpenRequest} onDeleteOpenRequest={handleDeleteOpenRequest} />;
      case 'exam': return <ExamView user={user!} students={students} exams={exams} onAddExam={handleAddExam} onDeleteExam={handleDeleteExam} />;
      case 'profile': return <ProfileSettings user={user!} onUpdateUser={(d) => { const updated = {...user!, ...d}; setUser(updated); api.send('updateUser', updated); }} />;
      case 'tutorial': return <TutorialGuide />;
      default: return <Dashboard user={user!} students={students} records={records} exams={exams} connectionError={connectionError} />;
    }
  };

  return (
    <>
      {!user ? (
        <LoginScreen 
          onLogin={setUser} 
          users={users} 
          students={students} 
          isLoadingData={isLoadingData} 
          connectionError={connectionError} 
          onQuickAttendance={handleMarkAttendance} 
          onOpenDbConfig={() => setShowDbConfig(true)}
        />
      ) : (
        <Layout 
          user={user} 
          onLogout={() => setUser(null)} 
          activeTab={activeTab} 
          onTabChange={setActiveTab}
          onOpenDbConfig={() => setShowDbConfig(true)}
        >
          {renderContent()}
        </Layout>
      )}
      <SyncStatusWidget 
        queueLength={queueLength} 
        failedQueueLength={failedQueueLength}
        isSyncing={isSyncing} 
        isOnline={isOnline} 
        syncError={syncError} 
        onOpenDbConfig={() => setShowDbConfig(true)}
      />
      {showDbConfig && <DatabaseConfigModal onClose={() => setShowDbConfig(false)} />}
    </>
  );
};

const SyncStatusWidget = ({ 
  queueLength, 
  failedQueueLength,
  isSyncing, 
  isOnline, 
  syncError,
  onOpenDbConfig
}: { 
  queueLength: number, 
  failedQueueLength: number,
  isSyncing: boolean, 
  isOnline: boolean, 
  syncError: string | null,
  onOpenDbConfig?: () => void
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (queueLength === 0 && failedQueueLength === 0) {
    if (!isOnline) {
      return (
        <div className="fixed bottom-4 right-4 z-50 pointer-events-auto no-print">
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-xl shadow-lg flex items-center gap-2 text-xs font-semibold animate-fade-in">
            <WifiOff className="text-red-500 shrink-0" size={14} />
            <span>Mode Offline</span>
          </div>
        </div>
      );
    }
    return (
      <div className="fixed bottom-4 right-4 z-50 pointer-events-auto no-print">
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded-xl shadow-lg flex items-center gap-2 text-xs font-semibold animate-fade-in">
          <div className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </div>
          <span>Mode Online</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs w-full pointer-events-auto no-print">
      <div className={`border rounded-2xl shadow-xl p-4 transition-all duration-300 animate-fade-in ${
        failedQueueLength > 0
          ? 'bg-rose-50 border-rose-200 text-rose-800'
          : !isOnline 
            ? 'bg-red-50 border-red-200 text-red-800' 
            : 'bg-orange-50 border-orange-200 text-orange-800'
      }`}>
        <div className="flex items-start gap-3 justify-between">
          <div className="flex gap-2">
            {failedQueueLength > 0 ? (
              <AlertTriangle className="text-rose-500 shrink-0 mt-0.5" size={18} />
            ) : !isOnline ? (
              <WifiOff className="text-red-500 shrink-0 mt-0.5" size={18} />
            ) : (
              <RefreshCw className={`text-orange-500 shrink-0 mt-0.5 ${isSyncing ? 'animate-spin' : ''}`} size={18} />
            )}
            <div>
              <h4 className="font-bold text-sm">
                {failedQueueLength > 0 
                  ? 'Sinkronisasi Gagal' 
                  : !isOnline 
                    ? 'Koneksi Terputus (Offline)' 
                    : 'Sinkronisasi Tertunda'}
              </h4>
              <p className="text-xs mt-1 font-medium opacity-90 leading-relaxed">
                {queueLength > 0 && <span>Ada {queueLength} data disimpan lokal.</span>}
                {failedQueueLength > 0 && <span className="block font-semibold text-rose-700">Terdapat {failedQueueLength} data ditolak server.</span>}
              </p>
              {syncError && (
                <div className="mt-1">
                  <p className="text-[10px] text-red-600 bg-red-100/50 p-1.5 rounded-lg font-mono break-all leading-normal border border-red-200">
                    Detail Error: {syncError}
                  </p>
                  {syncError === "Supabase belum dikonfigurasi." && onOpenDbConfig && (
                    <button
                      type="button"
                      onClick={onOpenDbConfig}
                      className="mt-1 text-[10px] font-bold text-emerald-700 hover:text-emerald-800 underline block text-left"
                    >
                      Konfigurasi Supabase Sekarang
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <button onClick={() => setIsOpen(!isOpen)} className="text-gray-400 hover:text-gray-600 transition-colors">
            <AlertCircle size={16} />
          </button>
        </div>

        {isOpen && (
          <div className="mt-3 pt-3 border-t border-black/10 text-[10px] leading-relaxed opacity-80">
            {failedQueueLength > 0 
              ? 'Ada data yang ditolak oleh server database Supabase (misalnya karena duplikasi ID data atau ketidakcocokan format). Data gagal ini aman disimpan secara terpisah dan tidak akan menghalangi data baru lainnya.' 
              : 'Aplikasi SITA mendukung penuh mode offline. Anda tetap bisa melakukan absensi QR atau mencatat hafalan secara lokal. Data aman disimpan di perangkat ini dan akan langsung disinkronkan otomatis saat terhubung internet kembali.'}
          </div>
        )}

        <div className="flex gap-2 mt-3">
          {failedQueueLength > 0 ? (
            <>
              <button
                onClick={() => {
                  if (confirm('Apakah Anda yakin ingin menghapus data gagal? Data ini tidak akan dikirim kembali.')) {
                    api.clearFailedQueue();
                  }
                }}
                className="flex-1 bg-white hover:bg-rose-100 text-rose-600 font-bold py-1.5 px-3 rounded-xl border border-rose-200 text-xs transition-colors flex items-center justify-center gap-1 shadow-sm"
              >
                Hapus Gagal
              </button>
              <button
                onClick={() => {
                  api.retryFailedQueue();
                }}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-1.5 px-3 rounded-xl text-xs transition-colors flex items-center justify-center gap-1 shadow-sm"
              >
                Coba Lagi
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  if (confirm('Apakah Anda yakin ingin menghapus semua antrean data yang belum tersinkronisasi?')) {
                    localStorage.setItem('sita_sync_queue_v2', '[]');
                    window.location.reload();
                  }
                }}
                className="flex-1 bg-white hover:bg-red-50 text-red-600 font-bold py-1.5 px-3 rounded-xl border border-red-200 text-xs transition-colors flex items-center justify-center gap-1 shadow-sm"
              >
                Hapus Antrean
              </button>
              <button
                onClick={() => {
                  if (syncError === "Supabase belum dikonfigurasi." && onOpenDbConfig) {
                    onOpenDbConfig();
                  } else {
                    api.processQueue();
                  }
                }}
                disabled={isSyncing}
                className={`flex-1 font-bold py-1.5 px-3 rounded-xl text-xs transition-colors flex items-center justify-center gap-1 shadow-sm disabled:opacity-50 ${
                  syncError === "Supabase belum dikonfigurasi."
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                {isSyncing ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" /> Menyinkronkan...
                  </>
                ) : syncError === "Supabase belum dikonfigurasi." ? (
                  'Konfigurasi'
                ) : (
                  'Sinkron'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};


// Modal Pengaturan Database Supabase
const DatabaseConfigModal = ({ onClose }: { onClose: () => void }) => {
  const [url, setUrl] = useState(() => window.localStorage.getItem('sita_supabase_url') || '');
  const [key, setKey] = useState(() => window.localStorage.getItem('sita_supabase_anon_key') || '');
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !key) return alert('Mohon isi kedua kolom tersebut!');
    
    window.localStorage.setItem('sita_supabase_url', url.trim());
    window.localStorage.setItem('sita_supabase_anon_key', key.trim());
    setIsSaved(true);
    setTimeout(() => {
      onClose();
      window.location.reload();
    }, 1000);
  };

  const handleReset = () => {
    if (confirm('Apakah Anda yakin ingin menghapus kredensial Supabase dan kembali ke mode default?')) {
      window.localStorage.removeItem('sita_supabase_url');
      window.localStorage.removeItem('sita_supabase_anon_key');
      alert('Kredensial dihapus.');
      onClose();
      window.location.reload();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl relative animate-fade-in border border-slate-100 font-sans">
        <button 
          onClick={onClose} 
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 hover:bg-slate-100 p-1.5 rounded-full"
        >
          <X size={18}/>
        </button>
        
        <h3 className="font-extrabold text-lg text-slate-800 mb-2 flex items-center gap-2">
          ⚙️ Pengaturan Koneksi Supabase
        </h3>
        <p className="text-xs text-slate-500 mb-5 leading-relaxed font-medium">
          Masukkan kredensial API Supabase Anda untuk menghubungkan aplikasi secara langsung ke cloud data.
        </p>

        {isSaved ? (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 p-5 rounded-2xl text-center font-bold text-sm animate-pulse flex items-center justify-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-600" />
            <span>Berhasil Disimpan! Memuat ulang sistem...</span>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                VITE_SUPABASE_URL
              </label>
              <input 
                type="url" 
                value={url} 
                onChange={(e) => setUrl(e.target.value)} 
                className="w-full border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-500 rounded-xl p-3 text-xs font-mono focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all" 
                placeholder="https://your-project-id.supabase.co" 
                required 
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                VITE_SUPABASE_ANON_KEY (Anon Key / Publishable Key)
              </label>
              <textarea 
                value={key} 
                onChange={(e) => setKey(e.target.value)} 
                className="w-full border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-500 rounded-xl p-3 text-xs font-mono h-24 focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all leading-normal resize-none" 
                placeholder="Paste Publishable Key (anon) di sini" 
                required 
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button 
                type="button" 
                onClick={handleReset}
                className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold py-3 rounded-xl text-xs transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99]"
              >
                Reset Default
              </button>
              <button 
                type="submit" 
                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3 rounded-xl text-xs transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99] hover:shadow-lg hover:shadow-emerald-600/15"
              >
                Simpan & Hubungkan
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};


export default App;
