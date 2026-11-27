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
import { getSessionExaminers } from '../../services/uasExaminerDisplay';
import {
  buildHalaqahPrefKey,
  computeStudentUASProgress,
  computeUASProgressStats,
  extractActiveHalaqahs,
  getActiveSessionsForPeriod,
  sortUASStudentsByPriority,
  UASStudentProgressCode
} from '../../services/uasProgressService';
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
  ChevronLeft,
  ChevronRight, 
  ShieldCheck, 
  Users, 
  Calendar,
  AlertTriangle,
  RotateCcw,
  BookOpen,
  X
} from 'lucide-react';

const PAGE_SIZE = 24;

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
  const [selectedHalaqah, setSelectedHalaqah] = useState<string>('ALL');
  const [pendingHalaqahChoice, setPendingHalaqahChoice] = useState<string>('ALL');
  const [halaqahStepConfirmed, setHalaqahStepConfirmed] = useState<boolean>(false);
  const [showHalaqahSwitcher, setShowHalaqahSwitcher] = useState<boolean>(false);
  const [selectedClass, setSelectedClass] = useState('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'ALL' | UASStudentProgressCode>('ALL');
  const [currentPage, setCurrentPage] = useState<number>(1);
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

  const examinerPrefId = verifiedExaminer?.teacherId || user.id;

  const persistHalaqahPref = (halaqahValue: string, periodId: string, exId: string) => {
    if (!periodId) return;
    try {
      sessionStorage.setItem(buildHalaqahPrefKey(user.id, exId, periodId), halaqahValue);
    } catch {
      // Ignore storage write errors
    }
  };

  const readHalaqahPref = (periodId: string, exId: string): string | null => {
    if (!periodId) return null;
    try {
      return sessionStorage.getItem(buildHalaqahPrefKey(user.id, exId, periodId));
    } catch {
      return null;
    }
  };

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
          setPeriodInfo({
            id: active.id,
            name: active.name,
            kkm: active.kkm || 75,
            status: active.status
          });
        } else {
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    } catch (e: any) {
      console.error('Failed to load UAS periods:', e);
      setErrorMsg('Gagal memuat daftar periode UAS. Periksa koneksi internet dan coba lagi.');
      setIsLoading(false);
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

  const handleSwitchExaminerAccount = () => {
    setVerifiedExaminer(null);
    setHalaqahStepConfirmed(false);
    setSelectedHalaqah('ALL');
    setPendingHalaqahChoice('ALL');
    setSelectedClass('ALL');
    setSelectedStatusFilter('ALL');
    setSearchQuery('');
    setCurrentPage(1);
    setShowHalaqahSwitcher(false);
    setPinError(null);
    try {
      const raw = localStorage.getItem('sita_current_user_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.verifiedExaminer) {
          delete parsed.verifiedExaminer;
          localStorage.setItem('sita_current_user_v1', JSON.stringify(parsed));
        }
      }
    } catch {
      // Ignore storage error
    }
  };

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
      // Selalu arahkan ke Langkah 3 (Pilih Halaqah) saat penguji baru verifikasi PIN
      setHalaqahStepConfirmed(false);
      setSelectedHalaqah('ALL');
      setPendingHalaqahChoice('ALL');
      setShowHalaqahSwitcher(false);
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
        const loadedStudents = Array.from(uniqueMap.values());
        setStudents(loadedStudents);
        if (res.period) {
          setPeriodInfo(res.period);
        }

        // Pulihkan pilihan halaqah yang sah untuk (user, examiner, period) setelah refresh
        const activeHalaqahNames = new Set(extractActiveHalaqahs(loadedStudents, periodId).map(h => h.name));
        const savedPref = readHalaqahPref(periodId, examinerPrefId);
        if (savedPref && (savedPref === 'ALL' || activeHalaqahNames.has(savedPref))) {
          setSelectedHalaqah(savedPref);
          setPendingHalaqahChoice(savedPref);
          if (isSharedExaminer && verifiedExaminer && user.verifiedExaminer?.teacherId === verifiedExaminer.teacherId) {
            setHalaqahStepConfirmed(true);
          }
        } else {
          setSelectedHalaqah('ALL');
          setPendingHalaqahChoice('ALL');
        }
      } else {
        if ((res as any).isPinExpired && isSharedExaminer) {
          handleSwitchExaminerAccount();
          setPinError(res.message || 'Verifikasi PIN sudah kedaluwarsa. Silakan verifikasi ulang.');
        } else {
          setErrorMsg(res.message || 'Gagal memuat daftar santri UAS.');
        }
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
      } else if ((res as any).isPinExpired && isSharedExaminer) {
        handleSwitchExaminerAccount();
        setPinError(res.message || 'Verifikasi PIN sudah kedaluwarsa. Silakan verifikasi PIN ulang.');
      } else {
        setErrorMsg(res.message || 'Tidak dapat memulai sesi ujian UAS.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memulai sesi ujian.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
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

  // Active halaqahs derived strictly from actual participants of selected period (no hardcode)
  const activeHalaqahs = useMemo(
    () => extractActiveHalaqahs(students, selectedPeriodId),
    [students, selectedPeriodId]
  );

  // Students scoped to selected halaqah (statistics & class options follow selected halaqah)
  const studentsInSelectedHalaqah = useMemo(() => {
    if (selectedHalaqah === 'ALL') return students;
    return students.filter(s => String(s.halaqah || '').trim() === selectedHalaqah);
  }, [students, selectedHalaqah]);

  // Filtered classes list (based on selected halaqah)
  const classesList = useMemo(() => {
    const set = new Set<string>();
    studentsInSelectedHalaqah.forEach(s => {
      if (s.class && s.class !== '-') set.add(s.class);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
  }, [studentsInSelectedHalaqah]);

  // Reset pagination whenever filters/halaqah/period change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedHalaqah, selectedStatusFilter, selectedClass, searchQuery, selectedPeriodId]);

  const handleSelectHalaqah = (nextHalaqah: string) => {
    setSelectedHalaqah(nextHalaqah);
    setPendingHalaqahChoice(nextHalaqah);
    setSelectedClass('ALL');
    setShowHalaqahSwitcher(false);
    persistHalaqahPref(nextHalaqah, selectedPeriodId, examinerPrefId);
  };

  const handleResetFilters = () => {
    setSelectedHalaqah('ALL');
    setPendingHalaqahChoice('ALL');
    setSelectedStatusFilter('ALL');
    setSelectedClass('ALL');
    setSearchQuery('');
    setCurrentPage(1);
    persistHalaqahPref('ALL', selectedPeriodId, examinerPrefId);
  };

  const hasActiveFilter =
    selectedHalaqah !== 'ALL' ||
    selectedStatusFilter !== 'ALL' ||
    selectedClass !== 'ALL' ||
    searchQuery.trim().length > 0;

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
        label: 'Sedang Diuji',
        canStart: isPeriodActive,
        disabledReason: isPeriodActive ? null : 'Ujian belum dibuka'
      };
    }
    const isApproved = sess.approvalStatus === 'admin_approved';
    if (!isApproved) {
      return {
        code: 'WAITING_APPROVAL' as const,
        label: 'Menunggu Persetujuan Admin',
        canStart: false,
        disabledReason: 'Materi sesi ini belum disetujui Admin'
      };
    }
    if (!sess.questionSetId) {
      return { code: 'WAITING_PACKET' as const, label: 'Menunggu Soal', canStart: false, disabledReason: 'Menunggu Soal' };
    }
    if (!isPeriodActive) {
      return { code: 'PACKET_READY' as const, label: 'Ujian Belum Dibuka', canStart: false, disabledReason: 'Ujian belum dibuka' };
    }
    return {
      code: 'READY' as const,
      label: 'Belum Diuji',
      canStart: true,
      disabledReason: null
    };
  };

  // Filtered & stably sorted students (prioritizing unfinished students)
  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched = studentsInSelectedHalaqah.filter(s => {
      const activeSessions = getActiveSessionsForPeriod(s, selectedPeriodId);
      const matchSessionExaminer = !q
        ? false
        : activeSessions.some((sess: any) =>
            getSessionExaminers(sess).some(ex => ex.name.toLowerCase().includes(q))
          );
      const matchSearch =
        !q ||
        s.studentName.toLowerCase().includes(q) ||
        (s.studentNis && s.studentNis.toLowerCase().includes(q)) ||
        (s.halaqah && s.halaqah.toLowerCase().includes(q)) ||
        (s.examinerName && s.examinerName.toLowerCase().includes(q)) ||
        matchSessionExaminer;
      if (!matchSearch) return false;
      if (selectedClass !== 'ALL' && s.class !== selectedClass) return false;

      if (selectedStatusFilter !== 'ALL') {
        const progress = computeStudentUASProgress(s, selectedPeriodId);
        if (progress.code !== selectedStatusFilter) return false;
      }
      return true;
    });
    return sortUASStudentsByPriority(matched, selectedPeriodId);
  }, [studentsInSelectedHalaqah, searchQuery, selectedClass, selectedStatusFilter, selectedPeriodId]);

  // Pagination for smooth rendering even with 240+ participants on mobile
  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedStudents = useMemo(() => {
    const startIdx = (safeCurrentPage - 1) * PAGE_SIZE;
    return filteredStudents.slice(startIdx, startIdx + PAGE_SIZE);
  }, [filteredStudents, safeCurrentPage]);

  // Statistics counters (strictly 1 count per student, scoped to selected halaqah)
  const stats = useMemo(
    () => computeUASProgressStats(studentsInSelectedHalaqah, selectedPeriodId),
    [studentsInSelectedHalaqah, selectedPeriodId]
  );

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
              {verifyingPin ? 'Memverifikasi...' : 'Lanjut Pilih Halaqah'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Langkah 3 untuk AKUN UJIAN bersama: Pilih Halaqah yang Akan Diuji (dari data aktual periode)
  if (isSharedExaminer && verifiedExaminer && !halaqahStepConfirmed) {
    return (
      <div className="p-4 sm:p-6 max-w-lg mx-auto mt-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 bg-white border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                <Users size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-base text-slate-900">Pilih Halaqah yang Akan Diuji</h2>
                <p className="text-xs text-slate-500 truncate">
                  Penguji: <strong className="text-slate-700">{verifiedExaminer.teacherName}</strong>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSwitchExaminerAccount}
              className="px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-600 hover:bg-slate-100 shrink-0"
            >
              Ganti Penguji
            </button>
          </div>

          <div className="p-5 space-y-4">
            {periodInfo && (
              <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-slate-800">{periodInfo.name}</span>
                <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-700 shrink-0">
                  {formatPeriodStatus(periodInfo.status)}
                </span>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-2">
                <span>{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => selectedPeriodId && loadStudents(selectedPeriodId)}
                  className="px-2.5 py-1 rounded-lg bg-white border border-rose-300 font-bold text-rose-800 shrink-0"
                >
                  Coba Lagi
                </button>
              </div>
            )}

            {isLoading ? (
              <div className="py-10 text-center">
                <RefreshCcw size={26} className="animate-spin text-teal-600 mx-auto mb-2.5" />
                <p className="text-xs font-semibold text-slate-500">Memuat daftar halaqah aktual...</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={() => setPendingHalaqahChoice('ALL')}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    pendingHalaqahChoice === 'ALL'
                      ? 'bg-teal-50 border-teal-500 ring-2 ring-teal-500/20'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <div className="text-sm font-bold text-slate-900">Semua Halaqah</div>
                    <div className="text-[11px] text-slate-500">Tampilkan seluruh peserta UAS pada periode ini</div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 shrink-0">
                    {students.length} Santri
                  </span>
                </button>

                {activeHalaqahs.map(h => (
                  <button
                    key={h.name}
                    type="button"
                    onClick={() => setPendingHalaqahChoice(h.name)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                      pendingHalaqahChoice === h.name
                        ? 'bg-teal-50 border-teal-500 ring-2 ring-teal-500/20'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 break-words">{h.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {h.completedCount} selesai • {h.remainingCount} belum selesai
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 shrink-0">
                      {h.studentCount} Santri
                    </span>
                  </button>
                ))}

                {activeHalaqahs.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-3">
                    Belum ada data halaqah terpisah pada periode ini. Anda dapat langsung masuk dengan "Semua Halaqah".
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                setSelectedHalaqah(pendingHalaqahChoice);
                setSelectedClass('ALL');
                setHalaqahStepConfirmed(true);
                persistHalaqahPref(pendingHalaqahChoice, selectedPeriodId, examinerPrefId);
              }}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
            >
              Masuk Dashboard Pelaksanaan UAS
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-10 max-w-7xl mx-auto">
      {/* Top Bar: Identitas Penguji & Halaqah yang Diuji + Tombol Ganti Halaqah */}
      <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2.5 text-xs text-emerald-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {isSharedExaminer && verifiedExaminer && (
              <>
                <span>Penguji: <strong>{verifiedExaminer.teacherName}</strong></span>
                <span className="text-emerald-400">•</span>
              </>
            )}
            <span>
              Halaqah yang Diuji:{' '}
              <strong className="text-emerald-950">
                {selectedHalaqah === 'ALL' ? 'Semua Halaqah' : selectedHalaqah}
              </strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHalaqahSwitcher(prev => !prev)}
              className="px-3 py-1.5 bg-white border border-emerald-300 rounded-xl font-bold text-emerald-800 hover:bg-emerald-100 transition-colors"
            >
              Ganti Halaqah
            </button>
            {isSharedExaminer && verifiedExaminer && (
              <button
                type="button"
                onClick={handleSwitchExaminerAccount}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl font-bold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Ganti Penguji
              </button>
            )}
          </div>
        </div>

        {showHalaqahSwitcher && (
          <div className="pt-2.5 border-t border-emerald-200/80 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleSelectHalaqah('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                selectedHalaqah === 'ALL'
                  ? 'bg-teal-700 text-white'
                  : 'bg-white text-slate-700 border border-emerald-200 hover:bg-emerald-100/60'
              }`}
            >
              Semua Halaqah ({students.length})
            </button>
            {activeHalaqahs.map(h => (
              <button
                key={h.name}
                type="button"
                onClick={() => handleSelectHalaqah(h.name)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                  selectedHalaqah === h.name
                    ? 'bg-teal-700 text-white'
                    : 'bg-white text-slate-700 border border-emerald-200 hover:bg-emerald-100/60'
                }`}
              >
                {h.name} ({h.studentCount})
              </button>
            ))}
          </div>
        )}
      </div>

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
                {selectedHalaqah === 'ALL'
                  ? 'Ringkasan progres ujian seluruh halaqah.'
                  : `Ringkasan progres ujian untuk ${selectedHalaqah}.`}
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
                setSelectedHalaqah('ALL');
                setSelectedClass('ALL');
                setSelectedStatusFilter('ALL');
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

        {/* Light Stats Grid: Progres Ujian per Halaqah (1 Santri = 1 Hitungan) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setSelectedStatusFilter('ALL')}
            className={`text-left rounded-xl p-3 border transition-all ${
              selectedStatusFilter === 'ALL'
                ? 'bg-slate-100 border-slate-400 ring-1 ring-slate-300'
                : 'bg-slate-50 border-slate-200/80 hover:bg-slate-100/70'
            }`}
          >
            <span className="text-[11px] text-slate-500 block font-medium">Total Santri</span>
            <span className="text-lg font-extrabold text-slate-900">{stats.total}</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatusFilter('NOT_STARTED')}
            className={`text-left rounded-xl p-3 border transition-all ${
              selectedStatusFilter === 'NOT_STARTED'
                ? 'bg-teal-100 border-teal-400 ring-1 ring-teal-300'
                : 'bg-teal-50/70 border-teal-200/80 hover:bg-teal-100/60'
            }`}
          >
            <span className="text-[11px] text-teal-700 block font-medium">Belum Diuji</span>
            <span className="text-lg font-extrabold text-teal-800">{stats.notStarted}</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatusFilter('PARTIAL')}
            className={`text-left rounded-xl p-3 border transition-all ${
              selectedStatusFilter === 'PARTIAL'
                ? 'bg-sky-100 border-sky-400 ring-1 ring-sky-300'
                : 'bg-sky-50/70 border-sky-200/80 hover:bg-sky-100/60'
            }`}
          >
            <span className="text-[11px] text-sky-700 block font-medium">Sebagian Selesai</span>
            <span className="text-lg font-extrabold text-sky-800">{stats.partial}</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatusFilter('IN_PROGRESS')}
            className={`text-left rounded-xl p-3 border transition-all ${
              selectedStatusFilter === 'IN_PROGRESS'
                ? 'bg-amber-100 border-amber-400 ring-1 ring-amber-300'
                : 'bg-amber-50/70 border-amber-200/80 hover:bg-amber-100/60'
            }`}
          >
            <span className="text-[11px] text-amber-700 block font-medium">Sedang Diuji</span>
            <span className="text-lg font-extrabold text-amber-800">{stats.inProgress}</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatusFilter('COMPLETED')}
            className={`text-left rounded-xl p-3 border transition-all ${
              selectedStatusFilter === 'COMPLETED'
                ? 'bg-emerald-100 border-emerald-400 ring-1 ring-emerald-300'
                : 'bg-emerald-50/70 border-emerald-200/80 hover:bg-emerald-100/60'
            }`}
          >
            <span className="text-[11px] text-emerald-700 block font-medium">Selesai</span>
            <span className="text-lg font-extrabold text-emerald-800">{stats.completed}</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedStatusFilter('NOT_READY')}
            className={`text-left rounded-xl p-3 border transition-all ${
              selectedStatusFilter === 'NOT_READY'
                ? 'bg-slate-200 border-slate-400 ring-1 ring-slate-300'
                : 'bg-slate-50 border-slate-200/80 hover:bg-slate-100'
            }`}
          >
            <span className="text-[11px] text-slate-600 block font-medium">Belum Siap</span>
            <span className="text-lg font-extrabold text-slate-700">{stats.notReady}</span>
          </button>
        </div>
      </div>

      {/* Period Not Active Banner */}
      {periodInfo && !isPeriodActive && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-950 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-600 shrink-0" />
              <span className="font-bold text-amber-950">Ujian belum dibuka oleh Admin.</span>
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
              Periode <strong>{periodInfo.name}</strong> berstatus <strong>{formatPeriodStatus(periodInfo.status)}</strong>. Tombol Mulai aktif otomatis setelah ujian dibuka oleh Admin.
            </p>
          )}
        </div>
      )}

      {/* Error Alert with Retry */}
      {errorMsg && (
        <div className="sticky top-3 z-40 p-4 bg-red-50 border border-red-300 rounded-2xl shadow-md flex flex-wrap items-center justify-between gap-2 text-xs text-red-700 animate-fade-in">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle size={16} className="text-red-500 shrink-0" />
            <span className="break-words">{errorMsg}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {selectedPeriodId && (
              <button
                type="button"
                onClick={() => loadStudents(selectedPeriodId)}
                className="px-3 py-1 rounded-lg bg-white border border-red-300 text-red-700 font-bold hover:bg-red-100"
              >
                Coba Lagi
              </button>
            )}
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600 font-bold px-1">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama santri, NIS, atau penguji..."
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-slate-700 placeholder-slate-400"
            />
          </div>

          <select
            aria-label="Filter Halaqah"
            value={selectedHalaqah}
            onChange={(e) => handleSelectHalaqah(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-700 font-medium"
          >
            <option value="ALL">Semua Halaqah ({students.length})</option>
            {activeHalaqahs.map(h => (
              <option key={h.name} value={h.name}>
                {h.name} ({h.studentCount})
              </option>
            ))}
          </select>

          <select
            aria-label="Filter Kelas"
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 text-slate-700 font-medium"
          >
            <option value="ALL">Semua Kelas</option>
            {classesList.map(c => (
              <option key={c} value={c}>Kelas {c}</option>
            ))}
          </select>
        </div>

        {/* Status Filter Tabs + Reset Filter */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              type="button"
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
              type="button"
              onClick={() => setSelectedStatusFilter('NOT_STARTED')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                selectedStatusFilter === 'NOT_STARTED'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Belum Diuji ({stats.notStarted})
            </button>
            <button
              type="button"
              onClick={() => setSelectedStatusFilter('PARTIAL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                selectedStatusFilter === 'PARTIAL'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Sebagian Selesai ({stats.partial})
            </button>
            <button
              type="button"
              onClick={() => setSelectedStatusFilter('IN_PROGRESS')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                selectedStatusFilter === 'IN_PROGRESS'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Sedang Diuji ({stats.inProgress})
            </button>
            <button
              type="button"
              onClick={() => setSelectedStatusFilter('COMPLETED')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                selectedStatusFilter === 'COMPLETED'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Selesai ({stats.completed})
            </button>
            <button
              type="button"
              onClick={() => setSelectedStatusFilter('NOT_READY')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                selectedStatusFilter === 'NOT_READY'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Belum Siap ({stats.notReady})
            </button>
          </div>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors inline-flex items-center gap-1 shrink-0"
            >
              <X size={13} />
              <span>Reset Filter</span>
            </button>
          )}
        </div>
      </div>

      {/* Participants Grid + Pagination */}
      {isLoading ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm">
          <RefreshCcw size={32} className="animate-spin text-teal-600 mx-auto mb-3" />
          <p className="text-xs font-bold text-slate-600">Memuat data pelaksanaan UAS...</p>
        </div>
      ) : filteredStudents.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100 shadow-sm space-y-3">
          <Users size={36} className="text-slate-300 mx-auto" />
          <div>
            <h4 className="text-sm font-bold text-slate-700">Tidak ada data santri</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Tidak ditemukan santri yang sesuai dengan pilihan halaqah atau filter saat ini.
            </p>
          </div>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white transition-colors"
            >
              Reset Filter
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
            <span>
              Menampilkan{' '}
              <strong className="text-slate-800">
                {(safeCurrentPage - 1) * PAGE_SIZE + 1}–{Math.min(safeCurrentPage * PAGE_SIZE, filteredStudents.length)}
              </strong>{' '}
              dari <strong className="text-slate-800">{filteredStudents.length}</strong> santri
            </span>
            {totalPages > 1 && (
              <span className="font-semibold text-slate-600">
                Halaman {safeCurrentPage} dari {totalPages}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedStudents.map(student => {
              const activeSessions = getActiveSessionsForPeriod(student, selectedPeriodId);
              const progress = computeStudentUASProgress(student, selectedPeriodId);
              const isAssignedToMe = student.examinerId === user.id;
              const canExamine = isAdmin || (isSharedExaminer && !!verifiedExaminer) || isAssignedToMe;
              const isSubmitted = progress.code === 'COMPLETED';
              const isInProgress = progress.code === 'IN_PROGRESS';
              const isReady = progress.code === 'NOT_STARTED' || progress.code === 'PARTIAL';

              return (
                <div
                  key={student.studentId}
                  className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Top Badge: Kelas, Halaqah & Unified Status */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                          Kelas {student.class}
                        </span>
                        {student.halaqah && student.halaqah !== '-' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200/70">
                            {student.halaqah}
                          </span>
                        )}
                      </div>

                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${progress.badgeClass}`}>
                        {progress.code === 'COMPLETED' ? <CheckCircle2 size={11} />
                          : progress.code === 'IN_PROGRESS' ? <Clock size={11} />
                          : progress.code === 'NOT_STARTED' || progress.code === 'PARTIAL' ? <Play size={10} />
                          : <AlertTriangle size={11} />}
                        <span>{progress.label}</span>
                      </span>
                    </div>

                    {/* Student Name, NIS & Session Progress */}
                    <h3 className="font-extrabold text-sm text-slate-800 tracking-tight leading-snug break-words">
                      {student.studentName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 mt-0.5">
                      <span>NIS: {student.studentNis}</span>
                      <span>•</span>
                      <span className="font-semibold text-slate-700">
                        Progres: {progress.progressText}
                      </span>
                    </div>

                    {/* Material & Guru Halaqah Information */}
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
                        <div className="min-w-0">
                          <span className="text-[10px] text-slate-400 block">Guru Halaqah:</span>
                          <span className={`font-bold break-words ${student.examinerName ? 'text-slate-700' : 'text-slate-400'}`}>
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
                          const sessWaitingPacket = sInfo.code === 'WAITING_PACKET' || sInfo.code === 'WAITING_APPROVAL';
                          const sessPeriodClosed = sInfo.code === 'PACKET_READY';
                          const sessCanStart = sInfo.canStart && canExamine && startingSessionId !== sess.id;
                          const disabledReason = !canExamine
                            ? (isSharedExaminer && !verifiedExaminer ? 'Verifikasi PIN' : 'Bukan penguji')
                            : sInfo.disabledReason;
                          const isMandatoryAction = sess.sessionType === 'full_juz' && sess.status === 'pending_mandatory' && sInfo.canStart;
                          const sessionExaminers = getSessionExaminers(sess);
                          const statusText = sessDone
                            ? `Selesai • Nilai ${sess.score ?? '-'}/100`
                            : sessInProgress
                              ? 'Sedang Diuji'
                              : sInfo.label;

                          return (
                            <div key={sess.id} className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 space-y-0.5">
                                  <div className="text-xs font-bold text-slate-800 leading-snug break-words">
                                    Sesi {sess.sessionNumber} • Juz {sess.juzNumber} ({sess.sessionType === 'partial_half' ? '4 Soal' : '9 Soal'})
                                  </div>
                                  <div className="text-[11px] text-slate-600 leading-snug break-words">
                                    <strong className={sessDone ? 'text-emerald-700' : sessInProgress ? 'text-amber-700' : 'text-slate-700'}>
                                      {statusText}
                                    </strong>
                                  </div>
                                </div>
                                {sessDone ? (
                                  <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold shrink-0">
                                    Selesai
                                  </span>
                                ) : sessWaitingPacket ? (
                                  <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 border border-slate-200 text-[11px] font-semibold shrink-0">
                                    Menunggu Soal
                                  </span>
                                ) : sessPeriodClosed ? (
                                  <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-semibold shrink-0">
                                    Belum Dibuka
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

                              <div className="pt-1.5 border-t border-slate-200/70 text-[11px] text-slate-500 leading-snug">
                                {sessionExaminers.length === 0 ? (
                                  <div className="break-words whitespace-normal">
                                    Penguji: <span className="text-slate-400 font-medium">Belum ada</span>
                                  </div>
                                ) : sessionExaminers.length === 1 ? (
                                  <div className="break-words whitespace-normal">
                                    Penguji: <strong className="text-slate-700">{sessionExaminers[0].name}</strong>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="text-slate-500">Penguji:</div>
                                    <ol className="mt-0.5 space-y-0.5 pl-4 list-decimal text-slate-700 font-semibold">
                                      {sessionExaminers.map((ex, idx) => (
                                        <li key={ex.id || `${ex.name}-${idx}`} className="break-words whitespace-normal">
                                          {ex.name}
                                        </li>
                                      ))}
                                    </ol>
                                  </div>
                                )}
                              </div>
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
                        {progress.label}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={safeCurrentPage <= 1}
                onClick={() => {
                  setCurrentPage(p => Math.max(1, p - 1));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                <ChevronLeft size={14} />
                <span>Sebelumnya</span>
              </button>

              <span className="text-xs font-bold text-slate-700">
                Halaman {safeCurrentPage} dari {totalPages}
              </span>

              <button
                type="button"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => {
                  setCurrentPage(p => Math.min(totalPages, p + 1));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                <span>Berikutnya</span>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
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
