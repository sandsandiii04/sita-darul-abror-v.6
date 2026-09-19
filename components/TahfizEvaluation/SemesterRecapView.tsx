import React, { useState, useEffect, useMemo } from 'react';
import { 
  User, 
  AcademicTerm, 
  ExamPeriod, 
  SemesterEvaluationConfig, 
  SemesterRecapResponse, 
  SemesterStudentRecap,
  SemesterRecapSummary,
  RemedialCandidateItem,
  RemedialDetailResponse
} from '../../types';
import { api } from '../../api';
import { MOCK_USERS } from '../../constants';
import { 
  Award, 
  BookOpen, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Search, 
  Filter, 
  SlidersHorizontal, 
  X, 
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  Layers,
  ChevronDown,
  Sparkles,
  Eye,
  ShieldCheck,
  FileCheck,
  Check,
  UserCheck
} from 'lucide-react';
import { remedialQuestionGenerator } from '../../services/remedialQuestionGenerator';

interface SemesterRecapViewProps {
  user: User;
}

type FilterChip = 'ALL' | 'TUNTAS' | 'PERLU_REMEDIAL' | 'UTS_REMEDIAL' | 'UAS_REMEDIAL' | 'BELUM_UTS' | 'BELUM_UAS' | 'INCOMPLETE';

export const SemesterRecapView: React.FC<SemesterRecapViewProps> = ({ user }) => {
  const [academicTerms, setAcademicTerms] = useState<AcademicTerm[]>([]);
  const [selectedTermId, setSelectedTermId] = useState<string>('');
  const [examPeriods, setExamPeriods] = useState<ExamPeriod[]>([]);
  const [configs, setConfigs] = useState<SemesterEvaluationConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Top Tab Navigation: Rekap Nilai vs Persiapan Remedial
  const [activeTab, setActiveTab] = useState<'RECAP' | 'REMEDIAL'>('RECAP');

  // Recap data
  const [recapResponse, setRecapResponse] = useState<SemesterRecapResponse | null>(null);

  // Remedial Generator Management State (Tahap 7B)
  const [remedialCandidates, setRemedialCandidates] = useState<RemedialCandidateItem[]>([]);
  const [remedialLoading, setRemedialLoading] = useState<boolean>(false);
  const [remedialGeneratingKey, setRemedialGeneratingKey] = useState<string | null>(null);
  const [remedialFilter, setRemedialFilter] = useState<'ALL' | 'UTS' | 'UAS' | 'PENDING' | 'READY'>('ALL');
  const [remedialSearch, setRemedialSearch] = useState<string>('');
  const [remedialDetailSession, setRemedialDetailSession] = useState<RemedialDetailResponse | null>(null);
  const [remedialDetailLoading, setRemedialDetailLoading] = useState<boolean>(false);
  const [remedialNotification, setRemedialNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Remedial Examiner Assignment & Reopen State (Tahap 7C)
  const [assignModalCandidate, setAssignModalCandidate] = useState<RemedialCandidateItem | null>(null);
  const [selectedExaminerId, setSelectedExaminerId] = useState<string>('');
  const [reassignReason, setReassignReason] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState<boolean>(false);
  const [reopenModalCandidate, setReopenModalCandidate] = useState<RemedialCandidateItem | null>(null);
  const [reopenReasonText, setReopenReasonText] = useState<string>('');
  const [isReopening, setIsReopening] = useState<boolean>(false);
  const [teachersList, setTeachersList] = useState<User[]>([]);

  // Filters & Search
  const [activeChip, setActiveChip] = useState<FilterChip>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedClass, setSelectedClass] = useState<string>('ALL');
  const [selectedHalaqah, setSelectedHalaqah] = useState<string>('ALL');

  // Detail Modal
  const [selectedStudent, setSelectedStudent] = useState<SemesterStudentRecap | null>(null);

  // Config Modal
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
  const [customName, setCustomName] = useState<string>('');
  const [customUtsPeriodId, setCustomUtsPeriodId] = useState<string>('');
  const [customUasPeriodId, setCustomUasPeriodId] = useState<string>('');
  const [customUtsWeight, setCustomUtsWeight] = useState<number>(40);
  const [customUasWeight, setCustomUasWeight] = useState<number>(60);
  const [configSaving, setConfigSaving] = useState<boolean>(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Load Initial Metadata (Terms, Periods, Configs)
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const termsRes = await api.getAcademicTerms(user);
      const terms = termsRes.data || [];
      setAcademicTerms(terms);

      const periodsRes = await api.getExamPeriods(user);
      const periods = periodsRes.data || [];
      setExamPeriods(periods);

      // Load teachers list for examiner assignment
      try {
        const rawUsers = localStorage.getItem('sita_users_v1');
        const uList: User[] = rawUsers ? JSON.parse(rawUsers) : MOCK_USERS;
        setTeachersList(uList.filter(u => u.role === 'teacher' || u.role === 'admin'));
      } catch (_) {
        setTeachersList(MOCK_USERS.filter(u => u.role === 'teacher' || u.role === 'admin'));
      }

      // Determine default active term
      const activeTerm = terms.find(t => t.status === 'active') || terms[0];
      const termId = activeTerm ? activeTerm.id : '';
      setSelectedTermId(termId);

      if (termId) {
        await loadConfigsAndRecap(termId, '');
      } else {
        setIsLoading(false);
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Gagal memuat metadata evaluasi semester.');
      setIsLoading(false);
    }
  };

  const loadConfigsAndRecap = async (termId: string, cfgId: string) => {
    try {
      const configsRes = await api.getSemesterEvaluationConfigs(termId, user);
      const termConfigs = configsRes.configs || [];
      setConfigs(termConfigs);

      const activeCfgId = cfgId || (termConfigs.length > 0 ? termConfigs[0].id : '');
      setSelectedConfigId(activeCfgId);

      await fetchRecap(termId, activeCfgId);
    } catch (e: any) {
      setErrorMessage(e?.message || 'Gagal memuat konfigurasi dan rekap semester.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const fetchRecap = async (termId: string, cfgId?: string) => {
    setIsRefreshing(true);
    setErrorMessage(null);
    try {
      const res = await api.getSemesterTahfizRecap({
        academicTermId: termId || undefined,
        configId: cfgId || undefined
      }, user);

      if (!res.success) {
        setErrorMessage(res.message || 'Gagal menghitung rekap nilai semester.');
        setRecapResponse(null);
      } else {
        setRecapResponse(res);
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Terjadi kesalahan sistem saat mengambil rekap semester.');
      setRecapResponse(null);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTermChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTermId = e.target.value;
    setSelectedTermId(newTermId);
    setSelectedConfigId('');
    setIsLoading(true);
    await loadConfigsAndRecap(newTermId, '');
  };

  const handleConfigChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newConfigId = e.target.value;
    setSelectedConfigId(newConfigId);
    await fetchRecap(selectedTermId, newConfigId);
    if (activeTab === 'REMEDIAL') {
      await loadRemedialCandidates(selectedTermId, newConfigId);
    }
  };

  // Remedial Candidate Operations (Tahap 7B)
  const loadRemedialCandidates = async (termId: string, cfgId?: string) => {
    setRemedialLoading(true);
    try {
      const res = await api.getRemedialGenerationCandidates({
        academicTermId: termId || undefined,
        configId: cfgId || undefined
      }, user);
      if (res.success && res.candidates) {
        setRemedialCandidates(res.candidates);
      }
    } catch (e: any) {
      console.error("loadRemedialCandidates error:", e);
    } finally {
      setRemedialLoading(false);
    }
  };

  const handleGenerateRemedialPackage = async (candidate: RemedialCandidateItem) => {
    const key = `${candidate.originalPeriodId}_${candidate.studentId}`;
    setRemedialGeneratingKey(key);
    setRemedialNotification(null);
    try {
      // 1. Fetch material snapshot
      const snapRes = await api.getStudentMaterialSnapshot(candidate.originalPeriodId, candidate.studentId, user);
      const snapshot = snapRes.snapshot;
      if (!snapshot || snapshot.status !== 'finalized') {
        throw new Error('Materi santri belum difinalisasi.');
      }

      // 2. Fetch original questions for anti-reuse
      let origQuestions: any[] = [];
      if (candidate.examType === 'uts') {
        const qsRes = await api.getUTSQuestionSet(candidate.originalPeriodId, candidate.studentId, user);
        origQuestions = qsRes.questions || [];
      } else {
        const qsRes = await api.getUASQuestionSet(candidate.originalPeriodId, candidate.studentId, user);
        origQuestions = qsRes.questions || [];
      }

      // 3. Fetch bank questions for hybrid matching
      const bankRes = await api.getQuestionBankList({
        status: 'active',
        examType: candidate.examType
      }, user);
      const bankQuestions = bankRes.data || [];

      // 4. Period mock/object
      const period = examPeriods.find(p => p.id === candidate.originalPeriodId) || {
        id: candidate.originalPeriodId,
        academicTermId: selectedTermId,
        name: candidate.originalPeriodName,
        examType: candidate.examType,
        kkm: candidate.kkm,
        materialCutoffDate: new Date().toISOString(),
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // 5. Generate payload using remedialQuestionGenerator
      if (candidate.examType === 'uts') {
        const payload = await remedialQuestionGenerator.generateUTSRemedialPayload({
          period: period as any,
          snapshot,
          originalQuestions: origQuestions,
          strategy: 'hybrid',
          bankQuestions
        });

        const genRes = await api.generateUTSRemedialQuestionSet({
          originalPeriodId: candidate.originalPeriodId,
          studentId: candidate.studentId,
          strategy: 'hybrid',
          questionsData: payload.questionsData,
          seed: payload.seed,
          fingerprint: payload.fingerprint
        }, user);

        if (!genRes.success) {
          throw new Error(genRes.message || 'Gagal generate paket remedial UTS.');
        }

        setRemedialNotification({
          type: 'success',
          message: `Berhasil membuat dan mengunci 5 butir soal UTS remedial untuk ${candidate.studentName}.`
        });
      } else {
        const payload = await remedialQuestionGenerator.generateUASRemedialPayload({
          period: period as any,
          snapshot,
          originalQuestions: origQuestions,
          strategy: 'hybrid',
          bankQuestions
        });

        const genRes = await api.generateUASRemedialQuestionSet({
          originalPeriodId: candidate.originalPeriodId,
          studentId: candidate.studentId,
          strategy: 'hybrid',
          seed: payload.seed,
          fingerprint: payload.fingerprint,
          questions: payload.questions
        }, user);

        if (!genRes.success) {
          throw new Error(genRes.message || 'Gagal generate paket remedial UAS.');
        }

        setRemedialNotification({
          type: 'success',
          message: `Berhasil membuat dan mengunci 9 butir soal UAS remedial untuk ${candidate.studentName}.`
        });
      }

      await loadRemedialCandidates(selectedTermId, selectedConfigId);
    } catch (err: any) {
      setRemedialNotification({
        type: 'error',
        message: err?.message || 'Gagal membangkitkan paket soal remedial.'
      });
    } finally {
      setRemedialGeneratingKey(null);
    }
  };

  const handleViewRemedialPackage = async (candidate: RemedialCandidateItem) => {
    if (!candidate.remedialSessionId) return;
    setRemedialDetailLoading(true);
    try {
      const res = await api.getRemedialQuestionSet(candidate.remedialSessionId, user);
      if (res.success) {
        setRemedialDetailSession(res);
      } else {
        setRemedialNotification({
          type: 'error',
          message: res.message || 'Gagal mengambil rincian paket soal remedial.'
        });
      }
    } catch (e: any) {
      setRemedialNotification({
        type: 'error',
        message: e?.message || 'Terjadi kesalahan saat memuat rincian paket remedial.'
      });
    } finally {
      setRemedialDetailLoading(false);
    }
  };

  const handleOpenAssignModal = (cand: RemedialCandidateItem) => {
    setAssignModalCandidate(cand);
    setSelectedExaminerId('');
    setReassignReason('');
  };

  const handleSaveExaminerAssignment = async () => {
    if (!assignModalCandidate || !assignModalCandidate.remedialSessionId || !selectedExaminerId) return;
    setIsAssigning(true);
    try {
      const res = await api.assignRemedialExaminer(
        assignModalCandidate.remedialSessionId,
        selectedExaminerId,
        reassignReason || undefined,
        user
      );
      if (res.success) {
        setRemedialNotification({
          type: 'success',
          message: `Berhasil menugaskan penguji untuk ${assignModalCandidate.studentName}.`
        });
        setAssignModalCandidate(null);
        await loadRemedialCandidates(selectedTermId, selectedConfigId);
      } else {
        setRemedialNotification({
          type: 'error',
          message: res.message || 'Gagal menugaskan penguji remedial.'
        });
      }
    } catch (e: any) {
      setRemedialNotification({
        type: 'error',
        message: e?.message || 'Terjadi kesalahan saat menugaskan penguji.'
      });
    } finally {
      setIsAssigning(false);
    }
  };

  const handleOpenReopenModal = (cand: RemedialCandidateItem) => {
    setReopenModalCandidate(cand);
    setReopenReasonText('');
  };

  const handleSaveReopen = async () => {
    if (!reopenModalCandidate || !reopenModalCandidate.remedialSessionId || !reopenReasonText.trim()) return;
    setIsReopening(true);
    try {
      const attemptId = `rem_att_${reopenModalCandidate.remedialSessionId}`;
      const res = await api.reopenRemedialAttempt(attemptId, reopenReasonText.trim(), user);
      if (res.success) {
        setRemedialNotification({
          type: 'success',
          message: `Ujian remedial ${reopenModalCandidate.studentName} berhasil dibuka kembali.`
        });
        setReopenModalCandidate(null);
        await loadRemedialCandidates(selectedTermId, selectedConfigId);
      } else {
        setRemedialNotification({
          type: 'error',
          message: res.message || 'Gagal membuka kembali ujian remedial.'
        });
      }
    } catch (e: any) {
      setRemedialNotification({
        type: 'error',
        message: e?.message || 'Terjadi kesalahan saat membuka kembali ujian.'
      });
    } finally {
      setIsReopening(false);
    }
  };

  // Filter remedial candidates
  const filteredRemedialCandidates = useMemo(() => {
    return remedialCandidates.filter(c => {
      if (remedialSearch.trim()) {
        const q = remedialSearch.toLowerCase();
        const matchName = c.studentName.toLowerCase().includes(q);
        const matchClass = c.className.toLowerCase().includes(q);
        const matchHalaqah = c.halaqah.toLowerCase().includes(q);
        const matchNis = c.studentNis?.toLowerCase().includes(q);
        if (!matchName && !matchClass && !matchHalaqah && !matchNis) return false;
      }

      if (remedialFilter === 'UTS') return c.examType === 'uts';
      if (remedialFilter === 'UAS') return c.examType === 'uas';
      if (remedialFilter === 'PENDING') return !c.isPackageReady;
      if (remedialFilter === 'READY') return c.isPackageReady;
      return true;
    });
  }, [remedialCandidates, remedialSearch, remedialFilter]);

  // Extract distinct classes and halaqahs
  const classesList = useMemo(() => {
    if (!recapResponse?.recap) return [];
    const set = new Set<string>();
    recapResponse.recap.forEach(r => {
      if (r.className && r.className !== '-') set.add(r.className);
    });
    return Array.from(set).sort();
  }, [recapResponse]);

  const halaqahList = useMemo(() => {
    if (!recapResponse?.recap) return [];
    const set = new Set<string>();
    recapResponse.recap.forEach(r => {
      if (r.halaqah && r.halaqah !== '-') set.add(r.halaqah);
    });
    return Array.from(set).sort();
  }, [recapResponse]);

  // Filter and search students
  const filteredStudents = useMemo(() => {
    if (!recapResponse?.recap) return [];
    return recapResponse.recap.filter(item => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.studentName.toLowerCase().includes(q);
        const matchNis = item.studentNis?.toLowerCase().includes(q);
        const matchClass = item.className.toLowerCase().includes(q);
        const matchHalaqah = item.halaqah.toLowerCase().includes(q);
        if (!matchName && !matchNis && !matchClass && !matchHalaqah) return false;
      }

      // 2. Class Filter
      if (selectedClass !== 'ALL' && item.className !== selectedClass) return false;

      // 3. Halaqah Filter
      if (selectedHalaqah !== 'ALL' && item.halaqah !== selectedHalaqah) return false;

      // 4. Chip Filter
      if (activeChip === 'TUNTAS') {
        return item.semester.status === 'TUNTAS';
      }
      if (activeChip === 'PERLU_REMEDIAL') {
        return item.semester.status === 'PERLU_REMEDIAL';
      }
      if (activeChip === 'UTS_REMEDIAL') {
        return item.uts.status === 'PERLU_REMEDIAL';
      }
      if (activeChip === 'UAS_REMEDIAL') {
        return item.uas.status === 'PERLU_REMEDIAL';
      }
      if (activeChip === 'BELUM_UTS') {
        return item.uts.status === 'NOT_STARTED';
      }
      if (activeChip === 'BELUM_UAS') {
        return item.uas.status === 'NOT_STARTED';
      }
      if (activeChip === 'INCOMPLETE') {
        return item.semester.status === 'INCOMPLETE';
      }

      return true;
    });
  }, [recapResponse, searchQuery, selectedClass, selectedHalaqah, activeChip]);

  // Handle Save Configuration
  const handleOpenConfigModal = () => {
    const termPeriods = examPeriods.filter(p => p.academicTermId === selectedTermId);
    const uts = termPeriods.filter(p => p.examType === 'uts');
    const uas = termPeriods.filter(p => p.examType === 'uas');

    setCustomName(recapResponse?.config?.configName || 'Konfigurasi Evaluasi Semester');
    setCustomUtsPeriodId(recapResponse?.config?.utsPeriodId || (uts[0]?.id || ''));
    setCustomUasPeriodId(recapResponse?.config?.uasPeriodId || (uas[0]?.id || ''));
    setCustomUtsWeight(recapResponse?.config?.utsWeight ?? 40);
    setCustomUasWeight(recapResponse?.config?.uasWeight ?? 60);
    setConfigError(null);
    setIsConfigModalOpen(true);
  };

  const handleSaveConfig = async () => {
    setConfigError(null);
    if (!customUtsPeriodId || !customUasPeriodId) {
      setConfigError('Harap pilih periode UTS dan periode UAS.');
      return;
    }
    const sum = Number((customUtsWeight + customUasWeight).toFixed(2));
    if (sum !== 100) {
      setConfigError(`Total bobot harus tepat 100% (Saat ini: ${sum}%).`);
      return;
    }

    setConfigSaving(true);
    try {
      const res = await api.upsertSemesterEvaluationConfig({
        academicTermId: selectedTermId,
        name: customName || 'Konfigurasi Rekap Semester',
        utsPeriodId: customUtsPeriodId,
        uasPeriodId: customUasPeriodId,
        utsWeight: customUtsWeight,
        uasWeight: customUasWeight
      }, user);

      if (res.success && res.config) {
        setIsConfigModalOpen(false);
        await loadConfigsAndRecap(selectedTermId, res.config.id);
      } else {
        setConfigError(res.message || 'Gagal menyimpan konfigurasi.');
      }
    } catch (e: any) {
      setConfigError(e?.message || 'Terjadi kesalahan sistem saat menyimpan konfigurasi.');
    } finally {
      setConfigSaving(false);
    }
  };

  const summary: SemesterRecapSummary = recapResponse?.summary || {
    totalStudents: 0,
    tuntasCount: 0,
    perluRemedialCount: 0,
    incompleteCount: 0,
    utsRemedialCount: 0,
    uasRemedialCount: 0,
    belumUtsCount: 0,
    belumUasCount: 0
  };

  const renderStatusBadge = (status: string, size: 'sm' | 'md' = 'sm') => {
    const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-semibold';
    switch (status) {
      case 'TUNTAS':
        return (
          <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium ${sizeClasses}`}>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Tuntas
          </span>
        );
      case 'PERLU_REMEDIAL':
        return (
          <span className={`inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-medium ${sizeClasses}`}>
            <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
            Perlu Remedial
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className={`inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium ${sizeClasses}`}>
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            Sedang Ujian
          </span>
        );
      case 'INCOMPLETE':
        return (
          <span className={`inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 font-medium ${sizeClasses}`}>
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            Belum Lengkap
          </span>
        );
      case 'NOT_STARTED':
      default:
        return (
          <span className={`inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200 font-medium ${sizeClasses}`}>
            Belum Ujian
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-600 mb-3" />
        <p className="text-sm font-medium">Memuat data rekap evaluasi semester...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header & Controls */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                <Award className="w-6 h-6" />
              </span>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Rekap Semester Tahfiz</h1>
                <p className="text-sm text-slate-500">
                  Evaluasi otoritatif hasil ujian semester dan status kelayakan remedial
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Term Selector */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <Calendar className="w-4 h-4 text-slate-500" />
              <select
                value={selectedTermId}
                onChange={handleTermChange}
                className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer"
              >
                {academicTerms.map(term => (
                  <option key={term.id} value={term.id}>
                    {term.academicYear} — Semester {term.semester === 'ganjil' ? 'Ganjil' : 'Genap'} {term.status === 'active' ? '(Aktif)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Config Selector */}
            {configs.length > 1 && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
                <Layers className="w-4 h-4 text-slate-500" />
                <select
                  value={selectedConfigId}
                  onChange={handleConfigChange}
                  className="bg-transparent text-sm font-medium text-slate-700 outline-none cursor-pointer"
                >
                  {configs.map(cfg => (
                    <option key={cfg.id} value={cfg.id}>
                      {cfg.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Config Button (Admin Only) */}
            {user.role === 'admin' && (
              <button
                onClick={handleOpenConfigModal}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition"
                title="Atur Pasangan Periode & Bobot Nilai"
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>Atur Bobot</span>
              </button>
            )}

            {/* Refresh Button */}
            <button
              onClick={() => fetchRecap(selectedTermId, selectedConfigId)}
              disabled={isRefreshing}
              className="p-2 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl border border-slate-200 transition"
              title="Perbarui Data"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Configuration Specs Banner */}
        {recapResponse?.config && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 bg-emerald-50/50 rounded-xl p-3 border border-emerald-100 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <span className="text-slate-400">Konfigurasi: </span>
                <span className="font-semibold text-slate-800">{recapResponse.config.configName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>UTS: <strong>{recapResponse.config.utsPeriodName}</strong> (KKM {recapResponse.config.utsKkm} • Bobot {recapResponse.config.utsWeight}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                <span>UAS: <strong>{recapResponse.config.uasPeriodName}</strong> (KKM {recapResponse.config.uasKkm} • Bobot {recapResponse.config.uasWeight}%)</span>
              </div>
            </div>
            <div className="text-slate-500 font-mono text-[11px]">
              Rumus: (UTS × {recapResponse.config.utsWeight}%) + (UAS × {recapResponse.config.uasWeight}%)
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="mt-4 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-800 text-sm">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Informasi Rekapitulasi</p>
              <p className="text-rose-700 mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}
      </div>

      {/* Top View Switcher Tabs: Rekap Nilai vs Persiapan Remedial */}
      <div className="flex bg-white rounded-2xl p-1.5 shadow-sm border border-slate-200">
        <button
          onClick={() => setActiveTab('RECAP')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition ${
            activeTab === 'RECAP'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Award className="w-4 h-4" />
          <span>Rekap Evaluasi Nilai</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('REMEDIAL');
            loadRemedialCandidates(selectedTermId, selectedConfigId);
          }}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition ${
            activeTab === 'REMEDIAL'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Persiapan Remedial</span>
          {recapResponse?.remedialCandidates && recapResponse.remedialCandidates.length > 0 && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
              activeTab === 'REMEDIAL' ? 'bg-white text-emerald-700' : 'bg-rose-100 text-rose-700'
            }`}>
              {recapResponse.remedialCandidates.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'RECAP' ? (
        <>
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Total Students */}
        <div 
          onClick={() => setActiveChip('ALL')}
          className={`cursor-pointer rounded-2xl p-4 border transition ${
            activeChip === 'ALL' ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-xs uppercase tracking-wider font-semibold opacity-70">Total Santri</div>
          <div className="text-2xl font-bold mt-1">{summary.totalStudents}</div>
          <div className="text-[11px] opacity-75 mt-0.5">Peserta evaluasi</div>
        </div>

        {/* Tuntas */}
        <div 
          onClick={() => setActiveChip('TUNTAS')}
          className={`cursor-pointer rounded-2xl p-4 border transition ${
            activeChip === 'TUNTAS' ? 'bg-emerald-600 text-white border-emerald-600 shadow-md' : 'bg-white text-slate-800 border-emerald-200 hover:border-emerald-300'
          }`}
        >
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-700 group-hover:text-emerald-800 flex items-center justify-between">
            <span className={activeChip === 'TUNTAS' ? 'text-white' : 'text-emerald-700'}>Tuntas</span>
            <CheckCircle2 className={`w-4 h-4 ${activeChip === 'TUNTAS' ? 'text-white' : 'text-emerald-600'}`} />
          </div>
          <div className={`text-2xl font-bold mt-1 ${activeChip === 'TUNTAS' ? 'text-white' : 'text-emerald-700'}`}>
            {summary.tuntasCount}
          </div>
          <div className={`text-[11px] mt-0.5 ${activeChip === 'TUNTAS' ? 'text-emerald-100' : 'text-slate-500'}`}>
            {summary.totalStudents > 0 ? `${Math.round((summary.tuntasCount / summary.totalStudents) * 100)}% tuntas` : '0%'}
          </div>
        </div>

        {/* Perlu Remedial */}
        <div 
          onClick={() => setActiveChip('PERLU_REMEDIAL')}
          className={`cursor-pointer rounded-2xl p-4 border transition ${
            activeChip === 'PERLU_REMEDIAL' ? 'bg-rose-600 text-white border-rose-600 shadow-md' : 'bg-white text-slate-800 border-rose-200 hover:border-rose-300'
          }`}
        >
          <div className="text-xs uppercase tracking-wider font-semibold flex items-center justify-between">
            <span className={activeChip === 'PERLU_REMEDIAL' ? 'text-white' : 'text-rose-700'}>Perlu Remedial</span>
            <AlertCircle className={`w-4 h-4 ${activeChip === 'PERLU_REMEDIAL' ? 'text-white' : 'text-rose-600'}`} />
          </div>
          <div className={`text-2xl font-bold mt-1 ${activeChip === 'PERLU_REMEDIAL' ? 'text-white' : 'text-rose-700'}`}>
            {summary.perluRemedialCount}
          </div>
          <div className={`text-[11px] mt-0.5 ${activeChip === 'PERLU_REMEDIAL' ? 'text-rose-100' : 'text-slate-500'}`}>
            {summary.totalStudents > 0 ? `${Math.round((summary.perluRemedialCount / summary.totalStudents) * 100)}% perlu rem.` : '0%'}
          </div>
        </div>

        {/* Belum Lengkap */}
        <div 
          onClick={() => setActiveChip('INCOMPLETE')}
          className={`cursor-pointer rounded-2xl p-4 border transition ${
            activeChip === 'INCOMPLETE' ? 'bg-amber-600 text-white border-amber-600 shadow-md' : 'bg-white text-slate-800 border-amber-200 hover:border-amber-300'
          }`}
        >
          <div className="text-xs uppercase tracking-wider font-semibold flex items-center justify-between">
            <span className={activeChip === 'INCOMPLETE' ? 'text-white' : 'text-amber-700'}>Belum Lengkap</span>
            <Clock className={`w-4 h-4 ${activeChip === 'INCOMPLETE' ? 'text-white' : 'text-amber-600'}`} />
          </div>
          <div className={`text-2xl font-bold mt-1 ${activeChip === 'INCOMPLETE' ? 'text-white' : 'text-amber-700'}`}>
            {summary.incompleteCount}
          </div>
          <div className={`text-[11px] mt-0.5 ${activeChip === 'INCOMPLETE' ? 'text-amber-100' : 'text-slate-500'}`}>
            Sebagian belum ujian
          </div>
        </div>

        {/* Remedial UTS */}
        <div 
          onClick={() => setActiveChip('UTS_REMEDIAL')}
          className={`cursor-pointer rounded-2xl p-4 border transition ${
            activeChip === 'UTS_REMEDIAL' ? 'bg-orange-600 text-white border-orange-600 shadow-md' : 'bg-white text-slate-800 border-orange-200 hover:border-orange-300'
          }`}
        >
          <div className="text-xs uppercase tracking-wider font-semibold flex items-center justify-between">
            <span className={activeChip === 'UTS_REMEDIAL' ? 'text-white' : 'text-orange-700'}>Remedial UTS</span>
            <RotateCcw className={`w-4 h-4 ${activeChip === 'UTS_REMEDIAL' ? 'text-white' : 'text-orange-600'}`} />
          </div>
          <div className={`text-2xl font-bold mt-1 ${activeChip === 'UTS_REMEDIAL' ? 'text-white' : 'text-orange-700'}`}>
            {summary.utsRemedialCount}
          </div>
          <div className={`text-[11px] mt-0.5 ${activeChip === 'UTS_REMEDIAL' ? 'text-orange-100' : 'text-slate-500'}`}>
            Kandidat rem. UTS
          </div>
        </div>

        {/* Remedial UAS */}
        <div 
          onClick={() => setActiveChip('UAS_REMEDIAL')}
          className={`cursor-pointer rounded-2xl p-4 border transition ${
            activeChip === 'UAS_REMEDIAL' ? 'bg-purple-600 text-white border-purple-600 shadow-md' : 'bg-white text-slate-800 border-purple-200 hover:border-purple-300'
          }`}
        >
          <div className="text-xs uppercase tracking-wider font-semibold flex items-center justify-between">
            <span className={activeChip === 'UAS_REMEDIAL' ? 'text-white' : 'text-purple-700'}>Remedial UAS</span>
            <RotateCcw className={`w-4 h-4 ${activeChip === 'UAS_REMEDIAL' ? 'text-white' : 'text-purple-600'}`} />
          </div>
          <div className={`text-2xl font-bold mt-1 ${activeChip === 'UAS_REMEDIAL' ? 'text-white' : 'text-purple-700'}`}>
            {summary.uasRemedialCount}
          </div>
          <div className={`text-[11px] mt-0.5 ${activeChip === 'UAS_REMEDIAL' ? 'text-purple-100' : 'text-slate-500'}`}>
            Kandidat rem. UAS
          </div>
        </div>
      </div>

      {/* Filter Chips Bar & Search */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari santri berdasarkan nama, NIS, kelas, atau halaqah..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Class & Halaqah Selectors */}
          <div className="flex items-center gap-2">
            {classesList.length > 0 && (
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 outline-none"
              >
                <option value="ALL">Semua Kelas</option>
                {classesList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}

            {halaqahList.length > 0 && (
              <select
                value={selectedHalaqah}
                onChange={(e) => setSelectedHalaqah(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 outline-none"
              >
                <option value="ALL">Semua Halaqah</option>
                {halaqahList.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          <span className="text-slate-400 flex items-center gap-1 mr-1">
            <Filter className="w-3.5 h-3.5" />
            Filter:
          </span>
          <button
            onClick={() => setActiveChip('ALL')}
            className={`px-3 py-1 rounded-full font-medium transition ${
              activeChip === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Semua ({summary.totalStudents})
          </button>
          <button
            onClick={() => setActiveChip('TUNTAS')}
            className={`px-3 py-1 rounded-full font-medium transition ${
              activeChip === 'TUNTAS' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Tuntas ({summary.tuntasCount})
          </button>
          <button
            onClick={() => setActiveChip('PERLU_REMEDIAL')}
            className={`px-3 py-1 rounded-full font-medium transition ${
              activeChip === 'PERLU_REMEDIAL' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            Perlu Remedial ({summary.perluRemedialCount})
          </button>
          <button
            onClick={() => setActiveChip('UTS_REMEDIAL')}
            className={`px-3 py-1 rounded-full font-medium transition ${
              activeChip === 'UTS_REMEDIAL' ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
            }`}
          >
            UTS Remedial ({summary.utsRemedialCount})
          </button>
          <button
            onClick={() => setActiveChip('UAS_REMEDIAL')}
            className={`px-3 py-1 rounded-full font-medium transition ${
              activeChip === 'UAS_REMEDIAL' ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
            }`}
          >
            UAS Remedial ({summary.uasRemedialCount})
          </button>
          <button
            onClick={() => setActiveChip('BELUM_UTS')}
            className={`px-3 py-1 rounded-full font-medium transition ${
              activeChip === 'BELUM_UTS' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Belum UTS ({summary.belumUtsCount})
          </button>
          <button
            onClick={() => setActiveChip('BELUM_UAS')}
            className={`px-3 py-1 rounded-full font-medium transition ${
              activeChip === 'BELUM_UAS' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Belum UAS ({summary.belumUasCount})
          </button>
          <button
            onClick={() => setActiveChip('INCOMPLETE')}
            className={`px-3 py-1 rounded-full font-medium transition ${
              activeChip === 'INCOMPLETE' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            Incomplete ({summary.incompleteCount})
          </button>
        </div>
      </div>

      {/* Main Content Table (Desktop) & Cards (Mobile) */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {filteredStudents.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <BookOpen className="w-12 h-12 mx-auto stroke-[1.5] text-slate-300 mb-2" />
            <p className="text-base font-semibold text-slate-700">Tidak ada santri ditemukan</p>
            <p className="text-xs text-slate-400 mt-1">Coba sesuaikan kata kunci pencarian atau filter chip</p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/80 text-xs font-semibold text-slate-600 uppercase border-b border-slate-200 tracking-wider">
                  <tr>
                    <th className="py-3.5 px-4">Santri</th>
                    <th className="py-3.5 px-4">Kelas / Halaqah</th>
                    <th className="py-3.5 px-4 text-center">UTS (Asli)</th>
                    <th className="py-3.5 px-4 text-center">UAS (Asli)</th>
                    <th className="py-3.5 px-4 text-center">Kontribusi UTS</th>
                    <th className="py-3.5 px-4 text-center">Kontribusi UAS</th>
                    <th className="py-3.5 px-4 text-center">Nilai Semester</th>
                    <th className="py-3.5 px-4 text-center">Status Akhir</th>
                    <th className="py-3.5 px-4 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStudents.map((item) => (
                    <tr key={item.studentId} className="hover:bg-slate-50/60 transition">
                      {/* Santri Name & NIS */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{item.studentName}</div>
                        <div className="text-xs text-slate-400">{item.studentNis || '-'}</div>
                      </td>

                      {/* Class & Halaqah */}
                      <td className="py-3.5 px-4 text-xs text-slate-600">
                        <div className="font-medium">{item.className}</div>
                        <div className="text-slate-400">{item.halaqah}</div>
                      </td>

                      {/* UTS Original */}
                      <td className="py-3.5 px-4 text-center">
                        {item.uts.originalScore !== null ? (
                          <div>
                            <span className="font-semibold text-slate-800 font-mono">
                              {item.uts.originalScore.toFixed(2)}
                            </span>
                            <div className="mt-0.5">{renderStatusBadge(item.uts.status, 'sm')}</div>
                          </div>
                        ) : (
                          <div>{renderStatusBadge(item.uts.status, 'sm')}</div>
                        )}
                      </td>

                      {/* UAS Original */}
                      <td className="py-3.5 px-4 text-center">
                        {item.uas.originalScore !== null ? (
                          <div>
                            <span className="font-semibold text-slate-800 font-mono">
                              {item.uas.originalScore.toFixed(2)}
                            </span>
                            <div className="mt-0.5">{renderStatusBadge(item.uas.status, 'sm')}</div>
                          </div>
                        ) : (
                          <div>{renderStatusBadge(item.uas.status, 'sm')}</div>
                        )}
                      </td>

                      {/* UTS Contribution */}
                      <td className="py-3.5 px-4 text-center font-mono text-xs">
                        {item.semester.utsContribution !== null ? (
                          <span className="text-slate-700">
                            {item.semester.utsContribution.toFixed(2)}
                            <span className="text-[10px] text-slate-400 ml-1">({item.semester.utsWeight}%)</span>
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* UAS Contribution */}
                      <td className="py-3.5 px-4 text-center font-mono text-xs">
                        {item.semester.uasContribution !== null ? (
                          <span className="text-slate-700">
                            {item.semester.uasContribution.toFixed(2)}
                            <span className="text-[10px] text-slate-400 ml-1">({item.semester.uasWeight}%)</span>
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* Semester Score */}
                      <td className="py-3.5 px-4 text-center font-mono">
                        {item.semester.score !== null ? (
                          <span className={`text-base font-bold ${
                            item.semester.status === 'TUNTAS' ? 'text-emerald-700' : 'text-rose-700'
                          }`}>
                            {item.semester.score.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs italic">Belum Lengkap</span>
                        )}
                      </td>

                      {/* Semester Status */}
                      <td className="py-3.5 px-4 text-center">
                        {renderStatusBadge(item.semester.status, 'md')}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => setSelectedStudent(item)}
                          className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition"
                        >
                          Detail Nilai
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="lg:hidden divide-y divide-slate-100">
              {filteredStudents.map((item) => (
                <div key={item.studentId} className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-900">{item.studentName}</h3>
                      <p className="text-xs text-slate-500">
                        {item.className} • {item.halaqah} {item.studentNis ? `• NIS: ${item.studentNis}` : ''}
                      </p>
                    </div>
                    <div>{renderStatusBadge(item.semester.status, 'sm')}</div>
                  </div>

                  {/* Component Breakdown Card */}
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-xl text-xs">
                    <div>
                      <div className="text-slate-400">Komponen UTS ({item.semester.utsWeight}%)</div>
                      <div className="font-semibold text-slate-800 mt-0.5 flex items-center gap-1.5">
                        {item.uts.originalScore !== null ? (
                          <>
                            <span className="font-mono text-sm">{item.uts.originalScore.toFixed(2)}</span>
                            <span className="text-[10px] text-slate-500">(Kontr: {item.semester.utsContribution?.toFixed(2)})</span>
                          </>
                        ) : (
                          <span className="text-slate-400 italic">Belum Ujian</span>
                        )}
                      </div>
                      <div className="mt-1">{renderStatusBadge(item.uts.status, 'sm')}</div>
                    </div>

                    <div>
                      <div className="text-slate-400">Komponen UAS ({item.semester.uasWeight}%)</div>
                      <div className="font-semibold text-slate-800 mt-0.5 flex items-center gap-1.5">
                        {item.uas.originalScore !== null ? (
                          <>
                            <span className="font-mono text-sm">{item.uas.originalScore.toFixed(2)}</span>
                            <span className="text-[10px] text-slate-500">(Kontr: {item.semester.uasContribution?.toFixed(2)})</span>
                          </>
                        ) : (
                          <span className="text-slate-400 italic">Belum Ujian</span>
                        )}
                      </div>
                      <div className="mt-1">{renderStatusBadge(item.uas.status, 'sm')}</div>
                    </div>
                  </div>

                  {/* Footer & Detail Button */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="text-xs">
                      <span className="text-slate-500">Nilai Akhir Semester: </span>
                      {item.semester.score !== null ? (
                        <span className="font-bold font-mono text-base text-slate-900">
                          {item.semester.score.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Belum Lengkap</span>
                      )}
                    </div>
                    <button
                      onClick={() => setSelectedStudent(item)}
                      className="px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition"
                    >
                      Detail Nilai
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
        </>
      ) : (
        /* ============================================================ */
        /* PERSIAPAN REMEDIAL VIEW (Tahap 7B)                           */
        /* ============================================================ */
        <div className="space-y-6">
          {/* Notification Alert */}
          {remedialNotification && (
            <div className={`p-4 rounded-xl flex items-start justify-between gap-3 text-sm animate-fade-in ${
              remedialNotification.type === 'success' 
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' 
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}>
              <div className="flex items-start gap-2.5">
                {remedialNotification.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                )}
                <p className="font-medium">{remedialNotification.message}</p>
              </div>
              <button 
                onClick={() => setRemedialNotification(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Remedial KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            {/* Total Candidates */}
            <div 
              onClick={() => setRemedialFilter('ALL')}
              className={`cursor-pointer rounded-2xl p-4 border transition ${
                remedialFilter === 'ALL' ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="text-xs uppercase tracking-wider font-semibold opacity-70">Total Kandidat</div>
              <div className="text-2xl font-bold mt-1">{remedialCandidates.length}</div>
              <div className="text-[11px] opacity-75 mt-0.5">Perlu remedial</div>
            </div>

            {/* UTS Candidates */}
            <div 
              onClick={() => setRemedialFilter('UTS')}
              className={`cursor-pointer rounded-2xl p-4 border transition ${
                remedialFilter === 'UTS' ? 'bg-orange-600 text-white border-orange-600 shadow-md' : 'bg-white text-slate-800 border-orange-200 hover:border-orange-300'
              }`}
            >
              <div className="text-xs uppercase tracking-wider font-semibold text-orange-700 flex items-center justify-between">
                <span className={remedialFilter === 'UTS' ? 'text-white' : 'text-orange-700'}>Remedial UTS</span>
                <RotateCcw className={`w-4 h-4 ${remedialFilter === 'UTS' ? 'text-white' : 'text-orange-600'}`} />
              </div>
              <div className={`text-2xl font-bold mt-1 ${remedialFilter === 'UTS' ? 'text-white' : 'text-orange-700'}`}>
                {remedialCandidates.filter(c => c.examType === 'uts').length}
              </div>
              <div className={`text-[11px] mt-0.5 ${remedialFilter === 'UTS' ? 'text-orange-100' : 'text-slate-500'}`}>
                Format 5 Soal
              </div>
            </div>

            {/* UAS Candidates */}
            <div 
              onClick={() => setRemedialFilter('UAS')}
              className={`cursor-pointer rounded-2xl p-4 border transition ${
                remedialFilter === 'UAS' ? 'bg-purple-600 text-white border-purple-600 shadow-md' : 'bg-white text-slate-800 border-purple-200 hover:border-purple-300'
              }`}
            >
              <div className="text-xs uppercase tracking-wider font-semibold text-purple-700 flex items-center justify-between">
                <span className={remedialFilter === 'UAS' ? 'text-white' : 'text-purple-700'}>Remedial UAS</span>
                <RotateCcw className={`w-4 h-4 ${remedialFilter === 'UAS' ? 'text-white' : 'text-purple-600'}`} />
              </div>
              <div className={`text-2xl font-bold mt-1 ${remedialFilter === 'UAS' ? 'text-white' : 'text-purple-700'}`}>
                {remedialCandidates.filter(c => c.examType === 'uas').length}
              </div>
              <div className={`text-[11px] mt-0.5 ${remedialFilter === 'UAS' ? 'text-purple-100' : 'text-slate-500'}`}>
                Format 9 Soal (2+7)
              </div>
            </div>

            {/* Paket Belum Dibuat */}
            <div 
              onClick={() => setRemedialFilter('PENDING')}
              className={`cursor-pointer rounded-2xl p-4 border transition ${
                remedialFilter === 'PENDING' ? 'bg-amber-600 text-white border-amber-600 shadow-md' : 'bg-white text-slate-800 border-amber-200 hover:border-amber-300'
              }`}
            >
              <div className="text-xs uppercase tracking-wider font-semibold text-amber-700 flex items-center justify-between">
                <span className={remedialFilter === 'PENDING' ? 'text-white' : 'text-amber-700'}>Belum Dibuat</span>
                <Clock className={`w-4 h-4 ${remedialFilter === 'PENDING' ? 'text-white' : 'text-amber-600'}`} />
              </div>
              <div className={`text-2xl font-bold mt-1 ${remedialFilter === 'PENDING' ? 'text-white' : 'text-amber-700'}`}>
                {remedialCandidates.filter(c => !c.isPackageReady).length}
              </div>
              <div className={`text-[11px] mt-0.5 ${remedialFilter === 'PENDING' ? 'text-amber-100' : 'text-slate-500'}`}>
                Menunggu Generator
              </div>
            </div>

            {/* Paket Siap / Locked */}
            <div 
              onClick={() => setRemedialFilter('READY')}
              className={`cursor-pointer rounded-2xl p-4 border transition ${
                remedialFilter === 'READY' ? 'bg-emerald-600 text-white border-emerald-600 shadow-md' : 'bg-white text-slate-800 border-emerald-200 hover:border-emerald-300'
              }`}
            >
              <div className="text-xs uppercase tracking-wider font-semibold text-emerald-700 flex items-center justify-between">
                <span className={remedialFilter === 'READY' ? 'text-white' : 'text-emerald-700'}>Paket Siap</span>
                <ShieldCheck className={`w-4 h-4 ${remedialFilter === 'READY' ? 'text-white' : 'text-emerald-600'}`} />
              </div>
              <div className={`text-2xl font-bold mt-1 ${remedialFilter === 'READY' ? 'text-white' : 'text-emerald-700'}`}>
                {remedialCandidates.filter(c => c.isPackageReady).length}
              </div>
              <div className={`text-[11px] mt-0.5 ${remedialFilter === 'READY' ? 'text-emerald-100' : 'text-slate-500'}`}>
                Terkunci (Locked)
              </div>
            </div>
          </div>

          {/* Filter Bar & Search */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari santri kandidat remedial..."
                  value={remedialSearch}
                  onChange={(e) => setRemedialSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition"
                />
                {remedialSearch && (
                  <button 
                    onClick={() => setRemedialSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
              <span className="text-slate-400 flex items-center gap-1 mr-1">
                <Filter className="w-3.5 h-3.5" />
                Filter:
              </span>
              <button
                onClick={() => setRemedialFilter('ALL')}
                className={`px-3 py-1 rounded-full font-medium transition ${
                  remedialFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Semua ({remedialCandidates.length})
              </button>
              <button
                onClick={() => setRemedialFilter('UTS')}
                className={`px-3 py-1 rounded-full font-medium transition ${
                  remedialFilter === 'UTS' ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                }`}
              >
                UTS ({remedialCandidates.filter(c => c.examType === 'uts').length})
              </button>
              <button
                onClick={() => setRemedialFilter('UAS')}
                className={`px-3 py-1 rounded-full font-medium transition ${
                  remedialFilter === 'UAS' ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                }`}
              >
                UAS ({remedialCandidates.filter(c => c.examType === 'uas').length})
              </button>
              <button
                onClick={() => setRemedialFilter('PENDING')}
                className={`px-3 py-1 rounded-full font-medium transition ${
                  remedialFilter === 'PENDING' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                Belum Dibuat ({remedialCandidates.filter(c => !c.isPackageReady).length})
              </button>
              <button
                onClick={() => setRemedialFilter('READY')}
                className={`px-3 py-1 rounded-full font-medium transition ${
                  remedialFilter === 'READY' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                Paket Siap ({remedialCandidates.filter(c => c.isPackageReady).length})
              </button>
            </div>
          </div>

          {/* Remedial Candidates Table Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Daftar Santri Remedial & Paket Soal</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Paket soal resmi diikat pada finalized material snapshot dan terproteksi anti-reuse
                </p>
              </div>
              <button
                onClick={() => loadRemedialCandidates(selectedTermId, selectedConfigId)}
                disabled={remedialLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${remedialLoading ? 'animate-spin' : ''}`} />
                <span>Perbarui</span>
              </button>
            </div>

            {remedialLoading ? (
              <div className="flex flex-col items-center justify-center p-12 text-slate-500">
                <RefreshCw className="w-8 h-8 animate-spin text-emerald-600 mb-3" />
                <p className="text-sm font-medium">Memuat data kandidat remedial...</p>
              </div>
            ) : filteredRemedialCandidates.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                <p className="font-semibold text-slate-700 text-base">Tidak Ada Kandidat Remedial</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Seluruh santri telah mencapai nilai KKM atau belum ada santri yang sesuai dengan kriteria filter saat ini.
                </p>
              </div>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-600">
                    <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200 text-xs">
                      <tr>
                        <th className="py-3.5 px-4 w-12 text-center">No</th>
                        <th className="py-3.5 px-4">Santri</th>
                        <th className="py-3.5 px-4">Kelas & Halaqah</th>
                        <th className="py-3.5 px-4 text-center">Komponen</th>
                        <th className="py-3.5 px-4 text-center">Nilai Awal vs KKM</th>
                        <th className="py-3.5 px-4 text-center">Status Materi</th>
                        <th className="py-3.5 px-4 text-center">Status Paket</th>
                        <th className="py-3.5 px-4 text-center">Aksi Generator</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredRemedialCandidates.map((cand, idx) => {
                        const isGen = remedialGeneratingKey === `${cand.originalPeriodId}_${cand.studentId}`;
                        return (
                          <tr key={`${cand.originalPeriodId}_${cand.studentId}`} className="hover:bg-slate-50/80 transition">
                            <td className="py-3.5 px-4 text-center text-slate-400 font-mono">
                              {idx + 1}
                            </td>

                            <td className="py-3.5 px-4">
                              <div className="font-bold text-slate-900 text-sm">{cand.studentName}</div>
                              <div className="text-[11px] text-slate-400 font-mono">
                                NIS: {cand.studentNis || '-'}
                              </div>
                            </td>

                            <td className="py-3.5 px-4">
                              <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium text-[11px]">
                                {cand.className}
                              </span>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {cand.halaqah}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              {cand.examType === 'uts' ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
                                  UTS Remedial
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                  UAS Remedial
                                </span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-center font-mono">
                              <span className="font-bold text-rose-600 text-sm">
                                {cand.originalScore.toFixed(2)}
                              </span>
                              <span className="text-slate-400 text-xs ml-1">/ KKM {cand.kkm}</span>
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px] font-semibold border border-emerald-200">
                                <FileCheck className="w-3 h-3" />
                                Finalized
                              </span>
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              {cand.isPackageReady ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                  Paket Siap ({cand.examType === 'uts' ? '5 Soal' : '9 Soal'})
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                                  Paket Belum Dibuat
                                </span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-center">
                              {cand.isPackageReady ? (
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => handleViewRemedialPackage(cand)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-xs rounded-xl border border-emerald-200 transition"
                                    title="Lihat Paket Soal"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>Paket</span>
                                  </button>
                                  <button
                                    onClick={() => handleOpenAssignModal(cand)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs rounded-xl border border-indigo-200 transition"
                                    title="Tugaskan Penguji"
                                  >
                                    <UserCheck className="w-3.5 h-3.5" />
                                    <span>Tugaskan</span>
                                  </button>
                                  <button
                                    onClick={() => handleOpenReopenModal(cand)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold text-xs rounded-xl border border-amber-200 transition"
                                    title="Buka Kembali Ujian Remedial"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    <span>Reopen</span>
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleGenerateRemedialPackage(cand)}
                                  disabled={isGen}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-sm hover:shadow transition disabled:opacity-50"
                                >
                                  {isGen ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Sparkles className="w-3.5 h-3.5" />
                                  )}
                                  <span>Generate Paket</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile View */}
                <div className="lg:hidden divide-y divide-slate-100">
                  {filteredRemedialCandidates.map((cand) => {
                    const isGen = remedialGeneratingKey === `${cand.originalPeriodId}_${cand.studentId}`;
                    return (
                      <div key={`${cand.originalPeriodId}_${cand.studentId}`} className="p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold text-slate-900">{cand.studentName}</h3>
                            <p className="text-xs text-slate-500">
                              {cand.className} • {cand.halaqah} {cand.studentNis ? `• NIS: ${cand.studentNis}` : ''}
                            </p>
                          </div>
                          {cand.examType === 'uts' ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
                              UTS
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                              UAS
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          <div>
                            <span className="text-slate-400">Nilai Awal: </span>
                            <span className="font-bold text-rose-600 font-mono">{cand.originalScore.toFixed(2)}</span>
                            <span className="text-slate-400"> (KKM {cand.kkm})</span>
                          </div>
                          <div>
                            {cand.isPackageReady ? (
                              <span className="text-emerald-700 font-semibold flex items-center gap-1">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Siap ({cand.examType === 'uts' ? '5 Soal' : '9 Soal'})
                              </span>
                            ) : (
                              <span className="text-amber-600 font-semibold flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                Belum Dibuat
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="pt-1 flex flex-wrap items-center gap-2">
                          {cand.isPackageReady ? (
                            <>
                              <button
                                onClick={() => handleViewRemedialPackage(cand)}
                                className="flex-1 flex items-center justify-center gap-1 py-2 bg-emerald-50 text-emerald-700 font-semibold text-xs rounded-xl border border-emerald-200 transition"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Paket</span>
                              </button>
                              <button
                                onClick={() => handleOpenAssignModal(cand)}
                                className="flex-1 flex items-center justify-center gap-1 py-2 bg-indigo-50 text-indigo-700 font-semibold text-xs rounded-xl border border-indigo-200 transition"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                <span>Tugaskan</span>
                              </button>
                              <button
                                onClick={() => handleOpenReopenModal(cand)}
                                className="flex-1 flex items-center justify-center gap-1 py-2 bg-amber-50 text-amber-700 font-semibold text-xs rounded-xl border border-amber-200 transition"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Reopen</span>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleGenerateRemedialPackage(cand)}
                              disabled={isGen}
                              className="w-full flex items-center justify-center gap-1.5 py-2 bg-indigo-600 text-white font-semibold text-xs rounded-xl shadow-sm transition disabled:opacity-50"
                            >
                              {isGen ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                              <span>Generate Paket Remedial</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Remedial Package Detail & Traceability Modal */}
      {remedialDetailSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-base font-bold">Rincian Paket Soal Remedial Terkunci</h3>
                </div>
                <p className="text-xs text-slate-300 mt-0.5">
                  {remedialDetailSession.student?.name} • {remedialDetailSession.student?.class} • {remedialDetailSession.student?.halaqah}
                </p>
              </div>
              <button
                onClick={() => setRemedialDetailSession(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4">
              {/* Traceability Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Original Exam Box */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
                  <div className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1 text-slate-500">
                    <Award className="w-3.5 h-3.5" />
                    Riwayat Ujian Original (Immutable)
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Komponen:</span>
                    <span className="font-semibold uppercase text-slate-800">{remedialDetailSession.originalExam?.examType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Nilai Awal:</span>
                    <span className="font-bold text-rose-600 font-mono">{remedialDetailSession.originalExam?.score} (KKM {remedialDetailSession.originalExam?.kkm})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Attempt ID:</span>
                    <span className="font-mono text-slate-700 text-[10px] truncate max-w-[150px]" title={remedialDetailSession.originalExam?.attemptId}>
                      {remedialDetailSession.originalExam?.attemptId}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Paket Soal Original:</span>
                    <span className="font-mono text-slate-700 text-[10px] truncate max-w-[150px]" title={remedialDetailSession.originalExam?.questionSetId}>
                      {remedialDetailSession.originalExam?.questionSetId}
                    </span>
                  </div>
                </div>

                {/* Remedial Session Box */}
                <div className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-xl space-y-1.5 text-xs">
                  <div className="font-bold text-emerald-800 uppercase tracking-wider text-[11px] flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Identitas Paket Remedial
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Status Paket:</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      {remedialDetailSession.remedialSession?.status?.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Versi Generator:</span>
                    <span className="font-semibold text-slate-800">v{remedialDetailSession.remedialSession?.generationVersion || 1}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Sesi Remedial ID:</span>
                    <span className="font-mono text-slate-700 text-[10px] truncate max-w-[150px]" title={remedialDetailSession.remedialSession?.id}>
                      {remedialDetailSession.remedialSession?.id}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Remedial Set ID:</span>
                    <span className="font-mono text-slate-700 text-[10px] truncate max-w-[150px]" title={remedialDetailSession.questionSet?.id}>
                      {remedialDetailSession.questionSet?.id}
                    </span>
                  </div>
                </div>
              </div>

              {/* Questions List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-slate-800">
                    Daftar Butir Soal Terkunci ({remedialDetailSession.questions?.length || 0} Soal)
                  </span>
                  <span className="text-slate-400">Proteksi Anti-Reuse Aktif</span>
                </div>

                <div className="space-y-2">
                  {(remedialDetailSession.questions || []).map((q) => (
                    <div key={q.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-bold text-[11px]">
                            Soal #{q.questionNumber}
                          </span>
                          {q.questionRole === 'mandatory' ? (
                            <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold text-[10px]">
                              Soal Wajib Halaman {q.pageNumber}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold text-[10px]">
                              Zona {q.zoneNumber} (Sambung Ayat)
                            </span>
                          )}
                          <span className="text-slate-400 text-[11px]">
                            Sumber: {q.sourceType === 'bank' ? 'Bank Soal' : 'Auto Generator'}
                          </span>
                        </div>

                        <div className="text-slate-600 text-[11px]">
                          {q.questionRole === 'mandatory' ? (
                            <span>Halaman {q.pageNumber} Mushaf Madinah • Rentang Surat {q.answerStartSurah}:{q.answerStartAyah} s.d. {q.answerEndSurah}:{q.answerEndAyah}</span>
                          ) : (
                            <span>Titik B: Surat {q.answerStartSurah} Ayat {q.answerStartAyah} Kata {q.answerStartWord} • Halaman {q.startPage}</span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-bold text-emerald-700 font-mono text-sm">
                          {q.maxScore} Poin
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setRemedialDetailSession(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Student Detail Modal */}
      {selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl border border-slate-200 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">{selectedStudent.studentName}</h3>
                <p className="text-xs text-slate-300">
                  {selectedStudent.className} • {selectedStudent.halaqah} {selectedStudent.studentNis ? `• NIS: ${selectedStudent.studentNis}` : ''}
                </p>
              </div>
              <button
                onClick={() => setSelectedStudent(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 text-sm">
              {/* Semester Status Banner */}
              <div className={`p-4 rounded-xl border flex items-center justify-between ${
                selectedStudent.semester.status === 'TUNTAS' 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : selectedStudent.semester.status === 'PERLU_REMEDIAL'
                  ? 'bg-rose-50 border-rose-200 text-rose-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider opacity-70">Status Semester</div>
                  <div className="text-lg font-bold mt-0.5">
                    {selectedStudent.semester.status === 'TUNTAS' ? 'TUNTAS' : selectedStudent.semester.status === 'PERLU_REMEDIAL' ? 'PERLU REMEDIAL' : 'BELUM LENGKAP'}
                  </div>
                  <div className="text-xs opacity-75 mt-0.5">
                    {selectedStudent.semester.status === 'TUNTAS' 
                      ? 'Seluruh komponen UTS dan UAS mencapai KKM.' 
                      : selectedStudent.semester.status === 'PERLU_REMEDIAL'
                      ? 'Terdapat komponen ujian yang berada di bawah KKM.'
                      : 'Salah satu atau kedua komponen ujian belum diselesaikan.'}
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div className="text-xs opacity-70">Nilai Akhir</div>
                  <div className="text-2xl font-bold">
                    {selectedStudent.semester.score !== null ? selectedStudent.semester.score.toFixed(2) : '-'}
                  </div>
                </div>
              </div>

              {/* Component Cards */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Rincian Komponen Evaluasi</h4>
                
                {/* UTS Component */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                      Ujian Tengah Semester (UTS)
                    </span>
                    {renderStatusBadge(selectedStudent.uts.status, 'sm')}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-slate-200">
                    <div>
                      <span className="text-slate-400">Nilai Asli:</span>
                      <p className="font-mono font-bold text-slate-800">
                        {selectedStudent.uts.originalScore !== null ? selectedStudent.uts.originalScore.toFixed(2) : '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-400">KKM UTS:</span>
                      <p className="font-mono font-semibold text-slate-700">{selectedStudent.uts.kkm}</p>
                    </div>
                    <div>
                      <span className="text-slate-400">Kontribusi ({selectedStudent.semester.utsWeight}%):</span>
                      <p className="font-mono font-semibold text-slate-800">
                        {selectedStudent.semester.utsContribution !== null ? selectedStudent.semester.utsContribution.toFixed(2) : '-'}
                      </p>
                    </div>
                  </div>
                  {selectedStudent.uts.materialSnapshotId && (
                    <div className="text-[11px] text-slate-400 font-mono truncate">
                      Snapshot Materi: {selectedStudent.uts.materialSnapshotId}
                    </div>
                  )}
                  {selectedStudent.uts.remedialEligible && (
                    <div className="text-xs text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200 font-medium">
                      Kandidat Remedial UTS: Nilai asli di bawah KKM ({selectedStudent.uts.kkm})
                    </div>
                  )}
                </div>

                {/* UAS Component */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-teal-500"></span>
                      Ujian Akhir Semester (UAS)
                    </span>
                    {renderStatusBadge(selectedStudent.uas.status, 'sm')}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-slate-200">
                    <div>
                      <span className="text-slate-400">Nilai Asli:</span>
                      <p className="font-mono font-bold text-slate-800">
                        {selectedStudent.uas.originalScore !== null ? selectedStudent.uas.originalScore.toFixed(2) : '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-400">KKM UAS:</span>
                      <p className="font-mono font-semibold text-slate-700">{selectedStudent.uas.kkm}</p>
                    </div>
                    <div>
                      <span className="text-slate-400">Kontribusi ({selectedStudent.semester.uasWeight}%):</span>
                      <p className="font-mono font-semibold text-slate-800">
                        {selectedStudent.semester.uasContribution !== null ? selectedStudent.semester.uasContribution.toFixed(2) : '-'}
                      </p>
                    </div>
                  </div>
                  {selectedStudent.uas.materialSnapshotId && (
                    <div className="text-[11px] text-slate-400 font-mono truncate">
                      Snapshot Materi: {selectedStudent.uas.materialSnapshotId}
                    </div>
                  )}
                  {selectedStudent.uas.remedialEligible && (
                    <div className="text-xs text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200 font-medium">
                      Kandidat Remedial UAS: Nilai asli di bawah KKM ({selectedStudent.uas.kkm})
                    </div>
                  )}
                </div>
              </div>

              {/* Informative Note for Remedial (No action button as per Tahap 7A spec) */}
              {(selectedStudent.uts.remedialEligible || selectedStudent.uas.remedialEligible) && (
                <div className="p-3 bg-slate-100 rounded-xl text-xs text-slate-600 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                  <p>
                    Kelayakan remedial dicatat secara sistem. Pelaksanaan dan pembuatan paket soal remedial akan dikelola pada tahap selanjutnya (Tahap 7B).
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedStudent(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Configuration Modal (Admin Only) */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold">Atur Konfigurasi Semester</h3>
              </div>
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm">
              {configError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  <span>{configError}</span>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Konfigurasi</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Misal: Semester Ganjil 2026/2027 Reguler"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* UTS Period Select */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Periode UTS</label>
                <select
                  value={customUtsPeriodId}
                  onChange={(e) => setCustomUtsPeriodId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                >
                  <option value="">-- Pilih Periode UTS --</option>
                  {examPeriods.filter(p => p.academicTermId === selectedTermId && p.examType === 'uts').map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} (KKM: {p.kkm})
                    </option>
                  ))}
                </select>
              </div>

              {/* UAS Period Select */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Periode UAS</label>
                <select
                  value={customUasPeriodId}
                  onChange={(e) => setCustomUasPeriodId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                >
                  <option value="">-- Pilih Periode UAS --</option>
                  {examPeriods.filter(p => p.academicTermId === selectedTermId && p.examType === 'uas').map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} (KKM: {p.kkm})
                    </option>
                  ))}
                </select>
              </div>

              {/* Weights */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Bobot UTS (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={customUtsWeight}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setCustomUtsWeight(val);
                      setCustomUasWeight(Math.max(0, 100 - val));
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Bobot UAS (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={customUasWeight}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setCustomUasWeight(val);
                      setCustomUtsWeight(Math.max(0, 100 - val));
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                Total: <strong className="text-slate-800">{customUtsWeight + customUasWeight}%</strong> (Harus tepat 100%)
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition"
              >
                Batal
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={configSaving}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5"
              >
                {configSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Simpan Konfigurasi</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Examiner Modal (Tahap 7C) */}
      {assignModalCandidate && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900">Penugasan Penguji Remedial</h3>
              </div>
              <button onClick={() => setAssignModalCandidate(null)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <p><span className="font-semibold text-slate-500">Santri:</span> <strong className="text-slate-800">{assignModalCandidate.studentName}</strong> (NIS: {assignModalCandidate.studentNis || '-'})</p>
              <p><span className="font-semibold text-slate-500">Komponen:</span> <strong className="text-slate-800">{assignModalCandidate.examType.toUpperCase()} Remedial</strong></p>
              <p><span className="font-semibold text-slate-500">Nilai Awal / KKM:</span> <strong className="text-rose-600 font-mono">{assignModalCandidate.originalScore}</strong> / KKM {assignModalCandidate.kkm}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Pilih Penguji Resmi</label>
              <select
                value={selectedExaminerId}
                onChange={(e) => setSelectedExaminerId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                <option value="">-- Pilih Guru / Penguji --</option>
                {teachersList.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.role === 'admin' ? 'Admin' : 'Guru'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Alasan Penugasan / Penggantian
                <span className="text-slate-400 font-normal ml-1">(Wajib jika ujian sedang berjalan)</span>
              </label>
              <textarea
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
                placeholder="Contoh: Penguji sebelumnya berhalangan hadir..."
                rows={2}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setAssignModalCandidate(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition"
              >
                Batal
              </button>
              <button
                onClick={handleSaveExaminerAssignment}
                disabled={isAssigning || !selectedExaminerId}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition shadow-sm"
              >
                {isAssigning && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Simpan Penugasan</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen Remedial Modal (Tahap 7C) */}
      {reopenModalCandidate && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-slate-900">Buka Kembali Ujian Remedial</h3>
              </div>
              <button onClick={() => setReopenModalCandidate(null)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Pembukaan kembali akan mengizinkan penguji resmi untuk mengoreksi nilai pada butir soal remedial tanpa mengubah paket soal atau nomor ID butir soal.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Alasan Pembukaan Kembali <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={reopenReasonText}
                onChange={(e) => setReopenReasonText(e.target.value)}
                placeholder="Wajib mencantumkan alasan pembukaan kembali (contoh: Koreksi penilaian soal nomor 3 oleh penguji)..."
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setReopenModalCandidate(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition"
              >
                Batal
              </button>
              <button
                onClick={handleSaveReopen}
                disabled={isReopening || !reopenReasonText.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition shadow-sm"
              >
                {isReopening && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Buka Kembali</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
