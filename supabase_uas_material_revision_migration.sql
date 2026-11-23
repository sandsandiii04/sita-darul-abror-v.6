-- ============================================================================
-- SITA DARUL ABROR — MIGRASI REVISI MATERI UAS & PENYEMPURNAAN GENERATOR
-- File migrasi terpisah untuk diuji di lokal/staging PostgreSQL.
-- JANGAN JALANKAN DI PRODUKSI SEBELUM PERSETUJUAN ADMIN.
--
-- Cakupan:
-- 1. Tabel public.exam_uas_material_revisions + partial unique index + RLS.
-- 2. RPC request_uas_material_revision_secure (Guru Halaqah / Admin, idempoten).
-- 3. RPC get_uas_material_revisions_secure (Admin semua, Guru hanya halaqahnya, live status).
-- 4. RPC decide_uas_material_revision_secure (Admin-only, atomik, race-safe, 4 kondisi).
-- 5. Penyempurnaan save_uas_session_question_set_secure:
--    - Mengizinkan pemakaian ulang soal Bank Soal antar-santri berbeda.
--    - Memastikan tidak ada duplikasi question_bank_id dalam 1 paket.
--    - Menghubungkan replacement_question_set_id pada revisi yang disetujui.
-- ============================================================================

BEGIN;

-- 1. Tabel Pengajuan Revisi Materi UAS
CREATE TABLE IF NOT EXISTS public.exam_uas_material_revisions (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT UNIQUE,
    exam_period_id TEXT NOT NULL REFERENCES public.exam_periods(id) ON DELETE RESTRICT,
    student_id TEXT NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
    student_name TEXT,
    student_nis TEXT,
    student_class TEXT,
    halaqah TEXT,
    uas_session_id TEXT NOT NULL REFERENCES public.exam_uas_sessions(id) ON DELETE RESTRICT,
    session_number INTEGER NOT NULL,
    old_question_set_id TEXT NULL,
    old_attempt_id TEXT NULL,
    old_approval_status TEXT,
    old_session_status TEXT,
    old_packet_status TEXT NOT NULL DEFAULT 'none' CHECK (old_packet_status IN ('none', 'unused_packet', 'in_progress', 'submitted')),
    old_attempt_status TEXT NOT NULL DEFAULT 'none' CHECK (old_attempt_status IN ('none', 'in_progress', 'submitted')),
    old_material JSONB NOT NULL,
    proposed_material JSONB NOT NULL,
    reason TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    requested_by_name TEXT NOT NULL,
    requested_by_role TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_academic_decision', 'on_hold_in_progress')),
    application_status TEXT NOT NULL DEFAULT 'not_applied' CHECK (application_status IN ('not_applied', 'applied', 'held_in_progress', 'requires_academic_decision', 'rejected')),
    decided_by TEXT NULL,
    decided_by_name TEXT NULL,
    decided_at TIMESTAMPTZ NULL,
    decision_reason TEXT NULL,
    decision_idempotency_key TEXT UNIQUE,
    replacement_question_set_id TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uas_rev_period_status
    ON public.exam_uas_material_revisions (exam_period_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_uas_rev_student
    ON public.exam_uas_material_revisions (exam_period_id, student_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_uas_rev_session
    ON public.exam_uas_material_revisions (uas_session_id, requested_at DESC);

-- Cegah 2 permohonan revisi aktif bersamaan pada sesi yang sama
CREATE UNIQUE INDEX IF NOT EXISTS uq_uas_revision_active_per_session
    ON public.exam_uas_material_revisions (uas_session_id)
    WHERE status IN ('pending', 'on_hold_in_progress');

ALTER TABLE public.exam_uas_material_revisions ENABLE ROW LEVEL SECURITY;

-- Tutup akses langsung tabel via PostgREST; seluruh akses wajib melalui RPC SECURITY DEFINER
REVOKE ALL ON TABLE public.exam_uas_material_revisions FROM PUBLIC, anon, authenticated;

-- 2. RPC: Guru Halaqah / Admin mengajukan revisi materi UAS (tidak langsung mengubah sesi aktif!)
CREATE OR REPLACE FUNCTION public.request_uas_material_revision_secure(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text,
    p_uas_session_id text,
    p_proposed_material jsonb,
    p_reason text,
    p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_sess RECORD;
    v_student RECORD;
    v_existing_idem RECORD;
    v_existing_active RECORD;
    v_attempt RECORD;
    v_has_attempt BOOLEAN := false;
    v_attempt_status TEXT := 'none';
    v_packet_status TEXT := 'none';
    v_rev_id TEXT;
    v_clean_key TEXT;
    v_clean_reason TEXT;
    v_prop_juz INT;
    v_prop_type TEXT;
    v_prop_sess_num INT;
    v_prop_start_s INT;
    v_prop_start_a INT;
    v_prop_end_s INT;
    v_prop_end_a INT;
    v_prop_start_p INT;
    v_prop_end_p INT;
    v_prop_pages JSONB;
    v_old_material JSONB;
    v_normalized_proposed JSONB;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid.');
    END IF;

    -- Hanya Admin atau Guru Halaqah pemilik santri (tolak akun ujian bersama / role lain)
    IF v_auth.out_role NOT IN ('admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Anda tidak berwenang mengajukan revisi materi.');
    END IF;

    IF NOT public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Anda tidak berwenang mengajukan revisi untuk santri ini.');
    END IF;

    v_clean_reason := trim(COALESCE(p_reason, ''));
    IF length(v_clean_reason) < 5 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Alasan revisi wajib diisi (minimal 5 karakter).');
    END IF;

    v_clean_key := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');

    -- Idempotency check (retry setelah timeout / klik ganda)
    IF v_clean_key IS NOT NULL THEN
        SELECT * INTO v_existing_idem
        FROM public.exam_uas_material_revisions
        WHERE idempotency_key = v_clean_key;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'alreadySubmitted', true,
                'revisionId', v_existing_idem.id,
                'status', v_existing_idem.status,
                'message', 'Pengajuan revisi ini sudah tercatat sebelumnya.'
            );
        END IF;
    END IF;

    -- Kunci baris sesi untuk mencegah race condition
    SELECT * INTO v_sess
    FROM public.exam_uas_sessions
    WHERE id = p_uas_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi UAS tidak ditemukan.');
    END IF;

    IF v_sess.exam_period_id != p_period_id OR v_sess.student_id != p_student_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Sesi tidak sesuai dengan periode atau santri yang dipilih.');
    END IF;

    IF v_sess.status = 'void' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi UAS sudah dibatalkan (void) dan tidak dapat diajukan revisi.');
    END IF;

    -- Cegah 2 permohonan revisi aktif pada sesi yang sama
    SELECT * INTO v_existing_active
    FROM public.exam_uas_material_revisions
    WHERE uas_session_id = p_uas_session_id
      AND status IN ('pending', 'on_hold_in_progress')
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'duplicateActive', true,
            'revisionId', v_existing_active.id,
            'message', 'Sudah ada pengajuan revisi aktif untuk sesi ini yang menunggu keputusan Admin.'
        );
    END IF;

    -- Validasi materi usulan
    v_prop_juz := (p_proposed_material->>'juzNumber')::int;
    v_prop_type := COALESCE(p_proposed_material->>'sessionType', v_sess.session_type);
    v_prop_sess_num := COALESCE((p_proposed_material->>'sessionNumber')::int, v_sess.session_number);
    v_prop_start_s := (p_proposed_material->>'startSurah')::int;
    v_prop_start_a := (p_proposed_material->>'startAyah')::int;
    v_prop_end_s := (p_proposed_material->>'endSurah')::int;
    v_prop_end_a := (p_proposed_material->>'endAyah')::int;
    v_prop_start_p := (p_proposed_material->>'startPage')::int;
    v_prop_end_p := (p_proposed_material->>'endPage')::int;
    v_prop_pages := COALESCE(p_proposed_material->'coveredPages', '[]'::jsonb);

    IF v_prop_juz IS NULL OR v_prop_juz < 1 OR v_prop_juz > 30 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Juz usulan harus antara 1 sampai 30.');
    END IF;

    IF v_prop_type NOT IN ('full_juz', 'partial_half') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Jenis sesi usulan harus full_juz atau partial_half.');
    END IF;

    IF v_prop_sess_num < 1 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nomor sesi usulan tidak valid.');
    END IF;

    IF v_prop_start_s IS NULL OR v_prop_end_s IS NULL OR v_prop_start_a IS NULL OR v_prop_end_a IS NULL
       OR v_prop_start_s < 1 OR v_prop_end_s > 114 OR v_prop_start_s > v_prop_end_s
       OR v_prop_start_a < 1 OR v_prop_end_a < 1
       OR (v_prop_start_s = v_prop_end_s AND v_prop_start_a > v_prop_end_a) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Rentang surah dan ayat materi usulan tidak valid.');
    END IF;

    IF jsonb_typeof(v_prop_pages) != 'array' OR jsonb_array_length(v_prop_pages) = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Cakupan halaman materi usulan tidak boleh kosong.');
    END IF;

    -- Pastikan nomor sesi usulan tidak bentrok dengan sesi aktif lain milik santri yang sama
    IF v_prop_sess_num != v_sess.session_number AND EXISTS (
        SELECT 1 FROM public.exam_uas_sessions s
        WHERE s.exam_period_id = p_period_id
          AND s.student_id = p_student_id
          AND s.session_number = v_prop_sess_num
          AND s.id != p_uas_session_id
          AND s.status != 'void'
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nomor sesi ' || v_prop_sess_num || ' sudah digunakan oleh sesi aktif lain.');
    END IF;

    -- Pastikan materi usulan tidak tumpang tindih dengan sesi aktif lain pada juz yang sama
    IF EXISTS (
        SELECT 1 FROM public.exam_uas_sessions s
        WHERE s.exam_period_id = p_period_id
          AND s.student_id = p_student_id
          AND s.juz_number = v_prop_juz
          AND s.id != p_uas_session_id
          AND s.status != 'void'
          AND (v_prop_start_s * 1000 + v_prop_start_a) <= (s.end_surah * 1000 + s.end_ayah)
          AND (v_prop_end_s * 1000 + v_prop_end_a) >= (s.start_surah * 1000 + s.start_ayah)
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Materi usulan pada Juz ' || v_prop_juz || ' tumpang tindih dengan sesi aktif lain milik santri ini.');
    END IF;

    -- Deteksi status attempt & paket saat ini (live)
    SELECT a.* INTO v_attempt
    FROM public.exam_attempts a
    WHERE a.status != 'void'
      AND (
          a.id = v_sess.attempt_id
          OR a.uas_session_id = v_sess.id
          OR (v_sess.question_set_id IS NOT NULL AND a.question_set_id = v_sess.question_set_id)
      )
    ORDER BY CASE WHEN a.status = 'submitted' THEN 1 WHEN a.status = 'in_progress' THEN 2 ELSE 3 END, a.created_at DESC
    LIMIT 1;

    IF FOUND THEN
        v_has_attempt := true;
        v_attempt_status := CASE WHEN v_attempt.status = 'submitted' THEN 'submitted' ELSE 'in_progress' END;
    ELSIF v_sess.status = 'submitted' OR v_sess.score IS NOT NULL THEN
        v_has_attempt := true;
        v_attempt_status := 'submitted';
    ELSIF v_sess.status = 'in_progress' THEN
        v_has_attempt := true;
        v_attempt_status := 'in_progress';
    END IF;

    IF v_attempt_status = 'submitted' THEN
        v_packet_status := 'submitted';
    ELSIF v_attempt_status = 'in_progress' THEN
        v_packet_status := 'in_progress';
    ELSIF v_sess.question_set_id IS NOT NULL THEN
        v_packet_status := 'unused_packet';
    ELSE
        v_packet_status := 'none';
    END IF;

    SELECT * INTO v_student FROM public.students WHERE id = p_student_id;

    v_old_material := jsonb_build_object(
        'sessionNumber', v_sess.session_number,
        'juzNumber', v_sess.juz_number,
        'sessionType', v_sess.session_type,
        'startSurah', v_sess.start_surah,
        'startAyah', v_sess.start_ayah,
        'endSurah', v_sess.end_surah,
        'endAyah', v_sess.end_ayah,
        'startPage', v_sess.start_page,
        'endPage', v_sess.end_page,
        'coveredPages', COALESCE(v_sess.covered_pages, '[]'::jsonb),
        'primaryPartId', v_sess.primary_part_id
    );

    v_normalized_proposed := jsonb_build_object(
        'sessionNumber', v_prop_sess_num,
        'juzNumber', v_prop_juz,
        'sessionType', v_prop_type,
        'startSurah', v_prop_start_s,
        'startAyah', v_prop_start_a,
        'endSurah', v_prop_end_s,
        'endAyah', v_prop_end_a,
        'startPage', COALESCE(v_prop_start_p, v_sess.start_page),
        'endPage', COALESCE(v_prop_end_p, v_sess.end_page),
        'coveredPages', v_prop_pages,
        'primaryPartId', NULLIF(p_proposed_material->>'primaryPartId', '')
    );

    v_rev_id := 'uas_rev_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);

    INSERT INTO public.exam_uas_material_revisions (
        id, idempotency_key, exam_period_id, student_id,
        student_name, student_nis, student_class, halaqah,
        uas_session_id, session_number,
        old_question_set_id, old_attempt_id,
        old_approval_status, old_session_status, old_packet_status, old_attempt_status,
        old_material, proposed_material, reason,
        requested_by, requested_by_name, requested_by_role,
        status, application_status
    ) VALUES (
        v_rev_id, v_clean_key, p_period_id, p_student_id,
        v_student.name, v_student.nis, v_student.class, v_student.halaqah,
        p_uas_session_id, v_sess.session_number,
        v_sess.question_set_id, COALESCE(v_attempt.id, v_sess.attempt_id),
        v_sess.approval_status, v_sess.status, v_packet_status, v_attempt_status,
        v_old_material, v_normalized_proposed, v_clean_reason,
        v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        'pending', 'not_applied'
    );

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        p_period_id, p_student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        'request_uas_material_revision', v_rev_id, v_clean_reason,
        jsonb_build_object(
            'uasSessionId', p_uas_session_id,
            'oldPacketStatus', v_packet_status,
            'oldAttemptStatus', v_attempt_status,
            'oldMaterial', v_old_material,
            'proposedMaterial', v_normalized_proposed
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'revisionId', v_rev_id,
        'status', 'pending',
        'oldPacketStatus', v_packet_status,
        'oldAttemptStatus', v_attempt_status,
        'message', 'Pengajuan revisi materi berhasil dikirim ke Admin. Sesi aktif tetap berlaku sampai Admin memberikan keputusan.'
    );
END;
$function$;

-- 3. RPC: Daftar Pengajuan Revisi Materi UAS (dengan status paket & attempt LIVE)
CREATE OR REPLACE FUNCTION public.get_uas_material_revisions_secure(
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
    v_rows JSONB;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role NOT IN ('admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT COALESCE(jsonb_agg(row_obj ORDER BY requested_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT
            r.requested_at,
            jsonb_build_object(
                'id', r.id,
                'idempotencyKey', r.idempotency_key,
                'examPeriodId', r.exam_period_id,
                'studentId', r.student_id,
                'studentName', COALESCE(s.name, r.student_name),
                'studentNis', COALESCE(s.nis, r.student_nis),
                'studentClass', COALESCE(s.class, r.student_class),
                'halaqah', COALESCE(s.halaqah, r.halaqah),
                'uasSessionId', r.uas_session_id,
                'sessionNumber', r.session_number,
                'oldQuestionSetId', r.old_question_set_id,
                'oldAttemptId', r.old_attempt_id,
                'oldApprovalStatus', r.old_approval_status,
                'oldSessionStatus', r.old_session_status,
                'oldPacketStatus', r.old_packet_status,
                'oldAttemptStatus', r.old_attempt_status,
                'liveSessionStatus', sess.status,
                'liveQuestionSetId', sess.question_set_id,
                'liveAttemptStatus', COALESCE(
                    (
                        SELECT CASE WHEN a.status = 'submitted' THEN 'submitted' ELSE 'in_progress' END
                        FROM public.exam_attempts a
                        WHERE a.status != 'void'
                          AND (
                              a.id = sess.attempt_id
                              OR a.uas_session_id = sess.id
                              OR (sess.question_set_id IS NOT NULL AND a.question_set_id = sess.question_set_id)
                          )
                        ORDER BY CASE WHEN a.status = 'submitted' THEN 1 WHEN a.status = 'in_progress' THEN 2 ELSE 3 END
                        LIMIT 1
                    ),
                    CASE
                        WHEN sess.status = 'submitted' OR sess.score IS NOT NULL THEN 'submitted'
                        WHEN sess.status = 'in_progress' THEN 'in_progress'
                        ELSE 'none'
                    END
                ),
                'livePacketStatus', CASE
                    WHEN EXISTS (
                        SELECT 1 FROM public.exam_attempts a
                        WHERE a.status = 'submitted'
                          AND (a.id = sess.attempt_id OR a.uas_session_id = sess.id OR (sess.question_set_id IS NOT NULL AND a.question_set_id = sess.question_set_id))
                    ) OR sess.status = 'submitted' OR sess.score IS NOT NULL THEN 'submitted'
                    WHEN EXISTS (
                        SELECT 1 FROM public.exam_attempts a
                        WHERE a.status = 'in_progress'
                          AND (a.id = sess.attempt_id OR a.uas_session_id = sess.id OR (sess.question_set_id IS NOT NULL AND a.question_set_id = sess.question_set_id))
                    ) OR sess.status = 'in_progress' THEN 'in_progress'
                    WHEN sess.question_set_id IS NOT NULL THEN 'unused_packet'
                    ELSE 'none'
                END,
                'oldMaterial', r.old_material,
                'proposedMaterial', r.proposed_material,
                'reason', r.reason,
                'requestedBy', r.requested_by,
                'requestedByName', r.requested_by_name,
                'requestedByRole', r.requested_by_role,
                'requestedAt', r.requested_at,
                'status', r.status,
                'applicationStatus', r.application_status,
                'decidedBy', r.decided_by,
                'decidedByName', r.decided_by_name,
                'decidedAt', r.decided_at,
                'decisionReason', r.decision_reason,
                'replacementQuestionSetId', r.replacement_question_set_id,
                'createdAt', r.created_at,
                'updatedAt', r.updated_at
            ) AS row_obj
        FROM public.exam_uas_material_revisions r
        LEFT JOIN public.students s ON s.id = r.student_id
        LEFT JOIN public.exam_uas_sessions sess ON sess.id = r.uas_session_id
        WHERE r.exam_period_id = p_period_id
          AND (p_student_id IS NULL OR r.student_id = p_student_id)
          AND (
              v_auth.out_role = 'admin'
              OR public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, r.student_id)
          )
    ) sub;

    RETURN jsonb_build_object('success', true, 'revisions', v_rows);
END;
$function$;

-- 4. RPC: Keputusan Admin atas Pengajuan Revisi Materi UAS (STRICT ADMIN-ONLY, ATOMIK, 4 KONDISI)
CREATE OR REPLACE FUNCTION public.decide_uas_material_revision_secure(
    p_username text,
    p_password text,
    p_revision_id text,
    p_decision text,
    p_reason text DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_rev RECORD;
    v_sess RECORD;
    v_attempt RECORD;
    v_has_submitted BOOLEAN := false;
    v_has_in_progress BOOLEAN := false;
    v_has_any_assessment BOOLEAN := false;
    v_clean_reason TEXT;
    v_clean_dec_key TEXT;
    v_prop JSONB;
    v_prop_juz INT;
    v_prop_type TEXT;
    v_prop_sess_num INT;
    v_prop_start_s INT;
    v_prop_start_a INT;
    v_prop_end_s INT;
    v_prop_end_a INT;
    v_prop_start_p INT;
    v_prop_end_p INT;
    v_prop_pages JSONB;
    v_target_part_id TEXT;
    v_old_qset_id TEXT;
    v_deactivated_packet BOOLEAN := false;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang dapat memutuskan pengajuan revisi materi UAS.');
    END IF;

    IF p_decision NOT IN ('approve', 'reject', 'mark_academic_decision') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Keputusan tidak valid.');
    END IF;

    -- Serialize concurrent Admin decisions on the same revision
    PERFORM pg_advisory_xact_lock(hashtext('uas_rev:' || p_revision_id));

    SELECT * INTO v_rev
    FROM public.exam_uas_material_revisions
    WHERE id = p_revision_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengajuan revisi tidak ditemukan.');
    END IF;

    v_clean_dec_key := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');

    -- Idempotent replay setelah timeout jaringan untuk Admin yang sama
    IF v_clean_dec_key IS NOT NULL AND v_rev.decision_idempotency_key = v_clean_dec_key THEN
        RETURN jsonb_build_object(
            'success', true,
            'alreadyDecided', true,
            'idempotentReplay', true,
            'status', v_rev.status,
            'applicationStatus', v_rev.application_status,
            'message', 'Keputusan revisi ini sudah tersimpan sebelumnya.'
        );
    END IF;

    -- Cegah keputusan ganda (2 Admin menyetujui bersamaan)
    IF v_rev.status NOT IN ('pending', 'on_hold_in_progress') THEN
        RETURN jsonb_build_object(
            'success', false,
            'alreadyDecided', true,
            'currentStatus', v_rev.status,
            'message', 'Pengajuan revisi ini sudah diproses sebelumnya (' || v_rev.status || ') oleh ' || COALESCE(v_rev.decided_by_name, 'Admin') || '.'
        );
    END IF;

    v_clean_reason := trim(COALESCE(p_reason, ''));

    -- Tolak revisi
    IF p_decision = 'reject' THEN
        IF length(v_clean_reason) < 5 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Alasan penolakan wajib diisi (minimal 5 karakter).');
        END IF;

        UPDATE public.exam_uas_material_revisions
        SET
            status = 'rejected',
            application_status = 'rejected',
            decided_by = v_auth.out_user_id,
            decided_by_name = v_auth.out_name,
            decided_at = now(),
            decision_reason = v_clean_reason,
            decision_idempotency_key = COALESCE(v_clean_dec_key, decision_idempotency_key),
            updated_at = now()
        WHERE id = p_revision_id;

        INSERT INTO public.exam_uas_prep_audit_logs (
            id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
        ) VALUES (
            'aud_' || md5(random()::text || clock_timestamp()::text),
            v_rev.exam_period_id, v_rev.student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
            'reject_uas_material_revision', p_revision_id, v_clean_reason,
            jsonb_build_object('uasSessionId', v_rev.uas_session_id)
        );

        RETURN jsonb_build_object('success', true, 'status', 'rejected', 'message', 'Pengajuan revisi materi ditolak. Sesi aktif tidak diubah.');
    END IF;

    -- Tandai Memerlukan Keputusan Akademik
    IF p_decision = 'mark_academic_decision' THEN
        IF length(v_clean_reason) < 5 THEN
            v_clean_reason := 'Ditandai Admin sebagai Memerlukan Keputusan Akademik khusus.';
        END IF;

        UPDATE public.exam_uas_material_revisions
        SET
            status = 'needs_academic_decision',
            application_status = 'requires_academic_decision',
            decided_by = v_auth.out_user_id,
            decided_by_name = v_auth.out_name,
            decided_at = now(),
            decision_reason = v_clean_reason,
            decision_idempotency_key = COALESCE(v_clean_dec_key, decision_idempotency_key),
            updated_at = now()
        WHERE id = p_revision_id;

        INSERT INTO public.exam_uas_prep_audit_logs (
            id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
        ) VALUES (
            'aud_' || md5(random()::text || clock_timestamp()::text),
            v_rev.exam_period_id, v_rev.student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
            'mark_uas_revision_academic_decision', p_revision_id, v_clean_reason,
            jsonb_build_object('uasSessionId', v_rev.uas_session_id)
        );

        RETURN jsonb_build_object(
            'success', true,
            'status', 'needs_academic_decision',
            'message', 'Pengajuan ditandai sebagai Memerlukan Keputusan Akademik. Data ujian dan nilai historis tetap terlindungi.'
        );
    END IF;

    -- ========================================================================
    -- APPROVE FLOW: Serialisasi penuh dengan start_uas_session_attempt!
    -- Kunci advisory lock yang sama + row lock FOR UPDATE agar jika attempt
    -- baru dimulai di tengah proses persetujuan, revisi ditahan secara atomik.
    -- ========================================================================
    PERFORM pg_advisory_xact_lock(hashtext('start_uas_session:' || v_rev.uas_session_id));

    SELECT * INTO v_sess
    FROM public.exam_uas_sessions
    WHERE id = v_rev.uas_session_id
    FOR UPDATE;

    IF NOT FOUND OR v_sess.status = 'void' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi UAS target tidak ditemukan atau sudah void.');
    END IF;

    v_old_qset_id := v_sess.question_set_id;

    -- Cek LIVE seluruh attempt & penilaian terkait sesi atau paket lama
    SELECT EXISTS (
        SELECT 1 FROM public.exam_attempts a
        WHERE a.status = 'submitted'
          AND (
              a.id = v_sess.attempt_id
              OR a.uas_session_id = v_sess.id
              OR (v_old_qset_id IS NOT NULL AND a.question_set_id = v_old_qset_id)
          )
    ) OR v_sess.status = 'submitted' OR v_sess.score IS NOT NULL
    INTO v_has_submitted;

    SELECT EXISTS (
        SELECT 1 FROM public.exam_attempts a
        WHERE a.status = 'in_progress'
          AND (
              a.id = v_sess.attempt_id
              OR a.uas_session_id = v_sess.id
              OR (v_old_qset_id IS NOT NULL AND a.question_set_id = v_old_qset_id)
          )
    ) OR v_sess.status = 'in_progress'
    INTO v_has_in_progress;

    SELECT EXISTS (
        SELECT 1
        FROM public.exam_question_assessments qa
        JOIN public.exam_attempts a ON a.id = qa.attempt_id
        WHERE a.status != 'void'
          AND (
              a.id = v_sess.attempt_id
              OR a.uas_session_id = v_sess.id
              OR (v_old_qset_id IS NOT NULL AND a.question_set_id = v_old_qset_id)
          )
    ) INTO v_has_any_assessment;

    -- KONDISI 4: UJIAN SUDAH SUBMITTED / SUDAH BERNILAI -> TOLAK PERUBAHAN OTOMATIS!
    IF v_has_submitted THEN
        UPDATE public.exam_uas_material_revisions
        SET
            status = 'needs_academic_decision',
            application_status = 'requires_academic_decision',
            old_question_set_id = COALESCE(old_question_set_id, v_old_qset_id),
            old_packet_status = 'submitted',
            old_attempt_status = 'submitted',
            decided_by = v_auth.out_user_id,
            decided_by_name = v_auth.out_name,
            decided_at = now(),
            decision_reason = COALESCE(NULLIF(v_clean_reason, ''), 'Otomatis ditahan: ujian sudah disubmit/bernilai. Memerlukan Keputusan Akademik.'),
            updated_at = now()
        WHERE id = p_revision_id;

        INSERT INTO public.exam_uas_prep_audit_logs (
            id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
        ) VALUES (
            'aud_' || md5(random()::text || clock_timestamp()::text),
            v_rev.exam_period_id, v_rev.student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
            'hold_uas_revision_submitted', p_revision_id,
            'Ujian sudah disubmit/bernilai; ditandai Memerlukan Keputusan Akademik.',
            jsonb_build_object('uasSessionId', v_sess.id, 'oldQuestionSetId', v_old_qset_id)
        );

        RETURN jsonb_build_object(
            'success', false,
            'blockedCondition', 'submitted',
            'status', 'needs_academic_decision',
            'message', 'Memerlukan Keputusan Akademik: Ujian sudah disubmit/bernilai. Materi, soal, penguji, dan nilai historis tetap terlindungi tanpa perubahan otomatis.'
        );
    END IF;

    -- KONDISI 3: UJIAN SEDANG BERJALAN (IN_PROGRESS) -> TAHAN PERUBAHAN OTOMATIS!
    IF v_has_in_progress OR v_has_any_assessment THEN
        UPDATE public.exam_uas_material_revisions
        SET
            status = 'on_hold_in_progress',
            application_status = 'held_in_progress',
            old_question_set_id = COALESCE(old_question_set_id, v_old_qset_id),
            old_packet_status = 'in_progress',
            old_attempt_status = 'in_progress',
            decision_reason = COALESCE(NULLIF(v_clean_reason, ''), 'Ditahan: ujian sedang berlangsung.'),
            updated_at = now()
        WHERE id = p_revision_id;

        INSERT INTO public.exam_uas_prep_audit_logs (
            id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
        ) VALUES (
            'aud_' || md5(random()::text || clock_timestamp()::text),
            v_rev.exam_period_id, v_rev.student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
            'hold_uas_revision_in_progress', p_revision_id,
            'Revisi ditahan karena ujian sedang berlangsung.',
            jsonb_build_object('uasSessionId', v_sess.id, 'oldQuestionSetId', v_old_qset_id)
        );

        RETURN jsonb_build_object(
            'success', false,
            'blockedCondition', 'in_progress',
            'status', 'on_hold_in_progress',
            'message', 'Revisi membutuhkan penanganan Admin karena ujian sedang berlangsung. Sesi dan paket aktif tidak diubah.'
        );
    END IF;

    -- ========================================================================
    -- KONDISI 1 (Approved, belum ada paket) & KONDISI 2 (Paket belum dipakai)
    -- ========================================================================
    v_prop := v_rev.proposed_material;
    v_prop_juz := (v_prop->>'juzNumber')::int;
    v_prop_type := v_prop->>'sessionType';
    v_prop_sess_num := COALESCE((v_prop->>'sessionNumber')::int, v_sess.session_number);
    v_prop_start_s := (v_prop->>'startSurah')::int;
    v_prop_start_a := (v_prop->>'startAyah')::int;
    v_prop_end_s := (v_prop->>'endSurah')::int;
    v_prop_end_a := (v_prop->>'endAyah')::int;
    v_prop_start_p := (v_prop->>'startPage')::int;
    v_prop_end_p := (v_prop->>'endPage')::int;
    v_prop_pages := COALESCE(v_prop->'coveredPages', '[]'::jsonb);

    -- Validasi ulang tidak ada bentrok nomor sesi atau overlap juz dengan sesi aktif lain
    IF v_prop_sess_num != v_sess.session_number AND EXISTS (
        SELECT 1 FROM public.exam_uas_sessions s
        WHERE s.exam_period_id = v_sess.exam_period_id
          AND s.student_id = v_sess.student_id
          AND s.session_number = v_prop_sess_num
          AND s.id != v_sess.id
          AND s.status != 'void'
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nomor sesi usulan (' || v_prop_sess_num || ') bentrok dengan sesi aktif lain.');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.exam_uas_sessions s
        WHERE s.exam_period_id = v_sess.exam_period_id
          AND s.student_id = v_sess.student_id
          AND s.juz_number = v_prop_juz
          AND s.id != v_sess.id
          AND s.status != 'void'
          AND (v_prop_start_s * 1000 + v_prop_start_a) <= (s.end_surah * 1000 + s.end_ayah)
          AND (v_prop_end_s * 1000 + v_prop_end_a) >= (s.start_surah * 1000 + s.start_ayah)
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Materi usulan pada Juz ' || v_prop_juz || ' tumpang tindih dengan sesi aktif lain.');
    END IF;

    -- KONDISI 2: Jika ada paket lama yang belum pernah dipakai, nonaktifkan dengan status 'stale' (TANPA DELETE & tanpa menyentuh paket void!)
    IF v_old_qset_id IS NOT NULL THEN
        UPDATE public.exam_question_sets
        SET status = 'stale', updated_at = now()
        WHERE id = v_old_qset_id
          AND status NOT IN ('stale', 'void');
        v_deactivated_packet := true;
    END IF;

    -- Pastikan exam_material_parts untuk juz usulan tersedia & berstatus finalized
    SELECT id INTO v_target_part_id
    FROM public.exam_material_parts
    WHERE exam_period_id = v_sess.exam_period_id
      AND student_id = v_sess.student_id
      AND juz_number = v_prop_juz
    ORDER BY part_order ASC
    LIMIT 1;

    IF v_target_part_id IS NULL THEN
        v_target_part_id := 'emp_' || v_sess.exam_period_id || '_' || v_sess.student_id || '_j' || v_prop_juz::text || '_rev';
        INSERT INTO public.exam_material_parts (
            id, exam_period_id, student_id, part_order, juz_number, part_type,
            start_surah, start_ayah, end_surah, end_ayah, start_page, end_page,
            covered_pages, covered_pages_count, juz_total_pages, coverage_ratio,
            has_gap, status, finalized_by, finalized_at, updated_at
        ) VALUES (
            v_target_part_id, v_sess.exam_period_id, v_sess.student_id, 1, v_prop_juz, v_prop_type,
            v_prop_start_s, v_prop_start_a, v_prop_end_s, v_prop_end_a, v_prop_start_p, v_prop_end_p,
            v_prop_pages, jsonb_array_length(v_prop_pages),
            CASE WHEN v_prop_juz = 30 THEN 23 ELSE 20 END,
            CASE WHEN v_prop_type = 'full_juz' THEN 1.0 ELSE LEAST(0.99, GREATEST(0.5, jsonb_array_length(v_prop_pages)::numeric / 20.0)) END,
            false, 'finalized', v_auth.out_user_id, now(), now()
        )
        ON CONFLICT (exam_period_id, student_id, juz_number, part_order) DO UPDATE SET
            part_type = EXCLUDED.part_type,
            start_surah = EXCLUDED.start_surah,
            start_ayah = EXCLUDED.start_ayah,
            end_surah = EXCLUDED.end_surah,
            end_ayah = EXCLUDED.end_ayah,
            start_page = EXCLUDED.start_page,
            end_page = EXCLUDED.end_page,
            covered_pages = EXCLUDED.covered_pages,
            covered_pages_count = EXCLUDED.covered_pages_count,
            coverage_ratio = EXCLUDED.coverage_ratio,
            status = 'finalized',
            finalized_by = v_auth.out_user_id,
            finalized_at = now(),
            updated_at = now()
        RETURNING id INTO v_target_part_id;
    ELSE
        UPDATE public.exam_material_parts
        SET
            part_type = v_prop_type,
            start_surah = v_prop_start_s,
            start_ayah = v_prop_start_a,
            end_surah = v_prop_end_s,
            end_ayah = v_prop_end_a,
            start_page = v_prop_start_p,
            end_page = v_prop_end_p,
            covered_pages = v_prop_pages,
            covered_pages_count = jsonb_array_length(v_prop_pages),
            coverage_ratio = CASE WHEN v_prop_type = 'full_juz' THEN 1.0 ELSE LEAST(0.99, GREATEST(0.5, jsonb_array_length(v_prop_pages)::numeric / 20.0)) END,
            status = 'finalized',
            finalized_by = v_auth.out_user_id,
            finalized_at = now(),
            updated_at = now()
        WHERE id = v_target_part_id;
    END IF;

    -- Terapkan materi baru ke sesi secara atomik (TIDAK otomatis generate paket pengganti!)
    UPDATE public.exam_uas_sessions
    SET
        session_number = v_prop_sess_num,
        session_type = v_prop_type,
        primary_part_id = v_target_part_id,
        juz_number = v_prop_juz,
        covered_pages = v_prop_pages,
        start_surah = v_prop_start_s,
        start_ayah = v_prop_start_a,
        end_surah = v_prop_end_s,
        end_ayah = v_prop_end_a,
        start_page = v_prop_start_p,
        end_page = v_prop_end_p,
        question_set_id = NULL,
        status = 'planned',
        approval_status = 'admin_approved',
        revision_number = COALESCE(revision_number, 1) + 1,
        change_reason = 'Revisi disetujui Admin (' || v_auth.out_name || '): ' || COALESCE(NULLIF(v_clean_reason, ''), v_rev.reason),
        updated_at = now()
    WHERE id = v_sess.id;

    -- Update status pengajuan revisi
    UPDATE public.exam_uas_material_revisions
    SET
        status = 'approved',
        application_status = 'applied',
        old_question_set_id = COALESCE(old_question_set_id, v_old_qset_id),
        old_packet_status = CASE WHEN v_deactivated_packet THEN 'unused_packet' ELSE 'none' END,
        old_attempt_status = 'none',
        decided_by = v_auth.out_user_id,
        decided_by_name = v_auth.out_name,
        decided_at = now(),
        decision_reason = COALESCE(NULLIF(v_clean_reason, ''), 'Revisi disetujui dan diterapkan oleh Admin.'),
        decision_idempotency_key = COALESCE(v_clean_dec_key, decision_idempotency_key),
        updated_at = now()
    WHERE id = p_revision_id;

    -- Catat audit trail lengkap
    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        v_rev.exam_period_id, v_rev.student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        'approve_uas_material_revision', p_revision_id,
        COALESCE(NULLIF(v_clean_reason, ''), 'Revisi materi disetujui Admin'),
        jsonb_build_object(
            'uasSessionId', v_sess.id,
            'deactivatedOldPacket', v_deactivated_packet,
            'oldQuestionSetId', v_old_qset_id,
            'oldMaterial', v_rev.old_material,
            'newMaterial', v_prop
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'status', 'approved',
        'applicationStatus', 'applied',
        'deactivatedOldPacket', v_deactivated_packet,
        'oldQuestionSetId', v_old_qset_id,
        'message', CASE
            WHEN v_deactivated_packet THEN 'Revisi disetujui. Paket soal lama telah dinonaktifkan (stale) sebagai riwayat audit dan materi baru diterapkan. Silakan generate paket pengganti melalui Siapkan Soal UAS.'
            ELSE 'Revisi disetujui dan materi baru berhasil diterapkan. Silakan lanjutkan generate paket soal melalui Siapkan Soal UAS.'
        END
    );
END;
$function$;

-- 5. Penyempurnaan save_uas_session_question_set_secure:
--    - Tetap idempoten & race-safe.
--    - Memastikan tidak ada duplikasi questionBankId di dalam 1 paket.
--    - Menghubungkan replacement_question_set_id pada revisi yang baru disetujui.
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
    v_distinct_qb_cnt INT;
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

    IF v_sess.attempt_id IS NOT NULL
       OR v_sess.status IN ('in_progress', 'submitted')
       OR EXISTS (
           SELECT 1 FROM public.exam_attempts a
           WHERE a.status != 'void'
             AND (
                 a.uas_session_id = v_sess.id
                 OR (v_sess.question_set_id IS NOT NULL AND a.question_set_id = v_sess.question_set_id)
             )
       ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi sudah digunakan dalam ujian/memiliki nilai dan paket soalnya tidak boleh diubah.');
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtext(v_sess.exam_period_id || ':' || v_sess.student_id || ':' || v_sess.session_number::text)
    );

    v_expected_min_q := CASE WHEN v_sess.session_type = 'partial_half' THEN 4 ELSE 7 END;
    v_target_status := CASE WHEN v_sess.session_type = 'partial_half' THEN 'locked' ELSE 'pending_mandatory' END;
    v_fingerprint := COALESCE(p_question_set->>'materialFingerprint', '');

    -- 1. Idempotency check
    IF v_sess.question_set_id IS NOT NULL THEN
        SELECT * INTO v_linked_qs
        FROM public.exam_question_sets
        WHERE id = v_sess.question_set_id;

        IF FOUND
           AND v_linked_qs.status NOT IN ('stale', 'void')
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

    -- 2. Recovery check (abaikan paket stale maupun void)
    SELECT qs.* INTO v_unlinked_qs
    FROM public.exam_question_sets qs
    WHERE qs.uas_session_id = p_uas_session_id
      AND qs.session_type = v_sess.session_type
      AND qs.status NOT IN ('stale', 'void')
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
                status = CASE WHEN v_sess.session_type = 'partial_half' OR v_unlinked_qs.status = 'locked' THEN 'ready' ELSE 'pending_mandatory' END,
                updated_at = now()
            WHERE id = p_uas_session_id;

            UPDATE public.exam_uas_material_revisions
            SET replacement_question_set_id = v_unlinked_qs.id, updated_at = now()
            WHERE id = (
                SELECT r.id
                FROM public.exam_uas_material_revisions r
                WHERE r.uas_session_id = p_uas_session_id
                  AND r.status = 'approved'
                  AND r.application_status = 'applied'
                  AND r.replacement_question_set_id IS NULL
                ORDER BY r.decided_at DESC NULLS LAST, r.updated_at DESC
                LIMIT 1
            );

            RETURN jsonb_build_object(
                'success', true,
                'recovered', true,
                'questionSetId', v_unlinked_qs.id,
                'version', v_unlinked_qs.version,
                'message', 'Paket soal valid yang sudah ada berhasil dihubungkan kembali ke sesi.'
            );
        END IF;
    END IF;

    -- 3. Validate incoming question payload: exact count AND no duplicate random questionBankId within one packet
    --    (hanya memeriksa soal acak Bank Soal; soal wajib manual tidak ikut dihitung sebagai duplikasi Bank Soal)
    v_payload_q_cnt := jsonb_array_length(COALESCE(p_questions, '[]'::jsonb));
    IF v_payload_q_cnt != v_expected_min_q THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Jumlah soal tidak sesuai untuk jenis sesi ini (wajib tepat ' || v_expected_min_q || ' soal acak Bank Soal, diterima ' || v_payload_q_cnt || ').'
        );
    END IF;

    SELECT count(DISTINCT NULLIF(elem->>'questionBankId', ''))::int
    INTO v_distinct_qb_cnt
    FROM jsonb_array_elements(COALESCE(p_questions, '[]'::jsonb)) elem
    WHERE COALESCE(elem->>'questionRole', 'random') = 'random';

    IF v_distinct_qb_cnt != v_expected_min_q THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Dalam satu paket ujian tidak boleh terdapat soal acak Bank Soal duplikat (ditemukan ' || v_distinct_qb_cnt || ' soal unik dari ' || v_expected_min_q || ' soal acak).'
        );
    END IF;

    -- 4. Mark ONLY unused non-void/non-stale sets for this (period, student, session_number) as 'stale' (never deleting, never touching historical void!)
    UPDATE public.exam_question_sets qs
    SET status = 'stale', updated_at = now()
    WHERE qs.exam_period_id = v_sess.exam_period_id
      AND qs.student_id = v_sess.student_id
      AND qs.session_number = v_sess.session_number
      AND qs.status NOT IN ('stale', 'void')
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

    -- Jika sesi ini baru saja disetujui revisi materinya, catat paket pengganti di tabel revisi!
    UPDATE public.exam_uas_material_revisions
    SET replacement_question_set_id = v_set_id, updated_at = now()
    WHERE id = (
        SELECT r.id
        FROM public.exam_uas_material_revisions r
        WHERE r.uas_session_id = p_uas_session_id
          AND r.status = 'approved'
          AND r.application_status = 'applied'
          AND r.replacement_question_set_id IS NULL
        ORDER BY r.decided_at DESC NULLS LAST, r.updated_at DESC
        LIMIT 1
    );

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

-- 6. Explicit GRANT / REVOKE (PostgREST least-privilege)
REVOKE ALL ON FUNCTION public.request_uas_material_revision_secure(text, text, text, text, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_uas_material_revision_secure(text, text, text, text, text, jsonb, text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_uas_material_revisions_secure(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_uas_material_revisions_secure(text, text, text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.decide_uas_material_revision_secure(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_uas_material_revision_secure(text, text, text, text, text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.save_uas_session_question_set_secure(text, text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_uas_session_question_set_secure(text, text, text, jsonb, jsonb) TO anon, authenticated;

COMMIT;
