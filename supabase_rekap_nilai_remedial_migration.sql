-- ============================================================
-- SQL Migration: Tahap 7A — Rekap Nilai & Remedial Eligibility Engine
-- Darul Abror IBS (Non-Destructive / Additive Migration — Hardened)
-- ============================================================
-- Catatan:
-- Migration ini bersifat aditif dan server-authoritative.
-- Modul Tahap 5A/5B/6A/6B tetap LOCKED dan tidak diubah.
-- SELURUH RPC DILINDUNGI ADMIN-ONLY & DEFENSE-IN-DEPTH.
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABEL ADITIF: semester_evaluation_configs
-- Konfigurasi Pasangan Periode UTS + UAS dan Pembobotan Semester
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS semester_evaluation_configs (
    id TEXT PRIMARY KEY,
    academic_term_id TEXT NOT NULL REFERENCES academic_terms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    uts_period_id TEXT NOT NULL REFERENCES exam_periods(id) ON DELETE RESTRICT,
    uas_period_id TEXT NOT NULL REFERENCES exam_periods(id) ON DELETE RESTRICT,
    uts_weight NUMERIC(5,2) NOT NULL DEFAULT 40.00 CHECK (uts_weight >= 0 AND uts_weight <= 100),
    uas_weight NUMERIC(5,2) NOT NULL DEFAULT 60.00 CHECK (uas_weight >= 0 AND uas_weight <= 100),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT chk_sec_weights_sum CHECK (ROUND(uts_weight + uas_weight, 2) = 100.00),
    CONSTRAINT uq_sec_term_periods UNIQUE (academic_term_id, uts_period_id, uas_period_id)
);

CREATE INDEX IF NOT EXISTS idx_sec_academic_term ON semester_evaluation_configs(academic_term_id);
CREATE INDEX IF NOT EXISTS idx_sec_uts_period ON semester_evaluation_configs(uts_period_id);
CREATE INDEX IF NOT EXISTS idx_sec_uas_period ON semester_evaluation_configs(uas_period_id);

-- Row Level Security (RLS)
ALTER TABLE semester_evaluation_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sec_deny_direct_access ON semester_evaluation_configs;
CREATE POLICY sec_deny_direct_access ON semester_evaluation_configs FOR ALL USING (false);


-- ============================================================
-- 2. STORED PROCEDURES (RPC) — TAHAP 7A
-- ============================================================

-- ------------------------------------------------------------
-- RPC 1: upsert_semester_evaluation_config (Admin Only)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS upsert_semester_evaluation_config(TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION upsert_semester_evaluation_config(
    p_username TEXT,
    p_password TEXT,
    p_config JSONB
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_id TEXT;
    v_term_id TEXT;
    v_uts_period_id TEXT;
    v_uas_period_id TEXT;
    v_uts_weight NUMERIC(5,2);
    v_uas_weight NUMERIC(5,2);
    v_name TEXT;
    v_term RECORD;
    v_uts_period RECORD;
    v_uas_period RECORD;
    v_old_config RECORD;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengelola konfigurasi semester.');
    END IF;

    -- 2. Parse Parameter
    v_id := COALESCE(p_config->>'id', 'sec_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6));
    v_term_id := p_config->>'academicTermId';
    v_uts_period_id := p_config->>'utsPeriodId';
    v_uas_period_id := p_config->>'uasPeriodId';
    
    IF p_config->>'utsWeight' IS NULL OR p_config->>'uasWeight' IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Bobot UTS dan UAS wajib diisi.');
    END IF;

    v_uts_weight := (p_config->>'utsWeight')::NUMERIC;
    v_uas_weight := (p_config->>'uasWeight')::NUMERIC;
    v_name := COALESCE(p_config->>'name', 'Konfigurasi Rekap Semester');

    -- 3. Validasi Academic Term
    SELECT * INTO v_term FROM academic_terms WHERE id = v_term_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Semester akademik tidak ditemukan.');
    END IF;

    -- 4. Validasi Periode UTS
    SELECT * INTO v_uts_period FROM exam_periods WHERE id = v_uts_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian UTS tidak ditemukan.');
    END IF;
    IF v_uts_period.exam_type != 'uts' THEN
        RETURN json_build_object('success', false, 'message', 'Periode UTS yang dipilih harus bertipe uts.');
    END IF;
    IF v_uts_period.academic_term_id != v_term_id THEN
        RETURN json_build_object('success', false, 'message', 'Periode UTS harus berada pada semester akademik yang sama.');
    END IF;

    -- 5. Validasi Periode UAS
    SELECT * INTO v_uas_period FROM exam_periods WHERE id = v_uas_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian UAS tidak ditemukan.');
    END IF;
    IF v_uas_period.exam_type != 'uas' THEN
        RETURN json_build_object('success', false, 'message', 'Periode UAS yang dipilih harus bertipe uas.');
    END IF;
    IF v_uas_period.academic_term_id != v_term_id THEN
        RETURN json_build_object('success', false, 'message', 'Periode UAS harus berada pada semester akademik yang sama.');
    END IF;

    -- 6. Validasi Bobot (Total Wajib 100)
    IF v_uts_weight < 0 OR v_uas_weight < 0 THEN
        RETURN json_build_object('success', false, 'message', 'Bobot UTS dan UAS tidak boleh negatif.');
    END IF;
    IF ROUND(v_uts_weight + v_uas_weight, 2) != 100.00 THEN
        RETURN json_build_object('success', false, 'message', 'Jumlah bobot UTS dan UAS wajib tepat 100%.');
    END IF;

    -- Ambil data lama untuk audit trail
    SELECT * INTO v_old_config FROM semester_evaluation_configs WHERE id = v_id;

    -- 7. Upsert Konfigurasi
    INSERT INTO semester_evaluation_configs (
        id, academic_term_id, name, uts_period_id, uas_period_id,
        uts_weight, uas_weight, created_by, created_at, updated_at
    ) VALUES (
        v_id, v_term_id, v_name, v_uts_period_id, v_uas_period_id,
        v_uts_weight, v_uas_weight, v_user.id, now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
        academic_term_id = EXCLUDED.academic_term_id,
        name = EXCLUDED.name,
        uts_period_id = EXCLUDED.uts_period_id,
        uas_period_id = EXCLUDED.uas_period_id,
        uts_weight = EXCLUDED.uts_weight,
        uas_weight = EXCLUDED.uas_weight,
        updated_at = now();

    -- 8. Audit Log Kanonikal (exam_period_id & student_id NULL, no fake IDs)
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        NULL, NULL, 'semester_config_upserted', v_user.id,
        CASE WHEN v_old_config.id IS NOT NULL THEN
            jsonb_build_object(
                'configId', v_old_config.id,
                'utsPeriodId', v_old_config.uts_period_id,
                'uasPeriodId', v_old_config.uas_period_id,
                'utsWeight', v_old_config.uts_weight,
                'uasWeight', v_old_config.uas_weight
            )
        ELSE NULL END,
        jsonb_build_object(
            'configId', v_id,
            'academicTermId', v_term_id,
            'utsPeriodId', v_uts_period_id,
            'uasPeriodId', v_uas_period_id,
            'utsWeight', v_uts_weight,
            'uasWeight', v_uas_weight
        ),
        'Pembaruan konfigurasi evaluasi semester tahfiz', now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Konfigurasi semester berhasil disimpan.',
        'config', json_build_object(
            'id', v_id,
            'academicTermId', v_term_id,
            'name', v_name,
            'utsPeriodId', v_uts_period_id,
            'uasPeriodId', v_uas_period_id,
            'utsWeight', v_uts_weight,
            'uasWeight', v_uas_weight
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 2: get_semester_evaluation_configs (Admin Only)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_semester_evaluation_configs(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_semester_evaluation_configs(
    p_username TEXT,
    p_password TEXT,
    p_academic_term_id TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_configs JSON;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak melihat daftar konfigurasi.');
    END IF;

    SELECT json_agg(json_build_object(
        'id', c.id,
        'academicTermId', c.academic_term_id,
        'academicYear', t.academic_year,
        'semester', t.semester,
        'name', c.name,
        'utsPeriodId', c.uts_period_id,
        'utsPeriodName', pu.name,
        'utsKkm', pu.kkm,
        'uasPeriodId', c.uas_period_id,
        'uasPeriodName', pa.name,
        'uasKkm', pa.kkm,
        'utsWeight', c.uts_weight,
        'uasWeight', c.uas_weight,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at
    ) ORDER BY c.created_at DESC) INTO v_configs
    FROM semester_evaluation_configs c
    JOIN academic_terms t ON t.id = c.academic_term_id
    JOIN exam_periods pu ON pu.id = c.uts_period_id
    JOIN exam_periods pa ON pa.id = c.uas_period_id
    WHERE (p_academic_term_id IS NULL OR c.academic_term_id = p_academic_term_id);

    RETURN json_build_object(
        'success', true,
        'configs', COALESCE(v_configs, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 3: get_semester_tahfiz_recap (Admin Only)
-- Rekap Otoritatif Semester & Remedial Candidate Engine
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_semester_tahfiz_recap(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_semester_tahfiz_recap(
    p_username TEXT,
    p_password TEXT,
    p_academic_term_id TEXT DEFAULT NULL,
    p_config_id TEXT DEFAULT NULL,
    p_uts_period_id TEXT DEFAULT NULL,
    p_uas_period_id TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_term RECORD;
    v_uts_period RECORD;
    v_uas_period RECORD;
    v_uts_weight NUMERIC(5,2) := 40.00;
    v_uas_weight NUMERIC(5,2) := 60.00;
    v_config_name TEXT := 'Rekap Evaluasi Semester';
    v_config RECORD;
    v_uts_count INTEGER;
    v_uas_count INTEGER;

    v_student RECORD;
    v_uts_att RECORD;
    v_uas_att RECORD;
    v_uts_qs RECORD;
    v_uas_qs RECORD;

    v_submitted_uts_count INTEGER;
    v_submitted_uas_count INTEGER;
    v_uts_snap_id TEXT;
    v_uas_snap_id TEXT;

    v_uts_score NUMERIC(5,2);
    v_uas_score NUMERIC(5,2);
    v_uts_status TEXT;
    v_uas_status TEXT;
    v_uts_remedial BOOLEAN;
    v_uas_remedial BOOLEAN;
    v_uts_contrib NUMERIC(5,2);
    v_uas_contrib NUMERIC(5,2);
    v_semester_score NUMERIC(5,2);
    v_semester_status TEXT;

    v_recap_items JSONB := '[]'::jsonb;
    v_remedial_candidates JSONB := '[]'::jsonb;

    v_total_students INTEGER := 0;
    v_tuntas_count INTEGER := 0;
    v_perlu_remedial_count INTEGER := 0;
    v_incomplete_count INTEGER := 0;
    v_uts_remedial_count INTEGER := 0;
    v_uas_remedial_count INTEGER := 0;
    v_belum_uts_count INTEGER := 0;
    v_belum_uas_count INTEGER := 0;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin (STRICT ADMIN ONLY)
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak melihat rekapitulasi semester.');
    END IF;

    -- 2. Resolusi Periode UTS & UAS Berdasarkan Parameter
    IF p_config_id IS NOT NULL AND trim(p_config_id) != '' THEN
        SELECT * INTO v_config FROM semester_evaluation_configs WHERE id = p_config_id;
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Konfigurasi evaluasi semester tidak ditemukan.');
        END IF;

        SELECT * INTO v_term FROM academic_terms WHERE id = v_config.academic_term_id;
        SELECT * INTO v_uts_period FROM exam_periods WHERE id = v_config.uts_period_id;
        SELECT * INTO v_uas_period FROM exam_periods WHERE id = v_config.uas_period_id;
        v_uts_weight := v_config.uts_weight;
        v_uas_weight := v_config.uas_weight;
        v_config_name := v_config.name;

    ELSIF p_uts_period_id IS NOT NULL AND p_uas_period_id IS NOT NULL THEN
        SELECT * INTO v_uts_period FROM exam_periods WHERE id = p_uts_period_id;
        SELECT * INTO v_uas_period FROM exam_periods WHERE id = p_uas_period_id;

        IF v_uts_period.id IS NULL OR v_uas_period.id IS NULL THEN
            RETURN json_build_object('success', false, 'message', 'Periode UTS atau UAS tidak ditemukan.');
        END IF;

        IF v_uts_period.exam_type != 'uts' OR v_uas_period.exam_type != 'uas' THEN
            RETURN json_build_object('success', false, 'message', 'Tipe periode tidak sesuai (harus pasangan UTS dan UAS).');
        END IF;

        IF v_uts_period.academic_term_id != v_uas_period.academic_term_id THEN
            RETURN json_build_object('success', false, 'message', 'Periode UTS dan UAS harus berada pada semester akademik yang sama.');
        END IF;

        SELECT * INTO v_term FROM academic_terms WHERE id = v_uts_period.academic_term_id;

        -- Cari apakah ada konfigurasi tersimpan untuk pasangan periode ini
        SELECT * INTO v_config FROM semester_evaluation_configs 
        WHERE uts_period_id = v_uts_period.id AND uas_period_id = v_uas_period.id;
        IF FOUND THEN
            v_uts_weight := v_config.uts_weight;
            v_uas_weight := v_config.uas_weight;
            v_config_name := v_config.name;
        END IF;

    ELSIF p_academic_term_id IS NOT NULL AND trim(p_academic_term_id) != '' THEN
        SELECT * INTO v_term FROM academic_terms WHERE id = p_academic_term_id;
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Semester akademik tidak ditemukan.');
        END IF;

        -- Cari apakah ada konfigurasi evaluasi untuk semester ini
        SELECT * INTO v_config FROM semester_evaluation_configs WHERE academic_term_id = p_academic_term_id LIMIT 1;
        IF FOUND THEN
            SELECT * INTO v_uts_period FROM exam_periods WHERE id = v_config.uts_period_id;
            SELECT * INTO v_uas_period FROM exam_periods WHERE id = v_config.uas_period_id;
            v_uts_weight := v_config.uts_weight;
            v_uas_weight := v_config.uas_weight;
            v_config_name := v_config.name;
        ELSE
            -- Multiple Period Protection: Hitung jumlah periode UTS & UAS pada semester ini
            SELECT COUNT(*) INTO v_uts_count FROM exam_periods WHERE academic_term_id = p_academic_term_id AND exam_type = 'uts';
            SELECT COUNT(*) INTO v_uas_count FROM exam_periods WHERE academic_term_id = p_academic_term_id AND exam_type = 'uas';

            IF v_uts_count = 0 OR v_uas_count = 0 THEN
                RETURN json_build_object(
                    'success', false, 
                    'message', 'Semester ini belum memiliki kelengkapan periode UTS dan UAS.'
                );
            END IF;

            IF v_uts_count > 1 OR v_uas_count > 1 THEN
                RETURN json_build_object(
                    'success', false, 
                    'message', 'Terdapat lebih dari satu periode UTS/UAS dalam semester ini. Harap pilih konfigurasi atau pasangan periode secara spesifik.'
                );
            END IF;

            -- Tepat 1 UTS dan 1 UAS: Auto-pairing aman
            SELECT * INTO v_uts_period FROM exam_periods WHERE academic_term_id = p_academic_term_id AND exam_type = 'uts' LIMIT 1;
            SELECT * INTO v_uas_period FROM exam_periods WHERE academic_term_id = p_academic_term_id AND exam_type = 'uas' LIMIT 1;
        END IF;

    ELSE
        -- Ambil semester aktif secara default
        SELECT * INTO v_term FROM academic_terms WHERE status = 'active' LIMIT 1;
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Tidak ada semester akademik aktif. Harap tentukan semester.');
        END IF;

        -- Multiple period protection pada semester aktif
        SELECT COUNT(*) INTO v_uts_count FROM exam_periods WHERE academic_term_id = v_term.id AND exam_type = 'uts';
        SELECT COUNT(*) INTO v_uas_count FROM exam_periods WHERE academic_term_id = v_term.id AND exam_type = 'uas';

        IF v_uts_count != 1 OR v_uas_count != 1 THEN
            RETURN json_build_object('success', false, 'message', 'Semester aktif memiliki periode jamak atau belum lengkap. Harap pilih konfigurasi secara spesifik.');
        END IF;

        SELECT * INTO v_uts_period FROM exam_periods WHERE academic_term_id = v_term.id AND exam_type = 'uts' LIMIT 1;
        SELECT * INTO v_uas_period FROM exam_periods WHERE academic_term_id = v_term.id AND exam_type = 'uas' LIMIT 1;
    END IF;

    -- Validasi final pasangan periode
    IF v_uts_period.id IS NULL OR v_uas_period.id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Pasangan periode UTS dan UAS tidak lengkap.');
    END IF;

    -- 3. Query Seluruh Santri Peserta (Union Peserta UTS & UAS)
    FOR v_student IN
        SELECT DISTINCT 
            s.id AS student_id,
            s.name AS student_name,
            s.nis AS student_nis,
            COALESCE(p_uts.class_snapshot, p_uas.class_snapshot, s.class) AS class_name,
            COALESCE(p_uts.halaqah_snapshot, p_uas.halaqah_snapshot, s.halaqah) AS halaqah
        FROM students s
        LEFT JOIN exam_participants p_uts ON p_uts.student_id = s.id AND p_uts.exam_period_id = v_uts_period.id
        LEFT JOIN exam_participants p_uas ON p_uas.student_id = s.id AND p_uas.exam_period_id = v_uas_period.id
        WHERE p_uts.id IS NOT NULL OR p_uas.id IS NOT NULL
        ORDER BY class_name ASC, student_name ASC
    LOOP
        v_total_students := v_total_students + 1;

        -- ------------------------------------------------------------
        -- 3A. Analisis Nilai Otoritatif UTS & Multiple Attempt Protection
        -- ------------------------------------------------------------
        v_uts_score := NULL;
        v_uts_status := 'NOT_STARTED';
        v_uts_remedial := false;
        v_uts_contrib := NULL;
        v_uts_snap_id := NULL;

        SELECT COUNT(*) INTO v_submitted_uts_count FROM exam_attempts
        WHERE exam_period_id = v_uts_period.id 
          AND student_id = v_student.student_id
          AND status = 'submitted';

        IF v_submitted_uts_count > 1 THEN
            RETURN json_build_object(
                'success', false,
                'message', 'Integritas data terlanggar: Ditemukan lebih dari satu ujian UTS berstatus submitted untuk santri ID ' || v_student.student_id
            );
        END IF;

        IF v_submitted_uts_count = 1 THEN
            SELECT * INTO v_uts_att FROM exam_attempts
            WHERE exam_period_id = v_uts_period.id 
              AND student_id = v_student.student_id
              AND status = 'submitted';

            v_uts_score := v_uts_att.total_score;
            IF v_uts_score >= v_uts_period.kkm THEN
                v_uts_status := 'TUNTAS';
                v_uts_remedial := false;
            ELSE
                v_uts_status := 'PERLU_REMEDIAL';
                v_uts_remedial := true;
                v_uts_remedial_count := v_uts_remedial_count + 1;
            END IF;

            -- Ambil question set untuk trace snapshot material original
            SELECT * INTO v_uts_qs FROM exam_question_sets WHERE id = v_uts_att.question_set_id;
            v_uts_snap_id := v_uts_qs.material_snapshot_id;
            IF v_uts_snap_id IS NULL THEN
                SELECT id INTO v_uts_snap_id FROM exam_material_snapshots
                WHERE exam_period_id = v_uts_period.id AND student_id = v_student.student_id AND status = 'finalized';
            END IF;
        ELSE
            -- Cek jika ada attempt in_progress
            PERFORM 1 FROM exam_attempts
            WHERE exam_period_id = v_uts_period.id 
              AND student_id = v_student.student_id
              AND status = 'in_progress';

            IF FOUND THEN
                v_uts_status := 'IN_PROGRESS';
            ELSE
                v_uts_status := 'NOT_STARTED';
            END IF;
            v_belum_uts_count := v_belum_uts_count + 1;
        END IF;

        -- ------------------------------------------------------------
        -- 3B. Analisis Nilai Otoritatif UAS & Multiple Attempt Protection
        -- ------------------------------------------------------------
        v_uas_score := NULL;
        v_uas_status := 'NOT_STARTED';
        v_uas_remedial := false;
        v_uas_contrib := NULL;
        v_uas_snap_id := NULL;

        SELECT COUNT(*) INTO v_submitted_uas_count FROM exam_attempts
        WHERE exam_period_id = v_uas_period.id 
          AND student_id = v_student.student_id
          AND status = 'submitted';

        IF v_submitted_uas_count > 1 THEN
            RETURN json_build_object(
                'success', false,
                'message', 'Integritas data terlanggar: Ditemukan lebih dari satu ujian UAS berstatus submitted untuk santri ID ' || v_student.student_id
            );
        END IF;

        IF v_submitted_uas_count = 1 THEN
            SELECT * INTO v_uas_att FROM exam_attempts
            WHERE exam_period_id = v_uas_period.id 
              AND student_id = v_student.student_id
              AND status = 'submitted';

            v_uas_score := v_uas_att.total_score;
            IF v_uas_score >= v_uas_period.kkm THEN
                v_uas_status := 'TUNTAS';
                v_uas_remedial := false;
            ELSE
                v_uas_status := 'PERLU_REMEDIAL';
                v_uas_remedial := true;
                v_uas_remedial_count := v_uas_remedial_count + 1;
            END IF;

            -- Ambil question set untuk trace snapshot material original
            SELECT * INTO v_uas_qs FROM exam_question_sets WHERE id = v_uas_att.question_set_id;
            v_uas_snap_id := v_uas_qs.material_snapshot_id;
            IF v_uas_snap_id IS NULL THEN
                SELECT id INTO v_uas_snap_id FROM exam_material_snapshots
                WHERE exam_period_id = v_uas_period.id AND student_id = v_student.student_id AND status = 'finalized';
            END IF;
        ELSE
            -- Cek jika ada attempt in_progress
            PERFORM 1 FROM exam_attempts
            WHERE exam_period_id = v_uas_period.id 
              AND student_id = v_student.student_id
              AND status = 'in_progress';

            IF FOUND THEN
                v_uas_status := 'IN_PROGRESS';
            ELSE
                v_uas_status := 'NOT_STARTED';
            END IF;
            v_belum_uas_count := v_belum_uas_count + 1;
        END IF;

        -- ------------------------------------------------------------
        -- 3C. Kalkulasi Nilai Akhir Semester & Kontribusi Komponen
        -- ------------------------------------------------------------
        IF v_uts_score IS NOT NULL AND v_uas_score IS NOT NULL THEN
            v_uts_contrib := ROUND(v_uts_score * (v_uts_weight / 100.0), 2);
            v_uas_contrib := ROUND(v_uas_score * (v_uas_weight / 100.0), 2);
            v_semester_score := ROUND(v_uts_contrib + v_uas_contrib, 2);

            -- THE FUNDAMENTAL REMEDIAL RULE:
            -- Nilai UAS yang tinggi TIDAK PERNAH membatalkan remedial UTS jika nilai UTS di bawah KKM.
            -- Status semester TUNTAS hanya jika KEDUA komponen TUNTAS secara independen.
            IF v_uts_status = 'TUNTAS' AND v_uas_status = 'TUNTAS' THEN
                v_semester_status := 'TUNTAS';
                v_tuntas_count := v_tuntas_count + 1;
            ELSE
                v_semester_status := 'PERLU_REMEDIAL';
                v_perlu_remedial_count := v_perlu_remedial_count + 1;
            END IF;
        ELSE
            -- Missing exam handling: NULL is NOT 0
            v_uts_contrib := NULL;
            v_uas_contrib := NULL;
            v_semester_score := NULL;
            v_semester_status := 'INCOMPLETE';
            v_incomplete_count := v_incomplete_count + 1;
        END IF;

        -- Susun item rekapitulasi santri
        v_recap_items := v_recap_items || jsonb_build_object(
            'studentId', v_student.student_id,
            'studentName', v_student.student_name,
            'studentNis', v_student.student_nis,
            'className', v_student.class_name,
            'halaqah', v_student.halaqah,
            'uts', jsonb_build_object(
                'periodId', v_uts_period.id,
                'attemptId', CASE WHEN v_submitted_uts_count = 1 THEN v_uts_att.id ELSE NULL END,
                'originalScore', v_uts_score,
                'kkm', v_uts_period.kkm,
                'status', v_uts_status,
                'remedialEligible', v_uts_remedial,
                'materialSnapshotId', v_uts_snap_id
            ),
            'uas', jsonb_build_object(
                'periodId', v_uas_period.id,
                'attemptId', CASE WHEN v_submitted_uas_count = 1 THEN v_uas_att.id ELSE NULL END,
                'originalScore', v_uas_score,
                'kkm', v_uas_period.kkm,
                'status', v_uas_status,
                'remedialEligible', v_uas_remedial,
                'materialSnapshotId', v_uas_snap_id
            ),
            'semester', jsonb_build_object(
                'utsWeight', v_uts_weight,
                'uasWeight', v_uas_weight,
                'utsContribution', v_uts_contrib,
                'uasContribution', v_uas_contrib,
                'score', v_semester_score,
                'status', v_semester_status
            )
        );

        -- ------------------------------------------------------------
        -- 3D. Kandidat Remedial (Traceability untuk Tahap 7B)
        -- ------------------------------------------------------------
        IF v_uts_remedial AND v_submitted_uts_count = 1 THEN
            v_remedial_candidates := v_remedial_candidates || jsonb_build_object(
                'studentId', v_student.student_id,
                'studentName', v_student.student_name,
                'className', v_student.class_name,
                'halaqah', v_student.halaqah,
                'examPeriodId', v_uts_period.id,
                'examType', 'uts',
                'originalAttemptId', v_uts_att.id,
                'originalQuestionSetId', v_uts_att.question_set_id,
                'originalScore', v_uts_score,
                'kkm', v_uts_period.kkm,
                'materialSnapshotId', COALESCE(v_uts_snap_id, ''),
                'eligibilityReason', 'ORIGINAL_SCORE_BELOW_KKM'
            );
        END IF;

        IF v_uas_remedial AND v_submitted_uas_count = 1 THEN
            v_remedial_candidates := v_remedial_candidates || jsonb_build_object(
                'studentId', v_student.student_id,
                'studentName', v_student.student_name,
                'className', v_student.class_name,
                'halaqah', v_student.halaqah,
                'examPeriodId', v_uas_period.id,
                'examType', 'uas',
                'originalAttemptId', v_uas_att.id,
                'originalQuestionSetId', v_uas_att.question_set_id,
                'originalScore', v_uas_score,
                'kkm', v_uas_period.kkm,
                'materialSnapshotId', COALESCE(v_uas_snap_id, ''),
                'eligibilityReason', 'ORIGINAL_SCORE_BELOW_KKM'
            );
        END IF;

    END LOOP;

    RETURN json_build_object(
        'success', true,
        'config', jsonb_build_object(
            'academicTermId', v_term.id,
            'academicYear', v_term.academic_year,
            'semester', v_term.semester,
            'configName', v_config_name,
            'utsPeriodId', v_uts_period.id,
            'utsPeriodName', v_uts_period.name,
            'utsKkm', v_uts_period.kkm,
            'utsWeight', v_uts_weight,
            'uasPeriodId', v_uas_period.id,
            'uasPeriodName', v_uas_period.name,
            'uasKkm', v_uas_period.kkm,
            'uasWeight', v_uas_weight
        ),
        'summary', jsonb_build_object(
            'totalStudents', v_total_students,
            'tuntasCount', v_tuntas_count,
            'perluRemedialCount', v_perlu_remedial_count,
            'incompleteCount', v_incomplete_count,
            'utsRemedialCount', v_uts_remedial_count,
            'uasRemedialCount', v_uas_remedial_count,
            'belumUtsCount', v_belum_uts_count,
            'belumUasCount', v_belum_uas_count
        ),
        'recap', v_recap_items,
        'remedialCandidates', v_remedial_candidates
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- 3. PERMISSIONS & EXECUTE PRIVILEGES
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION upsert_semester_evaluation_config(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_semester_evaluation_config(TEXT, TEXT, JSONB) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION get_semester_evaluation_configs(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_semester_evaluation_configs(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION get_semester_tahfiz_recap(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_semester_tahfiz_recap(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
