
import React, { useState, useEffect } from 'react';
import { User, Role, Student, TahfidzRecord, Attendance, Exam } from './types';
import { MOCK_USERS, MOCK_STUDENTS, MOCK_RECORDS, MOCK_ATTENDANCE, MOCK_EXAMS, LOGO_URL, GOOGLE_SCRIPT_URL } from './constants';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import TahfidzLog from './components/TahfidzLog';
import AttendanceView from './components/Attendance';
import ExamView from './components/ExamView';
import AdminPanel from './components/AdminPanel';
import ReportsView from './components/ReportsView';
import ProfileSettings from './components/ProfileSettings';
import TutorialGuide from './components/TutorialGuide';
import { User as UserIcon, Lock, AlertCircle, ArrowRight, CheckCircle2, XCircle, Loader2, WifiOff, Camera, X, Sun, Moon, Check, Wifi, RefreshCw } from 'lucide-react';
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
        <div className="text-center mb-8">
          <div className="w-24 h-24 mx-auto mb-4 relative bg-gray-50 rounded-full p-2 flex items-center justify-center border border-gray-100 shadow-sm overflow-hidden">
             <img 
                src={LOGO_URL} 
                alt="Logo" 
                className="w-full h-full object-contain" 
                onError={(e) => { (e.target as HTMLImageElement).src = 'https://cdn-icons-png.flaticon.com/512/3063/3063206.png'; }} 
             />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Darul Abror IBS</h1>
          <p className="text-emerald-600 font-medium text-sm mt-1">Sistem Informasi Tahfidz</p>
        </div>
        {connectionError && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                <WifiOff className="text-orange-500 shrink-0 mt-0.5" size={20} />
                <div className="flex-1">
                    <h3 className="font-bold text-orange-700 text-sm">Mode Offline</h3>
                    <p className="text-xs text-orange-600 mt-1 leading-relaxed">
                      {connectionError === 'no_url' ? "Database belum dikonfigurasi." : "Gagal sinkron data cloud."}
                    </p>
                    {connectionError === 'no_url' && (
                      <button 
                        type="button"
                        onClick={onOpenDbConfig}
                        className="mt-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 underline block text-left"
                      >
                        Hubungkan ke Supabase Sekarang
                      </button>
                    )}
                </div>
            </div>
        )}
        <form onSubmit={handleLogin} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username / NIS</label>
                <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full pl-10 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Username atau NIS Santri" required />
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full pl-10 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Masukkan password" required />
                </div>
            </div>
            {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2"><AlertCircle size={16} />{error}</div>}
            <button type="submit" disabled={isLoadingData && !users.length} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 mt-4 disabled:opacity-70">
                {isLoadingData && !users.length ? <><Loader2 size={20} className="animate-spin" /> Memuat...</> : <>Masuk Sistem <ArrowRight size={20} /></>}
            </button>
        </form>

        <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-gray-100"></div>
            <span className="flex-shrink-0 mx-4 text-xs text-gray-400 font-medium">Atau</span>
            <div className="flex-grow border-t border-gray-100"></div>
        </div>

        <button 
            type="button" 
            onClick={() => { setShowQuickScan(true); setScanStep(0); }}
            className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
        >
            <Camera size={20} /> Absen Cepat (Scan QR)
        </button>

        <div className="mt-8 text-center border-t border-gray-100 pt-6">
          <p className="text-xs text-gray-400 font-medium">© 2025. Darul Abror IBS V.1</p>
          <button 
            type="button"
            onClick={onOpenDbConfig}
            className="text-[11px] text-emerald-600 hover:text-emerald-700 font-bold mt-2.5 hover:underline transition-all block mx-auto"
          >
            ⚙️ Pengaturan Database (Supabase)
          </button>
        </div>
      </div>

      {/* QUICK SCAN MODAL */}
      {showQuickScan && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl relative animate-fade-in">
                <button onClick={() => setShowQuickScan(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 z-10"><X size={20}/></button>
                
                {scanStep === 0 && (
                    <>
                        <h3 className="font-bold text-lg text-gray-800 mb-4 text-center">Scan QR Code Absensi</h3>
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
                    </>
                )}

                {scanStep === 1 && (
                    <div className="space-y-4">
                        <div className="text-center mb-4">
                            <CheckCircle2 size={48} className="mx-auto text-green-500 mb-2" />
                            <h3 className="font-bold text-lg text-gray-800">QR Code Valid!</h3>
                            <p className="text-sm text-gray-500">Silakan pilih nama Anda untuk hadir.</p>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Nama Guru</label>
                            <select 
                                className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
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
                            <label className="block text-sm font-bold text-gray-700 mb-1">Sesi Halaqah</label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setQuickSession('pagi')}
                                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
                                        quickSession === 'pagi' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-gray-50 text-gray-500 border-gray-200'
                                    }`}
                                >
                                    <Sun size={16} /> Pagi
                                </button>
                                <button
                                    onClick={() => setQuickSession('malam')}
                                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
                                        quickSession === 'malam' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-gray-50 text-gray-500 border-gray-200'
                                    }`}
                                >
                                    <Moon size={16} /> Malam
                                </button>
                            </div>
                        </div>

                        <button 
                            onClick={() => {
                                if (!quickUserId) return alert("Pilih nama Anda terlebih dahulu!");
                                const att: Attendance = {
                                    id: 'att_' + Math.random().toString(36).substr(2, 9),
                                    userId: quickUserId,
                                    date: new Date().toISOString().split('T')[0],
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
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl flex justify-center items-center gap-2 disabled:opacity-50 mt-4"
                        >
                            <Check size={20} /> Simpan Kehadiran
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
    if (user) window.localStorage.setItem('sita_current_user_v1', JSON.stringify(user));
    else window.localStorage.removeItem('sita_current_user_v1');
  }, [user]);

  useEffect(() => { window.localStorage.setItem('sita_active_tab_v1', activeTab); }, [activeTab]);
  
  const [users, setUsers] = useStickyState<User[]>(MOCK_USERS, 'sita_users_v1');
  const [students, setStudents] = useStickyState<Student[]>(MOCK_STUDENTS, 'sita_students_v1');
  const [records, setRecords] = useStickyState<TahfidzRecord[]>(MOCK_RECORDS, 'sita_records_v1');
  const [attendance, setAttendance] = useStickyState<Attendance[]>(MOCK_ATTENDANCE, 'sita_attendance_v1');
  const [exams, setExams] = useStickyState<Exam[]>(MOCK_EXAMS, 'sita_exams_v1');

  const [isLoadingData, setIsLoadingData] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [showDbConfig, setShowDbConfig] = useState(false);

  const [queueLength, setQueueLength] = useState(api.getQueueLength());
  const [isSyncing, setIsSyncing] = useState(api.isSyncing());
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const unsubscribe = api.subscribe((len, syncing, lastError) => {
      setQueueLength(len);
      setIsSyncing(syncing);
      setSyncError(lastError);
    });
    return unsubscribe;
  }, []);

  // Handle WhatsApp approval/rejection magic links
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const id = params.get('id');
    
    if ((action === 'approve' || action === 'reject') && id && attendance.length > 0 && user?.role === 'admin') {
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
  }, [attendance, user, users]);

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
     const fetchData = async () => {
        const hasEnv = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY;
        const hasLocal = window.localStorage.getItem('sita_supabase_url') && window.localStorage.getItem('sita_supabase_anon_key');
        if (!hasEnv && !hasLocal) { setConnectionError('no_url'); return; }
        setIsLoadingData(true);
        try {
            const data = await api.load(user);
            if (data) {
               setUsers(data.users || []);
               setStudents(data.students || []);
               
               setRecords(data.records ? data.records.map((r: any) => ({ ...r, studentId: cleanId(r.studentId) })) : []);
               setAttendance(data.attendance ? data.attendance.map((a: any) => ({ ...a, userId: cleanId(a.userId) })) : []);
               setExams(data.exams ? data.exams.map((e: any) => ({ ...e, studentId: cleanId(e.studentId) })) : []);
               
               setConnectionError(null);
            } else setConnectionError('fetch_failed');
        } catch (e) {
            setConnectionError('fetch_failed');
        } finally {
            setIsLoadingData(false);
        }
     };
     fetchData();
  }, [user, setUsers, setStudents, setRecords, setAttendance, setExams]);

  const handleAddRecord = (newRecord: TahfidzRecord) => {
    setRecords(prev => [newRecord, ...prev]);
    const student = students.find(s => s.id === newRecord.studentId);
    api.send('addRecord', { 
        ...newRecord, 
        studentId: student ? `${student.id} | ${student.name}` : newRecord.studentId,
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
      case 'ziyadah': return <TahfidzLog key="ziyadah" user={user!} students={students} records={records} onAddRecord={handleAddRecord} onDeleteRecord={handleDeleteRecord} defaultTab="sabaq" allowedTabs={['sabaq']} />;
      case 'murojaah': return <TahfidzLog key="murojaah" user={user!} students={students} records={records} onAddRecord={handleAddRecord} onDeleteRecord={handleDeleteRecord} defaultTab="sabqi" allowedTabs={['sabqi', 'manzil']} />;
      case 'master_data': return <AdminPanel users={users} students={students} onAddUser={(u) => { setUsers(prev => [...prev, u]); api.send('addUser', u); }} onDeleteUser={handleDeleteUser} onUpdateUser={handleUpdateUser} onAddStudent={(s) => { setStudents(prev => [...prev, s]); api.send('addStudent', s); }} onDeleteStudent={handleDeleteStudent} onUpdateStudent={handleUpdateStudent} onBulkAddStudents={(s) => { setStudents(prev => [...prev, ...s]); s.forEach(item => api.send('addStudent', item)); }} onBulkAddUsers={(u) => { setUsers(prev => [...prev, ...u]); u.forEach(item => api.send('addUser', item)); }} onBulkAddRecords={(r) => { setRecords(prev => [...r, ...prev]); r.forEach(item => { const student = students.find(st => st.id === item.studentId); api.send('addRecord', { ...item, studentId: student ? `${student.id} | ${student.name}` : item.studentId, class: student?.class || '-' }); }); }} />;
      case 'reports': return <ReportsView user={user!} students={students} records={records} users={users} attendance={attendance} />;
      case 'attendance_student': return <AttendanceView user={user!} students={students} users={users} attendance={attendance} onMarkAttendance={handleMarkAttendance} onDeleteAttendance={handleDeleteAttendance} type="student" />;
      case 'attendance_teacher': case 'attendance_self': return <AttendanceView user={user!} students={students} users={users} attendance={attendance} onMarkAttendance={handleMarkAttendance} onDeleteAttendance={handleDeleteAttendance} type="teacher" />;
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
      <SyncStatusWidget queueLength={queueLength} isSyncing={isSyncing} isOnline={isOnline} syncError={syncError} />
      {showDbConfig && <DatabaseConfigModal onClose={() => setShowDbConfig(false)} />}
    </>
  );
};

const SyncStatusWidget = ({ queueLength, isSyncing, isOnline, syncError }: { queueLength: number, isSyncing: boolean, isOnline: boolean, syncError: string | null }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (queueLength === 0) {
    if (!isOnline) {
      return (
        <div className="fixed bottom-4 right-4 z-50 pointer-events-auto no-print">
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-xl shadow-lg flex items-center gap-2 text-xs font-semibold animate-fade-in">
            <WifiOff className="text-red-500 shrink-0" size={14} />
            <span>Mode Offline (Terkoneksi Lokal)</span>
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
          <span>Sistem Sinkron (Online)</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs w-full pointer-events-auto no-print">
      <div className={`border rounded-2xl shadow-xl p-4 transition-all duration-300 animate-fade-in ${
        !isOnline 
          ? 'bg-red-50 border-red-200 text-red-800' 
          : 'bg-orange-50 border-orange-200 text-orange-800'
      }`}>
        <div className="flex items-start gap-3 justify-between">
          <div className="flex gap-2">
            {!isOnline ? (
              <WifiOff className="text-red-500 shrink-0 mt-0.5" size={18} />
            ) : (
              <RefreshCw className={`text-orange-500 shrink-0 mt-0.5 ${isSyncing ? 'animate-spin' : ''}`} size={18} />
            )}
            <div>
              <h4 className="font-bold text-sm">
                {!isOnline ? 'Koneksi Terputus (Offline)' : 'Sinkronisasi Tertunda'}
              </h4>
              <p className="text-xs mt-1 font-medium opacity-90">
                Ada {queueLength} data baru disimpan lokal.
              </p>
              {syncError && (
                <p className="text-[10px] text-red-600 bg-red-100/50 p-1.5 rounded-lg mt-1 font-mono break-all leading-normal border border-red-200">
                  Detail Error: {syncError}
                </p>
              )}
            </div>
          </div>
          <button onClick={() => setIsOpen(!isOpen)} className="text-gray-400 hover:text-gray-600 transition-colors">
            <AlertCircle size={16} />
          </button>
        </div>

        {isOpen && (
          <div className="mt-3 pt-3 border-t border-black/10 text-[10px] leading-relaxed opacity-80">
            Aplikasi SITA mendukung penuh mode offline. Anda tetap bisa melakukan absensi QR atau mencatat hafalan secara lokal. Data aman disimpan di perangkat ini dan akan langsung disinkronkan otomatis saat terhubung internet kembali.
          </div>
        )}

        {isOnline && (
          <div className="flex gap-2 mt-3">
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
              onClick={() => api.processQueue()}
              disabled={isSyncing}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-xl text-xs transition-colors flex items-center justify-center gap-1 shadow-sm disabled:opacity-50"
            >
              {isSyncing ? (
                <>
                  <RefreshCw size={12} className="animate-spin" /> Menyinkronkan...
                </>
              ) : (
                'Sinkron'
              )}
            </button>
          </div>
        )}
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
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl relative animate-fade-in border border-gray-100">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <X size={20}/>
        </button>
        
        <h3 className="font-bold text-lg text-gray-800 mb-2 flex items-center gap-2">
          ⚙️ Pengaturan Koneksi Supabase
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Masukkan kredensial API Supabase Anda untuk menghubungkan aplikasi secara langsung.
        </p>

        {isSaved ? (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-center font-bold text-sm animate-pulse">
            ✓ Berhasil Disimpan! Memuat ulang sistem...
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                VITE_SUPABASE_URL
              </label>
              <input 
                type="url" 
                value={url} 
                onChange={(e) => setUrl(e.target.value)} 
                className="w-full border border-gray-300 rounded-xl p-3 text-xs font-mono focus:ring-2 focus:ring-emerald-500 outline-none" 
                placeholder="https://your-project-id.supabase.co" 
                required 
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                VITE_SUPABASE_ANON_KEY (Anon Key / Publishable Key)
              </label>
              <textarea 
                value={key} 
                onChange={(e) => setKey(e.target.value)} 
                className="w-full border border-gray-300 rounded-xl p-3 text-xs font-mono h-24 focus:ring-2 focus:ring-emerald-500 outline-none" 
                placeholder="Paste Publishable Key (anon) di sini" 
                required 
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button 
                type="button" 
                onClick={handleReset}
                className="flex-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold py-2.5 rounded-xl text-xs transition-all"
              >
                Reset Default
              </button>
              <button 
                type="submit" 
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs transition-all"
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
