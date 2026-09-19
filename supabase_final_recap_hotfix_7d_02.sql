-- ============================================================
-- SITA - SISTEM INFORMASI TAHFIDZ AL-QUR'AN
-- DARUL ABROR ISLAMIC BOARDING SCHOOL
-- TARGETED HOTFIX: TAHAP 7D — REKAP FINAL & MONITORING (HOTFIX #2)
-- File: supabase_final_recap_hotfix_7d_02.sql
--
-- FIX:
-- Cast hasil pemanggilan get_semester_final_recap ke JSONB pada
-- RPC get_student_evaluation_history untuk mengeliminasi error PostgreSQL 42883
-- ("function jsonb_array_elements(json) does not exist").
-- ============================================================

CREATE OR REPLACE FUNCTION get_student_evaluation_history(
    p_username TEXT,
    p_password TEXT,
    p_student_id TEXT,
    p_academic_term_id TEXT DEFAULT NULL,
    p_config_id TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
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
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION get_student_evaluation_history(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_student_evaluation_history(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
