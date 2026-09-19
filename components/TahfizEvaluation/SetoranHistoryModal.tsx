import React from 'react';
import { TahfidzRecord, Student } from '../../types';
import { X, BookOpen, Calendar, CheckCircle, Clock } from 'lucide-react';

interface SetoranHistoryModalProps {
  student: Student;
  records: TahfidzRecord[];
  startDate: string;
  cutoffDate: string;
  onClose: () => void;
}

export const SetoranHistoryModal: React.FC<SetoranHistoryModalProps> = ({
  student,
  records,
  startDate,
  cutoffDate,
  onClose
}) => {
  // Sort chronological
  const sortedRecords = [...records].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return (a.id || '').localeCompare(b.id || '');
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <BookOpen size={20} className="text-emerald-100" />
            </div>
            <div>
              <h3 className="font-bold text-base">Riwayat Setoran Sabaq Santri</h3>
              <p className="text-xs text-emerald-100">
                {student.name} &bull; Kelas {student.class} &bull; {student.halaqah}
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

        {/* Subheader info */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-emerald-600" />
            <span>Rentang Analisis: <strong>{startDate}</strong> s/d <strong>{cutoffDate}</strong></span>
          </div>
          <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-bold">
            {sortedRecords.length} Setoran Sabaq
          </span>
        </div>

        {/* Content list */}
        <div className="p-6 max-h-[60vh] overflow-y-auto divide-y divide-slate-100">
          {sortedRecords.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <Clock size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm font-semibold">Tidak ada setoran sabaq pada rentang tanggal ini.</p>
            </div>
          ) : (
            sortedRecords.map((rec, index) => (
              <div key={rec.id || index} className="py-3 flex items-start justify-between gap-4 first:pt-0 last:pb-0">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center">
                      {index + 1}
                    </span>
                    <strong className="text-sm font-bold text-slate-800">
                      {rec.surah} : {rec.ayahStart} - {rec.ayahEnd}
                    </strong>
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full border border-emerald-100">
                      Nilai: {rec.grade || 'A'}
                    </span>
                  </div>
                  {rec.notes && (
                    <p className="text-xs text-slate-500 pl-7 italic">
                      "{rec.notes}"
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs font-semibold text-slate-700">{rec.date}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition-all"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
