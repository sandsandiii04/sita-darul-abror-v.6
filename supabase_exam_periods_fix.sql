-- =========================================================================
-- SITA DARUL ABROR - FIX AKSES TABEL & RPC PERIODE UJIAN (EXAM_PERIODS)
-- Jalankan skrip ini di SQL Editor Dashboard Supabase Anda
-- =========================================================================

-- 1. Buka akses SELECT pada tabel exam_periods agar data periode terbaca di aplikasi
DROP POLICY IF EXISTS periods_deny_direct_access ON exam_periods;
DROP POLICY IF EXISTS periods_allow_read ON exam_periods;

CREATE POLICY periods_allow_read ON exam_periods 
    FOR SELECT 
    USING (true);

-- Tetap proteksi mutasi data langsung (hanya boleh melalui RPC aman)
DROP POLICY IF EXISTS periods_deny_insert ON exam_periods;
CREATE POLICY periods_deny_insert ON exam_periods 
    FOR INSERT 
    WITH CHECK (false);

DROP POLICY IF EXISTS periods_deny_update ON exam_periods;
CREATE POLICY periods_deny_update ON exam_periods 
    FOR UPDATE 
    USING (false);

DROP POLICY IF EXISTS periods_deny_delete ON exam_periods;
CREATE POLICY periods_deny_delete ON exam_periods 
    FOR DELETE 
    USING (false);


-- 2. Buat Stored Procedure RPC get_exam_periods (SECURITY DEFINER)
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
