export type Role = 'admin' | 'teacher' | 'parent';

export enum Grade {
  LANCAR = 'Lancar',
  LANCAR_BERSYARAT = 'Lancar Bersyarat',
  BELUM_LANCAR = 'Belum Lancar',
  ULANG = 'Ulang'
}

export interface User {
  id: string;
  name: string;
  role: Role;
  username?: string;
  password?: string;
  phoneNumber?: string; // Added for WhatsApp integration
  email?: string; // Added for Profile Settings
  avatar?: string;
  childId?: string; // For parents linked to a student
  gender?: 'L' | 'P'; // L for Laki-laki, P for Perempuan
}

export interface Student {
  id: string;
  name: string;
  nis: string;
  class: string;
  halaqah: string;
  teacherId: string;
  totalJuz: number;
  // Added for Parent/Student Login
  username?: string;
  password?: string;
}

export interface TahfidzRecord {
  id: string;
  studentId: string;
  date: string;
  type: 'sabaq' | 'sabqi' | 'manzil' | 'ziyadah' | 'murojaah';
  surah: string;
  ayahStart: number;
  ayahEnd: number;
  grade: string;
  notes?: string;
  class?: string;
}

export interface Attendance {
  id: string;
  userId: string; // Student ID or Teacher ID
  date: string;
  session: 'pagi' | 'malam'; // Added session support
  status: 'present' | 'sick' | 'permission' | 'alpha';
  approvalStatus?: 'pending' | 'approved' | 'rejected'; // New field for admin approval
  type: 'student' | 'teacher';
  class?: string;
  lateReason?: string; // New field for late attendance explanation
  qrToken?: string; // Add this line
}

export interface AttendanceOpenRequest {
  id: string;
  teacherId: string;
  date: string;
  session: 'pagi' | 'malam';
  type: 'student' | 'teacher';
  status: 'pending' | 'approved' | 'rejected';
  lateReason: string;
  createdAt?: string;
}

export interface Exam {
  id: string;
  studentId: string;
  date: string;
  category: string; 
  score: number;
  examiner: string;
  status: 'pass' | 'fail' | 'remedial';
  notes: string;
  juz?: string; // Added field for Database compatibility
  class?: string; // Added for historical data compatibility
  details?: {
    juz: string;
    surat: string;
    halaman: string;
    mistakes: { dibantu: number; ditegur: number; berhenti: number };
  };
}

export interface QuranWord {
  id: string | number;
  surahNumber: number;
  ayahNumber: number;
  position: number;
  textUthmani: string;
  pageNumber: number;
  juzNumber: number;
  lineNumber?: number;
  charTypeName?: string;
  translation?: string;
  transliteration?: string;
}

export interface QuranVerse {
  verseKey: string;
  surahNumber: number;
  ayahNumber: number;
  pageNumber: number;
  juzNumber: number;
  textUthmani: string;
  words?: QuranWord[];
}

export interface QuranSurah {
  number: number;
  name: string;
  startPage: number;
  totalAyahs?: number;
}

export interface QuranPage {
  pageNumber: number;
  verses: QuranVerse[];
  juzNumber?: number;
}

export interface QuranPosition {
  surahNumber: number;
  ayahNumber: number;
  wordPosition: number;
  pageNumber: number;
  lineNumber?: number;
}

export interface QuestionDraft {
  promptStart: QuranPosition;
  promptEnd: QuranPosition;
  answerStart: QuranPosition;
  answerEnd: QuranPosition;
  promptText: string;
  answerText: string;
  startPage: number;
  endPage: number;
  crossesAyah: boolean;
  crossesSurah: boolean;
  answerMode: 'end_ayah' | '3_lines' | '5_lines' | 'specific_ayah' | 'manual';
  surahName?: string;
  ayahDisplay?: string;
  fullAnswerVerses?: QuranVerse[];
}

export interface QuestionBankItem {
  id: string;
  examType: 'generic' | 'uts' | 'uas';
  questionType: 'random' | 'mandatory';
  promptStart: QuranPosition;
  promptEnd: QuranPosition;
  answerStart: QuranPosition;
  answerEnd: QuranPosition;
  promptText: string;
  answerText: string;
  totalExpectedWords?: number;
  startPage: number;
  endPage: number;
  startJuz: number;
  endJuz: number;
  answerMode: QuestionDraft['answerMode'];
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  notes?: string;
  questionFormat?: 'continuation' | 'full_page';
  pageNumber?: number | null;
  status: 'draft' | 'active' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  syncStatus?: 'saved' | 'pending' | 'failed';
  syncError?: string | null;
}

export interface QuestionBankMetadataInput {
  examType: 'generic' | 'uts' | 'uas';
  questionType: 'random' | 'mandatory';
  questionFormat?: 'continuation' | 'full_page';
  pageNumber?: number | null;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  notes?: string;
  status: 'draft' | 'active' | 'archived';
}

export interface QuestionBankFilter {
  search?: string;
  questionType?: 'all' | 'random' | 'mandatory';
  examType?: 'all' | 'generic' | 'uts' | 'uas';
  juz?: number | 'all';
  surah?: number | 'all';
  difficulty?: 'all' | 'easy' | 'medium' | 'hard';
  status?: 'active' | 'draft' | 'archived' | 'all';
  tag?: string;
}

// ============================================================
// QUICK BANK SOAL GENERATOR TYPES
// ============================================================

export interface QuickGeneratorOptions {
  materialType?: 'juz' | 'surah' | 'page'; // Mode materi: Juz (default), Surat, atau Range Halaman
  juz: number; // 1 - 30 (jika materialType === 'juz')
  surahNumber?: number; // 1 - 114 (jika materialType === 'surah')
  startPage?: number; // 1 - 604 (jika materialType === 'page')
  endPage?: number; // 1 - 604 (jika materialType === 'page')
  count: number; // Jumlah kandidat yang diminta (1, 5, 10, 20, 50, custom)
  questionType: 'continuation'; // Sambung Ayat
  difficulty: 'mixed' | 'easy' | 'medium' | 'hard';
  spreadEvenly: boolean; // Sebarkan soal secara merata
  avoidExisting: boolean; // Hindari soal yang sudah ada di Bank Soal
  avoidNearDistance: boolean; // Hindari titik yang terlalu berdekatan (<= 2 ayat)
}

export interface QuickQuestionCandidate {
  id: string;
  surahNumber: number;
  surahName: string;
  ayahNumber: number;
  pageNumber: number;
  juzNumber: number;
  promptStart: QuranPosition;
  promptEnd: QuranPosition;
  answerStart: QuranPosition;
  answerEnd: QuranPosition;
  promptText: string;
  answerText: string;
  totalExpectedWords: number;
  difficulty: 'easy' | 'medium' | 'hard';
  answerMode: 'end_ayah' | '3_lines' | '5_lines' | 'specific_ayah' | 'manual';
  selected: boolean;
  status: 'draft' | 'active';
}

export interface BulkSaveCandidatesResult {
  success: boolean;
  savedCount: number;
  skippedCount: number;
  savedIds?: string[];
  rejectedItems?: { index: number; reason: string }[];
  message?: string;
}

// ============================================================
// PDF BANK SOAL IMPORTER TYPES
// ============================================================

export interface PdfImportCandidate {
  id: string;
  packageNumber: number;
  questionNumber: number; // 1, 2, 3, 4
  pageIndex: number; // 1-indexed PDF page
  detectedCategory: string; // e.g. "Juz 30"
  detectedJuz?: number;
  startJuz?: number;
  endJuz?: number;
  surahNumber: number;
  surahName: string;
  ayahStart: number;
  ayahEnd: number;
  totalAyahsDetected: number;
  detectedAyahNumbers: number[];
  promptStart: QuranPosition;
  promptEnd: QuranPosition;
  answerStart: QuranPosition;
  answerEnd: QuranPosition;
  promptText: string;
  answerText: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceReason?: string;
  selected: boolean;
  status: 'draft' | 'active';
  difficulty?: 'easy' | 'medium' | 'hard';
  // PDF Crop Coordinates for Admin Visual Verification
  cropRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PdfAnalysisSummary {
  fileName: string;
  fileSize: number;
  totalPages: number;
  totalPackages: number;
  totalCandidates: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  detectedJuz?: number;
}


// ============================================================
// TAHAP 4: EVALUASI TAHFIZ (SEMESTER, PERIODE UTS/UAS & MATERI)
// ============================================================

export interface AcademicTerm {
  id: string;
  academicYear: string; // e.g. '2026/2027'
  semester: 'ganjil' | 'genap';
  startDate: string;
  endDate: string;
  status: 'draft' | 'active' | 'completed';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamPeriod {
  id: string;
  academicTermId: string;
  name: string; // e.g. 'UTS Tahfiz Semester Ganjil 2026/2027'
  examType: 'uts' | 'uas';
  materialCutoffDate: string;
  examStartDate?: string | null;
  examEndDate?: string | null;
  kkm: number;
  targetClasses: string[];
  targetHalaqahs: string[];
  status: 'draft' | 'preparation' | 'active' | 'completed';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamParticipant {
  id: string;
  examPeriodId: string;
  studentId: string;
  studentName: string;
  class: string;
  halaqah: string;
  teacherId?: string | null;
  status: 'registered' | 'exempt' | 'completed';
}

export type MemorizationDirection = 'forward' | 'backward' | 'single_surah' | 'unknown';
export type MaterialSnapshotStatus = 'not_ready' | 'needs_review' | 'ready' | 'finalized';

export interface ExamMaterialSnapshot {
  id: string;
  examPeriodId: string;
  studentId: string;
  sourceType: 'automatic' | 'manual_override';
  startSurah: number;
  startAyah: number;
  endSurah: number;
  endAyah: number;
  startPage?: number;
  endPage?: number;
  startJuz?: number;
  endJuz?: number;
  estimatedPages: number;
  startSurahName?: string;
  endSurahName?: string;
  firstRecordDate?: string | null;
  lastRecordDate?: string | null;
  totalRecordsAnalyzed: number;
  memorizationDirection: MemorizationDirection;
  status: MaterialSnapshotStatus;
  reviewReason?: string | null;
  overrideReason?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  finalizedBy?: string | null;
  finalizedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExamAuditLog {
  id: string;
  examPeriodId?: string;
  studentId?: string;
  action: string;
  actorId: string;
  beforeData?: any;
  afterData?: any;
  reason?: string;
  createdAt: string;
}

export interface TahfizEvaluationData {
  period: ExamPeriod;
  academicTerm: AcademicTerm;
  participants: ExamParticipant[];
  materialSnapshots: ExamMaterialSnapshot[];
  auditLogs: ExamAuditLog[];
}

// ============================================================
// TAHAP 5A: GENERATOR SOAL UTS TAHFIZ (5 ZONA MATERI)
// ============================================================

export type QuestionSetStatus = 'generated' | 'locked' | 'void' | 'stale';
export type UTSGenerationStrategy = 'hybrid' | 'bank_only' | 'auto_only';
export type QuestionSourceType = 'bank' | 'auto';

export interface ExamQuestionSet {
  id: string;
  examPeriodId: string;
  studentId: string;
  materialSnapshotId: string;
  version: number;
  generationStrategy: UTSGenerationStrategy;
  generationSeed: string;
  materialFingerprint: string;
  status: QuestionSetStatus;
  generatedBy?: string | null;
  generatedAt: string;
  lockedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  questions?: ExamQuestion[];
}

export interface ExamQuestion {
  id: string;
  questionSetId: string;
  questionNumber: number; // 1 to 9 (1-5 for UTS, 1-9 for UAS)
  zoneNumber?: number | null; // 1 to 7 for random, null for mandatory
  questionRole?: 'mandatory' | 'random';
  sourceType: QuestionSourceType;
  questionBankId?: string | null;
  pageNumber?: number | null;
  maxScore?: number; // 20 for UTS, 15 for UAS mandatory, 10 for UAS random

  // Koordinat A (Awal Prompt - nullable for mandatory full-page)
  promptStartSurah?: number | null;
  promptStartAyah?: number | null;
  promptStartWord?: number | null;

  // Koordinat A' (Akhir Prompt - nullable for mandatory full-page)
  promptEndSurah?: number | null;
  promptEndAyah?: number | null;
  promptEndWord?: number | null;

  // Koordinat B (Titik Mulai Sambung Ayat / Awal Halaman Wajib)
  answerStartSurah: number;
  answerStartAyah: number;
  answerStartWord: number;

  // Koordinat C (Batas Akhir Jawaban Santri / Akhir Halaman Wajib)
  answerEndSurah: number;
  answerEndAyah: number;
  answerEndWord: number;

  startPage?: number | null;
  endPage?: number | null;

  generatedMetadata?: {
    surahName?: string;
    endSurahName?: string;
    totalExpectedWords?: number;
    answerMode?: string;
    clampedStart?: boolean;
    clampedEnd?: boolean;
    difficulty?: string;
    notes?: string;
    isFullPage?: boolean;
    pageNumber?: number;
    fallbackMandatoryOverlap?: boolean;
  } | null;
  createdAt: string;
}

export interface MaterialPathNode {
  surahNumber: number;
  ayahNumber: number;
  pedagogicalIndex: number;
  pageNumber: number;
  surahName: string;
}

export interface MaterialPath {
  nodes: MaterialPathNode[];
  direction: MemorizationDirection;
  startSurah: number;
  startAyah: number;
  endSurah: number;
  endAyah: number;
  totalAyahs: number;
}

export interface MaterialZone {
  zoneNumber: number; // 1..5
  startIndex: number;
  endIndex: number;
  nodes: MaterialPathNode[];
  label: string;
}

export interface GeneratedUTSQuestion {
  questionNumber: number;
  zoneNumber: number;
  sourceType: QuestionSourceType;
  questionBankId?: string | null;
  promptStart: QuranPosition;
  promptEnd: QuranPosition;
  answerStart: QuranPosition;
  answerEnd: QuranPosition;
  startPage: number;
  endPage: number;
  metadata?: Record<string, any>;
  promptTextPreview?: string;
  answerTextPreview?: string;
}

export interface GeneratedUTSQuestionSet {
  questionSet: ExamQuestionSet;
  questions: ExamQuestion[];
}

// ============================================================
// TAHAP 6A: ENGINE GENERATOR SOAL UAS TAHFIZ (9 SOAL)
// ============================================================

export type UASQuestionRole = 'mandatory' | 'random';
export type UASGenerationStrategy = 'hybrid' | 'bank_only' | 'auto_only';

export interface GeneratedUASQuestion {
  questionNumber: number; // 1 to 9 (1-2 mandatory, 3-9 random)
  questionRole: UASQuestionRole;
  zoneNumber?: number | null; // 1 to 7 for random, null for mandatory
  sourceType: QuestionSourceType;
  questionBankId?: string | null;
  pageNumber?: number | null;
  maxScore: number; // 15 for mandatory, 10 for random

  // Prompt penguji (sambung ayat untuk random; nullable untuk mandatory full-page)
  promptStart?: QuranPosition | null;
  promptEnd?: QuranPosition | null;

  // Acuan jawaban santri (B..C untuk random; awal..akhir halaman untuk mandatory)
  answerStart: QuranPosition;
  answerEnd: QuranPosition;

  startPage: number;
  endPage: number;
  metadata?: Record<string, any>;
  promptTextPreview?: string;
  answerTextPreview?: string;
}

export interface GeneratedUASQuestionSet {
  questionSet: ExamQuestionSet;
  questions: ExamQuestion[];
}

// ============================================================
// TAHAP 5B: PELAKSANAAN & PENILAIAN UTS TAHFIZ
// ============================================================

export type ExaminerAssignmentStatus = 'assigned' | 'completed';
export type ExamAttemptStatus = 'in_progress' | 'submitted' | 'void';

export interface ExamExaminerAssignment {
  id: string;
  examPeriodId: string;
  studentId: string;
  examinerUserId: string;
  examinerName?: string;
  assignedBy?: string;
  assignedAt: string;
  status: ExaminerAssignmentStatus;
  createdAt?: string;
  updatedAt?: string;
}

export type FluencyEventType = 'self_correction' | 'reminder' | 'prompt' | 'unable';
export type TajwidEventType = 'minor' | 'major';
export type MakhrajEventType = 'minor' | 'major';

export interface UTSAssessmentEvent {
  id: string;
  type: FluencyEventType | TajwidEventType | MakhrajEventType;
  label: string;
  deduction: number;
  timestamp: number;
}

export interface ExamQuestionAssessment {
  id: string;
  examAttemptId: string;
  examQuestionId: string;
  questionNumber: number; // 1 to 5
  fluencyScore: number; // 0 to 12
  tajwidScore: number; // 0 to 4
  makhrajScore: number; // 0 to 4
  fluencyEvents: UTSAssessmentEvent[];
  tajwidEvents: UTSAssessmentEvent[];
  makhrajEvents: UTSAssessmentEvent[];
  questionScore: number; // 0 to 20
  notes?: string;
  startedAt?: string;
  completedAt?: string | null;
  version?: number;
  updatedAt?: string;
}

export interface ExamAttempt {
  id: string;
  examPeriodId: string;
  studentId: string;
  studentName?: string;
  class?: string;
  questionSetId: string;
  examinerUserId: string;
  attemptNumber: number;
  status: ExamAttemptStatus;
  startedAt: string;
  lastSavedAt: string;
  submittedAt?: string | null;
  totalScore: number; // 0 to 100
  createdAt?: string;
  updatedAt?: string;
}

export interface ExaminerStudentItem {
  studentId: string;
  studentName: string;
  studentNis: string;
  class: string;
  halaqah: string;
  teacherId: string;
  teacherName?: string;
  examinerId?: string;
  examinerName?: string;
  hasAssignment: boolean;
  snapshotId?: string;
  snapshotStatus?: string;
  startSurahName?: string;
  startAyah?: number;
  endSurahName?: string;
  endAyah?: number;
  memorizationDirection?: string;
  questionSetId?: string;
  questionSetStatus?: string;
  isStale?: boolean;
  attemptId?: string;
  attemptStatus?: ExamAttemptStatus;
  attemptNumber?: number;
  totalScore?: number;
  startedAt?: string;
  submittedAt?: string;
  completedQuestionsCount?: number;
}

export interface UTSScoringConfig {
  maxFluency: number; // 12
  maxTajwid: number; // 4
  maxMakhraj: number; // 4
  maxQuestionScore: number; // 20
  totalQuestions: number; // 5
  maxTotalScore: number; // 100
}

export type UASAssessmentEvent = UTSAssessmentEvent;
export type ExamAssessmentEvent = UTSAssessmentEvent;

export interface UASScoringConfig {
  mandatory: {
    maxFluency: number; // 9
    maxTajwid: number; // 3
    maxMakhraj: number; // 3
    maxQuestionScore: number; // 15
  };
  random: {
    maxFluency: number; // 6
    maxTajwid: number; // 2
    maxMakhraj: number; // 2
    maxQuestionScore: number; // 10
  };
  totalQuestions: number; // 9
  mandatoryQuestionsCount: number; // 2
  randomQuestionsCount: number; // 7
  maxTotalScore: number; // 100
}

// ============================================================
// TAHAP 7A: REKAP NILAI & REMEDIAL ELIGIBILITY ENGINE
// ============================================================

export type ComponentExamStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'TUNTAS' | 'PERLU_REMEDIAL';
export type SemesterRecapStatus = 'INCOMPLETE' | 'TUNTAS' | 'PERLU_REMEDIAL';

export interface SemesterEvaluationConfig {
  id: string;
  academicTermId: string;
  academicYear?: string;
  semester?: 'ganjil' | 'genap';
  name: string;
  utsPeriodId: string;
  utsPeriodName?: string;
  utsKkm?: number;
  uasPeriodId: string;
  uasPeriodName?: string;
  uasKkm?: number;
  utsWeight: number; // default 40
  uasWeight: number; // default 60
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SemesterExamComponent {
  periodId: string;
  attemptId?: string | null;
  originalScore: number | null;
  kkm: number;
  status: ComponentExamStatus;
  remedialEligible: boolean;
  materialSnapshotId?: string;
}

export interface SemesterContribution {
  utsWeight: number;
  uasWeight: number;
  utsContribution: number | null;
  uasContribution: number | null;
  score: number | null;
  status: SemesterRecapStatus;
}

export interface SemesterStudentRecap {
  studentId: string;
  studentName: string;
  studentNis?: string;
  className: string;
  halaqah: string;
  uts: SemesterExamComponent;
  uas: SemesterExamComponent;
  semester: SemesterContribution;
}

export interface SemesterRecapSummary {
  totalStudents: number;
  tuntasCount: number;
  perluRemedialCount: number;
  incompleteCount: number;
  utsRemedialCount: number;
  uasRemedialCount: number;
  belumUtsCount: number;
  belumUasCount: number;
}

export interface SemesterRemedialCandidate {
  studentId: string;
  studentName: string;
  className: string;
  halaqah: string;
  examPeriodId: string;
  examType: 'uts' | 'uas';
  originalAttemptId: string;
  originalQuestionSetId: string;
  originalScore: number;
  kkm: number;
  materialSnapshotId: string;
  eligibilityReason: 'ORIGINAL_SCORE_BELOW_KKM';
}

export interface SemesterRecapResponse {
  success: boolean;
  message?: string;
  config?: {
    academicTermId: string;
    academicYear: string;
    semester: string;
    configName: string;
    utsPeriodId: string;
    utsPeriodName: string;
    utsKkm: number;
    utsWeight: number;
    uasPeriodId: string;
    uasPeriodName: string;
    uasKkm: number;
    uasWeight: number;
  };
  summary?: SemesterRecapSummary;
  recap?: SemesterStudentRecap[];
  remedialCandidates?: SemesterRemedialCandidate[];
}

// ============================================================
// TAHAP 7B: REMEDIAL GENERATOR ENGINE TYPES
// ============================================================
export type RemedialSessionStatus = 'eligible' | 'generating' | 'generated' | 'locked' | 'stale' | 'invalid';

export interface ExamRemedialSession {
  id: string;
  originalExamPeriodId: string;
  studentId: string;
  examType: 'uts' | 'uas';
  originalAttemptId: string;
  originalQuestionSetId: string;
  materialSnapshotId: string;
  remedialQuestionSetId?: string | null;
  examinerUserId?: string | null;
  assignedBy?: string | null;
  assignedAt?: string | null;
  status: RemedialSessionStatus;
  generationVersion: number;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExamRemedialQuestionSet {
  id: string;
  remedialSessionId: string;
  originalExamPeriodId: string;
  studentId: string;
  examType: 'uts' | 'uas';
  materialSnapshotId: string;
  version: number;
  generationStrategy: string;
  generationSeed: string;
  materialFingerprint: string;
  status: 'generated' | 'locked' | 'void' | 'stale';
  generatedBy?: string | null;
  generatedAt: string;
  lockedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  questions?: ExamRemedialQuestion[];
}

export interface ExamRemedialQuestion {
  id: string;
  remedialQuestionSetId: string;
  questionNumber: number;
  zoneNumber?: number | null;
  questionRole: 'mandatory' | 'random';
  sourceType: 'bank' | 'auto';
  questionBankId?: string | null;
  pageNumber?: number | null;
  maxScore: number;
  promptStartSurah?: number | null;
  promptStartAyah?: number | null;
  promptStartWord?: number | null;
  promptEndSurah?: number | null;
  promptEndAyah?: number | null;
  promptEndWord?: number | null;
  answerStartSurah: number;
  answerStartAyah: number;
  answerStartWord: number;
  answerEndSurah: number;
  answerEndAyah: number;
  answerEndWord: number;
  startPage?: number | null;
  endPage?: number | null;
  generatedMetadata?: Record<string, any>;
  createdAt: string;
}

export interface RemedialCandidateItem {
  studentId: string;
  studentName: string;
  studentNis: string;
  className: string;
  halaqah: string;
  examType: 'uts' | 'uas';
  originalPeriodId: string;
  originalPeriodName: string;
  originalAttemptId: string;
  originalQuestionSetId: string;
  originalScore: number;
  kkm: number;
  materialSnapshotId: string;
  remedialSessionId?: string | null;
  generationStatus: RemedialSessionStatus;
  remedialQuestionSetId?: string | null;
  remedialVersion?: number;
  isPackageReady: boolean;
  questionCount?: number;
}

export interface RemedialCandidatesResponse {
  success: boolean;
  message?: string;
  summary?: {
    totalCandidates: number;
    readyCount: number;
    pendingCount: number;
  };
  candidates?: RemedialCandidateItem[];
}

export interface RemedialGenerationResponse {
  success: boolean;
  isExisting?: boolean;
  message?: string;
  remedialSession?: ExamRemedialSession;
  questionSet?: ExamRemedialQuestionSet;
  questions?: ExamRemedialQuestion[];
}

export interface RemedialDetailResponse {
  success: boolean;
  message?: string;
  remedialSession?: ExamRemedialSession;
  student?: {
    id: string;
    name: string;
    nis: string;
    class: string;
    halaqah: string;
  };
  originalExam?: {
    periodId: string;
    periodName: string;
    examType: string;
    kkm: number;
    attemptId: string;
    questionSetId: string;
    score: number;
    submittedAt: string;
  };
  questionSet?: ExamRemedialQuestionSet;
  questions?: ExamRemedialQuestion[];
}

export interface ExamRemedialExaminerAssignment {
  id: string;
  remedialSessionId: string;
  examinerUserId: string;
  assignedBy?: string | null;
  assignedAt: string;
  reassignReason?: string | null;
  status: 'assigned' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export interface ExamRemedialAttempt {
  id: string;
  remedialSessionId: string;
  remedialQuestionSetId: string;
  examinerUserId: string;
  attemptNumber: number;
  status: 'in_progress' | 'submitted' | 'reopened' | 'void';
  startedAt: string;
  lastSavedAt: string;
  submittedAt?: string | null;
  totalScore?: number | null;
  reopenedAt?: string | null;
  reopenedBy?: string | null;
  reopenReason?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExamRemedialQuestionAssessment {
  id: string;
  remedialAttemptId: string;
  remedialQuestionId: string;
  questionNumber: number;
  fluencyScore: number;
  tajwidScore: number;
  makhrajScore: number;
  fluencyEvents: any[];
  tajwidEvents: any[];
  makhrajEvents: any[];
  questionScore: number;
  notes?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RemedialExaminerStudentItem {
  remedialSessionId: string;
  examPeriodId: string;
  periodName: string;
  periodExamType: string;
  examType: 'uts' | 'uas';
  kkm: number;
  studentId: string;
  studentName: string;
  nis: string;
  className?: string;
  examinerId: string;
  examinerName?: string;
  sessionStatus: string;
  remedialQuestionSetId: string;
  questionSetStatus: string;
  materialFingerprint: string;
  originalAttemptId: string;
  originalScore: number;
  remedialAttemptId?: string | null;
  remedialAttemptStatus?: string | null;
  remedialScore?: number | null;
  remedialStartedAt?: string | null;
  remedialSubmittedAt?: string | null;
  effectiveScore: number;
  derivedStatus: string;
  questionCount: number;
  completedQuestionCount: number;
}

export interface StartRemedialResponse {
  success: boolean;
  message?: string;
  attempt?: ExamRemedialAttempt & { examType: 'uts' | 'uas'; kkm: number };
  questions?: ExamRemedialQuestion[];
  assessments?: ExamRemedialQuestionAssessment[];
}

export interface SaveRemedialAssessmentResponse {
  success: boolean;
  isConflict?: boolean;
  currentVersion?: number;
  isStale?: boolean;
  message?: string;
  assessment?: Partial<ExamRemedialQuestionAssessment>;
}

export interface SubmitRemedialResponse {
  success: boolean;
  isExisting?: boolean;
  isStale?: boolean;
  message?: string;
  totalScore?: number;
  submittedAt?: string;
  kkm?: number;
  isPassed?: boolean;
  effectiveScore?: number;
}

// ============================================================
// TAHAP 7D: REKAP FINAL, MONITORING & EXPORT
// ============================================================

export type FinalComponentStatus = 
  | 'BELUM_UJIAN'
  | 'TUNTAS'
  | 'PERLU_REMEDIAL'
  | 'REMEDIAL_DIJADWALKAN'
  | 'SEDANG_REMEDIAL'
  | 'TUNTAS_MELALUI_REMEDIAL'
  | 'BELUM_TUNTAS_SETELAH_REMEDIAL';

export type FinalSemesterStatus = 
  | 'BELUM_LENGKAP'
  | 'PERLU_REMEDIAL'
  | 'SEDANG_REMEDIAL'
  | 'BELUM_TUNTAS_SETELAH_REMEDIAL'
  | 'TUNTAS';

export type EffectiveScoreSource = 'ORIGINAL' | 'REMEDIAL' | 'NONE';

export interface FinalSemesterRecapItem {
  studentId: string;
  nis: string;
  studentName: string;
  class: string;
  halaqah: string;

  academicTermId: string;
  academicTermName: string;

  utsPeriodId: string;
  utsPeriodName: string;
  utsKkm: number;
  utsOriginalAttemptId: string | null;
  utsOriginalScore: number | null;
  utsOriginalSubmittedAt: string | null;
  utsOriginalExaminerName: string | null;

  utsRemedialSessionId: string | null;
  utsRemedialAttemptId: string | null;
  utsRemedialScore: number | null;
  utsRemedialSubmittedAt: string | null;
  utsRemedialExaminerName: string | null;

  utsEffectiveScore: number | null;
  utsEffectiveSource: EffectiveScoreSource;
  utsStatus: FinalComponentStatus;

  uasPeriodId: string;
  uasPeriodName: string;
  uasKkm: number;
  uasOriginalAttemptId: string | null;
  uasOriginalScore: number | null;
  uasOriginalSubmittedAt: string | null;
  uasOriginalExaminerName: string | null;

  uasRemedialSessionId: string | null;
  uasRemedialAttemptId: string | null;
  uasRemedialScore: number | null;
  uasRemedialSubmittedAt: string | null;
  uasRemedialExaminerName: string | null;

  uasEffectiveScore: number | null;
  uasEffectiveSource: EffectiveScoreSource;
  uasStatus: FinalComponentStatus;

  utsWeight: number;
  uasWeight: number;

  semesterFinalScore: number | null;
  semesterStatus: FinalSemesterStatus;

  hasRemedial: boolean;
  hasActiveRemedial: boolean;
}

export interface FinalSemesterMonitoringStats {
  totalStudents: number;
  tuntasCount: number;
  perluRemedialCount: number;
  sedangRemedialCount: number;
  tuntasViaRemedialCount: number;
  belumTuntasSetelahRemedialCount: number;
  belumLengkapCount: number;

  utsNotStartedCount: number;
  utsInProgressCount: number;
  utsSubmittedCount: number;

  uasNotStartedCount: number;
  uasInProgressCount: number;
  uasSubmittedCount: number;

  remedialNeedsCount: number;
  remedialScheduledCount: number;
  remedialInProgressCount: number;
  remedialSubmittedCount: number;
  remedialBelowKkmCount: number;
}

export interface FinalSemesterRecapResponse {
  success: boolean;
  errorType?: string;
  message?: string;
  config?: {
    id: string;
    name: string;
    academicTermId: string;
    academicYear: string;
    semester: string;
    utsPeriodId: string;
    utsPeriodName: string;
    utsKkm: number;
    uasPeriodId: string;
    uasPeriodName: string;
    uasKkm: number;
    utsWeight: number;
    uasWeight: number;
  };
  summary?: FinalSemesterMonitoringStats;
  recap?: FinalSemesterRecapItem[];
}

export interface FinalSemesterMonitoringResponse {
  success: boolean;
  errorType?: string;
  message?: string;
  config?: any;
  summary?: FinalSemesterMonitoringStats;
}

export interface EvaluationTimelineEvent {
  id: string;
  action: string;
  actionLabel: string;
  actorId: string;
  actorName: string;
  actorRole?: string;
  reason?: string;
  beforeData?: any;
  afterData?: any;
  createdAt: string;
}

export interface StudentEvaluationHistoryResponse {
  success: boolean;
  message?: string;
  student?: {
    id: string;
    name: string;
    nis: string;
    class: string;
    halaqah: string;
  };
  config?: any;
  recap?: FinalSemesterRecapItem;
  timeline?: EvaluationTimelineEvent[];
}