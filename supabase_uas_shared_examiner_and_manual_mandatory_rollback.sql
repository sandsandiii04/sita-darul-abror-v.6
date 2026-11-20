-- ROLLBACK for supabase_uas_shared_examiner_and_manual_mandatory.sql
BEGIN;

DROP FUNCTION IF EXISTS public.configure_shared_uas_account_secure(text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.revoke_uas_shared_sessions_secure(text, text, text);
DROP FUNCTION IF EXISTS public.set_uas_examiner_pin_secure(text, text, text, text);
DROP FUNCTION IF EXISTS public.get_uas_active_teachers(text, text);
DROP FUNCTION IF EXISTS public.verify_uas_examiner_identity(text, text, text, text);
DROP FUNCTION IF EXISTS public.select_uas_mandatory_pages(text, text, text, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.generate_uas_question_set(p_username text, p_password text, p_period_id text, p_student_id text, p_strategy text DEFAULT 'hybrid'::text, p_seed text DEFAULT NULL::text, p_questions jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user_id TEXT;
    v_user_role TEXT;
    v_exam_type TEXT;
    v_period_status TEXT;
    v_snapshot_id TEXT;
    v_snapshot_status TEXT;
    v_snap_start_surah INTEGER;
    v_snap_start_ayah INTEGER;
    v_snap_end_surah INTEGER;
    v_snap_end_ayah INTEGER;
    v_snap_min_surah INTEGER;
    v_snap_min_ayah INTEGER;
    v_snap_max_surah INTEGER;
    v_snap_max_ayah INTEGER;
    v_material_fingerprint TEXT;
    v_existing_set_id TEXT;
    v_existing_status TEXT;
    v_existing_fingerprint TEXT;
    v_existing_version INTEGER;
    v_new_set_id TEXT;
    v_q_elem JSONB;
    v_total_score NUMERIC := 0;
    v_mandatory_count INTEGER := 0;
    v_random_count INTEGER := 0;
    v_q_count INTEGER := 0;
    v_q_num INTEGER;
    v_q_role TEXT;
    v_q_score NUMERIC;
    v_q_zone INTEGER;
    v_q_source TEXT;
    v_q_bank_id TEXT;
    v_q_page INTEGER;
    v_as_surah INTEGER;
    v_as_ayah INTEGER;
    v_as_word INTEGER;
    v_ae_surah INTEGER;
    v_ae_ayah INTEGER;
    v_ae_word INTEGER;
    v_ps_surah INTEGER;
    v_ps_ayah INTEGER;
    v_ps_word INTEGER;
    v_pe_surah INTEGER;
    v_pe_ayah INTEGER;
    v_pe_word INTEGER;
    v_bank_row RECORD;
    v_used_random_b TEXT[] := ARRAY[]::TEXT[];
    v_used_mand_pages INTEGER[] := ARRAY[]::INTEGER[];
    v_used_zones INTEGER[] := ARRAY[]::INTEGER[];
    v_b_key TEXT;
    v_ret_questions JSONB;
    v_final_seed TEXT;
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    v_user_id := v_auth.out_user_id;
    v_user_role := v_auth.out_role;

    -- 2. Otorisasi: Khusus Admin
    IF v_user_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berwenang membangkitkan paket soal UAS.');
    END IF;

    -- 3. Validasi Periode Ujian (Khusus UAS)
    SELECT exam_type, status INTO v_exam_type, v_period_status
    FROM exam_periods
    WHERE id = p_period_id;

    IF v_exam_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_exam_type != 'uas' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Generator ini khusus untuk periode ujian UAS.');
    END IF;

    -- 4. Validasi Santri Terdaftar
    IF NOT EXISTS (SELECT 1 FROM exam_participants WHERE exam_period_id = p_period_id AND student_id = p_student_id) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Santri tidak terdaftar pada periode ujian UAS ini.');
    END IF;

    -- 5. Validasi Material Snapshot Finalized
    SELECT id, status, start_surah, start_ayah, end_surah, end_ayah,
           calculate_material_fingerprint(start_surah, start_ayah, end_surah, end_ayah, COALESCE(memorization_direction, 'forward'))
    INTO v_snapshot_id, v_snapshot_status, v_snap_start_surah, v_snap_start_ayah, v_snap_end_surah, v_snap_end_ayah, v_material_fingerprint
    FROM exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF v_snapshot_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Snapshot materi UAS santri belum dibuat.');
    END IF;

    IF v_snapshot_status != 'finalized' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Materi UAS santri belum difinalisasi.');
    END IF;

    -- Hitung batas canonical snapshot
    v_snap_min_surah := LEAST(v_snap_start_surah, v_snap_end_surah);
    v_snap_max_surah := GREATEST(v_snap_start_surah, v_snap_end_surah);
    IF v_snap_start_surah = v_snap_end_surah THEN
        v_snap_min_ayah := LEAST(v_snap_start_ayah, v_snap_end_ayah);
        v_snap_max_ayah := GREATEST(v_snap_start_ayah, v_snap_end_ayah);
    ELSE
        v_snap_min_ayah := CASE WHEN v_snap_start_surah < v_snap_end_surah THEN v_snap_start_ayah ELSE v_snap_end_ayah END;
        v_snap_max_ayah := CASE WHEN v_snap_start_surah > v_snap_end_surah THEN v_snap_start_ayah ELSE v_snap_end_ayah END;
    END IF;

    -- 6. Cek Idempotensi Paket Soal Existing
    SELECT id, status, material_fingerprint, version
    INTO v_existing_set_id, v_existing_status, v_existing_fingerprint, v_existing_version
    FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'locked'
    ORDER BY version DESC
    LIMIT 1;

    IF v_existing_set_id IS NOT NULL THEN
        IF v_existing_fingerprint = v_material_fingerprint THEN
            SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
            INTO v_ret_questions
            FROM exam_questions eq
            WHERE eq.question_set_id = v_existing_set_id;

            RETURN jsonb_build_object(
                'success', true,
                'isExisting', true,
                'message', 'Paket soal UAS sudah terkunci dan siap digunakan.',
                'questionSet', (SELECT row_to_json(eqs.*) FROM exam_question_sets eqs WHERE eqs.id = v_existing_set_id),
                'questions', COALESCE(v_ret_questions, '[]'::jsonb)
            );
        END IF;
    END IF;

    -- 7. KLAUSUL AUDIT 9, 10, 11, 12: VALIDASI SERVER-SIDE PAKET 9 SOAL
    v_q_count := jsonb_array_length(p_questions);
    IF v_q_count != 9 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket soal UAS harus memiliki tepat 9 butir soal (2 wajib + 7 acak). Diterima: ' || v_q_count);
    END IF;

    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        v_q_num := (v_q_elem->>'questionNumber')::INTEGER;
        v_q_role := COALESCE(v_q_elem->>'questionRole', v_q_elem->>'question_role');
        v_q_score := COALESCE((v_q_elem->>'maxScore')::NUMERIC, (v_q_elem->>'max_score')::NUMERIC, 0);
        v_q_zone := (v_q_elem->>'zoneNumber')::INTEGER;
        v_q_source := COALESCE(v_q_elem->>'sourceType', v_q_elem->>'source_type', 'auto');
        v_q_bank_id := v_q_elem->>'questionBankId';
        v_q_page := (v_q_elem->>'pageNumber')::INTEGER;

        -- Ekstraksi koordinat jawaban B dan C
        v_as_surah := COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER);
        v_as_ayah := COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER);
        v_as_word := COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER);

        v_ae_surah := COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER);
        v_ae_ayah := COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER);
        v_ae_word := COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER);

        -- Validasi koordinat dasar (1-114, ayah >= 1, word >= 1)
        IF v_as_surah NOT BETWEEN 1 AND 114 OR v_as_ayah < 1 OR v_as_word < 1 OR
           v_ae_surah NOT BETWEEN 1 AND 114 OR v_ae_ayah < 1 OR v_ae_word < 1 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Koordinat ayat/kata butir soal ' || v_q_num || ' tidak valid.');
        END IF;

        -- Validasi urutan B <= C
        IF (v_as_surah > v_ae_surah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah > v_ae_ayah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah = v_ae_ayah AND v_as_word > v_ae_word) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Urutan jawaban B ke C pada butir soal ' || v_q_num || ' tidak valid.');
        END IF;

        -- Validasi posisi di dalam snapshot
        IF (v_as_surah < v_snap_min_surah) OR (v_as_surah = v_snap_min_surah AND v_as_ayah < v_snap_min_ayah) OR
           (v_ae_surah > v_snap_max_surah) OR (v_ae_surah = v_snap_max_surah AND v_ae_ayah > v_snap_max_ayah) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Titik soal nomor ' || v_q_num || ' berada di luar batas snapshot materi santri.');
        END IF;

        v_total_score := v_total_score + v_q_score;

        -- Validasi spesifik per role
        IF v_q_role = 'mandatory' THEN
            v_mandatory_count := v_mandatory_count + 1;

            IF v_q_num NOT IN (1, 2) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib hanya boleh bernomor 1 atau 2.');
            END IF;

            IF v_q_score != 15 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal wajib harus tepat 15. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NOT NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib halaman penuh tidak boleh memiliki zone_number.');
            END IF;

            IF v_q_page IS NULL OR v_q_page NOT BETWEEN 1 AND 604 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor halaman soal wajib tidak valid (1-604).');
            END IF;

            IF v_q_page = ANY(v_used_mand_pages) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Kedua halaman soal wajib harus berbeda (halaman duplikat: ' || v_q_page || ').');
            END IF;
            v_used_mand_pages := array_append(v_used_mand_pages, v_q_page);

            -- Validasi Bank Soal ID jika source_type = bank
            IF v_q_source = 'bank' THEN
                IF v_q_bank_id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Soal wajib bank harus menyertakan questionBankId.');
                END IF;

                SELECT id, status, exam_type, question_type, question_format, page_number
                INTO v_bank_row
                FROM question_bank
                WHERE id = v_q_bank_id;

                IF v_bank_row.id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' tidak ditemukan.');
                END IF;

                IF v_bank_row.status != 'active' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' tidak berstatus aktif.');
                END IF;

                IF v_bank_row.exam_type NOT IN ('uas', 'generic') THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' bukan untuk ujian UAS/generic.');
                END IF;

                IF v_bank_row.question_type != 'mandatory' OR v_bank_row.question_format != 'full_page' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' bukan soal wajib full_page.');
                END IF;

                IF v_bank_row.page_number != v_q_page THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Halaman pada payload (' || v_q_page || ') tidak cocok dengan bank soal (' || v_bank_row.page_number || ').');
                END IF;
            END IF;

        ELSIF v_q_role = 'random' THEN
            v_random_count := v_random_count + 1;

            IF v_q_num NOT BETWEEN 3 AND 9 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak harus bernomor 3 s.d. 9.');
            END IF;

            IF v_q_score != 10 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal acak harus tepat 10. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NULL OR v_q_zone NOT BETWEEN 1 AND 7 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor zona soal acak harus antara 1 dan 7.');
            END IF;

            IF v_q_zone = ANY(v_used_zones) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Setiap zona 1 s.d. 7 harus unik (duplikasi zona: ' || v_q_zone || ').');
            END IF;
            v_used_zones := array_append(v_used_zones, v_q_zone);

            -- Validasi prompt penguji A dan A-aksen
            v_ps_surah := (v_q_elem->'promptStart'->>'surahNumber')::INTEGER;
            v_ps_ayah := (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER;
            v_ps_word := (v_q_elem->'promptStart'->>'wordPosition')::INTEGER;

            v_pe_surah := (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER;
            v_pe_ayah := (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER;
            v_pe_word := (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER;

            IF v_ps_surah IS NULL OR v_pe_surah IS NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak sambung ayat wajib memiliki prompt penguji A dan A-aksen.');
            END IF;

            -- Validasi A <= A-aksen
            IF (v_ps_surah > v_pe_surah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah > v_pe_ayah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah = v_pe_ayah AND v_ps_word > v_pe_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Urutan prompt A ke A-aksen soal ' || v_q_num || ' tidak valid.');
            END IF;

            -- Validasi A-aksen < B
            IF (v_pe_surah > v_as_surah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah > v_as_ayah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah = v_as_ayah AND v_pe_word >= v_as_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal jawaban B harus setelah prompt A-aksen pada butir soal ' || v_q_num || '.');
            END IF;

            -- Keunikan titik B
            v_b_key := v_as_surah || ':' || v_as_ayah || ':' || v_as_word;
            IF v_b_key = ANY(v_used_random_b) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal B soal acak harus unik (ditemukan duplikasi: ' || v_b_key || ').');
            END IF;
            v_used_random_b := array_append(v_used_random_b, v_b_key);

            -- Validasi Bank Soal ID jika source_type = bank
            IF v_q_source = 'bank' THEN
                IF v_q_bank_id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Soal acak bank harus menyertakan questionBankId.');
                END IF;

                SELECT id, status, exam_type, question_type, question_format
                INTO v_bank_row
                FROM question_bank
                WHERE id = v_q_bank_id;

                IF v_bank_row.id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' tidak ditemukan.');
                END IF;

                IF v_bank_row.status != 'active' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' tidak berstatus aktif.');
                END IF;

                IF v_bank_row.exam_type NOT IN ('uas', 'generic') THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' bukan untuk ujian UAS/generic.');
                END IF;

                IF v_bank_row.question_type != 'random' OR v_bank_row.question_format != 'continuation' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Bank Soal ID ' || v_q_bank_id || ' bukan soal acak continuation.');
                END IF;
            END IF;
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Role soal tidak valid: ' || v_q_role);
        END IF;
    END LOOP;

    -- Final package validation
    IF v_mandatory_count != 2 OR v_random_count != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Struktur soal UAS harus tepat 2 soal wajib dan 7 soal acak.');
    END IF;

    IF array_length(v_used_zones, 1) != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Tepat 7 zona (Zona 1 s.d. 7) harus terpenuhi.');
    END IF;

    IF v_total_score != 100 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Total bobot nilai soal UAS harus 100. Terhitung: ' || v_total_score);
    END IF;

    -- 8. Eksekusi Atomic: Buat Paket Baru
    v_final_seed := COALESCE(p_seed, 'seed_uas_' || p_period_id || '_' || p_student_id || '_' || floor(extract(epoch from now())));
    v_new_set_id := 'eqs_uas_' || p_period_id || '_' || p_student_id || '_v1';

    -- Void set lama jika ada
    UPDATE exam_question_sets
    SET status = 'void'
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status != 'void';

    INSERT INTO exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id, version,
        generation_strategy, generation_seed, material_fingerprint, status,
        generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_new_set_id, p_period_id, p_student_id, v_snapshot_id, 1,
        COALESCE(p_strategy, 'hybrid'), v_final_seed, v_material_fingerprint, 'locked',
        v_user_id, timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())
    );

    -- Simpan 9 butir soal
    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        INSERT INTO exam_questions (
            id, question_set_id, question_number, zone_number, question_role,
            source_type, question_bank_id, page_number, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'eq_uas_' || v_new_set_id || '_q' || (v_q_elem->>'questionNumber'),
            v_new_set_id,
            (v_q_elem->>'questionNumber')::INTEGER,
            (v_q_elem->>'zoneNumber')::INTEGER,
            COALESCE(v_q_elem->>'questionRole', 'random'),
            COALESCE(v_q_elem->>'sourceType', 'auto'),
            v_q_elem->>'questionBankId',
            (v_q_elem->>'pageNumber')::INTEGER,
            COALESCE((v_q_elem->>'maxScore')::NUMERIC, 10.00),
            (v_q_elem->'promptStart'->>'surahNumber')::INTEGER,
            (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER,
            (v_q_elem->'promptStart'->>'wordPosition')::INTEGER,
            (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER,
            (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER,
            (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER,
            COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER),
            COALESCE((v_q_elem->>'startPage')::INTEGER, (v_q_elem->>'start_page')::INTEGER),
            COALESCE((v_q_elem->>'endPage')::INTEGER, (v_q_elem->>'end_page')::INTEGER),
            COALESCE(v_q_elem->'metadata', '{}'::jsonb),
            timezone('utc'::text, now())
        );
    END LOOP;

    -- Audit Log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        p_student_id,
        'uas_question_set_generated',
        v_user_id,
        NULL,
        jsonb_build_object(
            'questionSetId', v_new_set_id,
            'version', 1,
            'strategy', p_strategy,
            'materialSnapshotId', v_snapshot_id,
            'materialFingerprint', v_material_fingerprint,
            'totalQuestions', 9,
            'mandatoryCount', v_mandatory_count,
            'randomCount', v_random_count,
            'totalMaxScore', v_total_score
        ),
        'Pembuatan otomatis 9 soal UAS berdasarkan finalized material snapshot',
        timezone('utc'::text, now())
    );

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
    INTO v_ret_questions
    FROM exam_questions eq
    WHERE eq.question_set_id = v_new_set_id;

    RETURN jsonb_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Berhasil membuat dan mengunci 9 soal UAS untuk santri.',
        'questionSet', (SELECT row_to_json(eqs.*) FROM exam_question_sets eqs WHERE eqs.id = v_new_set_id),
        'questions', COALESCE(v_ret_questions, '[]'::jsonb)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_examiner_uas_students(p_username text, p_password text, p_period_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_students JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uas' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian bukan periode UAS.');
    END IF;

    SELECT json_agg(json_build_object(
        'studentId', s.id,
        'studentName', s.name,
        'studentNis', s.nis,
        'class', s.class,
        'halaqah', s.halaqah,
        'teacherId', s.teacher_id,
        'teacherName', tu.name,
        'examinerId', COALESCE(a.examiner_user_id, p.teacher_id_snapshot, s.teacher_id),
        'examinerName', COALESCE(eu.name, tu.name, 'Guru Halaqah'),
        'hasAssignment', (a.id IS NOT NULL),
        'snapshotId', snap.id,
        'snapshotStatus', snap.status,
        'startSurahName', snap.start_surah_name,
        'startAyah', snap.start_ayah,
        'endSurahName', snap.end_surah_name,
        'endAyah', snap.end_ayah,
        'memorizationDirection', snap.memorization_direction,
        'questionSetId', qs.id,
        'questionSetStatus', qs.status,
        'questionSetVersion', qs.version,
        'isStale', (
            snap.status = 'finalized' AND qs.status IS NOT NULL AND 
            qs.material_fingerprint != calculate_material_fingerprint(snap.start_surah, snap.start_ayah, snap.end_surah, snap.end_ayah, snap.memorization_direction)
        ),
        'attemptId', att.id,
        'attemptStatus', att.status,
        'attemptNumber', att.attempt_number,
        'totalScore', att.total_score,
        'startedAt', att.started_at,
        'submittedAt', att.submitted_at,
        'completedQuestionsCount', COALESCE((
            SELECT COUNT(*) FROM exam_question_assessments eqa 
            WHERE eqa.exam_attempt_id = att.id AND eqa.completed_at IS NOT NULL
        ), 0)
    ) ORDER BY s.class ASC, s.name ASC) INTO v_students
    FROM exam_participants p
    JOIN students s ON s.id = p.student_id
    LEFT JOIN users tu ON tu.id = s.teacher_id
    LEFT JOIN exam_examiner_assignments a ON a.exam_period_id = p.exam_period_id AND a.student_id = p.student_id
    LEFT JOIN users eu ON eu.id = a.examiner_user_id
    LEFT JOIN exam_material_snapshots snap ON snap.exam_period_id = p.exam_period_id AND snap.student_id = p.student_id
    LEFT JOIN exam_question_sets qs ON qs.exam_period_id = p.exam_period_id AND qs.student_id = p.student_id AND qs.status IN ('locked', 'stale')
    LEFT JOIN exam_attempts att ON att.exam_period_id = p.exam_period_id AND att.student_id = p.student_id AND att.status IN ('in_progress', 'submitted')
    WHERE p.exam_period_id = p_period_id
      AND (
          v_user.role = 'admin' 
          OR a.examiner_user_id = v_user.id
          OR (a.examiner_user_id IS NULL AND (p.teacher_id_snapshot = v_user.id OR s.teacher_id = v_user.id))
      );

    RETURN json_build_object(
        'success', true,
        'period', json_build_object(
            'id', v_period.id,
            'name', v_period.name,
            'kkm', v_period.kkm,
            'status', v_period.status
        ),
        'students', COALESCE(v_students, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_uas_attempt(p_username text, p_password text, p_period_id text, p_student_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_participant RECORD;
    v_snapshot RECORD;
    v_question_set RECORD;
    v_assignment RECORD;
    v_existing_attempt RECORD;
    v_attempt_id TEXT;
    v_questions JSON;
    v_assessments JSON;
    v_q RECORD;
    v_calc_fingerprint TEXT;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uas' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian bukan periode UAS.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    SELECT * INTO v_participant FROM exam_participants 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Santri bukan peserta resmi periode ujian ini.');
    END IF;

    SELECT * INTO v_assignment FROM exam_examiner_assignments 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    
    IF FOUND THEN
        IF v_user.role = 'teacher' AND v_assignment.examiner_user_id != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk santri ini.');
        END IF;
    ELSE
        IF v_user.role = 'teacher' AND v_participant.teacher_id_snapshot != v_user.id AND (SELECT teacher_id FROM students WHERE id = p_student_id) != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan guru halaqah santri ini dan belum ditugaskan sebagai penguji.');
        END IF;

        INSERT INTO exam_examiner_assignments (
            id, exam_period_id, student_id, examiner_user_id, status, assigned_by, assigned_at, created_at, updated_at
        ) VALUES (
            'eea_' || p_period_id || '_' || p_student_id,
            p_period_id, p_student_id, v_user.id, 'assigned', v_user.id, now(), now(), now()
        ) ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
            examiner_user_id = EXCLUDED.examiner_user_id,
            updated_at = now();
    END IF;

    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Materi UAS santri belum difinalisasi.');
    END IF;

    SELECT * INTO v_question_set FROM exam_question_sets 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'locked'
    ORDER BY version DESC LIMIT 1;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal UAS belum dibuat atau terkunci.');
    END IF;

    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal berstatus STALE karena materi berubah.');
    END IF;

    SELECT * INTO v_existing_attempt FROM exam_attempts 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND attempt_number = 1;

    IF FOUND THEN
        IF v_existing_attempt.status = 'submitted' THEN
            RETURN json_build_object('success', false, 'message', 'Ujian santri ini sudah selesai dan telah dikirim (submitted).');
        END IF;

        v_attempt_id := v_existing_attempt.id;
    ELSE
        v_attempt_id := 'att_uas_' || p_period_id || '_' || p_student_id || '_a1';
        
        INSERT INTO exam_attempts (
            id, exam_period_id, student_id, question_set_id, examiner_user_id,
            attempt_number, status, started_at, last_saved_at, total_score, created_at, updated_at
        ) VALUES (
            v_attempt_id, p_period_id, p_student_id, v_question_set.id, v_user.id,
            1, 'in_progress', now(), now(), 0, now(), now()
        );

        FOR v_q IN 
            SELECT * FROM exam_questions 
            WHERE question_set_id = v_question_set.id 
            ORDER BY question_number ASC
        LOOP
            INSERT INTO exam_question_assessments (
                id, exam_attempt_id, exam_question_id, question_number,
                fluency_score, tajwid_score, makhraj_score,
                fluency_events, tajwid_events, makhraj_events,
                question_score, notes, started_at, completed_at, updated_at, version
            ) VALUES (
                'aqa_' || v_attempt_id || '_q' || v_q.question_number,
                v_attempt_id, v_q.id, v_q.question_number,
                6.67, 2.22, 2.22,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                11.11, '', now(), NULL, now(), 1
            );
        END LOOP;

        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            p_period_id, p_student_id, 'uas_exam_started', v_user.id,
            jsonb_build_object('attemptId', v_attempt_id, 'questionSetId', v_question_set.id),
            'Mulai pelaksanaan ujian UAS santri', now()
        );
    END IF;

    SELECT json_agg(json_build_object(
        'id', q.id,
        'questionNumber', q.question_number,
        'zoneNumber', q.zone_number,
        'sourceType', q.source_type,
        'promptStartSurah', q.prompt_start_surah,
        'promptStartAyah', q.prompt_start_ayah,
        'promptStartWord', q.prompt_start_word,
        'promptEndSurah', q.prompt_end_surah,
        'promptEndAyah', q.prompt_end_ayah,
        'promptEndWord', q.prompt_end_word,
        'answerStartSurah', q.answer_start_surah,
        'answerStartAyah', q.answer_start_ayah,
        'answerStartWord', q.answer_start_word,
        'answerEndSurah', q.answer_end_surah,
        'answerEndAyah', q.answer_end_ayah,
        'answerEndWord', q.answer_end_word,
        'startPage', q.start_page,
        'endPage', q.end_page,
        'generatedMetadata', q.generated_metadata
    ) ORDER BY q.question_number ASC) INTO v_questions
    FROM exam_questions q
    WHERE q.question_set_id = v_question_set.id;

    SELECT json_agg(json_build_object(
        'id', a.id,
        'examAttemptId', a.exam_attempt_id,
        'examQuestionId', a.exam_question_id,
        'questionNumber', a.question_number,
        'fluencyScore', a.fluency_score,
        'tajwidScore', a.tajwid_score,
        'makhrajScore', a.makhraj_score,
        'fluencyEvents', a.fluency_events,
        'tajwidEvents', a.tajwid_events,
        'makhrajEvents', a.makhraj_events,
        'questionScore', a.question_score,
        'notes', a.notes,
        'completedAt', a.completed_at,
        'version', a.version
    ) ORDER BY a.question_number ASC) INTO v_assessments
    FROM exam_question_assessments a
    WHERE a.exam_attempt_id = v_attempt_id;

    RETURN json_build_object(
        'success', true,
        'kkm', v_period.kkm,
        'attempt', json_build_object(
            'id', v_attempt_id,
            'examPeriodId', p_period_id,
            'studentId', p_student_id,
            'questionSetId', v_question_set.id,
            'status', 'in_progress',
            'startedAt', now(),
            'lastSavedAt', now()
        ),
        'questions', COALESCE(v_questions, '[]'::json),
        'assessments', COALESCE(v_assessments, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_periods(p_username text, p_password text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_periods JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;
    
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT json_agg(json_build_object(
        'id', p.id,
        'academicTermId', p.academic_term_id,
        'name', p.name,
        'examType', p.exam_type,
        'materialCutoffDate', p.material_cutoff_date,
        'examStartDate', p.exam_start_date,
        'examEndDate', p.exam_end_date,
        'kkm', p.kkm,
        'targetClasses', p.target_classes,
        'targetHalaqahs', p.target_halaqahs,
        'status', p.status,
        'createdBy', p.created_by,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at
    ) ORDER BY p.material_cutoff_date DESC, p.created_at DESC) INTO v_periods
    FROM exam_periods p;

    RETURN json_build_object('success', true, 'data', COALESCE(v_periods, '[]'::json));
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_uas_question_assessment(p_username text, p_password text, p_attempt_id text, p_question_number integer, p_assessment_data jsonb, p_expected_version integer DEFAULT NULL::integer, p_mark_completed boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_attempt RECORD;
    v_question_set RECORD;
    v_snapshot RECORD;
    v_question RECORD;
    v_calc_fingerprint TEXT;
    v_existing_assessment RECORD;
    v_f_events JSONB;
    v_t_events JSONB;
    v_m_events JSONB;
    v_max_fluency NUMERIC(5,2);
    v_max_tajwid NUMERIC(5,2);
    v_max_makhraj NUMERIC(5,2);
    v_max_score NUMERIC(5,2);
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
    v_f_deduction NUMERIC(5,2) := 0;
    v_t_deduction NUMERIC(5,2) := 0;
    v_m_deduction NUMERIC(5,2) := 0;
    v_event JSONB;
    v_ev_type TEXT;
    v_new_version INTEGER;
    v_new_completed_at TIMESTAMP WITH TIME ZONE;
    v_updated_rows INTEGER;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    -- Role Whitelist: Hanya Admin dan Teacher yang diizinkan
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat menilai ujian.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
    END IF;

    -- Read-only check: Tolak setelah submitted
    IF v_attempt.status != 'in_progress' THEN
        RETURN json_build_object('success', false, 'message', 'Ujian telah dikirim dan bersifat read-only.');
    END IF;

    -- Otorisasi penguji: Wajib assigned examiner atau Admin
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji sesi ini.');
    END IF;

    -- 3. Stale Check
    SELECT * INTO v_question_set FROM exam_question_sets WHERE id = v_attempt.question_set_id;
    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;
    
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.status != 'locked' OR v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'isStale', true, 'message', 'Ujian diblokir: Paket soal UAS berstatus STALE karena materi berubah.');
    END IF;

    -- 4. Ambil Assessment Eksisting
    SELECT * INTO v_existing_assessment FROM exam_question_assessments 
    WHERE exam_attempt_id = p_attempt_id AND question_number = p_question_number;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Data nomor soal tidak ditemukan pada sesi ujian.');
    END IF;

    -- Optimistic Concurrency Check
    IF p_expected_version IS NOT NULL AND v_existing_assessment.version != p_expected_version THEN
        RETURN json_build_object(
            'success', false, 
            'isConflict', true, 
            'message', 'Data ujian berubah di perangkat lain. Muat ulang data terbaru.',
            'currentVersion', v_existing_assessment.version
        );
    END IF;

    -- 5. Validasi Metadata Butir Soal (Authoritative)
    SELECT * INTO v_question FROM exam_questions WHERE id = v_existing_assessment.exam_question_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Metadata soal tidak ditemukan pada database.');
    END IF;

    IF v_question.question_role = 'mandatory' THEN
        IF v_question.max_score != 15.00 THEN
            RETURN json_build_object('success', false, 'message', 'Integritas gagal: Soal wajib harus memiliki bobot nilai 15.');
        END IF;
        v_max_fluency := 9.00;
        v_max_tajwid := 3.00;
        v_max_makhraj := 3.00;
        v_max_score := 15.00;
    ELSIF v_question.question_role = 'random' THEN
        IF v_question.max_score != 10.00 THEN
            RETURN json_build_object('success', false, 'message', 'Integritas gagal: Soal acak harus memiliki bobot nilai 10.');
        END IF;
        v_max_fluency := 6.00;
        v_max_tajwid := 2.00;
        v_max_makhraj := 2.00;
        v_max_score := 10.00;
    ELSE
        RETURN json_build_object('success', false, 'message', 'Role butir soal tidak dikenal: ' || v_question.question_role);
    END IF;

    -- 6. Parsing & Server Authoritative Deductions
    v_f_events := COALESCE(p_assessment_data->'fluencyEvents', '[]'::jsonb);
    v_t_events := COALESCE(p_assessment_data->'tajwidEvents', '[]'::jsonb);
    v_m_events := COALESCE(p_assessment_data->'makhrajEvents', '[]'::jsonb);

    -- Kelancaran
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_f_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'self_correction' THEN
            v_f_deduction := v_f_deduction + 0.5;
        ELSIF v_ev_type = 'reminder' THEN
            v_f_deduction := v_f_deduction + 1.0;
        ELSIF v_ev_type = 'prompt' THEN
            v_f_deduction := v_f_deduction + 2.0;
        ELSIF v_ev_type = 'unable' THEN
            v_f_deduction := v_f_deduction + 4.0;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event kelancaran tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_f_score := GREATEST(0.00, v_max_fluency - v_f_deduction);

    -- Tajwid
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_t_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'minor' THEN
            v_t_deduction := v_t_deduction + 0.5;
        ELSIF v_ev_type = 'major' THEN
            v_t_deduction := v_t_deduction + 1.0;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event tajwid tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_t_score := GREATEST(0.00, v_max_tajwid - v_t_deduction);

    -- Makhraj
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_m_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'minor' THEN
            v_m_deduction := v_m_deduction + 0.5;
        ELSIF v_ev_type = 'major' THEN
            v_m_deduction := v_m_deduction + 1.0;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event makhraj tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_m_score := GREATEST(0.00, v_max_makhraj - v_m_deduction);

    v_q_score := LEAST(v_max_score, GREATEST(0.00, v_f_score + v_t_score + v_m_score));
    v_new_version := v_existing_assessment.version + 1;

    -- Tentukan completed_at
    IF p_mark_completed = true OR (p_assessment_data->>'isCompleted')::BOOLEAN = true THEN
        v_new_completed_at := COALESCE(v_existing_assessment.completed_at, now());
    ELSE
        v_new_completed_at := v_existing_assessment.completed_at;
    END IF;

    -- Atomic Update dengan version lock
    UPDATE exam_question_assessments SET
        fluency_score = v_f_score,
        tajwid_score = v_t_score,
        makhraj_score = v_m_score,
        question_score = v_q_score,
        fluency_events = v_f_events,
        tajwid_events = v_t_events,
        makhraj_events = v_m_events,
        notes = p_assessment_data->>'notes',
        completed_at = v_new_completed_at,
        version = v_new_version,
        updated_at = now()
    WHERE id = v_existing_assessment.id
      AND (p_expected_version IS NULL OR version = p_expected_version);

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows = 0 THEN
        RETURN json_build_object(
            'success', false, 
            'isConflict', true, 
            'message', 'Data ujian berubah di perangkat lain. Muat ulang data terbaru.'
        );
    END IF;

    -- Update timestamp attempt
    UPDATE exam_attempts SET last_saved_at = now(), updated_at = now() WHERE id = p_attempt_id;

    -- Audit log jika baru saja ditandai completed
    IF (p_mark_completed = true OR (p_assessment_data->>'isCompleted')::BOOLEAN = true) AND v_existing_assessment.completed_at IS NULL THEN
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            before_data, after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            v_attempt.exam_period_id, v_attempt.student_id, 'uas_question_completed', v_user.id,
            NULL,
            jsonb_build_object(
                'attemptId', p_attempt_id,
                'questionNumber', p_question_number,
                'questionRole', v_question.question_role,
                'questionScore', v_q_score,
                'maxScore', v_max_score
            ),
            'Penguji menyelesaikan butir soal UAS nomor ' || p_question_number, now()
        );
    END IF;

    RETURN json_build_object(
        'success', true,
        'message', 'Penilaian soal UAS nomor ' || p_question_number || ' berhasil disimpan.',
        'assessment', json_build_object(
            'questionNumber', p_question_number,
            'questionRole', v_question.question_role,
            'fluencyScore', v_f_score,
            'tajwidScore', v_t_score,
            'makhrajScore', v_m_score,
            'questionScore', v_q_score,
            'maxScore', v_max_score,
            'completedAt', v_new_completed_at,
            'version', v_new_version,
            'lastSavedAt', now()
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_uas_attempt(p_username text, p_password text, p_attempt_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_attempt RECORD;
    v_period RECORD;
    v_question_set RECORD;
    v_snapshot RECORD;
    v_calc_fingerprint TEXT;
    v_count_total INTEGER;
    v_count_completed INTEGER;
    v_valid_q_count INTEGER;
    v_total_calculated NUMERIC(5,2) := 0;
    v_mandatory_subtotal NUMERIC(5,2) := 0;
    v_random_subtotal NUMERIC(5,2) := 0;
    v_is_passed BOOLEAN;
    v_asm RECORD;
    v_q RECORD;
    v_event JSONB;
    v_ev_type TEXT;
    v_max_fluency NUMERIC(5,2);
    v_max_tajwid NUMERIC(5,2);
    v_max_makhraj NUMERIC(5,2);
    v_max_score NUMERIC(5,2);
    v_f_deduction NUMERIC(5,2);
    v_t_deduction NUMERIC(5,2);
    v_m_deduction NUMERIC(5,2);
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    -- Role Whitelist: Hanya Admin dan Teacher yang diizinkan
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat mengirim ujian.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian UAS tidak ditemukan.');
    END IF;

    -- Otorisasi penguji: Wajib assigned examiner atau Admin (dicek sebelum idempotency return)
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang berwenang untuk sesi ini.');
    END IF;

    -- Idempotency check: jika sudah submitted, return data eksisting
    IF v_attempt.status = 'submitted' THEN
        SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
        RETURN json_build_object(
            'success', true,
            'isExisting', true,
            'message', 'Ujian UAS sudah dikirim dan difinalisasi sebelumnya.',
            'totalScore', v_attempt.total_score,
            'submittedAt', v_attempt.submitted_at,
            'kkm', v_period.kkm,
            'isPassed', (v_attempt.total_score >= v_period.kkm)
        );
    END IF;

    -- 3. Stale Check
    SELECT * INTO v_question_set FROM exam_question_sets WHERE id = v_attempt.question_set_id;
    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;
    
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.status != 'locked' OR v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'isStale', true, 'message', 'Ujian diblokir: Paket soal UAS berstatus STALE karena materi berubah.');
    END IF;

    -- 4. VALIDASI WAJIB 9 BUTIR SOAL DAN KESEMBILANNYA HARUS COMPLETED!
    SELECT COUNT(*), COUNT(*) FILTER (WHERE completed_at IS NOT NULL)
    INTO v_count_total, v_count_completed
    FROM exam_question_assessments
    WHERE exam_attempt_id = p_attempt_id;

    IF v_count_total != 9 OR v_count_completed != 9 THEN
        RETURN json_build_object(
            'success', false, 
            'message', 'Validasi gagal: Seluruh 9 butir soal wajib diselesaikan (completed) sebelum submit final. Saat ini ' || v_count_completed || ' dari 9 soal selesai.'
        );
    END IF;

    -- 5. VALIDASI SOAL BERASAL DARI QUESTION SET RESMI
    SELECT COUNT(*) INTO v_valid_q_count
    FROM exam_question_assessments eqa
    JOIN exam_questions eq ON eq.id = eqa.exam_question_id
    WHERE eqa.exam_attempt_id = p_attempt_id
      AND eq.question_set_id = v_attempt.question_set_id;

    IF v_valid_q_count != 9 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi integritas gagal: Butir soal tidak sesuai dengan paket soal resmi UAS.');
    END IF;

    -- 6. AUTHORITATIVE SERVER-SIDE RECALCULATION (9 BUTIR SOAL)
    v_total_calculated := 0;
    v_mandatory_subtotal := 0;
    v_random_subtotal := 0;

    FOR v_asm IN 
        SELECT a.*, q.question_role, q.max_score AS question_max_score
        FROM exam_question_assessments a
        JOIN exam_questions q ON q.id = a.exam_question_id
        WHERE a.exam_attempt_id = p_attempt_id 
        ORDER BY a.question_number ASC
    LOOP
        v_f_deduction := 0;
        v_t_deduction := 0;
        v_m_deduction := 0;

        IF v_asm.question_role = 'mandatory' THEN
            IF v_asm.question_max_score != 15.00 THEN
                RETURN json_build_object('success', false, 'message', 'Integritas gagal: Soal wajib harus memiliki bobot nilai 15.');
            END IF;
            v_max_fluency := 9.00;
            v_max_tajwid := 3.00;
            v_max_makhraj := 3.00;
            v_max_score := 15.00;
        ELSIF v_asm.question_role = 'random' THEN
            IF v_asm.question_max_score != 10.00 THEN
                RETURN json_build_object('success', false, 'message', 'Integritas gagal: Soal acak harus memiliki bobot nilai 10.');
            END IF;
            v_max_fluency := 6.00;
            v_max_tajwid := 2.00;
            v_max_makhraj := 2.00;
            v_max_score := 10.00;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Role butir soal tidak dikenal: ' || v_asm.question_role);
        END IF;

        -- 1. Fluency events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.fluency_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'self_correction' THEN v_f_deduction := v_f_deduction + 0.5;
            ELSIF v_ev_type = 'reminder' THEN v_f_deduction := v_f_deduction + 1.0;
            ELSIF v_ev_type = 'prompt' THEN v_f_deduction := v_f_deduction + 2.0;
            ELSIF v_ev_type = 'unable' THEN v_f_deduction := v_f_deduction + 4.0;
            END IF;
        END LOOP;
        v_f_score := GREATEST(0.00, v_max_fluency - v_f_deduction);

        -- 2. Tajwid events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.tajwid_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'minor' THEN v_t_deduction := v_t_deduction + 0.5;
            ELSIF v_ev_type = 'major' THEN v_t_deduction := v_t_deduction + 1.0;
            END IF;
        END LOOP;
        v_t_score := GREATEST(0.00, v_max_tajwid - v_t_deduction);

        -- 3. Makhraj events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.makhraj_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'minor' THEN v_m_deduction := v_m_deduction + 0.5;
            ELSIF v_ev_type = 'major' THEN v_m_deduction := v_m_deduction + 1.0;
            END IF;
        END LOOP;
        v_m_score := GREATEST(0.00, v_max_makhraj - v_m_deduction);

        v_q_score := LEAST(v_max_score, GREATEST(0.00, v_f_score + v_t_score + v_m_score));

        -- Update skor authoritative ke database
        UPDATE exam_question_assessments SET
            fluency_score = v_f_score,
            tajwid_score = v_t_score,
            makhraj_score = v_m_score,
            question_score = v_q_score,
            updated_at = now()
        WHERE id = v_asm.id;

        v_total_calculated := v_total_calculated + v_q_score;
        IF v_asm.question_role = 'mandatory' THEN
            v_mandatory_subtotal := v_mandatory_subtotal + v_q_score;
        ELSE
            v_random_subtotal := v_random_subtotal + v_q_score;
        END IF;
    END LOOP;

    v_total_calculated := ROUND(v_total_calculated, 2);
    v_mandatory_subtotal := ROUND(v_mandatory_subtotal, 2);
    v_random_subtotal := ROUND(v_random_subtotal, 2);

    IF v_total_calculated > 100.00 THEN
        RETURN json_build_object('success', false, 'message', 'Integritas nilai gagal: Total nilai melebihi 100.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
    v_is_passed := (v_total_calculated >= v_period.kkm);

    -- Finalisasi status attempt
    UPDATE exam_attempts SET
        status = 'submitted',
        total_score = v_total_calculated,
        submitted_at = now(),
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Tandai status assignment sebagai completed
    UPDATE exam_examiner_assignments SET
        status = 'completed',
        updated_at = now()
    WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;

    -- Audit log kanonikal
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_attempt.exam_period_id, v_attempt.student_id, 'uas_exam_submitted', v_user.id,
        jsonb_build_object('attemptId', p_attempt_id, 'status', 'in_progress'),
        jsonb_build_object(
            'attemptId', p_attempt_id,
            'totalScore', v_total_calculated,
            'mandatorySubtotal', v_mandatory_subtotal,
            'randomSubtotal', v_random_subtotal,
            'kkm', v_period.kkm,
            'isPassed', v_is_passed,
            'status', 'submitted'
        ),
        'Submit final hasil ujian UAS santri', now()
    );

    RETURN json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Hasil ujian UAS berhasil dikirim dan difinalisasi.',
        'totalScore', v_total_calculated,
        'mandatorySubtotal', v_mandatory_subtotal,
        'randomSubtotal', v_random_subtotal,
        'kkm', v_period.kkm,
        'isPassed', v_is_passed,
        'submittedAt', now()
    );
END;
$function$;

COMMIT;
