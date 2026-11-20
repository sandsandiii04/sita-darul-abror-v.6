-- ============================================================================
-- MIGRATION (ADDITIVE): UAS Per-Juz Material Parts & Multi-Session UAS
-- Supports:
--   - Full Juz Session: 7 Bank Soal (10p) + 2 Manual Mandatory Pages (15p) = 100
--   - Partial Half-Juz Session: 4 Bank Soal (25p) = 100 (no mandatory pages)
--   - Discontinuous segments, per-part Admin verification, and multi-session
--     per student with isolated question sets, attempts, scores & examiners.
-- ============================================================================

BEGIN;

-- 1. Material Parts per Juz per Student per Period
CREATE TABLE IF NOT EXISTS public.exam_material_parts (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT NOT NULL REFERENCES public.exam_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    snapshot_id TEXT REFERENCES public.exam_material_snapshots(id) ON DELETE CASCADE,
    part_order INTEGER NOT NULL DEFAULT 1,
    juz_number INTEGER NOT NULL CHECK (juz_number BETWEEN 1 AND 30),
    part_type TEXT NOT NULL CHECK (part_type IN ('full_juz', 'partial_half', 'minor_addition')),
    start_surah INTEGER NOT NULL,
    start_ayah INTEGER NOT NULL,
    end_surah INTEGER NOT NULL,
    end_ayah INTEGER NOT NULL,
    start_page INTEGER NOT NULL,
    end_page INTEGER NOT NULL,
    covered_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
    covered_pages_count INTEGER NOT NULL DEFAULT 0,
    juz_total_pages INTEGER NOT NULL DEFAULT 20,
    coverage_ratio NUMERIC(5,4) NOT NULL DEFAULT 0,
    segments JSONB NOT NULL DEFAULT '[]'::jsonb,
    has_gap BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'needs_review', 'needs_admin_decision', 'finalized', 'excluded')),
    review_reason TEXT,
    verified_by TEXT,
    verified_at TIMESTAMPTZ,
    finalized_by TEXT,
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exam_period_id, student_id, juz_number, part_order)
);
ALTER TABLE public.exam_material_parts ENABLE ROW LEVEL SECURITY;

-- 2. UAS Sessions per Student per Period (distinct from remedial sessions)
CREATE TABLE IF NOT EXISTS public.exam_uas_sessions (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT NOT NULL REFERENCES public.exam_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    session_number INTEGER NOT NULL CHECK (session_number >= 1),
    session_type TEXT NOT NULL CHECK (session_type IN ('full_juz', 'partial_half')),
    primary_part_id TEXT REFERENCES public.exam_material_parts(id) ON DELETE SET NULL,
    juz_number INTEGER NOT NULL CHECK (juz_number BETWEEN 1 AND 30),
    supplemental_parts JSONB NOT NULL DEFAULT '[]'::jsonb,
    covered_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
    start_surah INTEGER NOT NULL,
    start_ayah INTEGER NOT NULL,
    end_surah INTEGER NOT NULL,
    end_ayah INTEGER NOT NULL,
    start_page INTEGER NOT NULL,
    end_page INTEGER NOT NULL,
    question_set_id TEXT,
    attempt_id TEXT,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'draft_ready', 'pending_mandatory', 'ready', 'in_progress', 'submitted', 'void')),
    score NUMERIC(5,2),
    predikat TEXT,
    actual_examiner_id TEXT,
    actual_examiner_name TEXT,
    examiner_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exam_period_id, student_id, session_number)
);
ALTER TABLE public.exam_uas_sessions ENABLE ROW LEVEL SECURITY;

-- 3. Additive Columns & Multi-Session Unique Constraints on Existing Tables
ALTER TABLE public.exam_question_sets ADD COLUMN IF NOT EXISTS uas_session_id TEXT;
ALTER TABLE public.exam_question_sets ADD COLUMN IF NOT EXISTS session_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.exam_question_sets ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'full_juz';

ALTER TABLE public.exam_question_sets DROP CONSTRAINT IF EXISTS uq_exam_question_set_version;
ALTER TABLE public.exam_question_sets DROP CONSTRAINT IF EXISTS uq_exam_question_set_session_version;
ALTER TABLE public.exam_question_sets ADD CONSTRAINT uq_exam_question_set_session_version
    UNIQUE (exam_period_id, student_id, session_number, version);

ALTER TABLE public.exam_attempts ADD COLUMN IF NOT EXISTS uas_session_id TEXT;
ALTER TABLE public.exam_attempts ADD COLUMN IF NOT EXISTS session_type TEXT NOT NULL DEFAULT 'full_juz';

ALTER TABLE public.exam_attempts DROP CONSTRAINT IF EXISTS uq_exam_attempt;
ALTER TABLE public.exam_attempts DROP CONSTRAINT IF EXISTS uq_exam_attempt_session;
ALTER TABLE public.exam_attempts ADD CONSTRAINT uq_exam_attempt_session
    UNIQUE (exam_period_id, student_id, session_number, attempt_number);

-- 4. Admin RPC: Save/Sync Per-Juz Material Parts and UAS Sessions for a Student
CREATE OR REPLACE FUNCTION public.save_uas_juz_parts_and_sessions_secure(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text,
    p_parts jsonb,
    p_sessions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_part jsonb;
    v_sess jsonb;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang dapat menyimpan bagian materi per juz.');
    END IF;

    -- Upsert parts
    FOR v_part IN SELECT * FROM jsonb_array_elements(COALESCE(p_parts, '[]'::jsonb)) LOOP
        INSERT INTO public.exam_material_parts (
            id, exam_period_id, student_id, snapshot_id, part_order, juz_number, part_type,
            start_surah, start_ayah, end_surah, end_ayah, start_page, end_page,
            covered_pages, covered_pages_count, juz_total_pages, coverage_ratio,
            segments, has_gap, status, review_reason, updated_at
        ) VALUES (
            v_part->>'id',
            p_period_id,
            p_student_id,
            NULLIF(v_part->>'snapshotId', ''),
            COALESCE((v_part->>'partOrder')::int, 1),
            (v_part->>'juzNumber')::int,
            v_part->>'partType',
            (v_part->>'startSurah')::int,
            (v_part->>'startAyah')::int,
            (v_part->>'endSurah')::int,
            (v_part->>'endAyah')::int,
            (v_part->>'startPage')::int,
            (v_part->>'endPage')::int,
            COALESCE(v_part->'coveredPages', '[]'::jsonb),
            COALESCE((v_part->>'coveredPagesCount')::int, 0),
            COALESCE((v_part->>'juzTotalPages')::int, 20),
            COALESCE((v_part->>'coverageRatio')::numeric, 0),
            COALESCE(v_part->'segments', '[]'::jsonb),
            COALESCE((v_part->>'hasGap')::boolean, false),
            COALESCE(v_part->>'status', 'ready'),
            NULLIF(v_part->>'reviewReason', ''),
            now()
        )
        ON CONFLICT (id) DO UPDATE SET
            part_order = EXCLUDED.part_order,
            part_type = EXCLUDED.part_type,
            start_surah = EXCLUDED.start_surah,
            start_ayah = EXCLUDED.start_ayah,
            end_surah = EXCLUDED.end_surah,
            end_ayah = EXCLUDED.end_ayah,
            start_page = EXCLUDED.start_page,
            end_page = EXCLUDED.end_page,
            covered_pages = EXCLUDED.covered_pages,
            covered_pages_count = EXCLUDED.covered_pages_count,
            juz_total_pages = EXCLUDED.juz_total_pages,
            coverage_ratio = EXCLUDED.coverage_ratio,
            segments = EXCLUDED.segments,
            has_gap = EXCLUDED.has_gap,
            status = CASE
                WHEN public.exam_material_parts.status IN ('finalized', 'excluded') THEN public.exam_material_parts.status
                ELSE EXCLUDED.status
            END,
            review_reason = COALESCE(EXCLUDED.review_reason, public.exam_material_parts.review_reason),
            updated_at = now();
    END LOOP;

    -- Upsert sessions (preserve existing attempt/score/examiner if already started)
    FOR v_sess IN SELECT * FROM jsonb_array_elements(COALESCE(p_sessions, '[]'::jsonb)) LOOP
        INSERT INTO public.exam_uas_sessions (
            id, exam_period_id, student_id, session_number, session_type,
            primary_part_id, juz_number, supplemental_parts, covered_pages,
            start_surah, start_ayah, end_surah, end_ayah, start_page, end_page,
            status, updated_at
        ) VALUES (
            v_sess->>'id',
            p_period_id,
            p_student_id,
            (v_sess->>'sessionNumber')::int,
            v_sess->>'sessionType',
            NULLIF(v_sess->>'primaryPartId', ''),
            (v_sess->>'juzNumber')::int,
            COALESCE(v_sess->'supplementalParts', '[]'::jsonb),
            COALESCE(v_sess->'coveredPages', '[]'::jsonb),
            (v_sess->>'startSurah')::int,
            (v_sess->>'startAyah')::int,
            (v_sess->>'endSurah')::int,
            (v_sess->>'endAyah')::int,
            (v_sess->>'startPage')::int,
            (v_sess->>'endPage')::int,
            COALESCE(v_sess->>'status', 'planned'),
            now()
        )
        ON CONFLICT (exam_period_id, student_id, session_number) DO UPDATE SET
            session_type = CASE
                WHEN public.exam_uas_sessions.attempt_id IS NOT NULL THEN public.exam_uas_sessions.session_type
                ELSE EXCLUDED.session_type
            END,
            primary_part_id = COALESCE(EXCLUDED.primary_part_id, public.exam_uas_sessions.primary_part_id),
            juz_number = EXCLUDED.juz_number,
            supplemental_parts = EXCLUDED.supplemental_parts,
            covered_pages = EXCLUDED.covered_pages,
            start_surah = EXCLUDED.start_surah,
            start_ayah = EXCLUDED.start_ayah,
            end_surah = EXCLUDED.end_surah,
            end_ayah = EXCLUDED.end_ayah,
            start_page = EXCLUDED.start_page,
            end_page = EXCLUDED.end_page,
            updated_at = now();
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 5. Admin RPC: Verify / Finalize / Exclude an Individual Juz Material Part
CREATE OR REPLACE FUNCTION public.verify_or_finalize_uas_material_part_secure(
    p_username text,
    p_password text,
    p_part_id text,
    p_action text, -- 'verify' | 'finalize' | 'exclude'
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_new_status TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang dapat memverifikasi bagian materi.');
    END IF;

    v_new_status := CASE p_action
        WHEN 'verify' THEN 'ready'
        WHEN 'finalize' THEN 'finalized'
        WHEN 'exclude' THEN 'excluded'
        ELSE NULL
    END;

    IF v_new_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Aksi tidak dikenal.');
    END IF;

    UPDATE public.exam_material_parts
    SET
        status = v_new_status,
        review_reason = COALESCE(NULLIF(trim(p_reason), ''), review_reason),
        verified_by = CASE WHEN p_action IN ('verify', 'finalize') THEN v_auth.out_user_id ELSE verified_by END,
        verified_at = CASE WHEN p_action IN ('verify', 'finalize') THEN now() ELSE verified_at END,
        finalized_by = CASE WHEN p_action = 'finalize' THEN v_auth.out_user_id ELSE finalized_by END,
        finalized_at = CASE WHEN p_action = 'finalize' THEN now() ELSE finalized_at END,
        updated_at = now()
    WHERE id = p_part_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bagian materi tidak ditemukan.');
    END IF;

    RETURN jsonb_build_object('success', true, 'partId', p_part_id, 'status', v_new_status);
END;
$function$;

-- 6. Read RPC: Get Per-Juz Material Parts & UAS Sessions
CREATE OR REPLACE FUNCTION public.get_uas_juz_parts_and_sessions(
    p_username text,
    p_password text,
    p_period_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_parts jsonb;
    v_sessions jsonb;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role NOT IN ('admin', 'teacher', 'shared_uas_examiner') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    IF v_auth.out_role = 'shared_uas_examiner' AND NOT EXISTS (
        SELECT 1 FROM public.uas_verified_examiner_sessions
        WHERE session_token = p_password AND expires_at > now()
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Silakan verifikasi PIN penguji terlebih dahulu.');
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY p.student_id, p.part_order), '[]'::jsonb)
    INTO v_parts
    FROM public.exam_material_parts p
    WHERE p.exam_period_id = p_period_id;

    SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.student_id, s.session_number), '[]'::jsonb)
    INTO v_sessions
    FROM public.exam_uas_sessions s
    WHERE s.exam_period_id = p_period_id;

    RETURN jsonb_build_object('success', true, 'parts', v_parts, 'sessions', v_sessions);
END;
$function$;

-- 7. Start or Resume Specific UAS Session Attempt (preserves isolated examiner & session state)
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
    v_sess RECORD;
    v_verified RECORD;
    v_examiner_id TEXT;
    v_examiner_name TEXT;
    v_attempt RECORD;
    v_questions jsonb;
    v_assessments jsonb;
    v_new_history jsonb;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role NOT IN ('admin', 'teacher', 'shared_uas_examiner') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    IF v_auth.out_role = 'shared_uas_examiner' THEN
        SELECT * INTO v_verified
        FROM public.uas_verified_examiner_sessions
        WHERE session_token = p_password AND expires_at > now();
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', 'Silakan pilih nama penguji dan verifikasi PIN Anda terlebih dahulu.');
        END IF;
        v_examiner_id := v_verified.verified_teacher_id;
        v_examiner_name := v_verified.verified_teacher_name;
    ELSE
        v_examiner_id := v_auth.out_user_id;
        v_examiner_name := v_auth.out_name;
    END IF;

    SELECT * INTO v_sess
    FROM public.exam_uas_sessions
    WHERE id = p_uas_session_id AND exam_period_id = p_period_id AND student_id = p_student_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi UAS tidak ditemukan.');
    END IF;

    IF v_sess.question_set_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket soal untuk sesi ini belum tersedia.');
    END IF;

    SELECT * INTO v_attempt
    FROM public.exam_attempts
    WHERE uas_session_id = p_uas_session_id AND status != 'void'
    ORDER BY attempt_number DESC
    LIMIT 1;

    IF NOT FOUND THEN
        INSERT INTO public.exam_attempts (
            id, exam_period_id, student_id, question_set_id, examiner_user_id,
            attempt_number, session_number, uas_session_id, session_type,
            status, actual_examiner_id, actual_examiner_name,
            login_account_id, login_account_username, examiner_verified_at,
            examiner_history
        ) VALUES (
            'att_uas_' || p_uas_session_id || '_' || floor(extract(epoch from now()))::text,
            p_period_id,
            p_student_id,
            v_sess.question_set_id,
            v_examiner_id,
            1,
            v_sess.session_number,
            p_uas_session_id,
            v_sess.session_type,
            'in_progress',
            v_examiner_id,
            v_examiner_name,
            v_auth.out_user_id,
            v_auth.out_username,
            now(),
            jsonb_build_array(jsonb_build_object(
                'teacher_id', v_examiner_id,
                'teacher_name', v_examiner_name,
                'session_number', v_sess.session_number,
                'verified_at', now()
            ))
        )
        RETURNING * INTO v_attempt;

        UPDATE public.exam_uas_sessions
        SET
            attempt_id = v_attempt.id,
            status = 'in_progress',
            actual_examiner_id = v_examiner_id,
            actual_examiner_name = v_examiner_name,
            examiner_history = v_attempt.examiner_history,
            updated_at = now()
        WHERE id = p_uas_session_id;

        -- Inisialisasi baris exam_question_assessments agar save_uas_question_assessment siap
        INSERT INTO public.exam_question_assessments (
            id, exam_attempt_id, exam_question_id, question_number,
            fluency_score, tajwid_score, makhraj_score,
            fluency_events, tajwid_events, makhraj_events,
            question_score, notes, version, updated_at
        )
        SELECT
            'eqa_' || v_attempt.id || '_q' || q.question_number,
            v_attempt.id,
            q.id,
            q.question_number,
            CASE WHEN q.max_score = 25.00 THEN 15.00 WHEN q.question_role = 'mandatory' THEN 9.00 ELSE 6.00 END,
            CASE WHEN q.max_score = 25.00 THEN 5.00 WHEN q.question_role = 'mandatory' THEN 3.00 ELSE 2.00 END,
            CASE WHEN q.max_score = 25.00 THEN 5.00 WHEN q.question_role = 'mandatory' THEN 3.00 ELSE 2.00 END,
            '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
            q.max_score,
            '',
            1,
            now()
        FROM public.exam_questions q
        WHERE q.question_set_id = v_sess.question_set_id
        ON CONFLICT (exam_attempt_id, question_number) DO NOTHING;
    ELSE
        -- Update current session examiner if handed off while still preserving prior history
        v_new_history := COALESCE(v_attempt.examiner_history, '[]'::jsonb);
        IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_new_history) h
            WHERE h->>'teacher_id' = v_examiner_id
        ) THEN
            v_new_history := v_new_history || jsonb_build_array(jsonb_build_object(
                'teacher_id', v_examiner_id,
                'teacher_name', v_examiner_name,
                'session_number', v_sess.session_number,
                'verified_at', now()
            ));
        END IF;

        UPDATE public.exam_attempts
        SET
            actual_examiner_id = v_examiner_id,
            actual_examiner_name = v_examiner_name,
            examiner_history = v_new_history,
            updated_at = now()
        WHERE id = v_attempt.id
        RETURNING * INTO v_attempt;

        UPDATE public.exam_uas_sessions
        SET
            actual_examiner_id = v_examiner_id,
            actual_examiner_name = v_examiner_name,
            examiner_history = v_new_history,
            updated_at = now()
        WHERE id = p_uas_session_id;
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(q) ORDER BY q.question_number), '[]'::jsonb)
    INTO v_questions
    FROM public.exam_questions q
    WHERE q.question_set_id = v_sess.question_set_id;

    SELECT COALESCE(jsonb_agg(row_to_json(a) ORDER BY a.question_number), '[]'::jsonb)
    INTO v_assessments
    FROM public.exam_question_assessments a
    WHERE a.exam_attempt_id = v_attempt.id;

    RETURN jsonb_build_object(
        'success', true,
        'attempt', row_to_json(v_attempt),
        'session', row_to_json(v_sess),
        'questions', v_questions,
        'assessments', v_assessments
    );
END;
$function$;

-- 8. Admin RPC: Save Question Set for a Specific UAS Session (7 random draft or 4 random partial)
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
    v_set_id TEXT;
    v_q jsonb;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang dapat menyimpan paket soal sesi UAS.');
    END IF;

    SELECT * INTO v_sess FROM public.exam_uas_sessions WHERE id = p_uas_session_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi UAS tidak ditemukan.');
    END IF;

    v_set_id := p_question_set->>'id';
    INSERT INTO public.exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id,
        uas_session_id, session_number, session_type,
        version, generation_strategy, generation_seed, material_fingerprint,
        status, generated_by, generated_at, locked_at
    ) VALUES (
        v_set_id,
        v_sess.exam_period_id,
        v_sess.student_id,
        p_question_set->>'materialSnapshotId',
        p_uas_session_id,
        v_sess.session_number,
        v_sess.session_type,
        COALESCE((p_question_set->>'version')::int, 1),
        COALESCE(p_question_set->>'generationStrategy', 'bank_only'),
        COALESCE(p_question_set->>'generationSeed', ''),
        COALESCE(p_question_set->>'materialFingerprint', ''),
        COALESCE(p_question_set->>'status', CASE WHEN v_sess.session_type = 'partial_half' THEN 'locked' ELSE 'pending_mandatory' END),
        v_auth.out_user_id,
        now(),
        CASE WHEN v_sess.session_type = 'partial_half' THEN now() ELSE NULL END
    )
    ON CONFLICT (id) DO NOTHING;

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
        )
        ON CONFLICT (id) DO NOTHING;
    END LOOP;

    UPDATE public.exam_uas_sessions
    SET
        question_set_id = v_set_id,
        status = CASE WHEN v_sess.session_type = 'partial_half' THEN 'ready' ELSE 'pending_mandatory' END,
        updated_at = now()
    WHERE id = p_uas_session_id;

    RETURN jsonb_build_object('success', true, 'questionSetId', v_set_id);
END;
$function$;

-- 9. Update save_uas_question_assessment to support both Full Juz (15/10p) & Partial Half-Juz (25p)
CREATE OR REPLACE FUNCTION public.save_uas_question_assessment(
    p_username text,
    p_password text,
    p_attempt_id text,
    p_question_number integer,
    p_assessment_data jsonb,
    p_expected_version integer DEFAULT NULL::integer,
    p_mark_completed boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_attempt RECORD;
    v_question RECORD;
    v_existing_assessment RECORD;
    v_verified RECORD;
    v_actual_examiner_id TEXT;
    v_actual_examiner_name TEXT;
    v_max_fluency NUMERIC(5,2);
    v_max_tajwid NUMERIC(5,2);
    v_max_makhraj NUMERIC(5,2);
    v_max_score NUMERIC(5,2);
    v_f_events JSONB;
    v_t_events JSONB;
    v_m_events JSONB;
    v_event JSONB;
    v_ev_type TEXT;
    v_f_deduction NUMERIC(5,2) := 0;
    v_t_deduction NUMERIC(5,2) := 0;
    v_m_deduction NUMERIC(5,2) := 0;
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
    v_new_completed_at TIMESTAMPTZ;
    v_notes TEXT;
    v_new_version INTEGER;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;
    IF v_user.role NOT IN ('admin', 'teacher', 'shared_uas_examiner') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    IF v_user.role = 'shared_uas_examiner' THEN
        SELECT * INTO v_verified FROM public.uas_verified_examiner_sessions WHERE session_token = p_password AND expires_at > now();
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Identitas penguji belum diverifikasi.');
        END IF;
        v_actual_examiner_id := v_verified.verified_teacher_id;
        v_actual_examiner_name := v_verified.verified_teacher_name;
    ELSE
        v_actual_examiner_id := v_user.id;
        v_actual_examiner_name := v_user.name;
    END IF;

    SELECT * INTO v_attempt FROM public.exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
    END IF;
    IF v_attempt.status != 'in_progress' THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian sudah ditutup.');
    END IF;

    SELECT * INTO v_existing_assessment FROM public.exam_question_assessments
    WHERE exam_attempt_id = p_attempt_id AND question_number = p_question_number;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Butir soal assessment tidak ditemukan.');
    END IF;

    IF p_expected_version IS NOT NULL AND v_existing_assessment.version != p_expected_version THEN
        RETURN json_build_object('success', false, 'isConflict', true, 'message', 'Data ujian berubah di perangkat lain.', 'currentVersion', v_existing_assessment.version);
    END IF;

    SELECT * INTO v_question FROM public.exam_questions WHERE id = v_existing_assessment.exam_question_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Metadata soal tidak ditemukan.');
    END IF;

    IF v_question.question_role = 'mandatory' THEN
        v_max_fluency := 9.00; v_max_tajwid := 3.00; v_max_makhraj := 3.00; v_max_score := 15.00;
    ELSIF v_question.question_role = 'random' AND (v_attempt.session_type = 'partial_half' OR v_question.max_score = 25.00) THEN
        v_max_fluency := 15.00; v_max_tajwid := 5.00; v_max_makhraj := 5.00; v_max_score := 25.00;
    ELSIF v_question.question_role = 'random' THEN
        v_max_fluency := 6.00; v_max_tajwid := 2.00; v_max_makhraj := 2.00; v_max_score := 10.00;
    ELSE
        RETURN json_build_object('success', false, 'message', 'Role butir soal tidak dikenal.');
    END IF;

    v_f_events := COALESCE(p_assessment_data->'fluencyEvents', '[]'::jsonb);
    v_t_events := COALESCE(p_assessment_data->'tajwidEvents', '[]'::jsonb);
    v_m_events := COALESCE(p_assessment_data->'makhrajEvents', '[]'::jsonb);

    FOR v_event IN SELECT * FROM jsonb_array_elements(v_f_events) LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'self_correction' THEN v_f_deduction := v_f_deduction + 0.5;
        ELSIF v_ev_type = 'reminder' THEN v_f_deduction := v_f_deduction + 1.0;
        ELSIF v_ev_type = 'prompt' THEN v_f_deduction := v_f_deduction + 2.0;
        ELSIF v_ev_type = 'unable' THEN v_f_deduction := v_f_deduction + 4.0;
        END IF;
    END LOOP;
    v_f_score := GREATEST(0.00, v_max_fluency - v_f_deduction);

    FOR v_event IN SELECT * FROM jsonb_array_elements(v_t_events) LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'minor' THEN v_t_deduction := v_t_deduction + 0.5;
        ELSIF v_ev_type = 'major' THEN v_t_deduction := v_t_deduction + 1.0;
        END IF;
    END LOOP;
    v_t_score := GREATEST(0.00, v_max_tajwid - v_t_deduction);

    FOR v_event IN SELECT * FROM jsonb_array_elements(v_m_events) LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'minor' THEN v_m_deduction := v_m_deduction + 0.5;
        ELSIF v_ev_type = 'major' THEN v_m_deduction := v_m_deduction + 1.0;
        END IF;
    END LOOP;
    v_m_score := GREATEST(0.00, v_max_makhraj - v_m_deduction);

    v_q_score := LEAST(v_max_score, GREATEST(0.00, v_f_score + v_t_score + v_m_score));
    v_notes := COALESCE(p_assessment_data->>'notes', v_existing_assessment.notes);

    IF p_mark_completed = true OR (p_assessment_data->>'isCompleted')::BOOLEAN = true THEN
        v_new_completed_at := COALESCE(v_existing_assessment.completed_at, now());
    ELSE
        v_new_completed_at := v_existing_assessment.completed_at;
    END IF;

    UPDATE public.exam_question_assessments SET
        fluency_score = v_f_score,
        tajwid_score = v_t_score,
        makhraj_score = v_m_score,
        fluency_events = v_f_events,
        tajwid_events = v_t_events,
        makhraj_events = v_m_events,
        question_score = v_q_score,
        notes = v_notes,
        completed_at = v_new_completed_at,
        assessed_by_id = v_actual_examiner_id,
        assessed_by_name = v_actual_examiner_name,
        version = v_existing_assessment.version + 1,
        updated_at = now()
    WHERE id = v_existing_assessment.id
    RETURNING version INTO v_new_version;

    UPDATE public.exam_attempts SET last_saved_at = now(), updated_at = now() WHERE id = p_attempt_id;

    RETURN json_build_object(
        'success', true,
        'version', v_new_version,
        'fluencyScore', v_f_score,
        'tajwidScore', v_t_score,
        'makhrajScore', v_m_score,
        'questionScore', v_q_score,
        'maxScore', v_max_score,
        'completedAt', v_new_completed_at,
        'assessedByName', v_actual_examiner_name
    );
END;
$function$;

-- 10. Update submit_uas_attempt to support 9-question Full Juz & 4-question Partial Half-Juz + sync exam_uas_sessions
CREATE OR REPLACE FUNCTION public.submit_uas_attempt(
    p_username text,
    p_password text,
    p_attempt_id text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_attempt RECORD;
    v_question_set RECORD;
    v_period RECORD;
    v_verified RECORD;
    v_actual_examiner_id TEXT;
    v_actual_examiner_name TEXT;
    v_expected_count INTEGER;
    v_count_total INTEGER;
    v_count_completed INTEGER;
    v_valid_q_count INTEGER;
    v_total_calculated NUMERIC(6,2) := 0;
    v_mandatory_subtotal NUMERIC(6,2) := 0;
    v_random_subtotal NUMERIC(6,2) := 0;
    v_is_passed BOOLEAN;
    v_predikat TEXT;
    v_asm RECORD;
    v_max_fluency NUMERIC(5,2);
    v_max_tajwid NUMERIC(5,2);
    v_max_makhraj NUMERIC(5,2);
    v_max_score NUMERIC(5,2);
    v_event JSONB;
    v_ev_type TEXT;
    v_f_deduction NUMERIC(5,2);
    v_t_deduction NUMERIC(5,2);
    v_m_deduction NUMERIC(5,2);
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
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
        SELECT * INTO v_verified FROM public.uas_verified_examiner_sessions WHERE session_token = p_password AND expires_at > now();
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Identitas penguji belum diverifikasi.');
        END IF;
        v_actual_examiner_id := v_verified.verified_teacher_id;
        v_actual_examiner_name := v_verified.verified_teacher_name;
    ELSE
        v_actual_examiner_id := v_user.id;
        v_actual_examiner_name := v_user.name;
    END IF;

    SELECT * INTO v_attempt FROM public.exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
    END IF;

    IF v_attempt.status = 'submitted' THEN
        SELECT * INTO v_period FROM public.exam_periods WHERE id = v_attempt.exam_period_id;
        RETURN json_build_object(
            'success', true,
            'isExisting', true,
            'totalScore', v_attempt.total_score,
            'kkm', v_period.kkm,
            'isPassed', (v_attempt.total_score >= v_period.kkm),
            'submittedAt', v_attempt.submitted_at,
            'message', 'Ujian sudah disubmit sebelumnya.'
        );
    END IF;

    SELECT * INTO v_question_set FROM public.exam_question_sets WHERE id = v_attempt.question_set_id;
    IF NOT FOUND OR v_question_set.status != 'locked' THEN
        RETURN json_build_object('success', false, 'message', 'Paket soal belum terkunci atau tidak valid.');
    END IF;

    v_expected_count := CASE WHEN v_attempt.session_type = 'partial_half' THEN 4 ELSE 9 END;

    SELECT COUNT(*), COUNT(*) FILTER (WHERE completed_at IS NOT NULL)
    INTO v_count_total, v_count_completed
    FROM public.exam_question_assessments
    WHERE exam_attempt_id = p_attempt_id;

    IF v_count_total != v_expected_count OR v_count_completed != v_expected_count THEN
        RETURN json_build_object(
            'success', false,
            'message', 'Validasi gagal: Seluruh ' || v_expected_count || ' butir soal wajib diselesaikan sebelum submit final. Saat ini ' || v_count_completed || ' dari ' || v_expected_count || ' selesai.'
        );
    END IF;

    SELECT COUNT(*) INTO v_valid_q_count
    FROM public.exam_question_assessments eqa
    JOIN public.exam_questions eq ON eq.id = eqa.exam_question_id
    WHERE eqa.exam_attempt_id = p_attempt_id AND eq.question_set_id = v_attempt.question_set_id;

    IF v_valid_q_count != v_expected_count THEN
        RETURN json_build_object('success', false, 'message', 'Validasi integritas soal gagal.');
    END IF;

    FOR v_asm IN
        SELECT a.*, q.question_role, q.max_score AS question_max_score
        FROM public.exam_question_assessments a
        JOIN public.exam_questions q ON q.id = a.exam_question_id
        WHERE a.exam_attempt_id = p_attempt_id
        ORDER BY a.question_number ASC
    LOOP
        v_f_deduction := 0; v_t_deduction := 0; v_m_deduction := 0;
        IF v_asm.question_role = 'mandatory' THEN
            v_max_fluency := 9.00; v_max_tajwid := 3.00; v_max_makhraj := 3.00; v_max_score := 15.00;
        ELSIF v_asm.question_role = 'random' AND (v_attempt.session_type = 'partial_half' OR v_asm.question_max_score = 25.00) THEN
            v_max_fluency := 15.00; v_max_tajwid := 5.00; v_max_makhraj := 5.00; v_max_score := 25.00;
        ELSE
            v_max_fluency := 6.00; v_max_tajwid := 2.00; v_max_makhraj := 2.00; v_max_score := 10.00;
        END IF;

        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.fluency_events) LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'self_correction' THEN v_f_deduction := v_f_deduction + 0.5;
            ELSIF v_ev_type = 'reminder' THEN v_f_deduction := v_f_deduction + 1.0;
            ELSIF v_ev_type = 'prompt' THEN v_f_deduction := v_f_deduction + 2.0;
            ELSIF v_ev_type = 'unable' THEN v_f_deduction := v_f_deduction + 4.0;
            END IF;
        END LOOP;
        v_f_score := GREATEST(0.00, v_max_fluency - v_f_deduction);

        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.tajwid_events) LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'minor' THEN v_t_deduction := v_t_deduction + 0.5;
            ELSIF v_ev_type = 'major' THEN v_t_deduction := v_t_deduction + 1.0;
            END IF;
        END LOOP;
        v_t_score := GREATEST(0.00, v_max_tajwid - v_t_deduction);

        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.makhraj_events) LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'minor' THEN v_m_deduction := v_m_deduction + 0.5;
            ELSIF v_ev_type = 'major' THEN v_m_deduction := v_m_deduction + 1.0;
            END IF;
        END LOOP;
        v_m_score := GREATEST(0.00, v_max_makhraj - v_m_deduction);

        v_q_score := LEAST(v_max_score, GREATEST(0.00, v_f_score + v_t_score + v_m_score));

        UPDATE public.exam_question_assessments SET
            fluency_score = v_f_score,
            tajwid_score = v_t_score,
            makhraj_score = v_m_score,
            question_score = v_q_score,
            updated_at = now()
        WHERE id = v_asm.id;

        v_total_calculated := v_total_calculated + v_q_score;
        IF v_asm.question_role = 'mandatory' THEN
            v_mandatory_subtotal := v_mandatory_subtotal + v_q_score;
        ELSE
            v_random_subtotal := v_random_subtotal + v_q_score;
        END IF;
    END LOOP;

    v_total_calculated := ROUND(v_total_calculated, 2);
    IF v_total_calculated > 100.00 THEN
        RETURN json_build_object('success', false, 'message', 'Integritas nilai gagal: Total melebihi 100.');
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = v_attempt.exam_period_id;
    v_is_passed := (v_total_calculated >= v_period.kkm);
    v_predikat := CASE
        WHEN v_total_calculated >= 90 THEN 'Mumtaz'
        WHEN v_total_calculated >= 80 THEN 'Jayyid Jiddan'
        WHEN v_total_calculated >= v_period.kkm THEN 'Jayyid'
        ELSE 'Perlu Remedial'
    END;

    UPDATE public.exam_attempts SET
        status = 'submitted',
        total_score = v_total_calculated,
        submitted_at = now(),
        submitted_by_id = v_actual_examiner_id,
        submitted_by_name = v_actual_examiner_name,
        updated_at = now()
    WHERE id = p_attempt_id;

    IF v_attempt.uas_session_id IS NOT NULL THEN
        UPDATE public.exam_uas_sessions SET
            status = 'submitted',
            score = v_total_calculated,
            predikat = v_predikat,
            actual_examiner_id = v_actual_examiner_id,
            actual_examiner_name = v_actual_examiner_name,
            updated_at = now()
        WHERE id = v_attempt.uas_session_id;
    END IF;

    IF v_attempt.uas_session_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.exam_uas_sessions
        WHERE exam_period_id = v_attempt.exam_period_id
          AND student_id = v_attempt.student_id
          AND status != 'submitted'
    ) THEN
        UPDATE public.exam_examiner_assignments SET
            status = 'completed',
            updated_at = now()
        WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;
    END IF;

    RETURN json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Hasil ujian UAS berhasil dikirim dan difinalisasi.',
        'totalScore', v_total_calculated,
        'predikat', v_predikat,
        'mandatorySubtotal', ROUND(v_mandatory_subtotal, 2),
        'randomSubtotal', ROUND(v_random_subtotal, 2),
        'kkm', v_period.kkm,
        'isPassed', v_is_passed,
        'submittedAt', now()
    );
END;
$function$;

COMMIT;
