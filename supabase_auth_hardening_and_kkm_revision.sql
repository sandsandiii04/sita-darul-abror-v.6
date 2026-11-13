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

-- 4. UPDATE RPC: get_tahsin_sessions_secure
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

-- 5. UPDATE DEFAULTS KKM PADA TABEL tahsin_periods
ALTER TABLE tahsin_periods ALTER COLUMN passing_grade SET DEFAULT 70;
ALTER TABLE tahsin_periods ALTER COLUMN min_makharij SET DEFAULT 70;
ALTER TABLE tahsin_periods ALTER COLUMN min_tajwid SET DEFAULT 70;

-- 6. GRANT EXECUTE KE ANON & AUTHENTICATED
GRANT EXECUTE ON FUNCTION verify_login(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_tahsin_sessions_secure(text, text, text) TO anon, authenticated;
