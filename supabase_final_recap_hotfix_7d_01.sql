-- ============================================================
-- SITA - SISTEM INFORMASI TAHFIDZ AL-QUR'AN
-- DARUL ABROR ISLAMIC BOARDING SCHOOL
-- TARGETED HOTFIX: TAHAP 7D — REKAP FINAL & MONITORING (HOTFIX #1)
-- File: supabase_final_recap_hotfix_7d_01.sql
--
-- FIX:
-- Mengganti referensi field langsung pada RECORD PL/pgSQL
-- (v_rem_uts_sess, v_rem_uts_att, v_rem_uas_sess, v_rem_uas_att, dsb)
-- dengan variabel skalar eksplisit untuk mengeliminasi error PostgreSQL 55000
-- ("record is not assigned yet: The tuple structure of a not-yet-assigned record is indeterminate").
-- ============================================================

CREATE OR REPLACE FUNCTION get_semester_final_recap(
    p_username TEXT,
    p_password TEXT,
    p_academic_term_id TEXT DEFAULT NULL,
    p_config_id TEXT DEFAULT NULL,
    p_uts_period_id TEXT DEFAULT NULL,
    p_uas_period_id TEXT DEFAULT NULL,
    p_class TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_term RECORD;
    v_uts_period RECORD;
    v_uas_period RECORD;
    v_uts_weight NUMERIC(5,2) := 40.00;
    v_uas_weight NUMERIC(5,2) := 60.00;
    v_config_name TEXT := 'Rekap Evaluasi Semester Final';
    v_config RECORD;
    v_dup_cfg_count INTEGER;
    v_uts_count INTEGER;
    v_uas_count INTEGER;

    v_student RECORD;
    v_sub_uts_count INTEGER;
    v_uts_att RECORD;
    v_rem_uts_sess_count INTEGER;
    v_rem_uts_sess RECORD;
    v_rem_uts_sub_count INTEGER;
    v_rem_uts_att RECORD;
    v_uts_examiner_name TEXT;
    v_rem_uts_examiner_name TEXT;

    v_sub_uas_count INTEGER;
    v_uas_att RECORD;
    v_rem_uas_sess_count INTEGER;
    v_rem_uas_sess RECORD;
    v_rem_uas_sub_count INTEGER;
    v_rem_uas_att RECORD;
    v_uas_examiner_name TEXT;
    v_rem_uas_examiner_name TEXT;

    -- Scalar Holders for IDs, Statuses and Timestamps (Eliminates Error 55000 on unassigned RECORD)
    v_uts_orig_attempt_id TEXT;
    v_uts_orig_submitted_at TIMESTAMPTZ;
    v_rem_uts_sess_id TEXT;
    v_rem_uts_att_id TEXT;
    v_rem_uts_submitted_at TIMESTAMPTZ;
    v_rem_uts_att_status TEXT;

    v_uas_orig_attempt_id TEXT;
    v_uas_orig_submitted_at TIMESTAMPTZ;
    v_rem_uas_sess_id TEXT;
    v_rem_uas_att_id TEXT;
    v_rem_uas_submitted_at TIMESTAMPTZ;
    v_rem_uas_att_status TEXT;

    v_uts_orig_score NUMERIC(5,2);
    v_uts_rem_score NUMERIC(5,2);
    v_uts_eff_score NUMERIC(5,2);
    v_uts_eff_source TEXT;
    v_uts_status TEXT;

    v_uas_orig_score NUMERIC(5,2);
    v_uas_rem_score NUMERIC(5,2);
    v_uas_eff_score NUMERIC(5,2);
    v_uas_eff_source TEXT;
    v_uas_status TEXT;

    v_sem_score NUMERIC(5,2);
    v_sem_status TEXT;
    v_has_remedial BOOLEAN;
    v_has_active_remedial BOOLEAN;

    -- Monitoring Aggregation Counters
    v_total_students INTEGER := 0;
    v_tuntas_count INTEGER := 0;
    v_perlu_remedial_count INTEGER := 0;
    v_sedang_remedial_count INTEGER := 0;
    v_tuntas_via_remedial_count INTEGER := 0;
    v_belum_tuntas_setelah_remedial_count INTEGER := 0;
    v_belum_lengkap_count INTEGER := 0;

    v_uts_not_started_count INTEGER := 0;
    v_uts_in_progress_count INTEGER := 0;
    v_uts_submitted_count INTEGER := 0;

    v_uas_not_started_count INTEGER := 0;
    v_uas_in_progress_count INTEGER := 0;
    v_uas_submitted_count INTEGER := 0;

    v_rem_needs_count INTEGER := 0;
    v_rem_scheduled_count INTEGER := 0;
    v_rem_in_progress_count INTEGER := 0;
    v_rem_submitted_count INTEGER := 0;
    v_rem_below_kkm_count INTEGER := 0;

    v_recap_items JSONB := '[]'::jsonb;
    v_item JSONB;
    v_matches_status BOOLEAN;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengakses rekap final evaluasi semester.');
    END IF;

    -- 2. Resolusi Periode Akademik & Konfigurasi Semester
    IF p_config_id IS NOT NULL THEN
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

    ELSIF p_academic_term_id IS NOT NULL THEN
        SELECT * INTO v_term FROM academic_terms WHERE id = p_academic_term_id;
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Semester akademik tidak ditemukan.');
        END IF;

        -- Ambil config jika ada
        SELECT COUNT(*) INTO v_dup_cfg_count FROM semester_evaluation_configs WHERE academic_term_id = p_academic_term_id;
        IF v_dup_cfg_count > 1 THEN
            RETURN json_build_object(
                'success', false,
                'errorType', 'INTEGRITY_VIOLATION',
                'message', 'Ditemukan lebih dari satu konfigurasi semester (' || v_dup_cfg_count || ') untuk semester yang dipilih. Harap tentukan konfigurasi ID secara spesifik.'
            );
        ELSIF v_dup_cfg_count = 1 THEN
            SELECT * INTO v_config FROM semester_evaluation_configs WHERE academic_term_id = p_academic_term_id;
            SELECT * INTO v_uts_period FROM exam_periods WHERE id = v_config.uts_period_id;
            SELECT * INTO v_uas_period FROM exam_periods WHERE id = v_config.uas_period_id;
            v_uts_weight := v_config.uts_weight;
            v_uas_weight := v_config.uas_weight;
            v_config_name := v_config.name;
        ELSE
            -- Resolusi manual via p_uts_period_id dan p_uas_period_id
            IF p_uts_period_id IS NOT NULL AND p_uas_period_id IS NOT NULL THEN
                SELECT * INTO v_uts_period FROM exam_periods WHERE id = p_uts_period_id;
                SELECT * INTO v_uas_period FROM exam_periods WHERE id = p_uas_period_id;
            ELSE
                SELECT COUNT(*) INTO v_uts_count FROM exam_periods WHERE academic_term_id = p_academic_term_id AND exam_type = 'uts';
                SELECT COUNT(*) INTO v_uas_count FROM exam_periods WHERE academic_term_id = p_academic_term_id AND exam_type = 'uas';

                IF v_uts_count > 1 OR v_uas_count > 1 THEN
                    RETURN json_build_object(
                        'success', false,
                        'errorType', 'INTEGRITY_VIOLATION',
                        'message', 'Terdapat lebih dari satu periode UTS/UAS dalam semester ini. Harap pilih konfigurasi atau pasangan periode secara eksplisit.'
                    );
                END IF;

                SELECT * INTO v_uts_period FROM exam_periods WHERE academic_term_id = p_academic_term_id AND exam_type = 'uts';
                SELECT * INTO v_uas_period FROM exam_periods WHERE academic_term_id = p_academic_term_id AND exam_type = 'uas';
            END IF;
        END IF;

    ELSE
        -- Default: Semester aktif
        SELECT * INTO v_term FROM academic_terms WHERE status = 'active' LIMIT 1;
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Tidak ada semester akademik aktif. Harap pilih semester secara spesifik.');
        END IF;

        SELECT COUNT(*) INTO v_dup_cfg_count FROM semester_evaluation_configs WHERE academic_term_id = v_term.id;
        IF v_dup_cfg_count = 1 THEN
            SELECT * INTO v_config FROM semester_evaluation_configs WHERE academic_term_id = v_term.id;
            SELECT * INTO v_uts_period FROM exam_periods WHERE id = v_config.uts_period_id;
            SELECT * INTO v_uas_period FROM exam_periods WHERE id = v_config.uas_period_id;
            v_uts_weight := v_config.uts_weight;
            v_uas_weight := v_config.uas_weight;
            v_config_name := v_config.name;
        ELSE
            SELECT COUNT(*) INTO v_uts_count FROM exam_periods WHERE academic_term_id = v_term.id AND exam_type = 'uts';
            SELECT COUNT(*) INTO v_uas_count FROM exam_periods WHERE academic_term_id = v_term.id AND exam_type = 'uas';

            IF v_uts_count = 1 AND v_uas_count = 1 THEN
                SELECT * INTO v_uts_period FROM exam_periods WHERE academic_term_id = v_term.id AND exam_type = 'uts';
                SELECT * INTO v_uas_period FROM exam_periods WHERE academic_term_id = v_term.id AND exam_type = 'uas';
            ELSE
                RETURN json_build_object(
                    'success', false,
                    'message', 'Semester aktif memiliki periode jamak atau belum lengkap. Harap pilih konfigurasi secara spesifik.'
                );
            END IF;
        END IF;
    END IF;

    -- Validasi Keberadaan Pasangan Periode
    IF v_uts_period.id IS NULL OR v_uas_period.id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'message', 'Pasangan periode UTS dan UAS belum lengkap untuk semester ini.'
        );
    END IF;

    -- Cross-Term Pairing Guard
    IF v_uts_period.academic_term_id != v_uas_period.academic_term_id OR v_uts_period.academic_term_id != v_term.id THEN
        RETURN json_build_object(
            'success', false,
            'errorType', 'INTEGRITY_VIOLATION',
            'message', 'Periode UTS dan UAS harus berada pada semester akademik yang sama.'
        );
    END IF;

    -- Validasi Bobot Semester (Must Sum to 100)
    IF ROUND(v_uts_weight + v_uas_weight, 2) != 100.00 THEN
        RETURN json_build_object(
            'success', false,
            'errorType', 'INTEGRITY_VIOLATION',
            'message', 'Total bobot evaluasi semester UTS (' || v_uts_weight || '%) dan UAS (' || v_uas_weight || '%) harus berjumlah 100%.'
        );
    END IF;

    -- 3. Iterasi Peserta Ujian (Semua Santri yang terdaftar dalam UTS atau UAS)
    FOR v_student IN
        SELECT DISTINCT s.id AS student_id, s.nis, s.name AS student_name, s.class, s.halaqah
        FROM students s
        JOIN exam_participants ep ON ep.student_id = s.id
        WHERE (ep.exam_period_id = v_uts_period.id OR ep.exam_period_id = v_uas_period.id)
          AND (p_class IS NULL OR s.class = p_class)
          AND (p_search IS NULL OR (
                s.name ILIKE '%' || p_search || '%' OR
                s.nis ILIKE '%' || p_search || '%'
              ))
        ORDER BY s.class ASC, s.name ASC
    LOOP
        v_total_students := v_total_students + 1;

        -- Reset Scalar Holders for Each Student
        v_uts_orig_attempt_id := NULL;
        v_uts_orig_submitted_at := NULL;
        v_rem_uts_sess_id := NULL;
        v_rem_uts_att_id := NULL;
        v_rem_uts_submitted_at := NULL;
        v_rem_uts_att_status := NULL;

        v_uas_orig_attempt_id := NULL;
        v_uas_orig_submitted_at := NULL;
        v_rem_uas_sess_id := NULL;
        v_rem_uas_att_id := NULL;
        v_rem_uas_submitted_at := NULL;
        v_rem_uas_att_status := NULL;

        -- =========================================================
        -- A. UTS DATA RESOLUTION & INTEGRITY CHECK
        -- =========================================================
        -- Check duplicate submitted attempts for UTS
        SELECT COUNT(*) INTO v_sub_uts_count
        FROM exam_attempts
        WHERE exam_period_id = v_uts_period.id 
          AND student_id = v_student.student_id 
          AND status = 'submitted';

        IF v_sub_uts_count > 1 THEN
            RETURN json_build_object(
                'success', false,
                'errorType', 'INTEGRITY_VIOLATION',
                'message', 'Integritas gagal: Ditemukan ' || v_sub_uts_count || ' attempt UTS submitted ganda untuk santri: ' || v_student.student_name || '.'
            );
        END IF;

        IF v_sub_uts_count = 1 THEN
            SELECT ea.*, u.name AS examiner_name INTO v_uts_att 
            FROM exam_attempts ea
            LEFT JOIN users u ON u.id = ea.examiner_user_id
            WHERE ea.exam_period_id = v_uts_period.id 
              AND ea.student_id = v_student.student_id 
              AND ea.status = 'submitted';

            v_uts_orig_attempt_id := v_uts_att.id;
            v_uts_orig_submitted_at := v_uts_att.submitted_at;
            v_uts_orig_score := v_uts_att.total_score;
            v_uts_examiner_name := v_uts_att.examiner_name;
            v_uts_submitted_count := v_uts_submitted_count + 1;
        ELSE
            -- Check if in progress
            SELECT ea.* INTO v_uts_att 
            FROM exam_attempts ea
            WHERE ea.exam_period_id = v_uts_period.id 
              AND ea.student_id = v_student.student_id
            ORDER BY ea.created_at DESC LIMIT 1;

            IF FOUND AND v_uts_att.status = 'in_progress' THEN
                v_uts_orig_attempt_id := v_uts_att.id;
                v_uts_in_progress_count := v_uts_in_progress_count + 1;
            ELSE
                v_uts_not_started_count := v_uts_not_started_count + 1;
            END IF;

            v_uts_orig_score := NULL;
            v_uts_examiner_name := NULL;
        END IF;

        -- Check UTS Remedial Sessions
        SELECT COUNT(*) INTO v_rem_uts_sess_count
        FROM exam_remedial_sessions
        WHERE original_exam_period_id = v_uts_period.id
          AND student_id = v_student.student_id
          AND exam_type = 'uts'
          AND status NOT IN ('invalid', 'stale');

        IF v_rem_uts_sess_count > 1 THEN
            RETURN json_build_object(
                'success', false,
                'errorType', 'INTEGRITY_VIOLATION',
                'message', 'Integritas gagal: Ditemukan ' || v_rem_uts_sess_count || ' sesi remedial UTS aktif ganda untuk santri: ' || v_student.student_name || '.'
            );
        END IF;

        IF v_rem_uts_sess_count = 1 THEN
            SELECT * INTO v_rem_uts_sess
            FROM exam_remedial_sessions
            WHERE original_exam_period_id = v_uts_period.id
              AND student_id = v_student.student_id
              AND exam_type = 'uts'
              AND status NOT IN ('invalid', 'stale');

            v_rem_uts_sess_id := v_rem_uts_sess.id;

            -- Check duplicate submitted attempts for remedial UTS
            SELECT COUNT(*) INTO v_rem_uts_sub_count
            FROM exam_remedial_attempts
            WHERE remedial_session_id = v_rem_uts_sess.id
              AND status = 'submitted';

            IF v_rem_uts_sub_count > 1 THEN
                RETURN json_build_object(
                    'success', false,
                    'errorType', 'INTEGRITY_VIOLATION',
                    'message', 'Integritas gagal: Ditemukan ' || v_rem_uts_sub_count || ' attempt remedial UTS submitted ganda untuk santri: ' || v_student.student_name || '.'
                );
            END IF;

            IF v_rem_uts_sub_count = 1 THEN
                SELECT era.*, u.name AS examiner_name INTO v_rem_uts_att
                FROM exam_remedial_attempts era
                LEFT JOIN users u ON u.id = era.examiner_user_id
                WHERE era.remedial_session_id = v_rem_uts_sess.id
                  AND era.status = 'submitted';

                v_rem_uts_att_id := v_rem_uts_att.id;
                v_rem_uts_submitted_at := v_rem_uts_att.submitted_at;
                v_rem_uts_att_status := v_rem_uts_att.status;
                v_uts_rem_score := v_rem_uts_att.total_score;
                v_rem_uts_examiner_name := v_rem_uts_att.examiner_name;
                v_rem_submitted_count := v_rem_submitted_count + 1;
            ELSE
                SELECT era.*, u.name AS examiner_name INTO v_rem_uts_att
                FROM exam_remedial_attempts era
                LEFT JOIN users u ON u.id = era.examiner_user_id
                WHERE era.remedial_session_id = v_rem_uts_sess.id
                ORDER BY era.created_at DESC LIMIT 1;

                v_uts_rem_score := NULL;
                IF FOUND THEN
                    v_rem_uts_att_id := v_rem_uts_att.id;
                    v_rem_uts_att_status := v_rem_uts_att.status;
                    v_rem_uts_examiner_name := v_rem_uts_att.examiner_name;
                ELSE
                    v_rem_uts_examiner_name := NULL;
                END IF;

                IF v_rem_uts_att_status IN ('in_progress', 'reopened') THEN
                    v_rem_in_progress_count := v_rem_in_progress_count + 1;
                ELSE
                    v_rem_scheduled_count := v_rem_scheduled_count + 1;
                END IF;
            END IF;
        ELSE
            v_uts_rem_score := NULL;
            v_rem_uts_examiner_name := NULL;
        END IF;

        -- Derive UTS Effective Score & Component Status
        IF v_uts_rem_score IS NOT NULL THEN
            v_uts_eff_score := v_uts_rem_score;
            v_uts_eff_source := 'REMEDIAL';
            IF v_uts_rem_score >= v_uts_period.kkm THEN
                v_uts_status := 'TUNTAS_MELALUI_REMEDIAL';
            ELSE
                v_uts_status := 'BELUM_TUNTAS_SETELAH_REMEDIAL';
                v_rem_below_kkm_count := v_rem_below_kkm_count + 1;
            END IF;
        ELSIF v_uts_orig_score IS NOT NULL THEN
            v_uts_eff_score := v_uts_orig_score;
            v_uts_eff_source := 'ORIGINAL';
            IF v_uts_orig_score >= v_uts_period.kkm THEN
                v_uts_status := 'TUNTAS';
            ELSE
                IF v_rem_uts_sess_id IS NULL THEN
                    v_uts_status := 'PERLU_REMEDIAL';
                    v_rem_needs_count := v_rem_needs_count + 1;
                ELSIF v_rem_uts_att_status IN ('in_progress', 'reopened') THEN
                    v_uts_status := 'SEDANG_REMEDIAL';
                ELSE
                    v_uts_status := 'REMEDIAL_DIJADWALKAN';
                END IF;
            END IF;
        ELSE
            v_uts_eff_score := NULL;
            v_uts_eff_source := 'NONE';
            v_uts_status := 'BELUM_UJIAN';
        END IF;


        -- =========================================================
        -- B. UAS DATA RESOLUTION & INTEGRITY CHECK
        -- =========================================================
        -- Check duplicate submitted attempts for UAS
        SELECT COUNT(*) INTO v_sub_uas_count
        FROM exam_attempts
        WHERE exam_period_id = v_uas_period.id 
          AND student_id = v_student.student_id 
          AND status = 'submitted';

        IF v_sub_uas_count > 1 THEN
            RETURN json_build_object(
                'success', false,
                'errorType', 'INTEGRITY_VIOLATION',
                'message', 'Integritas gagal: Ditemukan ' || v_sub_uas_count || ' attempt UAS submitted ganda untuk santri: ' || v_student.student_name || '.'
            );
        END IF;

        IF v_sub_uas_count = 1 THEN
            SELECT ea.*, u.name AS examiner_name INTO v_uas_att 
            FROM exam_attempts ea
            LEFT JOIN users u ON u.id = ea.examiner_user_id
            WHERE ea.exam_period_id = v_uas_period.id 
              AND ea.student_id = v_student.student_id 
              AND ea.status = 'submitted';

            v_uas_orig_attempt_id := v_uas_att.id;
            v_uas_orig_submitted_at := v_uas_att.submitted_at;
            v_uas_orig_score := v_uas_att.total_score;
            v_uas_examiner_name := v_uas_att.examiner_name;
            v_uas_submitted_count := v_uas_submitted_count + 1;
        ELSE
            SELECT ea.* INTO v_uas_att 
            FROM exam_attempts ea
            WHERE ea.exam_period_id = v_uas_period.id 
              AND ea.student_id = v_student.student_id
            ORDER BY ea.created_at DESC LIMIT 1;

            IF FOUND AND v_uas_att.status = 'in_progress' THEN
                v_uas_orig_attempt_id := v_uas_att.id;
                v_uas_in_progress_count := v_uas_in_progress_count + 1;
            ELSE
                v_uas_not_started_count := v_uas_not_started_count + 1;
            END IF;

            v_uas_orig_score := NULL;
            v_uas_examiner_name := NULL;
        END IF;

        -- Check UAS Remedial Sessions
        SELECT COUNT(*) INTO v_rem_uas_sess_count
        FROM exam_remedial_sessions
        WHERE original_exam_period_id = v_uas_period.id
          AND student_id = v_student.student_id
          AND exam_type = 'uas'
          AND status NOT IN ('invalid', 'stale');

        IF v_rem_uas_sess_count > 1 THEN
            RETURN json_build_object(
                'success', false,
                'errorType', 'INTEGRITY_VIOLATION',
                'message', 'Integritas gagal: Ditemukan ' || v_rem_uas_sess_count || ' sesi remedial UAS aktif ganda untuk santri: ' || v_student.student_name || '.'
            );
        END IF;

        IF v_rem_uas_sess_count = 1 THEN
            SELECT * INTO v_rem_uas_sess
            FROM exam_remedial_sessions
            WHERE original_exam_period_id = v_uas_period.id
              AND student_id = v_student.student_id
              AND exam_type = 'uas'
              AND status NOT IN ('invalid', 'stale');

            v_rem_uas_sess_id := v_rem_uas_sess.id;

            -- Check duplicate submitted attempts for remedial UAS
            SELECT COUNT(*) INTO v_rem_uas_sub_count
            FROM exam_remedial_attempts
            WHERE remedial_session_id = v_rem_uas_sess.id
              AND status = 'submitted';

            IF v_rem_uas_sub_count > 1 THEN
                RETURN json_build_object(
                    'success', false,
                    'errorType', 'INTEGRITY_VIOLATION',
                    'message', 'Integritas gagal: Ditemukan ' || v_rem_uas_sub_count || ' attempt remedial UAS submitted ganda untuk santri: ' || v_student.student_name || '.'
                );
            END IF;

            IF v_rem_uas_sub_count = 1 THEN
                SELECT era.*, u.name AS examiner_name INTO v_rem_uas_att
                FROM exam_remedial_attempts era
                LEFT JOIN users u ON u.id = era.examiner_user_id
                WHERE era.remedial_session_id = v_rem_uas_sess.id
                  AND era.status = 'submitted';

                v_rem_uas_att_id := v_rem_uas_att.id;
                v_rem_uas_submitted_at := v_rem_uas_att.submitted_at;
                v_rem_uas_att_status := v_rem_uas_att.status;
                v_uas_rem_score := v_rem_uas_att.total_score;
                v_rem_uas_examiner_name := v_rem_uas_att.examiner_name;
                v_rem_submitted_count := v_rem_submitted_count + 1;
            ELSE
                SELECT era.*, u.name AS examiner_name INTO v_rem_uas_att
                FROM exam_remedial_attempts era
                LEFT JOIN users u ON u.id = era.examiner_user_id
                WHERE era.remedial_session_id = v_rem_uas_sess.id
                ORDER BY era.created_at DESC LIMIT 1;

                v_uas_rem_score := NULL;
                IF FOUND THEN
                    v_rem_uas_att_id := v_rem_uas_att.id;
                    v_rem_uas_att_status := v_rem_uas_att.status;
                    v_rem_uas_examiner_name := v_rem_uas_att.examiner_name;
                ELSE
                    v_rem_uas_examiner_name := NULL;
                END IF;

                IF v_rem_uas_att_status IN ('in_progress', 'reopened') THEN
                    v_rem_in_progress_count := v_rem_in_progress_count + 1;
                ELSE
                    v_rem_scheduled_count := v_rem_scheduled_count + 1;
                END IF;
            END IF;
        ELSE
            v_uas_rem_score := NULL;
            v_rem_uas_examiner_name := NULL;
        END IF;

        -- Derive UAS Effective Score & Component Status
        IF v_uas_rem_score IS NOT NULL THEN
            v_uas_eff_score := v_uas_rem_score;
            v_uas_eff_source := 'REMEDIAL';
            IF v_uas_rem_score >= v_uas_period.kkm THEN
                v_uas_status := 'TUNTAS_MELALUI_REMEDIAL';
            ELSE
                v_uas_status := 'BELUM_TUNTAS_SETELAH_REMEDIAL';
                v_rem_below_kkm_count := v_rem_below_kkm_count + 1;
            END IF;
        ELSIF v_uas_orig_score IS NOT NULL THEN
            v_uas_eff_score := v_uas_orig_score;
            v_uas_eff_source := 'ORIGINAL';
            IF v_uas_orig_score >= v_uas_period.kkm THEN
                v_uas_status := 'TUNTAS';
            ELSE
                IF v_rem_uas_sess_id IS NULL THEN
                    v_uas_status := 'PERLU_REMEDIAL';
                    v_rem_needs_count := v_rem_needs_count + 1;
                ELSIF v_rem_uas_att_status IN ('in_progress', 'reopened') THEN
                    v_uas_status := 'SEDANG_REMEDIAL';
                ELSE
                    v_uas_status := 'REMEDIAL_DIJADWALKAN';
                END IF;
            END IF;
        ELSE
            v_uas_eff_score := NULL;
            v_uas_eff_source := 'NONE';
            v_uas_status := 'BELUM_UJIAN';
        END IF;


        -- =========================================================
        -- C. FINAL SEMESTER SCORE & STATUS CALCULATION
        -- =========================================================
        v_has_remedial := (v_rem_uts_sess_id IS NOT NULL OR v_rem_uas_sess_id IS NOT NULL);
        v_has_active_remedial := (
            v_rem_uts_att_status IN ('in_progress', 'reopened') OR
            v_rem_uas_att_status IN ('in_progress', 'reopened')
        );

        -- Semester Score: NULL if either component is missing
        IF v_uts_eff_score IS NOT NULL AND v_uas_eff_score IS NOT NULL THEN
            v_sem_score := ROUND(((v_uts_eff_score * v_uts_weight / 100.0) + (v_uas_eff_score * v_uas_weight / 100.0)), 2);
        ELSE
            v_sem_score := NULL;
        END IF;

        -- Semester Status Derivation
        IF v_uts_eff_score IS NULL OR v_uas_eff_score IS NULL THEN
            IF v_uts_status = 'BELUM_UJIAN' AND v_uas_status = 'BELUM_UJIAN' THEN
                v_sem_status := 'BELUM_IKUT_UJIAN';
            ELSE
                v_sem_status := 'BELUM_LENGKAP';
            END IF;
            v_belum_lengkap_count := v_belum_lengkap_count + 1;

        ELSIF v_uts_status = 'SEDANG_REMEDIAL' OR v_uas_status = 'SEDANG_REMEDIAL' THEN
            v_sem_status := 'SEDANG_REMEDIAL';
            v_sedang_remedial_count := v_sedang_remedial_count + 1;

        ELSIF v_uts_status = 'PERLU_REMEDIAL' OR v_uas_status = 'PERLU_REMEDIAL' OR 
              v_uts_status = 'REMEDIAL_DIJADWALKAN' OR v_uas_status = 'REMEDIAL_DIJADWALKAN' THEN
            v_sem_status := 'PERLU_REMEDIAL';
            v_perlu_remedial_count := v_perlu_remedial_count + 1;

        ELSIF v_uts_status = 'BELUM_TUNTAS_SETELAH_REMEDIAL' OR v_uas_status = 'BELUM_TUNTAS_SETELAH_REMEDIAL' THEN
            v_sem_status := 'BELUM_TUNTAS_SETELAH_REMEDIAL';
            v_belum_tuntas_setelah_remedial_count := v_belum_tuntas_setelah_remedial_count + 1;

        ELSIF v_uts_eff_score >= v_uts_period.kkm AND v_uas_eff_score >= v_uas_period.kkm THEN
            IF v_uts_status = 'TUNTAS_MELALUI_REMEDIAL' OR v_uas_status = 'TUNTAS_MELALUI_REMEDIAL' THEN
                v_sem_status := 'TUNTAS_MELALUI_REMEDIAL';
                v_tuntas_via_remedial_count := v_tuntas_via_remedial_count + 1;
            ELSE
                v_sem_status := 'TUNTAS';
                v_tuntas_count := v_tuntas_count + 1;
            END IF;
        ELSE
            -- Fallback guard: Single component fail never overridden by aggregate
            v_sem_status := 'PERLU_REMEDIAL';
            v_perlu_remedial_count := v_perlu_remedial_count + 1;
        END IF;

        -- Filter by status if requested
        v_matches_status := (p_status IS NULL OR p_status = '' OR v_sem_status = p_status);

        IF v_matches_status THEN
            v_item := jsonb_build_object(
                'studentId', v_student.student_id,
                'nis', v_student.nis,
                'studentName', v_student.student_name,
                'class', v_student.class,
                'halaqah', v_student.halaqah,

                'utsPeriodId', v_uts_period.id,
                'utsPeriodName', v_uts_period.name,
                'utsKkm', v_uts_period.kkm,
                'utsOriginalAttemptId', v_uts_orig_attempt_id,
                'utsOriginalScore', v_uts_orig_score,
                'utsOriginalSubmittedAt', v_uts_orig_submitted_at,
                'utsOriginalExaminerName', v_uts_examiner_name,

                'utsRemedialSessionId', v_rem_uts_sess_id,
                'utsRemedialAttemptId', v_rem_uts_att_id,
                'utsRemedialScore', v_uts_rem_score,
                'utsRemedialSubmittedAt', v_rem_uts_submitted_at,
                'utsRemedialExaminerName', v_rem_uts_examiner_name,

                'utsEffectiveScore', v_uts_eff_score,
                'utsEffectiveSource', v_uts_eff_source,
                'utsStatus', v_uts_status,

                'uasPeriodId', v_uas_period.id,
                'uasPeriodName', v_uas_period.name,
                'uasKkm', v_uas_period.kkm,
                'uasOriginalAttemptId', v_uas_orig_attempt_id,
                'uasOriginalScore', v_uas_orig_score,
                'uasOriginalSubmittedAt', v_uas_orig_submitted_at,
                'uasOriginalExaminerName', v_uas_examiner_name,

                'uasRemedialSessionId', v_rem_uas_sess_id,
                'uasRemedialAttemptId', v_rem_uas_att_id,
                'uasRemedialScore', v_uas_rem_score,
                'uasRemedialSubmittedAt', v_rem_uas_submitted_at,
                'uasRemedialExaminerName', v_rem_uas_examiner_name,

                'uasEffectiveScore', v_uas_eff_score,
                'uasEffectiveSource', v_uas_eff_source,
                'uasStatus', v_uas_status,

                'utsWeight', v_uts_weight,
                'uasWeight', v_uas_weight,

                'semesterFinalScore', v_sem_score,
                'semesterStatus', v_sem_status,

                'hasRemedial', v_has_remedial,
                'hasActiveRemedial', v_has_active_remedial
            );

            v_recap_items := v_recap_items || jsonb_build_array(v_item);
        END IF;

    END LOOP;

    RETURN json_build_object(
        'success', true,
        'config', json_build_object(
            'id', v_config.id,
            'name', v_config_name,
            'academicTermId', v_term.id,
            'academicYear', v_term.academic_year,
            'semester', v_term.semester,
            'utsPeriodId', v_uts_period.id,
            'utsPeriodName', v_uts_period.name,
            'utsKkm', v_uts_period.kkm,
            'uasPeriodId', v_uas_period.id,
            'uasPeriodName', v_uas_period.name,
            'uasKkm', v_uas_period.kkm,
            'utsWeight', v_uts_weight,
            'uasWeight', v_uas_weight
        ),
        'summary', json_build_object(
            'totalStudents', v_total_students,
            'tuntasCount', v_tuntas_count,
            'perluRemedialCount', v_perlu_remedial_count,
            'sedangRemedialCount', v_sedang_remedial_count,
            'tuntasViaRemedialCount', v_tuntas_via_remedial_count,
            'belumTuntasSetelahRemedialCount', v_belum_tuntas_setelah_remedial_count,
            'belumLengkapCount', v_belum_lengkap_count,

            'utsNotStartedCount', v_uts_not_started_count,
            'utsInProgressCount', v_uts_in_progress_count,
            'utsSubmittedCount', v_uts_submitted_count,

            'uasNotStartedCount', v_uas_not_started_count,
            'uasInProgressCount', v_uas_in_progress_count,
            'uasSubmittedCount', v_uas_submitted_count,

            'remedialNeedsCount', v_rem_needs_count,
            'remedialScheduledCount', v_rem_scheduled_count,
            'remedialInProgressCount', v_rem_in_progress_count,
            'remedialSubmittedCount', v_rem_submitted_count,
            'remedialBelowKkmCount', v_rem_below_kkm_count
        ),
        'recap', v_recap_items
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION get_semester_final_recap(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_semester_final_recap(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
