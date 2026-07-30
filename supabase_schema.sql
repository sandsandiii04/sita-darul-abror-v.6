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
    gender TEXT CHECK (gender IN ('L', 'P')),
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
        'avatar', v_user.avatar,
        'gender', v_user.gender
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

-- Tambahkan kolom gender ke tabel users jika belum ada
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('L', 'P'));

-- 8. Fungsi RPC untuk mengambil list minimal guru sebelum login
CREATE OR REPLACE FUNCTION get_teacher_list()
RETURNS JSON AS $$
DECLARE
  v_list JSON;
BEGIN
  SELECT json_agg(t) INTO v_list FROM (
    SELECT id, name, role, gender FROM users WHERE role = 'teacher'
  ) t;
  RETURN COALESCE(v_list, '[]'::json);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Fungsi RPC untuk memuat semua data secara aman berdasarkan hak akses
CREATE OR REPLACE FUNCTION load_secure_data(p_username TEXT, p_password TEXT)
RETURNS JSON AS $$
DECLARE
  v_user RECORD;
  v_users JSON;
  v_students JSON;
  v_records JSON;
  v_attendance JSON;
  v_exams JSON;
BEGIN
  -- 1. Verifikasi kredensial user
  SELECT * INTO v_user FROM users WHERE username = p_username AND password = p_password;
  IF NOT FOUND THEN
     RETURN json_build_object('success', false, 'message', 'Akses ditolak: Kredensial login salah');
  END IF;

  -- 2. Kumpulkan data berdasarkan role
  IF v_user.role = 'admin' THEN
     -- Admin mendapat semua data
     SELECT json_agg(u) INTO v_users FROM (
       SELECT id, name, role, username, password, phone_number, child_id, email, avatar, gender FROM users
     ) u;
     SELECT json_agg(s) INTO v_students FROM students s;
     SELECT json_agg(r) INTO v_records FROM records r;
     SELECT json_agg(a) INTO v_attendance FROM attendance a;
     SELECT json_agg(e) INTO v_exams FROM exams e;
  ELSIF v_user.role = 'teacher' THEN
     -- Guru mendapat data semua guru (minimal untuk list/absen), santri bimbingannya, log tahfidz, absen, & ujian bimbingannya
     SELECT json_agg(u) INTO v_users FROM (
       SELECT id, name, role, phone_number, gender FROM users
     ) u;
     SELECT json_agg(s) INTO v_students FROM students s WHERE s.teacher_id = v_user.id;
     
     SELECT json_agg(r) INTO v_records FROM records r 
     WHERE r.student_id IN (SELECT id FROM students WHERE teacher_id = v_user.id);
     
     SELECT json_agg(a) INTO v_attendance FROM attendance a; -- Absen guru & santri
     
     SELECT json_agg(e) INTO v_exams FROM exams e
     WHERE e.student_id IN (SELECT id FROM students WHERE teacher_id = v_user.id);
  ELSE
     -- Wali santri (parent) mendapat data santri miliknya saja, log tahfidz, absen, & ujian anaknya
     SELECT json_agg(u) INTO v_users FROM (
       SELECT id, name, role, phone_number, gender FROM users WHERE id = v_user.id OR role = 'teacher'
     ) u;
     SELECT json_agg(s) INTO v_students FROM students s WHERE s.id = v_user.child_id;
     
     SELECT json_agg(r) INTO v_records FROM records r 
     WHERE r.student_id = v_user.child_id;
     
     SELECT json_agg(a) INTO v_attendance FROM attendance a 
     WHERE a.user_id = v_user.child_id;
     
     SELECT json_agg(e) INTO v_exams FROM exams e 
     WHERE e.student_id = v_user.child_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'users', COALESCE(v_users, '[]'::json),
    'students', COALESCE(v_students, '[]'::json),
    'records', COALESCE(v_records, '[]'::json),
    'attendance', COALESCE(v_attendance, '[]'::json),
    'exams', COALESCE(v_exams, '[]'::json)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Fungsi RPC untuk insert/update data (upsert) secara aman dari frontend
CREATE OR REPLACE FUNCTION upsert_data(p_table TEXT, p_data JSONB)
RETURNS JSON AS $$
DECLARE
  v_cols TEXT;
  v_vals TEXT;
  v_upsert TEXT;
BEGIN
  IF p_table = 'users' THEN
     INSERT INTO users (id, name, role, username, password, phone_number, child_id, email, avatar, gender)
     VALUES (
       p_data->>'id',
       p_data->>'name',
       p_data->>'role',
       p_data->>'username',
       p_data->>'password',
       p_data->>'phone_number',
       p_data->>'child_id',
       p_data->>'email',
       p_data->>'avatar',
       p_data->>'gender'
     )
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       phone_number = EXCLUDED.phone_number,
       child_id = EXCLUDED.child_id,
       email = EXCLUDED.email,
       avatar = EXCLUDED.avatar,
       gender = EXCLUDED.gender;
  ELSIF p_table = 'students' THEN
     INSERT INTO students (id, name, nis, class, halaqah, teacher_id, total_juz, username, password)
     VALUES (
       p_data->>'id',
       p_data->>'name',
       p_data->>'nis',
       p_data->>'class',
       p_data->>'halaqah',
       p_data->>'teacher_id',
       (p_data->>'total_juz')::NUMERIC,
       p_data->>'username',
       p_data->>'password'
     )
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       nis = EXCLUDED.nis,
       class = EXCLUDED.class,
       halaqah = EXCLUDED.halaqah,
       teacher_id = EXCLUDED.teacher_id,
       total_juz = EXCLUDED.total_juz,
       username = EXCLUDED.username,
       password = EXCLUDED.password;
  ELSIF p_table = 'records' THEN
     INSERT INTO records (id, student_id, date, type, surah, ayah_start, ayah_end, grade, notes, class)
     VALUES (
       p_data->>'id',
       p_data->>'student_id',
       (p_data->>'date')::DATE,
       p_data->>'type',
       p_data->>'surah',
       (p_data->>'ayah_start')::INTEGER,
       (p_data->>'ayah_end')::INTEGER,
       p_data->>'grade',
       p_data->>'notes',
       p_data->>'class'
     )
     ON CONFLICT (id) DO UPDATE SET
       student_id = EXCLUDED.student_id,
       date = EXCLUDED.date,
       type = EXCLUDED.type,
       surah = EXCLUDED.surah,
       ayah_start = EXCLUDED.ayah_start,
       ayah_end = EXCLUDED.ayah_end,
       grade = EXCLUDED.grade,
       notes = EXCLUDED.notes,
       class = EXCLUDED.class;
  ELSIF p_table = 'attendance' THEN
     INSERT INTO attendance (id, user_id, date, session, status, approval_status, type, class, late_reason)
     VALUES (
       p_data->>'id',
       p_data->>'user_id',
       (p_data->>'date')::DATE,
       p_data->>'session',
       p_data->>'status',
       p_data->>'approval_status',
       p_data->>'type',
       p_data->>'class',
       p_data->>'late_reason'
     )
     ON CONFLICT (id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       date = EXCLUDED.date,
       session = EXCLUDED.session,
       status = EXCLUDED.status,
       approval_status = EXCLUDED.approval_status,
       type = EXCLUDED.type,
       class = EXCLUDED.class,
       late_reason = EXCLUDED.late_reason;
  ELSIF p_table = 'exams' THEN
     INSERT INTO exams (id, student_id, student_name, date, category, score, examiner, status, notes, juz, class, details)
     VALUES (
       p_data->>'id',
       p_data->>'student_id',
       p_data->>'student_name',
       (p_data->>'date')::DATE,
       p_data->>'category',
       (p_data->>'score')::NUMERIC,
       p_data->>'examiner',
       p_data->>'status',
       p_data->>'notes',
       p_data->>'juz',
       p_data->>'class',
       (p_data->'details')
     )
     ON CONFLICT (id) DO UPDATE SET
       student_id = EXCLUDED.student_id,
       student_name = EXCLUDED.student_name,
       date = EXCLUDED.date,
       category = EXCLUDED.category,
       score = EXCLUDED.score,
       examiner = EXCLUDED.examiner,
       status = EXCLUDED.status,
       notes = EXCLUDED.notes,
       juz = EXCLUDED.juz,
       class = EXCLUDED.class,
       details = EXCLUDED.details;
  END IF;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
