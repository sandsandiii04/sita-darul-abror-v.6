import React, { useEffect, useState } from 'react';
import {
  User,
  ZiyadahAccelCoordinatorDelegation,
  ZiyadahAccelEvent,
  ZiyadahAccelEventStatus
} from '../../types';
import { getLocalDateString } from '../../constants';
import { safeGetLocalStorage, safeSetLocalStorage } from '../../api';
import { X, Calendar, ShieldCheck, Save, UserCheck, Plus, Trash2 } from 'lucide-react';

const SIGNER_PREF_KEY = 'sita_za_signer_pref_v1';

export interface EventModalFormState {
  name: string;
  academicYear: string;
  semester: 'ganjil' | 'genap';
  startDate: string;
  endDate: string;
  status: ZiyadahAccelEventStatus;
  signerCity: string;
  signerTitle: string;
  signerName: string;
  notes: string;
}

/**
 * Helper murni (mudah diuji unit-test) untuk menurunkan state form modal kegiatan
 * agar saat Admin beralih antara Kegiatan A, Kegiatan B, atau Kegiatan Baru,
 * data TIDAK PERNAH tertukar atau tertimpa nilai default (Perbaikan B-04 & A.3).
 */
export function deriveEventModalFormState(
  initialEvent: ZiyadahAccelEvent | null | undefined,
  today: string,
  savedSignerPref?: { city?: string; title?: string; name?: string } | null
): EventModalFormState {
  if (initialEvent) {
    return {
      name: initialEvent.name || '',
      academicYear: initialEvent.academicYear || '2026/2027',
      semester: initialEvent.semester === 'genap' ? 'genap' : 'ganjil',
      startDate: initialEvent.startDate || today,
      endDate: initialEvent.endDate || initialEvent.startDate || today,
      status: initialEvent.status || 'draft',
      signerCity: initialEvent.signerCity || 'Garut',
      signerTitle: initialEvent.signerTitle ?? '',
      signerName: initialEvent.signerName ?? '',
      notes: initialEvent.notes || ''
    };
  }

  return {
    name: '',
    academicYear: '2026/2027',
    semester: 'ganjil',
    startDate: today,
    endDate: today,
    status: 'draft',
    signerCity: savedSignerPref?.city || 'Garut',
    signerTitle:
      savedSignerPref?.title ??
      "Bagian Tahsin & Tahfidz Al Qur'an Ma'had Darul Abror Islamic Boarding School",
    signerName: savedSignerPref?.name ?? '',
    notes: ''
  };
}

interface ZiyadahAccelEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  teachers: User[];
  coordinators: ZiyadahAccelCoordinatorDelegation[];
  initialEvent?: ZiyadahAccelEvent | null;
  onSaveEvent: (payload: Partial<ZiyadahAccelEvent>) => Promise<{ success: boolean; message?: string }>;
  onToggleCoordinator?: (teacherId: string, isActive: boolean) => Promise<void>;
}

export const ZiyadahAccelEventModal: React.FC<ZiyadahAccelEventModalProps> = ({
  isOpen,
  onClose,
  user,
  teachers,
  coordinators,
  initialEvent,
  onSaveEvent,
  onToggleCoordinator
}) => {
  const today = getLocalDateString();

  const loadSavedSignerPref = () => {
    try {
      const raw = safeGetLocalStorage(SIGNER_PREF_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const [formState, setFormState] = useState<EventModalFormState>(() =>
    deriveEventModalFormState(initialEvent, today, loadSavedSignerPref())
  );
  const [selectedNewCoordId, setSelectedNewCoordId] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // PERBAIKAN B-04: Sinkronkan ulang state setiap kali modal dibuka atau kegiatan yang diedit berganti!
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setSelectedNewCoordId('');
    setFormState(deriveEventModalFormState(initialEvent, getLocalDateString(), loadSavedSignerPref()));
  }, [isOpen, initialEvent?.id, initialEvent?.version]);

  if (!isOpen) return null;

  const updateField = <K extends keyof EventModalFormState>(key: K, val: EventModalFormState[K]) => {
    setFormState(prev => ({ ...prev, [key]: val }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!formState.name.trim()) {
      setErrorMsg('Nama kegiatan wajib diisi.');
      return;
    }
    if (formState.startDate > formState.endDate) {
      setErrorMsg('Tanggal mulai tidak boleh melebihi tanggal selesai.');
      return;
    }

    setSaving(true);
    try {
      const cleanCity = formState.signerCity.trim() || 'Garut';
      const cleanTitle = formState.signerTitle.trim();
      const cleanName = formState.signerName.trim();

      // Simpan preferensi penandatangan pilihan Admin ke localStorage perangkat Admin
      safeSetLocalStorage(
        SIGNER_PREF_KEY,
        JSON.stringify({ city: cleanCity, title: cleanTitle, name: cleanName })
      );

      const res = await onSaveEvent({
        id: initialEvent?.id,
        name: formState.name.trim(),
        academicYear: formState.academicYear.trim(),
        semester: formState.semester,
        startDate: formState.startDate,
        endDate: formState.endDate,
        status: formState.status,
        signerCity: cleanCity,
        signerTitle: cleanTitle,
        signerName: cleanName,
        notes: formState.notes.trim() || null
      });
      if (res.success) {
        onClose();
      } else {
        setErrorMsg(res.message || 'Gagal menyimpan kegiatan.');
      }
    } finally {
      setSaving(false);
    }
  };

  const activeCoords = coordinators.filter(c => c.isActive);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-emerald-800 to-teal-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Calendar className="w-5 h-5 text-emerald-300" />
            <div>
              <h3 className="text-base font-bold">
                {initialEvent
                  ? `Pengaturan Kegiatan: ${initialEvent.name}`
                  : 'Buat Kegiatan Ziyadah Akselerasi Baru'}
              </h3>
              <p className="text-xs text-emerald-100">
                Mendukung sesi dinamis, antrean per majelis penguji, &amp; konfigurasi penandatangan laporan resmi
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 text-sm">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Nama Kegiatan</label>
            <input
              type="text"
              value={formState.name}
              onChange={e => updateField('name', e.target.value)}
              placeholder="Contoh: Ujian Ziyadah Akselerasi November 2026"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-500 outline-none font-medium"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Tahun Ajaran</label>
              <input
                type="text"
                value={formState.academicYear}
                onChange={e => updateField('academicYear', e.target.value)}
                placeholder="2026/2027"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Semester</label>
              <select
                value={formState.semester}
                onChange={e => updateField('semester', e.target.value as 'ganjil' | 'genap')}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white outline-none"
              >
                <option value="ganjil">Semester Ganjil</option>
                <option value="genap">Semester Genap</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Status Kegiatan</label>
              <select
                value={formState.status}
                onChange={e => updateField('status', e.target.value as ZiyadahAccelEventStatus)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white outline-none font-semibold"
              >
                <option value="draft">Draft (Persiapan)</option>
                <option value="scheduled">Terjadwal (Scheduled)</option>
                <option value="active">Aktif Berlangsung</option>
                <option value="closed">Ditutup (Closed)</option>
                <option value="cancelled">Dibatalkan</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Tanggal Mulai</label>
              <input
                type="date"
                value={formState.startDate}
                onChange={e => updateField('startDate', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Tanggal Selesai</label>
              <input
                type="date"
                value={formState.endDate}
                onChange={e => updateField('endDate', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white outline-none"
                required
              />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200/70 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
              <span>Konfigurasi Tanda Tangan Kop Laporan Resmi (Dapat Diatur Admin)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Kota Cetak</label>
                <input
                  type="text"
                  value={formState.signerCity}
                  onChange={e => updateField('signerCity', e.target.value)}
                  placeholder="Garut"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Nama Pejabat / Koordinator Tahfidz (Tampil di Tanda Tangan)
                </label>
                <input
                  type="text"
                  value={formState.signerName}
                  onChange={e => updateField('signerName', e.target.value)}
                  placeholder="Isi nama Koordinator / Kepala Bagian Tahfidz..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Jabatan Penandatangan</label>
              <input
                type="text"
                value={formState.signerTitle}
                onChange={e => updateField('signerTitle', e.target.value)}
                placeholder="Bagian Tahsin & Tahfidz Al Qur'an Ma'had Darul Abror Islamic Boarding School"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Catatan Kegiatan (Opsional)</label>
            <textarea
              rows={2}
              value={formState.notes}
              onChange={e => updateField('notes', e.target.value)}
              placeholder="Target capaian atau instruksi untuk penguji..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs outline-none"
            />
          </div>

          {/* Delegasi Hak Koordinator ke Guru Tertentu (Khusus Admin) */}
          {user.role === 'admin' && onToggleCoordinator && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <UserCheck className="w-4 h-4 text-teal-600" />
                <span>Delegasi Akses Koordinator Akselerasi (Untuk Akun Guru)</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Akun Admin otomatis memiliki akses penuh. Anda juga dapat menunjuk akun Guru tertentu sebagai Koordinator Akselerasi tanpa mengubah role global SITA.
              </p>
              <div className="flex gap-2">
                <select
                  value={selectedNewCoordId}
                  onChange={e => setSelectedNewCoordId(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs outline-none"
                >
                  <option value="">-- Pilih Guru untuk Diberi Hak Koordinator --</option>
                  {teachers
                    .filter(t => t.role === 'teacher' && !activeCoords.some(c => c.userId === t.id))
                    .map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} (@{t.username})
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!selectedNewCoordId}
                  onClick={async () => {
                    if (!selectedNewCoordId) return;
                    await onToggleCoordinator(selectedNewCoordId, true);
                    setSelectedNewCoordId('');
                  }}
                  className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah
                </button>
              </div>
              {activeCoords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {activeCoords.map(c => (
                    <span
                      key={c.userId}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold"
                    >
                      {c.userName}
                      <button
                        type="button"
                        onClick={() => onToggleCoordinator(c.userId, false)}
                        className="text-rose-500 hover:text-rose-700"
                        title="Cabut akses Koordinator"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Menyimpan...' : 'Simpan Kegiatan'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
