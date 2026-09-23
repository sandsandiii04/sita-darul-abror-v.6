import React, { useState, useMemo } from 'react';
import { AcademicTerm, ExamPeriod, Student, User } from '../../types';
import { X, Calendar, AlertCircle, Save, CheckSquare, Square, Users, Layers } from 'lucide-react';

interface ExamPeriodModalProps {
  user: User;
  period?: ExamPeriod | null;
  academicTerms: AcademicTerm[];
  students: Student[];
  onClose: () => void;
  onSaved: (period: ExamPeriod, selectedStudentIds: string[]) => void;
}

export const ExamPeriodModal: React.FC<ExamPeriodModalProps> = ({
  user,
  period,
  academicTerms,
  students,
  onClose,
  onSaved
}) => {
  const activeTerm = academicTerms.find(t => t.status === 'active') || academicTerms[0];

  const [termId, setTermId] = useState(period?.academicTermId || activeTerm?.id || '');
  const [examType, setExamType] = useState<'uts' | 'uas'>(period?.examType || 'uts');
  const [name, setName] = useState(
    period?.name || `UTS Tahfiz Semester Ganjil ${activeTerm?.academicYear || '2026/2027'}`
  );
  const [materialCutoffDate, setMaterialCutoffDate] = useState(
    period?.materialCutoffDate || '2026-09-22'
  );
  const [examStartDate, setExamStartDate] = useState(period?.examStartDate || '2026-09-23');
  const [examEndDate, setExamEndDate] = useState(period?.examEndDate || '2026-09-24');
  const [kkm, setKkm] = useState(period?.kkm || 75);
  const [utsQuestionCount, setUtsQuestionCount] = useState<5 | 10 | 15 | 20>(
    ([5, 10, 15, 20].includes(period?.utsQuestionCount as any) ? period?.utsQuestionCount : 5) as 5 | 10 | 15 | 20
  );

  // Participant selection mode
  const [selectionMode, setSelectionMode] = useState<'all' | 'class' | 'halaqah'>('all');
  const [selectedClasses, setSelectedClasses] = useState<string[]>(period?.targetClasses || []);
  const [selectedHalaqahs, setSelectedHalaqahs] = useState<string[]>(period?.targetHalaqahs || []);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Extract distinct classes and halaqahs from students
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => { if (s.class) set.add(s.class); });
    return Array.from(set).sort();
  }, [students]);

  const availableHalaqahs = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => { if (s.halaqah) set.add(s.halaqah); });
    return Array.from(set).sort();
  }, [students]);

  // Compute selected students count
  const filteredStudents = useMemo(() => {
    if (selectionMode === 'all') {
      return students;
    }
    if (selectionMode === 'class') {
      return students.filter(s => selectedClasses.includes(s.class));
    }
    if (selectionMode === 'halaqah') {
      return students.filter(s => selectedHalaqahs.includes(s.halaqah));
    }
    return students;
  }, [students, selectionMode, selectedClasses, selectedHalaqahs]);

  const handleToggleClass = (cls: string) => {
    setSelectedClasses(prev => 
      prev.includes(cls) ? prev.filter(c => c !== cls) : [...prev, cls]
    );
  };

  const handleToggleHalaqah = (hal: string) => {
    setSelectedHalaqahs(prev => 
      prev.includes(hal) ? prev.filter(h => h !== hal) : [...prev, hal]
    );
  };

  const handleTypeChange = (type: 'uts' | 'uas') => {
    setExamType(type);
    const term = academicTerms.find(t => t.id === termId);
    const semLabel = term ? (term.semester === 'ganjil' ? 'Ganjil' : 'Genap') : 'Ganjil';
    const yearLabel = term ? term.academicYear : '2026/2027';
    setName(`${type.toUpperCase()} Tahfiz Semester ${semLabel} ${yearLabel}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Nama periode ujian wajib diisi.');
      return;
    }
    if (!termId) {
      setErrorMessage('Pilih semester acuan.');
      return;
    }
    if (!materialCutoffDate) {
      setErrorMessage('Batas tanggal setoran (cutoff) wajib diisi.');
      return;
    }
    if (filteredStudents.length === 0) {
      setErrorMessage('Pilih minimal 1 santri peserta ujian.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const periodPayload: ExamPeriod = {
      id: period?.id || `period_${Date.now()}`,
      academicTermId: termId,
      name: name.trim(),
      examType,
      materialCutoffDate,
      examStartDate: examStartDate || null,
      examEndDate: examEndDate || null,
      kkm: Number(kkm) || 75,
      targetClasses: selectionMode === 'class' ? selectedClasses : [],
      targetHalaqahs: selectionMode === 'halaqah' ? selectedHalaqahs : [],
      status: period?.status || 'preparation',
      utsQuestionCount: examType === 'uts' ? utsQuestionCount : undefined,
      createdAt: period?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const studentIds = filteredStudents.map(s => s.id);
    onSaved(periodPayload, studentIds);
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <Calendar size={20} className="text-emerald-100" />
            </div>
            <div>
              <h3 className="font-bold text-base">
                {period ? 'Edit Periode Evaluasi' : 'Buat Periode Ujian UTS/UAS'}
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
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Academic Term Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Semester Acuan
              </label>
              <select
                value={termId}
                onChange={(e) => setTermId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                required
              >
                {academicTerms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.academicYear} - Semester {t.semester === 'ganjil' ? 'Ganjil' : 'Genap'} {t.status === 'active' ? '(Aktif)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Jenis Ujian
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleTypeChange('uts')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                    examType === 'uts'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-600/20'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  UTS (Tengah Semester)
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeChange('uas')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                    examType === 'uas'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-600/20'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  UAS (Akhir Semester)
                </button>
              </div>
            </div>
          </div>

          {/* Konfigurasi Jumlah Soal UTS */}
          {examType === 'uts' && (
            <div className="p-3.5 bg-emerald-50/60 border border-emerald-200/80 rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-emerald-950">
                  Jumlah Butir Soal UTS
                </label>
                <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-100/80 px-2 py-0.5 rounded-full">
                  Total Nilai: 100 Poin
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {([5, 10, 15, 20] as const).map(count => {
                  const ptsPerQ = count === 5 ? '20' : count === 10 ? '10' : count === 15 ? '~6.67' : '5';
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setUtsQuestionCount(count)}
                      className={`py-2 px-2 rounded-xl border text-center transition-all ${
                        utsQuestionCount === count
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-600/20 ring-2 ring-emerald-500/30'
                          : 'bg-white border-slate-200 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/30'
                      }`}
                    >
                      <div className="font-extrabold text-xs">{count} Soal</div>
                      <div className={`text-[10px] mt-0.5 ${utsQuestionCount === count ? 'text-emerald-100' : 'text-slate-400'}`}>
                        {ptsPerQ} poin/soal
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-emerald-800/80">
                Plafon skor per butir soal dan skala penalti kesalahan dihitung secara otomatis dan proporsional.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nama Periode Ujian
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: UTS Tahfiz Semester Ganjil 2026/2027"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              required
            />
          </div>

          {/* Dates & KKM */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Batas Setoran (Cutoff) *
              </label>
              <input
                type="date"
                value={materialCutoffDate}
                onChange={(e) => setMaterialCutoffDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                required
              />
              <span className="text-[10px] text-slate-500">Materi dihitung s/d tanggal ini</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Rentang Ujian
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={examStartDate}
                  onChange={(e) => setExamStartDate(e.target.value)}
                  className="w-full px-2 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
                <span className="text-slate-400 text-xs">-</span>
                <input
                  type="date"
                  value={examEndDate}
                  onChange={(e) => setExamEndDate(e.target.value)}
                  className="w-full px-2 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <span className="text-[10px] text-slate-500">Jadwal pelaksanaan</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                KKM Standar
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={kkm}
                onChange={(e) => setKkm(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                required
              />
              <span className="text-[10px] text-slate-500">Standar kelulusan (default: 75)</span>
            </div>
          </div>

          {/* Selection of Participants */}
          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Users size={16} className="text-emerald-600" />
                <span>Peserta Ujian Santri</span>
              </label>
              <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200">
                {filteredStudents.length} Santri Terpilih
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { id: 'all', label: 'Semua Santri Aktif' },
                { id: 'class', label: 'Pilih Berdasarkan Kelas' },
                { id: 'halaqah', label: 'Pilih Berdasarkan Halaqah' },
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectionMode(opt.id as any)}
                  className={`py-1.5 px-3 rounded-xl border text-xs font-semibold transition-all ${
                    selectionMode === opt.id
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {selectionMode === 'class' && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                <p className="text-[11px] font-semibold text-slate-600 mb-2">Pilih Kelas Peserta:</p>
                <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
                  {availableClasses.map(cls => {
                    const isSelected = selectedClasses.includes(cls);
                    return (
                      <button
                        key={cls}
                        type="button"
                        onClick={() => handleToggleClass(cls)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all ${
                          isSelected
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {isSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                        <span>Kelas {cls}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selectionMode === 'halaqah' && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                <p className="text-[11px] font-semibold text-slate-600 mb-2">Pilih Halaqah Peserta:</p>
                <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
                  {availableHalaqahs.map(hal => {
                    const isSelected = selectedHalaqahs.includes(hal);
                    return (
                      <button
                        key={hal}
                        type="button"
                        onClick={() => handleToggleHalaqah(hal)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all ${
                          isSelected
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {isSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                        <span>{hal}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

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
              disabled={isSubmitting || filteredStudents.length === 0}
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-xl shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Save size={15} />
              <span>{isSubmitting ? 'Memproses...' : 'Simpan & Daftarkan Peserta'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
