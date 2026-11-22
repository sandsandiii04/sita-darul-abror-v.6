-- ============================================================================
-- SITA DARUL ABROR — ADDITIVE PATCH: AKTIVASI PERIODE UAS OLEH ADMIN
-- Scope:
--   1. get_exam_period_activation_summary_secure: Admin-only readiness summary
--      for the confirmation modal (participants, approved/ready/not-ready sessions).
--   2. set_exam_period_status_secure: Admin-only status transition
--      (preparation -> active / completed) with server-side RBAC, audit logging,
--      and zero side effects on other periods, packets, attempts, or scores.
-- Non-destructive & additive only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_exam_period_activation_summary_secure(
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
    v_user RECORD;
    v_period RECORD;
    v_participants INT := 0;
    v_total_sessions INT := 0;
    v_approved_sessions INT := 0;
    v_ready_packet_sessions INT := 0;
    v_not_ready_sessions INT := 0;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;
    IF NOT FOUND OR v_user.role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak melihat ringkasan aktivasi periode.');
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    SELECT COUNT(*)::INT INTO v_participants
    FROM public.exam_participants
    WHERE exam_period_id = p_period_id;

    SELECT
        COUNT(*)::INT,
        COUNT(*) FILTER (WHERE approval_status = 'admin_approved')::INT,
        COUNT(*) FILTER (WHERE approval_status = 'admin_approved' AND question_set_id IS NOT NULL)::INT,
        COUNT(*) FILTER (WHERE NOT (approval_status = 'admin_approved' AND question_set_id IS NOT NULL))::INT
    INTO v_total_sessions, v_approved_sessions, v_ready_packet_sessions, v_not_ready_sessions
    FROM public.exam_uas_sessions
    WHERE exam_period_id = p_period_id
      AND status != 'void';

    RETURN jsonb_build_object(
        'success', true,
        'period', jsonb_build_object(
            'id', v_period.id,
            'name', v_period.name,
            'examType', v_period.exam_type,
            'status', v_period.status,
            'materialCutoffDate', v_period.material_cutoff_date,
            'examStartDate', v_period.exam_start_date,
            'examEndDate', v_period.exam_end_date,
            'kkm', v_period.kkm
        ),
        'summary', jsonb_build_object(
            'participantsCount', v_participants,
            'totalSessions', v_total_sessions,
            'approvedSessions', v_approved_sessions,
            'readyPacketSessions', v_ready_packet_sessions,
            'notReadySessions', v_not_ready_sessions
        )
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.set_exam_period_status_secure(
    p_username text,
    p_password text,
    p_period_id text,
    p_new_status text,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_old_status TEXT;
    v_participants INT := 0;
    v_approved_sessions INT := 0;
    v_ready_packet_sessions INT := 0;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;
    IF NOT FOUND OR v_user.role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengubah status periode ujian.');
    END IF;

    IF p_new_status NOT IN ('preparation', 'active', 'completed') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Status periode tidak valid. Gunakan preparation, active, atau completed.');
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    v_old_status := v_period.status;

    IF v_old_status = p_new_status THEN
        RETURN jsonb_build_object(
            'success', true,
            'unchanged', true,
            'period', jsonb_build_object('id', v_period.id, 'name', v_period.name, 'status', v_period.status),
            'oldStatus', v_old_status,
            'newStatus', p_new_status,
            'message', 'Status periode sudah ' || p_new_status || '.'
        );
    END IF;

    SELECT COUNT(*)::INT INTO v_participants
    FROM public.exam_participants
    WHERE exam_period_id = p_period_id;

    SELECT
        COUNT(*) FILTER (WHERE approval_status = 'admin_approved')::INT,
        COUNT(*) FILTER (WHERE approval_status = 'admin_approved' AND question_set_id IS NOT NULL)::INT
    INTO v_approved_sessions, v_ready_packet_sessions
    FROM public.exam_uas_sessions
    WHERE exam_period_id = p_period_id
      AND status != 'void';

    -- Update ONLY this specific period; do not modify other periods, packets, attempts, or scores
    UPDATE public.exam_periods
    SET status = p_new_status,
        updated_at = now()
    WHERE id = p_period_id
    RETURNING * INTO v_period;

    INSERT INTO public.exam_audit_logs (
        id, exam_period_id, student_id,
        action_type, actor_user_id, reason, payload
    ) VALUES (
        'eal_pstat_' || (EXTRACT(EPOCH FROM now())::BIGINT)::TEXT || '_' || floor(random()*1000)::TEXT,
        p_period_id, NULL,
        'UPDATE_EXAM_PERIOD_STATUS', v_user.id,
        COALESCE(NULLIF(trim(p_note), ''), 'Perubahan status periode ' || v_old_status || ' -> ' || p_new_status),
        jsonb_build_object(
            'period_id', p_period_id,
            'period_name', v_period.name,
            'exam_type', v_period.exam_type,
            'old_status', v_old_status,
            'new_status', p_new_status,
            'participants_count', v_participants,
            'approved_sessions', v_approved_sessions,
            'ready_packet_sessions', v_ready_packet_sessions
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'period', jsonb_build_object(
            'id', v_period.id,
            'name', v_period.name,
            'examType', v_period.exam_type,
            'status', v_period.status,
            'materialCutoffDate', v_period.material_cutoff_date,
            'examStartDate', v_period.exam_start_date,
            'examEndDate', v_period.exam_end_date,
            'kkm', v_period.kkm
        ),
        'oldStatus', v_old_status,
        'newStatus', p_new_status,
        'message', CASE
            WHEN p_new_status = 'active' THEN 'Periode ' || v_period.name || ' berhasil diaktifkan. Penguji kini dapat memulai ujian.'
            WHEN p_new_status = 'completed' THEN 'Periode ' || v_period.name || ' berhasil ditutup (selesai).'
            ELSE 'Periode ' || v_period.name || ' dikembalikan ke tahap persiapan.'
        END
    );
END;
$function$;
