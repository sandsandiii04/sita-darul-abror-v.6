import React, { useMemo, useState } from 'react';
import {
  User,
  ZiyadahAccelEvent,
  ZiyadahAccelParticipant,
  ZiyadahAccelSession,
  ZiyadahAccelSessionExaminer,
  ZiyadahAccelSubmission
} from '../../types';
import {
  Plus,
  Play,
  Lock,
  Ban,
  Edit2,
  ArrowUp,
  ArrowDown,
  Users,
  Calendar,
  ListOrdered,
  X,
  Save,
  Info,
  CheckCircle2
} from 'lucide-react';

interface ZiyadahAccelSessionsTabProps {
  event: ZiyadahAccelEvent;
  sessions: ZiyadahAccelSession[];
  sessionExaminers: ZiyadahAccelSessionExaminer[];
  participants: ZiyadahAccelParticipant[];
  submissions: ZiyadahAccelSubmission[];
  teachers: User[];
  isLocked: boolean;
  onSaveSession: (
    sessionPayload: Partial<ZiyadahAccelSession> & { eventId: string },
    examiners: ZiyadahAccelSessionExaminer[]
  ) => Promise<void>;
  onChangeSessionStatus: (
    sessionId: string,
    status: ZiyadahAccelSession['status'],
    reason?: string
  ) => Promise<void>;
  onSaveQueueOrder: (
    sessionId: string,
    orders: Array<{
      participantId: string;
      queueOrder: number;
      assignedExaminerId?: string | null;
      groupLabel?: string | null;
    }>,
    regularOffset: number,
    examinerOffsets?: Array<{
      examinerUserId: string;
      groupLabel?: string | null;
      regularQueueOffset: number;
      regularFinishConfirmed?: boolean;
    }>
  ) => Promise<void>;
}

export const ZiyadahAccelSessionsTab: React.FC<ZiyadahAccelSessionsTabProps> = ({
  event,
  sessions,
  sessionExaminers,
  participants,
  submissions,
  teachers,
  isLocked,
  onSaveSession,
  onChangeSessionStatus,
  onSaveQueueOrder
}) => {
  const [editingSession, setEditingSession] = useState<ZiyadahAccelSession | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const nextNum =
    sessions.length > 0 ? Math.max(...sessions.map(s => s.sessionNumber)) + 1 : 1;

  const [sessNumber, setSessNumber] = useState<number>(nextNum);
  const [sessName, setSessName] = useState<string>(`Sesi ${nextNum}`);
  const [sessDate, setSessDate] = useState<string>(event.startDate);
  const [startTime, setStartTime] = useState<string>('08:00');
  const [endTime, setEndTime] = useState<string>('11:00');
  const [regularOffset, setRegularOffset] = useState<number>(0);
  const [draftExaminers, setDraftExaminers] = useState<ZiyadahAccelSessionExaminer[]>([]);
  const [saving, setSaving] = useState(false);

  // Modal pengaturan antrean giliran per kelompok/majelis penguji (A.4)
  const [queueModalSession, setQueueModalSession] = useState<ZiyadahAccelSession | null>(null);
  const [selectedQueueGroupExaminerId, setSelectedQueueGroupExaminerId] = useState<string>('ALL');
  const [queueDraft, setQueueDraft] = useState<
    Array<{
      participantId: string;
      studentName: string;
      className: string;
      halaqah: string;
      assignedExaminerId: string | null;
      groupLabel: string | null;
    }>
  >([]);
  const [queueOffsetDraft, setQueueOffsetDraft] = useState<number>(0);
  const [examinerGroupOffsetsDraft, setExaminerGroupOffsetsDraft] = useState<
    Array<{
      examinerUserId: string;
      examinerName: string;
      groupLabel: string;
      regularQueueOffset: number;
      regularFinishConfirmed: boolean;
    }>
  >([]);

  const distinctClasses = useMemo(
    () =>
      Array.from(
        new Set(
          participants
            .filter(p => p.participantStatus === 'active')
            .map(p => p.classSnapshot)
        )
      ).sort((a, b) => a.localeCompare(b, 'id', { numeric: true })),
    [participants]
  );

  const distinctHalaqahs = useMemo(
    () =>
      Array.from(
        new Set(
          participants
            .filter(p => p.participantStatus === 'active')
            .map(p => p.halaqahSnapshot)
        )
      ).sort((a, b) => a.localeCompare(b, 'id', { numeric: true })),
    [participants]
  );

  const openCreateForm = () => {
    const num = sessions.length > 0 ? Math.max(...sessions.map(s => s.sessionNumber)) + 1 : 1;
    setEditingSession(null);
    setFormError(null);
    setSessNumber(num);
    setSessName(`Sesi ${num}`);
    setSessDate(event.startDate);
    setStartTime('08:00');
    setEndTime('11:00');
    setRegularOffset(0);
    setDraftExaminers([]);
    setIsFormOpen(true);
  };

  const openEditForm = (s: ZiyadahAccelSession) => {
    setEditingSession(s);
    setFormError(null);
    setSessNumber(s.sessionNumber);
    setSessName(s.name);
    setSessDate(s.sessionDate);
    setStartTime(s.startTime || '');
    setEndTime(s.endTime || '');
    setRegularOffset(s.regularQueueOffset || 0);
    setDraftExaminers(sessionExaminers.filter(se => se.sessionId === s.id));
    setIsFormOpen(true);
  };

  const handleToggleExaminer = (t: User) => {
    setDraftExaminers(prev => {
      const exists = prev.find(x => x.examinerUserId === t.id);
      if (exists) return prev.filter(x => x.examinerUserId !== t.id);
      return [
        ...prev,
        {
          examinerUserId: t.id,
          examinerNameSnapshot: t.name,
          groupLabel: `Majelis ${t.name}`,
          canExamineAll: true,
          assignedClasses: [],
          assignedHalaqahs: [],
          assignedParticipantIds: [],
          regularQueueOffset: regularOffset,
          regularFinishConfirmed: false
        }
      ];
    });
  };

  const updateExaminerConfig = (
    userId: string,
    patch: Partial<ZiyadahAccelSessionExaminer>
  ) => {
    setDraftExaminers(prev =>
      prev.map(x => (x.examinerUserId === userId ? { ...x, ...patch } : x))
    );
  };

  const handleSubmitSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validasi B-09: Jangan izinkan penguji tanpa cakupan jika "Semua Peserta" dimatikan
    for (const ex of draftExaminers) {
      if (
        !ex.canExamineAll &&
        (!ex.assignedClasses || ex.assignedClasses.length === 0) &&
        (!ex.assignedHalaqahs || ex.assignedHalaqahs.length === 0) &&
        (!ex.assignedParticipantIds || ex.assignedParticipantIds.length === 0)
      ) {
        setFormError(
          `Penguji ${ex.examinerNameSnapshot} belum memiliki cakupan Kelas/Halaqah. Centang "Semua Peserta" atau pilih minimal satu Kelas/Halaqah.`
        );
        return;
      }
    }

    setSaving(true);
    try {
      await onSaveSession(
        {
          id: editingSession?.id,
          eventId: event.id,
          sessionNumber: sessNumber,
          name: sessName.trim() || `Sesi ${sessNumber}`,
          sessionDate: sessDate,
          startTime: startTime || null,
          endTime: endTime || null,
          regularQueueOffset: regularOffset,
          status: editingSession?.status || 'scheduled'
        },
        draftExaminers
      );
      setIsFormOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const resolveDefaultExaminerForParticipant = (
    part: ZiyadahAccelParticipant,
    exList: ZiyadahAccelSessionExaminer[]
  ): ZiyadahAccelSessionExaminer | undefined => {
    return (
      exList.find(ex => ex.assignedParticipantIds?.includes(part.id)) ||
      exList.find(ex => ex.assignedClasses?.includes(part.classSnapshot)) ||
      exList.find(ex => ex.assignedHalaqahs?.includes(part.halaqahSnapshot)) ||
      exList.find(ex => ex.canExamineAll)
    );
  };

  const openQueueModal = (sess: ZiyadahAccelSession) => {
    const activeParts = participants.filter(p => p.participantStatus === 'active');
    const sessSubs = submissions.filter(sub => sub.sessionId === sess.id);
    const exList = sessionExaminers.filter(se => se.sessionId === sess.id);
    const subMap = new Map(sessSubs.map(s => [s.participantId, s]));

    const sorted = [...activeParts]
      .sort((a, b) => (subMap.get(a.id)?.queueOrder ?? 9999) - (subMap.get(b.id)?.queueOrder ?? 9999))
      .map(p => {
        const sub = subMap.get(p.id);
        const fallbackEx = resolveDefaultExaminerForParticipant(p, exList);
        return {
          participantId: p.id,
          studentName: p.studentNameSnapshot,
          className: p.classSnapshot,
          halaqah: p.halaqahSnapshot,
          assignedExaminerId: sub?.assignedExaminerId || fallbackEx?.examinerUserId || null,
          groupLabel: sub?.groupLabel || fallbackEx?.groupLabel || null
        };
      });

    setQueueModalSession(sess);
    setSelectedQueueGroupExaminerId(exList[0]?.examinerUserId || 'ALL');
    setQueueDraft(sorted);
    setQueueOffsetDraft(sess.regularQueueOffset || 0);
    setExaminerGroupOffsetsDraft(
      exList.map(ex => ({
        examinerUserId: ex.examinerUserId,
        examinerName: ex.examinerNameSnapshot,
        groupLabel: ex.groupLabel || `Majelis ${ex.examinerNameSnapshot}`,
        regularQueueOffset: ex.regularQueueOffset ?? sess.regularQueueOffset ?? 0,
        regularFinishConfirmed: Boolean(ex.regularFinishConfirmed)
      }))
    );
  };

  const filteredQueueDraftIndices = useMemo(() => {
    const indices: number[] = [];
    queueDraft.forEach((item, idx) => {
      if (
        selectedQueueGroupExaminerId === 'ALL' ||
        item.assignedExaminerId === selectedQueueGroupExaminerId
      ) {
        indices.push(idx);
      }
    });
    return indices;
  }, [queueDraft, selectedQueueGroupExaminerId]);

  const moveQueueItemInFilteredGroup = (filteredPos: number, dir: -1 | 1) => {
    const targetPos = filteredPos + dir;
    if (targetPos < 0 || targetPos >= filteredQueueDraftIndices.length) return;
    const realIdxA = filteredQueueDraftIndices[filteredPos];
    const realIdxB = filteredQueueDraftIndices[targetPos];
    setQueueDraft(prev => {
      const copy = [...prev];
      const tmp = copy[realIdxA];
      copy[realIdxA] = copy[realIdxB];
      copy[realIdxB] = tmp;
      return copy;
    });
  };

  return (
    <div className="space-y-5">
      {/* Banner Penjelasan Jujur Mekanisme Giliran Terakhir (Keputusan Admin A.4) */}
      <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 text-indigo-950 text-xs flex items-start gap-2.5">
        <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
        <div className="space-y-0.5 leading-relaxed">
          <div className="font-bold">
            Aturan Giliran Terakhir Peserta Akselerasi Per Kelompok/Majelis Penguji
          </div>
          <p className="text-indigo-900/90">
            Karena SITA tidak menyimpan antrean panggil harian santri reguler secara real-time, urutan giliran terakhir dikelola secara eksplisit per majelis penguji menggunakan <strong>Estimasi Santri Reguler Pendahulu</strong> dan <strong>Status Konfirmasi Selesai Setoran Reguler</strong> dari masing-masing penguji/koordinator.
          </p>
        </div>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-teal-600" />
            <span>Manajemen Sesi Dinamis ({sessions.filter(s => s.status !== 'cancelled').length} Sesi)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Jumlah sesi fleksibel (1..N). Dukung pembagian kelompok/majelis penguji per kelas atau halaqah beserta antrean gilirannya masing-masing.
          </p>
        </div>

        {!isLocked && (
          <button
            type="button"
            onClick={openCreateForm}
            className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold flex items-center gap-2 shadow-sm self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Sesi Baru</span>
          </button>
        )}
      </div>

      {/* Form Tambah / Edit Sesi */}
      {isFormOpen && !isLocked && (
        <form
          onSubmit={handleSubmitSession}
          className="bg-white p-6 rounded-2xl border border-teal-200 shadow-md space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h4 className="text-sm font-bold text-slate-800">
              {editingSession ? `Edit ${editingSession.name}` : 'Konfigurasi Sesi Ujian Baru'}
            </h4>
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {formError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Nomor Sesi</label>
              <input
                type="number"
                min={1}
                value={sessNumber}
                onChange={e => setSessNumber(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-mono font-bold"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">Nama Sesi</label>
              <input
                type="text"
                value={sessName}
                onChange={e => setSessName(e.target.value)}
                placeholder="Contoh: Sesi 1 — Pagi"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
                required
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Tanggal</label>
              <input
                type="date"
                value={sessDate}
                onChange={e => setSessDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50"
                required
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Default Offset Reguler
              </label>
              <input
                type="number"
                min={0}
                value={regularOffset}
                onChange={e => setRegularOffset(Math.max(0, parseInt(e.target.value) || 0))}
                title="Estimasi default jumlah santri reguler sebelum giliran akselerasi"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Jam Mulai</label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Jam Selesai</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50"
              />
            </div>
          </div>

          {/* Penugasan Penguji & Kelompok Majelis */}
          <div className="space-y-2.5 pt-2 border-t border-slate-100">
            <label className="block text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-teal-600" />
              <span>Tugaskan Penguji &amp; Kelompok Majelis ({draftExaminers.length} dipilih)</span>
            </label>
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              {teachers.map(t => {
                const active = draftExaminers.some(x => x.examinerUserId === t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleToggleExaminer(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                      active
                        ? 'bg-teal-600 text-white border-teal-700 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {t.name} ({t.role === 'admin' ? 'Admin' : 'Guru'})
                  </button>
                );
              })}
            </div>

            {draftExaminers.length > 0 && (
              <div className="space-y-2.5">
                {draftExaminers.map(ex => (
                  <div
                    key={ex.examinerUserId}
                    className="p-3.5 rounded-xl bg-teal-50/40 border border-teal-200/70 space-y-2.5 text-xs"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-center">
                      <div className="font-bold text-slate-800">{ex.examinerNameSnapshot}</div>
                      <input
                        type="text"
                        value={ex.groupLabel || ''}
                        onChange={e =>
                          updateExaminerConfig(ex.examinerUserId, { groupLabel: e.target.value })
                        }
                        placeholder="Nama Majelis / Kelompok"
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-medium"
                      />
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-600 whitespace-nowrap">
                          Reguler Majelis:
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={ex.regularQueueOffset ?? 0}
                          onChange={e =>
                            updateExaminerConfig(ex.examinerUserId, {
                              regularQueueOffset: Math.max(0, parseInt(e.target.value) || 0)
                            })
                          }
                          className="w-16 px-2 py-1 rounded-lg border border-slate-200 bg-white font-mono font-bold text-center"
                        />
                      </div>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={ex.canExamineAll}
                          onChange={e =>
                            updateExaminerConfig(ex.examinerUserId, {
                              canExamineAll: e.target.checked
                            })
                          }
                        />
                        <span>Semua Peserta Sesi</span>
                      </label>
                    </div>

                    {!ex.canExamineAll && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 border-t border-teal-200/50">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Batasi Kelas (Pilih 1 atau lebih):
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {distinctClasses.map(c => {
                              const picked = ex.assignedClasses?.includes(c);
                              return (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => {
                                    const cur = ex.assignedClasses || [];
                                    const next = picked
                                      ? cur.filter(x => x !== c)
                                      : [...cur, c];
                                    updateExaminerConfig(ex.examinerUserId, {
                                      assignedClasses: next
                                    });
                                  }}
                                  className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                                    picked
                                      ? 'bg-emerald-600 text-white border-emerald-700'
                                      : 'bg-white text-slate-600 border-slate-200'
                                  }`}
                                >
                                  Kelas {c}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Atau Batasi Halaqah:
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {distinctHalaqahs.map(h => {
                              const picked = ex.assignedHalaqahs?.includes(h);
                              return (
                                <button
                                  key={h}
                                  type="button"
                                  onClick={() => {
                                    const cur = ex.assignedHalaqahs || [];
                                    const next = picked
                                      ? cur.filter(x => x !== h)
                                      : [...cur, h];
                                    updateExaminerConfig(ex.examinerUserId, {
                                      assignedHalaqahs: next
                                    });
                                  }}
                                  className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                                    picked
                                      ? 'bg-teal-600 text-white border-teal-700'
                                      : 'bg-white text-slate-600 border-slate-200'
                                  }`}
                                >
                                  {h}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Menyimpan...' : 'Simpan Sesi'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Daftar Kartu Sesi */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sessions.map(sess => {
          const exList = sessionExaminers.filter(se => se.sessionId === sess.id);
          return (
            <div
              key={sess.id}
              className={`bg-white p-5 rounded-2xl border shadow-sm space-y-3 ${
                sess.status === 'active'
                  ? 'border-emerald-400 ring-2 ring-emerald-500/10'
                  : sess.status === 'cancelled'
                  ? 'border-slate-200 opacity-60'
                  : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-xs font-bold">
                      #{sess.sessionNumber}
                    </span>
                    <h4 className="text-sm font-extrabold text-slate-900">{sess.name}</h4>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Tanggal: <strong>{sess.sessionDate}</strong>{' '}
                    {sess.startTime ? `• ${sess.startTime}–${sess.endTime || ''}` : ''}
                  </div>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
                    sess.status === 'active'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : sess.status === 'closed'
                      ? 'bg-slate-200 text-slate-700'
                      : sess.status === 'cancelled'
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-blue-50 text-blue-700 border border-blue-200'
                  }`}
                >
                  {sess.status}
                </span>
              </div>

              <div className="text-xs bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5">
                <div className="font-semibold text-slate-600">Kelompok / Majelis Penguji:</div>
                {exList.length > 0 ? (
                  <div className="space-y-1">
                    {exList.map(e => (
                      <div
                        key={e.examinerUserId}
                        className="flex flex-wrap items-center justify-between gap-1 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200/80"
                      >
                        <div>
                          <span className="font-bold text-slate-800">{e.examinerNameSnapshot}</span>
                          {e.groupLabel ? (
                            <span className="text-slate-500"> • {e.groupLabel}</span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono font-bold">
                            +{e.regularQueueOffset ?? sess.regularQueueOffset ?? 0} reguler
                          </span>
                          {e.regularFinishConfirmed ? (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                              <CheckCircle2 className="w-3 h-3" /> Reguler Selesai
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                              Menunggu Reguler
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-amber-700 font-semibold">
                    Belum ada penguji ditugaskan (Hanya Koordinator)
                  </span>
                )}
              </div>

              {!isLocked && sess.status !== 'cancelled' && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {sess.status !== 'active' && (
                    <button
                      type="button"
                      onClick={() => onChangeSessionStatus(sess.id, 'active')}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <Play className="w-3.5 h-3.5" /> Aktifkan Sesi
                    </button>
                  )}
                  {sess.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => onChangeSessionStatus(sess.id, 'closed')}
                      className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <Lock className="w-3.5 h-3.5" /> Tutup Sesi
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openQueueModal(sess)}
                    className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold flex items-center gap-1"
                  >
                    <ListOrdered className="w-3.5 h-3.5" /> Antrean Per Majelis
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditForm(sess)}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1"
                  >
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                  {sess.status !== 'closed' && (
                    <button
                      type="button"
                      onClick={() => {
                        const r = window.prompt(`Alasan membatalkan ${sess.name}:`);
                        if (r !== null) onChangeSessionStatus(sess.id, 'cancelled', r);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold flex items-center gap-1 ml-auto"
                    >
                      <Ban className="w-3.5 h-3.5" /> Batalkan
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal Pengaturan Antrean Giliran Terakhir Per Kelompok Penguji */}
      {queueModalSession && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold">
                  Pengaturan Antrean Per Kelompok Penguji — {queueModalSession.name}
                </h4>
                <p className="text-[11px] text-slate-300">
                  Atur giliran terakhir peserta akselerasi per majelis beserta estimasi santri reguler pendahulu
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQueueModalSession(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {examinerGroupOffsetsDraft.length > 0 && (
              <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-2.5 text-xs">
                <div className="font-bold text-slate-700">
                  Pilih Majelis &amp; Konfigurasi Santri Reguler Pendahulu:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedQueueGroupExaminerId('ALL')}
                    className={`px-3 py-1.5 rounded-xl font-bold border ${
                      selectedQueueGroupExaminerId === 'ALL'
                        ? 'bg-indigo-600 text-white border-indigo-700'
                        : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    Semua Kelompok ({queueDraft.length})
                  </button>
                  {examinerGroupOffsetsDraft.map(eg => (
                    <button
                      key={eg.examinerUserId}
                      type="button"
                      onClick={() => setSelectedQueueGroupExaminerId(eg.examinerUserId)}
                      className={`px-3 py-1.5 rounded-xl font-bold border ${
                        selectedQueueGroupExaminerId === eg.examinerUserId
                          ? 'bg-indigo-600 text-white border-indigo-700'
                          : 'bg-white text-slate-700 border-slate-200'
                      }`}
                    >
                      {eg.groupLabel} ({eg.examinerName})
                    </button>
                  ))}
                </div>

                {selectedQueueGroupExaminerId !== 'ALL' && (
                  <div className="p-3 rounded-xl bg-white border border-indigo-200 flex flex-wrap items-center justify-between gap-3">
                    {examinerGroupOffsetsDraft
                      .filter(eg => eg.examinerUserId === selectedQueueGroupExaminerId)
                      .map(eg => (
                        <React.Fragment key={eg.examinerUserId}>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-700">
                              Estimasi santri reguler di {eg.groupLabel}:
                            </span>
                            <input
                              type="number"
                              min={0}
                              value={eg.regularQueueOffset}
                              onChange={e => {
                                const val = Math.max(0, parseInt(e.target.value) || 0);
                                setExaminerGroupOffsetsDraft(prev =>
                                  prev.map(x =>
                                    x.examinerUserId === eg.examinerUserId
                                      ? { ...x, regularQueueOffset: val }
                                      : x
                                  )
                                );
                              }}
                              className="w-20 px-2.5 py-1 rounded-lg border border-slate-300 font-mono font-bold text-center"
                            />
                          </div>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer font-bold text-emerald-800">
                            <input
                              type="checkbox"
                              checked={eg.regularFinishConfirmed}
                              onChange={e => {
                                const chk = e.target.checked;
                                setExaminerGroupOffsetsDraft(prev =>
                                  prev.map(x =>
                                    x.examinerUserId === eg.examinerUserId
                                      ? { ...x, regularFinishConfirmed: chk }
                                      : x
                                  )
                                );
                              }}
                            />
                            <span>Setoran Reguler Majelis Selesai</span>
                          </label>
                        </React.Fragment>
                      ))}
                  </div>
                )}
              </div>
            )}

            <div className="p-4 overflow-y-auto flex-1 divide-y divide-slate-100">
              {filteredQueueDraftIndices.map((realIdx, groupPos) => {
                const item = queueDraft[realIdx];
                const eg = examinerGroupOffsetsDraft.find(
                  x => x.examinerUserId === item.assignedExaminerId
                );
                const baseOffset = eg ? eg.regularQueueOffset : queueOffsetDraft;

                return (
                  <div
                    key={item.participantId}
                    className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-mono font-bold">
                        Aksel #{groupPos + 1} (Est. #{baseOffset + groupPos + 1})
                      </span>
                      <div>
                        <div className="font-bold text-slate-800">{item.studentName}</div>
                        <div className="text-[11px] text-slate-400">
                          Kelas {item.className} • {item.halaqah}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {examinerGroupOffsetsDraft.length > 0 && (
                        <select
                          value={item.assignedExaminerId || ''}
                          onChange={e => {
                            const exId = e.target.value || null;
                            const found = examinerGroupOffsetsDraft.find(
                              x => x.examinerUserId === exId
                            );
                            setQueueDraft(prev =>
                              prev.map((q, idx) =>
                                idx === realIdx
                                  ? {
                                      ...q,
                                      assignedExaminerId: exId,
                                      groupLabel: found?.groupLabel || null
                                    }
                                  : q
                              )
                            );
                          }}
                          className="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-[11px] font-semibold"
                        >
                          <option value="">-- Umum --</option>
                          {examinerGroupOffsetsDraft.map(opt => (
                            <option key={opt.examinerUserId} value={opt.examinerUserId}>
                              {opt.groupLabel}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        disabled={groupPos === 0}
                        onClick={() => moveQueueItemInFilteredGroup(groupPos, -1)}
                        className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-30"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={groupPos === filteredQueueDraftIndices.length - 1}
                        onClick={() => moveQueueItemInFilteredGroup(groupPos, 1)}
                        className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-30"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setQueueModalSession(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 text-slate-700 text-xs font-bold"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
                  // Hitung nomor urut per kelompok penguji (1..K di masing-masing majelis)
                  const groupCounters = new Map<string, number>();
                  const computedOrders = queueDraft.map(q => {
                    const gKey = q.assignedExaminerId || '__GLOBAL__';
                    const nextOrd = (groupCounters.get(gKey) || 0) + 1;
                    groupCounters.set(gKey, nextOrd);
                    return {
                      participantId: q.participantId,
                      queueOrder: nextOrd,
                      assignedExaminerId: q.assignedExaminerId,
                      groupLabel: q.groupLabel
                    };
                  });

                  await onSaveQueueOrder(
                    queueModalSession.id,
                    computedOrders,
                    queueOffsetDraft,
                    examinerGroupOffsetsDraft.map(eg => ({
                      examinerUserId: eg.examinerUserId,
                      groupLabel: eg.groupLabel,
                      regularQueueOffset: eg.regularQueueOffset,
                      regularFinishConfirmed: eg.regularFinishConfirmed
                    }))
                  );
                  setQueueModalSession(null);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
              >
                Simpan Antrean Majelis
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
