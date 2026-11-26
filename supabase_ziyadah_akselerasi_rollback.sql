-- ============================================================================
-- SITA DARUL ABROR — SAFE ROLLBACK SCRIPT (PERBAIKAN KRITIS B-02 & BAGIAN C)
-- Modul: UJIAN ZIYADAH AKSELERASI
--
-- STRATEGI KEAMANAN GANDA:
-- 1. SAFETY GUARD PENUH 9 TABEL: Menolak keras penghapusan tabel (DROP TABLE)
--    apabila terdapat >= 1 baris data di SALAH SATU dari ke-9 tabel modul
--    (baik baru berupa kegiatan, peserta, sesi, penugasan penguji, delegasi
--    koordinator, absen, setoran, audit log, maupun snapshot finalisasi).
-- 2. STRATEGI ROLLBACK NON-DESTRUKTIF (SOFT DISABLE):
--    Jika modul sudah berisi data dan perlu dinonaktifkan darurat TANPA
--    menghapus data historis sedikit pun, gunakan blok SOFT-DISABLE pada
--    bagian bawah komentar skrip ini (mencabut GRANT EXECUTE RPC dari anon
--    dan authenticated sehingga seluruh tabel tetap terkunci aman oleh RLS).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_coord_cnt integer := 0;
  v_evt_cnt integer := 0;
  v_part_cnt integer := 0;
  v_sess_cnt integer := 0;
  v_exam_cnt integer := 0;
  v_sub_cnt integer := 0;
  v_rng_cnt integer := 0;
  v_aud_cnt integer := 0;
  v_snap_cnt integer := 0;
  v_total_rows integer := 0;
BEGIN
  IF to_regclass('public.ziyadah_accel_coordinators') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_coord_cnt FROM public.ziyadah_accel_coordinators;
  END IF;
  IF to_regclass('public.ziyadah_accel_events') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_evt_cnt FROM public.ziyadah_accel_events;
  END IF;
  IF to_regclass('public.ziyadah_accel_participants') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_part_cnt FROM public.ziyadah_accel_participants;
  END IF;
  IF to_regclass('public.ziyadah_accel_sessions') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_sess_cnt FROM public.ziyadah_accel_sessions;
  END IF;
  IF to_regclass('public.ziyadah_accel_session_examiners') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_exam_cnt FROM public.ziyadah_accel_session_examiners;
  END IF;
  IF to_regclass('public.ziyadah_accel_submissions') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_sub_cnt FROM public.ziyadah_accel_submissions;
  END IF;
  IF to_regclass('public.ziyadah_accel_submission_ranges') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_rng_cnt FROM public.ziyadah_accel_submission_ranges;
  END IF;
  IF to_regclass('public.ziyadah_accel_audit_logs') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_aud_cnt FROM public.ziyadah_accel_audit_logs;
  END IF;
  IF to_regclass('public.ziyadah_accel_final_snapshots') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_snap_cnt FROM public.ziyadah_accel_final_snapshots;
  END IF;

  v_total_rows := v_coord_cnt + v_evt_cnt + v_part_cnt + v_sess_cnt + v_exam_cnt + v_sub_cnt + v_rng_cnt + v_aud_cnt + v_snap_cnt;

  IF v_total_rows > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK DESTRUKTIF DIBLOKIR DEMI KESELAMATAN DATA (Total % baris terdeteksi -> events:%, participants:%, sessions:%, examiners:%, submissions:%, ranges:%, audits:%, snapshots:%, coords:%). Gunakan prosedur SOFT-DISABLE non-destruktif agar riwayat tetap utuh!',
      v_total_rows, v_evt_cnt, v_part_cnt, v_sess_cnt, v_exam_cnt, v_sub_cnt, v_rng_cnt, v_aud_cnt, v_snap_cnt, v_coord_cnt;
  END IF;
END;
$$;

-- Hanya tercapai apabila SELURUH 9 tabel 100% kosong (0 baris):
DROP TRIGGER IF EXISTS trg_za_final_snapshot_immutable ON public.ziyadah_accel_final_snapshots;
DROP FUNCTION IF EXISTS public._za_guard_final_snapshot_immutability();
DROP FUNCTION IF EXISTS public._za_compute_authoritative_event_snapshot(text);
DROP FUNCTION IF EXISTS public._za_check_range_continuity(integer, integer, integer, integer, text);
DROP FUNCTION IF EXISTS public.za_finalize_or_reopen_event_secure(text, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.za_verify_submission_secure(text, text, text, text, numeric, numeric, text);
DROP FUNCTION IF EXISTS public.za_submit_setoran_secure(text, text, jsonb, integer, text);
DROP FUNCTION IF EXISTS public.za_get_event_workspace_secure(text, text, text);
DROP FUNCTION IF EXISTS public.za_reorder_queue_secure(text, text, text, jsonb, integer);
DROP FUNCTION IF EXISTS public.za_set_session_status_secure(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.za_upsert_session_secure(text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.za_update_participant_status_secure(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.za_enroll_participants_secure(text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.za_upsert_event_secure(text, text, jsonb);
DROP FUNCTION IF EXISTS public.za_list_events_secure(text, text);
DROP FUNCTION IF EXISTS public.za_manage_coordinator_secure(text, text, text, boolean, text);
DROP FUNCTION IF EXISTS public.za_get_access_context_secure(text, text);
DROP FUNCTION IF EXISTS public._za_can_examine_participant(text, text, text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public._za_can_examine_participant(text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public._za_is_coordinator(text, text, text, boolean);
DROP FUNCTION IF EXISTS public._za_is_coordinator(text, text, text);
DROP FUNCTION IF EXISTS public._za_resolve_actor(text, text);
DROP FUNCTION IF EXISTS public._za_surah_max_ayah(integer);

DROP TABLE IF EXISTS public.ziyadah_accel_final_snapshots;
DROP TABLE IF EXISTS public.ziyadah_accel_audit_logs;
DROP TABLE IF EXISTS public.ziyadah_accel_submission_ranges;
DROP TABLE IF EXISTS public.ziyadah_accel_submissions;
DROP TABLE IF EXISTS public.ziyadah_accel_session_examiners;
DROP TABLE IF EXISTS public.ziyadah_accel_sessions;
DROP TABLE IF EXISTS public.ziyadah_accel_participants;
DROP TABLE IF EXISTS public.ziyadah_accel_events;
DROP TABLE IF EXISTS public.ziyadah_accel_coordinators;

COMMIT;

-- ============================================================================
-- ALTERNATIF ROLLBACK NON-DESTRUKTIF (SOFT-DISABLE TANPA HAPUS DATA)
-- Jalankan blok ini SAJA apabila modul sudah berisi data kegiatan/setoran dan
-- ingin dinonaktifkan sementara tanpa menghilangkan satu baris pun:
-- ============================================================================
/*
BEGIN;
REVOKE EXECUTE ON FUNCTION public.za_get_access_context_secure(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_manage_coordinator_secure(text, text, text, boolean, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_list_events_secure(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_upsert_event_secure(text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_enroll_participants_secure(text, text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_update_participant_status_secure(text, text, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_upsert_session_secure(text, text, jsonb, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_set_session_status_secure(text, text, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_reorder_queue_secure(text, text, text, jsonb, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_get_event_workspace_secure(text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_submit_setoran_secure(text, text, jsonb, integer, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_verify_submission_secure(text, text, text, text, numeric, numeric, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.za_finalize_or_reopen_event_secure(text, text, text, text, text, jsonb) FROM anon, authenticated;
COMMIT;
*/
