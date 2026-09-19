-- =========================================================================
-- SITA DARUL ABROR - FIX AKSES TABEL, FITUR HAPUS & PEMBERSIHAN DUMMY
-- (Versi Bersih & Aman dari Foreign Key Constraint)
-- Jalankan skrip ini di SQL Editor Dashboard Supabase Anda
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. BUKA IZIN BACA (SELECT) PADA TABEL exam_periods
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS periods_deny_direct_access ON exam_periods;
DROP POLICY IF EXISTS periods_allow_read ON exam_periods;

CREATE POLICY periods_allow_read ON exam_periods 
    FOR SELECT 
    USING (true);

-- Tetap proteksi mutasi data langsung (hanya boleh melalui RPC aman)
DROP POLICY IF EXISTS periods_deny_insert ON exam_periods;
CREATE POLICY periods_deny_insert ON exam_periods FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS periods_deny_update ON exam_periods;
CREATE POLICY periods_deny_update ON exam_periods FOR UPDATE USING (false);

DROP POLICY IF EXISTS periods_deny_delete ON exam_periods;
CREATE POLICY periods_deny_delete ON exam_periods FOR DELETE USING (false);


-- -------------------------------------------------------------------------
-- 2. UBAH FOREIGN KEY CONSTRAINT AGAR OTOMATIS CASCADE SAAT DIHAPUS
-- -------------------------------------------------------------------------
-- Mengubah relasi semester_evaluation_configs agar tidak memblokir penghapusan periode
ALTER TABLE semester_evaluation_configs 
    DROP CONSTRAINT IF EXISTS semester_evaluation_configs_uts_period_id_fkey,
    DROP CONSTRAINT IF EXISTS semester_evaluation_configs_uas_period_id_fkey;

ALTER TABLE semester_evaluation_configs 
    ADD CONSTRAINT semester_evaluation_configs_uts_period_id_fkey 
        FOREIGN KEY (uts_period_id) REFERENCES exam_periods(id) ON DELETE CASCADE,
    ADD CONSTRAINT semester_evaluation_configs_uas_period_id_fkey 
        FOREIGN KEY (uas_period_id) REFERENCES exam_periods(id) ON DELETE CASCADE;

-- Mengubah relasi penilaian per nomor soal agar cascade bersih
ALTER TABLE IF EXISTS exam_question_assessments
    DROP CONSTRAINT IF EXISTS exam_question_assessments_exam_question_id_fkey;
ALTER TABLE IF EXISTS exam_question_assessments
    ADD CONSTRAINT exam_question_assessments_exam_question_id_fkey
        FOREIGN KEY (exam_question_id) REFERENCES exam_questions(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS exam_remedial_attempts
    DROP CONSTRAINT IF EXISTS exam_remedial_attempts_remedial_session_id_fkey,
    DROP CONSTRAINT IF EXISTS exam_remedial_attempts_remedial_question_set_id_fkey;
ALTER TABLE IF EXISTS exam_remedial_attempts
    ADD CONSTRAINT exam_remedial_attempts_remedial_session_id_fkey
        FOREIGN KEY (remedial_session_id) REFERENCES exam_remedial_sessions(id) ON DELETE CASCADE,
    ADD CONSTRAINT exam_remedial_attempts_remedial_question_set_id_fkey
        FOREIGN KEY (remedial_question_set_id) REFERENCES exam_remedial_question_sets(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS exam_remedial_question_assessments
    DROP CONSTRAINT IF EXISTS exam_remedial_question_assessments_remedial_question_id_fkey;
ALTER TABLE IF EXISTS exam_remedial_question_assessments
    ADD CONSTRAINT exam_remedial_question_assessments_remedial_question_id_fkey
        FOREIGN KEY (remedial_question_id) REFERENCES exam_remedial_questions(id) ON DELETE CASCADE;


-- -------------------------------------------------------------------------
-- 3. STORED PROCEDURE RPC: get_exam_periods (Role-Based Secure)
-- -------------------------------------------------------------------------
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
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;
    
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
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


-- -------------------------------------------------------------------------
-- 4. STORED PROCEDURE RPC: delete_exam_period (Admin Only, Cascade-Safe)
-- -------------------------------------------------------------------------
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
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak menghapus Periode Ujian.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    -- Hapus konfigurasi pasangan semester yang mengacu pada periode ini
    DELETE FROM semester_evaluation_configs 
    WHERE uts_period_id = p_period_id OR uas_period_id = p_period_id;

    -- Hapus periode ujian (CASCADE otomatis menghapus peserta, snapshots, paket soal, attempts, remedial)
    DELETE FROM exam_periods WHERE id = p_period_id;

    RETURN json_build_object('success', true, 'message', 'Periode ujian berhasil dihapus beserta seluruh data terkait.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION delete_exam_period(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;


-- -------------------------------------------------------------------------
-- 5. PEMBERSIHAN DATA DUMMY & UJIAN PERCOBAAN
-- -------------------------------------------------------------------------
-- A. Hapus konfigurasi pasangan semester dummy/percobaan terlebih dahulu
DELETE FROM semester_evaluation_configs 
WHERE id ILIKE '%test%' 
   OR id ILIKE '%smoke%' 
   OR id ILIKE '%diag%' 
   OR id ILIKE '%fl_%' 
   OR id ILIKE '%probe%' 
   OR id ILIKE '%iso_%' 
   OR id ILIKE '%live_%' 
   OR name ILIKE '%test%' 
   OR name ILIKE '%diff%' 
   OR name ILIKE '%live%'
   OR uts_period_id ILIKE 'test_%'
   OR uts_period_id ILIKE 'probe_%'
   OR uts_period_id ILIKE 'period_live_%'
   OR uas_period_id ILIKE 'test_%'
   OR uas_period_id ILIKE 'probe_%'
   OR uas_period_id ILIKE 'period_live_%';

-- B. Hapus penilaian soal ujian percobaan jika ada
DELETE FROM exam_question_assessments 
WHERE exam_attempt_id IN (
    SELECT id FROM exam_attempts 
    WHERE exam_period_id ILIKE 'test_%' 
       OR exam_period_id ILIKE 'probe_%' 
       OR exam_period_id ILIKE 'period_live_%'
       OR exam_period_id ILIKE '%verify%'
       OR exam_period_id ILIKE '%smoke%'
       OR exam_period_id ILIKE '%diag%'
       OR exam_period_id ILIKE '%fl_%'
       OR exam_period_id ILIKE 'live_iso_%'
);

-- C. Hapus seluruh periode ujian dummy/percobaan
DELETE FROM exam_periods 
WHERE id ILIKE 'test_%' 
   OR id ILIKE 'probe_%' 
   OR id ILIKE 'period_live_%' 
   OR id ILIKE '%verify%' 
   OR id ILIKE '%dummy%' 
   OR id ILIKE '%smoke%' 
   OR id ILIKE '%diag%' 
   OR id ILIKE '%fl_%' 
   OR id ILIKE 'live_iso_%' 
   OR id ILIKE 'uts_7d_%' 
   OR id ILIKE 'uas_7d_%' 
   OR name ILIKE '%test%' 
   OR name ILIKE '%verification%' 
   OR name ILIKE '%percobaan%' 
   OR name ILIKE '%live 7%';

-- D. Hapus semester akademik dummy/percobaan
DELETE FROM academic_terms 
WHERE id ILIKE 'test_%' 
   OR id ILIKE 'probe_%' 
   OR id ILIKE 'diag_%' 
   OR id ILIKE 'smoke_%' 
   OR id ILIKE 'fl_%' 
   OR id ILIKE 't1_%' 
   OR id ILIKE 'live_iso_%' 
   OR id ILIKE 'live_re_%' 
   OR id ILIKE 'term_7d_%';
