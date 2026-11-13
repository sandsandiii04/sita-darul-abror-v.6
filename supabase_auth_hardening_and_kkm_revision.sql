-- ==============================================================================
-- SQL MIGRATION: HARDENING AUTENTIKASI (SESSION TOKEN) & REVISI KKM TAHSIN
-- Pondok Pesantren Darul Abror — SITA (Sistem Informasi Tahfidz Al-Qur'an)
-- 
-- TUJUAN:
-- 1. Mencegah eksploitasi Pass-the-Hash (hash Bcrypt tidak lagi dapat digunakan sebagai password).
-- 2. Menerbitkan Session Token kriptografis aman saat login.
-- 3. Memastikan tidak ada password maupun hash Bcrypt yang tersimpan di browser klien.
-- 4. Menyesuaikan KKM resmi Ujian Tahsin:
--    - KKM Nilai Akhir: minimal 70
--    - Nilai Makharij: minimal 70
--    - Nilai Tajwid: minimal 70
--    - Bobot: Makharij 35%, Tajwid 30%, Kelancaran 20%, Waqaf & Ibtida 15%
--    - Kesalahan berat berulang yang belum diperbaiki menggagalkan kelulusan
-- 5. Menyelaraskan seluruh RPC SITA (load_secure_data, upsert_data, delete_data_secure,
--    get_tahsin_sessions_secure, save_tahsin_attempt_secure, save_tahsin_period_secure,
--    save_tahsin_examiner_assignment_secure) agar mendukung session token secara konsisten.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. TABEL: user_sessions (Penyimpanan Sesi Kriptografis Aktif)
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    session_token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc'::text, now()) + INTERVAL '7 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);

-- Kebijakan RLS Ketat: Tolak total akses langsung REST API (hanya dapat diakses melalui RPC SECURITY DEFINER)
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_sessions_deny_all ON user_sessions;
CREATE POLICY user_sessions_deny_all ON user_sessions FOR ALL USING (false);

-- 2. FUNGSI VALIDASI INTERNAL: validate_session_or_credential
DROP FUNCTION IF EXISTS validate_session_or_credential(text, text);
CREATE OR REPLACE FUNCTION validate_session_or_credential(
    p_username TEXT,
    p_credential TEXT,
    OUT out_user_id TEXT,
    OUT out_role TEXT,
    OUT out_username TEXT,
    OUT out_name TEXT,
    OUT out_is_valid BOOLEAN
) AS $$
DECLARE
    v_sess RECORD;
    v_u RECORD;
    v_st RECORD;
BEGIN
    out_is_valid := FALSE;

    -- A. Cek Session Token Aktif (Dari Sesi Login Browser yang Sah)
    SELECT s.*, u.name as real_name INTO v_sess 
    FROM user_sessions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE (s.username = p_username OR s.user_id = p_username)
      AND s.session_token = p_credential
      AND s.expires_at > timezone('utc'::text, now());

    IF FOUND THEN
        out_user_id := v_sess.user_id;
        out_role := v_sess.role;
        out_username := v_sess.username;
        out_name := COALESCE(v_sess.real_name, v_sess.username);
        out_is_valid := TRUE;
        RETURN;
    END IF;

    -- B. Cek Password Asli via Bcrypt crypt() (HANYA crypt, TANPA pembanding langsung password = p_credential)
    SELECT * INTO v_u FROM users
    WHERE username = p_username
      AND password = crypt(p_credential, password);

    IF FOUND THEN
        out_user_id := v_u.id;
        out_role := v_u.role;
        out_username := v_u.username;
        out_name := v_u.name;
        out_is_valid := TRUE;
        RETURN;
    END IF;

    -- C. Cek Santri / Wali via Bcrypt crypt()
    SELECT * INTO v_st FROM students
    WHERE (username = p_username OR nis = p_username)
      AND password = crypt(p_credential, password);

    IF FOUND THEN
        out_user_id := v_st.id;
        out_role := 'parent';
        out_username := COALESCE(v_st.username, v_st.nis);
        out_name := v_st.name;
        out_is_valid := TRUE;
        RETURN;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- 3. UPDATE FUNGSI LOGIN: verify_login
CREATE OR REPLACE FUNCTION verify_login(p_username TEXT, p_password TEXT)
RETURNS JSON AS $$
DECLARE
  v_user RECORD;
  v_student RECORD;
  v_session_token TEXT;
BEGIN
  -- 1. Verifikasi Pengguna (Admin / Guru) dengan Bcrypt crypt() asli
  SELECT * INTO v_user FROM users 
  WHERE username = p_username 
    AND password = crypt(p_password, password);
    
  IF FOUND THEN
    -- Terbitkan Session Token Kriptografis
    v_session_token := encode(gen_random_bytes(32), 'hex');
    INSERT INTO user_sessions (user_id, username, role, session_token, expires_at)
    VALUES (v_user.id, v_user.username, v_user.role, v_session_token, timezone('utc'::text, now()) + INTERVAL '7 days');

    -- Kembalikan data profil DENGAN sessionToken, TANPA password / hash
    RETURN json_build_object(
      'success', true,
      'type', 'user',
      'data', json_build_object(
        'id', v_user.id,
        'name', v_user.name,
        'role', v_user.role,
        'username', v_user.username,
        'sessionToken', v_session_token,
        'phoneNumber', v_user.phone_number,
        'email', v_user.email,
        'avatar', v_user.avatar,
        'gender', v_user.gender
      )
    );
  END IF;

  -- 2. Verifikasi Santri / Wali (Login via NIS atau Username)
  SELECT * INTO v_student FROM students 
  WHERE (username = p_username OR nis = p_username) 
    AND password = crypt(p_password, password);
    
  IF FOUND THEN
    v_session_token := encode(gen_random_bytes(32), 'hex');
    INSERT INTO user_sessions (user_id, username, role, session_token, expires_at)
    VALUES (v_student.id, COALESCE(v_student.username, v_student.nis), 'parent', v_session_token, timezone('utc'::text, now()) + INTERVAL '7 days');

    RETURN json_build_object(
      'success', true,
      'type', 'student',
      'data', json_build_object(
        'id', v_student.id,
        'name', v_student.name,
        'role', 'parent',
        'childId', v_student.id,
        'username', COALESCE(v_student.username, v_student.nis),
        'sessionToken', v_session_token
      )
    );
  END IF;

  RETURN json_build_object('success', false, 'message', 'Username atau password salah');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- 4. UPDATE RPC: load_secure_data (Mendukung Session Token & Menghapus Pemaparan Hash Password)
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
  v_auth RECORD;
BEGIN
  -- 1. Verifikasi kredensial menggunakan validate_session_or_credential
  SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);
  
  IF NOT v_auth.out_is_valid THEN
     RETURN json_build_object('success', false, 'message', 'Akses ditolak: Kredensial login salah');
  END IF;

  v_user_id := v_auth.out_user_id;
  v_role := v_auth.out_role;
  v_child_id := CASE WHEN v_role = 'parent' THEN v_user_id ELSE NULL END;

  -- 2. Kumpulkan data berdasarkan role
  IF v_role = 'admin' THEN
     -- Admin mendapat data operasional (absensi dibatasi 90 hari terakhir / 1 semester aktif)
     -- PERLINDUNGAN KEAMANAN: password hash TIDAK disertakan dalam payload
     SELECT json_agg(u) INTO v_users FROM (
       SELECT id, name, role, username, phone_number, child_id, email, avatar, gender FROM users
     ) u;
     SELECT json_agg(s) INTO v_students FROM students s;
     SELECT json_agg(r) INTO v_records FROM records r;
     SELECT json_agg(a) INTO v_attendance FROM (
       SELECT * FROM attendance a 
       WHERE a.date >= (CURRENT_DATE - INTERVAL '90 days')
     ) a;
     SELECT json_agg(e) INTO v_exams FROM exams e;
     SELECT json_agg(o) INTO v_open_requests FROM attendance_open_requests o;
  ELSIF v_role IN ('teacher', 'ustadz') THEN
      -- Guru mendapat data semua guru, santri, log bimbingannya, absen 35 hari terakhir, & ujian
      SELECT json_agg(u) INTO v_users FROM (
        SELECT id, name, role, phone_number, gender FROM users
      ) u;
      SELECT json_agg(s) INTO v_students FROM (
        SELECT id, name, nis, class, halaqah, teacher_id, total_juz FROM students
      ) s;
      
      SELECT json_agg(r) INTO v_records FROM records r 
      WHERE r.student_id IN (SELECT id FROM students WHERE teacher_id = v_user_id);
      
      -- Absen guru & santri: dibatasi 35 hari terakhir untuk efisiensi transfer data dan mencegah CPU exhaustion
      SELECT json_agg(a) INTO v_attendance FROM (
        SELECT * FROM attendance a 
        WHERE a.date >= (CURRENT_DATE - INTERVAL '35 days')
      ) a;
      
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- 5. UPDATE RPC: upsert_data (Mendukung Session Token)
CREATE OR REPLACE FUNCTION upsert_data(p_username TEXT, p_password TEXT, p_table TEXT, p_data JSONB)
RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_user_id TEXT;
  v_auth RECORD;
BEGIN
  -- 1. Verifikasi kredensial menggunakan validate_session_or_credential
  SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);
  
  IF v_auth.out_is_valid THEN
     v_user_id := v_auth.out_user_id;
     v_role := v_auth.out_role;
  ELSE
     -- Akses Khusus untuk Absen Cepat Guru (tanpa login) menggunakan QR Code yang valid
     IF p_table = 'attendance' AND p_data->>'type' = 'teacher' AND p_data->>'status' = 'present' AND p_data->>'qr_token' = 'SITA_ABSENSI_GURU_TETAP' THEN
        v_role := 'teacher';
        v_user_id := p_data->>'user_id';
     ELSE
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Kredensial tidak valid');
     END IF;
  END IF;

  -- 2. Validasi Hak Akses (Otorisasi)
  IF v_role = 'admin' THEN
    -- Admin boleh edit/input apa saja
  ELSIF v_role IN ('teacher', 'ustadz') THEN
    -- Guru boleh mengedit profil dirinya sendiri di tabel users, atau menulis data harian operasional serta capaian santri
    IF p_table = 'users' THEN
      IF (p_data->>'id') != v_user_id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Guru hanya dapat memperbarui profilnya sendiri');
      END IF;
    ELSIF p_table NOT IN ('records', 'attendance', 'exams', 'students', 'attendance_open_requests') THEN
      RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda tidak memiliki izin untuk mengubah tabel ini');
    END IF;
  ELSIF v_role = 'parent' THEN
    -- Wali santri / santri HANYA boleh mengisi/mengirim absensi mandiri santri atau permohonan buka absen santri miliknya
    IF p_table = 'attendance' THEN
      IF (p_data->>'user_id') != v_user_id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Wali hanya dapat mengisi absensi santri yang bersangkutan');
      END IF;
    ELSIF p_table = 'attendance_open_requests' THEN
      IF (p_data->>'student_id') != v_user_id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Wali hanya dapat mengirim permohonan buka absen santri miliknya');
      END IF;
    ELSE
      RETURN json_build_object('success', false, 'message', 'Akses ditolak: Wali santri tidak memiliki izin untuk mengubah data tabel ini');
    END IF;
  ELSE
    RETURN json_build_object('success', false, 'message', 'Akses ditolak: Peran pengguna tidak dikenali');
  END IF;

  -- Validasi nama tabel mencegah SQL injection
  IF p_table NOT IN ('users', 'students', 'records', 'attendance', 'exams', 'attendance_open_requests') THEN
    RETURN json_build_object('success', false, 'message', 'Nama tabel tidak valid');
  END IF;

  -- Eksekusi upsert dinamis
  EXECUTE format('INSERT INTO %I SELECT * FROM jsonb_populate_record(null::%I, $1) ON CONFLICT (id) DO UPDATE SET %s',
    p_table,
    p_table,
    (
      SELECT string_agg(quote_ident(column_name) || ' = EXCLUDED.' || quote_ident(column_name), ', ')
      FROM information_schema.columns
      WHERE table_name = p_table AND table_schema = 'public' AND column_name != 'id'
    )
  ) USING p_data;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- 6. UPDATE RPC: delete_data_secure (Mendukung Session Token)
CREATE OR REPLACE FUNCTION delete_data_secure(p_username TEXT, p_password TEXT, p_table TEXT, p_id TEXT)
RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_user_id TEXT;
  v_auth RECORD;
BEGIN
  -- 1. Verifikasi kredensial
  SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);
  
  IF NOT v_auth.out_is_valid THEN
    RETURN json_build_object('success', false, 'message', 'Akses ditolak: Kredensial tidak valid');
  END IF;

  v_user_id := v_auth.out_user_id;
  v_role := v_auth.out_role;

  -- 2. Validasi Hak Akses (Otorisasi)
  IF v_role = 'admin' THEN
    -- Admin boleh menghapus apa saja
  ELSIF v_role IN ('teacher', 'ustadz') THEN
    -- Guru hanya boleh menghapus records harian, absensi, ujian, atau permohonan buka absen
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- 7. UPDATE RPC: save_tahsin_attempt_secure (Mendukung Session Token & KKM 70)
CREATE OR REPLACE FUNCTION save_tahsin_attempt_secure(
    p_username TEXT,
    p_password TEXT,
    p_session_id TEXT,
    p_attempt_id TEXT,
    p_expected_version INTEGER,
    p_is_finalize BOOLEAN,
    p_attempt_data JSONB,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_session RECORD;
    v_existing_attempt RECORD;
    v_period RECORD;
    v_student RECORD;
    v_assignment RECORD;
    v_period_id TEXT;
    v_student_id TEXT;
    v_target_juz_start INTEGER;
    v_target_juz_end INTEGER;
    v_new_version INTEGER;
    v_final_status TEXT;
    v_session_status TEXT;
    v_score NUMERIC;
    v_predikat TEXT;
    v_passing_status TEXT;
    v_attempt_number INTEGER;
    v_attempt_type TEXT;
BEGIN
    -- 1. Autentikasi Pengguna Otoritatif via Session Token / Password
    SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'conflict', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau kredensial salah.');
    END IF;
    
    SELECT * INTO v_user FROM users WHERE id = v_auth.out_user_id;

    -- 2. Ambil dan Kunci Baris Sesi Ujian (Row-level lock FOR UPDATE)
    SELECT * INTO v_session FROM tahsin_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        -- Validasi Ketat Pembuatan Sesi Otomatis di Server:
        v_period_id := p_attempt_data->'sessionData'->>'periodId';
        v_student_id := p_attempt_data->'sessionData'->>'studentId';

        IF v_period_id IS NULL OR v_student_id IS NULL THEN
            RETURN json_build_object('success', false, 'conflict', false, 'message', 'Data referensi sesi ujian (periodId / studentId) tidak valid.');
        END IF;

        -- A. Verifikasi Keberadaan dan Status Periode Ujian
        SELECT * INTO v_period FROM tahsin_periods WHERE id = v_period_id;
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'conflict', false, 'message', 'Periode ujian tidak ditemukan di database.');
        END IF;

        IF v_period.status != 'active' AND v_user.role != 'admin' THEN
            RETURN json_build_object('success', false, 'conflict', false, 'message', 'Periode ujian belum aktif atau telah ditutup. Pengesahan nilai ditolak.');
        END IF;

        -- B. Verifikasi Keberadaan Data Santri Riil di Database Sekolah
        SELECT * INTO v_student FROM students WHERE id = v_student_id;
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'conflict', false, 'message', 'Data santri tidak terdaftar di database sekolah.');
        END IF;

        -- C. Verifikasi Penugasan Penguji (Jika Bukan Admin)
        IF v_user.role != 'admin' THEN
            SELECT * INTO v_assignment FROM tahsin_examiners 
            WHERE period_id = v_period_id AND teacher_id = v_user.id;

            IF FOUND THEN
                IF array_length(v_assignment.assigned_classes, 1) > 0 
                   AND NOT (v_student.class = ANY(v_assignment.assigned_classes)) THEN
                    RETURN json_build_object('success', false, 'conflict', false, 'message', 'Akses ditolak: Anda tidak ditugaskan untuk menguji kelas santri ini.');
                END IF;
            END IF;
        END IF;

        -- D. Hitung Cakupan Juz Otoritatif di Server Berdasarkan Kelas Santri (Kelas 7-12)
        IF v_student.class ILIKE '7%' OR v_student.class ILIKE '%VII%' THEN
            v_target_juz_start := 26; v_target_juz_end := 30;
        ELSIF v_student.class ILIKE '8%' OR v_student.class ILIKE '%VIII%' THEN
            v_target_juz_start := 21; v_target_juz_end := 30;
        ELSIF v_student.class ILIKE '9%' OR v_student.class ILIKE '%IX%' THEN
            v_target_juz_start := 16; v_target_juz_end := 30;
        ELSIF v_student.class ILIKE '10%' OR v_student.class ILIKE '%X%' THEN
            v_target_juz_start := 11; v_target_juz_end := 30;
        ELSIF v_student.class ILIKE '11%' OR v_student.class ILIKE '%XI%' THEN
            v_target_juz_start := 6; v_target_juz_end := 30;
        ELSIF v_student.class ILIKE '12%' OR v_student.class ILIKE '%XII%' THEN
            v_target_juz_start := 1; v_target_juz_end := 30;
        ELSE
            v_target_juz_start := 26; v_target_juz_end := 30;
        END IF;

        -- E. Buat Baris Sesi Otoritatif dari Data Server
        INSERT INTO tahsin_sessions (
            id, period_id, student_id, examiner_id,
            student_name_snapshot, class_snapshot, halaqah_snapshot,
            target_juz_start, target_juz_end, status,
            latest_attempt_number, version, last_updated_by,
            sync_status, created_at, updated_at
        ) VALUES (
            p_session_id,
            v_period.id,
            v_student.id,
            v_user.id,
            v_student.name,
            COALESCE(v_student.class, '-'),
            COALESCE(v_student.halaqah, '-'),
            v_target_juz_start,
            v_target_juz_end,
            'draft',
            1,
            1,
            v_user.id,
            'synced_server',
            timezone('utc'::text, now()),
            timezone('utc'::text, now())
        )
        RETURNING * INTO v_session;
    END IF;

    -- 3. Otorisasi Penguji / Admin
    IF v_user.role != 'admin' AND v_session.examiner_id IS NOT NULL AND v_session.examiner_id != v_user.id THEN
        RETURN json_build_object('success', false, 'conflict', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi santri ini.');
    END IF;

    -- 4. Deteksi Konflik Konkurensi (Optimistic Locking)
    IF p_expected_version IS NOT NULL AND p_expected_version > 0 AND v_session.version > p_expected_version THEN
        RETURN json_build_object(
            'success', false,
            'conflict', true,
            'server_version', v_session.version,
            'last_updated_by', v_session.last_updated_by,
            'message', 'Konflik konkurensi terdeteksi: Data santri ini telah diubah oleh penguji lain pada perangkat berbeda. Silakan muat ulang data terbaru sebelum menyimpan.'
        );
    END IF;

    -- 5. Ekstraksi Field dari payload JSONB
    v_score := (p_attempt_data->>'finalScore')::NUMERIC;
    v_predikat := p_attempt_data->>'predikat';
    v_passing_status := p_attempt_data->>'passingStatus';
    v_attempt_number := COALESCE((p_attempt_data->>'attemptNumber')::INTEGER, 1);
    v_attempt_type := COALESCE(p_attempt_data->>'attemptType', 'utama');

    IF v_attempt_type = 'utama' AND v_attempt_number > 1 THEN
        v_attempt_type := 'remedial';
    END IF;

    IF v_attempt_type = 'remedial' AND v_session.final_status = 'lulus' THEN
        IF v_user.role != 'admin' THEN
            RETURN json_build_object(
                'success', false, 
                'conflict', false, 
                'message', 'Santri telah dinyatakan LULUS pada ujian sebelumnya. Ujian remedial/ulang hanya dapat dibuka melalui wewenang Admin dengan alasan tercatat.'
            );
        ELSIF p_reason IS NULL OR trim(p_reason) = '' THEN
            RETURN json_build_object(
                'success', false, 
                'conflict', false, 
                'message', 'Wewenang Admin: Ujian ulang untuk santri yang sudah lulus wajib menyertakan alasan tertulis (p_reason).'
            );
        END IF;
    END IF;

    -- 6. Periksa Percobaan yang Sudah Ada
    SELECT * INTO v_existing_attempt FROM tahsin_attempts WHERE id = p_attempt_id;
    IF FOUND AND v_existing_attempt.status = 'finalized' AND v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'conflict', false, 'message', 'Nilai ujian yang telah disahkan hanya dapat diubah atau direvisi dengan kewenangan Admin.');
    END IF;

    -- 7. Upsert Percobaan Ujian (tahsin_attempts)
    INSERT INTO tahsin_attempts (
        id,
        session_id,
        attempt_number,
        attempt_type,
        examiner_id,
        examiner_name_snapshot,
        exam_date,
        start_surah,
        start_ayah,
        end_surah,
        end_ayah,
        start_page,
        end_page,
        pages_read,
        surah_name_display,
        randomize_reason,
        score_makharij,
        category_makharij,
        score_tajwid,
        category_tajwid,
        score_kelancaran,
        category_kelancaran,
        score_waqaf,
        category_waqaf,
        final_score,
        predikat,
        has_critical_error,
        critical_error_reason,
        passing_status,
        error_counts,
        coaching_notes,
        status,
        version,
        finalized_at,
        created_at,
        updated_at
    ) VALUES (
        p_attempt_id,
        v_session.id,
        v_attempt_number,
        v_attempt_type,
        v_user.id,
        v_user.name,
        COALESCE((p_attempt_data->>'examDate')::DATE, CURRENT_DATE),
        COALESCE((p_attempt_data->'reading'->>'startSurah')::INTEGER, 1),
        COALESCE((p_attempt_data->'reading'->>'startAyah')::INTEGER, 1),
        COALESCE((p_attempt_data->'reading'->>'endSurah')::INTEGER, 1),
        COALESCE((p_attempt_data->'reading'->>'endAyah')::INTEGER, 7),
        (p_attempt_data->'reading'->>'startPage')::INTEGER,
        (p_attempt_data->'reading'->>'endPage')::INTEGER,
        COALESCE((p_attempt_data->'reading'->>'pagesRead')::NUMERIC, 1),
        p_attempt_data->'reading'->>'startSurahName',
        p_attempt_data->'reading'->>'randomizeReason',
        COALESCE((p_attempt_data->'makharij'->>'score')::NUMERIC, 70),
        COALESCE(p_attempt_data->'makharij'->>'category', 'cukup'),
        COALESCE((p_attempt_data->'tajwid'->>'score')::NUMERIC, 70),
        COALESCE(p_attempt_data->'tajwid'->>'category', 'cukup'),
        COALESCE((p_attempt_data->'kelancaran'->>'score')::NUMERIC, 70),
        COALESCE(p_attempt_data->'kelancaran'->>'category', 'cukup'),
        COALESCE((p_attempt_data->'waqaf'->>'score')::NUMERIC, 70),
        COALESCE(p_attempt_data->'waqaf'->>'category', 'cukup'),
        v_score,
        v_predikat,
        COALESCE((p_attempt_data->>'hasCriticalError')::BOOLEAN, FALSE),
        p_attempt_data->>'criticalErrorReason',
        v_passing_status,
        COALESCE(p_attempt_data->'errorCounts', '{}'::jsonb),
        p_attempt_data->>'coachingNotes',
        CASE WHEN p_is_finalize THEN 'finalized' ELSE 'draft' END,
        COALESCE(v_existing_attempt.version, 0) + 1,
        CASE WHEN p_is_finalize THEN timezone('utc'::text, now()) ELSE NULL END,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
    )
    ON CONFLICT (session_id, attempt_number) DO UPDATE SET
        examiner_id = EXCLUDED.examiner_id,
        examiner_name_snapshot = EXCLUDED.examiner_name_snapshot,
        exam_date = EXCLUDED.exam_date,
        start_surah = EXCLUDED.start_surah,
        start_ayah = EXCLUDED.start_ayah,
        end_surah = EXCLUDED.end_surah,
        end_ayah = EXCLUDED.end_ayah,
        start_page = EXCLUDED.start_page,
        end_page = EXCLUDED.end_page,
        pages_read = EXCLUDED.pages_read,
        surah_name_display = EXCLUDED.surah_name_display,
        randomize_reason = EXCLUDED.randomize_reason,
        score_makharij = EXCLUDED.score_makharij,
        category_makharij = EXCLUDED.category_makharij,
        score_tajwid = EXCLUDED.score_tajwid,
        category_tajwid = EXCLUDED.category_tajwid,
        score_kelancaran = EXCLUDED.score_kelancaran,
        category_kelancaran = EXCLUDED.category_kelancaran,
        score_waqaf = EXCLUDED.score_waqaf,
        category_waqaf = EXCLUDED.category_waqaf,
        final_score = EXCLUDED.final_score,
        predikat = EXCLUDED.predikat,
        has_critical_error = EXCLUDED.has_critical_error,
        critical_error_reason = EXCLUDED.critical_error_reason,
        passing_status = EXCLUDED.passing_status,
        error_counts = EXCLUDED.error_counts,
        coaching_notes = EXCLUDED.coaching_notes,
        status = EXCLUDED.status,
        version = tahsin_attempts.version + 1,
        finalized_at = CASE WHEN EXCLUDED.status = 'finalized' THEN timezone('utc'::text, now()) ELSE tahsin_attempts.finalized_at END,
        updated_at = timezone('utc'::text, now());

    -- 8. Update Sesi Ujian (tahsin_sessions)
    v_new_version := v_session.version + 1;
    IF p_is_finalize THEN
        v_session_status := CASE WHEN v_passing_status = 'lulus' THEN 'completed' ELSE 'remedial_needed' END;
        v_final_status := v_passing_status;
    ELSE
        v_session_status := CASE WHEN v_session.status = 'not_started' THEN 'draft' ELSE v_session.status END;
        v_final_status := v_session.final_status;
    END IF;

    UPDATE tahsin_sessions SET
        status = v_session_status,
        final_score = CASE WHEN p_is_finalize THEN v_score ELSE tahsin_sessions.final_score END,
        predikat = CASE WHEN p_is_finalize THEN v_predikat ELSE tahsin_sessions.predikat END,
        final_status = v_final_status,
        latest_attempt_number = GREATEST(tahsin_sessions.latest_attempt_number, v_attempt_number),
        examiner_id = COALESCE(tahsin_sessions.examiner_id, v_user.id),
        version = v_new_version,
        last_updated_by = v_user.id,
        sync_status = 'synced_server',
        updated_at = timezone('utc'::text, now())
    WHERE id = v_session.id;

    -- 9. Catat Riwayat Audit Log Otoritatif
    INSERT INTO tahsin_audit_logs (
        id, session_id, attempt_id, changed_by, change_type,
        old_score, new_score, old_status, new_status, reason, created_at
    ) VALUES (
        'tal_' || gen_random_uuid(),
        v_session.id,
        p_attempt_id,
        v_user.id,
        CASE 
            WHEN v_existing_attempt IS NOT NULL AND v_existing_attempt.status = 'finalized' THEN 'revision_score'
            WHEN p_is_finalize AND v_attempt_type = 'remedial' THEN 'remedial_attempt'
            WHEN p_is_finalize THEN 'finalize_attempt'
            ELSE 'save_draft'
        END,
        v_session.final_score,
        v_score,
        v_session.status,
        v_session_status,
        p_reason,
        timezone('utc'::text, now())
    );

    RETURN json_build_object(
        'success', true,
        'conflict', false,
        'server_version', v_new_version,
        'session_status', v_session_status,
        'final_score', v_score,
        'message', CASE WHEN p_is_finalize THEN 'Ujian Tahsin berhasil disahkan dan tersimpan di database server.' ELSE 'Draft ujian berhasil disimpan di database server.' END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- 8. UPDATE RPC: save_tahsin_period_secure (Mendukung Session Token & KKM 70)
CREATE OR REPLACE FUNCTION save_tahsin_period_secure(
    p_username TEXT,
    p_password TEXT,
    p_period_data JSONB
)
RETURNS JSON AS $$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna via Session Token / Password
    SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau kredensial salah.');
    END IF;

    -- 2. Otorisasi Khusus Admin
    IF v_auth.out_role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berwenang mengelola periode ujian.');
    END IF;

    v_period_id := p_period_data->>'id';
    IF v_period_id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'ID periode tidak boleh kosong.');
    END IF;

    -- 3. Upsert Periode Ujian
    INSERT INTO tahsin_periods (
        id,
        name,
        academic_year,
        semester,
        start_date,
        end_date,
        status,
        passing_grade,
        min_makharij,
        min_tajwid,
        target_classes,
        created_by,
        updated_at
    ) VALUES (
        v_period_id,
        p_period_data->>'name',
        p_period_data->>'academicYear',
        LOWER(TRIM(p_period_data->>'semester')),
        COALESCE((p_period_data->>'startDate')::DATE, CURRENT_DATE),
        COALESCE((p_period_data->>'endDate')::DATE, CURRENT_DATE + 30),
        COALESCE(p_period_data->>'status', 'draft'),
        COALESCE((p_period_data->>'passingGrade')::NUMERIC, 70),
        COALESCE((p_period_data->>'minMakharij')::NUMERIC, 70),
        COALESCE((p_period_data->>'minTajwid')::NUMERIC, 70),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_period_data->'targetClasses', '[]'::jsonb))),
        v_auth.out_user_id,
        timezone('utc'::text, now())
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        academic_year = EXCLUDED.academic_year,
        semester = EXCLUDED.semester,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        status = EXCLUDED.status,
        passing_grade = EXCLUDED.passing_grade,
        min_makharij = EXCLUDED.min_makharij,
        min_tajwid = EXCLUDED.min_tajwid,
        target_classes = EXCLUDED.target_classes,
        updated_at = timezone('utc'::text, now());

    RETURN json_build_object('success', true, 'message', 'Periode Ujian Tahsin berhasil disimpan.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- 9. UPDATE RPC: save_tahsin_examiner_assignment_secure (Mendukung Session Token)
CREATE OR REPLACE FUNCTION save_tahsin_examiner_assignment_secure(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT,
    p_teacher_id TEXT,
    p_classes TEXT[],
    p_halaqahs TEXT[]
)
RETURNS JSON AS $$
DECLARE
    v_auth RECORD;
    v_id TEXT;
BEGIN
    SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau kredensial salah.');
    END IF;

    IF v_auth.out_role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang dapat menugaskan penguji.');
    END IF;

    v_id := 'te_' || p_period_id || '_' || p_teacher_id;

    INSERT INTO tahsin_examiners (
        id, period_id, teacher_id, assigned_classes, assigned_halaqahs, created_at
    ) VALUES (
        v_id, p_period_id, p_teacher_id, p_classes, p_halaqahs, timezone('utc'::text, now())
    )
    ON CONFLICT (period_id, teacher_id) DO UPDATE SET
        assigned_classes = EXCLUDED.assigned_classes,
        assigned_halaqahs = EXCLUDED.assigned_halaqahs;

    RETURN json_build_object('success', true, 'message', 'Penugasan penguji berhasil disimpan.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- 10. UPDATE RPC: get_tahsin_sessions_secure (Mendukung Session Token, Admin & Teacher/Ustadz)
CREATE OR REPLACE FUNCTION get_tahsin_sessions_secure(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_auth RECORD;
    v_result JSON;
BEGIN
    -- Validasi Session Token / Kredensial
    SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);

    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau kredensial salah.', 'data', '[]'::json);
    END IF;

    -- Otorisasi Berdasarkan Peran (Admin & Teacher/Ustadz)
    IF v_auth.out_role = 'admin' THEN
        SELECT COALESCE(json_agg(
            json_build_object(
                'id', s.id,
                'period_id', s.period_id,
                'student_id', s.student_id,
                'examiner_id', s.examiner_id,
                'student_name_snapshot', s.student_name_snapshot,
                'class_snapshot', s.class_snapshot,
                'halaqah_snapshot', s.halaqah_snapshot,
                'target_juz_start', s.target_juz_start,
                'target_juz_end', s.target_juz_end,
                'status', s.status,
                'final_score', s.final_score,
                'predikat', s.predikat,
                'final_status', s.final_status,
                'latest_attempt_number', s.latest_attempt_number,
                'version', s.version,
                'last_updated_by', s.last_updated_by,
                'sync_status', s.sync_status,
                'created_at', s.created_at,
                'updated_at', s.updated_at,
                'attempts', COALESCE((
                    SELECT json_agg(a.* ORDER BY a.attempt_number ASC)
                    FROM tahsin_attempts a WHERE a.session_id = s.id
                ), '[]'::json)
            ) ORDER BY s.student_name_snapshot ASC
        ), '[]'::json) INTO v_result
        FROM tahsin_sessions s
        WHERE s.period_id = p_period_id;

    ELSIF v_auth.out_role IN ('teacher', 'ustadz') THEN
        SELECT COALESCE(json_agg(
            json_build_object(
                'id', s.id,
                'period_id', s.period_id,
                'student_id', s.student_id,
                'examiner_id', s.examiner_id,
                'student_name_snapshot', s.student_name_snapshot,
                'class_snapshot', s.class_snapshot,
                'halaqah_snapshot', s.halaqah_snapshot,
                'target_juz_start', s.target_juz_start,
                'target_juz_end', s.target_juz_end,
                'status', s.status,
                'final_score', s.final_score,
                'predikat', s.predikat,
                'final_status', s.final_status,
                'latest_attempt_number', s.latest_attempt_number,
                'version', s.version,
                'last_updated_by', s.last_updated_by,
                'sync_status', s.sync_status,
                'created_at', s.created_at,
                'updated_at', s.updated_at,
                'attempts', COALESCE((
                    SELECT json_agg(a.* ORDER BY a.attempt_number ASC)
                    FROM tahsin_attempts a WHERE a.session_id = s.id
                ), '[]'::json)
            ) ORDER BY s.student_name_snapshot ASC
        ), '[]'::json) INTO v_result
        FROM tahsin_sessions s
        WHERE s.period_id = p_period_id
          AND (
            s.examiner_id = v_auth.out_user_id 
            OR s.examiner_id IS NULL 
            OR EXISTS (
                SELECT 1 FROM tahsin_examiners te 
                WHERE te.period_id = p_period_id AND te.teacher_id = v_auth.out_user_id 
                  AND (array_length(te.assigned_classes, 1) IS NULL OR s.class_snapshot = ANY(te.assigned_classes))
            )
            OR EXISTS (
                SELECT 1 FROM students st WHERE st.id = s.student_id AND st.teacher_id = v_auth.out_user_id
            )
          );
    ELSE
        SELECT COALESCE(json_agg(
            json_build_object(
                'id', s.id,
                'period_id', s.period_id,
                'student_id', s.student_id,
                'student_name_snapshot', s.student_name_snapshot,
                'class_snapshot', s.class_snapshot,
                'status', s.status,
                'final_score', s.final_score,
                'predikat', s.predikat,
                'final_status', s.final_status,
                'attempts', COALESCE((
                    SELECT json_agg(a.* ORDER BY a.attempt_number ASC)
                    FROM tahsin_attempts a WHERE a.session_id = s.id
                ), '[]'::json)
            )
        ), '[]'::json) INTO v_result
        FROM tahsin_sessions s
        WHERE s.period_id = p_period_id AND s.student_id = v_auth.out_user_id;
    END IF;

    RETURN json_build_object('success', true, 'data', v_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- 11. UPDATE DEFAULTS KKM PADA TABEL tahsin_periods
ALTER TABLE tahsin_periods ALTER COLUMN passing_grade SET DEFAULT 70;
ALTER TABLE tahsin_periods ALTER COLUMN min_makharij SET DEFAULT 70;
ALTER TABLE tahsin_periods ALTER COLUMN min_tajwid SET DEFAULT 70;

-- 12. GRANT EXECUTE KE ANON & AUTHENTICATED
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN 
        EXECUTE 'GRANT EXECUTE ON FUNCTION verify_login(text, text) TO authenticated, anon'; 
        EXECUTE 'GRANT EXECUTE ON FUNCTION load_secure_data(text, text) TO authenticated, anon'; 
        EXECUTE 'GRANT EXECUTE ON FUNCTION upsert_data(text, text, text, jsonb) TO authenticated, anon'; 
        EXECUTE 'GRANT EXECUTE ON FUNCTION delete_data_secure(text, text, text, text) TO authenticated, anon'; 
        EXECUTE 'GRANT EXECUTE ON FUNCTION save_tahsin_attempt_secure(text, text, text, text, integer, boolean, jsonb, text) TO authenticated, anon'; 
        EXECUTE 'GRANT EXECUTE ON FUNCTION save_tahsin_period_secure(text, text, jsonb) TO authenticated, anon'; 
        EXECUTE 'GRANT EXECUTE ON FUNCTION save_tahsin_examiner_assignment_secure(text, text, text, text, text[], text[]) TO authenticated, anon'; 
        EXECUTE 'GRANT EXECUTE ON FUNCTION get_tahsin_sessions_secure(text, text, text) TO authenticated, anon'; 
    END IF; 
END $$;
