-- ============================================================================
-- SITA DARUL ABROR — PATCH PERBAIKAN HAPUS & BUAT ULANG SESI MANUAL UAS
-- Kompatibel penuh dengan data & skema produksi.
-- 1. Mengganti constraint unik session_number menjadi PARTIAL UNIQUE INDEX
--    (WHERE status != 'void') agar sesi auto yang sudah di-void tidak
--    memblokir pembuatan sesi baru dengan nomor urut 1, 2, dst.
-- 2. Membuat delete_uas_manual_session_secure idempoten untuk sesi yang sudah
--    void, sambil tetap mempertahankan seluruh proteksi paket/attempt/lock.
-- 3. Membuat upsert_uas_manual_session_secure menggunakan clock_timestamp() +
--    suffix acak agar ID sesi baru tidak pernah bentrok dan tidak membangkitkan
--    kembali sesi yang sudah void.
-- ============================================================================

BEGIN;

-- 1. Partial unique index untuk nomor sesi aktif (abaikan sesi void)
ALTER TABLE public.exam_uas_sessions
    DROP CONSTRAINT IF EXISTS exam_uas_sessions_exam_period_id_student_id_session_number_key;

DROP INDEX IF EXISTS public.exam_uas_sessions_exam_period_id_student_id_session_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_uas_sessions_active_number
    ON public.exam_uas_sessions (exam_period_id, student_id, session_number)
    WHERE status != 'void';

-- 2. Hardened delete_uas_manual_session_secure
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
    v_sub RECORD;
    v_eff_reason TEXT;
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
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Anda tidak berwenang mengatur sesi santri ini.');
    END IF;

    -- Idempotent: jika sesi sudah berstatus void, langsung berhasil tanpa error
    IF v_sess.status = 'void' THEN
        RETURN jsonb_build_object('success', true, 'alreadyDeleted', true);
    END IF;

    -- Proteksi ketat: sesi yang sudah punya paket, attempt, nilai, atau terkunci tidak boleh dihapus
    IF v_sess.attempt_id IS NOT NULL
       OR v_sess.question_set_id IS NOT NULL
       OR v_sess.is_locked
       OR v_sess.status IN ('in_progress', 'submitted') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi ini sudah memiliki soal atau riwayat ujian. Hubungi Admin untuk melakukan perubahan.');
    END IF;

    SELECT * INTO v_sub FROM public.exam_uas_prep_submissions
    WHERE exam_period_id = v_sess.exam_period_id AND student_id = v_sess.student_id;

    IF FOUND AND v_sub.status = 'admin_approved' AND v_auth.out_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengajuan sudah disetujui Admin. Buka revisi terlebih dahulu untuk mengubah atau menghapus sesi.');
    END IF;

    v_eff_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Sesi dihapus melalui pengaturan manual');

    IF v_sess.source = 'manual' THEN
        DELETE FROM public.exam_uas_sessions WHERE id = p_session_id;
    ELSE
        UPDATE public.exam_uas_sessions
        SET
            status = 'void',
            approval_status = 'draft',
            cancelled_at = now(),
            cancelled_by = v_auth.out_user_id,
            cancelled_by_name = v_auth.out_name,
            cancelled_reason = v_eff_reason,
            updated_at = now()
        WHERE id = p_session_id;
    END IF;

    IF v_sub.id IS NOT NULL AND v_sub.status IN ('pending_admin_approval', 'exception_pending') THEN
        UPDATE public.exam_uas_prep_submissions
        SET status = 'draft', updated_at = now()
        WHERE id = v_sub.id;
    END IF;

    INSERT INTO public.exam_uas_prep_audit_logs (
        id, exam_period_id, student_id, actor_id, actor_name, actor_role, action, target_id, reason, details
    ) VALUES (
        'aud_' || md5(random()::text || clock_timestamp()::text),
        v_sess.exam_period_id, v_sess.student_id, v_auth.out_user_id, v_auth.out_name, v_auth.out_role,
        CASE WHEN v_sess.source = 'manual' THEN 'delete_manual_session' ELSE 'void_auto_session' END,
        p_session_id, v_eff_reason,
        jsonb_build_object('juzNumber', v_sess.juz_number, 'sessionNumber', v_sess.session_number, 'source', v_sess.source)
    );

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 3. Hardened upsert_uas_manual_session_secure
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
    v_has_existing BOOLEAN := false;
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

    v_sess_id := NULLIF(p_session->>'id', '');
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

    -- Pastikan ID sesi yang sudah void atau milik periode/santri lain tidak pernah dipakai ulang
    IF v_sess_id IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.exam_uas_sessions WHERE id = v_sess_id;
        IF FOUND THEN
            IF v_existing.exam_period_id != p_period_id OR v_existing.student_id != p_student_id THEN
                RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: ID sesi tidak sesuai dengan periode atau santri ini.');
            END IF;
            IF v_existing.status = 'void' THEN
                v_sess_id := NULL;
                v_has_existing := false;
            ELSE
                v_has_existing := true;
            END IF;
        END IF;
    END IF;

    IF v_sess_id IS NULL THEN
        v_sess_id := 'uas_sess_man_' || p_period_id || '_' || p_student_id || '_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    END IF;

    -- Cek duplikasi nomor sesi aktif (abaikan sesi void)
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

    IF v_has_existing THEN
        IF v_existing.attempt_id IS NOT NULL OR v_existing.status IN ('in_progress', 'submitted') THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi ini sudah memiliki soal atau riwayat ujian. Hubungi Admin untuk melakukan perubahan.');
        END IF;
        IF v_existing.question_set_id IS NOT NULL THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi ini sudah memiliki soal atau riwayat ujian. Hubungi Admin untuk melakukan perubahan.');
        END IF;
        IF v_existing.is_locked AND v_auth.out_role != 'admin' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Sesi ini sudah memiliki soal atau riwayat ujian. Hubungi Admin untuk melakukan perubahan.');
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
        CASE WHEN NOT v_has_existing THEN 'create_manual_session' ELSE 'edit_session' END,
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

COMMIT;
