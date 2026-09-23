import React, { useState } from 'react';
import { User, ExaminerStudentItem } from '../../types';
import { UserCheck, X, AlertCircle, Check } from 'lucide-react';

interface UASAssignExaminerModalProps {
  periodId: string;
  student: ExaminerStudentItem;
  teachers: User[];
  onAssign: (studentId: string, examinerId: string, reason?: string) => Promise<void>;
  onClose: () => void;
}

export const UASAssignExaminerModal: React.FC<UASAssignExaminerModalProps> = ({
  periodId,
  student,
  teachers,
  onAssign,
  onClose
}) => {
  const [selectedExaminerId, setSelectedExaminerId] = useState<string>(
    student.examinerId || student.teacherId || ''
  );
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInProgress = student.attemptStatus === 'in_progress';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExaminerId) {
      setError('Silakan pilih salah satu ustadz/ustadzah penguji.');
      return;
    }

    if (isInProgress && (!reason || !reason.trim())) {
      setError('Sesi ujian santri sedang berjalan (in_progress). Wajib mencantumkan alasan pengalihan/penggantian penguji.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onAssign(student.studentId, selectedExaminerId, reason);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Gagal menugaskan penguji.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200/60 flex items-center justify-center text-teal-700">
              <UserCheck size={18} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Tugaskan Penguji UAS</h3>
              <p className="text-xs text-slate-500">{student.studentName} ({student.class})</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700">
              <AlertCircle size={15} className="shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Pilih Guru / Penguji
            </label>
            <p className="text-[11px] text-slate-500 mb-2">
              Guru penguji yang ditugaskan akan memiliki hak akses membuka dan menilai 9 butir soal UAS santri ini.
            </p>

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {teachers.map((t) => {
                const isSelected = selectedExaminerId === t.id;
                const isCurrentTeacher = student.teacherId === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedExaminerId(t.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-teal-50/80 border-teal-500 text-teal-900 shadow-sm'
                        : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                        isSelected ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {t.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-xs font-bold leading-tight flex items-center gap-1.5">
                          <span>{t.name}</span>
                          {isCurrentTeacher && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                              Guru Halaqah
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 capitalize">
                          {t.role === 'admin' ? 'Administrator' : 'Guru / Pengajar'}
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-teal-600 text-white flex items-center justify-center">
                        <Check size={12} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {isInProgress && (
            <div className="space-y-1.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
              <label className="block text-xs font-bold text-amber-900">
                Alasan Pengalihan / Penggantian Penguji <span className="text-red-500">*</span>
              </label>
              <p className="text-[11px] text-amber-700">
                Sesi ujian santri sedang berjalan. Perubahan penguji akan dicatat dalam riwayat sistem.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Contoh: Penguji sebelumnya berhalangan hadir / tugas kedinasan..."
                rows={2}
                required
                className="w-full text-xs p-2.5 rounded-lg border border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500/20 bg-white"
              />
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedExaminerId}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 transition-all shadow-sm flex items-center gap-1.5"
            >
              <UserCheck size={14} className={isSubmitting ? 'animate-spin' : ''} />
              <span>{isSubmitting ? 'Menyimpan...' : 'Tugaskan Penguji'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
