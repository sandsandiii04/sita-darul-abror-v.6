import { createClient } from '@supabase/supabase-js';
import { User, Student, TahfidzRecord, Attendance, Exam } from './types';

export type ActionType = 'addUser' | 'addStudent' | 'addRecord' | 'addExam' | 'markAttendance' | 'updateUser' | 'deleteData';

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

// 2. Mapping Helper (Database snake_case <=> Frontend camelCase)
const mapUserFromDb = (row: any): User => ({
  id: row.id,
  name: row.name,
  role: row.role,
  username: row.username,
  password: row.password,
  phoneNumber: row.phone_number,
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
  phone_number: model.phoneNumber || null,
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
  class: row.class
});

const mapAttendanceToDb = (model: Attendance): any => ({
  id: model.id,
  user_id: cleanId(model.userId),
  date: model.date,
  session: model.session,
  status: model.status,
  approval_status: model.approvalStatus || null,
  type: model.type,
  class: model.class || null
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
          const { error: err } = await supabase.from('users').upsert(mapUserToDb(item.data));
          error = err;
        } else if (item.action === 'addStudent') {
          const { error: err } = await supabase.from('students').upsert(mapStudentToDb(item.data));
          error = err;
        } else if (item.action === 'addRecord') {
          const { error: err } = await supabase.from('records').upsert(mapRecordToDb(item.data));
          error = err;
        } else if (item.action === 'markAttendance') {
          const { error: err } = await supabase.from('attendance').upsert(mapAttendanceToDb(item.data));
          error = err;
        } else if (item.action === 'addExam') {
          const { error: err } = await supabase.from('exams').upsert(mapExamToDb(item.data));
          error = err;
        } else if (item.action === 'updateUser') {
          const { error: err } = await supabase.from('users').upsert(mapUserToDb(item.data));
          error = err;
        } else if (item.action === 'deleteData') {
          const tableName = item.data.sheetName.toLowerCase();
          const { error: err } = await supabase.from(tableName).delete().eq('id', item.data.id);
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

  // Fungsi mengambil semua data (GET)
  async load(currentUser: User | null) {
    if (!supabase) return null;

    try {
      let usersQuery = supabase.from('users').select('id, name, role');
      let studentsQuery = supabase.from('students').select('id, name, nis, class, halaqah, teacher_id, total_juz');
      let recordsQuery = supabase.from('records').select('*');
      let attendanceQuery = supabase.from('attendance').select('*');
      let examsQuery = supabase.from('exams').select('*');

      if (!currentUser) {
        // Jika belum login, hanya load list minimal guru untuk scan cepat
        const { data: usersData, error: usersError } = await supabase
          .from('users')
          .select('id, name, role')
          .eq('role', 'teacher');
          
        if (usersError) throw usersError;
        
        return {
          users: (usersData || []).map(mapUserFromDb),
          students: [],
          records: [],
          attendance: [],
          exams: []
        };
      }

      // Jika login sebagai Admin
      if (currentUser.role === 'admin') {
        usersQuery = supabase.from('users').select('*');
        studentsQuery = supabase.from('students').select('*');
      }
      // Jika login sebagai Guru
      else if (currentUser.role === 'teacher') {
        usersQuery = supabase.from('users').select('id, name, role, email, avatar');
        studentsQuery = supabase.from('students').select('id, name, nis, class, halaqah, teacher_id, total_juz');
      }
      // Jika login sebagai Orang Tua / Santri
      else if (currentUser.role === 'parent' && currentUser.childId) {
        usersQuery = supabase.from('users').select('id, name, role, email, avatar');
        studentsQuery = supabase.from('students').select('id, name, nis, class, halaqah, teacher_id, total_juz').eq('id', currentUser.childId);
        recordsQuery = supabase.from('records').select('*').eq('student_id', currentUser.childId);
        attendanceQuery = supabase.from('attendance').select('*').eq('user_id', currentUser.childId);
        examsQuery = supabase.from('exams').select('*').eq('student_id', currentUser.childId);
      }

      // Ambil data terbaru secara paralel
      const [
        { data: usersData, error: usersError },
        { data: studentsData, error: studentsError },
        { data: recordsData, error: recordsError },
        { data: attendanceData, error: attendanceError },
        { data: examsData, error: examsError }
      ] = await Promise.all([
        usersQuery,
        studentsQuery,
        recordsQuery,
        attendanceQuery,
        examsQuery
      ]);

      if (usersError || studentsError || recordsError || attendanceError || examsError) {
        throw new Error("Gagal memuat data dari Supabase");
      }

      console.log("Data loaded from Supabase successfully");
      return {
        users: (usersData || []).map(mapUserFromDb),
        students: (studentsData || []).map(mapStudentFromDb),
        records: (recordsData || []).map(mapRecordFromDb),
        attendance: (attendanceData || []).map(mapAttendanceFromDb),
        exams: (examsData || []).map(mapExamFromDb)
      };
    } catch (error) {
      console.error("Failed to load cloud data:", error);
      return null;
    }
  }
};
