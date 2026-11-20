-- ============================================================================
-- MIGRATION: UAS Shared Examiner Account, Per-Session Verification,
--            7-Question Bank-Only Draft & Manual 2-Page Mandatory Selection
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Update Check Constraints (Additive, preserves all existing rows)
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role = ANY (ARRAY['admin'::text, 'teacher'::text, 'parent'::text, 'shared_uas_examiner'::text]));

ALTER TABLE public.exam_question_sets DROP CONSTRAINT IF EXISTS exam_question_sets_status_check;
ALTER TABLE public.exam_question_sets ADD CONSTRAINT exam_question_sets_status_check
    CHECK (status = ANY (ARRAY['generated'::text, 'pending_mandatory'::text, 'locked'::text, 'void'::text, 'stale'::text]));

ALTER TABLE public.exam_questions DROP CONSTRAINT IF EXISTS exam_questions_source_type_check;
ALTER TABLE public.exam_questions ADD CONSTRAINT exam_questions_source_type_check
    CHECK (source_type = ANY (ARRAY['bank'::text, 'auto'::text, 'manual_mushaf'::text]));

-- 2. PIN Table for 16 Teachers (Admin-managed, bcrypt hashed, RLS enabled)
CREATE TABLE IF NOT EXISTS public.uas_examiner_pins (
    teacher_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.uas_examiner_pins ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.uas_examiner_pins ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE public.uas_examiner_pins ENABLE ROW LEVEL SECURITY;

-- 3. Verified Examiner Session Mapping (bound to sessionToken)
CREATE TABLE IF NOT EXISTS public.uas_verified_examiner_sessions (
    session_token TEXT PRIMARY KEY,
    shared_account_id TEXT NOT NULL,
    verified_teacher_id TEXT NOT NULL REFERENCES public.users(id),
    verified_teacher_name TEXT NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '12 hours')
);
ALTER TABLE public.uas_verified_examiner_sessions ENABLE ROW LEVEL SECURITY;

-- 4. Additive Examiner Audit Columns on exam_attempts
ALTER TABLE public.exam_attempts ADD COLUMN IF NOT EXISTS actual_examiner_id TEXT;
ALTER TABLE public.exam_attempts ADD COLUMN IF NOT EXISTS actual_examiner_name TEXT;
ALTER TABLE public.exam_attempts ADD COLUMN IF NOT EXISTS login_account_id TEXT;
ALTER TABLE public.exam_attempts ADD COLUMN IF NOT EXISTS login_account_username TEXT;
ALTER TABLE public.exam_attempts ADD COLUMN IF NOT EXISTS session_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.exam_attempts ADD COLUMN IF NOT EXISTS examiner_verified_at TIMESTAMPTZ;

ALTER TABLE public.exam_attempts ADD COLUMN IF NOT EXISTS submitted_by_id TEXT;
ALTER TABLE public.exam_attempts ADD COLUMN IF NOT EXISTS submitted_by_name TEXT;
ALTER TABLE public.exam_attempts ADD COLUMN IF NOT EXISTS examiner_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.exam_question_assessments ADD COLUMN IF NOT EXISTS assessed_by_id TEXT;
ALTER TABLE public.exam_question_assessments ADD COLUMN IF NOT EXISTS assessed_by_name TEXT;

CREATE OR REPLACE FUNCTION public.revoke_uas_shared_sessions_secure(
    p_username text,
    p_password text,
    p_account_username text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang dapat mencabut sesi akun bersama UAS.');
    END IF;

    DELETE FROM public.uas_verified_examiner_sessions v
    WHERE p_account_username IS NULL
       OR v.shared_account_id IN (SELECT id FROM public.users WHERE username = trim(p_account_username));

    DELETE FROM public.user_sessions s
    WHERE s.role = 'shared_uas_examiner'
      AND (p_account_username IS NULL OR s.username = trim(p_account_username));

    RETURN jsonb_build_object('success', true, 'message', 'Sesi akun bersama UAS berhasil dicabut.');
END;
$function$;


-- 5. Admin RPC: Configure/Activate Shared UAS Account (no hardcoded password in source)
CREATE OR REPLACE FUNCTION public.configure_shared_uas_account_secure(
    p_username text,
    p_password text,
    p_account_username text,
    p_account_name text DEFAULT 'Akun Penguji Bersama UAS',
    p_new_password text DEFAULT NULL,
    p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_target_id TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang dapat mengelola akun bersama UAS.');
    END IF;

    SELECT id INTO v_target_id FROM public.users WHERE username = trim(p_account_username) LIMIT 1;

    IF v_target_id IS NULL THEN
        IF p_new_password IS NULL OR length(trim(p_new_password)) < 6 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Password minimal 6 karakter wajib diisi saat membuat akun bersama baru.');
        END IF;
        v_target_id := 'uas_shared_' || floor(extract(epoch from now()))::text;
        INSERT INTO public.users (id, name, role, username, password)
        VALUES (
            v_target_id,
            COALESCE(NULLIF(trim(p_account_name), ''), 'Akun Penguji Bersama UAS'),
            'shared_uas_examiner',
            trim(p_account_username),
            crypt(trim(p_new_password), gen_salt('bf'))
        );
    ELSE
        UPDATE public.users
        SET
            name = COALESCE(NULLIF(trim(p_account_name), ''), name),
            role = CASE WHEN p_is_active THEN 'shared_uas_examiner' ELSE role END,
            password = CASE WHEN p_new_password IS NOT NULL AND length(trim(p_new_password)) >= 6 THEN crypt(trim(p_new_password), gen_salt('bf')) ELSE password END
        WHERE id = v_target_id;
    END IF;

    IF NOT COALESCE(p_is_active, true) THEN
        DELETE FROM public.uas_verified_examiner_sessions WHERE shared_account_id = v_target_id;
        DELETE FROM public.user_sessions WHERE user_id = v_target_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'accountId', v_target_id, 'username', trim(p_account_username));
END;
$function$;

-- 6. Admin RPC: Set/Rotate Individual Teacher Examiner PIN (bcrypt hashed)
CREATE OR REPLACE FUNCTION public.set_uas_examiner_pin_secure(
    p_username text,
    p_password text,
    p_teacher_id text,
    p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_teacher RECORD;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang dapat mengatur PIN penguji UAS.');
    END IF;

    IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
        RETURN jsonb_build_object('success', false, 'message', 'PIN penguji minimal 4 karakter.');
    END IF;

    SELECT id, name, role INTO v_teacher FROM public.users WHERE id = p_teacher_id;
    IF v_teacher.id IS NULL OR v_teacher.role NOT IN ('teacher', 'admin') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Guru penguji tidak ditemukan.');
    END IF;

    INSERT INTO public.uas_examiner_pins (teacher_id, pin_hash, is_active, failed_attempts, locked_until, updated_by, updated_at)
    VALUES (p_teacher_id, crypt(trim(p_pin), gen_salt('bf')), true, 0, NULL, v_auth.out_user_id, now())
    ON CONFLICT (teacher_id) DO UPDATE SET
        pin_hash = EXCLUDED.pin_hash,
        is_active = true,
        failed_attempts = 0,
        locked_until = NULL,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

    RETURN jsonb_build_object('success', true, 'teacherId', v_teacher.id, 'teacherName', v_teacher.name);
END;
$function$;

-- 7. List Active Teachers for Shared Examiner Selection (no PINs exposed)
CREATE OR REPLACE FUNCTION public.get_uas_active_teachers(
    p_username text,
    p_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_teachers JSONB;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role NOT IN ('shared_uas_examiner', 'admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'name', u.name,
        'username', u.username,
        'hasPin', EXISTS (SELECT 1 FROM public.uas_examiner_pins p WHERE p.teacher_id = u.id AND p.is_active = true)
    ) ORDER BY u.name ASC)
    INTO v_teachers
    FROM public.users u
    WHERE u.role = 'teacher';

    RETURN jsonb_build_object('success', true, 'teachers', COALESCE(v_teachers, '[]'::jsonb));
END;
$function$;

-- 8. Verify Personal Identity of Examiner on Shared UAS Account
CREATE OR REPLACE FUNCTION public.verify_uas_examiner_identity(
    p_username text,
    p_password text,
    p_teacher_id text,
    p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_teacher RECORD;
    v_pin_row RECORD;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role NOT IN ('shared_uas_examiner', 'admin') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya akun bersama UAS atau Admin yang dapat memverifikasi penguji.');
    END IF;

    SELECT id, name, username, role INTO v_teacher FROM public.users WHERE id = p_teacher_id;
    IF v_teacher.id IS NULL OR v_teacher.role != 'teacher' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Penguji tidak ditemukan atau bukan guru aktif.');
    END IF;

    SELECT * INTO v_pin_row FROM public.uas_examiner_pins WHERE teacher_id = p_teacher_id AND is_active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'PIN penguji belum diterbitkan oleh Admin untuk ' || v_teacher.name || '.');
    END IF;

    IF v_pin_row.locked_until IS NOT NULL AND v_pin_row.locked_until > now() THEN
        RETURN jsonb_build_object('success', false, 'message', 'Verifikasi PIN untuk ' || v_teacher.name || ' terkunci sementara 15 menit karena terlalu banyak percobaan salah.');
    END IF;

    IF crypt(trim(COALESCE(p_pin, '')), v_pin_row.pin_hash) != v_pin_row.pin_hash THEN
        UPDATE public.uas_examiner_pins
        SET failed_attempts = COALESCE(failed_attempts, 0) + 1,
            locked_until = CASE WHEN COALESCE(failed_attempts, 0) + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
            updated_at = now()
        WHERE teacher_id = p_teacher_id;
        RETURN jsonb_build_object('success', false, 'message', 'PIN verifikasi penguji salah.');
    END IF;

    UPDATE public.uas_examiner_pins
    SET failed_attempts = 0, locked_until = NULL, updated_at = now()
    WHERE teacher_id = p_teacher_id;

    INSERT INTO public.uas_verified_examiner_sessions (
        session_token, shared_account_id, verified_teacher_id, verified_teacher_name, verified_at, expires_at
    ) VALUES (
        p_password, v_auth.out_user_id, v_teacher.id, v_teacher.name, now(), now() + interval '12 hours'
    )
    ON CONFLICT (session_token) DO UPDATE SET
        shared_account_id = EXCLUDED.shared_account_id,
        verified_teacher_id = EXCLUDED.verified_teacher_id,
        verified_teacher_name = EXCLUDED.verified_teacher_name,
        verified_at = now(),
        expires_at = now() + interval '12 hours';

    INSERT INTO public.exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        NULL, NULL, 'VERIFY_UAS_EXAMINER', v_teacher.id,
        jsonb_build_object('sharedAccountId', v_auth.out_user_id, 'sharedUsername', v_auth.out_username, 'verifiedTeacherId', v_teacher.id, 'verifiedTeacherName', v_teacher.name),
        'Verifikasi identitas penguji UAS pada akun bersama', now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'verifiedExaminer', jsonb_build_object(
            'teacherId', v_teacher.id,
            'teacherName', v_teacher.name,
            'verifiedAt', now()
        )
    );
END;
$function$;

-- 9. Update generate_uas_question_set to support BOTH:
--    (a) 7-question 'pending_mandatory' draft from Bank Soal (Q3..Q9, total 70)
--    (b) 9-question 'locked' full set (Q1..Q2 mandatory + Q3..Q9 Bank Soal, total 100)
CREATE OR REPLACE FUNCTION public.generate_uas_question_set(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text,
    p_strategy text DEFAULT 'hybrid'::text,
    p_seed text DEFAULT NULL::text,
    p_questions jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user_id TEXT;
    v_user_role TEXT;
    v_exam_type TEXT;
    v_period_status TEXT;
    v_snapshot_id TEXT;
    v_snapshot_status TEXT;
    v_snap_start_surah INTEGER;
    v_snap_start_ayah INTEGER;
    v_snap_end_surah INTEGER;
    v_snap_end_ayah INTEGER;
    v_snap_min_surah INTEGER;
    v_snap_min_ayah INTEGER;
    v_snap_max_surah INTEGER;
    v_snap_max_ayah INTEGER;
    v_material_fingerprint TEXT;
    v_existing_set_id TEXT;
    v_existing_status TEXT;
    v_existing_fingerprint TEXT;
    v_new_set_id TEXT;
    v_q_elem JSONB;
    v_total_score NUMERIC := 0;
    v_mandatory_count INTEGER := 0;
    v_random_count INTEGER := 0;
    v_q_count INTEGER := 0;
    v_q_num INTEGER;
    v_q_role TEXT;
    v_q_score NUMERIC;
    v_q_zone INTEGER;
    v_q_source TEXT;
    v_q_bank_id TEXT;
    v_q_page INTEGER;
    v_as_surah INTEGER;
    v_as_ayah INTEGER;
    v_as_word INTEGER;
    v_ae_surah INTEGER;
    v_ae_ayah INTEGER;
    v_ae_word INTEGER;
    v_ps_surah INTEGER;
    v_ps_ayah INTEGER;
    v_ps_word INTEGER;
    v_pe_surah INTEGER;
    v_pe_ayah INTEGER;
    v_pe_word INTEGER;
    v_bank_row RECORD;
    v_used_random_b TEXT[] := ARRAY[]::TEXT[];
    v_used_mand_pages INTEGER[] := ARRAY[]::INTEGER[];
    v_used_zones INTEGER[] := ARRAY[]::INTEGER[];
    v_b_key TEXT;
    v_ret_questions JSONB;
    v_final_seed TEXT;
    v_target_set_status TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa.');
    END IF;
    v_user_id := v_auth.out_user_id;
    v_user_role := v_auth.out_role;

    IF v_user_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berwenang membangkitkan paket soal UAS.');
    END IF;

    SELECT exam_type, status INTO v_exam_type, v_period_status FROM exam_periods WHERE id = p_period_id;
    IF v_exam_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;
    IF v_exam_type != 'uas' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Generator ini khusus untuk periode ujian UAS.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM exam_participants WHERE exam_period_id = p_period_id AND student_id = p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Santri tidak terdaftar pada periode ujian UAS ini.');
    END IF;

    SELECT id, status, start_surah, start_ayah, end_surah, end_ayah,
           calculate_material_fingerprint(start_surah, start_ayah, end_surah, end_ayah, COALESCE(memorization_direction, 'forward'))
    INTO v_snapshot_id, v_snapshot_status, v_snap_start_surah, v_snap_start_ayah, v_snap_end_surah, v_snap_end_ayah, v_material_fingerprint
    FROM exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF v_snapshot_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Snapshot materi UAS santri belum dibuat.');
    END IF;
    IF v_snapshot_status != 'finalized' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Materi UAS santri belum difinalisasi.');
    END IF;

    v_snap_min_surah := LEAST(v_snap_start_surah, v_snap_end_surah);
    v_snap_max_surah := GREATEST(v_snap_start_surah, v_snap_end_surah);
    IF v_snap_start_surah = v_snap_end_surah THEN
        v_snap_min_ayah := LEAST(v_snap_start_ayah, v_snap_end_ayah);
        v_snap_max_ayah := GREATEST(v_snap_start_ayah, v_snap_end_ayah);
    ELSE
        v_snap_min_ayah := CASE WHEN v_snap_start_surah < v_snap_end_surah THEN v_snap_start_ayah ELSE v_snap_end_ayah END;
        v_snap_max_ayah := CASE WHEN v_snap_start_surah > v_snap_end_surah THEN v_snap_start_ayah ELSE v_snap_end_ayah END;
    END IF;

    -- Idempotency: keep existing locked or pending_mandatory set if fingerprint matches
    SELECT id, status, material_fingerprint
    INTO v_existing_set_id, v_existing_status, v_existing_fingerprint
    FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status IN ('locked', 'pending_mandatory')
    ORDER BY version DESC LIMIT 1;

    IF v_existing_set_id IS NOT NULL AND v_existing_fingerprint = v_material_fingerprint THEN
        SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
        INTO v_ret_questions
        FROM exam_questions eq WHERE eq.question_set_id = v_existing_set_id;

        RETURN jsonb_build_object(
            'success', true,
            'isExisting', true,
            'message', 'Paket soal UAS sudah tersedia.',
            'questionSet', (SELECT row_to_json(eqs.*) FROM exam_question_sets eqs WHERE eqs.id = v_existing_set_id),
            'questions', COALESCE(v_ret_questions, '[]'::jsonb)
        );
    END IF;

    v_q_count := jsonb_array_length(p_questions);
    IF v_q_count NOT IN (7, 9) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket UAS harus berisi 7 soal acak (draft) atau 9 soal lengkap. Diterima: ' || v_q_count);
    END IF;

    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        v_q_num := (v_q_elem->>'questionNumber')::INTEGER;
        v_q_role := COALESCE(v_q_elem->>'questionRole', v_q_elem->>'question_role');
        v_q_score := COALESCE((v_q_elem->>'maxScore')::NUMERIC, (v_q_elem->>'max_score')::NUMERIC, 0);
        v_q_zone := (v_q_elem->>'zoneNumber')::INTEGER;
        v_q_source := COALESCE(v_q_elem->>'sourceType', v_q_elem->>'source_type', 'bank');
        v_q_bank_id := v_q_elem->>'questionBankId';
        v_q_page := (v_q_elem->>'pageNumber')::INTEGER;

        v_as_surah := COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER);
        v_as_ayah := COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER);
        v_as_word := COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER);
        v_ae_surah := COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER);
        v_ae_ayah := COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER);
        v_ae_word := COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER);

        IF v_as_surah NOT BETWEEN 1 AND 114 OR v_as_ayah < 1 OR v_as_word < 1 OR
           v_ae_surah NOT BETWEEN 1 AND 114 OR v_ae_ayah < 1 OR v_ae_word < 1 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Koordinat ayat/kata butir soal ' || v_q_num || ' tidak valid.');
        END IF;

        IF (v_as_surah > v_ae_surah) OR (v_as_surah = v_ae_surah AND v_as_ayah > v_ae_ayah) OR (v_as_surah = v_ae_surah AND v_as_ayah = v_ae_ayah AND v_as_word > v_ae_word) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Urutan jawaban B ke C pada butir soal ' || v_q_num || ' tidak valid.');
        END IF;

        IF (v_as_surah < v_snap_min_surah) OR (v_as_surah = v_snap_min_surah AND v_as_ayah < v_snap_min_ayah) OR
           (v_ae_surah > v_snap_max_surah) OR (v_ae_surah = v_snap_max_surah AND v_ae_ayah > v_snap_max_ayah) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Titik soal nomor ' || v_q_num || ' berada di luar batas snapshot materi santri.');
        END IF;

        v_total_score := v_total_score + v_q_score;

        IF v_q_role = 'mandatory' THEN
            v_mandatory_count := v_mandatory_count + 1;
            IF v_q_num NOT IN (1, 2) OR v_q_score != 15 OR v_q_zone IS NOT NULL OR v_q_page IS NULL OR v_q_page NOT BETWEEN 1 AND 604 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Metadata soal wajib nomor ' || v_q_num || ' tidak valid.');
            END IF;
            IF v_q_page = ANY(v_used_mand_pages) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Kedua halaman soal wajib harus berbeda.');
            END IF;
            v_used_mand_pages := array_append(v_used_mand_pages, v_q_page);
        ELSIF v_q_role = 'random' THEN
            v_random_count := v_random_count + 1;
            IF v_q_num NOT BETWEEN 3 AND 9 OR v_q_score != 10 OR v_q_zone IS NULL OR v_q_zone NOT BETWEEN 1 AND 7 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Metadata soal acak nomor ' || v_q_num || ' tidak valid.');
            END IF;
            IF v_q_zone = ANY(v_used_zones) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Duplikasi zona ' || v_q_zone || '.');
            END IF;
            v_used_zones := array_append(v_used_zones, v_q_zone);

            v_ps_surah := (v_q_elem->'promptStart'->>'surahNumber')::INTEGER;
            v_ps_ayah := (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER;
            v_ps_word := (v_q_elem->'promptStart'->>'wordPosition')::INTEGER;
            v_pe_surah := (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER;
            v_pe_ayah := (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER;
            v_pe_word := (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER;

            IF v_ps_surah IS NULL OR v_pe_surah IS NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak wajib memiliki prompt penguji.');
            END IF;
            IF (v_pe_surah > v_as_surah) OR (v_pe_surah = v_as_surah AND v_pe_ayah > v_as_ayah) OR (v_pe_surah = v_as_surah AND v_pe_ayah = v_as_ayah AND v_pe_word >= v_as_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik B harus setelah A-aksen pada soal ' || v_q_num);
            END IF;

            v_b_key := v_as_surah || ':' || v_as_ayah || ':' || v_as_word;
            IF v_b_key = ANY(v_used_random_b) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Duplikasi titik B soal acak: ' || v_b_key);
            END IF;
            v_used_random_b := array_append(v_used_random_b, v_b_key);

            IF v_q_source = 'bank' THEN
                SELECT id, status, exam_type, question_type INTO v_bank_row FROM question_bank WHERE id = v_q_bank_id;
                IF v_bank_row.id IS NULL OR v_bank_row.status != 'active' OR v_bank_row.exam_type NOT IN ('uas', 'generic') OR v_bank_row.question_type != 'random' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || COALESCE(v_q_bank_id, 'NULL') || ' tidak valid untuk soal acak UAS.');
                END IF;
            END IF;
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Role soal tidak valid.');
        END IF;
    END LOOP;

    IF v_q_count = 7 THEN
        IF v_mandatory_count != 0 OR v_random_count != 7 OR v_total_score != 70 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Draft massal UAS harus tepat 7 soal acak (total skor 70).');
        END IF;
        v_target_set_status := 'pending_mandatory';
    ELSE
        IF v_mandatory_count != 2 OR v_random_count != 7 OR v_total_score != 100 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Paket lengkap UAS harus tepat 2 wajib + 7 acak (total skor 100).');
        END IF;
        v_target_set_status := 'locked';
    END IF;

    v_final_seed := COALESCE(p_seed, 'seed_uas_' || p_period_id || '_' || p_student_id || '_' || floor(extract(epoch from now())));
    v_new_set_id := 'eqs_uas_' || p_period_id || '_' || p_student_id || '_v1';

    UPDATE exam_question_sets SET status = 'void' WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status != 'void';

    INSERT INTO exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id, version,
        generation_strategy, generation_seed, material_fingerprint, status,
        generated_by, generated_at, locked_at, total_questions, created_at, updated_at
    ) VALUES (
        v_new_set_id, p_period_id, p_student_id, v_snapshot_id, 1,
        COALESCE(p_strategy, 'bank_only'), v_final_seed, v_material_fingerprint, v_target_set_status,
        v_user_id, now(), CASE WHEN v_target_set_status = 'locked' THEN now() ELSE NULL END, v_q_count, now(), now()
    );

    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        v_q_num := (v_q_elem->>'questionNumber')::INTEGER;
        v_q_role := COALESCE(v_q_elem->>'questionRole', v_q_elem->>'question_role');
        v_q_score := COALESCE((v_q_elem->>'maxScore')::NUMERIC, (v_q_elem->>'max_score')::NUMERIC, 0);
        v_q_zone := (v_q_elem->>'zoneNumber')::INTEGER;
        v_q_source := COALESCE(v_q_elem->>'sourceType', v_q_elem->>'source_type', 'bank');
        v_q_bank_id := v_q_elem->>'questionBankId';
        v_q_page := (v_q_elem->>'pageNumber')::INTEGER;

        INSERT INTO exam_questions (
            id, question_set_id, question_number, zone_number, question_role, source_type, question_bank_id,
            page_number, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'eq_uas_' || v_new_set_id || '_q' || v_q_num, v_new_set_id, v_q_num, v_q_zone, v_q_role, v_q_source, v_q_bank_id,
            v_q_page, v_q_score,
            (v_q_elem->'promptStart'->>'surahNumber')::INTEGER, (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER, (v_q_elem->'promptStart'->>'wordPosition')::INTEGER,
            (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER, (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER, (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER,
            COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER),
            COALESCE((v_q_elem->>'startPage')::INTEGER, v_q_page),
            COALESCE((v_q_elem->>'endPage')::INTEGER, v_q_page),
            COALESCE(v_q_elem->'metadata', '{}'::jsonb), now()
        );
    END LOOP;

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number) INTO v_ret_questions
    FROM exam_questions eq WHERE eq.question_set_id = v_new_set_id;

    RETURN jsonb_build_object(
        'success', true,
        'isExisting', false,
        'message', CASE WHEN v_target_set_status = 'pending_mandatory' THEN 'Draft 7 soal acak UAS berhasil disimpan.' ELSE 'Paket 9 soal UAS berhasil dibuat dan dikunci.' END,
        'questionSet', (SELECT row_to_json(eqs.*) FROM exam_question_sets eqs WHERE eqs.id = v_new_set_id),
        'questions', COALESCE(v_ret_questions, '[]'::jsonb)
    );
END;
$function$;

-- 10. Manual Mandatory Selection RPC by Verified Examiner (locks Q1 & Q2 -> total 9 questions)
CREATE OR REPLACE FUNCTION public.select_uas_mandatory_pages(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text,
    p_q1_payload jsonb,
    p_q2_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_verified RECORD;
    v_examiner_id TEXT;
    v_examiner_name TEXT;
    v_snapshot RECORD;
    v_set RECORD;
    v_snap_min_surah INTEGER;
    v_snap_min_ayah INTEGER;
    v_snap_max_surah INTEGER;
    v_snap_max_ayah INTEGER;
    v_p1 INTEGER;
    v_p2 INTEGER;
    v_elem JSONB;
    v_q_num INTEGER;
    v_as_surah INTEGER;
    v_as_ayah INTEGER;
    v_as_word INTEGER;
    v_ae_surah INTEGER;
    v_ae_ayah INTEGER;
    v_ae_word INTEGER;
    v_q_source TEXT;
    v_q_bank_id TEXT;
    v_ret_questions JSONB;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role NOT IN ('shared_uas_examiner', 'teacher', 'admin') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    IF v_auth.out_role = 'shared_uas_examiner' THEN
        SELECT * INTO v_verified FROM public.uas_verified_examiner_sessions
        WHERE session_token = p_password AND expires_at > now();
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', 'Identitas penguji UAS belum diverifikasi.');
        END IF;
        v_examiner_id := v_verified.verified_teacher_id;
        v_examiner_name := v_verified.verified_teacher_name;
    ELSE
        SELECT id, name INTO v_examiner_id, v_examiner_name FROM public.users WHERE id = v_auth.out_user_id;
    END IF;

    SELECT * INTO v_snapshot FROM exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Snapshot materi UAS belum difinalisasi.');
    END IF;

    SELECT * INTO v_set FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status IN ('pending_mandatory', 'locked')
    ORDER BY version DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Draft 7 soal acak belum disiapkan untuk santri ini.');
    END IF;

    IF v_set.status = 'locked' AND EXISTS (SELECT 1 FROM exam_questions WHERE question_set_id = v_set.id AND question_role = 'mandatory') THEN
        RETURN jsonb_build_object('success', false, 'message', '2 soal wajib sudah dipilih dan dikunci sebelumnya.');
    END IF;

    v_p1 := (p_q1_payload->>'pageNumber')::INTEGER;
    v_p2 := (p_q2_payload->>'pageNumber')::INTEGER;
    IF v_p1 IS NULL OR v_p2 IS NULL OR v_p1 = v_p2 OR v_p1 NOT BETWEEN 1 AND 604 OR v_p2 NOT BETWEEN 1 AND 604 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Penguji wajib memilih tepat 2 halaman penuh yang berbeda (1–604).');
    END IF;

    v_snap_min_surah := LEAST(v_snapshot.start_surah, v_snapshot.end_surah);
    v_snap_max_surah := GREATEST(v_snapshot.start_surah, v_snapshot.end_surah);
    IF v_snapshot.start_surah = v_snapshot.end_surah THEN
        v_snap_min_ayah := LEAST(v_snapshot.start_ayah, v_snapshot.end_ayah);
        v_snap_max_ayah := GREATEST(v_snapshot.start_ayah, v_snapshot.end_ayah);
    ELSE
        v_snap_min_ayah := CASE WHEN v_snapshot.start_surah < v_snapshot.end_surah THEN v_snapshot.start_ayah ELSE v_snapshot.end_ayah END;
        v_snap_max_ayah := CASE WHEN v_snapshot.start_surah > v_snapshot.end_surah THEN v_snapshot.start_ayah ELSE v_snapshot.end_ayah END;
    END IF;

    FOR v_q_num IN 1..2 LOOP
        v_elem := CASE WHEN v_q_num = 1 THEN p_q1_payload ELSE p_q2_payload END;
        v_as_surah := (v_elem->'answerStart'->>'surahNumber')::INTEGER;
        v_as_ayah := (v_elem->'answerStart'->>'ayahNumber')::INTEGER;
        v_as_word := COALESCE((v_elem->'answerStart'->>'wordPosition')::INTEGER, 1);
        v_ae_surah := (v_elem->'answerEnd'->>'surahNumber')::INTEGER;
        v_ae_ayah := (v_elem->'answerEnd'->>'ayahNumber')::INTEGER;
        v_ae_word := COALESCE((v_elem->'answerEnd'->>'wordPosition')::INTEGER, 1);
        v_q_source := COALESCE(v_elem->>'sourceType', 'manual_mushaf');
        v_q_bank_id := v_elem->>'questionBankId';

        IF (v_as_surah < v_snap_min_surah) OR (v_as_surah = v_snap_min_surah AND v_as_ayah < v_snap_min_ayah) OR
           (v_ae_surah > v_snap_max_surah) OR (v_ae_surah = v_snap_max_surah AND v_ae_ayah > v_snap_max_ayah) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Halaman wajib yang dipilih berada di luar cakupan materi finalized santri.');
        END IF;

        INSERT INTO exam_questions (
            id, question_set_id, question_number, zone_number, question_role, source_type, question_bank_id,
            page_number, max_score,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'eq_uas_' || v_set.id || '_q' || v_q_num, v_set.id, v_q_num, NULL, 'mandatory', v_q_source, v_q_bank_id,
            CASE WHEN v_q_num = 1 THEN v_p1 ELSE v_p2 END, 15,
            v_as_surah, v_as_ayah, v_as_word,
            v_ae_surah, v_ae_ayah, v_ae_word,
            CASE WHEN v_q_num = 1 THEN v_p1 ELSE v_p2 END,
            CASE WHEN v_q_num = 1 THEN v_p1 ELSE v_p2 END,
            COALESCE(v_elem->'metadata', '{}'::jsonb), now()
        ) ON CONFLICT (id) DO NOTHING;
    END LOOP;

    UPDATE exam_question_sets
    SET status = 'locked', total_questions = 9, locked_at = now(), updated_at = now()
    WHERE id = v_set.id;

    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id, p_student_id, 'SELECT_UAS_MANDATORY_PAGES', v_examiner_id,
        jsonb_build_object('questionSetId', v_set.id, 'page1', v_p1, 'page2', v_p2, 'examinerId', v_examiner_id, 'examinerName', v_examiner_name, 'loginAccountId', v_auth.out_user_id),
        'Pemilihan manual 2 soal wajib halaman penuh UAS oleh penguji', now()
    );

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number) INTO v_ret_questions
    FROM exam_questions eq WHERE eq.question_set_id = v_set.id;

    RETURN jsonb_build_object(
        'success', true,
        'questionSet', (SELECT row_to_json(eqs.*) FROM exam_question_sets eqs WHERE eqs.id = v_set.id),
        'questions', COALESCE(v_ret_questions, '[]'::jsonb)
    );
END;
$function$;

-- 11. Update get_examiner_uas_students to support shared_uas_examiner (all 240 official participants)
CREATE OR REPLACE FUNCTION public.get_examiner_uas_students(p_username text, p_password text, p_period_id text)
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
    v_students JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role NOT IN ('admin', 'teacher', 'shared_uas_examiner') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    IF v_user.role = 'shared_uas_examiner' THEN
        SELECT * INTO v_verified FROM public.uas_verified_examiner_sessions
        WHERE session_token = p_password AND expires_at > now();
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'requiresExaminerVerification', true, 'message', 'Identitas penguji UAS belum diverifikasi.');
        END IF;
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND OR v_period.exam_type != 'uas' THEN
        RETURN json_build_object('success', false, 'message', 'Periode UAS tidak ditemukan.');
    END IF;

    SELECT json_agg(json_build_object(
        'studentId', s.id,
        'studentName', s.name,
        'studentNis', s.nis,
        'class', s.class,
        'halaqah', s.halaqah,
        'teacherId', s.teacher_id,
        'teacherName', tu.name,
        'examinerId', COALESCE(att.actual_examiner_id, a.examiner_user_id, p.teacher_id_snapshot, s.teacher_id),
        'examinerName', COALESCE(att.actual_examiner_name, eu.name, tu.name, 'Penguji UAS'),
        'hasAssignment', (a.id IS NOT NULL),
        'snapshotId', snap.id,
        'snapshotStatus', snap.status,
        'startSurah', snap.start_surah,
        'startAyah', snap.start_ayah,
        'endSurah', snap.end_surah,
        'endAyah', snap.end_ayah,
        'startPage', snap.start_page,
        'endPage', snap.end_page,
        'startSurahName', snap.start_surah_name,
        'endSurahName', snap.end_surah_name,
        'memorizationDirection', snap.memorization_direction,
        'questionSetId', qs.id,
        'questionSetStatus', qs.status,
        'questionSetVersion', qs.version,
        'isStale', (
            snap.status = 'finalized' AND qs.status IS NOT NULL AND
            qs.material_fingerprint != calculate_material_fingerprint(snap.start_surah, snap.start_ayah, snap.end_surah, snap.end_ayah, snap.memorization_direction)
        ),
        'attemptId', att.id,
        'attemptStatus', att.status,
        'attemptNumber', att.attempt_number,
        'sessionNumber', COALESCE(att.session_number, 1),
        'actualExaminerId', att.actual_examiner_id,
        'actualExaminerName', att.actual_examiner_name,
        'totalScore', att.total_score,
        'startedAt', att.started_at,
        'submittedAt', att.submitted_at,
        'completedQuestionsCount', COALESCE((
            SELECT COUNT(*) FROM exam_question_assessments eqa
            WHERE eqa.exam_attempt_id = att.id AND eqa.completed_at IS NOT NULL
        ), 0)
    ) ORDER BY s.class ASC, s.name ASC) INTO v_students
    FROM exam_participants p
    JOIN students s ON s.id = p.student_id
    LEFT JOIN users tu ON tu.id = s.teacher_id
    LEFT JOIN exam_examiner_assignments a ON a.exam_period_id = p.exam_period_id AND a.student_id = p.student_id
    LEFT JOIN users eu ON eu.id = a.examiner_user_id
    LEFT JOIN exam_material_snapshots snap ON snap.exam_period_id = p.exam_period_id AND snap.student_id = p.student_id
    LEFT JOIN exam_question_sets qs ON qs.exam_period_id = p.exam_period_id AND qs.student_id = p.student_id AND qs.status IN ('locked', 'pending_mandatory', 'stale')
    LEFT JOIN LATERAL (
        SELECT * FROM exam_attempts ea
        WHERE ea.exam_period_id = p.exam_period_id AND ea.student_id = p.student_id AND ea.status IN ('in_progress', 'submitted')
        ORDER BY ea.attempt_number DESC LIMIT 1
    ) att ON true
    WHERE p.exam_period_id = p_period_id
      AND s.class NOT ILIKE '%7-UJI%'
      AND (
          v_user.role IN ('admin', 'shared_uas_examiner')
          OR a.examiner_user_id = v_user.id
          OR (a.examiner_user_id IS NULL AND (p.teacher_id_snapshot = v_user.id OR s.teacher_id = v_user.id))
      );

    RETURN json_build_object(
        'success', true,
        'period', json_build_object('id', v_period.id, 'name', v_period.name, 'kkm', v_period.kkm, 'status', v_period.status),
        'students', COALESCE(v_students, '[]'::json)
    );
END;
$function$;

-- 12. Update start_uas_attempt for shared_uas_examiner + multi-session + actual examiner tracking
CREATE OR REPLACE FUNCTION public.start_uas_attempt(p_username text, p_password text, p_period_id text, p_student_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_verified RECORD;
    v_actual_examiner_id TEXT;
    v_actual_examiner_name TEXT;
    v_verified_at TIMESTAMPTZ;
    v_period RECORD;
    v_participant RECORD;
    v_snapshot RECORD;
    v_question_set RECORD;
    v_assignment RECORD;
    v_existing_attempt RECORD;
    v_attempt_id TEXT;
    v_next_attempt_num INTEGER := 1;
    v_questions JSON;
    v_assessments JSON;
    v_q RECORD;
    v_calc_fingerprint TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role NOT IN ('admin', 'teacher', 'shared_uas_examiner') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    IF v_user.role = 'shared_uas_examiner' THEN
        SELECT * INTO v_verified FROM public.uas_verified_examiner_sessions
        WHERE session_token = p_password AND expires_at > now();
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'message', 'Identitas penguji UAS belum diverifikasi.');
        END IF;
        v_actual_examiner_id := v_verified.verified_teacher_id;
        v_actual_examiner_name := v_verified.verified_teacher_name;
        v_verified_at := v_verified.verified_at;
    ELSE
        v_actual_examiner_id := v_user.id;
        v_actual_examiner_name := v_user.name;
        v_verified_at := now();
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND OR v_period.exam_type != 'uas' THEN
        RETURN json_build_object('success', false, 'message', 'Periode UAS tidak ditemukan.');
    END IF;
    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    SELECT * INTO v_participant FROM exam_participants WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Santri bukan peserta resmi periode ujian ini.');
    END IF;

    IF v_user.role = 'teacher' THEN
        SELECT * INTO v_assignment FROM exam_examiner_assignments WHERE exam_period_id = p_period_id AND student_id = p_student_id;
        IF FOUND THEN
            IF v_assignment.examiner_user_id != v_user.id THEN
                RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk santri ini.');
            END IF;
        ELSIF v_participant.teacher_id_snapshot != v_user.id AND (SELECT teacher_id FROM students WHERE id = p_student_id) != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan guru halaqah santri ini.');
        END IF;
    END IF;

    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Materi UAS santri belum difinalisasi.');
    END IF;

    SELECT * INTO v_question_set FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status IN ('locked', 'pending_mandatory')
    ORDER BY version DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal UAS belum disiapkan.');
    END IF;
    IF v_question_set.status = 'pending_mandatory' THEN
        RETURN json_build_object('success', false, 'requiresManualMandatory', true, 'message', 'Silakan pilih 2 soal wajib halaman penuh terlebih dahulu.');
    END IF;

    v_calc_fingerprint := calculate_material_fingerprint(v_snapshot.start_surah, v_snapshot.start_ayah, v_snapshot.end_surah, v_snapshot.end_ayah, v_snapshot.memorization_direction);
    IF v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal berstatus STALE karena materi berubah.');
    END IF;

    -- Support multi-session: reuse open in_progress attempt (logging examiner handoff if changed), or create next session if previous submitted
    SELECT * INTO v_existing_attempt FROM exam_attempts
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'in_progress'
    ORDER BY attempt_number DESC LIMIT 1;

    IF FOUND THEN
        v_attempt_id := v_existing_attempt.id;
        IF v_existing_attempt.actual_examiner_id IS DISTINCT FROM v_actual_examiner_id THEN
            INSERT INTO exam_audit_logs (
                id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at
            ) VALUES (
                'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
                p_period_id, p_student_id, 'SWITCH_UAS_EXAMINER', v_actual_examiner_id,
                jsonb_build_object('attemptId', v_attempt_id, 'oldExaminerId', v_existing_attempt.actual_examiner_id, 'oldExaminerName', v_existing_attempt.actual_examiner_name),
                jsonb_build_object('attemptId', v_attempt_id, 'newExaminerId', v_actual_examiner_id, 'newExaminerName', v_actual_examiner_name, 'loginAccountId', v_user.id),
                'Pergantian penguji terverifikasi pada sesi ujian UAS', now()
            );
            UPDATE exam_attempts
            SET examiner_history = COALESCE(examiner_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('examinerId', v_actual_examiner_id, 'examinerName', v_actual_examiner_name, 'action', 'handoff', 'at', now())),
                actual_examiner_id = v_actual_examiner_id,
                actual_examiner_name = v_actual_examiner_name,
                examiner_user_id = v_actual_examiner_id,
                login_account_id = v_user.id,
                login_account_username = v_user.username,
                examiner_verified_at = v_verified_at,
                updated_at = now()
            WHERE id = v_attempt_id;
        END IF;
    ELSE
        SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_next_attempt_num
        FROM exam_attempts WHERE exam_period_id = p_period_id AND student_id = p_student_id;

        IF v_next_attempt_num = 1 AND EXISTS (
            SELECT 1 FROM exam_attempts WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'submitted'
        ) THEN
            v_next_attempt_num := 2;
        END IF;

        v_attempt_id := 'att_uas_' || p_period_id || '_' || p_student_id || '_a' || v_next_attempt_num;
        INSERT INTO exam_attempts (
            id, exam_period_id, student_id, question_set_id, examiner_user_id,
            actual_examiner_id, actual_examiner_name, login_account_id, login_account_username,
            session_number, examiner_verified_at, examiner_history,
            attempt_number, status, started_at, last_saved_at, total_score, created_at, updated_at
        ) VALUES (
            v_attempt_id, p_period_id, p_student_id, v_question_set.id, v_actual_examiner_id,
            v_actual_examiner_id, v_actual_examiner_name, v_user.id, v_user.username,
            v_next_attempt_num, v_verified_at, jsonb_build_array(jsonb_build_object('examinerId', v_actual_examiner_id, 'examinerName', v_actual_examiner_name, 'action', 'start', 'at', now())),
            v_next_attempt_num, 'in_progress', now(), now(), 0, now(), now()
        );

        FOR v_q IN SELECT * FROM exam_questions WHERE question_set_id = v_question_set.id ORDER BY question_number ASC
        LOOP
            INSERT INTO exam_question_assessments (
                id, exam_attempt_id, exam_question_id, question_number,
                fluency_score, tajwid_score, makhraj_score,
                fluency_events, tajwid_events, makhraj_events,
                question_score, notes, started_at, completed_at, updated_at, version
            ) VALUES (
                'aqa_' || v_attempt_id || '_q' || v_q.question_number,
                v_attempt_id, v_q.id, v_q.question_number,
                CASE WHEN v_q.question_role = 'mandatory' THEN 9 ELSE 6 END,
                CASE WHEN v_q.question_role = 'mandatory' THEN 3 ELSE 2 END,
                CASE WHEN v_q.question_role = 'mandatory' THEN 3 ELSE 2 END,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                CASE WHEN v_q.question_role = 'mandatory' THEN 15 ELSE 10 END,
                '', now(), NULL, now(), 1
            );
        END LOOP;

        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id, after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            p_period_id, p_student_id, 'uas_exam_started', v_actual_examiner_id,
            jsonb_build_object('attemptId', v_attempt_id, 'sessionNumber', v_next_attempt_num, 'actualExaminerId', v_actual_examiner_id, 'actualExaminerName', v_actual_examiner_name, 'loginAccountId', v_user.id),
            'Mulai sesi ujian UAS santri', now()
        );
    END IF;

    SELECT json_agg(json_build_object(
        'id', q.id, 'questionNumber', q.question_number, 'zoneNumber', q.zone_number,
        'questionRole', q.question_role, 'pageNumber', q.page_number, 'maxScore', q.max_score,
        'sourceType', q.source_type, 'questionBankId', q.question_bank_id,
        'promptStartSurah', q.prompt_start_surah, 'promptStartAyah', q.prompt_start_ayah, 'promptStartWord', q.prompt_start_word,
        'promptEndSurah', q.prompt_end_surah, 'promptEndAyah', q.prompt_end_ayah, 'promptEndWord', q.prompt_end_word,
        'answerStartSurah', q.answer_start_surah, 'answerStartAyah', q.answer_start_ayah, 'answerStartWord', q.answer_start_word,
        'answerEndSurah', q.answer_end_surah, 'answerEndAyah', q.answer_end_ayah, 'answerEndWord', q.answer_end_word,
        'startPage', q.start_page, 'endPage', q.end_page, 'generatedMetadata', q.generated_metadata
    ) ORDER BY q.question_number ASC) INTO v_questions
    FROM exam_questions q WHERE q.question_set_id = v_question_set.id;

    SELECT json_agg(json_build_object(
        'id', a.id, 'examAttemptId', a.exam_attempt_id, 'examQuestionId', a.exam_question_id,
        'questionNumber', a.question_number, 'fluencyScore', a.fluency_score, 'tajwidScore', a.tajwid_score,
        'makhrajScore', a.makhraj_score, 'fluencyEvents', a.fluency_events, 'tajwidEvents', a.tajwid_events,
        'makhrajEvents', a.makhraj_events, 'questionScore', a.question_score, 'notes', a.notes,
        'startedAt', a.started_at, 'completedAt', a.completed_at, 'updatedAt', a.updated_at, 'version', a.version
    ) ORDER BY a.question_number ASC) INTO v_assessments
    FROM exam_question_assessments a WHERE a.exam_attempt_id = v_attempt_id;

    RETURN json_build_object(
        'success', true,
        'kkm', v_period.kkm,
        'attempt', (SELECT row_to_json(ea.*) FROM exam_attempts ea WHERE ea.id = v_attempt_id),
        'questions', COALESCE(v_questions, '[]'::json),
        'assessments', COALESCE(v_assessments, '[]'::json)
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_exam_periods(p_username text, p_password text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_periods JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;
    
    IF v_user.role NOT IN ('admin', 'teacher', 'shared_uas_examiner') THEN
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
    FROM exam_periods p WHERE (v_user.role != 'shared_uas_examiner' OR p.exam_type = 'uas');

    RETURN json_build_object('success', true, 'data', COALESCE(v_periods, '[]'::json));
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_uas_question_assessment(p_username text, p_password text, p_attempt_id text, p_question_number integer, p_assessment_data jsonb, p_expected_version integer DEFAULT NULL::integer, p_mark_completed boolean DEFAULT false)
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
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    -- Role Whitelist: Hanya Admin dan Teacher yang diizinkan
    IF v_user.role NOT IN ('admin', 'teacher', 'shared_uas_examiner') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat menilai ujian.');
    END IF;

    IF v_user.role = 'shared_uas_examiner' AND NOT EXISTS (
        SELECT 1 FROM public.uas_verified_examiner_sessions WHERE session_token = p_password AND expires_at > now()
    ) THEN
        RETURN json_build_object('success', false, 'message', 'Identitas penguji UAS belum diverifikasi.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
    END IF;

    -- Read-only check: Tolak setelah submitted
    IF v_attempt.status != 'in_progress' THEN
        RETURN json_build_object('success', false, 'message', 'Ujian telah dikirim dan bersifat read-only.');
    END IF;

    -- Otorisasi penguji: Wajib assigned examiner atau Admin
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji sesi ini.');
    END IF;

    -- 3. Stale Check
    SELECT * INTO v_question_set FROM exam_question_sets WHERE id = v_attempt.question_set_id;
    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;
    
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.status != 'locked' OR v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'isStale', true, 'message', 'Ujian diblokir: Paket soal UAS berstatus STALE karena materi berubah.');
    END IF;

    -- 4. Ambil Assessment Eksisting
    SELECT * INTO v_existing_assessment FROM exam_question_assessments 
    WHERE exam_attempt_id = p_attempt_id AND question_number = p_question_number;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Data nomor soal tidak ditemukan pada sesi ujian.');
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

    -- 5. Validasi Metadata Butir Soal (Authoritative)
    SELECT * INTO v_question FROM exam_questions WHERE id = v_existing_assessment.exam_question_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Metadata soal tidak ditemukan pada database.');
    END IF;

    IF v_question.question_role = 'mandatory' THEN
        IF v_question.max_score != 15.00 THEN
            RETURN json_build_object('success', false, 'message', 'Integritas gagal: Soal wajib harus memiliki bobot nilai 15.');
        END IF;
        v_max_fluency := 9.00;
        v_max_tajwid := 3.00;
        v_max_makhraj := 3.00;
        v_max_score := 15.00;
    ELSIF v_question.question_role = 'random' THEN
        IF v_question.max_score != 10.00 THEN
            RETURN json_build_object('success', false, 'message', 'Integritas gagal: Soal acak harus memiliki bobot nilai 10.');
        END IF;
        v_max_fluency := 6.00;
        v_max_tajwid := 2.00;
        v_max_makhraj := 2.00;
        v_max_score := 10.00;
    ELSE
        RETURN json_build_object('success', false, 'message', 'Role butir soal tidak dikenal: ' || v_question.question_role);
    END IF;

    -- 6. Parsing & Server Authoritative Deductions
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

    v_q_score := LEAST(v_max_score, GREATEST(0.00, v_f_score + v_t_score + v_m_score));
    v_new_version := v_existing_assessment.version + 1;

    -- Tentukan completed_at
    IF p_mark_completed = true OR (p_assessment_data->>'isCompleted')::BOOLEAN = true THEN
        v_new_completed_at := COALESCE(v_existing_assessment.completed_at, now());
    ELSE
        v_new_completed_at := v_existing_assessment.completed_at;
    END IF;

    -- Atomic Update dengan version lock
    UPDATE exam_question_assessments SET
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
    UPDATE exam_attempts SET last_saved_at = now(), updated_at = now() WHERE id = p_attempt_id;

    -- Audit log jika baru saja ditandai completed
    IF (p_mark_completed = true OR (p_assessment_data->>'isCompleted')::BOOLEAN = true) AND v_existing_assessment.completed_at IS NULL THEN
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            before_data, after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            v_attempt.exam_period_id, v_attempt.student_id, 'uas_question_completed', v_user.id,
            NULL,
            jsonb_build_object(
                'attemptId', p_attempt_id,
                'questionNumber', p_question_number,
                'questionRole', v_question.question_role,
                'questionScore', v_q_score,
                'maxScore', v_max_score
            ),
            'Penguji menyelesaikan butir soal UAS nomor ' || p_question_number, now()
        );
    END IF;

    RETURN json_build_object(
        'success', true,
        'message', 'Penilaian soal UAS nomor ' || p_question_number || ' berhasil disimpan.',
        'assessment', json_build_object(
            'questionNumber', p_question_number,
            'questionRole', v_question.question_role,
            'fluencyScore', v_f_score,
            'tajwidScore', v_t_score,
            'makhrajScore', v_m_score,
            'questionScore', v_q_score,
            'maxScore', v_max_score,
            'completedAt', v_new_completed_at,
            'version', v_new_version,
            'lastSavedAt', now()
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_uas_attempt(p_username text, p_password text, p_attempt_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_attempt RECORD;
    v_period RECORD;
    v_question_set RECORD;
    v_snapshot RECORD;
    v_calc_fingerprint TEXT;
    v_count_total INTEGER;
    v_count_completed INTEGER;
    v_valid_q_count INTEGER;
    v_total_calculated NUMERIC(5,2) := 0;
    v_mandatory_subtotal NUMERIC(5,2) := 0;
    v_random_subtotal NUMERIC(5,2) := 0;
    v_is_passed BOOLEAN;
    v_asm RECORD;
    v_q RECORD;
    v_event JSONB;
    v_ev_type TEXT;
    v_max_fluency NUMERIC(5,2);
    v_max_tajwid NUMERIC(5,2);
    v_max_makhraj NUMERIC(5,2);
    v_max_score NUMERIC(5,2);
    v_f_deduction NUMERIC(5,2);
    v_t_deduction NUMERIC(5,2);
    v_m_deduction NUMERIC(5,2);
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    -- Role Whitelist: Hanya Admin dan Teacher yang diizinkan
    IF v_user.role NOT IN ('admin', 'teacher', 'shared_uas_examiner') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat mengirim ujian.');
    END IF;

    IF v_user.role = 'shared_uas_examiner' AND NOT EXISTS (
        SELECT 1 FROM public.uas_verified_examiner_sessions WHERE session_token = p_password AND expires_at > now()
    ) THEN
        RETURN json_build_object('success', false, 'message', 'Identitas penguji UAS belum diverifikasi.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian UAS tidak ditemukan.');
    END IF;

    -- Otorisasi penguji: Wajib assigned examiner atau Admin (dicek sebelum idempotency return)
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang berwenang untuk sesi ini.');
    END IF;

    -- Idempotency check: jika sudah submitted, return data eksisting
    IF v_attempt.status = 'submitted' THEN
        SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
        RETURN json_build_object(
            'success', true,
            'isExisting', true,
            'message', 'Ujian UAS sudah dikirim dan difinalisasi sebelumnya.',
            'totalScore', v_attempt.total_score,
            'submittedAt', v_attempt.submitted_at,
            'kkm', v_period.kkm,
            'isPassed', (v_attempt.total_score >= v_period.kkm)
        );
    END IF;

    -- 3. Stale Check
    SELECT * INTO v_question_set FROM exam_question_sets WHERE id = v_attempt.question_set_id;
    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;
    
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.status != 'locked' OR v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'isStale', true, 'message', 'Ujian diblokir: Paket soal UAS berstatus STALE karena materi berubah.');
    END IF;

    -- 4. VALIDASI WAJIB 9 BUTIR SOAL DAN KESEMBILANNYA HARUS COMPLETED!
    SELECT COUNT(*), COUNT(*) FILTER (WHERE completed_at IS NOT NULL)
    INTO v_count_total, v_count_completed
    FROM exam_question_assessments
    WHERE exam_attempt_id = p_attempt_id;

    IF v_count_total != 9 OR v_count_completed != 9 THEN
        RETURN json_build_object(
            'success', false, 
            'message', 'Validasi gagal: Seluruh 9 butir soal wajib diselesaikan (completed) sebelum submit final. Saat ini ' || v_count_completed || ' dari 9 soal selesai.'
        );
    END IF;

    -- 5. VALIDASI SOAL BERASAL DARI QUESTION SET RESMI
    SELECT COUNT(*) INTO v_valid_q_count
    FROM exam_question_assessments eqa
    JOIN exam_questions eq ON eq.id = eqa.exam_question_id
    WHERE eqa.exam_attempt_id = p_attempt_id
      AND eq.question_set_id = v_attempt.question_set_id;

    IF v_valid_q_count != 9 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi integritas gagal: Butir soal tidak sesuai dengan paket soal resmi UAS.');
    END IF;

    -- 6. AUTHORITATIVE SERVER-SIDE RECALCULATION (9 BUTIR SOAL)
    v_total_calculated := 0;
    v_mandatory_subtotal := 0;
    v_random_subtotal := 0;

    FOR v_asm IN 
        SELECT a.*, q.question_role, q.max_score AS question_max_score
        FROM exam_question_assessments a
        JOIN exam_questions q ON q.id = a.exam_question_id
        WHERE a.exam_attempt_id = p_attempt_id 
        ORDER BY a.question_number ASC
    LOOP
        v_f_deduction := 0;
        v_t_deduction := 0;
        v_m_deduction := 0;

        IF v_asm.question_role = 'mandatory' THEN
            IF v_asm.question_max_score != 15.00 THEN
                RETURN json_build_object('success', false, 'message', 'Integritas gagal: Soal wajib harus memiliki bobot nilai 15.');
            END IF;
            v_max_fluency := 9.00;
            v_max_tajwid := 3.00;
            v_max_makhraj := 3.00;
            v_max_score := 15.00;
        ELSIF v_asm.question_role = 'random' THEN
            IF v_asm.question_max_score != 10.00 THEN
                RETURN json_build_object('success', false, 'message', 'Integritas gagal: Soal acak harus memiliki bobot nilai 10.');
            END IF;
            v_max_fluency := 6.00;
            v_max_tajwid := 2.00;
            v_max_makhraj := 2.00;
            v_max_score := 10.00;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Role butir soal tidak dikenal: ' || v_asm.question_role);
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

        -- Update skor authoritative ke database
        UPDATE exam_question_assessments SET
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
    v_mandatory_subtotal := ROUND(v_mandatory_subtotal, 2);
    v_random_subtotal := ROUND(v_random_subtotal, 2);

    IF v_total_calculated > 100.00 THEN
        RETURN json_build_object('success', false, 'message', 'Integritas nilai gagal: Total nilai melebihi 100.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
    v_is_passed := (v_total_calculated >= v_period.kkm);

    -- Finalisasi status attempt
    UPDATE exam_attempts SET
        status = 'submitted',
        total_score = v_total_calculated,
        submitted_at = now(),
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Tandai status assignment sebagai completed
    UPDATE exam_examiner_assignments SET
        status = 'completed',
        updated_at = now()
    WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;

    -- Audit log kanonikal
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_attempt.exam_period_id, v_attempt.student_id, 'uas_exam_submitted', v_user.id,
        jsonb_build_object('attemptId', p_attempt_id, 'status', 'in_progress'),
        jsonb_build_object(
            'attemptId', p_attempt_id,
            'totalScore', v_total_calculated,
            'mandatorySubtotal', v_mandatory_subtotal,
            'randomSubtotal', v_random_subtotal,
            'kkm', v_period.kkm,
            'isPassed', v_is_passed,
            'status', 'submitted'
        ),
        'Submit final hasil ujian UAS santri', now()
    );

    RETURN json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Hasil ujian UAS berhasil dikirim dan difinalisasi.',
        'totalScore', v_total_calculated,
        'mandatorySubtotal', v_mandatory_subtotal,
        'randomSubtotal', v_random_subtotal,
        'kkm', v_period.kkm,
        'isPassed', v_is_passed,
        'submittedAt', now()
    );
END;
$function$;

COMMIT;
