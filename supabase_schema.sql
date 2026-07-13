-- ============================================================
-- SQL Schema untuk Database SITA Darul Abror (Supabase)
-- Jalankan query ini di "SQL Editor" dashboard Supabase Anda.
-- ============================================================

-- 1. Tabel Users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'parent')),
    username TEXT UNIQUE,
    password TEXT NOT NULL,
    phone_number TEXT,
    child_id TEXT,
    email TEXT,
    avatar TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabel Students
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    nis TEXT UNIQUE NOT NULL,
    class TEXT NOT NULL,
    halaqah TEXT NOT NULL,
    teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    total_juz NUMERIC DEFAULT 0,
    username TEXT UNIQUE,
    password TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Tabel Records (Tahfidz Log)
CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('sabaq', 'sabqi', 'manzil', 'ziyadah', 'murojaah')),
    surah TEXT NOT NULL,
    ayah_start INTEGER DEFAULT 0,
    ayah_end INTEGER DEFAULT 0,
    grade TEXT NOT NULL,
    notes TEXT,
    class TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Tabel Attendance
CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL, -- ID guru atau ID santri
    date DATE NOT NULL,
    session TEXT NOT NULL CHECK (session IN ('pagi', 'malam')),
    status TEXT NOT NULL CHECK (status IN ('present', 'sick', 'permission', 'alpha')),
    approval_status TEXT CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    type TEXT NOT NULL CHECK (type IN ('student', 'teacher')),
    class TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Tabel Exams
CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
    student_name TEXT,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    score NUMERIC NOT NULL,
    examiner TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'remedial')),
    notes TEXT,
    juz TEXT,
    class TEXT,
    details JSONB, -- Menyimpan detail kesalahan ujian (surat, juz, mistakes)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Fungsi RPC untuk verifikasi login secara aman
CREATE OR REPLACE FUNCTION verify_login(p_username TEXT, p_password TEXT)
RETURNS JSON AS $$
DECLARE
  v_user RECORD;
  v_student RECORD;
BEGIN
  -- 1. Cari di tabel users (Guru / Admin)
  SELECT * INTO v_user FROM users WHERE username = p_username AND password = p_password;
  IF FOUND THEN
    RETURN json_build_object(
      'success', true,
      'type', 'user',
      'data', json_build_object(
        'id', v_user.id,
        'name', v_user.name,
        'role', v_user.role,
        'username', v_user.username,
        'password', v_user.password,
        'phoneNumber', v_user.phone_number,
        'email', v_user.email,
        'avatar', v_user.avatar
      )
    );
  END IF;

  -- 2. Cari di tabel students (Orang Tua menggunakan NIS / Username)
  SELECT * INTO v_student FROM students WHERE (username = p_username OR nis = p_username) AND password = p_password;
  IF FOUND THEN
    RETURN json_build_object(
      'success', true,
      'type', 'student',
      'data', json_build_object(
        'id', v_student.id,
        'name', v_student.name,
        'role', 'parent',
        'childId', v_student.id,
        'username', v_student.username
      )
    );
  END IF;

  -- Jika tidak ditemukan
  RETURN json_build_object('success', false, 'message', 'Username atau password salah');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. Migrasi Fitur Akses Absensi Terlambat (Batas 05:50 Pagi & 18:50 Malam)
-- ============================================================

-- Tambahkan kolom keterangan keterlambatan ke tabel attendance jika belum ada
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_reason TEXT;

-- Tabel untuk menampung permohonan buka absen terlambat dari guru
CREATE TABLE IF NOT EXISTS attendance_open_requests (
    id TEXT PRIMARY KEY,
    teacher_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    session TEXT NOT NULL CHECK (session IN ('pagi', 'malam')),
    type TEXT NOT NULL CHECK (type IN ('student', 'teacher')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    late_reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
