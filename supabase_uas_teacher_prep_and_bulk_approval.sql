-- ============================================================================
-- SITA DARUL ABROR — VERIFIKASI GURU HALAQAH, SESI MANUAL & PERSETUJUAN MASSAL ADMIN
-- Migrasi Additive + Gabungan Patch Validasi (TIDAK menghapus tabel/data historis)
-- ============================================================================

-- 1. Kolom tambahan pada exam_material_parts (additive)
ALTER TABLE public.exam_material_parts
    ADD COLUMN IF NOT EXISTS verification_notes TEXT,
    ADD COLUMN IF NOT EXISTS source_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS teacher_status TEXT NOT NULL DEFAULT 'draft_auto',
    ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS approved_by TEXT,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
    ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1;

-- 2. Kolom tambahan pada exam_uas_sessions (additive)
ALTER TABLE public.exam_uas_sessions
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'auto',
    ADD COLUMN IF NOT EXISTS created_by TEXT,
    ADD COLUMN IF NOT EXISTS created_by_name TEXT,
    ADD COLUMN IF NOT EXISTS change_reason TEXT,
    ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS approved_by TEXT,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
    ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

-- 3. Tabel pengajuan persiapan materi & sesi per santri (Guru -> Admin)
CREATE TABLE IF NOT EXISTS public.exam_uas_prep_submissions (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    halaqah TEXT,
    student_name TEXT,
    student_class TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    is_exception BOOLEAN NOT NULL DEFAULT false,
    exception_reason TEXT,
    revision_number INTEGER NOT NULL DEFAULT 1,
    source_fingerprint TEXT,
    full_juz_count INTEGER NOT NULL DEFAULT 0,
    partial_juz_count INTEGER NOT NULL DEFAULT 0,
    manual_session_count INTEGER NOT NULL DEFAULT 0,
    total_session_count INTEGER NOT NULL DEFAULT 0,
    submitted_at TIMESTAMPTZ,
    approved_by TEXT,
    approved_by_name TEXT,
    approved_at TIMESTAMPTZ,
    rejected_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exam_period_id, student_id)
);

-- 4. Tabel audit log persiapan materi, sesi manual, dan persetujuan
CREATE TABLE IF NOT EXISTS public.exam_uas_prep_audit_logs (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT,
    reason TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.exam_uas_prep_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_uas_prep_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exam_uas_prep_submissions_no_direct ON public.exam_uas_prep_submissions;
CREATE POLICY exam_uas_prep_submissions_no_direct ON public.exam_uas_prep_submissions FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS exam_uas_prep_audit_logs_no_direct ON public.exam_uas_prep_audit_logs;
CREATE POLICY exam_uas_prep_audit_logs_no_direct ON public.exam_uas_prep_audit_logs FOR ALL USING (false) WITH CHECK (false);

-- 5. Helper: Batas maksimal ayat surah untuk validasi server-side
CREATE OR REPLACE FUNCTION public._uas_surah_max_ayah(p_surah_name text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    v_clean TEXT := regexp_replace(lower(trim(COALESCE(p_surah_name, ''))), '[''’`\s-]', '', 'g');
BEGIN
    IF v_clean LIKE '%fatihah%' THEN RETURN 7;
    ELSIF v_clean LIKE '%baqarah%' OR v_clean LIKE '%baqoro%' THEN RETURN 286;
    ELSIF v_clean LIKE '%imran%' THEN RETURN 200;
    ELSIF v_clean LIKE '%nisa%' THEN RETURN 176;
    ELSIF v_clean LIKE '%maidah%' THEN RETURN 120;
    ELSIF v_clean LIKE '%anam%' THEN RETURN 165;
    ELSIF v_clean LIKE '%araf%' THEN RETURN 206;
    ELSIF v_clean LIKE '%anfal%' THEN RETURN 75;
    ELSIF v_clean LIKE '%taubah%' THEN RETURN 129;
    ELSIF v_clean LIKE '%yunus%' THEN RETURN 109;
    ELSIF v_clean LIKE '%hud%' THEN RETURN 123;
    ELSIF v_clean LIKE '%yusuf%' THEN RETURN 111;
    ELSIF v_clean LIKE '%naba%' THEN RETURN 40;
    ELSIF v_clean LIKE '%naziat%' THEN RETURN 46;
    ELSIF v_clean LIKE '%abasa%' THEN RETURN 42;
    ELSIF v_clean LIKE '%nas%' THEN RETURN 6;
    ELSIF v_clean LIKE '%falaq%' THEN RETURN 5;
    ELSIF v_clean LIKE '%ikhlas%' THEN RETURN 4;
    ELSE RETURN 286;
    END IF;
END;
$function$;

-- 6. Helper: Cek kepemilikan halaqah guru atau admin
CREATE OR REPLACE FUNCTION public._uas_assert_student_access(
    p_user_id text,
    p_role text,
    p_student_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
    SELECT CASE
        WHEN p_role = 'admin' THEN true
        WHEN p_role = 'teacher' THEN EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.id = p_student_id AND s.teacher_id = p_user_id
        )
        ELSE false
    END;
$function$;

-- 7. Read RPC: Get Per-Juz Parts, Sessions & Submissions (terfilter per halaqah untuk guru)
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
    v_submissions jsonb;
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
    WHERE p.exam_period_id = p_period_id
      AND (
          v_auth.out_role IN ('admin', 'shared_uas_examiner')
          OR EXISTS (
              SELECT 1 FROM public.students st
              WHERE st.id = p.student_id AND st.teacher_id = v_auth.out_user_id
          )
      );

    SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.student_id, s.session_number), '[]'::jsonb)
    INTO v_sessions
    FROM public.exam_uas_sessions s
    WHERE s.exam_period_id = p_period_id
      AND (
          v_auth.out_role IN ('admin', 'shared_uas_examiner')
          OR EXISTS (
              SELECT 1 FROM public.students st
              WHERE st.id = s.student_id AND st.teacher_id = v_auth.out_user_id
          )
      );

    SELECT COALESCE(jsonb_agg(row_to_json(sub) ORDER BY sub.student_name, sub.student_id), '[]'::jsonb)
    INTO v_submissions
    FROM public.exam_uas_prep_submissions sub
    WHERE sub.exam_period_id = p_period_id
      AND (
          v_auth.out_role = 'admin'
          OR (v_auth.out_role = 'teacher' AND EXISTS (
              SELECT 1 FROM public.students st
              WHERE st.id = sub.student_id AND st.teacher_id = v_auth.out_user_id
          ))
      );

    RETURN jsonb_build_object(
        'success', true,
        'parts', v_parts,
        'sessions', v_sessions,
        'submissions', v_submissions
    );
END;
$function$;

-- 8. Save Auto Parts & Sessions (Admin atau Guru pemilik halaqah, dengan validasi server ke public.records)
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
    v_period RECORD;
    v_sub RECORD;
    v_part jsonb;
    v_sess jsonb;
    v_existing RECORD;
    v_has_db_anomaly BOOLEAN := false;
    v_db_anomaly_msg TEXT := NULL;
    v_seg_count INT;
    v_eff_has_gap BOOLEAN;
    v_eff_status TEXT;
    v_has_active_pkg_or_att BOOLEAN;
    v_coverage_changed BOOLEAN;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR NOT public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Anda tidak berwenang mengelola materi santri ini.');
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id;
    SELECT * INTO v_sub FROM public.exam_uas_prep_submissions WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    -- Verifikasi langsung terhadap sumber public.records di server
    SELECT
        EXISTS (
            SELECT 1
            FROM public.records r
            WHERE r.student_id = p_student_id
              AND r.type IN ('sabaq', 'ziyadah')
              AND (v_period.material_cutoff_date IS NULL OR r.date::date <= v_period.material_cutoff_date::date)
              AND (
                  (COALESCE(r.ayah_start, 0) > COALESCE(r.ayah_end, 0) AND COALESCE(r.ayah_end, 0) > 0)
                  OR COALESCE(r.ayah_end, 0) > public._uas_surah_max_ayah(r.surah)
              )
        ),
        (
            SELECT string_agg(r.surah || ' ' || r.ayah_start || '-' || r.ayah_end || ' (' || r.date || ')', '; ')
            FROM public.records r
            WHERE r.student_id = p_student_id
              AND r.type IN ('sabaq', 'ziyadah')
              AND (v_period.material_cutoff_date IS NULL OR r.date::date <= v_period.material_cutoff_date::date)
              AND (
                  (COALESCE(r.ayah_start, 0) > COALESCE(r.ayah_end, 0) AND COALESCE(r.ayah_end, 0) > 0)
                  OR COALESCE(r.ayah_end, 0) > public._uas_surah_max_ayah(r.surah)
              )
        )
    INTO v_has_db_anomaly, v_db_anomaly_msg;

    FOR v_part IN SELECT * FROM jsonb_array_elements(COALESCE(p_parts, '[]'::jsonb)) LOOP
        v_seg_count := jsonb_array_length(COALESCE(v_part->'segments', '[]'::jsonb));
        v_eff_has_gap := COALESCE((v_part->>'hasGap')::boolean, false) OR v_seg_count > 1;

        IF v_eff_has_gap
           OR v_has_db_anomaly
           OR COALESCE(v_part->>'reviewReason', '') ~* '(melebihi batas|terbalik|anomali|tidak valid|tidak dikenali)'
        THEN
            v_eff_status := 'needs_review';
        ELSIF v_part->>'status' = 'finalized' THEN
            v_eff_status := 'ready';
        ELSE
            v_eff_status := COALESCE(NULLIF(v_part->>'status', ''), 'ready');
        END IF;

        SELECT * INTO v_existing FROM public.exam_material_parts WHERE id = (v_part->>'id');

        IF NOT FOUND THEN
            INSERT INTO public.exam_material_parts (
                id, exam_period_id, student_id, snapshot_id, part_order, juz_number, part_type,
                start_surah, start_ayah, end_surah, end_ayah, start_page, end_page,
                covered_pages, covered_pages_count, juz_total_pages, coverage_ratio,
                segments, has_gap, status, teacher_status, review_reason, updated_at
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
                v_eff_has_gap,
                v_eff_status,
                CASE WHEN v_eff_status = 'needs_review' THEN 'needs_teacher_review' ELSE 'draft_auto' END,
                COALESCE(NULLIF(v_part->>'reviewReason', ''), CASE WHEN v_has_db_anomaly THEN 'Anomali setoran sumber: ' || v_db_anomaly_msg ELSE NULL END),
                now()
            );
        ELSE
            IF v_existing.status = 'excluded' THEN
                CONTINUE;
            END IF;

            v_coverage_changed := (
                v_existing.covered_pages IS DISTINCT FROM COALESCE(v_part->'coveredPages', '[]'::jsonb)
                OR v_existing.has_gap IS DISTINCT FROM v_eff_has_gap
                OR v_existing.start_surah IS DISTINCT FROM (v_part->>'startSurah')::int
                OR v_existing.start_ayah IS DISTINCT FROM (v_part->>'startAyah')::int
                OR v_existing.end_surah IS DISTINCT FROM (v_part->>'endSurah')::int
                OR v_existing.end_ayah IS DISTINCT FROM (v_part->>'endAyah')::int
            );

            SELECT EXISTS (
                SELECT 1 FROM public.exam_uas_sessions s
                WHERE s.primary_part_id = v_existing.id
                  AND (s.question_set_id IS NOT NULL OR s.attempt_id IS NOT NULL)
            ) INTO v_has_active_pkg_or_att;

            IF v_existing.status = 'finalized' AND v_coverage_changed AND v_has_active_pkg_or_att THEN
                UPDATE public.exam_material_parts
                SET
                    status = 'needs_review',
                    teacher_status = 'stale',
                    approval_status = 'stale',
                    review_reason = 'STALE: Sumber setoran berubah setelah paket/attempt dibuat. Periksa manual sebelum mengubah paket.',
                    updated_at = now()
                WHERE id = v_existing.id;

                IF v_sub.id IS NOT NULL AND v_sub.status = 'admin_approved' THEN
                    UPDATE public.exam_uas_prep_submissions
                    SET status = 'stale', updated_at = now()
                    WHERE id = v_sub.id;
                END IF;
            ELSIF (v_existing.status = 'finalized' OR v_existing.teacher_status = 'admin_approved') AND NOT v_coverage_changed THEN
                UPDATE public.exam_material_parts SET updated_at = now() WHERE id = v_existing.id;
            ELSE
                UPDATE public.exam_material_parts
                SET
                    part_order = COALESCE((v_part->>'partOrder')::int, 1),
                    part_type = v_part->>'partType',
                    start_surah = (v_part->>'startSurah')::int,
                    start_ayah = (v_part->>'startAyah')::int,
                    end_surah = (v_part->>'endSurah')::int,
                    end_ayah = (v_part->>'endAyah')::int,
                    start_page = (v_part->>'startPage')::int,
                    end_page = (v_part->>'endPage')::int,
                    covered_pages = COALESCE(v_part->'coveredPages', '[]'::jsonb),
                    covered_pages_count = COALESCE((v_part->>'coveredPagesCount')::int, 0),
                    juz_total_pages = COALESCE((v_part->>'juzTotalPages')::int, 20),
                    coverage_ratio = COALESCE((v_part->>'coverageRatio')::numeric, 0),
                    segments = COALESCE(v_part->'segments', '[]'::jsonb),
                    has_gap = v_eff_has_gap,
                    status = v_eff_status,
                    teacher_status = CASE
                        WHEN v_coverage_changed THEN CASE WHEN v_eff_status = 'needs_review' THEN 'needs_teacher_review' ELSE 'draft_auto' END
                        ELSE v_existing.teacher_status
                    END,
                    approval_status = CASE WHEN v_coverage_changed THEN 'draft' ELSE v_existing.approval_status END,
                    verified_by = CASE WHEN v_coverage_changed THEN NULL ELSE v_existing.verified_by END,
                    verified_at = CASE WHEN v_coverage_changed THEN NULL ELSE v_existing.verified_at END,
                    finalized_by = CASE WHEN v_coverage_changed THEN NULL ELSE v_existing.finalized_by END,
                    finalized_at = CASE WHEN v_coverage_changed THEN NULL ELSE v_existing.finalized_at END,
                    review_reason = COALESCE(NULLIF(v_part->>'reviewReason', ''), v_existing.review_reason),
                    updated_at = now()
                WHERE id = v_existing.id;

                IF v_coverage_changed AND v_sub.id IS NOT NULL AND v_sub.status IN ('admin_approved', 'pending_admin_approval') THEN
                    UPDATE public.exam_uas_prep_submissions
                    SET status = 'stale', updated_at = now()
                    WHERE id = v_sub.id;
                END IF;
            END IF;
        END IF;
    END LOOP;

    -- Upsert auto sessions only (do not overwrite manual sessions or locked/active sessions)
    FOR v_sess IN SELECT * FROM jsonb_array_elements(COALESCE(p_sessions, '[]'::jsonb)) LOOP
        INSERT INTO public.exam_uas_sessions (
            id, exam_period_id, student_id, session_number, session_type,
            primary_part_id, juz_number, supplemental_parts, covered_pages,
            start_surah, start_ayah, end_surah, end_ayah, start_page, end_page,
            source, created_by, created_by_name, status, updated_at
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
            'auto',
            v_auth.out_user_id,
            v_auth.out_name,
            'planned',
            now()
        )
        ON CONFLICT (id) DO UPDATE SET
            session_type = CASE WHEN public.exam_uas_sessions.source = 'manual' OR public.exam_uas_sessions.is_locked OR public.exam_uas_sessions.question_set_id IS NOT NULL OR public.exam_uas_sessions.attempt_id IS NOT NULL THEN public.exam_uas_sessions.session_type ELSE EXCLUDED.session_type END,
            primary_part_id = CASE WHEN public.exam_uas_sessions.source = 'manual' OR public.exam_uas_sessions.is_locked OR public.exam_uas_sessions.question_set_id IS NOT NULL OR public.exam_uas_sessions.attempt_id IS NOT NULL THEN public.exam_uas_sessions.primary_part_id ELSE EXCLUDED.primary_part_id END,
            supplemental_parts = CASE WHEN public.exam_uas_sessions.source = 'manual' OR public.exam_uas_sessions.is_locked OR public.exam_uas_sessions.question_set_id IS NOT NULL OR public.exam_uas_sessions.attempt_id IS NOT NULL THEN public.exam_uas_sessions.supplemental_parts ELSE EXCLUDED.supplemental_parts END,
            covered_pages = CASE WHEN public.exam_uas_sessions.source = 'manual' OR public.exam_uas_sessions.is_locked OR public.exam_uas_sessions.question_set_id IS NOT NULL OR public.exam_uas_sessions.attempt_id IS NOT NULL THEN public.exam_uas_sessions.covered_pages ELSE EXCLUDED.covered_pages END,
            start_surah = CASE WHEN public.exam_uas_sessions.source = 'manual' OR public.exam_uas_sessions.is_locked OR public.exam_uas_sessions.question_set_id IS NOT NULL OR public.exam_uas_sessions.attempt_id IS NOT NULL THEN public.exam_uas_sessions.start_surah ELSE EXCLUDED.start_surah END,
            start_ayah = CASE WHEN public.exam_uas_sessions.source = 'manual' OR public.exam_uas_sessions.is_locked OR public.exam_uas_sessions.question_set_id IS NOT NULL OR public.exam_uas_sessions.attempt_id IS NOT NULL THEN public.exam_uas_sessions.start_ayah ELSE EXCLUDED.start_ayah END,
            end_surah = CASE WHEN public.exam_uas_sessions.source = 'manual' OR public.exam_uas_sessions.is_locked OR public.exam_uas_sessions.question_set_id IS NOT NULL OR public.exam_uas_sessions.attempt_id IS NOT NULL THEN public.exam_uas_sessions.end_surah ELSE EXCLUDED.end_surah END,
            end_ayah = CASE WHEN public.exam_uas_sessions.source = 'manual' OR public.exam_uas_sessions.is_locked OR public.exam_uas_sessions.question_set_id IS NOT NULL OR public.exam_uas_sessions.attempt_id IS NOT NULL THEN public.exam_uas_sessions.end_ayah ELSE EXCLUDED.end_ayah END,
            start_page = CASE WHEN public.exam_uas_sessions.source = 'manual' OR public.exam_uas_sessions.is_locked OR public.exam_uas_sessions.question_set_id IS NOT NULL OR public.exam_uas_sessions.attempt_id IS NOT NULL THEN public.exam_uas_sessions.start_page ELSE EXCLUDED.start_page END,
            end_page = CASE WHEN public.exam_uas_sessions.source = 'manual' OR public.exam_uas_sessions.is_locked OR public.exam_uas_sessions.question_set_id IS NOT NULL OR public.exam_uas_sessions.attempt_id IS NOT NULL THEN public.exam_uas_sessions.end_page ELSE EXCLUDED.end_page END,
            updated_at = now();
    END LOOP;

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 9. Verify / Finalize / Exclude Individual Juz Material Part (Guru pemilik halaqah bisa verify/exclude; hanya Admin bisa finalize)
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
    v_part RECORD;
    v_period RECORD;
    v_new_status TEXT;
    v_new_teacher_status TEXT;
    v_has_db_anomaly BOOLEAN := false;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role NOT IN ('admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT * INTO v_part FROM public.exam_material_parts WHERE id = p_part_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bagian materi tidak ditemukan.');
    END IF;

    IF NOT public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, v_part.student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Santri ini bukan binaan halaqah Anda.');
    END IF;

    IF p_action = 'finalize' AND v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang dapat memfinalisasi akhir materi UAS.');
    END IF;

    IF v_part.teacher_status = 'admin_approved' AND v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Materi sudah disetujui Admin dan dikunci. Ajukan revisi baru jika ada perubahan.');
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = v_part.exam_period_id;

    v_new_status := CASE p_action
        WHEN 'verify' THEN 'ready'
        WHEN 'finalize' THEN 'finalized'
        WHEN 'exclude' THEN 'excluded'
        ELSE NULL
    END;

    v_new_teacher_status := CASE p_action
        WHEN 'verify' THEN 'teacher_verified'
        WHEN 'finalize' THEN 'admin_approved'
        WHEN 'exclude' THEN v_part.teacher_status
        ELSE v_part.teacher_status
    END;

    IF v_new_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Aksi tidak dikenal.');
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.records r
        WHERE r.student_id = v_part.student_id
          AND r.type IN ('sabaq', 'ziyadah')
          AND (v_period.material_cutoff_date IS NULL OR r.date::date <= v_period.material_cutoff_date::date)
          AND (
              (COALESCE(r.ayah_start, 0) > COALESCE(r.ayah_end, 0) AND COALESCE(r.ayah_end, 0) > 0)
              OR COALESCE(r.ayah_end, 0) > public._uas_surah_max_ayah(r.surah)
          )
    ) INTO v_has_db_anomaly;

    IF p_action = 'verify' THEN
        IF COALESCE(v_part.coverage_ratio, 0) <= 0 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Verifikasi ditolak: cakupan materi tidak sah (0%).');
        END IF;
        IF v_has_db_anomaly OR COALESCE(v_part.review_reason, '') ~* '(melebihi batas|terbalik|anomali|tidak valid|tidak dikenali)' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Verifikasi ditolak: Data setoran sumber masih memiliki ayat tidak valid. Perbaiki record setoran terlebih dahulu.');
        END IF;
        IF length(trim(COALESCE(p_reason, ''))) < 5 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Verifikasi ditolak: wajib mengisi catatan pemeriksaan minimal 5 karakter.');
        END IF;
    END IF;

    IF p_action = 'finalize' THEN
        IF v_part.status = 'needs_review' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Finalisasi ditolak: Bagian materi masih berstatus needs_review. Lakukan Verifikasi terlebih dahulu.');
        END IF;
        IF v_part.status = 'needs_admin_decision' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Finalisasi ditolak: Materi < 0,5 juz berstatus needs_admin_decision.');
        END IF;
        IF v_part.status = 'excluded' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Finalisasi ditolak: Bagian materi sudah dikecualikan (excluded).');
        END IF;
        IF v_part.has_gap AND v_part.verified_at IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', 'Finalisasi ditolak: Materi memiliki lompatan segmen yang belum diverifikasi.');
        END IF;
        IF v_has_db_anomaly OR COALESCE(v_part.review_reason, '') ~* '(melebihi batas|terbalik|anomali|tidak valid|tidak dikenali)' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Finalisasi ditolak: Data setoran sumber masih memiliki ayat tidak valid.');
        END IF;
        IF COALESCE(v_part.coverage_ratio, 0) <= 0 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Finalisasi ditolak: Cakupan materi tidak sah (0%).');
        END IF;
        IF v_part.part_type = 'full_juz' AND COALESCE(v_part.coverage_ratio, 0) < 1 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Finalisasi ditolak: Juz penuh wajib 100% cakupan.');
        END IF;
    END IF;

    UPDATE public.exam_material_parts
    SET
        status = v_new_status,
        teacher_status = v_new_teacher_status,
        verification_notes = CASE WHEN p_action = 'verify' THEN trim(p_reason) ELSE verification_notes END,
        review_reason = COALESCE(NULLIF(trim(p_reason), ''), review_reason),
        verified_by = CASE WHEN p_action IN ('verify', 'finalize') THEN v_auth.out_user_id ELSE verified_by END,
        verified_at = CASE WHEN p_action IN ('verify', 'finalize') THEN now() ELSE verified_at END,
        finalized_by = CASE WHEN p_action = 'finalize' THEN v_auth.out_user_id ELSE finalized_by END,
        finalized_at = CASE WHEN p_action = 'finalize' THEN now() ELSE finalized_at END,
        approval_status = CASE WHEN p_action = 'finalize' THEN 'admin_approved' ELSE approval_status END,
        approved_by = CASE WHEN p_action = 'finalize' THEN v_auth.out_user_id ELSE approved_by END,
        approved_at = CASE WHEN p_action = 'finalize' THEN now() ELSE approved_at END,
        updated_at = now()
    WHERE id = p_part_id;

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        v_part.exam_period_id,
        v_part.student_id,
        v_auth.out_user_id,
        v_auth.out_name,
        v_auth.out_role,
        CASE p_action WHEN 'verify' THEN 'teacher_verify' WHEN 'finalize' THEN 'admin_finalize' ELSE 'exclude_part' END,
        p_part_id,
        p_reason,
        jsonb_build_object('juzNumber', v_part.juz_number, 'newStatus', v_new_status)
    );

    RETURN jsonb_build_object('success', true, 'partId', p_part_id, 'status', v_new_status, 'teacherStatus', v_new_teacher_status);
END;
$function$;

-- 10. Tambah / Edit Sesi Manual oleh Guru Halaqah atau Admin
CREATE OR REPLACE FUNCTION public.upsert_uas_manual_session_secure(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text,
    p_session jsonb,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_part RECORD;
    v_sub RECORD;
    v_existing RECORD;
    v_sess_id TEXT;
    v_sess_num INT;
    v_sess_type TEXT;
    v_primary_part_id TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR NOT public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Anda tidak berwenang mengatur sesi santri ini.');
    END IF;

    IF length(trim(COALESCE(p_reason, ''))) < 5 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Catatan alasan perubahan manual wajib diisi (minimal 5 karakter).');
    END IF;

    SELECT * INTO v_sub FROM public.exam_uas_prep_submissions WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF FOUND AND v_sub.status = 'admin_approved' AND v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengajuan sudah disetujui Admin dan dikunci. Buat revisi baru untuk mengubah sesi.');
    END IF;

    v_sess_id := COALESCE(NULLIF(p_session->>'id', ''), 'uas_sess_man_' || p_period_id || '_' || p_student_id || '_' || floor(extract(epoch from now()) * 1000)::bigint::text);
    v_sess_num := (p_session->>'sessionNumber')::int;
    v_sess_type := p_session->>'sessionType';
    v_primary_part_id := NULLIF(p_session->>'primaryPartId', '');

    IF v_sess_type NOT IN ('full_juz', 'partial_half') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Jenis sesi harus full_juz atau partial_half.');
    END IF;

    IF v_primary_part_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bagian materi utama (juz) wajib dipilih.');
    END IF;

    SELECT * INTO v_part FROM public.exam_material_parts WHERE id = v_primary_part_id AND exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bagian materi juz tidak ditemukan.');
    END IF;

    IF v_part.verified_at IS NULL AND v_part.status != 'ready' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bagian materi harus diverifikasi terlebih dahulu sebelum dibuat sesi.');
    END IF;

    -- Enforsir aturan akademik ketat untuk full_juz (100%) dan partial_half (>= 50%)
    IF v_sess_type = 'full_juz' AND (v_part.part_type != 'full_juz' OR COALESCE(v_part.coverage_ratio, 0) < 1 OR v_part.has_gap) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ditolak: Sesi full_juz hanya boleh dibuat dari hafalan sah 100% satu juz tanpa celah.');
    END IF;
    IF v_sess_type = 'partial_half' AND COALESCE(v_part.coverage_ratio, 0) < 0.5 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ditolak: Sesi setengah juz (partial_half) minimal 50% cakupan panjang hafalan.');
    END IF;

    -- Cek duplikasi nomor sesi
    IF EXISTS (
        SELECT 1 FROM public.exam_uas_sessions s
        WHERE s.exam_period_id = p_period_id AND s.student_id = p_student_id AND s.session_number = v_sess_num AND s.id != v_sess_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nomor sesi ' || v_sess_num || ' sudah digunakan pada santri ini.');
    END IF;

    -- Cek apakah sesi sudah memiliki paket atau attempt
    SELECT * INTO v_existing FROM public.exam_uas_sessions WHERE id = v_sess_id;
    IF FOUND THEN
        IF v_existing.attempt_id IS NOT NULL THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi yang sudah memiliki attempt/nilai ujian tidak boleh diubah.');
        END IF;
        IF v_existing.question_set_id IS NOT NULL THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi sudah memiliki paket soal. Hapus/regenerasi paket soal melalui Admin terlebih dahulu.');
        END IF;
        IF v_existing.is_locked AND v_auth.out_role != 'admin' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi sudah dikunci oleh Admin.');
        END IF;
    ELSE
        -- Cek duplikasi cakupan utama jika bukan revisi
        IF EXISTS (
            SELECT 1 FROM public.exam_uas_sessions s
            WHERE s.exam_period_id = p_period_id AND s.student_id = p_student_id AND s.primary_part_id = v_primary_part_id
        ) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Bagian juz ini sudah memiliki sesi aktif. Edit sesi yang ada atau gunakan alasan khusus.');
        END IF;
    END IF;

    INSERT INTO public.exam_uas_sessions (
        id, exam_period_id, student_id, session_number, session_type,
        primary_part_id, juz_number, supplemental_parts, covered_pages,
        start_surah, start_ayah, end_surah, end_ayah, start_page, end_page,
        source, created_by, created_by_name, change_reason, approval_status, status, updated_at
    ) VALUES (
        v_sess_id, p_period_id, p_student_id, v_sess_num, v_sess_type,
        v_primary_part_id, v_part.juz_number,
        COALESCE(p_session->'supplementalParts', '[]'::jsonb),
        COALESCE(p_session->'coveredPages', v_part.covered_pages),
        COALESCE((p_session->>'startSurah')::int, v_part.start_surah),
        COALESCE((p_session->>'startAyah')::int, v_part.start_ayah),
        COALESCE((p_session->>'endSurah')::int, v_part.end_surah),
        COALESCE((p_session->>'endAyah')::int, v_part.end_ayah),
        COALESCE((p_session->>'startPage')::int, v_part.start_page),
        COALESCE((p_session->>'endPage')::int, v_part.end_page),
        'manual', v_auth.out_user_id, v_auth.out_name, trim(p_reason), 'draft', 'planned', now()
    )
    ON CONFLICT (id) DO UPDATE SET
        session_number = EXCLUDED.session_number,
        session_type = EXCLUDED.session_type,
        supplemental_parts = EXCLUDED.supplemental_parts,
        covered_pages = EXCLUDED.covered_pages,
        start_surah = EXCLUDED.start_surah,
        start_ayah = EXCLUDED.start_ayah,
        end_surah = EXCLUDED.end_surah,
        end_ayah = EXCLUDED.end_ayah,
        start_page = EXCLUDED.start_page,
        end_page = EXCLUDED.end_page,
        change_reason = EXCLUDED.change_reason,
        approval_status = 'draft',
        updated_at = now();

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        p_period_id, p_student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        CASE WHEN v_existing.id IS NULL THEN 'teacher_create_manual_session' ELSE 'teacher_edit_session' END,
        v_sess_id, trim(p_reason),
        jsonb_build_object('sessionNumber', v_sess_num, 'sessionType', v_sess_type, 'juzNumber', v_part.juz_number)
    );

    RETURN jsonb_build_object('success', true, 'sessionId', v_sess_id);
END;
$function$;

-- 11. Hapus Sesi Manual Draft (hanya sesi manual belum dikunci & belum ada paket/attempt)
CREATE OR REPLACE FUNCTION public.delete_uas_manual_session_secure(
    p_username text,
    p_password text,
    p_session_id text,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_sess RECORD;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT * INTO v_sess FROM public.exam_uas_sessions WHERE id = p_session_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak ditemukan.');
    END IF;

    IF NOT public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, v_sess.student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    IF v_sess.source != 'manual' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi otomatis tidak boleh dihapus melalui tombol hapus manual.');
    END IF;
    IF v_sess.attempt_id IS NOT NULL OR v_sess.question_set_id IS NOT NULL OR v_sess.is_locked THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi yang sudah dikunci/memiliki paket atau attempt tidak boleh dihapus.');
    END IF;

    DELETE FROM public.exam_uas_sessions WHERE id = p_session_id;

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        v_sess.exam_period_id, v_sess.student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        'teacher_delete_session', p_session_id, COALESCE(NULLIF(trim(p_reason), ''), 'Pembatalan sesi manual draft')
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 12. Kirim Pengajuan Materi & Sesi ke Admin
CREATE OR REPLACE FUNCTION public.submit_uas_prep_for_approval_secure(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text,
    p_is_exception boolean DEFAULT false,
    p_exception_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_student RECORD;
    v_period RECORD;
    v_has_db_anomaly BOOLEAN := false;
    v_unverified_cnt INT;
    v_full_cnt INT;
    v_partial_cnt INT;
    v_manual_cnt INT;
    v_total_cnt INT;
    v_target_status TEXT;
    v_sub_id TEXT := 'sub_' || p_period_id || '_' || p_student_id;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR NOT public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Santri ini bukan binaan halaqah Anda.');
    END IF;

    SELECT * INTO v_student FROM public.students WHERE id = p_student_id;
    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id;

    SELECT EXISTS (
        SELECT 1 FROM public.records r
        WHERE r.student_id = p_student_id
          AND r.type IN ('sabaq', 'ziyadah')
          AND (v_period.material_cutoff_date IS NULL OR r.date::date <= v_period.material_cutoff_date::date)
          AND (
              (COALESCE(r.ayah_start, 0) > COALESCE(r.ayah_end, 0) AND COALESCE(r.ayah_end, 0) > 0)
              OR COALESCE(r.ayah_end, 0) > public._uas_surah_max_ayah(r.surah)
          )
    ) INTO v_has_db_anomaly;

    IF v_has_db_anomaly AND NOT p_is_exception THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengajuan ditolak: Masih terdapat record ayat tidak valid. Perbaiki record atau ajukan sebagai pengecualian.');
    END IF;

    SELECT count(*)::int INTO v_unverified_cnt
    FROM public.exam_material_parts p
    WHERE p.exam_period_id = p_period_id AND p.student_id = p_student_id
      AND p.status != 'excluded'
      AND (p.status IN ('needs_review', 'needs_admin_decision') OR p.verified_at IS NULL);

    IF v_unverified_cnt > 0 AND NOT p_is_exception THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengajuan ditolak: Masih ada ' || v_unverified_cnt || ' bagian juz yang belum diverifikasi guru.');
    END IF;

    SELECT
        count(*) FILTER (WHERE session_type = 'full_juz')::int,
        count(*) FILTER (WHERE session_type = 'partial_half')::int,
        count(*) FILTER (WHERE source = 'manual')::int,
        count(*)::int
    INTO v_full_cnt, v_partial_cnt, v_manual_cnt, v_total_cnt
    FROM public.exam_uas_sessions
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF v_total_cnt = 0 AND NOT p_is_exception THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengajuan ditolak: Belum ada sesi UAS yang direncanakan.');
    END IF;

    IF p_is_exception AND length(trim(COALESCE(p_exception_reason, ''))) < 5 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Alasan pengecualian wajib diisi minimal 5 karakter.');
    END IF;

    v_target_status := CASE WHEN p_is_exception THEN 'exception_pending' ELSE 'pending_admin_approval' END;

    INSERT INTO public.exam_uas_prep_submissions (
        id, exam_period_id, student_id, teacher_id, teacher_name,
        halaqah, student_name, student_class, status, is_exception, exception_reason,
        full_juz_count, partial_juz_count, manual_session_count, total_session_count,
        submitted_at, updated_at
    ) VALUES (
        v_sub_id, p_period_id, p_student_id, v_auth.out_user_id, v_auth.out_name,
        v_student.halaqah, v_student.name, v_student.class, v_target_status, p_is_exception, NULLIF(trim(p_exception_reason), ''),
        v_full_cnt, v_partial_cnt, v_manual_cnt, v_total_cnt, now(), now()
    )
    ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
        teacher_id = EXCLUDED.teacher_id,
        teacher_name = EXCLUDED.teacher_name,
        status = EXCLUDED.status,
        is_exception = EXCLUDED.is_exception,
        exception_reason = EXCLUDED.exception_reason,
        full_juz_count = EXCLUDED.full_juz_count,
        partial_juz_count = EXCLUDED.partial_juz_count,
        manual_session_count = EXCLUDED.manual_session_count,
        total_session_count = EXCLUDED.total_session_count,
        rejected_reason = NULL,
        submitted_at = now(),
        updated_at = now();

    UPDATE public.exam_material_parts
    SET teacher_status = v_target_status, approval_status = v_target_status, updated_at = now()
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status != 'excluded';

    UPDATE public.exam_uas_sessions
    SET approval_status = v_target_status, updated_at = now()
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        p_period_id, p_student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        'teacher_submit_approval', v_sub_id, p_exception_reason,
        jsonb_build_object('status', v_target_status, 'totalSessions', v_total_cnt)
    );

    RETURN jsonb_build_object('success', true, 'submissionId', v_sub_id, 'status', v_target_status);
END;
$function$;

-- 13. Buka Revisi Baru setelah Disetujui Admin (tanpa menghapus attempt/nilai yang sudah ada)
CREATE OR REPLACE FUNCTION public.reopen_uas_prep_revision_secure(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_sub RECORD;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR NOT public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    IF length(trim(COALESCE(p_reason, ''))) < 5 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Alasan revisi wajib diisi minimal 5 karakter.');
    END IF;

    SELECT * INTO v_sub FROM public.exam_uas_prep_submissions WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Data pengajuan tidak ditemukan.');
    END IF;

    UPDATE public.exam_uas_prep_submissions
    SET status = 'draft', revision_number = revision_number + 1, updated_at = now()
    WHERE id = v_sub.id;

    UPDATE public.exam_material_parts
    SET teacher_status = 'teacher_verified', approval_status = 'draft', revision_number = revision_number + 1, updated_at = now()
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status != 'excluded';

    -- Buka kunci hanya sesi yang belum memiliki attempt ujian
    UPDATE public.exam_uas_sessions
    SET is_locked = false, approval_status = 'draft', revision_number = revision_number + 1, updated_at = now()
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND attempt_id IS NULL;

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        p_period_id, p_student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        'create_revision', v_sub.id, trim(p_reason)
    );

    RETURN jsonb_build_object('success', true, 'revisionNumber', v_sub.revision_number + 1);
END;
$function$;

-- 14. Admin Bulk Approve / Reject Pengajuan (Idempoten, validasi ulang di server per santri)
CREATE OR REPLACE FUNCTION public.admin_bulk_decide_uas_prep_secure(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_ids jsonb,
    p_decision text, -- 'approve' | 'approve_manual_exception' | 'reject'
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
    v_sid TEXT;
    v_sub RECORD;
    v_has_db_anomaly BOOLEAN;
    v_bad_part_cnt INT;
    v_approved_cnt INT := 0;
    v_skipped_cnt INT := 0;
    v_failed_cnt INT := 0;
    v_already_cnt INT := 0;
    v_results jsonb := '[]'::jsonb;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang dapat menyetujui atau menolak pengajuan.');
    END IF;

    IF p_decision NOT IN ('approve', 'approve_manual_exception', 'reject') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Keputusan tidak valid.');
    END IF;

    IF p_decision = 'reject' AND length(trim(COALESCE(p_reason, ''))) < 5 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Alasan penolakan wajib diisi minimal 5 karakter.');
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id;

    FOR v_sid IN SELECT jsonb_array_elements_text(COALESCE(p_student_ids, '[]'::jsonb)) LOOP
        SELECT * INTO v_sub FROM public.exam_uas_prep_submissions WHERE exam_period_id = p_period_id AND student_id = v_sid;
        IF NOT FOUND THEN
            v_skipped_cnt := v_skipped_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'outcome', 'skipped', 'reason', 'Belum diajukan oleh guru.');
            CONTINUE;
        END IF;

        IF p_decision = 'reject' THEN
            UPDATE public.exam_uas_prep_submissions
            SET status = 'rejected', rejected_reason = trim(p_reason), updated_at = now()
            WHERE id = v_sub.id;

            UPDATE public.exam_material_parts
            SET teacher_status = 'needs_correction', approval_status = 'rejected', rejected_reason = trim(p_reason), updated_at = now()
            WHERE exam_period_id = p_period_id AND student_id = v_sid AND status != 'excluded';

            UPDATE public.exam_uas_sessions
            SET approval_status = 'rejected', rejected_reason = trim(p_reason), is_locked = false, updated_at = now()
            WHERE exam_period_id = p_period_id AND student_id = v_sid AND attempt_id IS NULL;

            INSERT INTO public.exam_uas_prep_audit_logs (
                id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason
            ) VALUES (
                'aud_' || md5(random()::text || clock_timestamp()::text),
                p_period_id, v_sid, v_auth.out_user_id, v_auth.out_name, v_auth.out_role, 'admin_reject', v_sub.id, trim(p_reason)
            );

            v_approved_cnt := v_approved_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'rejected', 'reason', trim(p_reason));
            CONTINUE;
        END IF;

        -- Idempotency check
        IF v_sub.status = 'admin_approved' THEN
            v_already_cnt := v_already_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'already_approved', 'reason', 'Sudah disetujui sebelumnya.');
            CONTINUE;
        END IF;

        -- Blokir persetujuan massal otomatis untuk status bermasalah / pengecualian
        IF p_decision = 'approve' AND v_sub.status != 'pending_admin_approval' THEN
            v_skipped_cnt := v_skipped_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'skipped', 'reason', 'Status "' || v_sub.status || '" tidak memenuhi syarat persetujuan massal.');
            CONTINUE;
        END IF;

        -- Re-validasi server ke public.records
        SELECT EXISTS (
            SELECT 1 FROM public.records r
            WHERE r.student_id = v_sid
              AND r.type IN ('sabaq', 'ziyadah')
              AND (v_period.material_cutoff_date IS NULL OR r.date::date <= v_period.material_cutoff_date::date)
              AND (
                  (COALESCE(r.ayah_start, 0) > COALESCE(r.ayah_end, 0) AND COALESCE(r.ayah_end, 0) > 0)
                  OR COALESCE(r.ayah_end, 0) > public._uas_surah_max_ayah(r.surah)
              )
        ) INTO v_has_db_anomaly;

        IF v_has_db_anomaly AND p_decision = 'approve' THEN
            v_failed_cnt := v_failed_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'failed', 'reason', 'Ditemukan ayat tidak valid pada tabel setoran sumber.');
            CONTINUE;
        END IF;

        SELECT count(*)::int INTO v_bad_part_cnt
        FROM public.exam_material_parts p
        WHERE p.exam_period_id = p_period_id AND p.student_id = v_sid
          AND p.status IN ('needs_review', 'needs_admin_decision');

        IF v_bad_part_cnt > 0 AND p_decision = 'approve' THEN
            v_skipped_cnt := v_skipped_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'skipped', 'reason', 'Masih terdapat ' || v_bad_part_cnt || ' bagian juz berstatus review/keputusan.');
            CONTINUE;
        END IF;

        -- Approve & lock
        UPDATE public.exam_uas_prep_submissions
        SET status = 'admin_approved', approved_by = v_auth.out_user_id, approved_by_name = v_auth.out_name, approved_at = now(), updated_at = now()
        WHERE id = v_sub.id;

        UPDATE public.exam_material_parts
        SET status = 'finalized', teacher_status = 'admin_approved', approval_status = 'admin_approved',
            finalized_by = v_auth.out_user_id, finalized_at = now(),
            approved_by = v_auth.out_user_id, approved_at = now(), updated_at = now()
        WHERE exam_period_id = p_period_id AND student_id = v_sid AND status != 'excluded';

        UPDATE public.exam_uas_sessions
        SET approval_status = 'admin_approved', is_locked = true,
            approved_by = v_auth.out_user_id, approved_at = now(), updated_at = now()
        WHERE exam_period_id = p_period_id AND student_id = v_sid;

        INSERT INTO public.exam_uas_prep_audit_logs (
            id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
        ) VALUES (
            'aud_' || md5(random()::text || clock_timestamp()::text),
            p_period_id, v_sid, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
            'admin_bulk_approve', v_sub.id, p_reason, jsonb_build_object('decision', p_decision)
        );

        v_approved_cnt := v_approved_cnt + 1;
        v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'approved', 'reason', 'Disetujui & difinalisasi.');
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'approvedCount', v_approved_cnt,
        'alreadyApprovedCount', v_already_cnt,
        'skippedCount', v_skipped_cnt,
        'failedCount', v_failed_cnt,
        'results', v_results
    );
END;
$function$;

-- 15. Baca Audit Log Persiapan Materi & Persetujuan
CREATE OR REPLACE FUNCTION public.get_uas_prep_audit_logs_secure(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_logs jsonb;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role NOT IN ('admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(l) ORDER BY l.created_at DESC), '[]'::jsonb)
    INTO v_logs
    FROM public.exam_uas_prep_audit_logs l
    WHERE l.exam_period_id = p_period_id
      AND (p_student_id IS NULL OR l.student_id = p_student_id)
      AND (
          v_auth.out_role = 'admin'
          OR EXISTS (SELECT 1 FROM public.students st WHERE st.id = l.student_id AND st.teacher_id = v_auth.out_user_id)
      );

    RETURN jsonb_build_object('success', true, 'logs', v_logs);
END;
$function$;
