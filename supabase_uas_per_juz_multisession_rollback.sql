-- ============================================================================
-- ROLLBACK: UAS Per-Juz Material Parts & Multi-Session UAS
-- Safe rollback: drops new functions and tables without deleting any
-- historical exam_attempts, exam_question_assessments, or question_bank rows.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.save_uas_session_question_set_secure(text, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.start_uas_session_attempt(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.get_uas_juz_parts_and_sessions(text, text, text);
DROP FUNCTION IF EXISTS public.verify_or_finalize_uas_material_part_secure(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.save_uas_juz_parts_and_sessions_secure(text, text, text, text, jsonb, jsonb);

DROP TABLE IF EXISTS public.exam_uas_sessions;
DROP TABLE IF EXISTS public.exam_material_parts;

COMMIT;
