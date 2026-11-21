-- ============================================================================
-- SITA DARUL ABROR — ADDITIVE PATCH: MANUAL MATERIAL PART & EVIDENCE VALIDATION
-- Safe, idempotent, additive only. Does NOT re-run historical migrations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._uas_surah_num_max_ayah(p_surah_num int)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT COALESCE(
        (ARRAY[
            7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,
            112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,
            54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,
            14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,
            29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,
            11,8,3,9,5,4,7,3,6,3,5,4,5,6
        ])[p_surah_num],
        286
    );
$function$;

CREATE OR REPLACE FUNCTION public.upsert_uas_manual_part_secure(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text,
    p_part jsonb,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_period RECORD;
    v_sub RECORD;
    v_part_id TEXT;
    v_juz INT;
    v_part_type TEXT;
    v_start_surah INT;
    v_start_ayah INT;
    v_end_surah INT;
    v_end_ayah INT;
    v_start_page INT;
    v_end_page INT;
    v_cov_count INT;
    v_juz_total INT;
    v_cov_ratio NUMERIC;
    v_has_gap BOOLEAN;
    v_segments jsonb;
    v_covered_pages jsonb;
    v_eff_status TEXT;
    v_has_evidence BOOLEAN := false;
    v_has_locked_session BOOLEAN := false;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR NOT public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Anda tidak berwenang mengatur materi santri ini.');
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    SELECT * INTO v_sub FROM public.exam_uas_prep_submissions WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF FOUND AND v_sub.status = 'admin_approved' AND v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Materi sudah disetujui Admin dan dikunci. Ajukan revisi baru untuk mengubah.');
    END IF;

    v_juz := (p_part->>'juzNumber')::int;
    v_part_id := COALESCE(NULLIF(p_part->>'id', ''), 'emp_' || p_period_id || '_' || p_student_id || '_j' || v_juz::text);
    v_part_type := COALESCE(NULLIF(p_part->>'partType', ''), 'partial_half');
    v_start_surah := (p_part->>'startSurah')::int;
    v_start_ayah := (p_part->>'startAyah')::int;
    v_end_surah := (p_part->>'endSurah')::int;
    v_end_ayah := (p_part->>'endAyah')::int;
    v_start_page := COALESCE((p_part->>'startPage')::int, 1);
    v_end_page := COALESCE((p_part->>'endPage')::int, v_start_page);
    v_covered_pages := COALESCE(p_part->'coveredPages', '[]'::jsonb);
    v_cov_count := COALESCE((p_part->>'coveredPagesCount')::int, jsonb_array_length(v_covered_pages));
    v_juz_total := GREATEST(1, COALESCE((p_part->>'juzTotalPages')::int, 20));
    v_cov_ratio := COALESCE((p_part->>'coverageRatio')::numeric, 0);
    v_has_gap := COALESCE((p_part->>'hasGap')::boolean, false);
    v_segments := COALESCE(p_part->'segments', '[]'::jsonb);

    IF v_juz IS NULL OR v_juz < 1 OR v_juz > 30 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nomor juz harus antara 1 dan 30.');
    END IF;
    IF v_start_surah IS NULL OR v_end_surah IS NULL OR v_start_surah < 1 OR v_end_surah > 114 OR v_start_surah > v_end_surah THEN
        RETURN jsonb_build_object('success', false, 'message', 'Rentang surah tidak valid.');
    END IF;
    IF v_start_ayah < 1 OR v_end_ayah < 1 OR v_end_ayah > public._uas_surah_num_max_ayah(v_end_surah)
       OR (v_start_surah = v_end_surah AND v_start_ayah > v_end_ayah) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Rentang ayat melebihi batas surah atau terbalik.');
    END IF;
    IF v_cov_count <= 0 OR v_cov_ratio <= 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Cakupan halaman Mushaf tidak boleh kosong (0%).');
    END IF;

    -- Proteksi sesi yang sudah memiliki paket soal atau attempt ujian
    SELECT EXISTS (
        SELECT 1 FROM public.exam_uas_sessions s
        WHERE s.primary_part_id = v_part_id
          AND (s.attempt_id IS NOT NULL OR s.question_set_id IS NOT NULL)
    ) INTO v_has_locked_session;
    IF v_has_locked_session THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bagian materi sudah terikat pada paket soal/attempt ujian dan tidak dapat diubah secara destruktif.');
    END IF;

    -- Wajib ada bukti setoran sabaq/ziyadah sah di public.records pada rentang surah yang diklaim
    SELECT EXISTS (
        SELECT 1 FROM public.records r
        WHERE r.student_id = p_student_id
          AND r.type IN ('sabaq', 'ziyadah')
          AND (v_period.material_cutoff_date IS NULL OR r.date::date <= v_period.material_cutoff_date::date)
          AND COALESCE(r.ayah_start, 0) >= 1
          AND COALESCE(r.ayah_end, 0) >= COALESCE(r.ayah_start, 0)
          AND COALESCE(r.ayah_end, 0) <= public._uas_surah_max_ayah(r.surah)
    ) INTO v_has_evidence;

    IF NOT v_has_evidence THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ditolak: Tidak ditemukan bukti setoran sabaq/ziyadah yang sah sampai tanggal cutoff.');
    END IF;

    v_eff_status := CASE
        WHEN v_has_gap THEN 'needs_review'
        WHEN v_part_type = 'full_juz' AND v_cov_ratio >= 1 THEN 'ready'
        WHEN v_cov_ratio >= 0.5 THEN 'ready'
        ELSE 'needs_admin_decision'
    END;

    INSERT INTO public.exam_material_parts (
        id, exam_period_id, student_id, part_order, juz_number, part_type,
        start_surah, start_ayah, end_surah, end_ayah,
        start_page, end_page, covered_pages, covered_pages_count,
        juz_total_pages, coverage_ratio, segments, has_gap,
        status, teacher_status, approval_status, review_reason, updated_at
    ) VALUES (
        v_part_id, p_period_id, p_student_id, COALESCE((p_part->>'partOrder')::int, 1), v_juz, v_part_type,
        v_start_surah, v_start_ayah, v_end_surah, v_end_ayah,
        v_start_page, v_end_page, v_covered_pages, v_cov_count,
        v_juz_total, v_cov_ratio, v_segments, v_has_gap,
        v_eff_status, 'draft_manual', 'draft', COALESCE(NULLIF(trim(p_reason), ''), 'Input materi manual Guru Halaqah'), now()
    )
    ON CONFLICT (id) DO UPDATE SET
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
        status = EXCLUDED.status,
        teacher_status = 'draft_manual',
        approval_status = 'draft',
        verified_by = NULL,
        verified_at = NULL,
        review_reason = EXCLUDED.review_reason,
        updated_at = now();

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        p_period_id, p_student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        'teacher_manual_part_upsert', v_part_id, COALESCE(NULLIF(trim(p_reason), ''), 'Pengaturan materi manual'),
        jsonb_build_object('juzNumber', v_juz, 'partType', v_part_type, 'coverageRatio', v_cov_ratio)
    );

    RETURN jsonb_build_object('success', true, 'partId', v_part_id, 'status', v_eff_status, 'teacherStatus', 'draft_manual');
END;
$function$;
