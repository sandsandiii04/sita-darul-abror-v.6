-- ==============================================================================
-- SITA DARUL ABROR — UPGRADE ALL 53 EVALUATION / UAS / UTS / BANK SOAL RPCs
-- TO SUPPORT sessionToken AUTHENTICATION (validate_session_or_credential)
--
-- Non-Destructive: Preserves 100% of business rules, scoring, fingerprinting,
-- Owner-First / explicit examiner assignment, optimistic locking, and audit logs.
-- Generated directly from live production pg_proc definitions.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.archive_question_bank_item(p_username text, p_password text, p_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_role TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengakses fitur ini.');
    END IF;
    v_role := v_auth.out_role;

    UPDATE question_bank 
    SET status = 'archived', 
        archived_at = timezone('utc'::text, now()), 
        updated_at = timezone('utc'::text, now())
    WHERE id = p_id;

    RETURN json_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_examiner_secure(p_username text, p_password text, p_period_id text, p_student_id text, p_examiner_id text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_student RECORD;
    v_examiner RECORD;
    v_assignment_id TEXT;
    v_existing_attempt RECORD;
    v_old_assignment RECORD;
    v_action TEXT := 'examiner_assigned';
    v_attempt_status TEXT := 'no_attempt';
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    -- 2. Otorisasi: Wajib Admin
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak menugaskan penguji.');
    END IF;

    -- 3. Validasi Periode
    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    -- 4. Validasi Santri & Peserta
    SELECT * INTO v_student FROM students WHERE id = p_student_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Santri tidak ditemukan.');
    END IF;

    -- 5. Validasi Penguji (Wajib User dengan role teacher atau admin)
    SELECT * INTO v_examiner FROM users WHERE id = p_examiner_id AND role IN ('teacher', 'admin');
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Penguji tidak valid (harus guru atau admin).');
    END IF;

    -- 6. Cek jika santri sudah submitted: DITOLAK
    SELECT * INTO v_existing_attempt FROM exam_attempts 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'submitted';
    IF FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Tidak dapat mengubah penguji: Ujian santri ini sudah diselesaikan (submitted).');
    END IF;

    -- 7. Cek jika sesi sedang in_progress: Wajib alasan reassignment
    SELECT * INTO v_existing_attempt FROM exam_attempts 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'in_progress';
    IF FOUND THEN
        IF p_reason IS NULL OR trim(p_reason) = '' THEN
            RETURN json_build_object('success', false, 'message', 'Sesi ujian santri sedang berjalan (in_progress). Wajib mencantumkan alasan pengalihan/penggantian penguji.');
        END IF;
        v_action := 'examiner_reassigned';
        v_attempt_status := 'in_progress';
    END IF;

    SELECT * INTO v_old_assignment FROM exam_examiner_assignments 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    v_assignment_id := 'eea_' || p_period_id || '_' || p_student_id;

    -- 8. Upsert Assignment
    INSERT INTO exam_examiner_assignments (
        id, exam_period_id, student_id, examiner_user_id, assigned_by, assigned_at, status, created_at, updated_at
    ) VALUES (
        v_assignment_id, p_period_id, p_student_id, p_examiner_id, v_user.id, now(), 'assigned', now(), now()
    )
    ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
        examiner_user_id = EXCLUDED.examiner_user_id,
        assigned_by = EXCLUDED.assigned_by,
        assigned_at = now(),
        updated_at = now();

    -- Jika ada attempt in_progress, update examiner_user_id pada attempt secara konsisten
    UPDATE exam_attempts 
    SET examiner_user_id = p_examiner_id, updated_at = now()
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'in_progress';

    -- Audit Log Kanonikal
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id, p_student_id, v_action, v_user.id,
        jsonb_build_object(
            'oldExaminerId', v_old_assignment.examiner_user_id,
            'attemptStatus', v_attempt_status
        ),
        jsonb_build_object(
            'newExaminerId', p_examiner_id, 
            'examinerName', v_examiner.name,
            'attemptStatus', v_attempt_status
        ),
        COALESCE(p_reason, 'Penugasan penguji ujian santri'), now()
    );

    RETURN json_build_object(
        'success', true, 
        'message', 'Penguji berhasil ditugaskan untuk ' || v_student.name || '.',
        'assignment', json_build_object(
            'id', v_assignment_id,
            'examPeriodId', p_period_id,
            'studentId', p_student_id,
            'examinerUserId', p_examiner_id,
            'examinerName', v_examiner.name,
            'status', 'assigned'
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_remedial_examiner_secure(p_username text, p_password text, p_remedial_session_id text, p_examiner_id text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_session RECORD;
    v_examiner RECORD;
    v_existing_attempt RECORD;
    v_old_examiner_id TEXT;
    v_action TEXT;
    v_audit_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak menugaskan penguji remedial.');
    END IF;

    -- 2. Validasi Remedial Session
    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = p_remedial_session_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi remedial tidak ditemukan.');
    END IF;

    IF v_session.remedial_question_set_id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Paket soal remedial belum dibuat untuk sesi ini.');
    END IF;

    -- 3. Validasi Penguji Baru (Wajib user aktif role teacher atau admin)
    SELECT * INTO v_examiner FROM users WHERE id = p_examiner_id AND role IN ('teacher', 'admin');
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Penguji tidak valid (harus guru atau admin).');
    END IF;

    -- 4. Validasi Status Attempt Remedial Eksisting
    SELECT * INTO v_existing_attempt FROM exam_remedial_attempts WHERE remedial_session_id = p_remedial_session_id;
    IF FOUND THEN
        IF v_existing_attempt.status = 'submitted' THEN
            RETURN json_build_object('success', false, 'message', 'Sesi remedial sudah disubmit dan terkunci. Penguji tidak dapat diubah.');
        END IF;

        -- Jika sedang in_progress atau reopened, wajib mencantumkan alasan
        IF v_existing_attempt.status IN ('in_progress', 'reopened') THEN
            IF p_reason IS NULL OR trim(p_reason) = '' THEN
                RETURN json_build_object('success', false, 'message', 'Alasan penggantian penguji wajib diisi karena ujian sedang berlangsung/dibuka kembali.');
            END IF;
        END IF;
    END IF;

    v_old_examiner_id := v_session.examiner_user_id;

    -- 5. Simpan / Update Assignment
    INSERT INTO exam_remedial_examiner_assignments (
        id, remedial_session_id, examiner_user_id, assigned_by, assigned_at, reassign_reason, status, created_at, updated_at
    ) VALUES (
        'rem_asgn_' || v_session.id,
        p_remedial_session_id,
        p_examiner_id,
        v_user.id,
        now(),
        p_reason,
        'assigned',
        now(),
        now()
    )
    ON CONFLICT (remedial_session_id) DO UPDATE SET
        examiner_user_id = EXCLUDED.examiner_user_id,
        assigned_by = EXCLUDED.assigned_by,
        assigned_at = now(),
        reassign_reason = EXCLUDED.reassign_reason,
        updated_at = now();

    -- Update examiner_user_id pada exam_remedial_sessions
    UPDATE exam_remedial_sessions SET
        examiner_user_id = p_examiner_id,
        assigned_by = v_user.id,
        assigned_at = now(),
        updated_at = now()
    WHERE id = p_remedial_session_id;

    -- Jika attempt sudah ada dan in_progress/reopened, update juga attempt examiner binding secara konsisten
    IF FOUND AND v_existing_attempt.id IS NOT NULL THEN
        UPDATE exam_remedial_attempts SET
            examiner_user_id = p_examiner_id,
            updated_at = now()
        WHERE id = v_existing_attempt.id;
    END IF;

    -- 6. Audit Log Kanonikal
    v_action := CASE WHEN v_old_examiner_id IS NOT NULL AND v_old_examiner_id != p_examiner_id 
                     THEN 'remedial_examiner_reassigned' 
                     ELSE 'remedial_examiner_assigned' END;

    v_audit_id := 'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);

    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        v_audit_id,
        v_session.original_exam_period_id,
        v_session.student_id,
        v_action,
        v_user.id,
        jsonb_build_object('remedialSessionId', p_remedial_session_id, 'oldExaminerId', v_old_examiner_id),
        jsonb_build_object('remedialSessionId', p_remedial_session_id, 'newExaminerId', p_examiner_id),
        p_reason,
        now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Penguji ujian remedial berhasil ditugaskan.',
        'remedialSessionId', p_remedial_session_id,
        'examinerId', p_examiner_id,
        'action', v_action
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_activate_question_bank_drafts(p_username text, p_password text, p_exam_type text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_role TEXT;
    v_updated_count INT := 0;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengakses fitur ini.');
    END IF;
    v_role := v_auth.out_role;

    IF p_exam_type IS NOT NULL AND p_exam_type <> 'all' THEN
        UPDATE question_bank 
        SET status = 'active', updated_at = timezone('utc'::text, now())
        WHERE status = 'draft' AND exam_type = p_exam_type AND id IS NOT NULL;
    ELSE
        UPDATE question_bank 
        SET status = 'active', updated_at = timezone('utc'::text, now())
        WHERE status = 'draft' AND id IS NOT NULL;
    END IF;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN json_build_object('success', true, 'updated_count', v_updated_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_finalize_material_snapshots(p_username text, p_password text, p_period_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_finalized_count INTEGER := 0;
    v_needs_review_count INTEGER := 0;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak melakukan finalisasi massal.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    -- Hitung yang berstatus needs_review (ini TIDAK boleh ikut finalisasi massal)
    SELECT count(*) INTO v_needs_review_count 
    FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND status = 'needs_review';

    -- Update hanya yang statusnya 'ready'
    WITH updated AS (
        UPDATE exam_material_snapshots SET
            status = 'finalized',
            finalized_by = v_user.id,
            finalized_at = now(),
            updated_at = now()
        WHERE exam_period_id = p_period_id AND status = 'ready'
        RETURNING id
    )
    SELECT count(*) INTO v_finalized_count FROM updated;

    INSERT INTO exam_audit_logs (id, exam_period_id, action, actor_id, after_data, reason, created_at)
    VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        'bulk_finalized',
        v_user.id,
        jsonb_build_object('finalizedCount', v_finalized_count, 'skippedNeedsReview', v_needs_review_count),
        'Finalisasi massal seluruh santri yang berstatus Siap (Ready)',
        now()
    );

    RETURN json_build_object(
        'success', true,
        'finalizedCount', v_finalized_count,
        'skippedNeedsReview', v_needs_review_count,
        'message', v_finalized_count || ' santri berhasil difinalisasi. ' || v_needs_review_count || ' santri perlu verifikasi manual.'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_exam_period_with_participants(p_username text, p_password text, p_period jsonb, p_student_ids text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period_id TEXT;
    v_term_id TEXT;
    v_term RECORD;
    v_cutoff DATE;
    v_kkm NUMERIC;
    v_student RECORD;
    v_count INTEGER := 0;
    v_uts_q_count INTEGER;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuat Periode Ujian.');
    END IF;

    v_term_id := p_period->>'academicTermId';
    SELECT * INTO v_term FROM academic_terms WHERE id = v_term_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Semester akademik tidak ditemukan.');
    END IF;

    v_cutoff := (p_period->>'materialCutoffDate')::DATE;
    IF v_cutoff < v_term.start_date THEN
        RETURN json_build_object('success', false, 'message', 'Tanggal batas materi (cutoff) tidak boleh sebelum tanggal awal semester.');
    END IF;

    v_period_id := COALESCE(p_period->>'id', 'period_' || extract(epoch from now())::bigint);
    v_kkm := COALESCE((p_period->>'kkm')::NUMERIC, 75);
    v_uts_q_count := COALESCE(
        (p_period->>'utsQuestionCount')::INTEGER,
        (p_period->>'uts_question_count')::INTEGER,
        5
    );

    -- 1. Insert exam_period dengan uts_question_count
    INSERT INTO exam_periods (
        id, academic_term_id, name, exam_type, material_cutoff_date,
        exam_start_date, exam_end_date, kkm, target_classes, target_halaqahs,
        status, uts_question_count, created_by, created_at, updated_at
    ) VALUES (
        v_period_id,
        v_term_id,
        p_period->>'name',
        p_period->>'examType',
        v_cutoff,
        (p_period->>'examStartDate')::DATE,
        (p_period->>'examEndDate')::DATE,
        v_kkm,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_period->'targetClasses', '[]'::jsonb))),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_period->'targetHalaqahs', '[]'::jsonb))),
        COALESCE(p_period->>'status', 'preparation'),
        v_uts_q_count,
        v_user.id,
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        exam_type = EXCLUDED.exam_type,
        material_cutoff_date = EXCLUDED.material_cutoff_date,
        exam_start_date = EXCLUDED.exam_start_date,
        exam_end_date = EXCLUDED.exam_end_date,
        kkm = EXCLUDED.kkm,
        target_classes = EXCLUDED.target_classes,
        target_halaqahs = EXCLUDED.target_halaqahs,
        status = EXCLUDED.status,
        uts_question_count = COALESCE(EXCLUDED.uts_question_count, exam_periods.uts_question_count, 5),
        updated_at = now();

    -- 2. Insert participants with profile snapshots
    IF array_length(p_student_ids, 1) > 0 THEN
        FOR v_student IN 
            SELECT id, name, class, halaqah, teacher_id 
            FROM students 
            WHERE id = ANY(p_student_ids)
        LOOP
            INSERT INTO exam_participants (
                id, exam_period_id, student_id,
                student_name_snapshot, class_snapshot, halaqah_snapshot, teacher_id_snapshot,
                status, created_at, updated_at
            ) VALUES (
                'part_' || v_period_id || '_' || v_student.id,
                v_period_id,
                v_student.id,
                v_student.name,
                v_student.class,
                v_student.halaqah,
                v_student.teacher_id,
                'registered',
                now(),
                now()
            )
            ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
                student_name_snapshot = EXCLUDED.student_name_snapshot,
                class_snapshot = EXCLUDED.class_snapshot,
                halaqah_snapshot = EXCLUDED.halaqah_snapshot,
                teacher_id_snapshot = EXCLUDED.teacher_id_snapshot,
                status = EXCLUDED.status,
                updated_at = now();
                
            v_count := v_count + 1;
        END LOOP;
    END IF;

    RETURN json_build_object(
        'success', true,
        'message', 'Periode ujian dan peserta berhasil disimpan.',
        'periodId', v_period_id,
        'participantsCount', v_count
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_all_question_bank_items(p_username text, p_password text, p_exam_type text DEFAULT NULL::text, p_status text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_role TEXT;
    v_deleted_count INT := 0;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengakses fitur ini.');
    END IF;
    v_role := v_auth.out_role;

    IF p_exam_type IS NOT NULL AND p_exam_type <> 'all' AND p_status IS NOT NULL AND p_status <> 'all' THEN
        DELETE FROM question_bank WHERE exam_type = p_exam_type AND status = p_status AND id IS NOT NULL;
    ELSIF p_exam_type IS NOT NULL AND p_exam_type <> 'all' THEN
        DELETE FROM question_bank WHERE exam_type = p_exam_type AND id IS NOT NULL;
    ELSIF p_status IS NOT NULL AND p_status <> 'all' THEN
        DELETE FROM question_bank WHERE status = p_status AND id IS NOT NULL;
    ELSE
        DELETE FROM question_bank WHERE id IS NOT NULL;
    END IF;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN json_build_object('success', true, 'deleted_count', v_deleted_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_exam_period(p_username text, p_password text, p_period_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak menghapus Periode Ujian.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    -- Hapus konfigurasi pasangan semester yang mengacu pada periode ini
    DELETE FROM semester_evaluation_configs 
    WHERE uts_period_id = p_period_id OR uas_period_id = p_period_id;

    -- Hapus periode ujian (CASCADE otomatis menghapus peserta, snapshots, paket soal, attempts, remedial)
    DELETE FROM exam_periods WHERE id = p_period_id;

    RETURN json_build_object('success', true, 'message', 'Periode ujian berhasil dihapus beserta seluruh data terkait.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_question_bank_item(p_username text, p_password text, p_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_role TEXT;
    v_deleted_count INT := 0;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengakses fitur ini.');
    END IF;
    v_role := v_auth.out_role;

    DELETE FROM question_bank WHERE id = p_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN json_build_object('success', v_deleted_count > 0, 'deleted_count', v_deleted_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_uas_question_set(p_username text, p_password text, p_period_id text, p_student_id text, p_strategy text DEFAULT 'hybrid'::text, p_seed text DEFAULT NULL::text, p_questions jsonb DEFAULT '[]'::jsonb)
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
    v_existing_version INTEGER;
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
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    v_user_id := v_auth.out_user_id;
    v_user_role := v_auth.out_role;

    -- 2. Otorisasi: Khusus Admin
    IF v_user_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berwenang membangkitkan paket soal UAS.');
    END IF;

    -- 3. Validasi Periode Ujian (Khusus UAS)
    SELECT exam_type, status INTO v_exam_type, v_period_status
    FROM exam_periods
    WHERE id = p_period_id;

    IF v_exam_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_exam_type != 'uas' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Generator ini khusus untuk periode ujian UAS.');
    END IF;

    -- 4. Validasi Santri Terdaftar
    IF NOT EXISTS (SELECT 1 FROM exam_participants WHERE exam_period_id = p_period_id AND student_id = p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Santri tidak terdaftar pada periode ujian UAS ini.');
    END IF;

    -- 5. Validasi Material Snapshot Finalized
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

    -- Hitung batas canonical snapshot
    v_snap_min_surah := LEAST(v_snap_start_surah, v_snap_end_surah);
    v_snap_max_surah := GREATEST(v_snap_start_surah, v_snap_end_surah);
    IF v_snap_start_surah = v_snap_end_surah THEN
        v_snap_min_ayah := LEAST(v_snap_start_ayah, v_snap_end_ayah);
        v_snap_max_ayah := GREATEST(v_snap_start_ayah, v_snap_end_ayah);
    ELSE
        v_snap_min_ayah := CASE WHEN v_snap_start_surah < v_snap_end_surah THEN v_snap_start_ayah ELSE v_snap_end_ayah END;
        v_snap_max_ayah := CASE WHEN v_snap_start_surah > v_snap_end_surah THEN v_snap_start_ayah ELSE v_snap_end_ayah END;
    END IF;

    -- 6. Cek Idempotensi Paket Soal Existing
    SELECT id, status, material_fingerprint, version
    INTO v_existing_set_id, v_existing_status, v_existing_fingerprint, v_existing_version
    FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'locked'
    ORDER BY version DESC
    LIMIT 1;

    IF v_existing_set_id IS NOT NULL THEN
        IF v_existing_fingerprint = v_material_fingerprint THEN
            SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
            INTO v_ret_questions
            FROM exam_questions eq
            WHERE eq.question_set_id = v_existing_set_id;

            RETURN jsonb_build_object(
                'success', true,
                'isExisting', true,
                'message', 'Paket soal UAS sudah terkunci dan siap digunakan.',
                'questionSet', (SELECT row_to_json(eqs.*) FROM exam_question_sets eqs WHERE eqs.id = v_existing_set_id),
                'questions', COALESCE(v_ret_questions, '[]'::jsonb)
            );
        END IF;
    END IF;

    -- 7. KLAUSUL AUDIT 9, 10, 11, 12: VALIDASI SERVER-SIDE PAKET 9 SOAL
    v_q_count := jsonb_array_length(p_questions);
    IF v_q_count != 9 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket soal UAS harus memiliki tepat 9 butir soal (2 wajib + 7 acak). Diterima: ' || v_q_count);
    END IF;

    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        v_q_num := (v_q_elem->>'questionNumber')::INTEGER;
        v_q_role := COALESCE(v_q_elem->>'questionRole', v_q_elem->>'question_role');
        v_q_score := COALESCE((v_q_elem->>'maxScore')::NUMERIC, (v_q_elem->>'max_score')::NUMERIC, 0);
        v_q_zone := (v_q_elem->>'zoneNumber')::INTEGER;
        v_q_source := COALESCE(v_q_elem->>'sourceType', v_q_elem->>'source_type', 'auto');
        v_q_bank_id := v_q_elem->>'questionBankId';
        v_q_page := (v_q_elem->>'pageNumber')::INTEGER;

        -- Ekstraksi koordinat jawaban B dan C
        v_as_surah := COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER);
        v_as_ayah := COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER);
        v_as_word := COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER);

        v_ae_surah := COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER);
        v_ae_ayah := COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER);
        v_ae_word := COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER);

        -- Validasi koordinat dasar (1-114, ayah >= 1, word >= 1)
        IF v_as_surah NOT BETWEEN 1 AND 114 OR v_as_ayah < 1 OR v_as_word < 1 OR
           v_ae_surah NOT BETWEEN 1 AND 114 OR v_ae_ayah < 1 OR v_ae_word < 1 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Koordinat ayat/kata butir soal ' || v_q_num || ' tidak valid.');
        END IF;

        -- Validasi urutan B <= C
        IF (v_as_surah > v_ae_surah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah > v_ae_ayah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah = v_ae_ayah AND v_as_word > v_ae_word) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Urutan jawaban B ke C pada butir soal ' || v_q_num || ' tidak valid.');
        END IF;

        -- Validasi posisi di dalam snapshot
        IF (v_as_surah < v_snap_min_surah) OR (v_as_surah = v_snap_min_surah AND v_as_ayah < v_snap_min_ayah) OR
           (v_ae_surah > v_snap_max_surah) OR (v_ae_surah = v_snap_max_surah AND v_ae_ayah > v_snap_max_ayah) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Titik soal nomor ' || v_q_num || ' berada di luar batas snapshot materi santri.');
        END IF;

        v_total_score := v_total_score + v_q_score;

        -- Validasi spesifik per role
        IF v_q_role = 'mandatory' THEN
            v_mandatory_count := v_mandatory_count + 1;

            IF v_q_num NOT IN (1, 2) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib hanya boleh bernomor 1 atau 2.');
            END IF;

            IF v_q_score != 15 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal wajib harus tepat 15. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NOT NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib halaman penuh tidak boleh memiliki zone_number.');
            END IF;

            IF v_q_page IS NULL OR v_q_page NOT BETWEEN 1 AND 604 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor halaman soal wajib tidak valid (1-604).');
            END IF;

            IF v_q_page = ANY(v_used_mand_pages) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Kedua halaman soal wajib harus berbeda (halaman duplikat: ' || v_q_page || ').');
            END IF;
            v_used_mand_pages := array_append(v_used_mand_pages, v_q_page);

            -- Validasi Bank Soal ID jika source_type = bank
            IF v_q_source = 'bank' THEN
                IF v_q_bank_id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Soal wajib bank harus menyertakan questionBankId.');
                END IF;

                SELECT id, status, exam_type, question_type, question_format, page_number
                INTO v_bank_row
                FROM question_bank
                WHERE id = v_q_bank_id;

                IF v_bank_row.id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' tidak ditemukan.');
                END IF;

                IF v_bank_row.status != 'active' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' tidak berstatus aktif.');
                END IF;

                IF v_bank_row.exam_type NOT IN ('uas', 'generic') THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' bukan untuk ujian UAS/generic.');
                END IF;

                IF v_bank_row.question_type != 'mandatory' OR v_bank_row.question_format != 'full_page' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' bukan soal wajib full_page.');
                END IF;

                IF v_bank_row.page_number != v_q_page THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Halaman pada payload (' || v_q_page || ') tidak cocok dengan bank soal (' || v_bank_row.page_number || ').');
                END IF;
            END IF;

        ELSIF v_q_role = 'random' THEN
            v_random_count := v_random_count + 1;

            IF v_q_num NOT BETWEEN 3 AND 9 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak harus bernomor 3 s.d. 9.');
            END IF;

            IF v_q_score != 10 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal acak harus tepat 10. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NULL OR v_q_zone NOT BETWEEN 1 AND 7 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor zona soal acak harus antara 1 dan 7.');
            END IF;

            IF v_q_zone = ANY(v_used_zones) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Setiap zona 1 s.d. 7 harus unik (duplikasi zona: ' || v_q_zone || ').');
            END IF;
            v_used_zones := array_append(v_used_zones, v_q_zone);

            -- Validasi prompt penguji A dan A-aksen
            v_ps_surah := (v_q_elem->'promptStart'->>'surahNumber')::INTEGER;
            v_ps_ayah := (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER;
            v_ps_word := (v_q_elem->'promptStart'->>'wordPosition')::INTEGER;

            v_pe_surah := (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER;
            v_pe_ayah := (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER;
            v_pe_word := (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER;

            IF v_ps_surah IS NULL OR v_pe_surah IS NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak sambung ayat wajib memiliki prompt penguji A dan A-aksen.');
            END IF;

            -- Validasi A <= A-aksen
            IF (v_ps_surah > v_pe_surah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah > v_pe_ayah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah = v_pe_ayah AND v_ps_word > v_pe_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Urutan prompt A ke A-aksen soal ' || v_q_num || ' tidak valid.');
            END IF;

            -- Validasi A-aksen < B
            IF (v_pe_surah > v_as_surah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah > v_as_ayah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah = v_as_ayah AND v_pe_word >= v_as_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal jawaban B harus setelah prompt A-aksen pada butir soal ' || v_q_num || '.');
            END IF;

            -- Keunikan titik B
            v_b_key := v_as_surah || ':' || v_as_ayah || ':' || v_as_word;
            IF v_b_key = ANY(v_used_random_b) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal B soal acak harus unik (ditemukan duplikasi: ' || v_b_key || ').');
            END IF;
            v_used_random_b := array_append(v_used_random_b, v_b_key);

            -- Validasi Bank Soal ID jika source_type = bank
            IF v_q_source = 'bank' THEN
                IF v_q_bank_id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Soal acak bank harus menyertakan questionBankId.');
                END IF;

                SELECT id, status, exam_type, question_type, question_format
                INTO v_bank_row
                FROM question_bank
                WHERE id = v_q_bank_id;

                IF v_bank_row.id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' tidak ditemukan.');
                END IF;

                IF v_bank_row.status != 'active' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' tidak berstatus aktif.');
                END IF;

                IF v_bank_row.exam_type NOT IN ('uas', 'generic') THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' bukan untuk ujian UAS/generic.');
                END IF;

                IF v_bank_row.question_type != 'random' OR v_bank_row.question_format != 'continuation' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' bukan soal acak continuation.');
                END IF;
            END IF;
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Role soal tidak valid: ' || v_q_role);
        END IF;
    END LOOP;

    -- Final package validation
    IF v_mandatory_count != 2 OR v_random_count != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Struktur soal UAS harus tepat 2 soal wajib dan 7 soal acak.');
    END IF;

    IF array_length(v_used_zones, 1) != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Tepat 7 zona (Zona 1 s.d. 7) harus terpenuhi.');
    END IF;

    IF v_total_score != 100 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Total bobot nilai soal UAS harus 100. Terhitung: ' || v_total_score);
    END IF;

    -- 8. Eksekusi Atomic: Buat Paket Baru
    v_final_seed := COALESCE(p_seed, 'seed_uas_' || p_period_id || '_' || p_student_id || '_' || floor(extract(epoch from now())));
    v_new_set_id := 'eqs_uas_' || p_period_id || '_' || p_student_id || '_v1';

    -- Void set lama jika ada
    UPDATE exam_question_sets
    SET status = 'void'
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status != 'void';

    INSERT INTO exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id, version,
        generation_strategy, generation_seed, material_fingerprint, status,
        generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_new_set_id, p_period_id, p_student_id, v_snapshot_id, 1,
        COALESCE(p_strategy, 'hybrid'), v_final_seed, v_material_fingerprint, 'locked',
        v_user_id, timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())
    );

    -- Simpan 9 butir soal
    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        INSERT INTO exam_questions (
            id, question_set_id, question_number, zone_number, question_role,
            source_type, question_bank_id, page_number, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'eq_uas_' || v_new_set_id || '_q' || (v_q_elem->>'questionNumber'),
            v_new_set_id,
            (v_q_elem->>'questionNumber')::INTEGER,
            (v_q_elem->>'zoneNumber')::INTEGER,
            COALESCE(v_q_elem->>'questionRole', 'random'),
            COALESCE(v_q_elem->>'sourceType', 'auto'),
            v_q_elem->>'questionBankId',
            (v_q_elem->>'pageNumber')::INTEGER,
            COALESCE((v_q_elem->>'maxScore')::NUMERIC, 10.00),
            (v_q_elem->'promptStart'->>'surahNumber')::INTEGER,
            (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER,
            (v_q_elem->'promptStart'->>'wordPosition')::INTEGER,
            (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER,
            (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER,
            (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER,
            COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER),
            COALESCE((v_q_elem->>'startPage')::INTEGER, (v_q_elem->>'start_page')::INTEGER),
            COALESCE((v_q_elem->>'endPage')::INTEGER, (v_q_elem->>'end_page')::INTEGER),
            COALESCE(v_q_elem->'metadata', '{}'::jsonb),
            timezone('utc'::text, now())
        );
    END LOOP;

    -- Audit Log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        p_student_id,
        'uas_question_set_generated',
        v_user_id,
        NULL,
        jsonb_build_object(
            'questionSetId', v_new_set_id,
            'version', 1,
            'strategy', p_strategy,
            'materialSnapshotId', v_snapshot_id,
            'materialFingerprint', v_material_fingerprint,
            'totalQuestions', 9,
            'mandatoryCount', v_mandatory_count,
            'randomCount', v_random_count,
            'totalMaxScore', v_total_score
        ),
        'Pembuatan otomatis 9 soal UAS berdasarkan finalized material snapshot',
        timezone('utc'::text, now())
    );

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
    INTO v_ret_questions
    FROM exam_questions eq
    WHERE eq.question_set_id = v_new_set_id;

    RETURN jsonb_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Berhasil membuat dan mengunci 9 soal UAS untuk santri.',
        'questionSet', (SELECT row_to_json(eqs.*) FROM exam_question_sets eqs WHERE eqs.id = v_new_set_id),
        'questions', COALESCE(v_ret_questions, '[]'::jsonb)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_uas_remedial_question_set(p_username text, p_password text, p_original_period_id text, p_student_id text, p_strategy text DEFAULT 'hybrid'::text, p_seed text DEFAULT NULL::text, p_fingerprint text DEFAULT NULL::text, p_questions jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_snapshot RECORD;
    v_orig_attempt RECORD;
    v_session RECORD;
    v_existing_set RECORD;
    v_session_id TEXT;
    v_new_set_id TEXT;
    v_calc_fingerprint TEXT;
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
    v_used_random_b TEXT[] := ARRAY[]::TEXT[];
    v_used_mand_pages INTEGER[] := ARRAY[]::INTEGER[];
    v_used_zones INTEGER[] := ARRAY[]::INTEGER[];
    v_orig_mand_pages INTEGER[] := ARRAY[]::INTEGER[];
    v_orig_random_b TEXT[] := ARRAY[]::TEXT[];
    v_orig_qb_ids TEXT[] := ARRAY[]::TEXT[];
    v_b_key TEXT;
    v_ret_questions JSONB;
    v_final_seed TEXT;
    v_submitted_count INTEGER := 0;
    v_row RECORD;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berwenang membangkitkan paket soal UAS remedial.');
    END IF;

    -- 2. Validasi Periode Original (Khusus UAS)
    SELECT * INTO v_period FROM exam_periods WHERE id = p_original_period_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Periode ujian UAS tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uas' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Generator ini khusus untuk remedial ujian UAS.');
    END IF;

    -- 3. Validasi Attempt Original: Wajib unik, status = submitted, nilai < KKM
    -- Proteksi Gate 9: Tidak boleh ambigu dengan LIMIT 1 jika terdapat >1 attempt submitted
    SELECT COUNT(*) INTO v_submitted_count FROM exam_attempts
    WHERE exam_period_id = p_original_period_id 
      AND student_id = p_student_id 
      AND status = 'submitted';

    IF v_submitted_count > 1 THEN
        RETURN jsonb_build_object('success', false, 'message', 'INTEGRITY_VIOLATION: Ditemukan lebih dari 1 attempt original berstatus submitted untuk santri ini (' || v_submitted_count || ' attempt). Pemilihan attempt tidak boleh ambigu (LIMIT 1 dilarang).');
    END IF;

    IF v_submitted_count = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Santri belum menyelesaikan ujian UAS original.');
    END IF;

    SELECT * INTO v_orig_attempt FROM exam_attempts
    WHERE exam_period_id = p_original_period_id 
      AND student_id = p_student_id 
      AND status = 'submitted';

    IF v_orig_attempt.total_score >= v_period.kkm THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nilai UAS santri (' || v_orig_attempt.total_score || ') sudah mencapai KKM (' || v_period.kkm || '). Santri tidak berhak mengikuti remedial.');
    END IF;

    -- 4. Validasi Snapshot Materi Original: Wajib FINALIZED
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE id = (
        SELECT material_snapshot_id FROM exam_question_sets WHERE id = v_orig_attempt.question_set_id
    );

    IF NOT FOUND THEN
        SELECT * INTO v_snapshot FROM exam_material_snapshots
        WHERE exam_period_id = p_original_period_id AND student_id = p_student_id;
    END IF;

    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Snapshot materi UAS santri belum difinalisasi.');
    END IF;

    -- Hitung fingerprint
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    -- Validasi Fingerprint (Gate 11)
    IF p_fingerprint IS NOT NULL AND p_fingerprint != '' AND p_fingerprint != v_calc_fingerprint THEN
        RETURN jsonb_build_object('success', false, 'message', 'Material fingerprint mismatch: Materi santri tidak sesuai.');
    END IF;

    -- 5. Ambil exclusion list dari soal original UAS (Anti-Reuse)
    FOR v_row IN 
        SELECT question_role, page_number, answer_start_surah, answer_start_ayah, answer_start_word, question_bank_id 
        FROM exam_questions 
        WHERE question_set_id = v_orig_attempt.question_set_id
    LOOP
        IF v_row.question_role = 'mandatory' AND v_row.page_number IS NOT NULL THEN
            v_orig_mand_pages := array_append(v_orig_mand_pages, v_row.page_number);
        ELSE
            v_orig_random_b := array_append(v_orig_random_b, v_row.answer_start_surah || ':' || v_row.answer_start_ayah || ':' || v_row.answer_start_word);
        END IF;
        IF v_row.question_bank_id IS NOT NULL THEN
            v_orig_qb_ids := array_append(v_orig_qb_ids, v_row.question_bank_id);
        END IF;
    END LOOP;

    -- 6. IDEMPOTENCY CHECK
    SELECT * INTO v_session FROM exam_remedial_sessions 
    WHERE original_exam_period_id = p_original_period_id AND student_id = p_student_id;

    IF FOUND AND v_session.remedial_question_set_id IS NOT NULL THEN
        SELECT * INTO v_existing_set FROM exam_remedial_question_sets
        WHERE id = v_session.remedial_question_set_id AND status = 'locked';

        IF FOUND THEN
            SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
            INTO v_ret_questions
            FROM exam_remedial_questions eq
            WHERE eq.remedial_question_set_id = v_existing_set.id;

            RETURN jsonb_build_object(
                'success', true,
                'isExisting', true,
                'message', 'Paket soal UAS remedial sudah terkunci dan siap digunakan.',
                'remedialSession', row_to_json(v_session),
                'questionSet', row_to_json(v_existing_set),
                'questions', COALESCE(v_ret_questions, '[]'::jsonb)
            );
        END IF;
    END IF;

    -- 7. Validasi Struktur Paket 9 Soal (2 Wajib + 7 Acak)
    v_q_count := jsonb_array_length(p_questions);
    IF v_q_count != 9 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket soal UAS remedial harus memiliki tepat 9 butir soal (2 wajib + 7 acak). Diterima: ' || v_q_count);
    END IF;

    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        v_q_num := (v_q_elem->>'questionNumber')::INTEGER;
        v_q_role := COALESCE(v_q_elem->>'questionRole', v_q_elem->>'question_role');
        v_q_score := COALESCE((v_q_elem->>'maxScore')::NUMERIC, (v_q_elem->>'max_score')::NUMERIC, 0);
        v_q_zone := (v_q_elem->>'zoneNumber')::INTEGER;
        v_q_source := COALESCE(v_q_elem->>'sourceType', v_q_elem->>'source_type', 'auto');
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
            RETURN jsonb_build_object('success', false, 'message', 'Koordinat ayat/kata butir soal remedial ' || v_q_num || ' tidak valid.');
        END IF;

        IF (v_as_surah > v_ae_surah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah > v_ae_ayah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah = v_ae_ayah AND v_as_word > v_ae_word) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Urutan jawaban B ke C pada butir soal remedial ' || v_q_num || ' tidak valid.');
        END IF;

        v_total_score := v_total_score + v_q_score;

        -- Validasi Soal Wajib (Q1 & Q2)
        IF v_q_role = 'mandatory' THEN
            v_mandatory_count := v_mandatory_count + 1;

            IF v_q_num NOT IN (1, 2) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib UAS hanya boleh bernomor 1 atau 2.');
            END IF;

            IF v_q_score != 15 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal wajib remedial harus tepat 15. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NOT NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib remedial tidak boleh memiliki zone_number.');
            END IF;

            IF v_q_page IS NULL OR v_q_page NOT BETWEEN 1 AND 604 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor halaman soal wajib remedial tidak valid (1-604).');
            END IF;

            -- Anti-Reuse Halaman Wajib terhadap UAS Original
            IF v_q_page = ANY(v_orig_mand_pages) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Halaman wajib ' || v_q_page || ' telah digunakan pada UAS original (anti-reuse terlanggar).');
            END IF;

            -- Anti-Reuse ID Bank Soal terhadap UAS Original
            IF v_q_bank_id IS NOT NULL AND v_q_bank_id = ANY(v_orig_qb_ids) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bank Soal butir wajib ' || v_q_num || ' telah digunakan pada UAS original (anti-reuse terlanggar).');
            END IF;

            IF v_q_page = ANY(v_used_mand_pages) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Kedua halaman soal wajib remedial harus berbeda (halaman duplikat: ' || v_q_page || ').');
            END IF;
            v_used_mand_pages := array_append(v_used_mand_pages, v_q_page);

        -- Validasi Soal Acak (Q3..Q9)
        ELSIF v_q_role = 'random' THEN
            v_random_count := v_random_count + 1;

            IF v_q_num NOT BETWEEN 3 AND 9 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak remedial harus bernomor 3 s.d. 9.');
            END IF;

            IF v_q_score != 10 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal acak remedial harus tepat 10. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NULL OR v_q_zone NOT BETWEEN 1 AND 7 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor zona soal acak remedial harus antara 1 dan 7.');
            END IF;

            IF v_q_zone = ANY(v_used_zones) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Setiap zona 1 s.d. 7 harus unik (duplikasi zona: ' || v_q_zone || ').');
            END IF;
            v_used_zones := array_append(v_used_zones, v_q_zone);

            v_ps_surah := (v_q_elem->'promptStart'->>'surahNumber')::INTEGER;
            v_ps_ayah := (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER;
            v_ps_word := (v_q_elem->'promptStart'->>'wordPosition')::INTEGER;

            v_pe_surah := (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER;
            v_pe_ayah := (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER;
            v_pe_word := (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER;

            IF v_ps_surah IS NULL OR v_pe_surah IS NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak remedial sambung ayat wajib memiliki prompt penguji A dan A-aksen.');
            END IF;

            IF (v_ps_surah > v_pe_surah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah > v_pe_ayah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah = v_pe_ayah AND v_ps_word > v_pe_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Urutan prompt A ke A-aksen soal remedial ' || v_q_num || ' tidak valid.');
            END IF;

            IF (v_pe_surah > v_as_surah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah > v_as_ayah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah = v_as_ayah AND v_pe_word >= v_as_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik B harus setelah A-aksen pada butir soal remedial ' || v_q_num || '.');
            END IF;

            -- Validasi Batas Snapshot Materi Santri (Gate 19)
            IF v_snapshot.memorization_direction = 'forward' THEN
                IF (v_ps_surah < v_snapshot.start_surah) OR 
                   (v_ps_surah = v_snapshot.start_surah AND v_ps_ayah < v_snapshot.start_ayah) OR
                   (v_ae_surah > v_snapshot.end_surah) OR 
                   (v_ae_surah = v_snapshot.end_surah AND v_ae_ayah > v_snapshot.end_ayah) THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Butir soal acak UAS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
                END IF;
            ELSE
                IF (v_ps_surah > v_snapshot.start_surah) OR 
                   (v_ps_surah = v_snapshot.start_surah AND v_ps_ayah < v_snapshot.start_ayah) OR
                   (v_ae_surah < v_snapshot.end_surah) OR 
                   (v_ae_surah = v_snapshot.end_surah AND v_ae_ayah > v_snapshot.end_ayah) THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Butir soal acak UAS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
                END IF;
            END IF;

            v_b_key := v_as_surah || ':' || v_as_ayah || ':' || v_as_word;

            -- Anti-Reuse Titik B terhadap UAS Original
            IF v_b_key = ANY(v_orig_random_b) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal B butir soal acak ' || v_q_num || ' menduplikasi titik soal UAS original (anti-reuse terlanggar).');
            END IF;

            -- Anti-Reuse ID Bank Soal terhadap UAS Original
            IF v_q_bank_id IS NOT NULL AND v_q_bank_id = ANY(v_orig_qb_ids) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bank Soal butir acak ' || v_q_num || ' telah digunakan pada UAS original (anti-reuse terlanggar).');
            END IF;

            IF v_b_key = ANY(v_used_random_b) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal B soal acak remedial harus unik (duplikasi: ' || v_b_key || ').');
            END IF;
            v_used_random_b := array_append(v_used_random_b, v_b_key);
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Role soal remedial tidak valid: ' || v_q_role);
        END IF;
    END LOOP;

    IF v_mandatory_count != 2 OR v_random_count != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Struktur soal UAS remedial harus tepat 2 soal wajib dan 7 soal acak.');
    END IF;

    IF array_length(v_used_zones, 1) != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Tepat 7 zona (Zona 1 s.d. 7) harus terpenuhi pada UAS remedial.');
    END IF;

    IF v_total_score != 100 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Total bobot nilai soal UAS remedial harus 100. Terhitung: ' || v_total_score);
    END IF;

    -- 8. Eksekusi Atomik Penyimpanan Data UAS Remedial
    v_session_id := 'ers_' || p_original_period_id || '_' || p_student_id;
    v_final_seed := COALESCE(p_seed, 'seed_uas_rem_' || p_original_period_id || '_' || p_student_id || '_' || floor(extract(epoch from now())));
    v_new_set_id := 'erqs_' || p_original_period_id || '_' || p_student_id || '_v1';

    INSERT INTO exam_remedial_sessions (
        id, original_exam_period_id, student_id, exam_type,
        original_attempt_id, original_question_set_id, material_snapshot_id,
        remedial_question_set_id, status, generation_version,
        created_by, created_at, updated_at
    ) VALUES (
        v_session_id, p_original_period_id, p_student_id, 'uas',
        v_orig_attempt.id, v_orig_attempt.question_set_id, v_snapshot.id,
        NULL, 'generating', 1,
        v_user.id, timezone('utc'::text, now()), timezone('utc'::text, now())
    )
    ON CONFLICT (original_exam_period_id, student_id) DO UPDATE SET
        status = 'generating',
        updated_at = timezone('utc'::text, now());

    INSERT INTO exam_remedial_question_sets (
        id, remedial_session_id, original_exam_period_id, student_id,
        exam_type, material_snapshot_id, version, generation_strategy,
        generation_seed, material_fingerprint, status,
        generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_new_set_id, v_session_id, p_original_period_id, p_student_id,
        'uas', v_snapshot.id, 1, COALESCE(p_strategy, 'hybrid'),
        v_final_seed, v_calc_fingerprint, 'locked',
        v_user.id, timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())
    )
    ON CONFLICT (remedial_session_id, version) DO UPDATE SET
        material_fingerprint = v_calc_fingerprint,
        status = 'locked',
        locked_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now());

    DELETE FROM exam_remedial_questions WHERE remedial_question_set_id = v_new_set_id;

    -- Simpan 9 butir soal remedial
    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        INSERT INTO exam_remedial_questions (
            id, remedial_question_set_id, question_number, zone_number, question_role,
            source_type, question_bank_id, page_number, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'erq_' || v_new_set_id || '_q' || (v_q_elem->>'questionNumber'),
            v_new_set_id,
            (v_q_elem->>'questionNumber')::INTEGER,
            (v_q_elem->>'zoneNumber')::INTEGER,
            COALESCE(v_q_elem->>'questionRole', 'random'),
            COALESCE(v_q_elem->>'sourceType', 'auto'),
            v_q_elem->>'questionBankId',
            (v_q_elem->>'pageNumber')::INTEGER,
            COALESCE((v_q_elem->>'maxScore')::NUMERIC, 10.00),
            (v_q_elem->'promptStart'->>'surahNumber')::INTEGER,
            (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER,
            (v_q_elem->'promptStart'->>'wordPosition')::INTEGER,
            (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER,
            (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER,
            (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER,
            COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER),
            COALESCE((v_q_elem->>'startPage')::INTEGER, (v_q_elem->>'start_page')::INTEGER),
            COALESCE((v_q_elem->>'endPage')::INTEGER, (v_q_elem->>'end_page')::INTEGER),
            COALESCE(v_q_elem->'metadata', '{}'::jsonb),
            timezone('utc'::text, now())
        );
    END LOOP;

    -- Update session status ke LOCKED
    UPDATE exam_remedial_sessions 
    SET remedial_question_set_id = v_new_set_id,
        status = 'locked',
        updated_at = timezone('utc'::text, now())
    WHERE id = v_session_id;

    -- Audit Log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_original_period_id,
        p_student_id,
        'remedial_question_set_generated',
        v_user.id,
        NULL,
        jsonb_build_object(
            'remedialSessionId', v_session_id,
            'remedialQuestionSetId', v_new_set_id,
            'originalAttemptId', v_orig_attempt.id,
            'originalQuestionSetId', v_orig_attempt.question_set_id,
            'originalScore', v_orig_attempt.total_score,
            'kkm', v_period.kkm,
            'questionsCount', 9,
            'status', 'locked'
        ),
        'Pembuatan otomatis 9 soal UAS remedial dengan proteksi anti-reuse',
        timezone('utc'::text, now())
    );

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
    INTO v_ret_questions
    FROM exam_remedial_questions eq
    WHERE eq.remedial_question_set_id = v_new_set_id;

    RETURN jsonb_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Berhasil membuat dan mengunci 9 butir soal UAS remedial dengan proteksi anti-reuse.',
        'remedialSession', (SELECT row_to_json(ers.*) FROM exam_remedial_sessions ers WHERE ers.id = v_session_id),
        'questionSet', (SELECT row_to_json(erqs.*) FROM exam_remedial_question_sets erqs WHERE erqs.id = v_new_set_id),
        'questions', COALESCE(v_ret_questions, '[]'::jsonb)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_uts_question_set(p_username text, p_password text, p_period_id text, p_student_id text, p_strategy text, p_questions_data jsonb, p_seed text, p_fingerprint text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_participant RECORD;
    v_snapshot RECORD;
    v_existing_set RECORD;
    v_calculated_fingerprint TEXT;
    v_version INTEGER := 1;
    v_set_id TEXT;
    v_q JSONB;
    v_inserted_questions JSON;
    v_q_count INTEGER;
    v_expected_q_count INTEGER;
    v_q_max NUMERIC(5,2);
    v_q_num INTEGER;
BEGIN
    SET search_path = public, extensions;

    -- 1. Autentikasi User (Admin Only)
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuat soal ujian UTS.');
    END IF;

    -- 2. Validasi Periode Ujian UTS Aktif
    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uts' THEN
        RETURN json_build_object('success', false, 'message', 'Fungsi ini khusus untuk pembuatan soal UTS.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    v_expected_q_count := COALESCE(v_period.uts_question_count, 5);

    -- 3. Validasi Kepesertaan Santri
    SELECT * INTO v_participant FROM exam_participants 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Santri bukan peserta resmi periode ujian ini.');
    END IF;

    -- 4. Validasi Snapshot Materi Wajib FINAL
    SELECT * INTO v_snapshot FROM exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Materi ujian belum diusulkan atau disiapkan.');
    END IF;

    IF v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Materi ujian santri belum difinalisasi (Status: ' || v_snapshot.status || '). Generator hanya boleh dijalankan untuk materi yang sudah final.');
    END IF;

    -- 5. Hitung & Validasi Material Fingerprint
    v_calculated_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah,
        v_snapshot.start_ayah,
        v_snapshot.end_surah,
        v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_calculated_fingerprint != p_fingerprint THEN
        RETURN json_build_object('success', false, 'message', 'Fingerprint materi tidak cocok. Data materi mungkin baru saja berubah.');
    END IF;

    -- 6. Idempotency Check: Jika Paket Soal Valid Sudah Ada, Return Existing
    SELECT * INTO v_existing_set FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id
    ORDER BY version DESC LIMIT 1;

    IF FOUND THEN
        IF v_existing_set.status = 'locked' AND v_existing_set.material_fingerprint = v_calculated_fingerprint THEN
            SELECT json_build_object(
                'success', true,
                'isExisting', true,
                'message', 'Paket soal UTS versi ' || v_existing_set.version || ' sudah aktif dan terkunci.',
                'questionSet', row_to_json(v_existing_set),
                'questions', (
                    SELECT json_agg(json_build_object(
                        'id', q.id,
                        'questionNumber', q.question_number,
                        'zoneNumber', q.zone_number,
                        'sourceType', q.source_type,
                        'questionBankId', q.question_bank_id,
                        'maxScore', COALESCE(q.max_score, 20.00),
                        'promptStartSurah', q.prompt_start_surah,
                        'promptStartAyah', q.prompt_start_ayah,
                        'promptStartWord', q.prompt_start_word,
                        'promptEndSurah', q.prompt_end_surah,
                        'promptEndAyah', q.prompt_end_ayah,
                        'promptEndWord', q.prompt_end_word,
                        'answerStartSurah', q.answer_start_surah,
                        'answerStartAyah', q.answer_start_ayah,
                        'answerStartWord', q.answer_start_word,
                        'answerEndSurah', q.answer_end_surah,
                        'answerEndAyah', q.answer_end_ayah,
                        'answerEndWord', q.answer_end_word,
                        'startPage', q.start_page,
                        'endPage', q.end_page,
                        'generatedMetadata', q.generated_metadata,
                        'createdAt', q.created_at
                    ) ORDER BY q.question_number)
                    FROM exam_questions q
                    WHERE q.question_set_id = v_existing_set.id
                )
            ) INTO v_inserted_questions;

            RETURN v_inserted_questions;
        ELSE
            UPDATE exam_question_sets 
            SET status = 'stale', updated_at = now() 
            WHERE id = v_existing_set.id;
        END IF;
    END IF;

    -- 7. Validasi Input Soal: Wajib Sesuai Konfigurasi (5, 10, 15, atau 20)
    v_q_count := jsonb_array_length(p_questions_data);
    IF v_q_count NOT IN (5, 10, 15, 20) THEN
        RETURN json_build_object('success', false, 'message', 'Jumlah soal UTS tidak valid (' || v_q_count || '). Hanya diperbolehkan 5, 10, 15, atau 20 butir soal.');
    END IF;

    IF v_q_count != v_expected_q_count THEN
        RETURN json_build_object('success', false, 'message', 'Jumlah butir soal (' || v_q_count || ') tidak sesuai dengan konfigurasi periode (' || v_expected_q_count || ' soal).');
    END IF;

    -- 8. Tentukan Versi Baru
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    v_set_id := 'eqs_' || p_period_id || '_' || p_student_id || '_v' || v_version;

    -- 9. Simpan exam_question_sets (Status LOCKED secara atomik)
    INSERT INTO exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id,
        version, generation_strategy, generation_seed, material_fingerprint,
        status, total_questions, generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_set_id,
        p_period_id,
        p_student_id,
        v_snapshot.id,
        v_version,
        COALESCE(p_strategy, 'hybrid'),
        p_seed,
        v_calculated_fingerprint,
        'locked',
        v_q_count,
        v_user.id,
        now(),
        now(),
        now(),
        now()
    );

    -- 10. Simpan Butir Soal exam_questions dengan Bobot Terdistribusi Presisi (Exact 100)
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        v_q_num := (v_q->>'questionNumber')::INTEGER;

        -- Tentukan max_score per butir soal:
        -- Jika dikirim dari generator client, gunakan nilainya; jika tidak, hitung secara server-authoritative
        IF (v_q->>'maxScore') IS NOT NULL THEN
            v_q_max := (v_q->>'maxScore')::NUMERIC(5,2);
        ELSE
            IF v_q_count = 5 THEN
                v_q_max := 20.00;
            ELSIF v_q_count = 10 THEN
                v_q_max := 10.00;
            ELSIF v_q_count = 20 THEN
                v_q_max := 5.00;
            ELSIF v_q_count = 15 THEN
                -- 10 soal pertama @ 6.67, 5 soal terakhir @ 6.66 = Total 100.00
                IF v_q_num <= 10 THEN
                    v_q_max := 6.67;
                ELSE
                    v_q_max := 6.66;
                END IF;
            ELSE
                v_q_max := ROUND(100.0 / v_q_count, 2);
            END IF;
        END IF;

        INSERT INTO exam_questions (
            id, question_set_id, question_number, zone_number,
            source_type, question_bank_id, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'eq_' || v_set_id || '_q' || v_q_num,
            v_set_id,
            v_q_num,
            (v_q->>'zoneNumber')::INTEGER,
            v_q->>'sourceType',
            v_q->>'questionBankId',
            v_q_max,
            (v_q->>'promptStartSurah')::INTEGER,
            (v_q->>'promptStartAyah')::INTEGER,
            (v_q->>'promptStartWord')::INTEGER,
            (v_q->>'promptEndSurah')::INTEGER,
            (v_q->>'promptEndAyah')::INTEGER,
            (v_q->>'promptEndWord')::INTEGER,
            (v_q->>'answerStartSurah')::INTEGER,
            (v_q->>'answerStartAyah')::INTEGER,
            (v_q->>'answerStartWord')::INTEGER,
            (v_q->>'answerEndSurah')::INTEGER,
            (v_q->>'answerEndAyah')::INTEGER,
            (v_q->>'answerEndWord')::INTEGER,
            (v_q->>'startPage')::INTEGER,
            (v_q->>'endPage')::INTEGER,
            COALESCE(v_q->'generatedMetadata', '{}'::jsonb),
            now()
        );
    END LOOP;

    -- 11. Audit Log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        p_student_id,
        'question_set_generated',
        v_user.id,
        jsonb_build_object(
            'questionSetId', v_set_id,
            'version', v_version,
            'totalQuestions', v_q_count,
            'fingerprint', v_calculated_fingerprint
        ),
        'Pembuatan paket soal UTS (' || v_q_count || ' soal) berhasil',
        now()
    );

    -- 12. Return Result
    SELECT json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Paket soal UTS (' || v_q_count || ' butir) berhasil dibuat dan dikunci.',
        'questionSet', row_to_json(s),
        'questions', (
            SELECT json_agg(json_build_object(
                'id', q.id,
                'questionNumber', q.question_number,
                'zoneNumber', q.zone_number,
                'sourceType', q.source_type,
                'questionBankId', q.question_bank_id,
                'maxScore', q.max_score,
                'promptStartSurah', q.prompt_start_surah,
                'promptStartAyah', q.prompt_start_ayah,
                'promptStartWord', q.prompt_start_word,
                'promptEndSurah', q.prompt_end_surah,
                'promptEndAyah', q.prompt_end_ayah,
                'promptEndWord', q.prompt_end_word,
                'answerStartSurah', q.answer_start_surah,
                'answerStartAyah', q.answer_start_ayah,
                'answerStartWord', q.answer_start_word,
                'answerEndSurah', q.answer_end_surah,
                'answerEndAyah', q.answer_end_ayah,
                'answerEndWord', q.answer_end_word,
                'startPage', q.start_page,
                'endPage', q.end_page,
                'generatedMetadata', q.generated_metadata,
                'createdAt', q.created_at
            ) ORDER BY q.question_number)
            FROM exam_questions q
            WHERE q.question_set_id = s.id
        )
    ) INTO v_inserted_questions
    FROM exam_question_sets s
    WHERE s.id = v_set_id;

    RETURN v_inserted_questions;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_uts_remedial_question_set(p_username text, p_password text, p_original_period_id text, p_student_id text, p_strategy text, p_questions_data jsonb, p_seed text, p_fingerprint text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_snapshot RECORD;
    v_orig_attempt RECORD;
    v_orig_qs RECORD;
    v_session RECORD;
    v_existing_set RECORD;
    v_session_id TEXT;
    v_set_id TEXT;
    v_q JSONB;
    v_q_num INTEGER;
    v_z_num INTEGER;
    v_as_s INTEGER;
    v_as_a INTEGER;
    v_as_w INTEGER;
    v_ae_s INTEGER;
    v_ae_a INTEGER;
    v_ae_w INTEGER;
    v_ps_s INTEGER;
    v_ps_a INTEGER;
    v_ps_w INTEGER;
    v_pe_s INTEGER;
    v_pe_a INTEGER;
    v_pe_w INTEGER;
    v_qb_id TEXT;
    v_b_key TEXT;
    v_used_b_keys TEXT[] := ARRAY[]::TEXT[];
    v_used_zones INTEGER[] := ARRAY[]::INTEGER[];
    v_orig_b_keys TEXT[] := ARRAY[]::TEXT[];
    v_orig_qb_ids TEXT[] := ARRAY[]::TEXT[];
    v_calc_fingerprint TEXT;
    v_inserted_questions JSONB := '[]'::jsonb;
    v_submitted_count INTEGER := 0;
    v_row RECORD;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuat soal remedial UTS.');
    END IF;

    -- 2. Validasi Periode Original (Khusus UTS)
    SELECT * INTO v_period FROM exam_periods WHERE id = p_original_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian UTS tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uts' THEN
        RETURN json_build_object('success', false, 'message', 'Generator ini khusus untuk remedial ujian UTS.');
    END IF;

    -- 3. Validasi Attempt Original: Wajib unik, status = submitted, nilai < KKM
    -- Proteksi Gate 9: Tidak boleh ambigu dengan LIMIT 1 jika terdapat >1 attempt submitted
    SELECT COUNT(*) INTO v_submitted_count FROM exam_attempts
    WHERE exam_period_id = p_original_period_id 
      AND student_id = p_student_id 
      AND status = 'submitted';

    IF v_submitted_count > 1 THEN
        RETURN json_build_object('success', false, 'message', 'INTEGRITY_VIOLATION: Ditemukan lebih dari 1 attempt original berstatus submitted untuk santri ini (' || v_submitted_count || ' attempt). Pemilihan attempt tidak boleh ambigu (LIMIT 1 dilarang).');
    END IF;

    IF v_submitted_count = 0 THEN
        RETURN json_build_object('success', false, 'message', 'Santri belum menyelesaikan ujian UTS original.');
    END IF;

    SELECT * INTO v_orig_attempt FROM exam_attempts
    WHERE exam_period_id = p_original_period_id 
      AND student_id = p_student_id 
      AND status = 'submitted';

    IF v_orig_attempt.total_score >= v_period.kkm THEN
        RETURN json_build_object('success', false, 'message', 'Nilai UTS santri (' || v_orig_attempt.total_score || ') sudah mencapai KKM (' || v_period.kkm || '). Santri tidak berhak mengikuti remedial.');
    END IF;

    -- 4. Validasi Snapshot Materi Original: Wajib FINALIZED
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE id = (
        SELECT material_snapshot_id FROM exam_question_sets WHERE id = v_orig_attempt.question_set_id
    );

    IF NOT FOUND THEN
        SELECT * INTO v_snapshot FROM exam_material_snapshots
        WHERE exam_period_id = p_original_period_id AND student_id = p_student_id;
    END IF;

    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi original santri belum difinalisasi.');
    END IF;

    -- Validasi Fingerprint
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF p_fingerprint IS NOT NULL AND p_fingerprint != '' AND p_fingerprint != v_calc_fingerprint THEN
        RETURN json_build_object('success', false, 'message', 'Material fingerprint mismatch: Materi santri tidak sesuai.');
    END IF;

    -- 5. Ambil exclusion list dari soal original UTS (Anti-Reuse)
    FOR v_row IN 
        SELECT answer_start_surah, answer_start_ayah, answer_start_word, question_bank_id 
        FROM exam_questions 
        WHERE question_set_id = v_orig_attempt.question_set_id
    LOOP
        v_orig_b_keys := array_append(v_orig_b_keys, v_row.answer_start_surah || ':' || v_row.answer_start_ayah || ':' || v_row.answer_start_word);
        IF v_row.question_bank_id IS NOT NULL THEN
            v_orig_qb_ids := array_append(v_orig_qb_ids, v_row.question_bank_id);
        END IF;
    END LOOP;

    -- 6. IDEMPOTENCY CHECK: Cek apakah sesi & paket soal remedial sudah pernah dibuat
    SELECT * INTO v_session FROM exam_remedial_sessions 
    WHERE original_exam_period_id = p_original_period_id AND student_id = p_student_id;

    IF FOUND AND v_session.remedial_question_set_id IS NOT NULL THEN
        SELECT * INTO v_existing_set FROM exam_remedial_question_sets
        WHERE id = v_session.remedial_question_set_id AND status = 'locked';

        IF FOUND THEN
            -- Kembalikan paket existing tanpa mengubah data apapun
            SELECT json_agg(row_to_json(q.*) ORDER BY q.question_number)
            INTO v_inserted_questions
            FROM exam_remedial_questions q
            WHERE q.remedial_question_set_id = v_existing_set.id;

            RETURN json_build_object(
                'success', true,
                'isExisting', true,
                'message', 'Paket soal remedial UTS santri sudah dibuat dan terkunci sebelumnya.',
                'remedialSession', row_to_json(v_session),
                'questionSet', row_to_json(v_existing_set),
                'questions', COALESCE(v_inserted_questions, '[]'::jsonb)
            );
        END IF;
    END IF;

    -- 7. Validasi Payload Input: Wajib Tepat 5 Soal
    IF jsonb_array_length(p_questions_data) != 5 THEN
        RETURN json_build_object('success', false, 'message', 'Generator gagal: Wajib menghasilkan tepat 5 soal remedial UTS.');
    END IF;

    -- 8. Validasi Detail Butir Soal & Anti-Reuse
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        v_q_num := (v_q->>'questionNumber')::INTEGER;
        v_z_num := (v_q->>'zoneNumber')::INTEGER;
        v_qb_id := v_q->>'questionBankId';

        IF v_q_num NOT BETWEEN 1 AND 5 THEN
            RETURN json_build_object('success', false, 'message', 'Nomor soal UTS remedial harus antara 1 dan 5.');
        END IF;

        IF v_z_num NOT BETWEEN 1 AND 5 THEN
            RETURN json_build_object('success', false, 'message', 'Nomor zona UTS remedial harus antara 1 dan 5.');
        END IF;

        IF v_z_num = ANY(v_used_zones) THEN
            RETURN json_build_object('success', false, 'message', 'Duplikasi zona terdeteksi pada butir soal remedial nomor ' || v_q_num);
        END IF;
        v_used_zones := array_append(v_used_zones, v_z_num);

        v_ps_s := (v_q->>'promptStartSurah')::INTEGER;
        v_ps_a := (v_q->>'promptStartAyah')::INTEGER;
        v_ps_w := (v_q->>'promptStartWord')::INTEGER;
        v_pe_s := (v_q->>'promptEndSurah')::INTEGER;
        v_pe_a := (v_q->>'promptEndAyah')::INTEGER;
        v_pe_w := (v_q->>'promptEndWord')::INTEGER;

        v_as_s := (v_q->>'answerStartSurah')::INTEGER;
        v_as_a := (v_q->>'answerStartAyah')::INTEGER;
        v_as_w := (v_q->>'answerStartWord')::INTEGER;
        v_ae_s := (v_q->>'answerEndSurah')::INTEGER;
        v_ae_a := (v_q->>'answerEndAyah')::INTEGER;
        v_ae_w := (v_q->>'answerEndWord')::INTEGER;

        -- Validasi koordinat dasar
        IF v_as_s NOT BETWEEN 1 AND 114 OR v_as_a < 1 OR v_as_w < 1 OR
           v_ae_s NOT BETWEEN 1 AND 114 OR v_ae_a < 1 OR v_ae_w < 1 OR
           v_ps_s NOT BETWEEN 1 AND 114 OR v_ps_a < 1 OR v_ps_w < 1 OR
           v_pe_s NOT BETWEEN 1 AND 114 OR v_pe_a < 1 OR v_pe_w < 1 THEN
            RETURN json_build_object('success', false, 'message', 'Koordinat ayat/kata pada butir soal remedial ' || v_q_num || ' tidak valid.');
        END IF;

        -- Validasi urutan A <= A' < B <= C
        IF (v_ps_s > v_pe_s) OR (v_ps_s = v_pe_s AND v_ps_a > v_pe_a) OR (v_ps_s = v_pe_s AND v_ps_a = v_pe_a AND v_ps_w > v_pe_w) THEN
            RETURN json_build_object('success', false, 'message', 'Urutan prompt A ke A-aksen tidak valid pada butir ' || v_q_num);
        END IF;

        IF (v_pe_s > v_as_s) OR (v_pe_s = v_as_s AND v_pe_a > v_as_a) OR (v_pe_s = v_as_s AND v_pe_a = v_as_a AND v_pe_w >= v_as_w) THEN
            RETURN json_build_object('success', false, 'message', 'Titik B harus setelah A-aksen pada butir ' || v_q_num);
        END IF;

        IF (v_as_s > v_ae_s) OR (v_as_s = v_ae_s AND v_as_a > v_ae_a) OR (v_as_s = v_ae_s AND v_as_a = v_ae_a AND v_as_w > v_ae_w) THEN
            RETURN json_build_object('success', false, 'message', 'Urutan jawaban B ke C tidak valid pada butir ' || v_q_num);
        END IF;

        -- Validasi Batas Snapshot Materi Santri (Gate 18)
        IF v_snapshot.memorization_direction = 'forward' THEN
            IF (v_ps_s < v_snapshot.start_surah) OR 
               (v_ps_s = v_snapshot.start_surah AND v_ps_a < v_snapshot.start_ayah) OR
               (v_ae_s > v_snapshot.end_surah) OR 
               (v_ae_s = v_snapshot.end_surah AND v_ae_a > v_snapshot.end_ayah) THEN
                RETURN json_build_object('success', false, 'message', 'Butir soal UTS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
            END IF;
        ELSE
            IF (v_ps_s > v_snapshot.start_surah) OR 
               (v_ps_s = v_snapshot.start_surah AND v_ps_a < v_snapshot.start_ayah) OR
               (v_ae_s < v_snapshot.end_surah) OR 
               (v_ae_s = v_snapshot.end_surah AND v_ae_a > v_snapshot.end_ayah) THEN
                RETURN json_build_object('success', false, 'message', 'Butir soal UTS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
            END IF;
        END IF;

        -- Validasi Anti-Reuse terhadap Soal Original UTS
        v_b_key := v_as_s || ':' || v_as_a || ':' || v_as_w;
        IF v_b_key = ANY(v_orig_b_keys) THEN
            RETURN json_build_object('success', false, 'message', 'Titik awal B butir soal ' || v_q_num || ' menduplikasi titik soal UTS original (anti-reuse terlanggar).');
        END IF;

        IF v_qb_id IS NOT NULL AND v_qb_id = ANY(v_orig_qb_ids) THEN
            RETURN json_build_object('success', false, 'message', 'Bank Soal butir ' || v_q_num || ' telah digunakan pada UTS original (anti-reuse terlanggar).');
        END IF;

        -- Validasi keunikan B di antara sesama soal remedial
        IF v_b_key = ANY(v_used_b_keys) THEN
            RETURN json_build_object('success', false, 'message', 'Duplikasi titik B terdeteksi pada butir soal remedial nomor ' || v_q_num);
        END IF;
        v_used_b_keys := array_append(v_used_b_keys, v_b_key);
    END LOOP;

    -- 9. Eksekusi Atomik Penyimpanan Data Remedial
    v_session_id := 'ers_' || p_original_period_id || '_' || p_student_id;
    v_set_id := 'erqs_' || p_original_period_id || '_' || p_student_id || '_v1';

    -- Simpan / Update exam_remedial_sessions
    INSERT INTO exam_remedial_sessions (
        id, original_exam_period_id, student_id, exam_type,
        original_attempt_id, original_question_set_id, material_snapshot_id,
        remedial_question_set_id, status, generation_version,
        created_by, created_at, updated_at
    ) VALUES (
        v_session_id, p_original_period_id, p_student_id, 'uts',
        v_orig_attempt.id, v_orig_attempt.question_set_id, v_snapshot.id,
        NULL, 'generating', 1,
        v_user.id, now(), now()
    )
    ON CONFLICT (original_exam_period_id, student_id) DO UPDATE SET
        status = 'generating',
        updated_at = now();

    -- Simpan exam_remedial_question_sets
    INSERT INTO exam_remedial_question_sets (
        id, remedial_session_id, original_exam_period_id, student_id,
        exam_type, material_snapshot_id, version, generation_strategy,
        generation_seed, material_fingerprint, status,
        generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_set_id, v_session_id, p_original_period_id, p_student_id,
        'uts', v_snapshot.id, 1, COALESCE(p_strategy, 'hybrid'),
        COALESCE(p_seed, 'seed_uts_rem_' || p_student_id || '_' || floor(extract(epoch from now()))),
        v_calc_fingerprint, 'locked',
        v_user.id, now(), now(), now(), now()
    )
    ON CONFLICT (remedial_session_id, version) DO UPDATE SET
        material_fingerprint = v_calc_fingerprint,
        status = 'locked',
        locked_at = now(),
        updated_at = now();

    -- Hapus soal lama pada paket ini jika ada (idempotency cleanup)
    DELETE FROM exam_remedial_questions WHERE remedial_question_set_id = v_set_id;

    -- Simpan 5 butir soal remedial
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        INSERT INTO exam_remedial_questions (
            id, remedial_question_set_id, question_number, zone_number,
            question_role, source_type, question_bank_id, page_number, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'erq_' || v_set_id || '_q' || (v_q->>'questionNumber'),
            v_set_id,
            (v_q->>'questionNumber')::INTEGER,
            (v_q->>'zoneNumber')::INTEGER,
            'random',
            COALESCE(v_q->>'sourceType', 'auto'),
            v_q->>'questionBankId',
            (v_q->>'startPage')::INTEGER,
            20.00,
            (v_q->>'promptStartSurah')::INTEGER,
            (v_q->>'promptStartAyah')::INTEGER,
            (v_q->>'promptStartWord')::INTEGER,
            (v_q->>'promptEndSurah')::INTEGER,
            (v_q->>'promptEndAyah')::INTEGER,
            (v_q->>'promptEndWord')::INTEGER,
            (v_q->>'answerStartSurah')::INTEGER,
            (v_q->>'answerStartAyah')::INTEGER,
            (v_q->>'answerStartWord')::INTEGER,
            (v_q->>'answerEndSurah')::INTEGER,
            (v_q->>'answerEndAyah')::INTEGER,
            (v_q->>'answerEndWord')::INTEGER,
            (v_q->>'startPage')::INTEGER,
            (v_q->>'endPage')::INTEGER,
            COALESCE(v_q->'generatedMetadata', '{}'::jsonb),
            now()
        );
    END LOOP;

    -- Update session status ke LOCKED
    UPDATE exam_remedial_sessions 
    SET remedial_question_set_id = v_set_id,
        status = 'locked',
        updated_at = now()
    WHERE id = v_session_id;

    -- 10. Catat Audit Log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_original_period_id,
        p_student_id,
        'remedial_question_set_generated',
        v_user.id,
        NULL,
        jsonb_build_object(
            'remedialSessionId', v_session_id,
            'remedialQuestionSetId', v_set_id,
            'originalAttemptId', v_orig_attempt.id,
            'originalQuestionSetId', v_orig_attempt.question_set_id,
            'originalScore', v_orig_attempt.total_score,
            'kkm', v_period.kkm,
            'questionsCount', 5,
            'status', 'locked'
        ),
        'Pembuatan otomatis 5 soal UTS remedial dengan proteksi anti-reuse',
        now()
    );

    -- 11. Return Respon Sukses
    SELECT json_agg(row_to_json(q.*) ORDER BY q.question_number)
    INTO v_inserted_questions
    FROM exam_remedial_questions q
    WHERE q.remedial_question_set_id = v_set_id;

    RETURN json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Berhasil membuat dan mengunci 5 soal UTS remedial dengan proteksi anti-reuse.',
        'remedialSession', (SELECT row_to_json(ers.*) FROM exam_remedial_sessions ers WHERE ers.id = v_session_id),
        'questionSet', (SELECT row_to_json(erqs.*) FROM exam_remedial_question_sets erqs WHERE erqs.id = v_set_id),
        'questions', COALESCE(v_inserted_questions, '[]'::jsonb)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_academic_terms(p_username text, p_password text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_terms JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;
    
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT json_agg(json_build_object(
        'id', t.id,
        'academicYear', t.academic_year,
        'semester', t.semester,
        'startDate', t.start_date,
        'endDate', t.end_date,
        'status', t.status,
        'createdBy', t.created_by,
        'createdAt', t.created_at,
        'updatedAt', t.updated_at
    ) ORDER BY t.start_date DESC) INTO v_terms
    FROM academic_terms t;

    RETURN json_build_object('success', true, 'data', COALESCE(v_terms, '[]'::json));
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
    
    IF v_user.role NOT IN ('admin', 'teacher') THEN
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
    FROM exam_periods p;

    RETURN json_build_object('success', true, 'data', COALESCE(v_periods, '[]'::json));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_examiner_remedial_students(p_username text, p_password text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_result JSON;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.get_examiner_uas_students(p_username text, p_password text, p_period_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_students JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uas' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian bukan periode UAS.');
    END IF;

    SELECT json_agg(json_build_object(
        'studentId', s.id,
        'studentName', s.name,
        'studentNis', s.nis,
        'class', s.class,
        'halaqah', s.halaqah,
        'teacherId', s.teacher_id,
        'teacherName', tu.name,
        'examinerId', COALESCE(a.examiner_user_id, p.teacher_id_snapshot, s.teacher_id),
        'examinerName', COALESCE(eu.name, tu.name, 'Guru Halaqah'),
        'hasAssignment', (a.id IS NOT NULL),
        'snapshotId', snap.id,
        'snapshotStatus', snap.status,
        'startSurahName', snap.start_surah_name,
        'startAyah', snap.start_ayah,
        'endSurahName', snap.end_surah_name,
        'endAyah', snap.end_ayah,
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
    LEFT JOIN exam_question_sets qs ON qs.exam_period_id = p.exam_period_id AND qs.student_id = p.student_id AND qs.status IN ('locked', 'stale')
    LEFT JOIN exam_attempts att ON att.exam_period_id = p.exam_period_id AND att.student_id = p.student_id AND att.status IN ('in_progress', 'submitted')
    WHERE p.exam_period_id = p_period_id
      AND (
          v_user.role = 'admin' 
          OR a.examiner_user_id = v_user.id
          OR (a.examiner_user_id IS NULL AND (p.teacher_id_snapshot = v_user.id OR s.teacher_id = v_user.id))
      );

    RETURN json_build_object(
        'success', true,
        'period', json_build_object(
            'id', v_period.id,
            'name', v_period.name,
            'kkm', v_period.kkm,
            'status', v_period.status
        ),
        'students', COALESCE(v_students, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_examiner_uts_students(p_username text, p_password text, p_period_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_students JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    -- Query peserta:
    -- Admin melihat semua santri.
    -- Penguji melihat santri yang eksplisit ditugaskan kepadanya ATAU
    -- santri halaqahnya sendiri jika belum ada penguji lain yang ditugaskan secara eksplisit.
    SELECT json_agg(json_build_object(
        'studentId', s.id,
        'studentName', s.name,
        'studentNis', s.nis,
        'class', s.class,
        'halaqah', s.halaqah,
        'teacherId', s.teacher_id,
        'teacherName', tu.name,
        'examinerId', COALESCE(a.examiner_user_id, p.teacher_id_snapshot, s.teacher_id),
        'examinerName', COALESCE(eu.name, tu.name, 'Guru Halaqah'),
        'hasAssignment', (a.id IS NOT NULL),
        'snapshotId', snap.id,
        'snapshotStatus', snap.status,
        'startSurahName', snap.start_surah_name,
        'startAyah', snap.start_ayah,
        'endSurahName', snap.end_surah_name,
        'endAyah', snap.end_ayah,
        'memorizationDirection', snap.memorization_direction,
        'questionSetId', qs.id,
        'questionSetStatus', qs.status,
        'isStale', (
            snap.status = 'finalized' AND qs.status IS NOT NULL AND 
            qs.material_fingerprint != calculate_material_fingerprint(snap.start_surah, snap.start_ayah, snap.end_surah, snap.end_ayah, snap.memorization_direction)
        ),
        'attemptId', att.id,
        'attemptStatus', att.status,
        'attemptNumber', att.attempt_number,
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
    LEFT JOIN exam_question_sets qs ON qs.exam_period_id = p.exam_period_id AND qs.student_id = p.student_id AND qs.status IN ('locked', 'stale')
    LEFT JOIN exam_attempts att ON att.exam_period_id = p.exam_period_id AND att.student_id = p.student_id AND att.status IN ('in_progress', 'submitted')
    WHERE p.exam_period_id = p_period_id
      AND (
          v_user.role = 'admin' 
          OR a.examiner_user_id = v_user.id
          OR (a.examiner_user_id IS NULL AND (p.teacher_id_snapshot = v_user.id OR s.teacher_id = v_user.id))
      );

    RETURN json_build_object(
        'success', true,
        'period', json_build_object(
            'id', v_period.id,
            'name', v_period.name,
            'kkm', v_period.kkm,
            'status', v_period.status
        ),
        'students', COALESCE(v_students, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_period_question_sets_summary(p_username text, p_password text, p_period_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_results JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT json_agg(json_build_object(
        'studentId', p.student_id,
        'studentName', p.student_name_snapshot,
        'class', p.class_snapshot,
        'halaqah', p.halaqah_snapshot,
        'questionSetId', s.id,
        'status', s.status,
        'version', s.version,
        'generatedAt', s.generated_at,
        'hasQuestions', (s.id IS NOT NULL)
    )) INTO v_results
    FROM exam_participants p
    LEFT JOIN LATERAL (
        SELECT id, status, version, generated_at
        FROM exam_question_sets eqs
        WHERE eqs.exam_period_id = p_period_id 
          AND eqs.student_id = p.student_id 
          AND eqs.status IN ('locked', 'stale')
        ORDER BY eqs.version DESC 
        LIMIT 1
    ) s ON true
    WHERE p.exam_period_id = p_period_id
      AND (v_user.role = 'admin' OR p.teacher_id_snapshot = v_user.id);

    RETURN json_build_object(
        'success', true,
        'data', COALESCE(v_results, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_question_bank_secure(p_username text, p_password text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_role TEXT;
    v_items JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengakses fitur ini.');
    END IF;
    v_role := v_auth.out_role;

    SELECT json_agg(q ORDER BY q.updated_at DESC) INTO v_items FROM question_bank q;

    RETURN json_build_object('success', true, 'data', COALESCE(v_items, '[]'::json));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_remedial_attempt_detail(p_username text, p_password text, p_attempt_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_attempt RECORD;
    v_session RECORD;
    v_period RECORD;
    v_student RECORD;
    v_questions JSON;
    v_assessments JSON;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.get_remedial_generation_candidates(p_username text, p_password text, p_academic_term_id text DEFAULT NULL::text, p_config_id text DEFAULT NULL::text, p_exam_period_id text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_candidates JSONB := '[]'::jsonb;
    v_total_candidates INTEGER := 0;
    v_ready_count INTEGER := 0;
    v_pending_count INTEGER := 0;
    v_r RECORD;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengelola persiapan remedial.');
    END IF;

    -- 2. Query Kandidat Remedial yang Sah (Server-Authoritative)
    -- Syarat: Ujian original berstatus submitted, nilai < KKM, snapshot finalized
    FOR v_r IN
        SELECT 
            s.id AS student_id,
            s.name AS student_name,
            s.nis AS student_nis,
            COALESCE(p.class_snapshot, s.class) AS class_name,
            COALESCE(p.halaqah_snapshot, s.halaqah) AS halaqah,
            ep.id AS original_period_id,
            ep.name AS original_period_name,
            ep.exam_type,
            ep.kkm,
            att.id AS original_attempt_id,
            att.question_set_id AS original_question_set_id,
            att.total_score AS original_score,
            att.submitted_at AS original_submitted_at,
            ems.id AS material_snapshot_id,
            ers.id AS remedial_session_id,
            COALESCE(ers.status, 'eligible') AS session_status,
            erqs.id AS remedial_question_set_id,
            erqs.version AS remedial_version,
            erqs.status AS remedial_set_status,
            (
                SELECT COUNT(*) FROM exam_remedial_questions erq 
                WHERE erq.remedial_question_set_id = erqs.id
            ) AS remedial_question_count
        FROM exam_attempts att
        JOIN exam_periods ep ON ep.id = att.exam_period_id
        JOIN students s ON s.id = att.student_id
        JOIN exam_participants p ON p.exam_period_id = ep.id AND p.student_id = s.id
        JOIN exam_material_snapshots ems ON ems.exam_period_id = ep.id AND ems.student_id = s.id
        LEFT JOIN exam_remedial_sessions ers ON ers.original_exam_period_id = ep.id AND ers.student_id = s.id
        LEFT JOIN exam_remedial_question_sets erqs ON erqs.id = ers.remedial_question_set_id
        WHERE att.status = 'submitted'
          AND att.total_score < ep.kkm
          AND ems.status = 'finalized'
          AND (p_exam_period_id IS NULL OR ep.id = p_exam_period_id)
          AND (p_academic_term_id IS NULL OR ep.academic_term_id = p_academic_term_id)
        ORDER BY class_name ASC, s.name ASC, ep.exam_type ASC
    LOOP
        v_total_candidates := v_total_candidates + 1;
        IF v_r.remedial_set_status = 'locked' THEN
            v_ready_count := v_ready_count + 1;
        ELSE
            v_pending_count := v_pending_count + 1;
        END IF;

        v_candidates := v_candidates || jsonb_build_object(
            'studentId', v_r.student_id,
            'studentName', v_r.student_name,
            'studentNis', v_r.student_nis,
            'className', v_r.class_name,
            'halaqah', v_r.halaqah,
            'examType', v_r.exam_type,
            'originalPeriodId', v_r.original_period_id,
            'originalPeriodName', v_r.original_period_name,
            'originalAttemptId', v_r.original_attempt_id,
            'originalQuestionSetId', v_r.original_question_set_id,
            'originalScore', v_r.original_score,
            'kkm', v_r.kkm,
            'materialSnapshotId', v_r.material_snapshot_id,
            'remedialSessionId', v_r.remedial_session_id,
            'generationStatus', v_r.session_status,
            'remedialQuestionSetId', v_r.remedial_question_set_id,
            'remedialVersion', v_r.remedial_version,
            'isPackageReady', (v_r.remedial_set_status = 'locked'),
            'questionCount', v_r.remedial_question_count
        );
    END LOOP;

    RETURN json_build_object(
        'success', true,
        'summary', jsonb_build_object(
            'totalCandidates', v_total_candidates,
            'readyCount', v_ready_count,
            'pendingCount', v_pending_count
        ),
        'candidates', v_candidates
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_remedial_question_set(p_username text, p_password text, p_remedial_session_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_session RECORD;
    v_qset RECORD;
    v_questions JSONB;
    v_orig_attempt RECORD;
    v_orig_period RECORD;
    v_student RECORD;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak melihat rincian paket soal remedial.');
    END IF;

    -- 2. Cari Sesi Remedial
    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = p_remedial_session_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi remedial tidak ditemukan.');
    END IF;

    -- 3. Ambil data original
    SELECT * INTO v_orig_attempt FROM exam_attempts WHERE id = v_session.original_attempt_id;
    SELECT * INTO v_orig_period FROM exam_periods WHERE id = v_session.original_exam_period_id;
    SELECT * INTO v_student FROM students WHERE id = v_session.student_id;

    -- 4. Ambil paket soal remedial jika ada
    IF v_session.remedial_question_set_id IS NOT NULL THEN
        SELECT * INTO v_qset FROM exam_remedial_question_sets WHERE id = v_session.remedial_question_set_id;
        
        SELECT json_agg(row_to_json(q.*) ORDER BY q.question_number)
        INTO v_questions
        FROM exam_remedial_questions q
        WHERE q.remedial_question_set_id = v_qset.id;
    END IF;

    RETURN json_build_object(
        'success', true,
        'remedialSession', row_to_json(v_session),
        'student', json_build_object(
            'id', v_student.id,
            'name', v_student.name,
            'nis', v_student.nis,
            'class', v_student.class,
            'halaqah', v_student.halaqah
        ),
        'originalExam', json_build_object(
            'periodId', v_orig_period.id,
            'periodName', v_orig_period.name,
            'examType', v_orig_period.exam_type,
            'kkm', v_orig_period.kkm,
            'attemptId', v_orig_attempt.id,
            'questionSetId', v_orig_attempt.question_set_id,
            'score', v_orig_attempt.total_score,
            'submittedAt', v_orig_attempt.submitted_at
        ),
        'questionSet', CASE WHEN v_qset.id IS NOT NULL THEN row_to_json(v_qset) ELSE NULL END,
        'questions', COALESCE(v_questions, '[]'::jsonb)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_semester_evaluation_configs(p_username text, p_password text, p_academic_term_id text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_configs JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.get_semester_final_recap(p_username text, p_password text, p_academic_term_id text DEFAULT NULL::text, p_config_id text DEFAULT NULL::text, p_uts_period_id text DEFAULT NULL::text, p_uas_period_id text DEFAULT NULL::text, p_class text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_term RECORD;
    v_uts_period RECORD;
    v_uas_period RECORD;
    v_uts_weight NUMERIC(5,2) := 40.00;
    v_uas_weight NUMERIC(5,2) := 60.00;
    v_config_name TEXT := 'Rekap Evaluasi Semester Final';
    v_config RECORD;
    v_config_id TEXT := NULL;
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
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

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
        v_config_id := v_config.id;
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
            v_config_id := v_config.id;
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
            v_config_id := v_config.id;
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
            'id', v_config_id,
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
$function$;

CREATE OR REPLACE FUNCTION public.get_semester_tahfiz_recap(p_username text, p_password text, p_academic_term_id text DEFAULT NULL::text, p_config_id text DEFAULT NULL::text, p_uts_period_id text DEFAULT NULL::text, p_uas_period_id text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_term RECORD;
    v_uts_period RECORD;
    v_uas_period RECORD;
    v_uts_weight NUMERIC(5,2) := 40.00;
    v_uas_weight NUMERIC(5,2) := 60.00;
    v_config_name TEXT := 'Rekap Evaluasi Semester';
    v_config RECORD;
    v_config_id TEXT := NULL;
    v_uts_count INTEGER;
    v_uas_count INTEGER;

    v_student RECORD;
    v_uts_att RECORD;
    v_uts_att_id TEXT;
    v_uts_qset_id TEXT;
    v_uas_att RECORD;
    v_uas_att_id TEXT;
    v_uas_qset_id TEXT;
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
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

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
        v_config_id := v_config.id;
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
            v_config_id := v_config.id;
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
            v_config_id := v_config.id;
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
        v_uts_att_id := NULL;
        v_uts_qset_id := NULL;
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
            v_uts_att_id := v_uts_att_id;
            v_uts_qset_id := v_uts_qset_id;
            IF v_uts_score >= v_uts_period.kkm THEN
                v_uts_status := 'TUNTAS';
                v_uts_remedial := false;
            ELSE
                v_uts_status := 'PERLU_REMEDIAL';
                v_uts_remedial := true;
                v_uts_remedial_count := v_uts_remedial_count + 1;
            END IF;

            -- Ambil question set untuk trace snapshot material original
            SELECT * INTO v_uts_qs FROM exam_question_sets WHERE id = v_uts_qset_id;
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
        v_uas_att_id := NULL;
        v_uas_qset_id := NULL;
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
            v_uas_att_id := v_uas_att_id;
            v_uas_qset_id := v_uas_qset_id;
            IF v_uas_score >= v_uas_period.kkm THEN
                v_uas_status := 'TUNTAS';
                v_uas_remedial := false;
            ELSE
                v_uas_status := 'PERLU_REMEDIAL';
                v_uas_remedial := true;
                v_uas_remedial_count := v_uas_remedial_count + 1;
            END IF;

            -- Ambil question set untuk trace snapshot material original
            SELECT * INTO v_uas_qs FROM exam_question_sets WHERE id = v_uas_qset_id;
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
                'attemptId', v_uts_att_id,
                'originalScore', v_uts_score,
                'kkm', v_uts_period.kkm,
                'status', v_uts_status,
                'remedialEligible', v_uts_remedial,
                'materialSnapshotId', v_uts_snap_id
            ),
            'uas', jsonb_build_object(
                'periodId', v_uas_period.id,
                'attemptId', v_uas_att_id,
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
                'originalAttemptId', v_uts_att_id,
                'originalQuestionSetId', v_uts_qset_id,
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
                'originalAttemptId', v_uas_att_id,
                'originalQuestionSetId', v_uas_qset_id,
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
$function$;

CREATE OR REPLACE FUNCTION public.get_student_evaluation_history(p_username text, p_password text, p_student_id text, p_academic_term_id text DEFAULT NULL::text, p_config_id text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_student RECORD;
    v_recap_res JSONB;
    v_item JSONB;
    v_target_item JSONB := NULL;
    v_timeline JSONB := '[]'::jsonb;
    v_log RECORD;
    v_period_ids TEXT[];
    v_action_label TEXT;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak melihat riwayat detail evaluasi santri.');
    END IF;

    -- 2. Validasi Santri
    SELECT * INTO v_student FROM students WHERE id = p_student_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Data santri tidak ditemukan.');
    END IF;

    -- 3. Ambil data rekap santri melalui get_semester_final_recap
    SELECT (get_semester_final_recap(
        p_username, p_password, p_academic_term_id, p_config_id,
        NULL, NULL, NULL, NULL, v_student.nis
    ))::jsonb INTO v_recap_res;

    IF (v_recap_res->>'success')::BOOLEAN = false THEN
        RETURN v_recap_res::json;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_recap_res->'recap')
    LOOP
        IF v_item->>'studentId' = p_student_id THEN
            v_target_item := v_item;
            EXIT;
        END IF;
    END LOOP;

    IF v_target_item IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Santri tidak terdaftar dalam evaluasi semester yang dipilih.');
    END IF;

    -- 4. Kumpulkan Timeline Otoritatif dari exam_audit_logs
    v_period_ids := ARRAY[v_target_item->>'utsPeriodId', v_target_item->>'uasPeriodId'];

    FOR v_log IN
        SELECT l.*, u.name AS actor_name, u.role AS actor_role
        FROM exam_audit_logs l
        LEFT JOIN users u ON u.id = l.actor_id
        WHERE l.student_id = p_student_id
          AND (l.exam_period_id IS NULL OR l.exam_period_id = ANY(v_period_ids))
        ORDER BY l.created_at ASC
    LOOP
        v_action_label := CASE v_log.action
            WHEN 'examiner_assigned' THEN 'Penugasan Penguji'
            WHEN 'examiner_reassigned' THEN 'Pergantian Penguji'
            WHEN 'exam_attempt_started' THEN 'Ujian Dimulai'
            WHEN 'exam_attempt_submitted' THEN 'Ujian Disubmit'
            WHEN 'remedial_session_generated' THEN 'Paket Remedial Dibuat'
            WHEN 'remedial_examiner_assigned' THEN 'Penugasan Penguji Remedial'
            WHEN 'remedial_examiner_reassigned' THEN 'Pergantian Penguji Remedial'
            WHEN 'remedial_exam_started' THEN 'Ujian Remedial Dimulai'
            WHEN 'remedial_exam_submitted' THEN 'Ujian Remedial Disubmit'
            WHEN 'remedial_exam_reopened' THEN 'Ujian Remedial Dibuka Kembali (Reopened)'
            ELSE v_log.action
        END;

        v_timeline := v_timeline || jsonb_build_array(jsonb_build_object(
            'id', v_log.id,
            'action', v_log.action,
            'actionLabel', v_action_label,
            'actorId', v_log.actor_id,
            'actorName', COALESCE(v_log.actor_name, 'System'),
            'actorRole', v_log.actor_role,
            'reason', v_log.reason,
            'beforeData', v_log.before_data,
            'afterData', v_log.after_data,
            'createdAt', v_log.created_at
        ));
    END LOOP;

    RETURN json_build_object(
        'success', true,
        'student', json_build_object(
            'id', v_student.id,
            'name', v_student.name,
            'nis', v_student.nis,
            'class', v_student.class,
            'halaqah', v_student.halaqah
        ),
        'config', v_recap_res->'config',
        'recap', v_target_item,
        'timeline', v_timeline
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_tahfiz_evaluation_data(p_username text, p_password text, p_period_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_term RECORD;
    v_participants JSON;
    v_snapshots JSON;
    v_audit_logs JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Parent tidak memiliki akses ke data evaluasi.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    SELECT * INTO v_term FROM academic_terms WHERE id = v_period.academic_term_id;

    -- Query Peserta: Admin melihat semua, Guru hanya melihat santri halaqahnya
    IF v_user.role = 'admin' THEN
        SELECT json_agg(json_build_object(
            'id', p.id,
            'examPeriodId', p.exam_period_id,
            'studentId', p.student_id,
            'studentName', p.student_name_snapshot,
            'class', p.class_snapshot,
            'halaqah', p.halaqah_snapshot,
            'teacherId', p.teacher_id_snapshot,
            'status', p.status
        ) ORDER BY p.class_snapshot, p.student_name_snapshot) INTO v_participants
        FROM exam_participants p
        WHERE p.exam_period_id = p_period_id;

        SELECT json_agg(json_build_object(
            'id', s.id,
            'examPeriodId', s.exam_period_id,
            'studentId', s.student_id,
            'sourceType', s.source_type,
            'startSurah', s.start_surah,
            'startAyah', s.start_ayah,
            'endSurah', s.end_surah,
            'endAyah', s.end_ayah,
            'startPage', s.start_page,
            'endPage', s.end_page,
            'startJuz', s.start_juz,
            'endJuz', s.end_juz,
            'estimatedPages', s.estimated_pages,
            'startSurahName', s.start_surah_name,
            'endSurahName', s.end_surah_name,
            'firstRecordDate', s.first_record_date,
            'lastRecordDate', s.last_record_date,
            'totalRecordsAnalyzed', s.total_records_analyzed,
            'memorizationDirection', s.memorization_direction,
            'status', s.status,
            'reviewReason', s.review_reason,
            'overrideReason', s.override_reason,
            'verifiedBy', s.verified_by,
            'verifiedAt', s.verified_at,
            'finalizedBy', s.finalized_by,
            'finalizedAt', s.finalized_at
        )) INTO v_snapshots
        FROM exam_material_snapshots s
        WHERE s.exam_period_id = p_period_id;

        SELECT json_agg(json_build_object(
            'id', a.id,
            'examPeriodId', a.exam_period_id,
            'studentId', a.student_id,
            'action', a.action,
            'actorId', a.actor_id,
            'beforeData', a.before_data,
            'afterData', a.after_data,
            'reason', a.reason,
            'createdAt', a.created_at
        ) ORDER BY a.created_at DESC) INTO v_audit_logs
        FROM exam_audit_logs a
        WHERE a.exam_period_id = p_period_id;

    ELSE
        -- TEACHER: Filter hanya santri halaqahnya
        SELECT json_agg(json_build_object(
            'id', p.id,
            'examPeriodId', p.exam_period_id,
            'studentId', p.student_id,
            'studentName', p.student_name_snapshot,
            'class', p.class_snapshot,
            'halaqah', p.halaqah_snapshot,
            'teacherId', p.teacher_id_snapshot,
            'status', p.status
        ) ORDER BY p.student_name_snapshot) INTO v_participants
        FROM exam_participants p
        WHERE p.exam_period_id = p_period_id 
          AND p.teacher_id_snapshot = v_user.id;

        SELECT json_agg(json_build_object(
            'id', s.id,
            'examPeriodId', s.exam_period_id,
            'studentId', s.student_id,
            'sourceType', s.source_type,
            'startSurah', s.start_surah,
            'startAyah', s.start_ayah,
            'endSurah', s.end_surah,
            'endAyah', s.end_ayah,
            'startPage', s.start_page,
            'endPage', s.end_page,
            'startJuz', s.start_juz,
            'endJuz', s.end_juz,
            'estimatedPages', s.estimated_pages,
            'startSurahName', s.start_surah_name,
            'endSurahName', s.end_surah_name,
            'firstRecordDate', s.first_record_date,
            'lastRecordDate', s.last_record_date,
            'totalRecordsAnalyzed', s.total_records_analyzed,
            'memorizationDirection', s.memorization_direction,
            'status', s.status,
            'reviewReason', s.review_reason,
            'overrideReason', s.override_reason,
            'verifiedBy', s.verified_by,
            'verifiedAt', s.verified_at,
            'finalizedBy', s.finalized_by,
            'finalizedAt', s.finalized_at
        )) INTO v_snapshots
        FROM exam_material_snapshots s
        JOIN exam_participants ep ON ep.exam_period_id = s.exam_period_id AND ep.student_id = s.student_id
        WHERE s.exam_period_id = p_period_id
          AND ep.teacher_id_snapshot = v_user.id;

        v_audit_logs := '[]'::json;
    END IF;

    RETURN json_build_object(
        'success', true,
        'period', json_build_object(
            'id', v_period.id,
            'academicTermId', v_period.academic_term_id,
            'name', v_period.name,
            'examType', v_period.exam_type,
            'materialCutoffDate', v_period.material_cutoff_date,
            'examStartDate', v_period.exam_start_date,
            'examEndDate', v_period.exam_end_date,
            'kkm', v_period.kkm,
            'targetClasses', v_period.target_classes,
            'targetHalaqahs', v_period.target_halaqahs,
            'status', v_period.status
        ),
        'academicTerm', json_build_object(
            'id', v_term.id,
            'academicYear', v_term.academic_year,
            'semester', v_term.semester,
            'startDate', v_term.start_date,
            'endDate', v_term.end_date,
            'status', v_term.status
        ),
        'participants', COALESCE(v_participants, '[]'::json),
        'materialSnapshots', COALESCE(v_snapshots, '[]'::json),
        'auditLogs', COALESCE(v_audit_logs, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_uas_attempt(p_username text, p_password text, p_attempt_id text)
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
    v_student RECORD;
    v_questions JSON;
    v_assessments JSON;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    -- Role Whitelist: Hanya Admin dan Teacher yang diizinkan
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat melihat detail ujian.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian UAS tidak ditemukan.');
    END IF;

    -- Teacher authorization: harus penguji sesi attempt ini
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang berwenang untuk sesi ini.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
    SELECT * INTO v_student FROM students WHERE id = v_attempt.student_id;

    -- 3. Ambil 9 Butir Soal
    SELECT json_agg(json_build_object(
        'id', q.id,
        'questionNumber', q.question_number,
        'questionRole', q.question_role,
        'zoneNumber', q.zone_number,
        'maxScore', q.max_score,
        'pageNumber', q.page_number,
        'sourceType', q.source_type,
        'promptStartSurah', q.prompt_start_surah,
        'promptStartAyah', q.prompt_start_ayah,
        'promptStartWord', q.prompt_start_word,
        'promptEndSurah', q.prompt_end_surah,
        'promptEndAyah', q.prompt_end_ayah,
        'promptEndWord', q.prompt_end_word,
        'answerStartSurah', q.answer_start_surah,
        'answerStartAyah', q.answer_start_ayah,
        'answerStartWord', q.answer_start_word,
        'answerEndSurah', q.answer_end_surah,
        'answerEndAyah', q.answer_end_ayah,
        'answerEndWord', q.answer_end_word,
        'startPage', q.start_page,
        'endPage', q.end_page,
        'generatedMetadata', q.generated_metadata
    ) ORDER BY q.question_number ASC) INTO v_questions
    FROM exam_questions q
    WHERE q.question_set_id = v_attempt.question_set_id;

    -- 4. Ambil 9 Butir Assessments
    SELECT json_agg(json_build_object(
        'id', a.id,
        'examAttemptId', a.exam_attempt_id,
        'examQuestionId', a.exam_question_id,
        'questionNumber', a.question_number,
        'fluencyScore', a.fluency_score,
        'tajwidScore', a.tajwid_score,
        'makhrajScore', a.makhraj_score,
        'fluencyEvents', a.fluency_events,
        'tajwidEvents', a.tajwid_events,
        'makhrajEvents', a.makhraj_events,
        'questionScore', a.question_score,
        'notes', a.notes,
        'completedAt', a.completed_at,
        'version', a.version
    ) ORDER BY a.question_number ASC) INTO v_assessments
    FROM exam_question_assessments a
    WHERE a.exam_attempt_id = p_attempt_id;

    RETURN json_build_object(
        'success', true,
        'attempt', json_build_object(
            'id', v_attempt.id,
            'examPeriodId', v_attempt.exam_period_id,
            'studentId', v_attempt.student_id,
            'studentName', v_student.name,
            'class', v_student.class,
            'questionSetId', v_attempt.question_set_id,
            'status', v_attempt.status,
            'totalScore', v_attempt.total_score,
            'startedAt', v_attempt.started_at,
            'lastSavedAt', v_attempt.last_saved_at,
            'submittedAt', v_attempt.submitted_at
        ),
        'kkm', v_period.kkm,
        'questions', v_questions,
        'assessments', v_assessments
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_uas_question_set(p_username text, p_password text, p_period_id text, p_student_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user_id TEXT;
    v_user_role TEXT;
    v_snapshot_status TEXT;
    v_current_fingerprint TEXT;
    v_set_row RECORD;
    v_ret_questions JSONB;
    v_is_stale BOOLEAN := false;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    v_user_id := v_auth.out_user_id;
    v_user_role := v_auth.out_role;

    IF v_user_role NOT IN ('admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    -- Ambil paket soal terkunci aktif
    SELECT * INTO v_set_row
    FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'locked'
    ORDER BY version DESC
    LIMIT 1;

    IF v_set_row.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket soal UAS belum dibuat atau tidak aktif.');
    END IF;

    -- Cek status stale terhadap snapshot terkini
    SELECT status, calculate_material_fingerprint(start_surah, start_ayah, end_surah, end_ayah, COALESCE(memorization_direction, 'forward'))
    INTO v_snapshot_status, v_current_fingerprint
    FROM exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF v_current_fingerprint IS NOT NULL AND v_set_row.material_fingerprint != v_current_fingerprint THEN
        v_is_stale := true;
    END IF;

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
    INTO v_ret_questions
    FROM exam_questions eq
    WHERE eq.question_set_id = v_set_row.id;

    RETURN jsonb_build_object(
        'success', true,
        'isStale', v_is_stale,
        'questionSet', row_to_json(v_set_row),
        'questions', COALESCE(v_ret_questions, '[]'::jsonb)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_uts_attempt(p_username text, p_password text, p_attempt_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_attempt RECORD;
    v_period RECORD;
    v_student RECORD;
    v_questions JSON;
    v_assessments JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
    END IF;

    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
    SELECT * INTO v_student FROM students WHERE id = v_attempt.student_id;

    -- Ambil soal
    SELECT json_agg(json_build_object(
        'id', q.id,
        'questionNumber', q.question_number,
        'zoneNumber', q.zone_number,
        'sourceType', q.source_type,
        'promptStartSurah', q.prompt_start_surah,
        'promptStartAyah', q.prompt_start_ayah,
        'promptStartWord', q.prompt_start_word,
        'promptEndSurah', q.prompt_end_surah,
        'promptEndAyah', q.prompt_end_ayah,
        'promptEndWord', q.prompt_end_word,
        'answerStartSurah', q.answer_start_surah,
        'answerStartAyah', q.answer_start_ayah,
        'answerStartWord', q.answer_start_word,
        'answerEndSurah', q.answer_end_surah,
        'answerEndAyah', q.answer_end_ayah,
        'answerEndWord', q.answer_end_word,
        'startPage', q.start_page,
        'endPage', q.end_page,
        'generatedMetadata', q.generated_metadata
    ) ORDER BY q.question_number ASC) INTO v_questions
    FROM exam_questions q
    WHERE q.question_set_id = v_attempt.question_set_id;

    -- Ambil assessments
    SELECT json_agg(json_build_object(
        'id', a.id,
        'examAttemptId', a.exam_attempt_id,
        'examQuestionId', a.exam_question_id,
        'questionNumber', a.question_number,
        'fluencyScore', a.fluency_score,
        'tajwidScore', a.tajwid_score,
        'makhrajScore', a.makhraj_score,
        'fluencyEvents', a.fluency_events,
        'tajwidEvents', a.tajwid_events,
        'makhrajEvents', a.makhraj_events,
        'questionScore', a.question_score,
        'notes', a.notes,
        'completedAt', a.completed_at,
        'version', a.version
    ) ORDER BY a.question_number ASC) INTO v_assessments
    FROM exam_question_assessments a
    WHERE a.exam_attempt_id = p_attempt_id;

    RETURN json_build_object(
        'success', true,
        'attempt', json_build_object(
            'id', v_attempt.id,
            'examPeriodId', v_attempt.exam_period_id,
            'studentId', v_attempt.student_id,
            'studentName', v_student.name,
            'class', v_student.class,
            'questionSetId', v_attempt.question_set_id,
            'status', v_attempt.status,
            'totalScore', v_attempt.total_score,
            'startedAt', v_attempt.started_at,
            'lastSavedAt', v_attempt.last_saved_at,
            'submittedAt', v_attempt.submitted_at
        ),
        'kkm', v_period.kkm,
        'questions', v_questions,
        'assessments', v_assessments
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_uts_question_set(p_username text, p_password text, p_period_id text, p_student_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_participant RECORD;
    v_snapshot RECORD;
    v_set RECORD;
    v_questions JSON;
    v_is_stale BOOLEAN := false;
    v_current_fingerprint TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    -- Otorisasi Role: Admin boleh semua, Guru hanya halaqahnya
    IF v_user.role = 'teacher' THEN
        SELECT * INTO v_participant FROM exam_participants 
        WHERE exam_period_id = p_period_id AND student_id = p_student_id;
        
        IF NOT FOUND OR v_participant.teacher_id_snapshot != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda hanya dapat melihat soal santri binaan halaqah Anda.');
        END IF;
    ELSIF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    -- Ambil set yang aktif (locked atau stale) versi tertinggi
    SELECT * INTO v_set 
    FROM exam_question_sets 
    WHERE exam_period_id = p_period_id 
      AND student_id = p_student_id 
      AND status IN ('locked', 'stale')
    ORDER BY version DESC 
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN json_build_object('success', true, 'hasQuestionSet', false, 'message', 'Soal UTS belum dibuat.');
    END IF;

    -- Cek apakah snapshot materi saat ini berbeda dari saat soal dibuat (stale detection)
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF FOUND THEN
        v_current_fingerprint := calculate_material_fingerprint(
            v_snapshot.start_surah,
            v_snapshot.start_ayah,
            v_snapshot.end_surah,
            v_snapshot.end_ayah,
            v_snapshot.memorization_direction
        );

        IF v_set.material_fingerprint != v_current_fingerprint THEN
            v_is_stale := true;
            IF v_set.status != 'stale' THEN
                UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_set.id;
                v_set.status := 'stale';
            END IF;
        END IF;
    END IF;

    -- Ambil 5 butir soal
    SELECT json_agg(json_build_object(
        'id', q.id,
        'questionSetId', q.question_set_id,
        'questionNumber', q.question_number,
        'zoneNumber', q.zone_number,
        'sourceType', q.source_type,
        'questionBankId', q.question_bank_id,
        'promptStartSurah', q.prompt_start_surah,
        'promptStartAyah', q.prompt_start_ayah,
        'promptStartWord', q.prompt_start_word,
        'promptEndSurah', q.prompt_end_surah,
        'promptEndAyah', q.prompt_end_ayah,
        'promptEndWord', q.prompt_end_word,
        'answerStartSurah', q.answer_start_surah,
        'answerStartAyah', q.answer_start_ayah,
        'answerStartWord', q.answer_start_word,
        'answerEndSurah', q.answer_end_surah,
        'answerEndAyah', q.answer_end_ayah,
        'answerEndWord', q.answer_end_word,
        'startPage', q.start_page,
        'endPage', q.end_page,
        'generatedMetadata', q.generated_metadata,
        'createdAt', q.created_at
    ) ORDER BY q.question_number) INTO v_questions
    FROM exam_questions q
    WHERE q.question_set_id = v_set.id;

    RETURN json_build_object(
        'success', true,
        'hasQuestionSet', true,
        'isStale', v_is_stale,
        'questionSet', json_build_object(
            'id', v_set.id,
            'examPeriodId', v_set.exam_period_id,
            'studentId', v_set.student_id,
            'materialSnapshotId', v_set.material_snapshot_id,
            'version', v_set.version,
            'generationStrategy', v_set.generation_strategy,
            'generationSeed', v_set.generation_seed,
            'materialFingerprint', v_set.material_fingerprint,
            'status', v_set.status,
            'generatedBy', v_set.generated_by,
            'generatedAt', v_set.generated_at,
            'lockedAt', v_set.locked_at,
            'createdAt', v_set.created_at,
            'updatedAt', v_set.updated_at
        ),
        'questions', COALESCE(v_questions, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.regenerate_uas_question_set(p_username text, p_password text, p_period_id text, p_student_id text, p_reason text, p_strategy text DEFAULT 'hybrid'::text, p_seed text DEFAULT NULL::text, p_questions jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user_id TEXT;
    v_user_role TEXT;
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
    v_old_set_id TEXT;
    v_old_version INTEGER;
    v_new_version INTEGER;
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
BEGIN
    -- 1. Autentikasi Admin
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    v_user_id := v_auth.out_user_id;
    v_user_role := v_auth.out_role;

    IF v_user_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berwenang meregenerasi soal UAS.');
    END IF;

    -- 2. Alasan Wajib Diisi
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Alasan regenerasi soal UAS wajib diisi.');
    END IF;

    -- 3. Snapshot Aktif Finalized
    SELECT id, status, start_surah, start_ayah, end_surah, end_ayah,
           calculate_material_fingerprint(start_surah, start_ayah, end_surah, end_ayah, COALESCE(memorization_direction, 'forward'))
    INTO v_snapshot_id, v_snapshot_status, v_snap_start_surah, v_snap_start_ayah, v_snap_end_surah, v_snap_end_ayah, v_material_fingerprint
    FROM exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF v_snapshot_status != 'finalized' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Materi UAS santri belum difinalisasi.');
    END IF;

    -- Batas canonical snapshot
    v_snap_min_surah := LEAST(v_snap_start_surah, v_snap_end_surah);
    v_snap_max_surah := GREATEST(v_snap_start_surah, v_snap_end_surah);
    IF v_snap_start_surah = v_snap_end_surah THEN
        v_snap_min_ayah := LEAST(v_snap_start_ayah, v_snap_end_ayah);
        v_snap_max_ayah := GREATEST(v_snap_start_ayah, v_snap_end_ayah);
    ELSE
        v_snap_min_ayah := CASE WHEN v_snap_start_surah < v_snap_end_surah THEN v_snap_start_ayah ELSE v_snap_end_ayah END;
        v_snap_max_ayah := CASE WHEN v_snap_start_surah > v_snap_end_surah THEN v_snap_start_ayah ELSE v_snap_end_ayah END;
    END IF;

    -- 4. Validasi Struktur 9 Soal Baru
    v_q_count := jsonb_array_length(p_questions);
    IF v_q_count != 9 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket soal UAS harus memiliki tepat 9 butir soal (2 wajib + 7 acak). Diterima: ' || v_q_count);
    END IF;

    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        v_q_num := (v_q_elem->>'questionNumber')::INTEGER;
        v_q_role := COALESCE(v_q_elem->>'questionRole', v_q_elem->>'question_role');
        v_q_score := COALESCE((v_q_elem->>'maxScore')::NUMERIC, (v_q_elem->>'max_score')::NUMERIC, 0);
        v_q_zone := (v_q_elem->>'zoneNumber')::INTEGER;
        v_q_source := COALESCE(v_q_elem->>'sourceType', v_q_elem->>'source_type', 'auto');
        v_q_bank_id := v_q_elem->>'questionBankId';
        v_q_page := (v_q_elem->>'pageNumber')::INTEGER;

        v_as_surah := COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER);
        v_as_ayah := COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER);
        v_as_word := COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER);

        v_ae_surah := COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER);
        v_ae_ayah := COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER);
        v_ae_word := COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER);

        -- Koordinat dasar
        IF v_as_surah NOT BETWEEN 1 AND 114 OR v_as_ayah < 1 OR v_as_word < 1 OR
           v_ae_surah NOT BETWEEN 1 AND 114 OR v_ae_ayah < 1 OR v_ae_word < 1 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Koordinat ayat/kata butir soal ' || v_q_num || ' tidak valid.');
        END IF;

        IF (v_as_surah > v_ae_surah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah > v_ae_ayah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah = v_ae_ayah AND v_as_word > v_ae_word) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Urutan jawaban B ke C pada butir soal ' || v_q_num || ' tidak valid.');
        END IF;

        IF (v_as_surah < v_snap_min_surah) OR (v_as_surah = v_snap_min_surah AND v_as_ayah < v_snap_min_ayah) OR
           (v_ae_surah > v_snap_max_surah) OR (v_ae_surah = v_snap_max_surah AND v_ae_ayah > v_snap_max_ayah) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Titik soal nomor ' || v_q_num || ' berada di luar batas snapshot materi santri.');
        END IF;

        v_total_score := v_total_score + v_q_score;

        IF v_q_role = 'mandatory' THEN
            v_mandatory_count := v_mandatory_count + 1;

            IF v_q_num NOT IN (1, 2) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib hanya boleh bernomor 1 atau 2.');
            END IF;

            IF v_q_score != 15 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal wajib harus tepat 15. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NOT NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib halaman penuh tidak boleh memiliki zone_number.');
            END IF;

            IF v_q_page IS NULL OR v_q_page NOT BETWEEN 1 AND 604 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor halaman soal wajib tidak valid (1-604).');
            END IF;

            IF v_q_page = ANY(v_used_mand_pages) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Kedua halaman soal wajib harus berbeda (halaman duplikat: ' || v_q_page || ').');
            END IF;
            v_used_mand_pages := array_append(v_used_mand_pages, v_q_page);

            IF v_q_source = 'bank' THEN
                IF v_q_bank_id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Soal wajib bank harus menyertakan questionBankId.');
                END IF;

                SELECT id, status, exam_type, question_type, question_format, page_number
                INTO v_bank_row
                FROM question_bank
                WHERE id = v_q_bank_id;

                IF v_bank_row.id IS NULL OR v_bank_row.status != 'active' OR v_bank_row.exam_type NOT IN ('uas', 'generic') OR
                   v_bank_row.question_type != 'mandatory' OR v_bank_row.question_format != 'full_page' OR v_bank_row.page_number != v_q_page THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Validasi Bank Soal ID ' || v_q_bank_id || ' gagal.');
                END IF;
            END IF;

        ELSIF v_q_role = 'random' THEN
            v_random_count := v_random_count + 1;

            IF v_q_num NOT BETWEEN 3 AND 9 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak harus bernomor 3 s.d. 9.');
            END IF;

            IF v_q_score != 10 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal acak harus tepat 10. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NULL OR v_q_zone NOT BETWEEN 1 AND 7 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor zona soal acak harus antara 1 dan 7.');
            END IF;

            IF v_q_zone = ANY(v_used_zones) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Setiap zona 1 s.d. 7 harus unik (duplikasi zona: ' || v_q_zone || ').');
            END IF;
            v_used_zones := array_append(v_used_zones, v_q_zone);

            v_ps_surah := (v_q_elem->'promptStart'->>'surahNumber')::INTEGER;
            v_ps_ayah := (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER;
            v_ps_word := (v_q_elem->'promptStart'->>'wordPosition')::INTEGER;

            v_pe_surah := (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER;
            v_pe_ayah := (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER;
            v_pe_word := (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER;

            IF v_ps_surah IS NULL OR v_pe_surah IS NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak sambung ayat wajib memiliki prompt penguji A dan A-aksen.');
            END IF;

            IF (v_ps_surah > v_pe_surah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah > v_pe_ayah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah = v_pe_ayah AND v_ps_word > v_pe_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Urutan prompt A ke A-aksen soal ' || v_q_num || ' tidak valid.');
            END IF;

            IF (v_pe_surah > v_as_surah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah > v_as_ayah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah = v_as_ayah AND v_pe_word >= v_as_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal jawaban B harus setelah prompt A-aksen pada butir soal ' || v_q_num || '.');
            END IF;

            v_b_key := v_as_surah || ':' || v_as_ayah || ':' || v_as_word;
            IF v_b_key = ANY(v_used_random_b) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal B soal acak harus unik (ditemukan duplikasi: ' || v_b_key || ').');
            END IF;
            v_used_random_b := array_append(v_used_random_b, v_b_key);

            IF v_q_source = 'bank' THEN
                IF v_q_bank_id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Soal acak bank harus menyertakan questionBankId.');
                END IF;

                SELECT id, status, exam_type, question_type, question_format
                INTO v_bank_row
                FROM question_bank
                WHERE id = v_q_bank_id;

                IF v_bank_row.id IS NULL OR v_bank_row.status != 'active' OR v_bank_row.exam_type NOT IN ('uas', 'generic') OR
                   v_bank_row.question_type != 'random' OR v_bank_row.question_format != 'continuation' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Validasi Bank Soal ID ' || v_q_bank_id || ' gagal.');
                END IF;
            END IF;
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Role soal tidak valid: ' || v_q_role);
        END IF;
    END LOOP;

    IF v_mandatory_count != 2 OR v_random_count != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Struktur soal UAS harus tepat 2 soal wajib dan 7 soal acak.');
    END IF;

    IF array_length(v_used_zones, 1) != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Tepat 7 zona (Zona 1 s.d. 7) harus terpenuhi.');
    END IF;

    IF v_total_score != 100 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Total bobot nilai soal UAS harus 100. Terhitung: ' || v_total_score);
    END IF;

    -- 5. Ambil Versi Terakhir
    SELECT id, version INTO v_old_set_id, v_old_version
    FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id
    ORDER BY version DESC
    LIMIT 1;

    v_new_version := COALESCE(v_old_version, 0) + 1;

    -- Void paket lama
    IF v_old_set_id IS NOT NULL THEN
        UPDATE exam_question_sets
        SET status = 'void', updated_at = timezone('utc'::text, now())
        WHERE id = v_old_set_id;

        -- Audit Log: uas_question_set_voided
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            before_data, after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            p_period_id,
            p_student_id,
            'uas_question_set_voided',
            v_user_id,
            jsonb_build_object('voidedSetId', v_old_set_id, 'version', v_old_version),
            NULL,
            p_reason,
            timezone('utc'::text, now())
        );
    END IF;

    -- 6. Buat Paket Baru
    v_final_seed := COALESCE(p_seed, 'seed_uas_' || p_period_id || '_' || p_student_id || '_v' || v_new_version || '_' || floor(extract(epoch from now())));
    v_new_set_id := 'eqs_uas_' || p_period_id || '_' || p_student_id || '_v' || v_new_version;

    INSERT INTO exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id, version,
        generation_strategy, generation_seed, material_fingerprint, status,
        generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_new_set_id, p_period_id, p_student_id, v_snapshot_id, v_new_version,
        COALESCE(p_strategy, 'hybrid'), v_final_seed, v_material_fingerprint, 'locked',
        v_user_id, timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())
    );

    -- Simpan 9 butir soal baru
    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        INSERT INTO exam_questions (
            id, question_set_id, question_number, zone_number, question_role,
            source_type, question_bank_id, page_number, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'eq_uas_' || v_new_set_id || '_q' || (v_q_elem->>'questionNumber'),
            v_new_set_id,
            (v_q_elem->>'questionNumber')::INTEGER,
            (v_q_elem->>'zoneNumber')::INTEGER,
            COALESCE(v_q_elem->>'questionRole', 'random'),
            COALESCE(v_q_elem->>'sourceType', 'auto'),
            v_q_elem->>'questionBankId',
            (v_q_elem->>'pageNumber')::INTEGER,
            COALESCE((v_q_elem->>'maxScore')::NUMERIC, 10.00),
            (v_q_elem->'promptStart'->>'surahNumber')::INTEGER,
            (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER,
            (v_q_elem->'promptStart'->>'wordPosition')::INTEGER,
            (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER,
            (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER,
            (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER,
            COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER),
            COALESCE((v_q_elem->>'startPage')::INTEGER, (v_q_elem->>'start_page')::INTEGER),
            COALESCE((v_q_elem->>'endPage')::INTEGER, (v_q_elem->>'end_page')::INTEGER),
            COALESCE(v_q_elem->'metadata', '{}'::jsonb),
            timezone('utc'::text, now())
        );
    END LOOP;

    -- Audit Log: uas_question_set_regenerated
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        p_student_id,
        'uas_question_set_regenerated',
        v_user_id,
        jsonb_build_object(
            'oldQuestionSetId', v_old_set_id,
            'oldVersion', v_old_version
        ),
        jsonb_build_object(
            'questionSetId', v_new_set_id,
            'newVersion', v_new_version,
            'strategy', p_strategy,
            'status', 'locked',
            'questionsCount', 9,
            'mandatoryCount', v_mandatory_count,
            'randomCount', v_random_count,
            'totalMaxScore', v_total_score
        ),
        p_reason,
        timezone('utc'::text, now())
    );

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
    INTO v_ret_questions
    FROM exam_questions eq
    WHERE eq.question_set_id = v_new_set_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Berhasil meregenerasi 9 soal UAS untuk santri.',
        'questionSet', (SELECT row_to_json(eqs.*) FROM exam_question_sets eqs WHERE eqs.id = v_new_set_id),
        'questions', COALESCE(v_ret_questions, '[]'::jsonb)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.regenerate_uts_question_set(p_username text, p_password text, p_period_id text, p_student_id text, p_strategy text, p_questions_data jsonb, p_seed text, p_fingerprint text, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_snapshot RECORD;
    v_old_set RECORD;
    v_calculated_fingerprint TEXT;
    v_new_version INTEGER := 1;
    v_new_set_id TEXT;
    v_q JSONB;
    v_inserted_questions JSON;
    v_q_count INTEGER;
    v_expected_q_count INTEGER;
    v_q_max NUMERIC(5,2);
    v_q_num INTEGER;
BEGIN
    SET search_path = public, extensions;

    -- 1. Autentikasi User (Admin Only)
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak men-generate ulang soal UTS.');
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Alasan generate ulang (reason) wajib diisi.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    v_expected_q_count := COALESCE(v_period.uts_question_count, 5);

    -- 2. Validasi Snapshot Materi Wajib FINAL
    SELECT * INTO v_snapshot FROM exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Materi ujian santri belum difinalisasi.');
    END IF;

    v_calculated_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_calculated_fingerprint != p_fingerprint THEN
        RETURN json_build_object('success', false, 'message', 'Fingerprint materi tidak cocok.');
    END IF;

    -- 3. Cek attempt ujian yang sedang berjalan/submitted
    IF EXISTS (
        SELECT 1 FROM exam_attempts 
        WHERE exam_period_id = p_period_id 
          AND student_id = p_student_id 
          AND status IN ('in_progress', 'submitted')
    ) THEN
        RETURN json_build_object('success', false, 'message', 'Tidak dapat membuat ulang soal: Ujian santri sedang berlangsung atau sudah diselesaikan.');
    END IF;

    -- 4. Void set lama jika ada
    SELECT * INTO v_old_set FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status != 'void'
    ORDER BY version DESC LIMIT 1;

    IF FOUND THEN
        UPDATE exam_question_sets
        SET status = 'void', updated_at = now()
        WHERE id = v_old_set.id;

        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            p_period_id, p_student_id, 'question_set_voided', v_user.id,
            jsonb_build_object('voidedSetId', v_old_set.id, 'version', v_old_set.version),
            p_reason, now()
        );

        v_new_version := v_old_set.version + 1;
    ELSE
        SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_version
        FROM exam_question_sets
        WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    END IF;

    -- 5. Validasi Jumlah Soal (5, 10, 15, atau 20)
    v_q_count := jsonb_array_length(p_questions_data);
    IF v_q_count NOT IN (5, 10, 15, 20) THEN
        RETURN json_build_object('success', false, 'message', 'Jumlah butir soal tidak valid (' || v_q_count || '). Hanya diperbolehkan 5, 10, 15, atau 20 butir.');
    END IF;

    IF v_q_count != v_expected_q_count THEN
        RETURN json_build_object('success', false, 'message', 'Jumlah butir soal (' || v_q_count || ') tidak sesuai dengan konfigurasi periode (' || v_expected_q_count || ' soal).');
    END IF;

    v_new_set_id := 'eqs_' || p_period_id || '_' || p_student_id || '_v' || v_new_version;

    -- 6. Insert Set Baru
    INSERT INTO exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id,
        version, generation_strategy, generation_seed, material_fingerprint,
        status, total_questions, generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_new_set_id,
        p_period_id,
        p_student_id,
        v_snapshot.id,
        v_new_version,
        COALESCE(p_strategy, 'hybrid'),
        p_seed,
        v_calculated_fingerprint,
        'locked',
        v_q_count,
        v_user.id,
        now(),
        now(),
        now(),
        now()
    );

    -- 7. Insert exam_questions
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        v_q_num := (v_q->>'questionNumber')::INTEGER;

        IF (v_q->>'maxScore') IS NOT NULL THEN
            v_q_max := (v_q->>'maxScore')::NUMERIC(5,2);
        ELSE
            IF v_q_count = 5 THEN
                v_q_max := 20.00;
            ELSIF v_q_count = 10 THEN
                v_q_max := 10.00;
            ELSIF v_q_count = 20 THEN
                v_q_max := 5.00;
            ELSIF v_q_count = 15 THEN
                IF v_q_num <= 10 THEN v_q_max := 6.67; ELSE v_q_max := 6.66; END IF;
            ELSE
                v_q_max := ROUND(100.0 / v_q_count, 2);
            END IF;
        END IF;

        INSERT INTO exam_questions (
            id, question_set_id, question_number, zone_number,
            source_type, question_bank_id, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'eq_' || v_new_set_id || '_q' || v_q_num,
            v_new_set_id,
            v_q_num,
            (v_q->>'zoneNumber')::INTEGER,
            v_q->>'sourceType',
            v_q->>'questionBankId',
            v_q_max,
            (v_q->>'promptStartSurah')::INTEGER,
            (v_q->>'promptStartAyah')::INTEGER,
            (v_q->>'promptStartWord')::INTEGER,
            (v_q->>'promptEndSurah')::INTEGER,
            (v_q->>'promptEndAyah')::INTEGER,
            (v_q->>'promptEndWord')::INTEGER,
            (v_q->>'answerStartSurah')::INTEGER,
            (v_q->>'answerStartAyah')::INTEGER,
            (v_q->>'answerStartWord')::INTEGER,
            (v_q->>'answerEndSurah')::INTEGER,
            (v_q->>'answerEndAyah')::INTEGER,
            (v_q->>'answerEndWord')::INTEGER,
            (v_q->>'startPage')::INTEGER,
            (v_q->>'endPage')::INTEGER,
            COALESCE(v_q->'generatedMetadata', '{}'::jsonb),
            now()
        );
    END LOOP;

    -- 8. Return Result
    SELECT json_build_object(
        'success', true,
        'message', 'Paket soal UTS berhasil di-generate ulang (Versi ' || v_new_version || ').',
        'questionSet', row_to_json(s),
        'questions', (
            SELECT json_agg(json_build_object(
                'id', q.id,
                'questionNumber', q.question_number,
                'zoneNumber', q.zone_number,
                'sourceType', q.source_type,
                'questionBankId', q.question_bank_id,
                'maxScore', q.max_score,
                'promptStartSurah', q.prompt_start_surah,
                'promptStartAyah', q.prompt_start_ayah,
                'promptStartWord', q.prompt_start_word,
                'promptEndSurah', q.prompt_end_surah,
                'promptEndAyah', q.prompt_end_ayah,
                'promptEndWord', q.prompt_end_word,
                'answerStartSurah', q.answer_start_surah,
                'answerStartAyah', q.answer_start_ayah,
                'answerStartWord', q.answer_start_word,
                'answerEndSurah', q.answer_end_surah,
                'answerEndAyah', q.answer_end_ayah,
                'answerEndWord', q.answer_end_word,
                'startPage', q.start_page,
                'endPage', q.end_page,
                'generatedMetadata', q.generated_metadata,
                'createdAt', q.created_at
            ) ORDER BY q.question_number)
            FROM exam_questions q
            WHERE q.question_set_id = s.id
        )
    ) INTO v_inserted_questions
    FROM exam_question_sets s
    WHERE s.id = v_new_set_id;

    RETURN v_inserted_questions;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_material_snapshot(p_username text, p_password text, p_snapshot_id text, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_snap RECORD;
    v_period RECORD;
    v_before JSONB;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuka kembali materi final.');
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan pembukaan kembali materi.');
    END IF;

    SELECT * INTO v_snap FROM exam_material_snapshots WHERE id = p_snapshot_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi tidak ditemukan.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_snap.exam_period_id;
    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    v_before := to_jsonb(v_snap);

    UPDATE exam_material_snapshots SET
        status = 'ready',
        finalized_by = NULL,
        finalized_at = NULL,
        updated_at = now()
    WHERE id = p_snapshot_id;

    INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
    VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_snap.exam_period_id,
        v_snap.student_id,
        'material_reopened',
        v_user.id,
        v_before,
        to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)),
        p_reason,
        now()
    );

    RETURN json_build_object('success', true, 'message', 'Materi berhasil dibuka kembali untuk revisi.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_remedial_attempt(p_username text, p_password text, p_attempt_id text, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_attempt RECORD;
    v_session RECORD;
    v_audit_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.reopen_uas_attempt(p_username text, p_password text, p_attempt_id text, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_attempt RECORD;
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    -- 2. Otorisasi Admin
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuka kembali (reopen) ujian UAS yang sudah disubmit.');
    END IF;

    -- 3. Validasi Alasan Wajib
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan pembukaan kembali ujian.');
    END IF;

    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian UAS tidak ditemukan.');
    END IF;

    IF v_attempt.status != 'submitted' THEN
        RETURN json_build_object('success', false, 'message', 'Hanya sesi ujian yang sudah berstatus submitted yang dapat dibuka kembali.');
    END IF;

    -- 4. Kembalikan status attempt ke in_progress
    UPDATE exam_attempts SET
        status = 'in_progress',
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Kembalikan status assignment ke assigned
    UPDATE exam_examiner_assignments SET
        status = 'assigned',
        updated_at = now()
    WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;

    -- 5. Audit Log Kanonikal
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_attempt.exam_period_id, v_attempt.student_id, 'uas_exam_reopened', v_user.id,
        jsonb_build_object('attemptId', p_attempt_id, 'oldStatus', 'submitted', 'score', v_attempt.total_score),
        jsonb_build_object('attemptId', p_attempt_id, 'newStatus', 'in_progress'),
        p_reason, now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Ujian UAS berhasil dibuka kembali untuk koreksi nilai.'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_uts_attempt(p_username text, p_password text, p_attempt_id text, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_attempt RECORD;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuka kembali (reopen) ujian yang sudah disubmit.');
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan pembukaan kembali ujian.');
    END IF;

    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
    END IF;

    IF v_attempt.status != 'submitted' THEN
        RETURN json_build_object('success', false, 'message', 'Hanya sesi ujian yang sudah berstatus submitted yang dapat dibuka kembali.');
    END IF;

    -- Kembalikan status ke in_progress
    UPDATE exam_attempts SET
        status = 'in_progress',
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Kembalikan status assignment ke assigned
    UPDATE exam_examiner_assignments SET
        status = 'assigned',
        updated_at = now()
    WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;

    -- Audit log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_attempt.exam_period_id, v_attempt.student_id, 'attempt_reopened', v_user.id,
        jsonb_build_object('attemptId', p_attempt_id, 'oldStatus', 'submitted', 'score', v_attempt.total_score),
        jsonb_build_object('attemptId', p_attempt_id, 'newStatus', 'in_progress'),
        p_reason, now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Ujian berhasil dibuka kembali untuk koreksi nilai.'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_question_bank_item(p_username text, p_password text, p_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_role TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengakses fitur ini.');
    END IF;
    v_role := v_auth.out_role;

    UPDATE question_bank 
    SET status = 'active', 
        archived_at = NULL, 
        updated_at = timezone('utc'::text, now())
    WHERE id = p_id;

    RETURN json_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_material_snapshots_batch(p_username text, p_password text, p_period_id text, p_snapshots jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_item JSONB;
    v_count INTEGER := 0;
    v_skipped INTEGER := 0;
    v_existing_status TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak memperbarui snapshot materi.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_snapshots)
    LOOP
        -- Periksa apakah snapshot untuk santri ini sudah berstatus 'finalized'
        SELECT status INTO v_existing_status 
        FROM exam_material_snapshots 
        WHERE exam_period_id = p_period_id AND student_id = v_item->>'studentId';

        IF v_existing_status = 'finalized' THEN
            -- JANGAN TIMPA snapshot yang sudah final!
            v_skipped := v_skipped + 1;
        ELSE
            INSERT INTO exam_material_snapshots (
                id, exam_period_id, student_id, source_type,
                start_surah, start_ayah, end_surah, end_ayah,
                start_page, end_page, start_juz, end_juz, estimated_pages,
                start_surah_name, end_surah_name,
                first_record_date, last_record_date, total_records_analyzed, memorization_direction,
                status, review_reason,
                created_at, updated_at
            ) VALUES (
                COALESCE(v_item->>'id', 'snap_' || p_period_id || '_' || (v_item->>'studentId')),
                p_period_id,
                v_item->>'studentId',
                COALESCE(v_item->>'sourceType', 'automatic'),
                (v_item->>'startSurah')::INTEGER,
                (v_item->>'startAyah')::INTEGER,
                (v_item->>'endSurah')::INTEGER,
                (v_item->>'endAyah')::INTEGER,
                (v_item->>'startPage')::INTEGER,
                (v_item->>'endPage')::INTEGER,
                (v_item->>'startJuz')::INTEGER,
                (v_item->>'endJuz')::INTEGER,
                COALESCE((v_item->>'estimatedPages')::NUMERIC, 0),
                v_item->>'startSurahName',
                v_item->>'endSurahName',
                (v_item->>'firstRecordDate')::DATE,
                (v_item->>'lastRecordDate')::DATE,
                COALESCE((v_item->>'totalRecordsAnalyzed')::INTEGER, 0),
                COALESCE(v_item->>'memorizationDirection', 'forward'),
                COALESCE(v_item->>'status', 'not_ready'),
                v_item->>'reviewReason',
                now(),
                now()
            )
            ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
                source_type = EXCLUDED.source_type,
                start_surah = EXCLUDED.start_surah,
                start_ayah = EXCLUDED.start_ayah,
                end_surah = EXCLUDED.end_surah,
                end_ayah = EXCLUDED.end_ayah,
                start_page = EXCLUDED.start_page,
                end_page = EXCLUDED.end_page,
                start_juz = EXCLUDED.start_juz,
                end_juz = EXCLUDED.end_juz,
                estimated_pages = EXCLUDED.estimated_pages,
                start_surah_name = EXCLUDED.start_surah_name,
                end_surah_name = EXCLUDED.end_surah_name,
                first_record_date = EXCLUDED.first_record_date,
                last_record_date = EXCLUDED.last_record_date,
                total_records_analyzed = EXCLUDED.total_records_analyzed,
                memorization_direction = EXCLUDED.memorization_direction,
                status = EXCLUDED.status,
                review_reason = EXCLUDED.review_reason,
                updated_at = now();

            v_count := v_count + 1;
        END IF;
    END LOOP;

    -- Audit log
    INSERT INTO exam_audit_logs (id, exam_period_id, action, actor_id, after_data, reason, created_at)
    VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        'material_generated',
        v_user.id,
        jsonb_build_object('savedCount', v_count, 'skippedFinalizedCount', v_skipped),
        'Auto-generate / batch snapshot materi ujian santri',
        now()
    );

    RETURN json_build_object('success', true, 'savedCount', v_count, 'skippedFinalizedCount', v_skipped, 'message', 'Snapshot materi berhasil disimpan.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_remedial_question_assessment(p_username text, p_password text, p_attempt_id text, p_question_number integer, p_assessment_data jsonb, p_expected_version integer DEFAULT NULL::integer, p_mark_completed boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
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
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

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
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat menilai ujian.');
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

CREATE OR REPLACE FUNCTION public.save_uts_question_assessment(p_username text, p_password text, p_attempt_id text, p_question_number integer, p_assessment_data jsonb, p_mark_completed boolean DEFAULT false, p_expected_version integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_attempt RECORD;
    v_existing_assessment RECORD;
    v_q_max NUMERIC(5,2);
    v_scale NUMERIC(7,4);
    v_max_f NUMERIC(5,2);
    v_max_t NUMERIC(5,2);
    v_max_m NUMERIC(5,2);
    v_f_deduction NUMERIC(5,2) := 0;
    v_t_deduction NUMERIC(5,2) := 0;
    v_m_deduction NUMERIC(5,2) := 0;
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
    v_f_events JSONB;
    v_t_events JSONB;
    v_m_events JSONB;
    v_event JSONB;
    v_ev_type TEXT;
    v_new_version INTEGER;
    v_new_completed_at TIMESTAMPTZ;
    v_updated_rows INTEGER;
BEGIN
    SET search_path = public, extensions;

    -- 1. Autentikasi
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
    END IF;

    IF v_attempt.status = 'submitted' THEN
        RETURN json_build_object('success', false, 'message', 'Ujian sudah disubmit dan terkunci.');
    END IF;

    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji sesi ini.');
    END IF;

    -- 3. Ambil Assessment Existing & Kunci Versi
    SELECT * INTO v_existing_assessment FROM exam_question_assessments 
    WHERE exam_attempt_id = p_attempt_id AND question_number = p_question_number;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Butir soal ' || p_question_number || ' tidak ditemukan.');
    END IF;

    IF p_expected_version IS NOT NULL AND v_existing_assessment.version != p_expected_version THEN
        RETURN json_build_object(
            'success', false, 
            'isConflict', true, 
            'message', 'Data ujian berubah di perangkat lain. Muat ulang data terbaru.',
            'currentVersion', v_existing_assessment.version
        );
    END IF;

    -- 4. Ambil max_score Butir Soal untuk Normalisasi Proporsional
    SELECT COALESCE(q.max_score, 20.00) INTO v_q_max
    FROM exam_questions q
    WHERE q.id = v_existing_assessment.exam_question_id;

    IF NOT FOUND OR v_q_max IS NULL THEN
        v_q_max := 20.00;
    END IF;

    -- Skala pengurangan proporsional terhadap baseline 20 poin:
    -- baseline: self_correction=0.5 (2.5%), reminder=1.0 (5%), prompt=2.0 (10%), unable=4.0 (20%)
    v_scale := v_q_max / 20.00;
    v_max_f := ROUND(v_q_max * 0.60, 2);
    v_max_t := ROUND(v_q_max * 0.20, 2);
    v_max_m := v_q_max - v_max_f - v_max_t;

    -- 5. Parsing Events & Server Authoritative Deductions
    v_f_events := COALESCE(p_assessment_data->'fluencyEvents', '[]'::jsonb);
    v_t_events := COALESCE(p_assessment_data->'tajwidEvents', '[]'::jsonb);
    v_m_events := COALESCE(p_assessment_data->'makhrajEvents', '[]'::jsonb);

    -- 5.1 Kelancaran
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_f_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'self_correction' THEN
            v_f_deduction := v_f_deduction + (0.5 * v_scale);
        ELSIF v_ev_type = 'reminder' THEN
            v_f_deduction := v_f_deduction + (1.0 * v_scale);
        ELSIF v_ev_type = 'prompt' THEN
            v_f_deduction := v_f_deduction + (2.0 * v_scale);
        ELSIF v_ev_type = 'unable' THEN
            v_f_deduction := v_f_deduction + (4.0 * v_scale);
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event kelancaran tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_f_score := GREATEST(0.00, ROUND(v_max_f - v_f_deduction, 2));

    -- 5.2 Tajwid
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_t_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'minor' THEN
            v_t_deduction := v_t_deduction + (0.5 * v_scale);
        ELSIF v_ev_type = 'major' THEN
            v_t_deduction := v_t_deduction + (1.0 * v_scale);
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event tajwid tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_t_score := GREATEST(0.00, ROUND(v_max_t - v_t_deduction, 2));

    -- 5.3 Makhraj
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_m_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'minor' THEN
            v_m_deduction := v_m_deduction + (0.5 * v_scale);
        ELSIF v_ev_type = 'major' THEN
            v_m_deduction := v_m_deduction + (1.0 * v_scale);
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event makhraj tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_m_score := GREATEST(0.00, ROUND(v_max_m - v_m_deduction, 2));

    v_q_score := v_f_score + v_t_score + v_m_score;
    v_new_version := v_existing_assessment.version + 1;

    -- Tentukan status completed_at
    IF p_mark_completed = true OR (p_assessment_data->>'isCompleted')::BOOLEAN = true THEN
        v_new_completed_at := COALESCE(v_existing_assessment.completed_at, now());
    ELSE
        v_new_completed_at := v_existing_assessment.completed_at;
    END IF;

    -- 6. Update Assessment Atomik
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

    -- Update last_saved_at pada attempt
    UPDATE exam_attempts SET last_saved_at = now(), updated_at = now() WHERE id = p_attempt_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Penilaian soal ' || p_question_number || ' berhasil disimpan.',
        'assessment', json_build_object(
            'questionNumber', p_question_number,
            'fluencyScore', v_f_score,
            'tajwidScore', v_t_score,
            'makhrajScore', v_m_score,
            'questionScore', v_q_score,
            'completedAt', v_new_completed_at,
            'version', v_new_version,
            'lastSavedAt', now()
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_remedial_attempt(p_username text, p_password text, p_remedial_session_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
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
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.start_uas_attempt(p_username text, p_password text, p_period_id text, p_student_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_participant RECORD;
    v_snapshot RECORD;
    v_question_set RECORD;
    v_assignment RECORD;
    v_existing_attempt RECORD;
    v_attempt_id TEXT;
    v_questions JSON;
    v_assessments JSON;
    v_q RECORD;
    v_calc_fingerprint TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uas' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian bukan periode UAS.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    SELECT * INTO v_participant FROM exam_participants 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Santri bukan peserta resmi periode ujian ini.');
    END IF;

    SELECT * INTO v_assignment FROM exam_examiner_assignments 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    
    IF FOUND THEN
        IF v_user.role = 'teacher' AND v_assignment.examiner_user_id != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk santri ini.');
        END IF;
    ELSE
        IF v_user.role = 'teacher' AND v_participant.teacher_id_snapshot != v_user.id AND (SELECT teacher_id FROM students WHERE id = p_student_id) != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan guru halaqah santri ini dan belum ditugaskan sebagai penguji.');
        END IF;

        INSERT INTO exam_examiner_assignments (
            id, exam_period_id, student_id, examiner_user_id, status, assigned_by, assigned_at, created_at, updated_at
        ) VALUES (
            'eea_' || p_period_id || '_' || p_student_id,
            p_period_id, p_student_id, v_user.id, 'assigned', v_user.id, now(), now(), now()
        ) ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
            examiner_user_id = EXCLUDED.examiner_user_id,
            updated_at = now();
    END IF;

    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Materi UAS santri belum difinalisasi.');
    END IF;

    SELECT * INTO v_question_set FROM exam_question_sets 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'locked'
    ORDER BY version DESC LIMIT 1;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal UAS belum dibuat atau terkunci.');
    END IF;

    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal berstatus STALE karena materi berubah.');
    END IF;

    SELECT * INTO v_existing_attempt FROM exam_attempts 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND attempt_number = 1;

    IF FOUND THEN
        IF v_existing_attempt.status = 'submitted' THEN
            RETURN json_build_object('success', false, 'message', 'Ujian santri ini sudah selesai dan telah dikirim (submitted).');
        END IF;

        v_attempt_id := v_existing_attempt.id;
    ELSE
        v_attempt_id := 'att_uas_' || p_period_id || '_' || p_student_id || '_a1';
        
        INSERT INTO exam_attempts (
            id, exam_period_id, student_id, question_set_id, examiner_user_id,
            attempt_number, status, started_at, last_saved_at, total_score, created_at, updated_at
        ) VALUES (
            v_attempt_id, p_period_id, p_student_id, v_question_set.id, v_user.id,
            1, 'in_progress', now(), now(), 0, now(), now()
        );

        FOR v_q IN 
            SELECT * FROM exam_questions 
            WHERE question_set_id = v_question_set.id 
            ORDER BY question_number ASC
        LOOP
            INSERT INTO exam_question_assessments (
                id, exam_attempt_id, exam_question_id, question_number,
                fluency_score, tajwid_score, makhraj_score,
                fluency_events, tajwid_events, makhraj_events,
                question_score, notes, started_at, completed_at, updated_at, version
            ) VALUES (
                'aqa_' || v_attempt_id || '_q' || v_q.question_number,
                v_attempt_id, v_q.id, v_q.question_number,
                6.67, 2.22, 2.22,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                11.11, '', now(), NULL, now(), 1
            );
        END LOOP;

        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            p_period_id, p_student_id, 'uas_exam_started', v_user.id,
            jsonb_build_object('attemptId', v_attempt_id, 'questionSetId', v_question_set.id),
            'Mulai pelaksanaan ujian UAS santri', now()
        );
    END IF;

    SELECT json_agg(json_build_object(
        'id', q.id,
        'questionNumber', q.question_number,
        'zoneNumber', q.zone_number,
        'sourceType', q.source_type,
        'promptStartSurah', q.prompt_start_surah,
        'promptStartAyah', q.prompt_start_ayah,
        'promptStartWord', q.prompt_start_word,
        'promptEndSurah', q.prompt_end_surah,
        'promptEndAyah', q.prompt_end_ayah,
        'promptEndWord', q.prompt_end_word,
        'answerStartSurah', q.answer_start_surah,
        'answerStartAyah', q.answer_start_ayah,
        'answerStartWord', q.answer_start_word,
        'answerEndSurah', q.answer_end_surah,
        'answerEndAyah', q.answer_end_ayah,
        'answerEndWord', q.answer_end_word,
        'startPage', q.start_page,
        'endPage', q.end_page,
        'generatedMetadata', q.generated_metadata
    ) ORDER BY q.question_number ASC) INTO v_questions
    FROM exam_questions q
    WHERE q.question_set_id = v_question_set.id;

    SELECT json_agg(json_build_object(
        'id', a.id,
        'examAttemptId', a.exam_attempt_id,
        'examQuestionId', a.exam_question_id,
        'questionNumber', a.question_number,
        'fluencyScore', a.fluency_score,
        'tajwidScore', a.tajwid_score,
        'makhrajScore', a.makhraj_score,
        'fluencyEvents', a.fluency_events,
        'tajwidEvents', a.tajwid_events,
        'makhrajEvents', a.makhraj_events,
        'questionScore', a.question_score,
        'notes', a.notes,
        'completedAt', a.completed_at,
        'version', a.version
    ) ORDER BY a.question_number ASC) INTO v_assessments
    FROM exam_question_assessments a
    WHERE a.exam_attempt_id = v_attempt_id;

    RETURN json_build_object(
        'success', true,
        'kkm', v_period.kkm,
        'attempt', json_build_object(
            'id', v_attempt_id,
            'examPeriodId', p_period_id,
            'studentId', p_student_id,
            'questionSetId', v_question_set.id,
            'status', 'in_progress',
            'startedAt', now(),
            'lastSavedAt', now()
        ),
        'questions', COALESCE(v_questions, '[]'::json),
        'assessments', COALESCE(v_assessments, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_uts_attempt(p_username text, p_password text, p_period_id text, p_student_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_participant RECORD;
    v_snapshot RECORD;
    v_question_set RECORD;
    v_assignment RECORD;
    v_existing_attempt RECORD;
    v_attempt_id TEXT;
    v_q RECORD;
    v_calc_fingerprint TEXT;
    v_q_max NUMERIC(5,2);
    v_init_f NUMERIC(5,2);
    v_init_t NUMERIC(5,2);
    v_init_m NUMERIC(5,2);
BEGIN
    SET search_path = public, extensions;

    -- 1. Autentikasi User (Admin atau Penguji)
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    -- 2. Validasi Periode UTS
    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    -- 3. Validasi Santri Peserta
    SELECT * INTO v_participant FROM exam_participants 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Santri bukan peserta resmi periode ujian ini.');
    END IF;

    -- 4. Otorisasi Penguji
    IF v_user.role = 'teacher' THEN
        SELECT * INTO v_assignment FROM exam_examiner_assignments
        WHERE exam_period_id = p_period_id AND student_id = p_student_id;

        IF FOUND THEN
            IF v_assignment.examiner_user_id != v_user.id THEN
                RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk santri ini.');
            END IF;
        ELSE
            IF v_participant.teacher_id_snapshot IS NOT NULL AND v_participant.teacher_id_snapshot != v_user.id THEN
                RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan guru halaqah santri ini.');
            END IF;
        END IF;
    END IF;

    -- 5. Validasi Prasyarat Materi Final & Paket Soal Terkunci
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Materi UTS santri belum difinalisasi.');
    END IF;

    SELECT * INTO v_question_set FROM exam_question_sets 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'locked'
    ORDER BY version DESC LIMIT 1;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal UTS belum dibuat atau terkunci.');
    END IF;

    -- Stale check
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal berstatus STALE karena materi berubah.');
    END IF;

    -- 6. Idempotency Check: Ambil Attempt yang Sedang Berjalan jika Ada
    SELECT * INTO v_existing_attempt FROM exam_attempts 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND attempt_number = 1;

    IF FOUND THEN
        IF v_existing_attempt.status = 'submitted' THEN
            RETURN json_build_object('success', false, 'message', 'Ujian santri ini sudah selesai dan telah dikirim (submitted).');
        END IF;

        v_attempt_id := v_existing_attempt.id;
    ELSE
        -- Buat attempt baru
        v_attempt_id := 'att_' || p_period_id || '_' || p_student_id || '_a1';
        
        INSERT INTO exam_attempts (
            id, exam_period_id, student_id, question_set_id, examiner_user_id,
            attempt_number, status, started_at, last_saved_at, total_score, created_at, updated_at
        ) VALUES (
            v_attempt_id, p_period_id, p_student_id, v_question_set.id, v_user.id,
            1, 'in_progress', now(), now(), 0, now(), now()
        );

        -- Inisialisasi assessment dinamis untuk seluruh butir soal pada set:
        -- Sub-score dihitung presisi berdasarkan max_score tiap soal (60% / 20% / 20%)
        FOR v_q IN 
            SELECT * FROM exam_questions 
            WHERE question_set_id = v_question_set.id 
            ORDER BY question_number ASC
        LOOP
            v_q_max := COALESCE(v_q.max_score, 20.00);
            v_init_f := ROUND(v_q_max * 0.60, 2);
            v_init_t := ROUND(v_q_max * 0.20, 2);
            v_init_m := v_q_max - v_init_f - v_init_t; -- Exact sum guarantee

            INSERT INTO exam_question_assessments (
                id, exam_attempt_id, exam_question_id, question_number,
                fluency_score, tajwid_score, makhraj_score,
                fluency_events, tajwid_events, makhraj_events,
                question_score, notes, started_at, completed_at, updated_at, version
            ) VALUES (
                'aqa_' || v_attempt_id || '_q' || v_q.question_number,
                v_attempt_id, v_q.id, v_q.question_number,
                v_init_f, v_init_t, v_init_m,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                v_q_max, '', now(), NULL, now(), 1
            );
        END LOOP;

        -- Audit log
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            p_period_id, p_student_id, 'exam_started', v_user.id,
            jsonb_build_object('attemptId', v_attempt_id, 'questionSetId', v_question_set.id),
            'Mulai pelaksanaan ujian UTS santri', now()
        );
    END IF;

    -- 7. Return Sesi Ujian Lengkap
    RETURN json_build_object(
        'success', true,
        'attempt', (SELECT row_to_json(a) FROM exam_attempts a WHERE a.id = v_attempt_id),
        'kkm', v_period.kkm,
        'questions', (
            SELECT json_agg(json_build_object(
                'id', q.id,
                'questionNumber', q.question_number,
                'zoneNumber', q.zone_number,
                'sourceType', q.source_type,
                'questionBankId', q.question_bank_id,
                'maxScore', COALESCE(q.max_score, 20.00),
                'promptStartSurah', q.prompt_start_surah,
                'promptStartAyah', q.prompt_start_ayah,
                'promptStartWord', q.prompt_start_word,
                'promptEndSurah', q.prompt_end_surah,
                'promptEndAyah', q.prompt_end_ayah,
                'promptEndWord', q.prompt_end_word,
                'answerStartSurah', q.answer_start_surah,
                'answerStartAyah', q.answer_start_ayah,
                'answerStartWord', q.answer_start_word,
                'answerEndSurah', q.answer_end_surah,
                'answerEndAyah', q.answer_end_ayah,
                'answerEndWord', q.answer_end_word,
                'startPage', q.start_page,
                'endPage', q.end_page,
                'generatedMetadata', q.generated_metadata
            ) ORDER BY q.question_number)
            FROM exam_questions q
            WHERE q.question_set_id = v_question_set.id
        ),
        'assessments', (
            SELECT json_agg(json_build_object(
                'id', a.id,
                'examAttemptId', a.exam_attempt_id,
                'examQuestionId', a.exam_question_id,
                'questionNumber', a.question_number,
                'fluencyScore', a.fluency_score,
                'tajwidScore', a.tajwid_score,
                'makhrajScore', a.makhraj_score,
                'fluencyEvents', a.fluency_events,
                'tajwidEvents', a.tajwid_events,
                'makhrajEvents', a.makhraj_events,
                'questionScore', a.question_score,
                'notes', a.notes,
                'startedAt', a.started_at,
                'completedAt', a.completed_at,
                'version', a.version,
                'updatedAt', a.updated_at
            ) ORDER BY a.question_number)
            FROM exam_question_assessments a
            WHERE a.exam_attempt_id = v_attempt_id
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_remedial_attempt(p_username text, p_password text, p_attempt_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
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
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

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
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat mengirim ujian.');
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

CREATE OR REPLACE FUNCTION public.submit_uts_attempt(p_username text, p_password text, p_attempt_id text, p_examiner_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    v_is_passed BOOLEAN;
    v_asm RECORD;
    v_q_max NUMERIC(5,2);
    v_scale NUMERIC(7,4);
    v_max_f NUMERIC(5,2);
    v_max_t NUMERIC(5,2);
    v_max_m NUMERIC(5,2);
    v_event JSONB;
    v_ev_type TEXT;
    v_f_deduction NUMERIC(5,2);
    v_t_deduction NUMERIC(5,2);
    v_m_deduction NUMERIC(5,2);
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
    v_notes_to_save TEXT;
BEGIN
    SET search_path = public, extensions;

    -- 1. Autentikasi
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
    END IF;

    -- Idempotency check: jika sudah submitted, return existing
    IF v_attempt.status = 'submitted' THEN
        SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
        RETURN json_build_object(
            'success', true,
            'isExisting', true,
            'message', 'Ujian sudah disubmit sebelumnya.',
            'totalScore', v_attempt.total_score,
            'submittedAt', v_attempt.submitted_at,
            'kkm', v_period.kkm,
            'isPassed', (v_attempt.total_score >= v_period.kkm),
            'examinerNotes', v_attempt.examiner_notes
        );
    END IF;

    -- Otorisasi penguji
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji sesi ini.');
    END IF;

    -- Validasi panjang catatan penguji
    IF p_examiner_notes IS NOT NULL AND char_length(p_examiner_notes) > 500 THEN
        RETURN json_build_object('success', false, 'message', 'Catatan penguji maksimal 500 karakter.');
    END IF;
    v_notes_to_save := COALESCE(p_examiner_notes, v_attempt.examiner_notes);

    -- STALE CHECK
    SELECT * INTO v_question_set FROM exam_question_sets WHERE id = v_attempt.question_set_id;
    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;
    
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.status != 'locked' OR v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'isStale', true, 'message', 'Ujian diblokir: Paket soal berstatus STALE karena materi berubah.');
    END IF;

    -- VALIDASI SELURUH BUTIR SOAL WAJIB COMPLETED
    SELECT COUNT(*), COUNT(*) FILTER (WHERE completed_at IS NOT NULL)
    INTO v_count_total, v_count_completed
    FROM exam_question_assessments
    WHERE exam_attempt_id = p_attempt_id;

    IF v_count_total = 0 OR v_count_completed != v_count_total THEN
        RETURN json_build_object(
            'success', false, 
            'message', 'Validasi gagal: Seluruh butir soal (' || v_count_total || ' butir) wajib diselesaikan sebelum submit final. Saat ini baru ' || v_count_completed || ' soal selesai.'
        );
    END IF;

    -- VALIDASI SOAL BERASAL DARI QUESTION SET RESMI
    SELECT COUNT(*) INTO v_valid_q_count
    FROM exam_question_assessments eqa
    JOIN exam_questions eq ON eq.id = eqa.exam_question_id
    WHERE eqa.exam_attempt_id = p_attempt_id
      AND eq.question_set_id = v_attempt.question_set_id;

    IF v_valid_q_count != v_count_total THEN
        RETURN json_build_object('success', false, 'message', 'Validasi integritas gagal: Butir soal tidak sesuai dengan paket soal resmi.');
    END IF;

    -- AUTHORITATIVE SERVER-SIDE RECALCULATION
    v_total_calculated := 0;

    FOR v_asm IN 
        SELECT a.*, COALESCE(q.max_score, 20.00) AS q_max 
        FROM exam_question_assessments a
        JOIN exam_questions q ON q.id = a.exam_question_id
        WHERE a.exam_attempt_id = p_attempt_id 
        ORDER BY a.question_number ASC
    LOOP
        v_q_max := v_asm.q_max;
        v_scale := v_q_max / 20.00;
        v_max_f := ROUND(v_q_max * 0.60, 2);
        v_max_t := ROUND(v_q_max * 0.20, 2);
        v_max_m := v_q_max - v_max_f - v_max_t;

        v_f_deduction := 0;
        v_t_deduction := 0;
        v_m_deduction := 0;

        -- 1. Fluency events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.fluency_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'self_correction' THEN v_f_deduction := v_f_deduction + (0.5 * v_scale);
            ELSIF v_ev_type = 'reminder' THEN v_f_deduction := v_f_deduction + (1.0 * v_scale);
            ELSIF v_ev_type = 'prompt' THEN v_f_deduction := v_f_deduction + (2.0 * v_scale);
            ELSIF v_ev_type = 'unable' THEN v_f_deduction := v_f_deduction + (4.0 * v_scale);
            END IF;
        END LOOP;
        v_f_score := GREATEST(0.00, ROUND(v_max_f - v_f_deduction, 2));

        -- 2. Tajwid events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.tajwid_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'minor' THEN v_t_deduction := v_t_deduction + (0.5 * v_scale);
            ELSIF v_ev_type = 'major' THEN v_t_deduction := v_t_deduction + (1.0 * v_scale);
            END IF;
        END LOOP;
        v_t_score := GREATEST(0.00, ROUND(v_max_t - v_t_deduction, 2));

        -- 3. Makhraj events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.makhraj_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'minor' THEN v_m_deduction := v_m_deduction + (0.5 * v_scale);
            ELSIF v_ev_type = 'major' THEN v_m_deduction := v_m_deduction + (1.0 * v_scale);
            END IF;
        END LOOP;
        v_m_score := GREATEST(0.00, ROUND(v_max_m - v_m_deduction, 2));

        v_q_score := v_f_score + v_t_score + v_m_score;

        -- Update skor authoritative ke database
        UPDATE exam_question_assessments SET
            fluency_score = v_f_score,
            tajwid_score = v_t_score,
            makhraj_score = v_m_score,
            question_score = v_q_score,
            updated_at = now()
        WHERE id = v_asm.id;

        v_total_calculated := v_total_calculated + v_q_score;
    END LOOP;

    v_total_calculated := ROUND(v_total_calculated, 2);

    SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
    v_is_passed := (v_total_calculated >= v_period.kkm);

    -- Finalisasi status attempt & simpan examiner_notes
    UPDATE exam_attempts SET
        status = 'submitted',
        total_score = v_total_calculated,
        examiner_notes = v_notes_to_save,
        submitted_at = now(),
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Tandai status assignment sebagai completed
    UPDATE exam_examiner_assignments
    SET status = 'completed', updated_at = now()
    WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;

    -- Audit log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_attempt.exam_period_id, v_attempt.student_id, 'exam_submitted', v_user.id,
        jsonb_build_object(
            'attemptId', p_attempt_id,
            'totalScore', v_total_calculated,
            'isPassed', v_is_passed,
            'kkm', v_period.kkm,
            'hasExaminerNotes', (v_notes_to_save IS NOT NULL AND v_notes_to_save != '')
        ),
        'Ujian UTS berhasil disubmit final (Nilai: ' || v_total_calculated || ')',
        now()
    );

    RETURN json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Ujian UTS berhasil disubmit final.',
        'totalScore', v_total_calculated,
        'submittedAt', now(),
        'kkm', v_period.kkm,
        'isPassed', v_is_passed,
        'examinerNotes', v_notes_to_save
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_academic_term(p_username text, p_password text, p_term jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_id TEXT;
    v_year TEXT;
    v_sem TEXT;
    v_start DATE;
    v_end DATE;
    v_status TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengelola Semester.');
    END IF;

    v_id := COALESCE(p_term->>'id', 'term_' || extract(epoch from now())::bigint);
    v_year := p_term->>'academicYear';
    v_sem := p_term->>'semester';
    v_start := (p_term->>'startDate')::DATE;
    v_end := (p_term->>'endDate')::DATE;
    v_status := COALESCE(p_term->>'status', 'draft');

    IF v_start > v_end THEN
        RETURN json_build_object('success', false, 'message', 'Tanggal mulai semester tidak boleh lebih besar dari tanggal selesai.');
    END IF;

    -- Jika diset menjadi 'active', nonaktifkan semester aktif lainnya terlebih dahulu
    IF v_status = 'active' THEN
        UPDATE academic_terms SET status = 'completed', updated_at = now() WHERE status = 'active' AND id != v_id;
    END IF;

    INSERT INTO academic_terms (id, academic_year, semester, start_date, end_date, status, created_by, created_at, updated_at)
    VALUES (v_id, v_year, v_sem, v_start, v_end, v_status, v_user.id, now(), now())
    ON CONFLICT (id) DO UPDATE SET
        academic_year = EXCLUDED.academic_year,
        semester = EXCLUDED.semester,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        status = EXCLUDED.status,
        updated_at = now();

    RETURN json_build_object('success', true, 'id', v_id, 'message', 'Semester berhasil disimpan.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_question_bank_item(p_username text, p_password text, p_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_role TEXT;
    v_user_id TEXT;
    v_id TEXT;
    v_a_surah INT;
    v_a_ayah INT;
    v_a_word INT;
    v_ae_surah INT;
    v_ae_ayah INT;
    v_ae_word INT;
    v_b_surah INT;
    v_b_ayah INT;
    v_b_word INT;
    v_c_surah INT;
    v_c_ayah INT;
    v_c_word INT;
    v_start_page INT;
    v_end_page INT;
    v_start_juz INT;
    v_end_juz INT;
BEGIN
    -- 1. Verifikasi kredensial actor langsung ke tabel users (Admin Only)
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengakses fitur ini.');
    END IF;
    v_user_id := v_auth.out_user_id;
    v_role := v_auth.out_role;

    -- 2. Parsing koordinat struktural A, A', B, C
    v_a_surah := (p_data->'prompt_start'->>'surah')::INT;
    v_a_ayah  := (p_data->'prompt_start'->>'ayah')::INT;
    v_a_word  := (p_data->'prompt_start'->>'word')::INT;

    v_ae_surah := (p_data->'prompt_end'->>'surah')::INT;
    v_ae_ayah  := (p_data->'prompt_end'->>'ayah')::INT;
    v_ae_word  := (p_data->'prompt_end'->>'word')::INT;

    v_b_surah := (p_data->'answer_start'->>'surah')::INT;
    v_b_ayah  := (p_data->'answer_start'->>'ayah')::INT;
    v_b_word  := (p_data->'answer_start'->>'word')::INT;

    v_c_surah := (p_data->'answer_end'->>'surah')::INT;
    v_c_ayah  := (p_data->'answer_end'->>'ayah')::INT;
    v_c_word  := (p_data->'answer_end'->>'word')::INT;

    v_start_page := (p_data->>'start_page')::INT;
    v_end_page   := (p_data->>'end_page')::INT;
    v_start_juz  := (p_data->>'start_juz')::INT;
    v_end_juz    := (p_data->>'end_juz')::INT;

    -- 3. Validasi Batas Nilai Al-Qur'an di Backend
    IF v_a_surah < 1 OR v_a_surah > 114 OR v_ae_surah < 1 OR v_ae_surah > 114 OR
       v_b_surah < 1 OR v_b_surah > 114 OR v_c_surah < 1 OR v_c_surah > 114 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Nomor surat harus antara 1 dan 114.');
    END IF;

    IF v_start_page < 1 OR v_start_page > 604 OR v_end_page < 1 OR v_end_page > 604 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Halaman mushaf harus antara 1 dan 604.');
    END IF;

    IF v_start_juz < 1 OR v_start_juz > 30 OR v_end_juz < 1 OR v_end_juz > 30 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Juz Al-Qur''an harus antara 1 dan 30.');
    END IF;

    -- 4. Validasi Struktural A <= A' < B <= C di Backend
    IF (v_a_surah > v_ae_surah) OR 
       (v_a_surah = v_ae_surah AND v_a_ayah > v_ae_ayah) OR 
       (v_a_surah = v_ae_surah AND v_a_ayah = v_ae_ayah AND v_a_word > v_ae_word) THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Titik A awal prompt tidak boleh melebihi akhir prompt A''.');
    END IF;

    IF (v_ae_surah > v_b_surah) OR 
       (v_ae_surah = v_b_surah AND v_ae_ayah > v_b_ayah) OR 
       (v_ae_surah = v_b_surah AND v_ae_ayah = v_b_ayah AND v_ae_word >= v_b_word) THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Titik B santri menjawab harus setelah akhir prompt A''.');
    END IF;

    IF (v_b_surah > v_c_surah) OR 
       (v_b_surah = v_c_surah AND v_b_ayah > v_c_ayah) OR 
       (v_b_surah = v_c_surah AND v_b_ayah = v_c_ayah AND v_b_word > v_c_word) THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Titik B santri menjawab tidak boleh melebihi batas akhir C.');
    END IF;

    v_id := COALESCE(p_data->>'id', 'qb_' || floor(extract(epoch from now()))::text || '_' || substr(md5(random()::text), 1, 6));

    -- 5. Eksekusi Upsert
    INSERT INTO question_bank (
        id,
        exam_type,
        question_type,
        prompt_start_surah,
        prompt_start_ayah,
        prompt_start_word,
        prompt_end_surah,
        prompt_end_ayah,
        prompt_end_word,
        answer_start_surah,
        answer_start_ayah,
        answer_start_word,
        answer_end_surah,
        answer_end_ayah,
        answer_end_word,
        start_page,
        end_page,
        start_juz,
        end_juz,
        prompt_text,
        answer_text,
        total_expected_words,
        answer_mode,
        difficulty,
        tags,
        notes,
        status,
        created_by,
        updated_at
    ) VALUES (
        v_id,
        COALESCE(p_data->>'exam_type', 'generic'),
        COALESCE(p_data->>'question_type', 'random'),
        v_a_surah,
        v_a_ayah,
        v_a_word,
        v_ae_surah,
        v_ae_ayah,
        v_ae_word,
        v_b_surah,
        v_b_ayah,
        v_b_word,
        v_c_surah,
        v_c_ayah,
        v_c_word,
        v_start_page,
        v_end_page,
        v_start_juz,
        v_end_juz,
        p_data->>'prompt_text',
        p_data->>'answer_text',
        COALESCE((p_data->>'total_expected_words')::INT, 0),
        COALESCE(p_data->>'answer_mode', 'end_ayah'),
        COALESCE(p_data->>'difficulty', 'medium'),
        COALESCE(p_data->'tags', '[]'::jsonb),
        p_data->>'notes',
        COALESCE(p_data->>'status', 'active'),
        v_user_id,
        timezone('utc'::text, now())
    )
    ON CONFLICT (id) DO UPDATE SET
        exam_type = EXCLUDED.exam_type,
        question_type = EXCLUDED.question_type,
        prompt_start_surah = EXCLUDED.prompt_start_surah,
        prompt_start_ayah = EXCLUDED.prompt_start_ayah,
        prompt_start_word = EXCLUDED.prompt_start_word,
        prompt_end_surah = EXCLUDED.prompt_end_surah,
        prompt_end_ayah = EXCLUDED.prompt_end_ayah,
        prompt_end_word = EXCLUDED.prompt_end_word,
        answer_start_surah = EXCLUDED.answer_start_surah,
        answer_start_ayah = EXCLUDED.answer_start_ayah,
        answer_start_word = EXCLUDED.answer_start_word,
        answer_end_surah = EXCLUDED.answer_end_surah,
        answer_end_ayah = EXCLUDED.answer_end_ayah,
        answer_end_word = EXCLUDED.answer_end_word,
        start_page = EXCLUDED.start_page,
        end_page = EXCLUDED.end_page,
        start_juz = EXCLUDED.start_juz,
        end_juz = EXCLUDED.end_juz,
        prompt_text = EXCLUDED.prompt_text,
        answer_text = EXCLUDED.answer_text,
        total_expected_words = EXCLUDED.total_expected_words,
        answer_mode = EXCLUDED.answer_mode,
        difficulty = EXCLUDED.difficulty,
        tags = EXCLUDED.tags,
        notes = EXCLUDED.notes,
        status = EXCLUDED.status,
        updated_at = timezone('utc'::text, now());

    RETURN json_build_object('success', true, 'id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_semester_evaluation_config(p_username text, p_password text, p_config jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
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
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.verify_or_override_material_snapshot(p_username text, p_password text, p_snapshot_id text, p_action text, p_data jsonb, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_snap RECORD;
    v_participant RECORD;
    v_period RECORD;
    v_before JSONB;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    SELECT * INTO v_snap FROM exam_material_snapshots WHERE id = p_snapshot_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi tidak ditemukan.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_snap.exam_period_id;
    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    SELECT * INTO v_participant FROM exam_participants 
    WHERE exam_period_id = v_snap.exam_period_id AND student_id = v_snap.student_id;

    -- Otorisasi Role: Jika guru, harus sesuai dengan halaqah santri
    IF v_user.role = 'teacher' THEN
        IF v_participant.teacher_id_snapshot != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda hanya dapat memverifikasi santri halaqah Anda sendiri.');
        END IF;
    ELSIF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    v_before := to_jsonb(v_snap);

    IF p_action = 'verify' THEN
        UPDATE exam_material_snapshots SET
            status = 'ready',
            verified_by = v_user.id,
            verified_at = now(),
            updated_at = now()
        WHERE id = p_snapshot_id;

        INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
        VALUES ('audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6), v_snap.exam_period_id, v_snap.student_id, 'material_verified', v_user.id, v_before, to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)), p_reason, now());

        RETURN json_build_object('success', true, 'message', 'Materi berhasil diverifikasi.');

    ELSIF p_action = 'override' THEN
        IF p_reason IS NULL OR trim(p_reason) = '' THEN
            RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan koreksi manual.');
        END IF;

        UPDATE exam_material_snapshots SET
            source_type = 'manual_override',
            start_surah = (p_data->>'startSurah')::INTEGER,
            start_ayah = (p_data->>'startAyah')::INTEGER,
            end_surah = (p_data->>'endSurah')::INTEGER,
            end_ayah = (p_data->>'endAyah')::INTEGER,
            start_page = (p_data->>'startPage')::INTEGER,
            end_page = (p_data->>'endPage')::INTEGER,
            start_juz = (p_data->>'startJuz')::INTEGER,
            end_juz = (p_data->>'endJuz')::INTEGER,
            estimated_pages = COALESCE((p_data->>'estimatedPages')::NUMERIC, 0),
            start_surah_name = p_data->>'startSurahName',
            end_surah_name = p_data->>'endSurahName',
            override_reason = p_reason,
            status = 'ready',
            verified_by = v_user.id,
            verified_at = now(),
            updated_at = now()
        WHERE id = p_snapshot_id;

        INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
        VALUES ('audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6), v_snap.exam_period_id, v_snap.student_id, 'material_override', v_user.id, v_before, to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)), p_reason, now());

        RETURN json_build_object('success', true, 'message', 'Koreksi materi manual berhasil disimpan.');

    ELSIF p_action = 'finalize' THEN
        IF v_snap.status NOT IN ('ready', 'needs_review') THEN
            RETURN json_build_object('success', false, 'message', 'Materi belum siap untuk difinalisasi.');
        END IF;

        UPDATE exam_material_snapshots SET
            status = 'finalized',
            finalized_by = v_user.id,
            finalized_at = now(),
            updated_at = now()
        WHERE id = p_snapshot_id;

        INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
        VALUES ('audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6), v_snap.exam_period_id, v_snap.student_id, 'material_finalized', v_user.id, v_before, to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)), p_reason, now());

        RETURN json_build_object('success', true, 'message', 'Materi berhasil difinalisasi.');
    ELSE
        RETURN json_build_object('success', false, 'message', 'Aksi tidak dikenali.');
    END IF;
END;
$function$;

COMMIT;
