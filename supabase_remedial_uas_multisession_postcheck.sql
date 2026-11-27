-- ============================================================================
-- SITA DARUL ABROR — POSTCHECK PATCH REMEDIAL UAS MULTI-SESI
-- ============================================================================
SELECT
    (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
           'get_student_uas_original_questions',
           'generate_uas_remedial_question_set',
           'generate_uts_remedial_question_set',
           'get_examiner_remedial_students'
       )) AS rpcs_ok,
    (SELECT CASE WHEN pg_get_functiondef(p.oid) ILIKE '%v_active_uas_sessions_count%' THEN 1 ELSE 0 END
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'generate_uas_remedial_question_set'
     LIMIT 1) AS uas_multisession_enabled,
    (SELECT CASE WHEN pg_get_functiondef(p.oid) ILIKE '%COALESCE(v_snapshot.memorization_direction%' THEN 1 ELSE 0 END
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'generate_uts_remedial_question_set'
     LIMIT 1) AS uts_direction_fix_ok;
