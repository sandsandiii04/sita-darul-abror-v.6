import React, { useState } from 'react';
import { AcademicTerm, User } from '../../types';
import { X, Calendar, AlertCircle, Save, CheckCircle } from 'lucide-react';

interface AcademicTermModalProps {
  user: User;
  term?: AcademicTerm | null;
  onClose: () => void;
  onSaved: (term: AcademicTerm) => void;
}

export const AcademicTermModal: React.FC<AcademicTermModalProps> = ({
  user,
  term,
  onClose,
  onSaved
}) => {
  const [academicYear, setAcademicYear] = useState(term?.academicYear || '2026/2027');
  const [semester, setSemester] = useState<'ganjil' | 'genap'>(term?.semester || 'ganjil');
  const [startDate, setStartDate] = useState(term?.startDate || '2026-07-15');
  const [endDate, setEndDate] = useState(term?.endDate || '2026-12-20');
  const [status, setStatus] = useState<'draft' | 'active' | 'completed'>(term?.status || 'active');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!academicYear.trim()) {
      setErrorMessage('Tahun ajaran wajib diisi.');
      return;
    }
    if (startDate > endDate) {
      setErrorMessage('Tanggal mulai semester tidak boleh lebih besar dari tanggal selesai.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const termPayload: AcademicTerm = {
      id: term?.id || `term_${Date.now()}`,
      academicYear: academicYear.trim(),
      semester,
      startDate,
      endDate,
      status,
      createdAt: term?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    onSaved(termPayload);
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <Calendar size={20} className="text-emerald-100" />
            </div>
            <div>
              <h3 className="font-bold text-base">
                {term ? 'Edit Semester & Tahun Ajaran' : 'Tambah Semester Baru'}
              </h3>
              <p className="text-xs text-emerald-100">
                Pondok Pesantren Darul Abror IBS
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-emerald-100 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tahun Ajaran
              </label>
              <input
                type="text"
                placeholder="Contoh: 2026/2027"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Semester
              </label>
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value as any)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
              >
                <option value="ganjil">Ganjil</option>
                <option value="genap">Genap</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tanggal Mulai
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tanggal Selesai
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Status Semester
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'active', label: 'Aktif (Berjalan)', desc: 'Menjadi acuan materi saat ini' },
                { id: 'draft', label: 'Draft', desc: 'Belum diberlakukan' },
                { id: 'completed', label: 'Selesai', desc: 'Arsip riwayat semester' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStatus(opt.id as any)}
                  className={`p-2.5 rounded-xl border text-left transition-all text-xs ${
                    status === opt.id
                      ? 'border-emerald-500 bg-emerald-50/60 text-emerald-900 font-semibold ring-1 ring-emerald-500'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span>{opt.label}</span>
                    {status === opt.id && <CheckCircle size={14} className="text-emerald-600" />}
                  </div>
                  <p className="text-[10px] text-slate-500 font-normal leading-tight">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {status === 'active' && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 leading-relaxed">
              <span className="font-semibold">Catatan:</span> Mengaktifkan semester ini akan secara otomatis menonaktifkan semester aktif sebelumnya agar data setoran terarah presisi.
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-xl shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Save size={15} />
              <span>{isSubmitting ? 'Menyimpan...' : 'Simpan Semester'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
