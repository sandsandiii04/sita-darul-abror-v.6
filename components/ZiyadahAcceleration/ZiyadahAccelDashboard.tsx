import React from 'react';
import { ZiyadahAccelEvent, ZiyadahAccelEventMetrics } from '../../types';
import { formatPagesIndo } from '../../services/ziyadahAccelPageCalc';
import {
  Users,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  BookOpen,
  Award,
  Layers,
  Activity
} from 'lucide-react';

interface ZiyadahAccelDashboardProps {
  event: ZiyadahAccelEvent;
  metrics: ZiyadahAccelEventMetrics;
  onNavigateSubTab: (tab: 'participants' | 'sessions' | 'monitoring' | 'reports') => void;
}

export const ZiyadahAccelDashboard: React.FC<ZiyadahAccelDashboardProps> = ({
  event,
  metrics,
  onNavigateSubTab
}) => {
  const obligationPct =
    metrics.totalObligationsCount > 0
      ? Math.round((metrics.submittedObligationsCount / metrics.totalObligationsCount) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Baris 1: Metrik Utama (Memisahkan Tegas Santri Unik vs Kewajiban Setoran) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div
          onClick={() => onNavigateSubTab('participants')}
          className="cursor-pointer bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-400 transition"
        >
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Peserta Unik</span>
            <Users className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-1.5 font-mono">
            {metrics.uniqueParticipantsCount}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Santri aktif terdaftar di database SITA
          </div>
        </div>

        <div
          onClick={() => onNavigateSubTab('sessions')}
          className="cursor-pointer bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-teal-400 transition"
        >
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Sesi Pelaksanaan</span>
            <Calendar className="w-4 h-4 text-teal-600" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-1.5 font-mono">
            {metrics.totalSessionsCount}
          </div>
          <div className="text-[11px] text-teal-700 font-semibold mt-1 truncate">
            {metrics.currentActiveSessionName
              ? `Aktif/Berikutnya: ${metrics.currentActiveSessionName}`
              : 'Belum ada sesi terjadwal'}
          </div>
        </div>

        <div
          onClick={() => onNavigateSubTab('reports')}
          className="cursor-pointer bg-emerald-50/70 p-5 rounded-2xl border border-emerald-200 shadow-sm hover:border-emerald-500 transition"
        >
          <div className="flex items-center justify-between text-xs font-bold text-emerald-800 uppercase tracking-wider">
            <span>Total Ziyadah Unik</span>
            <BookOpen className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-3xl font-extrabold text-emerald-950 mt-1.5 font-mono">
            {formatPagesIndo(metrics.totalUniqueVerifiedPages)}{' '}
            <span className="text-sm font-bold">Hal</span>
          </div>
          <div className="text-[11px] text-emerald-800 mt-1">
            {metrics.totalUnverifiedPages > 0
              ? `+ ${formatPagesIndo(metrics.totalUnverifiedPages)} hal menunggu verifikasi`
              : `Bruto disetor: ${formatPagesIndo(metrics.totalSubmittedPages)} halaman`}
          </div>
        </div>

        <div
          onClick={() => onNavigateSubTab('reports')}
          className="cursor-pointer bg-teal-50/70 p-5 rounded-2xl border border-teal-200 shadow-sm hover:border-teal-500 transition"
        >
          <div className="flex items-center justify-between text-xs font-bold text-teal-800 uppercase tracking-wider">
            <span>Rata-rata Nilai</span>
            <Award className="w-4 h-4 text-teal-700" />
          </div>
          <div className="text-3xl font-extrabold text-teal-950 mt-1.5 font-mono">
            {metrics.averageScoreByStudent !== null ? metrics.averageScoreByStudent.toFixed(2) : '-'}
          </div>
          <div className="text-[11px] text-teal-800 mt-1">
            Per santri ({metrics.studentsWithScoreCount} santri) • Per setoran:{' '}
            <strong>
              {metrics.averageScoreBySubmission !== null
                ? metrics.averageScoreBySubmission.toFixed(2)
                : '-'}
            </strong>
          </div>
        </div>
      </div>

      {/* Baris 2: Sesi Aktif (Santri Unik) vs Total Kewajiban Setoran (Peserta x Sesi) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              <span>
                Status Sesi Saat Ini:{' '}
                <strong className="text-emerald-700">
                  {metrics.currentActiveSessionName || 'Belum Dipilih'}
                </strong>
              </span>
            </h3>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">
              Satuan: Santri Unik ({metrics.uniqueParticipantsCount})
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-center">
              <div className="text-xs font-semibold text-emerald-700">Sudah Setor</div>
              <div className="text-xl font-extrabold text-emerald-900 font-mono mt-0.5">
                {metrics.activeSessionSubmittedStudents}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-center">
              <div className="text-xs font-semibold text-amber-700">Belum Setor</div>
              <div className="text-xl font-extrabold text-amber-900 font-mono mt-0.5">
                {metrics.activeSessionPendingStudents}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-center">
              <div className="text-xs font-semibold text-rose-700">Tidak Hadir</div>
              <div className="text-xl font-extrabold text-rose-900 font-mono mt-0.5">
                {metrics.activeSessionAbsentStudents}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600" />
              <span>Pemenuhan Kewajiban Kumulatif ({obligationPct}%)</span>
            </h3>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-800 font-semibold border border-teal-100">
              {metrics.uniqueParticipantsCount} Peserta × {metrics.totalSessionsCount} Sesi ={' '}
              {metrics.totalObligationsCount} Kewajiban
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 pt-1 text-center">
            <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-100">
              <div className="text-[11px] font-semibold text-emerald-700">Sudah Masuk</div>
              <div className="text-lg font-extrabold text-emerald-900 font-mono">
                {metrics.submittedObligationsCount}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[11px] font-semibold text-slate-600">Belum Masuk</div>
              <div className="text-lg font-extrabold text-slate-800 font-mono">
                {metrics.notSubmittedObligationsCount}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-rose-50/70 border border-rose-100">
              <div className="text-[11px] font-semibold text-rose-700">Tidak Hadir</div>
              <div className="text-lg font-extrabold text-rose-900 font-mono">
                {metrics.absentObligationsCount}
              </div>
            </div>
            <div
              onClick={() => onNavigateSubTab('monitoring')}
              className="cursor-pointer p-2.5 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 transition"
            >
              <div className="text-[11px] font-bold text-amber-800 flex items-center justify-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Verifikasi
              </div>
              <div className="text-lg font-extrabold text-amber-900 font-mono">
                {metrics.needsVerificationSubmissionsCount}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Baris 3: Progres Per Sesi */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-600" />
            <span>Rincian Progres Per Sesi ({event.name})</span>
          </h3>
        </div>
        {metrics.sessionProgress.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Belum ada sesi dibuat pada kegiatan ini. Buka tab <strong>Sesi &amp; Penguji</strong> untuk menambahkan sesi.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 font-bold uppercase border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Sesi</th>
                  <th className="py-3 px-4">Tanggal</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Sudah Setor</th>
                  <th className="py-3 px-4 text-center">Belum Giliran / Dipanggil</th>
                  <th className="py-3 px-4 text-center">Tidak Hadir</th>
                  <th className="py-3 px-4 text-center">Perlu Verifikasi</th>
                  <th className="py-3 px-4 text-center">Total Ziyadah</th>
                  <th className="py-3 px-4 text-center">Rerata Sesi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metrics.sessionProgress.map(sp => {
                  const pct =
                    sp.totalParticipants > 0
                      ? Math.round((sp.submittedCount / sp.totalParticipants) * 100)
                      : 0;
                  return (
                    <tr key={sp.sessionId} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4 font-bold text-slate-900">{sp.sessionName}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono">{sp.sessionDate}</td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                            sp.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : sp.status === 'closed'
                              ? 'bg-slate-200 text-slate-700'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}
                        >
                          {sp.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-emerald-700">
                        {sp.submittedCount}/{sp.totalParticipants} ({pct}%)
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-slate-600">
                        {sp.waitingTurnCount + sp.calledNotSubmittedCount + sp.pendingExaminerInputCount}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-rose-600">
                        {sp.absentCount}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-amber-700 font-bold">
                        {sp.needsVerificationCount}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-slate-800">
                        {formatPagesIndo(sp.totalUniquePages)} Hal
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-teal-800">
                        {sp.averageSessionScore !== null ? sp.averageSessionScore.toFixed(2) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Baris 4: Progres Per Kelas & Per Halaqah */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <span>Progres Per Kelas</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {metrics.classProgress.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Belum ada data peserta.</div>
            ) : (
              metrics.classProgress.map(cp => (
                <div key={cp.groupKey} className="px-5 py-3 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-800">Kelas {cp.groupKey}</div>
                    <div className="text-[11px] text-slate-500">
                      {cp.participantCount} Santri • Setoran: {cp.submittedObligations}/{cp.totalObligations}
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="font-bold text-emerald-700">
                      {formatPagesIndo(cp.totalUniqueVerifiedPages)} Hal
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Avg: {cp.averageScoreByStudent !== null ? cp.averageScoreByStudent.toFixed(2) : '-'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-600" />
            <span>Progres Per Halaqah</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {metrics.halaqahProgress.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Belum ada data peserta.</div>
            ) : (
              metrics.halaqahProgress.map(hp => (
                <div key={hp.groupKey} className="px-5 py-3 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-800">{hp.groupKey}</div>
                    <div className="text-[11px] text-slate-500">
                      {hp.participantCount} Santri • Setoran: {hp.submittedObligations}/{hp.totalObligations}
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="font-bold text-teal-700">
                      {formatPagesIndo(hp.totalUniqueVerifiedPages)} Hal
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Avg: {hp.averageScoreByStudent !== null ? hp.averageScoreByStudent.toFixed(2) : '-'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
