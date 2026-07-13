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