-- ============================================================
-- SQL Migration: Bank Soal Tahfiz Permanen (Darul Abror IBS)
-- Non-destructive migration untuk Supabase PostgreSQL
-- ============================================================

-- 1. Tabel question_bank
CREATE TABLE IF NOT EXISTS question_bank (
    id TEXT PRIMARY KEY,
    exam_type TEXT NOT NULL DEFAULT 'generic' CHECK (exam_type IN ('generic', 'uts', 'uas')),
    question_type TEXT NOT NULL DEFAULT 'random' CHECK (question_type IN ('random', 'mandatory')),
    
    -- Posisi Struktural Titik A (Awal Prompt Penguji)
    prompt_start_surah INTEGER NOT NULL CHECK (prompt_start_surah BETWEEN 1 AND 114),
    prompt_start_ayah INTEGER NOT NULL CHECK (prompt_start_ayah >= 1),
    prompt_start_word INTEGER NOT NULL CHECK (prompt_start_word >= 1),
    
    -- Posisi Struktural Titik A' (Akhir Prompt Penguji)
    prompt_end_surah INTEGER NOT NULL CHECK (prompt_end_surah BETWEEN 1 AND 114),
    prompt_end_ayah INTEGER NOT NULL CHECK (prompt_end_ayah >= 1),
    prompt_end_word INTEGER NOT NULL CHECK (prompt_end_word >= 1),
    
    -- Posisi Struktural Titik B (Santri Mulai Menjawab)
    answer_start_surah INTEGER NOT NULL CHECK (answer_start_surah BETWEEN 1 AND 114),
    answer_start_ayah INTEGER NOT NULL CHECK (answer_start_ayah >= 1),
    answer_start_word INTEGER NOT NULL CHECK (answer_start_word >= 1),
    
    -- Posisi Struktural Titik C (Batas Akhir Jawaban Santri)
    answer_end_surah INTEGER NOT NULL CHECK (answer_end_surah BETWEEN 1 AND 114),
    answer_end_ayah INTEGER NOT NULL CHECK (answer_end_ayah >= 1),
    answer_end_word INTEGER NOT NULL CHECK (answer_end_word >= 1),
    
    -- Posisi Halaman & Juz Mushaf Standar Madinah (1–604, 1–30)
    start_page INTEGER NOT NULL CHECK (start_page BETWEEN 1 AND 604),
    end_page INTEGER NOT NULL CHECK (end_page BETWEEN 1 AND 604),
    start_juz INTEGER NOT NULL CHECK (start_juz BETWEEN 1 AND 30),
    end_juz INTEGER NOT NULL CHECK (end_juz BETWEEN 1 AND 30),
    
    -- Teks Snapshot (untuk preview cepat & riwayat)
    prompt_text TEXT NOT NULL,
    answer_text TEXT NOT NULL,
    total_expected_words INTEGER NOT NULL DEFAULT 0 CHECK (total_expected_words >= 0),
    
    -- Mode Batas & Kesulitan
    answer_mode TEXT NOT NULL DEFAULT 'end_ayah' CHECK (answer_mode IN ('end_ayah', '3_lines', '5_lines', 'specific_ayah', 'manual')),
    difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    
    -- Metadata
    tags JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
    
    -- Audit Timestamps & Creator (users.id berformat TEXT)
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    archived_at TIMESTAMP WITH TIME ZONE,

    -- Validasi Struktural Al-Qur'an di Database: A <= A' < B <= C
    CONSTRAINT chk_qb_page_order CHECK (start_page <= end_page),
    CONSTRAINT chk_qb_juz_order CHECK (start_juz <= end_juz),
    CONSTRAINT chk_qb_a_lte_a_end CHECK (
        (prompt_start_surah < prompt_end_surah) OR 
        (prompt_start_surah = prompt_end_surah AND prompt_start_ayah < prompt_end_ayah) OR 
        (prompt_start_surah = prompt_end_surah AND prompt_start_ayah = prompt_end_ayah AND prompt_start_word <= prompt_end_word)
    ),
    CONSTRAINT chk_qb_a_end_lt_b CHECK (
        (prompt_end_surah < answer_start_surah) OR 
        (prompt_end_surah = answer_start_surah AND prompt_end_ayah < answer_start_ayah) OR 
        (prompt_end_surah = answer_start_surah AND prompt_end_ayah = answer_start_ayah AND prompt_end_word < answer_start_word)
    ),
    CONSTRAINT chk_qb_b_lte_c CHECK (
        (answer_start_surah < answer_end_surah) OR 
        (answer_start_surah = answer_end_surah AND answer_start_ayah < answer_end_ayah) OR 
        (answer_start_surah = answer_end_surah AND answer_start_ayah = answer_end_ayah AND answer_start_word <= answer_end_word)
    )
);

-- 2. Index untuk Optimasi Pencarian, Filter & Deteksi Duplikasi
-- Index Duplicate Detection: Mencakup SEMUA 12 koordinat posisi (A, A', B, C) termasuk lintas surat
CREATE INDEX IF NOT EXISTS idx_question_bank_exact_points ON question_bank (
    prompt_start_surah, prompt_start_ayah, prompt_start_word,
    prompt_end_surah, prompt_end_ayah, prompt_end_word,
    answer_start_surah, answer_start_ayah, answer_start_word,
    answer_end_surah, answer_end_ayah, answer_end_word
);

-- Index Pencarian & Filtering
CREATE INDEX IF NOT EXISTS idx_question_bank_status_exam ON question_bank (status, exam_type, question_type);
CREATE INDEX IF NOT EXISTS idx_question_bank_juz_surah ON question_bank (start_juz, prompt_start_surah);
CREATE INDEX IF NOT EXISTS idx_question_bank_difficulty ON question_bank (difficulty);
CREATE INDEX IF NOT EXISTS idx_question_bank_updated_at ON question_bank (updated_at DESC);

-- 3. Trigger Otomatis: Update updated_at pada Setiap Perubahan Baris
CREATE OR REPLACE FUNCTION set_question_bank_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_question_bank_updated_at ON question_bank;
CREATE TRIGGER trg_question_bank_updated_at
BEFORE UPDATE ON question_bank
FOR EACH ROW
EXECUTE FUNCTION set_question_bank_updated_at();

-- 4. Enable Row Level Security (RLS)
ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;

-- Policy RLS: Tolak akses langsung tabel dari anon/unauthenticated client.
-- Semua operasi data Bank Soal wajib melalui Secure RPC (SECURITY DEFINER)
-- yang memverifikasi kredensial admin secara eksplisit.
DROP POLICY IF EXISTS qb_deny_direct_access ON question_bank;
CREATE POLICY qb_deny_direct_access ON question_bank
    FOR ALL
    USING (false);

-- 5. RPC: Upsert Question Bank Item (Admin Only dengan Verifikasi Password)
CREATE OR REPLACE FUNCTION upsert_question_bank_item(
    p_username TEXT, 
    p_password TEXT, 
    p_data JSONB
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
    v_user_id TEXT;
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
BEGIN
    -- 1. Verifikasi kredensial actor langsung ke tabel users (Admin Only)
    SELECT id, role INTO v_user_id, v_role FROM users 
    WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengelola Bank Soal.');
    END IF;

    -- 2. Parsing koordinat struktural A, A', B, C
    v_a_surah := (p_data->'prompt_start'->>'surah')::INT;
    v_a_ayah  := (p_data->'prompt_start'->>'ayah')::INT;
    v_a_word  := (p_data->'prompt_start'->>'word')::INT;

    v_ae_surah := (p_data->'prompt_end'->>'surah')::INT;
    v_ae_ayah  := (p_data->'prompt_end'->>'ayah')::INT;
    v_ae_word  := (p_data->'prompt_end'->>'word')::INT;

    v_b_surah := (p_data->'answer_start'->>'surah')::INT;
    v_b_ayah  := (p_data->'answer_start'->>'ayah')::INT;
    v_b_word  := (p_data->'answer_start'->>'word')::INT;

    v_c_surah := (p_data->'answer_end'->>'surah')::INT;
    v_c_ayah  := (p_data->'answer_end'->>'ayah')::INT;
    v_c_word  := (p_data->'answer_end'->>'word')::INT;

    v_start_page := (p_data->>'start_page')::INT;
    v_end_page   := (p_data->>'end_page')::INT;
    v_start_juz  := (p_data->>'start_juz')::INT;
    v_end_juz    := (p_data->>'end_juz')::INT;

    -- 3. Validasi Batas Nilai Al-Qur'an di Backend
    IF v_a_surah < 1 OR v_a_surah > 114 OR v_ae_surah < 1 OR v_ae_surah > 114 OR
       v_b_surah < 1 OR v_b_surah > 114 OR v_c_surah < 1 OR v_c_surah > 114 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Nomor surat harus antara 1 dan 114.');
    END IF;

    IF v_start_page < 1 OR v_start_page > 604 OR v_end_page < 1 OR v_end_page > 604 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Halaman mushaf harus antara 1 dan 604.');
    END IF;

    IF v_start_juz < 1 OR v_start_juz > 30 OR v_end_juz < 1 OR v_end_juz > 30 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Juz Al-Qur''an harus antara 1 dan 30.');
    END IF;

    -- 4. Validasi Struktural A <= A' < B <= C di Backend
    IF (v_a_surah > v_ae_surah) OR 
       (v_a_surah = v_ae_surah AND v_a_ayah > v_ae_ayah) OR 
       (v_a_surah = v_ae_surah AND v_a_ayah = v_ae_ayah AND v_a_word > v_ae_word) THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Titik A awal prompt tidak boleh melebihi akhir prompt A''.');
    END IF;

    IF (v_ae_surah > v_b_surah) OR 
       (v_ae_surah = v_b_surah AND v_ae_ayah > v_b_ayah) OR 
       (v_ae_surah = v_b_surah AND v_ae_ayah = v_b_ayah AND v_ae_word >= v_b_word) THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Titik B santri menjawab harus setelah akhir prompt A''.');
    END IF;

    IF (v_b_surah > v_c_surah) OR 
       (v_b_surah = v_c_surah AND v_b_ayah > v_c_ayah) OR 
       (v_b_surah = v_c_surah AND v_b_ayah = v_c_ayah AND v_b_word > v_c_word) THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Titik B santri menjawab tidak boleh melebihi batas akhir C.');
    END IF;

    v_id := COALESCE(p_data->>'id', 'qb_' || floor(extract(epoch from now()))::text || '_' || substr(md5(random()::text), 1, 6));

    -- 5. Eksekusi Upsert
    INSERT INTO question_bank (
        id,
        exam_type,
        question_type,
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
        updated_at
    ) VALUES (
        v_id,
        COALESCE(p_data->>'exam_type', 'generic'),
        COALESCE(p_data->>'question_type', 'random'),
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
        p_data->>'prompt_text',
        p_data->>'answer_text',
        COALESCE((p_data->>'total_expected_words')::INT, 0),
        COALESCE(p_data->>'answer_mode', 'end_ayah'),
        COALESCE(p_data->>'difficulty', 'medium'),
        COALESCE(p_data->'tags', '[]'::jsonb),
        p_data->>'notes',
        COALESCE(p_data->>'status', 'active'),
        v_user_id,
        timezone('utc'::text, now())
    )
    ON CONFLICT (id) DO UPDATE SET
        exam_type = EXCLUDED.exam_type,
        question_type = EXCLUDED.question_type,
        prompt_start_surah = EXCLUDED.prompt_start_surah,
        prompt_start_ayah = EXCLUDED.prompt_start_ayah,
        prompt_start_word = EXCLUDED.prompt_start_word,
        prompt_end_surah = EXCLUDED.prompt_end_surah,
        prompt_end_ayah = EXCLUDED.prompt_end_ayah,
        prompt_end_word = EXCLUDED.prompt_end_word,
        answer_start_surah = EXCLUDED.answer_start_surah,
        answer_start_ayah = EXCLUDED.answer_start_ayah,
        answer_start_word = EXCLUDED.answer_start_word,
        answer_end_surah = EXCLUDED.answer_end_surah,
        answer_end_ayah = EXCLUDED.answer_end_ayah,
        answer_end_word = EXCLUDED.answer_end_word,
        start_page = EXCLUDED.start_page,
        end_page = EXCLUDED.end_page,
        start_juz = EXCLUDED.start_juz,
        end_juz = EXCLUDED.end_juz,
        prompt_text = EXCLUDED.prompt_text,
        answer_text = EXCLUDED.answer_text,
        total_expected_words = EXCLUDED.total_expected_words,
        answer_mode = EXCLUDED.answer_mode,
        difficulty = EXCLUDED.difficulty,
        tags = EXCLUDED.tags,
        notes = EXCLUDED.notes,
        status = EXCLUDED.status,
        updated_at = timezone('utc'::text, now());

    RETURN json_build_object('success', true, 'id', v_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RPC: Archive Question Bank Item (Admin Only)
CREATE OR REPLACE FUNCTION archive_question_bank_item(
    p_username TEXT, 
    p_password TEXT, 
    p_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT role INTO v_role FROM users 
    WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengarsipkan soal.');
    END IF;

    UPDATE question_bank 
    SET status = 'archived', 
        archived_at = timezone('utc'::text, now()), 
        updated_at = timezone('utc'::text, now())
    WHERE id = p_id;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RPC: Restore Question Bank Item (Admin Only)
CREATE OR REPLACE FUNCTION restore_question_bank_item(
    p_username TEXT, 
    p_password TEXT, 
    p_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT role INTO v_role FROM users 
    WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak memulihkan soal.');
    END IF;

    UPDATE question_bank 
    SET status = 'active', 
        archived_at = NULL, 
        updated_at = timezone('utc'::text, now())
    WHERE id = p_id;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. RPC: Get Question Bank Secure (Admin Only)
CREATE OR REPLACE FUNCTION get_question_bank_secure(
    p_username TEXT, 
    p_password TEXT
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
    v_items JSON;
BEGIN
    SELECT role INTO v_role FROM users 
    WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membaca Bank Soal.');
    END IF;

    SELECT json_agg(q ORDER BY q.updated_at DESC) INTO v_items FROM question_bank q;

    RETURN json_build_object('success', true, 'data', COALESCE(v_items, '[]'::json));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
