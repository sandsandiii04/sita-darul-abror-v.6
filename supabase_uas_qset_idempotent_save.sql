-- ============================================================================
-- SITA DARUL ABROR — ADDITIVE PATCH: IDEMPOTENT, RACE-SAFE UAS SESSION
-- QUESTION SET GENERATOR RPC (FIXES uq_exam_question_set_session_version)
-- Safe, idempotent, additive only. Does NOT re-run historical migrations
-- and does NOT delete any historical question sets or attempts.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_uas_session_question_set_secure(
    p_username text,
    p_password text,
    p_uas_session_id text,
    p_question_set jsonb,
    p_questions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_sess RECORD;
    v_linked_qs RECORD;
    v_unlinked_qs RECORD;
    v_linked_q_cnt INT := 0;
    v_unlinked_q_cnt INT := 0;
    v_expected_min_q INT;
    v_payload_q_cnt INT;
    v_next_version INT;
    v_set_id TEXT;
    v_target_status TEXT;
    v_fingerprint TEXT;
    v_q jsonb;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang dapat menyimpan paket soal sesi UAS.');
    END IF;

    -- Lock session row to prevent race conditions / double-click
    SELECT * INTO v_sess
    FROM public.exam_uas_sessions
    WHERE id = p_uas_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi UAS tidak ditemukan.');
    END IF;

    IF v_sess.status = 'void' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi UAS sudah dibatalkan (void) dan tidak dapat dibuatkan paket soal.');
    END IF;

    IF v_sess.approval_status IS DISTINCT FROM 'admin_approved' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi UAS belum disetujui Admin.');
    END IF;

    -- Never modify sessions already used in an exam attempt
    IF v_sess.attempt_id IS NOT NULL OR v_sess.status IN ('in_progress', 'submitted') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi sudah digunakan dalam ujian/memiliki nilai dan paket soalnya tidak boleh diubah.');
    END IF;

    -- Serialize concurrent saves for the same (period, student, session_number)
    PERFORM pg_advisory_xact_lock(
        hashtext(v_sess.exam_period_id || ':' || v_sess.student_id || ':' || v_sess.session_number::text)
    );

    v_expected_min_q := CASE WHEN v_sess.session_type = 'partial_half' THEN 4 ELSE 7 END;
    v_target_status := CASE WHEN v_sess.session_type = 'partial_half' THEN 'locked' ELSE 'pending_mandatory' END;
    v_fingerprint := COALESCE(p_question_set->>'materialFingerprint', '');

    -- 1. Idempotency check: if session ALREADY has a valid linked question_set matching session_id, type,
    --    material fingerprint, and EXACT Bank Soal random question count (4 partial / 7 full), reuse it safely!
    IF v_sess.question_set_id IS NOT NULL THEN
        SELECT * INTO v_linked_qs
        FROM public.exam_question_sets
        WHERE id = v_sess.question_set_id;

        IF FOUND
           AND v_linked_qs.status != 'stale'
           AND v_linked_qs.uas_session_id = p_uas_session_id
           AND v_linked_qs.session_type = v_sess.session_type
           AND (v_fingerprint = '' OR COALESCE(v_linked_qs.material_fingerprint, '') = v_fingerprint) THEN
            SELECT count(*)::int INTO v_linked_q_cnt
            FROM public.exam_questions
            WHERE question_set_id = v_linked_qs.id
              AND question_role = 'random'
              AND source_type = 'bank';

            IF v_linked_q_cnt = v_expected_min_q THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'alreadyExists', true,
                    'questionSetId', v_linked_qs.id,
                    'version', v_linked_qs.version,
                    'message', 'Paket soal sesi sudah tersedia dan valid.'
                );
            END IF;
        END IF;
    END IF;

    -- 2. Recovery check: if a valid, complete packet already exists for THIS uas_session_id
    --    (e.g. previous request succeeded before network dropped) but wasn't linked yet, re-link it!
    SELECT qs.* INTO v_unlinked_qs
    FROM public.exam_question_sets qs
    WHERE qs.uas_session_id = p_uas_session_id
      AND qs.session_type = v_sess.session_type
      AND qs.status != 'stale'
    ORDER BY qs.version DESC
    LIMIT 1;

    IF FOUND THEN
        SELECT count(*)::int INTO v_unlinked_q_cnt
        FROM public.exam_questions
        WHERE question_set_id = v_unlinked_qs.id
          AND question_role = 'random'
          AND source_type = 'bank';

        IF v_unlinked_q_cnt = v_expected_min_q
           AND (v_fingerprint = '' OR COALESCE(v_unlinked_qs.material_fingerprint, '') = v_fingerprint) THEN
            UPDATE public.exam_uas_sessions
            SET
                question_set_id = v_unlinked_qs.id,
                status = CASE WHEN v_sess.session_type = 'partial_half' THEN 'ready' ELSE 'pending_mandatory' END,
                updated_at = now()
            WHERE id = p_uas_session_id;

            RETURN jsonb_build_object(
                'success', true,
                'recovered', true,
                'questionSetId', v_unlinked_qs.id,
                'version', v_unlinked_qs.version,
                'message', 'Paket soal valid yang sudah ada berhasil dihubungkan kembali ke sesi.'
            );
        END IF;
    END IF;

    -- 3. Validate incoming question payload BEFORE creating any new set (exact 4 partial / exact 7 full random Bank Soal!)
    v_payload_q_cnt := jsonb_array_length(COALESCE(p_questions, '[]'::jsonb));
    IF v_payload_q_cnt != v_expected_min_q THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Jumlah soal tidak sesuai untuk jenis sesi ini (wajib tepat ' || v_expected_min_q || ' soal acak Bank Soal, diterima ' || v_payload_q_cnt || ').'
        );
    END IF;

    -- 4. Mark ONLY unused legacy/unlinked/incomplete sets for this (period, student, session_number)
    --    that have NO attempts AND are NOT linked by any other active session as 'stale' (never deleting!)
    UPDATE public.exam_question_sets qs
    SET status = 'stale', updated_at = now()
    WHERE qs.exam_period_id = v_sess.exam_period_id
      AND qs.student_id = v_sess.student_id
      AND qs.session_number = v_sess.session_number
      AND qs.status != 'stale'
      AND NOT EXISTS (
          SELECT 1 FROM public.exam_attempts a WHERE a.question_set_id = qs.id
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.exam_uas_sessions s2
          WHERE s2.question_set_id = qs.id AND s2.id != p_uas_session_id AND s2.status != 'void'
      );

    SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
    FROM public.exam_question_sets
    WHERE exam_period_id = v_sess.exam_period_id
      AND student_id = v_sess.student_id
      AND session_number = v_sess.session_number;

    v_set_id := 'eqs_uas_' || v_sess.exam_period_id || '_' || v_sess.student_id || '_s' || v_sess.session_number::text || '_v' || v_next_version::text;

    -- 5. Atomic insert of question set + all questions + session link
    INSERT INTO public.exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id,
        uas_session_id, session_number, session_type,
        version, total_questions, generation_strategy, generation_seed, material_fingerprint,
        status, generated_by, generated_at, locked_at
    ) VALUES (
        v_set_id,
        v_sess.exam_period_id,
        v_sess.student_id,
        COALESCE(
            NULLIF(p_question_set->>'materialSnapshotId', ''),
            (SELECT ms.id FROM public.exam_material_snapshots ms WHERE ms.exam_period_id = v_sess.exam_period_id AND ms.student_id = v_sess.student_id LIMIT 1)
        ),
        p_uas_session_id,
        v_sess.session_number,
        v_sess.session_type,
        v_next_version,
        v_payload_q_cnt,
        COALESCE(p_question_set->>'generationStrategy', 'bank_only'),
        COALESCE(p_question_set->>'generationSeed', ''),
        v_fingerprint,
        v_target_status,
        v_auth.out_user_id,
        now(),
        CASE WHEN v_sess.session_type = 'partial_half' THEN now() ELSE NULL END
    );

    FOR v_q IN SELECT * FROM jsonb_array_elements(COALESCE(p_questions, '[]'::jsonb)) LOOP
        INSERT INTO public.exam_questions (
            id, question_set_id, question_number, zone_number, question_role,
            source_type, question_bank_id, page_number, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata
        ) VALUES (
            'eq_' || v_set_id || '_q' || (v_q->>'questionNumber'),
            v_set_id,
            (v_q->>'questionNumber')::int,
            (v_q->>'zoneNumber')::int,
            COALESCE(v_q->>'questionRole', 'random'),
            COALESCE(v_q->>'sourceType', 'bank'),
            NULLIF(v_q->>'questionBankId', ''),
            (v_q->>'pageNumber')::int,
            (v_q->>'maxScore')::numeric,
            (v_q->'promptStart'->>'surahNumber')::int,
            (v_q->'promptStart'->>'ayahNumber')::int,
            (v_q->'promptStart'->>'wordPosition')::int,
            (v_q->'promptEnd'->>'surahNumber')::int,
            (v_q->'promptEnd'->>'ayahNumber')::int,
            (v_q->'promptEnd'->>'wordPosition')::int,
            (v_q->'answerStart'->>'surahNumber')::int,
            (v_q->'answerStart'->>'ayahNumber')::int,
            (v_q->'answerStart'->>'wordPosition')::int,
            (v_q->'answerEnd'->>'surahNumber')::int,
            (v_q->'answerEnd'->>'ayahNumber')::int,
            (v_q->'answerEnd'->>'wordPosition')::int,
            (v_q->>'startPage')::int,
            (v_q->>'endPage')::int,
            COALESCE(v_q->'metadata', '{}'::jsonb)
        );
    END LOOP;

    UPDATE public.exam_uas_sessions
    SET
        question_set_id = v_set_id,
        status = CASE WHEN v_sess.session_type = 'partial_half' THEN 'ready' ELSE 'pending_mandatory' END,
        updated_at = now()
    WHERE id = p_uas_session_id;

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        v_sess.exam_period_id, v_sess.student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        'generate_uas_session_question_set', v_set_id,
        'Pembuatan paket soal Sesi ' || v_sess.session_number || ' (Juz ' || v_sess.juz_number || ')',
        jsonb_build_object(
            'uasSessionId', p_uas_session_id,
            'sessionNumber', v_sess.session_number,
            'sessionType', v_sess.session_type,
            'juzNumber', v_sess.juz_number,
            'version', v_next_version,
            'questionCount', v_payload_q_cnt
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'questionSetId', v_set_id,
        'version', v_next_version,
        'questionCount', v_payload_q_cnt
    );
END;
$function$;
