-- ============================================================================
-- SITA DARUL ABROR — PEMERIKSAAN READ-ONLY SESUDAH MIGRASI
-- Jalankan di Supabase SQL Editor tepat setelah menjalankan:
--   supabase_uas_material_revision_migration.sql
--
-- SKRIP INI 100% READ-ONLY. Bandingkan hasilnya dengan baseline pra-migrasi:
--   locked = 342, pending_mandatory = 94, void = 607, total = 1043.
-- ============================================================================

-- 1. Verifikasi distribusi status paket soal (harus IDENTIK dengan baseline sebelum migrasi)
SELECT status, count(*)::int AS jumlah
FROM public.exam_question_sets
GROUP BY status
ORDER BY status;

SELECT count(*)::int AS total_paket_soal FROM public.exam_question_sets;

-- 2. Verifikasi jumlah attempt UAS & checksum nilai historis (KHUSUS periode exam_type = 'uas')
SELECT
    a.status,
    count(*)::int AS jumlah_attempt_uas,
    COALESCE(SUM(a.total_score), 0) AS checksum_nilai_uas
FROM public.exam_attempts a
JOIN public.exam_periods ep ON ep.id = a.exam_period_id
WHERE ep.exam_type = 'uas'
GROUP BY a.status
ORDER BY a.status;

-- 2b. Verifikasi khusus attempt UAS in_progress (wajib = 0 saat jendela migrasi)
SELECT count(*)::int AS uas_in_progress_count
FROM public.exam_attempts a
JOIN public.exam_periods ep ON ep.id = a.exam_period_id
WHERE ep.exam_type = 'uas'
  AND a.status = 'in_progress';

-- 3. Verifikasi tabel baru exam_uas_material_revisions + RLS + partial unique index
SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    (SELECT count(*)::int FROM public.exam_uas_material_revisions) AS row_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'exam_uas_material_revisions';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'exam_uas_material_revisions'
ORDER BY indexname;

-- 4. Verifikasi keempat RPC aktif + hak akses anon/authenticated
SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS args,
    p.prosecdef AS is_security_definer,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'request_uas_material_revision_secure',
    'get_uas_material_revisions_secure',
    'decide_uas_material_revision_secure',
    'save_uas_session_question_set_secure'
  )
ORDER BY p.proname;

-- 5. Verifikasi akses langsung tabel exam_uas_material_revisions tertutup untuk anon/authenticated
SELECT
    has_table_privilege('anon', 'public.exam_uas_material_revisions', 'SELECT') AS anon_select,
    has_table_privilege('anon', 'public.exam_uas_material_revisions', 'INSERT') AS anon_insert,
    has_table_privilege('authenticated', 'public.exam_uas_material_revisions', 'SELECT') AS auth_select,
    has_table_privilege('authenticated', 'public.exam_uas_material_revisions', 'INSERT') AS auth_insert;
