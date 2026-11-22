-- ============================================================================
-- SITA DARUL ABROR — HOTFIX TERPADU CONSTRAINT RUBRIK PARSIAL (4x25) &
-- ZONE_NUMBER SOAL WAJIB MANUAL (FULL JUZ)
--
-- Akar Masalah Produksi (Terverifikasi dari pg_constraint):
--   1. public.exam_question_assessments masih memakai 4 CHECK constraint lama
--      era UTS (fluency <= 12, tajwid <= 4, makhraj <= 4, question <= 20).
--      Saat memulai sesi UAS partial_half (4 soal x 25 = 15 + 5 + 5),
--      INSERT gagal dengan SQLSTATE 23514 (check_violation).
--   2. public.exam_questions memiliki constraint chk_eq_role_fields &
--      chk_eq_zone_number yang mewajibkan zone_number IS NULL untuk
--      question_role = 'mandatory' (bukan 0).
--
-- Non-destructive & backward-compatible:
--   - Tidak mengubah tabel/data historis (1.115 baris assessment lama tetap valid).
--   - Tidak menambah kolom baru.
--   - Tidak menimpa start_uas_session_attempt, save_uas_question_assessment,
--     maupun submit_uas_attempt yang sudah benar.
-- ============================================================================

BEGIN;

-- 1. Perluas 4 CHECK constraint pada public.exam_question_assessments
--    agar mendukung rubrik UAS partial_half (15 + 5 + 5 = 25) sekaligus
--    tetap menjaga batas UTS (12+4+4=20), UAS penuh wajib (9+3+3=15),
--    dan UAS penuh acak (6+2+2=10).
ALTER TABLE public.exam_question_assessments
  DROP CONSTRAINT IF EXISTS exam_question_assessments_fluency_score_check;
ALTER TABLE public.exam_question_assessments
  ADD CONSTRAINT exam_question_assessments_fluency_score_check
  CHECK (fluency_score >= 0::numeric AND fluency_score <= 15::numeric);

ALTER TABLE public.exam_question_assessments
  DROP CONSTRAINT IF EXISTS exam_question_assessments_tajwid_score_check;
ALTER TABLE public.exam_question_assessments
  ADD CONSTRAINT exam_question_assessments_tajwid_score_check
  CHECK (tajwid_score >= 0::numeric AND tajwid_score <= 5::numeric);

ALTER TABLE public.exam_question_assessments
  DROP CONSTRAINT IF EXISTS exam_question_assessments_makhraj_score_check;
ALTER TABLE public.exam_question_assessments
  ADD CONSTRAINT exam_question_assessments_makhraj_score_check
  CHECK (makhraj_score >= 0::numeric AND makhraj_score <= 5::numeric);

ALTER TABLE public.exam_question_assessments
  DROP CONSTRAINT IF EXISTS exam_question_assessments_question_score_check;
ALTER TABLE public.exam_question_assessments
  ADD CONSTRAINT exam_question_assessments_question_score_check
  CHECK (question_score >= 0::numeric AND question_score <= 25::numeric);


-- 2. Perbaiki select_uas_mandatory_pages agar mengisi zone_number = NULL
--    untuk question_role = 'mandatory' (memenuhi chk_eq_role_fields & chk_eq_zone_number).
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

        -- zone_number MUST be NULL for question_role = 'mandatory' (chk_eq_role_fields & chk_eq_zone_number)
        INSERT INTO public.exam_questions (
            id, question_set_id, question_number, zone_number, question_role, source_type, question_bank_id,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            page_number, start_page, end_page, max_score, generated_metadata, created_at
        ) VALUES (
            'eq_uas_' || v_set.id || '_q1', v_set.id, 1, NULL, 'mandatory',
            COALESCE(p_q1_payload->>'sourceType', 'manual_mushaf'),
            p_q1_payload->>'questionBankId',
            NULL, NULL, NULL,
            NULL, NULL, NULL,
            COALESCE((p_q1_payload->'answerStart'->>'surahNumber')::INT, (p_q1_payload->>'answerStartSurah')::INT, (p_q1_payload->>'startSurah')::INT, v_sess.start_surah, 1),
            COALESCE((p_q1_payload->'answerStart'->>'ayahNumber')::INT, (p_q1_payload->>'answerStartAyah')::INT, (p_q1_payload->>'startAyah')::INT, 1), 1,
            COALESCE((p_q1_payload->'answerEnd'->>'surahNumber')::INT, (p_q1_payload->>'answerEndSurah')::INT, (p_q1_payload->>'endSurah')::INT, v_sess.end_surah, 1),
            COALESCE((p_q1_payload->'answerEnd'->>'ayahNumber')::INT, (p_q1_payload->>'answerEndAyah')::INT, (p_q1_payload->>'endAyah')::INT, 1), 1,
            v_p1, v_p1, v_p1, 15,
            jsonb_build_object('juzNumber', COALESCE((p_q1_payload->>'juzNumber')::INT, v_sess.juz_number, 30), 'manualMandatory', true),
            now()
        ), (
            'eq_uas_' || v_set.id || '_q2', v_set.id, 2, NULL, 'mandatory',
            COALESCE(p_q2_payload->>'sourceType', 'manual_mushaf'),
            p_q2_payload->>'questionBankId',
            NULL, NULL, NULL,
            NULL, NULL, NULL,
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

    -- 2. Legacy fallback
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
        'eq_uas_' || v_set.id || '_q1', v_set.id, 1, NULL, 'mandatory',
        COALESCE(p_q1_payload->>'sourceType', 'manual_mushaf'),
        p_q1_payload->>'questionBankId',
        NULL, NULL, NULL,
        NULL, NULL, NULL,
        COALESCE((p_q1_payload->'answerStart'->>'surahNumber')::INT, (p_q1_payload->>'answerStartSurah')::INT, (p_q1_payload->>'startSurah')::INT, v_snapshot.start_surah),
        COALESCE((p_q1_payload->'answerStart'->>'ayahNumber')::INT, (p_q1_payload->>'answerStartAyah')::INT, (p_q1_payload->>'startAyah')::INT, 1), 1,
        COALESCE((p_q1_payload->'answerEnd'->>'surahNumber')::INT, (p_q1_payload->>'answerEndSurah')::INT, (p_q1_payload->>'endSurah')::INT, v_snapshot.end_surah),
        COALESCE((p_q1_payload->'answerEnd'->>'ayahNumber')::INT, (p_q1_payload->>'answerEndAyah')::INT, (p_q1_payload->>'endAyah')::INT, 1), 1,
        v_p1, v_p1, v_p1, 15,
        jsonb_build_object('juzNumber', COALESCE((p_q1_payload->>'juzNumber')::INT, 30), 'manualMandatory', true),
        now()
    ), (
        'eq_uas_' || v_set.id || '_q2', v_set.id, 2, NULL, 'mandatory',
        COALESCE(p_q2_payload->>'sourceType', 'manual_mushaf'),
        p_q2_payload->>'questionBankId',
        NULL, NULL, NULL,
        NULL, NULL, NULL,
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

COMMIT;
