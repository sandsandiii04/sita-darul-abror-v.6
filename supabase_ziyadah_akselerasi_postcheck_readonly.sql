-- ============================================================================
-- SITA DARUL ABROR — POSTCHECK VERIFICATION (READ-ONLY)
-- Modul: UJIAN ZIYADAH AKSELERASI (Revisi Hardening Audit B-01..B-12)
-- ============================================================================

WITH table_checks AS (
  SELECT COUNT(*) AS tables_ok
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename IN (
      'ziyadah_accel_coordinators',
      'ziyadah_accel_events',
      'ziyadah_accel_participants',
      'ziyadah_accel_sessions',
      'ziyadah_accel_session_examiners',
      'ziyadah_accel_submissions',
      'ziyadah_accel_submission_ranges',
      'ziyadah_accel_audit_logs',
      'ziyadah_accel_final_snapshots'
    )
    AND rowsecurity = true
),
policy_checks AS (
  SELECT COUNT(*) AS policies_ok
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename LIKE 'ziyadah_accel_%'
),
index_checks AS (
  SELECT COUNT(*) AS active_range_index_ok
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'ziyadah_accel_submission_ranges'
    AND indexname = 'uq_za_submission_active_range_order'
),
rpc_checks AS (
  SELECT COUNT(DISTINCT p.proname) AS rpcs_ok
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'za_get_access_context_secure',
      'za_manage_coordinator_secure',
      'za_list_events_secure',
      'za_upsert_event_secure',
      'za_enroll_participants_secure',
      'za_update_participant_status_secure',
      'za_upsert_session_secure',
      'za_set_session_status_secure',
      'za_reorder_queue_secure',
      'za_get_event_workspace_secure',
      'za_submit_setoran_secure',
      'za_verify_submission_secure',
      'za_finalize_or_reopen_event_secure'
    )
    AND p.prosecdef = true
),
trigger_checks AS (
  SELECT COUNT(*) AS snapshot_trigger_ok
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'ziyadah_accel_final_snapshots'
    AND t.tgname = 'trg_za_final_snapshot_immutable'
    AND NOT t.tgisinternal
)
SELECT
  t.tables_ok,
  p.policies_ok,
  i.active_range_index_ok,
  r.rpcs_ok,
  tr.snapshot_trigger_ok,
  CASE
    WHEN t.tables_ok = 9
     AND p.policies_ok >= 9
     AND i.active_range_index_ok = 1
     AND r.rpcs_ok = 13
     AND tr.snapshot_trigger_ok = 1
    THEN 'PASS'
    ELSE 'FAIL'
  END AS overall_status
FROM table_checks t
CROSS JOIN policy_checks p
CROSS JOIN index_checks i
CROSS JOIN rpc_checks r
CROSS JOIN trigger_checks tr;
