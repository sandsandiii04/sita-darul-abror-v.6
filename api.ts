import { createClient } from '@supabase/supabase-js';
import { User, Student, TahfidzRecord, Attendance, Exam, AttendanceOpenRequest, QuestionBankItem, QuestionBankFilter, AcademicTerm, ExamPeriod, ExamParticipant, ExamMaterialSnapshot, ExamAuditLog, TahfizEvaluationData, ExamQuestionSet, ExamQuestion, UTSGenerationStrategy, ExamExaminerAssignment, ExamAttempt, ExamQuestionAssessment, ExaminerStudentItem, UTSAssessmentEvent, UASAssessmentEvent, GeneratedUASQuestion, UASGenerationStrategy, SemesterEvaluationConfig, SemesterRecapResponse, SemesterStudentRecap, SemesterRemedialCandidate, SemesterRecapSummary, ExamRemedialSession, ExamRemedialQuestionSet, ExamRemedialQuestion, RemedialCandidateItem, RemedialCandidatesResponse, RemedialGenerationResponse, RemedialDetailResponse, ExamRemedialAttempt, ExamRemedialQuestionAssessment, RemedialExaminerStudentItem, StartRemedialResponse, SaveRemedialAssessmentResponse, SubmitRemedialResponse, FinalSemesterRecapResponse, FinalSemesterMonitoringResponse, StudentEvaluationHistoryResponse, QuickQuestionCandidate, BulkSaveCandidatesResult } from './types';
import { MOCK_USERS, MOCK_STUDENTS } from './constants';
import { calculateFluencyScore, calculateTajwidScore, calculateMakhrajScore, calculateQuestionScore, calculateAttemptTotalScore } from './services/utsScoringService';
import { calculateUASFluencyScore, calculateUASTajwidScore, calculateUASMakhrajScore, calculateUASQuestionScore, calculateUASAttemptTotalScore, isMandatoryQuestion, UAS_SCORING_CONFIG } from './services/uasScoringService';

export type ActionType = 'addUser' | 'addStudent' | 'addRecord' | 'addExam' | 'markAttendance' | 'updateUser' | 'deleteData' | 'addAttendanceOpenRequest';

export interface QueueItem {
  id: string;
  action: ActionType;
  data: any;
  timestamp: number;
  error?: string;
}

// 1. Inisialisasi Supabase Client
let supabaseUrl = '';
let supabaseAnonKey = '';

if (typeof window !== 'undefined') {
  supabaseUrl = window.localStorage.getItem('sita_supabase_url') || '';
  supabaseAnonKey = window.localStorage.getItem('sita_supabase_anon_key') || '';
}

if (!supabaseUrl) {
  supabaseUrl = (import.meta as any)?.env?.VITE_SUPABASE_URL || '';
}
if (!supabaseAnonKey) {
  supabaseAnonKey = (import.meta as any)?.env?.VITE_SUPABASE_ANON_KEY || '';
}

// Default fallback credentials from project's .env file
const DEFAULT_SUPABASE_URL = 'https://sxcgiznhnvyhozghloik.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_gUTuV06xBXIXNYBgH3IyPw_u6DiKMS_';

if (!supabaseUrl || supabaseUrl === 'undefined' || supabaseUrl === 'null') {
  supabaseUrl = DEFAULT_SUPABASE_URL;
}
if (!supabaseAnonKey || supabaseAnonKey === 'undefined' || supabaseAnonKey === 'null') {
  supabaseAnonKey = DEFAULT_SUPABASE_ANON_KEY;
}

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;


// Helper: Bersihkan ID dari format "id | nama" menjadi "id"
const cleanId = (id: any): string => {
  if (id === null || id === undefined) return '';
  return id.toString().split(' | ')[0].trim();
};

// Helper: Enkripsi dan Dekripsi string untuk mengamankan No HP dari pencurian data/db leak
const SECRET_KEY = "SITA_DARUL_ABROR_SECURE_PHONE_KEY";

const encryptPhone = (phone: string): string => {
  if (!phone) return '';
  let xorResult = '';
  for (let i = 0; i < phone.length; i++) {
    const charCode = phone.charCodeAt(i) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length);
    xorResult += String.fromCharCode(charCode);
  }
  return 'ENC_' + btoa(unescape(encodeURIComponent(xorResult)));
};

const decryptPhone = (encodedPhone: string): string => {
  if (!encodedPhone) return '';
  if (!encodedPhone.startsWith('ENC_')) return encodedPhone; // Fallback jika data lama belum terenkripsi
  try {
    const cleanBase64 = encodedPhone.substring(4);
    const xorResult = decodeURIComponent(escape(atob(cleanBase64)));
    let phone = '';
    for (let i = 0; i < xorResult.length; i++) {
      const charCode = xorResult.charCodeAt(i) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length);
      phone += String.fromCharCode(charCode);
    }
    return phone;
  } catch (e) {
    return encodedPhone; // Fallback jika terjadi error dekripsi
  }
};

// 2. Mapping Helper (Database snake_case <=> Frontend camelCase)
const mapUserFromDb = (row: any): User => ({
  id: row.id,
  name: row.name,
  role: row.role,
  username: row.username,
  password: row.password,
  phoneNumber: decryptPhone(row.phone_number),
  childId: row.child_id,
  email: row.email,
  avatar: row.avatar,
  gender: row.gender
});

const mapUserToDb = (model: User): any => ({
  id: model.id,
  name: model.name,
  role: model.role,
  username: model.username,
  password: model.password,
  phone_number: model.phoneNumber ? encryptPhone(model.phoneNumber) : null,
  child_id: model.childId || null,
  email: model.email || null,
  avatar: model.avatar || null,
  gender: model.gender || null
});

const mapStudentFromDb = (row: any): Student => ({
  id: row.id,
  name: row.name,
  nis: row.nis,
  class: row.class,
  halaqah: row.halaqah,
  teacherId: row.teacher_id,
  totalJuz: parseFloat(row.total_juz) || 0,
  username: row.username,
  password: row.password
});

const mapStudentToDb = (model: Student): any => ({
  id: model.id,
  name: model.name,
  nis: model.nis,
  class: model.class,
  halaqah: model.halaqah,
  teacher_id: cleanId(model.teacherId) || null,
  total_juz: model.totalJuz || 0,
  username: model.username || model.nis,
  password: model.password || model.nis || '123'
});

const mapRecordFromDb = (row: any): TahfidzRecord => ({
  id: row.id,
  studentId: row.student_id,
  date: row.date,
  type: row.type,
  surah: row.surah,
  ayahStart: row.ayah_start,
  ayahEnd: row.ayah_end,
  grade: row.grade,
  notes: row.notes,
  class: row.class
});

const mapRecordToDb = (model: TahfidzRecord): any => ({
  id: model.id,
  student_id: cleanId(model.studentId),
  date: model.date,
  type: model.type,
  surah: model.surah,
  ayah_start: model.ayahStart || 0,
  ayah_end: model.ayahEnd || 0,
  grade: model.grade,
  notes: model.notes || null,
  class: model.class || null
});

const mapAttendanceFromDb = (row: any): Attendance => ({
  id: row.id,
  userId: row.user_id,
  date: row.date,
  session: row.session,
  status: row.status,
  approvalStatus: row.approval_status,
  type: row.type,
  class: row.class,
  lateReason: row.late_reason
});

const mapAttendanceToDb = (model: Attendance): any => ({
  id: model.id,
  user_id: cleanId(model.userId),
  date: model.date,
  session: model.session,
  status: model.status,
  approval_status: model.approvalStatus || null,
  type: model.type,
  class: model.class || null,
  late_reason: model.lateReason || null,
  qr_token: model.qrToken || null
});

const mapAttendanceOpenRequestFromDb = (row: any): AttendanceOpenRequest => ({
  id: row.id,
  teacherId: row.teacher_id,
  date: row.date,
  session: row.session,
  type: row.type,
  status: row.status,
  lateReason: row.late_reason,
  createdAt: row.created_at
});

const mapAttendanceOpenRequestToDb = (model: AttendanceOpenRequest): any => ({
  id: model.id,
  teacher_id: cleanId(model.teacherId),
  date: model.date,
  session: model.session,
  type: model.type,
  status: model.status,
  late_reason: model.lateReason
});

const mapExamFromDb = (row: any): Exam => ({
  id: row.id,
  studentId: row.student_id,
  date: row.date,
  category: row.category,
  score: parseFloat(row.score) || 0,
  examiner: row.examiner,
  status: row.status,
  notes: row.notes,
  juz: row.juz,
  class: row.class,
  details: row.details
});

const mapExamToDb = (model: Exam): any => ({
  id: model.id,
  student_id: cleanId(model.studentId),
  date: model.date,
  category: model.category,
  score: model.score,
  examiner: model.examiner,
  status: model.status,
  notes: model.notes || null,
  juz: model.juz || null,
  class: model.class || null,
  details: model.details || null
});

export const mapQuestionBankToDb = (model: QuestionBankItem): any => ({
  id: model.id,
  exam_type: model.examType,
  question_type: model.questionType,
  prompt_start: {
    surah: model.promptStart.surahNumber,
    ayah: model.promptStart.ayahNumber,
    word: model.promptStart.wordPosition
  },
  prompt_end: {
    surah: model.promptEnd.surahNumber,
    ayah: model.promptEnd.ayahNumber,
    word: model.promptEnd.wordPosition
  },
  answer_start: {
    surah: model.answerStart.surahNumber,
    ayah: model.answerStart.ayahNumber,
    word: model.answerStart.wordPosition
  },
  answer_end: {
    surah: model.answerEnd.surahNumber,
    ayah: model.answerEnd.ayahNumber,
    word: model.answerEnd.wordPosition
  },
  prompt_start_surah: model.promptStart.surahNumber,
  prompt_start_ayah: model.promptStart.ayahNumber,
  prompt_start_word: model.promptStart.wordPosition,
  prompt_end_surah: model.promptEnd.surahNumber,
  prompt_end_ayah: model.promptEnd.ayahNumber,
  prompt_end_word: model.promptEnd.wordPosition,
  answer_start_surah: model.answerStart.surahNumber,
  answer_start_ayah: model.answerStart.ayahNumber,
  answer_start_word: model.answerStart.wordPosition,
  answer_end_surah: model.answerEnd.surahNumber,
  answer_end_ayah: model.answerEnd.ayahNumber,
  answer_end_word: model.answerEnd.wordPosition,
  prompt_start_page: model.promptStart.pageNumber,
  prompt_end_page: model.promptEnd.pageNumber,
  answer_start_page: model.answerStart.pageNumber,
  answer_end_page: model.answerEnd.pageNumber,
  start_page: model.startPage,
  end_page: model.endPage,
  start_juz: model.startJuz,
  end_juz: model.endJuz,
  prompt_text: model.promptText,
  answer_text: model.answerText,
  total_expected_words: model.totalExpectedWords || 0,
  answer_mode: model.answerMode,
  difficulty: model.difficulty,
  tags: model.tags,
  notes: model.notes || null,
  status: model.status,
  created_by: model.createdBy,
  updated_at: model.updatedAt,
  archived_at: model.archivedAt || null
});

export const mapQuestionBankFromDb = (row: any): QuestionBankItem => ({
  id: row.id,
  examType: row.exam_type || 'generic',
  questionType: row.question_type || 'random',
  promptStart: {
    surahNumber: row.prompt_start_surah,
    ayahNumber: row.prompt_start_ayah,
    wordPosition: row.prompt_start_word,
    pageNumber: row.prompt_start_page || row.start_page
  },
  promptEnd: {
    surahNumber: row.prompt_end_surah,
    ayahNumber: row.prompt_end_ayah,
    wordPosition: row.prompt_end_word,
    pageNumber: row.prompt_end_page || row.start_page
  },
  answerStart: {
    surahNumber: row.answer_start_surah,
    ayahNumber: row.answer_start_ayah,
    wordPosition: row.answer_start_word,
    pageNumber: row.answer_start_page || (row.answer_start_surah === row.answer_end_surah ? row.end_page : row.end_page)
  },
  answerEnd: {
    surahNumber: row.answer_end_surah,
    ayahNumber: row.answer_end_ayah,
    wordPosition: row.answer_end_word,
    pageNumber: row.answer_end_page || row.end_page
  },
  promptText: row.prompt_text,
  answerText: row.answer_text,
  totalExpectedWords: row.total_expected_words || 0,
  startPage: row.start_page,
  endPage: row.end_page,
  startJuz: row.start_juz,
  endJuz: row.end_juz,
  answerMode: row.answer_mode || 'end_ayah',
  difficulty: row.difficulty || 'medium',
  tags: Array.isArray(row.tags) ? row.tags : typeof row.tags === 'string' ? JSON.parse(row.tags) : [],
  notes: row.notes || undefined,
  status: row.status || 'active',
  createdBy: row.created_by || 'admin',
  createdAt: row.created_at || new Date().toISOString(),
  updatedAt: row.updated_at || new Date().toISOString(),
  archivedAt: row.archived_at || null,
  syncStatus: 'saved',
  syncError: null
});

// Helper: Penunggu waktu (Delay)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let isProcessing = false;
let lastSyncError: string | null = null;
let queueChangeCallbacks: ((length: number, isSyncing: boolean, lastError: string | null, failedLength: number) => void)[] = [];

export const safeSetLocalStorage = (key: string, value: string): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (e: any) {
    console.warn(`[SITA safeSetLocalStorage] Gagal menyimpan key "${key}":`, e);
    if (e?.name === 'QuotaExceededError' || e?.code === 22 || e?.code === 1014) {
      try {
        // Bebaskan ruang memori lokal HP dengan menghapus cache berukuran besar
        window.localStorage.removeItem('sita_attendance_v1');
        window.localStorage.removeItem('sita_records_v1');
        window.localStorage.removeItem('sita_question_bank_cache_v2');
        window.localStorage.setItem(key, value);
        return true;
      } catch (retryErr) {
        console.warn(`[SITA safeSetLocalStorage] Retry simpan key "${key}" tetap gagal:`, retryErr);
      }
    }
    return false;
  }
};

export const safeGetLocalStorage = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
};

const getQueue = (): QueueItem[] => {
  try {
    const q = safeGetLocalStorage('sita_sync_queue_v2');
    return q ? JSON.parse(q) : [];
  } catch (e) {
    return [];
  }
};

const saveQueue = (queue: QueueItem[]) => {
  safeSetLocalStorage('sita_sync_queue_v2', JSON.stringify(queue));
  notifyCallbacks();
};

const getFailedQueue = (): QueueItem[] => {
  try {
    const q = safeGetLocalStorage('sita_failed_queue_v2');
    return q ? JSON.parse(q) : [];
  } catch (e) {
    return [];
  }
};

const saveFailedQueue = (queue: QueueItem[]) => {
  safeSetLocalStorage('sita_failed_queue_v2', JSON.stringify(queue));
  notifyCallbacks();
};

const notifyCallbacks = () => {
  const len = getQueue().length;
  const failedLen = getFailedQueue().length;
  queueChangeCallbacks.forEach(cb => cb(len, isProcessing, lastSyncError, failedLen));
};

function isTemporaryError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || String(error)).toLowerCase();
  if (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('connection') ||
    msg.includes('dns') ||
    msg.includes('offline') ||
    msg.includes('cors') ||
    msg.includes('abort') ||
    msg.includes('gateway') ||
    msg.includes('service unavailable') ||
    msg.includes('server error') ||
    msg.includes('internal server error') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('load failed') ||
    msg.includes('socket') ||
    msg.includes('econnreset') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  ) {
    return true;
  }
  const code = error.code || '';
  if (typeof code === 'string' && (code.startsWith('08') || code.startsWith('57') || code === '53300' || code === '53400')) {
    return true;
  }
  const status = error.status || error.statusCode;
  if (typeof status === 'number' && (status >= 500 || status === 429 || status === 408)) {
    return true;
  }
  return false;
}

let inMemoryUser: User | null = null;

export const setSessionUser = (u: User | null) => {
  inMemoryUser = u;
  if (typeof window !== 'undefined') {
    if (u) {
      safeSetLocalStorage('sita_current_user_v1', JSON.stringify(u));
    } else {
      try {
        window.localStorage.removeItem('sita_current_user_v1');
      } catch (e) {}
    }
  }
};

const getLoggedUser = (): User | null => {
  if (inMemoryUser) return inMemoryUser;
  if (typeof window === 'undefined') return null;
  try {
    const u = safeGetLocalStorage('sita_current_user_v1');
    return u ? JSON.parse(u) : null;
  } catch (e) {
    return null;
  }
};

async function seedIfEmpty() {
  if (!supabase) return;
  try {
    const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
    if (!error && count === 0) {
      console.log("Database is empty. Seeding default mock users and students...");
      const dbUsers = MOCK_USERS.map(mapUserToDb);
      const { error: errUsers } = await supabase.from('users').insert(dbUsers);
      if (errUsers) console.error("Error seeding users:", errUsers);
      
      const dbStudents = MOCK_STUDENTS.map(mapStudentToDb);
      const { error: errStudents } = await supabase.from('students').insert(dbStudents);
      if (errStudents) console.error("Error seeding students:", errStudents);
    }
  } catch (err) {
    console.error("Failed to seed database:", err);
  }
}

export const api = {
  // Berlangganan perubahan antrean (untuk UI)
  subscribe(cb: (length: number, isSyncing: boolean, lastError: string | null, failedLength: number) => void) {
    queueChangeCallbacks.push(cb);
    cb(getQueue().length, isProcessing, lastSyncError, getFailedQueue().length);
    return () => {
      queueChangeCallbacks = queueChangeCallbacks.filter(c => c !== cb);
    };
  },

  getQueueLength(): number {
    return getQueue().length;
  },

  getQueue(): QueueItem[] {
    return getQueue();
  },

  isSyncing(): boolean {
    return isProcessing;
  },

  // Helper untuk membaca item antrean aktif guna penggabungan data (prevent data flicker/loss saat polling)
  getPendingRecords(): TahfidzRecord[] {
    return getQueue()
      .filter(item => item.action === 'addRecord' && item.data)
      .map(item => ({
        ...item.data,
        studentId: cleanId(item.data.studentId)
      }));
  },

  getPendingAttendance(): Attendance[] {
    return getQueue()
      .filter(item => item.action === 'markAttendance' && item.data)
      .map(item => ({
        ...item.data,
        userId: cleanId(item.data.userId)
      }));
  },

  getPendingExams(): Exam[] {
    return getQueue()
      .filter(item => item.action === 'addExam' && item.data)
      .map(item => ({
        ...item.data,
        studentId: cleanId(item.data.studentId)
      }));
  },

  getPendingStudents(): Student[] {
    return getQueue()
      .filter(item => item.action === 'addStudent' && item.data)
      .map(item => item.data);
  },

  // Eksekusi langsung ke database untuk persetujuan (magic link) tanpa lewat antrean background
  async markAttendanceDirect(attendanceData: Attendance, userOverride?: User | null): Promise<{ success: boolean; message?: string }> {
    if (!supabase) return { success: false, message: 'Database Supabase belum terhubung.' };
    const u = userOverride || getLoggedUser();
    if (!u) return { success: false, message: 'Pengguna belum login atau sesi telah berakhir.' };

    try {
      const dbData = mapAttendanceToDb(attendanceData);
      const { data, error } = await supabase.rpc('upsert_data', {
        p_username: u.username,
        p_password: u.password,
        p_table: 'attendance',
        p_data: dbData
      });

      if (error) throw error;
      if (data && data.success === false) {
        throw new Error(data.message || 'Gagal menyimpan absensi ke server.');
      }
      return { success: true };
    } catch (err: any) {
      console.error('Error markAttendanceDirect:', err);
      return { success: false, message: err?.message || 'Gagal menghubungi server database.' };
    }
  },

  async addAttendanceOpenRequestDirect(reqData: AttendanceOpenRequest, userOverride?: User | null): Promise<{ success: boolean; message?: string }> {
    if (!supabase) return { success: false, message: 'Database Supabase belum terhubung.' };
    const u = userOverride || getLoggedUser();
    if (!u) return { success: false, message: 'Pengguna belum login atau sesi telah berakhir.' };

    try {
      const dbData = mapAttendanceOpenRequestToDb(reqData);
      const { data, error } = await supabase.rpc('upsert_data', {
        p_username: u.username,
        p_password: u.password,
        p_table: 'attendance_open_requests',
        p_data: dbData
      });

      if (error) throw error;
      if (data && data.success === false) {
        throw new Error(data.message || 'Gagal menyimpan permohonan ke server.');
      }
      return { success: true };
    } catch (err: any) {
      console.error('Error addAttendanceOpenRequestDirect:', err);
      return { success: false, message: err?.message || 'Gagal menghubungi server database.' };
    }
  },

  // Fungsi mengirim data (POST) - Offline First
  async send(action: ActionType, data: any) {
    const queue = getQueue();
    const newItem: QueueItem = {
      id: 'q_' + Math.random().toString(36).substr(2, 9),
      action,
      data,
      timestamp: Date.now()
    };
    queue.push(newItem);
    saveQueue(queue);

    // Jalankan proses sinkronisasi di background
    this.processQueue();
  },

  // Fungsi memproses antrean di background
  async processQueue() {
    if (isProcessing) return;
    if (!supabase) {
      console.warn("Supabase belum dikonfigurasi.");
      lastSyncError = "Supabase belum dikonfigurasi.";
      notifyCallbacks();
      return;
    }

    const queue = getQueue();
    if (queue.length === 0) {
      lastSyncError = null;
      notifyCallbacks();
      return;
    }

    isProcessing = true;
    lastSyncError = null;
    notifyCallbacks();

    console.log(`Memulai sinkronisasi Supabase untuk ${queue.length} antrean data...`);

    while (getQueue().length > 0) {
      if (typeof window !== 'undefined' && 'navigator' in window && !window.navigator.onLine) {
        console.warn("Sinkronisasi ditangguhkan: perangkat offline.");
        lastSyncError = "Koneksi offline.";
        break;
      }

      const currentQueue = getQueue();
      const item = currentQueue[0];

      try {
        let error = null;
        let rpcRes: any = null;
        
        // Ambil akun login aktif saat ini untuk otorisasi RPC
        const userCreds = getLoggedUser();
        const uName = userCreds?.username || '';
        const uPass = userCreds?.password || '';

        const isTeacherQuickQR = item.action === 'markAttendance' && 
          item.data?.type === 'teacher' && 
          item.data?.status === 'present' && 
          item.data?.qrToken === 'SITA_ABSENSI_GURU_TETAP';

        // Proteksi: Jika data butuh otentikasi tetapi kredensial belum ada, tunda pemrosesan antrean
        if (!uName || !uPass) {
          if (!isTeacherQuickQR) {
            console.warn("Sinkronisasi ditunda: Menunggu otentikasi login pengguna.");
            lastSyncError = "Menunggu otentikasi login pengguna.";
            break;
          }
        }

        if (item.action === 'addUser') {
          const { data: d, error: err } = await supabase.rpc('upsert_data', { 
            p_username: uName, 
            p_password: uPass, 
            p_table: 'users', 
            p_data: mapUserToDb(item.data) 
          });
          rpcRes = d;
          error = err;
        } else if (item.action === 'addStudent') {
          const { data: d, error: err } = await supabase.rpc('upsert_data', { 
            p_username: uName, 
            p_password: uPass, 
            p_table: 'students', 
            p_data: mapStudentToDb(item.data) 
          });
          rpcRes = d;
          error = err;
        } else if (item.action === 'addRecord') {
          const { data: d, error: err } = await supabase.rpc('upsert_data', { 
            p_username: uName, 
            p_password: uPass, 
            p_table: 'records', 
            p_data: mapRecordToDb(item.data) 
          });
          rpcRes = d;
          error = err;
        } else if (item.action === 'markAttendance') {
          const { data: d, error: err } = await supabase.rpc('upsert_data', { 
            p_username: uName, 
            p_password: uPass, 
            p_table: 'attendance', 
            p_data: mapAttendanceToDb(item.data) 
          });
          rpcRes = d;
          error = err;
        } else if (item.action === 'addAttendanceOpenRequest') {
          // Ganti dari direct upsert ke secure upsert RPC
          const { data: d, error: err } = await supabase.rpc('upsert_data', { 
            p_username: uName, 
            p_password: uPass, 
            p_table: 'attendance_open_requests', 
            p_data: mapAttendanceOpenRequestToDb(item.data) 
          });
          rpcRes = d;
          error = err;
        } else if (item.action === 'addExam') {
          const { data: d, error: err } = await supabase.rpc('upsert_data', { 
            p_username: uName, 
            p_password: uPass, 
            p_table: 'exams', 
            p_data: mapExamToDb(item.data) 
          });
          rpcRes = d;
          error = err;
        } else if (item.action === 'updateUser') {
          const { data: d, error: err } = await supabase.rpc('upsert_data', { 
            p_username: uName, 
            p_password: uPass, 
            p_table: 'users', 
            p_data: mapUserToDb(item.data) 
          });
          rpcRes = d;
          error = err;
        } else if (item.action === 'deleteData') {
          let tableName = item.data.sheetName.toLowerCase();
          if (tableName === 'attendanceopenrequests') {
            tableName = 'attendance_open_requests';
          }
          
          let err = null;
          // Menggunakan delete_data_secure RPC untuk semua tabel demi keamanan penuh
          const { data: deleteRes, error: deleteErr } = await supabase.rpc('delete_data_secure', { 
            p_username: uName, 
            p_password: uPass, 
            p_table: tableName, 
            p_id: item.data.id 
          });
          if (deleteErr) {
            err = deleteErr;
          } else if (deleteRes && deleteRes.success === false) {
            err = new Error(deleteRes.message || 'Gagal menghapus data secara aman.');
          }
          error = err;
        }

        // Cek jika RPC mengembalikan status gagal di data
        if (!error && rpcRes && rpcRes.success === false) {
          error = new Error(rpcRes.message || 'Gagal menyimpan data ke database.');
        }

        if (error) throw error;

        // Hapus dari antrean jika sukses
        const updatedQueue = getQueue().filter(q => q.id !== item.id);
        saveQueue(updatedQueue);
        lastSyncError = null;
        console.log(`Berhasil sinkronisasi Supabase: ${item.action}`, item.data);
      } catch (err: any) {
        console.error(`Gagal sinkronisasi Supabase ${item.id} (${item.action}):`, err);
        const errMsg = err?.message || String(err);
        
        if (isTemporaryError(err)) {
          // Error sementara (jaringan/timeout): tangguhkan antrean, coba lagi nanti
          lastSyncError = errMsg;
          break;
        } else {
          // Error permanen (database constraint/format salah): pindahkan ke failed queue (DLQ) agar tidak memacetkan antrean data lain
          const failedQueue = getFailedQueue();
          failedQueue.push({
            ...item,
            error: errMsg
          });
          saveFailedQueue(failedQueue);
          
          // Hapus dari antrean aktif karena tidak bisa diproses
          const updatedQueue = getQueue().filter(q => q.id !== item.id);
          saveQueue(updatedQueue);
          
          console.warn(`Data dengan error permanen dipindahkan ke DLQ: ${item.action}`, item.data);
        }
      }
    }

    isProcessing = false;
    notifyCallbacks();
  },

  getFailedQueue(): QueueItem[] {
    return getFailedQueue();
  },

  clearFailedQueue() {
    saveFailedQueue([]);
  },

  retryFailedQueue() {
    const failed = getFailedQueue();
    if (failed.length === 0) return;
    
    const active = getQueue();
    const combined = [...active];
    failed.forEach(item => {
      if (!combined.some(c => c.id === item.id)) {
        const { error, ...cleanItem } = item;
        // Inject qrToken for teacher attendance recovery
        if (cleanItem.action === 'markAttendance' && cleanItem.data && cleanItem.data.type === 'teacher') {
          cleanItem.data.qrToken = 'SITA_ABSENSI_GURU_TETAP';
        }
        combined.push(cleanItem);
      }
    });
    
    saveQueue(combined);
    saveFailedQueue([]);
    
    this.processQueue();
  },

  // Fungsi Login menggunakan RPC
  async login(username: string, password: string): Promise<{ success: boolean; data?: User; message?: string }> {
    if (!supabase) return { success: false, message: 'Koneksi database belum dikonfigurasi.' };
    try {
      await seedIfEmpty();
      const { data, error } = await supabase.rpc('verify_login', {
        p_username: username.trim(),
        p_password: password.trim()
      });
      if (error) throw error;
      
      const result = data as { success: boolean; data?: any; message?: string };
      if (result.success && result.data) {
        const loggedUser: User = {
          id: result.data.id,
          name: result.data.name,
          role: result.data.role,
          username: result.data.username,
          password: result.data.password,
          phoneNumber: result.data.phoneNumber || result.data.phone_number,
          childId: result.data.childId || result.data.child_id,
          email: result.data.email,
          avatar: result.data.avatar
        };
        setSessionUser(loggedUser);
        return {
          success: true,
          data: loggedUser
        };
      }
      return { success: false, message: result.message || 'Username atau password salah.' };
    } catch (err: any) {
      console.error('Login RPC error:', err);
      return { success: false, message: err?.message || 'Gagal menghubungi server login.' };
    }
  },

  // Fungsi mengambil semua data (GET) - Menggunakan RPC Aman
  async load(currentUser: User | null) {
    if (!supabase) return null;

    try {
      await seedIfEmpty();
      if (!currentUser) {
        // Jika belum login, hanya load list minimal guru menggunakan RPC aman
        const { data: teachersData, error: teachersError } = await supabase.rpc('get_teacher_list');
        if (teachersError) throw teachersError;
        
        return {
          users: (teachersData || []).map((row: any) => ({
            id: row.id,
            name: row.name,
            role: row.role,
            username: '',
            password: '',
            phoneNumber: '',
            childId: '',
            email: '',
            avatar: ''
          })),
          students: [],
          records: [],
          attendance: [],
          exams: [],
          openRequests: []
        };
      }

      // Jika login, load seluruh data secara aman lewat RPC menggunakan kredensial user
      const { data: secureData, error: secureError } = await supabase.rpc('load_secure_data', {
        p_username: currentUser.username,
        p_password: currentUser.password
      });

      if (secureError) throw secureError;
      
      const result = secureData as {
        success: boolean;
        message?: string;
        users?: any[];
        students?: any[];
        records?: any[];
        attendance?: any[];
        exams?: any[];
        open_requests?: any[];
      };

      if (!result.success) {
        throw new Error(result.message || "Gagal memuat data aman.");
      }

      console.log("Data loaded securely from Supabase RPC");
      return {
        users: (result.users || []).map(mapUserFromDb),
        students: (result.students || []).map(mapStudentFromDb),
        records: (result.records || []).map(mapRecordFromDb),
        attendance: (result.attendance || []).map(mapAttendanceFromDb),
        exams: (result.exams || []).map(mapExamFromDb),
        openRequests: (result.open_requests || []).map(mapAttendanceOpenRequestFromDb)
      };
    } catch (error) {
      console.error("Failed to load secure cloud data:", error);
      return null;
    }
  },

  // ================= BANK SOAL TAHFIZ API =================
  // ================= BANK SOAL TAHFIZ API (HARDENED) =================
  // Local storage is strictly for cache & recovery drafts, NOT an alternative permanent save.
  getLocalQuestionBankCache(): QuestionBankItem[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const stored = localStorage.getItem('sita_question_bank_cache_v2');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  },

  saveLocalQuestionBankCache(items: QuestionBankItem[]) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem('sita_question_bank_cache_v2', JSON.stringify(items));
    } catch (e) {
      console.warn("Gagal update local cache:", e);
    }
  },

  getRecoveryDrafts(): QuestionBankItem[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const stored = localStorage.getItem('sita_question_bank_recovery_v2');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  },

  saveRecoveryDraft(item: QuestionBankItem, errorReason: string) {
    try {
      if (typeof localStorage === 'undefined') return;
      const drafts = this.getRecoveryDrafts();
      const existingIdx = drafts.findIndex(d => d.id === item.id);
      const draftItem: QuestionBankItem = {
        ...item,
        syncStatus: 'failed',
        syncError: errorReason,
        updatedAt: new Date().toISOString()
      };
      if (existingIdx >= 0) {
        drafts[existingIdx] = draftItem;
      } else {
        drafts.unshift(draftItem);
      }
      localStorage.setItem('sita_question_bank_recovery_v2', JSON.stringify(drafts));
    } catch (e) {
      console.warn("Gagal menyimpan recovery draft:", e);
    }
  },

  removeRecoveryDraft(id: string) {
    try {
      if (typeof localStorage === 'undefined') return;
      const drafts = this.getRecoveryDrafts().filter(d => d.id !== id);
      localStorage.setItem('sita_question_bank_recovery_v2', JSON.stringify(drafts));
    } catch (e) {}
  },

  // Save Question Bank Item (Supabase as Source of Truth)
  async saveQuestionBankItem(item: QuestionBankItem, userOverride?: User | null): Promise<{ success: boolean; data?: QuestionBankItem; message?: string; isDraftSaved?: boolean }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak menyimpan soal ke Bank Soal.' };
    }

    // Client structural validation
    const isAValid = item.promptStart.surahNumber < item.promptEnd.surahNumber ||
      (item.promptStart.surahNumber === item.promptEnd.surahNumber && item.promptStart.ayahNumber < item.promptEnd.ayahNumber) ||
      (item.promptStart.surahNumber === item.promptEnd.surahNumber && item.promptStart.ayahNumber === item.promptEnd.ayahNumber && item.promptStart.wordPosition <= item.promptEnd.wordPosition);

    const isAEndLtB = item.promptEnd.surahNumber < item.answerStart.surahNumber ||
      (item.promptEnd.surahNumber === item.answerStart.surahNumber && item.promptEnd.ayahNumber < item.answerStart.ayahNumber) ||
      (item.promptEnd.surahNumber === item.answerStart.surahNumber && item.promptEnd.ayahNumber === item.answerStart.ayahNumber && item.promptEnd.wordPosition < item.answerStart.wordPosition);

    const isBCValid = item.answerStart.surahNumber < item.answerEnd.surahNumber ||
      (item.answerStart.surahNumber === item.answerEnd.surahNumber && item.answerStart.ayahNumber < item.answerEnd.ayahNumber) ||
      (item.answerStart.surahNumber === item.answerEnd.surahNumber && item.answerStart.ayahNumber === item.answerEnd.ayahNumber && item.answerStart.wordPosition <= item.answerEnd.wordPosition);

    if (!isAValid || !isAEndLtB || !isBCValid) {
      return { success: false, message: 'Validasi posisi Al-Qur\'an gagal: Urutan Titik A, A\', B, C tidak valid (harus A ≤ A\' < B ≤ C).' };
    }

    const payload = mapQuestionBankToDb(item);

    if (!supabase) {
      this.saveRecoveryDraft(item, 'Supabase client belum terkonfigurasi');
      return {
        success: false,
        message: 'Gagal menyimpan soal ke server: Koneksi Supabase belum terkonfigurasi. Draft Anda tetap tersimpan di perangkat ini.',
        isDraftSaved: true,
        data: { ...item, syncStatus: 'failed', syncError: 'Koneksi Supabase belum terkonfigurasi' }
      };
    }

    try {
      // 1. Panggil Secure RPC yang memverifikasi admin & password di PostgreSQL
      const { data: rpcData, error: rpcError } = await supabase.rpc('upsert_question_bank_item', {
        p_username: u.username,
        p_password: u.password,
        p_data: payload
      });

      if (!rpcError && rpcData?.success) {
        // Berhasil disimpan permanen di Supabase!
        const savedItem: QuestionBankItem = {
          ...item,
          id: rpcData.id || item.id,
          syncStatus: 'saved',
          syncError: null,
          updatedAt: new Date().toISOString()
        };

        // Perbarui cache lokal & hapus dari recovery draft
        const cache = this.getLocalQuestionBankCache();
        const cIdx = cache.findIndex(q => q.id === savedItem.id);
        if (cIdx >= 0) cache[cIdx] = savedItem;
        else cache.unshift(savedItem);
        this.saveLocalQuestionBankCache(cache);
        this.removeRecoveryDraft(item.id);

        return {
          success: true,
          data: savedItem,
          message: 'Soal berhasil disimpan permanen ke server database Supabase.'
        };
      }

      // Cek jika RPC gagal dengan pesan otorisasi atau validasi
      const errMsg = rpcData?.message || rpcError?.message || 'Gagal menyimpan soal ke server.';

      // Simpan ke local recovery draft agar data admin tidak lenyap saat terjadi kendala server/jaringan
      this.saveRecoveryDraft(item, errMsg);

      return {
        success: false,
        message: `Gagal menyimpan soal ke server: ${errMsg}. Draft Anda tetap tersimpan di perangkat ini.`,
        isDraftSaved: true,
        data: { ...item, syncStatus: 'failed', syncError: errMsg }
      };
    } catch (err: any) {
      const errMsg = err?.message || 'Terjadi kesalahan jaringan.';
      this.saveRecoveryDraft(item, errMsg);
      return {
        success: false,
        message: `Gagal menyimpan soal ke server: ${errMsg}. Draft Anda tetap tersimpan di perangkat ini.`,
        isDraftSaved: true,
        data: { ...item, syncStatus: 'failed', syncError: errMsg }
      };
    }
  },

  // Get Question Bank List (Supabase is Source of Truth)
  async getQuestionBankList(filter?: QuestionBankFilter, userOverride?: User | null): Promise<{ success: boolean; data: QuestionBankItem[]; message?: string; isOfflineCache?: boolean }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, data: [], message: 'Akses ditolak: Hanya Admin yang berhak mengakses Bank Soal.' };
    }

    let serverItems: QuestionBankItem[] = [];
    let isOffline = false;

    if (supabase) {
      try {
        // Coba lewat Secure RPC terlebih dahulu
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_question_bank_secure', {
          p_username: u.username,
          p_password: u.password
        });

        if (!rpcError && rpcData?.success && Array.isArray(rpcData.data)) {
          serverItems = rpcData.data.map(mapQuestionBankFromDb);
          this.saveLocalQuestionBankCache(serverItems);
        } else {
          // Fallback direct table select jika RPC belum ter-apply
          const { data: dbRows, error: tableError } = await supabase
            .from('question_bank')
            .select('*')
            .order('updated_at', { ascending: false });

          if (!tableError && dbRows && Array.isArray(dbRows)) {
            serverItems = dbRows.map(mapQuestionBankFromDb);
            this.saveLocalQuestionBankCache(serverItems);
          } else {
            isOffline = true;
          }
        }
      } catch (e) {
        isOffline = true;
      }
    } else {
      isOffline = true;
    }

    // Jika server tidak dapat dihubungi, gunakan data cache lokal
    if (isOffline) {
      serverItems = this.getLocalQuestionBankCache();
    }

    // Gabungkan dengan recovery drafts (draft lokal yang belum tersinkron/gagal sinkron)
    const recoveryDrafts = this.getRecoveryDrafts();
    const serverIdSet = new Set(serverItems.map(i => i.id));
    const unsyncedDrafts = recoveryDrafts.filter(d => !serverIdSet.has(d.id));

    // Draft yang belum tersinkron ditempatkan di paling atas dengan status pending/failed
    let allItems = [...unsyncedDrafts, ...serverItems];

    let filtered = [...allItems];
    if (filter) {
      if (filter.status && filter.status !== 'all') {
        filtered = filtered.filter(q => q.status === filter.status);
      }
      if (filter.examType && filter.examType !== 'all') {
        if (filter.examType === 'uts') {
          // UTS mengizinkan tipe 'uts' atau 'generic' (umum), tetapi menolak 'uas'
          filtered = filtered.filter(q => q.examType === 'uts' || q.examType === 'generic');
        } else if (filter.examType === 'uas') {
          filtered = filtered.filter(q => q.examType === 'uas' || q.examType === 'generic');
        } else {
          filtered = filtered.filter(q => q.examType === filter.examType);
        }
      }
      if (filter.questionType && filter.questionType !== 'all') {
        filtered = filtered.filter(q => q.questionType === filter.questionType);
      }
      if (filter.difficulty && filter.difficulty !== 'all') {
        filtered = filtered.filter(q => q.difficulty === filter.difficulty);
      }
      if (filter.juz && filter.juz !== 'all') {
        filtered = filtered.filter(q => q.startJuz === filter.juz || q.endJuz === filter.juz);
      }
      if (filter.surah && filter.surah !== 'all') {
        filtered = filtered.filter(q => 
          q.promptStart.surahNumber === filter.surah || 
          q.answerEnd.surahNumber === filter.surah
        );
      }
      if (filter.tag && filter.tag.trim()) {
        const cleanTag = filter.tag.trim().toLowerCase();
        filtered = filtered.filter(q => q.tags.some(t => t.toLowerCase().includes(cleanTag)));
      }
      if (filter.search && filter.search.trim()) {
        const q = filter.search.trim().toLowerCase();
        filtered = filtered.filter(item => {
          const matchPrompt = item.promptText.toLowerCase().includes(q);
          const matchAnswer = item.answerText.toLowerCase().includes(q);
          const matchTag = item.tags.some(t => t.toLowerCase().includes(q));
          const matchSurah = item.promptStart.surahNumber.toString() === q;
          const matchSurahAyah = `${item.promptStart.surahNumber}:${item.promptStart.ayahNumber}`.includes(q);
          const matchJuz = `juz ${item.startJuz}`.toLowerCase().includes(q);
          return matchPrompt || matchAnswer || matchTag || matchSurah || matchSurahAyah || matchJuz;
        });
      }
    }

    return {
      success: true,
      data: filtered,
      isOfflineCache: isOffline
    };
  },

  async archiveQuestionBankItem(id: string, userOverride?: User | null): Promise<{ success: boolean; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak mengarsipkan soal.' };
    }

    if (!supabase) {
      return { success: false, message: 'Gagal mengarsipkan: Database Supabase belum terhubung.' };
    }

    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('archive_question_bank_item', {
        p_username: u.username,
        p_password: u.password,
        p_id: id
      });

      if (!rpcErr && rpcData?.success) {
        const cache = this.getLocalQuestionBankCache();
        const target = cache.find(q => q.id === id);
        if (target) {
          target.status = 'archived';
          target.archivedAt = new Date().toISOString();
          target.updatedAt = new Date().toISOString();
          this.saveLocalQuestionBankCache(cache);
        }
        return { success: true };
      }

      const errMsg = rpcData?.message || rpcErr?.message || 'Gagal mengarsipkan soal di server.';
      return { success: false, message: errMsg };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal mengarsipkan soal.' };
    }
  },

  async restoreQuestionBankItem(id: string, userOverride?: User | null): Promise<{ success: boolean; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak memulihkan soal.' };
    }

    if (!supabase) {
      return { success: false, message: 'Gagal memulihkan: Database Supabase belum terhubung.' };
    }

    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('restore_question_bank_item', {
        p_username: u.username,
        p_password: u.password,
        p_id: id
      });

      if (!rpcErr && rpcData?.success) {
        const cache = this.getLocalQuestionBankCache();
        const target = cache.find(q => q.id === id);
        if (target) {
          target.status = 'active';
          target.archivedAt = null;
          target.updatedAt = new Date().toISOString();
          this.saveLocalQuestionBankCache(cache);
        }
        return { success: true };
      }

      const errMsg = rpcData?.message || rpcErr?.message || 'Gagal memulihkan soal di server.';
      return { success: false, message: errMsg };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal memulihkan soal.' };
    }
  },

  async deleteQuestionBankItem(id: string, userOverride?: User | null): Promise<{ success: boolean; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak menghapus soal.' };
    }

    let remoteSuccess = false;
    let remoteErrMsg = '';

    if (supabase) {
      try {
        // 1. Panggil RPC delete_question_bank_item
        const { data: rpcData, error: rpcErr } = await supabase.rpc('delete_question_bank_item', {
          p_username: u.username,
          p_password: u.password,
          p_id: id
        });

        if (!rpcErr && rpcData?.success) {
          remoteSuccess = true;
        } else {
          // 2. Fallback: coba direct table delete jika diperbolehkan policy
          const { error: directErr } = await supabase
            .from('question_bank')
            .delete()
            .eq('id', id);

          if (!directErr) {
            remoteSuccess = true;
          } else {
            remoteErrMsg = rpcData?.message || rpcErr?.message || directErr?.message || 'Gagal menghapus di server';
          }
        }
      } catch (e: any) {
        remoteErrMsg = e?.message || 'Gagal menghapus di server';
      }
    }

    // Bersihkan dari cache lokal & recovery drafts
    const cache = this.getLocalQuestionBankCache().filter(q => q.id !== id);
    this.saveLocalQuestionBankCache(cache);
    this.removeRecoveryDraft(id);

    return { 
      success: true, 
      message: remoteSuccess 
        ? 'Soal berhasil dihapus permanen dari server & penyimpanan.' 
        : (remoteErrMsg ? `Soal dihapus dari cache lokal. Catatan server: ${remoteErrMsg}` : 'Soal berhasil dihapus.') 
    };
  },

  async deleteAllQuestionBankItems(
    options?: { examType?: string; status?: string },
    userOverride?: User | null
  ): Promise<{ success: boolean; deletedCount: number; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, deletedCount: 0, message: 'Akses ditolak: Hanya Admin yang berhak menghapus semua soal.' };
    }

    let remoteSuccess = false;
    let serverDeletedCount = 0;
    const examType = options?.examType;
    const status = options?.status;

    if (supabase) {
      try {
        // 1. Panggil RPC delete_all_question_bank_items
        const { data: rpcData, error: rpcErr } = await supabase.rpc('delete_all_question_bank_items', {
          p_username: u.username,
          p_password: u.password,
          p_exam_type: examType && examType !== 'all' ? examType : null,
          p_status: status && status !== 'all' ? status : null
        });

        if (!rpcErr && rpcData?.success) {
          remoteSuccess = true;
          serverDeletedCount = rpcData.deleted_count || 0;
        } else {
          // 2. Fallback direct delete
          let query = supabase.from('question_bank').delete();
          if (examType && examType !== 'all') {
            query = query.eq('exam_type', examType);
          }
          if (status && status !== 'all') {
            query = query.eq('status', status);
          }
          const { error: directErr, count } = await query.neq('id', '___dummy_never_match___');
          if (!directErr) {
            remoteSuccess = true;
            serverDeletedCount = count || 0;
          }
        }
      } catch (e: any) {
        console.warn("Delete all question bank remote error:", e);
      }
    }

    // Bersihkan dari cache lokal & recovery drafts
    let cache = this.getLocalQuestionBankCache();
    const prevCount = cache.length;
    if (examType && examType !== 'all') {
      cache = cache.filter(q => q.examType !== examType);
    } else if (status && status !== 'all') {
      cache = cache.filter(q => q.status !== status);
    } else {
      cache = [];
    }
    this.saveLocalQuestionBankCache(cache);

    try {
      if (!examType && !status) {
        localStorage.removeItem('sita_question_bank_recovery_v2');
      }
    } catch (e) {}

    const totalCleaned = serverDeletedCount || (prevCount - cache.length);

    return {
      success: true,
      deletedCount: totalCleaned,
      message: `${totalCleaned} soal berhasil dihapus permanen.`
    };
  },

  async checkDuplicateQuestion(
    promptStart: any,
    promptEnd: any,
    answerStart: any,
    answerEnd: any,
    excludeId?: string
  ): Promise<QuestionBankItem | null> {
    const matchFn = (q: QuestionBankItem) => {
      if (excludeId && q.id === excludeId) return false;
      return (
        q.promptStart.surahNumber === promptStart.surahNumber &&
        q.promptStart.ayahNumber === promptStart.ayahNumber &&
        q.promptStart.wordPosition === promptStart.wordPosition &&
        q.promptEnd.surahNumber === promptEnd.surahNumber &&
        q.promptEnd.ayahNumber === promptEnd.ayahNumber &&
        q.promptEnd.wordPosition === promptEnd.wordPosition &&
        q.answerStart.surahNumber === answerStart.surahNumber &&
        q.answerStart.ayahNumber === answerStart.ayahNumber &&
        q.answerStart.wordPosition === answerStart.wordPosition &&
        q.answerEnd.surahNumber === answerEnd.surahNumber &&
        q.answerEnd.ayahNumber === answerEnd.ayahNumber &&
        q.answerEnd.wordPosition === answerEnd.wordPosition
      );
    };

    const cache = this.getLocalQuestionBankCache();
    const localMatch = cache.find(matchFn);
    if (localMatch) return localMatch;

    const recovery = this.getRecoveryDrafts();
    const recoveryMatch = recovery.find(matchFn);
    if (recoveryMatch) return recoveryMatch;

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('question_bank')
          .select('*')
          .eq('prompt_start_surah', promptStart.surahNumber)
          .eq('prompt_start_ayah', promptStart.ayahNumber)
          .eq('prompt_start_word', promptStart.wordPosition)
          .eq('prompt_end_surah', promptEnd.surahNumber)
          .eq('prompt_end_ayah', promptEnd.ayahNumber)
          .eq('prompt_end_word', promptEnd.wordPosition)
          .eq('answer_start_surah', answerStart.surahNumber)
          .eq('answer_start_ayah', answerStart.ayahNumber)
          .eq('answer_start_word', answerStart.wordPosition)
          .eq('answer_end_surah', answerEnd.surahNumber)
          .eq('answer_end_ayah', answerEnd.ayahNumber)
          .eq('answer_end_word', answerEnd.wordPosition);

        if (!error && data && data.length > 0) {
          const found = data.find((r: any) => !excludeId || r.id !== excludeId);
          if (found) return mapQuestionBankFromDb(found);
        }
      } catch (e) {
        console.warn("Check duplicate remote warning:", e);
      }
    }

    return null;
  },

  // Bulk Save Candidates from Quick Bank Soal Generator (Admin Only, Fail-Closed, Atomic)
  async bulkSaveQuestionBankCandidates(
    candidates: QuickQuestionCandidate[],
    userOverride?: User | null
  ): Promise<BulkSaveCandidatesResult> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return {
        success: false,
        savedCount: 0,
        skippedCount: candidates.length,
        message: 'Akses ditolak: Hanya Administrator yang berhak menyimpan Bank Soal secara massal.'
      };
    }

    const selectedCandidates = candidates.filter(c => c.selected);
    const skippedCount = candidates.length - selectedCandidates.length;

    if (selectedCandidates.length === 0) {
      return {
        success: false,
        savedCount: 0,
        skippedCount: candidates.length,
        message: 'Tidak ada kandidat soal yang dipilih untuk disimpan.'
      };
    }

    // Konversi QuickQuestionCandidate menjadi QuestionBankItem
    const itemsToSave: QuestionBankItem[] = selectedCandidates.map(c => ({
      id: c.id,
      examType: 'generic',
      questionType: 'random',
      questionFormat: 'continuation',
      promptStart: { ...c.promptStart },
      promptEnd: { ...c.promptEnd },
      answerStart: { ...c.answerStart },
      answerEnd: { ...c.answerEnd },
      promptText: c.promptText,
      answerText: c.answerText,
      totalExpectedWords: c.totalExpectedWords,
      startPage: Math.min(c.promptStart.pageNumber, c.answerStart.pageNumber),
      endPage: Math.max(c.answerStart.pageNumber, c.answerEnd.pageNumber),
      startJuz: c.juzNumber,
      endJuz: c.juzNumber,
      answerMode: c.answerMode || 'end_ayah',
      difficulty: c.difficulty,
      tags: ['quick_generator'],
      notes: 'Dihasilkan otomatis oleh Quick Bank Soal Generator',
      status: c.status || 'draft',
      createdBy: u.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));

    // Coba simpan via RPC bulk_insert_question_bank_candidates terlebih dahulu (jika migrasi sudah aktif)
    if (supabase) {
      try {
        const payloadArray = itemsToSave.map(mapQuestionBankToDb);
        const { data: rpcData, error: rpcError } = await supabase.rpc('bulk_insert_question_bank_candidates', {
          p_username: u.username,
          p_password: u.password,
          p_items: payloadArray
        });

        if (!rpcError && rpcData?.success) {
          const cache = this.getLocalQuestionBankCache();
          itemsToSave.forEach(it => {
            cache.unshift({ ...it, syncStatus: 'saved' });
          });
          this.saveLocalQuestionBankCache(cache);

          return {
            success: true,
            savedCount: rpcData.saved_count || itemsToSave.length,
            skippedCount,
            savedIds: rpcData.saved_ids || itemsToSave.map(i => i.id),
            message: `${rpcData.saved_count || itemsToSave.length} soal berhasil disimpan ke Bank Soal (Status: Draft).`
          };
        }

        if (rpcData && !rpcData.success) {
          return {
            success: false,
            savedCount: 0,
            skippedCount: candidates.length,
            message: rpcData.message || 'Validasi server gagal saat menyimpan soal massal.'
          };
        }
      } catch (err: any) {
        console.warn("RPC bulk_insert_question_bank_candidates belum terpasang atau gagal, beralih ke secure client-side loop:", err?.message);
      }
    }

    // Fallback Adaptif: Validasi & Simpan satu per satu via saveQuestionBankItem (yang memanggil upsert_question_bank_item)
    const savedIds: string[] = [];
    const rejectedItems: { index: number; reason: string }[] = [];

    for (let i = 0; i < itemsToSave.length; i++) {
      const it = itemsToSave[i];
      // Revalidasi duplikasi ganda sebelum simpan
      const dup = await this.checkDuplicateQuestion(it.promptStart, it.promptEnd, it.answerStart, it.answerEnd);
      if (dup) {
        rejectedItems.push({ index: i, reason: `Soal #${i + 1} sudah ada di Bank Soal (ID: ${dup.id})` });
        continue;
      }

      const saveRes = await this.saveQuestionBankItem(it, u);
      if (saveRes.success && saveRes.data) {
        savedIds.push(saveRes.data.id);
      } else if (saveRes.isDraftSaved && saveRes.data) {
        savedIds.push(saveRes.data.id);
      } else {
        rejectedItems.push({ index: i, reason: saveRes.message || `Gagal menyimpan soal #${i + 1}` });
      }
    }

    if (rejectedItems.length > 0 && savedIds.length === 0) {
      return {
        success: false,
        savedCount: 0,
        skippedCount: candidates.length,
        rejectedItems,
        message: `Penyimpanan gagal: ${rejectedItems.map(r => r.reason).join(', ')}`
      };
    }

    return {
      success: true,
      savedCount: savedIds.length,
      skippedCount: skippedCount + rejectedItems.length,
      savedIds,
      rejectedItems,
      message: `${savedIds.length} soal berhasil disimpan ke Bank Soal (Status: Draft).`
    };
  },

  // ============================================================
  // TAHAP 4: EVALUASI TAHFIZ (SEMESTER, PERIODE UTS/UAS & MATERI)
  // ============================================================

  getLocalAcademicTerms(): AcademicTerm[] {
    try {
      const raw = localStorage.getItem('sita_academic_terms_v1');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  },

  saveLocalAcademicTerms(terms: AcademicTerm[]) {
    try {
      localStorage.setItem('sita_academic_terms_v1', JSON.stringify(terms));
    } catch (e) {}
  },

  getLocalExamPeriods(): ExamPeriod[] {
    try {
      const raw = localStorage.getItem('sita_exam_periods_v1');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  },

  saveLocalExamPeriods(periods: ExamPeriod[]) {
    try {
      localStorage.setItem('sita_exam_periods_v1', JSON.stringify(periods));
    } catch (e) {}
  },

  getLocalEvaluationData(periodId: string): TahfizEvaluationData | null {
    try {
      const raw = localStorage.getItem(`sita_eval_data_${periodId}`);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  },

  saveLocalEvaluationData(periodId: string, data: TahfizEvaluationData) {
    try {
      localStorage.setItem(`sita_eval_data_${periodId}`, JSON.stringify(data));
    } catch (e) {}
  },

  async getAcademicTerms(userOverride?: User | null): Promise<{ success: boolean; data?: AcademicTerm[]; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role === 'parent') {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_academic_terms', {
          p_username: u.username,
          p_password: u.password
        });
        if (!error && data?.success) {
          const list: AcademicTerm[] = data.data || [];
          this.saveLocalAcademicTerms(list);
          return { success: true, data: list };
        }
      } catch (e) {
        console.warn("getAcademicTerms remote failed, falling back to local:", e);
      }
    }

    const local = this.getLocalAcademicTerms();
    return { success: true, data: local };
  },

  async upsertAcademicTerm(term: Partial<AcademicTerm>, userOverride?: User | null): Promise<{ success: boolean; id?: string; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak mengelola Semester.' };
    }

    const termId = term.id || `term_${Date.now()}`;
    const payload = {
      id: termId,
      academicYear: term.academicYear,
      semester: term.semester,
      startDate: term.startDate,
      endDate: term.endDate,
      status: term.status || 'draft'
    };

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('upsert_academic_term', {
          p_username: u.username,
          p_password: u.password,
          p_term: payload
        });
        if (!error && data?.success) {
          // Update local cache
          const local = this.getLocalAcademicTerms();
          const savedTerm: AcademicTerm = {
            id: data.id || termId,
            academicYear: term.academicYear!,
            semester: term.semester!,
            startDate: term.startDate!,
            endDate: term.endDate!,
            status: term.status as any || 'draft',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          if (savedTerm.status === 'active') {
            local.forEach(t => { if (t.id !== savedTerm.id && t.status === 'active') t.status = 'completed'; });
          }
          const idx = local.findIndex(t => t.id === savedTerm.id);
          if (idx >= 0) local[idx] = savedTerm;
          else local.unshift(savedTerm);
          this.saveLocalAcademicTerms(local);

          return { success: true, id: data.id || termId, message: data.message };
        }
        return { success: false, message: data?.message || error?.message || 'Gagal menyimpan semester ke Supabase.' };
      } catch (e: any) {
        console.warn("upsertAcademicTerm remote failed:", e);
        return { success: false, message: e?.message || 'Gagal menghubungi server database Supabase.' };
      }
    }

    // Offline mode (hanya jika client Supabase tidak aktif)
    const local = this.getLocalAcademicTerms();
    const savedTerm: AcademicTerm = {
      id: termId,
      academicYear: term.academicYear || '2026/2027',
      semester: term.semester || 'ganjil',
      startDate: term.startDate || new Date().toISOString().split('T')[0],
      endDate: term.endDate || new Date().toISOString().split('T')[0],
      status: term.status as any || 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (savedTerm.status === 'active') {
      local.forEach(t => { if (t.id !== savedTerm.id && t.status === 'active') t.status = 'completed'; });
    }
    const idx = local.findIndex(t => t.id === savedTerm.id);
    if (idx >= 0) local[idx] = savedTerm;
    else local.unshift(savedTerm);
    this.saveLocalAcademicTerms(local);

    return { success: true, id: termId, message: 'Semester berhasil disimpan (Offline/Lokal).' };
  },

  async getExamPeriods(userOverride?: User | null): Promise<{ success: boolean; data?: ExamPeriod[]; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role === 'parent') {
      return { success: false, message: 'Akses ditolak: Parent tidak memiliki akses.' };
    }

    const local = this.getLocalExamPeriods();

    if (supabase) {
      // 1. Coba lewat RPC get_exam_periods (Role-Based Secure)
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_exam_periods', {
          p_username: u.username,
          p_password: u.password
        });

        if (!rpcError && rpcData?.success && Array.isArray(rpcData.data)) {
          const list: ExamPeriod[] = rpcData.data.map((r: any) => ({
            id: r.id,
            academicTermId: r.academicTermId || r.academic_term_id,
            name: r.name,
            examType: r.examType || r.exam_type,
            materialCutoffDate: r.materialCutoffDate || r.material_cutoff_date,
            examStartDate: r.examStartDate || r.exam_start_date,
            examEndDate: r.examEndDate || r.exam_end_date,
            kkm: Number(r.kkm || 75),
            targetClasses: r.targetClasses || r.target_classes || [],
            targetHalaqahs: r.targetHalaqahs || r.target_halaqahs || [],
            status: r.status,
            createdBy: r.createdBy || r.created_by,
            createdAt: r.createdAt || r.created_at,
            updatedAt: r.updatedAt || r.updated_at
          }));
          this.saveLocalExamPeriods(list);
          return { success: true, data: list };
        }
      } catch (e) {
        console.warn("get_exam_periods RPC fallback to direct select:", e);
      }

      // 2. Fallback: Coba lewat direct select dari tabel exam_periods
      try {
        const { data, error } = await supabase
          .from('exam_periods')
          .select('*')
          .order('material_cutoff_date', { ascending: false });

        if (!error && data && data.length > 0) {
          const mapped: ExamPeriod[] = data.map((r: any) => ({
            id: r.id,
            academicTermId: r.academic_term_id,
            name: r.name,
            examType: r.exam_type,
            materialCutoffDate: r.material_cutoff_date,
            examStartDate: r.exam_start_date,
            examEndDate: r.exam_end_date,
            kkm: Number(r.kkm || 75),
            targetClasses: r.target_classes || [],
            targetHalaqahs: r.target_halaqahs || [],
            status: r.status,
            createdBy: r.created_by,
            createdAt: r.created_at,
            updatedAt: r.updated_at
          }));
          this.saveLocalExamPeriods(mapped);
          return { success: true, data: mapped };
        }
        if (error) {
          console.warn("getExamPeriods direct select error:", error.message);
        }
      } catch (e) {
        console.warn("getExamPeriods remote error:", e);
      }
    }

    // 3. Fallback ke data lokal (mencegah data terhapus jika remote diblokir RLS)
    return { success: true, data: local };
  },

  async createExamPeriodWithParticipants(
    period: Partial<ExamPeriod>,
    studentIds: string[],
    userOverride?: User | null
  ): Promise<{ success: boolean; periodId?: string; participantsCount?: number; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak membuat Periode Ujian.' };
    }

    const periodId = period.id || `period_${Date.now()}`;
    const payload = {
      id: periodId,
      academicTermId: period.academicTermId,
      name: period.name,
      examType: period.examType,
      materialCutoffDate: period.materialCutoffDate,
      examStartDate: period.examStartDate || null,
      examEndDate: period.examEndDate || null,
      kkm: period.kkm || 75,
      targetClasses: period.targetClasses || [],
      targetHalaqahs: period.targetHalaqahs || [],
      status: period.status || 'preparation'
    };

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('create_exam_period_with_participants', {
          p_username: u.username,
          p_password: u.password,
          p_period: payload,
          p_student_ids: studentIds
        });

        if (!error && data?.success) {
          const savedPeriod: ExamPeriod = {
            id: data.periodId || periodId,
            academicTermId: period.academicTermId!,
            name: period.name!,
            examType: period.examType as any || 'uts',
            materialCutoffDate: period.materialCutoffDate!,
            examStartDate: period.examStartDate || null,
            examEndDate: period.examEndDate || null,
            kkm: period.kkm || 75,
            targetClasses: period.targetClasses || [],
            targetHalaqahs: period.targetHalaqahs || [],
            status: period.status as any || 'preparation',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          const localPeriods = this.getLocalExamPeriods();
          const idx = localPeriods.findIndex(p => p.id === savedPeriod.id);
          if (idx >= 0) localPeriods[idx] = savedPeriod;
          else localPeriods.unshift(savedPeriod);
          this.saveLocalExamPeriods(localPeriods);

          // Auto assign default examiners (guru halaqah) in background
          if (studentIds.length > 0) {
            this.load(u).then(cloud => {
              const students = cloud?.students || [];
              studentIds.forEach(sid => {
                const s = students.find(st => st.id === sid);
                if (s?.teacherId) {
                  this.assignExaminer({
                    periodId: data.periodId || periodId,
                    studentId: sid,
                    examinerId: s.teacherId,
                    reason: 'Penugasan otomatis guru halaqah sebagai penguji default'
                  }, u).catch(() => {});
                }
              });
            }).catch(() => {});
          }

          return {
            success: true,
            periodId: data.periodId || periodId,
            participantsCount: data.participantsCount,
            message: data.message
          };
        }
        return { success: false, message: data?.message || error?.message || 'Gagal membuat periode ujian di Supabase.' };
      } catch (e: any) {
        console.warn("createExamPeriod remote failed:", e);
        return { success: false, message: e?.message || 'Gagal menghubungi server database.' };
      }
    }

    // Offline mode
    const savedPeriod: ExamPeriod = {
      id: periodId,
      academicTermId: period.academicTermId || '',
      name: period.name || 'Periode Ujian Baru',
      examType: period.examType as any || 'uts',
      materialCutoffDate: period.materialCutoffDate || new Date().toISOString().split('T')[0],
      examStartDate: period.examStartDate || null,
      examEndDate: period.examEndDate || null,
      kkm: period.kkm || 75,
      targetClasses: period.targetClasses || [],
      targetHalaqahs: period.targetHalaqahs || [],
      status: period.status as any || 'preparation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const localPeriods = this.getLocalExamPeriods();
    const idx = localPeriods.findIndex(p => p.id === savedPeriod.id);
    if (idx >= 0) localPeriods[idx] = savedPeriod;
    else localPeriods.unshift(savedPeriod);
    this.saveLocalExamPeriods(localPeriods);

    return {
      success: true,
      periodId,
      participantsCount: studentIds.length,
      message: 'Periode ujian berhasil disimpan secara lokal.'
    };
  },

  async deleteExamPeriod(
    periodId: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak menghapus Periode Ujian.' };
    }

    if (supabase) {
      try {
        // 1. Coba lewat RPC delete_exam_period
        const { data, error } = await supabase.rpc('delete_exam_period', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: periodId
        });

        if (!error && data?.success) {
          const local = this.getLocalExamPeriods().filter(p => p.id !== periodId);
          this.saveLocalExamPeriods(local);
          try {
            localStorage.removeItem(`sita_eval_data_${periodId}`);
          } catch (e) {}

          return { success: true, message: data.message || 'Periode ujian berhasil dihapus.' };
        }

        // 2. Fallback: coba hapus langsung dari tabel exam_periods
        const { error: directErr } = await supabase
          .from('exam_periods')
          .delete()
          .eq('id', periodId);

        if (!directErr) {
          const local = this.getLocalExamPeriods().filter(p => p.id !== periodId);
          this.saveLocalExamPeriods(local);
          try {
            localStorage.removeItem(`sita_eval_data_${periodId}`);
          } catch (e) {}
          return { success: true, message: 'Periode ujian berhasil dihapus dari sistem.' };
        }

        if (error || directErr) {
          console.warn("deleteExamPeriod error:", error?.message || directErr?.message);
        }
      } catch (e: any) {
        console.warn("deleteExamPeriod remote error:", e);
      }
    }

    // Offline / Local cleanup
    const local = this.getLocalExamPeriods().filter(p => p.id !== periodId);
    this.saveLocalExamPeriods(local);
    try {
      localStorage.removeItem(`sita_eval_data_${periodId}`);
    } catch (e) {}

    return { success: true, message: 'Periode ujian berhasil dihapus dari penyimpanan lokal.' };
  },

  async saveMaterialSnapshotsBatch(
    periodId: string,
    snapshots: Partial<ExamMaterialSnapshot>[],
    userOverride?: User | null
  ): Promise<{ success: boolean; savedCount?: number; skippedFinalizedCount?: number; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak memperbarui snapshot materi massal.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('save_material_snapshots_batch', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: periodId,
          p_snapshots: snapshots
        });
        if (!error && data?.success) {
          return {
            success: true,
            savedCount: data.savedCount,
            skippedFinalizedCount: data.skippedFinalizedCount,
            message: data.message
          };
        }
        return { success: false, message: data?.message || error?.message || 'Gagal menyimpan snapshot materi di server.' };
      } catch (e: any) {
        console.warn("saveMaterialSnapshotsBatch remote failed:", e);
        return { success: false, message: e?.message || 'Gagal menghubungi server database.' };
      }
    }

    // Offline mode
    const cached = this.getLocalEvaluationData(periodId);
    if (cached) {
      let saved = 0;
      let skipped = 0;
      snapshots.forEach(s => {
        const exIdx = cached.materialSnapshots.findIndex(m => m.studentId === s.studentId);
        if (exIdx >= 0) {
          if (cached.materialSnapshots[exIdx].status === 'finalized') {
            skipped++;
            return;
          }
          cached.materialSnapshots[exIdx] = { ...cached.materialSnapshots[exIdx], ...s } as ExamMaterialSnapshot;
        } else {
          cached.materialSnapshots.push({
            id: s.id || `snap_${periodId}_${s.studentId}`,
            ...s
          } as ExamMaterialSnapshot);
        }
        saved++;
      });
      this.saveLocalEvaluationData(periodId, cached);
      return {
        success: true,
        savedCount: saved,
        skippedFinalizedCount: skipped,
        message: `${saved} snapshot berhasil disimpan secara lokal (${skipped} dilewati karena sudah final).`
      };
    }

    return { success: true, savedCount: snapshots.length, message: 'Snapshot materi tersimpan lokal.' };
  },

  async verifyOrOverrideMaterialSnapshot(
    snapshotId: string,
    action: 'verify' | 'override' | 'finalize',
    data: Partial<ExamMaterialSnapshot>,
    reason?: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (!u || (u.role !== 'admin' && u.role !== 'teacher')) {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (action === 'override' && (!reason || !reason.trim())) {
      return { success: false, message: 'Wajib mencantumkan alasan koreksi manual.' };
    }

    if (supabase) {
      try {
        const { data: rpcData, error } = await supabase.rpc('verify_or_override_material_snapshot', {
          p_username: u.username,
          p_password: u.password,
          p_snapshot_id: snapshotId,
          p_action: action,
          p_data: data,
          p_reason: reason || ''
        });

        if (!error && rpcData?.success) {
          return { success: true, message: rpcData.message };
        }
        return { success: false, message: rpcData?.message || error?.message || 'Gagal memproses verifikasi di server.' };
      } catch (e: any) {
        console.warn("verifyOrOverrideMaterialSnapshot remote error:", e);
        return { success: false, message: e?.message || 'Gagal menghubungi server database.' };
      }
    }

    return { success: true, message: `Materi berhasil diproses (${action}) secara lokal.` };
  },

  async reopenMaterialSnapshot(
    snapshotId: string,
    reason: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak membuka kembali materi final.' };
    }
    if (!reason || !reason.trim()) {
      return { success: false, message: 'Wajib mencantumkan alasan pembukaan kembali materi.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('reopen_material_snapshot', {
          p_username: u.username,
          p_password: u.password,
          p_snapshot_id: snapshotId,
          p_reason: reason
        });
        if (!error && data?.success) {
          return { success: true, message: data.message };
        }
        return { success: false, message: data?.message || error?.message || 'Gagal membuka kembali materi di server.' };
      } catch (e: any) {
        console.warn("reopenMaterialSnapshot remote error:", e);
        return { success: false, message: e?.message || 'Gagal menghubungi server database.' };
      }
    }

    return { success: true, message: 'Materi berhasil dibuka kembali (Lokal).' };
  },

  async bulkFinalizeMaterialSnapshots(
    periodId: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; finalizedCount?: number; skippedNeedsReview?: number; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak melakukan finalisasi massal.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('bulk_finalize_material_snapshots', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: periodId
        });
        if (!error && data?.success) {
          return {
            success: true,
            finalizedCount: data.finalizedCount,
            skippedNeedsReview: data.skippedNeedsReview,
            message: data.message
          };
        }
        return { success: false, message: data?.message || error?.message || 'Gagal melakukan finalisasi massal di server.' };
      } catch (e: any) {
        console.warn("bulkFinalizeMaterialSnapshots remote error:", e);
        return { success: false, message: e?.message || 'Gagal menghubungi server database.' };
      }
    }

    return { success: true, finalizedCount: 0, skippedNeedsReview: 0, message: 'Finalisasi massal berhasil (Lokal).' };
  },

  async getTahfizEvaluationData(
    periodId: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; data?: TahfizEvaluationData; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role === 'parent') {
      return { success: false, message: 'Akses ditolak: Parent tidak memiliki akses ke data evaluasi.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_tahfiz_evaluation_data', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: periodId
        });
        if (!error && data?.success) {
          const rawParticipants = data.participants;
          const rawSnapshots = data.materialSnapshots;
          const rawAuditLogs = data.auditLogs;

          const evalData: TahfizEvaluationData = (data.data || {
            period: data.period,
            academicTerm: data.academicTerm,
            participants: (Array.isArray(rawParticipants) ? rawParticipants : (typeof rawParticipants === 'string' ? JSON.parse(rawParticipants) : [])) || [],
            materialSnapshots: (Array.isArray(rawSnapshots) ? rawSnapshots : (typeof rawSnapshots === 'string' ? JSON.parse(rawSnapshots) : [])) || [],
            auditLogs: (Array.isArray(rawAuditLogs) ? rawAuditLogs : (typeof rawAuditLogs === 'string' ? JSON.parse(rawAuditLogs) : [])) || []
          }) as TahfizEvaluationData;

          if (evalData && (evalData.period || (evalData.participants && evalData.participants.length > 0))) {
            this.saveLocalEvaluationData(periodId, evalData);
            return { success: true, data: evalData };
          }
        }
        if (data?.message) {
          const cached = this.getLocalEvaluationData(periodId);
          if (cached) {
            return { success: true, data: cached };
          }
          return { success: false, message: data.message };
        }
      } catch (e: any) {
        console.warn("getTahfizEvaluationData remote error, fallback to local:", e);
      }
    }

    const cached = this.getLocalEvaluationData(periodId);
    if (cached) {
      return { success: true, data: cached };
    }

    return { success: false, message: 'Data evaluasi tidak ditemukan pada server maupun penyimpanan lokal.' };
  },

  // ============================================================
  // TAHAP 5A: GENERATOR SOAL UTS TAHFIZ (5 ZONA MATERI)
  // ============================================================

  getLocalQuestionSets(periodId: string): { sets: ExamQuestionSet[]; questions: Record<string, ExamQuestion[]> } {
    try {
      const raw = localStorage.getItem(`sita_uts_question_sets_${periodId}`);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { sets: [], questions: {} };
  },

  saveLocalQuestionSet(periodId: string, set: ExamQuestionSet, questions: ExamQuestion[]) {
    try {
      const current = this.getLocalQuestionSets(periodId);
      const existingIdx = current.sets.findIndex(s => s.studentId === set.studentId && s.version === set.version);
      if (existingIdx >= 0) {
        current.sets[existingIdx] = set;
      } else {
        current.sets.unshift(set);
      }
      current.questions[set.id] = questions;
      localStorage.setItem(`sita_uts_question_sets_${periodId}`, JSON.stringify(current));
    } catch (e) {}
  },

  async generateUTSQuestionSet(
    params: {
      periodId: string;
      studentId: string;
      strategy?: UTSGenerationStrategy;
      questions: ExamQuestion[];
      seed: string;
      fingerprint: string;
    },
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    isExisting?: boolean;
    questionSet?: ExamQuestionSet;
    questions?: ExamQuestion[];
    message?: string;
  }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak membuat soal ujian UTS.' };
    }

    const payloadQuestions = params.questions.map(q => ({
      questionNumber: q.questionNumber,
      zoneNumber: q.zoneNumber,
      sourceType: q.sourceType,
      questionBankId: q.questionBankId || null,
      promptStartSurah: q.promptStartSurah,
      promptStartAyah: q.promptStartAyah,
      promptStartWord: q.promptStartWord,
      promptEndSurah: q.promptEndSurah,
      promptEndAyah: q.promptEndAyah,
      promptEndWord: q.promptEndWord,
      answerStartSurah: q.answerStartSurah,
      answerStartAyah: q.answerStartAyah,
      answerStartWord: q.answerStartWord,
      answerEndSurah: q.answerEndSurah,
      answerEndAyah: q.answerEndAyah,
      answerEndWord: q.answerEndWord,
      startPage: q.startPage || null,
      endPage: q.endPage || null,
      generatedMetadata: q.generatedMetadata || {}
    }));

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('generate_uts_question_set', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: params.periodId,
          p_student_id: params.studentId,
          p_strategy: params.strategy || 'hybrid',
          p_questions_data: payloadQuestions,
          p_seed: params.seed,
          p_fingerprint: params.fingerprint
        });

        if (!error && data?.success) {
          if (data.questionSet && data.questions) {
            this.saveLocalQuestionSet(params.periodId, data.questionSet, data.questions);
          }
          return {
            success: true,
            isExisting: data.isExisting,
            questionSet: data.questionSet,
            questions: data.questions,
            message: data.message
          };
        }
        return { success: false, message: data?.message || error?.message || 'Gagal menyimpan soal UTS ke Supabase.' };
      } catch (e: any) {
        console.error("generateUTSQuestionSet remote error:", e);
        return { success: false, message: e?.message || 'Gagal menghubungi server Supabase saat generate soal UTS.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif. Paket soal resmi hanya dapat dibuat langsung di Supabase.'
    };
  },

  async regenerateUTSQuestionSet(
    params: {
      periodId: string;
      studentId: string;
      strategy?: UTSGenerationStrategy;
      questions: ExamQuestion[];
      seed: string;
      fingerprint: string;
      reason: string;
    },
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    questionSet?: ExamQuestionSet;
    questions?: ExamQuestion[];
    message?: string;
  }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak men-generate ulang soal UTS.' };
    }
    if (!params.reason || !params.reason.trim()) {
      return { success: false, message: 'Wajib mencantumkan alasan pembuatan ulang (regenerate) soal.' };
    }

    const payloadQuestions = params.questions.map(q => ({
      questionNumber: q.questionNumber,
      zoneNumber: q.zoneNumber,
      sourceType: q.sourceType,
      questionBankId: q.questionBankId || null,
      promptStartSurah: q.promptStartSurah,
      promptStartAyah: q.promptStartAyah,
      promptStartWord: q.promptStartWord,
      promptEndSurah: q.promptEndSurah,
      promptEndAyah: q.promptEndAyah,
      promptEndWord: q.promptEndWord,
      answerStartSurah: q.answerStartSurah,
      answerStartAyah: q.answerStartAyah,
      answerStartWord: q.answerStartWord,
      answerEndSurah: q.answerEndSurah,
      answerEndAyah: q.answerEndAyah,
      answerEndWord: q.answerEndWord,
      startPage: q.startPage || null,
      endPage: q.endPage || null,
      generatedMetadata: q.generatedMetadata || {}
    }));

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('regenerate_uts_question_set', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: params.periodId,
          p_student_id: params.studentId,
          p_strategy: params.strategy || 'hybrid',
          p_questions_data: payloadQuestions,
          p_seed: params.seed,
          p_fingerprint: params.fingerprint,
          p_reason: params.reason
        });

        if (!error && data?.success) {
          if (data.questionSet && data.questions) {
            this.saveLocalQuestionSet(params.periodId, data.questionSet, data.questions);
          }
          return {
            success: true,
            questionSet: data.questionSet,
            questions: data.questions,
            message: data.message
          };
        }
        return { success: false, message: data?.message || error?.message || 'Gagal meregenerate soal UTS di Supabase.' };
      } catch (e: any) {
        console.error("regenerateUTSQuestionSet remote error:", e);
        return { success: false, message: e?.message || 'Gagal menghubungi server Supabase saat generate ulang soal UTS.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif. Pembuatan ulang soal resmi hanya dapat dilakukan di Supabase.'
    };
  },

  async getUTSQuestionSet(
    periodId: string,
    studentId: string,
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    hasQuestionSet?: boolean;
    isStale?: boolean;
    questionSet?: ExamQuestionSet;
    questions?: ExamQuestion[];
    message?: string;
  }> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role === 'parent') {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_uts_question_set', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: periodId,
          p_student_id: studentId
        });

        if (!error && data?.success) {
          return {
            success: true,
            hasQuestionSet: data.hasQuestionSet,
            isStale: data.isStale,
            questionSet: data.questionSet,
            questions: data.questions || []
          };
        }
        if (data?.message) {
          return { success: false, message: data.message };
        }
      } catch (e: any) {
        console.warn("getUTSQuestionSet remote error, reading read-only cache:", e);
      }
    }

    // Fallback to local storage (hanya jika koneksi ke server benar-benar terputus secara fisik)
    const local = this.getLocalQuestionSets(periodId);
    const set = local.sets.find(s => s.studentId === studentId && (s.status === 'locked' || s.status === 'stale'));
    if (set) {
      const questions = local.questions[set.id] || [];
      return {
        success: true,
        hasQuestionSet: true,
        isStale: set.status === 'stale',
        questionSet: set,
        questions
      };
    }

    return { success: true, hasQuestionSet: false, message: 'Soal UTS belum dibuat.' };
  },

  async getPeriodQuestionSetsSummary(
    periodId: string,
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    data?: Array<{
      studentId: string;
      studentName: string;
      class: string;
      halaqah: string;
      questionSetId?: string | null;
      status?: string | null;
      version?: number | null;
      generatedAt?: string | null;
      hasQuestions: boolean;
    }>;
    message?: string;
  }> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role === 'parent') {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_period_question_sets_summary', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: periodId
        });

        if (!error && data?.success) {
          return { success: true, data: data.data || [] };
        }
      } catch (e: any) {
        console.warn("getPeriodQuestionSetsSummary remote error, fallback to local:", e);
      }
    }

    // Fallback to local storage
    const local = this.getLocalQuestionSets(periodId);
    const summary = local.sets.map(s => ({
      studentId: s.studentId,
      studentName: '',
      class: '',
      halaqah: '',
      questionSetId: s.id,
      status: s.status,
      version: s.version,
      generatedAt: s.generatedAt,
      hasQuestions: true
    }));

    return { success: true, data: summary };
  },

  // ============================================================
  // TAHAP 6A: ENGINE GENERATOR SOAL UAS TAHFIZ (9 SOAL)
  // ============================================================

  async generateUASQuestionSet(
    params: {
      periodId: string;
      studentId: string;
      strategy?: UASGenerationStrategy;
      questions: GeneratedUASQuestion[];
      seed?: string;
    },
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    isExisting?: boolean;
    questionSet?: ExamQuestionSet;
    questions?: ExamQuestion[];
    message?: string;
  }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak men-generate soal UAS.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('generate_uas_question_set', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: params.periodId,
          p_student_id: params.studentId,
          p_strategy: params.strategy || 'hybrid',
          p_seed: params.seed || null,
          p_questions: params.questions
        });

        if (!error && data?.success) {
          if (data.questionSet && data.questions) {
            this.saveLocalQuestionSet(params.periodId, data.questionSet, data.questions);
          }
          return {
            success: true,
            isExisting: data.isExisting,
            questionSet: data.questionSet,
            questions: data.questions,
            message: data.message
          };
        }
        return { success: false, message: data?.message || error?.message || 'Gagal menyimpan soal UAS ke Supabase.' };
      } catch (e: any) {
        console.error("generateUASQuestionSet remote error:", e);
        return { success: false, message: e?.message || 'Gagal menghubungi server Supabase saat generate soal UAS.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif. Paket soal resmi hanya dapat dibuat langsung di Supabase.'
    };
  },

  async regenerateUASQuestionSet(
    params: {
      periodId: string;
      studentId: string;
      strategy?: UASGenerationStrategy;
      questions: GeneratedUASQuestion[];
      seed?: string;
      reason: string;
    },
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    questionSet?: ExamQuestionSet;
    questions?: ExamQuestion[];
    message?: string;
  }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak men-generate ulang soal UAS.' };
    }
    if (!params.reason || !params.reason.trim()) {
      return { success: false, message: 'Wajib mencantumkan alasan pembuatan ulang (regenerate) soal.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('regenerate_uas_question_set', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: params.periodId,
          p_student_id: params.studentId,
          p_reason: params.reason,
          p_strategy: params.strategy || 'hybrid',
          p_seed: params.seed || null,
          p_questions: params.questions
        });

        if (!error && data?.success) {
          if (data.questionSet && data.questions) {
            this.saveLocalQuestionSet(params.periodId, data.questionSet, data.questions);
          }
          return {
            success: true,
            questionSet: data.questionSet,
            questions: data.questions,
            message: data.message
          };
        }
        return { success: false, message: data?.message || error?.message || 'Gagal meregenerate soal UAS di Supabase.' };
      } catch (e: any) {
        console.error("regenerateUASQuestionSet remote error:", e);
        return { success: false, message: e?.message || 'Gagal menghubungi server Supabase saat generate ulang soal UAS.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif. Pembuatan ulang soal resmi hanya dapat dilakukan di Supabase.'
    };
  },

  async getUASQuestionSet(
    periodId: string,
    studentId: string,
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    hasQuestionSet?: boolean;
    isStale?: boolean;
    questionSet?: ExamQuestionSet;
    questions?: ExamQuestion[];
    message?: string;
  }> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role === 'parent') {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_uas_question_set', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: periodId,
          p_student_id: studentId
        });

        if (!error && data?.success) {
          return {
            success: true,
            hasQuestionSet: true,
            isStale: data.isStale,
            questionSet: data.questionSet,
            questions: data.questions || []
          };
        }
        if (data?.message) {
          return { success: false, message: data.message };
        }
      } catch (e: any) {
        console.warn("getUASQuestionSet remote error, reading read-only cache:", e);
      }
    }

    // Fallback to local storage
    const local = this.getLocalQuestionSets(periodId);
    const set = local.sets.find(s => s.studentId === studentId && (s.status === 'locked' || s.status === 'stale'));
    if (set) {
      const questions = local.questions[set.id] || [];
      return {
        success: true,
        hasQuestionSet: true,
        isStale: set.status === 'stale',
        questionSet: set,
        questions
      };
    }

    return { success: true, hasQuestionSet: false, message: 'Soal UAS belum dibuat.' };
  },

  // ============================================================
  // TAHAP 5B: PELAKSANAAN & PENILAIAN UTS TAHFIZ (PENGUJI)
  // ============================================================

  getLocalExaminerAssignments(periodId: string): ExamExaminerAssignment[] {
    try {
      const raw = localStorage.getItem(`sita_uts_examiner_assignments_${periodId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      }
    } catch (e) {}
    return [];
  },

  saveLocalExaminerAssignment(periodId: string, assignment: ExamExaminerAssignment) {
    if (!assignment) return;
    try {
      const list = this.getLocalExaminerAssignments(periodId).filter(Boolean);
      const idx = list.findIndex(a => a && a.studentId === assignment.studentId);
      if (idx >= 0) {
        list[idx] = assignment;
      } else {
        list.push(assignment);
      }
      localStorage.setItem(`sita_uts_examiner_assignments_${periodId}`, JSON.stringify(list));
    } catch (e) {}
  },

  getLocalAttempts(periodId: string): ExamAttempt[] {
    try {
      const raw = localStorage.getItem(`sita_uts_attempts_${periodId}`);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  },

  saveLocalAttempt(periodId: string, attempt: ExamAttempt) {
    try {
      const list = this.getLocalAttempts(periodId);
      const idx = list.findIndex(a => a.id === attempt.id);
      if (idx >= 0) {
        list[idx] = attempt;
      } else {
        list.push(attempt);
      }
      localStorage.setItem(`sita_uts_attempts_${periodId}`, JSON.stringify(list));
    } catch (e) {}
  },

  findLocalAttemptById(attemptId: string): { attempt: ExamAttempt; periodId: string } | null {
    try {
      if (typeof localStorage === 'undefined') return null;

      // Check all possible keys in localStorage
      const allKeys = new Set<string>();
      try {
        Object.keys(localStorage).forEach(k => allKeys.add(k));
      } catch (e) {}

      const len = localStorage.length || 0;
      for (let i = 0; i < len; i++) {
        try {
          const k = localStorage.key ? localStorage.key(i) : null;
          if (k) allKeys.add(k);
        } catch (e) {}
      }

      for (const key of allKeys) {
        if (key && (key.startsWith('sita_uts_attempts_') || key.startsWith('sita_uas_attempts_'))) {
          const periodId = key.replace('sita_uts_attempts_', '').replace('sita_uas_attempts_', '');
          const raw = localStorage.getItem(key);
          if (raw) {
            try {
              const list: ExamAttempt[] = JSON.parse(raw);
              const found = list.find(a => a && a.id === attemptId);
              if (found) return { attempt: found, periodId };
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
    return null;
  },

  getLocalQuestionAssessments(attemptId: string): ExamQuestionAssessment[] {
    try {
      let raw = localStorage.getItem(`sita_uas_assessments_${attemptId}`);
      if (!raw) {
        raw = localStorage.getItem(`sita_uts_assessments_${attemptId}`);
      }
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  },

  saveLocalQuestionAssessments(attemptId: string, assessments: ExamQuestionAssessment[]) {
    try {
      if (attemptId.includes('uas')) {
        localStorage.setItem(`sita_uas_assessments_${attemptId}`, JSON.stringify(assessments));
      } else {
        localStorage.setItem(`sita_uts_assessments_${attemptId}`, JSON.stringify(assessments));
      }
    } catch (e) {}
  },

  getLocalUASAttempts(periodId: string): ExamAttempt[] {
    try {
      const raw = localStorage.getItem(`sita_uas_attempts_${periodId}`);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  },

  saveLocalUASAttempt(periodId: string, attempt: ExamAttempt) {
    try {
      const list = this.getLocalUASAttempts(periodId);
      const idx = list.findIndex(a => a.id === attempt.id);
      if (idx >= 0) {
        list[idx] = attempt;
      } else {
        list.push(attempt);
      }
      localStorage.setItem(`sita_uas_attempts_${periodId}`, JSON.stringify(list));
    } catch (e) {}
  },

  async assignExaminer(
    params: {
      periodId: string;
      studentId: string;
      examinerId: string;
      reason?: string;
    },
    userOverride?: User | null
  ): Promise<{ success: boolean; message?: string; assignment?: ExamExaminerAssignment }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak menugaskan penguji.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('assign_examiner_secure', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: params.periodId,
          p_student_id: params.studentId,
          p_examiner_id: params.examinerId,
          p_reason: params.reason || null
        });

        if (!error && data) {
          if (data.success && data.assignment) {
            this.saveLocalExaminerAssignment(params.periodId, data.assignment);
          }
          return data;
        }
      } catch (e: any) {
        console.warn("assignExaminer remote error, fallback to local:", e);
      }
    }

    // Local fallback
    const attempts = [...this.getLocalAttempts(params.periodId), ...this.getLocalUASAttempts(params.periodId)];
    const existingAttempt = attempts.find(at => at.studentId === params.studentId);
    if (existingAttempt?.status === 'submitted') {
      return { success: false, message: 'Tidak dapat mengubah penguji: Ujian santri ini sudah diselesaikan (submitted).' };
    }
    if (existingAttempt?.status === 'in_progress') {
      if (!params.reason || !params.reason.trim()) {
        return { success: false, message: 'Sesi ujian santri sedang berjalan (in_progress). Wajib mencantumkan alasan pengalihan/penggantian penguji.' };
      }
      existingAttempt.examinerUserId = params.examinerId;
      if (existingAttempt.id && existingAttempt.id.startsWith('att_uas_')) {
        this.saveLocalUASAttempt(params.periodId, existingAttempt);
      } else {
        this.saveLocalAttempt(params.periodId, existingAttempt);
      }
    }

    const cloud = await this.load(u);
    const users = cloud?.users || MOCK_USERS;
    const examiner = users.find(x => x.id === params.examinerId);
    const assignment: ExamExaminerAssignment = {
      id: `eea_${params.periodId}_${params.studentId}`,
      examPeriodId: params.periodId,
      studentId: params.studentId,
      examinerUserId: params.examinerId,
      examinerName: examiner?.name || '',
      assignedBy: u.id,
      assignedAt: new Date().toISOString(),
      status: 'assigned'
    };
    this.saveLocalExaminerAssignment(params.periodId, assignment);
    return { success: true, message: 'Penguji berhasil ditugaskan (lokal).', assignment };
  },

  async getExaminerUTSStudents(
    periodId: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; message?: string; period?: any; students?: ExaminerStudentItem[] }> {
    const u = userOverride || getLoggedUser();
    if (!u || (u.role !== 'admin' && u.role !== 'teacher')) {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_examiner_uts_students', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: periodId
        });

        if (!error && data?.success) {
          return {
            success: true,
            period: data.period,
            students: data.students || []
          };
        }
      } catch (e: any) {
        console.warn("getExaminerUTSStudents remote error, fallback to local:", e);
      }
    }

    // Fallback lokal
    const evalData = await this.getTahfizEvaluationData(periodId, u);
    if (!evalData.success || !evalData.data) {
      return { success: false, message: evalData.message || 'Gagal memuat data evaluasi.' };
    }

    const { period, participants, materialSnapshots } = evalData.data;
    const cloud = await this.load(u);
    const students = cloud?.students || MOCK_STUDENTS;
    const users = cloud?.users || MOCK_USERS;
    const qSets = this.getLocalQuestionSets(periodId);
    const assignments = this.getLocalExaminerAssignments(periodId);
    const attempts = this.getLocalAttempts(periodId);

    const result: ExaminerStudentItem[] = [];

    for (const p of participants) {
      const s = students.find(x => x.id === p.studentId) || {
        id: p.studentId,
        name: (p as any).studentName || `Santri ${p.studentId}`,
        nis: (p as any).nis || '-',
        class: (p as any).class || '-',
        halaqah: (p as any).halaqah || '-',
        teacherId: (p as any).teacherIdSnapshot || ''
      };

      const assignment = assignments.find(a => a && a.studentId === p.studentId);
      const assignedExaminerId = assignment?.examinerUserId;
      const examiner = users.find(usr => usr.id === assignedExaminerId);
      const teacher = users.find(usr => usr.id === s.teacherId);

      // Filtering per role:
      // Admin sees all.
      // Teacher sees students explicitly assigned to them, or their own halaqah students if no assignment yet
      if (u.role === 'teacher') {
        const isAssigned = assignedExaminerId === u.id;
        const isHalaqahTeacher = !assignedExaminerId && (
          s.teacherId === u.id || 
          (p as any).teacherIdSnapshot === u.id || 
          s.halaqah?.toLowerCase().includes(u.name.toLowerCase())
        );
        if (!isAssigned && !isHalaqahTeacher) {
          continue;
        }
      }

      const snap = materialSnapshots.find(m => m.studentId === p.studentId);
      const qSet = qSets.sets.find(qs => qs.studentId === p.studentId && (qs.status === 'locked' || qs.status === 'stale'));
      const att = attempts.find(at => at.studentId === p.studentId && at.status !== 'void');
      const assessments = att ? this.getLocalQuestionAssessments(att.id) : [];
      const completedQuestionsCount = assessments.filter(a => !!a.completedAt).length;

      result.push({
        studentId: s.id,
        studentName: s.name,
        studentNis: s.nis,
        class: s.class,
        halaqah: s.halaqah,
        teacherId: s.teacherId,
        teacherName: teacher?.name || '',
        examinerId: assignedExaminerId,
        examinerName: examiner?.name || '',
        hasAssignment: !!assignment,
        snapshotId: snap?.id,
        snapshotStatus: snap?.status,
        startSurahName: snap?.startSurahName,
        startAyah: snap?.startAyah,
        endSurahName: snap?.endSurahName,
        endAyah: snap?.endAyah,
        memorizationDirection: snap?.memorizationDirection,
        questionSetId: qSet?.id,
        questionSetStatus: qSet?.status,
        isStale: qSet?.status === 'stale',
        attemptId: att?.id,
        attemptStatus: att?.status,
        attemptNumber: att?.attemptNumber,
        totalScore: att?.totalScore,
        startedAt: att?.startedAt,
        submittedAt: att?.submittedAt,
        completedQuestionsCount
      });
    }

    result.sort((a, b) => a.class.localeCompare(b.class) || a.studentName.localeCompare(b.studentName));

    return {
      success: true,
      period: {
        id: period.id,
        name: period.name,
        kkm: period.kkm,
        status: period.status
      },
      students: result
    };
  },

  async startUTSAttempt(
    params: {
      periodId: string;
      studentId: string;
    },
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    message?: string;
    attempt?: ExamAttempt;
    kkm?: number;
    questions?: ExamQuestion[];
    assessments?: ExamQuestionAssessment[];
  }> {
    const u = userOverride || getLoggedUser();
    if (!u || (u.role !== 'admin' && u.role !== 'teacher')) {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('start_uts_attempt', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: params.periodId,
          p_student_id: params.studentId
        });

        if (!error && data) {
          if (data.success && data.attempt) {
            this.saveLocalAttempt(params.periodId, data.attempt);
            if (data.assessments) {
              this.saveLocalQuestionAssessments(data.attempt.id, data.assessments);
            }
          }
          return data;
        }
      } catch (e: any) {
        console.warn("startUTSAttempt remote error, fallback to local:", e);
      }
    }

    // Local fallback
    const evalData = await this.getTahfizEvaluationData(params.periodId, u);
    if (!evalData.success || !evalData.data) {
      return { success: false, message: 'Gagal memuat data evaluasi.' };
    }

    const { period, participants, materialSnapshots } = evalData.data;
    if (period.status === 'completed') {
      return { success: false, message: 'Periode ujian telah selesai dan terkunci.' };
    }

    const participant = participants.find(p => p.studentId === params.studentId);
    if (!participant) {
      return { success: false, message: 'Santri bukan peserta resmi periode ujian ini.' };
    }

    // Teacher explicit assignment check (no halaqah fallback)
    const assignments = this.getLocalExaminerAssignments(params.periodId);
    const assignment = assignments.find(a => a && a.studentId === params.studentId);
    if (!assignment) {
      return { success: false, message: 'Akses ditolak: Penguji belum ditugaskan untuk santri ini.' };
    }
    if (u.role === 'teacher' && assignment.examinerUserId !== u.id) {
      return { success: false, message: 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk santri ini.' };
    }

    const snap = materialSnapshots.find(m => m.studentId === params.studentId);
    if (!snap || snap.status !== 'finalized') {
      return { success: false, message: 'Prasyarat gagal: Materi UTS santri belum difinalisasi.' };
    }

    const qSets = this.getLocalQuestionSets(params.periodId);
    const qSet = qSets.sets.find(qs => qs.studentId === params.studentId && qs.status === 'locked');
    if (!qSet) {
      return { success: false, message: 'Prasyarat gagal: Paket soal UTS belum dibuat atau terkunci.' };
    }

    const questions = qSets.questions[qSet.id] || [];
    if (questions.length !== 5) {
      return { success: false, message: 'Prasyarat gagal: Paket soal tidak memiliki tepat 5 butir soal.' };
    }

    // Existing attempt
    const attempts = this.getLocalAttempts(params.periodId);
    let attempt = attempts.find(at => at.studentId === params.studentId && at.status !== 'void');

    let assessments: ExamQuestionAssessment[] = [];
    if (attempt) {
      if (attempt.status === 'submitted') {
        return { success: false, message: 'Ujian santri ini sudah selesai dan telah dikirim (submitted).' };
      }
      assessments = this.getLocalQuestionAssessments(attempt.id);
    } else {
      const attemptId = `att_${params.periodId}_${params.studentId}_a1`;
      attempt = {
        id: attemptId,
        examPeriodId: params.periodId,
        studentId: params.studentId,
        questionSetId: qSet.id,
        examinerUserId: u.id,
        attemptNumber: 1,
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
        totalScore: 100
      };
      this.saveLocalAttempt(params.periodId, attempt);

      // Create 5 empty assessments: default score 20, but completedAt MUST BE null!
      assessments = questions.map(q => ({
        id: `aqa_${attemptId}_q${q.questionNumber}`,
        examAttemptId: attemptId,
        examQuestionId: q.id,
        questionNumber: q.questionNumber,
        fluencyScore: 12,
        tajwidScore: 4,
        makhrajScore: 4,
        fluencyEvents: [],
        tajwidEvents: [],
        makhrajEvents: [],
        questionScore: 20,
        notes: '',
        startedAt: new Date().toISOString(),
        completedAt: null,
        version: 1
      }));
      this.saveLocalQuestionAssessments(attemptId, assessments);
    }

    return {
      success: true,
      attempt,
      kkm: period.kkm,
      questions,
      assessments
    };
  },

  async saveUTSQuestionAssessment(
    params: {
      attemptId: string;
      questionNumber: number;
      expectedVersion?: number;
      markCompleted?: boolean;
      assessmentData: {
        fluencyEvents: UTSAssessmentEvent[];
        tajwidEvents: UTSAssessmentEvent[];
        makhrajEvents: UTSAssessmentEvent[];
        notes?: string;
        isCompleted?: boolean;
      };
    },
    userOverride?: User | null
  ): Promise<{ success: boolean; isConflict?: boolean; message?: string; assessment?: any }> {
    const u = userOverride || getLoggedUser();
    if (!u || (u.role !== 'admin' && u.role !== 'teacher')) {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('save_uts_question_assessment', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: params.attemptId,
          p_question_number: params.questionNumber,
          p_assessment_data: params.assessmentData,
          p_expected_version: params.expectedVersion ?? null,
          p_mark_completed: params.markCompleted ?? params.assessmentData.isCompleted ?? false
        });

        if (!error && data) {
          return data;
        }
      } catch (e: any) {
        console.warn("saveUTSQuestionAssessment remote error, fallback to local:", e);
      }
    }

    // Check attempt status (read-only if submitted)
    const foundAtt = this.findLocalAttemptById(params.attemptId);
    if (foundAtt && foundAtt.attempt.status === 'submitted') {
      return { success: false, message: 'Ujian telah diselesaikan (submitted) dan bersifat read-only.' };
    }

    // Local fallback
    const assessments = this.getLocalQuestionAssessments(params.attemptId);
    const idx = assessments.findIndex(a => a.questionNumber === params.questionNumber);
    if (idx < 0) {
      return { success: false, message: 'Data soal tidak ditemukan pada sesi ujian.' };
    }

    const currentAsm = assessments[idx];
    if (params.expectedVersion !== undefined && currentAsm.version !== undefined && currentAsm.version !== params.expectedVersion) {
      return {
        success: false,
        isConflict: true,
        message: 'Data ujian berubah di perangkat lain. Muat ulang data terbaru.'
      };
    }

    // Validate events whitelist and server calculation
    const validFluency = ['self_correction', 'reminder', 'prompt', 'unable'];
    let fDeduction = 0;
    for (const ev of (params.assessmentData.fluencyEvents || [])) {
      if (!validFluency.includes(ev.type)) {
        return { success: false, message: `Event kelancaran tidak dikenal: ${ev.type}` };
      }
      if (ev.type === 'self_correction') fDeduction += 0.5;
      else if (ev.type === 'reminder') fDeduction += 1.0;
      else if (ev.type === 'prompt') fDeduction += 2.0;
      else if (ev.type === 'unable') fDeduction += 4.0;
    }
    const fScore = Math.max(0, 12 - fDeduction);

    const validTajwid = ['minor', 'major'];
    let tDeduction = 0;
    for (const ev of (params.assessmentData.tajwidEvents || [])) {
      if (!validTajwid.includes(ev.type)) {
        return { success: false, message: `Event tajwid tidak dikenal: ${ev.type}` };
      }
      if (ev.type === 'minor') tDeduction += 0.5;
      else if (ev.type === 'major') tDeduction += 1.0;
    }
    const tScore = Math.max(0, 4 - tDeduction);

    const validMakhraj = ['minor', 'major'];
    let mDeduction = 0;
    for (const ev of (params.assessmentData.makhrajEvents || [])) {
      if (!validMakhraj.includes(ev.type)) {
        return { success: false, message: `Event makhraj tidak dikenal: ${ev.type}` };
      }
      if (ev.type === 'minor') mDeduction += 0.5;
      else if (ev.type === 'major') mDeduction += 1.0;
    }
    const mScore = Math.max(0, 4 - mDeduction);

    const qScore = Math.round((fScore + tScore + mScore) * 100) / 100;
    const newVersion = (currentAsm.version || 1) + 1;
    const isCompleted = params.markCompleted ?? params.assessmentData.isCompleted ?? false;
    const newCompletedAt = isCompleted ? (currentAsm.completedAt || new Date().toISOString()) : currentAsm.completedAt;

    assessments[idx] = {
      ...currentAsm,
      fluencyScore: fScore,
      tajwidScore: tScore,
      makhrajScore: mScore,
      fluencyEvents: params.assessmentData.fluencyEvents || [],
      tajwidEvents: params.assessmentData.tajwidEvents || [],
      makhrajEvents: params.assessmentData.makhrajEvents || [],
      questionScore: qScore,
      notes: params.assessmentData.notes || '',
      completedAt: newCompletedAt,
      version: newVersion,
      updatedAt: new Date().toISOString()
    };

    this.saveLocalQuestionAssessments(params.attemptId, assessments);

    return {
      success: true,
      message: `Penilaian soal ${params.questionNumber} berhasil disimpan.`,
      assessment: {
        questionNumber: params.questionNumber,
        fluencyScore: fScore,
        tajwidScore: tScore,
        makhrajScore: mScore,
        questionScore: qScore,
        completedAt: newCompletedAt,
        version: newVersion,
        lastSavedAt: new Date().toISOString()
      }
    };
  },

  async getUTSAttempt(
    attemptId: string,
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    message?: string;
    attempt?: ExamAttempt;
    kkm?: number;
    questions?: ExamQuestion[];
    assessments?: ExamQuestionAssessment[];
  }> {
    const u = userOverride || getLoggedUser();
    if (!u || (u.role !== 'admin' && u.role !== 'teacher')) {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_uts_attempt', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: attemptId
        });

        if (!error && data) {
          return data;
        }
      } catch (e: any) {
        console.warn("getUTSAttempt remote error, fallback to local:", e);
      }
    }

    // Local fallback: search across attempts
    const assessments = this.getLocalQuestionAssessments(attemptId);
    return {
      success: true,
      assessments
    };
  },

  async submitUTSAttempt(
    attemptId: string,
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    isExisting?: boolean;
    message?: string;
    totalScore?: number;
    kkm?: number;
    isPassed?: boolean;
    submittedAt?: string;
  }> {
    const u = userOverride || getLoggedUser();
    if (!u || (u.role !== 'admin' && u.role !== 'teacher')) {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('submit_uts_attempt', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: attemptId
        });

        if (!error && data) {
          return data;
        }
      } catch (e: any) {
        console.warn("submitUTSAttempt remote error, fallback to local:", e);
      }
    }

    // Local fallback
    const foundAtt = this.findLocalAttemptById(attemptId);
    if (foundAtt && foundAtt.attempt.status === 'submitted') {
      return {
        success: true,
        isExisting: true,
        totalScore: foundAtt.attempt.totalScore,
        kkm: 75,
        isPassed: (foundAtt.attempt.totalScore || 0) >= 75,
        submittedAt: foundAtt.attempt.submittedAt || new Date().toISOString(),
        message: 'Ujian sudah disubmit sebelumnya.'
      };
    }

    const assessments = this.getLocalQuestionAssessments(attemptId);
    const completedCount = assessments.filter(a => !!a.completedAt).length;
    if (assessments.length !== 5 || completedCount !== 5) {
      return {
        success: false,
        message: `Validasi gagal: Seluruh 5 butir soal wajib diselesaikan (completed) sebelum submit final. Saat ini ${completedCount} dari 5 soal selesai.`
      };
    }

    // Authoritative recalculation
    let totalCalculated = 0;
    for (let i = 0; i < assessments.length; i++) {
      const a = assessments[i];
      let fDed = 0;
      for (const ev of (a.fluencyEvents || [])) {
        if (ev.type === 'self_correction') fDed += 0.5;
        else if (ev.type === 'reminder') fDed += 1.0;
        else if (ev.type === 'prompt') fDed += 2.0;
        else if (ev.type === 'unable') fDed += 4.0;
      }
      const fScore = Math.max(0, 12 - fDed);

      let tDed = 0;
      for (const ev of (a.tajwidEvents || [])) {
        if (ev.type === 'minor') tDed += 0.5;
        else if (ev.type === 'major') tDed += 1.0;
      }
      const tScore = Math.max(0, 4 - tDed);

      let mDed = 0;
      for (const ev of (a.makhrajEvents || [])) {
        if (ev.type === 'minor') mDed += 0.5;
        else if (ev.type === 'major') mDed += 1.0;
      }
      const mScore = Math.max(0, 4 - mDed);
      const qScore = Math.round((fScore + tScore + mScore) * 100) / 100;

      assessments[i] = {
        ...a,
        fluencyScore: fScore,
        tajwidScore: tScore,
        makhrajScore: mScore,
        questionScore: qScore
      };
      totalCalculated += qScore;
    }

    this.saveLocalQuestionAssessments(attemptId, assessments);
    totalCalculated = Math.round(totalCalculated * 100) / 100;

    // Update attempt status to submitted
    if (foundAtt) {
      foundAtt.attempt.status = 'submitted';
      foundAtt.attempt.totalScore = totalCalculated;
      foundAtt.attempt.submittedAt = new Date().toISOString();
      this.saveLocalAttempt(foundAtt.periodId, foundAtt.attempt);
    }

    return {
      success: true,
      totalScore: totalCalculated,
      kkm: 75,
      isPassed: totalCalculated >= 75,
      submittedAt: new Date().toISOString(),
      message: 'Hasil ujian UTS berhasil dikirim dan difinalisasi.'
    };
  },

  async reopenUTSAttempt(
    params: {
      attemptId: string;
      reason: string;
    },
    userOverride?: User | null
  ): Promise<{ success: boolean; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak membuka kembali ujian.' };
    }

    if (!params.reason || !params.reason.trim()) {
      return { success: false, message: 'Wajib mencantumkan alasan pembukaan kembali ujian.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('reopen_uts_attempt', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: params.attemptId,
          p_reason: params.reason
        });

        if (!error && data) {
          return data;
        }
      } catch (e: any) {
        console.warn("reopenUTSAttempt remote error, fallback to local:", e);
      }
    }

    return {
      success: true,
      message: 'Ujian berhasil dibuka kembali untuk koreksi nilai (lokal).'
    };
  },

  // ============================================================
  // TAHAP 6B: PELAKSANAAN & PENILAIAN UAS TAHFIZ (PENGUJI)
  // ============================================================

  async getExaminerUASStudents(
    periodId: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; message?: string; period?: any; students?: ExaminerStudentItem[] }> {
    const u = userOverride || getLoggedUser();
    if (!u || (u.role !== 'admin' && u.role !== 'teacher')) {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_examiner_uas_students', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: periodId
        });

        if (!error && data?.success) {
          return {
            success: true,
            period: data.period,
            students: data.students || []
          };
        }
      } catch (e: any) {
        console.warn("getExaminerUASStudents remote error, fallback to local:", e);
      }
    }

    // Local fallback
    const evalData = await this.getTahfizEvaluationData(periodId, u);
    if (!evalData.success || !evalData.data) {
      return { success: false, message: evalData.message || 'Gagal memuat data evaluasi.' };
    }

    const { period, participants, materialSnapshots } = evalData.data;
    const cloud = await this.load(u);
    const students = cloud?.students || MOCK_STUDENTS;
    const users = cloud?.users || MOCK_USERS;
    const qSets = this.getLocalQuestionSets(periodId);
    const assignments = this.getLocalExaminerAssignments(periodId);
    const attempts = this.getLocalUASAttempts(periodId);

    const result: ExaminerStudentItem[] = [];

    for (const p of participants) {
      const s = students.find(x => x.id === p.studentId) || {
        id: p.studentId,
        name: (p as any).studentName || `Santri ${p.studentId}`,
        nis: (p as any).nis || '-',
        class: (p as any).class || '-',
        halaqah: (p as any).halaqah || '-',
        teacherId: (p as any).teacherIdSnapshot || ''
      };

      const assignment = assignments.find(a => a && a.studentId === p.studentId);
      const assignedExaminerId = assignment?.examinerUserId;
      const examiner = users.find(usr => usr.id === assignedExaminerId);
      const teacher = users.find(usr => usr.id === s.teacherId);

      // Filtering per role:
      // Admin sees all.
      // Teacher sees students explicitly assigned to them, or their own halaqah students if no assignment yet
      if (u.role === 'teacher') {
        const isAssigned = assignedExaminerId === u.id;
        const isHalaqahTeacher = !assignedExaminerId && (
          s.teacherId === u.id || 
          (p as any).teacherIdSnapshot === u.id || 
          s.halaqah?.toLowerCase().includes(u.name.toLowerCase())
        );
        if (!isAssigned && !isHalaqahTeacher) {
          continue;
        }
      }

      const snap = materialSnapshots.find(m => m.studentId === p.studentId);
      const qSet = qSets.sets.find(qs => qs.studentId === p.studentId && (qs.status === 'locked' || qs.status === 'stale'));
      const att = attempts.find(at => at.studentId === p.studentId && at.status !== 'void');
      const assessments = att ? this.getLocalQuestionAssessments(att.id) : [];
      const completedQuestionsCount = assessments.filter(a => !!a.completedAt).length;

      result.push({
        studentId: s.id,
        studentName: s.name,
        studentNis: s.nis,
        class: s.class,
        halaqah: s.halaqah,
        teacherId: s.teacherId,
        teacherName: teacher?.name || '',
        examinerId: assignedExaminerId,
        examinerName: examiner?.name || '',
        hasAssignment: !!assignment,
        snapshotId: snap?.id,
        snapshotStatus: snap?.status,
        startSurahName: snap?.startSurahName,
        startAyah: snap?.startAyah,
        endSurahName: snap?.endSurahName,
        endAyah: snap?.endAyah,
        memorizationDirection: snap?.memorizationDirection,
        questionSetId: qSet?.id,
        questionSetStatus: qSet?.status,
        isStale: qSet?.status === 'stale',
        attemptId: att?.id,
        attemptStatus: att?.status,
        attemptNumber: att?.attemptNumber,
        totalScore: att?.totalScore,
        startedAt: att?.startedAt,
        submittedAt: att?.submittedAt,
        completedQuestionsCount
      });
    }

    result.sort((a, b) => a.class.localeCompare(b.class) || a.studentName.localeCompare(b.studentName));

    return {
      success: true,
      period: {
        id: period.id,
        name: period.name,
        kkm: period.kkm,
        status: period.status
      },
      students: result
    };
  },

  async startUASAttempt(
    params: {
      periodId: string;
      studentId: string;
    },
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    message?: string;
    attempt?: ExamAttempt;
    kkm?: number;
    questions?: ExamQuestion[];
    assessments?: ExamQuestionAssessment[];
  }> {
    const u = userOverride || getLoggedUser();
    if (!u || (u.role !== 'admin' && u.role !== 'teacher')) {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('start_uas_attempt', {
          p_username: u.username,
          p_password: u.password,
          p_period_id: params.periodId,
          p_student_id: params.studentId
        });

        if (!error && data) {
          if (data.success && data.attempt) {
            this.saveLocalUASAttempt(params.periodId, data.attempt);
            if (data.assessments) {
              this.saveLocalQuestionAssessments(data.attempt.id, data.assessments);
            }
          }
          return data;
        }
      } catch (e: any) {
        console.warn("startUASAttempt remote error, fallback to local:", e);
      }
    }

    // Local fallback
    const evalData = await this.getTahfizEvaluationData(params.periodId, u);
    if (!evalData.success || !evalData.data) {
      return { success: false, message: 'Gagal memuat data evaluasi.' };
    }

    const { period, participants, materialSnapshots } = evalData.data;
    if (period.status === 'completed') {
      return { success: false, message: 'Periode ujian telah selesai dan terkunci.' };
    }

    const participant = participants.find(p => p.studentId === params.studentId);
    if (!participant) {
      return { success: false, message: 'Santri bukan peserta resmi periode ujian ini.' };
    }

    // Teacher explicit assignment check (no halaqah fallback)
    const assignments = this.getLocalExaminerAssignments(params.periodId);
    const assignment = assignments.find(a => a && a.studentId === params.studentId);
    if (!assignment) {
      return { success: false, message: 'Akses ditolak: Penguji belum ditugaskan untuk santri ini.' };
    }
    if (u.role === 'teacher' && assignment.examinerUserId !== u.id) {
      return { success: false, message: 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk santri ini.' };
    }

    const snap = materialSnapshots.find(m => m.studentId === params.studentId);
    if (!snap || snap.status !== 'finalized') {
      return { success: false, message: 'Prasyarat gagal: Materi UAS santri belum difinalisasi.' };
    }

    const qSets = this.getLocalQuestionSets(params.periodId);
    const qSet = qSets.sets.find(qs => qs.studentId === params.studentId && qs.status === 'locked');
    if (!qSet) {
      return { success: false, message: 'Prasyarat gagal: Paket soal UAS belum dibuat atau terkunci.' };
    }

    const questions = qSets.questions[qSet.id] || [];
    if (questions.length !== 9) {
      return { success: false, message: 'Prasyarat gagal: Paket soal tidak memiliki tepat 9 butir soal.' };
    }

    // Existing attempt
    const attempts = this.getLocalUASAttempts(params.periodId);
    let attempt = attempts.find(at => at.studentId === params.studentId && at.status !== 'void');

    let assessments: ExamQuestionAssessment[] = [];
    if (attempt) {
      if (attempt.status === 'submitted') {
        return { success: false, message: 'Ujian santri ini sudah selesai dan telah dikirim (submitted).' };
      }
      if (u.role === 'teacher' && attempt.examinerUserId !== u.id) {
        return { success: false, message: 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi ujian ini.' };
      }
      assessments = this.getLocalQuestionAssessments(attempt.id);
    } else {
      const attemptId = `att_uas_${params.periodId}_${params.studentId}_a1`;
      attempt = {
        id: attemptId,
        examPeriodId: params.periodId,
        studentId: params.studentId,
        questionSetId: qSet.id,
        examinerUserId: assignment.examinerUserId,
        attemptNumber: 1,
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
        totalScore: 100
      };
      this.saveLocalUASAttempt(params.periodId, attempt);

      // Create 9 empty assessments: default scores, but completedAt MUST BE null!
      assessments = questions.map(q => {
        const isMandatory = isMandatoryQuestion(q.questionNumber, (q as any).questionRole || (q as any).question_role);
        const maxScore = isMandatory ? 15 : 10;
        const maxFluency = isMandatory ? 9 : 6;
        const maxTajwid = isMandatory ? 3 : 2;
        const maxMakhraj = isMandatory ? 3 : 2;

        return {
          id: `aqa_${attemptId}_q${q.questionNumber}`,
          examAttemptId: attemptId,
          examQuestionId: q.id,
          questionNumber: q.questionNumber,
          fluencyScore: maxFluency,
          tajwidScore: maxTajwid,
          makhrajScore: maxMakhraj,
          fluencyEvents: [],
          tajwidEvents: [],
          makhrajEvents: [],
          questionScore: maxScore,
          notes: '',
          startedAt: new Date().toISOString(),
          completedAt: null,
          version: 1
        };
      });
      this.saveLocalQuestionAssessments(attemptId, assessments);
    }

    return {
      success: true,
      attempt,
      kkm: period.kkm,
      questions,
      assessments
    };
  },

  async saveUASQuestionAssessment(
    params: {
      attemptId: string;
      questionNumber: number;
      expectedVersion?: number;
      markCompleted?: boolean;
      assessmentData: {
        fluencyEvents: UASAssessmentEvent[];
        tajwidEvents: UASAssessmentEvent[];
        makhrajEvents: UASAssessmentEvent[];
        notes?: string;
        isCompleted?: boolean;
      };
    },
    userOverride?: User | null
  ): Promise<{ success: boolean; isConflict?: boolean; message?: string; assessment?: any }> {
    const u = userOverride || getLoggedUser();
    if (!u || (u.role !== 'admin' && u.role !== 'teacher')) {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('save_uas_question_assessment', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: params.attemptId,
          p_question_number: params.questionNumber,
          p_assessment_data: params.assessmentData,
          p_expected_version: params.expectedVersion ?? null,
          p_mark_completed: params.markCompleted ?? params.assessmentData.isCompleted ?? false
        });

        if (!error && data) {
          return data;
        }
      } catch (e: any) {
        console.warn("saveUASQuestionAssessment remote error, fallback to local:", e);
      }
    }

    // Check attempt status (read-only if submitted)
    const foundAtt = this.findLocalAttemptById(params.attemptId);
    if (foundAtt && u.role === 'teacher' && foundAtt.attempt.examinerUserId !== u.id) {
      return { success: false, message: 'Akses ditolak: Anda bukan penguji sesi ini.' };
    }
    if (foundAtt && foundAtt.attempt.status === 'submitted') {
      return { success: false, message: 'Ujian telah diselesaikan (submitted) dan bersifat read-only.' };
    }

    // Local fallback
    const assessments = this.getLocalQuestionAssessments(params.attemptId);
    const idx = assessments.findIndex(a => a.questionNumber === params.questionNumber);
    if (idx < 0) {
      return { success: false, message: 'Data soal tidak ditemukan pada sesi ujian.' };
    }

    const currentAsm = assessments[idx];
    if (params.expectedVersion !== undefined && currentAsm.version !== undefined && currentAsm.version !== params.expectedVersion) {
      return {
        success: false,
        isConflict: true,
        message: 'Data ujian berubah di perangkat lain. Muat ulang data terbaru.'
      };
    }

    const isMandatory = isMandatoryQuestion(params.questionNumber);
    const maxFluency = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxFluency : UAS_SCORING_CONFIG.random.maxFluency;
    const maxTajwid = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxTajwid : UAS_SCORING_CONFIG.random.maxTajwid;
    const maxMakhraj = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxMakhraj : UAS_SCORING_CONFIG.random.maxMakhraj;
    const maxQScore = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxQuestionScore : UAS_SCORING_CONFIG.random.maxQuestionScore;

    // Validate events whitelist and server calculation
    const validFluency = ['self_correction', 'reminder', 'prompt', 'unable'];
    let fDeduction = 0;
    for (const ev of (params.assessmentData.fluencyEvents || [])) {
      if (!validFluency.includes(ev.type)) {
        return { success: false, message: `Event kelancaran tidak dikenal: ${ev.type}` };
      }
      if (ev.type === 'self_correction') fDeduction += 0.5;
      else if (ev.type === 'reminder') fDeduction += 1.0;
      else if (ev.type === 'prompt') fDeduction += 2.0;
      else if (ev.type === 'unable') fDeduction += 4.0;
    }
    const fScore = Math.max(0, maxFluency - fDeduction);

    const validTajwid = ['minor', 'major'];
    let tDeduction = 0;
    for (const ev of (params.assessmentData.tajwidEvents || [])) {
      if (!validTajwid.includes(ev.type)) {
        return { success: false, message: `Event tajwid tidak dikenal: ${ev.type}` };
      }
      if (ev.type === 'minor') tDeduction += 0.5;
      else if (ev.type === 'major') tDeduction += 1.0;
    }
    const tScore = Math.max(0, maxTajwid - tDeduction);

    const validMakhraj = ['minor', 'major'];
    let mDeduction = 0;
    for (const ev of (params.assessmentData.makhrajEvents || [])) {
      if (!validMakhraj.includes(ev.type)) {
        return { success: false, message: `Event makhraj tidak dikenal: ${ev.type}` };
      }
      if (ev.type === 'minor') mDeduction += 0.5;
      else if (ev.type === 'major') mDeduction += 1.0;
    }
    const mScore = Math.max(0, maxMakhraj - mDeduction);

    const qScore = Math.round(Math.min(maxQScore, Math.max(0, fScore + tScore + mScore)) * 100) / 100;
    const newVersion = (currentAsm.version || 1) + 1;
    const isCompleted = params.markCompleted ?? params.assessmentData.isCompleted ?? false;
    const newCompletedAt = isCompleted ? (currentAsm.completedAt || new Date().toISOString()) : currentAsm.completedAt;

    assessments[idx] = {
      ...currentAsm,
      fluencyScore: fScore,
      tajwidScore: tScore,
      makhrajScore: mScore,
      fluencyEvents: params.assessmentData.fluencyEvents || [],
      tajwidEvents: params.assessmentData.tajwidEvents || [],
      makhrajEvents: params.assessmentData.makhrajEvents || [],
      questionScore: qScore,
      notes: params.assessmentData.notes || '',
      completedAt: newCompletedAt,
      version: newVersion,
      updatedAt: new Date().toISOString()
    };

    this.saveLocalQuestionAssessments(params.attemptId, assessments);

    return {
      success: true,
      message: `Penilaian soal UAS ${params.questionNumber} berhasil disimpan.`,
      assessment: {
        questionNumber: params.questionNumber,
        fluencyScore: fScore,
        tajwidScore: tScore,
        makhrajScore: mScore,
        questionScore: qScore,
        completedAt: newCompletedAt,
        version: newVersion,
        lastSavedAt: new Date().toISOString()
      }
    };
  },

  async getUASAttempt(
    attemptId: string,
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    message?: string;
    attempt?: ExamAttempt;
    kkm?: number;
    questions?: ExamQuestion[];
    assessments?: ExamQuestionAssessment[];
  }> {
    const u = userOverride || getLoggedUser();
    if (!u || (u.role !== 'admin' && u.role !== 'teacher')) {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_uas_attempt', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: attemptId
        });

        if (!error && data) {
          return data;
        }
      } catch (e: any) {
        console.warn("getUASAttempt remote error, fallback to local:", e);
      }
    }

    // Local fallback
    const foundAtt = this.findLocalAttemptById(attemptId);
    if (foundAtt && u.role === 'teacher' && foundAtt.attempt.examinerUserId !== u.id) {
      return { success: false, message: 'Akses ditolak: Anda bukan penguji yang berwenang untuk sesi ini.' };
    }
    const assessments = this.getLocalQuestionAssessments(attemptId);
    return {
      success: true,
      assessments
    };
  },

  async submitUASAttempt(
    attemptId: string,
    userOverride?: User | null
  ): Promise<{
    success: boolean;
    isExisting?: boolean;
    message?: string;
    totalScore?: number;
    kkm?: number;
    isPassed?: boolean;
    submittedAt?: string;
  }> {
    const u = userOverride || getLoggedUser();
    if (!u || (u.role !== 'admin' && u.role !== 'teacher')) {
      return { success: false, message: 'Akses ditolak.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('submit_uas_attempt', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: attemptId
        });

        if (!error && data) {
          return data;
        }
      } catch (e: any) {
        console.warn("submitUASAttempt remote error, fallback to local:", e);
      }
    }

    // Local fallback
    const foundAtt = this.findLocalAttemptById(attemptId);
    if (foundAtt && u.role === 'teacher' && foundAtt.attempt.examinerUserId !== u.id) {
      return { success: false, message: 'Akses ditolak: Anda bukan penguji yang berwenang untuk sesi ini.' };
    }
    if (foundAtt && foundAtt.attempt.status === 'submitted') {
      return {
        success: true,
        isExisting: true,
        totalScore: foundAtt.attempt.totalScore,
        kkm: 75,
        isPassed: (foundAtt.attempt.totalScore || 0) >= 75,
        submittedAt: foundAtt.attempt.submittedAt || new Date().toISOString(),
        message: 'Ujian sudah disubmit sebelumnya.'
      };
    }

    const assessments = this.getLocalQuestionAssessments(attemptId);
    const completedCount = assessments.filter(a => !!a.completedAt).length;
    if (assessments.length !== 9 || completedCount !== 9) {
      return {
        success: false,
        message: `Validasi gagal: Seluruh 9 butir soal wajib diselesaikan (completed) sebelum submit final. Saat ini ${completedCount} dari 9 soal selesai.`
      };
    }

    // Authoritative recalculation
    let totalCalculated = 0;
    for (let i = 0; i < assessments.length; i++) {
      const a = assessments[i];
      const isMandatory = isMandatoryQuestion(a.questionNumber);
      const maxFluency = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxFluency : UAS_SCORING_CONFIG.random.maxFluency;
      const maxTajwid = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxTajwid : UAS_SCORING_CONFIG.random.maxTajwid;
      const maxMakhraj = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxMakhraj : UAS_SCORING_CONFIG.random.maxMakhraj;
      const maxQScore = isMandatory ? UAS_SCORING_CONFIG.mandatory.maxQuestionScore : UAS_SCORING_CONFIG.random.maxQuestionScore;

      let fDed = 0;
      for (const ev of (a.fluencyEvents || [])) {
        if (ev.type === 'self_correction') fDed += 0.5;
        else if (ev.type === 'reminder') fDed += 1.0;
        else if (ev.type === 'prompt') fDed += 2.0;
        else if (ev.type === 'unable') fDed += 4.0;
      }
      const fScore = Math.max(0, maxFluency - fDed);

      let tDed = 0;
      for (const ev of (a.tajwidEvents || [])) {
        if (ev.type === 'minor') tDed += 0.5;
        else if (ev.type === 'major') tDed += 1.0;
      }
      const tScore = Math.max(0, maxTajwid - tDed);

      let mDed = 0;
      for (const ev of (a.makhrajEvents || [])) {
        if (ev.type === 'minor') mDed += 0.5;
        else if (ev.type === 'major') mDed += 1.0;
      }
      const mScore = Math.max(0, maxMakhraj - mDed);
      const qScore = Math.round(Math.min(maxQScore, Math.max(0, fScore + tScore + mScore)) * 100) / 100;

      assessments[i] = {
        ...a,
        fluencyScore: fScore,
        tajwidScore: tScore,
        makhrajScore: mScore,
        questionScore: qScore
      };
      totalCalculated += qScore;
    }

    this.saveLocalQuestionAssessments(attemptId, assessments);
    totalCalculated = Math.round(Math.min(100, Math.max(0, totalCalculated)) * 100) / 100;

    // Update attempt status to submitted
    if (foundAtt) {
      foundAtt.attempt.status = 'submitted';
      foundAtt.attempt.totalScore = totalCalculated;
      foundAtt.attempt.submittedAt = new Date().toISOString();
      this.saveLocalUASAttempt(foundAtt.periodId, foundAtt.attempt);
    }

    return {
      success: true,
      totalScore: totalCalculated,
      kkm: 75,
      isPassed: totalCalculated >= 75,
      submittedAt: new Date().toISOString(),
      message: 'Hasil ujian UAS berhasil dikirim dan difinalisasi.'
    };
  },

  async reopenUASAttempt(
    params: {
      attemptId: string;
      reason: string;
    },
    userOverride?: User | null
  ): Promise<{ success: boolean; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (u?.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak membuka kembali ujian.' };
    }

    if (!params.reason || !params.reason.trim()) {
      return { success: false, message: 'Wajib mencantumkan alasan pembukaan kembali ujian.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('reopen_uas_attempt', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: params.attemptId,
          p_reason: params.reason
        });

        if (!error && data) {
          return data;
        }
      } catch (e: any) {
        console.warn("reopenUASAttempt remote error, fallback to local:", e);
      }
    }

    const foundAtt = this.findLocalAttemptById(params.attemptId);
    if (foundAtt) {
      foundAtt.attempt.status = 'in_progress';
      foundAtt.attempt.submittedAt = null;
      this.saveLocalUASAttempt(foundAtt.periodId, foundAtt.attempt);
    }

    return {
      success: true,
      message: 'Ujian UAS berhasil dibuka kembali untuk koreksi nilai (lokal).'
    };
  },

  // ============================================================
  // TAHAP 7A: REKAP NILAI & REMEDIAL ELIGIBILITY ENGINE
  // ============================================================

  getLocalSemesterEvaluationConfigs(): SemesterEvaluationConfig[] {
    try {
      const raw = localStorage.getItem('sita_semester_evaluation_configs');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  },

  saveLocalSemesterEvaluationConfig(config: SemesterEvaluationConfig) {
    try {
      const configs = this.getLocalSemesterEvaluationConfigs();
      const idx = configs.findIndex(c => c.id === config.id);
      if (idx >= 0) {
        configs[idx] = config;
      } else {
        configs.unshift(config);
      }
      localStorage.setItem('sita_semester_evaluation_configs', JSON.stringify(configs));
    } catch (e) {}
  },

  async getSemesterEvaluationConfigs(
    academicTermId?: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; configs?: SemesterEvaluationConfig[]; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak melihat konfigurasi semester.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_semester_evaluation_configs', {
          p_username: u.username,
          p_password: u.password,
          p_academic_term_id: academicTermId || null
        });

        if (data && data.success === false) {
          return data;
        }

        if (!error && data?.success) {
          return {
            success: true,
            configs: data.configs || []
          };
        }

        if (error) {
          if (!isTemporaryError(error)) {
            return { success: false, message: error.message || 'Akses ditolak oleh server.' };
          }
          console.warn("getSemesterEvaluationConfigs remote temporary error, fallback to local:", error);
        }
      } catch (e: any) {
        if (!isTemporaryError(e)) {
          return { success: false, message: e?.message || 'Akses ditolak oleh server.' };
        }
        console.warn("getSemesterEvaluationConfigs remote error, fallback to local:", e);
      }
    }

    // Local fallback only if offline / demo mode
    let configs = this.getLocalSemesterEvaluationConfigs();
    if (academicTermId) {
      configs = configs.filter(c => c.academicTermId === academicTermId);
    }
    return { success: true, configs };
  },

  async upsertSemesterEvaluationConfig(
    config: Partial<SemesterEvaluationConfig>,
    userOverride?: User | null
  ): Promise<{ success: boolean; config?: SemesterEvaluationConfig; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak mengelola konfigurasi semester.' };
    }

    const payload = {
      id: config.id,
      academicTermId: config.academicTermId,
      name: config.name,
      utsPeriodId: config.utsPeriodId,
      uasPeriodId: config.uasPeriodId,
      utsWeight: config.utsWeight ?? 40,
      uasWeight: config.uasWeight ?? 60
    };

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('upsert_semester_evaluation_config', {
          p_username: u.username,
          p_password: u.password,
          p_config: payload
        });

        if (data && data.success === false) {
          return data;
        }

        if (!error && data?.success) {
          if (data.config) {
            this.saveLocalSemesterEvaluationConfig(data.config);
          }
          return data;
        }

        if (error) {
          if (!isTemporaryError(error)) {
            return { success: false, message: error.message || 'Gagal menyimpan konfigurasi pada server.' };
          }
        }
      } catch (e: any) {
        if (!isTemporaryError(e)) {
          return { success: false, message: e?.message || 'Gagal menyimpan konfigurasi pada server.' };
        }
        console.warn("upsertSemesterEvaluationConfig remote error, fallback to local:", e);
      }
    }

    // Local fallback
    const id = payload.id || `sec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const savedConfig: SemesterEvaluationConfig = {
      id,
      academicTermId: payload.academicTermId!,
      name: payload.name || 'Konfigurasi Rekap Semester',
      utsPeriodId: payload.utsPeriodId!,
      uasPeriodId: payload.uasPeriodId!,
      utsWeight: payload.utsWeight,
      uasWeight: payload.uasWeight,
      createdBy: u.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.saveLocalSemesterEvaluationConfig(savedConfig);

    return {
      success: true,
      config: savedConfig,
      message: 'Konfigurasi evaluasi semester berhasil disimpan (lokal).'
    };
  },

  async getSemesterTahfizRecap(
    params: {
      academicTermId?: string;
      configId?: string;
      utsPeriodId?: string;
      uasPeriodId?: string;
    },
    userOverride?: User | null
  ): Promise<SemesterRecapResponse> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak melihat rekapitulasi semester.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_semester_tahfiz_recap', {
          p_username: u.username,
          p_password: u.password,
          p_academic_term_id: params.academicTermId || null,
          p_config_id: params.configId || null,
          p_uts_period_id: params.utsPeriodId || null,
          p_uas_period_id: params.uasPeriodId || null
        });

        if (data && data.success === false) {
          return data;
        }

        if (!error && data) {
          return data;
        }

        if (error) {
          if (!isTemporaryError(error)) {
            return { success: false, message: error.message || 'Akses ditolak oleh server.' };
          }
          console.warn("getSemesterTahfizRecap remote temporary error, fallback to local:", error);
        }
      } catch (e: any) {
        if (!isTemporaryError(e)) {
          return { success: false, message: e?.message || 'Akses ditolak oleh server.' };
        }
        console.warn("getSemesterTahfizRecap remote error, fallback to local:", e);
      }
    }

    // Local authoritative computation fallback
    try {
      const allTerms = this.getLocalAcademicTerms();
      const allPeriods = this.getLocalExamPeriods();
      const allConfigs = this.getLocalSemesterEvaluationConfigs();

      let targetTerm: AcademicTerm | undefined;
      let utsPeriod: ExamPeriod | undefined;
      let uasPeriod: ExamPeriod | undefined;
      let configName = 'Default / Otomatis';
      let utsWeight = 40.00;
      let uasWeight = 60.00;

      if (params.configId) {
        const cfg = allConfigs.find(c => c.id === params.configId);
        if (!cfg) return { success: false, message: 'Konfigurasi evaluasi semester tidak ditemukan.' };
        targetTerm = allTerms.find(t => t.id === cfg.academicTermId);
        utsPeriod = allPeriods.find(p => p.id === cfg.utsPeriodId);
        uasPeriod = allPeriods.find(p => p.id === cfg.uasPeriodId);
        configName = cfg.name;
        utsWeight = Number(cfg.utsWeight);
        uasWeight = Number(cfg.uasWeight);
      } else if (params.utsPeriodId && params.uasPeriodId) {
        utsPeriod = allPeriods.find(p => p.id === params.utsPeriodId);
        uasPeriod = allPeriods.find(p => p.id === params.uasPeriodId);
        if (!utsPeriod || !uasPeriod) return { success: false, message: 'Periode UTS atau UAS tidak ditemukan.' };
        targetTerm = allTerms.find(t => t.id === utsPeriod!.academicTermId);
        const matchedCfg = allConfigs.find(c => c.utsPeriodId === utsPeriod!.id && c.uasPeriodId === uasPeriod!.id);
        if (matchedCfg) {
          configName = matchedCfg.name;
          utsWeight = Number(matchedCfg.utsWeight);
          uasWeight = Number(matchedCfg.uasWeight);
        }
      } else {
        const termId = params.academicTermId || allTerms.find(t => t.status === 'active')?.id || allTerms[0]?.id;
        if (!termId) return { success: false, message: 'Semester akademik tidak ditemukan.' };
        targetTerm = allTerms.find(t => t.id === termId);

        const termUts = allPeriods.filter(p => p.academicTermId === termId && p.examType === 'uts');
        const termUas = allPeriods.filter(p => p.academicTermId === termId && p.examType === 'uas');

        if (termUts.length > 1 || termUas.length > 1) {
          return {
            success: false,
            message: 'Terdapat lebih dari satu periode UTS/UAS dalam semester ini. Harap pilih konfigurasi atau pasangan periode secara spesifik.'
          };
        }

        if (termUts.length === 0 || termUas.length === 0) {
          return {
            success: false,
            message: 'Periode UTS atau UAS tidak lengkap untuk semester ini.'
          };
        }

        utsPeriod = termUts[0];
        uasPeriod = termUas[0];
        const matchedCfg = allConfigs.find(c => c.utsPeriodId === utsPeriod!.id && c.uasPeriodId === uasPeriod!.id);
        if (matchedCfg) {
          configName = matchedCfg.name;
          utsWeight = Number(matchedCfg.utsWeight);
          uasWeight = Number(matchedCfg.uasWeight);
        }
      }

      if (!utsPeriod || !uasPeriod) {
        return { success: false, message: 'Pasangan periode UTS dan UAS belum ditentukan.' };
      }

      const utsKkm = Number(utsPeriod.kkm || 70);
      const uasKkm = Number(uasPeriod.kkm || 75);

      const cloud = await this.load(u);
      const students = cloud?.students || MOCK_STUDENTS;

      const utsParticipantsData = this.getLocalEvaluationData(utsPeriod.id);
      const uasParticipantsData = this.getLocalEvaluationData(uasPeriod.id);

      const utsAttempts = this.getLocalAttempts(utsPeriod.id);
      const uasAttempts = this.getLocalUASAttempts(uasPeriod.id);

      const utsQuestionSets = this.getLocalQuestionSets(utsPeriod.id).sets || [];
      const uasQuestionSetsRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(`sita_uas_question_sets_${uasPeriod.id}`) : null;
      const uasQuestionSets: ExamQuestionSet[] = uasQuestionSetsRaw ? JSON.parse(uasQuestionSetsRaw).sets || [] : [];

      const relevantStudentIds = new Set<string>();
      if (utsParticipantsData?.participants?.length) {
        utsParticipantsData.participants.forEach(p => relevantStudentIds.add(p.studentId));
      }
      if (uasParticipantsData?.participants?.length) {
        uasParticipantsData.participants.forEach(p => relevantStudentIds.add(p.studentId));
      }
      if (relevantStudentIds.size === 0) {
        students.forEach(s => relevantStudentIds.add(s.id));
      }

      const studentList = students.filter(s => relevantStudentIds.has(s.id));
      const recap: SemesterStudentRecap[] = [];
      const remedialCandidates: SemesterRemedialCandidate[] = [];

      for (const s of studentList) {
        // Multiple Attempt Protection
        const submittedUtsAttempts = utsAttempts.filter(a => a.studentId === s.id && a.status === 'submitted');
        if (submittedUtsAttempts.length > 1) {
          return {
            success: false,
            message: `Integritas data terlanggar: Ditemukan lebih dari satu ujian UTS berstatus submitted untuk santri ID ${s.id}`
          };
        }
        const submittedUasAttempts = uasAttempts.filter(a => a.studentId === s.id && a.status === 'submitted');
        if (submittedUasAttempts.length > 1) {
          return {
            success: false,
            message: `Integritas data terlanggar: Ditemukan lebih dari satu ujian UAS berstatus submitted untuk santri ID ${s.id}`
          };
        }

        // UTS attempt
        const utsAtt = submittedUtsAttempts[0] || utsAttempts.find(a => a.studentId === s.id && a.status === 'in_progress');
        const utsQSet = utsQuestionSets.find(q => q.studentId === s.id);
        let utsScore: number | null = null;
        let utsStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'TUNTAS' | 'PERLU_REMEDIAL' = 'NOT_STARTED';
        let utsEligible = false;

        if (utsAtt && utsAtt.status === 'submitted') {
          utsScore = Number(utsAtt.totalScore);
          utsStatus = utsScore >= utsKkm ? 'TUNTAS' : 'PERLU_REMEDIAL';
          utsEligible = (utsStatus === 'PERLU_REMEDIAL');
        } else if (utsAtt && utsAtt.status === 'in_progress') {
          utsStatus = 'IN_PROGRESS';
        }

        const utsMaterialSnapshotId = utsQSet?.materialSnapshotId || utsParticipantsData?.materialSnapshots?.find(m => m.studentId === s.id)?.id;

        // UAS attempt
        const uasAtt = submittedUasAttempts[0] || uasAttempts.find(a => a.studentId === s.id && a.status === 'in_progress');
        const uasQSet = uasQuestionSets.find(q => q.studentId === s.id);
        let uasScore: number | null = null;
        let uasStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'TUNTAS' | 'PERLU_REMEDIAL' = 'NOT_STARTED';
        let uasEligible = false;

        if (uasAtt && uasAtt.status === 'submitted') {
          uasScore = Number(uasAtt.totalScore);
          uasStatus = uasScore >= uasKkm ? 'TUNTAS' : 'PERLU_REMEDIAL';
          uasEligible = (uasStatus === 'PERLU_REMEDIAL');
        } else if (uasAtt && uasAtt.status === 'in_progress') {
          uasStatus = 'IN_PROGRESS';
        }

        const uasMaterialSnapshotId = uasQSet?.materialSnapshotId || uasParticipantsData?.materialSnapshots?.find(m => m.studentId === s.id)?.id;

        // Semester Contribution
        let utsContrib: number | null = null;
        let uasContrib: number | null = null;
        let semScore: number | null = null;
        let semStatus: 'INCOMPLETE' | 'TUNTAS' | 'PERLU_REMEDIAL' = 'INCOMPLETE';

        if (utsScore !== null && uasScore !== null) {
          utsContrib = Math.round(utsScore * (utsWeight / 100.0) * 100) / 100;
          uasContrib = Math.round(uasScore * (uasWeight / 100.0) * 100) / 100;
          semScore = Math.round((utsContrib + uasContrib) * 100) / 100;
          semStatus = (utsStatus === 'TUNTAS' && uasStatus === 'TUNTAS') ? 'TUNTAS' : 'PERLU_REMEDIAL';
        }

        recap.push({
          studentId: s.id,
          studentName: s.name,
          studentNis: s.nis,
          className: s.class || '-',
          halaqah: s.halaqah || '-',
          uts: {
            periodId: utsPeriod.id,
            attemptId: utsAtt?.id || null,
            originalScore: utsScore,
            kkm: utsKkm,
            status: utsStatus,
            remedialEligible: utsEligible,
            materialSnapshotId: utsMaterialSnapshotId
          },
          uas: {
            periodId: uasPeriod.id,
            attemptId: uasAtt?.id || null,
            originalScore: uasScore,
            kkm: uasKkm,
            status: uasStatus,
            remedialEligible: uasEligible,
            materialSnapshotId: uasMaterialSnapshotId
          },
          semester: {
            utsWeight,
            uasWeight,
            utsContribution: utsContrib,
            uasContribution: uasContrib,
            score: semScore,
            status: semStatus
          }
        });

        if (utsEligible && utsAtt) {
          remedialCandidates.push({
            studentId: s.id,
            studentName: s.name,
            className: s.class || '-',
            halaqah: s.halaqah || '-',
            examPeriodId: utsPeriod.id,
            examType: 'uts',
            originalAttemptId: utsAtt.id,
            originalQuestionSetId: utsAtt.questionSetId || utsQSet?.id || '',
            originalScore: utsScore!,
            kkm: utsKkm,
            materialSnapshotId: utsMaterialSnapshotId || '',
            eligibilityReason: 'ORIGINAL_SCORE_BELOW_KKM'
          });
        }

        if (uasEligible && uasAtt) {
          remedialCandidates.push({
            studentId: s.id,
            studentName: s.name,
            className: s.class || '-',
            halaqah: s.halaqah || '-',
            examPeriodId: uasPeriod.id,
            examType: 'uas',
            originalAttemptId: uasAtt.id,
            originalQuestionSetId: uasAtt.questionSetId || uasQSet?.id || '',
            originalScore: uasScore!,
            kkm: uasKkm,
            materialSnapshotId: uasMaterialSnapshotId || '',
            eligibilityReason: 'ORIGINAL_SCORE_BELOW_KKM'
          });
        }
      }

      const summary: SemesterRecapSummary = {
        totalStudents: recap.length,
        tuntasCount: recap.filter(r => r.semester.status === 'TUNTAS').length,
        perluRemedialCount: recap.filter(r => r.semester.status === 'PERLU_REMEDIAL').length,
        incompleteCount: recap.filter(r => r.semester.status === 'INCOMPLETE').length,
        utsRemedialCount: recap.filter(r => r.uts.status === 'PERLU_REMEDIAL').length,
        uasRemedialCount: recap.filter(r => r.uas.status === 'PERLU_REMEDIAL').length,
        belumUtsCount: recap.filter(r => r.uts.status === 'NOT_STARTED').length,
        belumUasCount: recap.filter(r => r.uas.status === 'NOT_STARTED').length
      };

      return {
        success: true,
        config: {
          academicTermId: targetTerm?.id || '',
          academicYear: targetTerm?.academicYear || '',
          semester: targetTerm?.semester || '',
          configName,
          utsPeriodId: utsPeriod.id,
          utsPeriodName: utsPeriod.name,
          utsKkm,
          utsWeight,
          uasPeriodId: uasPeriod.id,
          uasPeriodName: uasPeriod.name,
          uasKkm,
          uasWeight
        },
        summary,
        recap,
        remedialCandidates
      };
    } catch (e: any) {
      return { success: false, message: 'Gagal memproses rekap semester: ' + (e?.message || String(e)) };
    }
  },

  async getStudentMaterialSnapshot(
    periodId: string,
    studentId: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; snapshot?: ExamMaterialSnapshot; message?: string }> {
    const evalRes = await this.getTahfizEvaluationData(periodId, userOverride);
    if (!evalRes.success || !evalRes.data) {
      return { success: false, message: evalRes.message || 'Gagal memuat data evaluasi materi santri.' };
    }
    const snapshot = evalRes.data.materialSnapshots?.find(m => m.studentId === studentId);
    return { success: true, snapshot };
  },

  // ============================================================
  // TAHAP 7B: REMEDIAL GENERATOR ENGINE
  // ============================================================
  async getRemedialGenerationCandidates(
    params: {
      academicTermId?: string;
      configId?: string;
      examPeriodId?: string;
    } = {},
    userOverride?: User | null
  ): Promise<RemedialCandidatesResponse> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak mengelola persiapan remedial.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_remedial_generation_candidates', {
          p_username: u.username,
          p_password: u.password,
          p_academic_term_id: params.academicTermId || null,
          p_config_id: params.configId || null,
          p_exam_period_id: params.examPeriodId || null
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal mengambil data kandidat remedial dari server.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat mengambil kandidat remedial.' };
      }
    }

    // Local Storage Fallback
    try {
      const recapRes = await this.getSemesterTahfizRecap(params, u);
      const candidates: RemedialCandidateItem[] = (recapRes.remedialCandidates || []).map(rc => ({
        studentId: rc.studentId,
        studentName: rc.studentName,
        studentNis: '',
        className: rc.className,
        halaqah: rc.halaqah,
        examType: rc.examType,
        originalPeriodId: rc.examPeriodId,
        originalPeriodName: rc.examType === 'uts' ? 'UTS' : 'UAS',
        originalAttemptId: rc.originalAttemptId,
        originalQuestionSetId: rc.originalQuestionSetId,
        originalScore: rc.originalScore,
        kkm: rc.kkm,
        materialSnapshotId: rc.materialSnapshotId,
        remedialSessionId: null,
        generationStatus: 'eligible',
        isPackageReady: false
      }));

      const rawSessions = localStorage.getItem('sita_remedial_sessions');
      const sessions: Record<string, ExamRemedialSession> = rawSessions ? JSON.parse(rawSessions) : {};

      for (const c of candidates) {
        const key = `${c.originalPeriodId}_${c.studentId}`;
        if (sessions[key]) {
          c.remedialSessionId = sessions[key].id;
          c.generationStatus = sessions[key].status;
          c.remedialQuestionSetId = sessions[key].remedialQuestionSetId;
          c.isPackageReady = sessions[key].status === 'locked';
        }
      }

      const readyCount = candidates.filter(c => c.isPackageReady).length;
      return {
        success: true,
        summary: {
          totalCandidates: candidates.length,
          readyCount,
          pendingCount: candidates.length - readyCount
        },
        candidates
      };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Gagal memproses kandidat remedial lokal.' };
    }
  },

  async generateUTSRemedialQuestionSet(
    params: {
      originalPeriodId: string;
      studentId: string;
      strategy?: string;
      questionsData: any[];
      seed?: string;
      fingerprint?: string;
    },
    userOverride?: User | null
  ): Promise<RemedialGenerationResponse> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak membuat soal remedial UTS.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('generate_uts_remedial_question_set', {
          p_username: u.username,
          p_password: u.password,
          p_original_period_id: params.originalPeriodId,
          p_student_id: params.studentId,
          p_strategy: params.strategy || 'hybrid',
          p_questions_data: params.questionsData,
          p_seed: params.seed || null,
          p_fingerprint: params.fingerprint || null
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal generate paket soal remedial UTS.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat generate remedial UTS.' };
      }
    }

    // Local fallback
    const sessId = `ers_${params.originalPeriodId}_${params.studentId}`;
    const setId = `erqs_${params.originalPeriodId}_${params.studentId}_v1`;
    const session: ExamRemedialSession = {
      id: sessId,
      originalExamPeriodId: params.originalPeriodId,
      studentId: params.studentId,
      examType: 'uts',
      originalAttemptId: 'orig_att',
      originalQuestionSetId: 'orig_qs',
      materialSnapshotId: 'orig_snap',
      remedialQuestionSetId: setId,
      status: 'locked',
      generationVersion: 1,
      createdBy: u.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const rawSessions = safeGetLocalStorage('sita_remedial_sessions');
    const sessions: Record<string, ExamRemedialSession> = rawSessions ? JSON.parse(rawSessions) : {};
    sessions[`${params.originalPeriodId}_${params.studentId}`] = session;
    safeSetLocalStorage('sita_remedial_sessions', JSON.stringify(sessions));

    return {
      success: true,
      isExisting: false,
      message: 'Berhasil membuat dan mengunci 5 butir soal UTS remedial (Lokal).',
      remedialSession: session
    };
  },

  async generateUASRemedialQuestionSet(
    params: {
      originalPeriodId: string;
      studentId: string;
      strategy?: string;
      seed?: string;
      fingerprint?: string;
      questions: any[];
    },
    userOverride?: User | null
  ): Promise<RemedialGenerationResponse> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak membuat soal remedial UAS.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('generate_uas_remedial_question_set', {
          p_username: u.username,
          p_password: u.password,
          p_original_period_id: params.originalPeriodId,
          p_student_id: params.studentId,
          p_strategy: params.strategy || 'hybrid',
          p_seed: params.seed || null,
          p_fingerprint: params.fingerprint || null,
          p_questions: params.questions
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal generate paket soal remedial UAS.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat generate remedial UAS.' };
      }
    }

    // Local fallback
    const sessId = `ers_${params.originalPeriodId}_${params.studentId}`;
    const setId = `erqs_${params.originalPeriodId}_${params.studentId}_v1`;
    const session: ExamRemedialSession = {
      id: sessId,
      originalExamPeriodId: params.originalPeriodId,
      studentId: params.studentId,
      examType: 'uas',
      originalAttemptId: 'orig_att',
      originalQuestionSetId: 'orig_qs',
      materialSnapshotId: 'orig_snap',
      remedialQuestionSetId: setId,
      status: 'locked',
      generationVersion: 1,
      createdBy: u.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const rawSessions = safeGetLocalStorage('sita_remedial_sessions');
    const sessions: Record<string, ExamRemedialSession> = rawSessions ? JSON.parse(rawSessions) : {};
    sessions[`${params.originalPeriodId}_${params.studentId}`] = session;
    safeSetLocalStorage('sita_remedial_sessions', JSON.stringify(sessions));

    return {
      success: true,
      isExisting: false,
      message: 'Berhasil membuat dan mengunci 9 butir soal UAS remedial (Lokal).',
      remedialSession: session
    };
  },

  async getRemedialQuestionSet(
    remedialSessionId: string,
    userOverride?: User | null
  ): Promise<RemedialDetailResponse> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak melihat rincian paket remedial.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_remedial_question_set', {
          p_username: u.username,
          p_password: u.password,
          p_remedial_session_id: remedialSessionId
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal mengambil rincian paket soal remedial.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat mengambil paket remedial.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif untuk mengambil rincian paket soal remedial.'
    };
  },

  async assignRemedialExaminer(
    remedialSessionId: string,
    examinerId: string,
    reason?: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; message?: string; action?: string }> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak menugaskan penguji remedial.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('assign_remedial_examiner_secure', {
          p_username: u.username,
          p_password: u.password,
          p_remedial_session_id: remedialSessionId,
          p_examiner_id: examinerId,
          p_reason: reason || null
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal menugaskan penguji remedial.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat menugaskan penguji remedial.' };
      }
    }

    // Local fallback
    const rawSessions = safeGetLocalStorage('sita_remedial_sessions');
    const sessions: Record<string, ExamRemedialSession> = rawSessions ? JSON.parse(rawSessions) : {};
    for (const key of Object.keys(sessions)) {
      if (sessions[key].id === remedialSessionId) {
        sessions[key].examinerUserId = examinerId;
        sessions[key].assignedBy = u.id;
        sessions[key].assignedAt = new Date().toISOString();
        break;
      }
    }
    safeSetLocalStorage('sita_remedial_sessions', JSON.stringify(sessions));

    return {
      success: true,
      message: 'Penguji ujian remedial berhasil ditugaskan (Lokal).'
    };
  },

  async getExaminerRemedialStudents(
    userOverride?: User | null
  ): Promise<{ success: boolean; students?: RemedialExaminerStudentItem[]; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (!u || !['admin', 'teacher'].includes(u.role)) {
      return { success: false, message: 'Akses ditolak: Hanya Penguji atau Admin yang dapat mengakses daftar remedial.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_examiner_remedial_students', {
          p_username: u.username,
          p_password: u.password
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal memuat daftar remedial santri.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat memuat daftar remedial.' };
      }
    }

    return {
      success: true,
      students: []
    };
  },

  async startRemedialAttempt(
    remedialSessionId: string,
    userOverride?: User | null
  ): Promise<StartRemedialResponse> {
    const u = userOverride || getLoggedUser();
    if (!u || !['admin', 'teacher'].includes(u.role)) {
      return { success: false, message: 'Akses ditolak: Hanya Penguji atau Admin yang dapat memulai ujian remedial.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('start_remedial_attempt', {
          p_username: u.username,
          p_password: u.password,
          p_remedial_session_id: remedialSessionId
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal memulai sesi remedial.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat memulai sesi remedial.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif untuk memulai ujian remedial.'
    };
  },

  async saveRemedialQuestionAssessment(
    params: {
      attemptId: string;
      questionNumber: number;
      assessmentData: any;
      expectedVersion?: number;
      markCompleted?: boolean;
    },
    userOverride?: User | null
  ): Promise<SaveRemedialAssessmentResponse> {
    const u = userOverride || getLoggedUser();
    if (!u || !['admin', 'teacher'].includes(u.role)) {
      return { success: false, message: 'Akses ditolak: Hanya Penguji atau Admin yang dapat menilai ujian remedial.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('save_remedial_question_assessment', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: params.attemptId,
          p_question_number: params.questionNumber,
          p_assessment_data: params.assessmentData,
          p_expected_version: params.expectedVersion ?? null,
          p_mark_completed: params.markCompleted ?? false
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal menyimpan penilaian remedial.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat menyimpan penilaian remedial.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif untuk menyimpan penilaian.'
    };
  },

  async getRemedialAttemptDetail(
    attemptId: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; attempt?: any; questions?: any[]; assessments?: any[]; message?: string }> {
    const u = userOverride || getLoggedUser();
    if (!u || !['admin', 'teacher'].includes(u.role)) {
      return { success: false, message: 'Akses ditolak: Hanya Penguji atau Admin yang dapat melihat detail remedial.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_remedial_attempt_detail', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: attemptId
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal memuat detail remedial.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat memuat detail remedial.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif untuk memuat detail remedial.'
    };
  },

  async submitRemedialAttempt(
    attemptId: string,
    userOverride?: User | null
  ): Promise<SubmitRemedialResponse> {
    const u = userOverride || getLoggedUser();
    if (!u || !['admin', 'teacher'].includes(u.role)) {
      return { success: false, message: 'Akses ditolak: Hanya Penguji atau Admin yang dapat mengirim ujian remedial.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('submit_remedial_attempt', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: attemptId
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal mengirim ujian remedial.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat mengirim ujian remedial.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif untuk submit ujian remedial.'
    };
  },

  async reopenRemedialAttempt(
    attemptId: string,
    reason: string,
    userOverride?: User | null
  ): Promise<{ success: boolean; message?: string; attemptId?: string; status?: string }> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak membuka kembali ujian remedial.' };
    }

    if (!reason || !reason.trim()) {
      return { success: false, message: 'Wajib mencantumkan alasan pembukaan kembali ujian remedial.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('reopen_remedial_attempt', {
          p_username: u.username,
          p_password: u.password,
          p_attempt_id: attemptId,
          p_reason: reason
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal membuka kembali ujian remedial.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat membuka kembali ujian remedial.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif untuk membuka kembali ujian remedial.'
    };
  },

  // ============================================================
  // TAHAP 7D: REKAP FINAL, MONITORING & EXPORT API
  // ============================================================

  async getSemesterFinalRecap(
    params: {
      academicTermId?: string;
      configId?: string;
      utsPeriodId?: string;
      uasPeriodId?: string;
      class?: string;
      status?: string;
      search?: string;
    },
    userOverride?: User | null
  ): Promise<FinalSemesterRecapResponse> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak mengakses rekap final evaluasi semester.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_semester_final_recap', {
          p_username: u.username,
          p_password: u.password,
          p_academic_term_id: params.academicTermId || null,
          p_config_id: params.configId || null,
          p_uts_period_id: params.utsPeriodId || null,
          p_uas_period_id: params.uasPeriodId || null,
          p_class: params.class || null,
          p_status: params.status || null,
          p_search: params.search || null
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal memuat rekap final evaluasi semester.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat memuat rekap final evaluasi semester.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif untuk memuat rekap final.'
    };
  },

  async getSemesterMonitoringStats(
    params: {
      academicTermId?: string;
      configId?: string;
      utsPeriodId?: string;
      uasPeriodId?: string;
      class?: string;
    },
    userOverride?: User | null
  ): Promise<FinalSemesterMonitoringResponse> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak mengakses data monitoring semester.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_semester_monitoring_stats', {
          p_username: u.username,
          p_password: u.password,
          p_academic_term_id: params.academicTermId || null,
          p_config_id: params.configId || null,
          p_uts_period_id: params.utsPeriodId || null,
          p_uas_period_id: params.uasPeriodId || null,
          p_class: params.class || null
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal memuat statistik monitoring semester.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat memuat statistik monitoring.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif untuk memuat monitoring semester.'
    };
  },

  async getStudentEvaluationHistory(
    params: {
      studentId: string;
      academicTermId?: string;
      configId?: string;
    },
    userOverride?: User | null
  ): Promise<StudentEvaluationHistoryResponse> {
    const u = userOverride || getLoggedUser();
    if (!u || u.role !== 'admin') {
      return { success: false, message: 'Akses ditolak: Hanya Admin yang berhak melihat detail riwayat evaluasi santri.' };
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_student_evaluation_history', {
          p_username: u.username,
          p_password: u.password,
          p_student_id: params.studentId,
          p_academic_term_id: params.academicTermId || null,
          p_config_id: params.configId || null
        });

        if (data && data.success === false) {
          return data;
        }
        if (!error && data) {
          return data;
        }
        if (error) {
          return { success: false, message: error.message || 'Gagal memuat riwayat evaluasi santri.' };
        }
      } catch (e: any) {
        return { success: false, message: e?.message || 'Terjadi kesalahan saat memuat riwayat evaluasi santri.' };
      }
    }

    return {
      success: false,
      message: 'Koneksi database Supabase tidak aktif untuk memuat riwayat evaluasi santri.'
    };
  }
};


export const validation = {
  formatWhatsApp(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (!cleaned) return '';
    if (cleaned.startsWith('08')) {
      cleaned = '628' + cleaned.substring(2);
    } else if (cleaned.startsWith('8')) {
      cleaned = '628' + cleaned.substring(1);
    } else if (!cleaned.startsWith('62') && cleaned.length >= 9) {
      cleaned = '62' + cleaned;
    }
    return cleaned;
  },

  validatePhone(phone: string): { isValid: boolean; formatted: string; error?: string } {
    if (!phone) {
      return { isValid: true, formatted: '' };
    }
    const formatted = this.formatWhatsApp(phone);
    if (formatted.length < 10 || formatted.length > 15) {
      return { 
        isValid: false, 
        formatted, 
        error: 'Nomor WhatsApp tidak valid. Panjang nomor harus antara 10-15 digit (contoh: 6281234567890).' 
      };
    }
    if (!formatted.startsWith('628')) {
      return {
        isValid: false,
        formatted,
        error: 'Nomor WhatsApp Indonesia harus diawali dengan 628... atau 08...'
      };
    }
    return { isValid: true, formatted };
  },

  validateName(name: string): { isValid: boolean; error?: string } {
    if (!name || name.trim().length < 2) {
      return { isValid: false, error: 'Nama harus memiliki minimal 2 karakter.' };
    }
    const forbidden = /[<>{}@$%*\[\]]/;
    if (forbidden.test(name)) {
      return { isValid: false, error: 'Nama tidak boleh mengandung karakter khusus seperti < > { } @ $ % * [ ]' };
    }
    return { isValid: true };
  }
};
