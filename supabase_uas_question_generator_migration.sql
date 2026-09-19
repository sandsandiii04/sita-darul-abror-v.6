-- ============================================================
-- SQL Migration: Tahap 6A — Engine Generator Soal UAS Tahfiz
-- Darul Abror IBS (Non-Destructive Additive Hardened Migration)
-- ============================================================

-- 1. MODIFIKASI ADITIF TABEL: exam_questions
-- Menambahkan kolom role, page_number, max_score untuk mendukung
-- 2 Soal Wajib Halaman Penuh (bobot 15) dan 7 Soal Acak 7-Zona (bobot 10)
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS question_role TEXT NOT NULL DEFAULT 'random' CHECK (question_role IN ('mandatory', 'random'));
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS page_number INTEGER CHECK (page_number BETWEEN 1 AND 604);
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS max_score NUMERIC(5,2) DEFAULT 20.00;

-- Relaksasi question_number: 1..9 (1..5 untuk UTS, 1..9 untuk UAS)
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS exam_questions_question_number_check;
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS chk_eq_question_number;
ALTER TABLE exam_questions ADD CONSTRAINT chk_eq_question_number CHECK (question_number BETWEEN 1 AND 9);

-- Relaksasi zone_number: nullable untuk Soal Wajib (halaman penuh), 1..7 untuk Soal Acak
ALTER TABLE exam_questions ALTER COLUMN zone_number DROP NOT NULL;
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS exam_questions_zone_number_check;
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS chk_eq_zone_number;
ALTER TABLE exam_questions ADD CONSTRAINT chk_eq_zone_number CHECK (zone_number IS NULL OR (zone_number BETWEEN 1 AND 7));

-- Relaksasi koordinat prompt: nullable untuk Soal Wajib Halaman Penuh
ALTER TABLE exam_questions ALTER COLUMN prompt_start_surah DROP NOT NULL;
ALTER TABLE exam_questions ALTER COLUMN prompt_start_ayah DROP NOT NULL;
ALTER TABLE exam_questions ALTER COLUMN prompt_start_word DROP NOT NULL;
ALTER TABLE exam_questions ALTER COLUMN prompt_end_surah DROP NOT NULL;
ALTER TABLE exam_questions ALTER COLUMN prompt_end_ayah DROP NOT NULL;
ALTER TABLE exam_questions ALTER COLUMN prompt_end_word DROP NOT NULL;

-- Relaksasi constraint keunikan zona: ganti dengan partial unique index di mana zone_number IS NOT NULL
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS uq_eq_set_zone;
DROP INDEX IF EXISTS uq_eq_set_zone_not_null;
CREATE UNIQUE INDEX IF NOT EXISTS uq_eq_set_zone_not_null ON exam_questions (question_set_id, zone_number) WHERE zone_number IS NOT NULL;

-- KLAUSUL AUDIT 7 & 8: Constraint Safety berdasarkan question_role
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS chk_eq_role_fields;
ALTER TABLE exam_questions ADD CONSTRAINT chk_eq_role_fields CHECK (
    (
        question_role = 'random' AND
        prompt_start_surah IS NOT NULL AND prompt_start_ayah IS NOT NULL AND prompt_start_word IS NOT NULL AND
        prompt_end_surah IS NOT NULL AND prompt_end_ayah IS NOT NULL AND prompt_end_word IS NOT NULL AND
        zone_number IS NOT NULL AND zone_number BETWEEN 1 AND 7
    ) OR (
        question_role = 'mandatory' AND
        page_number IS NOT NULL AND page_number BETWEEN 1 AND 604 AND
        answer_start_surah IS NOT NULL AND answer_start_ayah IS NOT NULL AND answer_start_word IS NOT NULL AND
        answer_end_surah IS NOT NULL AND answer_end_ayah IS NOT NULL AND answer_end_word IS NOT NULL AND
        zone_number IS NULL
    )
);

-- Constraint urutan jawaban B <= C untuk seluruh soal
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS chk_eq_b_lte_c;
ALTER TABLE exam_questions ADD CONSTRAINT chk_eq_b_lte_c CHECK (
    (answer_start_surah < answer_end_surah) OR
    (answer_start_surah = answer_end_surah AND answer_start_ayah < answer_end_ayah) OR
    (answer_start_surah = answer_end_surah AND answer_start_ayah = answer_end_ayah AND answer_start_word <= answer_end_word)
);

-- Constraint urutan titik soal: Khusus Soal Acak (sambung ayat) A <= A-aksen < B
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS chk_eq_a_lte_a_end;
ALTER TABLE exam_questions ADD CONSTRAINT chk_eq_a_lte_a_end CHECK (
    question_role = 'mandatory' OR
    (prompt_start_surah < prompt_end_surah) OR 
    (prompt_start_surah = prompt_end_surah AND prompt_start_ayah < prompt_end_ayah) OR 
    (prompt_start_surah = prompt_end_surah AND prompt_start_ayah = prompt_end_ayah AND prompt_start_word <= prompt_end_word)
);

ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS chk_eq_a_end_lt_b;
ALTER TABLE exam_questions ADD CONSTRAINT chk_eq_a_end_lt_b CHECK (
    question_role = 'mandatory' OR
    (prompt_end_surah < answer_start_surah) OR 
    (prompt_end_surah = answer_start_surah AND prompt_end_ayah < answer_start_ayah) OR 
    (prompt_end_surah = answer_start_surah AND prompt_end_ayah = answer_start_ayah AND prompt_end_word < answer_start_word)
);


-- ============================================================
-- 2. MODIFIKASI ADITIF TABEL: question_bank
-- Mendukung kurasi soal wajib halaman penuh (full_page) oleh koordinator/admin
-- ============================================================
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS question_format TEXT NOT NULL DEFAULT 'continuation' CHECK (question_format IN ('continuation', 'full_page'));
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS page_number INTEGER CHECK (page_number BETWEEN 1 AND 604);

ALTER TABLE question_bank ALTER COLUMN prompt_start_surah DROP NOT NULL;
ALTER TABLE question_bank ALTER COLUMN prompt_start_ayah DROP NOT NULL;
ALTER TABLE question_bank ALTER COLUMN prompt_start_word DROP NOT NULL;
ALTER TABLE question_bank ALTER COLUMN prompt_end_surah DROP NOT NULL;
ALTER TABLE question_bank ALTER COLUMN prompt_end_ayah DROP NOT NULL;
ALTER TABLE question_bank ALTER COLUMN prompt_end_word DROP NOT NULL;

-- KLAUSUL AUDIT 7 & 8: Constraint format dan konsistensi tipe bank soal
ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS chk_qb_format_fields;
ALTER TABLE question_bank ADD CONSTRAINT chk_qb_format_fields CHECK (
    (
        question_format = 'continuation' AND
        prompt_start_surah IS NOT NULL AND prompt_start_ayah IS NOT NULL AND prompt_start_word IS NOT NULL AND
        prompt_end_surah IS NOT NULL AND prompt_end_ayah IS NOT NULL AND prompt_end_word IS NOT NULL
    ) OR (
        question_format = 'full_page' AND
        page_number IS NOT NULL AND page_number BETWEEN 1 AND 604
    )
);

ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS chk_qb_type_format_consistency;
ALTER TABLE question_bank ADD CONSTRAINT chk_qb_type_format_consistency CHECK (
    (question_type = 'mandatory' AND question_format = 'full_page') OR
    (question_type = 'random' AND question_format = 'continuation')
);

ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS chk_qb_a_end_lt_b;
ALTER TABLE question_bank ADD CONSTRAINT chk_qb_a_end_lt_b CHECK (
    question_format = 'full_page' OR
    (prompt_end_surah < answer_start_surah) OR 
    (prompt_end_surah = answer_start_surah AND prompt_end_ayah < answer_start_ayah) OR 
    (prompt_end_surah = answer_start_surah AND prompt_end_ayah = answer_start_ayah AND prompt_end_word < answer_start_word)
);


-- ============================================================
-- 3. STORED PROCEDURES (SECURITY DEFINER RPC) UNTUK UAS
-- ============================================================

-- A. GENERATE UAS QUESTION SET
DROP FUNCTION IF EXISTS generate_uas_question_set;
CREATE OR REPLACE FUNCTION generate_uas_question_set(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT,
    p_student_id TEXT,
    p_strategy TEXT DEFAULT 'hybrid',
    p_seed TEXT DEFAULT NULL,
    p_questions JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
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
    SELECT id, role INTO v_user_id, v_user_role
    FROM users
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Kredensial tidak valid.');
    END IF;

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
$$;


-- B. REGENERATE UAS QUESTION SET
DROP FUNCTION IF EXISTS regenerate_uas_question_set;
CREATE OR REPLACE FUNCTION regenerate_uas_question_set(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT,
    p_student_id TEXT,
    p_reason TEXT,
    p_strategy TEXT DEFAULT 'hybrid',
    p_seed TEXT DEFAULT NULL,
    p_questions JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id TEXT;
    v_user_role TEXT;
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
    v_old_set_id TEXT;
    v_old_version INTEGER;
    v_new_version INTEGER;
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
    -- 1. Autentikasi Admin
    SELECT id, role INTO v_user_id, v_user_role
    FROM users
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Kredensial tidak valid.');
    END IF;

    IF v_user_role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berwenang meregenerasi soal UAS.');
    END IF;

    -- 2. Alasan Wajib Diisi
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Alasan regenerasi soal UAS wajib diisi.');
    END IF;

    -- 3. Snapshot Aktif Finalized
    SELECT id, status, start_surah, start_ayah, end_surah, end_ayah,
           calculate_material_fingerprint(start_surah, start_ayah, end_surah, end_ayah, COALESCE(memorization_direction, 'forward'))
    INTO v_snapshot_id, v_snapshot_status, v_snap_start_surah, v_snap_start_ayah, v_snap_end_surah, v_snap_end_ayah, v_material_fingerprint
    FROM exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF v_snapshot_status != 'finalized' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Materi UAS santri belum difinalisasi.');
    END IF;

    -- Batas canonical snapshot
    v_snap_min_surah := LEAST(v_snap_start_surah, v_snap_end_surah);
    v_snap_max_surah := GREATEST(v_snap_start_surah, v_snap_end_surah);
    IF v_snap_start_surah = v_snap_end_surah THEN
        v_snap_min_ayah := LEAST(v_snap_start_ayah, v_snap_end_ayah);
        v_snap_max_ayah := GREATEST(v_snap_start_ayah, v_snap_end_ayah);
    ELSE
        v_snap_min_ayah := CASE WHEN v_snap_start_surah < v_snap_end_surah THEN v_snap_start_ayah ELSE v_snap_end_ayah END;
        v_snap_max_ayah := CASE WHEN v_snap_start_surah > v_snap_end_surah THEN v_snap_start_ayah ELSE v_snap_end_ayah END;
    END IF;

    -- 4. Validasi Struktur 9 Soal Baru
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

        v_as_surah := COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER);
        v_as_ayah := COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER);
        v_as_word := COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER);

        v_ae_surah := COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER);
        v_ae_ayah := COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER);
        v_ae_word := COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER);

        -- Koordinat dasar
        IF v_as_surah NOT BETWEEN 1 AND 114 OR v_as_ayah < 1 OR v_as_word < 1 OR
           v_ae_surah NOT BETWEEN 1 AND 114 OR v_ae_ayah < 1 OR v_ae_word < 1 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Koordinat ayat/kata butir soal ' || v_q_num || ' tidak valid.');
        END IF;

        IF (v_as_surah > v_ae_surah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah > v_ae_ayah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah = v_ae_ayah AND v_as_word > v_ae_word) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Urutan jawaban B ke C pada butir soal ' || v_q_num || ' tidak valid.');
        END IF;

        IF (v_as_surah < v_snap_min_surah) OR (v_as_surah = v_snap_min_surah AND v_as_ayah < v_snap_min_ayah) OR
           (v_ae_surah > v_snap_max_surah) OR (v_ae_surah = v_snap_max_surah AND v_ae_ayah > v_snap_max_ayah) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Titik soal nomor ' || v_q_num || ' berada di luar batas snapshot materi santri.');
        END IF;

        v_total_score := v_total_score + v_q_score;

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

            IF v_q_source = 'bank' THEN
                IF v_q_bank_id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Soal wajib bank harus menyertakan questionBankId.');
                END IF;

                SELECT id, status, exam_type, question_type, question_format, page_number
                INTO v_bank_row
                FROM question_bank
                WHERE id = v_q_bank_id;

                IF v_bank_row.id IS NULL OR v_bank_row.status != 'active' OR v_bank_row.exam_type NOT IN ('uas', 'generic') OR
                   v_bank_row.question_type != 'mandatory' OR v_bank_row.question_format != 'full_page' OR v_bank_row.page_number != v_q_page THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Validasi Bank Soal ID ' || v_q_bank_id || ' gagal.');
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

            v_ps_surah := (v_q_elem->'promptStart'->>'surahNumber')::INTEGER;
            v_ps_ayah := (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER;
            v_ps_word := (v_q_elem->'promptStart'->>'wordPosition')::INTEGER;

            v_pe_surah := (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER;
            v_pe_ayah := (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER;
            v_pe_word := (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER;

            IF v_ps_surah IS NULL OR v_pe_surah IS NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak sambung ayat wajib memiliki prompt penguji A dan A-aksen.');
            END IF;

            IF (v_ps_surah > v_pe_surah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah > v_pe_ayah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah = v_pe_ayah AND v_ps_word > v_pe_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Urutan prompt A ke A-aksen soal ' || v_q_num || ' tidak valid.');
            END IF;

            IF (v_pe_surah > v_as_surah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah > v_as_ayah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah = v_as_ayah AND v_pe_word >= v_as_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal jawaban B harus setelah prompt A-aksen pada butir soal ' || v_q_num || '.');
            END IF;

            v_b_key := v_as_surah || ':' || v_as_ayah || ':' || v_as_word;
            IF v_b_key = ANY(v_used_random_b) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal B soal acak harus unik (ditemukan duplikasi: ' || v_b_key || ').');
            END IF;
            v_used_random_b := array_append(v_used_random_b, v_b_key);

            IF v_q_source = 'bank' THEN
                IF v_q_bank_id IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Soal acak bank harus menyertakan questionBankId.');
                END IF;

                SELECT id, status, exam_type, question_type, question_format
                INTO v_bank_row
                FROM question_bank
                WHERE id = v_q_bank_id;

                IF v_bank_row.id IS NULL OR v_bank_row.status != 'active' OR v_bank_row.exam_type NOT IN ('uas', 'generic') OR
                   v_bank_row.question_type != 'random' OR v_bank_row.question_format != 'continuation' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Validasi Bank Soal ID ' || v_q_bank_id || ' gagal.');
                END IF;
            END IF;
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Role soal tidak valid: ' || v_q_role);
        END IF;
    END LOOP;

    IF v_mandatory_count != 2 OR v_random_count != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Struktur soal UAS harus tepat 2 soal wajib dan 7 soal acak.');
    END IF;

    IF array_length(v_used_zones, 1) != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Tepat 7 zona (Zona 1 s.d. 7) harus terpenuhi.');
    END IF;

    IF v_total_score != 100 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Total bobot nilai soal UAS harus 100. Terhitung: ' || v_total_score);
    END IF;

    -- 5. Ambil Versi Terakhir
    SELECT id, version INTO v_old_set_id, v_old_version
    FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id
    ORDER BY version DESC
    LIMIT 1;

    v_new_version := COALESCE(v_old_version, 0) + 1;

    -- Void paket lama
    IF v_old_set_id IS NOT NULL THEN
        UPDATE exam_question_sets
        SET status = 'void', updated_at = timezone('utc'::text, now())
        WHERE id = v_old_set_id;

        -- Audit Log: uas_question_set_voided
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            before_data, after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            p_period_id,
            p_student_id,
            'uas_question_set_voided',
            v_user_id,
            jsonb_build_object('voidedSetId', v_old_set_id, 'version', v_old_version),
            NULL,
            p_reason,
            timezone('utc'::text, now())
        );
    END IF;

    -- 6. Buat Paket Baru
    v_final_seed := COALESCE(p_seed, 'seed_uas_' || p_period_id || '_' || p_student_id || '_v' || v_new_version || '_' || floor(extract(epoch from now())));
    v_new_set_id := 'eqs_uas_' || p_period_id || '_' || p_student_id || '_v' || v_new_version;

    INSERT INTO exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id, version,
        generation_strategy, generation_seed, material_fingerprint, status,
        generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_new_set_id, p_period_id, p_student_id, v_snapshot_id, v_new_version,
        COALESCE(p_strategy, 'hybrid'), v_final_seed, v_material_fingerprint, 'locked',
        v_user_id, timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())
    );

    -- Simpan 9 butir soal baru
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

    -- Audit Log: uas_question_set_regenerated
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        p_student_id,
        'uas_question_set_regenerated',
        v_user_id,
        jsonb_build_object(
            'oldQuestionSetId', v_old_set_id,
            'oldVersion', v_old_version
        ),
        jsonb_build_object(
            'questionSetId', v_new_set_id,
            'newVersion', v_new_version,
            'strategy', p_strategy,
            'status', 'locked',
            'questionsCount', 9,
            'mandatoryCount', v_mandatory_count,
            'randomCount', v_random_count,
            'totalMaxScore', v_total_score
        ),
        p_reason,
        timezone('utc'::text, now())
    );

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
    INTO v_ret_questions
    FROM exam_questions eq
    WHERE eq.question_set_id = v_new_set_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Berhasil meregenerasi 9 soal UAS untuk santri.',
        'questionSet', (SELECT row_to_json(eqs.*) FROM exam_question_sets eqs WHERE eqs.id = v_new_set_id),
        'questions', COALESCE(v_ret_questions, '[]'::jsonb)
    );
END;
$$;


-- C. GET UAS QUESTION SET
DROP FUNCTION IF EXISTS get_uas_question_set;
CREATE OR REPLACE FUNCTION get_uas_question_set(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT,
    p_student_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id TEXT;
    v_user_role TEXT;
    v_snapshot_status TEXT;
    v_current_fingerprint TEXT;
    v_set_row RECORD;
    v_ret_questions JSONB;
    v_is_stale BOOLEAN := false;
BEGIN
    SELECT id, role INTO v_user_id, v_user_role
    FROM users
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Kredensial tidak valid.');
    END IF;

    IF v_user_role NOT IN ('admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    -- Ambil paket soal terkunci aktif
    SELECT * INTO v_set_row
    FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'locked'
    ORDER BY version DESC
    LIMIT 1;

    IF v_set_row.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket soal UAS belum dibuat atau tidak aktif.');
    END IF;

    -- Cek status stale terhadap snapshot terkini
    SELECT status, calculate_material_fingerprint(start_surah, start_ayah, end_surah, end_ayah, COALESCE(memorization_direction, 'forward'))
    INTO v_snapshot_status, v_current_fingerprint
    FROM exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF v_current_fingerprint IS NOT NULL AND v_set_row.material_fingerprint != v_current_fingerprint THEN
        v_is_stale := true;
    END IF;

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
    INTO v_ret_questions
    FROM exam_questions eq
    WHERE eq.question_set_id = v_set_row.id;

    RETURN jsonb_build_object(
        'success', true,
        'isStale', v_is_stale,
        'questionSet', row_to_json(v_set_row),
        'questions', COALESCE(v_ret_questions, '[]'::jsonb)
    );
END;
$$;
