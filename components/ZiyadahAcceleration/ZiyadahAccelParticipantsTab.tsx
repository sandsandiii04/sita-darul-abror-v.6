import React, { useMemo, useState } from 'react';
import {
  Student,
  TahfidzRecord,
  ZiyadahAccelEvent,
  ZiyadahAccelParticipant
} from '../../types';
import { extractStudentDailyBaseline } from '../../services/ziyadahAccelPageCalc';
import {
  UserPlus,
  Search,
  CheckSquare,
  Square,
  Users,
  CheckCircle2,
  UserX,
  RotateCcw
} from 'lucide-react';

interface ZiyadahAccelParticipantsTabProps {
  event: ZiyadahAccelEvent;
  allStudents: Student[];
  dailyRecords: TahfidzRecord[];
  participants: ZiyadahAccelParticipant[];
  isLocked: boolean;
  onEnrollStudents: (
    items: Array<{
      studentId: string;
      directionHint?: string;
      baselineSurah?: number | null;
      baselineAyah?: number | null;
      baselinePage?: number | null;
      baselineLabel?: string | null;
    }>
  ) => Promise<void>;
  onToggleParticipantStatus: (
    participantId: string,
    status: 'active' | 'withdrawn',
    reason?: string
  ) => Promise<void>;
}

export const ZiyadahAccelParticipantsTab: React.FC<ZiyadahAccelParticipantsTabProps> = ({
  allStudents,
  dailyRecords,
  participants,
  isLocked,
  onEnrollStudents,
  onToggleParticipantStatus
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerClass, setPickerClass] = useState('ALL');
  const [pickerHalaqah, setPickerHalaqah] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrolling, setEnrolling] = useState(false);

  const [listSearch, setListSearch] = useState('');
  const [listClass, setListClass] = useState('ALL');

  const activeEnrolledSet = useMemo(() => {
    const s = new Set<string>();
    participants.forEach(p => {
      if (p.participantStatus === 'active') s.add(p.studentId);
    });
    return s;
  }, [participants]);

  const distinctClasses = useMemo(() => {
    const s = new Set<string>();
    allStudents.forEach(st => {
      if (st.class && st.class !== '-') s.add(st.class);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
  }, [allStudents]);

  const distinctHalaqahs = useMemo(() => {
    const s = new Set<string>();
    allStudents.forEach(st => {
      if (st.halaqah && st.halaqah !== '-') s.add(st.halaqah);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
  }, [allStudents]);

  const pickerCandidates = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return allStudents
      .filter(st => {
        if (pickerClass !== 'ALL' && st.class !== pickerClass) return false;
        if (pickerHalaqah !== 'ALL' && st.halaqah !== pickerHalaqah) return false;
        if (q) {
          const mName = (st.name || '').toLowerCase().includes(q);
          const mNis = (st.nis || '').toLowerCase().includes(q);
          if (!mName && !mNis) return false;
        }
        return true;
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));
  }, [allStudents, pickerSearch, pickerClass, pickerHalaqah]);

  const selectableCandidates = useMemo(
    () => pickerCandidates.filter(st => !activeEnrolledSet.has(st.id)),
    [pickerCandidates, activeEnrolledSet]
  );

  const toggleCandidate = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    if (selectableCandidates.every(c => selectedIds.has(c.id)) && selectableCandidates.length > 0) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        selectableCandidates.forEach(c => next.delete(c.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        selectableCandidates.forEach(c => next.add(c.id));
        return next;
      });
    }
  };

  const handleConfirmEnroll = async () => {
    if (selectedIds.size === 0) return;
    setEnrolling(true);
    try {
      const payload = Array.from(selectedIds).map(studentId => {
        const base = extractStudentDailyBaseline(studentId, dailyRecords);
        return {
          studentId,
          directionHint: base.directionHint,
          baselineSurah: base.baselineSurah,
          baselineAyah: base.baselineAyah,
          baselinePage: base.baselinePage,
          baselineLabel: base.baselineLabel
        };
      });
      await onEnrollStudents(payload);
      setSelectedIds(new Set());
      setShowPicker(false);
    } finally {
      setEnrolling(false);
    }
  };

  const filteredParticipants = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return participants.filter(p => {
      if (listClass !== 'ALL' && p.classSnapshot !== listClass) return false;
      if (q) {
        const mName = p.studentNameSnapshot.toLowerCase().includes(q);
        const mNis = p.nisSnapshot.toLowerCase().includes(q);
        const mHlq = p.halaqahSnapshot.toLowerCase().includes(q);
        if (!mName && !mNis && !mHlq) return false;
      }
      return true;
    });
  }, [participants, listSearch, listClass]);

  return (
    <div className="space-y-5">
      {/* Header Kontrol Peserta */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" />
            <span>
              Daftar Peserta Kegiatan ({participants.filter(p => p.participantStatus === 'active').length}{' '}
              Aktif)
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Mengacu langsung ke ID resmi santri SITA dengan pembekuan snapshot Kelas &amp; Halaqah saat kegiatan berlangsung.
          </p>
        </div>

        {!isLocked && (
          <button
            type="button"
            onClick={() => setShowPicker(!showPicker)}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 shadow-sm transition self-start md:self-auto"
          >
            <UserPlus className="w-4 h-4" />
            <span>{showPicker ? 'Tutup Pemilih Santri' : 'Tambah Peserta (Tunggal / Massal)'}</span>
          </button>
        )}
      </div>

      {/* Panel Pemilih Santri dari Database Induk */}
      {showPicker && !isLocked && (
        <div className="bg-emerald-50/40 p-5 rounded-2xl border border-emerald-200 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={pickerSearch}
                onChange={e => setPickerSearch(e.target.value)}
                placeholder="Cari nama santri atau NIS..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs outline-none"
              />
            </div>
            <select
              value={pickerClass}
              onChange={e => setPickerClass(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium outline-none"
            >
              <option value="ALL">Semua Kelas</option>
              {distinctClasses.map(c => (
                <option key={c} value={c}>
                  Kelas {c}
                </option>
              ))}
            </select>
            <select
              value={pickerHalaqah}
              onChange={e => setPickerHalaqah(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium outline-none"
            >
              <option value="ALL">Semua Halaqah</option>
              {distinctHalaqahs.map(h => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <button
              type="button"
              onClick={handleSelectAllFiltered}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 font-semibold text-slate-700 flex items-center gap-1.5"
            >
              <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
              <span>Pilih / Lepas Semua Hasil Filter ({selectableCandidates.length} belum terdaftar)</span>
            </button>

            <button
              type="button"
              disabled={selectedIds.size === 0 || enrolling}
              onClick={handleConfirmEnroll}
              className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white font-bold shadow-sm"
            >
              {enrolling
                ? 'Mendaftarkan...'
                : `Daftarkan ${selectedIds.size} Santri Terpilih`}
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 max-h-72 overflow-y-auto divide-y divide-slate-100">
            {pickerCandidates.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Tidak ditemukan santri sesuai filter.
              </div>
            ) : (
              pickerCandidates.map(st => {
                const alreadyIn = activeEnrolledSet.has(st.id);
                const checked = selectedIds.has(st.id);
                return (
                  <div
                    key={st.id}
                    onClick={() => !alreadyIn && toggleCandidate(st.id)}
                    className={`px-4 py-2.5 flex items-center justify-between text-xs ${
                      alreadyIn
                        ? 'bg-slate-50 opacity-60 cursor-not-allowed'
                        : 'cursor-pointer hover:bg-emerald-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {alreadyIn ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      ) : checked ? (
                        <CheckSquare className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-300" />
                      )}
                      <div>
                        <span className="font-bold text-slate-800">{st.name}</span>
                        <span className="text-slate-400 ml-2 font-mono">NIS: {st.nis}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                        {st.class}
                      </span>
                      <span className="text-slate-500">{st.halaqah}</span>
                      {alreadyIn && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                          Sudah Terdaftar
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Tabel Peserta Terdaftar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3 justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={listSearch}
              onChange={e => setListSearch(e.target.value)}
              placeholder="Filter peserta terdaftar..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs outline-none"
            />
          </div>
          <select
            value={listClass}
            onChange={e => setListClass(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium outline-none"
          >
            <option value="ALL">Semua Kelas</option>
            {Array.from(new Set(participants.map(p => p.classSnapshot)))
              .sort()
              .map(c => (
                <option key={c} value={c}>
                  Kelas {c}
                </option>
              ))}
          </select>
        </div>

        {filteredParticipants.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-400">
            Belum ada peserta pada kegiatan ini. Klik <strong>Tambah Peserta</strong> di kanan atas.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 font-bold uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 w-10 text-center">No</th>
                  <th className="py-3 px-4">Nama Santri &amp; ID</th>
                  <th className="py-3 px-4 text-center">Snapshot Kelas</th>
                  <th className="py-3 px-4">Snapshot Halaqah &amp; Guru</th>
                  <th className="py-3 px-4">Referensi Batas Hafalan Harian</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  {!isLocked && <th className="py-3 px-4 text-center">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredParticipants.map((p, idx) => (
                  <tr
                    key={p.id}
                    className={
                      p.participantStatus === 'withdrawn' ? 'bg-slate-50 opacity-60' : 'hover:bg-slate-50/60'
                    }
                  >
                    <td className="py-3 px-4 text-center font-mono text-slate-400">{idx + 1}</td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{p.studentNameSnapshot}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        NIS: {p.nisSnapshot} • ID: {p.studentId}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2.5 py-0.5 rounded bg-slate-100 text-slate-800 font-bold">
                        {p.classSnapshot}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-700">{p.halaqahSnapshot}</div>
                      <div className="text-[11px] text-slate-400">
                        {p.halaqahTeacherNameSnapshot || '-'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{p.baselineLabel || '-'}</td>
                    <td className="py-3 px-4 text-center">
                      {p.participantStatus === 'active' ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[11px]">
                          Aktif
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-bold text-[11px]">
                          Nonaktif
                        </span>
                      )}
                    </td>
                    {!isLocked && (
                      <td className="py-3 px-4 text-center">
                        {p.participantStatus === 'active' ? (
                          <button
                            type="button"
                            onClick={() => {
                              const reason = window.prompt(
                                `Alasan menonaktifkan ${p.studentNameSnapshot} dari kegiatan ini:`,
                                'Izin uzur kegiatan'
                              );
                              if (reason !== null) {
                                onToggleParticipantStatus(p.id, 'withdrawn', reason);
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-[11px]"
                          >
                            <UserX className="w-3 h-3" /> Nonaktifkan
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onToggleParticipantStatus(p.id, 'active')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                          >
                            <RotateCcw className="w-3 h-3" /> Aktifkan
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
