-- ============================================================
-- SITA - SISTEM INFORMASI TAHFIDZ AL-QUR'AN
-- DARUL ABROR ISLAMIC BOARDING SCHOOL
-- HOTFIX #2 TAHAP 7C: REMEDIAL EXECUTION LIFECYCLE BOUNDARY FIX
-- File: supabase_remedial_execution_hotfix_7c_02.sql
--
-- TARGET REVISION:
-- 1. submit_remedial_attempt:
--    - Hapus mutasi ilegal: UPDATE exam_remedial_sessions SET status = 'submitted'
--    - Sesi remedial Tahap 7B (exam_remedial_sessions) tetap berstatus 'locked'
--    - Memperbarui exam_remedial_attempts: status = 'submitted', total_score, submitted_at, version = version + 1
--    - Menghilangkan PostgreSQL 23514 (exam_remedial_sessions_status_check)
-- 2. reopen_remedial_attempt:
--    - Hapus mutasi ilegal: UPDATE exam_remedial_sessions SET status = 'reopened'
--    - Sesi remedial Tahap 7B (exam_remedial_sessions) tetap berstatus 'locked'
--    - Memperbarui exam_remedial_attempts: status = 'reopened', reopened_at, reopened_by, reopen_reason, version = version + 1
--    - Menghilangkan potensi PostgreSQL 23514 pada saat reopen
-- ============================================================

-- ------------------------------------------------------------
-- RPC 6: submit_remedial_attempt (HOTFIX #2)
-- Finalisasi Ujian Remedial Santri (Authoritative Server-Side Recalculation)
-- Memastikan Status Session Tetap 'locked' dan Original UTS/UAS Imutabel
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS submit_remedial_attempt(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION submit_remedial_attempt(
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
    v_question_set RECORD;
    v_snapshot RECORD;
    v_calc_fingerprint TEXT;
    v_expected_qcount INTEGER;
    v_count_total INTEGER;
    v_count_completed INTEGER;
    v_valid_q_count INTEGER;
    v_asm RECORD;
    v_max_score NUMERIC(5,2);
    v_max_fluency NUMERIC(5,2);
    v_max_tajwid NUMERIC(5,2);
    v_max_makhraj NUMERIC(5,2);
    v_f_deduction NUMERIC(5,2);
    v_t_deduction NUMERIC(5,2);
    v_m_deduction NUMERIC(5,2);
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
    v_event JSONB;
    v_ev_type TEXT;
    v_total_calculated NUMERIC(5,2) := 0.00;
    v_is_passed BOOLEAN;
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
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat mengirim ujian.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_remedial_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian remedial tidak ditemukan.');
    END IF;

    -- Otorisasi penguji resmi
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi ini.');
    END IF;

    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = v_attempt.remedial_session_id;
    SELECT * INTO v_period FROM exam_periods WHERE id = v_session.original_exam_period_id;

    -- Idempotency check: jika sudah submitted, kembalikan hasil yang tersimpan tanpa duplikasi audit
    IF v_attempt.status = 'submitted' THEN
        RETURN json_build_object(
            'success', true,
            'isExisting', true,
            'message', 'Ujian remedial sudah dikirim dan difinalisasi sebelumnya.',
            'totalScore', v_attempt.total_score,
            'submittedAt', v_attempt.submitted_at,
            'kkm', v_period.kkm,
            'isPassed', (v_attempt.total_score >= v_period.kkm),
            'effectiveScore', v_attempt.total_score
        );
    END IF;

    -- 3. Stale Check
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

    -- 4. Validasi Kelengkapan Soal (UTS: 5 soal, UAS: 9 soal, seluruhnya COMPLETED)
    v_expected_qcount := CASE WHEN v_session.exam_type = 'uts' THEN 5 ELSE 9 END;

    SELECT COUNT(*), COUNT(*) FILTER (WHERE completed_at IS NOT NULL)
    INTO v_count_total, v_count_completed
    FROM exam_remedial_question_assessments
    WHERE remedial_attempt_id = p_attempt_id;

    IF v_count_total != v_expected_qcount OR v_count_completed != v_expected_qcount THEN
        RETURN json_build_object(
            'success', false, 
            'message', 'Validasi gagal: Seluruh ' || v_expected_qcount || ' butir soal wajib diselesaikan (completed) sebelum submit final. Saat ini ' || v_count_completed || ' dari ' || v_expected_qcount || ' soal selesai.'
        );
    END IF;

    -- Validasi soal berasal dari question set resmi
    SELECT COUNT(*) INTO v_valid_q_count
    FROM exam_remedial_question_assessments eqa
    JOIN exam_remedial_questions eq ON eq.id = eqa.remedial_question_id
    WHERE eqa.remedial_attempt_id = p_attempt_id
      AND eq.remedial_question_set_id = v_attempt.remedial_question_set_id;

    IF v_valid_q_count != v_expected_qcount THEN
        RETURN json_build_object('success', false, 'message', 'Validasi integritas gagal: Butir soal tidak sesuai dengan paket soal resmi remedial.');
    END IF;

    -- 5. Authoritative Server-Side Recalculation
    v_total_calculated := 0;

    FOR v_asm IN 
        SELECT a.*, q.question_role, q.max_score AS question_max_score
        FROM exam_remedial_question_assessments a
        JOIN exam_remedial_questions q ON q.id = a.remedial_question_id
        WHERE a.remedial_attempt_id = p_attempt_id 
        ORDER BY a.question_number ASC
    LOOP
        v_f_deduction := 0;
        v_t_deduction := 0;
        v_m_deduction := 0;

        IF v_session.exam_type = 'uts' THEN
            v_max_fluency := 12.00;
            v_max_tajwid := 4.00;
            v_max_makhraj := 4.00;
            v_max_score := 20.00;
        ELSE -- UAS
            IF v_asm.question_role = 'mandatory' THEN
                v_max_fluency := 9.00;
                v_max_tajwid := 3.00;
                v_max_makhraj := 3.00;
                v_max_score := 15.00;
            ELSIF v_asm.question_role = 'random' THEN
                v_max_fluency := 6.00;
                v_max_tajwid := 2.00;
                v_max_makhraj := 2.00;
                v_max_score := 10.00;
            END IF;
        END IF;

        -- 1. Fluency events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.fluency_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'self_correction' THEN v_f_deduction := v_f_deduction + 0.5;
            ELSIF v_ev_type = 'reminder' THEN v_f_deduction := v_f_deduction + 1.0;
            ELSIF v_ev_type = 'prompt' THEN v_f_deduction := v_f_deduction + 2.0;
            ELSIF v_ev_type = 'unable' THEN v_f_deduction := v_f_deduction + 4.0;
            END IF;
        END LOOP;
        v_f_score := GREATEST(0.00, v_max_fluency - v_f_deduction);

        -- 2. Tajwid events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.tajwid_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'minor' THEN v_t_deduction := v_t_deduction + 0.5;
            ELSIF v_ev_type = 'major' THEN v_t_deduction := v_t_deduction + 1.0;
            END IF;
        END LOOP;
        v_t_score := GREATEST(0.00, v_max_tajwid - v_t_deduction);

        -- 3. Makhraj events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.makhraj_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'minor' THEN v_m_deduction := v_m_deduction + 0.5;
            ELSIF v_ev_type = 'major' THEN v_m_deduction := v_m_deduction + 1.0;
            END IF;
        END LOOP;
        v_m_score := GREATEST(0.00, v_max_makhraj - v_m_deduction);

        v_q_score := LEAST(v_max_score, GREATEST(0.00, v_f_score + v_t_score + v_m_score));

        -- Simpan hasil authoritative per soal
        UPDATE exam_remedial_question_assessments SET
            fluency_score = v_f_score,
            tajwid_score = v_t_score,
            makhraj_score = v_m_score,
            question_score = v_q_score,
            updated_at = now()
        WHERE id = v_asm.id;

        v_total_calculated := v_total_calculated + v_q_score;
    END LOOP;

    v_total_calculated := ROUND(v_total_calculated, 2);

    IF v_total_calculated > 100.00 THEN
        RETURN json_build_object('success', false, 'message', 'Integritas nilai gagal: Total nilai melebihi 100.');
    END IF;

    v_is_passed := (v_total_calculated >= v_period.kkm);

    -- 6. Finalisasi Status Attempt Remedial (ORIGINAL ATTEMPT TETAP IMMUTABLE!)
    UPDATE exam_remedial_attempts SET
        status = 'submitted',
        total_score = v_total_calculated,
        submitted_at = now(),
        version = version + 1,
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Update assignment status
    UPDATE exam_remedial_examiner_assignments SET
        status = 'completed',
        updated_at = now()
    WHERE remedial_session_id = v_session.id;

    -- CATATAN ARSITEKTURAL: exam_remedial_sessions.status TETAP 'locked'.
    -- Pemisahan lifecycle: status 'submitted' hanya dimiliki oleh exam_remedial_attempts.

    -- 7. Audit Log Kanonikal
    v_audit_id := 'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        v_audit_id,
        v_session.original_exam_period_id,
        v_session.student_id,
        'remedial_exam_submitted',
        v_user.id,
        jsonb_build_object('attemptId', p_attempt_id, 'status', 'in_progress'),
        jsonb_build_object('attemptId', p_attempt_id, 'status', 'submitted', 'totalScore', v_total_calculated, 'kkm', v_period.kkm, 'isPassed', v_is_passed),
        'Finalisasi dan pengiriman nilai remedial',
        now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Ujian remedial berhasil difinalisasi dan dikirim.',
        'totalScore', v_total_calculated,
        'submittedAt', now(),
        'kkm', v_period.kkm,
        'isPassed', v_is_passed,
        'effectiveScore', v_total_calculated
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION submit_remedial_attempt(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_remedial_attempt(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;


-- ------------------------------------------------------------
-- RPC 7: reopen_remedial_attempt (HOTFIX #2)
-- Admin Only: Membuka Kembali Remedial yang Sudah Disubmit
-- Mempertahankan Question Set, Question IDs, dan Riwayat Nilai
-- Status Session Tetap 'locked', Hanya Status Attempt Menjadi 'reopened'
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS reopen_remedial_attempt(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION reopen_remedial_attempt(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT,
    p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
    v_session RECORD;
    v_audit_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    -- 2. Otorisasi Admin Saja
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuka kembali (reopen) ujian remedial.');
    END IF;

    -- 3. Validasi Alasan Wajib
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan pembukaan kembali ujian remedial.');
    END IF;

    SELECT * INTO v_attempt FROM exam_remedial_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian remedial tidak ditemukan.');
    END IF;

    IF v_attempt.status != 'submitted' THEN
        RETURN json_build_object('success', false, 'message', 'Hanya sesi ujian remedial yang berstatus submitted yang dapat dibuka kembali.');
    END IF;

    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = v_attempt.remedial_session_id;

    -- 4. Kembalikan Status Attempt ke reopened (Increment version token)
    UPDATE exam_remedial_attempts SET
        status = 'reopened',
        reopened_at = now(),
        reopened_by = v_user.id,
        reopen_reason = p_reason,
        version = version + 1,
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Kembalikan status assignment ke assigned
    UPDATE exam_remedial_examiner_assignments SET
        status = 'assigned',
        updated_at = now()
    WHERE remedial_session_id = v_session.id;

    -- CATATAN ARSITEKTURAL: exam_remedial_sessions.status TETAP 'locked'.
    -- Pemisahan lifecycle: status 'reopened' hanya dimiliki oleh exam_remedial_attempts.

    -- 5. Audit Log Kanonikal
    v_audit_id := 'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        v_audit_id,
        v_session.original_exam_period_id,
        v_session.student_id,
        'remedial_exam_reopened',
        v_user.id,
        jsonb_build_object('attemptId', p_attempt_id, 'oldStatus', 'submitted', 'score', v_attempt.total_score),
        jsonb_build_object('attemptId', p_attempt_id, 'newStatus', 'reopened'),
        p_reason,
        now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Ujian remedial berhasil dibuka kembali untuk koreksi nilai oleh penguji resmi.',
        'attemptId', p_attempt_id,
        'status', 'reopened'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION reopen_remedial_attempt(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reopen_remedial_attempt(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
