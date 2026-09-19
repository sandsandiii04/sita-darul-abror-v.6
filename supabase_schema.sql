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
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION verify_login(p_username TEXT, p_password TEXT)
RETURNS JSON AS $$
DECLARE
  v_user RECORD;
  v_student RECORD;
BEGIN
  -- 1. Cari di tabel users (Guru / Admin)
  SELECT * INTO v_user FROM users WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
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
  SELECT * INTO v_student FROM students WHERE (username = p_username OR nis = p_username) AND (password = p_password OR password = crypt(p_password, password));
  IF FOUND THEN
    RETURN json_build_object(
      'success', true,
      'type', 'student',
      'data', json_build_object(
        'id', v_student.id,
        'name', v_student.name,
        'role', 'parent',
        'childId', v_student.id,
        'username', v_student.username,
        'password', v_student.password
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
  v_users JSON;
  v_students JSON;
  v_records JSON;
  v_attendance JSON;
  v_exams JSON;
  v_open_requests JSON;
  v_role TEXT;
  v_user_id TEXT;
  v_child_id TEXT;
BEGIN
  -- 1. Verifikasi kredensial di tabel users
  SELECT id, role, child_id INTO v_user_id, v_role, v_child_id FROM users WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
  
  IF NOT FOUND THEN
     -- Coba verifikasi di tabel students (wali santri login menggunakan username/nis santri)
     SELECT id INTO v_user_id FROM students WHERE (username = p_username OR nis = p_username) AND (password = p_password OR password = crypt(p_password, password));
     IF FOUND THEN
        v_role := 'parent';
        v_child_id := v_user_id; -- Wali/santri login memiliki child_id yang sama dengan id santri
     ELSE
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Kredensial login salah');
     END IF;
  END IF;

  -- 2. Kumpulkan data berdasarkan role
  IF v_role = 'admin' THEN
     -- Admin mendapat semua data
     SELECT json_agg(u) INTO v_users FROM (
       SELECT id, name, role, username, password, phone_number, child_id, email, avatar, gender FROM users
     ) u;
     SELECT json_agg(s) INTO v_students FROM students s;
     SELECT json_agg(r) INTO v_records FROM records r;
     SELECT json_agg(a) INTO v_attendance FROM attendance a;
     SELECT json_agg(e) INTO v_exams FROM exams e;
     SELECT json_agg(o) INTO v_open_requests FROM attendance_open_requests o;
  ELSIF v_role = 'teacher' THEN
      -- Guru mendapat data semua guru (minimal untuk list/absen), santri (semua santri agar bisa menguji ujian santri halaqah lain), log tahfidz santri bimbingannya, absen, & ujian
      SELECT json_agg(u) INTO v_users FROM (
        SELECT id, name, role, phone_number, gender FROM users
      ) u;
      -- Memuat semua santri agar guru halaqah bisa menguji santri dari halaqah mana saja
      SELECT json_agg(s) INTO v_students FROM (
        SELECT id, name, nis, class, halaqah, teacher_id, total_juz FROM students
      ) s;
      
      SELECT json_agg(r) INTO v_records FROM records r 
      WHERE r.student_id IN (SELECT id FROM students WHERE teacher_id = v_user_id);
      
      SELECT json_agg(a) INTO v_attendance FROM attendance a; -- Absen guru & santri
      
      -- Memuat seluruh data ujian agar riwayat ujian dapat dilihat dan diuji lintas halaqah
      SELECT json_agg(e) INTO v_exams FROM exams e;
      
      SELECT json_agg(o) INTO v_open_requests FROM attendance_open_requests o WHERE o.teacher_id = v_user_id;
  ELSE
     -- Wali santri (parent) mendapat data santri miliknya saja, log tahfidz, absen, & ujian anaknya
     SELECT json_agg(u) INTO v_users FROM (
       SELECT id, name, role, phone_number, gender FROM users WHERE id = v_user_id OR role = 'teacher'
     ) u;
     SELECT json_agg(s) INTO v_students FROM students s WHERE s.id = v_child_id;
     
     SELECT json_agg(r) INTO v_records FROM records r 
     WHERE r.student_id = v_child_id;
     
     SELECT json_agg(a) INTO v_attendance FROM attendance a 
     WHERE a.user_id = v_child_id;
     
     SELECT json_agg(e) INTO v_exams FROM exams e 
     WHERE e.student_id = v_child_id;
     
     v_open_requests := '[]'::json;
  END IF;

  RETURN json_build_object(
    'success', true,
    'users', COALESCE(v_users, '[]'::json),
    'students', COALESCE(v_students, '[]'::json),
    'records', COALESCE(v_records, '[]'::json),
    'attendance', COALESCE(v_attendance, '[]'::json),
    'exams', COALESCE(v_exams, '[]'::json),
    'open_requests', COALESCE(v_open_requests, '[]'::json)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Fungsi RPC untuk insert/update data (upsert) secara aman dari frontend
CREATE OR REPLACE FUNCTION upsert_data(p_username TEXT, p_password TEXT, p_table TEXT, p_data JSONB)
RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_user_id TEXT;
BEGIN
  -- 1. Verifikasi kredensial pengirim (harus guru, admin, atau wali/santri)
  SELECT id, role INTO v_user_id, v_role FROM users 
  WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
  
  IF NOT FOUND THEN
     -- Cari di tabel students (Wali santri / Santri)
     SELECT id INTO v_user_id FROM students
     WHERE (username = p_username OR nis = p_username) AND (password = p_password OR password = crypt(p_password, password));
     
     IF FOUND THEN
        v_role := 'parent';
     ELSE
        -- Akses Khusus untuk Absen Cepat Guru (tanpa login) menggunakan QR Code yang valid
        IF p_table = 'attendance' AND p_data->>'type' = 'teacher' AND p_data->>'status' = 'present' AND p_data->>'qr_token' = 'SITA_ABSENSI_GURU_TETAP' THEN
           v_role := 'teacher';
           v_user_id := p_data->>'user_id';
        ELSE
           RETURN json_build_object('success', false, 'message', 'Akses ditolak: Kredensial tidak valid');
        END IF;
     END IF;
  END IF;

  -- 2. Validasi Hak Akses (Otorisasi)
  IF v_role = 'admin' THEN
    -- Admin boleh edit/input apa saja
  ELSIF v_role = 'teacher' THEN
    -- Guru boleh mengedit profil dirinya sendiri di tabel users, atau menulis data harian operasional serta capaian santri
    IF p_table = 'users' THEN
      IF p_data->>'id' <> v_user_id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda hanya dapat mengedit profil diri sendiri');
      END IF;
    ELSIF p_table NOT IN ('records', 'attendance', 'exams', 'attendance_open_requests', 'students') THEN
      RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda tidak memiliki izin untuk mengedit tabel ini');
    END IF;
  ELSIF v_role = 'parent' THEN
    -- Wali santri/Santri hanya boleh mengedit profil dirinya sendiri di tabel students
    IF p_table = 'students' THEN
      IF p_data->>'id' <> v_user_id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda hanya dapat mengedit profil diri sendiri');
      END IF;
    ELSE
      RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda tidak memiliki izin untuk mengedit tabel ini');
    END IF;
  ELSE
    -- Lainnya tidak boleh menulis data apa pun
    RETURN json_build_object('success', false, 'message', 'Akses ditolak: Izin tidak mencukupi');
  END IF;

  -- 3. Eksekusi Inserts/Updates
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
       COALESCE(NULLIF(p_data->>'username', ''), p_data->>'nis'),
       COALESCE(NULLIF(p_data->>'password', ''), p_data->>'nis', '123')
     )
     ON CONFLICT (id) DO UPDATE SET
       name = COALESCE(NULLIF(EXCLUDED.name, ''), students.name),
       nis = COALESCE(NULLIF(EXCLUDED.nis, ''), students.nis),
       class = COALESCE(NULLIF(EXCLUDED.class, ''), students.class),
       halaqah = COALESCE(NULLIF(EXCLUDED.halaqah, ''), students.halaqah),
       teacher_id = COALESCE(NULLIF(EXCLUDED.teacher_id, ''), students.teacher_id),
       total_juz = COALESCE(EXCLUDED.total_juz, students.total_juz),
       username = COALESCE(NULLIF(EXCLUDED.username, ''), students.username),
       password = COALESCE(NULLIF(EXCLUDED.password, ''), students.password);
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
  ELSIF p_table = 'attendance_open_requests' THEN
     INSERT INTO attendance_open_requests (id, teacher_id, date, session, type, status, late_reason)
     VALUES (
       p_data->>'id',
       p_data->>'teacher_id',
       (p_data->>'date')::DATE,
       p_data->>'session',
       p_data->>'type',
       p_data->>'status',
       p_data->>'late_reason'
     )
     ON CONFLICT (id) DO UPDATE SET
       teacher_id = EXCLUDED.teacher_id,
       date = EXCLUDED.date,
       session = EXCLUDED.session,
       type = EXCLUDED.type,
       status = EXCLUDED.status,
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

-- 11. Fungsi RPC untuk menghapus data secara aman
CREATE OR REPLACE FUNCTION delete_data_secure(p_username TEXT, p_password TEXT, p_table TEXT, p_id TEXT)
RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_user_id TEXT;
BEGIN
  -- 1. Verifikasi kredensial pengirim
  SELECT id, role INTO v_user_id, v_role FROM users 
  WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'Akses ditolak: Kredensial tidak valid');
  END IF;

  -- 2. Validasi Hak Akses (Otorisasi)
  IF v_role = 'admin' THEN
    -- Admin boleh menghapus apa saja
  ELSIF v_role = 'teacher' THEN
    -- Guru hanya boleh menghapus records harian
    IF p_table NOT IN ('records', 'attendance', 'exams', 'attendance_open_requests') THEN
      RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda tidak memiliki izin untuk menghapus tabel ini');
    END IF;
  ELSE
    -- Wali / Lainnya tidak boleh menghapus data
    RETURN json_build_object('success', false, 'message', 'Akses ditolak: Izin tidak mencukupi');
  END IF;

  -- Validasi nama tabel mencegah SQL injection
  IF p_table NOT IN ('users', 'students', 'records', 'attendance', 'exams', 'attendance_open_requests') THEN
    RETURN json_build_object('success', false, 'message', 'Nama tabel tidak valid');
  END IF;

  -- Eksekusi penghapusan dinamis secara aman
  EXECUTE format('DELETE FROM %I WHERE id = $1', p_table) USING p_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 12. Mengaktifkan Row Level Security (RLS) pada Semua Tabel
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_open_requests ENABLE ROW LEVEL SECURITY;

-- Catatan: RLS diaktifkan TANPA membuat policy SELECT/INSERT/UPDATE/DELETE publik.
-- Hal ini membuat semua akses langsung dari frontend (melalui Client SDK) akan ditolak secara default.
-- Akses data hanya diperbolehkan melalui fungsi RPC yang didefinisikan dengan SECURITY DEFINER.

-- ============================================================
-- 13. Modul Bank Soal Tahfiz Permanen (Darul Abror IBS)
-- ============================================================

CREATE TABLE IF NOT EXISTS question_bank (
    id TEXT PRIMARY KEY,
    exam_type TEXT NOT NULL DEFAULT 'generic' CHECK (exam_type IN ('generic', 'uts', 'uas')),
    question_type TEXT NOT NULL DEFAULT 'random' CHECK (question_type IN ('random', 'mandatory')),
    
    -- Posisi Struktural Titik A (Awal Prompt Penguji)
    prompt_start_surah INTEGER NOT NULL CHECK (prompt_start_surah BETWEEN 1 AND 114),
    prompt_start_ayah INTEGER NOT NULL CHECK (prompt_start_ayah >= 1),
    prompt_start_word INTEGER NOT NULL CHECK (prompt_start_word >= 1),
    
    -- Posisi Struktural Titik A' (Akhir Prompt Penguji)
    prompt_end_surah INTEGER NOT NULL CHECK (prompt_end_surah BETWEEN 1 AND 114),
    prompt_end_ayah INTEGER NOT NULL CHECK (prompt_end_ayah >= 1),
    prompt_end_word INTEGER NOT NULL CHECK (prompt_end_word >= 1),
    
    -- Posisi Struktural Titik B (Santri Mulai Menjawab)
    answer_start_surah INTEGER NOT NULL CHECK (answer_start_surah BETWEEN 1 AND 114),
    answer_start_ayah INTEGER NOT NULL CHECK (answer_start_ayah >= 1),
    answer_start_word INTEGER NOT NULL CHECK (answer_start_word >= 1),
    
    -- Posisi Struktural Titik C (Batas Akhir Jawaban Santri)
    answer_end_surah INTEGER NOT NULL CHECK (answer_end_surah BETWEEN 1 AND 114),
    answer_end_ayah INTEGER NOT NULL CHECK (answer_end_ayah >= 1),
    answer_end_word INTEGER NOT NULL CHECK (answer_end_word >= 1),
    
    -- Posisi Halaman & Juz Mushaf Standar Madinah (1–604, 1–30)
    start_page INTEGER NOT NULL CHECK (start_page BETWEEN 1 AND 604),
    end_page INTEGER NOT NULL CHECK (end_page BETWEEN 1 AND 604),
    start_juz INTEGER NOT NULL CHECK (start_juz BETWEEN 1 AND 30),
    end_juz INTEGER NOT NULL CHECK (end_juz BETWEEN 1 AND 30),
    
    -- Teks Snapshot (untuk preview cepat & riwayat)
    prompt_text TEXT NOT NULL,
    answer_text TEXT NOT NULL,
    total_expected_words INTEGER NOT NULL DEFAULT 0 CHECK (total_expected_words >= 0),
    
    -- Mode Batas & Kesulitan
    answer_mode TEXT NOT NULL DEFAULT 'end_ayah' CHECK (answer_mode IN ('end_ayah', '3_lines', '5_lines', 'specific_ayah', 'manual')),
    difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    
    -- Metadata
    tags JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
    
    -- Audit Timestamps & Creator (users.id berformat TEXT)
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    archived_at TIMESTAMP WITH TIME ZONE,

    -- Validasi Struktural Al-Qur'an di Database: A <= A' < B <= C
    CONSTRAINT chk_qb_page_order CHECK (start_page <= end_page),
    CONSTRAINT chk_qb_juz_order CHECK (start_juz <= end_juz),
    CONSTRAINT chk_qb_a_lte_a_end CHECK (
        (prompt_start_surah < prompt_end_surah) OR 
        (prompt_start_surah = prompt_end_surah AND prompt_start_ayah < prompt_end_ayah) OR 
        (prompt_start_surah = prompt_end_surah AND prompt_start_ayah = prompt_end_ayah AND prompt_start_word <= prompt_end_word)
    ),
    CONSTRAINT chk_qb_a_end_lt_b CHECK (
        (prompt_end_surah < answer_start_surah) OR 
        (prompt_end_surah = answer_start_surah AND prompt_end_ayah < answer_start_ayah) OR 
        (prompt_end_surah = answer_start_surah AND prompt_end_ayah = answer_start_ayah AND prompt_end_word < answer_start_word)
    ),
    CONSTRAINT chk_qb_b_lte_c CHECK (
        (answer_start_surah < answer_end_surah) OR 
        (answer_start_surah = answer_end_surah AND answer_start_ayah < answer_end_ayah) OR 
        (answer_start_surah = answer_end_surah AND answer_start_ayah = answer_end_ayah AND answer_start_word <= answer_end_word)
    )
);

-- Index Duplicate Detection: Mencakup SEMUA 12 koordinat posisi (A, A', B, C) termasuk lintas surat
CREATE INDEX IF NOT EXISTS idx_question_bank_exact_points ON question_bank (
    prompt_start_surah, prompt_start_ayah, prompt_start_word,
    prompt_end_surah, prompt_end_ayah, prompt_end_word,
    answer_start_surah, answer_start_ayah, answer_start_word,
    answer_end_surah, answer_end_ayah, answer_end_word
);

-- Index Pencarian & Filtering
CREATE INDEX IF NOT EXISTS idx_question_bank_status_exam ON question_bank (status, exam_type, question_type);
CREATE INDEX IF NOT EXISTS idx_question_bank_juz_surah ON question_bank (start_juz, prompt_start_surah);
CREATE INDEX IF NOT EXISTS idx_question_bank_difficulty ON question_bank (difficulty);
CREATE INDEX IF NOT EXISTS idx_question_bank_updated_at ON question_bank (updated_at DESC);

-- Trigger Otomatis: Update updated_at pada Setiap Perubahan Baris
CREATE OR REPLACE FUNCTION set_question_bank_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_question_bank_updated_at ON question_bank;
CREATE TRIGGER trg_question_bank_updated_at
BEFORE UPDATE ON question_bank
FOR EACH ROW
EXECUTE FUNCTION set_question_bank_updated_at();

ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qb_deny_direct_access ON question_bank;
CREATE POLICY qb_deny_direct_access ON question_bank
    FOR ALL
    USING (false);

-- RPC: Upsert Question Bank Item (Admin Only dengan Verifikasi Password)
CREATE OR REPLACE FUNCTION upsert_question_bank_item(
    p_username TEXT, 
    p_password TEXT, 
    p_data JSONB
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
    v_user_id TEXT;
    v_id TEXT;
    v_a_surah INT;
    v_a_ayah INT;
    v_a_word INT;
    v_ae_surah INT;
    v_ae_ayah INT;
    v_ae_word INT;
    v_b_surah INT;
    v_b_ayah INT;
    v_b_word INT;
    v_c_surah INT;
    v_c_ayah INT;
    v_c_word INT;
    v_start_page INT;
    v_end_page INT;
    v_start_juz INT;
    v_end_juz INT;
BEGIN
    SELECT id, role INTO v_user_id, v_role FROM users 
    WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengelola Bank Soal.');
    END IF;

    v_a_surah := (p_data->'prompt_start'->>'surah')::INT;
    v_a_ayah  := (p_data->'prompt_start'->>'ayah')::INT;
    v_a_word  := (p_data->'prompt_start'->>'word')::INT;

    v_ae_surah := (p_data->'prompt_end'->>'surah')::INT;
    v_ae_ayah  := (p_data->'prompt_end'->>'ayah')::INT;
    v_ae_word  := (p_data->'prompt_end'->>'word')::INT;

    v_b_surah := (p_data->'answer_start'->>'surah')::INT;
    v_b_ayah  := (p_data->'answer_start'->>'ayah')::INT;
    v_b_word  := (p_data->'answer_start'->>'word')::INT;

    v_c_surah := (p_data->'answer_end'->>'surah')::INT;
    v_c_ayah  := (p_data->'answer_end'->>'ayah')::INT;
    v_c_word  := (p_data->'answer_end'->>'word')::INT;

    v_start_page := (p_data->>'start_page')::INT;
    v_end_page   := (p_data->>'end_page')::INT;
    v_start_juz  := (p_data->>'start_juz')::INT;
    v_end_juz    := (p_data->>'end_juz')::INT;

    IF v_a_surah < 1 OR v_a_surah > 114 OR v_ae_surah < 1 OR v_ae_surah > 114 OR
       v_b_surah < 1 OR v_b_surah > 114 OR v_c_surah < 1 OR v_c_surah > 114 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Nomor surat harus antara 1 dan 114.');
    END IF;

    IF v_start_page < 1 OR v_start_page > 604 OR v_end_page < 1 OR v_end_page > 604 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Halaman mushaf harus antara 1 dan 604.');
    END IF;

    IF v_start_juz < 1 OR v_start_juz > 30 OR v_end_juz < 1 OR v_end_juz > 30 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Juz Al-Qur''an harus antara 1 dan 30.');
    END IF;

    IF (v_a_surah > v_ae_surah) OR 
       (v_a_surah = v_ae_surah AND v_a_ayah > v_ae_ayah) OR 
       (v_a_surah = v_ae_surah AND v_a_ayah = v_ae_ayah AND v_a_word > v_ae_word) THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Titik A awal prompt tidak boleh melebihi akhir prompt A''.');
    END IF;

    IF (v_ae_surah > v_b_surah) OR 
       (v_ae_surah = v_b_surah AND v_ae_ayah > v_b_ayah) OR 
       (v_ae_surah = v_b_surah AND v_ae_ayah = v_b_ayah AND v_ae_word >= v_b_word) THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Titik B santri menjawab harus setelah akhir prompt A''.');
    END IF;

    IF (v_b_surah > v_c_surah) OR 
       (v_b_surah = v_c_surah AND v_b_ayah > v_c_ayah) OR 
       (v_b_surah = v_c_surah AND v_b_ayah = v_c_ayah AND v_b_word > v_c_word) THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Titik B santri menjawab tidak boleh melebihi batas akhir C.');
    END IF;

    v_id := COALESCE(p_data->>'id', 'qb_' || floor(extract(epoch from now()))::text || '_' || substr(md5(random()::text), 1, 6));

    INSERT INTO question_bank (
        id,
        exam_type,
        question_type,
        prompt_start_surah,
        prompt_start_ayah,
        prompt_start_word,
        prompt_end_surah,
        prompt_end_ayah,
        prompt_end_word,
        answer_start_surah,
        answer_start_ayah,
        answer_start_word,
        answer_end_surah,
        answer_end_ayah,
        answer_end_word,
        start_page,
        end_page,
        start_juz,
        end_juz,
        prompt_text,
        answer_text,
        total_expected_words,
        answer_mode,
        difficulty,
        tags,
        notes,
        status,
        created_by,
        updated_at
    ) VALUES (
        v_id,
        COALESCE(p_data->>'exam_type', 'generic'),
        COALESCE(p_data->>'question_type', 'random'),
        v_a_surah,
        v_a_ayah,
        v_a_word,
        v_ae_surah,
        v_ae_ayah,
        v_ae_word,
        v_b_surah,
        v_b_ayah,
        v_b_word,
        v_c_surah,
        v_c_ayah,
        v_c_word,
        v_start_page,
        v_end_page,
        v_start_juz,
        v_end_juz,
        p_data->>'prompt_text',
        p_data->>'answer_text',
        COALESCE((p_data->>'total_expected_words')::INT, 0),
        COALESCE(p_data->>'answer_mode', 'end_ayah'),
        COALESCE(p_data->>'difficulty', 'medium'),
        COALESCE(p_data->'tags', '[]'::jsonb),
        p_data->>'notes',
        COALESCE(p_data->>'status', 'active'),
        v_user_id,
        timezone('utc'::text, now())
    )
    ON CONFLICT (id) DO UPDATE SET
        exam_type = EXCLUDED.exam_type,
        question_type = EXCLUDED.question_type,
        prompt_start_surah = EXCLUDED.prompt_start_surah,
        prompt_start_ayah = EXCLUDED.prompt_start_ayah,
        prompt_start_word = EXCLUDED.prompt_start_word,
        prompt_end_surah = EXCLUDED.prompt_end_surah,
        prompt_end_ayah = EXCLUDED.prompt_end_ayah,
        prompt_end_word = EXCLUDED.prompt_end_word,
        answer_start_surah = EXCLUDED.answer_start_surah,
        answer_start_ayah = EXCLUDED.answer_start_ayah,
        answer_start_word = EXCLUDED.answer_start_word,
        answer_end_surah = EXCLUDED.answer_end_surah,
        answer_end_ayah = EXCLUDED.answer_end_ayah,
        answer_end_word = EXCLUDED.answer_end_word,
        start_page = EXCLUDED.start_page,
        end_page = EXCLUDED.end_page,
        start_juz = EXCLUDED.start_juz,
        end_juz = EXCLUDED.end_juz,
        prompt_text = EXCLUDED.prompt_text,
        answer_text = EXCLUDED.answer_text,
        total_expected_words = EXCLUDED.total_expected_words,
        answer_mode = EXCLUDED.answer_mode,
        difficulty = EXCLUDED.difficulty,
        tags = EXCLUDED.tags,
        notes = EXCLUDED.notes,
        status = EXCLUDED.status,
        updated_at = timezone('utc'::text, now());

    RETURN json_build_object('success', true, 'id', v_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Archive Question Bank Item (Admin Only)
CREATE OR REPLACE FUNCTION archive_question_bank_item(
    p_username TEXT, 
    p_password TEXT, 
    p_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT role INTO v_role FROM users 
    WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengarsipkan soal.');
    END IF;

    UPDATE question_bank 
    SET status = 'archived', 
        archived_at = timezone('utc'::text, now()), 
        updated_at = timezone('utc'::text, now())
    WHERE id = p_id;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Restore Question Bank Item (Admin Only)
CREATE OR REPLACE FUNCTION restore_question_bank_item(
    p_username TEXT, 
    p_password TEXT, 
    p_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT role INTO v_role FROM users 
    WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak memulihkan soal.');
    END IF;

    UPDATE question_bank 
    SET status = 'active', 
        archived_at = NULL, 
        updated_at = timezone('utc'::text, now())
    WHERE id = p_id;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Get Question Bank Secure (Admin Only)
CREATE OR REPLACE FUNCTION get_question_bank_secure(
    p_username TEXT, 
    p_password TEXT
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
    v_items JSON;
BEGIN
    SELECT role INTO v_role FROM users 
    WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membaca Bank Soal.');
    END IF;

    SELECT json_agg(q ORDER BY q.updated_at DESC) INTO v_items FROM question_bank q;

    RETURN json_build_object('success', true, 'data', COALESCE(v_items, '[]'::json));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 10. EVALUASI TAHFIZ (Tahap 4: Periode & Persiapan Materi UTS/UAS)
-- ============================================================

-- 1. TABEL: academic_terms
CREATE TABLE IF NOT EXISTS academic_terms (
    id TEXT PRIMARY KEY,
    academic_year TEXT NOT NULL,
    semester TEXT NOT NULL CHECK (semester IN ('ganjil', 'genap')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed')),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT chk_academic_term_dates CHECK (start_date <= end_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_terms_unique_active 
ON academic_terms(status) 
WHERE status = 'active';

-- 2. TABEL: exam_periods
CREATE TABLE IF NOT EXISTS exam_periods (
    id TEXT PRIMARY KEY,
    academic_term_id TEXT NOT NULL REFERENCES academic_terms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    exam_type TEXT NOT NULL CHECK (exam_type IN ('uts', 'uas')),
    material_cutoff_date DATE NOT NULL,
    exam_start_date DATE,
    exam_end_date DATE,
    kkm NUMERIC NOT NULL DEFAULT 75 CHECK (kkm >= 0 AND kkm <= 100),
    target_classes TEXT[] DEFAULT '{}',
    target_halaqahs TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'preparation', 'active', 'completed')),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. TABEL: exam_participants
CREATE TABLE IF NOT EXISTS exam_participants (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT NOT NULL REFERENCES exam_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    student_name_snapshot TEXT NOT NULL,
    class_snapshot TEXT NOT NULL,
    halaqah_snapshot TEXT NOT NULL,
    teacher_id_snapshot TEXT REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'exempt', 'completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_exam_participant UNIQUE(exam_period_id, student_id)
);

-- 4. TABEL: exam_material_snapshots
CREATE TABLE IF NOT EXISTS exam_material_snapshots (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT NOT NULL REFERENCES exam_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL DEFAULT 'automatic' CHECK (source_type IN ('automatic', 'manual_override')),
    start_surah INTEGER NOT NULL CHECK (start_surah BETWEEN 1 AND 114),
    start_ayah INTEGER NOT NULL CHECK (start_ayah >= 1),
    end_surah INTEGER NOT NULL CHECK (end_surah BETWEEN 1 AND 114),
    end_ayah INTEGER NOT NULL CHECK (end_ayah >= 1),
    start_page INTEGER CHECK (start_page BETWEEN 1 AND 604),
    end_page INTEGER CHECK (end_page BETWEEN 1 AND 604),
    start_juz INTEGER CHECK (start_juz BETWEEN 1 AND 30),
    end_juz INTEGER CHECK (end_juz BETWEEN 1 AND 30),
    estimated_pages NUMERIC DEFAULT 0,
    start_surah_name TEXT,
    end_surah_name TEXT,
    first_record_date DATE,
    last_record_date DATE,
    total_records_analyzed INTEGER DEFAULT 0,
    memorization_direction TEXT DEFAULT 'forward' CHECK (memorization_direction IN ('forward', 'backward', 'single_surah', 'unknown')),
    status TEXT NOT NULL DEFAULT 'not_ready' CHECK (status IN ('not_ready', 'needs_review', 'ready', 'finalized')),
    review_reason TEXT,
    verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    finalized_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    finalized_at TIMESTAMP WITH TIME ZONE,
    override_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_exam_material_snapshot UNIQUE(exam_period_id, student_id)
);

-- 5. TABEL: exam_audit_logs
CREATE TABLE IF NOT EXISTS exam_audit_logs (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT,
    student_id TEXT,
    action TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    before_data JSONB,
    after_data JSONB,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. RLS: Proteksi Akses Langsung
ALTER TABLE academic_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_material_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS terms_deny_direct_access ON academic_terms;
CREATE POLICY terms_deny_direct_access ON academic_terms FOR ALL USING (false);

DROP POLICY IF EXISTS periods_deny_direct_access ON exam_periods;
CREATE POLICY periods_deny_direct_access ON exam_periods FOR ALL USING (false);

DROP POLICY IF EXISTS participants_deny_direct_access ON exam_participants;
CREATE POLICY participants_deny_direct_access ON exam_participants FOR ALL USING (false);

DROP POLICY IF EXISTS material_deny_direct_access ON exam_material_snapshots;
CREATE POLICY material_deny_direct_access ON exam_material_snapshots FOR ALL USING (false);

DROP POLICY IF EXISTS audit_deny_direct_access ON exam_audit_logs;
CREATE POLICY audit_deny_direct_access ON exam_audit_logs FOR ALL USING (false);


-- ============================================================
-- 7. STORED PROCEDURES (SECURITY DEFINER RPC)
-- ============================================================

-- RPC 1: upsert_academic_term (Admin Only)
CREATE OR REPLACE FUNCTION upsert_academic_term(
    p_username TEXT,
    p_password TEXT,
    p_term JSONB
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_id TEXT;
    v_year TEXT;
    v_sem TEXT;
    v_start DATE;
    v_end DATE;
    v_status TEXT;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengelola Semester.');
    END IF;

    v_id := COALESCE(p_term->>'id', 'term_' || extract(epoch from now())::bigint);
    v_year := p_term->>'academicYear';
    v_sem := p_term->>'semester';
    v_start := (p_term->>'startDate')::DATE;
    v_end := (p_term->>'endDate')::DATE;
    v_status := COALESCE(p_term->>'status', 'draft');

    IF v_start > v_end THEN
        RETURN json_build_object('success', false, 'message', 'Tanggal mulai semester tidak boleh lebih besar dari tanggal selesai.');
    END IF;

    -- Jika diset menjadi 'active', nonaktifkan semester aktif lainnya terlebih dahulu
    IF v_status = 'active' THEN
        UPDATE academic_terms SET status = 'completed', updated_at = now() WHERE status = 'active' AND id != v_id;
    END IF;

    INSERT INTO academic_terms (id, academic_year, semester, start_date, end_date, status, created_by, created_at, updated_at)
    VALUES (v_id, v_year, v_sem, v_start, v_end, v_status, v_user.id, now(), now())
    ON CONFLICT (id) DO UPDATE SET
        academic_year = EXCLUDED.academic_year,
        semester = EXCLUDED.semester,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        status = EXCLUDED.status,
        updated_at = now();

    RETURN json_build_object('success', true, 'id', v_id, 'message', 'Semester berhasil disimpan.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 2: get_academic_terms (Admin / Teacher)
CREATE OR REPLACE FUNCTION get_academic_terms(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_terms JSON;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;
    
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT json_agg(json_build_object(
        'id', t.id,
        'academicYear', t.academic_year,
        'semester', t.semester,
        'startDate', t.start_date,
        'endDate', t.end_date,
        'status', t.status,
        'createdBy', t.created_by,
        'createdAt', t.created_at,
        'updatedAt', t.updated_at
    ) ORDER BY t.start_date DESC) INTO v_terms
    FROM academic_terms t;

    RETURN json_build_object('success', true, 'data', COALESCE(v_terms, '[]'::json));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 3: create_exam_period_with_participants (Admin Only, Transaction-Safe)
CREATE OR REPLACE FUNCTION create_exam_period_with_participants(
    p_username TEXT,
    p_password TEXT,
    p_period JSONB,
    p_student_ids TEXT[]
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period_id TEXT;
    v_term_id TEXT;
    v_term RECORD;
    v_cutoff DATE;
    v_kkm NUMERIC;
    v_student RECORD;
    v_count INTEGER := 0;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuat Periode Ujian.');
    END IF;

    v_term_id := p_period->>'academicTermId';
    SELECT * INTO v_term FROM academic_terms WHERE id = v_term_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Semester akademik tidak ditemukan.');
    END IF;

    v_cutoff := (p_period->>'materialCutoffDate')::DATE;
    IF v_cutoff < v_term.start_date THEN
        RETURN json_build_object('success', false, 'message', 'Tanggal batas materi (cutoff) tidak boleh sebelum tanggal awal semester.');
    END IF;

    v_period_id := COALESCE(p_period->>'id', 'period_' || extract(epoch from now())::bigint);
    v_kkm := COALESCE((p_period->>'kkm')::NUMERIC, 75);

    -- 1. Insert exam_period
    INSERT INTO exam_periods (
        id, academic_term_id, name, exam_type, material_cutoff_date,
        exam_start_date, exam_end_date, kkm, target_classes, target_halaqahs,
        status, created_by, created_at, updated_at
    ) VALUES (
        v_period_id,
        v_term_id,
        p_period->>'name',
        p_period->>'examType',
        v_cutoff,
        (p_period->>'examStartDate')::DATE,
        (p_period->>'examEndDate')::DATE,
        v_kkm,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_period->'targetClasses', '[]'::jsonb))),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_period->'targetHalaqahs', '[]'::jsonb))),
        COALESCE(p_period->>'status', 'preparation'),
        v_user.id,
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        exam_type = EXCLUDED.exam_type,
        material_cutoff_date = EXCLUDED.material_cutoff_date,
        exam_start_date = EXCLUDED.exam_start_date,
        exam_end_date = EXCLUDED.exam_end_date,
        kkm = EXCLUDED.kkm,
        target_classes = EXCLUDED.target_classes,
        target_halaqahs = EXCLUDED.target_halaqahs,
        status = EXCLUDED.status,
        updated_at = now();

    -- 2. Insert participants with profile snapshots
    IF array_length(p_student_ids, 1) > 0 THEN
        FOR v_student IN 
            SELECT id, name, class, halaqah, teacher_id 
            FROM students 
            WHERE id = ANY(p_student_ids)
        LOOP
            INSERT INTO exam_participants (
                id, exam_period_id, student_id,
                student_name_snapshot, class_snapshot, halaqah_snapshot, teacher_id_snapshot,
                status, created_at, updated_at
            ) VALUES (
                'part_' || v_period_id || '_' || v_student.id,
                v_period_id,
                v_student.id,
                v_student.name,
                v_student.class,
                v_student.halaqah,
                v_student.teacher_id,
                'registered',
                now(),
                now()
            )
            ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
                student_name_snapshot = EXCLUDED.student_name_snapshot,
                class_snapshot = EXCLUDED.class_snapshot,
                halaqah_snapshot = EXCLUDED.halaqah_snapshot,
                teacher_id_snapshot = EXCLUDED.teacher_id_snapshot,
                updated_at = now();

            v_count := v_count + 1;
        END LOOP;
    END IF;

    -- 3. Audit log
    INSERT INTO exam_audit_logs (id, exam_period_id, action, actor_id, after_data, reason, created_at)
    VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_period_id,
        'period_created',
        v_user.id,
        jsonb_build_object('name', p_period->>'name', 'participantsCount', v_count),
        'Pembuatan periode evaluasi dan pendaftaran peserta awal',
        now()
    );

    RETURN json_build_object('success', true, 'periodId', v_period_id, 'participantsCount', v_count, 'message', 'Periode ujian dan peserta berhasil disimpan.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 4: save_material_snapshots_batch (Admin Only, Atomic)
CREATE OR REPLACE FUNCTION save_material_snapshots_batch(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT,
    p_snapshots JSONB
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_item JSONB;
    v_count INTEGER := 0;
    v_skipped INTEGER := 0;
    v_existing_status TEXT;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak memperbarui snapshot materi.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_snapshots)
    LOOP
        -- Periksa apakah snapshot untuk santri ini sudah berstatus 'finalized'
        SELECT status INTO v_existing_status 
        FROM exam_material_snapshots 
        WHERE exam_period_id = p_period_id AND student_id = v_item->>'studentId';

        IF v_existing_status = 'finalized' THEN
            -- JANGAN TIMPA snapshot yang sudah final!
            v_skipped := v_skipped + 1;
        ELSE
            INSERT INTO exam_material_snapshots (
                id, exam_period_id, student_id, source_type,
                start_surah, start_ayah, end_surah, end_ayah,
                start_page, end_page, start_juz, end_juz, estimated_pages,
                start_surah_name, end_surah_name,
                first_record_date, last_record_date, total_records_analyzed, memorization_direction,
                status, review_reason,
                created_at, updated_at
            ) VALUES (
                COALESCE(v_item->>'id', 'snap_' || p_period_id || '_' || (v_item->>'studentId')),
                p_period_id,
                v_item->>'studentId',
                COALESCE(v_item->>'sourceType', 'automatic'),
                (v_item->>'startSurah')::INTEGER,
                (v_item->>'startAyah')::INTEGER,
                (v_item->>'endSurah')::INTEGER,
                (v_item->>'endAyah')::INTEGER,
                (v_item->>'startPage')::INTEGER,
                (v_item->>'endPage')::INTEGER,
                (v_item->>'startJuz')::INTEGER,
                (v_item->>'endJuz')::INTEGER,
                COALESCE((v_item->>'estimatedPages')::NUMERIC, 0),
                v_item->>'startSurahName',
                v_item->>'endSurahName',
                (v_item->>'firstRecordDate')::DATE,
                (v_item->>'lastRecordDate')::DATE,
                COALESCE((v_item->>'totalRecordsAnalyzed')::INTEGER, 0),
                COALESCE(v_item->>'memorizationDirection', 'forward'),
                COALESCE(v_item->>'status', 'not_ready'),
                v_item->>'reviewReason',
                now(),
                now()
            )
            ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
                source_type = EXCLUDED.source_type,
                start_surah = EXCLUDED.start_surah,
                start_ayah = EXCLUDED.start_ayah,
                end_surah = EXCLUDED.end_surah,
                end_ayah = EXCLUDED.end_ayah,
                start_page = EXCLUDED.start_page,
                end_page = EXCLUDED.end_page,
                start_juz = EXCLUDED.start_juz,
                end_juz = EXCLUDED.end_juz,
                estimated_pages = EXCLUDED.estimated_pages,
                start_surah_name = EXCLUDED.start_surah_name,
                end_surah_name = EXCLUDED.end_surah_name,
                first_record_date = EXCLUDED.first_record_date,
                last_record_date = EXCLUDED.last_record_date,
                total_records_analyzed = EXCLUDED.total_records_analyzed,
                memorization_direction = EXCLUDED.memorization_direction,
                status = EXCLUDED.status,
                review_reason = EXCLUDED.review_reason,
                updated_at = now();

            v_count := v_count + 1;
        END IF;
    END LOOP;

    -- Audit log
    INSERT INTO exam_audit_logs (id, exam_period_id, action, actor_id, after_data, reason, created_at)
    VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        'material_generated',
        v_user.id,
        jsonb_build_object('savedCount', v_count, 'skippedFinalizedCount', v_skipped),
        'Auto-generate / batch snapshot materi ujian santri',
        now()
    );

    RETURN json_build_object('success', true, 'savedCount', v_count, 'skippedFinalizedCount', v_skipped, 'message', 'Snapshot materi berhasil disimpan.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 5: verify_or_override_material_snapshot (Teacher / Admin)
CREATE OR REPLACE FUNCTION verify_or_override_material_snapshot(
    p_username TEXT,
    p_password TEXT,
    p_snapshot_id TEXT,
    p_action TEXT, -- 'verify', 'override', 'finalize'
    p_data JSONB,
    p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_snap RECORD;
    v_participant RECORD;
    v_period RECORD;
    v_before JSONB;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    SELECT * INTO v_snap FROM exam_material_snapshots WHERE id = p_snapshot_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi tidak ditemukan.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_snap.exam_period_id;
    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    SELECT * INTO v_participant FROM exam_participants 
    WHERE exam_period_id = v_snap.exam_period_id AND student_id = v_snap.student_id;

    -- Otorisasi Role: Jika guru, harus sesuai dengan halaqah santri
    IF v_user.role = 'teacher' THEN
        IF v_participant.teacher_id_snapshot != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda hanya dapat memverifikasi santri halaqah Anda sendiri.');
        END IF;
    ELSIF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    v_before := to_jsonb(v_snap);

    IF p_action = 'verify' THEN
        UPDATE exam_material_snapshots SET
            status = 'ready',
            verified_by = v_user.id,
            verified_at = now(),
            updated_at = now()
        WHERE id = p_snapshot_id;

        INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
        VALUES ('audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6), v_snap.exam_period_id, v_snap.student_id, 'material_verified', v_user.id, v_before, to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)), p_reason, now());

        RETURN json_build_object('success', true, 'message', 'Materi berhasil diverifikasi.');

    ELSIF p_action = 'override' THEN
        IF p_reason IS NULL OR trim(p_reason) = '' THEN
            RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan koreksi manual.');
        END IF;

        UPDATE exam_material_snapshots SET
            source_type = 'manual_override',
            start_surah = (p_data->>'startSurah')::INTEGER,
            start_ayah = (p_data->>'startAyah')::INTEGER,
            end_surah = (p_data->>'endSurah')::INTEGER,
            end_ayah = (p_data->>'endAyah')::INTEGER,
            start_page = (p_data->>'startPage')::INTEGER,
            end_page = (p_data->>'endPage')::INTEGER,
            start_juz = (p_data->>'startJuz')::INTEGER,
            end_juz = (p_data->>'endJuz')::INTEGER,
            estimated_pages = COALESCE((p_data->>'estimatedPages')::NUMERIC, 0),
            start_surah_name = p_data->>'startSurahName',
            end_surah_name = p_data->>'endSurahName',
            override_reason = p_reason,
            status = 'ready',
            verified_by = v_user.id,
            verified_at = now(),
            updated_at = now()
        WHERE id = p_snapshot_id;

        INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
        VALUES ('audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6), v_snap.exam_period_id, v_snap.student_id, 'material_override', v_user.id, v_before, to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)), p_reason, now());

        RETURN json_build_object('success', true, 'message', 'Koreksi materi manual berhasil disimpan.');

    ELSIF p_action = 'finalize' THEN
        IF v_snap.status NOT IN ('ready', 'needs_review') THEN
            RETURN json_build_object('success', false, 'message', 'Materi belum siap untuk difinalisasi.');
        END IF;

        UPDATE exam_material_snapshots SET
            status = 'finalized',
            finalized_by = v_user.id,
            finalized_at = now(),
            updated_at = now()
        WHERE id = p_snapshot_id;

        INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
        VALUES ('audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6), v_snap.exam_period_id, v_snap.student_id, 'material_finalized', v_user.id, v_before, to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)), p_reason, now());

        RETURN json_build_object('success', true, 'message', 'Materi berhasil difinalisasi.');
    ELSE
        RETURN json_build_object('success', false, 'message', 'Aksi tidak dikenali.');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 6: reopen_material_snapshot (Admin Only)
CREATE OR REPLACE FUNCTION reopen_material_snapshot(
    p_username TEXT,
    p_password TEXT,
    p_snapshot_id TEXT,
    p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_snap RECORD;
    v_period RECORD;
    v_before JSONB;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuka kembali materi final.');
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan pembukaan kembali materi.');
    END IF;

    SELECT * INTO v_snap FROM exam_material_snapshots WHERE id = p_snapshot_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi tidak ditemukan.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_snap.exam_period_id;
    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    v_before := to_jsonb(v_snap);

    UPDATE exam_material_snapshots SET
        status = 'ready',
        finalized_by = NULL,
        finalized_at = NULL,
        updated_at = now()
    WHERE id = p_snapshot_id;

    INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
    VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_snap.exam_period_id,
        v_snap.student_id,
        'material_reopened',
        v_user.id,
        v_before,
        to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)),
        p_reason,
        now()
    );

    RETURN json_build_object('success', true, 'message', 'Materi berhasil dibuka kembali untuk revisi.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 7: bulk_finalize_material_snapshots (Admin Only, Ready Items Only)
CREATE OR REPLACE FUNCTION bulk_finalize_material_snapshots(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_finalized_count INTEGER := 0;
    v_needs_review_count INTEGER := 0;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak melakukan finalisasi massal.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    -- Hitung yang berstatus needs_review (ini TIDAK boleh ikut finalisasi massal)
    SELECT count(*) INTO v_needs_review_count 
    FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND status = 'needs_review';

    -- Update hanya yang statusnya 'ready'
    WITH updated AS (
        UPDATE exam_material_snapshots SET
            status = 'finalized',
            finalized_by = v_user.id,
            finalized_at = now(),
            updated_at = now()
        WHERE exam_period_id = p_period_id AND status = 'ready'
        RETURNING id
    )
    SELECT count(*) INTO v_finalized_count FROM updated;

    INSERT INTO exam_audit_logs (id, exam_period_id, action, actor_id, after_data, reason, created_at)
    VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        'bulk_finalized',
        v_user.id,
        jsonb_build_object('finalizedCount', v_finalized_count, 'skippedNeedsReview', v_needs_review_count),
        'Finalisasi massal seluruh santri yang berstatus Siap (Ready)',
        now()
    );

    RETURN json_build_object(
        'success', true,
        'finalizedCount', v_finalized_count,
        'skippedNeedsReview', v_needs_review_count,
        'message', v_finalized_count || ' santri berhasil difinalisasi. ' || v_needs_review_count || ' santri perlu verifikasi manual.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 8: get_tahfiz_evaluation_data (Role-Based Secure Query)
CREATE OR REPLACE FUNCTION get_tahfiz_evaluation_data(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_term RECORD;
    v_participants JSON;
    v_snapshots JSON;
    v_audit_logs JSON;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Parent tidak memiliki akses ke data evaluasi.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    SELECT * INTO v_term FROM academic_terms WHERE id = v_period.academic_term_id;

    -- Query Peserta: Admin melihat semua, Guru hanya melihat santri halaqahnya
    IF v_user.role = 'admin' THEN
        SELECT json_agg(json_build_object(
            'id', p.id,
            'examPeriodId', p.exam_period_id,
            'studentId', p.student_id,
            'studentName', p.student_name_snapshot,
            'class', p.class_snapshot,
            'halaqah', p.halaqah_snapshot,
            'teacherId', p.teacher_id_snapshot,
            'status', p.status
        ) ORDER BY p.class_snapshot, p.student_name_snapshot) INTO v_participants
        FROM exam_participants p
        WHERE p.exam_period_id = p_period_id;

        SELECT json_agg(json_build_object(
            'id', s.id,
            'examPeriodId', s.exam_period_id,
            'studentId', s.student_id,
            'sourceType', s.source_type,
            'startSurah', s.start_surah,
            'startAyah', s.start_ayah,
            'endSurah', s.end_surah,
            'endAyah', s.end_ayah,
            'startPage', s.start_page,
            'endPage', s.end_page,
            'startJuz', s.start_juz,
            'endJuz', s.end_juz,
            'estimatedPages', s.estimated_pages,
            'startSurahName', s.start_surah_name,
            'endSurahName', s.end_surah_name,
            'firstRecordDate', s.first_record_date,
            'lastRecordDate', s.last_record_date,
            'totalRecordsAnalyzed', s.total_records_analyzed,
            'memorizationDirection', s.memorization_direction,
            'status', s.status,
            'reviewReason', s.review_reason,
            'overrideReason', s.override_reason,
            'verifiedBy', s.verified_by,
            'verifiedAt', s.verified_at,
            'finalizedBy', s.finalized_by,
            'finalizedAt', s.finalized_at
        )) INTO v_snapshots
        FROM exam_material_snapshots s
        WHERE s.exam_period_id = p_period_id;

        SELECT json_agg(json_build_object(
            'id', a.id,
            'examPeriodId', a.exam_period_id,
            'studentId', a.student_id,
            'action', a.action,
            'actorId', a.actor_id,
            'beforeData', a.before_data,
            'afterData', a.after_data,
            'reason', a.reason,
            'createdAt', a.created_at
        ) ORDER BY a.created_at DESC) INTO v_audit_logs
        FROM exam_audit_logs a
        WHERE a.exam_period_id = p_period_id;

    ELSE
        -- TEACHER: Filter hanya santri halaqahnya
        SELECT json_agg(json_build_object(
            'id', p.id,
            'examPeriodId', p.exam_period_id,
            'studentId', p.student_id,
            'studentName', p.student_name_snapshot,
            'class', p.class_snapshot,
            'halaqah', p.halaqah_snapshot,
            'teacherId', p.teacher_id_snapshot,
            'status', p.status
        ) ORDER BY p.student_name_snapshot) INTO v_participants
        FROM exam_participants p
        WHERE p.exam_period_id = p_period_id 
          AND p.teacher_id_snapshot = v_user.id;

        SELECT json_agg(json_build_object(
            'id', s.id,
            'examPeriodId', s.exam_period_id,
            'studentId', s.student_id,
            'sourceType', s.source_type,
            'startSurah', s.start_surah,
            'startAyah', s.start_ayah,
            'endSurah', s.end_surah,
            'endAyah', s.end_ayah,
            'startPage', s.start_page,
            'endPage', s.end_page,
            'startJuz', s.start_juz,
            'endJuz', s.end_juz,
            'estimatedPages', s.estimated_pages,
            'startSurahName', s.start_surah_name,
            'endSurahName', s.end_surah_name,
            'firstRecordDate', s.first_record_date,
            'lastRecordDate', s.last_record_date,
            'totalRecordsAnalyzed', s.total_records_analyzed,
            'memorizationDirection', s.memorization_direction,
            'status', s.status,
            'reviewReason', s.review_reason,
            'overrideReason', s.override_reason,
            'verifiedBy', s.verified_by,
            'verifiedAt', s.verified_at,
            'finalizedBy', s.finalized_by,
            'finalizedAt', s.finalized_at
        )) INTO v_snapshots
        FROM exam_material_snapshots s
        JOIN exam_participants ep ON ep.exam_period_id = s.exam_period_id AND ep.student_id = s.student_id
        WHERE s.exam_period_id = p_period_id
          AND ep.teacher_id_snapshot = v_user.id;

        v_audit_logs := '[]'::json;
    END IF;

    RETURN json_build_object(
        'success', true,
        'period', json_build_object(
            'id', v_period.id,
            'academicTermId', v_period.academic_term_id,
            'name', v_period.name,
            'examType', v_period.exam_type,
            'materialCutoffDate', v_period.material_cutoff_date,
            'examStartDate', v_period.exam_start_date,
            'examEndDate', v_period.exam_end_date,
            'kkm', v_period.kkm,
            'targetClasses', v_period.target_classes,
            'targetHalaqahs', v_period.target_halaqahs,
            'status', v_period.status
        ),
        'academicTerm', json_build_object(
            'id', v_term.id,
            'academicYear', v_term.academic_year,
            'semester', v_term.semester,
            'startDate', v_term.start_date,
            'endDate', v_term.end_date,
            'status', v_term.status
        ),
        'participants', COALESCE(v_participants, '[]'::json),
        'materialSnapshots', COALESCE(v_snapshots, '[]'::json),
        'auditLogs', COALESCE(v_audit_logs, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =========================================================================
-- HOTFIX: RLS READ ACCESS & get_exam_periods RPC
-- =========================================================================
DROP POLICY IF EXISTS periods_deny_direct_access ON exam_periods;
DROP POLICY IF EXISTS periods_allow_read ON exam_periods;

CREATE POLICY periods_allow_read ON exam_periods 
    FOR SELECT 
    USING (true);

DROP POLICY IF EXISTS periods_deny_insert ON exam_periods;
CREATE POLICY periods_deny_insert ON exam_periods FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS periods_deny_update ON exam_periods;
CREATE POLICY periods_deny_update ON exam_periods FOR UPDATE USING (false);

DROP POLICY IF EXISTS periods_deny_delete ON exam_periods;
CREATE POLICY periods_deny_delete ON exam_periods FOR DELETE USING (false);

CREATE OR REPLACE FUNCTION get_exam_periods(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_periods JSON;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (
          password = p_password 
          OR password = crypt(p_password, password)
      );
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;
    
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Parent tidak memiliki akses ke periode ujian.');
    END IF;

    SELECT json_agg(json_build_object(
        'id', p.id,
        'academicTermId', p.academic_term_id,
        'name', p.name,
        'examType', p.exam_type,
        'materialCutoffDate', p.material_cutoff_date,
        'examStartDate', p.exam_start_date,
        'examEndDate', p.exam_end_date,
        'kkm', p.kkm,
        'targetClasses', p.target_classes,
        'targetHalaqahs', p.target_halaqahs,
        'status', p.status,
        'createdBy', p.created_by,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at
    ) ORDER BY p.material_cutoff_date DESC, p.created_at DESC) INTO v_periods
    FROM exam_periods p;

    RETURN json_build_object('success', true, 'data', COALESCE(v_periods, '[]'::json));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_exam_periods(TEXT, TEXT) TO anon, authenticated, service_role;


-- RPC delete_exam_period (Admin Only, Cascade-Safe)
CREATE OR REPLACE FUNCTION delete_exam_period(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (
          password = p_password 
          OR password = crypt(p_password, password)
      );
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak menghapus Periode Ujian.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan atau sudah dihapus.');
    END IF;

    -- Lepaskan referensi pada konfigurasi rekap semester jika ada
    UPDATE semester_evaluation_configs 
    SET uts_period_id = NULL 
    WHERE uts_period_id = p_period_id;

    UPDATE semester_evaluation_configs 
    SET uas_period_id = NULL 
    WHERE uas_period_id = p_period_id;

    -- Hapus periode ujian (Foreign key CASCADE akan otomatis membersihkan peserta, snapshot materi, paket soal, dan nilai terkait)
    DELETE FROM exam_periods WHERE id = p_period_id;

    RETURN json_build_object('success', true, 'message', 'Periode ujian berhasil dihapus beserta seluruh data terkait.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION delete_exam_period(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;


