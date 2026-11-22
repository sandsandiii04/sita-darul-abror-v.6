-- ============================================================================
-- SITA DARUL ABROR — HOTFIX PENYELARASAN SKEMA PRODUKSI JALUR UJIAN UAS
-- Memperbaiki ketidaksesuaian kolom PL/pgSQL terhadap skema produksi aktual:
--   - public.exam_questions (TIDAK memiliki kolom juz_number, max_fluency,
--     max_tajwid, max_makhraj; bobot rubrik diturunkan dari session_type +
--     question_role + max_score sesuai standar produksi).
--   - public.exam_attempts (mengisi session_type, login_account_id,
--     login_account_username, examiner_verified_at, submitted_by_id/name).
--   - public.exam_audit_logs (action, actor_id, before_data, after_data, reason).
-- Non-destructive & backward-compatible. Tidak mengubah tabel/data historis.
-- ============================================================================

DROP FUNCTION IF EXISTS public.select_uas_mandatory_pages(text, text, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.select_uas_mandatory_pages(text, text, text, text, jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION public.select_uas_mandatory_pages(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text,
    p_q1_payload jsonb,
    p_q2_payload jsonb,
    p_uas_session_id text DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_verified RECORD;
    v_period RECORD;
    v_sess RECORD;
    v_snapshot RECORD;
    v_set RECORD;
    v_p1 INT;
    v_p2 INT;
    v_min_page INT;
    v_max_page INT;
    v_covered_pages INT[];
    v_random_count INT;
    v_attempt_exists BOOLEAN;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role NOT IN ('admin', 'teacher', 'shared_uas_examiner') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    IF v_user.role = 'shared_uas_examiner' THEN
        SELECT * INTO v_verified FROM public.uas_verified_examiner_sessions
        WHERE session_token = p_password AND expires_at > now();
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'requiresExaminerVerification', true, 'message', 'Verifikasi PIN penguji terlebih dahulu.');
        END IF;
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id;
    IF NOT FOUND OR v_period.exam_type != 'uas' THEN
        RETURN json_build_object('success', false, 'message', 'Periode UAS tidak ditemukan.');
    END IF;
    IF v_period.status != 'active' THEN
        RETURN json_build_object('success', false, 'message', 'UAS belum dibuka oleh Admin.');
    END IF;

    v_p1 := COALESCE((p_q1_payload->>'pageNumber')::INT, (p_q1_payload->>'startPage')::INT);
    v_p2 := COALESCE((p_q2_payload->>'pageNumber')::INT, (p_q2_payload->>'startPage')::INT);

    IF v_p1 IS NULL OR v_p2 IS NULL OR v_p1 = v_p2 OR v_p1 NOT BETWEEN 1 AND 604 OR v_p2 NOT BETWEEN 1 AND 604 THEN
        RETURN json_build_object('success', false, 'message', 'Harus memilih 2 halaman berbeda (1–604) untuk soal wajib.');
    END IF;

    -- 1. Primary per-session lookup
    IF p_uas_session_id IS NOT NULL AND length(trim(p_uas_session_id)) > 0 THEN
        SELECT * INTO v_sess
        FROM public.exam_uas_sessions
        WHERE id = p_uas_session_id
          AND exam_period_id = p_period_id
          AND student_id = p_student_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Sesi UAS tidak ditemukan.');
        END IF;
    ELSE
        SELECT * INTO v_sess
        FROM public.exam_uas_sessions
        WHERE exam_period_id = p_period_id
          AND student_id = p_student_id
          AND session_type = 'full_juz'
          AND status = 'pending_mandatory'
        ORDER BY session_number ASC
        LIMIT 1
        FOR UPDATE;
    END IF;

    IF v_sess.id IS NOT NULL THEN
        IF v_sess.status = 'void' THEN
            RETURN json_build_object('success', false, 'message', 'Sesi ujian ini sudah dibatalkan (void).');
        END IF;
        IF v_sess.session_type != 'full_juz' THEN
            RETURN json_build_object('success', false, 'message', 'Sesi parsial tidak memerlukan pemilihan 2 soal wajib.');
        END IF;
        IF v_sess.approval_status != 'admin_approved' THEN
            RETURN json_build_object('success', false, 'message', 'Materi sesi ini belum disetujui Admin.');
        END IF;
        IF v_sess.question_set_id IS NULL THEN
            RETURN json_build_object('success', false, 'message', 'Soal sesi ini belum disiapkan.');
        END IF;

        SELECT * INTO v_set
        FROM public.exam_question_sets
        WHERE id = v_sess.question_set_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Paket soal sesi tidak ditemukan.');
        END IF;

        IF v_set.status = 'locked' THEN
            RETURN json_build_object(
                'success', true,
                'alreadyLocked', true,
                'questionSet', row_to_json(v_set),
                'message', 'Soal wajib sesi ini sudah terkunci sebelumnya.'
            );
        END IF;

        IF v_set.status != 'pending_mandatory' THEN
            RETURN json_build_object('success', false, 'message', 'Paket soal tidak dalam status menunggu pemilihan soal wajib.');
        END IF;

        v_covered_pages := ARRAY[]::INT[];
        IF v_sess.covered_pages IS NOT NULL AND jsonb_typeof(v_sess.covered_pages) = 'array' THEN
            SELECT COALESCE(array_agg((elem)::INT), ARRAY[]::INT[])
            INTO v_covered_pages
            FROM jsonb_array_elements_text(v_sess.covered_pages) AS elem
            WHERE elem ~ '^[0-9]+$';
        END IF;
        v_min_page := COALESCE(v_sess.start_page, 1);
        v_max_page := COALESCE(v_sess.end_page, 604);

        IF array_length(v_covered_pages, 1) IS NOT NULL AND array_length(v_covered_pages, 1) >= 2 THEN
            IF NOT (v_p1 = ANY(v_covered_pages)) OR NOT (v_p2 = ANY(v_covered_pages)) THEN
                RETURN json_build_object(
                    'success', false,
                    'message', 'Halaman soal wajib harus berada dalam rentang halaman materi sesi yang disetujui.'
                );
            END IF;
        ELSE
            IF v_p1 < v_min_page OR v_p1 > v_max_page OR v_p2 < v_min_page OR v_p2 > v_max_page THEN
                RETURN json_build_object(
                    'success', false,
                    'message', 'Halaman soal wajib harus berada dalam rentang halaman ' || v_min_page || ' s.d. ' || v_max_page || '.'
                );
            END IF;
        END IF;

        SELECT COUNT(*) INTO v_random_count
        FROM public.exam_questions
        WHERE question_set_id = v_set.id AND question_number BETWEEN 3 AND 9;

        IF v_random_count != 7 THEN
            RETURN json_build_object('success', false, 'message', 'Paket soal sesi tidak memiliki tepat 7 soal acak (ditemukan ' || v_random_count || ').');
        END IF;

        SELECT EXISTS(SELECT 1 FROM public.exam_attempts WHERE question_set_id = v_set.id) INTO v_attempt_exists;
        IF v_attempt_exists THEN
            RETURN json_build_object('success', false, 'message', 'Paket soal sudah memiliki attempt ujian dan tidak dapat diubah.');
        END IF;

        DELETE FROM public.exam_questions WHERE question_set_id = v_set.id AND question_number IN (1, 2);

        -- Insert ONLY exact production columns of public.exam_questions
        INSERT INTO public.exam_questions (
            id, question_set_id, question_number, zone_number, question_role, source_type, question_bank_id,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            page_number, start_page, end_page, max_score, generated_metadata, created_at
        ) VALUES (
            'eq_uas_' || v_set.id || '_q1', v_set.id, 1, 0, 'mandatory',
            COALESCE(p_q1_payload->>'sourceType', 'manual_mushaf'),
            p_q1_payload->>'questionBankId',
            COALESCE((p_q1_payload->'answerStart'->>'surahNumber')::INT, (p_q1_payload->>'promptStartSurah')::INT, (p_q1_payload->>'startSurah')::INT, v_sess.start_surah, 1),
            COALESCE((p_q1_payload->'answerStart'->>'ayahNumber')::INT, (p_q1_payload->>'promptStartAyah')::INT, (p_q1_payload->>'startAyah')::INT, 1), 1,
            COALESCE((p_q1_payload->'answerEnd'->>'surahNumber')::INT, (p_q1_payload->>'promptEndSurah')::INT, (p_q1_payload->>'endSurah')::INT, v_sess.end_surah, 1),
            COALESCE((p_q1_payload->'answerEnd'->>'ayahNumber')::INT, (p_q1_payload->>'promptEndAyah')::INT, (p_q1_payload->>'endAyah')::INT, 1), 1,
            COALESCE((p_q1_payload->'answerStart'->>'surahNumber')::INT, (p_q1_payload->>'answerStartSurah')::INT, (p_q1_payload->>'startSurah')::INT, v_sess.start_surah, 1),
            COALESCE((p_q1_payload->'answerStart'->>'ayahNumber')::INT, (p_q1_payload->>'answerStartAyah')::INT, (p_q1_payload->>'startAyah')::INT, 1), 1,
            COALESCE((p_q1_payload->'answerEnd'->>'surahNumber')::INT, (p_q1_payload->>'answerEndSurah')::INT, (p_q1_payload->>'endSurah')::INT, v_sess.end_surah, 1),
            COALESCE((p_q1_payload->'answerEnd'->>'ayahNumber')::INT, (p_q1_payload->>'answerEndAyah')::INT, (p_q1_payload->>'endAyah')::INT, 1), 1,
            v_p1, v_p1, v_p1, 15,
            jsonb_build_object('juzNumber', COALESCE((p_q1_payload->>'juzNumber')::INT, v_sess.juz_number, 30), 'manualMandatory', true),
            now()
        ), (
            'eq_uas_' || v_set.id || '_q2', v_set.id, 2, 0, 'mandatory',
            COALESCE(p_q2_payload->>'sourceType', 'manual_mushaf'),
            p_q2_payload->>'questionBankId',
            COALESCE((p_q2_payload->'answerStart'->>'surahNumber')::INT, (p_q2_payload->>'promptStartSurah')::INT, (p_q2_payload->>'startSurah')::INT, v_sess.start_surah, 1),
            COALESCE((p_q2_payload->'answerStart'->>'ayahNumber')::INT, (p_q2_payload->>'promptStartAyah')::INT, (p_q2_payload->>'startAyah')::INT, 1), 1,
            COALESCE((p_q2_payload->'answerEnd'->>'surahNumber')::INT, (p_q2_payload->>'promptEndSurah')::INT, (p_q2_payload->>'endSurah')::INT, v_sess.end_surah, 1),
            COALESCE((p_q2_payload->'answerEnd'->>'ayahNumber')::INT, (p_q2_payload->>'promptEndAyah')::INT, (p_q2_payload->>'endAyah')::INT, 1), 1,
            COALESCE((p_q2_payload->'answerStart'->>'surahNumber')::INT, (p_q2_payload->>'answerStartSurah')::INT, (p_q2_payload->>'startSurah')::INT, v_sess.start_surah, 1),
            COALESCE((p_q2_payload->'answerStart'->>'ayahNumber')::INT, (p_q2_payload->>'answerStartAyah')::INT, (p_q2_payload->>'startAyah')::INT, 1), 1,
            COALESCE((p_q2_payload->'answerEnd'->>'surahNumber')::INT, (p_q2_payload->>'answerEndSurah')::INT, (p_q2_payload->>'endSurah')::INT, v_sess.end_surah, 1),
            COALESCE((p_q2_payload->'answerEnd'->>'ayahNumber')::INT, (p_q2_payload->>'answerEndAyah')::INT, (p_q2_payload->>'endAyah')::INT, 1), 1,
            v_p2, v_p2, v_p2, 15,
            jsonb_build_object('juzNumber', COALESCE((p_q2_payload->>'juzNumber')::INT, v_sess.juz_number, 30), 'manualMandatory', true),
            now()
        );

        UPDATE public.exam_question_sets
        SET status = 'locked',
            total_questions = 9,
            locked_at = now(),
            updated_at = now()
        WHERE id = v_set.id
        RETURNING * INTO v_set;

        UPDATE public.exam_uas_sessions
        SET status = 'ready',
            updated_at = now()
        WHERE id = v_sess.id;

        RETURN json_build_object(
            'success', true,
            'questionSet', row_to_json(v_set),
            'uasSessionId', v_sess.id,
            'message', '2 Soal Wajib (Halaman ' || v_p1 || ' & ' || v_p2 || ') berhasil dikunci. Paket 9 soal UAS siap diuji.'
        );
    END IF;

    -- 2. Legacy fallback (no exam_uas_sessions row)
    SELECT * INTO v_snapshot FROM public.exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'finalized';
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi UAS atau materi santri yang disetujui tidak ditemukan.');
    END IF;

    SELECT * INTO v_set FROM public.exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'pending_mandatory'
    ORDER BY version DESC LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Paket soal tidak dalam status menunggu pemilihan soal wajib.');
    END IF;

    v_min_page := COALESCE(v_snapshot.start_page, 1);
    v_max_page := COALESCE(v_snapshot.end_page, 604);
    IF v_p1 < v_min_page OR v_p1 > v_max_page OR v_p2 < v_min_page OR v_p2 > v_max_page THEN
        RETURN json_build_object('success', false, 'message', 'Halaman soal wajib harus berada dalam rentang materi hafalan santri (' || v_min_page || ' s.d. ' || v_max_page || ').');
    END IF;

    DELETE FROM public.exam_questions WHERE question_set_id = v_set.id AND question_number IN (1, 2);

    INSERT INTO public.exam_questions (
        id, question_set_id, question_number, zone_number, question_role, source_type, question_bank_id,
        prompt_start_surah, prompt_start_ayah, prompt_start_word,
        prompt_end_surah, prompt_end_ayah, prompt_end_word,
        answer_start_surah, answer_start_ayah, answer_start_word,
        answer_end_surah, answer_end_ayah, answer_end_word,
        page_number, start_page, end_page, max_score, generated_metadata, created_at
    ) VALUES (
        'eq_uas_' || v_set.id || '_q1', v_set.id, 1, 0, 'mandatory',
        COALESCE(p_q1_payload->>'sourceType', 'manual_mushaf'),
        p_q1_payload->>'questionBankId',
        COALESCE((p_q1_payload->'answerStart'->>'surahNumber')::INT, (p_q1_payload->>'promptStartSurah')::INT, (p_q1_payload->>'startSurah')::INT, v_snapshot.start_surah),
        COALESCE((p_q1_payload->'answerStart'->>'ayahNumber')::INT, (p_q1_payload->>'promptStartAyah')::INT, (p_q1_payload->>'startAyah')::INT, 1), 1,
        COALESCE((p_q1_payload->'answerEnd'->>'surahNumber')::INT, (p_q1_payload->>'promptEndSurah')::INT, (p_q1_payload->>'endSurah')::INT, v_snapshot.end_surah),
        COALESCE((p_q1_payload->'answerEnd'->>'ayahNumber')::INT, (p_q1_payload->>'promptEndAyah')::INT, (p_q1_payload->>'endAyah')::INT, 1), 1,
        COALESCE((p_q1_payload->'answerStart'->>'surahNumber')::INT, (p_q1_payload->>'answerStartSurah')::INT, (p_q1_payload->>'startSurah')::INT, v_snapshot.start_surah),
        COALESCE((p_q1_payload->'answerStart'->>'ayahNumber')::INT, (p_q1_payload->>'answerStartAyah')::INT, (p_q1_payload->>'startAyah')::INT, 1), 1,
        COALESCE((p_q1_payload->'answerEnd'->>'surahNumber')::INT, (p_q1_payload->>'answerEndSurah')::INT, (p_q1_payload->>'endSurah')::INT, v_snapshot.end_surah),
        COALESCE((p_q1_payload->'answerEnd'->>'ayahNumber')::INT, (p_q1_payload->>'answerEndAyah')::INT, (p_q1_payload->>'endAyah')::INT, 1), 1,
        v_p1, v_p1, v_p1, 15,
        jsonb_build_object('juzNumber', COALESCE((p_q1_payload->>'juzNumber')::INT, 30), 'manualMandatory', true),
        now()
    ), (
        'eq_uas_' || v_set.id || '_q2', v_set.id, 2, 0, 'mandatory',
        COALESCE(p_q2_payload->>'sourceType', 'manual_mushaf'),
        p_q2_payload->>'questionBankId',
        COALESCE((p_q2_payload->'answerStart'->>'surahNumber')::INT, (p_q2_payload->>'promptStartSurah')::INT, (p_q2_payload->>'startSurah')::INT, v_snapshot.start_surah),
        COALESCE((p_q2_payload->'answerStart'->>'ayahNumber')::INT, (p_q2_payload->>'promptStartAyah')::INT, (p_q2_payload->>'startAyah')::INT, 1), 1,
        COALESCE((p_q2_payload->'answerEnd'->>'surahNumber')::INT, (p_q2_payload->>'promptEndSurah')::INT, (p_q2_payload->>'endSurah')::INT, v_snapshot.end_surah),
        COALESCE((p_q2_payload->'answerEnd'->>'ayahNumber')::INT, (p_q2_payload->>'promptEndAyah')::INT, (p_q2_payload->>'endAyah')::INT, 1), 1,
        COALESCE((p_q2_payload->'answerStart'->>'surahNumber')::INT, (p_q2_payload->>'answerStartSurah')::INT, (p_q2_payload->>'startSurah')::INT, v_snapshot.start_surah),
        COALESCE((p_q2_payload->'answerStart'->>'ayahNumber')::INT, (p_q2_payload->>'answerStartAyah')::INT, (p_q2_payload->>'startAyah')::INT, 1), 1,
        COALESCE((p_q2_payload->'answerEnd'->>'surahNumber')::INT, (p_q2_payload->>'answerEndSurah')::INT, (p_q2_payload->>'endSurah')::INT, v_snapshot.end_surah),
        COALESCE((p_q2_payload->'answerEnd'->>'ayahNumber')::INT, (p_q2_payload->>'answerEndAyah')::INT, (p_q2_payload->>'endAyah')::INT, 1), 1,
        v_p2, v_p2, v_p2, 15,
        jsonb_build_object('juzNumber', COALESCE((p_q2_payload->>'juzNumber')::INT, 30), 'manualMandatory', true),
        now()
    );

    UPDATE public.exam_question_sets
    SET status = 'locked', total_questions = 9, locked_at = now(), updated_at = now()
    WHERE id = v_set.id
    RETURNING * INTO v_set;

    RETURN json_build_object(
        'success', true,
        'questionSet', row_to_json(v_set),
        'message', '2 Soal Wajib (Halaman ' || v_p1 || ' & ' || v_p2 || ') berhasil dikunci. Paket 9 soal UAS siap diuji.'
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.start_uas_session_attempt(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text,
    p_uas_session_id text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_verified RECORD;
    v_period RECORD;
    v_sess RECORD;
    v_qset RECORD;
    v_attempt RECORD;
    v_attempt_id TEXT;
    v_actual_examiner_id TEXT;
    v_actual_examiner_name TEXT;
    v_verified_at TIMESTAMPTZ := NULL;
    v_q RECORD;
    v_q_count INT;
    v_expected_count INT;
    v_max_f NUMERIC;
    v_max_t NUMERIC;
    v_max_m NUMERIC;
    v_max_s NUMERIC;
    v_questions JSONB;
    v_assessments JSONB;
    v_hist JSONB;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role NOT IN ('admin', 'teacher', 'shared_uas_examiner') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    IF v_user.role = 'shared_uas_examiner' THEN
        SELECT * INTO v_verified FROM public.uas_verified_examiner_sessions
        WHERE session_token = p_password AND expires_at > now();
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'requiresExaminerVerification', true, 'message', 'Verifikasi PIN penguji terlebih dahulu.');
        END IF;
        v_actual_examiner_id := v_verified.verified_teacher_id;
        v_actual_examiner_name := v_verified.verified_teacher_name;
        v_verified_at := v_verified.verified_at;
    ELSE
        v_actual_examiner_id := v_user.id;
        v_actual_examiner_name := v_user.name;
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id;
    IF NOT FOUND OR v_period.exam_type != 'uas' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Periode UAS tidak ditemukan.');
    END IF;
    IF v_period.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'message', 'UAS belum dibuka oleh Admin.');
    END IF;

    -- Serialize concurrent start requests for the same session (anti double-click / multi-device race)
    PERFORM pg_advisory_xact_lock(hashtext('start_uas_session:' || p_uas_session_id));

    SELECT * INTO v_sess
    FROM public.exam_uas_sessions
    WHERE id = p_uas_session_id
      AND exam_period_id = p_period_id
      AND student_id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi UAS tidak ditemukan.');
    END IF;
    IF v_sess.status = 'void' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi ujian ini sudah dibatalkan (void).');
    END IF;
    IF v_sess.approval_status != 'admin_approved' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Materi sesi ini belum disetujui Admin.');
    END IF;
    IF v_sess.status = 'submitted' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi ujian ini sudah selesai (submitted) dan terkunci.');
    END IF;
    IF v_sess.question_set_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Soal sesi ini belum disiapkan.');
    END IF;

    SELECT * INTO v_qset FROM public.exam_question_sets WHERE id = v_sess.question_set_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket soal sesi tidak ditemukan.');
    END IF;
    IF v_qset.status = 'pending_mandatory' THEN
        RETURN jsonb_build_object('success', false, 'requiresManualMandatory', true, 'message', 'Pilih 2 soal wajib terlebih dahulu.');
    END IF;
    IF v_qset.status != 'locked' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket soal sesi belum terkunci (status: ' || v_qset.status || ').');
    END IF;

    v_expected_count := CASE WHEN v_sess.session_type = 'partial_half' THEN 4 ELSE 9 END;
    SELECT COUNT(*) INTO v_q_count FROM public.exam_questions WHERE question_set_id = v_qset.id;
    IF v_q_count != v_expected_count THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Jumlah butir soal pada paket tidak sesuai (' || v_q_count || '/' || v_expected_count || ').'
        );
    END IF;

    -- Check existing attempt for this session
    SELECT * INTO v_attempt
    FROM public.exam_attempts
    WHERE uas_session_id = v_sess.id
      AND status IN ('in_progress', 'submitted')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        IF v_attempt.status = 'submitted' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi ujian ini sudah selesai (submitted) dan terkunci.');
        END IF;

        v_hist := COALESCE(v_sess.examiner_history, '[]'::jsonb);
        IF v_attempt.actual_examiner_id IS DISTINCT FROM v_actual_examiner_id THEN
            v_hist := v_hist || jsonb_build_array(jsonb_build_object(
                'examinerId', v_actual_examiner_id,
                'examinerName', v_actual_examiner_name,
                'action', 'resume',
                'at', now()
            ));
            UPDATE public.exam_attempts
            SET actual_examiner_id = v_actual_examiner_id,
                actual_examiner_name = v_actual_examiner_name,
                examiner_history = v_hist,
                updated_at = now()
            WHERE id = v_attempt.id
            RETURNING * INTO v_attempt;

            UPDATE public.exam_uas_sessions
            SET actual_examiner_id = v_actual_examiner_id,
                actual_examiner_name = v_actual_examiner_name,
                examiner_history = v_hist,
                updated_at = now()
            WHERE id = v_sess.id;
        END IF;
    ELSE
        v_attempt_id := 'ea_uas_' || v_sess.id || '_' || (EXTRACT(EPOCH FROM now())::BIGINT)::TEXT;
        v_hist := COALESCE(v_sess.examiner_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'examinerId', v_actual_examiner_id,
            'examinerName', v_actual_examiner_name,
            'action', 'start',
            'at', now()
        ));

        INSERT INTO public.exam_attempts (
            id, exam_period_id, student_id, question_set_id,
            examiner_user_id, actual_examiner_id, actual_examiner_name,
            login_account_id, login_account_username, examiner_verified_at,
            attempt_number, session_number, uas_session_id, session_type,
            examiner_history, status, started_at, last_saved_at, updated_at
        ) VALUES (
            v_attempt_id, p_period_id, p_student_id, v_sess.question_set_id,
            v_user.id, v_actual_examiner_id, v_actual_examiner_name,
            v_user.id, v_user.username, v_verified_at,
            v_sess.session_number, v_sess.session_number, v_sess.id, v_sess.session_type,
            v_hist, 'in_progress', now(), now(), now()
        ) RETURNING * INTO v_attempt;

        FOR v_q IN
            SELECT id, question_number, question_role, max_score
            FROM public.exam_questions
            WHERE question_set_id = v_sess.question_set_id
            ORDER BY question_number ASC
        LOOP
            -- Derive rubric deterministically from session_type + question_role + max_score
            -- (Matches save_uas_question_assessment & submit_uas_attempt production rules)
            IF v_sess.session_type = 'partial_half' OR COALESCE(v_q.max_score, 0) = 25 THEN
                v_max_f := 15; v_max_t := 5; v_max_m := 5; v_max_s := 25;
            ELSIF v_q.question_role = 'mandatory' THEN
                v_max_f := 9; v_max_t := 3; v_max_m := 3; v_max_s := 15;
            ELSIF v_q.question_role = 'random' THEN
                v_max_f := 6; v_max_t := 2; v_max_m := 2; v_max_s := 10;
            ELSE
                RAISE EXCEPTION 'Metadata role butir soal tidak valid pada soal nomor %', v_q.question_number;
            END IF;

            INSERT INTO public.exam_question_assessments (
                id, exam_attempt_id, exam_question_id, question_number,
                fluency_score, tajwid_score, makhraj_score, question_score,
                fluency_events, tajwid_events, makhraj_events,
                assessed_by_id, assessed_by_name,
                started_at, version, updated_at
            ) VALUES (
                'eqa_' || v_attempt_id || '_q' || v_q.question_number,
                v_attempt_id, v_q.id, v_q.question_number,
                v_max_f, v_max_t, v_max_m, v_max_s,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                v_actual_examiner_id, v_actual_examiner_name,
                now(), 1, now()
            );
        END LOOP;

        UPDATE public.exam_uas_sessions
        SET attempt_id = v_attempt_id,
            status = 'in_progress',
            actual_examiner_id = v_actual_examiner_id,
            actual_examiner_name = v_actual_examiner_name,
            examiner_history = v_hist,
            updated_at = now()
        WHERE id = v_sess.id;
    END IF;

    -- Build questions payload using ONLY real production columns of exam_questions
    SELECT jsonb_agg(jsonb_build_object(
        'id', q.id,
        'questionSetId', q.question_set_id,
        'questionNumber', q.question_number,
        'zoneNumber', q.zone_number,
        'questionRole', q.question_role,
        'sourceType', q.source_type,
        'promptStartSurah', q.prompt_start_surah, 'promptStartAyah', q.prompt_start_ayah, 'promptStartWord', q.prompt_start_word,
        'promptEndSurah', q.prompt_end_surah, 'promptEndAyah', q.prompt_end_ayah, 'promptEndWord', q.prompt_end_word,
        'answerStartSurah', q.answer_start_surah, 'answerStartAyah', q.answer_start_ayah, 'answerStartWord', q.answer_start_word,
        'answerEndSurah', q.answer_end_surah, 'answerEndAyah', q.answer_end_ayah, 'answerEndWord', q.answer_end_word,
        'pageNumber', q.page_number,
        'startPage', q.start_page,
        'endPage', q.end_page,
        'juzNumber', COALESCE((q.generated_metadata->>'juzNumber')::INT, v_sess.juz_number),
        'maxScore', COALESCE(q.max_score, CASE WHEN v_sess.session_type = 'partial_half' THEN 25 WHEN q.question_role = 'mandatory' THEN 15 ELSE 10 END),
        'maxFluency', CASE WHEN v_sess.session_type = 'partial_half' OR COALESCE(q.max_score, 0) = 25 THEN 15 WHEN q.question_role = 'mandatory' THEN 9 ELSE 6 END,
        'maxTajwid', CASE WHEN v_sess.session_type = 'partial_half' OR COALESCE(q.max_score, 0) = 25 THEN 5 WHEN q.question_role = 'mandatory' THEN 3 ELSE 2 END,
        'maxMakhraj', CASE WHEN v_sess.session_type = 'partial_half' OR COALESCE(q.max_score, 0) = 25 THEN 5 WHEN q.question_role = 'mandatory' THEN 3 ELSE 2 END
    ) ORDER BY q.question_number ASC) INTO v_questions
    FROM public.exam_questions q
    WHERE q.question_set_id = v_sess.question_set_id;

    SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'examAttemptId', a.exam_attempt_id, 'examQuestionId', a.exam_question_id,
        'questionNumber', a.question_number, 'fluencyScore', a.fluency_score, 'tajwidScore', a.tajwid_score,
        'makhrajScore', a.makhraj_score, 'questionScore', a.question_score,
        'fluencyEvents', a.fluency_events, 'tajwidEvents', a.tajwid_events, 'makhrajEvents', a.makhraj_events,
        'notes', a.notes, 'completedAt', a.completed_at, 'version', a.version
    ) ORDER BY a.question_number ASC) INTO v_assessments
    FROM public.exam_question_assessments a
    WHERE a.exam_attempt_id = v_attempt.id;

    RETURN jsonb_build_object(
        'success', true,
        'kkm', v_period.kkm,
        'session', to_jsonb(v_sess),
        'attempt', jsonb_build_object(
            'id', v_attempt.id, 'examPeriodId', v_attempt.exam_period_id, 'studentId', v_attempt.student_id,
            'questionSetId', v_attempt.question_set_id, 'examinerUserId', v_attempt.examiner_user_id,
            'actualExaminerId', v_attempt.actual_examiner_id, 'actualExaminerName', v_attempt.actual_examiner_name,
            'attemptNumber', v_attempt.attempt_number, 'sessionNumber', v_attempt.session_number,
            'uasSessionId', v_attempt.uas_session_id, 'sessionType', v_sess.session_type,
            'status', v_attempt.status, 'startedAt', v_attempt.started_at
        ),
        'questions', COALESCE(v_questions, '[]'::jsonb),
        'assessments', COALESCE(v_assessments, '[]'::jsonb)
    );
END;
$function$;
