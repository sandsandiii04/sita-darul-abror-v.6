-- ============================================================
-- SQL Migration: Tahap 7B — Remedial Generator Engine
-- SITA — Sistem Informasi Tahfidz Al-Qur'an (Darul Abror IBS)
-- Non-Destructive Additive Migration (Zero Modification to Locked Modules)
-- ============================================================
-- Catatan Keamanan & Arsitektur:
-- 1. Migration ini 100% ADITIF. Tidak mengubah atau menambahkan kolom pada
--    tabel locked (exam_periods, exam_participants, exam_material_snapshots,
--    exam_question_sets, exam_questions, exam_attempts, exam_question_assessments).
-- 2. Menjamin isolasi penuh paket soal remedial dari paket soal original
--    sehingga tidak mengganggu kueri pelaksanaan ujian original (5B & 6B).
-- 3. Database menjamin invariant "Maksimal 1 Remedial per Komponen Ujian per Santri".
-- 4. RPC dilindungi Admin-Only Authentication (users.password + extensions.crypt)
--    dan berjalan dengan SECURITY DEFINER & SET search_path = public, pg_temp.
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABEL ADITIF: exam_remedial_sessions
-- Identitas & Status Sesi Remedial Resmi per Santri per Komponen
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_remedial_sessions (
    id TEXT PRIMARY KEY,
    original_exam_period_id TEXT NOT NULL REFERENCES exam_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    exam_type TEXT NOT NULL CHECK (exam_type IN ('uts', 'uas')),
    original_attempt_id TEXT NOT NULL REFERENCES exam_attempts(id) ON DELETE RESTRICT,
    original_question_set_id TEXT NOT NULL REFERENCES exam_question_sets(id) ON DELETE RESTRICT,
    material_snapshot_id TEXT NOT NULL REFERENCES exam_material_snapshots(id) ON DELETE RESTRICT,
    remedial_question_set_id TEXT, -- Diisi setelah paket soal dibangkitkan
    status TEXT NOT NULL DEFAULT 'eligible' CHECK (status IN ('eligible', 'generating', 'generated', 'locked', 'stale', 'invalid')),
    generation_version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    -- Invariant Unik: Maksimal 1 sesi remedial per komponen per santri
    CONSTRAINT uq_remedial_session_period_student UNIQUE (original_exam_period_id, student_id),
    -- Invariant Unik: 1 attempt original hanya memiliki 1 sesi remedial
    CONSTRAINT uq_remedial_session_attempt UNIQUE (original_attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_ers_period_student ON exam_remedial_sessions(original_exam_period_id, student_id);
CREATE INDEX IF NOT EXISTS idx_ers_attempt ON exam_remedial_sessions(original_attempt_id);
CREATE INDEX IF NOT EXISTS idx_ers_status ON exam_remedial_sessions(status);
CREATE INDEX IF NOT EXISTS idx_ers_snapshot ON exam_remedial_sessions(material_snapshot_id);

-- RLS: Proteksi Akses Langsung
ALTER TABLE exam_remedial_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ers_deny_direct_access ON exam_remedial_sessions;
CREATE POLICY ers_deny_direct_access ON exam_remedial_sessions FOR ALL USING (false);


-- ------------------------------------------------------------
-- 2. TABEL ADITIF: exam_remedial_question_sets
-- Paket Soal Remedial Terkunci (5 Soal UTS / 9 Soal UAS)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_remedial_question_sets (
    id TEXT PRIMARY KEY,
    remedial_session_id TEXT NOT NULL REFERENCES exam_remedial_sessions(id) ON DELETE CASCADE,
    original_exam_period_id TEXT NOT NULL REFERENCES exam_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    exam_type TEXT NOT NULL CHECK (exam_type IN ('uts', 'uas')),
    material_snapshot_id TEXT NOT NULL REFERENCES exam_material_snapshots(id) ON DELETE RESTRICT,
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

    CONSTRAINT uq_erqs_session_version UNIQUE (remedial_session_id, version)
);

CREATE INDEX IF NOT EXISTS idx_erqs_session ON exam_remedial_question_sets(remedial_session_id);
CREATE INDEX IF NOT EXISTS idx_erqs_period_student ON exam_remedial_question_sets(original_exam_period_id, student_id);
CREATE INDEX IF NOT EXISTS idx_erqs_status ON exam_remedial_question_sets(status);

-- Foreign Key sirkular aman dari exam_remedial_sessions ke exam_remedial_question_sets
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_ers_remedial_question_set'
    ) THEN
        ALTER TABLE exam_remedial_sessions 
        ADD CONSTRAINT fk_ers_remedial_question_set 
        FOREIGN KEY (remedial_question_set_id) 
        REFERENCES exam_remedial_question_sets(id) ON DELETE SET NULL;
    END IF;
END $$;

-- RLS: Proteksi Akses Langsung
ALTER TABLE exam_remedial_question_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erqs_deny_direct_access ON exam_remedial_question_sets;
CREATE POLICY erqs_deny_direct_access ON exam_remedial_question_sets FOR ALL USING (false);


-- ------------------------------------------------------------
-- 3. TABEL ADITIF: exam_remedial_questions
-- Butir Soal Remedial (Koordinat Struktural Quran & Anti-Reuse)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_remedial_questions (
    id TEXT PRIMARY KEY,
    remedial_question_set_id TEXT NOT NULL REFERENCES exam_remedial_question_sets(id) ON DELETE CASCADE,
    question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 9),
    zone_number INTEGER CHECK (zone_number IS NULL OR (zone_number BETWEEN 1 AND 7)),
    question_role TEXT NOT NULL DEFAULT 'random' CHECK (question_role IN ('mandatory', 'random')),
    source_type TEXT NOT NULL CHECK (source_type IN ('bank', 'auto')),
    question_bank_id TEXT REFERENCES question_bank(id) ON DELETE SET NULL,
    page_number INTEGER CHECK (page_number IS NULL OR (page_number BETWEEN 1 AND 604)),
    max_score NUMERIC(5,2) NOT NULL DEFAULT 20.00 CHECK (max_score > 0 AND max_score <= 100),

    -- Koordinat Prompt Penguji (A dan A-aksen)
    prompt_start_surah INTEGER CHECK (prompt_start_surah IS NULL OR (prompt_start_surah BETWEEN 1 AND 114)),
    prompt_start_ayah INTEGER CHECK (prompt_start_ayah IS NULL OR prompt_start_ayah >= 1),
    prompt_start_word INTEGER CHECK (prompt_start_word IS NULL OR prompt_start_word >= 1),
    prompt_end_surah INTEGER CHECK (prompt_end_surah IS NULL OR (prompt_end_surah BETWEEN 1 AND 114)),
    prompt_end_ayah INTEGER CHECK (prompt_end_ayah IS NULL OR prompt_end_ayah >= 1),
    prompt_end_word INTEGER CHECK (prompt_end_word IS NULL OR prompt_end_word >= 1),

    -- Koordinat Jawaban Santri (B dan C)
    answer_start_surah INTEGER NOT NULL CHECK (answer_start_surah BETWEEN 1 AND 114),
    answer_start_ayah INTEGER NOT NULL CHECK (answer_start_ayah >= 1),
    answer_start_word INTEGER NOT NULL CHECK (answer_start_word >= 1),
    answer_end_surah INTEGER NOT NULL CHECK (answer_end_surah BETWEEN 1 AND 114),
    answer_end_ayah INTEGER NOT NULL CHECK (answer_end_ayah >= 1),
    answer_end_word INTEGER NOT NULL CHECK (answer_end_word >= 1),

    -- Halaman Mushaf Madinah
    start_page INTEGER CHECK (start_page BETWEEN 1 AND 604),
    end_page INTEGER CHECK (end_page BETWEEN 1 AND 604),

    generated_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    -- Keunikan per nomor dalam satu paket soal remedial
    CONSTRAINT uq_erq_set_number UNIQUE (remedial_question_set_id, question_number),

    -- Validasi spesifik per role (mandatory vs random)
    CONSTRAINT chk_erq_role_fields CHECK (
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
    ),

    -- Urutan jawaban B <= C
    CONSTRAINT chk_erq_b_lte_c CHECK (
        (answer_start_surah < answer_end_surah) OR
        (answer_start_surah = answer_end_surah AND answer_start_ayah < answer_end_ayah) OR
        (answer_start_surah = answer_end_surah AND answer_start_ayah = answer_end_ayah AND answer_start_word <= answer_end_word)
    ),

    -- Urutan prompt A <= A' < B (khusus random sambung ayat)
    CONSTRAINT chk_erq_a_lte_a_end CHECK (
        question_role = 'mandatory' OR
        (prompt_start_surah < prompt_end_surah) OR
        (prompt_start_surah = prompt_end_surah AND prompt_start_ayah < prompt_end_ayah) OR
        (prompt_start_surah = prompt_end_surah AND prompt_start_ayah = prompt_end_ayah AND prompt_start_word <= prompt_end_word)
    ),
    CONSTRAINT chk_erq_a_end_lt_b CHECK (
        question_role = 'mandatory' OR
        (prompt_end_surah < answer_start_surah) OR
        (prompt_end_surah = answer_start_surah AND prompt_end_ayah < answer_start_ayah) OR
        (prompt_end_surah = answer_start_surah AND prompt_end_ayah = answer_start_ayah AND prompt_end_word < answer_start_word)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_erq_set_zone_not_null 
ON exam_remedial_questions (remedial_question_set_id, zone_number) 
WHERE zone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_erq_set_id ON exam_remedial_questions(remedial_question_set_id);
CREATE INDEX IF NOT EXISTS idx_erq_qbank_id ON exam_remedial_questions(question_bank_id);

-- RLS: Proteksi Akses Langsung
ALTER TABLE exam_remedial_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erq_deny_direct_access ON exam_remedial_questions;
CREATE POLICY erq_deny_direct_access ON exam_remedial_questions FOR ALL USING (false);


-- ============================================================
-- 4. STORED PROCEDURES (SECURITY DEFINER RPC) — TAHAP 7B
-- ============================================================

-- ------------------------------------------------------------
-- RPC 1: get_remedial_generation_candidates (Admin Only)
-- Mengambil daftar santri yang berhak mengikuti remedial dan status paketnya
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_remedial_generation_candidates(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_remedial_generation_candidates(
    p_username TEXT,
    p_password TEXT,
    p_academic_term_id TEXT DEFAULT NULL,
    p_config_id TEXT DEFAULT NULL,
    p_exam_period_id TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_candidates JSONB := '[]'::jsonb;
    v_total_candidates INTEGER := 0;
    v_ready_count INTEGER := 0;
    v_pending_count INTEGER := 0;
    v_r RECORD;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengelola persiapan remedial.');
    END IF;

    -- 2. Query Kandidat Remedial yang Sah (Server-Authoritative)
    -- Syarat: Ujian original berstatus submitted, nilai < KKM, snapshot finalized
    FOR v_r IN
        SELECT 
            s.id AS student_id,
            s.name AS student_name,
            s.nis AS student_nis,
            COALESCE(p.class_snapshot, s.class) AS class_name,
            COALESCE(p.halaqah_snapshot, s.halaqah) AS halaqah,
            ep.id AS original_period_id,
            ep.name AS original_period_name,
            ep.exam_type,
            ep.kkm,
            att.id AS original_attempt_id,
            att.question_set_id AS original_question_set_id,
            att.total_score AS original_score,
            att.submitted_at AS original_submitted_at,
            ems.id AS material_snapshot_id,
            ers.id AS remedial_session_id,
            COALESCE(ers.status, 'eligible') AS session_status,
            erqs.id AS remedial_question_set_id,
            erqs.version AS remedial_version,
            erqs.status AS remedial_set_status,
            (
                SELECT COUNT(*) FROM exam_remedial_questions erq 
                WHERE erq.remedial_question_set_id = erqs.id
            ) AS remedial_question_count
        FROM exam_attempts att
        JOIN exam_periods ep ON ep.id = att.exam_period_id
        JOIN students s ON s.id = att.student_id
        JOIN exam_participants p ON p.exam_period_id = ep.id AND p.student_id = s.id
        JOIN exam_material_snapshots ems ON ems.exam_period_id = ep.id AND ems.student_id = s.id
        LEFT JOIN exam_remedial_sessions ers ON ers.original_exam_period_id = ep.id AND ers.student_id = s.id
        LEFT JOIN exam_remedial_question_sets erqs ON erqs.id = ers.remedial_question_set_id
        WHERE att.status = 'submitted'
          AND att.total_score < ep.kkm
          AND ems.status = 'finalized'
          AND (p_exam_period_id IS NULL OR ep.id = p_exam_period_id)
          AND (p_academic_term_id IS NULL OR ep.academic_term_id = p_academic_term_id)
        ORDER BY class_name ASC, s.name ASC, ep.exam_type ASC
    LOOP
        v_total_candidates := v_total_candidates + 1;
        IF v_r.remedial_set_status = 'locked' THEN
            v_ready_count := v_ready_count + 1;
        ELSE
            v_pending_count := v_pending_count + 1;
        END IF;

        v_candidates := v_candidates || jsonb_build_object(
            'studentId', v_r.student_id,
            'studentName', v_r.student_name,
            'studentNis', v_r.student_nis,
            'className', v_r.class_name,
            'halaqah', v_r.halaqah,
            'examType', v_r.exam_type,
            'originalPeriodId', v_r.original_period_id,
            'originalPeriodName', v_r.original_period_name,
            'originalAttemptId', v_r.original_attempt_id,
            'originalQuestionSetId', v_r.original_question_set_id,
            'originalScore', v_r.original_score,
            'kkm', v_r.kkm,
            'materialSnapshotId', v_r.material_snapshot_id,
            'remedialSessionId', v_r.remedial_session_id,
            'generationStatus', v_r.session_status,
            'remedialQuestionSetId', v_r.remedial_question_set_id,
            'remedialVersion', v_r.remedial_version,
            'isPackageReady', (v_r.remedial_set_status = 'locked'),
            'questionCount', v_r.remedial_question_count
        );
    END LOOP;

    RETURN json_build_object(
        'success', true,
        'summary', jsonb_build_object(
            'totalCandidates', v_total_candidates,
            'readyCount', v_ready_count,
            'pendingCount', v_pending_count
        ),
        'candidates', v_candidates
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 2: generate_uts_remedial_question_set (Admin Only)
-- Pembangkitan Paket Soal UTS Remedial (Tepat 5 Soal, 5 Zona, Anti-Reuse)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS generate_uts_remedial_question_set(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION generate_uts_remedial_question_set(
    p_username TEXT,
    p_password TEXT,
    p_original_period_id TEXT,
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
    v_orig_attempt RECORD;
    v_orig_qs RECORD;
    v_session RECORD;
    v_existing_set RECORD;
    v_session_id TEXT;
    v_set_id TEXT;
    v_q JSONB;
    v_q_num INTEGER;
    v_z_num INTEGER;
    v_as_s INTEGER;
    v_as_a INTEGER;
    v_as_w INTEGER;
    v_ae_s INTEGER;
    v_ae_a INTEGER;
    v_ae_w INTEGER;
    v_ps_s INTEGER;
    v_ps_a INTEGER;
    v_ps_w INTEGER;
    v_pe_s INTEGER;
    v_pe_a INTEGER;
    v_pe_w INTEGER;
    v_qb_id TEXT;
    v_b_key TEXT;
    v_used_b_keys TEXT[] := ARRAY[]::TEXT[];
    v_used_zones INTEGER[] := ARRAY[]::INTEGER[];
    v_orig_b_keys TEXT[] := ARRAY[]::TEXT[];
    v_orig_qb_ids TEXT[] := ARRAY[]::TEXT[];
    v_calc_fingerprint TEXT;
    v_inserted_questions JSONB := '[]'::jsonb;
    v_submitted_count INTEGER := 0;
    v_row RECORD;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuat soal remedial UTS.');
    END IF;

    -- 2. Validasi Periode Original (Khusus UTS)
    SELECT * INTO v_period FROM exam_periods WHERE id = p_original_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian UTS tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uts' THEN
        RETURN json_build_object('success', false, 'message', 'Generator ini khusus untuk remedial ujian UTS.');
    END IF;

    -- 3. Validasi Attempt Original: Wajib unik, status = submitted, nilai < KKM
    -- Proteksi Gate 9: Tidak boleh ambigu dengan LIMIT 1 jika terdapat >1 attempt submitted
    SELECT COUNT(*) INTO v_submitted_count FROM exam_attempts
    WHERE exam_period_id = p_original_period_id 
      AND student_id = p_student_id 
      AND status = 'submitted';

    IF v_submitted_count > 1 THEN
        RETURN json_build_object('success', false, 'message', 'INTEGRITY_VIOLATION: Ditemukan lebih dari 1 attempt original berstatus submitted untuk santri ini (' || v_submitted_count || ' attempt). Pemilihan attempt tidak boleh ambigu (LIMIT 1 dilarang).');
    END IF;

    IF v_submitted_count = 0 THEN
        RETURN json_build_object('success', false, 'message', 'Santri belum menyelesaikan ujian UTS original.');
    END IF;

    SELECT * INTO v_orig_attempt FROM exam_attempts
    WHERE exam_period_id = p_original_period_id 
      AND student_id = p_student_id 
      AND status = 'submitted';

    IF v_orig_attempt.total_score >= v_period.kkm THEN
        RETURN json_build_object('success', false, 'message', 'Nilai UTS santri (' || v_orig_attempt.total_score || ') sudah mencapai KKM (' || v_period.kkm || '). Santri tidak berhak mengikuti remedial.');
    END IF;

    -- 4. Validasi Snapshot Materi Original: Wajib FINALIZED
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE id = (
        SELECT material_snapshot_id FROM exam_question_sets WHERE id = v_orig_attempt.question_set_id
    );

    IF NOT FOUND THEN
        SELECT * INTO v_snapshot FROM exam_material_snapshots
        WHERE exam_period_id = p_original_period_id AND student_id = p_student_id;
    END IF;

    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi original santri belum difinalisasi.');
    END IF;

    -- Validasi Fingerprint
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF p_fingerprint IS NOT NULL AND p_fingerprint != '' AND p_fingerprint != v_calc_fingerprint THEN
        RETURN json_build_object('success', false, 'message', 'Material fingerprint mismatch: Materi santri tidak sesuai.');
    END IF;

    -- 5. Ambil exclusion list dari soal original UTS (Anti-Reuse)
    FOR v_row IN 
        SELECT answer_start_surah, answer_start_ayah, answer_start_word, question_bank_id 
        FROM exam_questions 
        WHERE question_set_id = v_orig_attempt.question_set_id
    LOOP
        v_orig_b_keys := array_append(v_orig_b_keys, v_row.answer_start_surah || ':' || v_row.answer_start_ayah || ':' || v_row.answer_start_word);
        IF v_row.question_bank_id IS NOT NULL THEN
            v_orig_qb_ids := array_append(v_orig_qb_ids, v_row.question_bank_id);
        END IF;
    END LOOP;

    -- 6. IDEMPOTENCY CHECK: Cek apakah sesi & paket soal remedial sudah pernah dibuat
    SELECT * INTO v_session FROM exam_remedial_sessions 
    WHERE original_exam_period_id = p_original_period_id AND student_id = p_student_id;

    IF FOUND AND v_session.remedial_question_set_id IS NOT NULL THEN
        SELECT * INTO v_existing_set FROM exam_remedial_question_sets
        WHERE id = v_session.remedial_question_set_id AND status = 'locked';

        IF FOUND THEN
            -- Kembalikan paket existing tanpa mengubah data apapun
            SELECT json_agg(row_to_json(q.*) ORDER BY q.question_number)
            INTO v_inserted_questions
            FROM exam_remedial_questions q
            WHERE q.remedial_question_set_id = v_existing_set.id;

            RETURN json_build_object(
                'success', true,
                'isExisting', true,
                'message', 'Paket soal remedial UTS santri sudah dibuat dan terkunci sebelumnya.',
                'remedialSession', row_to_json(v_session),
                'questionSet', row_to_json(v_existing_set),
                'questions', COALESCE(v_inserted_questions, '[]'::jsonb)
            );
        END IF;
    END IF;

    -- 7. Validasi Payload Input: Wajib Tepat 5 Soal
    IF jsonb_array_length(p_questions_data) != 5 THEN
        RETURN json_build_object('success', false, 'message', 'Generator gagal: Wajib menghasilkan tepat 5 soal remedial UTS.');
    END IF;

    -- 8. Validasi Detail Butir Soal & Anti-Reuse
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        v_q_num := (v_q->>'questionNumber')::INTEGER;
        v_z_num := (v_q->>'zoneNumber')::INTEGER;
        v_qb_id := v_q->>'questionBankId';

        IF v_q_num NOT BETWEEN 1 AND 5 THEN
            RETURN json_build_object('success', false, 'message', 'Nomor soal UTS remedial harus antara 1 dan 5.');
        END IF;

        IF v_z_num NOT BETWEEN 1 AND 5 THEN
            RETURN json_build_object('success', false, 'message', 'Nomor zona UTS remedial harus antara 1 dan 5.');
        END IF;

        IF v_z_num = ANY(v_used_zones) THEN
            RETURN json_build_object('success', false, 'message', 'Duplikasi zona terdeteksi pada butir soal remedial nomor ' || v_q_num);
        END IF;
        v_used_zones := array_append(v_used_zones, v_z_num);

        v_ps_s := (v_q->>'promptStartSurah')::INTEGER;
        v_ps_a := (v_q->>'promptStartAyah')::INTEGER;
        v_ps_w := (v_q->>'promptStartWord')::INTEGER;
        v_pe_s := (v_q->>'promptEndSurah')::INTEGER;
        v_pe_a := (v_q->>'promptEndAyah')::INTEGER;
        v_pe_w := (v_q->>'promptEndWord')::INTEGER;

        v_as_s := (v_q->>'answerStartSurah')::INTEGER;
        v_as_a := (v_q->>'answerStartAyah')::INTEGER;
        v_as_w := (v_q->>'answerStartWord')::INTEGER;
        v_ae_s := (v_q->>'answerEndSurah')::INTEGER;
        v_ae_a := (v_q->>'answerEndAyah')::INTEGER;
        v_ae_w := (v_q->>'answerEndWord')::INTEGER;

        -- Validasi koordinat dasar
        IF v_as_s NOT BETWEEN 1 AND 114 OR v_as_a < 1 OR v_as_w < 1 OR
           v_ae_s NOT BETWEEN 1 AND 114 OR v_ae_a < 1 OR v_ae_w < 1 OR
           v_ps_s NOT BETWEEN 1 AND 114 OR v_ps_a < 1 OR v_ps_w < 1 OR
           v_pe_s NOT BETWEEN 1 AND 114 OR v_pe_a < 1 OR v_pe_w < 1 THEN
            RETURN json_build_object('success', false, 'message', 'Koordinat ayat/kata pada butir soal remedial ' || v_q_num || ' tidak valid.');
        END IF;

        -- Validasi urutan A <= A' < B <= C
        IF (v_ps_s > v_pe_s) OR (v_ps_s = v_pe_s AND v_ps_a > v_pe_a) OR (v_ps_s = v_pe_s AND v_ps_a = v_pe_a AND v_ps_w > v_pe_w) THEN
            RETURN json_build_object('success', false, 'message', 'Urutan prompt A ke A-aksen tidak valid pada butir ' || v_q_num);
        END IF;

        IF (v_pe_s > v_as_s) OR (v_pe_s = v_as_s AND v_pe_a > v_as_a) OR (v_pe_s = v_as_s AND v_pe_a = v_as_a AND v_pe_w >= v_as_w) THEN
            RETURN json_build_object('success', false, 'message', 'Titik B harus setelah A-aksen pada butir ' || v_q_num);
        END IF;

        IF (v_as_s > v_ae_s) OR (v_as_s = v_ae_s AND v_as_a > v_ae_a) OR (v_as_s = v_ae_s AND v_as_a = v_ae_a AND v_as_w > v_ae_w) THEN
            RETURN json_build_object('success', false, 'message', 'Urutan jawaban B ke C tidak valid pada butir ' || v_q_num);
        END IF;

        -- Validasi Batas Snapshot Materi Santri (Gate 18)
        IF v_snapshot.memorization_direction = 'forward' THEN
            IF (v_ps_s < v_snapshot.start_surah) OR 
               (v_ps_s = v_snapshot.start_surah AND v_ps_a < v_snapshot.start_ayah) OR
               (v_ae_s > v_snapshot.end_surah) OR 
               (v_ae_s = v_snapshot.end_surah AND v_ae_a > v_snapshot.end_ayah) THEN
                RETURN json_build_object('success', false, 'message', 'Butir soal UTS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
            END IF;
        ELSE
            IF (v_ps_s > v_snapshot.start_surah) OR 
               (v_ps_s = v_snapshot.start_surah AND v_ps_a < v_snapshot.start_ayah) OR
               (v_ae_s < v_snapshot.end_surah) OR 
               (v_ae_s = v_snapshot.end_surah AND v_ae_a > v_snapshot.end_ayah) THEN
                RETURN json_build_object('success', false, 'message', 'Butir soal UTS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
            END IF;
        END IF;

        -- Validasi Anti-Reuse terhadap Soal Original UTS
        v_b_key := v_as_s || ':' || v_as_a || ':' || v_as_w;
        IF v_b_key = ANY(v_orig_b_keys) THEN
            RETURN json_build_object('success', false, 'message', 'Titik awal B butir soal ' || v_q_num || ' menduplikasi titik soal UTS original (anti-reuse terlanggar).');
        END IF;

        IF v_qb_id IS NOT NULL AND v_qb_id = ANY(v_orig_qb_ids) THEN
            RETURN json_build_object('success', false, 'message', 'Bank Soal butir ' || v_q_num || ' telah digunakan pada UTS original (anti-reuse terlanggar).');
        END IF;

        -- Validasi keunikan B di antara sesama soal remedial
        IF v_b_key = ANY(v_used_b_keys) THEN
            RETURN json_build_object('success', false, 'message', 'Duplikasi titik B terdeteksi pada butir soal remedial nomor ' || v_q_num);
        END IF;
        v_used_b_keys := array_append(v_used_b_keys, v_b_key);
    END LOOP;

    -- 9. Eksekusi Atomik Penyimpanan Data Remedial
    v_session_id := 'ers_' || p_original_period_id || '_' || p_student_id;
    v_set_id := 'erqs_' || p_original_period_id || '_' || p_student_id || '_v1';

    -- Simpan / Update exam_remedial_sessions
    INSERT INTO exam_remedial_sessions (
        id, original_exam_period_id, student_id, exam_type,
        original_attempt_id, original_question_set_id, material_snapshot_id,
        remedial_question_set_id, status, generation_version,
        created_by, created_at, updated_at
    ) VALUES (
        v_session_id, p_original_period_id, p_student_id, 'uts',
        v_orig_attempt.id, v_orig_attempt.question_set_id, v_snapshot.id,
        NULL, 'generating', 1,
        v_user.id, now(), now()
    )
    ON CONFLICT (original_exam_period_id, student_id) DO UPDATE SET
        status = 'generating',
        updated_at = now();

    -- Simpan exam_remedial_question_sets
    INSERT INTO exam_remedial_question_sets (
        id, remedial_session_id, original_exam_period_id, student_id,
        exam_type, material_snapshot_id, version, generation_strategy,
        generation_seed, material_fingerprint, status,
        generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_set_id, v_session_id, p_original_period_id, p_student_id,
        'uts', v_snapshot.id, 1, COALESCE(p_strategy, 'hybrid'),
        COALESCE(p_seed, 'seed_uts_rem_' || p_student_id || '_' || floor(extract(epoch from now()))),
        v_calc_fingerprint, 'locked',
        v_user.id, now(), now(), now(), now()
    )
    ON CONFLICT (remedial_session_id, version) DO UPDATE SET
        material_fingerprint = v_calc_fingerprint,
        status = 'locked',
        locked_at = now(),
        updated_at = now();

    -- Hapus soal lama pada paket ini jika ada (idempotency cleanup)
    DELETE FROM exam_remedial_questions WHERE remedial_question_set_id = v_set_id;

    -- Simpan 5 butir soal remedial
    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        INSERT INTO exam_remedial_questions (
            id, remedial_question_set_id, question_number, zone_number,
            question_role, source_type, question_bank_id, page_number, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'erq_' || v_set_id || '_q' || (v_q->>'questionNumber'),
            v_set_id,
            (v_q->>'questionNumber')::INTEGER,
            (v_q->>'zoneNumber')::INTEGER,
            'random',
            COALESCE(v_q->>'sourceType', 'auto'),
            v_q->>'questionBankId',
            (v_q->>'startPage')::INTEGER,
            20.00,
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

    -- Update session status ke LOCKED
    UPDATE exam_remedial_sessions 
    SET remedial_question_set_id = v_set_id,
        status = 'locked',
        updated_at = now()
    WHERE id = v_session_id;

    -- 10. Catat Audit Log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_original_period_id,
        p_student_id,
        'remedial_question_set_generated',
        v_user.id,
        NULL,
        jsonb_build_object(
            'remedialSessionId', v_session_id,
            'remedialQuestionSetId', v_set_id,
            'originalAttemptId', v_orig_attempt.id,
            'originalQuestionSetId', v_orig_attempt.question_set_id,
            'originalScore', v_orig_attempt.total_score,
            'kkm', v_period.kkm,
            'questionsCount', 5,
            'status', 'locked'
        ),
        'Pembuatan otomatis 5 soal UTS remedial dengan proteksi anti-reuse',
        now()
    );

    -- 11. Return Respon Sukses
    SELECT json_agg(row_to_json(q.*) ORDER BY q.question_number)
    INTO v_inserted_questions
    FROM exam_remedial_questions q
    WHERE q.remedial_question_set_id = v_set_id;

    RETURN json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Berhasil membuat dan mengunci 5 soal UTS remedial dengan proteksi anti-reuse.',
        'remedialSession', (SELECT row_to_json(ers.*) FROM exam_remedial_sessions ers WHERE ers.id = v_session_id),
        'questionSet', (SELECT row_to_json(erqs.*) FROM exam_remedial_question_sets erqs WHERE erqs.id = v_set_id),
        'questions', COALESCE(v_inserted_questions, '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 3: generate_uas_remedial_question_set (Admin Only)
-- Pembangkitan Paket Soal UAS Remedial (2 Wajib + 7 Acak, Anti-Reuse)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS generate_uas_remedial_question_set(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS generate_uas_remedial_question_set(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION generate_uas_remedial_question_set(
    p_username TEXT,
    p_password TEXT,
    p_original_period_id TEXT,
    p_student_id TEXT,
    p_strategy TEXT DEFAULT 'hybrid',
    p_seed TEXT DEFAULT NULL,
    p_fingerprint TEXT DEFAULT NULL,
    p_questions JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_snapshot RECORD;
    v_orig_attempt RECORD;
    v_session RECORD;
    v_existing_set RECORD;
    v_session_id TEXT;
    v_new_set_id TEXT;
    v_calc_fingerprint TEXT;
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
    v_used_random_b TEXT[] := ARRAY[]::TEXT[];
    v_used_mand_pages INTEGER[] := ARRAY[]::INTEGER[];
    v_used_zones INTEGER[] := ARRAY[]::INTEGER[];
    v_orig_mand_pages INTEGER[] := ARRAY[]::INTEGER[];
    v_orig_random_b TEXT[] := ARRAY[]::TEXT[];
    v_orig_qb_ids TEXT[] := ARRAY[]::TEXT[];
    v_b_key TEXT;
    v_ret_questions JSONB;
    v_final_seed TEXT;
    v_submitted_count INTEGER := 0;
    v_row RECORD;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Kredensial tidak valid.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berwenang membangkitkan paket soal UAS remedial.');
    END IF;

    -- 2. Validasi Periode Original (Khusus UAS)
    SELECT * INTO v_period FROM exam_periods WHERE id = p_original_period_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Periode ujian UAS tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uas' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Generator ini khusus untuk remedial ujian UAS.');
    END IF;

    -- 3. Validasi Attempt Original: Wajib unik, status = submitted, nilai < KKM
    -- Proteksi Gate 9: Tidak boleh ambigu dengan LIMIT 1 jika terdapat >1 attempt submitted
    SELECT COUNT(*) INTO v_submitted_count FROM exam_attempts
    WHERE exam_period_id = p_original_period_id 
      AND student_id = p_student_id 
      AND status = 'submitted';

    IF v_submitted_count > 1 THEN
        RETURN jsonb_build_object('success', false, 'message', 'INTEGRITY_VIOLATION: Ditemukan lebih dari 1 attempt original berstatus submitted untuk santri ini (' || v_submitted_count || ' attempt). Pemilihan attempt tidak boleh ambigu (LIMIT 1 dilarang).');
    END IF;

    IF v_submitted_count = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Santri belum menyelesaikan ujian UAS original.');
    END IF;

    SELECT * INTO v_orig_attempt FROM exam_attempts
    WHERE exam_period_id = p_original_period_id 
      AND student_id = p_student_id 
      AND status = 'submitted';

    IF v_orig_attempt.total_score >= v_period.kkm THEN
        RETURN jsonb_build_object('success', false, 'message', 'Nilai UAS santri (' || v_orig_attempt.total_score || ') sudah mencapai KKM (' || v_period.kkm || '). Santri tidak berhak mengikuti remedial.');
    END IF;

    -- 4. Validasi Snapshot Materi Original: Wajib FINALIZED
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE id = (
        SELECT material_snapshot_id FROM exam_question_sets WHERE id = v_orig_attempt.question_set_id
    );

    IF NOT FOUND THEN
        SELECT * INTO v_snapshot FROM exam_material_snapshots
        WHERE exam_period_id = p_original_period_id AND student_id = p_student_id;
    END IF;

    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Snapshot materi UAS santri belum difinalisasi.');
    END IF;

    -- Hitung fingerprint
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    -- Validasi Fingerprint (Gate 11)
    IF p_fingerprint IS NOT NULL AND p_fingerprint != '' AND p_fingerprint != v_calc_fingerprint THEN
        RETURN jsonb_build_object('success', false, 'message', 'Material fingerprint mismatch: Materi santri tidak sesuai.');
    END IF;

    -- 5. Ambil exclusion list dari soal original UAS (Anti-Reuse)
    FOR v_row IN 
        SELECT question_role, page_number, answer_start_surah, answer_start_ayah, answer_start_word, question_bank_id 
        FROM exam_questions 
        WHERE question_set_id = v_orig_attempt.question_set_id
    LOOP
        IF v_row.question_role = 'mandatory' AND v_row.page_number IS NOT NULL THEN
            v_orig_mand_pages := array_append(v_orig_mand_pages, v_row.page_number);
        ELSE
            v_orig_random_b := array_append(v_orig_random_b, v_row.answer_start_surah || ':' || v_row.answer_start_ayah || ':' || v_row.answer_start_word);
        END IF;
        IF v_row.question_bank_id IS NOT NULL THEN
            v_orig_qb_ids := array_append(v_orig_qb_ids, v_row.question_bank_id);
        END IF;
    END LOOP;

    -- 6. IDEMPOTENCY CHECK
    SELECT * INTO v_session FROM exam_remedial_sessions 
    WHERE original_exam_period_id = p_original_period_id AND student_id = p_student_id;

    IF FOUND AND v_session.remedial_question_set_id IS NOT NULL THEN
        SELECT * INTO v_existing_set FROM exam_remedial_question_sets
        WHERE id = v_session.remedial_question_set_id AND status = 'locked';

        IF FOUND THEN
            SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
            INTO v_ret_questions
            FROM exam_remedial_questions eq
            WHERE eq.remedial_question_set_id = v_existing_set.id;

            RETURN jsonb_build_object(
                'success', true,
                'isExisting', true,
                'message', 'Paket soal UAS remedial sudah terkunci dan siap digunakan.',
                'remedialSession', row_to_json(v_session),
                'questionSet', row_to_json(v_existing_set),
                'questions', COALESCE(v_ret_questions, '[]'::jsonb)
            );
        END IF;
    END IF;

    -- 7. Validasi Struktur Paket 9 Soal (2 Wajib + 7 Acak)
    v_q_count := jsonb_array_length(p_questions);
    IF v_q_count != 9 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket soal UAS remedial harus memiliki tepat 9 butir soal (2 wajib + 7 acak). Diterima: ' || v_q_count);
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

        IF v_as_surah NOT BETWEEN 1 AND 114 OR v_as_ayah < 1 OR v_as_word < 1 OR
           v_ae_surah NOT BETWEEN 1 AND 114 OR v_ae_ayah < 1 OR v_ae_word < 1 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Koordinat ayat/kata butir soal remedial ' || v_q_num || ' tidak valid.');
        END IF;

        IF (v_as_surah > v_ae_surah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah > v_ae_ayah) OR 
           (v_as_surah = v_ae_surah AND v_as_ayah = v_ae_ayah AND v_as_word > v_ae_word) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Urutan jawaban B ke C pada butir soal remedial ' || v_q_num || ' tidak valid.');
        END IF;

        v_total_score := v_total_score + v_q_score;

        -- Validasi Soal Wajib (Q1 & Q2)
        IF v_q_role = 'mandatory' THEN
            v_mandatory_count := v_mandatory_count + 1;

            IF v_q_num NOT IN (1, 2) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib UAS hanya boleh bernomor 1 atau 2.');
            END IF;

            IF v_q_score != 15 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal wajib remedial harus tepat 15. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NOT NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib remedial tidak boleh memiliki zone_number.');
            END IF;

            IF v_q_page IS NULL OR v_q_page NOT BETWEEN 1 AND 604 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor halaman soal wajib remedial tidak valid (1-604).');
            END IF;

            -- Anti-Reuse Halaman Wajib terhadap UAS Original
            IF v_q_page = ANY(v_orig_mand_pages) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Halaman wajib ' || v_q_page || ' telah digunakan pada UAS original (anti-reuse terlanggar).');
            END IF;

            -- Anti-Reuse ID Bank Soal terhadap UAS Original
            IF v_q_bank_id IS NOT NULL AND v_q_bank_id = ANY(v_orig_qb_ids) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bank Soal butir wajib ' || v_q_num || ' telah digunakan pada UAS original (anti-reuse terlanggar).');
            END IF;

            IF v_q_page = ANY(v_used_mand_pages) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Kedua halaman soal wajib remedial harus berbeda (halaman duplikat: ' || v_q_page || ').');
            END IF;
            v_used_mand_pages := array_append(v_used_mand_pages, v_q_page);

        -- Validasi Soal Acak (Q3..Q9)
        ELSIF v_q_role = 'random' THEN
            v_random_count := v_random_count + 1;

            IF v_q_num NOT BETWEEN 3 AND 9 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak remedial harus bernomor 3 s.d. 9.');
            END IF;

            IF v_q_score != 10 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal acak remedial harus tepat 10. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NULL OR v_q_zone NOT BETWEEN 1 AND 7 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor zona soal acak remedial harus antara 1 dan 7.');
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
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak remedial sambung ayat wajib memiliki prompt penguji A dan A-aksen.');
            END IF;

            IF (v_ps_surah > v_pe_surah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah > v_pe_ayah) OR 
               (v_ps_surah = v_pe_surah AND v_ps_ayah = v_pe_ayah AND v_ps_word > v_pe_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Urutan prompt A ke A-aksen soal remedial ' || v_q_num || ' tidak valid.');
            END IF;

            IF (v_pe_surah > v_as_surah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah > v_as_ayah) OR 
               (v_pe_surah = v_as_surah AND v_pe_ayah = v_as_ayah AND v_pe_word >= v_as_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik B harus setelah A-aksen pada butir soal remedial ' || v_q_num || '.');
            END IF;

            -- Validasi Batas Snapshot Materi Santri (Gate 19)
            IF v_snapshot.memorization_direction = 'forward' THEN
                IF (v_ps_surah < v_snapshot.start_surah) OR 
                   (v_ps_surah = v_snapshot.start_surah AND v_ps_ayah < v_snapshot.start_ayah) OR
                   (v_ae_surah > v_snapshot.end_surah) OR 
                   (v_ae_surah = v_snapshot.end_surah AND v_ae_ayah > v_snapshot.end_ayah) THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Butir soal acak UAS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
                END IF;
            ELSE
                IF (v_ps_surah > v_snapshot.start_surah) OR 
                   (v_ps_surah = v_snapshot.start_surah AND v_ps_ayah < v_snapshot.start_ayah) OR
                   (v_ae_surah < v_snapshot.end_surah) OR 
                   (v_ae_surah = v_snapshot.end_surah AND v_ae_ayah > v_snapshot.end_ayah) THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Butir soal acak UAS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
                END IF;
            END IF;

            v_b_key := v_as_surah || ':' || v_as_ayah || ':' || v_as_word;

            -- Anti-Reuse Titik B terhadap UAS Original
            IF v_b_key = ANY(v_orig_random_b) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal B butir soal acak ' || v_q_num || ' menduplikasi titik soal UAS original (anti-reuse terlanggar).');
            END IF;

            -- Anti-Reuse ID Bank Soal terhadap UAS Original
            IF v_q_bank_id IS NOT NULL AND v_q_bank_id = ANY(v_orig_qb_ids) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bank Soal butir acak ' || v_q_num || ' telah digunakan pada UAS original (anti-reuse terlanggar).');
            END IF;

            IF v_b_key = ANY(v_used_random_b) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal B soal acak remedial harus unik (duplikasi: ' || v_b_key || ').');
            END IF;
            v_used_random_b := array_append(v_used_random_b, v_b_key);
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Role soal remedial tidak valid: ' || v_q_role);
        END IF;
    END LOOP;

    IF v_mandatory_count != 2 OR v_random_count != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Struktur soal UAS remedial harus tepat 2 soal wajib dan 7 soal acak.');
    END IF;

    IF array_length(v_used_zones, 1) != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Tepat 7 zona (Zona 1 s.d. 7) harus terpenuhi pada UAS remedial.');
    END IF;

    IF v_total_score != 100 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Total bobot nilai soal UAS remedial harus 100. Terhitung: ' || v_total_score);
    END IF;

    -- 8. Eksekusi Atomik Penyimpanan Data UAS Remedial
    v_session_id := 'ers_' || p_original_period_id || '_' || p_student_id;
    v_final_seed := COALESCE(p_seed, 'seed_uas_rem_' || p_original_period_id || '_' || p_student_id || '_' || floor(extract(epoch from now())));
    v_new_set_id := 'erqs_' || p_original_period_id || '_' || p_student_id || '_v1';

    INSERT INTO exam_remedial_sessions (
        id, original_exam_period_id, student_id, exam_type,
        original_attempt_id, original_question_set_id, material_snapshot_id,
        remedial_question_set_id, status, generation_version,
        created_by, created_at, updated_at
    ) VALUES (
        v_session_id, p_original_period_id, p_student_id, 'uas',
        v_orig_attempt.id, v_orig_attempt.question_set_id, v_snapshot.id,
        NULL, 'generating', 1,
        v_user.id, timezone('utc'::text, now()), timezone('utc'::text, now())
    )
    ON CONFLICT (original_exam_period_id, student_id) DO UPDATE SET
        status = 'generating',
        updated_at = timezone('utc'::text, now());

    INSERT INTO exam_remedial_question_sets (
        id, remedial_session_id, original_exam_period_id, student_id,
        exam_type, material_snapshot_id, version, generation_strategy,
        generation_seed, material_fingerprint, status,
        generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_new_set_id, v_session_id, p_original_period_id, p_student_id,
        'uas', v_snapshot.id, 1, COALESCE(p_strategy, 'hybrid'),
        v_final_seed, v_calc_fingerprint, 'locked',
        v_user.id, timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())
    )
    ON CONFLICT (remedial_session_id, version) DO UPDATE SET
        material_fingerprint = v_calc_fingerprint,
        status = 'locked',
        locked_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now());

    DELETE FROM exam_remedial_questions WHERE remedial_question_set_id = v_new_set_id;

    -- Simpan 9 butir soal remedial
    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        INSERT INTO exam_remedial_questions (
            id, remedial_question_set_id, question_number, zone_number, question_role,
            source_type, question_bank_id, page_number, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'erq_' || v_new_set_id || '_q' || (v_q_elem->>'questionNumber'),
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

    -- Update session status ke LOCKED
    UPDATE exam_remedial_sessions 
    SET remedial_question_set_id = v_new_set_id,
        status = 'locked',
        updated_at = timezone('utc'::text, now())
    WHERE id = v_session_id;

    -- Audit Log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_original_period_id,
        p_student_id,
        'remedial_question_set_generated',
        v_user.id,
        NULL,
        jsonb_build_object(
            'remedialSessionId', v_session_id,
            'remedialQuestionSetId', v_new_set_id,
            'originalAttemptId', v_orig_attempt.id,
            'originalQuestionSetId', v_orig_attempt.question_set_id,
            'originalScore', v_orig_attempt.total_score,
            'kkm', v_period.kkm,
            'questionsCount', 9,
            'status', 'locked'
        ),
        'Pembuatan otomatis 9 soal UAS remedial dengan proteksi anti-reuse',
        timezone('utc'::text, now())
    );

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
    INTO v_ret_questions
    FROM exam_remedial_questions eq
    WHERE eq.remedial_question_set_id = v_new_set_id;

    RETURN jsonb_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Berhasil membuat dan mengunci 9 butir soal UAS remedial dengan proteksi anti-reuse.',
        'remedialSession', (SELECT row_to_json(ers.*) FROM exam_remedial_sessions ers WHERE ers.id = v_session_id),
        'questionSet', (SELECT row_to_json(erqs.*) FROM exam_remedial_question_sets erqs WHERE erqs.id = v_new_set_id),
        'questions', COALESCE(v_ret_questions, '[]'::jsonb)
    );
END;
$$;


-- ------------------------------------------------------------
-- RPC 4: get_remedial_question_set (Admin Only)
-- Mengambil rincian paket soal remedial beserta keterlacakan ke ujian original
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_remedial_question_set(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_remedial_question_set(
    p_username TEXT,
    p_password TEXT,
    p_remedial_session_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_session RECORD;
    v_qset RECORD;
    v_questions JSONB;
    v_orig_attempt RECORD;
    v_orig_period RECORD;
    v_student RECORD;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak melihat rincian paket soal remedial.');
    END IF;

    -- 2. Cari Sesi Remedial
    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = p_remedial_session_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi remedial tidak ditemukan.');
    END IF;

    -- 3. Ambil data original
    SELECT * INTO v_orig_attempt FROM exam_attempts WHERE id = v_session.original_attempt_id;
    SELECT * INTO v_orig_period FROM exam_periods WHERE id = v_session.original_exam_period_id;
    SELECT * INTO v_student FROM students WHERE id = v_session.student_id;

    -- 4. Ambil paket soal remedial jika ada
    IF v_session.remedial_question_set_id IS NOT NULL THEN
        SELECT * INTO v_qset FROM exam_remedial_question_sets WHERE id = v_session.remedial_question_set_id;
        
        SELECT json_agg(row_to_json(q.*) ORDER BY q.question_number)
        INTO v_questions
        FROM exam_remedial_questions q
        WHERE q.remedial_question_set_id = v_qset.id;
    END IF;

    RETURN json_build_object(
        'success', true,
        'remedialSession', row_to_json(v_session),
        'student', json_build_object(
            'id', v_student.id,
            'name', v_student.name,
            'nis', v_student.nis,
            'class', v_student.class,
            'halaqah', v_student.halaqah
        ),
        'originalExam', json_build_object(
            'periodId', v_orig_period.id,
            'periodName', v_orig_period.name,
            'examType', v_orig_period.exam_type,
            'kkm', v_orig_period.kkm,
            'attemptId', v_orig_attempt.id,
            'questionSetId', v_orig_attempt.question_set_id,
            'score', v_orig_attempt.total_score,
            'submittedAt', v_orig_attempt.submitted_at
        ),
        'questionSet', CASE WHEN v_qset.id IS NOT NULL THEN row_to_json(v_qset) ELSE NULL END,
        'questions', COALESCE(v_questions, '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- 5. PERMISSIONS & EXECUTE PRIVILEGES
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION get_remedial_generation_candidates(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_remedial_generation_candidates(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION generate_uts_remedial_question_set(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_uts_remedial_question_set(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION generate_uas_remedial_question_set(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_uas_remedial_question_set(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION get_remedial_question_set(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_remedial_question_set(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
