-- ============================================================
-- SITA — SISTEM INFORMASI TAHFIDZ AL-QUR'AN
-- DARUL ABROR ISLAMIC BOARDING SCHOOL
-- HOTFIX TAHAP 7C: PELAKSANAAN & PENILAIAN REMEDIAL
-- File: supabase_remedial_execution_hotfix_7c_01.sql
--
-- TARGET REVISION:
-- 1. get_examiner_remedial_students:
--    - Menghapus referensi tabel non-eksis 'classes' dan relasi 'st.class_id'.
--    - Menggunakan kolom live 'st.class' dan memproyeksikan 'className' & 'class'.
--    - Menghilangkan PostgreSQL error 42P01 (relation "classes" does not exist).
-- 2. start_remedial_attempt:
--    - Additive enhancement: memproyeksikan properti 'isCompleted'
--      (completed_at IS NOT NULL) pada daftar assessments untuk integritas resume.
-- 3. get_remedial_attempt_detail:
--    - Additive enhancement: memproyeksikan properti 'isCompleted'
--      (completed_at IS NOT NULL) pada daftar assessments.
-- 4. save_remedial_question_assessment:
--    - Additive enhancement: menyertakan 'isCompleted' pada response assessment.
-- ============================================================

-- ------------------------------------------------------------
-- RPC 2: get_examiner_remedial_students (HOTFIX)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_examiner_remedial_students(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_examiner_remedial_students(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_result JSON;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat mengakses daftar remedial.');
    END IF;

    -- 2. Query Daftar Santri Menggunakan Schema Aktual students.class
    SELECT json_agg(row_to_json(t)) INTO v_result
    FROM (
        SELECT 
            s.id AS "remedialSessionId",
            s.original_exam_period_id AS "examPeriodId",
            ep.name AS "periodName",
            ep.exam_type AS "periodExamType",
            s.exam_type AS "examType",
            ep.kkm AS "kkm",
            st.id AS "studentId",
            st.name AS "studentName",
            st.nis AS "nis",
            st.class AS "className",
            st.class AS "class",
            s.examiner_user_id AS "examinerId",
            eu.name AS "examinerName",
            s.status AS "sessionStatus",
            s.remedial_question_set_id AS "remedialQuestionSetId",
            rqs.status AS "questionSetStatus",
            rqs.material_fingerprint AS "materialFingerprint",
            orig_att.id AS "originalAttemptId",
            orig_att.total_score AS "originalScore",
            ra.id AS "remedialAttemptId",
            ra.status AS "remedialAttemptStatus",
            ra.total_score AS "remedialScore",
            ra.started_at AS "remedialStartedAt",
            ra.submitted_at AS "remedialSubmittedAt",
            -- Effective score: jika remedial submitted, gunakan remedial; else original
            CASE WHEN ra.status = 'submitted' THEN ra.total_score ELSE orig_att.total_score END AS "effectiveScore",
            -- Status Derivation Authoritative
            CASE 
                WHEN ra.status = 'submitted' AND ra.total_score >= ep.kkm THEN 'TUNTAS_MELALUI_REMEDIAL'
                WHEN ra.status = 'submitted' AND ra.total_score < ep.kkm THEN 'BELUM_TUNTAS_SETELAH_REMEDIAL'
                WHEN ra.status IN ('in_progress', 'reopened') THEN 'SEDANG_REMEDIAL'
                WHEN rqs.status = 'locked' THEN 'REMEDIAL_DIJADWALKAN'
                ELSE 'PERLU_REMEDIAL'
            END AS "derivedStatus",
            (SELECT COUNT(*) FROM exam_remedial_questions eq WHERE eq.remedial_question_set_id = s.remedial_question_set_id) AS "questionCount",
            (SELECT COUNT(*) FROM exam_remedial_question_assessments eqa WHERE eqa.remedial_attempt_id = ra.id AND eqa.completed_at IS NOT NULL) AS "completedQuestionCount"
        FROM exam_remedial_sessions s
        JOIN students st ON st.id = s.student_id
        JOIN exam_periods ep ON ep.id = s.original_exam_period_id
        JOIN exam_attempts orig_att ON orig_att.id = s.original_attempt_id
        JOIN exam_remedial_question_sets rqs ON rqs.id = s.remedial_question_set_id
        LEFT JOIN users eu ON eu.id = s.examiner_user_id
        LEFT JOIN exam_remedial_attempts ra ON ra.remedial_session_id = s.id
        WHERE rqs.status = 'locked'
          AND (v_user.role = 'admin' OR s.examiner_user_id = v_user.id)
        ORDER BY st.name ASC
    ) t;

    RETURN json_build_object(
        'success', true,
        'students', COALESCE(v_result, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION get_examiner_remedial_students(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_examiner_remedial_students(TEXT, TEXT) TO anon, authenticated, service_role;


-- ------------------------------------------------------------
-- RPC 3: start_remedial_attempt (HOTFIX ADDITIVE)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS start_remedial_attempt(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION start_remedial_attempt(
    p_username TEXT,
    p_password TEXT,
    p_remedial_session_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_session RECORD;
    v_period RECORD;
    v_snapshot RECORD;
    v_question_set RECORD;
    v_calc_fingerprint TEXT;
    v_existing_attempt RECORD;
    v_attempt_id TEXT;
    v_expected_qcount INTEGER;
    v_actual_qcount INTEGER;
    v_q RECORD;
    v_questions JSON;
    v_assessments JSON;
    v_audit_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat memulai ujian remedial.');
    END IF;

    -- 2. Validasi Sesi Remedial
    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = p_remedial_session_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi remedial tidak ditemukan.');
    END IF;

    IF v_session.status IN ('stale', 'invalid') THEN
        RETURN json_build_object('success', false, 'message', 'Sesi remedial tidak valid atau berstatus stale.');
    END IF;

    -- 3. Validasi Penugasan Penguji Resmi
    IF v_session.examiner_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Penguji belum ditugaskan untuk sesi remedial ini.');
    END IF;

    IF v_user.role = 'teacher' AND v_session.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi remedial ini.');
    END IF;

    -- 4. Validasi Periode & Snapshot
    SELECT * INTO v_period FROM exam_periods WHERE id = v_session.original_exam_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian asli tidak ditemukan.');
    END IF;

    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE id = v_session.material_snapshot_id;
    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi santri belum difinalisasi.');
    END IF;

    -- 5. Validasi Paket Soal: Wajib LOCKED & Material Fingerprint Masih Valid
    SELECT * INTO v_question_set FROM exam_remedial_question_sets WHERE id = v_session.remedial_question_set_id;
    IF NOT FOUND OR v_question_set.status != 'locked' THEN
        RETURN json_build_object('success', false, 'message', 'Paket soal remedial belum terkunci (locked).');
    END IF;

    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        COALESCE(v_snapshot.memorization_direction, 'forward')
    );

    IF v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_remedial_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        UPDATE exam_remedial_sessions SET status = 'stale', updated_at = now() WHERE id = v_session.id;
        RETURN json_build_object('success', false, 'message', 'Paket soal berstatus STALE karena materi santri telah berubah.');
    END IF;

    -- 6. Validasi Jumlah & Struktur Butir Soal
    v_expected_qcount := CASE WHEN v_session.exam_type = 'uts' THEN 5 ELSE 9 END;
    SELECT COUNT(*) INTO v_actual_qcount FROM exam_remedial_questions WHERE remedial_question_set_id = v_question_set.id;

    IF v_actual_qcount != v_expected_qcount THEN
        RETURN json_build_object('success', false, 'message', 'Integritas paket soal gagal: Jumlah soal tidak sesuai spesifikasi (' || v_actual_qcount || ' dari ' || v_expected_qcount || ').');
    END IF;

    -- Khusus UAS: periksa struktur 2 mandatory dan 7 random
    IF v_session.exam_type = 'uas' THEN
        DECLARE
            v_mand_count INTEGER;
            v_rand_count INTEGER;
        BEGIN
            SELECT COUNT(*) INTO v_mand_count FROM exam_remedial_questions 
            WHERE remedial_question_set_id = v_question_set.id AND question_role = 'mandatory' AND max_score = 15.00;
            SELECT COUNT(*) INTO v_rand_count FROM exam_remedial_questions 
            WHERE remedial_question_set_id = v_question_set.id AND question_role = 'random' AND max_score = 10.00;

            IF v_mand_count != 2 OR v_rand_count != 7 THEN
                RETURN json_build_object('success', false, 'message', 'Integritas struktur UAS gagal: Wajib tepat 2 soal wajib (15 poin) dan 7 soal acak (10 poin).');
            END IF;
        END;
    END IF;

    -- 7. IDEMPOTENCY CHECK: Cek apakah sudah ada attempt
    SELECT * INTO v_existing_attempt FROM exam_remedial_attempts WHERE remedial_session_id = p_remedial_session_id;

    IF FOUND THEN
        IF v_existing_attempt.status = 'submitted' THEN
            RETURN json_build_object('success', false, 'message', 'Ujian remedial santri ini sudah selesai dan telah disubmit.');
        END IF;

        v_attempt_id := v_existing_attempt.id;
    ELSE
        -- Buat attempt baru: BINDING EXAMINER_USER_ID WAJIB DARI v_session.examiner_user_id (Official Assignment)
        v_attempt_id := 'rem_att_' || v_session.id;

        INSERT INTO exam_remedial_attempts (
            id, remedial_session_id, remedial_question_set_id, examiner_user_id,
            attempt_number, status, started_at, last_saved_at, total_score, version, created_at, updated_at
        ) VALUES (
            v_attempt_id, v_session.id, v_question_set.id, v_session.examiner_user_id,
            1, 'in_progress', now(), now(), 100.00, 1, now(), now()
        );

        -- Inisialisasi butir penilaian (assessments) untuk setiap nomor soal
        FOR v_q IN 
            SELECT * FROM exam_remedial_questions 
            WHERE remedial_question_set_id = v_question_set.id 
            ORDER BY question_number ASC
        LOOP
            INSERT INTO exam_remedial_question_assessments (
                id, remedial_attempt_id, remedial_question_id, question_number,
                fluency_score, tajwid_score, makhraj_score, question_score,
                fluency_events, tajwid_events, makhraj_events, version,
                started_at, created_at, updated_at
            ) VALUES (
                'rem_eqa_' || v_attempt_id || '_q' || v_q.question_number,
                v_attempt_id,
                v_q.id,
                v_q.question_number,
                -- Inisialisasi skor default penuh sesuai role
                CASE WHEN v_session.exam_type = 'uts' THEN 12.00 
                     WHEN v_q.question_role = 'mandatory' THEN 9.00 
                     ELSE 6.00 END,
                CASE WHEN v_session.exam_type = 'uts' THEN 4.00 
                     WHEN v_q.question_role = 'mandatory' THEN 3.00 
                     ELSE 2.00 END,
                CASE WHEN v_session.exam_type = 'uts' THEN 4.00 
                     WHEN v_q.question_role = 'mandatory' THEN 3.00 
                     ELSE 2.00 END,
                v_q.max_score,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 1,
                now(), now(), now()
            );
        END LOOP;

        -- Audit Log Mulai Remedial
        v_audit_id := 'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            before_data, after_data, reason, created_at
        ) VALUES (
            v_audit_id,
            v_session.original_exam_period_id,
            v_session.student_id,
            'remedial_attempt_started',
            v_user.id,
            jsonb_build_object('remedialSessionId', p_remedial_session_id, 'status', 'scheduled'),
            jsonb_build_object('attemptId', v_attempt_id, 'officialExaminerId', v_session.examiner_user_id, 'status', 'in_progress'),
            'Memulai sesi ujian remedial',
            now()
        );
    END IF;

    -- 8. Query Data Pertanyaan (Tanpa Ayat Al-Qur'an Text)
    SELECT json_agg(row_to_json(q_row)) INTO v_questions
    FROM (
        SELECT 
            id,
            question_number AS "questionNumber",
            zone_number AS "zoneNumber",
            question_role AS "questionRole",
            source_type AS "sourceType",
            page_number AS "pageNumber",
            max_score AS "maxScore",
            prompt_start_surah AS "promptStartSurah",
            prompt_start_ayah AS "promptStartAyah",
            prompt_start_word AS "promptStartWord",
            prompt_end_surah AS "promptEndSurah",
            prompt_end_ayah AS "promptEndAyah",
            prompt_end_word AS "promptEndWord",
            answer_start_surah AS "answerStartSurah",
            answer_start_ayah AS "answerStartAyah",
            answer_start_word AS "answerStartWord",
            answer_end_surah AS "answerEndSurah",
            answer_end_ayah AS "answerEndAyah",
            answer_end_word AS "answerEndWord",
            start_page AS "startPage",
            end_page AS "endPage",
            generated_metadata AS "metadata"
        FROM exam_remedial_questions
        WHERE remedial_question_set_id = v_question_set.id
        ORDER BY question_number ASC
    ) q_row;

    -- 9. Query Data Assessments Eksisting (Autosave / Resume dengan isCompleted)
    SELECT json_agg(row_to_json(a_row)) INTO v_assessments
    FROM (
        SELECT 
            id,
            question_number AS "questionNumber",
            remedial_question_id AS "questionId",
            fluency_score AS "fluencyScore",
            tajwid_score AS "tajwidScore",
            makhraj_score AS "makhrajScore",
            question_score AS "questionScore",
            fluency_events AS "fluencyEvents",
            tajwid_events AS "tajwidEvents",
            makhraj_events AS "makhrajEvents",
            notes,
            version,
            started_at AS "startedAt",
            completed_at AS "completedAt",
            (completed_at IS NOT NULL) AS "isCompleted"
        FROM exam_remedial_question_assessments
        WHERE remedial_attempt_id = v_attempt_id
        ORDER BY question_number ASC
    ) a_row;

    RETURN json_build_object(
        'success', true,
        'message', 'Sesi ujian remedial siap dilaksanakan.',
        'isExisting', (v_existing_attempt.id IS NOT NULL),
        'attempt', json_build_object(
            'id', v_attempt_id,
            'remedialSessionId', v_session.id,
            'remedialQuestionSetId', v_question_set.id,
            'examinerUserId', v_session.examiner_user_id,
            'attemptNumber', 1,
            'status', 'in_progress',
            'examType', v_session.exam_type,
            'kkm', v_period.kkm
        ),
        'questions', COALESCE(v_questions, '[]'::json),
        'assessments', COALESCE(v_assessments, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION start_remedial_attempt(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_remedial_attempt(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;


-- ------------------------------------------------------------
-- RPC 4: save_remedial_question_assessment (HOTFIX ADDITIVE)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS save_remedial_question_assessment(TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION save_remedial_question_assessment(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT,
    p_question_number INTEGER,
    p_assessment_data JSONB,
    p_expected_version INTEGER DEFAULT NULL,
    p_mark_completed BOOLEAN DEFAULT false
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
    v_session RECORD;
    v_question_set RECORD;
    v_snapshot RECORD;
    v_question RECORD;
    v_calc_fingerprint TEXT;
    v_existing_assessment RECORD;
    v_f_events JSONB;
    v_t_events JSONB;
    v_m_events JSONB;
    v_max_fluency NUMERIC(5,2);
    v_max_tajwid NUMERIC(5,2);
    v_max_makhraj NUMERIC(5,2);
    v_max_score NUMERIC(5,2);
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
    v_f_deduction NUMERIC(5,2) := 0;
    v_t_deduction NUMERIC(5,2) := 0;
    v_m_deduction NUMERIC(5,2) := 0;
    v_event JSONB;
    v_ev_type TEXT;
    v_new_version INTEGER;
    v_new_completed_at TIMESTAMP WITH TIME ZONE;
    v_updated_rows INTEGER;
    v_audit_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat menilai ujian.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_remedial_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian remedial tidak ditemukan.');
    END IF;

    IF v_attempt.status = 'submitted' THEN
        RETURN json_build_object('success', false, 'message', 'Ujian telah dikirim dan bersifat read-only.');
    END IF;

    -- Otorisasi penguji: Wajib assigned examiner atau Admin
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi ini.');
    END IF;

    -- 3. Stale Check
    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = v_attempt.remedial_session_id;
    SELECT * INTO v_question_set FROM exam_remedial_question_sets WHERE id = v_attempt.remedial_question_set_id;
    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE id = v_session.material_snapshot_id;
    
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        COALESCE(v_snapshot.memorization_direction, 'forward')
    );

    IF v_question_set.status != 'locked' OR v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_remedial_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        UPDATE exam_remedial_sessions SET status = 'stale', updated_at = now() WHERE id = v_session.id;
        RETURN json_build_object('success', false, 'isStale', true, 'message', 'Ujian diblokir: Paket soal remedial berstatus STALE karena materi berubah.');
    END IF;

    -- 4. Ambil Assessment Eksisting
    SELECT * INTO v_existing_assessment FROM exam_remedial_question_assessments 
    WHERE remedial_attempt_id = p_attempt_id AND question_number = p_question_number;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Data nomor butir soal tidak ditemukan pada sesi remedial.');
    END IF;

    -- Optimistic Concurrency Check
    IF p_expected_version IS NOT NULL AND v_existing_assessment.version != p_expected_version THEN
        RETURN json_build_object(
            'success', false, 
            'isConflict', true, 
            'message', 'Data ujian berubah di perangkat lain. Muat ulang data terbaru.',
            'currentVersion', v_existing_assessment.version
        );
    END IF;

    -- 5. Validasi Metadata Butir Soal (Authoritative Rubric Setup)
    SELECT * INTO v_question FROM exam_remedial_questions WHERE id = v_existing_assessment.remedial_question_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Metadata butir soal tidak ditemukan pada database.');
    END IF;

    IF v_session.exam_type = 'uts' THEN
        v_max_fluency := 12.00;
        v_max_tajwid := 4.00;
        v_max_makhraj := 4.00;
        v_max_score := 20.00;
    ELSE -- UAS
        IF v_question.question_role = 'mandatory' THEN
            v_max_fluency := 9.00;
            v_max_tajwid := 3.00;
            v_max_makhraj := 3.00;
            v_max_score := 15.00;
        ELSIF v_question.question_role = 'random' THEN
            v_max_fluency := 6.00;
            v_max_tajwid := 2.00;
            v_max_makhraj := 2.00;
            v_max_score := 10.00;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Role butir soal tidak dikenal: ' || v_question.question_role);
        END IF;
    END IF;

    -- 6. Server-Authoritative Deduction Calculation
    v_f_events := COALESCE(p_assessment_data->'fluencyEvents', '[]'::jsonb);
    v_t_events := COALESCE(p_assessment_data->'tajwidEvents', '[]'::jsonb);
    v_m_events := COALESCE(p_assessment_data->'makhrajEvents', '[]'::jsonb);

    -- Kelancaran
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_f_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'self_correction' THEN
            v_f_deduction := v_f_deduction + 0.5;
        ELSIF v_ev_type = 'reminder' THEN
            v_f_deduction := v_f_deduction + 1.0;
        ELSIF v_ev_type = 'prompt' THEN
            v_f_deduction := v_f_deduction + 2.0;
        ELSIF v_ev_type = 'unable' THEN
            v_f_deduction := v_f_deduction + 4.0;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event kelancaran tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_f_score := GREATEST(0.00, v_max_fluency - v_f_deduction);

    -- Tajwid
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_t_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'minor' THEN
            v_t_deduction := v_t_deduction + 0.5;
        ELSIF v_ev_type = 'major' THEN
            v_t_deduction := v_t_deduction + 1.0;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event tajwid tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_t_score := GREATEST(0.00, v_max_tajwid - v_t_deduction);

    -- Makhraj
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_m_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'minor' THEN
            v_m_deduction := v_m_deduction + 0.5;
        ELSIF v_ev_type = 'major' THEN
            v_m_deduction := v_m_deduction + 1.0;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event makhraj tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_m_score := GREATEST(0.00, v_max_makhraj - v_m_deduction);

    -- Server Authoritative Total Score
    v_q_score := LEAST(v_max_score, GREATEST(0.00, v_f_score + v_t_score + v_m_score));
    v_new_version := v_existing_assessment.version + 1;

    -- Tentukan completed_at
    IF p_mark_completed = true OR (p_assessment_data->>'isCompleted')::BOOLEAN = true THEN
        v_new_completed_at := COALESCE(v_existing_assessment.completed_at, now());
    ELSE
        v_new_completed_at := v_existing_assessment.completed_at;
    END IF;

    -- Atomic Update dengan version guard
    UPDATE exam_remedial_question_assessments SET
        fluency_score = v_f_score,
        tajwid_score = v_t_score,
        makhraj_score = v_m_score,
        question_score = v_q_score,
        fluency_events = v_f_events,
        tajwid_events = v_t_events,
        makhraj_events = v_m_events,
        notes = p_assessment_data->>'notes',
        completed_at = v_new_completed_at,
        version = v_new_version,
        updated_at = now()
    WHERE id = v_existing_assessment.id
      AND (p_expected_version IS NULL OR version = p_expected_version);

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows = 0 THEN
        RETURN json_build_object(
            'success', false, 
            'isConflict', true, 
            'message', 'Data ujian berubah di perangkat lain. Muat ulang data terbaru.'
        );
    END IF;

    -- Update timestamp attempt
    UPDATE exam_remedial_attempts SET last_saved_at = now(), updated_at = now() WHERE id = p_attempt_id;

    -- Audit log jika baru saja ditandai completed
    IF (p_mark_completed = true OR (p_assessment_data->>'isCompleted')::BOOLEAN = true) AND v_existing_assessment.completed_at IS NULL THEN
        v_audit_id := 'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            before_data, after_data, reason, created_at
        ) VALUES (
            v_audit_id,
            v_session.original_exam_period_id,
            v_session.student_id,
            'remedial_question_scored',
            v_user.id,
            jsonb_build_object('attemptId', p_attempt_id, 'questionNumber', p_question_number, 'isCompleted', false),
            jsonb_build_object('attemptId', p_attempt_id, 'questionNumber', p_question_number, 'score', v_q_score, 'version', v_new_version, 'isCompleted', true),
            'Penilaian butir soal remedial ' || p_question_number || ' diselesaikan',
            now()
        );
    END IF;

    RETURN json_build_object(
        'success', true,
        'message', 'Penilaian soal nomor ' || p_question_number || ' berhasil disimpan.',
        'assessment', json_build_object(
            'questionNumber', p_question_number,
            'fluencyScore', v_f_score,
            'tajwidScore', v_t_score,
            'makhrajScore', v_m_score,
            'questionScore', v_q_score,
            'version', v_new_version,
            'completedAt', v_new_completed_at,
            'isCompleted', (v_new_completed_at IS NOT NULL)
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION save_remedial_question_assessment(TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_remedial_question_assessment(TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, BOOLEAN) TO anon, authenticated, service_role;


-- ------------------------------------------------------------
-- RPC 5: get_remedial_attempt_detail (HOTFIX ADDITIVE)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_remedial_attempt_detail(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_remedial_attempt_detail(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
    v_session RECORD;
    v_period RECORD;
    v_student RECORD;
    v_questions JSON;
    v_assessments JSON;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat melihat detail ujian.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_remedial_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian remedial tidak ditemukan.');
    END IF;

    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi ini.');
    END IF;

    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = v_attempt.remedial_session_id;
    SELECT * INTO v_period FROM exam_periods WHERE id = v_session.original_exam_period_id;
    SELECT * INTO v_student FROM students WHERE id = v_session.student_id;

    -- 3. Query Pertanyaan (Tanpa Teks Al-Qur'an)
    SELECT json_agg(row_to_json(q_row)) INTO v_questions
    FROM (
        SELECT 
            id,
            question_number AS "questionNumber",
            zone_number AS "zoneNumber",
            question_role AS "questionRole",
            source_type AS "sourceType",
            page_number AS "pageNumber",
            max_score AS "maxScore",
            prompt_start_surah AS "promptStartSurah",
            prompt_start_ayah AS "promptStartAyah",
            prompt_start_word AS "promptStartWord",
            prompt_end_surah AS "promptEndSurah",
            prompt_end_ayah AS "promptEndAyah",
            prompt_end_word AS "promptEndWord",
            answer_start_surah AS "answerStartSurah",
            answer_start_ayah AS "answerStartAyah",
            answer_start_word AS "answerStartWord",
            answer_end_surah AS "answerEndSurah",
            answer_end_ayah AS "answerEndAyah",
            answer_end_word AS "answerEndWord",
            start_page AS "startPage",
            end_page AS "endPage",
            generated_metadata AS "metadata"
        FROM exam_remedial_questions
        WHERE remedial_question_set_id = v_attempt.remedial_question_set_id
        ORDER BY question_number ASC
    ) q_row;

    -- 4. Query Penilaian Eksisting (dengan isCompleted)
    SELECT json_agg(row_to_json(a_row)) INTO v_assessments
    FROM (
        SELECT 
            id,
            question_number AS "questionNumber",
            remedial_question_id AS "questionId",
            fluency_score AS "fluencyScore",
            tajwid_score AS "tajwidScore",
            makhraj_score AS "makhrajScore",
            question_score AS "questionScore",
            fluency_events AS "fluencyEvents",
            tajwid_events AS "tajwidEvents",
            makhraj_events AS "makhrajEvents",
            notes,
            version,
            started_at AS "startedAt",
            completed_at AS "completedAt",
            (completed_at IS NOT NULL) AS "isCompleted"
        FROM exam_remedial_question_assessments
        WHERE remedial_attempt_id = v_attempt.id
        ORDER BY question_number ASC
    ) a_row;

    RETURN json_build_object(
        'success', true,
        'attempt', json_build_object(
            'id', v_attempt.id,
            'remedialSessionId', v_session.id,
            'remedialQuestionSetId', v_attempt.remedial_question_set_id,
            'examinerUserId', v_attempt.examiner_user_id,
            'status', v_attempt.status,
            'startedAt', v_attempt.started_at,
            'lastSavedAt', v_attempt.last_saved_at,
            'submittedAt', v_attempt.submitted_at,
            'totalScore', v_attempt.total_score,
            'version', v_attempt.version,
            'examType', v_session.exam_type,
            'kkm', v_period.kkm,
            'student', json_build_object(
                'id', v_student.id,
                'name', v_student.name,
                'nis', v_student.nis,
                'class', v_student.class,
                'className', v_student.class
            )
        ),
        'questions', COALESCE(v_questions, '[]'::json),
        'assessments', COALESCE(v_assessments, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION get_remedial_attempt_detail(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_remedial_attempt_detail(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
