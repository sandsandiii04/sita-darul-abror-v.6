import React, { useState, useMemo } from 'react';
import { ExamMaterialSnapshot, ExamParticipant, Student, User } from '../../types';
import { quranService } from '../../services/quranService';
import { 
  Search, 
  Filter, 
  CheckCircle2, 
  AlertTriangle, 
  Lock, 
  Clock, 
  Eye, 
  ArrowRight, 
  BookOpen, 
  Edit3,
  Sparkles
} from 'lucide-react';

const getSnapshotCoverage = (snap?: ExamMaterialSnapshot) => {
  if (!snap) {
    return { startPage: 1, endPage: 1, startJuz: 1, endJuz: 1, estimatedPages: 0 };
  }
  if (snap.totalRecordsAnalyzed === 0 || (snap.status === 'not_ready' && snap.startSurah === 1 && snap.endSurah === 1 && snap.startAyah === 1 && snap.endAyah === 1 && (snap.estimatedPages === 0 || !snap.estimatedPages))) {
    return {
      startPage: snap.startPage || 1,
      endPage: snap.endPage || 1,
      startJuz: snap.startJuz || 1,
      endJuz: snap.endJuz || 1,
      estimatedPages: 0
    };
  }
  return quranService.calculateMaterialCoverage(
    snap.startSurah,
    snap.startAyah,
    snap.endSurah,
    snap.endAyah,
    snap.memorizationDirection
  );
};

interface MaterialTableProps {
  user: User;
  participants: ExamParticipant[];
  snapshots: ExamMaterialSnapshot[];
  students: Student[];
  questionSetMap?: Map<string, { status: string; version: number; id: string }>;
  isUTSPeriod?: boolean;
  examType?: 'uts' | 'uas';
  utsQuestionCount?: number;
  onOpenVerificationModal: (participant: ExamParticipant, student: Student, snapshot: ExamMaterialSnapshot) => void;
  onOpenQuestionPreview?: (participant: ExamParticipant, student: Student, snapshot: ExamMaterialSnapshot) => void;
  onGenerateQuestions?: (participant: ExamParticipant, student: Student, snapshot: ExamMaterialSnapshot) => void;
}

export const MaterialTable: React.FC<MaterialTableProps> = ({
  user,
  participants,
  snapshots,
  students,
  questionSetMap = new Map(),
  isUTSPeriod = true,
  examType = 'uts',
  utsQuestionCount,
  onOpenVerificationModal,
  onOpenQuestionPreview,
  onGenerateQuestions
}) => {
  const isQuestionPeriod = isUTSPeriod || examType === 'uas';
  const isUAS = examType === 'uas';
  const utsCount = utsQuestionCount || 5;
  const questionCount = isUAS ? 9 : utsCount;
  const questionColTitle = isUAS ? 'Soal UAS (9 Soal)' : `Soal UTS (${utsCount} Soal)`;
  const questionGenerateBtnLabel = isUAS ? 'Generate 9 Soal' : `Generate ${utsCount} Soal`;
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [selectedHalaqah, setSelectedHalaqah] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // Snapshot lookup by studentId
  const snapshotMap = useMemo(() => {
    const map = new Map<string, ExamMaterialSnapshot>();
    snapshots.forEach(s => map.set(s.studentId, s));
    return map;
  }, [snapshots]);

  // Student lookup by id
  const studentMap = useMemo(() => {
    const map = new Map<string, Student>();
    students.forEach(s => map.set(s.id, s));
    return map;
  }, [students]);

  // Extract distinct classes & halaqahs from participants
  const classes = useMemo(() => {
    const set = new Set<string>();
    participants.forEach(p => { if (p.class) set.add(p.class); });
    return Array.from(set).sort();
  }, [participants]);

  const halaqahs = useMemo(() => {
    const set = new Set<string>();
    participants.forEach(p => { if (p.halaqah) set.add(p.halaqah); });
    return Array.from(set).sort();
  }, [participants]);

  // Filter participants
  const filteredParticipants = useMemo(() => {
    return participants.filter(p => {
      const snap = snapshotMap.get(p.studentId);

      // Search name
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchName = p.studentName.toLowerCase().includes(q);
        const matchHalaqah = p.halaqah.toLowerCase().includes(q);
        if (!matchName && !matchHalaqah) return false;
      }

      // Class
      if (selectedClass !== 'all' && p.class !== selectedClass) return false;

      // Halaqah
      if (selectedHalaqah !== 'all' && p.halaqah !== selectedHalaqah) return false;

      // Status
      if (selectedStatus !== 'all') {
        const currentStatus = snap?.status || 'not_ready';
        if (currentStatus !== selectedStatus) return false;
      }

      return true;
    });
  }, [participants, searchTerm, selectedClass, selectedHalaqah, selectedStatus, snapshotMap]);

  // Pagination
  const totalPages = Math.ceil(filteredParticipants.length / pageSize) || 1;
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredParticipants.slice(start, start + pageSize);
  }, [filteredParticipants, currentPage, pageSize]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden space-y-0">
      {/* Filters Bar */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3">
        {/* Search */}
        <div className="relative min-w-[240px] flex-1 max-w-sm">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Cari nama santri atau halaqah..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
          />
        </div>

        {/* Dropdowns */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Class Filter */}
          <select
            value={selectedClass}
            onChange={(e) => {
              setSelectedClass(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-emerald-500 font-semibold text-slate-700"
          >
            <option value="all">Semua Kelas ({classes.length})</option>
            {classes.map(c => (
              <option key={c} value={c}>Kelas {c}</option>
            ))}
          </select>

          {/* Halaqah Filter */}
          <select
            value={selectedHalaqah}
            onChange={(e) => {
              setSelectedHalaqah(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-emerald-500 font-semibold text-slate-700"
          >
            <option value="all">Semua Halaqah ({halaqahs.length})</option>
            {halaqahs.map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-slate-700"
          >
            <option value="all">Semua Status</option>
            <option value="ready">🟢 Siap / Terverifikasi</option>
            <option value="needs_review">🟡 Perlu Verifikasi</option>
            <option value="not_ready">⚪ Belum Siap</option>
            <option value="finalized">🔵 Final / Terkunci</option>
          </select>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200/80">
            <tr>
              <th className="py-3 px-4 w-12 text-center">No</th>
              <th className="py-3 px-4">Santri</th>
              <th className="py-3 px-4">Kelas & Halaqah</th>
              <th className="py-3 px-4">Usulan Materi Ujian</th>
              <th className="py-3 px-4 text-center">Estimasi Hal</th>
              <th className="py-3 px-4">Sumber</th>
              <th className="py-3 px-4 text-center">Status</th>
              {isQuestionPeriod && <th className="py-3 px-4 text-center">{questionColTitle}</th>}
              <th className="py-3 px-4 text-center w-28">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {paginatedList.length === 0 ? (
              <tr>
                <td colSpan={isQuestionPeriod ? 9 : 8} className="py-12 text-center text-slate-400">
                  <BookOpen size={28} className="mx-auto mb-2 opacity-50" />
                  <p className="font-semibold text-sm">Tidak ada santri yang sesuai dengan filter.</p>
                </td>
              </tr>
            ) : (
              paginatedList.map((participant, idx) => {
                const snap = snapshotMap.get(participant.studentId);
                const student: Student = studentMap.get(participant.studentId) || {
                  id: participant.studentId,
                  name: participant.studentName,
                  nis: participant.studentId,
                  class: participant.class,
                  halaqah: participant.halaqah,
                  teacherId: participant.teacherId || '',
                  totalJuz: 0
                };
                const cov = snap ? getSnapshotCoverage(snap) : null;
                const effectiveSnap = (snap && cov) ? {
                  ...snap,
                  startPage: cov.startPage,
                  endPage: cov.endPage,
                  startJuz: cov.startJuz,
                  endJuz: cov.endJuz,
                  estimatedPages: cov.estimatedPages
                } : undefined;

                const status = effectiveSnap?.status || 'not_ready';
                const qInfo = questionSetMap.get(participant.studentId);
                const rowNumber = (currentPage - 1) * pageSize + idx + 1;

                return (
                  <tr key={participant.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 text-center text-slate-400 font-semibold">
                      {rowNumber}
                    </td>

                    <td className="py-3 px-4">
                      <strong className="font-bold text-slate-900 block text-xs">
                        {participant.studentName}
                      </strong>
                      <span className="text-[10px] text-slate-400">ID: {participant.studentId}</span>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-800 block">Kelas {participant.class}</span>
                      <span className="text-[10px] text-emerald-700 font-semibold">{participant.halaqah}</span>
                    </td>

                    <td className="py-3 px-4">
                      {effectiveSnap ? (
                        <div className="space-y-0.5">
                          <div className="font-bold text-slate-900 flex items-center gap-1">
                            <span>{effectiveSnap.startSurahName} {effectiveSnap.startAyah}</span>
                            <ArrowRight size={12} className="text-slate-400 shrink-0" />
                            <span>{effectiveSnap.endSurahName} {effectiveSnap.endAyah}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 block">
                            Mushaf: Hal {effectiveSnap.startPage || 1} - {effectiveSnap.endPage || 1} (Juz {effectiveSnap.startJuz || 1}-{effectiveSnap.endJuz || 1})
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Belum di-generate</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md font-bold text-[11px]">
                        {effectiveSnap?.estimatedPages || 0} Hal
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      {effectiveSnap?.sourceType === 'manual_override' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                          <Edit3 size={10} />
                          Manual
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                          Otomatis
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          status === 'finalized'
                            ? 'bg-purple-100 text-purple-800 border border-purple-200'
                            : status === 'ready'
                            ? 'bg-emerald-100 text-emerald-800'
                            : status === 'needs_review'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {status === 'finalized' ? (
                          <>
                            <Lock size={11} /> Terkunci (Final)
                          </>
                        ) : status === 'ready' ? (
                          <>
                            <CheckCircle2 size={11} /> Siap
                          </>
                        ) : status === 'needs_review' ? (
                          <>
                            <AlertTriangle size={11} className="text-amber-600" /> Perlu Verifikasi
                          </>
                        ) : (
                          <>Belum Siap</>
                        )}
                      </span>
                    </td>

                    {isQuestionPeriod && (
                      <td className="py-3 px-4 text-center">
                        {status !== 'finalized' ? (
                          <span className="text-[10px] text-slate-400 italic">
                            {status === 'needs_review' ? 'Perlu Ditinjau' : 'Materi Belum Final'}
                          </span>
                        ) : qInfo ? (
                          <button
                            onClick={() => effectiveSnap && onOpenQuestionPreview && onOpenQuestionPreview(participant, student, effectiveSnap)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all shadow-xs cursor-pointer ${
                              qInfo.status === 'stale'
                                ? 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100'
                                : 'bg-indigo-50 border-indigo-200 text-indigo-800 hover:bg-indigo-100'
                            }`}
                            title={`Klik untuk melihat pratinjau ${questionCount} butir soal`}
                          >
                            {qInfo.status === 'stale' ? (
                              <>
                                <AlertTriangle size={11} className="text-rose-600" />
                                <span>Perlu Ditinjau (v{qInfo.version})</span>
                              </>
                            ) : (
                              <>
                                <Lock size={11} className="text-indigo-600" />
                                <span>Sudah Dibuat ({questionCount} Soal)</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            {effectiveSnap && (effectiveSnap.estimatedPages === 0 || !effectiveSnap.estimatedPages) ? (
                              <span className="text-[10px] text-amber-600 font-medium italic">Materi Tidak Cukup</span>
                            ) : user.role === 'admin' && onGenerateQuestions ? (
                              <button
                                onClick={() => effectiveSnap && onGenerateQuestions(participant, student, effectiveSnap)}
                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg text-[10px] font-bold shadow-xs shadow-indigo-600/20 transition-all flex items-center gap-1 cursor-pointer"
                                title={`Generate ${questionCount} Soal untuk santri ini`}
                              >
                                <Sparkles size={11} />
                                <span>{questionGenerateBtnLabel}</span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400">Belum Dibuat</span>
                            )}
                          </div>
                        )}
                      </td>
                    )}

                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => effectiveSnap && onOpenVerificationModal(participant, student, effectiveSnap)}
                        disabled={!effectiveSnap}
                        className={`px-3 py-1.5 rounded-xl font-bold text-[11px] transition-all inline-flex items-center gap-1 shadow-sm ${
                          status === 'finalized'
                            ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            : status === 'needs_review'
                            ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'
                            : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                        } disabled:opacity-40 disabled:pointer-events-none`}
                      >
                        <Eye size={12} />
                        <span>{status === 'finalized' ? 'Lihat' : 'Verifikasi'}</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      {totalPages > 1 && (
        <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 bg-slate-50/50">
          <span>
            Menampilkan {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredParticipants.length)} dari {filteredParticipants.length} santri
          </span>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold disabled:opacity-40 hover:bg-slate-50"
            >
              Sebelumnya
            </button>
            <span className="px-3 py-1.5 font-bold text-slate-700">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold disabled:opacity-40 hover:bg-slate-50"
            >
              Selanjutnya
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
