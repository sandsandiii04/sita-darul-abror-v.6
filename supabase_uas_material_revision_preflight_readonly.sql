-- ============================================================================
-- SITA DARUL ABROR — SKRIP PREFLIGHT READ-ONLY PRODUKSI
-- Jalankan di Supabase SQL Editor SEBELUM menjalankan migrasi:
--   supabase_uas_material_revision_migration.sql
--
-- SKRIP INI 100% READ-ONLY (HANYA SELECT / INSPEKSI SKEMA).
-- Tidak mengubah data, skema, fungsi, atau index apa pun.
-- ============================================================================

-- 1. Verifikasi keberadaan kolom wajib pada tabel-tabel terdampak
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'exam_uas_sessions' AND column_name IN (
      'id','exam_period_id','student_id','session_number','session_type',
      'primary_part_id','juz_number','covered_pages','start_surah','start_ayah',
      'end_surah','end_ayah','start_page','end_page','question_set_id','attempt_id',
      'approval_status','revision_number','change_reason','status','score','updated_at'
    ))
    OR (table_name = 'exam_question_sets' AND column_name IN (
      'id','exam_period_id','student_id','material_snapshot_id','uas_session_id',
      'session_number','session_type','version','total_questions','generation_strategy',
      'generation_seed','material_fingerprint','status','generated_by','generated_at','locked_at','updated_at'
    ))
    OR (table_name = 'exam_material_parts' AND column_name IN (
      'id','exam_period_id','student_id','part_order','juz_number','part_type',
      'start_surah','start_ayah','end_surah','end_ayah','start_page','end_page',
      'covered_pages','covered_pages_count','juz_total_pages','coverage_ratio',
      'has_gap','status','finalized_by','finalized_at','updated_at'
    ))
    OR (table_name = 'exam_attempts' AND column_name IN (
      'id','exam_period_id','student_id','question_set_id','uas_session_id','status','total_score'
    ))
    OR (table_name = 'exam_question_assessments' AND column_name IN ('id','attempt_id'))
    OR (table_name = 'exam_uas_prep_audit_logs' AND column_name IN (
      'id','exam_period_id','student_id','actor_id','actor_name','actor_role','action','target_id','reason','details'
    ))
  )
ORDER BY table_name, column_name;

-- 2. Verifikasi CHECK constraint pada exam_question_sets (wajib mengizinkan 'stale') & users.role
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS constraint_def
FROM pg_constraint
WHERE contype = 'c'
  AND conrelid::regclass::text IN (
    'exam_question_sets', 'exam_uas_sessions', 'exam_material_parts', 'exam_attempts', 'users'
  )
ORDER BY table_name, conname;

-- 3. Verifikasi UNIQUE & PARTIAL UNIQUE INDEX aktif pada exam_uas_sessions & exam_question_sets & exam_material_parts
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('exam_uas_sessions', 'exam_question_sets', 'exam_material_parts', 'exam_attempts')
ORDER BY tablename, indexname;

-- 4. Verifikasi Foreign Key terkait paket, sesi, dan attempt
SELECT
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
    ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('exam_uas_sessions', 'exam_question_sets', 'exam_questions', 'exam_attempts', 'exam_question_assessments')
ORDER BY tc.table_name, tc.constraint_name;

-- 5. Verifikasi Trigger aktif pada tabel terdampak
SELECT event_object_table AS table_name, trigger_name, action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('exam_uas_sessions', 'exam_question_sets', 'exam_material_parts', 'exam_attempts')
ORDER BY event_object_table, trigger_name;

-- 6. Verifikasi fungsi prasyarat & BACKUP definisi RPC produksi save_uas_session_question_set_secure saat ini
SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS args,
    pg_get_functiondef(p.oid) AS current_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'validate_session_or_credential',
    '_uas_assert_student_access',
    'save_uas_session_question_set_secure',
    'start_uas_session_attempt',
    'select_uas_mandatory_pages'
  )
ORDER BY p.proname;

-- 7. Cek apakah tabel exam_uas_material_revisions sudah ada sebelumnya (seharusnya belum ada)
SELECT to_regclass('public.exam_uas_material_revisions') AS existing_revision_table;
