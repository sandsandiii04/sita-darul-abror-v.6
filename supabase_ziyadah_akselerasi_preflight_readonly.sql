-- ============================================================================
-- SITA DARUL ABROR — PREFLIGHT CHECK (READ-ONLY)
-- Modul: UJIAN ZIYADAH AKSELERASI (Revisi Hardening Audit B-01..B-12)
-- Jaminan: 100% SELECT (Read-Only), TIDAK mengubah skema maupun data apa pun.
-- ============================================================================

WITH dependency_checks AS (
  SELECT
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS has_users_table,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_sessions') AS has_user_sessions_table,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'students') AS has_students_table,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'records') AS has_records_table,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'academic_terms') AS has_academic_terms_table,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'uas_examiner_pins') AS has_uas_pins_table,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'uas_verified_examiner_sessions') AS has_uas_verified_sessions_table,
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'validate_session_or_credential'
    ) AS has_auth_validator_rpc
),
collision_checks AS (
  SELECT
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'ziyadah_accel_%') AS existing_za_tables,
    (
      SELECT COUNT(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND (p.proname LIKE 'za_%' OR p.proname LIKE '_za_%')
    ) AS existing_za_functions
),
live_activity_checks AS (
  SELECT
    COALESCE((SELECT COUNT(*) FROM public.exam_attempts WHERE status = 'in_progress'), 0) AS active_uts_uas_attempts,
    COALESCE((SELECT COUNT(*) FROM public.exam_uas_sessions WHERE status = 'in_progress'), 0) AS active_uas_sessions
)
SELECT
  d.has_users_table,
  d.has_user_sessions_table,
  d.has_students_table,
  d.has_records_table,
  d.has_academic_terms_table,
  d.has_uas_pins_table,
  d.has_uas_verified_sessions_table,
  d.has_auth_validator_rpc,
  c.existing_za_tables,
  c.existing_za_functions,
  l.active_uts_uas_attempts,
  l.active_uas_sessions,
  CASE
    WHEN d.has_users_table
     AND d.has_user_sessions_table
     AND d.has_students_table
     AND d.has_records_table
     AND d.has_academic_terms_table
     AND d.has_auth_validator_rpc
    THEN 'READY_FOR_MIGRATION'
    ELSE 'BLOCKED_MISSING_DEPENDENCY'
  END AS preflight_status
FROM dependency_checks d
CROSS JOIN collision_checks c
CROSS JOIN live_activity_checks l;
