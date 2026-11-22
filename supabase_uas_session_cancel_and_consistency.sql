-- ============================================================================
-- SITA DARUL ABROR — ADDITIVE PATCH: SESSION CANCELLATION (VOID),
-- EVIDENCE-BACKED FULL-JUZ/PARTIAL CONSISTENCY GUARD & ADMIN/TEACHER SHARED PREP
-- Safe, idempotent, additive only. Does NOT re-run historical migrations.
-- ============================================================================

-- 1. Add audit columns for cancelled/voided sessions
ALTER TABLE public.exam_uas_sessions
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_by_name TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

-- 1b. Complete 114-Surah name -> surah number resolver (handles Indonesian/Arabic spelling variants)
CREATE OR REPLACE FUNCTION public._uas_resolve_surah_num(p_surah_name text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    v_clean TEXT := regexp_replace(lower(trim(COALESCE(p_surah_name, ''))), '[''’`"\.\s\-_]', '', 'g');
BEGIN
    IF v_clean = '' THEN RETURN NULL; END IF;
    -- Strip optional leading "surah" / "surat" / "qs"
    v_clean := regexp_replace(v_clean, '^(surah|surat|qs)', '');
    -- Direct numeric input (1..114)
    IF v_clean ~ '^[0-9]+$' THEN
        IF v_clean::int BETWEEN 1 AND 114 THEN RETURN v_clean::int; END IF;
        RETURN NULL;
    END IF;

    CASE
        WHEN v_clean IN ('alfatihah','fatihah') THEN RETURN 1;
        WHEN v_clean IN ('albaqarah','baqarah','albaqoroh','baqoroh') THEN RETURN 2;
        WHEN v_clean IN ('aliimran','alimran','imran','aliimron') THEN RETURN 3;
        WHEN v_clean IN ('annisa','nisa') THEN RETURN 4;
        WHEN v_clean IN ('almaidah','maidah') THEN RETURN 5;
        WHEN v_clean IN ('alanam','anam') THEN RETURN 6;
        WHEN v_clean IN ('alaraf','araf') THEN RETURN 7;
        WHEN v_clean IN ('alanfal','anfal') THEN RETURN 8;
        WHEN v_clean IN ('attaubah','taubah','attawbah','tawbah') THEN RETURN 9;
        WHEN v_clean IN ('yunus') THEN RETURN 10;
        WHEN v_clean IN ('hud') THEN RETURN 11;
        WHEN v_clean IN ('yusuf') THEN RETURN 12;
        WHEN v_clean IN ('arrad','rad') THEN RETURN 13;
        WHEN v_clean IN ('ibrahim') THEN RETURN 14;
        WHEN v_clean IN ('alhijr','hijr') THEN RETURN 15;
        WHEN v_clean IN ('annahl','nahl') THEN RETURN 16;
        WHEN v_clean IN ('alisra','isra','baniisrail') THEN RETURN 17;
        WHEN v_clean IN ('alkahf','alkahfi','kahf','kahfi') THEN RETURN 18;
        WHEN v_clean IN ('maryam') THEN RETURN 19;
        WHEN v_clean IN ('taha','thaha','toha') THEN RETURN 20;
        WHEN v_clean IN ('alanbiya','anbiya') THEN RETURN 21;
        WHEN v_clean IN ('alhajj','alhaj','hajj','haj') THEN RETURN 22;
        WHEN v_clean IN ('almuminun','muminun','almukminun','mukminun') THEN RETURN 23;
        WHEN v_clean IN ('annur','nur') THEN RETURN 24;
        WHEN v_clean IN ('alfurqan','furqan','alfurqon','furqon') THEN RETURN 25;
        WHEN v_clean IN ('asysyuara','ashshuara','syuara','shuara') THEN RETURN 26;
        WHEN v_clean IN ('annaml','naml') THEN RETURN 27;
        WHEN v_clean IN ('alqasas','qasas','alqashash','qashash','alqosos') THEN RETURN 28;
        WHEN v_clean IN ('alankabut','ankabut') THEN RETURN 29;
        WHEN v_clean IN ('arrum','rum') THEN RETURN 30;
        WHEN v_clean IN ('luqman','lukman') THEN RETURN 31;
        WHEN v_clean IN ('assajdah','sajdah','asajdah') THEN RETURN 32;
        WHEN v_clean IN ('alahzab','ahzab') THEN RETURN 33;
        WHEN v_clean IN ('saba') THEN RETURN 34;
        WHEN v_clean IN ('fatir','fathir') THEN RETURN 35;
        WHEN v_clean IN ('yasin','yasiin','yaasin') THEN RETURN 36;
        WHEN v_clean IN ('assaffat','asaffat','saffat','ashshaffat','shaffat','assoffat') THEN RETURN 37;
        WHEN v_clean IN ('sad','shad','shod') THEN RETURN 38;
        WHEN v_clean IN ('azzumar','zumar') THEN RETURN 39;
        WHEN v_clean IN ('gafir','ghafir','alghafir','almumin','mumin') THEN RETURN 40;
        WHEN v_clean IN ('fussilat','fushshilat','fushilat') THEN RETURN 41;
        WHEN v_clean IN ('asysyura','asysura','ashshura','syura','sura','shura') THEN RETURN 42;
        WHEN v_clean IN ('azzukhruf','zukhruf') THEN RETURN 43;
        WHEN v_clean IN ('addukhan','dukhan') THEN RETURN 44;
        WHEN v_clean IN ('aljasiyah','aljathiyah','jasiyah','jathiyah','aljasiyyah') THEN RETURN 45;
        WHEN v_clean IN ('alahqaf','ahqaf') THEN RETURN 46;
        WHEN v_clean IN ('muhammad') THEN RETURN 47;
        WHEN v_clean IN ('alfath','fath') THEN RETURN 48;
        WHEN v_clean IN ('alhujurat','hujurat') THEN RETURN 49;
        WHEN v_clean IN ('qaf','qof') THEN RETURN 50;
        WHEN v_clean IN ('azzariyat','adzdzariyat','zariyat','dzariyat') THEN RETURN 51;
        WHEN v_clean IN ('attur','aththur','tur','thur') THEN RETURN 52;
        WHEN v_clean IN ('annajm','najm') THEN RETURN 53;
        WHEN v_clean IN ('alqamar','qamar','alqomar','qomar') THEN RETURN 54;
        WHEN v_clean IN ('arrahman','rahman') THEN RETURN 55;
        WHEN v_clean IN ('alwaqiah','waqiah') THEN RETURN 56;
        WHEN v_clean IN ('alhadid','hadid') THEN RETURN 57;
        WHEN v_clean IN ('almujadilah','almujadalah','mujadilah','mujadalah') THEN RETURN 58;
        WHEN v_clean IN ('alhasyr','alhashr','hasyr','hashr') THEN RETURN 59;
        WHEN v_clean IN ('almumtahanah','mumtahanah') THEN RETURN 60;
        WHEN v_clean IN ('assaff','assaf','ashshaff','saff','saf','shaff') THEN RETURN 61;
        WHEN v_clean IN ('aljumuah','aljumah','jumuah','jumah') THEN RETURN 62;
        WHEN v_clean IN ('almunafiqun','munafiqun') THEN RETURN 63;
        WHEN v_clean IN ('attagabun','attaghabun','tagabun','taghabun') THEN RETURN 64;
        WHEN v_clean IN ('attalaq','aththalaq','talaq','thalaq') THEN RETURN 65;
        WHEN v_clean IN ('attahrim','tahrim') THEN RETURN 66;
        WHEN v_clean IN ('almulk','mulk') THEN RETURN 67;
        WHEN v_clean IN ('alqalam','qalam','alqolam','qolam') THEN RETURN 68;
        WHEN v_clean IN ('alhaqqah','haqqah','alhaqqoh') THEN RETURN 69;
        WHEN v_clean IN ('almaarij','maarij') THEN RETURN 70;
        WHEN v_clean IN ('nuh') THEN RETURN 71;
        WHEN v_clean IN ('aljinn','aljin','jinn','jin') THEN RETURN 72;
        WHEN v_clean IN ('almuzzammil','almuzammil','muzzammil','muzammil') THEN RETURN 73;
        WHEN v_clean IN ('almuddassir','almuddatstsir','almudassir','muddassir','muddatstsir','mudassir') THEN RETURN 74;
        WHEN v_clean IN ('alqiyamah','qiyamah') THEN RETURN 75;
        WHEN v_clean IN ('alinsan','insan','addahr','dahr') THEN RETURN 76;
        WHEN v_clean IN ('almursalat','mursalat') THEN RETURN 77;
        WHEN v_clean IN ('annaba','naba') THEN RETURN 78;
        WHEN v_clean IN ('annaziat','naziat') THEN RETURN 79;
        WHEN v_clean IN ('abasa') THEN RETURN 80;
        WHEN v_clean IN ('attakwir','takwir') THEN RETURN 81;
        WHEN v_clean IN ('alinfitar','alinfithar','infitar','infithar') THEN RETURN 82;
        WHEN v_clean IN ('almutaffifin','almuthaffifin','mutaffifin','muthaffifin') THEN RETURN 83;
        WHEN v_clean IN ('alinsyiqaq','alinshiqaq','insyiqaq','inshiqaq') THEN RETURN 84;
        WHEN v_clean IN ('alburuj','buruj') THEN RETURN 85;
        WHEN v_clean IN ('attariq','aththariq','tariq','thariq') THEN RETURN 86;
        WHEN v_clean IN ('alala','ala') THEN RETURN 87;
        WHEN v_clean IN ('algasyiyah','alghasyiyah','alghashiyah','gasyiyah','ghasyiyah','ghashiyah') THEN RETURN 88;
        WHEN v_clean IN ('alfajr','fajr','alfajar','fajar') THEN RETURN 89;
        WHEN v_clean IN ('albalad','balad') THEN RETURN 90;
        WHEN v_clean IN ('asysyams','ashshams','syams','shams') THEN RETURN 91;
        WHEN v_clean IN ('allail','allayl','lail','layl') THEN RETURN 92;
        WHEN v_clean IN ('adduha','adhdhuha','duha','dhuha') THEN RETURN 93;
        WHEN v_clean IN ('alinsyirah','alinshirah','asysyarh','ashsharh','insyirah','syarh','alamnasyrah') THEN RETURN 94;
        WHEN v_clean IN ('attin','tin') THEN RETURN 95;
        WHEN v_clean IN ('alalaq','alaq') THEN RETURN 96;
        WHEN v_clean IN ('alqadr','qadr','alqadar','qadar') THEN RETURN 97;
        WHEN v_clean IN ('albayyinah','bayyinah') THEN RETURN 98;
        WHEN v_clean IN ('azzalzalah','zalzalah','alzilzal','zilzal') THEN RETURN 99;
        WHEN v_clean IN ('aladiyat','adiyat') THEN RETURN 100;
        WHEN v_clean IN ('alqariah','qariah') THEN RETURN 101;
        WHEN v_clean IN ('attakasur','attakatsur','takasur','takatsur') THEN RETURN 102;
        WHEN v_clean IN ('alasr','alashr','asr','ashr') THEN RETURN 103;
        WHEN v_clean IN ('alhumazah','humazah') THEN RETURN 104;
        WHEN v_clean IN ('alfil','alfeel','fil','feel') THEN RETURN 105;
        WHEN v_clean IN ('quraisy','quraish','alquraisy','alquraish') THEN RETURN 106;
        WHEN v_clean IN ('almaun','maun') THEN RETURN 107;
        WHEN v_clean IN ('alkausar','alkautsar','alkawthar','kausar','kautsar','kawthar') THEN RETURN 108;
        WHEN v_clean IN ('alkafirun','kafirun') THEN RETURN 109;
        WHEN v_clean IN ('annasr','annashr','nasr','nashr') THEN RETURN 110;
        WHEN v_clean IN ('allahab','lahab','almasad','masad') THEN RETURN 111;
        WHEN v_clean IN ('alikhlas','ikhlas') THEN RETURN 112;
        WHEN v_clean IN ('alfalaq','falaq') THEN RETURN 113;
        WHEN v_clean IN ('annas','nas') THEN RETURN 114;
        ELSE RETURN NULL;
    END CASE;
END;
$function$;

-- 1c. Replace _uas_surah_max_ayah so ALL 114 surahs have exact max-ayah limits (including Al-Fajr = 30!)
CREATE OR REPLACE FUNCTION public._uas_surah_max_ayah(p_surah_name text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT CASE
        WHEN public._uas_resolve_surah_num(p_surah_name) IS NOT NULL
            THEN public._uas_surah_num_max_ayah(public._uas_resolve_surah_num(p_surah_name))
        ELSE 0
    END;
$function$;

-- 1d. Server-side valid deposit evidence calculator per Juz from public.records (Madinah Mushaf exact 30 Juz boundaries)
CREATE OR REPLACE FUNCTION public._uas_compute_juz_evidence(
    p_student_id text,
    p_period_id text,
    p_juz_number int
)
RETURNS TABLE(
    total_ayahs int,
    covered_ayahs int,
    evidence_ratio numeric,
    is_full_evidenced boolean,
    has_juz_anomaly boolean,
    has_any_anomaly boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_period RECORD;
    v_term_start DATE := NULL;
    v_juz_start_s INT;
    v_juz_start_a INT;
    v_juz_end_s INT;
    v_juz_end_a INT;
    v_total INT := 0;
    v_covered INT := 0;
    v_juz_anom BOOLEAN := false;
    v_any_anom BOOLEAN := false;
    v_bounds INT[][] := ARRAY[
        ARRAY[1,1,2,141],    ARRAY[2,142,2,252],  ARRAY[2,253,3,92],   ARRAY[3,93,4,23],    ARRAY[4,24,4,147],
        ARRAY[4,148,5,81],   ARRAY[5,82,6,110],   ARRAY[6,111,7,87],   ARRAY[7,88,8,40],    ARRAY[8,41,9,92],
        ARRAY[9,93,11,5],    ARRAY[11,6,12,52],   ARRAY[12,53,14,52],  ARRAY[15,1,16,128],  ARRAY[17,1,18,74],
        ARRAY[18,75,20,135], ARRAY[21,1,22,78],   ARRAY[23,1,25,20],   ARRAY[25,21,27,55],  ARRAY[27,56,29,45],
        ARRAY[29,46,33,30],  ARRAY[33,31,36,27],  ARRAY[36,28,39,31],  ARRAY[39,32,41,46],  ARRAY[41,47,45,37],
        ARRAY[46,1,51,30],   ARRAY[51,31,57,29],  ARRAY[58,1,66,12],   ARRAY[67,1,77,50],   ARRAY[78,1,114,6]
    ];
BEGIN
    IF p_juz_number IS NULL OR p_juz_number < 1 OR p_juz_number > 30 THEN
        RETURN QUERY SELECT 0, 0, 0::numeric, false, false, false;
        RETURN;
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id;
    IF v_period.academic_term_id IS NOT NULL THEN
        SELECT t.start_date::date INTO v_term_start
        FROM public.academic_terms t
        WHERE t.id = v_period.academic_term_id;
    END IF;

    v_juz_start_s := v_bounds[p_juz_number][1];
    v_juz_start_a := v_bounds[p_juz_number][2];
    v_juz_end_s   := v_bounds[p_juz_number][3];
    v_juz_end_a   := v_bounds[p_juz_number][4];

    -- Check anomalies across all sabaq/ziyadah records for this student within the period window
    WITH scoped_records AS (
        SELECT
            r.id,
            public._uas_resolve_surah_num(r.surah) AS snum,
            COALESCE(r.ayah_start, 0) AS a_start,
            COALESCE(r.ayah_end, 0) AS a_end
        FROM public.records r
        WHERE r.student_id = p_student_id
          AND r.type IN ('sabaq', 'ziyadah')
          AND (v_term_start IS NULL OR r.date::date >= v_term_start)
          AND (v_period.material_cutoff_date IS NULL OR r.date::date <= v_period.material_cutoff_date::date)
    ),
    flagged AS (
        SELECT
            sr.*,
            (
                sr.snum IS NULL
                OR sr.a_start < 1
                OR sr.a_end < sr.a_start
                OR sr.a_end > public._uas_surah_num_max_ayah(sr.snum)
            ) AS is_invalid
        FROM scoped_records sr
    )
    SELECT
        COALESCE(bool_or(is_invalid), false),
        COALESCE(bool_or(is_invalid AND (snum IS NULL OR (snum >= v_juz_start_s AND snum <= v_juz_end_s))), false)
    INTO v_any_anom, v_juz_anom
    FROM flagged;

    -- Compute exact Juz ayah coverage strictly from VALID records (invalid records excluded!)
    WITH juz_surahs AS (
        SELECT
            s AS snum,
            CASE WHEN s = v_juz_start_s THEN v_juz_start_a ELSE 1 END AS min_a,
            CASE WHEN s = v_juz_end_s THEN v_juz_end_a ELSE public._uas_surah_num_max_ayah(s) END AS max_a
        FROM generate_series(v_juz_start_s, v_juz_end_s) AS s
    ),
    juz_ayahs AS (
        SELECT js.snum, a AS anum
        FROM juz_surahs js,
             LATERAL generate_series(js.min_a, js.max_a) AS a
    ),
    valid_records AS (
        SELECT
            public._uas_resolve_surah_num(r.surah) AS snum,
            r.ayah_start AS a_start,
            r.ayah_end AS a_end
        FROM public.records r
        WHERE r.student_id = p_student_id
          AND r.type IN ('sabaq', 'ziyadah')
          AND (v_term_start IS NULL OR r.date::date >= v_term_start)
          AND (v_period.material_cutoff_date IS NULL OR r.date::date <= v_period.material_cutoff_date::date)
          AND public._uas_resolve_surah_num(r.surah) IS NOT NULL
          AND COALESCE(r.ayah_start, 0) >= 1
          AND COALESCE(r.ayah_end, 0) >= COALESCE(r.ayah_start, 0)
          AND COALESCE(r.ayah_end, 0) <= public._uas_surah_num_max_ayah(public._uas_resolve_surah_num(r.surah))
    )
    SELECT
        (SELECT count(*)::int FROM juz_ayahs),
        (
            SELECT count(*)::int
            FROM juz_ayahs ja
            WHERE EXISTS (
                SELECT 1 FROM valid_records vr
                WHERE vr.snum = ja.snum AND ja.anum BETWEEN vr.a_start AND vr.a_end
            )
        )
    INTO v_total, v_covered;

    RETURN QUERY SELECT
        v_total,
        v_covered,
        CASE WHEN v_total > 0 THEN round(v_covered::numeric / v_total::numeric, 4) ELSE 0::numeric END,
        (v_total > 0 AND v_covered >= v_total AND NOT v_juz_anom),
        v_juz_anom,
        v_any_anom;
END;
$function$;

-- 2. Update get_uas_juz_parts_and_sessions to exclude voided/cancelled sessions (preserving admin, teacher, shared_uas_examiner)
CREATE OR REPLACE FUNCTION public.get_uas_juz_parts_and_sessions(
    p_username text,
    p_password text,
    p_period_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_parts jsonb;
    v_sessions jsonb;
    v_submissions jsonb;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR v_auth.out_role NOT IN ('admin', 'teacher', 'shared_uas_examiner') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    IF v_auth.out_role = 'shared_uas_examiner' AND NOT EXISTS (
        SELECT 1 FROM public.uas_verified_examiner_sessions
        WHERE session_token = p_password AND expires_at > now()
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Silakan verifikasi PIN penguji terlebih dahulu.');
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY p.student_id, p.part_order), '[]'::jsonb)
    INTO v_parts
    FROM public.exam_material_parts p
    WHERE p.exam_period_id = p_period_id
      AND (
          v_auth.out_role IN ('admin', 'shared_uas_examiner')
          OR EXISTS (
              SELECT 1 FROM public.students st
              WHERE st.id = p.student_id AND st.teacher_id = v_auth.out_user_id
          )
      );

    SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.student_id, s.session_number), '[]'::jsonb)
    INTO v_sessions
    FROM public.exam_uas_sessions s
    WHERE s.exam_period_id = p_period_id
      AND s.status != 'void'
      AND (
          v_auth.out_role IN ('admin', 'shared_uas_examiner')
          OR EXISTS (
              SELECT 1 FROM public.students st
              WHERE st.id = s.student_id AND st.teacher_id = v_auth.out_user_id
          )
      );

    SELECT COALESCE(jsonb_agg(row_to_json(sub) ORDER BY sub.updated_at DESC), '[]'::jsonb)
    INTO v_submissions
    FROM public.exam_uas_prep_submissions sub
    WHERE sub.exam_period_id = p_period_id
      AND (
          v_auth.out_role = 'admin'
          OR (v_auth.out_role = 'teacher' AND EXISTS (
              SELECT 1 FROM public.students st
              WHERE st.id = sub.student_id AND st.teacher_id = v_auth.out_user_id
          ))
      );

    RETURN jsonb_build_object(
        'success', true,
        'parts', v_parts,
        'sessions', v_sessions,
        'submissions', v_submissions
    );
END;
$function$;

-- 2b. Update upsert_uas_manual_part_secure: enforce valid deposit evidence per Juz & invalidate stale submissions on edit
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
    v_eff_status TEXT;
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

    IF v_juz IS NULL OR v_juz < 1 OR v_juz > 30 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nomor juz harus antara 1 dan 30.');
    END IF;
    IF v_start_surah IS NULL OR v_end_surah IS NULL OR v_start_surah < 1 OR v_end_surah > 114 OR v_start_surah > v_end_surah THEN
        RETURN jsonb_build_object('success', false, 'message', 'Rentang surah tidak valid.');
    END IF;
    IF v_start_ayah < 1 OR v_end_ayah < 1 OR v_end_ayah > public._uas_surah_num_max_ayah(v_end_surah)
       OR (v_start_surah = v_end_surah AND v_start_ayah > v_end_ayah) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Rentang ayat melebihi batas surah atau terbalik.');
    END IF;
    IF v_cov_count <= 0 OR v_cov_ratio <= 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Cakupan halaman Mushaf tidak boleh kosong (0%).');
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

    -- Validasi bukti setoran sah aktual pada public.records untuk Juz ini
    SELECT * INTO v_ev FROM public._uas_compute_juz_evidence(p_student_id, p_period_id, v_juz);
    IF COALESCE(v_ev.covered_ayahs, 0) <= 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Ditolak: Tidak ditemukan bukti setoran sabaq/ziyadah yang sah pada Juz ' || v_juz || ' sampai tanggal cutoff.');
    END IF;
    IF v_part_type = 'full_juz' AND NOT v_ev.is_full_evidenced THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Ditolak: Bukti setoran sah Juz ' || v_juz || ' baru mencapai ' || round(COALESCE(v_ev.evidence_ratio, 0) * 100)::int || '% (' || COALESCE(v_ev.covered_ayahs, 0) || '/' || COALESCE(v_ev.total_ayahs, 0) || ' ayat) atau masih ada catatan ayat invalid. Tidak boleh ditetapkan sebagai 1 Juz Penuh.'
        );
    END IF;
    IF v_part_type = 'partial_half' AND (v_cov_ratio < 0.5 OR COALESCE(v_ev.evidence_ratio, 0) < 0.30) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Ditolak: Bukti setoran sah Juz ' || v_juz || ' belum mencukupi untuk sesi Parsial (minimal 50% cakupan sah).'
        );
    END IF;

    v_eff_status := CASE
        WHEN v_has_gap OR v_ev.has_juz_anomaly THEN 'needs_review'
        WHEN v_part_type = 'full_juz' AND v_cov_ratio >= 1 AND v_ev.is_full_evidenced THEN 'ready'
        WHEN v_cov_ratio >= 0.5 THEN 'ready'
        ELSE 'needs_admin_decision'
    END;

    INSERT INTO public.exam_material_parts (
        id, exam_period_id, student_id, part_order, juz_number, part_type,
        start_surah, start_ayah, end_surah, end_ayah,
        start_page, end_page, covered_pages, covered_pages_count,
        juz_total_pages, coverage_ratio, segments, has_gap,
        status, teacher_status, approval_status, review_reason, updated_at
    ) VALUES (
        v_part_id, p_period_id, p_student_id, COALESCE((p_part->>'partOrder')::int, 1), v_juz, v_part_type,
        v_start_surah, v_start_ayah, v_end_surah, v_end_ayah,
        v_start_page, v_end_page, v_covered_pages, v_cov_count,
        v_juz_total, v_cov_ratio, v_segments, v_has_gap,
        v_eff_status, 'draft_manual', 'draft', COALESCE(NULLIF(trim(p_reason), ''), 'Input materi manual'), now()
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
        teacher_status = 'draft_manual',
        approval_status = 'draft',
        verified_by = NULL,
        verified_at = NULL,
        review_reason = EXCLUDED.review_reason,
        updated_at = now();

    -- Invalidate stale submission so modified material never reuses prior verification/approval
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
        CASE WHEN v_auth.out_role = 'admin' THEN 'admin_manual_part_upsert' ELSE 'teacher_manual_part_upsert' END,
        v_part_id, COALESCE(NULLIF(trim(p_reason), ''), 'Pengaturan materi manual'),
        jsonb_build_object(
            'juzNumber', v_juz,
            'partType', v_part_type,
            'coverageRatio', v_cov_ratio,
            'evidenceRatio', v_ev.evidence_ratio,
            'isFullEvidenced', v_ev.is_full_evidenced
        )
    );

    RETURN jsonb_build_object('success', true, 'partId', v_part_id, 'status', v_eff_status, 'teacherStatus', 'draft_manual');
END;
$function$;

-- 3. Update delete_uas_manual_session_secure:
--    - Supports deleting manual draft sessions OR soft-voiding auto draft sessions
--    - Prevents auto-sync from resurrecting voided auto sessions
--    - Protects sessions with attempt_id, question_set_id, in_progress/submitted, or is_locked
--    - Resets pending_admin_approval submission to draft (requires re-submission)
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

    IF v_sess.attempt_id IS NOT NULL
       OR v_sess.question_set_id IS NOT NULL
       OR v_sess.is_locked
       OR v_sess.status IN ('in_progress', 'submitted') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Sesi yang sudah dikunci atau memiliki paket/nilai ujian tidak boleh dihapus.');
    END IF;

    SELECT * INTO v_sub FROM public.exam_uas_prep_submissions
    WHERE exam_period_id = v_sess.exam_period_id AND student_id = v_sess.student_id;

    IF FOUND AND v_sub.status = 'admin_approved' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengajuan sudah disetujui Admin. Buka revisi terlebih dahulu untuk mengubah atau menghapus sesi.');
    END IF;

    v_eff_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Sesi dihapus melalui pengaturan manual');

    IF v_sess.source = 'manual' THEN
        DELETE FROM public.exam_uas_sessions WHERE id = p_session_id;
    ELSE
        -- Soft-cancel auto session so auto-sync will NOT recreate it
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

    -- If already submitted for approval, revert submission to draft so it must be re-verified/re-submitted
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

-- 4. Update upsert_uas_manual_session_secure: validate against ACTUAL public.records evidence + ignore void sessions
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

    IF v_part.verified_at IS NULL AND v_part.status != 'ready' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Bagian materi harus diverifikasi terlebih dahulu sebelum dibuat sesi.');
    END IF;

    -- Validasi bukti setoran sah aktual dari public.records (tidak hanya percaya coverage_ratio di exam_material_parts!)
    SELECT * INTO v_ev FROM public._uas_compute_juz_evidence(p_student_id, p_period_id, v_part.juz_number);

    IF v_sess_type = 'full_juz' THEN
        IF v_part.part_type != 'full_juz' OR COALESCE(v_part.coverage_ratio, 0) < 1 OR v_part.has_gap THEN
            RETURN jsonb_build_object('success', false, 'message', 'Ditolak: Sesi 1 Juz Penuh hanya boleh dibuat dari hafalan sah 100% satu juz tanpa celah.');
        END IF;
        IF NOT v_ev.is_full_evidenced THEN
            -- Tandai part yang tidak sinkron agar diperiksa ulang
            UPDATE public.exam_material_parts
            SET status = 'needs_review', teacher_status = 'stale', approval_status = 'stale',
                review_reason = 'Ketidaksesuaian bukti setoran sah Juz ' || v_part.juz_number || ' (' || round(COALESCE(v_ev.evidence_ratio, 0) * 100)::int || '% ayat sah). Perlu pemeriksaan ulang.',
                updated_at = now()
            WHERE id = v_part.id;
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Ditolak: Bukti setoran sah Juz ' || v_part.juz_number || ' hanya ' || round(COALESCE(v_ev.evidence_ratio, 0) * 100)::int || '% (' || COALESCE(v_ev.covered_ayahs, 0) || '/' || COALESCE(v_ev.total_ayahs, 0) || ' ayat) atau terdapat catatan ayat invalid. Sesi 1 Juz Penuh wajib 100% didukung bukti setoran sah.'
            );
        END IF;
    END IF;

    IF v_sess_type = 'partial_half' THEN
        IF COALESCE(v_part.coverage_ratio, 0) < 0.5 OR COALESCE(v_ev.covered_ayahs, 0) <= 0 OR COALESCE(v_ev.evidence_ratio, 0) < 0.30 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Ditolak: Sesi Parsial minimal 50% cakupan panjang hafalan dan harus didukung bukti setoran sah pada Juz ' || v_part.juz_number || '.');
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

    -- Cek apakah sesi sudah memiliki paket, attempt, atau sedang/sudah ujian
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
    ELSE
        -- Cek duplikasi cakupan utama pada sesi aktif (abaikan sesi void)
        IF EXISTS (
            SELECT 1 FROM public.exam_uas_sessions s
            WHERE s.exam_period_id = p_period_id AND s.student_id = p_student_id
              AND s.primary_part_id = v_primary_part_id AND s.status != 'void'
        ) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Bagian juz ini sudah memiliki sesi aktif. Gunakan Ubah Sesi untuk mengeditnya.');
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
        COALESCE((p_session->>'startSurah')::int, v_part.start_surah),
        COALESCE((p_session->>'startAyah')::int, v_part.start_ayah),
        COALESCE((p_session->>'endSurah')::int, v_part.end_surah),
        COALESCE((p_session->>'endAyah')::int, v_part.end_ayah),
        COALESCE((p_session->>'startPage')::int, v_part.start_page),
        COALESCE((p_session->>'endPage')::int, v_part.end_page),
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

    -- Invalidate pending submission if session was modified (so old verification is not blindly reused)
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
            'evidenceRatio', v_ev.evidence_ratio,
            'isFullEvidenced', v_ev.is_full_evidenced
        )
    );

    RETURN jsonb_build_object('success', true, 'sessionId', v_sess_id);
END;
$function$;

-- 4b. Update submit_uas_prep_for_approval_secure: ignore void sessions + enforce actual deposit evidence per session
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
    v_has_db_anomaly BOOLEAN := false;
    v_unverified_cnt INT;
    v_full_cnt INT;
    v_partial_cnt INT;
    v_manual_cnt INT;
    v_total_cnt INT;
    v_target_status TEXT;
    v_sub_id TEXT := 'sub_' || p_period_id || '_' || p_student_id;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR NOT public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Santri ini bukan binaan halaqah Anda.');
    END IF;

    SELECT * INTO v_student FROM public.students WHERE id = p_student_id;
    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id;

    SELECT EXISTS (
        SELECT 1 FROM public.records r
        WHERE r.student_id = p_student_id
          AND r.type IN ('sabaq', 'ziyadah')
          AND (v_period.material_cutoff_date IS NULL OR r.date::date <= v_period.material_cutoff_date::date)
          AND (
              public._uas_resolve_surah_num(r.surah) IS NULL
              OR COALESCE(r.ayah_start, 0) < 1
              OR COALESCE(r.ayah_end, 0) < COALESCE(r.ayah_start, 0)
              OR COALESCE(r.ayah_end, 0) > public._uas_surah_max_ayah(r.surah)
          )
    ) INTO v_has_db_anomaly;

    IF v_has_db_anomaly AND NOT p_is_exception THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengajuan ditolak: Masih terdapat catatan ayat tidak valid pada tabel setoran. Perbaiki setoran atau ajukan sebagai pengecualian.');
    END IF;

    SELECT count(*)::int INTO v_unverified_cnt
    FROM public.exam_material_parts p
    WHERE p.exam_period_id = p_period_id AND p.student_id = p_student_id
      AND p.status != 'excluded'
      AND (p.status IN ('needs_review', 'needs_admin_decision') OR p.verified_at IS NULL);

    IF v_unverified_cnt > 0 AND NOT p_is_exception THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengajuan ditolak: Masih ada ' || v_unverified_cnt || ' bagian juz yang belum diverifikasi guru.');
    END IF;

    -- Hitung sesi aktif saja (abaikan status = 'void')
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

    -- Validasi setiap sesi aktif terhadap bukti setoran sah di public.records
    IF NOT p_is_exception THEN
        FOR v_sess IN
            SELECT s.id, s.session_number, s.session_type, s.juz_number, s.primary_part_id,
                   p.coverage_ratio, p.has_gap, p.part_type
            FROM public.exam_uas_sessions s
            JOIN public.exam_material_parts p ON p.id = s.primary_part_id
            WHERE s.exam_period_id = p_period_id AND s.student_id = p_student_id AND s.status != 'void'
        LOOP
            SELECT * INTO v_ev FROM public._uas_compute_juz_evidence(p_student_id, p_period_id, v_sess.juz_number);
            IF v_sess.session_type = 'full_juz' AND (
                COALESCE(v_sess.coverage_ratio, 0) < 1 OR v_sess.has_gap OR v_sess.part_type != 'full_juz' OR NOT v_ev.is_full_evidenced
            ) THEN
                UPDATE public.exam_material_parts
                SET status = 'needs_review', teacher_status = 'stale', approval_status = 'stale',
                    review_reason = 'Pengajuan ditolak: Bukti setoran sah Juz ' || v_sess.juz_number || ' hanya ' || round(COALESCE(v_ev.evidence_ratio, 0) * 100)::int || '%. Perlu pemeriksaan ulang.',
                    updated_at = now()
                WHERE id = v_sess.primary_part_id;
                RETURN jsonb_build_object(
                    'success', false,
                    'message', 'Pengajuan ditolak: Sesi ' || v_sess.session_number || ' (Juz ' || v_sess.juz_number || ') bertipe 1 Juz Penuh, namun bukti setoran sah hanya ' || round(COALESCE(v_ev.evidence_ratio, 0) * 100)::int || '% (' || COALESCE(v_ev.covered_ayahs, 0) || '/' || COALESCE(v_ev.total_ayahs, 0) || ' ayat). Perbaiki materi terlebih dahulu.'
                );
            END IF;
            IF v_sess.session_type = 'partial_half' AND (
                COALESCE(v_sess.coverage_ratio, 0) < 0.5 OR COALESCE(v_ev.covered_ayahs, 0) <= 0 OR COALESCE(v_ev.evidence_ratio, 0) < 0.30
            ) THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'message', 'Pengajuan ditolak: Sesi ' || v_sess.session_number || ' (Juz ' || v_sess.juz_number || ') tidak memenuhi cakupan bukti setoran sah minimal untuk sesi Parsial.'
                );
            END IF;
        END LOOP;
    END IF;

    IF p_is_exception AND length(trim(COALESCE(p_exception_reason, ''))) < 5 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Alasan pengecualian wajib diisi minimal 5 karakter.');
    END IF;

    v_target_status := CASE WHEN p_is_exception THEN 'exception_pending' ELSE 'pending_admin_approval' END;

    INSERT INTO public.exam_uas_prep_submissions (
        id, exam_period_id, student_id, teacher_id, teacher_name,
        halaqah, student_name, student_class, status, is_exception, exception_reason,
        full_juz_count, partial_juz_count, manual_session_count, total_session_count,
        submitted_at, updated_at
    ) VALUES (
        v_sub_id, p_period_id, p_student_id, v_auth.out_user_id, v_auth.out_name,
        COALESCE(v_student.halaqah, '-'), COALESCE(v_student.name, p_student_id), COALESCE(v_student.class, '-'),
        v_target_status, p_is_exception, NULLIF(trim(COALESCE(p_exception_reason, '')), ''),
        v_full_cnt, v_partial_cnt, v_manual_cnt, v_total_cnt,
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
        CASE WHEN p_is_exception THEN 'submit_exception' ELSE 'submit_for_approval' END,
        v_sub_id, p_exception_reason,
        jsonb_build_object('fullCount', v_full_cnt, 'partialCount', v_partial_cnt, 'totalCount', v_total_cnt)
    );

    RETURN jsonb_build_object('success', true, 'submissionId', v_sub_id, 'status', v_target_status);
END;
$function$;

-- 5. Update save_uas_juz_parts_and_sessions_secure so auto-sync NEVER resurrects voided auto sessions
CREATE OR REPLACE FUNCTION public.save_uas_juz_parts_and_sessions_secure(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text,
    p_parts jsonb,
    p_sessions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_part jsonb;
    v_sess jsonb;
    v_existing RECORD;
    v_existing_sess RECORD;
    v_sub RECORD;
    v_period RECORD;
    v_has_db_anomaly BOOLEAN := false;
    v_eff_status TEXT;
    v_eff_has_gap BOOLEAN;
    v_coverage_changed BOOLEAN;
    v_has_active_pkg_or_att BOOLEAN;
    v_is_voided BOOLEAN := false;
    v_part_count INT := 0;
    v_sess_count INT := 0;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid OR NOT public._uas_assert_student_access(v_auth.out_user_id, v_auth.out_role, p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Anda tidak berwenang mengelola persiapan materi santri ini.');
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_period_id;
    SELECT * INTO v_sub FROM public.exam_uas_prep_submissions WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    SELECT EXISTS (
        SELECT 1 FROM public.records r
        WHERE r.student_id = p_student_id
          AND r.type IN ('sabaq', 'ziyadah')
          AND (v_period.material_cutoff_date IS NULL OR r.date::date <= v_period.material_cutoff_date::date)
          AND (
              public._uas_resolve_surah_num(r.surah) IS NULL
              OR COALESCE(r.ayah_start, 0) < 1
              OR COALESCE(r.ayah_end, 0) < COALESCE(r.ayah_start, 0)
              OR COALESCE(r.ayah_end, 0) > public._uas_surah_max_ayah(r.surah)
          )
    ) INTO v_has_db_anomaly;

    FOR v_part IN SELECT * FROM jsonb_array_elements(COALESCE(p_parts, '[]'::jsonb)) LOOP
        SELECT * INTO v_existing FROM public.exam_material_parts WHERE id = (v_part->>'id');
        v_eff_has_gap := COALESCE((v_part->>'hasGap')::boolean, false);
        v_eff_status := COALESCE(v_part->>'status', 'ready');
        IF v_eff_status = 'finalized' THEN v_eff_status := 'ready'; END IF;
        IF v_has_db_anomaly THEN v_eff_status := 'needs_review'; END IF;

        IF NOT FOUND THEN
            INSERT INTO public.exam_material_parts (
                id, exam_period_id, student_id, snapshot_id, part_order, juz_number, part_type,
                start_surah, start_ayah, end_surah, end_ayah, start_page, end_page,
                covered_pages, covered_pages_count, juz_total_pages, coverage_ratio,
                segments, has_gap, status, teacher_status, approval_status, review_reason, updated_at
            ) VALUES (
                v_part->>'id', p_period_id, p_student_id, NULLIF(v_part->>'snapshotId', ''),
                COALESCE((v_part->>'partOrder')::int, 1), (v_part->>'juzNumber')::int, v_part->>'partType',
                (v_part->>'startSurah')::int, (v_part->>'startAyah')::int, (v_part->>'endSurah')::int, (v_part->>'endAyah')::int,
                (v_part->>'startPage')::int, (v_part->>'endPage')::int,
                COALESCE(v_part->'coveredPages', '[]'::jsonb), COALESCE((v_part->>'coveredPagesCount')::int, 0),
                COALESCE((v_part->>'juzTotalPages')::int, 20), COALESCE((v_part->>'coverageRatio')::numeric, 0),
                COALESCE(v_part->'segments', '[]'::jsonb), v_eff_has_gap, v_eff_status,
                CASE WHEN v_eff_status = 'needs_review' THEN 'needs_teacher_review' ELSE 'draft_auto' END,
                'draft', NULLIF(v_part->>'reviewReason', ''), now()
            );
        ELSE
            IF v_existing.status = 'excluded' OR v_existing.teacher_status = 'draft_manual' THEN
                CONTINUE;
            END IF;
            v_coverage_changed := (
                v_existing.covered_pages IS DISTINCT FROM COALESCE(v_part->'coveredPages', '[]'::jsonb)
                OR v_existing.has_gap IS DISTINCT FROM v_eff_has_gap
                OR v_existing.start_surah IS DISTINCT FROM (v_part->>'startSurah')::int
                OR v_existing.start_ayah IS DISTINCT FROM (v_part->>'startAyah')::int
                OR v_existing.end_surah IS DISTINCT FROM (v_part->>'endSurah')::int
                OR v_existing.end_ayah IS DISTINCT FROM (v_part->>'endAyah')::int
            );
            SELECT EXISTS (
                SELECT 1 FROM public.exam_uas_sessions s
                WHERE s.primary_part_id = v_existing.id AND s.status != 'void'
                  AND (s.question_set_id IS NOT NULL OR s.attempt_id IS NOT NULL OR s.status IN ('in_progress', 'submitted'))
            ) INTO v_has_active_pkg_or_att;

            IF v_existing.status = 'finalized' AND v_coverage_changed AND v_has_active_pkg_or_att THEN
                UPDATE public.exam_material_parts SET status = 'needs_review', teacher_status = 'stale', approval_status = 'stale', updated_at = now() WHERE id = v_existing.id;
                IF v_sub.id IS NOT NULL AND v_sub.status = 'admin_approved' THEN
                    UPDATE public.exam_uas_prep_submissions SET status = 'stale', updated_at = now() WHERE id = v_sub.id;
                END IF;
            ELSIF (v_existing.status = 'finalized' OR v_existing.teacher_status = 'admin_approved') AND NOT v_coverage_changed THEN
                UPDATE public.exam_material_parts SET updated_at = now() WHERE id = v_existing.id;
            ELSE
                UPDATE public.exam_material_parts SET
                    part_order = COALESCE((v_part->>'partOrder')::int, 1),
                    part_type = v_part->>'partType',
                    start_surah = (v_part->>'startSurah')::int, start_ayah = (v_part->>'startAyah')::int,
                    end_surah = (v_part->>'endSurah')::int, end_ayah = (v_part->>'endAyah')::int,
                    start_page = (v_part->>'startPage')::int, end_page = (v_part->>'endPage')::int,
                    covered_pages = COALESCE(v_part->'coveredPages', '[]'::jsonb),
                    covered_pages_count = COALESCE((v_part->>'coveredPagesCount')::int, 0),
                    juz_total_pages = COALESCE((v_part->>'juzTotalPages')::int, 20),
                    coverage_ratio = COALESCE((v_part->>'coverageRatio')::numeric, 0),
                    segments = COALESCE(v_part->'segments', '[]'::jsonb),
                    has_gap = v_eff_has_gap, status = v_eff_status,
                    verified_by = CASE WHEN v_coverage_changed THEN NULL ELSE v_existing.verified_by END,
                    verified_at = CASE WHEN v_coverage_changed THEN NULL ELSE v_existing.verified_at END,
                    updated_at = now()
                WHERE id = v_existing.id;
            END IF;
        END IF;
        v_part_count := v_part_count + 1;
    END LOOP;

    FOR v_sess IN SELECT * FROM jsonb_array_elements(COALESCE(p_sessions, '[]'::jsonb)) LOOP
        -- Skip if this session ID or primary_part_id was explicitly voided by Guru/Admin
        SELECT EXISTS (
            SELECT 1 FROM public.exam_uas_sessions s
            WHERE s.exam_period_id = p_period_id AND s.student_id = p_student_id AND s.status = 'void'
              AND (s.id = (v_sess->>'id') OR s.primary_part_id = NULLIF(v_sess->>'primaryPartId', ''))
        ) INTO v_is_voided;
        IF v_is_voided THEN CONTINUE; END IF;

        SELECT * INTO v_existing_sess FROM public.exam_uas_sessions WHERE id = (v_sess->>'id');
        IF FOUND THEN
            IF v_existing_sess.source = 'manual' OR v_existing_sess.is_locked OR v_existing_sess.question_set_id IS NOT NULL OR v_existing_sess.attempt_id IS NOT NULL OR v_existing_sess.status IN ('in_progress', 'submitted') THEN
                CONTINUE;
            END IF;
            UPDATE public.exam_uas_sessions SET
                session_number = (v_sess->>'sessionNumber')::int,
                session_type = v_sess->>'sessionType',
                primary_part_id = NULLIF(v_sess->>'primaryPartId', ''),
                juz_number = (v_sess->>'juzNumber')::int,
                covered_pages = COALESCE(v_sess->'coveredPages', '[]'::jsonb),
                start_surah = (v_sess->>'startSurah')::int, start_ayah = (v_sess->>'startAyah')::int,
                end_surah = (v_sess->>'endSurah')::int, end_ayah = (v_sess->>'endAyah')::int,
                start_page = (v_sess->>'startPage')::int, end_page = (v_sess->>'endPage')::int,
                updated_at = now()
            WHERE id = v_existing_sess.id;
        ELSE
            -- Skip if an active session already exists for this primary_part_id
            IF EXISTS (
                SELECT 1 FROM public.exam_uas_sessions s
                WHERE s.exam_period_id = p_period_id AND s.student_id = p_student_id
                  AND s.primary_part_id = NULLIF(v_sess->>'primaryPartId', '') AND s.status != 'void'
            ) THEN CONTINUE; END IF;

            INSERT INTO public.exam_uas_sessions (
                id, exam_period_id, student_id, session_number, session_type,
                primary_part_id, juz_number, supplemental_parts, covered_pages,
                start_surah, start_ayah, end_surah, end_ayah, start_page, end_page,
                source, approval_status, status, updated_at
            ) VALUES (
                v_sess->>'id', p_period_id, p_student_id, (v_sess->>'sessionNumber')::int, v_sess->>'sessionType',
                NULLIF(v_sess->>'primaryPartId', ''), (v_sess->>'juzNumber')::int,
                COALESCE(v_sess->'supplementalParts', '[]'::jsonb), COALESCE(v_sess->'coveredPages', '[]'::jsonb),
                (v_sess->>'startSurah')::int, (v_sess->>'startAyah')::int, (v_sess->>'endSurah')::int, (v_sess->>'endAyah')::int,
                (v_sess->>'startPage')::int, (v_sess->>'endPage')::int, 'auto', 'draft', 'planned', now()
            );
        END IF;
        v_sess_count := v_sess_count + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'partsSaved', v_part_count, 'sessionsSaved', v_sess_count);
END;
$function$;

-- 6. Update admin_bulk_decide_uas_prep_secure: validate EVERY active session against ACTUAL public.records deposit evidence + ignore void sessions
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
    v_has_db_anomaly BOOLEAN;
    v_bad_part_cnt INT;
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

        IF p_decision = 'approve' AND v_sub.status != 'pending_admin_approval' THEN
            v_skipped_cnt := v_skipped_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'skipped', 'reason', 'Status "' || v_sub.status || '" tidak memenuhi syarat persetujuan massal.');
            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM public.records r
            WHERE r.student_id = v_sid AND r.type IN ('sabaq', 'ziyadah')
              AND (v_period.material_cutoff_date IS NULL OR r.date::date <= v_period.material_cutoff_date::date)
              AND (
                  public._uas_resolve_surah_num(r.surah) IS NULL
                  OR COALESCE(r.ayah_start, 0) < 1
                  OR COALESCE(r.ayah_end, 0) < COALESCE(r.ayah_start, 0)
                  OR COALESCE(r.ayah_end, 0) > public._uas_surah_max_ayah(r.surah)
              )
        ) INTO v_has_db_anomaly;

        IF v_has_db_anomaly AND p_decision = 'approve' THEN
            v_failed_cnt := v_failed_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'failed', 'reason', 'Ditemukan ayat tidak valid pada tabel setoran sumber.');
            CONTINUE;
        END IF;

        SELECT count(*)::int INTO v_bad_part_cnt FROM public.exam_material_parts p
        WHERE p.exam_period_id = p_period_id AND p.student_id = v_sid AND p.status IN ('needs_review', 'needs_admin_decision');
        IF v_bad_part_cnt > 0 AND p_decision = 'approve' THEN
            v_skipped_cnt := v_skipped_cnt + 1;
            v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'skipped', 'reason', 'Masih terdapat ' || v_bad_part_cnt || ' bagian juz berstatus review/keputusan.');
            CONTINUE;
        END IF;

        -- Evidence-backed consistency check on EVERY active (non-void) session!
        v_evidence_error := NULL;
        IF p_decision = 'approve' THEN
            FOR v_sess IN
                SELECT s.id, s.session_number, s.session_type, s.juz_number, s.primary_part_id,
                       p.coverage_ratio, p.has_gap, p.part_type
                FROM public.exam_uas_sessions s
                JOIN public.exam_material_parts p ON p.id = s.primary_part_id
                WHERE s.exam_period_id = p_period_id AND s.student_id = v_sid AND s.status != 'void'
            LOOP
                SELECT * INTO v_ev FROM public._uas_compute_juz_evidence(v_sid, p_period_id, v_sess.juz_number);
                IF v_sess.session_type = 'full_juz' AND (
                    COALESCE(v_sess.coverage_ratio, 0) < 1 OR v_sess.has_gap OR v_sess.part_type != 'full_juz' OR NOT v_ev.is_full_evidenced
                ) THEN
                    -- Tandai part & submission sebagai perlu pemeriksaan ulang (stale)
                    UPDATE public.exam_material_parts
                    SET status = 'needs_review', teacher_status = 'stale', approval_status = 'stale',
                        review_reason = 'Ketidaksesuaian snapshot vs bukti setoran sah Juz ' || v_sess.juz_number || ' (' || round(COALESCE(v_ev.evidence_ratio, 0) * 100)::int || '% ayat sah). Perlu pemeriksaan ulang.',
                        updated_at = now()
                    WHERE id = v_sess.primary_part_id;
                    UPDATE public.exam_uas_prep_submissions
                    SET status = 'stale', updated_at = now()
                    WHERE id = v_sub.id;
                    v_evidence_error := 'Juz ' || v_sess.juz_number || ' bertipe 1 Juz Penuh, namun bukti setoran sah hanya ' || round(COALESCE(v_ev.evidence_ratio, 0) * 100)::int || '% (' || COALESCE(v_ev.covered_ayahs, 0) || '/' || COALESCE(v_ev.total_ayahs, 0) || ' ayat). Ditandai perlu pemeriksaan ulang.';
                    EXIT;
                END IF;
                IF v_sess.session_type = 'partial_half' AND (
                    COALESCE(v_sess.coverage_ratio, 0) < 0.5 OR COALESCE(v_ev.covered_ayahs, 0) <= 0 OR COALESCE(v_ev.evidence_ratio, 0) < 0.30
                ) THEN
                    v_evidence_error := 'Sesi ' || v_sess.session_number || ' (Juz ' || v_sess.juz_number || ') tidak memiliki cukup bukti setoran sah untuk sesi Parsial.';
                    EXIT;
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
        VALUES ('aud_' || md5(random()::text || clock_timestamp()::text), p_period_id, v_sid, v_auth.out_user_id, v_auth.out_name, v_auth.out_role, 'admin_bulk_approve', v_sub.id, p_reason, jsonb_build_object('decision', p_decision));

        v_approved_cnt := v_approved_cnt + 1;
        v_results := v_results || jsonb_build_object('studentId', v_sid, 'studentName', v_sub.student_name, 'outcome', 'approved', 'reason', 'Disetujui & difinalisasi.');
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
