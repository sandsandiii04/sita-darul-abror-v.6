import React, { useMemo, useState, useEffect } from 'react';
import {
  AcademicTerm,
  ExamMaterialPart,
  ExamMaterialSnapshot,
  ExamParticipant,
  ExamPeriod,
  ExamUASSession,
  QuestionBankItem,
  TahfidzRecord,
  User
} from '../../types';
import { api } from '../../api';
import { analyzeStudentJuzPartsAndSessions } from '../../services/uasJuzSegmentationService';
import { evaluateUASSessionEligibility } from '../../services/uasBulkEligibilityService';
import { BookOpen, CheckCircle2, AlertTriangle, RefreshCw, ShieldCheck, Layers, Ban } from 'lucide-react';

interface UASJuzPreparationPanelProps {
  user: User;
  period: ExamPeriod;
  term: AcademicTerm;
  participants: ExamParticipant[];
  snapshots: ExamMaterialSnapshot[];
  records: TahfidzRecord[];
  onSessionsUpdated?: () => void;
}

export const UASJuzPreparationPanel: React.FC<UASJuzPreparationPanelProps> = ({
  user,
  period,
  term,
  participants,
  snapshots,
  records,
  onSessionsUpdated
}) => {
  const [serverParts, setServerParts] = useState<ExamMaterialPart[]>([]);
  const [serverSessions, setServerSessions] = useState<ExamUASSession[]>([]);
  const [bankQuestions, setBankQuestions] = useState<QuestionBankItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [busyPartId, setBusyPartId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'multi_session' | 'needs_review' | 'needs_decision' | 'bank_short'>('all');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isAdmin = user.role === 'admin';

  const loadRemote = async () => {
    const [juzRes, bankRes] = await Promise.all([
      api.getUASJuzPartsAndSessions(period.id, user),
      api.getQuestionBankList({ status: 'active', examType: 'uas' })
    ]);
    if (juzRes.success) {
      setServerParts(
        (juzRes.parts || []).map((p: any) => ({
          id: p.id,
          examPeriodId: p.exam_period_id,
          studentId: p.student_id,
          snapshotId: p.snapshot_id,
          partOrder: p.part_order,
          juzNumber: p.juz_number,
          partType: p.part_type,
          startSurah: p.start_surah,
          startAyah: p.start_ayah,
          endSurah: p.end_surah,
          endAyah: p.end_ayah,
          startPage: p.start_page,
          endPage: p.end_page,
          coveredPages: p.covered_pages || [],
          coveredPagesCount: p.covered_pages_count || 0,
          juzTotalPages: p.juz_total_pages || 20,
          coverageRatio: Number(p.coverage_ratio || 0),
          segments: p.segments || [],
          hasGap: !!p.has_gap,
          status: p.status,
          reviewReason: p.review_reason,
          verifiedBy: p.verified_by,
          verifiedAt: p.verified_at,
          finalizedBy: p.finalized_by,
          finalizedAt: p.finalized_at
        }))
      );
      setServerSessions(
        (juzRes.sessions || []).map((s: any) => ({
          id: s.id,
          examPeriodId: s.exam_period_id,
          studentId: s.student_id,
          sessionNumber: s.session_number,
          sessionType: s.session_type,
          primaryPartId: s.primary_part_id,
          juzNumber: s.juz_number,
          supplementalParts: s.supplemental_parts || [],
          coveredPages: s.covered_pages || [],
          startSurah: s.start_surah,
          startAyah: s.start_ayah,
          endSurah: s.end_surah,
          endAyah: s.end_ayah,
          startPage: s.start_page,
          endPage: s.end_page,
          questionSetId: s.question_set_id,
          attemptId: s.attempt_id,
          status: s.status,
          score: s.score,
          predikat: s.predikat,
          actualExaminerId: s.actual_examiner_id,
          actualExaminerName: s.actual_examiner_name,
          examinerHistory: s.examiner_history || []
        }))
      );
    }
    if (bankRes?.data) {
      setBankQuestions(bankRes.data);
    }
  };

  useEffect(() => {
    loadRemote();
  }, [period.id]);

  const studentRows = useMemo(() => {
    const snapMap = new Map<string, ExamMaterialSnapshot>();
    snapshots.forEach(s => snapMap.set(s.studentId, s));

    const partsByStudent = new Map<string, ExamMaterialPart[]>();
    serverParts.forEach(p => {
      const list = partsByStudent.get(p.studentId) || [];
      list.push(p);
      partsByStudent.set(p.studentId, list);
    });

    const sessByStudent = new Map<string, ExamUASSession[]>();
    serverSessions.forEach(s => {
      const list = sessByStudent.get(s.studentId) || [];
      list.push(s);
      sessByStudent.set(s.studentId, list);
    });

    return participants.map(p => {
      const snap = snapMap.get(p.studentId);
      const existingParts = partsByStudent.get(p.studentId) || [];
      const analysis = analyzeStudentJuzPartsAndSessions({
        studentId: p.studentId,
        periodId: period.id,
        term,
        period,
        records,
        snapshotId: snap?.id || null,
        existingParts
      });

      const savedSessions = sessByStudent.get(p.studentId);
      const effectiveSessions = (savedSessions && savedSessions.length > 0) ? savedSessions : analysis.sessions;
      const sessionEligibilities = effectiveSessions.map(s => {
        const primary = analysis.parts.find(pt => pt.id === s.primaryPartId || pt.juzNumber === s.juzNumber) || null;
        return evaluateUASSessionEligibility({
          session: s,
          primaryPart: primary,
          bankQuestions
        });
      });

      return {
        participant: p,
        analysis,
        sessions: effectiveSessions,
        sessionEligibilities
      };
    });
  }, [participants, snapshots, serverParts, serverSessions, period, term, records, bankQuestions]);

  const summary = useMemo(() => {
    let totalSessions = 0;
    let fullSessions = 0;
    let partialSessions = 0;
    let multiSessionStudents = 0;
    let needsReview = 0;
    let needsDecision = 0;
    let bankShort = 0;

    studentRows.forEach(r => {
      if (r.sessions.length > 1) multiSessionStudents++;
      totalSessions += r.sessions.length;
      fullSessions += r.sessions.filter(s => s.sessionType === 'full_juz').length;
      partialSessions += r.sessions.filter(s => s.sessionType === 'partial_half').length;
      if (r.analysis.hasUnverifiedGaps) needsReview++;
      if (r.analysis.needsAdminDecision) needsDecision++;
      if (r.sessionEligibilities.some(e => e.status === 'BANK_SOAL_KURANG')) bankShort++;
    });

    return { totalSessions, fullSessions, partialSessions, multiSessionStudents, needsReview, needsDecision, bankShort };
  }, [studentRows]);

  const filteredRows = useMemo(() => {
    return studentRows.filter(r => {
      if (filterMode === 'multi_session') return r.sessions.length > 1;
      if (filterMode === 'needs_review') return r.analysis.hasUnverifiedGaps;
      if (filterMode === 'needs_decision') return r.analysis.needsAdminDecision;
      if (filterMode === 'bank_short') return r.sessionEligibilities.some(e => e.status === 'BANK_SOAL_KURANG');
      return true;
    });
  }, [studentRows, filterMode]);

  const handleSyncAllToServer = async () => {
    if (!isAdmin) return;
    setIsSyncing(true);
    setMsg(null);
    let okCount = 0;
    try {
      for (const row of studentRows) {
        if (row.analysis.parts.length === 0) continue;
        const res = await api.saveUASJuzPartsAndSessions(
          period.id,
          row.participant.studentId,
          row.analysis.parts,
          row.analysis.sessions,
          user
        );
        if (res.success) okCount++;
      }
      await loadRemote();
      onSessionsUpdated?.();
      setMsg({ type: 'success', text: `Sinkronisasi materi per juz & rencana sesi UAS selesai untuk ${okCount} santri.` });
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.message || 'Gagal menyinkronkan materi per juz.' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePartAction = async (part: ExamMaterialPart, action: 'verify' | 'finalize' | 'exclude', row: (typeof studentRows)[number]) => {
    if (!isAdmin) return;
    setBusyPartId(part.id);
    setMsg(null);
    try {
      // Pastikan sudah tersimpan di server terlebih dahulu
      if (!serverParts.some(sp => sp.id === part.id)) {
        await api.saveUASJuzPartsAndSessions(
          period.id,
          row.participant.studentId,
          row.analysis.parts,
          row.analysis.sessions,
          user
        );
      }
      const res = await api.verifyOrFinalizeUASMaterialPart(part.id, action, undefined, user);
      if (res.success) {
        await loadRemote();
        onSessionsUpdated?.();
        setMsg({ type: 'success', text: `Juz ${part.juzNumber} (${row.participant.studentName}) berhasil di-${action}.` });
      } else {
        setMsg({ type: 'error', text: res.message || 'Gagal memperbarui status bagian juz.' });
      }
    } finally {
      setBusyPartId(null);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-teal-200/80 shadow-sm p-5 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-teal-700" />
            <h2 className="text-base font-extrabold text-slate-900">Persiapan Materi Per Juz &amp; Multi-Sesi UAS</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Cutoff materi: <strong>{period.materialCutoffDate}</strong> • 1 Juz Penuh = 9 soal (7 Bank Soal + 2 wajib manual) • Setengah Juz = 4 soal Bank Soal (4×25 = 100 poin).
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={handleSyncAllToServer}
            disabled={isSyncing}
            className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            <span>{isSyncing ? 'Menyinkronkan...' : 'Sinkronkan Materi Per Juz & Sesi'}</span>
          </button>
        )}
      </div>

      {msg && (
        <div className={`p-3 rounded-2xl text-xs font-semibold border ${msg.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      {/* Summary Chips */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
        <button onClick={() => setFilterMode('all')} className={`p-3 rounded-2xl border text-left ${filterMode === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 border-slate-200'}`}>
          <div className="text-[10px] opacity-75">Total Sesi UAS</div>
          <div className="text-lg font-black">{summary.totalSessions}</div>
          <div className="text-[10px] opacity-75">{summary.fullSessions} penuh • {summary.partialSessions} ½ juz</div>
        </button>
        <button onClick={() => setFilterMode('multi_session')} className={`p-3 rounded-2xl border text-left ${filterMode === 'multi_session' ? 'bg-teal-700 text-white border-teal-700' : 'bg-teal-50/70 border-teal-200 text-teal-900'}`}>
          <div className="text-[10px] opacity-80">Santri Multi-Sesi</div>
          <div className="text-lg font-black">{summary.multiSessionStudents}</div>
          <div className="text-[10px] opacity-80">&gt; 1 sesi UAS</div>
        </button>
        <button onClick={() => setFilterMode('needs_review')} className={`p-3 rounded-2xl border text-left ${filterMode === 'needs_review' ? 'bg-amber-600 text-white border-amber-600' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          <div className="text-[10px] opacity-80">Ada Lompatan</div>
          <div className="text-lg font-black">{summary.needsReview}</div>
          <div className="text-[10px] opacity-80">Segmen terpisah</div>
        </button>
        <button onClick={() => setFilterMode('needs_decision')} className={`p-3 rounded-2xl border text-left ${filterMode === 'needs_decision' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 border-indigo-200 text-indigo-900'}`}>
          <div className="text-[10px] opacity-80">&lt; 0,5 Juz</div>
          <div className="text-lg font-black">{summary.needsDecision}</div>
          <div className="text-[10px] opacity-80">Perlu keputusan Admin</div>
        </button>
        <button onClick={() => setFilterMode('bank_short')} className={`p-3 rounded-2xl border text-left ${filterMode === 'bank_short' ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
          <div className="text-[10px] opacity-80">Bank Soal Kurang</div>
          <div className="text-lg font-black">{summary.bankShort}</div>
          <div className="text-[10px] opacity-80">Ada zona kosong</div>
        </button>
      </div>

      {/* Per-Student Juz Parts Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-2xl">
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3">Santri</th>
              <th className="py-2.5 px-3">Bagian Materi Per Juz (Setoran Sah)</th>
              <th className="py-2.5 px-3">Rencana Sesi &amp; Kelayakan Bank Soal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.slice(0, 60).map(row => (
              <tr key={row.participant.studentId} className="align-top hover:bg-slate-50/70">
                <td className="py-3 px-3 w-48">
                  <div className="font-bold text-slate-800">{row.participant.studentName}</div>
                  <div className="text-[11px] text-slate-400">{row.participant.class} • {row.participant.halaqah}</div>
                  <div className="mt-1 text-[10px] font-semibold text-teal-700">{row.sessions.length} Sesi UAS</div>
                </td>
                <td className="py-3 px-3 space-y-1.5">
                  {row.analysis.parts.length === 0 ? (
                    <span className="text-slate-400 italic">Belum ada setoran sabaq/ziyadah semester berjalan.</span>
                  ) : (
                    row.analysis.parts.map(pt => (
                      <div key={pt.id} className="p-2 rounded-xl border border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 font-bold text-slate-800">
                            <BookOpen size={12} className="text-teal-600" />
                            <span>Juz {pt.juzNumber}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                              {pt.partType === 'full_juz' ? 'Penuh' : pt.partType === 'partial_half' ? 'Setengah Juz' : 'Tambahan < 0,5 Juz'}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              pt.status === 'finalized' ? 'bg-emerald-100 text-emerald-800'
                                : pt.status === 'needs_review' ? 'bg-amber-100 text-amber-800'
                                : pt.status === 'needs_admin_decision' ? 'bg-indigo-100 text-indigo-800'
                                : pt.status === 'excluded' ? 'bg-slate-200 text-slate-500'
                                : 'bg-sky-100 text-sky-800'
                            }`}>
                              {pt.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 mt-0.5">
                            {pt.startSurahName}:{pt.startAyah} s.d. {pt.endSurahName}:{pt.endAyah} ({pt.coveredPagesCount}/{pt.juzTotalPages} hal sah{pt.hasGap ? ` • ${pt.segments.length} segmen` : ''})
                          </div>
                          {pt.reviewReason && (
                            <div className="text-[10px] text-amber-700 mt-0.5">{pt.reviewReason}</div>
                          )}
                        </div>
                        {isAdmin && pt.status !== 'finalized' && (
                          <div className="flex items-center gap-1">
                            {pt.status === 'needs_review' && (
                              <button
                                onClick={() => handlePartAction(pt, 'verify', row)}
                                disabled={busyPartId === pt.id}
                                className="px-2 py-1 text-[10px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg"
                              >
                                Verifikasi
                              </button>
                            )}
                            <button
                              onClick={() => handlePartAction(pt, 'finalize', row)}
                              disabled={busyPartId === pt.id}
                              className="px-2 py-1 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1"
                            >
                              <ShieldCheck size={11} />
                              <span>Finalisasi</span>
                            </button>
                            <button
                              onClick={() => handlePartAction(pt, 'exclude', row)}
                              disabled={busyPartId === pt.id}
                              className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg"
                              title="Kecualikan bagian ini"
                            >
                              <Ban size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </td>
                <td className="py-3 px-3 space-y-1.5 w-80">
                  {row.sessionEligibilities.length === 0 ? (
                    <span className="text-[11px] text-indigo-700 font-semibold">{row.analysis.summaryReason}</span>
                  ) : (
                    row.sessionEligibilities.map(se => (
                      <div key={se.sessionId} className="p-2 rounded-xl border border-slate-200 bg-slate-50/70">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-800">
                            Sesi {se.sessionNumber} • Juz {se.juzNumber} ({se.sessionType === 'full_juz' ? '9 Soal' : '4 Soal'})
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            se.status === 'SIAP_GENERATE' || se.status === 'SUDAH_ADA'
                              ? 'bg-emerald-100 text-emerald-800'
                              : se.status === 'BANK_SOAL_KURANG'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {se.status === 'BANK_SOAL_KURANG' ? `Bank Kurang (${se.coveredZones}/${se.requiredZones})` : se.status}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{se.reason}</div>
                      </div>
                    ))
                  )}
                </td>
              </tr>
            ))}
            {filteredRows.length > 60 && (
              <tr>
                <td colSpan={3} className="py-2 px-3 text-center text-[11px] text-slate-500 bg-slate-50">
                  Menampilkan 60 dari {filteredRows.length} santri. Gunakan filter di atas untuk menyaring.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
