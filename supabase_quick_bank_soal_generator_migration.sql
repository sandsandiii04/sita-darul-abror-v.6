-- ============================================================
-- SITA — SISTEM INFORMASI TAHFIZ AL-QUR'AN
-- DARUL ABROR ISLAMIC BOARDING SCHOOL
-- FITUR ADITIF: QUICK BANK SOAL GENERATOR (PRE-LIVE MIGRATION)
-- ============================================================
-- CATATAN KEAMANAN:
-- 1. Skrip ini 100% ADITIF: Tidak merusak atau memodifikasi tabel hafalan, absensi,
--    maupun snapshots evaluasi ujian (UTS/UAS/Remedial).
-- 2. Status default butir soal hasil generator adalah 'draft' agar melalui kurasi Admin.
-- 3. Menggunakan SECURITY DEFINER dengan search_path terisolasi dan verifikasi Admin fail-closed.
-- ============================================================

-- RPC: Bulk Insert Question Bank Candidates (Admin Only)
-- Mendukung penyimpanan massal atomik dengan validasi koordinat dan anti-duplikasi ganda
CREATE OR REPLACE FUNCTION bulk_insert_question_bank_candidates(
    p_username TEXT,
    p_password TEXT,
    p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
    v_user_id TEXT;
    v_item JSONB;
    v_len INT;
    v_idx INT;
    
    v_id TEXT;
    v_a_surah INT;
    v_a_ayah INT;
    v_a_word INT;
    v_ae_surah INT;
    v_ae_ayah INT;
    v_ae_word INT;
    v_b_surah INT;
    v_b_ayah INT;
    v_b_word INT;
    v_c_surah INT;
    v_c_ayah INT;
    v_c_word INT;
    v_start_page INT;
    v_end_page INT;
    v_start_juz INT;
    v_end_juz INT;
    v_prompt_text TEXT;
    v_answer_text TEXT;
    v_difficulty TEXT;
    v_status TEXT;
    v_total_expected_words INT;
    
    v_dup_id TEXT;
    v_batch_fingerprints TEXT[] := ARRAY[]::TEXT[];
    v_cur_fp TEXT;
    v_saved_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- 1. Verifikasi Admin Fail-Closed dengan Password Hash / Plaintext
    SELECT id, role INTO v_user_id, v_role FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN jsonb_build_object(
            'success', false, 
            'code', 'UNAUTHORIZED', 
            'message', 'Akses ditolak: Hanya Administrator yang berhak menyimpan Bank Soal secara massal.'
        );
    END IF;

    -- 2. Validasi Struktur Payload Array
    IF jsonb_typeof(p_items) <> 'array' THEN
        RETURN jsonb_build_object(
            'success', false, 
            'code', 'INVALID_PAYLOAD', 
            'message', 'Payload p_items harus berupa JSON array.'
        );
    END IF;

    v_len := jsonb_array_length(p_items);
    IF v_len = 0 THEN
        RETURN jsonb_build_object(
            'success', false, 
            'code', 'EMPTY_BATCH', 
            'message', 'Daftar kandidat soal tidak boleh kosong.'
        );
    END IF;

    IF v_len > 200 THEN
        RETURN jsonb_build_object(
            'success', false, 
            'code', 'BATCH_TOO_LARGE', 
            'message', 'Maksimal 200 kandidat soal dalam satu kali penyimpanan massal.'
        );
    END IF;

    -- 3. PASS 1: VALIDASI SEMUA ITEM TERLEBIH DAHULU (FAIL-CLOSED ATOMIC REJECT)
    FOR v_idx IN 0..(v_len - 1) LOOP
        v_item := p_items->v_idx;

        v_a_surah := (v_item->'prompt_start'->>'surah')::INT;
        v_a_ayah  := (v_item->'prompt_start'->>'ayah')::INT;
        v_a_word  := (v_item->'prompt_start'->>'word')::INT;

        v_ae_surah := (v_item->'prompt_end'->>'surah')::INT;
        v_ae_ayah  := (v_item->'prompt_end'->>'ayah')::INT;
        v_ae_word  := (v_item->'prompt_end'->>'word')::INT;

        v_b_surah := (v_item->'answer_start'->>'surah')::INT;
        v_b_ayah  := (v_item->'answer_start'->>'ayah')::INT;
        v_b_word  := (v_item->'answer_start'->>'word')::INT;

        v_c_surah := (v_item->'answer_end'->>'surah')::INT;
        v_c_ayah  := (v_item->'answer_end'->>'ayah')::INT;
        v_c_word  := (v_item->'answer_end'->>'word')::INT;

        v_start_page := (v_item->>'start_page')::INT;
        v_end_page   := (v_item->>'end_page')::INT;
        v_start_juz  := (v_item->>'start_juz')::INT;
        v_end_juz    := (v_item->>'end_juz')::INT;
        v_difficulty := COALESCE(v_item->>'difficulty', 'medium');
        v_status     := COALESCE(v_item->>'status', 'draft');

        -- A. Validasi Range Batasan Mushaf
        IF v_a_surah < 1 OR v_a_surah > 114 OR v_ae_surah < 1 OR v_ae_surah > 114 OR
           v_b_surah < 1 OR v_b_surah > 114 OR v_c_surah < 1 OR v_c_surah > 114 THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_COORDINATES',
                'error_index', v_idx,
                'message', format('Item #%s: Nomor surat harus antara 1 dan 114.', v_idx + 1)
            );
        END IF;

        IF v_start_page < 1 OR v_start_page > 604 OR v_end_page < 1 OR v_end_page > 604 THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_COORDINATES',
                'error_index', v_idx,
                'message', format('Item #%s: Halaman mushaf harus antara 1 dan 604.', v_idx + 1)
            );
        END IF;

        IF v_start_juz < 1 OR v_start_juz > 30 OR v_end_juz < 1 OR v_end_juz > 30 THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_COORDINATES',
                'error_index', v_idx,
                'message', format('Item #%s: Juz Al-Qur''an harus antara 1 dan 30.', v_idx + 1)
            );
        END IF;

        -- B. Validasi Urutan Titik A <= A' < B <= C
        IF (v_a_surah > v_ae_surah) OR 
           (v_a_surah = v_ae_surah AND v_a_ayah > v_ae_ayah) OR 
           (v_a_surah = v_ae_surah AND v_a_ayah = v_ae_ayah AND v_a_word > v_ae_word) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_COORDINATES',
                'error_index', v_idx,
                'message', format('Item #%s: Titik awal prompt A tidak boleh melebihi akhir prompt A''.', v_idx + 1)
            );
        END IF;

        IF (v_ae_surah > v_b_surah) OR 
           (v_ae_surah = v_b_surah AND v_ae_ayah > v_b_ayah) OR 
           (v_ae_surah = v_b_surah AND v_ae_ayah = v_b_ayah AND v_ae_word >= v_b_word) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_COORDINATES',
                'error_index', v_idx,
                'message', format('Item #%s: Titik awal jawaban B harus setelah akhir prompt A''.', v_idx + 1)
            );
        END IF;

        IF (v_b_surah > v_c_surah) OR 
           (v_b_surah = v_c_surah AND v_b_ayah > v_c_ayah) OR 
           (v_b_surah = v_c_surah AND v_b_ayah = v_c_ayah AND v_b_word > v_c_word) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_COORDINATES',
                'error_index', v_idx,
                'message', format('Item #%s: Titik awal jawaban B tidak boleh melebihi batas akhir C.', v_idx + 1)
            );
        END IF;

        -- C. Cek Duplikasi di Dalam Batch (Intra-batch Duplication Check)
        v_cur_fp := format('%s:%s:%s_%s:%s:%s_%s:%s:%s_%s:%s:%s',
            v_a_surah, v_a_ayah, v_a_word,
            v_ae_surah, v_ae_ayah, v_ae_word,
            v_b_surah, v_b_ayah, v_b_word,
            v_c_surah, v_c_ayah, v_c_word
        );

        IF v_cur_fp = ANY(v_batch_fingerprints) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'DUPLICATE_IN_BATCH',
                'error_index', v_idx,
                'message', format('Item #%s: Terdapat butir soal dengan koordinat persis sama di dalam batch penyimpanan yang sama.', v_idx + 1)
            );
        END IF;
        v_batch_fingerprints := array_append(v_batch_fingerprints, v_cur_fp);

        -- D. Cek Duplikasi terhadap Database Eksisting (Inter-table Duplication Check / Race Condition Guard)
        SELECT id INTO v_dup_id FROM question_bank
        WHERE prompt_start_surah = v_a_surah AND prompt_start_ayah = v_a_ayah AND prompt_start_word = v_a_word
          AND prompt_end_surah = v_ae_surah AND prompt_end_ayah = v_ae_ayah AND prompt_end_word = v_ae_word
          AND answer_start_surah = v_b_surah AND answer_start_ayah = v_b_ayah AND answer_start_word = v_b_word
          AND answer_end_surah = v_c_surah AND answer_end_ayah = v_c_ayah AND answer_end_word = v_c_word
        LIMIT 1;

        IF v_dup_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'DUPLICATE_QUESTION',
                'error_index', v_idx,
                'existing_id', v_dup_id,
                'message', format('Item #%s: Soal sudah ada di Bank Soal dengan ID %s.', v_idx + 1, v_dup_id)
            );
        END IF;
    END LOOP;

    -- 4. PASS 2: EKSEKUSI INSERT SELURUH ITEM (SEMUA TERJAMIN VALID)
    FOR v_idx IN 0..(v_len - 1) LOOP
        v_item := p_items->v_idx;

        v_id := COALESCE(v_item->>'id', 'qb_' || floor(extract(epoch from now()))::text || '_' || substr(md5(random()::text), 1, 6));

        v_a_surah := (v_item->'prompt_start'->>'surah')::INT;
        v_a_ayah  := (v_item->'prompt_start'->>'ayah')::INT;
        v_a_word  := (v_item->'prompt_start'->>'word')::INT;

        v_ae_surah := (v_item->'prompt_end'->>'surah')::INT;
        v_ae_ayah  := (v_item->'prompt_end'->>'ayah')::INT;
        v_ae_word  := (v_item->'prompt_end'->>'word')::INT;

        v_b_surah := (v_item->'answer_start'->>'surah')::INT;
        v_b_ayah  := (v_item->'answer_start'->>'ayah')::INT;
        v_b_word  := (v_item->'answer_start'->>'word')::INT;

        v_c_surah := (v_item->'answer_end'->>'surah')::INT;
        v_c_ayah  := (v_item->'answer_end'->>'ayah')::INT;
        v_c_word  := (v_item->'answer_end'->>'word')::INT;

        v_start_page := (v_item->>'start_page')::INT;
        v_end_page   := (v_item->>'end_page')::INT;
        v_start_juz  := (v_item->>'start_juz')::INT;
        v_end_juz    := (v_item->>'end_juz')::INT;

        v_prompt_text := COALESCE(v_item->>'prompt_text', '');
        v_answer_text := COALESCE(v_item->>'answer_text', '');
        v_total_expected_words := COALESCE((v_item->>'total_expected_words')::INT, 0);
        v_difficulty := COALESCE(v_item->>'difficulty', 'medium');
        v_status     := COALESCE(v_item->>'status', 'draft');

        INSERT INTO question_bank (
            id,
            exam_type,
            question_type,
            question_format,
            prompt_start_surah,
            prompt_start_ayah,
            prompt_start_word,
            prompt_end_surah,
            prompt_end_ayah,
            prompt_end_word,
            answer_start_surah,
            answer_start_ayah,
            answer_start_word,
            answer_end_surah,
            answer_end_ayah,
            answer_end_word,
            start_page,
            end_page,
            start_juz,
            end_juz,
            prompt_text,
            answer_text,
            total_expected_words,
            answer_mode,
            difficulty,
            tags,
            notes,
            status,
            created_by,
            created_at,
            updated_at
        ) VALUES (
            v_id,
            COALESCE(v_item->>'exam_type', 'generic'),
            COALESCE(v_item->>'question_type', 'random'),
            'continuation',
            v_a_surah,
            v_a_ayah,
            v_a_word,
            v_ae_surah,
            v_ae_ayah,
            v_ae_word,
            v_b_surah,
            v_b_ayah,
            v_b_word,
            v_c_surah,
            v_c_ayah,
            v_c_word,
            v_start_page,
            v_end_page,
            v_start_juz,
            v_end_juz,
            v_prompt_text,
            v_answer_text,
            v_total_expected_words,
            COALESCE(v_item->>'answer_mode', 'end_ayah'),
            v_difficulty,
            COALESCE(v_item->'tags', '["quick_generator"]'::jsonb),
            COALESCE(v_item->>'notes', 'Dihasilkan otomatis oleh Quick Bank Soal Generator'),
            v_status,
            v_user_id,
            timezone('utc'::text, now()),
            timezone('utc'::text, now())
        );

        v_saved_ids := array_append(v_saved_ids, v_id);
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'saved_count', array_length(v_saved_ids, 1),
        'saved_ids', to_jsonb(v_saved_ids),
        'message', format('%s kandidat soal berhasil disimpan ke Bank Soal.', array_length(v_saved_ids, 1))
    );
END;
$$;
