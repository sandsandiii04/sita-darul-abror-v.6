// components/TahfizEvaluation/StudentEvaluationDetailModal.tsx
// Modal Detail Komprehensif Evaluasi Santri & Timeline Audit Otoritatif (Tahap 7D)
// SITA — Darul Abror Islamic Boarding School

import React, { useState, useEffect } from 'react';
import { User, StudentEvaluationHistoryResponse } from '../../types';
import { api } from '../../api';
import { 
  X, 
  User as UserIcon, 
  Award, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  BookOpen, 
  ShieldCheck, 
  Calendar, 
  RefreshCw,
  Info,
  Layers,
  FileText
} from 'lucide-react';

interface StudentEvaluationDetailModalProps {
  studentId: string;
  studentName?: string;
  academicTermId?: string;
  configId?: string;
  user: User;
  onClose: () => void;
}

export const StudentEvaluationDetailModal: React.FC<StudentEvaluationDetailModalProps> = ({
  studentId,
  studentName,
  academicTermId,
  configId,
  user,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<'SCORES' | 'TIMELINE'>('SCORES');
  const [data, setData] = useState<StudentEvaluationHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, [studentId, academicTermId, configId]);

  const loadHistory = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.getStudentEvaluationHistory({
        studentId,
        academicTermId,
        configId
      }, user);

      if (res.success) {
        setData(res);
      } else {
        setErrorMessage(res.message || 'Gagal memuat detail riwayat evaluasi.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadge = (status?: string, hasRemedial?: boolean) => {
    switch (status) {
      case 'TUNTAS':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {hasRemedial ? 'Tuntas via Remedial' : 'Tuntas (KKM Terpenuhi)'}
          </span>
        );
      case 'TUNTAS_MELALUI_REMEDIAL':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-teal-100 text-teal-800 border border-teal-300">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Tuntas melalui Remedial
          </span>
        );
      case 'PERLU_REMEDIAL':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            Perlu Remedial
          </span>
        );
      case 'SEDANG_REMEDIAL':
      case 'REMEDIAL_DIJADWALKAN':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <Clock className="w-3.5 h-3.5" />
            {status === 'SEDANG_REMEDIAL' ? 'Sedang Remedial' : 'Remedial Dijadwalkan'}
          </span>
        );
      case 'BELUM_TUNTAS_SETELAH_REMEDIAL':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <AlertTriangle className="w-3.5 h-3.5" />
            Belum Tuntas Setelah Remedial
          </span>
        );
      case 'BELUM_LENGKAP':
      case 'BELUM_UJIAN':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700 border border-gray-300">
            <Info className="w-3.5 h-3.5" />
            {status === 'BELUM_UJIAN' ? 'Belum Ujian' : 'Belum Lengkap'}
          </span>
        );
    }
  };

  const recap = data?.recap;
  const student = data?.student;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-gray-200">
        
        {/* Header Modal */}
        <div className="px-6 py-5 bg-gradient-to-r from-teal-800 to-emerald-900 text-white flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-teal-200 border border-white/20">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Detail Histori & Evaluasi Santri</h2>
              <p className="text-xs text-teal-100">
                {studentName || student?.name || 'Memuat data santri...'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 bg-gray-50 px-6 pt-3 gap-3">
          <button
            onClick={() => setActiveTab('SCORES')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'SCORES'
                ? 'border-teal-600 text-teal-700 bg-white rounded-t-lg shadow-sm'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Award className="w-4 h-4" />
            Rekap Nilai Otoritatif
          </button>
          <button
            onClick={() => setActiveTab('TIMELINE')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
              activeTab === 'TIMELINE'
                ? 'border-teal-600 text-teal-700 bg-white rounded-t-lg shadow-sm'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <Clock className="w-4 h-4" />
            Riwayat Aktivitas ({data?.timeline?.length || 0})
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {isLoading ? (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-teal-600 animate-spin mx-auto" />
              <p className="text-sm font-medium text-gray-600">Memuat riwayat aktivitas santri...</p>
            </div>
          ) : errorMessage ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          ) : !recap ? (
            <div className="py-12 text-center text-gray-500 text-sm">
              Data evaluasi tidak ditemukan untuk santri ini.
            </div>
          ) : activeTab === 'SCORES' ? (
            <div className="space-y-6">
              
              {/* Profil Singkat Santri */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-teal-50/50 rounded-xl border border-teal-100">
                <div>
                  <div className="text-xs text-gray-500">Nama Santri</div>
                  <div className="text-sm font-bold text-gray-900">{recap.studentName}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">NIS</div>
                  <div className="text-sm font-bold text-gray-900">{recap.nis}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Kelas</div>
                  <div className="text-sm font-bold text-gray-900">{recap.class}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Halaqah</div>
                  <div className="text-sm font-bold text-gray-900">{recap.halaqah || '-'}</div>
                </div>
              </div>

              {/* Komponen UTS & UAS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Panel UTS */}
                <div className="p-5 bg-white rounded-xl border border-gray-200 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-teal-600"></span>
                      <h3 className="text-sm font-bold text-gray-900">Ujian Tengah Semester (UTS)</h3>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                      KKM: {recap.utsKkm}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-gray-50">
                      <span className="text-gray-500">Nilai Original:</span>
                      <span className="font-bold text-gray-800">
                        {recap.utsOriginalScore !== null ? Number(recap.utsOriginalScore).toFixed(2) : '- (Belum Ujian)'}
                      </span>
                    </div>
                    {recap.utsOriginalAttemptId && (
                      <div className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">Attempt Asli:</span>
                        <span className="font-mono text-gray-600 text-[11px]">{recap.utsOriginalAttemptId}</span>
                      </div>
                    )}
                    {recap.utsOriginalExaminerName && (
                      <div className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">Penguji Asli:</span>
                        <span className="text-gray-700">{recap.utsOriginalExaminerName}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-1 border-b border-gray-50">
                      <span className="text-gray-500">Nilai Remedial:</span>
                      <span className="font-bold text-teal-700">
                        {recap.utsRemedialScore !== null ? Number(recap.utsRemedialScore).toFixed(2) : '-'}
                      </span>
                    </div>
                    {recap.utsRemedialAttemptId && (
                      <div className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">Attempt Remedial:</span>
                        <span className="font-mono text-teal-700 text-[11px]">{recap.utsRemedialAttemptId}</span>
                      </div>
                    )}
                    {recap.utsRemedialExaminerName && (
                      <div className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">Penguji Remedial:</span>
                        <span className="text-gray-700">{recap.utsRemedialExaminerName}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-1.5 pt-2 border-t border-gray-200">
                      <span className="font-bold text-gray-700">Nilai Efektif UTS:</span>
                      <span className="text-sm font-extrabold text-teal-800">
                        {recap.utsEffectiveScore !== null ? Number(recap.utsEffectiveScore).toFixed(2) : '-'}
                        <span className="ml-1 text-[10px] font-normal text-gray-500">
                          ({recap.utsEffectiveSource})
                        </span>
                      </span>
                    </div>
                    <div className="pt-1 flex items-center justify-between">
                      <span className="text-gray-500">Status Komponen:</span>
                      {getStatusBadge(recap.utsStatus)}
                    </div>
                  </div>
                </div>

                {/* Panel UAS */}
                <div className="p-5 bg-white rounded-xl border border-gray-200 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
                      <h3 className="text-sm font-bold text-gray-900">Ujian Akhir Semester (UAS)</h3>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                      KKM: {recap.uasKkm}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-gray-50">
                      <span className="text-gray-500">Nilai Original:</span>
                      <span className="font-bold text-gray-800">
                        {recap.uasOriginalScore !== null ? Number(recap.uasOriginalScore).toFixed(2) : '- (Belum Ujian)'}
                      </span>
                    </div>
                    {recap.uasOriginalAttemptId && (
                      <div className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">Attempt Asli:</span>
                        <span className="font-mono text-gray-600 text-[11px]">{recap.uasOriginalAttemptId}</span>
                      </div>
                    )}
                    {recap.uasOriginalExaminerName && (
                      <div className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">Penguji Asli:</span>
                        <span className="text-gray-700">{recap.uasOriginalExaminerName}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-1 border-b border-gray-50">
                      <span className="text-gray-500">Nilai Remedial:</span>
                      <span className="font-bold text-emerald-700">
                        {recap.uasRemedialScore !== null ? Number(recap.uasRemedialScore).toFixed(2) : '-'}
                      </span>
                    </div>
                    {recap.uasRemedialAttemptId && (
                      <div className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">Attempt Remedial:</span>
                        <span className="font-mono text-emerald-700 text-[11px]">{recap.uasRemedialAttemptId}</span>
                      </div>
                    )}
                    {recap.uasRemedialExaminerName && (
                      <div className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">Penguji Remedial:</span>
                        <span className="text-gray-700">{recap.uasRemedialExaminerName}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-1.5 pt-2 border-t border-gray-200">
                      <span className="font-bold text-gray-700">Nilai Efektif UAS:</span>
                      <span className="text-sm font-extrabold text-emerald-800">
                        {recap.uasEffectiveScore !== null ? Number(recap.uasEffectiveScore).toFixed(2) : '-'}
                        <span className="ml-1 text-[10px] font-normal text-gray-500">
                          ({recap.uasEffectiveSource})
                        </span>
                      </span>
                    </div>
                    <div className="pt-1 flex items-center justify-between">
                      <span className="text-gray-500">Status Komponen:</span>
                      {getStatusBadge(recap.uasStatus)}
                    </div>
                  </div>
                </div>

              </div>

              {/* Rekapitulasi Akhir Semester */}
              <div className="p-5 bg-gradient-to-r from-teal-50 via-emerald-50 to-teal-50 rounded-xl border border-teal-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className="w-5 h-5 text-teal-700" />
                    <h3 className="text-sm font-bold text-teal-900">Perhitungan Akhir Nilai Semester</h3>
                  </div>
                  {getStatusBadge(recap.semesterStatus, recap.hasRemedial)}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                  <div className="bg-white/80 p-3 rounded-lg border border-teal-100 text-center">
                    <div className="text-xs text-gray-500">Kontribusi UTS ({recap.utsWeight}%)</div>
                    <div className="text-base font-bold text-gray-900 mt-0.5">
                      {recap.utsEffectiveScore !== null 
                        ? (Number(recap.utsEffectiveScore) * (recap.utsWeight / 100)).toFixed(2)
                        : '-'}
                    </div>
                  </div>
                  <div className="bg-white/80 p-3 rounded-lg border border-teal-100 text-center">
                    <div className="text-xs text-gray-500">Kontribusi UAS ({recap.uasWeight}%)</div>
                    <div className="text-base font-bold text-gray-900 mt-0.5">
                      {recap.uasEffectiveScore !== null 
                        ? (Number(recap.uasEffectiveScore) * (recap.uasWeight / 100)).toFixed(2)
                        : '-'}
                    </div>
                  </div>
                  <div className="bg-teal-700 text-white p-3 rounded-lg shadow-sm text-center">
                    <div className="text-xs text-teal-200 font-medium">Nilai Akhir Semester</div>
                    <div className="text-xl font-extrabold mt-0.5">
                      {recap.semesterFinalScore !== null ? Number(recap.semesterFinalScore).toFixed(2) : '-'}
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-gray-500 text-center italic">
                  * Formula otoritatif server: (UTS Efektif × {recap.utsWeight}%) + (UAS Efektif × {recap.uasWeight}%). Nilai missing tetap NULL dan tidak dikonversi ke angka 0.
                </p>
              </div>

            </div>
          ) : (
            /* Timeline Riwayat Aktivitas */
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0 text-blue-600" />
                <span>Seluruh riwayat di bawah ini dicatat secara otomatis oleh sistem evaluasi.</span>
              </div>

              {(!data?.timeline || data.timeline.length === 0) ? (
                <div className="py-12 text-center text-gray-400 text-sm">
                  Belum ada riwayat aktivitas untuk santri ini.
                </div>
              ) : (
                <div className="relative pl-6 border-l-2 border-teal-200 space-y-6 my-2">
                  {data.timeline.map((event, idx) => (
                    <div key={event.id || idx} className="relative group">
                      <div className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full bg-teal-600 border-4 border-white shadow-sm" />
                      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-1.5 hover:border-teal-300 transition-colors">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-gray-900 bg-teal-50 text-teal-800 px-2.5 py-0.5 rounded-full">
                            {event.actionLabel || event.action}
                          </span>
                          <span className="text-[11px] text-gray-400 flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3" />
                            {new Date(event.createdAt).toLocaleString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600">
                          Aktor: <span className="font-semibold text-gray-800">{event.actorName}</span> ({event.actorRole || 'System'})
                        </div>
                        {event.reason && (
                          <div className="text-xs text-gray-700 bg-gray-50 p-2 rounded-lg italic">
                            "{event.reason}"
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Modal */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-100 transition-colors"
          >
            Tutup
          </button>
        </div>

      </div>
    </div>
  );
};
