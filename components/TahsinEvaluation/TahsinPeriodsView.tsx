import React, { useState, useEffect } from 'react';
import { User, Student, TahsinPeriod } from '../../types';
import { tahsinService } from '../../services/tahsinService';
import { TahsinPeriodModal } from './TahsinPeriodModal';
import { 
  Calendar, 
  Plus, 
  Edit3, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Users, 
  Award,
  Layers,
  ArrowRight
} from 'lucide-react';

interface TahsinPeriodsViewProps {
  user: User;
  students: Student[];
  teachers?: User[];
  onNavigateToExecution?: (periodId: string) => void;
}

export const TahsinPeriodsView: React.FC<TahsinPeriodsViewProps> = ({
  user,
  students,
  teachers = [],
  onNavigateToExecution
}) => {
  const [periods, setPeriods] = useState<TahsinPeriod[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [periodToEdit, setPeriodToEdit] = useState<TahsinPeriod | null>(null);

  const availableClasses = Array.from(new Set(students.map(s => s.class))).sort();

  const loadPeriods = async () => {
    setIsLoading(true);
    try {
      const data = await tahsinService.fetchPeriods();
      setPeriods(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPeriods();
  }, []);

  const handleSavePeriod = async (period: TahsinPeriod) => {
    await tahsinService.savePeriod(period);
    // Inisialisasi peserta jika status aktif
    if (period.status === 'active') {
      tahsinService.initializeSessionsForPeriod(period, students, teachers);
    }
    loadPeriods();
  };

  return (
    <div className="space-y-5">
      {/* Top Header Card */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100">
            Pengaturan Periode & Standar Mutu
          </span>
          <h2 className="text-xl font-extrabold text-slate-800 tracking-tight mt-1">
            Periode Ujian Tahsin Al-Qur'an
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Kelola jadwal pelaksanaan ujian semester, KKM kelulusan, target kelas, dan penugasan penguji.
          </p>
        </div>

        {user.role === 'admin' && (
          <button
            onClick={() => {
              setPeriodToEdit(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-emerald-600/20"
          >
            <Plus size={16} /> Buat Periode Ujian
          </button>
        )}
      </div>

      {/* Periods Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {periods.map(period => {
          const isActive = period.status === 'active';
          const isClosed = period.status === 'closed';

          return (
            <div
              key={period.id}
              className={`bg-white rounded-2xl p-5 shadow-sm border transition-all hover:shadow-md flex flex-col justify-between ${
                isActive ? 'border-emerald-300 ring-2 ring-emerald-500/10' : 'border-slate-200/80'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border ${
                    isActive 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                      : isClosed 
                        ? 'bg-slate-100 text-slate-500 border-slate-200' 
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {period.status}
                  </span>

                  {user.role === 'admin' && (
                    <button
                      onClick={() => {
                        setPeriodToEdit(period);
                        setIsModalOpen(true);
                      }}
                      className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Edit Periode"
                    >
                      <Edit3 size={15} />
                    </button>
                  )}
                </div>

                <div>
                  <h3 className="font-extrabold text-base text-slate-800 leading-snug">{period.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Tahun Ajaran <strong>{period.academicYear}</strong> • Semester <span className="capitalize">{period.semester}</span>
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Jadwal:</span>
                    <span className="font-semibold text-slate-700">{period.startDate} s.d. {period.endDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Standar KKM:</span>
                    <span className="font-bold text-emerald-700">Nilai ≥ {period.passingGrade}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Min. Makharij / Tajwid:</span>
                    <span className="font-bold text-slate-700">{period.minMakharij} / {period.minTajwid}</span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Target Kelas:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(period.targetClasses && period.targetClasses.length > 0) ? (
                      period.targetClasses.map(c => (
                        <span key={c} className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                          {c}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">Semua Kelas</span>
                    )}
                  </div>
                </div>
              </div>

              {onNavigateToExecution && (
                <div className="pt-4 mt-4 border-t border-slate-100">
                  <button
                    onClick={() => onNavigateToExecution(period.id)}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 font-bold text-xs rounded-xl border border-slate-200 hover:border-emerald-200 transition-colors"
                  >
                    Buka Pelaksanaan Ujian <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <TahsinPeriodModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        periodToEdit={periodToEdit}
        onSave={handleSavePeriod}
        currentUser={user}
        availableClasses={availableClasses}
      />
    </div>
  );
};

export default TahsinPeriodsView;
