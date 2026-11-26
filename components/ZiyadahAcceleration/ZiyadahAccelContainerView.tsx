import React, { useEffect, useMemo, useState } from 'react';
import {
  Student,
  TahfidzRecord,
  User,
  ZiyadahAccelCoordinatorDelegation,
  ZiyadahAccelEvent,
  ZiyadahAccelWorkspaceData
} from '../../types';
import { api } from '../../api';
import { ziyadahAccelService } from '../../services/ziyadahAccelService';
import { computeZiyadahAccelAnalytics } from '../../services/ziyadahAccelPageCalc';
import { ZiyadahAccelEventModal } from './ZiyadahAccelEventModal';
import { ZiyadahAccelDashboard } from './ZiyadahAccelDashboard';
import { ZiyadahAccelParticipantsTab } from './ZiyadahAccelParticipantsTab';
import { ZiyadahAccelSessionsTab } from './ZiyadahAccelSessionsTab';
import { ZiyadahAccelExaminerView } from './ZiyadahAccelExaminerView';
import { ZiyadahAccelMonitoringMatrix } from './ZiyadahAccelMonitoringMatrix';
import { ZiyadahAccelReportsView } from './ZiyadahAccelReportsView';
import {
  Sparkles,
  Plus,
  Settings,
  RefreshCw,
  LayoutDashboard,
  Users,
  Calendar,
  ClipboardCheck,
  Table,
  FileText,
  AlertTriangle,
  ShieldCheck,
  Lock,
  UserCheck
} from 'lucide-react';

export type ZiyadahInternalTab =
  | 'dashboard'
  | 'participants'
  | 'sessions'
  | 'execution'
  | 'monitoring'
  | 'reports';

interface ZiyadahAccelContainerViewProps {
  user: User;
  students: Student[];
  users: User[];
  records: TahfidzRecord[];
  initialSubTab?: ZiyadahInternalTab;
  onUserUpdate?: (updatedUser: User) => void;
  onAccessContextChanged?: () => void;
}

export const ZiyadahAccelContainerView: React.FC<ZiyadahAccelContainerViewProps> = ({
  user,
  students,
  users,
  records,
  initialSubTab = 'dashboard',
  onUserUpdate,
  onAccessContextChanged
}) => {
  const isSharedExaminer = user.role === 'shared_uas_examiner';

  const [subTab, setSubTab] = useState<ZiyadahInternalTab>(
    user.role === 'admin' ? initialSubTab : 'execution'
  );
  const [events, setEvents] = useState<ZiyadahAccelEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [workspace, setWorkspace] = useState<ZiyadahAccelWorkspaceData | null>(null);
  const [isCoordinator, setIsCoordinator] = useState<boolean>(user.role === 'admin');
  const [coordinators, setCoordinators] = useState<ZiyadahAccelCoordinatorDelegation[]>([]);
  const [migrationPending, setMigrationPending] = useState<boolean>(false);

  // State khusus Akun Bersama UJIAN + PIN Guru (Perbaikan B-03 & A.1)
  const [pinRequired, setPinRequired] = useState<boolean>(false);
  const [verifiedExaminer, setVerifiedExaminer] = useState<{
    teacherId: string;
    teacherName: string;
  } | null>(
    user.verifiedExaminer
      ? {
          teacherId: user.verifiedExaminer.teacherId,
          teacherName: user.verifiedExaminer.teacherName
        }
      : null
  );
  const [activeTeachersList, setActiveTeachersList] = useState<
    Array<{ id: string; name: string; username?: string; hasPin?: boolean }>
  >([]);
  const [selectedPinTeacherId, setSelectedPinTeacherId] = useState<string>('');
  const [pinInput, setPinInput] = useState<string>('');
  const [verifyingPin, setVerifyingPin] = useState<boolean>(false);
  const [pinErrorMsg, setPinErrorMsg] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [bannerMsg, setBannerMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ZiyadahAccelEvent | null>(null);

  useEffect(() => {
    if (isSharedExaminer) {
      setSubTab('execution');
    } else {
      setSubTab(user.role === 'teacher' && !isCoordinator ? 'execution' : initialSubTab);
    }
  }, [initialSubTab, user.role, isCoordinator, isSharedExaminer]);

  const teachersList = useMemo(
    () => users.filter(u => u.role === 'teacher' || u.role === 'admin'),
    [users]
  );

  const loadSharedActiveTeachers = async () => {
    if (!isSharedExaminer) return;
    try {
      const res = await api.getUASActiveTeachers(user);
      if (res.success && res.teachers) {
        setActiveTeachersList(res.teachers);
      }
    } catch {}
  };

  const loadInitial = async (preferEventId?: string) => {
    setLoading(true);
    try {
      const ctxRes = await ziyadahAccelService.getAccessContext(user);
      if (ctxRes.migrationPending === true) {
        setMigrationPending(true);
        setLoading(false);
        return;
      }
      setMigrationPending(false);

      if (!ctxRes.success && !ctxRes.pinRequired) {
        setEvents([]);
        setWorkspace(null);
        setBannerMsg({
          type: 'error',
          text: ctxRes.message || 'Gagal menghubungkan ke layanan database Ziyadah Akselerasi.'
        });
        return;
      }

      if (isSharedExaminer && ctxRes.pinRequired) {
        setPinRequired(true);
        setVerifiedExaminer(null);
        setEvents([]);
        setWorkspace(null);
        if (ctxRes.isPinExpired) {
          setPinErrorMsg('Sesi verifikasi PIN Guru Anda telah berakhir. Silakan masukkan PIN kembali.');
        }
        await loadSharedActiveTeachers();
        return;
      }

      setPinRequired(false);
      if (ctxRes.verifiedExaminer) {
        setVerifiedExaminer(ctxRes.verifiedExaminer);
      }

      const listRes = await ziyadahAccelService.listEvents(user);
      if (listRes.migrationPending === true) {
        setMigrationPending(true);
        return;
      }
      if (listRes.pinRequired) {
        setPinRequired(true);
        setVerifiedExaminer(null);
        await loadSharedActiveTeachers();
        return;
      }
      if (!listRes.success) {
        setEvents([]);
        setWorkspace(null);
        setBannerMsg({
          type: 'error',
          text: listRes.message || 'Gagal memuat daftar kegiatan Ziyadah Akselerasi.'
        });
        return;
      }

      const coordFlag = Boolean(
        !isSharedExaminer && (ctxRes.isCoordinator || listRes.isCoordinator || user.role === 'admin')
      );
      setIsCoordinator(coordFlag);
      setCoordinators(ctxRes.coordinators || []);

      const evList = listRes.events || [];
      setEvents(evList);

      const targetId =
        preferEventId ||
        (evList.some(e => e.id === selectedEventId) ? selectedEventId : '') ||
        evList.find(e => e.status === 'active')?.id ||
        evList[0]?.id ||
        '';

      setSelectedEventId(targetId);
      if (targetId) {
        await loadWorkspace(targetId);
      } else {
        setWorkspace(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspace = async (eventId: string) => {
    if (!eventId) return;
    setRefreshing(true);
    try {
      const res = await ziyadahAccelService.getEventWorkspace(user, eventId);
      if (res.pinRequired) {
        setPinRequired(true);
        setVerifiedExaminer(null);
        setWorkspace(null);
        await loadSharedActiveTeachers();
        return;
      }
      if (res.success && res.workspace) {
        setWorkspace(res.workspace);
        setIsCoordinator(Boolean(!isSharedExaminer && (res.workspace.isCoordinator || user.role === 'admin')));
      } else {
        setWorkspace(null);
        setBannerMsg({ type: 'error', text: res.message || 'Gagal memuat workspace kegiatan.' });
      }
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadInitial();
  }, [user.id, user.sessionToken, user.verifiedExaminer?.teacherId]);

  const handleVerifySharedPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPinTeacherId || !pinInput.trim()) {
      setPinErrorMsg('Pilih nama Guru Penguji dan masukkan PIN verifikasi pribadi.');
      return;
    }
    setVerifyingPin(true);
    setPinErrorMsg(null);
    try {
      const res = await api.verifyUASExaminerIdentity(selectedPinTeacherId, pinInput.trim(), user);
      if (res.success && res.verifiedExaminer) {
        setPinInput('');
        setVerifiedExaminer({
          teacherId: res.verifiedExaminer.teacherId,
          teacherName: res.verifiedExaminer.teacherName
        });
        setPinRequired(false);
        const updatedUser: User = {
          ...user,
          verifiedExaminer: res.verifiedExaminer
        };
        onUserUpdate?.(updatedUser);
        onAccessContextChanged?.();
        await loadInitial();
      } else {
        setPinErrorMsg(res.message || 'PIN verifikasi penguji tidak sesuai.');
      }
    } finally {
      setVerifyingPin(false);
    }
  };

  const handleSwitchSharedExaminer = async () => {
    setPinRequired(true);
    setPinInput('');
    setPinErrorMsg(null);
    await loadSharedActiveTeachers();
  };

  const analytics = useMemo(() => {
    if (!workspace) return null;
    return computeZiyadahAccelAnalytics({
      participants: workspace.participants,
      sessions: workspace.sessions,
      submissions: workspace.submissions
    });
  }, [workspace]);

  const activeEvent = workspace?.event || events.find(e => e.id === selectedEventId) || null;
  const isEventLocked =
    activeEvent?.status === 'finalized' || activeEvent?.status === 'cancelled';

  if (loading) {
    return (
      <div className="py-24 text-center space-y-3 text-slate-500">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
        <p className="text-xs font-semibold">Memuat Modul Ujian Ziyadah Akselerasi...</p>
      </div>
    );
  }

  // Layar Verifikasi Identitas PIN Guru pada Akun Bersama UJIAN (Sesuai Mekanisme UAS Existing)
  if (isSharedExaminer && pinRequired) {
    return (
      <div className="max-w-md mx-auto py-8 px-2">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-800 to-teal-900 p-5 text-white space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/15 text-emerald-100 text-[11px] font-bold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Akun Bersama UJIAN — Verifikasi Identitas Penguji</span>
            </div>
            <h2 className="text-lg font-extrabold">Ujian Ziyadah Akselerasi</h2>
            <p className="text-xs text-emerald-100">
              Pilih nama Guru Penguji dan masukkan PIN pribadi SITA agar setiap setoran tercatat atas identitas individual yang sah.
            </p>
          </div>

          <form onSubmit={handleVerifySharedPin} className="p-5 space-y-4 text-xs">
            {pinErrorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                {pinErrorMsg}
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-1.5">
                Nama Guru Penguji Resmi
              </label>
              <select
                value={selectedPinTeacherId}
                onChange={e => setSelectedPinTeacherId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white font-semibold outline-none"
                required
              >
                <option value="">-- Pilih Nama Guru Penguji --</option>
                {activeTeachersList.map(t => (
                  <option key={t.id} value={t.id} disabled={t.hasPin === false}>
                    {t.name} {t.hasPin === false ? '(PIN Belum Diatur Admin)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1.5">
                PIN Verifikasi Pribadi Penguji
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinInput}
                  onChange={e => setPinInput(e.target.value)}
                  placeholder="Masukkan PIN Guru..."
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white font-mono text-sm font-bold outline-none"
                  required
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              {verifiedExaminer && (
                <button
                  type="button"
                  onClick={() => setPinRequired(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  Batal
                </button>
              )}
              <button
                type="submit"
                disabled={verifyingPin}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold shadow-sm flex items-center justify-center gap-1.5"
              >
                <UserCheck className="w-4 h-4" />
                <span>{verifyingPin ? 'Memverifikasi PIN...' : 'Verifikasi & Buka Antrean'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12">
      {/* Header Utama Modul Ziyadah Akselerasi */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-emerald-950 text-white rounded-2xl p-6 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-400/20 text-emerald-200 border border-emerald-400/30 text-[11px] font-bold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {isSharedExaminer && verifiedExaminer
                  ? `Penguji Terverifikasi PIN: ${verifiedExaminer.teacherName}`
                  : 'Modul Terpadu Ujian Ziyadah Akselerasi'}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
              {activeEvent ? activeEvent.name : 'Ujian Ziyadah Akselerasi'}
            </h1>
            {activeEvent && (
              <p className="text-xs text-emerald-100">
                TA {activeEvent.academicYear} (Semester{' '}
                {activeEvent.semester === 'ganjil' ? 'Ganjil' : 'Genap'}) •{' '}
                {activeEvent.startDate} s.d. {activeEvent.endDate} • Status:{' '}
                <strong className="uppercase">{activeEvent.status}</strong>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {isSharedExaminer && (
              <button
                type="button"
                onClick={handleSwitchSharedExaminer}
                className="px-3 py-2 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 border border-amber-300/40 text-amber-100 text-xs font-bold flex items-center gap-1.5"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Ganti Penguji (PIN)</span>
              </button>
            )}

            {events.length > 0 && (
              <select
                value={selectedEventId}
                onChange={async e => {
                  const id = e.target.value;
                  setSelectedEventId(id);
                  await loadWorkspace(id);
                }}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white text-xs font-bold outline-none"
              >
                {events.map(ev => (
                  <option key={ev.id} value={ev.id} className="text-slate-900">
                    {ev.name} ({ev.status.toUpperCase()})
                  </option>
                ))}
              </select>
            )}

            {isCoordinator && !migrationPending && (
              <>
                {activeEvent && activeEvent.status !== 'finalized' && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEvent(activeEvent);
                      setIsEventModalOpen(true);
                    }}
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white"
                    title="Pengaturan Kegiatan & Delegasi Koordinator"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditingEvent(null);
                    setIsEventModalOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-4 h-4" /> Kegiatan Baru
                </button>
              </>
            )}

            {selectedEventId && (
              <button
                type="button"
                disabled={refreshing}
                onClick={() => loadWorkspace(selectedEventId)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white"
                title="Muat Ulang Data"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Info jika migrasi SQL belum dijalankan di Supabase produksi */}
      {migrationPending && (
        <div className="p-5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-1.5">
          <div className="font-extrabold text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>Skema Database Ziyadah Akselerasi Belum Diaktifkan pada Server</span>
          </div>
          <p className="leading-relaxed">
            Modul frontend telah siap, namun migrasi aditif{' '}
            <code className="font-mono bg-white px-1.5 py-0.5 rounded border">
              supabase_ziyadah_akselerasi_migration.sql
            </code>{' '}
            belum dijalankan pada database Supabase sesuai prosedur persetujuan Admin.
          </p>
        </div>
      )}

      {bannerMsg && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between ${
            bannerMsg.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span>{bannerMsg.text}</span>
          <button
            type="button"
            onClick={() => setBannerMsg(null)}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* Navigasi Tab Internal Modul */}
      {activeEvent && workspace && analytics ? (
        <>
          <div className="bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap gap-1">
            {isCoordinator && (
              <>
                <button
                  type="button"
                  onClick={() => setSubTab('dashboard')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                    subTab === 'dashboard'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('participants')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                    subTab === 'participants'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" /> Peserta ({analytics.metrics.uniqueParticipantsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('sessions')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                    subTab === 'sessions'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" /> Sesi &amp; Penguji ({analytics.metrics.totalSessionsCount})
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setSubTab('execution')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                subTab === 'execution'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ClipboardCheck className="w-3.5 h-3.5" /> Form Setoran Penguji
            </button>

            {isCoordinator && (
              <>
                <button
                  type="button"
                  onClick={() => setSubTab('monitoring')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                    subTab === 'monitoring'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Table className="w-3.5 h-3.5" /> Monitoring Matriks
                  {analytics.metrics.needsVerificationSubmissionsCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-extrabold">
                      {analytics.metrics.needsVerificationSubmissionsCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('reports')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                    subTab === 'reports'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" /> Laporan &amp; Arsip
                </button>
              </>
            )}
          </div>

          {subTab === 'dashboard' && isCoordinator && (
            <ZiyadahAccelDashboard
              event={activeEvent}
              metrics={analytics.metrics}
              onNavigateSubTab={t => setSubTab(t)}
            />
          )}

          {subTab === 'participants' && isCoordinator && (
            <ZiyadahAccelParticipantsTab
              event={activeEvent}
              allStudents={students}
              dailyRecords={records}
              participants={workspace.participants}
              isLocked={isEventLocked}
              onEnrollStudents={async items => {
                const res = await ziyadahAccelService.enrollParticipants(
                  user,
                  activeEvent.id,
                  items
                );
                setBannerMsg({
                  type: res.success ? 'success' : 'error',
                  text: res.message || 'Selesai memproses peserta.'
                });
                await loadWorkspace(activeEvent.id);
              }}
              onToggleParticipantStatus={async (pid, st, rsn) => {
                const res = await ziyadahAccelService.updateParticipantStatus(user, pid, st, rsn);
                setBannerMsg({
                  type: res.success ? 'success' : 'error',
                  text: res.message || 'Status diperbarui.'
                });
                await loadWorkspace(activeEvent.id);
              }}
            />
          )}

          {subTab === 'sessions' && isCoordinator && (
            <ZiyadahAccelSessionsTab
              event={activeEvent}
              sessions={workspace.sessions}
              sessionExaminers={workspace.sessionExaminers}
              participants={workspace.participants}
              submissions={workspace.submissions}
              teachers={teachersList}
              isLocked={isEventLocked}
              onSaveSession={async (sessPayload, exList) => {
                const res = await ziyadahAccelService.upsertSession(user, sessPayload, exList);
                setBannerMsg({
                  type: res.success ? 'success' : 'error',
                  text: res.message || 'Sesi disimpan.'
                });
                onAccessContextChanged?.();
                await loadWorkspace(activeEvent.id);
              }}
              onChangeSessionStatus={async (sid, st, rsn) => {
                const res = await ziyadahAccelService.setSessionStatus(user, sid, st, rsn);
                setBannerMsg({
                  type: res.success ? 'success' : 'error',
                  text: res.message || 'Status sesi diperbarui.'
                });
                await loadWorkspace(activeEvent.id);
              }}
              onSaveQueueOrder={async (sid, orders, regOffset, examinerOffsets) => {
                const res = await ziyadahAccelService.reorderQueue(
                  user,
                  sid,
                  orders,
                  regOffset,
                  examinerOffsets
                );
                setBannerMsg({
                  type: res.success ? 'success' : 'error',
                  text: res.message || 'Urutan giliran disimpan.'
                });
                await loadWorkspace(activeEvent.id);
              }}
            />
          )}

          {subTab === 'execution' && (
            <ZiyadahAccelExaminerView
              user={user}
              actorUserId={workspace.actorUserId || verifiedExaminer?.teacherId || user.id}
              actorName={workspace.actorName || verifiedExaminer?.teacherName || user.name}
              isSharedAccount={Boolean(workspace.isSharedAccount || isSharedExaminer)}
              isCoordinator={isCoordinator}
              event={activeEvent}
              sessions={workspace.sessions}
              sessionExaminers={workspace.sessionExaminers}
              participants={workspace.participants}
              submissions={workspace.submissions}
              onSubmissionSaved={() => loadWorkspace(activeEvent.id)}
              onSwitchSharedExaminer={isSharedExaminer ? handleSwitchSharedExaminer : undefined}
            />
          )}

          {subTab === 'monitoring' && isCoordinator && (
            <ZiyadahAccelMonitoringMatrix
              sessions={workspace.sessions}
              rows={analytics.studentRows}
              auditLogs={workspace.auditLogs}
              isLocked={isEventLocked}
              onRefresh={() => loadWorkspace(activeEvent.id)}
              onVerifySubmission={async p => {
                const res = await ziyadahAccelService.verifySubmission({
                  user,
                  ...p
                });
                setBannerMsg({
                  type: res.success ? 'success' : 'error',
                  text: res.message || 'Verifikasi disimpan.'
                });
                await loadWorkspace(activeEvent.id);
              }}
            />
          )}

          {subTab === 'reports' && isCoordinator && (
            <ZiyadahAccelReportsView
              user={user}
              event={activeEvent}
              liveMetrics={analytics.metrics}
              liveRows={analytics.studentRows}
              sessions={workspace.sessions}
              finalSnapshot={workspace.finalSnapshot}
              onFinalizeEvent={async reason => {
                // B-12: Seluruh frozen_summary, frozen_student_rows, dan frozen_session_matrix
                // dihitung 100% secara otoritatif oleh server dari transaksi sah di database.
                const res = await ziyadahAccelService.finalizeOrReopenEvent({
                  user,
                  eventId: activeEvent.id,
                  action: 'finalize',
                  reason
                });
                setBannerMsg({
                  type: res.success ? 'success' : 'error',
                  text: res.message || 'Finalisasi diproses.'
                });
                await loadInitial(activeEvent.id);
              }}
              onReopenEvent={async reason => {
                const res = await ziyadahAccelService.finalizeOrReopenEvent({
                  user,
                  eventId: activeEvent.id,
                  action: 'reopen',
                  reason
                });
                setBannerMsg({
                  type: res.success ? 'success' : 'error',
                  text: res.message || 'Kegiatan dibuka kembali.'
                });
                await loadInitial(activeEvent.id);
              }}
            />
          )}
        </>
      ) : (
        !migrationPending && (
          <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
            <Sparkles className="w-10 h-10 text-emerald-500 mx-auto" />
            <h3 className="text-base font-bold text-slate-800">
              {isCoordinator
                ? 'Belum Ada Kegiatan Ujian Ziyadah Akselerasi'
                : 'Tidak Ada Penugasan Aktif untuk Identitas Penguji Ini'}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {isCoordinator
                ? 'Klik tombol "Kegiatan Baru" di kanan atas untuk memulai kegiatan Ujian Ziyadah Akselerasi pertama.'
                : isSharedExaminer && verifiedExaminer
                  ? `Akun Guru ${verifiedExaminer.teacherName} tidak ditugaskan sebagai penguji pada kegiatan Ziyadah Akselerasi yang sedang berjalan. Klik "Ganti Penguji (PIN)" di atas jika penguji lain ingin masuk.`
                  : 'Akun Anda belum memiliki penugasan penguji aktif pada kegiatan Ujian Ziyadah Akselerasi.'}
            </p>
          </div>
        )
      )}

      <ZiyadahAccelEventModal
        isOpen={isEventModalOpen}
        onClose={() => setIsEventModalOpen(false)}
        user={user}
        teachers={teachersList}
        coordinators={coordinators}
        initialEvent={editingEvent}
        onSaveEvent={async payload => {
          const res = await ziyadahAccelService.upsertEvent(user, payload);
          if (res.success) {
            setBannerMsg({ type: 'success', text: res.message || 'Kegiatan berhasil disimpan.' });
            onAccessContextChanged?.();
            await loadInitial(res.eventId);
          }
          return res;
        }}
        onToggleCoordinator={async (teacherId, active) => {
          const res = await ziyadahAccelService.manageCoordinator(user, teacherId, active);
          setBannerMsg({
            type: res.success ? 'success' : 'error',
            text: res.message || 'Hak Koordinator diperbarui.'
          });
          onAccessContextChanged?.();
          const ctx = await ziyadahAccelService.getAccessContext(user);
          setCoordinators(ctx.coordinators || []);
        }}
      />
    </div>
  );
};
