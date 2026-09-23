-- =========================================================================
-- SQL MIGRATION: TAHAP 8B.2 — CORE DATABASE & BACKEND RPC HARDENING
-- SITA — Sistem Informasi Tahfidz Al-Qur'an Darul Abror IBS
-- =========================================================================
-- Non-Destructive Migration & Deterministic Server-Authoritative Engine
-- Scope: Flexible UTS Question Count (5, 10, 15, 20), Proportional Rubric,
--        Examiner Notes, and Zero UAS/Remedial Regressions.
-- =========================================================================

-- =========================================================================
-- 1. DDL SCHEMA ENHANCEMENTS & CONSTRAINT RELAXATION
-- =========================================================================

-- 1.1 exam_questions: Dukung nomor soal dan zona dinamis (1..20)
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS chk_eq_question_number;
ALTER TABLE exam_questions ADD CONSTRAINT chk_eq_question_number CHECK (question_number BETWEEN 1 AND 20);

ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS chk_eq_zone_number;
ALTER TABLE exam_questions ADD CONSTRAINT chk_eq_zone_number CHECK (zone_number IS NULL OR (zone_number BETWEEN 1 AND 20));

ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS chk_eq_role_fields;
ALTER TABLE exam_questions ADD CONSTRAINT chk_eq_role_fields CHECK (
    question_role IS NULL OR
    (
        question_role = 'random' AND
        prompt_start_surah IS NOT NULL AND prompt_start_ayah IS NOT NULL AND prompt_start_word IS NOT NULL AND
        prompt_end_surah IS NOT NULL AND prompt_end_ayah IS NOT NULL AND prompt_end_word IS NOT NULL AND
        zone_number IS NOT NULL AND zone_number BETWEEN 1 AND 20
    ) OR (
        question_role = 'mandatory' AND
        page_number IS NOT NULL AND page_number BETWEEN 1 AND 604 AND
        answer_start_surah IS NOT NULL AND answer_start_ayah IS NOT NULL AND answer_start_word IS NOT NULL AND
        answer_end_surah IS NOT NULL AND answer_end_ayah IS NOT NULL AND answer_end_word IS NOT NULL AND
        zone_number IS NULL
    )
);

-- 1.2 exam_question_assessments: Dukung nomor soal dinamis (1..20)
ALTER TABLE exam_question_assessments DROP CONSTRAINT IF EXISTS exam_question_assessments_question_number_check;
ALTER TABLE exam_question_assessments ADD CONSTRAINT exam_question_assessments_question_number_check CHECK (question_number BETWEEN 1 AND 20);

-- Relaksasi sub-score checks jika ada agar mendukung plafon dinamis (>= 0 dan <= 20)
ALTER TABLE exam_question_assessments DROP CONSTRAINT IF EXISTS chk_eqa_fluency_score;
ALTER TABLE exam_question_assessments DROP CONSTRAINT IF EXISTS chk_eqa_tajwid_score;
ALTER TABLE exam_question_assessments DROP CONSTRAINT IF EXISTS chk_eqa_makhraj_score;
ALTER TABLE exam_question_assessments DROP CONSTRAINT IF EXISTS chk_eqa_question_score;

-- 1.3 exam_periods: Konfigurasi jumlah soal UTS (5, 10, 15, 20)
ALTER TABLE exam_periods ADD COLUMN IF NOT EXISTS uts_question_count INTEGER DEFAULT 5;
ALTER TABLE exam_periods DROP CONSTRAINT IF EXISTS chk_ep_uts_question_count;
ALTER TABLE exam_periods ADD CONSTRAINT chk_ep_uts_question_count CHECK (uts_question_count IN (5, 10, 15, 20));

-- 1.4 exam_question_sets: Snapshot total_questions pada set
ALTER TABLE exam_question_sets ADD COLUMN IF NOT EXISTS total_questions INTEGER NOT NULL DEFAULT 5;

-- 1.5 exam_attempts: Catatan Penguji (Opsional, Maks 500 Karakter)
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS examiner_notes TEXT;
ALTER TABLE exam_attempts DROP CONSTRAINT IF EXISTS chk_ea_examiner_notes_length;
ALTER TABLE exam_attempts ADD CONSTRAINT chk_ea_examiner_notes_length CHECK (examiner_notes IS NULL OR char_length(examiner_notes) <= 500);

-- Pastikan exam_questions memiliki kolom max_score jika belum ada
ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS max_score NUMERIC(5,2) DEFAULT 20.00;


-- =========================================================================
-- 2. STORED PROCEDURE: generate_uts_question_set
-- =========================================================================
DROP FUNCTION IF EXISTS generate_uts_question_set(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION generate_uts_question_set(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT,
    p_student_id TEXT,
    p_strategy TEXT,
    p_questions_data JSONB,
    p_seed TEXT,
    p_fingerprint TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_participant RECORD;
    v_snapshot RECORD;
    v_existing_set RECORD;
    v_calculated_fingerprint TEXT;
    v_version INTEGER := 1;
    v_set_id TEXT;
    v_q JSONB;
    v_inserted_questions JSON;
    v_q_count INTEGER;
    v_expected_q_count INTEGER;
    v_q_max NUMERIC(5,2);
    v_q_num INTEGER;
BEGIN
    SET search_path = public, extensions;

    -- 1. Autentikasi User (Admin Only)
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuat soal ujian UTS.');
    END IF;

    -- 2. Validasi Periode Ujian UTS Aktif
    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uts' THEN
        RETURN json_build_object('success', false, 'message', 'Fungsi ini khusus untuk pembuatan soal UTS.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    v_expected_q_count := COALESCE(v_period.uts_question_count, 5);

    -- 3. Validasi Kepesertaan Santri
    SELECT * INTO v_participant FROM exam_participants 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Santri bukan peserta resmi periode ujian ini.');
    END IF;

    -- 4. Validasi Snapshot Materi Wajib FINAL
    SELECT * INTO v_snapshot FROM exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Materi ujian belum diusulkan atau disiapkan.');
    END IF;

    IF v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Materi ujian santri belum difinalisasi (Status: ' || v_snapshot.status || '). Generator hanya boleh dijalankan untuk materi yang sudah final.');
    END IF;

    -- 5. Hitung & Validasi Material Fingerprint
    v_calculated_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah,
        v_snapshot.start_ayah,
        v_snapshot.end_surah,
        v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_calculated_fingerprint != p_fingerprint THEN
        RETURN json_build_object('success', false, 'message', 'Fingerprint materi tidak cocok. Data materi mungkin baru saja berubah.');
    END IF;

    -- 6. Idempotency Check: Jika Paket Soal Valid Sudah Ada, Return Existing
    SELECT * INTO v_existing_set FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id
    ORDER BY version DESC LIMIT 1;

    IF FOUND THEN
        IF v_existing_set.status = 'locked' AND v_existing_set.material_fingerprint = v_calculated_fingerprint THEN
            SELECT json_build_object(
                'success', true,
                'isExisting', true,
                'message', 'Paket soal UTS versi ' || v_existing_set.version || ' sudah aktif dan terkunci.',
                'questionSet', row_to_json(v_existing_set),
                'questions', (
                    SELECT json_agg(json_build_object(
                        'id', q.id,
                        'questionNumber', q.question_number,
                        'zoneNumber', q.zone_number,
                        'sourceType', q.source_type,
                        'questionBankId', q.question_bank_id,
                        'maxScore', COALESCE(q.max_score, 20.00),
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
                        'generatedMetadata', q.generated_metadata,
                        'createdAt', q.created_at
                    ) ORDER BY q.question_number)
                    FROM exam_questions q
                    WHERE q.question_set_id = v_existing_set.id
                )
            ) INTO v_inserted_questions;

            RETURN v_inserted_questions;
        ELSE
            UPDATE exam_question_sets 
            SET status = 'stale', updated_at = now() 
            WHERE id = v_existing_set.id;
        END IF;
    END IF;

    -- 7. Validasi Input Soal: Wajib Sesuai Konfigurasi (5, 10, 15, atau 20)
    v_q_count := jsonb_array_length(p_questions_data);
    IF v_q_count NOT IN (5, 10, 15, 20) THEN
        RETURN json_build_object('success', false, 'message', 'Jumlah soal UTS tidak valid (' || v_q_count || '). Hanya diperbolehkan 5, 10, 15, atau 20 butir soal.');
    END IF;

    IF v_q_count != v_expected_q_count THEN
        RETURN json_build_object('success', false, 'message', 'Jumlah butir soal (' || v_q_count || ') tidak sesuai dengan konfigurasi periode (' || v_expected_q_count || ' soal).');
    END IF;

    -- 8. Tentukan Versi Baru
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    v_set_id := 'eqs_' || p_period_id || '_' || p_student_id || '_v' || v_version;

    -- 9. Simpan exam_question_sets (Status LOCKED secara atomik)
    INSERT INTO exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id,
        version, generation_strategy, generation_seed, material_fingerprint,
        status, total_questions, generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_set_id,
        p_period_id,
        p_student_id,
        v_snapshot.id,
        v_version,
        COALESCE(p_strategy, 'hybrid'),
        p_seed,
        v_calculated_fingerprint,
        'locked',
        v_q_count,
        v_user.id,
        now(),
        now(),
        now(),
        now()
    );

    -- 10. Simpan Butir Soal exam_questions dengan Bobot Terdistribusi Presisi (Exact 100)
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        v_q_num := (v_q->>'questionNumber')::INTEGER;

        -- Tentukan max_score per butir soal:
        -- Jika dikirim dari generator client, gunakan nilainya; jika tidak, hitung secara server-authoritative
        IF (v_q->>'maxScore') IS NOT NULL THEN
            v_q_max := (v_q->>'maxScore')::NUMERIC(5,2);
        ELSE
            IF v_q_count = 5 THEN
                v_q_max := 20.00;
            ELSIF v_q_count = 10 THEN
                v_q_max := 10.00;
            ELSIF v_q_count = 20 THEN
                v_q_max := 5.00;
            ELSIF v_q_count = 15 THEN
                -- 10 soal pertama @ 6.67, 5 soal terakhir @ 6.66 = Total 100.00
                IF v_q_num <= 10 THEN
                    v_q_max := 6.67;
                ELSE
                    v_q_max := 6.66;
                END IF;
            ELSE
                v_q_max := ROUND(100.0 / v_q_count, 2);
            END IF;
        END IF;

        INSERT INTO exam_questions (
            id, question_set_id, question_number, zone_number,
            source_type, question_bank_id, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'eq_' || v_set_id || '_q' || v_q_num,
            v_set_id,
            v_q_num,
            (v_q->>'zoneNumber')::INTEGER,
            v_q->>'sourceType',
            v_q->>'questionBankId',
            v_q_max,
            (v_q->>'promptStartSurah')::INTEGER,
            (v_q->>'promptStartAyah')::INTEGER,
            (v_q->>'promptStartWord')::INTEGER,
            (v_q->>'promptEndSurah')::INTEGER,
            (v_q->>'promptEndAyah')::INTEGER,
            (v_q->>'promptEndWord')::INTEGER,
            (v_q->>'answerStartSurah')::INTEGER,
            (v_q->>'answerStartAyah')::INTEGER,
            (v_q->>'answerStartWord')::INTEGER,
            (v_q->>'answerEndSurah')::INTEGER,
            (v_q->>'answerEndAyah')::INTEGER,
            (v_q->>'answerEndWord')::INTEGER,
            (v_q->>'startPage')::INTEGER,
            (v_q->>'endPage')::INTEGER,
            COALESCE(v_q->'generatedMetadata', '{}'::jsonb),
            now()
        );
    END LOOP;

    -- 11. Audit Log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        p_student_id,
        'question_set_generated',
        v_user.id,
        jsonb_build_object(
            'questionSetId', v_set_id,
            'version', v_version,
            'totalQuestions', v_q_count,
            'fingerprint', v_calculated_fingerprint
        ),
        'Pembuatan paket soal UTS (' || v_q_count || ' soal) berhasil',
        now()
    );

    -- 12. Return Result
    SELECT json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Paket soal UTS (' || v_q_count || ' butir) berhasil dibuat dan dikunci.',
        'questionSet', row_to_json(s),
        'questions', (
            SELECT json_agg(json_build_object(
                'id', q.id,
                'questionNumber', q.question_number,
                'zoneNumber', q.zone_number,
                'sourceType', q.source_type,
                'questionBankId', q.question_bank_id,
                'maxScore', q.max_score,
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
                'generatedMetadata', q.generated_metadata,
                'createdAt', q.created_at
            ) ORDER BY q.question_number)
            FROM exam_questions q
            WHERE q.question_set_id = s.id
        )
    ) INTO v_inserted_questions
    FROM exam_question_sets s
    WHERE s.id = v_set_id;

    RETURN v_inserted_questions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =========================================================================
-- 3. STORED PROCEDURE: regenerate_uts_question_set
-- =========================================================================
DROP FUNCTION IF EXISTS regenerate_uts_question_set(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION regenerate_uts_question_set(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT,
    p_student_id TEXT,
    p_strategy TEXT,
    p_questions_data JSONB,
    p_seed TEXT,
    p_fingerprint TEXT,
    p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_snapshot RECORD;
    v_old_set RECORD;
    v_calculated_fingerprint TEXT;
    v_new_version INTEGER := 1;
    v_new_set_id TEXT;
    v_q JSONB;
    v_inserted_questions JSON;
    v_q_count INTEGER;
    v_expected_q_count INTEGER;
    v_q_max NUMERIC(5,2);
    v_q_num INTEGER;
BEGIN
    SET search_path = public, extensions;

    -- 1. Autentikasi User (Admin Only)
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak men-generate ulang soal UTS.');
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Alasan generate ulang (reason) wajib diisi.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    v_expected_q_count := COALESCE(v_period.uts_question_count, 5);

    -- 2. Validasi Snapshot Materi Wajib FINAL
    SELECT * INTO v_snapshot FROM exam_material_snapshots
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Materi ujian santri belum difinalisasi.');
    END IF;

    v_calculated_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_calculated_fingerprint != p_fingerprint THEN
        RETURN json_build_object('success', false, 'message', 'Fingerprint materi tidak cocok.');
    END IF;

    -- 3. Cek attempt ujian yang sedang berjalan/submitted
    IF EXISTS (
        SELECT 1 FROM exam_attempts 
        WHERE exam_period_id = p_period_id 
          AND student_id = p_student_id 
          AND status IN ('in_progress', 'submitted')
    ) THEN
        RETURN json_build_object('success', false, 'message', 'Tidak dapat membuat ulang soal: Ujian santri sedang berlangsung atau sudah diselesaikan.');
    END IF;

    -- 4. Void set lama jika ada
    SELECT * INTO v_old_set FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status != 'void'
    ORDER BY version DESC LIMIT 1;

    IF FOUND THEN
        UPDATE exam_question_sets
        SET status = 'void', updated_at = now()
        WHERE id = v_old_set.id;

        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            p_period_id, p_student_id, 'question_set_voided', v_user.id,
            jsonb_build_object('voidedSetId', v_old_set.id, 'version', v_old_set.version),
            p_reason, now()
        );

        v_new_version := v_old_set.version + 1;
    ELSE
        SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_version
        FROM exam_question_sets
        WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    END IF;

    -- 5. Validasi Jumlah Soal (5, 10, 15, atau 20)
    v_q_count := jsonb_array_length(p_questions_data);
    IF v_q_count NOT IN (5, 10, 15, 20) THEN
        RETURN json_build_object('success', false, 'message', 'Jumlah butir soal tidak valid (' || v_q_count || '). Hanya diperbolehkan 5, 10, 15, atau 20 butir.');
    END IF;

    IF v_q_count != v_expected_q_count THEN
        RETURN json_build_object('success', false, 'message', 'Jumlah butir soal (' || v_q_count || ') tidak sesuai dengan konfigurasi periode (' || v_expected_q_count || ' soal).');
    END IF;

    v_new_set_id := 'eqs_' || p_period_id || '_' || p_student_id || '_v' || v_new_version;

    -- 6. Insert Set Baru
    INSERT INTO exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id,
        version, generation_strategy, generation_seed, material_fingerprint,
        status, total_questions, generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_new_set_id,
        p_period_id,
        p_student_id,
        v_snapshot.id,
        v_new_version,
        COALESCE(p_strategy, 'hybrid'),
        p_seed,
        v_calculated_fingerprint,
        'locked',
        v_q_count,
        v_user.id,
        now(),
        now(),
        now(),
        now()
    );

    -- 7. Insert exam_questions
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        v_q_num := (v_q->>'questionNumber')::INTEGER;

        IF (v_q->>'maxScore') IS NOT NULL THEN
            v_q_max := (v_q->>'maxScore')::NUMERIC(5,2);
        ELSE
            IF v_q_count = 5 THEN
                v_q_max := 20.00;
            ELSIF v_q_count = 10 THEN
                v_q_max := 10.00;
            ELSIF v_q_count = 20 THEN
                v_q_max := 5.00;
            ELSIF v_q_count = 15 THEN
                IF v_q_num <= 10 THEN v_q_max := 6.67; ELSE v_q_max := 6.66; END IF;
            ELSE
                v_q_max := ROUND(100.0 / v_q_count, 2);
            END IF;
        END IF;

        INSERT INTO exam_questions (
            id, question_set_id, question_number, zone_number,
            source_type, question_bank_id, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'eq_' || v_new_set_id || '_q' || v_q_num,
            v_new_set_id,
            v_q_num,
            (v_q->>'zoneNumber')::INTEGER,
            v_q->>'sourceType',
            v_q->>'questionBankId',
            v_q_max,
            (v_q->>'promptStartSurah')::INTEGER,
            (v_q->>'promptStartAyah')::INTEGER,
            (v_q->>'promptStartWord')::INTEGER,
            (v_q->>'promptEndSurah')::INTEGER,
            (v_q->>'promptEndAyah')::INTEGER,
            (v_q->>'promptEndWord')::INTEGER,
            (v_q->>'answerStartSurah')::INTEGER,
            (v_q->>'answerStartAyah')::INTEGER,
            (v_q->>'answerStartWord')::INTEGER,
            (v_q->>'answerEndSurah')::INTEGER,
            (v_q->>'answerEndAyah')::INTEGER,
            (v_q->>'answerEndWord')::INTEGER,
            (v_q->>'startPage')::INTEGER,
            (v_q->>'endPage')::INTEGER,
            COALESCE(v_q->'generatedMetadata', '{}'::jsonb),
            now()
        );
    END LOOP;

    -- 8. Return Result
    SELECT json_build_object(
        'success', true,
        'message', 'Paket soal UTS berhasil di-generate ulang (Versi ' || v_new_version || ').',
        'questionSet', row_to_json(s),
        'questions', (
            SELECT json_agg(json_build_object(
                'id', q.id,
                'questionNumber', q.question_number,
                'zoneNumber', q.zone_number,
                'sourceType', q.source_type,
                'questionBankId', q.question_bank_id,
                'maxScore', q.max_score,
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
                'generatedMetadata', q.generated_metadata,
                'createdAt', q.created_at
            ) ORDER BY q.question_number)
            FROM exam_questions q
            WHERE q.question_set_id = s.id
        )
    ) INTO v_inserted_questions
    FROM exam_question_sets s
    WHERE s.id = v_new_set_id;

    RETURN v_inserted_questions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =========================================================================
-- 4. STORED PROCEDURE: start_uts_attempt
-- =========================================================================
DROP FUNCTION IF EXISTS start_uts_attempt(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION start_uts_attempt(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT,
    p_student_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_participant RECORD;
    v_snapshot RECORD;
    v_question_set RECORD;
    v_assignment RECORD;
    v_existing_attempt RECORD;
    v_attempt_id TEXT;
    v_q RECORD;
    v_calc_fingerprint TEXT;
    v_q_max NUMERIC(5,2);
    v_init_f NUMERIC(5,2);
    v_init_t NUMERIC(5,2);
    v_init_m NUMERIC(5,2);
BEGIN
    SET search_path = public, extensions;

    -- 1. Autentikasi User (Admin atau Penguji)
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    -- 2. Validasi Periode UTS
    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    -- 3. Validasi Santri Peserta
    SELECT * INTO v_participant FROM exam_participants 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Santri bukan peserta resmi periode ujian ini.');
    END IF;

    -- 4. Otorisasi Penguji
    IF v_user.role = 'teacher' THEN
        SELECT * INTO v_assignment FROM exam_examiner_assignments
        WHERE exam_period_id = p_period_id AND student_id = p_student_id;

        IF FOUND THEN
            IF v_assignment.examiner_user_id != v_user.id THEN
                RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk santri ini.');
            END IF;
        ELSE
            IF v_participant.teacher_id_snapshot IS NOT NULL AND v_participant.teacher_id_snapshot != v_user.id THEN
                RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan guru halaqah santri ini.');
            END IF;
        END IF;
    END IF;

    -- 5. Validasi Prasyarat Materi Final & Paket Soal Terkunci
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Materi UTS santri belum difinalisasi.');
    END IF;

    SELECT * INTO v_question_set FROM exam_question_sets 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'locked'
    ORDER BY version DESC LIMIT 1;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal UTS belum dibuat atau terkunci.');
    END IF;

    -- Stale check
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal berstatus STALE karena materi berubah.');
    END IF;

    -- 6. Idempotency Check: Ambil Attempt yang Sedang Berjalan jika Ada
    SELECT * INTO v_existing_attempt FROM exam_attempts 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND attempt_number = 1;

    IF FOUND THEN
        IF v_existing_attempt.status = 'submitted' THEN
            RETURN json_build_object('success', false, 'message', 'Ujian santri ini sudah selesai dan telah dikirim (submitted).');
        END IF;

        v_attempt_id := v_existing_attempt.id;
    ELSE
        -- Buat attempt baru
        v_attempt_id := 'att_' || p_period_id || '_' || p_student_id || '_a1';
        
        INSERT INTO exam_attempts (
            id, exam_period_id, student_id, question_set_id, examiner_user_id,
            attempt_number, status, started_at, last_saved_at, total_score, created_at, updated_at
        ) VALUES (
            v_attempt_id, p_period_id, p_student_id, v_question_set.id, v_user.id,
            1, 'in_progress', now(), now(), 0, now(), now()
        );

        -- Inisialisasi assessment dinamis untuk seluruh butir soal pada set:
        -- Sub-score dihitung presisi berdasarkan max_score tiap soal (60% / 20% / 20%)
        FOR v_q IN 
            SELECT * FROM exam_questions 
            WHERE question_set_id = v_question_set.id 
            ORDER BY question_number ASC
        LOOP
            v_q_max := COALESCE(v_q.max_score, 20.00);
            v_init_f := ROUND(v_q_max * 0.60, 2);
            v_init_t := ROUND(v_q_max * 0.20, 2);
            v_init_m := v_q_max - v_init_f - v_init_t; -- Exact sum guarantee

            INSERT INTO exam_question_assessments (
                id, exam_attempt_id, exam_question_id, question_number,
                fluency_score, tajwid_score, makhraj_score,
                fluency_events, tajwid_events, makhraj_events,
                question_score, notes, started_at, completed_at, updated_at, version
            ) VALUES (
                'aqa_' || v_attempt_id || '_q' || v_q.question_number,
                v_attempt_id, v_q.id, v_q.question_number,
                v_init_f, v_init_t, v_init_m,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                v_q_max, '', now(), NULL, now(), 1
            );
        END LOOP;

        -- Audit log
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            p_period_id, p_student_id, 'exam_started', v_user.id,
            jsonb_build_object('attemptId', v_attempt_id, 'questionSetId', v_question_set.id),
            'Mulai pelaksanaan ujian UTS santri', now()
        );
    END IF;

    -- 7. Return Sesi Ujian Lengkap
    RETURN json_build_object(
        'success', true,
        'attempt', (SELECT row_to_json(a) FROM exam_attempts a WHERE a.id = v_attempt_id),
        'kkm', v_period.kkm,
        'questions', (
            SELECT json_agg(json_build_object(
                'id', q.id,
                'questionNumber', q.question_number,
                'zoneNumber', q.zone_number,
                'sourceType', q.source_type,
                'questionBankId', q.question_bank_id,
                'maxScore', COALESCE(q.max_score, 20.00),
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
            ) ORDER BY q.question_number)
            FROM exam_questions q
            WHERE q.question_set_id = v_question_set.id
        ),
        'assessments', (
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
                'startedAt', a.started_at,
                'completedAt', a.completed_at,
                'version', a.version,
                'updatedAt', a.updated_at
            ) ORDER BY a.question_number)
            FROM exam_question_assessments a
            WHERE a.exam_attempt_id = v_attempt_id
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =========================================================================
-- 5. STORED PROCEDURE: save_uts_question_assessment
-- =========================================================================
DROP FUNCTION IF EXISTS save_uts_question_assessment(TEXT, TEXT, TEXT, INTEGER, JSONB, BOOLEAN, INTEGER);
DROP FUNCTION IF EXISTS save_uts_question_assessment(TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION save_uts_question_assessment(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT,
    p_question_number INTEGER,
    p_assessment_data JSONB,
    p_mark_completed BOOLEAN DEFAULT false,
    p_expected_version INTEGER DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
    v_existing_assessment RECORD;
    v_q_max NUMERIC(5,2);
    v_scale NUMERIC(7,4);
    v_max_f NUMERIC(5,2);
    v_max_t NUMERIC(5,2);
    v_max_m NUMERIC(5,2);
    v_f_deduction NUMERIC(5,2) := 0;
    v_t_deduction NUMERIC(5,2) := 0;
    v_m_deduction NUMERIC(5,2) := 0;
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
    v_f_events JSONB;
    v_t_events JSONB;
    v_m_events JSONB;
    v_event JSONB;
    v_ev_type TEXT;
    v_new_version INTEGER;
    v_new_completed_at TIMESTAMPTZ;
    v_updated_rows INTEGER;
BEGIN
    SET search_path = public, extensions;

    -- 1. Autentikasi
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
    END IF;

    IF v_attempt.status = 'submitted' THEN
        RETURN json_build_object('success', false, 'message', 'Ujian sudah disubmit dan terkunci.');
    END IF;

    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji sesi ini.');
    END IF;

    -- 3. Ambil Assessment Existing & Kunci Versi
    SELECT * INTO v_existing_assessment FROM exam_question_assessments 
    WHERE exam_attempt_id = p_attempt_id AND question_number = p_question_number;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Butir soal ' || p_question_number || ' tidak ditemukan.');
    END IF;

    IF p_expected_version IS NOT NULL AND v_existing_assessment.version != p_expected_version THEN
        RETURN json_build_object(
            'success', false, 
            'isConflict', true, 
            'message', 'Data ujian berubah di perangkat lain. Muat ulang data terbaru.',
            'currentVersion', v_existing_assessment.version
        );
    END IF;

    -- 4. Ambil max_score Butir Soal untuk Normalisasi Proporsional
    SELECT COALESCE(q.max_score, 20.00) INTO v_q_max
    FROM exam_questions q
    WHERE q.id = v_existing_assessment.exam_question_id;

    IF NOT FOUND OR v_q_max IS NULL THEN
        v_q_max := 20.00;
    END IF;

    -- Skala pengurangan proporsional terhadap baseline 20 poin:
    -- baseline: self_correction=0.5 (2.5%), reminder=1.0 (5%), prompt=2.0 (10%), unable=4.0 (20%)
    v_scale := v_q_max / 20.00;
    v_max_f := ROUND(v_q_max * 0.60, 2);
    v_max_t := ROUND(v_q_max * 0.20, 2);
    v_max_m := v_q_max - v_max_f - v_max_t;

    -- 5. Parsing Events & Server Authoritative Deductions
    v_f_events := COALESCE(p_assessment_data->'fluencyEvents', '[]'::jsonb);
    v_t_events := COALESCE(p_assessment_data->'tajwidEvents', '[]'::jsonb);
    v_m_events := COALESCE(p_assessment_data->'makhrajEvents', '[]'::jsonb);

    -- 5.1 Kelancaran
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_f_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'self_correction' THEN
            v_f_deduction := v_f_deduction + (0.5 * v_scale);
        ELSIF v_ev_type = 'reminder' THEN
            v_f_deduction := v_f_deduction + (1.0 * v_scale);
        ELSIF v_ev_type = 'prompt' THEN
            v_f_deduction := v_f_deduction + (2.0 * v_scale);
        ELSIF v_ev_type = 'unable' THEN
            v_f_deduction := v_f_deduction + (4.0 * v_scale);
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event kelancaran tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_f_score := GREATEST(0.00, ROUND(v_max_f - v_f_deduction, 2));

    -- 5.2 Tajwid
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_t_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'minor' THEN
            v_t_deduction := v_t_deduction + (0.5 * v_scale);
        ELSIF v_ev_type = 'major' THEN
            v_t_deduction := v_t_deduction + (1.0 * v_scale);
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event tajwid tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_t_score := GREATEST(0.00, ROUND(v_max_t - v_t_deduction, 2));

    -- 5.3 Makhraj
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_m_events)
    LOOP
        v_ev_type := v_event->>'type';
        IF v_ev_type = 'minor' THEN
            v_m_deduction := v_m_deduction + (0.5 * v_scale);
        ELSIF v_ev_type = 'major' THEN
            v_m_deduction := v_m_deduction + (1.0 * v_scale);
        ELSE
            RETURN json_build_object('success', false, 'message', 'Event makhraj tidak dikenal: ' || COALESCE(v_ev_type, 'null'));
        END IF;
    END LOOP;
    v_m_score := GREATEST(0.00, ROUND(v_max_m - v_m_deduction, 2));

    v_q_score := v_f_score + v_t_score + v_m_score;
    v_new_version := v_existing_assessment.version + 1;

    -- Tentukan status completed_at
    IF p_mark_completed = true OR (p_assessment_data->>'isCompleted')::BOOLEAN = true THEN
        v_new_completed_at := COALESCE(v_existing_assessment.completed_at, now());
    ELSE
        v_new_completed_at := v_existing_assessment.completed_at;
    END IF;

    -- 6. Update Assessment Atomik
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

    -- Update last_saved_at pada attempt
    UPDATE exam_attempts SET last_saved_at = now(), updated_at = now() WHERE id = p_attempt_id;

    RETURN json_build_object(
        'success', true,
        'message', 'Penilaian soal ' || p_question_number || ' berhasil disimpan.',
        'assessment', json_build_object(
            'questionNumber', p_question_number,
            'fluencyScore', v_f_score,
            'tajwidScore', v_t_score,
            'makhrajScore', v_m_score,
            'questionScore', v_q_score,
            'completedAt', v_new_completed_at,
            'version', v_new_version,
            'lastSavedAt', now()
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =========================================================================
-- 6. STORED PROCEDURE: submit_uts_attempt
-- =========================================================================
-- Catatan: Parameter p_examiner_notes ditambahkan sebagai parameter ke-4 dengan default NULL
DROP FUNCTION IF EXISTS submit_uts_attempt(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS submit_uts_attempt(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION submit_uts_attempt(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT,
    p_examiner_notes TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
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
    v_is_passed BOOLEAN;
    v_asm RECORD;
    v_q_max NUMERIC(5,2);
    v_scale NUMERIC(7,4);
    v_max_f NUMERIC(5,2);
    v_max_t NUMERIC(5,2);
    v_max_m NUMERIC(5,2);
    v_event JSONB;
    v_ev_type TEXT;
    v_f_deduction NUMERIC(5,2);
    v_t_deduction NUMERIC(5,2);
    v_m_deduction NUMERIC(5,2);
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
    v_notes_to_save TEXT;
BEGIN
    SET search_path = public, extensions;

    -- 1. Autentikasi
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
    END IF;

    -- Idempotency check: jika sudah submitted, return existing
    IF v_attempt.status = 'submitted' THEN
        SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
        RETURN json_build_object(
            'success', true,
            'isExisting', true,
            'message', 'Ujian sudah disubmit sebelumnya.',
            'totalScore', v_attempt.total_score,
            'submittedAt', v_attempt.submitted_at,
            'kkm', v_period.kkm,
            'isPassed', (v_attempt.total_score >= v_period.kkm),
            'examinerNotes', v_attempt.examiner_notes
        );
    END IF;

    -- Otorisasi penguji
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji sesi ini.');
    END IF;

    -- Validasi panjang catatan penguji
    IF p_examiner_notes IS NOT NULL AND char_length(p_examiner_notes) > 500 THEN
        RETURN json_build_object('success', false, 'message', 'Catatan penguji maksimal 500 karakter.');
    END IF;
    v_notes_to_save := COALESCE(p_examiner_notes, v_attempt.examiner_notes);

    -- STALE CHECK
    SELECT * INTO v_question_set FROM exam_question_sets WHERE id = v_attempt.question_set_id;
    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;
    
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.status != 'locked' OR v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'isStale', true, 'message', 'Ujian diblokir: Paket soal berstatus STALE karena materi berubah.');
    END IF;

    -- VALIDASI SELURUH BUTIR SOAL WAJIB COMPLETED
    SELECT COUNT(*), COUNT(*) FILTER (WHERE completed_at IS NOT NULL)
    INTO v_count_total, v_count_completed
    FROM exam_question_assessments
    WHERE exam_attempt_id = p_attempt_id;

    IF v_count_total = 0 OR v_count_completed != v_count_total THEN
        RETURN json_build_object(
            'success', false, 
            'message', 'Validasi gagal: Seluruh butir soal (' || v_count_total || ' butir) wajib diselesaikan sebelum submit final. Saat ini baru ' || v_count_completed || ' soal selesai.'
        );
    END IF;

    -- VALIDASI SOAL BERASAL DARI QUESTION SET RESMI
    SELECT COUNT(*) INTO v_valid_q_count
    FROM exam_question_assessments eqa
    JOIN exam_questions eq ON eq.id = eqa.exam_question_id
    WHERE eqa.exam_attempt_id = p_attempt_id
      AND eq.question_set_id = v_attempt.question_set_id;

    IF v_valid_q_count != v_count_total THEN
        RETURN json_build_object('success', false, 'message', 'Validasi integritas gagal: Butir soal tidak sesuai dengan paket soal resmi.');
    END IF;

    -- AUTHORITATIVE SERVER-SIDE RECALCULATION
    v_total_calculated := 0;

    FOR v_asm IN 
        SELECT a.*, COALESCE(q.max_score, 20.00) AS q_max 
        FROM exam_question_assessments a
        JOIN exam_questions q ON q.id = a.exam_question_id
        WHERE a.exam_attempt_id = p_attempt_id 
        ORDER BY a.question_number ASC
    LOOP
        v_q_max := v_asm.q_max;
        v_scale := v_q_max / 20.00;
        v_max_f := ROUND(v_q_max * 0.60, 2);
        v_max_t := ROUND(v_q_max * 0.20, 2);
        v_max_m := v_q_max - v_max_f - v_max_t;

        v_f_deduction := 0;
        v_t_deduction := 0;
        v_m_deduction := 0;

        -- 1. Fluency events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.fluency_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'self_correction' THEN v_f_deduction := v_f_deduction + (0.5 * v_scale);
            ELSIF v_ev_type = 'reminder' THEN v_f_deduction := v_f_deduction + (1.0 * v_scale);
            ELSIF v_ev_type = 'prompt' THEN v_f_deduction := v_f_deduction + (2.0 * v_scale);
            ELSIF v_ev_type = 'unable' THEN v_f_deduction := v_f_deduction + (4.0 * v_scale);
            END IF;
        END LOOP;
        v_f_score := GREATEST(0.00, ROUND(v_max_f - v_f_deduction, 2));

        -- 2. Tajwid events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.tajwid_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'minor' THEN v_t_deduction := v_t_deduction + (0.5 * v_scale);
            ELSIF v_ev_type = 'major' THEN v_t_deduction := v_t_deduction + (1.0 * v_scale);
            END IF;
        END LOOP;
        v_t_score := GREATEST(0.00, ROUND(v_max_t - v_t_deduction, 2));

        -- 3. Makhraj events
        FOR v_event IN SELECT * FROM jsonb_array_elements(v_asm.makhraj_events)
        LOOP
            v_ev_type := v_event->>'type';
            IF v_ev_type = 'minor' THEN v_m_deduction := v_m_deduction + (0.5 * v_scale);
            ELSIF v_ev_type = 'major' THEN v_m_deduction := v_m_deduction + (1.0 * v_scale);
            END IF;
        END LOOP;
        v_m_score := GREATEST(0.00, ROUND(v_max_m - v_m_deduction, 2));

        v_q_score := v_f_score + v_t_score + v_m_score;

        -- Update skor authoritative ke database
        UPDATE exam_question_assessments SET
            fluency_score = v_f_score,
            tajwid_score = v_t_score,
            makhraj_score = v_m_score,
            question_score = v_q_score,
            updated_at = now()
        WHERE id = v_asm.id;

        v_total_calculated := v_total_calculated + v_q_score;
    END LOOP;

    v_total_calculated := ROUND(v_total_calculated, 2);

    SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
    v_is_passed := (v_total_calculated >= v_period.kkm);

    -- Finalisasi status attempt & simpan examiner_notes
    UPDATE exam_attempts SET
        status = 'submitted',
        total_score = v_total_calculated,
        examiner_notes = v_notes_to_save,
        submitted_at = now(),
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Tandai status assignment sebagai completed
    UPDATE exam_examiner_assignments
    SET status = 'completed', updated_at = now()
    WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;

    -- Audit log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_attempt.exam_period_id, v_attempt.student_id, 'exam_submitted', v_user.id,
        jsonb_build_object(
            'attemptId', p_attempt_id,
            'totalScore', v_total_calculated,
            'isPassed', v_is_passed,
            'kkm', v_period.kkm,
            'hasExaminerNotes', (v_notes_to_save IS NOT NULL AND v_notes_to_save != '')
        ),
        'Ujian UTS berhasil disubmit final (Nilai: ' || v_total_calculated || ')',
        now()
    );

    RETURN json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Ujian UTS berhasil disubmit final.',
        'totalScore', v_total_calculated,
        'submittedAt', now(),
        'kkm', v_period.kkm,
        'isPassed', v_is_passed,
        'examinerNotes', v_notes_to_save
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =========================================================================
-- 8. STORED PROCEDURE: create_exam_period_with_participants
-- =========================================================================
-- Mendukung penulisan dan update konfigurasi uts_question_count (5, 10, 15, 20)
CREATE OR REPLACE FUNCTION create_exam_period_with_participants(
    p_username TEXT,
    p_password TEXT,
    p_period JSONB,
    p_student_ids TEXT[]
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period_id TEXT;
    v_term_id TEXT;
    v_term RECORD;
    v_cutoff DATE;
    v_kkm NUMERIC;
    v_student RECORD;
    v_count INTEGER := 0;
    v_uts_q_count INTEGER;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuat Periode Ujian.');
    END IF;

    v_term_id := p_period->>'academicTermId';
    SELECT * INTO v_term FROM academic_terms WHERE id = v_term_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Semester akademik tidak ditemukan.');
    END IF;

    v_cutoff := (p_period->>'materialCutoffDate')::DATE;
    IF v_cutoff < v_term.start_date THEN
        RETURN json_build_object('success', false, 'message', 'Tanggal batas materi (cutoff) tidak boleh sebelum tanggal awal semester.');
    END IF;

    v_period_id := COALESCE(p_period->>'id', 'period_' || extract(epoch from now())::bigint);
    v_kkm := COALESCE((p_period->>'kkm')::NUMERIC, 75);
    v_uts_q_count := COALESCE(
        (p_period->>'utsQuestionCount')::INTEGER,
        (p_period->>'uts_question_count')::INTEGER,
        5
    );

    -- 1. Insert exam_period
    INSERT INTO exam_periods (
        id, academic_term_id, name, exam_type, material_cutoff_date,
        exam_start_date, exam_end_date, kkm, target_classes, target_halaqahs,
        status, uts_question_count, created_by, created_at, updated_at
    ) VALUES (
        v_period_id,
        v_term_id,
        p_period->>'name',
        p_period->>'examType',
        v_cutoff,
        (p_period->>'examStartDate')::DATE,
        (p_period->>'examEndDate')::DATE,
        v_kkm,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_period->'targetClasses', '[]'::jsonb))),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_period->'targetHalaqahs', '[]'::jsonb))),
        COALESCE(p_period->>'status', 'preparation'),
        v_uts_q_count,
        v_user.id,
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        exam_type = EXCLUDED.exam_type,
        material_cutoff_date = EXCLUDED.material_cutoff_date,
        exam_start_date = EXCLUDED.exam_start_date,
        exam_end_date = EXCLUDED.exam_end_date,
        kkm = EXCLUDED.kkm,
        target_classes = EXCLUDED.target_classes,
        target_halaqahs = EXCLUDED.target_halaqahs,
        status = EXCLUDED.status,
        uts_question_count = COALESCE(EXCLUDED.uts_question_count, exam_periods.uts_question_count, 5),
        updated_at = now();

    -- 2. Insert participants with profile snapshots
    IF array_length(p_student_ids, 1) > 0 THEN
        FOR v_student IN 
            SELECT id, name, class, halaqah, teacher_id 
            FROM students 
            WHERE id = ANY(p_student_ids)
        LOOP
            INSERT INTO exam_participants (
                id, exam_period_id, student_id,
                student_name_snapshot, class_snapshot, halaqah_snapshot, teacher_id_snapshot,
                status, created_at, updated_at
            ) VALUES (
                'part_' || v_period_id || '_' || v_student.id,
                v_period_id,
                v_student.id,
                v_student.name,
                v_student.class,
                v_student.halaqah,
                v_student.teacher_id,
                'registered',
                now(),
                now()
            )
            ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
                student_name_snapshot = EXCLUDED.student_name_snapshot,
                class_snapshot = EXCLUDED.class_snapshot,
                halaqah_snapshot = EXCLUDED.halaqah_snapshot,
                teacher_id_snapshot = EXCLUDED.teacher_id_snapshot,
                status = EXCLUDED.status,
                updated_at = now();
                
            v_count := v_count + 1;
        END LOOP;
    END IF;

    RETURN json_build_object(
        'success', true,
        'message', 'Periode ujian dan peserta berhasil disimpan.',
        'periodId', v_period_id,
        'participantsCount', v_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
