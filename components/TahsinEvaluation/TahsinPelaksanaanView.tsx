import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, 
  Student, 
  TahsinPeriod, 
  TahsinSession, 
  TahsinAttempt 
} from '../../types';
import { tahsinService, formatTahsinPassageDisplay } from '../../services/tahsinService';
import { api, setSessionUser } from '../../api';
import { TahsinExamSheet } from './TahsinExamSheet';
import { 
  Search, 
  Filter, 
  BookOpen, 
  Award, 
  CheckCircle2, 
  AlertTriangle, 
  Play, 
  Clock, 
  Layers, 
  Users, 
  ChevronRight,
  RotateCcw,
  RefreshCw,
  Cloud,
  CloudOff,
  UploadCloud,
  Download,
  Lock
} from 'lucide-react';

interface TahsinPelaksanaanViewProps {
  user: User;
  students: Student[];
  teachers?: User[];
  users?: User[];
}

export const TahsinPelaksanaanView: React.FC<TahsinPelaksanaanViewProps> = ({
  user,
  students,
  teachers = [],
  users
}) => {
  const allTeachers = teachers || users || [];
  const [periods, setPeriods] = useState<TahsinPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [sessions, setSessions] = useState<TahsinSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterClass, setFilterClass] = useState<string>('');
  const [filterHalaqah, setFilterHalaqah] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Active Session for Exam Sheet
  const [activeSession, setActiveSession] = useState<TahsinSession | null>(null);
  const [activeAttemptToEdit, setActiveAttemptToEdit] = useState<TahsinAttempt | null>(null);
  const [activeAttemptType, setActiveAttemptType] = useState<'utama' | 'remedial'>('utama');
  const [activeAttemptNumber, setActiveAttemptNumber] = useState<number>(1);

  // Sync Queue State
  const [effectiveUser, setEffectiveUser] = useState<User>(user);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [conflictSyncCount, setConflictSyncCount] = useState<number>(0);
  const [pendingSyncError, setPendingSyncError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [reauthPassword, setReauthPassword] = useState<string>('');
  const [isReauthenticating, setIsReauthenticating] = useState<boolean>(false);

  useEffect(() => {
    setEffectiveUser(user);
  }, [user]);

  const checkPendingSync = () => {
    tahsinService.reconcileAndRescueLocalSessions();
    const items = tahsinService.getPendingSyncItems(effectiveUser.role === 'admin' ? undefined : effectiveUser.id);
    setPendingSyncCount(items.length);
    setConflictSyncCount(items.filter(i => i.conflictDetected).length);
    const conflictOrErr = items.find(i => i.lastError);
    setPendingSyncError(conflictOrErr?.lastError || null);
    const snap = tahsinService.getSyncStateSnapshot(effectiveUser);
    setAuthRequired(snap.authRequired || (!effectiveUser.sessionToken && !effectiveUser.password && items.length > 0));
  };

  useEffect(() => {
    const unsub = tahsinService.subscribeSync(() => {
      const items = tahsinService.getPendingSyncItems(effectiveUser.role === 'admin' ? undefined : effectiveUser.id);
      const snap = tahsinService.getSyncStateSnapshot(effectiveUser);
      setPendingSyncCount(items.length);
      setConflictSyncCount(items.filter(i => i.conflictDetected).length);
      setIsSyncing(snap.isSyncing);
      const conflictOrErr = items.find(i => i.lastError);
      setPendingSyncError(conflictOrErr?.lastError || snap.lastError);
      setAuthRequired(snap.authRequired || (!effectiveUser.sessionToken && !effectiveUser.password && items.length > 0));
    });
    return unsub;
  }, [effectiveUser]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const res = await tahsinService.syncPendingAttempts(effectiveUser, { forceManual: true });
      const remaining = tahsinService.getPendingSyncCount(effectiveUser.role === 'admin' ? undefined : effectiveUser.id);
      const firstErr = res.details.find((d: any) => d.error)?.error;
      if (res.authRequired) {
        setAuthRequired(true);
        alert(`Sesi login Anda perlu diperbarui sebelum sinkronisasi dapat dikirim ke server.\nSilakan masukkan password Anda pada kolom "Perbarui Sesi Login & Sinkronkan" di atas (data ujian lokal Anda tetap aman dan tidak hilang).`);
      } else {
        alert(`Hasil Sinkronisasi Cloud:\n- Berhasil: ${res.succeeded}\n- Konflik: ${res.conflicts}\n- Gagal: ${res.failed}\n- Sisa Antrean: ${remaining}${firstErr ? '\n\nCatatan: ' + firstErr : ''}`);
      }
      await loadData();
    } catch (err: any) {
      alert(`Terjadi kendala saat sinkronisasi: ${err.message || 'Koneksi gagal'}`);
    } finally {
      setIsSyncing(false);
      checkPendingSync();
    }
  };

  const handleInlineReauthAndSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reauthPassword.trim()) {
      alert('Masukkan password akun Anda untuk memperbarui sesi login.');
      return;
    }
    setIsReauthenticating(true);
    try {
      const res = await api.login(effectiveUser.username, reauthPassword.trim());
      if (!res.success || !res.data) {
        alert(res.message || 'Password tidak sesuai. Data lokal tetap aman.');
        return;
      }
      const refreshedUser = res.data;
      setSessionUser(refreshedUser);
      setEffectiveUser(refreshedUser);
      try {
        const sanitized = { ...refreshedUser };
        delete sanitized.password;
        window.localStorage.setItem('sita_current_user_v1', JSON.stringify(sanitized));
      } catch (_) {}
      setReauthPassword('');
      setAuthRequired(false);

      const syncRes = await tahsinService.syncPendingAttempts(refreshedUser, { forceManual: true });
      await loadData();
      alert(`Sesi login berhasil diperbarui!\nHasil Sinkronisasi Cloud:\n- Berhasil: ${syncRes.succeeded}\n- Konflik: ${syncRes.conflicts}\n- Gagal: ${syncRes.failed}`);
    } catch (err: any) {
      alert('Gagal menghubungi server untuk memperbarui sesi: ' + (err?.message || 'Koneksi gagal'));
    } finally {
      setIsReauthenticating(false);
      checkPendingSync();
    }
  };

  const handleDownloadLocalBackup = () => {
    try {
      const jsonStr = tahsinService.exportPendingSyncBackup(effectiveUser.role === 'admin' ? undefined : effectiveUser.id);
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_tahsin_lokal_${effectiveUser.username}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('Gagal mengunduh backup lokal: ' + (e?.message || 'Error'));
    }
  };

  // Load Periods
  const loadData = async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      checkPendingSync();
      const fetchedPeriods = await tahsinService.fetchPeriods();
      setPeriods(fetchedPeriods);

      const activePeriod = (selectedPeriodId && fetchedPeriods.find(p => p.id === selectedPeriodId)) ||
        fetchedPeriods.find(p => p.status === 'active') || 
        fetchedPeriods[0];

      if (activePeriod) {
        setSelectedPeriodId(activePeriod.id);
        try {
          const fetchedSessions = await tahsinService.fetchSessions(activePeriod.id, effectiveUser);
          // Padukan data server dengan santri eligible tanpa menghapus sesi yang sudah tersimpan
          const initialized = tahsinService.initializeSessionsForPeriod(activePeriod, students, allTeachers, fetchedSessions);
          setSessions(initialized);
        } catch (innerErr: any) {
          if (sessions.length > 0) {
            const initialized = tahsinService.initializeSessionsForPeriod(activePeriod, students, allTeachers, sessions);
            setSessions(initialized);
          }
          throw innerErr;
        }
      }
    } catch (e: any) {
      console.error('Gagal memuat data pelaksanaan tahsin:', e);
      setFetchError(e?.message || 'Gagal memuat data sesi ujian dari server.');
    } finally {
      checkPendingSync();
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [students]);

  // Handle Period Change
  const handlePeriodChange = async (newPeriodId: string) => {
    setSelectedPeriodId(newPeriodId);
    setIsLoading(true);
    setFetchError(null);
    try {
      const targetPeriod = periods.find(p => p.id === newPeriodId);
      const fetched = await tahsinService.fetchSessions(newPeriodId, effectiveUser);
      if (targetPeriod) {
        const initialized = tahsinService.initializeSessionsForPeriod(targetPeriod, students, allTeachers, fetched);
        setSessions(initialized);
      } else {
        setSessions(fetched);
      }
    } catch (e: any) {
      console.error('Gagal ganti periode:', e);
      setFetchError(e?.message || 'Gagal memuat data sesi ujian dari server.');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);

  // Sesi sesuai kewenangan pengguna (Owner-First untuk guru halaqah, penuh untuk admin)
  const authorizedSessions = useMemo(() => {
    if (user.role === 'teacher') {
      return sessions.filter(session => {
        const studentObj = students.find(s => s.id === session.studentId);
        return studentObj?.teacherId === user.id || session.examinerId === user.id;
      });
    }
    return sessions;
  }, [sessions, user, students]);

  // Filter List Peserta
  const filteredSessions = useMemo(() => {
    return authorizedSessions.filter(session => {
      // 1. Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = session.studentNameSnapshot.toLowerCase().includes(q);
        const studentObj = students.find(s => s.id === session.studentId);
        const matchesNis = studentObj?.nis.includes(q);
        if (!matchesName && !matchesNis) return false;
      }

      // 2. Class filter
      if (filterClass && session.classSnapshot !== filterClass) {
        return false;
      }

      // 3. Halaqah filter
      if (filterHalaqah && session.halaqahSnapshot !== filterHalaqah) {
        return false;
      }

      // 4. Status filter
      if (filterStatus === 'not_started' && session.status !== 'not_started') return false;
      if (filterStatus === 'draft' && session.status !== 'draft') return false;
      if (filterStatus === 'lulus' && (session.status !== 'completed' || session.passingStatus !== 'lulus')) return false;
      if (filterStatus === 'remedial' && (session.status !== 'remedial_needed' && session.passingStatus !== 'remedial')) return false;

      return true;
    });
  }, [authorizedSessions, searchQuery, filterClass, filterHalaqah, filterStatus, students]);

  // Derived options for filter dropdowns
  const classOptions = useMemo(() => Array.from(new Set(authorizedSessions.map(s => s.classSnapshot))).sort(), [authorizedSessions]);
  const halaqahOptions = useMemo(() => Array.from(new Set(authorizedSessions.map(s => s.halaqahSnapshot))).sort(), [authorizedSessions]);

  // Progress Stats (Sudah Diuji mencakup Lulus maupun Remedial yang telah disahkan secara resmi)
  const isSessionTested = (s: TahsinSession) => tahsinService.isSessionTested(s);
  const completedCount = authorizedSessions.filter(isSessionTested).length;
  const progressPercent = authorizedSessions.length > 0 ? Math.round((completedCount / authorizedSessions.length) * 100) : 0;

  // Trigger Uji Santri
  const handleStartExam = (session: TahsinSession, type: 'utama' | 'remedial' = 'utama') => {
    const student = students.find(s => s.id === session.studentId);
    if (!student) {
      alert('Data santri tidak ditemukan.');
      return;
    }

    const attempts = session.attempts || [];
    let attemptToEdit: TahsinAttempt | null = null;
    let nextAttemptNum = 1;

    if (type === 'remedial') {
      nextAttemptNum = (session.latestAttemptNumber || 1) + 1;
    } else {
      if (attempts.length > 0) {
        // Ambil attempt terbaru saat melihat riwayat/nilai ujian
        attemptToEdit = attempts[attempts.length - 1];
        nextAttemptNum = attemptToEdit.attemptNumber || 1;
      }
    }

    setActiveSession(session);
    setActiveAttemptToEdit(attemptToEdit);
    setActiveAttemptType(type);
    setActiveAttemptNumber(nextAttemptNum);
  };

  // If in active exam mode, render the Exam Sheet
  if (activeSession) {
    const studentObj = students.find(s => s.id === activeSession.studentId)!;
    return (
      <TahsinExamSheet
        user={effectiveUser}
        period={selectedPeriod!}
        session={activeSession}
        student={studentObj}
        attemptToEdit={activeAttemptToEdit}
        attemptNumber={activeAttemptNumber}
        attemptType={activeAttemptType}
        onBack={() => {
          setActiveSession(null);
          setActiveAttemptToEdit(null);
          loadData();
        }}
        onSuccess={() => {
          setActiveSession(null);
          setActiveAttemptToEdit(null);
          loadData();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Banner & Periode Selector */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100">
            Modul Evaluasi Tahsin Al-Qur'an
          </span>
          <h2 className="text-xl font-extrabold text-slate-800 tracking-tight mt-1">
            Pelaksanaan Ujian Tahsin
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Evaluasi kualitas bacaan santri dengan mushaf Al-Qur'an secara objektif dan terstruktur.
          </p>
        </div>

        {/* Periode Selector */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <label className="text-xs font-bold text-slate-500">Periode:</label>
          <select
            value={selectedPeriodId}
            onChange={(e) => handlePeriodChange(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
          >
            {periods.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.status.toUpperCase()})
              </option>
            ))}
          </select>
          <button
            onClick={loadData}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors"
            title="Refresh Data"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Server Fetch Error Alert Banner */}
      {fetchError && (
        <div className="bg-rose-50 border border-rose-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm animate-fade-in">
          <div className="flex items-start gap-3">
            <span className="p-2 bg-rose-100 text-rose-800 rounded-xl">
              <AlertTriangle size={20} />
            </span>
            <div>
              <h4 className="text-xs font-bold text-rose-900">
                Gagal Memuat Data Ujian dari Server Cloud
              </h4>
              <p className="text-[11px] text-rose-700 mt-0.5">
                {fetchError}. Periksa koneksi internet atau sesi login Anda. Sistem menahan tampilan agar tidak menampilkan data lokal yang usang.
              </p>
            </div>
          </div>
          <button
            onClick={() => loadData()}
            className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-extrabold shadow-sm transition self-start sm:self-auto flex-shrink-0"
          >
            <RefreshCw size={14} />
            Muat Ulang
          </button>
        </div>
      )}

      {/* Pending Sync Alert Banner */}
      {pendingSyncCount > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3 shadow-sm animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="p-2 bg-amber-100 text-amber-800 rounded-xl">
                <UploadCloud size={20} />
              </span>
              <div>
                <h4 className="text-xs font-bold text-amber-900">
                  Peringatan: {pendingSyncCount} Data Ujian Belum Tersinkronkan ke Database Server
                  {conflictSyncCount > 0 ? ` (${conflictSyncCount} Konflik Data)` : ''}
                </h4>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  Nilai tersimpan aman di perangkat ini dan belum dihitung sebagai nilai resmi hingga tersinkronisasi. Klik tombol di samping untuk mengirimkan antrean ke server cloud saat internet stabil.
                </p>
                {pendingSyncError && (
                  <p className="text-[11px] font-bold text-rose-700 mt-1">
                    Info Status: {pendingSyncError}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto flex-shrink-0">
              <button
                type="button"
                onClick={handleDownloadLocalBackup}
                className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold shadow-sm transition"
                title="Unduh salinan cadangan data ujian lokal (.json) untuk penyelamatan darurat"
              >
                <Download size={14} />
                Unduh Backup Lokal (.json)
              </button>
              <button
                type="button"
                onClick={handleManualSync}
                disabled={isSyncing}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-extrabold shadow-sm transition disabled:opacity-50"
              >
                <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'Sedang Sinkronisasi...' : 'Sinkronkan Sekarang'}
              </button>
            </div>
          </div>

          {/* Inline Re-Authentication Box When Session Token Is Missing/Expired */}
          {authRequired && (
            <form
              onSubmit={handleInlineReauthAndSync}
              className="bg-white border border-amber-300 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
            >
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <Lock size={15} className="text-amber-600 flex-shrink-0" />
                <span>
                  <strong>Sesi keamanan akun ({effectiveUser.username}) perlu diperbarui:</strong> Masukkan password Anda untuk memperbarui token tanpa keluar akun (data lokal tetap aman):
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={reauthPassword}
                  onChange={(e) => setReauthPassword(e.target.value)}
                  placeholder="Password akun Anda..."
                  className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  disabled={isReauthenticating}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-extrabold whitespace-nowrap disabled:opacity-50"
                >
                  {isReauthenticating ? 'Memverifikasi...' : 'Perbarui Sesi & Sinkronkan'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Progress & Quick Stats Card */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase">Total Peserta</div>
          <div className="text-xl font-black text-slate-800 mt-0.5">{authorizedSessions.length}</div>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase">Sudah Diuji</div>
          <div className="text-xl font-black text-emerald-700 mt-0.5">{completedCount}</div>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase">Belum Diuji</div>
          <div className="text-xl font-black text-amber-700 mt-0.5">{authorizedSessions.length - completedCount}</div>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-sm text-center">
          <div className="text-[10px] font-bold text-slate-400 uppercase">Progres Ujian</div>
          <div className="text-xl font-black text-teal-700 mt-0.5">{progressPercent}%</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama atau NIS..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white text-xs font-medium"
            />
          </div>

          {/* Filter Kelas */}
          <div>
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white font-medium"
            >
              <option value="">Semua Kelas</option>
              {classOptions.map(c => <option key={c} value={c}>Kelas {c}</option>)}
            </select>
          </div>

          {/* Filter Halaqah */}
          <div>
            <select
              value={filterHalaqah}
              onChange={(e) => setFilterHalaqah(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white font-medium"
            >
              <option value="">Semua Halaqah</option>
              {halaqahOptions.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>

          {/* Filter Status */}
          <div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white font-medium"
            >
              <option value="all">Semua Status</option>
              <option value="not_started">Belum Diuji</option>
              <option value="draft">Draft Tersimpan</option>
              <option value="lulus">Lulus</option>
              <option value="remedial">Perlu Remedial</option>
            </select>
          </div>
        </div>
      </div>

      {/* Participants Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 text-slate-600 border-b border-slate-200 text-[11px] font-bold">
                <th className="p-3 text-center w-12">No</th>
                <th className="p-3">Nama Santri</th>
                <th className="p-3 text-center">Kelas</th>
                <th className="p-3">Halaqah</th>
                <th className="p-3 text-center">Cakupan Juz</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-center">Nilai Akhir</th>
                <th className="p-3 text-center">Predikat</th>
                <th className="p-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    Tidak ada peserta ujian tahsin yang sesuai dengan filter.
                  </td>
                </tr>
              ) : (
                filteredSessions.map((session, idx) => {
                  const coverageRule = tahsinService.getCoverageByClass(session.classSnapshot);
                  const isCompleted = session.status === 'completed' || session.status === 'remedial_needed';
                  const isRemedial = session.passingStatus === 'remedial' || session.status === 'remedial_needed';
                  const latestAttempt = session.attempts && session.attempts.length > 0 ? session.attempts[session.attempts.length - 1] : null;
                  const passage = latestAttempt?.reading ? formatTahsinPassageDisplay(latestAttempt.reading) : null;

                  return (
                    <tr key={session.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3 text-center text-slate-400 font-bold">{idx + 1}</td>
                      <td className="p-3">
                        <div className="font-extrabold text-slate-800">{session.studentNameSnapshot}</div>
                        {passage && passage.hasData ? (
                          <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">
                            {passage.surahAyahText} • {passage.pageText} ({passage.juzText})
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-400">Percobaan #{session.latestAttemptNumber || 1}</div>
                        )}
                      </td>
                      <td className="p-3 text-center font-bold text-slate-600">
                        {session.classSnapshot}
                      </td>
                      <td className="p-3 font-medium text-slate-600">
                        {session.halaqahSnapshot}
                      </td>
                      <td className="p-3 text-center">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-100 text-[10px] font-bold">
                          Juz {session.targetJuzStart}–{session.targetJuzEnd}
                        </span>
                        {latestAttempt?.examinerName && (
                          <div className="text-[9px] text-slate-400 mt-0.5 truncate max-w-[120px] mx-auto" title={`Penguji: ${latestAttempt.examinerName}`}>
                            {latestAttempt.examinerName}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {session.status === 'not_started' && (
                          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-bold text-[10px]">
                            Belum Diuji
                          </span>
                        )}
                        {session.status === 'draft' && (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 font-bold text-[10px]">
                            Draft
                          </span>
                        )}
                        {session.status === 'completed' && session.passingStatus === 'lulus' && (
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] flex items-center justify-center gap-1">
                            <CheckCircle2 size={12} /> Lulus
                          </span>
                        )}
                        {isRemedial && (
                          <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[10px] flex items-center justify-center gap-1">
                            <AlertTriangle size={12} /> Perlu Remedial
                          </span>
                        )}
                        {/* Status Sinkronisasi Server (6 Status Jelas) */}
                        <div className="mt-1 flex items-center justify-center">
                          {isSyncing && (session.syncStatus === 'pending_sync' || session.syncStatus === 'sync_failed') ? (
                            <span className="text-[9px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200 flex items-center gap-1 font-bold" title="Sedang mengirim ke server cloud">
                              <RefreshCw size={10} className="animate-spin" /> Sedang Sinkronisasi
                            </span>
                          ) : session.syncStatus === 'synced_server' ? (
                            <span className="text-[9px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 flex items-center gap-1" title="Tersimpan di Cloud Server">
                              <Cloud size={10} /> Cloud OK
                            </span>
                          ) : session.syncStatus === 'conflict' ? (
                            <span className="text-[9px] text-purple-800 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200 flex items-center gap-1 font-bold" title="Konflik versi data dengan server">
                              <AlertTriangle size={10} /> Konflik Data
                            </span>
                          ) : session.syncStatus === 'sync_failed' ? (
                            <span className="text-[9px] text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 flex items-center gap-1 font-bold" title="Gagal sinkronisasi, menunggu pengiriman ulang">
                              <CloudOff size={10} /> Gagal Sync
                            </span>
                          ) : session.syncStatus === 'pending_sync' ? (
                            <span className="text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 flex items-center gap-1" title="Menunggu sinkronisasi ke server">
                              <UploadCloud size={10} /> Menunggu Sinkronisasi
                            </span>
                          ) : session.status !== 'not_started' && session.syncStatus === 'local_only' ? (
                            <span className="text-[9px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 flex items-center gap-1" title="Tersimpan di perangkat lokal">
                              <Clock size={10} /> Tersimpan Lokal
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3 text-center font-black text-slate-800">
                        {session.finalScore !== undefined ? session.finalScore.toFixed(2) : '-'}
                      </td>
                      <td className="p-3 text-center font-bold text-slate-600">
                        {session.predikat || '-'}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {session.status === 'not_started' && (
                            <button
                              onClick={() => handleStartExam(session, 'utama')}
                              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-all shadow-sm"
                            >
                              <Play size={12} /> Uji
                            </button>
                          )}

                          {session.status === 'draft' && (
                            <button
                              onClick={() => handleStartExam(session, 'utama')}
                              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs transition-all shadow-sm"
                            >
                              <Clock size={12} /> Lanjut Draft
                            </button>
                          )}

                          {(session.status === 'completed' || (isRemedial && session.attempts && session.attempts.length > 0)) && (
                            <button
                              onClick={() => handleStartExam(session, 'utama')}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
                              title="Lihat detail nilai, materi bacaan, atau koreksi nilai"
                            >
                              Lihat Nilai
                            </button>
                          )}

                          {isRemedial && (
                            <button
                              onClick={() => handleStartExam(session, 'remedial')}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-all shadow-sm"
                              title="Lakukan Ujian Remedial Baru"
                            >
                              <RotateCcw size={12} /> Remedial
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TahsinPelaksanaanView;

