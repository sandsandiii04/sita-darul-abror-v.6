import React, { useState } from 'react';
import { TahsinPeriod, User } from '../../types';
import { X, Calendar, Plus, Save, AlertCircle } from 'lucide-react';

interface TahsinPeriodModalProps {
  isOpen: boolean;
  onClose: () => void;
  periodToEdit?: TahsinPeriod | null;
  onSave: (period: TahsinPeriod) => Promise<void>;
  currentUser: User;
  availableClasses: string[];
}

export const TahsinPeriodModal: React.FC<TahsinPeriodModalProps> = ({
  isOpen,
  onClose,
  periodToEdit,
  onSave,
  currentUser,
  availableClasses
}) => {
  if (!isOpen) return null;

  const [name, setName] = useState<string>(periodToEdit?.name || '');
  const [academicYear, setAcademicYear] = useState<string>(periodToEdit?.academicYear || '2026/2027');
  const [semester, setSemester] = useState<'ganjil' | 'genap'>(periodToEdit?.semester || 'ganjil');
  const [startDate, setStartDate] = useState<string>(periodToEdit?.startDate || new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(periodToEdit?.endDate || new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0]);
  const [status, setStatus] = useState<'draft' | 'active' | 'closed'>(periodToEdit?.status || 'active');
  const [passingGrade, setPassingGrade] = useState<number>(periodToEdit?.passingGrade ?? 80);
  const [minMakharij, setMinMakharij] = useState<number>(periodToEdit?.minMakharij ?? 75);
  const [minTajwid, setMinTajwid] = useState<number>(periodToEdit?.minTajwid ?? 75);
  const [selectedClasses, setSelectedClasses] = useState<string[]>(periodToEdit?.targetClasses || availableClasses);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggleClass = (className: string) => {
    setSelectedClasses(prev => 
      prev.includes(className) ? prev.filter(c => c !== className) : [...prev, className]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama periode wajib diisi.');
      return;
    }
    if (startDate > endDate) {
      setError('Tanggal mulai tidak boleh lebih lambat dari tanggal selesai.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const id = periodToEdit?.id || `tp_${Date.now()}`;
      const payload: TahsinPeriod = {
        id,
        name: name.trim(),
        academicYear,
        semester,
        startDate,
        endDate,
        status,
        passingGrade: Number(passingGrade),
        minMakharij: Number(minMakharij),
        minTajwid: Number(minTajwid),
        targetClasses: selectedClasses,
        createdBy: currentUser.id,
        createdAt: periodToEdit?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await onSave(payload);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan periode ujian.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 my-8 animate-fade-in border border-slate-100">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="text-emerald-600" size={20} />
            <h3 className="font-extrabold text-base text-slate-800">
              {periodToEdit ? 'Edit Periode Ujian Tahsin' : 'Buat Periode Ujian Tahsin Baru'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Nama Periode Ujian:</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Ujian Tahsin Semester Ganjil 2026/2027"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white text-xs font-semibold"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Tahun Ajaran:</label>
              <input
                type="text"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                placeholder="2026/2027"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none text-xs font-medium"
                required
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Semester:</label>
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value as 'ganjil' | 'genap')}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none text-xs font-semibold capitalize"
              >
                <option value="ganjil">Ganjil</option>
                <option value="genap">Genap</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Tanggal Mulai:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none text-xs"
                required
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Tanggal Selesai:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none text-xs"
                required
              />
            </div>
          </div>

          {/* Aturan Standar Kelulusan */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
            <h4 className="font-extrabold text-slate-800 text-[11px] uppercase tracking-wider">
              Standar Kelulusan Tahsin
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">KKM Nilai Akhir:</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={passingGrade}
                  onChange={(e) => setPassingGrade(parseFloat(e.target.value) || 80)}
                  className="w-full p-2 bg-white border border-slate-200 rounded-lg text-center font-bold text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Min. Makharij:</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={minMakharij}
                  onChange={(e) => setMinMakharij(parseFloat(e.target.value) || 75)}
                  className="w-full p-2 bg-white border border-slate-200 rounded-lg text-center font-bold text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Min. Tajwid:</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={minTajwid}
                  onChange={(e) => setMinTajwid(parseFloat(e.target.value) || 75)}
                  className="w-full p-2 bg-white border border-slate-200 rounded-lg text-center font-bold text-xs"
                />
              </div>
            </div>
          </div>

          {/* Target Kelas */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-bold text-slate-700">Target Kelas Peserta:</label>
              <button
                type="button"
                onClick={() => setSelectedClasses(selectedClasses.length === availableClasses.length ? [] : availableClasses)}
                className="text-[10px] font-bold text-emerald-600 hover:underline"
              >
                {selectedClasses.length === availableClasses.length ? 'Batal Semua' : 'Pilih Semua'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-xl max-h-32 overflow-y-auto">
              {availableClasses.map(c => {
                const isSelected = selectedClasses.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleToggleClass(c)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
                      isSelected 
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs' 
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Kelas {c}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Status Periode:</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'active' | 'closed')}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none uppercase"
            >
              <option value="draft">Draft (Persiapan)</option>
              <option value="active">Aktif (Sedang Berjalan)</option>
              <option value="closed">Ditutup (Selesai)</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-colors shadow-sm flex items-center gap-1.5"
            >
              <Save size={14} />
              {isSubmitting ? 'Menyimpan...' : 'Simpan Periode'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TahsinPeriodModal;
