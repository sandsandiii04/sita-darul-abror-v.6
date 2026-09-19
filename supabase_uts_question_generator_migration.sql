-- ============================================================
-- SQL Migration: Tahap 5A — Engine Generator Soal UTS Tahfiz
-- Darul Abror IBS (Non-Destructive Migration)
-- ============================================================

-- 1. TABEL: exam_question_sets (Paket 5 Soal UTS per Santri)
CREATE TABLE IF NOT EXISTS exam_question_sets (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT NOT NULL REFERENCES exam_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    material_snapshot_id TEXT NOT NULL REFERENCES exam_material_snapshots(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    generation_strategy TEXT NOT NULL DEFAULT 'hybrid' CHECK (generation_strategy IN ('hybrid', 'bank_only', 'auto_only')),
    generation_seed TEXT NOT NULL,
    material_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('generated', 'locked', 'void', 'stale')),
    
    generated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    locked_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_exam_question_set_version UNIQUE (exam_period_id, student_id, version)
);

CREATE INDEX IF NOT EXISTS idx_eqs_period_student ON exam_question_sets(exam_period_id, student_id);
CREATE INDEX IF NOT EXISTS idx_eqs_status ON exam_question_sets(status);
CREATE INDEX IF NOT EXISTS idx_eqs_snapshot_id ON exam_question_sets(material_snapshot_id);

-- 2. TABEL: exam_questions (Detail 5 Butir Soal per Zona)
CREATE TABLE IF NOT EXISTS exam_questions (
    id TEXT PRIMARY KEY,
    question_set_id TEXT NOT NULL REFERENCES exam_question_sets(id) ON DELETE CASCADE,
    question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 5),
    zone_number INTEGER NOT NULL CHECK (zone_number BETWEEN 1 AND 5),
    source_type TEXT NOT NULL CHECK (source_type IN ('bank', 'auto')),
    question_bank_id TEXT REFERENCES question_bank(id) ON DELETE SET NULL,
    
    -- Koordinat Posisi Titik A (Awal Prompt Penguji)
    prompt_start_surah INTEGER NOT NULL CHECK (prompt_start_surah BETWEEN 1 AND 114),
    prompt_start_ayah INTEGER NOT NULL CHECK (prompt_start_ayah >= 1),
    prompt_start_word INTEGER NOT NULL CHECK (prompt_start_word >= 1),

    -- Koordinat Posisi Titik A' (Akhir Prompt Penguji)
    prompt_end_surah INTEGER NOT NULL CHECK (prompt_end_surah BETWEEN 1 AND 114),
    prompt_end_ayah INTEGER NOT NULL CHECK (prompt_end_ayah >= 1),
    prompt_end_word INTEGER NOT NULL CHECK (prompt_end_word >= 1),

    -- Koordinat Posisi Titik B (Titik Mulai Santri Sambung Ayat)
    answer_start_surah INTEGER NOT NULL CHECK (answer_start_surah BETWEEN 1 AND 114),
    answer_start_ayah INTEGER NOT NULL CHECK (answer_start_ayah >= 1),
    answer_start_word INTEGER NOT NULL CHECK (answer_start_word >= 1),

    -- Koordinat Posisi Titik C (Batas Akhir Acuan Jawaban Santri)
    answer_end_surah INTEGER NOT NULL CHECK (answer_end_surah BETWEEN 1 AND 114),
    answer_end_ayah INTEGER NOT NULL CHECK (answer_end_ayah >= 1),
    answer_end_word INTEGER NOT NULL CHECK (answer_end_word >= 1),

    -- Navigasi Halaman Mushaf Standar Madinah (1–604)
    start_page INTEGER CHECK (start_page BETWEEN 1 AND 604),
    end_page INTEGER CHECK (end_page BETWEEN 1 AND 604),
    
    generated_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    -- Constraint Keunikan: Tepat 1 Soal per Nomor & per Zona
    CONSTRAINT uq_eq_set_number UNIQUE (question_set_id, question_number),
    CONSTRAINT uq_eq_set_zone UNIQUE (question_set_id, zone_number),

    -- Validasi Struktural Urutan Titik Soal: A <= A' < B <= C
    CONSTRAINT chk_eq_a_lte_a_end CHECK (
        (prompt_start_surah < prompt_end_surah) OR 
        (prompt_start_surah = prompt_end_surah AND prompt_start_ayah < prompt_end_ayah) OR 
        (prompt_start_surah = prompt_end_surah AND prompt_start_ayah = prompt_end_ayah AND prompt_start_word <= prompt_end_word)
    ),
    CONSTRAINT chk_eq_a_end_lt_b CHECK (
        (prompt_end_surah < answer_start_surah) OR 
        (prompt_end_surah = answer_start_surah AND prompt_end_ayah < answer_start_ayah) OR 
        (prompt_end_surah = answer_start_surah AND prompt_end_ayah = answer_start_ayah AND prompt_end_word < answer_start_word)
    ),
    CONSTRAINT chk_eq_b_lte_c CHECK (
        (answer_start_surah < answer_end_surah) OR 
        (answer_start_surah = answer_end_surah AND answer_start_ayah < answer_end_ayah) OR 
        (answer_start_surah = answer_end_surah AND answer_start_ayah = answer_end_ayah AND answer_start_word <= answer_end_word)
    )
);

CREATE INDEX IF NOT EXISTS idx_eq_set_id ON exam_questions(question_set_id);
CREATE INDEX IF NOT EXISTS idx_eq_qbank_id ON exam_questions(question_bank_id);

-- 3. Trigger Otomatis: Update updated_at pada exam_question_sets
CREATE OR REPLACE FUNCTION set_exam_question_sets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exam_question_sets_updated_at ON exam_question_sets;
CREATE TRIGGER trg_exam_question_sets_updated_at
BEFORE UPDATE ON exam_question_sets
FOR EACH ROW
EXECUTE FUNCTION set_exam_question_sets_updated_at();

-- 4. ROW LEVEL SECURITY (RLS)
ALTER TABLE exam_question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eqs_deny_direct_access ON exam_question_sets;
CREATE POLICY eqs_deny_direct_access ON exam_question_sets FOR ALL USING (false);

DROP POLICY IF EXISTS eq_deny_direct_access ON exam_questions;
CREATE POLICY eq_deny_direct_access ON exam_questions FOR ALL USING (false);


-- ============================================================
-- 5. STORED PROCEDURES (SECURITY DEFINER RPC)
-- ============================================================

-- Helper Function: Calculate Material Fingerprint
CREATE OR REPLACE FUNCTION calculate_material_fingerprint(
    p_start_surah INTEGER,
    p_start_ayah INTEGER,
    p_end_surah INTEGER,
    p_end_ayah INTEGER,
    p_direction TEXT
)
RETURNS TEXT AS $$
BEGIN
    RETURN md5(p_start_surah::text || ':' || p_start_ayah::text || '-' || p_end_surah::text || ':' || p_end_ayah::text || '-' || COALESCE(p_direction, 'forward'));
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- RPC 1: generate_uts_question_set (Admin Only, Atomic & Idempotent)
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
    v_snapshot RECORD;
    v_existing_set RECORD;
    v_set_id TEXT;
    v_version INTEGER := 1;
    v_q JSONB;
    v_inserted_questions JSONB := '[]'::jsonb;
    v_calculated_fingerprint TEXT;
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    -- 2. Otorisasi Role: Wajib Admin
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuat soal ujian UTS.');
    END IF;

    -- 3. Validasi Periode Ujian
    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uts' THEN
        RETURN json_build_object('success', false, 'message', 'Generator ini khusus untuk periode ujian UTS.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    -- 4. Validasi Snapshot Materi: Wajib FINALIZED
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi santri belum dibuat.');
    END IF;

    IF v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Materi UTS santri belum difinalisasi.');
    END IF;

    -- Hitung fingerprint aktual dari snapshot saat ini
    v_calculated_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah,
        v_snapshot.start_ayah,
        v_snapshot.end_surah,
        v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    -- 5. IDEMPOTENCY CHECK: Periksa apakah sudah ada set yang aktif ('locked')
    SELECT * INTO v_existing_set 
    FROM exam_question_sets 
    WHERE exam_period_id = p_period_id 
      AND student_id = p_student_id 
      AND status = 'locked'
    ORDER BY version DESC 
    LIMIT 1;

    IF FOUND THEN
        -- Periksa kesesuaian fingerprint materi
        IF v_existing_set.material_fingerprint = v_calculated_fingerprint THEN
            -- Idempotent: Kembalikan set yang sudah ada beserta 5 soalnya
            SELECT json_build_object(
                'success', true,
                'isExisting', true,
                'message', 'Soal UTS santri sudah dibuat dan terkunci sebelumnya.',
                'questionSet', json_build_object(
                    'id', v_existing_set.id,
                    'examPeriodId', v_existing_set.exam_period_id,
                    'studentId', v_existing_set.student_id,
                    'materialSnapshotId', v_existing_set.material_snapshot_id,
                    'version', v_existing_set.version,
                    'generationStrategy', v_existing_set.generation_strategy,
                    'generationSeed', v_existing_set.generation_seed,
                    'materialFingerprint', v_existing_set.material_fingerprint,
                    'status', v_existing_set.status,
                    'generatedBy', v_existing_set.generated_by,
                    'generatedAt', v_existing_set.generated_at,
                    'lockedAt', v_existing_set.locked_at
                ),
                'questions', (
                    SELECT json_agg(json_build_object(
                        'id', q.id,
                        'questionSetId', q.question_set_id,
                        'questionNumber', q.question_number,
                        'zoneNumber', q.zone_number,
                        'sourceType', q.source_type,
                        'questionBankId', q.question_bank_id,
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
            -- Materi snapshot berubah setelah soal dibuat! Tandai stale
            UPDATE exam_question_sets 
            SET status = 'stale', updated_at = now() 
            WHERE id = v_existing_set.id;

            -- Lanjutkan untuk membuat versi baru yang sinkron dengan materi terbaru
        END IF;
    END IF;

    -- 6. Validasi Input Soal: Wajib Tepat 5 Soal
    IF jsonb_array_length(p_questions_data) != 5 THEN
        RETURN json_build_object('success', false, 'message', 'Generator gagal: Wajib menghasilkan tepat 5 soal.');
    END IF;

    -- 7. Tentukan Versi Baru
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM exam_question_sets
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    v_set_id := 'eqs_' || p_period_id || '_' || p_student_id || '_v' || v_version;

    -- 8. Simpan exam_question_sets (Status LOCKED secara atomik)
    INSERT INTO exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id,
        version, generation_strategy, generation_seed, material_fingerprint,
        status, generated_by, generated_at, locked_at, created_at, updated_at
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
        v_user.id,
        now(),
        now(),
        now(),
        now()
    );

    -- 9. Simpan 5 exam_questions
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        INSERT INTO exam_questions (
            id, question_set_id, question_number, zone_number,
            source_type, question_bank_id,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'eq_' || v_set_id || '_q' || (v_q->>'questionNumber'),
            v_set_id,
            (v_q->>'questionNumber')::INTEGER,
            (v_q->>'zoneNumber')::INTEGER,
            v_q->>'sourceType',
            v_q->>'questionBankId',
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

    -- 10. Audit Log
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
            'strategy', p_strategy,
            'status', 'locked',
            'questionsCount', 5
        ),
        'Pembuatan otomatis 5 soal UTS berdasarkan finalized material snapshot',
        now()
    );

    -- 11. Return Respon Sukses
    RETURN json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Berhasil membuat dan mengunci 5 soal UTS untuk santri.',
        'questionSet', json_build_object(
            'id', v_set_id,
            'examPeriodId', p_period_id,
            'studentId', p_student_id,
            'materialSnapshotId', v_snapshot.id,
            'version', v_version,
            'generationStrategy', p_strategy,
            'generationSeed', p_seed,
            'materialFingerprint', v_calculated_fingerprint,
            'status', 'locked',
            'generatedBy', v_user.id,
            'generatedAt', now(),
            'lockedAt', now()
        ),
        'questions', (
            SELECT json_agg(json_build_object(
                'id', q.id,
                'questionSetId', q.question_set_id,
                'questionNumber', q.question_number,
                'zoneNumber', q.zone_number,
                'sourceType', q.source_type,
                'questionBankId', q.question_bank_id,
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
            WHERE q.question_set_id = v_set_id
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 2: regenerate_uts_question_set (Admin Only, Void Old Version & Increment Version)
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
    v_new_set_id TEXT;
    v_new_version INTEGER := 1;
    v_q JSONB;
    v_calculated_fingerprint TEXT;
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    -- 2. Otorisasi Role: Wajib Admin
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak men-generate ulang soal ujian.');
    END IF;

    -- 3. Validasi Alasan: WAJIB
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan pembuatan ulang (regenerate) soal.');
    END IF;

    -- 4. Validasi Periode
    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND OR v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan atau telah terkunci.');
    END IF;

    -- 5. Validasi Snapshot
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Materi UTS santri belum difinalisasi.');
    END IF;

    -- Hitung fingerprint aktual
    v_calculated_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah,
        v_snapshot.start_ayah,
        v_snapshot.end_surah,
        v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    -- 6. Cari Set Lama
    SELECT * INTO v_old_set 
    FROM exam_question_sets 
    WHERE exam_period_id = p_period_id 
      AND student_id = p_student_id 
      AND status IN ('locked', 'stale')
    ORDER BY version DESC 
    LIMIT 1;

    IF FOUND THEN
        -- Tandai set lama sebagai 'void'
        UPDATE exam_question_sets 
        SET status = 'void', updated_at = now() 
        WHERE id = v_old_set.id;

        -- Catat audit pembatalan
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            before_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            p_period_id,
            p_student_id,
            'question_set_voided',
            v_user.id,
            jsonb_build_object('voidedSetId', v_old_set.id, 'version', v_old_set.version),
            p_reason,
            now()
        );

        v_new_version := v_old_set.version + 1;
    ELSE
        SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_version
        FROM exam_question_sets
        WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    END IF;

    -- 7. Validasi Tepat 5 Soal
    IF jsonb_array_length(p_questions_data) != 5 THEN
        RETURN json_build_object('success', false, 'message', 'Generator gagal: Wajib menghasilkan tepat 5 soal.');
    END IF;

    v_new_set_id := 'eqs_' || p_period_id || '_' || p_student_id || '_v' || v_new_version;

    -- 8. Insert Set Baru
    INSERT INTO exam_question_sets (
        id, exam_period_id, student_id, material_snapshot_id,
        version, generation_strategy, generation_seed, material_fingerprint,
        status, generated_by, generated_at, locked_at, created_at, updated_at
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
        v_user.id,
        now(),
        now(),
        now(),
        now()
    );

    -- 9. Insert 5 Questions
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        INSERT INTO exam_questions (
            id, question_set_id, question_number, zone_number,
            source_type, question_bank_id,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'eq_' || v_new_set_id || '_q' || (v_q->>'questionNumber'),
            v_new_set_id,
            (v_q->>'questionNumber')::INTEGER,
            (v_q->>'zoneNumber')::INTEGER,
            v_q->>'sourceType',
            v_q->>'questionBankId',
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

    -- 10. Audit Log Regenerated
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        p_student_id,
        'question_set_regenerated',
        v_user.id,
        jsonb_build_object(
            'newQuestionSetId', v_new_set_id,
            'version', v_new_version,
            'strategy', p_strategy
        ),
        p_reason,
        now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Berhasil melakukan generate ulang soal UTS (Versi ' || v_new_version || ').',
        'questionSet', json_build_object(
            'id', v_new_set_id,
            'examPeriodId', p_period_id,
            'studentId', p_student_id,
            'materialSnapshotId', v_snapshot.id,
            'version', v_new_version,
            'generationStrategy', p_strategy,
            'generationSeed', p_seed,
            'materialFingerprint', v_calculated_fingerprint,
            'status', 'locked',
            'generatedBy', v_user.id,
            'generatedAt', now(),
            'lockedAt', now()
        ),
        'questions', (
            SELECT json_agg(json_build_object(
                'id', q.id,
                'questionSetId', q.question_set_id,
                'questionNumber', q.question_number,
                'zoneNumber', q.zone_number,
                'sourceType', q.source_type,
                'questionBankId', q.question_bank_id,
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
            WHERE q.question_set_id = v_new_set_id
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 3: get_uts_question_set (Admin / Teacher View with Stale Detection)
CREATE OR REPLACE FUNCTION get_uts_question_set(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT,
    p_student_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_participant RECORD;
    v_snapshot RECORD;
    v_set RECORD;
    v_questions JSON;
    v_is_stale BOOLEAN := false;
    v_current_fingerprint TEXT;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    -- Otorisasi Role: Admin boleh semua, Guru hanya halaqahnya
    IF v_user.role = 'teacher' THEN
        SELECT * INTO v_participant FROM exam_participants 
        WHERE exam_period_id = p_period_id AND student_id = p_student_id;
        
        IF NOT FOUND OR v_participant.teacher_id_snapshot != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda hanya dapat melihat soal santri binaan halaqah Anda.');
        END IF;
    ELSIF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    -- Ambil set yang aktif (locked atau stale) versi tertinggi
    SELECT * INTO v_set 
    FROM exam_question_sets 
    WHERE exam_period_id = p_period_id 
      AND student_id = p_student_id 
      AND status IN ('locked', 'stale')
    ORDER BY version DESC 
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN json_build_object('success', true, 'hasQuestionSet', false, 'message', 'Soal UTS belum dibuat.');
    END IF;

    -- Cek apakah snapshot materi saat ini berbeda dari saat soal dibuat (stale detection)
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    IF FOUND THEN
        v_current_fingerprint := calculate_material_fingerprint(
            v_snapshot.start_surah,
            v_snapshot.start_ayah,
            v_snapshot.end_surah,
            v_snapshot.end_ayah,
            v_snapshot.memorization_direction
        );

        IF v_set.material_fingerprint != v_current_fingerprint THEN
            v_is_stale := true;
            IF v_set.status != 'stale' THEN
                UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_set.id;
                v_set.status := 'stale';
            END IF;
        END IF;
    END IF;

    -- Ambil 5 butir soal
    SELECT json_agg(json_build_object(
        'id', q.id,
        'questionSetId', q.question_set_id,
        'questionNumber', q.question_number,
        'zoneNumber', q.zone_number,
        'sourceType', q.source_type,
        'questionBankId', q.question_bank_id,
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
    ) ORDER BY q.question_number) INTO v_questions
    FROM exam_questions q
    WHERE q.question_set_id = v_set.id;

    RETURN json_build_object(
        'success', true,
        'hasQuestionSet', true,
        'isStale', v_is_stale,
        'questionSet', json_build_object(
            'id', v_set.id,
            'examPeriodId', v_set.exam_period_id,
            'studentId', v_set.student_id,
            'materialSnapshotId', v_set.material_snapshot_id,
            'version', v_set.version,
            'generationStrategy', v_set.generation_strategy,
            'generationSeed', v_set.generation_seed,
            'materialFingerprint', v_set.material_fingerprint,
            'status', v_set.status,
            'generatedBy', v_set.generated_by,
            'generatedAt', v_set.generated_at,
            'lockedAt', v_set.locked_at,
            'createdAt', v_set.created_at,
            'updatedAt', v_set.updated_at
        ),
        'questions', COALESCE(v_questions, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 4: get_period_question_sets_summary (List Status Soal Seluruh Santri di Periode)
CREATE OR REPLACE FUNCTION get_period_question_sets_summary(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_results JSON;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT json_agg(json_build_object(
        'studentId', p.student_id,
        'studentName', p.student_name_snapshot,
        'class', p.class_snapshot,
        'halaqah', p.halaqah_snapshot,
        'questionSetId', s.id,
        'status', s.status,
        'version', s.version,
        'generatedAt', s.generated_at,
        'hasQuestions', (s.id IS NOT NULL)
    )) INTO v_results
    FROM exam_participants p
    LEFT JOIN LATERAL (
        SELECT id, status, version, generated_at
        FROM exam_question_sets eqs
        WHERE eqs.exam_period_id = p_period_id 
          AND eqs.student_id = p.student_id 
          AND eqs.status IN ('locked', 'stale')
        ORDER BY eqs.version DESC 
        LIMIT 1
    ) s ON true
    WHERE p.exam_period_id = p_period_id
      AND (v_user.role = 'admin' OR p.teacher_id_snapshot = v_user.id);

    RETURN json_build_object(
        'success', true,
        'data', COALESCE(v_results, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
