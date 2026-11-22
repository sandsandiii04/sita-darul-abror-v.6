import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  User, 
  ExamPeriod, 
  ExaminerStudentItem, 
  ExamAttempt,
  ExamQuestion,
  ExamQuestionAssessment
} from '../../types';
import { api } from '../../api';
import { UASExamSheet } from './UASExamSheet';
import { UASAssignExaminerModal } from './UASAssignExaminerModal';
import { UASReopenModal } from './UASReopenModal';
import { UASExamReviewModal } from './UASExamReviewModal';
import { UASManualMandatoryModal } from './UASManualMandatoryModal';
import { 
  ClipboardCheck, 
  Play, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Search, 
  Filter, 
  UserCheck, 
  RefreshCcw, 
  Award, 
  ChevronRight, 
  ShieldCheck, 
  Users, 
  Calendar,
  AlertTriangle,
  RotateCcw,
  BookOpen
} from 'lucide-react';

interface UASPelaksanaanViewProps {
  user: User;
  onNavigateToPeriods?: () => void;
}

export const UASPelaksanaanView: React.FC<UASPelaksanaanViewProps> = React.memo(({ user, onNavigateToPeriods }) => {
  const [periods, setPeriods] = useState<ExamPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [students, setStudents] = useState<ExaminerStudentItem[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [periodInfo, setPeriodInfo] = useState<{ id: string; name: string; kkm: number; status: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClass, setSelectedClass] = useState('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'ALL' | 'READY' | 'IN_PROGRESS' | 'SUBMITTED' | 'NEED_QUESTIONS'>('ALL');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active exam session state (when testing a student)
  const [activeSession, setActiveSession] = useState<{
    student: ExaminerStudentItem;
    attempt: ExamAttempt;
    kkm: number;
    questions: ExamQuestion[];
    assessments: ExamQuestionAssessment[];
  } | null>(null);

  // Modals state
  const [assignModalStudent, setAssignModalStudent] = useState<ExaminerStudentItem | null>(null);
  const [reopenModalStudent, setReopenModalStudent] = useState<ExaminerStudentItem | null>(null);
  const [viewResultStudent, setViewResultStudent] = useState<{
    student: ExaminerStudentItem;
    questions: ExamQuestion[];
    assessments: ExamQuestionAssessment[];
  } | null>(null);

  const isAdmin = user.role === 'admin';
  const isSharedExaminer = user.role === 'shared_uas_examiner';
  const [verifiedExaminer, setVerifiedExaminer] = useState<{ teacherId: string; teacherName: string; verifiedAt: string } | null>(
    user.verifiedExaminer || null
  );
  const [activeTeachersList, setActiveTeachersList] = useState<{ id: string; name: string; username?: string; hasPin?: boolean }[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [examinerPin, setExaminerPin] = useState('');
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [manualMandatoryStudent, setManualMandatoryStudent] = useState<ExaminerStudentItem | null>(null);
  const [showPeriodDetail, setShowPeriodDetail] = useState(false);

  // Load available UAS periods
  useEffect(() => {
    loadPeriods();
    loadTeachers();
    if (isSharedExaminer) {
      api.getUASActiveTeachers(user).then(res => {
        if (res.success && res.teachers) setActiveTeachersList(res.teachers);
      });
    }
  }, []);

  const loadPeriods = async () => {
    try {
      const res = await api.getExamPeriods(user);
      if (res.success && res.data) {
        // Filter only UAS periods
        const uasPeriods = res.data.filter(p => p.examType?.toLowerCase() === 'uas');
        setPeriods(uasPeriods);

        // Auto select active or most recent
        const active = uasPeriods.find(p => p.status === 'active') || uasPeriods[0];
        if (active) {
          setSelectedPeriodId(active.id);
        }
      }
    } catch (e: any) {
      console.error('Failed to load UAS periods:', e);
    }
  };

  const loadTeachers = () => {
    try {
      const raw = localStorage.getItem('sita_users_v1');
      const uList: User[] = raw ? JSON.parse(raw) : [];
      const tList = uList.filter(u => u.role === 'teacher' || u.role === 'admin');
      setTeachers(tList);
    } catch (e) {}
  };

  // Load students for selected period
  useEffect(() => {
    if (selectedPeriodId && (!isSharedExaminer || verifiedExaminer)) {
      loadStudents(selectedPeriodId);
    }
  }, [selectedPeriodId, verifiedExaminer]);

  const handleVerifyExaminer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacherId || !examinerPin.trim()) {
      setPinError('Pilih nama penguji dan masukkan PIN verifikasi.');
      return;
    }
    setVerifyingPin(true);
    setPinError(null);
    const res = await api.verifyUASExaminerIdentity(selectedTeacherId, examinerPin.trim(), user);
    setVerifyingPin(false);
    if (res.success && res.verifiedExaminer) {
      setVerifiedExaminer(res.verifiedExaminer);
      setExaminerPin('');
      if (selectedPeriodId) loadStudents(selectedPeriodId);
    } else {
      setPinError(res.message || 'Verifikasi identitas penguji gagal.');
    }
  };

  const loadSeqRef = useRef(0);

  const loadStudents = async (periodId: string) => {
    const seq = ++loadSeqRef.current;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [res, juzRes] = await Promise.all([
        api.getExaminerUASStudents(periodId, user),
        api.getUASJuzPartsAndSessions(periodId, user)
      ]);
      if (seq !== loadSeqRef.current) return;
      if (res.success && res.students) {
        const sessMap = new Map<string, any[]>();
        if (juzRes?.success && Array.isArray(juzRes.sessions)) {
          juzRes.sessions
            .filter((s: any) => s.status !== 'void')
            .forEach((s: any) => {
            const sid = s.student_id || s.studentId;
            const list = sessMap.get(sid) || [];
            list.push({
              id: s.id,
              examPeriodId: s.exam_period_id || s.examPeriodId,
              studentId: sid,
              sessionNumber: s.session_number || s.sessionNumber,
              sessionType: s.session_type || s.sessionType,
              juzNumber: s.juz_number || s.juzNumber,
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
              approvalStatus: s.approval_status || s.approvalStatus,
              isLocked: !!s.is_locked,
              status: s.status,
              score: s.score,
              predikat: s.predikat,
              actualExaminerId: s.actual_examiner_id,
              actualExaminerName: s.actual_examiner_name,
              examinerHistory: s.examiner_history || []
            });
            sessMap.set(sid, list);
          });
        }
        const uniqueMap = new Map<string, ExaminerStudentItem>();
        res.students.forEach(st => {
          if (!uniqueMap.has(st.studentId)) {
            uniqueMap.set(st.studentId, {
              ...st,
              sessions: sessMap.get(st.studentId) || []
            });
          }
        });
        setStudents(Array.from(uniqueMap.values()));
        if (res.period) {
          setPeriodInfo(res.period);
        }
      } else {
        setErrorMsg(res.message || 'Gagal memuat daftar santri UAS.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setIsLoading(false);
    }
  };

  const startInFlightRef = useRef(false);
  const [startingSessionId, setStartingSessionId] = useState<string | null>(null);

  const buildMandatoryStudentPayload = (student: ExaminerStudentItem, sessionItem?: any) => ({
    ...student,
    uasSessionId: sessionItem?.id || student.uasSessionId,
    sessionNumber: sessionItem?.sessionNumber || student.sessionNumber,
    juzNumber: sessionItem?.juzNumber || student.juzNumber,
    startSurah: sessionItem?.startSurah || student.startSurah,
    startAyah: sessionItem?.startAyah || student.startAyah,
    endSurah: sessionItem?.endSurah || student.endSurah,
    endAyah: sessionItem?.endAyah || student.endAyah,
    startPage: sessionItem?.startPage || student.startPage,
    endPage: sessionItem?.endPage || student.endPage,
    coveredPages: sessionItem?.coveredPages || (student as any).coveredPages
  });

  // Start specific UAS session (multi-session per juz) or fallback single session
  const handleStartExam = async (student: ExaminerStudentItem, sessionItem?: any) => {
    if (startInFlightRef.current) return;
    if (!isPeriodActive) {
      setErrorMsg('UAS belum dibuka oleh Admin.');
      return;
    }
    if (isSharedExaminer && !verifiedExaminer) {
      setErrorMsg('Verifikasi PIN penguji terlebih dahulu.');
      return;
    }
    const isPartialSession = sessionItem?.sessionType === 'partial_half';
    const needsMandatory = sessionItem
      ? (sessionItem.sessionType === 'full_juz' && sessionItem.status === 'pending_mandatory')
      : (student.questionSetStatus === 'pending_mandatory');

    if (!isPartialSession && needsMandatory) {
      setManualMandatoryStudent(buildMandatoryStudentPayload(student, sessionItem));
      return;
    }
    startInFlightRef.current = true;
    setStartingSessionId(sessionItem?.id || student.studentId);
    setErrorMsg(null);
    try {
      const effectiveUser = verifiedExaminer ? { ...user, verifiedExaminer } : user;
      const res = sessionItem
        ? await api.startUASSessionAttempt(selectedPeriodId, student.studentId, sessionItem.id, effectiveUser)
        : await api.startUASAttempt({ periodId: selectedPeriodId, studentId: student.studentId }, effectiveUser);

      if ((res as any).requiresManualMandatory) {
        setManualMandatoryStudent(buildMandatoryStudentPayload(student, sessionItem));
        return;
      }

      if (res.success && res.attempt && res.questions && res.assessments) {
        setActiveSession({
          student: sessionItem ? { ...student, sessionNumber: sessionItem.sessionNumber, sessionType: sessionItem.sessionType, juzNumber: sessionItem.juzNumber } : student,
          attempt: {
            ...res.attempt,
            sessionType: sessionItem?.sessionType || res.attempt.sessionType || (res.questions.length === 4 ? 'partial_half' : 'full_juz'),
            sessionNumber: sessionItem?.sessionNumber || res.attempt.sessionNumber || 1
          },
          kkm: (res as any).kkm || periodInfo?.kkm || 75,
          questions: res.questions,
          assessments: res.assessments
        });
      } else {
        setErrorMsg(res.message || 'Tidak dapat memulai sesi ujian UAS.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memulai sesi ujian.');
    } finally {
      startInFlightRef.current = false;
      setStartingSessionId(null);
    }
  };

  // View completed exam results
  const handleViewResult = async (student: ExaminerStudentItem) => {
    if (!student.attemptId) return;
    try {
      const res = await api.getUASAttempt(student.attemptId, user);
      if (res.success && res.assessments) {
        // Also fetch questions
        const qRes = await api.getUASQuestionSet(selectedPeriodId, student.studentId, user);
        if (qRes.success && qRes.questions) {
          setViewResultStudent({
            student,
            questions: qRes.questions,
            assessments: res.assessments
          });
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat hasil ujian.');
    }
  };

  // Handle examiner assignment
  const handleAssignExaminer = async (studentId: string, examinerId: string, reason?: string) => {
    const res = await api.assignExaminer({
      periodId: selectedPeriodId,
      studentId,
      examinerId,
      reason
    }, user);

    if (res.success) {
      loadStudents(selectedPeriodId);
    } else {
      throw new Error(res.message || 'Gagal menugaskan penguji.');
    }
  };

  // Handle reopen exam attempt
  const handleReopenExam = async (attemptId: string, reason: string) => {
    const res = await api.reopenUASAttempt({
      attemptId,
      reason
    }, user);

    if (res.success) {
      loadStudents(selectedPeriodId);
    } else {
      throw new Error(res.message || 'Gagal membuka kembali ujian UAS.');
    }
  };

  // Filtered classes list
  const classesList = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => {
      if (s.class && s.class !== '-') set.add(s.class);
    });
    return Array.from(set).sort();
  }, [students]);

  // Unified official per-session & student status calculator
  const isPeriodActive = periodInfo?.status === 'active';
  const formatPeriodStatus = (st?: string) => {
    if (st === 'active') return 'Aktif';
    if (st === 'preparation') return 'Persiapan';
    if (st === 'closed' || st === 'completed') return 'Selesai';
    return 'Draft';
  };
  const getSessionStatusInfo = (sess: any) => {
    if (sess.status === 'submitted') {
      return { code: 'SUBMITTED' as const, label: 'Selesai', canStart: false, disabledReason: 'Selesai' };
    }
    if (sess.status === 'in_progress') {
      return {
        code: 'IN_PROGRESS' as const,
        label: 'Sedang Ujian',
        canStart: isPeriodActive,
        disabledReason: isPeriodActive ? null : 'UAS belum dibuka'
      };
    }
    const isApproved = sess.approvalStatus === 'admin_approved' || Boolean(sess.questionSetId);
    if (!isApproved) {
      return { code: 'WAITING_APPROVAL' as const, label: 'Menunggu Admin', canStart: false, disabledReason: 'Menunggu Admin' };
    }
    if (!sess.questionSetId) {
      return { code: 'WAITING_PACKET' as const, label: 'Menunggu Soal', canStart: false, disabledReason: 'Menunggu Soal' };
    }
    if (!isPeriodActive) {
      return { code: 'PACKET_READY' as const, label: 'Siap Diuji', canStart: false, disabledReason: 'UAS belum dibuka' };
    }
    return {
      code: 'READY' as const,
      label: 'Siap Diuji',
      canStart: true,
      disabledReason: null
    };
  };

  const getStudentOverallStatus = (s: ExaminerStudentItem) => {
    const activeSessions = (s.sessions || []).filter((x: any) => x.status !== 'void');
    if (activeSessions.length > 0) {
      const infos = activeSessions.map(getSessionStatusInfo);
      const total = infos.length;
      const doneCnt = infos.filter(i => i.code === 'SUBMITTED').length;
      const inProgCnt = infos.filter(i => i.code === 'IN_PROGRESS').length;
      const readyCnt = infos.filter(i => i.code === 'READY').length;
      const pktReadyCnt = infos.filter(i => i.code === 'PACKET_READY').length;
      const waitPktCnt = infos.filter(i => i.code === 'WAITING_PACKET').length;

      if (doneCnt === total) return { code: 'SUBMITTED' as const, label: 'Selesai', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
      if (inProgCnt > 0) return { code: 'IN_PROGRESS' as const, label: 'Sedang Ujian', cls: 'bg-amber-50 text-amber-800 border border-amber-200' };
      if (readyCnt === total) return { code: 'READY' as const, label: 'Siap Diuji', cls: 'bg-teal-50 text-teal-800 border border-teal-200' };
      if (readyCnt > 0) return { code: 'READY' as const, label: `${readyCnt}/${total} Siap Diuji`, cls: 'bg-teal-50 text-teal-800 border border-teal-200' };
      if (pktReadyCnt > 0) return { code: 'PACKET_READY' as const, label: 'Menunggu Dibuka', cls: 'bg-slate-100 text-slate-700 border border-slate-200' };
      if (waitPktCnt > 0) return { code: 'WAITING_PACKET' as const, label: 'Menunggu Soal', cls: 'bg-amber-50 text-amber-800 border border-amber-200' };
      return { code: 'WAITING_APPROVAL' as const, label: 'Menunggu Admin', cls: 'bg-slate-100 text-slate-600 border border-slate-200' };
    }
    if (s.attemptStatus === 'submitted') return { code: 'SUBMITTED' as const, label: `Selesai (${s.totalScore})`, cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
    if (s.attemptStatus === 'in_progress') return { code: 'IN_PROGRESS' as const, label: 'Sedang Ujian', cls: 'bg-amber-50 text-amber-800 border border-amber-200' };
    return { code: 'WAITING_APPROVAL' as const, label: 'Menunggu Admin', cls: 'bg-slate-100 text-slate-600 border border-slate-200' };
  };

  // Filtered students
  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      const matchSearch = 
        s.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.studentNis.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.examinerName && s.examinerName.toLowerCase().includes(searchQuery.toLowerCase()));
      if (!matchSearch) return false;
      if (selectedClass !== 'ALL' && s.class !== selectedClass) return false;

      const overall = getStudentOverallStatus(s);
      if (selectedStatusFilter === 'READY') return overall.code === 'READY';
      if (selectedStatusFilter === 'IN_PROGRESS') return overall.code === 'IN_PROGRESS';
      if (selectedStatusFilter === 'SUBMITTED') return overall.code === 'SUBMITTED';
      if (selectedStatusFilter === 'NEED_QUESTIONS') return overall.code === 'WAITING_PACKET' || overall.code === 'WAITING_APPROVAL';
      return true;
    });
  }, [students, searchQuery, selectedClass, selectedStatusFilter, periodInfo?.status]);

  // Statistics counters
  const stats = useMemo(() => {
    const total = students.length;
    let submitted = 0;
    let inProgress = 0;
    let ready = 0;
    let needQuestions = 0;
    students.forEach(s => {
      const code = getStudentOverallStatus(s).code;
      if (code === 'SUBMITTED') submitted++;
      else if (code === 'IN_PROGRESS') inProgress++;
      else if (code === 'READY') ready++;
      else if (code === 'WAITING_PACKET' || code === 'WAITING_APPROVAL') needQuestions++;
    });
    return { total, submitted, inProgress, ready, needQuestions };
  }, [students, periodInfo?.status]);

  // If in active examination session, render full screen exam sheet
  if (activeSession) {
    return (
      <UASExamSheet
        user={verifiedExaminer ? { ...user, verifiedExaminer } : user}
        periodId={selectedPeriodId}
        studentId={activeSession.student.studentId}
        studentName={activeSession.student.studentName}
        studentClass={activeSession.student.class}
        attempt={activeSession.attempt}
        kkm={activeSession.kkm}
        initialQuestions={activeSession.questions}
        initialAssessments={activeSession.assessments}
        onFinish={() => {
          setActiveSession(null);
          loadStudents(selectedPeriodId);
        }}
        onExit={() => {
          setActiveSession(null);
          loadStudents(selectedPeriodId);
        }}
      />
    );
  }

  if (isSharedExaminer && !verifiedExaminer) {
    return (
      <div className="p-4 sm:p-6 max-w-md mx-auto mt-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 bg-white border-b border-slate-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="font-bold text-base text-slate-900">Verifikasi Penguji UAS</h2>
              <p className="text-xs text-slate-500">
                Akun: <strong>{user.name}</strong> • Pilih nama penguji dan masukkan PIN.
              </p>
            </div>
          </div>
          <form onSubmit={handleVerifyExaminer} className="p-5 space-y-4">
            {pinError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                <span>{pinError}</span>
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Nama Penguji</label>
              <select
                value={selectedTeacherId}
                onChange={e => setSelectedTeacherId(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-slate-900"
                required
              >
                <option value="">-- Pilih Penguji --</option>
                {activeTeachersList.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">PIN Penguji</label>
              <input
                type="password"
                value={examinerPin}
                onChange={e => setExaminerPin(e.target.value)}
                placeholder="Masukkan PIN pribadi"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-slate-900"
                required
              />
            </div>
            <button
              type="submit"
              disabled={verifyingPin || !selectedTeacherId || !examinerPin.trim()}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
            >
              {verifyingPin ? 'Memverifikasi...' : 'Masuk Pelaksanaan UAS'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-10 max-w-7xl mx-auto">
      {isSharedExaminer && verifiedExaminer && (
        <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>Penguji: <strong>{verifiedExaminer.teacherName}</strong></span>
            <span className="text-emerald-400">•</span>
            <span className="text-emerald-700">{user.name}</span>
          </div>
          <button
            type="button"
            onClick={() => setVerifiedExaminer(null)}
            className="px-3 py-1 bg-white border border-emerald-300 rounded-xl font-bold text-emerald-800 hover:bg-emerald-100"
          >
            Ganti Penguji
          </button>
        </div>
      )}

      {/* Clean Light Header */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
              <ClipboardCheck size={20} />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900">
                Pelaksanaan UAS Tahfiz
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Pilih santri dan sesi untuk memulai atau melanjutkan penilaian.
              </p>
            </div>
          </div>

          {/* Period Selector */}
          <div className="flex items-center gap-2 min-w-0 sm:min-w-[260px]">
            <select
              value={selectedPeriodId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedPeriodId(nextId);
                setStudents([]);
                const matched = periods.find(p => p.id === nextId);
                if (matched) {
                  setPeriodInfo({
                    id: matched.id,
                    name: matched.name,
                    kkm: matched.kkm || 75,
                    status: matched.status
                  });
                }
              }}
              className="flex-1 min-w-0 bg-slate-50 text-slate-800 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            >
              {periods.length === 0 && <option value="">Belum ada periode UAS</option>}
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({formatPeriodStatus(p.status)})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                loadPeriods();
                if (selectedPeriodId) loadStudents(selectedPeriodId);
              }}
              className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors shrink-0"
              title="Segarkan"
              aria-label="Segarkan"
            >
              <RefreshCcw size={15} className={isLoading ? 'animate-spin text-teal-600' : ''} />
            </button>
          </div>
        </div>

        {/* Light Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-3 border-t border-slate-100">
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 block font-medium">Total Peserta</span>
            <span className="text-lg font-extrabold text-slate-900">{stats.total}</span>
          </div>
          <div className="bg-teal-50/70 rounded-xl p-3 border border-teal-200/80">
            <span className="text-[11px] text-teal-700 block font-medium">Siap Diuji</span>
            <span className="text-lg font-extrabold text-teal-800">{stats.ready}</span>
          </div>
          <div className="bg-amber-50/70 rounded-xl p-3 border border-amber-200/80">
            <span className="text-[11px] text-amber-700 block font-medium">Sedang Ujian</span>
            <span className="text-lg font-extrabold text-amber-800">{stats.inProgress}</span>
          </div>
          <div className="bg-emerald-50/70 rounded-xl p-3 border border-emerald-200/80">
            <span className="text-[11px] text-emerald-700 block font-medium">Selesai</span>
            <span className="text-lg font-extrabold text-emerald-800">{stats.submitted}</span>
          </div>
        </div>
      </div>

      {/* Period Not Active Banner */}
      {periodInfo && !isPeriodActive && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-950 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-600 shrink-0" />
              <span className="font-bold text-amber-950">UAS belum dibuka oleh Admin.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPeriodDetail(prev => !prev)}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold text-[11px] hover:bg-amber-100"
              >
                {showPeriodDetail ? 'Tutup Detail' : 'Lihat Detail'}
              </button>
              {isAdmin && onNavigateToPeriods && (
                <button
                  type="button"
                  onClick={onNavigateToPeriods}
                  className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-bold transition-colors"
                >
                  Kelola Periode UAS
                </button>
              )}
            </div>
          </div>
          {showPeriodDetail && (
            <p className="text-[11px] text-amber-900 pt-1 border-t border-amber-200/70">
              Periode <strong>{periodInfo.name}</strong> berstatus <strong>{formatPeriodStatus(periodInfo.status)}</strong>. Tombol Mulai aktif otomatis setelah periode dibuka oleh Admin.
            </p>
          )}
        </div>
      )}

      {/* Error Alert */}
      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-between text-xs text-red-700 animate-fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-red-500 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600 font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari santri, NIS, atau penguji..."
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-slate-700 placeholder-slate-400"
            />
          </div>

          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="text-xs p-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-700 font-medium"
          >
            <option value="ALL">Semua Kelas</option>
            {classesList.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
          <button
            onClick={() => setSelectedStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              selectedStatusFilter === 'ALL'
                ? 'bg-teal-700 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Semua ({stats.total})
          </button>
          <button
            onClick={() => setSelectedStatusFilter('READY')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              selectedStatusFilter === 'READY'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Siap ({stats.ready})
          </button>
          <button
            onClick={() => setSelectedStatusFilter('IN_PROGRESS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              selectedStatusFilter === 'IN_PROGRESS'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Berjalan ({stats.inProgress})
          </button>
          <button
            onClick={() => setSelectedStatusFilter('SUBMITTED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              selectedStatusFilter === 'SUBMITTED'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Selesai ({stats.submitted})
          </button>
        </div>
      </div>

      {/* Participants Grid */}
      {isLoading ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm">
          <RefreshCcw size={32} className="animate-spin text-teal-600 mx-auto mb-3" />
          <p className="text-xs font-bold text-slate-600">Memuat data pelaksanaan UAS...</p>
        </div>
      ) : filteredStudents.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm">
          <Users size={36} className="text-slate-300 mx-auto mb-2" />
          <h4 className="text-sm font-bold text-slate-700">Tidak ada data santri</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Tidak ditemukan santri yang memenuhi kriteria filter atau belum ditugaskan kepada Anda.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStudents.map(student => {
            const activeSessions = (student.sessions || []).filter((x: any) => x.status !== 'void');
            const overall = getStudentOverallStatus(student);
            const hasAssignment = student.hasAssignment || isSharedExaminer;
            const isAssignedToMe = student.examinerId === user.id;
            const canExamine = isAdmin || (isSharedExaminer && !!verifiedExaminer) || isAssignedToMe;
            const isSubmitted = overall.code === 'SUBMITTED';
            const isInProgress = overall.code === 'IN_PROGRESS';
            const isReady = overall.code === 'READY';

            return (
              <div
                key={student.studentId}
                className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Top Badge: Unified Status */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                      Kelas {student.class}
                    </span>

                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${overall.cls}`}>
                      {overall.code === 'SUBMITTED' ? <CheckCircle2 size={11} />
                        : overall.code === 'IN_PROGRESS' ? <Clock size={11} />
                        : overall.code === 'READY' ? <Play size={10} />
                        : <AlertTriangle size={11} />}
                      <span>{overall.label}</span>
                    </span>
                  </div>

                  {/* Student Name & NIS */}
                  <h3 className="font-extrabold text-sm text-slate-800 tracking-tight leading-snug">
                    {student.studentName}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">NIS: {student.studentNis}</p>

                  {/* Material & Guru Halaqah Information (Section H: clearly distinguish Guru Halaqah vs actual PIN Examiner!) */}
                  <div className="mt-3 space-y-1.5 text-xs">
                    {activeSessions.length === 0 && (
                      <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                        <span className="text-[10px] text-slate-400 block">Materi Uji UAS:</span>
                        <span className="font-bold text-slate-700">
                          {student.startSurahName ? `${student.startSurahName} s.d. ${student.endSurahName}` : 'Belum diatur Guru Halaqah'}
                        </span>
                      </div>
                    )}

                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-slate-400 block">Guru Halaqah:</span>
                        <span className={`font-bold ${student.examinerName ? 'text-slate-700' : 'text-slate-400'}`}>
                          {student.examinerName || 'Belum Terdaftar'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                  {activeSessions.length > 0 ? (
                    <div className="space-y-1.5">
                      {activeSessions.map(sess => {
                        const sInfo = getSessionStatusInfo(sess);
                        const sessDone = sInfo.code === 'SUBMITTED';
                        const sessInProgress = sInfo.code === 'IN_PROGRESS';
                        const sessCanStart = sInfo.canStart && canExamine && startingSessionId !== sess.id;
                        const disabledReason = !canExamine
                          ? (isSharedExaminer && !verifiedExaminer ? 'Verifikasi PIN' : 'Bukan penguji')
                          : sInfo.disabledReason;
                        const isMandatoryAction = sess.sessionType === 'full_juz' && sess.status === 'pending_mandatory' && sInfo.canStart;
                        const historyNames: string[] = Array.isArray(sess.examinerHistory)
                          ? Array.from(
                              new Set(
                                sess.examinerHistory
                                  .map((h: any) => String(h?.examinerName || h?.teacherName || h?.name || '').trim())
                                  .filter(Boolean)
                              )
                            )
                          : [];
                        const actualExaminer =
                          (sess.actualExaminerName || '').trim() ||
                          historyNames[historyNames.length - 1] ||
                          '';
                        const otherExaminers = historyNames.filter(n => n !== actualExaminer);
                        const statusText = sessDone
                          ? `Selesai • Nilai: ${sess.score ?? '-'}/100`
                          : sessInProgress
                            ? 'Sedang Diuji'
                            : sInfo.label;
                        const examinerDisplay = actualExaminer || 'Belum ada';

                        return (
                          <div key={sess.id} className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
                            <div className="min-w-0 space-y-0.5">
                              <div className="text-xs font-bold text-slate-800 truncate">
                                Sesi {sess.sessionNumber} • Juz {sess.juzNumber} ({sess.sessionType === 'partial_half' ? '4 Soal' : '9 Soal'})
                              </div>
                              <div className="text-[11px] text-slate-600 truncate">
                                Status: <strong className={sessDone ? 'text-emerald-700' : sessInProgress ? 'text-amber-700' : 'text-slate-700'}>{statusText}</strong>
                              </div>
                              <div
                                className="text-[11px] text-slate-500 truncate flex items-center gap-1"
                                title={historyNames.length > 1 ? `Riwayat penguji: ${historyNames.join(', ')}` : undefined}
                              >
                                <span className="truncate">
                                  Penguji: <strong className={actualExaminer ? 'text-slate-700' : 'text-slate-400 font-medium'}>{examinerDisplay}</strong>
                                </span>
                                {otherExaminers.length > 0 && (
                                  <span className="px-1.5 py-0.2 rounded bg-slate-200/80 text-slate-600 text-[10px] font-semibold shrink-0">
                                    +{otherExaminers.length}
                                  </span>
                                )}
                              </div>
                            </div>
                            {sessDone ? (
                              <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold shrink-0">
                                Selesai
                              </span>
                            ) : (
                              <button
                                onClick={() => handleStartExam(student, sess)}
                                disabled={!sessCanStart}
                                title={disabledReason || undefined}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                                  sessCanStart
                                    ? 'bg-teal-600 hover:bg-teal-700 text-white cursor-pointer'
                                    : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                                }`}
                              >
                                {startingSessionId === sess.id
                                  ? 'Memuat...'
                                  : isMandatoryAction
                                    ? 'Pilih Soal Wajib'
                                    : sess.status === 'in_progress'
                                      ? 'Lanjutkan'
                                      : 'Mulai'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : isSubmitted ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleViewResult(student)}
                        className="flex-1 py-2 px-3 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Award size={14} className="text-teal-600" />
                        <span>Lihat Hasil Nilai</span>
                      </button>

                      {isAdmin && (
                        <button
                          onClick={() => setReopenModalStudent(student)}
                          className="py-2 px-3 rounded-xl text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1"
                          title="Buka Kembali Ujian"
                        >
                          <RotateCcw size={13} />
                          <span>Buka Kembali</span>
                        </button>
                      )}
                    </div>
                  ) : isInProgress ? (
                    <button
                      onClick={() => handleStartExam(student)}
                      disabled={!canExamine}
                      className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold text-white transition-all shadow-sm flex items-center justify-center gap-2 ${
                        canExamine 
                          ? 'bg-amber-600 hover:bg-amber-700 cursor-pointer' 
                          : 'bg-slate-400 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <Play size={14} />
                      <span>Lanjutkan Ujian ({student.completedQuestionsCount || 0}/9)</span>
                    </button>
                  ) : isReady ? (
                    <button
                      onClick={() => handleStartExam(student)}
                      disabled={!canExamine}
                      className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold text-white transition-all shadow-sm flex items-center justify-center gap-2 ${
                        canExamine 
                          ? 'bg-teal-600 hover:bg-teal-700 cursor-pointer' 
                          : 'bg-slate-400 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <Play size={14} />
                      <span>{student.questionSetStatus === 'pending_mandatory' ? 'Pilih Soal Wajib & Mulai Ujian' : 'Mulai Ujian UAS'}</span>
                    </button>
                  ) : (
                    <div className="text-center py-1.5 text-[11px] text-slate-400">
                      {overall.label}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {manualMandatoryStudent && (
        <UASManualMandatoryModal
          isOpen={!!manualMandatoryStudent}
          onClose={() => setManualMandatoryStudent(null)}
          user={verifiedExaminer ? { ...user, verifiedExaminer } : user}
          periodId={selectedPeriodId}
          student={manualMandatoryStudent}
          onSuccessStartExam={() => {
            const st = manualMandatoryStudent;
            setManualMandatoryStudent(null);
            const sessionObj = st.uasSessionId
              ? {
                  id: st.uasSessionId,
                  sessionNumber: st.sessionNumber || 1,
                  sessionType: 'full_juz' as const,
                  juzNumber: st.juzNumber || 30,
                  status: 'ready'
                }
              : undefined;
            handleStartExam({ ...st, questionSetStatus: 'locked' }, sessionObj);
          }}
        />
      )}

      {assignModalStudent && (
        <UASAssignExaminerModal
          periodId={selectedPeriodId}
          student={assignModalStudent}
          teachers={teachers}
          onAssign={handleAssignExaminer}
          onClose={() => setAssignModalStudent(null)}
        />
      )}

      {reopenModalStudent && (
        <UASReopenModal
          student={reopenModalStudent}
          onReopen={handleReopenExam}
          onClose={() => setReopenModalStudent(null)}
        />
      )}

      {viewResultStudent && (
        <UASExamReviewModal
          studentName={viewResultStudent.student.studentName}
          studentClass={viewResultStudent.student.class}
          kkm={periodInfo?.kkm || 75}
          questions={viewResultStudent.questions}
          assessments={viewResultStudent.assessments}
          onSubmitFinal={async () => {}}
          onClose={() => setViewResultStudent(null)}
          onNavigateToQuestion={() => {}}
          isReadOnly={true}
        />
      )}
    </div>
  );
});
