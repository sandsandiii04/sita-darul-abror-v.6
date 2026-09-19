import React, { useState, useEffect } from 'react';
import { AcademicTerm, ExamPeriod, Student, TahfidzRecord, User } from '../../types';
import { api } from '../../api';
import { materialDetectionService } from '../../services/materialDetectionService';
import { AcademicTermModal } from './AcademicTermModal';
import { ExamPeriodModal } from './ExamPeriodModal';
import { 
  Calendar, 
  Plus, 
  Sparkles, 
  BookOpen, 
  ArrowRight, 
  CheckCircle2, 
  Clock, 
  Users, 
  AlertCircle,
  RefreshCw,
  Award,
  Trash2,
  AlertTriangle,
  X
} from 'lucide-react';

interface EvaluationPeriodsProps {
  user: User;
  students: Student[];
  records: TahfidzRecord[];
  onNavigateToPreparation: (periodId: string) => void;
}

export const EvaluationPeriods: React.FC<EvaluationPeriodsProps> = ({
  user,
  students,
  records,
  onNavigateToPreparation
}) => {
  const [academicTerms, setAcademicTerms] = useState<AcademicTerm[]>([]);
  const [examPeriods, setExamPeriods] = useState<ExamPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Modals state
  const [isTermModalOpen, setIsTermModalOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<AcademicTerm | null>(null);
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<ExamPeriod | null>(null);
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [periodToDelete, setPeriodToDelete] = useState<ExamPeriod | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const termsRes = await api.getAcademicTerms(user);
      if (termsRes.success && termsRes.data) {
        setAcademicTerms(termsRes.data);
      }

      const periodsRes = await api.getExamPeriods(user);
      if (periodsRes.success && periodsRes.data) {
        setExamPeriods(periodsRes.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const activeTerm = academicTerms.find(t => t.status === 'active') || academicTerms[0];

  const handleSaveTerm = async (term: AcademicTerm) => {
    setIsTermModalOpen(false);
    setStatusMessage({ type: 'info', text: 'Menyimpan semester...' });
    const res = await api.upsertAcademicTerm(term, user);
    if (res.success) {
      setStatusMessage({ type: 'success', text: res.message || 'Semester berhasil disimpan.' });
      loadData();
    } else {
      setStatusMessage({ type: 'error', text: res.message || 'Gagal menyimpan semester.' });
    }
  };

  const handleSavePeriod = async (period: ExamPeriod, studentIds: string[]) => {
    setIsPeriodModalOpen(false);
    setStatusMessage({ type: 'info', text: 'Membuat periode ujian dan menetapkan peserta...' });
    const res = await api.createExamPeriodWithParticipants(period, studentIds, user);
    if (res.success) {
      setStatusMessage({ 
        type: 'success', 
        text: `${period.name} berhasil dibuat dengan ${res.participantsCount || studentIds.length} peserta!` 
      });
      loadData();
      
      // Auto generate material initial snapshot
      if (res.periodId && activeTerm) {
        handleAutoGenerateMaterial(res.periodId, period, studentIds);
      }
    } else {
      setStatusMessage({ type: 'error', text: res.message || 'Gagal membuat periode ujian.' });
    }
  };

  const handleDeletePeriod = async (periodId: string) => {
    if (!periodId) return;
    setIsDeleting(true);
    setStatusMessage({ type: 'info', text: 'Menghapus periode ujian...' });
    try {
      const res = await api.deleteExamPeriod(periodId, user);
      if (res.success) {
        setStatusMessage({ type: 'success', text: res.message || 'Periode ujian berhasil dihapus.' });
        setPeriodToDelete(null);
        await loadData();
      } else {
        setStatusMessage({ type: 'error', text: res.message || 'Gagal menghapus periode ujian.' });
      }
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: e?.message || 'Terjadi kesalahan saat menghapus periode ujian.' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAutoGenerateMaterial = async (periodId: string, targetPeriod?: ExamPeriod, specificStudentIds?: string[]) => {
    const period = targetPeriod || examPeriods.find(p => p.id === periodId);
    if (!period) return;

    const term = academicTerms.find(t => t.id === period.academicTermId) || activeTerm;
    if (!term) {
      setStatusMessage({ type: 'error', text: 'Semester acuan tidak ditemukan.' });
      return;
    }

    setIsGenerating(periodId);
    setStatusMessage({ type: 'info', text: `Menganalisis records setoran santri untuk ${period.name}...` });

    try {
      // Determine students to analyze
      const studentPool = specificStudentIds 
        ? students.filter(s => specificStudentIds.includes(s.id))
        : students;

      const snapshots = studentPool.map(student => {
        const det = materialDetectionService.analyzeStudentMaterial(
          student.id,
          periodId,
          term,
          period,
          records
        );
        return det.snapshot;
      });

      const res = await api.saveMaterialSnapshotsBatch(periodId, snapshots, user);
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `Deteksi materi selesai: ${res.savedCount || snapshots.length} santri berhasil dianalisis.`
        });
      } else {
        setStatusMessage({ type: 'error', text: res.message || 'Gagal menyimpan hasil deteksi materi.' });
      }
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: e?.message || 'Terjadi kesalahan saat mendeteksi materi.' });
    } finally {
      setIsGenerating(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-800 via-teal-800 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 -mt-8 -mr-8 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 bg-emerald-500/20 border border-emerald-400/30 rounded-full text-xs font-semibold text-emerald-300">
                Tahap 4 Evaluasi Tahfiz
              </span>
              {activeTerm && (
                <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium text-slate-200">
                  Semester {activeTerm.semester === 'ganjil' ? 'Ganjil' : 'Genap'} {activeTerm.academicYear}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              Periode Evaluasi Tahfiz
            </h1>
            <p className="text-sm text-emerald-100/90 mt-1 max-w-2xl leading-relaxed">
              Kelola tahun ajaran, semester berjalan, dan tentukan rentang periode ujian UTS/UAS beserta peserta ujian santri Pondok Pesantren Darul Abror.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => {
                setEditingTerm(null);
                setIsTermModalOpen(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-xs transition-all flex items-center gap-2 backdrop-blur-sm"
            >
              <Calendar size={15} />
              <span>Kelola Semester</span>
            </button>
            <button
              onClick={() => {
                setEditingPeriod(null);
                setIsPeriodModalOpen(true);
              }}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white font-bold text-xs shadow-lg shadow-emerald-500/30 transition-all flex items-center gap-2"
            >
              <Plus size={16} />
              <span>Buat Periode Ujian</span>
            </button>
          </div>
        </div>
      </div>

      {/* Notification status message */}
      {statusMessage && (
        <div
          className={`p-4 rounded-2xl border text-xs font-medium flex items-center justify-between transition-all ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : statusMessage.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-teal-50 border-teal-200 text-teal-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            ) : statusMessage.type === 'error' ? (
              <AlertCircle size={16} className="text-rose-600 shrink-0" />
            ) : (
              <RefreshCw size={16} className="text-teal-600 animate-spin shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-slate-600 font-bold ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Semester Aktif Card */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm relative">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Semester Aktif
            </span>
            <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
              <Calendar size={18} />
            </span>
          </div>
          {activeTerm ? (
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Semester {activeTerm.semester === 'ganjil' ? 'Ganjil' : 'Genap'} {activeTerm.academicYear}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {activeTerm.startDate} s/d {activeTerm.endDate}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Aktif Berjalan
                </span>
                <button
                  onClick={() => {
                    setEditingTerm(activeTerm);
                    setIsTermModalOpen(true);
                  }}
                  className="text-xs text-emerald-700 font-semibold hover:underline"
                >
                  Ubah
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold text-slate-700">Belum ada semester aktif</p>
              <button
                onClick={() => {
                  setEditingTerm(null);
                  setIsTermModalOpen(true);
                }}
                className="mt-2 text-xs font-bold text-emerald-600 hover:underline"
              >
                + Buat Semester Sekarang
              </button>
            </div>
          )}
        </div>

        {/* Total Periode Ujian Card */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Periode Evaluasi
            </span>
            <span className="p-2 bg-teal-50 text-teal-600 rounded-xl">
              <Award size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-3xl font-black text-slate-900">{examPeriods.length}</h3>
            <span className="text-xs font-semibold text-slate-500">Periode Ujian</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {examPeriods.filter(p => p.examType === 'uts').length} UTS &bull; {examPeriods.filter(p => p.examType === 'uas').length} UAS
          </p>
        </div>

        {/* Total Santri & Records Card */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Populasi Santri
            </span>
            <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Users size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-3xl font-black text-slate-900">{students.length}</h3>
            <span className="text-xs font-semibold text-slate-500">Santri Aktif</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {records.filter(r => r.type === 'sabaq' || r.type === 'ziyadah').length} setoran sabaq tercatat di sistem
          </p>
        </div>
      </div>

      {/* Exam Periods Section */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-slate-800 text-sm">Daftar Periode Ujian Tahfiz</h2>
            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs font-semibold">
              {examPeriods.length}
            </span>
          </div>
          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {examPeriods.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <Award size={28} />
            </div>
            <h4 className="font-bold text-slate-800 text-base mb-1">Belum Ada Periode Ujian</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
              Buat periode ujian baru untuk memulai persiapan materi UTS atau UAS santri secara otomatis.
            </p>
            <button
              onClick={() => {
                setEditingPeriod(null);
                setIsPeriodModalOpen(true);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-600/20 inline-flex items-center gap-2"
            >
              <Plus size={15} />
              <span>Buat Periode Ujian Pertama</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {examPeriods.map((period) => {
              const isGenThis = isGenerating === period.id;
              const term = academicTerms.find(t => t.id === period.academicTermId);

              return (
                <div
                  key={period.id}
                  className="p-5 hover:bg-slate-50/60 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider ${
                          period.examType === 'uts'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                        }`}
                      >
                        {period.examType.toUpperCase()}
                      </span>
                      <h3 className="font-bold text-slate-900 text-base">{period.name}</h3>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                          period.status === 'completed'
                            ? 'bg-slate-100 text-slate-600'
                            : period.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {period.status === 'completed'
                          ? 'Selesai'
                          : period.status === 'active'
                          ? 'Ujian Aktif'
                          : 'Tahap Persiapan Materi'}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar size={14} className="text-slate-400" />
                        <span>Batas Setoran: <strong className="text-slate-700">{period.materialCutoffDate}</strong></span>
                      </span>
                      {period.examStartDate && (
                        <span className="flex items-center gap-1">
                          <Clock size={14} className="text-slate-400" />
                          <span>Jadwal: {period.examStartDate} s/d {period.examEndDate || '-'}</span>
                        </span>
                      )}
                      <span>KKM: <strong className="text-slate-700">{period.kkm}</strong></span>
                      {term && (
                        <span className="text-slate-400">
                          Semester {term.semester === 'ganjil' ? 'Ganjil' : 'Genap'} {term.academicYear}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                      onClick={() => handleAutoGenerateMaterial(period.id, period)}
                      disabled={isGenThis}
                      className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-all flex items-center gap-1.5 disabled:opacity-50"
                      title="Deteksi dan perbarui rentang materi santri dari records sabaq"
                    >
                      <Sparkles size={14} className={isGenThis ? 'animate-spin text-emerald-600' : 'text-amber-500'} />
                      <span>{isGenThis ? 'Menganalisis...' : 'Deteksi Otomatis'}</span>
                    </button>

                    <button
                      onClick={() => onNavigateToPreparation(period.id)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all flex items-center gap-1.5"
                    >
                      <BookOpen size={14} />
                      <span>Buka Persiapan Materi</span>
                      <ArrowRight size={14} />
                    </button>

                    {user.role === 'admin' && (
                      <button
                        onClick={() => setPeriodToDelete(period)}
                        className="p-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300 transition-colors"
                        title="Hapus Periode Ujian"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {isTermModalOpen && (
        <AcademicTermModal
          user={user}
          term={editingTerm}
          onClose={() => setIsTermModalOpen(false)}
          onSaved={handleSaveTerm}
        />
      )}

      {isPeriodModalOpen && (
        <ExamPeriodModal
          user={user}
          period={editingPeriod}
          academicTerms={academicTerms}
          students={students}
          onClose={() => setIsPeriodModalOpen(false)}
          onSaved={handleSavePeriod}
        />
      )}

      {/* Delete Confirmation Modal */}
      {periodToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
                <AlertTriangle size={24} />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-800">
                  Hapus Periode Ujian?
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Apakah Anda yakin ingin menghapus <strong className="text-slate-800 font-semibold">{periodToDelete.name}</strong>?
                </p>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-left mt-3">
                  <p className="text-[11px] text-amber-800 font-medium leading-relaxed">
                    ⚠️ <strong>Perhatian:</strong> Menghapus periode ujian ini akan menghapus data peserta ujian, snapshot materi santri, dan paket soal yang terkait dengan periode ini.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setPeriodToDelete(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-colors"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => handleDeletePeriod(periodToDelete.id)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold text-xs shadow-md shadow-rose-600/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isDeleting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Menghapus...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      <span>Ya, Hapus</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
