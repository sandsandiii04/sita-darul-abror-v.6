-- ============================================================================
-- SITA DARUL ABROR — ADDITIVE PATCH: GURU HALAQAH MANUAL AUTHORITY &
-- FLEXIBLE MULTI-SESSION UAS PREPARATION
-- Safe, idempotent, additive only. Does NOT re-run historical migrations.
-- Explicitly separates:
--   1. App deposit evidence (public.records -> evidence_ratio, evidence_differs)
--   2. Guru Halaqah manual declaration (manual_confirmation, verification_notes,
--      selected_material, source='manual_teacher')
--   3. Admin approval & audit trail
-- ============================================================================

-- 1. Additive columns on exam_material_parts
ALTER TABLE public.exam_material_parts
    ADD COLUMN IF NOT EXISTS manual_confirmation BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS verification_notes TEXT,
    ADD COLUMN IF NOT EXISTS evidence_ratio NUMERIC,
    ADD COLUMN IF NOT EXISTS evidence_differs BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'auto',
    ADD COLUMN IF NOT EXISTS selected_material JSONB;

-- 2. Additive columns on exam_uas_prep_submissions
ALTER TABLE public.exam_uas_prep_submissions
    ADD COLUMN IF NOT EXISTS has_manual_override BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS manual_confirmation BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS verification_notes TEXT,
    ADD COLUMN IF NOT EXISTS evidence_summary JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3. Update upsert_uas_manual_part_secure:
--    - Keeps strict structural guards (valid Juz 1..30, Surah 1..114, Ayah bounds,
--      non-empty pages, locked/attempt/question_set protection, halaqah isolation).
--    - Computes app deposit evidence as a recorded reference (evidence_ratio, evidence_differs)
--      WITHOUT blocking Guru/Admin when manual_confirmation = true + verification_notes >= 5 chars.
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
    v_ev RECORD;
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
    v_manual_conf BOOLEAN;
    v_verif_notes TEXT;
    v_evidence_differs BOOLEAN := false;
    v_source TEXT;
    v_selected_material jsonb;
    v_eff_status TEXT;
    v_eff_teacher_status TEXT;
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
    v_manual_conf := COALESCE((p_part->>'manualConfirmation')::boolean, false);
    v_verif_notes := NULLIF(trim(COALESCE(p_part->>'verificationNotes', p_reason, '')), '');

    -- Hard structural validation (NEVER relaxed)
    IF v_juz IS NULL OR v_juz < 1 OR v_juz > 30 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nomor juz harus antara 1 dan 30.');
    END IF;
    IF v_part_type NOT IN ('full_juz', 'partial_half', 'minor_addition') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Jenis bagian materi tidak valid.');
    END IF;
    IF v_start_surah IS NULL OR v_end_surah IS NULL OR v_start_surah < 1 OR v_end_surah > 114 OR v_start_surah > v_end_surah THEN
        RETURN jsonb_build_object('success', false, 'message', 'Rentang surah tidak valid (harus antara 1 dan 114).');
    END IF;
    IF v_start_ayah IS NULL OR v_end_ayah IS NULL
       OR v_start_ayah < 1 OR v_end_ayah < 1
       OR v_start_ayah > public._uas_surah_num_max_ayah(v_start_surah)
       OR v_end_ayah > public._uas_surah_num_max_ayah(v_end_surah)
       OR (v_start_surah = v_end_surah AND v_start_ayah > v_end_ayah) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Rentang ayat melebihi batas surah atau terbalik.');
    END IF;
    IF v_cov_count <= 0 OR v_cov_ratio <= 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Cakupan halaman Mushaf tidak boleh kosong.');
    END IF;

    -- Proteksi sesi yang sudah memiliki paket soal, attempt, atau sedang/sudah ujian
    SELECT EXISTS (
        SELECT 1 FROM public.exam_uas_sessions s
        WHERE s.primary_part_id = v_part_id AND s.status != 'void'
          AND (s.attempt_id IS NOT NULL OR s.question_set_id IS NOT NULL OR s.status IN ('in_progress', 'submitted'))
    ) INTO v_has_locked_session;
    IF v_has_locked_session THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bagian materi sudah terikat pada paket soal/attempt ujian dan tidak dapat diubah secara destruktif.');
    END IF;

    -- Hitung bukti setoran aplikasi sebagai pembanding (TIDAK mengubah records asli)
    SELECT * INTO v_ev FROM public._uas_compute_juz_evidence(p_student_id, p_period_id, v_juz);

    v_evidence_differs := (
        (v_part_type = 'full_juz' AND NOT COALESCE(v_ev.is_full_evidenced, false))
        OR (v_part_type = 'partial_half' AND (COALESCE(v_ev.covered_ayahs, 0) <= 0 OR COALESCE(v_ev.evidence_ratio, 0) < 0.30))
        OR COALESCE(v_ev.has_juz_anomaly, false)
    );

    -- Jika berbeda dengan catatan setoran aplikasi, wajib ada konfirmasi manual + catatan singkat
    IF v_evidence_differs THEN
        IF NOT v_manual_conf THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Catatan setoran aplikasi berbeda dengan materi Juz ' || v_juz || ' yang ditetapkan. Centang "Tetapkan Sesuai Pemeriksaan Guru" dan isi catatan singkat untuk melanjutkan.'
            );
        END IF;
        IF length(COALESCE(v_verif_notes, '')) < 5 THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Catatan singkat perbedaan materi wajib diisi minimal 5 karakter.'
            );
        END IF;
    END IF;

    v_source := CASE WHEN v_auth.out_role = 'admin' THEN 'manual_admin' ELSE 'manual_teacher' END;
    v_eff_status := CASE
        WHEN v_manual_conf THEN 'ready'
        WHEN v_has_gap THEN 'needs_review'
        WHEN v_part_type = 'full_juz' AND v_cov_ratio >= 1 THEN 'ready'
        WHEN v_cov_ratio >= 0.5 THEN 'ready'
        ELSE 'needs_admin_decision'
    END;
    v_eff_teacher_status := CASE WHEN v_manual_conf THEN 'teacher_verified' ELSE 'draft_manual' END;

    v_selected_material := jsonb_build_object(
        'juzNumber', v_juz,
        'partType', v_part_type,
        'startSurah', v_start_surah,
        'startAyah', v_start_ayah,
        'endSurah', v_end_surah,
        'endAyah', v_end_ayah,
        'startPage', v_start_page,
        'endPage', v_end_page,
        'coveredPagesCount', v_cov_count,
        'juzTotalPages', v_juz_total,
        'coverageRatio', v_cov_ratio
    );

    INSERT INTO public.exam_material_parts (
        id, exam_period_id, student_id, part_order, juz_number, part_type,
        start_surah, start_ayah, end_surah, end_ayah,
        start_page, end_page, covered_pages, covered_pages_count,
        juz_total_pages, coverage_ratio, segments, has_gap,
        status, teacher_status, approval_status, review_reason,
        manual_confirmation, verification_notes, evidence_ratio, evidence_differs,
        source, selected_material, verified_by, verified_at, updated_at
    ) VALUES (
        v_part_id, p_period_id, p_student_id, COALESCE((p_part->>'partOrder')::int, 1), v_juz, v_part_type,
        v_start_surah, v_start_ayah, v_end_surah, v_end_ayah,
        v_start_page, v_end_page, v_covered_pages, v_cov_count,
        v_juz_total, v_cov_ratio, v_segments, CASE WHEN v_manual_conf THEN false ELSE v_has_gap END,
        v_eff_status, v_eff_teacher_status, 'draft',
        COALESCE(v_verif_notes, 'Penetapan materi manual Guru Halaqah'),
        v_manual_conf, v_verif_notes, COALESCE(v_ev.evidence_ratio, 0), v_evidence_differs,
        v_source, v_selected_material,
        CASE WHEN v_manual_conf THEN v_auth.out_user_id ELSE NULL END,
        CASE WHEN v_manual_conf THEN now() ELSE NULL END,
        now()
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
        teacher_status = EXCLUDED.teacher_status,
        approval_status = 'draft',
        review_reason = EXCLUDED.review_reason,
        manual_confirmation = EXCLUDED.manual_confirmation,
        verification_notes = EXCLUDED.verification_notes,
        evidence_ratio = EXCLUDED.evidence_ratio,
        evidence_differs = EXCLUDED.evidence_differs,
        source = EXCLUDED.source,
        selected_material = EXCLUDED.selected_material,
        verified_by = EXCLUDED.verified_by,
        verified_at = EXCLUDED.verified_at,
        revision_number = COALESCE(public.exam_material_parts.revision_number, 1) + 1,
        updated_at = now();

    -- Invalidate pending submission when material is edited
    IF v_sub.id IS NOT NULL AND v_sub.status IN ('pending_admin_approval', 'exception_pending', 'admin_approved') THEN
        UPDATE public.exam_uas_prep_submissions
        SET status = 'draft', updated_at = now()
        WHERE id = v_sub.id;
    END IF;

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        p_period_id, p_student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        CASE WHEN v_auth.out_role = 'admin' THEN 'admin_manual_part_upsert' ELSE 'teacher_manual_part_upsert' END,
        v_part_id, COALESCE(v_verif_notes, 'Penetapan materi manual'),
        jsonb_build_object(
            'juzNumber', v_juz,
            'partType', v_part_type,
            'coverageRatio', v_cov_ratio,
            'evidenceRatio', COALESCE(v_ev.evidence_ratio, 0),
            'evidenceDiffers', v_evidence_differs,
            'manualConfirmation', v_manual_conf,
            'source', v_source
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'partId', v_part_id,
        'status', v_eff_status,
        'teacherStatus', v_eff_teacher_status,
        'evidenceRatio', COALESCE(v_ev.evidence_ratio, 0),
        'evidenceDiffers', v_evidence_differs
    );
END;
$function$;

-- 4. Update upsert_uas_manual_session_secure:
--    - Allows Guru/Admin manual sessions backed by manual_confirmation = true even when records < 100%.
--    - Allows splitting one Juz into multiple sessions when page/surah ranges are explicitly distinct (non-overlapping),
--      while still blocking accidental duplicate sessions on identical ranges.
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
    v_ev RECORD;
    v_existing RECORD;
    v_sub RECORD;
    v_sess_id TEXT;
    v_sess_num INT;
    v_sess_type TEXT;
    v_primary_part_id TEXT;
    v_start_surah INT;
    v_start_ayah INT;
    v_end_surah INT;
    v_end_ayah INT;
    v_start_page INT;
    v_end_page INT;
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

    v_start_surah := COALESCE((p_session->>'startSurah')::int, v_part.start_surah);
    v_start_ayah  := COALESCE((p_session->>'startAyah')::int, v_part.start_ayah);
    v_end_surah   := COALESCE((p_session->>'endSurah')::int, v_part.end_surah);
    v_end_ayah    := COALESCE((p_session->>'endAyah')::int, v_part.end_ayah);
    v_start_page  := COALESCE((p_session->>'startPage')::int, v_part.start_page);
    v_end_page    := COALESCE((p_session->>'endPage')::int, v_part.end_page);

    -- Hard structural surah/ayah validation
    IF v_start_surah < 1 OR v_end_surah > 114 OR v_start_surah > v_end_surah
       OR v_start_ayah < 1 OR v_end_ayah < 1
       OR v_start_ayah > public._uas_surah_num_max_ayah(v_start_surah)
       OR v_end_ayah > public._uas_surah_num_max_ayah(v_end_surah)
       OR (v_start_surah = v_end_surah AND v_start_ayah > v_end_ayah) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Rentang surah atau ayat pada sesi tidak valid.');
    END IF;

    SELECT * INTO v_ev FROM public._uas_compute_juz_evidence(p_student_id, p_period_id, v_part.juz_number);

    IF v_sess_type = 'full_juz' THEN
        IF v_part.part_type != 'full_juz' OR COALESCE(v_part.coverage_ratio, 0) < 1 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi 1 Juz Penuh harus menggunakan batas satu juz utuh sesuai Mushaf.');
        END IF;
        IF NOT COALESCE(v_ev.is_full_evidenced, false) AND NOT COALESCE(v_part.manual_confirmation, false) THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Catatan setoran aplikasi untuk Juz ' || v_part.juz_number || ' belum 100%. Centang konfirmasi "Tetapkan Sesuai Pemeriksaan Guru" pada materi Juz ' || v_part.juz_number || ' untuk menetapkan 1 Juz Penuh secara manual.'
            );
        END IF;
    END IF;

    IF v_sess_type = 'partial_half' THEN
        IF NOT COALESCE(v_part.manual_confirmation, false) AND (COALESCE(v_part.coverage_ratio, 0) < 0.5 OR COALESCE(v_ev.covered_ayahs, 0) <= 0) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi Parsial membutuhkan minimal 50% cakupan atau konfirmasi penetapan manual Guru Halaqah.');
        END IF;
    END IF;

    -- Cek duplikasi nomor sesi (abaikan sesi void)
    IF EXISTS (
        SELECT 1 FROM public.exam_uas_sessions s
        WHERE s.exam_period_id = p_period_id AND s.student_id = p_student_id
          AND s.session_number = v_sess_num AND s.id != v_sess_id AND s.status != 'void'
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nomor sesi ' || v_sess_num || ' sudah digunakan pada santri ini.');
    END IF;

    -- Cegah tumpang tindih cakupan ayat pada juz yang sama (abaikan sesi ini sendiri & sesi void)
    IF EXISTS (
        SELECT 1 FROM public.exam_uas_sessions s
        WHERE s.exam_period_id = p_period_id AND s.student_id = p_student_id
          AND s.juz_number = v_part.juz_number AND s.status != 'void' AND s.id != v_sess_id
          AND (v_start_surah * 1000 + v_start_ayah) <= (s.end_surah * 1000 + s.end_ayah)
          AND (v_end_surah * 1000 + v_end_ayah) >= (s.start_surah * 1000 + s.start_ayah)
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Cakupan ayat pada Juz ' || v_part.juz_number || ' tumpang tindih dengan sesi lain yang sudah aktif. Atur rentang ayat yang terpisah agar tidak tumpang tindih.');
    END IF;

    SELECT * INTO v_existing FROM public.exam_uas_sessions WHERE id = v_sess_id;
    IF FOUND THEN
        IF v_existing.attempt_id IS NOT NULL OR v_existing.status IN ('in_progress', 'submitted') THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi yang sudah memiliki attempt/nilai ujian tidak boleh diubah.');
        END IF;
        IF v_existing.question_set_id IS NOT NULL THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi sudah memiliki paket soal. Hapus/regenerasi paket soal melalui Admin terlebih dahulu.');
        END IF;
        IF v_existing.is_locked AND v_auth.out_role != 'admin' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi sudah dikunci oleh Admin.');
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
        v_start_surah, v_start_ayah, v_end_surah, v_end_ayah, v_start_page, v_end_page,
        'manual', v_auth.out_user_id, v_auth.out_name, trim(p_reason), 'draft', 'planned', now()
    )
    ON CONFLICT (id) DO UPDATE SET
        session_number = EXCLUDED.session_number,
        session_type = EXCLUDED.session_type,
        primary_part_id = EXCLUDED.primary_part_id,
        juz_number = EXCLUDED.juz_number,
        covered_pages = EXCLUDED.covered_pages,
        start_surah = EXCLUDED.start_surah,
        start_ayah = EXCLUDED.start_ayah,
        end_surah = EXCLUDED.end_surah,
        end_ayah = EXCLUDED.end_ayah,
        start_page = EXCLUDED.start_page,
        end_page = EXCLUDED.end_page,
        change_reason = EXCLUDED.change_reason,
        approval_status = 'draft',
        status = 'planned',
        updated_at = now();

    IF v_sub.id IS NOT NULL AND v_sub.status IN ('pending_admin_approval', 'exception_pending') THEN
        UPDATE public.exam_uas_prep_submissions
        SET status = 'draft', updated_at = now()
        WHERE id = v_sub.id;
    END IF;

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        p_period_id, p_student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        CASE WHEN v_existing.id IS NULL THEN 'create_manual_session' ELSE 'edit_session' END,
        v_sess_id, trim(p_reason),
        jsonb_build_object(
            'sessionNumber', v_sess_num,
            'sessionType', v_sess_type,
            'juzNumber', v_part.juz_number,
            'manualConfirmation', v_part.manual_confirmation,
            'evidenceRatio', COALESCE(v_ev.evidence_ratio, 0)
        )
    );

    RETURN jsonb_build_object('success', true, 'sessionId', v_sess_id);
END;
$function$;

-- 5. Update submit_uas_prep_for_approval_secure:
--    - Accepts manual-confirmed teacher declarations even when app records differ (<100% or anomaly).
--    - Records explicit evidence_summary, has_manual_override, manual_confirmation, verification_notes
--      on exam_uas_prep_submissions so Admin can review every difference clearly.
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
    v_sess RECORD;
    v_ev RECORD;
    v_unverified_cnt INT;
    v_full_cnt INT;
    v_partial_cnt INT;
    v_manual_cnt INT;
    v_total_cnt INT;
    v_has_manual_override BOOLEAN := false;
    v_has_any_manual_conf BOOLEAN := false;
    v_combined_notes TEXT := '';
    v_evidence_summary jsonb := '[]'::jsonb;
    v_target_status TEXT;
    v_sub_id TEXT := 'sub_' || p_period_id || '_' || p_student_id;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR NOT public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Santri ini bukan binaan halaqah Anda.');
    END IF;

    SELECT * INTO v_student FROM public.students WHERE id = p_student_id;
    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id;

    SELECT count(*)::int INTO v_unverified_cnt
    FROM public.exam_material_parts p
    WHERE p.exam_period_id = p_period_id AND p.student_id = p_student_id
      AND p.status != 'excluded'
      AND p.verified_at IS NULL AND NOT COALESCE(p.manual_confirmation, false);

    IF v_unverified_cnt > 0 AND NOT p_is_exception THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengajuan ditolak: Masih ada ' || v_unverified_cnt || ' bagian juz yang belum diperiksa guru.');
    END IF;

    SELECT
        count(*) FILTER (WHERE session_type = 'full_juz')::int,
        count(*) FILTER (WHERE session_type = 'partial_half')::int,
        count(*) FILTER (WHERE source = 'manual')::int,
        count(*)::int
    INTO v_full_cnt, v_partial_cnt, v_manual_cnt, v_total_cnt
    FROM public.exam_uas_sessions
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status != 'void';

    IF v_total_cnt = 0 AND NOT p_is_exception THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengajuan ditolak: Belum ada sesi UAS aktif yang direncanakan.');
    END IF;

    -- Periksa tiap sesi aktif terhadap bukti setoran aplikasi vs konfirmasi manual Guru
    FOR v_sess IN
        SELECT s.id, s.session_number, s.session_type, s.juz_number, s.primary_part_id,
               p.coverage_ratio, p.has_gap, p.part_type,
               COALESCE(p.manual_confirmation, false) AS manual_confirmation,
               p.verification_notes
        FROM public.exam_uas_sessions s
        JOIN public.exam_material_parts p ON p.id = s.primary_part_id
        WHERE s.exam_period_id = p_period_id AND s.student_id = p_student_id AND s.status != 'void'
        ORDER BY s.session_number
    LOOP
        SELECT * INTO v_ev FROM public._uas_compute_juz_evidence(p_student_id, p_period_id, v_sess.juz_number);

        IF v_sess.manual_confirmation THEN
            v_has_any_manual_conf := true;
            IF v_sess.verification_notes IS NOT NULL AND position(v_sess.verification_notes in v_combined_notes) = 0 THEN
                v_combined_notes := trim(both ' ' from (v_combined_notes || CASE WHEN v_combined_notes = '' THEN '' ELSE ' | ' END || v_sess.verification_notes));
            END IF;
        END IF;

        IF v_sess.session_type = 'full_juz' AND NOT COALESCE(v_ev.is_full_evidenced, false) THEN
            IF NOT v_sess.manual_confirmation AND NOT p_is_exception THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'message', 'Juz ' || v_sess.juz_number || ' berbeda dengan catatan setoran aplikasi (' || round(COALESCE(v_ev.evidence_ratio, 0) * 100)::int || '%). Centang "Tetapkan Sesuai Pemeriksaan Guru" dan isi catatan singkat untuk mengirim ke Admin.'
                );
            END IF;
            v_has_manual_override := true;
        ELSIF v_sess.session_type = 'partial_half' AND (COALESCE(v_ev.covered_ayahs, 0) <= 0 OR COALESCE(v_ev.evidence_ratio, 0) < 0.30 OR COALESCE(v_ev.has_juz_anomaly, false)) THEN
            IF NOT v_sess.manual_confirmation AND NOT p_is_exception THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'message', 'Catatan setoran aplikasi Juz ' || v_sess.juz_number || ' berbeda. Centang "Tetapkan Sesuai Pemeriksaan Guru" dan isi catatan singkat untuk mengirim ke Admin.'
                );
            END IF;
            v_has_manual_override := true;
        ELSIF COALESCE(v_ev.has_juz_anomaly, false) THEN
            v_has_manual_override := true;
        END IF;

        v_evidence_summary := v_evidence_summary || jsonb_build_object(
            'sessionNumber', v_sess.session_number,
            'juzNumber', v_sess.juz_number,
            'sessionType', v_sess.session_type,
            'evidenceRatio', COALESCE(v_ev.evidence_ratio, 0),
            'coveredAyahs', COALESCE(v_ev.covered_ayahs, 0),
            'totalAyahs', COALESCE(v_ev.total_ayahs, 0),
            'hasAnomaly', COALESCE(v_ev.has_juz_anomaly, false),
            'manualConfirmation', v_sess.manual_confirmation,
            'verificationNotes', v_sess.verification_notes
        );
    END LOOP;

    IF p_is_exception AND length(trim(COALESCE(p_exception_reason, ''))) < 5 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Alasan pengecualian wajib diisi minimal 5 karakter.');
    END IF;

    v_target_status := CASE WHEN p_is_exception THEN 'exception_pending' ELSE 'pending_admin_approval' END;

    INSERT INTO public.exam_uas_prep_submissions (
        id, exam_period_id, student_id, teacher_id, teacher_name,
        halaqah, student_name, student_class, status, is_exception, exception_reason,
        full_juz_count, partial_juz_count, manual_session_count, total_session_count,
        has_manual_override, manual_confirmation, verification_notes, evidence_summary,
        submitted_at, updated_at
    ) VALUES (
        v_sub_id, p_period_id, p_student_id, v_auth.out_user_id, v_auth.out_name,
        COALESCE(v_student.halaqah, '-'), COALESCE(v_student.name, p_student_id), COALESCE(v_student.class, '-'),
        v_target_status, p_is_exception, NULLIF(trim(COALESCE(p_exception_reason, '')), ''),
        v_full_cnt, v_partial_cnt, v_manual_cnt, v_total_cnt,
        v_has_manual_override, v_has_any_manual_conf, NULLIF(v_combined_notes, ''), v_evidence_summary,
        now(), now()
    )
    ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
        teacher_id = EXCLUDED.teacher_id,
        teacher_name = EXCLUDED.teacher_name,
        halaqah = EXCLUDED.halaqah,
        student_name = EXCLUDED.student_name,
        student_class = EXCLUDED.student_class,
        status = EXCLUDED.status,
        is_exception = EXCLUDED.is_exception,
        exception_reason = EXCLUDED.exception_reason,
        rejected_reason = NULL,
        full_juz_count = EXCLUDED.full_juz_count,
        partial_juz_count = EXCLUDED.partial_juz_count,
        manual_session_count = EXCLUDED.manual_session_count,
        total_session_count = EXCLUDED.total_session_count,
        has_manual_override = EXCLUDED.has_manual_override,
        manual_confirmation = EXCLUDED.manual_confirmation,
        verification_notes = EXCLUDED.verification_notes,
        evidence_summary = EXCLUDED.evidence_summary,
        revision_number = public.exam_uas_prep_submissions.revision_number + 1,
        submitted_at = now(),
        updated_at = now();

    UPDATE public.exam_material_parts
    SET approval_status = v_target_status, updated_at = now()
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status != 'excluded';

    UPDATE public.exam_uas_sessions
    SET approval_status = v_target_status, updated_at = now()
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status != 'void';

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        p_period_id, p_student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        CASE WHEN v_has_manual_override THEN 'submit_manual_override' ELSE 'submit_for_approval' END,
        v_sub_id, COALESCE(NULLIF(v_combined_notes, ''), p_exception_reason),
        jsonb_build_object(
            'fullCount', v_full_cnt,
            'partialCount', v_partial_cnt,
            'totalCount', v_total_cnt,
            'hasManualOverride', v_has_manual_override
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'submissionId', v_sub_id,
        'status', v_target_status,
        'hasManualOverride', v_has_manual_override
    );
END;
$function$;

-- 6. Update admin_bulk_decide_uas_prep_secure:
--    - Admin can approve BOTH standard submissions AND Guru manual-confirmed submissions
--      (manual_confirmation = true + verification_notes >= 5 chars).
--    - Still rejects unconfirmed stale/spoofed full_juz sessions where evidence < 100% AND manual_confirmation = false.
CREATE OR REPLACE FUNCTION public.admin_bulk_decide_uas_prep_secure(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_ids jsonb,
    p_decision text,
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
    v_sess RECORD;
    v_ev RECORD;
    v_evidence_error TEXT;
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
            UPDATE public.exam_uas_prep_submissions SET status = 'rejected', rejected_reason = trim(p_reason), updated_at = now() WHERE id = v_sub.id;
            UPDATE public.exam_material_parts SET teacher_status = 'needs_correction', approval_status = 'rejected', rejected_reason = trim(p_reason), updated_at = now() WHERE exam_period_id = p_period_id AND student_id = v_sid AND status != 'excluded';
            UPDATE public.exam_uas_sessions SET approval_status = 'rejected', rejected_reason = trim(p_reason), is_locked = false, updated_at = now() WHERE exam_period_id = p_period_id AND student_id = v_sid AND attempt_id IS NULL AND status != 'void';
            INSERT INTO public.exam_uas_prep_audit_logs (id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason)
            VALUES ('aud_' || md5(random()::text || clock_timestamp()::text), p_period_id, v_sid, v_auth.out_user_id, v_auth.out_name, v_auth.out_role, 'admin_reject', v_sub.id, trim(p_reason));
            v_approved_cnt := v_approved_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'rejected', 'reason', trim(p_reason));
            CONTINUE;
        END IF;

        IF v_sub.status = 'admin_approved' THEN
            v_already_cnt := v_already_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'already_approved', 'reason', 'Sudah disetujui sebelumnya.');
            CONTINUE;
        END IF;

        IF p_decision = 'approve' AND v_sub.status NOT IN ('pending_admin_approval', 'exception_pending') THEN
            v_skipped_cnt := v_skipped_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'skipped', 'reason', 'Status "' || v_sub.status || '" tidak memenuhi syarat persetujuan.');
            CONTINUE;
        END IF;

        -- Validasi setiap sesi aktif: izinkan jika terbukti di records ATAU dikonfirmasi manual oleh Guru Halaqah
        v_evidence_error := NULL;
        IF p_decision = 'approve' THEN
            FOR v_sess IN
                SELECT s.id, s.session_number, s.session_type, s.juz_number, s.primary_part_id,
                       p.coverage_ratio, p.part_type,
                       COALESCE(p.manual_confirmation, false) AS manual_confirmation,
                       p.verification_notes
                FROM public.exam_uas_sessions s
                JOIN public.exam_material_parts p ON p.id = s.primary_part_id
                WHERE s.exam_period_id = p_period_id AND s.student_id = v_sid AND s.status != 'void'
            LOOP
                SELECT * INTO v_ev FROM public._uas_compute_juz_evidence(v_sid, p_period_id, v_sess.juz_number);
                IF v_sess.session_type = 'full_juz' AND NOT COALESCE(v_ev.is_full_evidenced, false) THEN
                    IF NOT v_sess.manual_confirmation OR length(trim(COALESCE(v_sess.verification_notes, ''))) < 5 THEN
                        v_evidence_error := 'Juz ' || v_sess.juz_number || ' belum memiliki konfirmasi manual Guru Halaqah atas perbedaan catatan setoran (' || round(COALESCE(v_ev.evidence_ratio, 0) * 100)::int || '%).';
                        EXIT;
                    END IF;
                END IF;
            END LOOP;
        END IF;

        IF v_evidence_error IS NOT NULL THEN
            v_failed_cnt := v_failed_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'failed', 'reason', v_evidence_error);
            CONTINUE;
        END IF;

        UPDATE public.exam_uas_prep_submissions SET status = 'admin_approved', approved_by = v_auth.out_user_id, approved_by_name = v_auth.out_name, approved_at = now(), updated_at = now() WHERE id = v_sub.id;
        UPDATE public.exam_material_parts SET status = 'finalized', teacher_status = 'admin_approved', approval_status = 'admin_approved', finalized_by = v_auth.out_user_id, finalized_at = now(), approved_by = v_auth.out_user_id, approved_at = now(), updated_at = now() WHERE exam_period_id = p_period_id AND student_id = v_sid AND status != 'excluded';
        UPDATE public.exam_uas_sessions SET approval_status = 'admin_approved', is_locked = true, approved_by = v_auth.out_user_id, approved_at = now(), updated_at = now() WHERE exam_period_id = p_period_id AND student_id = v_sid AND status != 'void';

        INSERT INTO public.exam_uas_prep_audit_logs (id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details)
        VALUES (
            'aud_' || md5(random()::text || clock_timestamp()::text),
            p_period_id, v_sid, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
            CASE WHEN COALESCE(v_sub.has_manual_override, false) THEN 'admin_approve_manual_teacher' ELSE 'admin_bulk_approve' END,
            v_sub.id, p_reason,
            jsonb_build_object('decision', p_decision, 'hasManualOverride', COALESCE(v_sub.has_manual_override, false))
        );

        v_approved_cnt := v_approved_cnt + 1;
        v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'approved', 'reason', CASE WHEN COALESCE(v_sub.has_manual_override, false) THEN 'Disetujui (Penetapan Manual Guru).' ELSE 'Disetujui & difinalisasi.' END);
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
