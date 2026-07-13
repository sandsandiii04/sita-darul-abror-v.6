import { createClient } from '@supabase/supabase-js';
import { User, Student, TahfidzRecord, Attendance, Exam, AttendanceOpenRequest } from './types';

export type ActionType = 'addUser' | 'addStudent' | 'addRecord' | 'addExam' | 'markAttendance' | 'updateUser' | 'deleteData' | 'addAttendanceOpenRequest';

export interface QueueItem {
  id: string;
  action: ActionType;
  data: any;
  timestamp: number;
}

// 1. Inisialisasi Supabase Client
let supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
let supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl && typeof window !== 'undefined') {
  supabaseUrl = window.localStorage.getItem('sita_supabase_url') || '';
}
if (!supabaseAnonKey && typeof window !== 'undefined') {
  supabaseAnonKey = window.localStorage.getItem('sita_supabase_anon_key') || '';
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
  avatar: row.avatar
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
  avatar: model.avatar || null
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
  password: model.password
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
  late_reason: model.lateReason || null
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

// Helper: Penunggu waktu (Delay)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let isProcessing = false;
let lastSyncError: string | null = null;
let queueChangeCallbacks: ((length: number, isSyncing: boolean, lastError: string | null) => void)[] = [];

const getQueue = (): QueueItem[] => {
  try {
    const q = localStorage.getItem('sita_sync_queue_v2');
    return q ? JSON.parse(q) : [];
  } catch (e) {
    return [];
  }
};

const saveQueue = (queue: QueueItem[]) => {
  localStorage.setItem('sita_sync_queue_v2', JSON.stringify(queue));
  notifyCallbacks();
};

const notifyCallbacks = () => {
  const len = getQueue().length;
  queueChangeCallbacks.forEach(cb => cb(len, isProcessing, lastSyncError));
};

export const api = {
  // Berlangganan perubahan antrean (untuk UI)
  subscribe(cb: (length: number, isSyncing: boolean, lastError: string | null) => void) {
    queueChangeCallbacks.push(cb);
    cb(getQueue().length, isProcessing, lastSyncError);
    return () => {
      queueChangeCallbacks = queueChangeCallbacks.filter(c => c !== cb);
    };
  },

  getQueueLength(): number {
    return getQueue().length;
  },

  isSyncing(): boolean {
    return isProcessing;
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

        if (item.action === 'addUser') {
          const { error: err } = await supabase.rpc('upsert_data', { p_table: 'users', p_data: mapUserToDb(item.data) });
          error = err;
        } else if (item.action === 'addStudent') {
          const { error: err } = await supabase.rpc('upsert_data', { p_table: 'students', p_data: mapStudentToDb(item.data) });
          error = err;
        } else if (item.action === 'addRecord') {
          const { error: err } = await supabase.rpc('upsert_data', { p_table: 'records', p_data: mapRecordToDb(item.data) });
          error = err;
        } else if (item.action === 'markAttendance') {
          const { error: err } = await supabase.rpc('upsert_data', { p_table: 'attendance', p_data: mapAttendanceToDb(item.data) });
          error = err;
        } else if (item.action === 'addAttendanceOpenRequest') {
          const { error: err } = await supabase.rpc('upsert_data', { p_table: 'attendance_open_requests', p_data: mapAttendanceOpenRequestToDb(item.data) });
          error = err;
        } else if (item.action === 'addExam') {
          const { error: err } = await supabase.rpc('upsert_data', { p_table: 'exams', p_data: mapExamToDb(item.data) });
          error = err;
        } else if (item.action === 'updateUser') {
          const { error: err } = await supabase.rpc('upsert_data', { p_table: 'users', p_data: mapUserToDb(item.data) });
          error = err;
        } else if (item.action === 'deleteData') {
          const tableName = item.data.sheetName.toLowerCase();
          const { error: err } = await supabase.rpc('delete_data_secure', { p_table: tableName, p_id: item.data.id });
          error = err;
        }

        if (error) throw error;

        // Hapus dari antrean jika sukses
        const updatedQueue = getQueue().filter(q => q.id !== item.id);
        saveQueue(updatedQueue);
        lastSyncError = null;
        console.log(`Berhasil sinkronisasi Supabase: ${item.action}`, item.data);
      } catch (error: any) {
        console.error(`Gagal sinkronisasi Supabase ${item.id} (${item.action}):`, error);
        lastSyncError = error?.message || String(error);
        break;
      }
    }

    isProcessing = false;
    notifyCallbacks();
  },

  // Fungsi Login menggunakan RPC
  async login(username: string, password: string): Promise<{ success: boolean; data?: User; message?: string }> {
    if (!supabase) return { success: false, message: 'Koneksi database belum dikonfigurasi.' };
    try {
      const { data, error } = await supabase.rpc('verify_login', {
        p_username: username.trim(),
        p_password: password.trim()
      });
      if (error) throw error;
      
      const result = data as { success: boolean; data?: any; message?: string };
      if (result.success && result.data) {
        return {
          success: true,
          data: {
            id: result.data.id,
            name: result.data.name,
            role: result.data.role,
            username: result.data.username,
            password: result.data.password,
            phoneNumber: result.data.phoneNumber || result.data.phone_number,
            childId: result.data.childId || result.data.child_id,
            email: result.data.email,
            avatar: result.data.avatar
          }
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
      };

      if (!result.success) {
        throw new Error(result.message || "Gagal memuat data aman.");
      }

      let openRequests: any[] = [];
      try {
        const { data: reqData, error: reqError } = await supabase.from('attendance_open_requests').select('*');
        if (!reqError && reqData) {
          openRequests = reqData;
        }
      } catch (e) {
        console.warn("Table attendance_open_requests might not exist:", e);
      }

      console.log("Data loaded securely from Supabase RPC");
      return {
        users: (result.users || []).map(mapUserFromDb),
        students: (result.students || []).map(mapStudentFromDb),
        records: (result.records || []).map(mapRecordFromDb),
        attendance: (result.attendance || []).map(mapAttendanceFromDb),
        exams: (result.exams || []).map(mapExamFromDb),
        openRequests: openRequests.map(mapAttendanceOpenRequestFromDb)
      };
    } catch (error) {
      console.error("Failed to load secure cloud data:", error);
      return null;
    }
  }
};
