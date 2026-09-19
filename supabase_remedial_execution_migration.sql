-- ============================================================
-- SQL Migration: Tahap 7C — Pelaksanaan & Penilaian Remedial
-- SITA (Sistem Informasi Tahfidz Al-Qur’an) Darul Abror IBS
-- NON-DESTRUCTIVE ADDITIVE MIGRATION (PRE-LIVE ONLY)
-- ============================================================

-- 1. ADDITIVE COLUMNS PADA exam_remedial_sessions
ALTER TABLE exam_remedial_sessions 
ADD COLUMN IF NOT EXISTS examiner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE exam_remedial_sessions 
ADD COLUMN IF NOT EXISTS assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE exam_remedial_sessions 
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_ers_examiner ON exam_remedial_sessions(examiner_user_id);


-- 2. TABEL: exam_remedial_examiner_assignments (Riwayat Penugasan Penguji Remedial)
CREATE TABLE IF NOT EXISTS exam_remedial_examiner_assignments (
    id TEXT PRIMARY KEY,
    remedial_session_id TEXT NOT NULL REFERENCES exam_remedial_sessions(id) ON DELETE CASCADE,
    examiner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    reassign_reason TEXT,
    status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_remedial_assignment_session UNIQUE (remedial_session_id)
);

CREATE INDEX IF NOT EXISTS idx_erea_session ON exam_remedial_examiner_assignments(remedial_session_id);
CREATE INDEX IF NOT EXISTS idx_erea_examiner ON exam_remedial_examiner_assignments(examiner_user_id);
CREATE INDEX IF NOT EXISTS idx_erea_status ON exam_remedial_examiner_assignments(status);


-- 3. TABEL: exam_remedial_attempts (Sesi Pelaksanaan Ujian Remedial Santri)
CREATE TABLE IF NOT EXISTS exam_remedial_attempts (
    id TEXT PRIMARY KEY,
    remedial_session_id TEXT NOT NULL REFERENCES exam_remedial_sessions(id) ON DELETE RESTRICT,
    remedial_question_set_id TEXT NOT NULL REFERENCES exam_remedial_question_sets(id) ON DELETE RESTRICT,
    examiner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number = 1),
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'reopened', 'void')),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_saved_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    submitted_at TIMESTAMP WITH TIME ZONE,
    total_score NUMERIC(5,2) DEFAULT NULL CHECK (total_score IS NULL OR (total_score >= 0 AND total_score <= 100)),
    reopened_at TIMESTAMP WITH TIME ZONE,
    reopened_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    reopen_reason TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_remedial_attempt_session UNIQUE (remedial_session_id)
);

CREATE INDEX IF NOT EXISTS idx_era_session ON exam_remedial_attempts(remedial_session_id);
CREATE INDEX IF NOT EXISTS idx_era_qset ON exam_remedial_attempts(remedial_question_set_id);
CREATE INDEX IF NOT EXISTS idx_era_examiner ON exam_remedial_attempts(examiner_user_id);
CREATE INDEX IF NOT EXISTS idx_era_status ON exam_remedial_attempts(status);


-- 4. TABEL: exam_remedial_question_assessments (Penilaian per Nomor Butir Soal Remedial)
CREATE TABLE IF NOT EXISTS exam_remedial_question_assessments (
    id TEXT PRIMARY KEY,
    remedial_attempt_id TEXT NOT NULL REFERENCES exam_remedial_attempts(id) ON DELETE CASCADE,
    remedial_question_id TEXT NOT NULL REFERENCES exam_remedial_questions(id) ON DELETE RESTRICT,
    question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 9),

    fluency_score NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (fluency_score >= 0 AND fluency_score <= 12),
    tajwid_score NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (tajwid_score >= 0 AND tajwid_score <= 4),
    makhraj_score NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (makhraj_score >= 0 AND makhraj_score <= 4),

    fluency_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    tajwid_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    makhraj_events JSONB NOT NULL DEFAULT '[]'::jsonb,

    question_score NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (question_score >= 0 AND question_score <= 20),
    notes TEXT,

    started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_remedial_assessment_attempt_q UNIQUE (remedial_attempt_id, remedial_question_id),
    CONSTRAINT uq_remedial_assessment_attempt_num UNIQUE (remedial_attempt_id, question_number)
);

CREATE INDEX IF NOT EXISTS idx_erqa_attempt ON exam_remedial_question_assessments(remedial_attempt_id);
CREATE INDEX IF NOT EXISTS idx_erqa_question ON exam_remedial_question_assessments(remedial_question_id);
CREATE INDEX IF NOT EXISTS idx_erqa_num ON exam_remedial_question_assessments(remedial_attempt_id, question_number);


-- 5. ROW LEVEL SECURITY (RLS) — DENY DIRECT CLIENT ACCESS
ALTER TABLE exam_remedial_examiner_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_remedial_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_remedial_question_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erea_deny_direct_access ON exam_remedial_examiner_assignments;
CREATE POLICY erea_deny_direct_access ON exam_remedial_examiner_assignments FOR ALL USING (false);

DROP POLICY IF EXISTS era_deny_direct_access ON exam_remedial_attempts;
CREATE POLICY era_deny_direct_access ON exam_remedial_attempts FOR ALL USING (false);

DROP POLICY IF EXISTS erqa_deny_direct_access ON exam_remedial_question_assessments;
CREATE POLICY erqa_deny_direct_access ON exam_remedial_question_assessments FOR ALL USING (false);


-- ============================================================
-- 6. STORED PROCEDURES (SECURITY DEFINER RPC) — HARDENED
-- ============================================================

-- ------------------------------------------------------------
-- RPC 1: assign_remedial_examiner_secure
-- Penugasan Penguji Remedial (Admin Only)
-- Sebelum submit boleh ditugaskan ulang dengan reason wajib
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS assign_remedial_examiner_secure(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION assign_remedial_examiner_secure(
    p_username TEXT,
    p_password TEXT,
    p_remedial_session_id TEXT,
    p_examiner_id TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_session RECORD;
    v_examiner RECORD;
    v_existing_attempt RECORD;
    v_old_examiner_id TEXT;
    v_action TEXT;
    v_audit_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak menugaskan penguji remedial.');
    END IF;

    -- 2. Validasi Remedial Session
    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = p_remedial_session_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi remedial tidak ditemukan.');
    END IF;

    IF v_session.remedial_question_set_id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Paket soal remedial belum dibuat untuk sesi ini.');
    END IF;

    -- 3. Validasi Penguji Baru (Wajib user aktif role teacher atau admin)
    SELECT * INTO v_examiner FROM users WHERE id = p_examiner_id AND role IN ('teacher', 'admin');
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Penguji tidak valid (harus guru atau admin).');
    END IF;

    -- 4. Validasi Status Attempt Remedial Eksisting
    SELECT * INTO v_existing_attempt FROM exam_remedial_attempts WHERE remedial_session_id = p_remedial_session_id;
    IF FOUND THEN
        IF v_existing_attempt.status = 'submitted' THEN
            RETURN json_build_object('success', false, 'message', 'Sesi remedial sudah disubmit dan terkunci. Penguji tidak dapat diubah.');
        END IF;

        -- Jika sedang in_progress atau reopened, wajib mencantumkan alasan
        IF v_existing_attempt.status IN ('in_progress', 'reopened') THEN
            IF p_reason IS NULL OR trim(p_reason) = '' THEN
                RETURN json_build_object('success', false, 'message', 'Alasan penggantian penguji wajib diisi karena ujian sedang berlangsung/dibuka kembali.');
            END IF;
        END IF;
    END IF;

    v_old_examiner_id := v_session.examiner_user_id;

    -- 5. Simpan / Update Assignment
    INSERT INTO exam_remedial_examiner_assignments (
        id, remedial_session_id, examiner_user_id, assigned_by, assigned_at, reassign_reason, status, created_at, updated_at
    ) VALUES (
        'rem_asgn_' || v_session.id,
        p_remedial_session_id,
        p_examiner_id,
        v_user.id,
        now(),
        p_reason,
        'assigned',
        now(),
        now()
    )
    ON CONFLICT (remedial_session_id) DO UPDATE SET
        examiner_user_id = EXCLUDED.examiner_user_id,
        assigned_by = EXCLUDED.assigned_by,
        assigned_at = now(),
        reassign_reason = EXCLUDED.reassign_reason,
        updated_at = now();

    -- Update examiner_user_id pada exam_remedial_sessions
    UPDATE exam_remedial_sessions SET
        examiner_user_id = p_examiner_id,
        assigned_by = v_user.id,
        assigned_at = now(),
        updated_at = now()
    WHERE id = p_remedial_session_id;

    -- Jika attempt sudah ada dan in_progress/reopened, update juga attempt examiner binding secara konsisten
    IF FOUND AND v_existing_attempt.id IS NOT NULL THEN
        UPDATE exam_remedial_attempts SET
            examiner_user_id = p_examiner_id,
            updated_at = now()
        WHERE id = v_existing_attempt.id;
    END IF;

    -- 6. Audit Log Kanonikal
    v_action := CASE WHEN v_old_examiner_id IS NOT NULL AND v_old_examiner_id != p_examiner_id 
                     THEN 'remedial_examiner_reassigned' 
                     ELSE 'remedial_examiner_assigned' END;

    v_audit_id := 'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);

    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        v_audit_id,
        v_session.original_exam_period_id,
        v_session.student_id,
        v_action,
        v_user.id,
        jsonb_build_object('remedialSessionId', p_remedial_session_id, 'oldExaminerId', v_old_examiner_id),
        jsonb_build_object('remedialSessionId', p_remedial_session_id, 'newExaminerId', p_examiner_id),
        p_reason,
        now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Penguji ujian remedial berhasil ditugaskan.',
        'remedialSessionId', p_remedial_session_id,
        'examinerId', p_examiner_id,
        'action', v_action
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 2: get_examiner_remedial_students
-- Daftar Santri Remedial yang Ditugaskan ke Penguji
-- Examiner hanya melihat santri yang resmi di-assign kepadanya
-- Admin dapat melihat seluruh santri remedial
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_examiner_remedial_students(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_examiner_remedial_students(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_result JSON;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat mengakses daftar remedial.');
    END IF;

    -- 2. Query Daftar Santri
    SELECT json_agg(row_to_json(t)) INTO v_result
    FROM (
        SELECT 
            s.id AS "remedialSessionId",
            s.original_exam_period_id AS "examPeriodId",
            ep.name AS "periodName",
            ep.exam_type AS "periodExamType",
            s.exam_type AS "examType",
            ep.kkm AS "kkm",
            st.id AS "studentId",
            st.name AS "studentName",
            st.nis AS "nis",
            c.name AS "className",
            s.examiner_user_id AS "examinerId",
            eu.name AS "examinerName",
            s.status AS "sessionStatus",
            s.remedial_question_set_id AS "remedialQuestionSetId",
            rqs.status AS "questionSetStatus",
            rqs.material_fingerprint AS "materialFingerprint",
            orig_att.id AS "originalAttemptId",
            orig_att.total_score AS "originalScore",
            ra.id AS "remedialAttemptId",
            ra.status AS "remedialAttemptStatus",
            ra.total_score AS "remedialScore",
            ra.started_at AS "remedialStartedAt",
            ra.submitted_at AS "remedialSubmittedAt",
            -- Effective score: jika remedial submitted, gunakan remedial; else original
            CASE WHEN ra.status = 'submitted' THEN ra.total_score ELSE orig_att.total_score END AS "effectiveScore",
            -- Status Derivation
            CASE 
                WHEN ra.status = 'submitted' AND ra.total_score >= ep.kkm THEN 'TUNTAS_MELALUI_REMEDIAL'
                WHEN ra.status = 'submitted' AND ra.total_score < ep.kkm THEN 'BELUM_TUNTAS_SETELAH_REMEDIAL'
                WHEN ra.status IN ('in_progress', 'reopened') THEN 'SEDANG_REMEDIAL'
                WHEN rqs.status = 'locked' THEN 'REMEDIAL_DIJADWALKAN'
                ELSE 'PERLU_REMEDIAL'
            END AS "derivedStatus",
            (SELECT COUNT(*) FROM exam_remedial_questions eq WHERE eq.remedial_question_set_id = s.remedial_question_set_id) AS "questionCount",
            (SELECT COUNT(*) FROM exam_remedial_question_assessments eqa WHERE eqa.remedial_attempt_id = ra.id AND eqa.completed_at IS NOT NULL) AS "completedQuestionCount"
        FROM exam_remedial_sessions s
        JOIN students st ON st.id = s.student_id
        LEFT JOIN classes c ON c.id = st.class_id
        JOIN exam_periods ep ON ep.id = s.original_exam_period_id
        JOIN exam_attempts orig_att ON orig_att.id = s.original_attempt_id
        JOIN exam_remedial_question_sets rqs ON rqs.id = s.remedial_question_set_id
        LEFT JOIN users eu ON eu.id = s.examiner_user_id
        LEFT JOIN exam_remedial_attempts ra ON ra.remedial_session_id = s.id
        WHERE rqs.status = 'locked'
          AND (v_user.role = 'admin' OR s.examiner_user_id = v_user.id)
        ORDER BY st.name ASC
    ) t;

    RETURN json_build_object(
        'success', true,
        'students', COALESCE(v_result, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 3: start_remedial_attempt
-- Memulai / Melanjutkan Sesi Ujian Remedial Santri (Idempotent)
-- Examiner Binding Wajib Berasal dari Penugasan Resmi (v_session.examiner_user_id)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS start_remedial_attempt(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION start_remedial_attempt(
    p_username TEXT,
    p_password TEXT,
    p_remedial_session_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_session RECORD;
    v_period RECORD;
    v_snapshot RECORD;
    v_question_set RECORD;
    v_calc_fingerprint TEXT;
    v_existing_attempt RECORD;
    v_attempt_id TEXT;
    v_expected_qcount INTEGER;
    v_actual_qcount INTEGER;
    v_q RECORD;
    v_questions JSON;
    v_assessments JSON;
    v_audit_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat memulai ujian remedial.');
    END IF;

    -- 2. Validasi Sesi Remedial
    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = p_remedial_session_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi remedial tidak ditemukan.');
    END IF;

    IF v_session.status IN ('stale', 'invalid') THEN
        RETURN json_build_object('success', false, 'message', 'Sesi remedial tidak valid atau berstatus stale.');
    END IF;

    -- 3. Validasi Penugasan Penguji Resmi
    IF v_session.examiner_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Penguji belum ditugaskan untuk sesi remedial ini.');
    END IF;

    IF v_user.role = 'teacher' AND v_session.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi remedial ini.');
    END IF;

    -- 4. Validasi Periode & Snapshot
    SELECT * INTO v_period FROM exam_periods WHERE id = v_session.original_exam_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian asli tidak ditemukan.');
    END IF;

    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE id = v_session.material_snapshot_id;
    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi santri belum difinalisasi.');
    END IF;

    -- 5. Validasi Paket Soal: Wajib LOCKED & Material Fingerprint Masih Valid
    SELECT * INTO v_question_set FROM exam_remedial_question_sets WHERE id = v_session.remedial_question_set_id;
    IF NOT FOUND OR v_question_set.status != 'locked' THEN
        RETURN json_build_object('success', false, 'message', 'Paket soal remedial belum terkunci (locked).');
    END IF;

    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        COALESCE(v_snapshot.memorization_direction, 'forward')
    );

    IF v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_remedial_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        UPDATE exam_remedial_sessions SET status = 'stale', updated_at = now() WHERE id = v_session.id;
        RETURN json_build_object('success', false, 'message', 'Paket soal berstatus STALE karena materi santri telah berubah.');
    END IF;

    -- 6. Validasi Jumlah & Struktur Butir Soal
    v_expected_qcount := CASE WHEN v_session.exam_type = 'uts' THEN 5 ELSE 9 END;
    SELECT COUNT(*) INTO v_actual_qcount FROM exam_remedial_questions WHERE remedial_question_set_id = v_question_set.id;

    IF v_actual_qcount != v_expected_qcount THEN
        RETURN json_build_object('success', false, 'message', 'Integritas paket soal gagal: Jumlah soal tidak sesuai spesifikasi (' || v_actual_qcount || ' dari ' || v_expected_qcount || ').');
    END IF;

    -- Khusus UAS: periksa struktur 2 mandatory dan 7 random
    IF v_session.exam_type = 'uas' THEN
        DECLARE
            v_mand_count INTEGER;
            v_rand_count INTEGER;
        BEGIN
            SELECT COUNT(*) INTO v_mand_count FROM exam_remedial_questions 
            WHERE remedial_question_set_id = v_question_set.id AND question_role = 'mandatory' AND max_score = 15.00;
            SELECT COUNT(*) INTO v_rand_count FROM exam_remedial_questions 
            WHERE remedial_question_set_id = v_question_set.id AND question_role = 'random' AND max_score = 10.00;

            IF v_mand_count != 2 OR v_rand_count != 7 THEN
                RETURN json_build_object('success', false, 'message', 'Integritas struktur UAS gagal: Wajib tepat 2 soal wajib (15 poin) dan 7 soal acak (10 poin).');
            END IF;
        END;
    END IF;

    -- 7. IDEMPOTENCY CHECK: Cek apakah sudah ada attempt
    SELECT * INTO v_existing_attempt FROM exam_remedial_attempts WHERE remedial_session_id = p_remedial_session_id;

    IF FOUND THEN
        IF v_existing_attempt.status = 'submitted' THEN
            RETURN json_build_object('success', false, 'message', 'Ujian remedial santri ini sudah selesai dan telah disubmit.');
        END IF;

        v_attempt_id := v_existing_attempt.id;
    ELSE
        -- Buat attempt baru: BINDING EXAMINER_USER_ID WAJIB DARI v_session.examiner_user_id (Official Assignment)
        v_attempt_id := 'rem_att_' || v_session.id;

        INSERT INTO exam_remedial_attempts (
            id, remedial_session_id, remedial_question_set_id, examiner_user_id,
            attempt_number, status, started_at, last_saved_at, total_score, version, created_at, updated_at
        ) VALUES (
            v_attempt_id, v_session.id, v_question_set.id, v_session.examiner_user_id,
            1, 'in_progress', now(), now(), 100.00, 1, now(), now()
        );

        -- Inisialisasi butir penilaian (assessments) untuk setiap nomor soal
        FOR v_q IN 
            SELECT * FROM exam_remedial_questions 
            WHERE remedial_question_set_id = v_question_set.id 
            ORDER BY question_number ASC
        LOOP
            INSERT INTO exam_remedial_question_assessments (
                id, remedial_attempt_id, remedial_question_id, question_number,
                fluency_score, tajwid_score, makhraj_score, question_score,
                fluency_events, tajwid_events, makhraj_events, version,
                started_at, created_at, updated_at
            ) VALUES (
                'rem_eqa_' || v_attempt_id || '_q' || v_q.question_number,
                v_attempt_id,
                v_q.id,
                v_q.question_number,
                -- Inisialisasi skor default penuh sesuai role
                CASE WHEN v_session.exam_type = 'uts' THEN 12.00 
                     WHEN v_q.question_role = 'mandatory' THEN 9.00 
                     ELSE 6.00 END,
                CASE WHEN v_session.exam_type = 'uts' THEN 4.00 
                     WHEN v_q.question_role = 'mandatory' THEN 3.00 
                     ELSE 2.00 END,
                CASE WHEN v_session.exam_type = 'uts' THEN 4.00 
                     WHEN v_q.question_role = 'mandatory' THEN 3.00 
                     ELSE 2.00 END,
                v_q.max_score,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 1,
                now(), now(), now()
            );
        END LOOP;

        -- Audit Log Mulai Remedial
        v_audit_id := 'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            before_data, after_data, reason, created_at
        ) VALUES (
            v_audit_id,
            v_session.original_exam_period_id,
            v_session.student_id,
            'remedial_attempt_started',
            v_user.id,
            jsonb_build_object('remedialSessionId', p_remedial_session_id, 'status', 'scheduled'),
            jsonb_build_object('attemptId', v_attempt_id, 'officialExaminerId', v_session.examiner_user_id, 'status', 'in_progress'),
            'Memulai sesi ujian remedial',
            now()
        );
    END IF;

    -- 8. Query Data Pertanyaan (Tanpa Ayat Al-Qur'an Text)
    SELECT json_agg(row_to_json(q_row)) INTO v_questions
    FROM (
        SELECT 
            id,
            question_number AS "questionNumber",
            zone_number AS "zoneNumber",
            question_role AS "questionRole",
            source_type AS "sourceType",
            page_number AS "pageNumber",
            max_score AS "maxScore",
            prompt_start_surah AS "promptStartSurah",
            prompt_start_ayah AS "promptStartAyah",
            prompt_start_word AS "promptStartWord",
            prompt_end_surah AS "promptEndSurah",
            prompt_end_ayah AS "promptEndAyah",
            prompt_end_word AS "promptEndWord",
            answer_start_surah AS "answerStartSurah",
            answer_start_ayah AS "answerStartAyah",
            answer_start_word AS "answerStartWord",
            answer_end_surah AS "answerEndSurah",
            answer_end_ayah AS "answerEndAyah",
            answer_end_word AS "answerEndWord",
            start_page AS "startPage",
            end_page AS "endPage",
            generated_metadata AS "metadata"
        FROM exam_remedial_questions
        WHERE remedial_question_set_id = v_question_set.id
        ORDER BY question_number ASC
    ) q_row;

    -- 9. Query Data Assessments Eksisting (Autosave / Resume)
    SELECT json_agg(row_to_json(a_row)) INTO v_assessments
    FROM (
        SELECT 
            id,
            question_number AS "questionNumber",
            remedial_question_id AS "questionId",
            fluency_score AS "fluencyScore",
            tajwid_score AS "tajwidScore",
            makhraj_score AS "makhrajScore",
            question_score AS "questionScore",
            fluency_events AS "fluencyEvents",
            tajwid_events AS "tajwidEvents",
            makhraj_events AS "makhrajEvents",
            notes,
            version,
            started_at AS "startedAt",
            completed_at AS "completedAt"
        FROM exam_remedial_question_assessments
        WHERE remedial_attempt_id = v_attempt_id
        ORDER BY question_number ASC
    ) a_row;

    RETURN json_build_object(
        'success', true,
        'message', 'Sesi ujian remedial siap dilaksanakan.',
        'attempt', json_build_object(
            'id', v_attempt_id,
            'remedialSessionId', v_session.id,
            'remedialQuestionSetId', v_question_set.id,
            'examinerUserId', v_session.examiner_user_id,
            'attemptNumber', 1,
            'status', COALESCE(v_existing_attempt.status, 'in_progress'),
            'examType', v_session.exam_type,
            'kkm', v_period.kkm
        ),
        'questions', COALESCE(v_questions, '[]'::json),
        'assessments', COALESCE(v_assessments, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 4: save_remedial_question_assessment
-- Autosave Penilaian per Butir Soal Remedial
-- Server Authoritative Rubric & Optimistic Concurrency Guard
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS save_remedial_question_assessment(TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION save_remedial_question_assessment(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT,
    p_question_number INTEGER,
    p_assessment_data JSONB,
    p_expected_version INTEGER DEFAULT NULL,
    p_mark_completed BOOLEAN DEFAULT false
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
    v_session RECORD;
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
    v_audit_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat menilai ujian.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_remedial_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian remedial tidak ditemukan.');
    END IF;

    IF v_attempt.status = 'submitted' THEN
        RETURN json_build_object('success', false, 'message', 'Ujian telah dikirim dan bersifat read-only.');
    END IF;

    -- Otorisasi penguji: Wajib assigned examiner atau Admin
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi ini.');
    END IF;

    -- 3. Stale Check
    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = v_attempt.remedial_session_id;
    SELECT * INTO v_question_set FROM exam_remedial_question_sets WHERE id = v_attempt.remedial_question_set_id;
    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE id = v_session.material_snapshot_id;
    
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        COALESCE(v_snapshot.memorization_direction, 'forward')
    );

    IF v_question_set.status != 'locked' OR v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_remedial_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        UPDATE exam_remedial_sessions SET status = 'stale', updated_at = now() WHERE id = v_session.id;
        RETURN json_build_object('success', false, 'isStale', true, 'message', 'Ujian diblokir: Paket soal remedial berstatus STALE karena materi berubah.');
    END IF;

    -- 4. Ambil Assessment Eksisting
    SELECT * INTO v_existing_assessment FROM exam_remedial_question_assessments 
    WHERE remedial_attempt_id = p_attempt_id AND question_number = p_question_number;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Data nomor butir soal tidak ditemukan pada sesi remedial.');
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

    -- 5. Validasi Metadata Butir Soal (Authoritative Rubric Setup)
    SELECT * INTO v_question FROM exam_remedial_questions WHERE id = v_existing_assessment.remedial_question_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Metadata butir soal tidak ditemukan pada database.');
    END IF;

    IF v_session.exam_type = 'uts' THEN
        v_max_fluency := 12.00;
        v_max_tajwid := 4.00;
        v_max_makhraj := 4.00;
        v_max_score := 20.00;
    ELSE -- UAS
        IF v_question.question_role = 'mandatory' THEN
            v_max_fluency := 9.00;
            v_max_tajwid := 3.00;
            v_max_makhraj := 3.00;
            v_max_score := 15.00;
        ELSIF v_question.question_role = 'random' THEN
            v_max_fluency := 6.00;
            v_max_tajwid := 2.00;
            v_max_makhraj := 2.00;
            v_max_score := 10.00;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Role butir soal tidak dikenal: ' || v_question.question_role);
        END IF;
    END IF;

    -- 6. Server-Authoritative Deduction Calculation
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

    -- Atomic Update dengan version guard
    UPDATE exam_remedial_question_assessments SET
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
    UPDATE exam_remedial_attempts SET last_saved_at = now(), updated_at = now() WHERE id = p_attempt_id;

    -- Audit log jika baru saja ditandai completed
    IF (p_mark_completed = true OR (p_assessment_data->>'isCompleted')::BOOLEAN = true) AND v_existing_assessment.completed_at IS NULL THEN
        v_audit_id := 'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            before_data, after_data, reason, created_at
        ) VALUES (
            v_audit_id,
            v_session.original_exam_period_id,
            v_session.student_id,
            'remedial_question_scored',
            v_user.id,
            jsonb_build_object('attemptId', p_attempt_id, 'questionNumber', p_question_number, 'isCompleted', false),
            jsonb_build_object('attemptId', p_attempt_id, 'questionNumber', p_question_number, 'score', v_q_score, 'version', v_new_version, 'isCompleted', true),
            'Penilaian butir soal remedial ' || p_question_number || ' diselesaikan',
            now()
        );
    END IF;

    RETURN json_build_object(
        'success', true,
        'message', 'Penilaian soal nomor ' || p_question_number || ' berhasil disimpan.',
        'assessment', json_build_object(
            'questionNumber', p_question_number,
            'fluencyScore', v_f_score,
            'tajwidScore', v_t_score,
            'makhrajScore', v_m_score,
            'questionScore', v_q_score,
            'version', v_new_version,
            'completedAt', v_new_completed_at
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 5: get_remedial_attempt_detail
-- Detail Sesi Ujian Remedial untuk Resume & Review
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_remedial_attempt_detail(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_remedial_attempt_detail(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
    v_session RECORD;
    v_period RECORD;
    v_student RECORD;
    v_questions JSON;
    v_assessments JSON;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat melihat detail remedial.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_remedial_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian remedial tidak ditemukan.');
    END IF;

    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi ini.');
    END IF;

    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = v_attempt.remedial_session_id;
    SELECT * INTO v_period FROM exam_periods WHERE id = v_session.original_exam_period_id;
    SELECT * INTO v_student FROM students WHERE id = v_session.student_id;

    -- 3. Query Pertanyaan (Tanpa Teks Al-Qur'an)
    SELECT json_agg(row_to_json(q_row)) INTO v_questions
    FROM (
        SELECT 
            id,
            question_number AS "questionNumber",
            zone_number AS "zoneNumber",
            question_role AS "questionRole",
            source_type AS "sourceType",
            page_number AS "pageNumber",
            max_score AS "maxScore",
            prompt_start_surah AS "promptStartSurah",
            prompt_start_ayah AS "promptStartAyah",
            prompt_start_word AS "promptStartWord",
            prompt_end_surah AS "promptEndSurah",
            prompt_end_ayah AS "promptEndAyah",
            prompt_end_word AS "promptEndWord",
            answer_start_surah AS "answerStartSurah",
            answer_start_ayah AS "answerStartAyah",
            answer_start_word AS "answerStartWord",
            answer_end_surah AS "answerEndSurah",
            answer_end_ayah AS "answerEndAyah",
            answer_end_word AS "answerEndWord",
            start_page AS "startPage",
            end_page AS "endPage",
            generated_metadata AS "metadata"
        FROM exam_remedial_questions
        WHERE remedial_question_set_id = v_attempt.remedial_question_set_id
        ORDER BY question_number ASC
    ) q_row;

    -- 4. Query Assessments
    SELECT json_agg(row_to_json(a_row)) INTO v_assessments
    FROM (
        SELECT 
            id,
            question_number AS "questionNumber",
            remedial_question_id AS "questionId",
            fluency_score AS "fluencyScore",
            tajwid_score AS "tajwidScore",
            makhraj_score AS "makhrajScore",
            question_score AS "questionScore",
            fluency_events AS "fluencyEvents",
            tajwid_events AS "tajwidEvents",
            makhraj_events AS "makhrajEvents",
            notes,
            version,
            started_at AS "startedAt",
            completed_at AS "completedAt"
        FROM exam_remedial_question_assessments
        WHERE remedial_attempt_id = v_attempt.id
        ORDER BY question_number ASC
    ) a_row;

    RETURN json_build_object(
        'success', true,
        'attempt', json_build_object(
            'id', v_attempt.id,
            'remedialSessionId', v_session.id,
            'remedialQuestionSetId', v_attempt.remedial_question_set_id,
            'examinerUserId', v_attempt.examiner_user_id,
            'status', v_attempt.status,
            'startedAt', v_attempt.started_at,
            'lastSavedAt', v_attempt.last_saved_at,
            'submittedAt', v_attempt.submitted_at,
            'totalScore', v_attempt.total_score,
            'version', v_attempt.version,
            'examType', v_session.exam_type,
            'kkm', v_period.kkm,
            'student', json_build_object(
                'id', v_student.id,
                'name', v_student.name,
                'nis', v_student.nis
            )
        ),
        'questions', COALESCE(v_questions, '[]'::json),
        'assessments', COALESCE(v_assessments, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 6: submit_remedial_attempt
-- Finalisasi & Pengiriman Ujian Remedial (Idempotent & Authoritative)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS submit_remedial_attempt(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION submit_remedial_attempt(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
    v_session RECORD;
    v_period RECORD;
    v_question_set RECORD;
    v_snapshot RECORD;
    v_calc_fingerprint TEXT;
    v_expected_qcount INTEGER;
    v_count_total INTEGER;
    v_count_completed INTEGER;
    v_valid_q_count INTEGER;
    v_total_calculated NUMERIC(5,2) := 0;
    v_asm RECORD;
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
    v_audit_id TEXT;
    v_is_passed BOOLEAN;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat mengirim ujian.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_remedial_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian remedial tidak ditemukan.');
    END IF;

    -- Otorisasi penguji
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi ini.');
    END IF;

    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = v_attempt.remedial_session_id;
    SELECT * INTO v_period FROM exam_periods WHERE id = v_session.original_exam_period_id;

    -- Idempotency check: jika sudah submitted, kembalikan hasil yang tersimpan tanpa duplikasi audit
    IF v_attempt.status = 'submitted' THEN
        RETURN json_build_object(
            'success', true,
            'isExisting', true,
            'message', 'Ujian remedial sudah dikirim dan difinalisasi sebelumnya.',
            'totalScore', v_attempt.total_score,
            'submittedAt', v_attempt.submitted_at,
            'kkm', v_period.kkm,
            'isPassed', (v_attempt.total_score >= v_period.kkm),
            'effectiveScore', v_attempt.total_score
        );
    END IF;

    -- 3. Stale Check
    SELECT * INTO v_question_set FROM exam_remedial_question_sets WHERE id = v_attempt.remedial_question_set_id;
    SELECT * INTO v_snapshot FROM exam_material_snapshots WHERE id = v_session.material_snapshot_id;
    
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        COALESCE(v_snapshot.memorization_direction, 'forward')
    );

    IF v_question_set.status != 'locked' OR v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_remedial_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        UPDATE exam_remedial_sessions SET status = 'stale', updated_at = now() WHERE id = v_session.id;
        RETURN json_build_object('success', false, 'isStale', true, 'message', 'Ujian diblokir: Paket soal remedial berstatus STALE karena materi berubah.');
    END IF;

    -- 4. Validasi Kelengkapan Soal (UTS: 5 soal, UAS: 9 soal, seluruhnya COMPLETED)
    v_expected_qcount := CASE WHEN v_session.exam_type = 'uts' THEN 5 ELSE 9 END;

    SELECT COUNT(*), COUNT(*) FILTER (WHERE completed_at IS NOT NULL)
    INTO v_count_total, v_count_completed
    FROM exam_remedial_question_assessments
    WHERE remedial_attempt_id = p_attempt_id;

    IF v_count_total != v_expected_qcount OR v_count_completed != v_expected_qcount THEN
        RETURN json_build_object(
            'success', false, 
            'message', 'Validasi gagal: Seluruh ' || v_expected_qcount || ' butir soal wajib diselesaikan (completed) sebelum submit final. Saat ini ' || v_count_completed || ' dari ' || v_expected_qcount || ' soal selesai.'
        );
    END IF;

    -- Validasi soal berasal dari question set resmi
    SELECT COUNT(*) INTO v_valid_q_count
    FROM exam_remedial_question_assessments eqa
    JOIN exam_remedial_questions eq ON eq.id = eqa.remedial_question_id
    WHERE eqa.remedial_attempt_id = p_attempt_id
      AND eq.remedial_question_set_id = v_attempt.remedial_question_set_id;

    IF v_valid_q_count != v_expected_qcount THEN
        RETURN json_build_object('success', false, 'message', 'Validasi integritas gagal: Butir soal tidak sesuai dengan paket soal resmi remedial.');
    END IF;

    -- 5. Authoritative Server-Side Recalculation
    v_total_calculated := 0;

    FOR v_asm IN 
        SELECT a.*, q.question_role, q.max_score AS question_max_score
        FROM exam_remedial_question_assessments a
        JOIN exam_remedial_questions q ON q.id = a.remedial_question_id
        WHERE a.remedial_attempt_id = p_attempt_id 
        ORDER BY a.question_number ASC
    LOOP
        v_f_deduction := 0;
        v_t_deduction := 0;
        v_m_deduction := 0;

        IF v_session.exam_type = 'uts' THEN
            v_max_fluency := 12.00;
            v_max_tajwid := 4.00;
            v_max_makhraj := 4.00;
            v_max_score := 20.00;
        ELSE -- UAS
            IF v_asm.question_role = 'mandatory' THEN
                v_max_fluency := 9.00;
                v_max_tajwid := 3.00;
                v_max_makhraj := 3.00;
                v_max_score := 15.00;
            ELSIF v_asm.question_role = 'random' THEN
                v_max_fluency := 6.00;
                v_max_tajwid := 2.00;
                v_max_makhraj := 2.00;
                v_max_score := 10.00;
            END IF;
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

        -- Simpan hasil authoritative per soal
        UPDATE exam_remedial_question_assessments SET
            fluency_score = v_f_score,
            tajwid_score = v_t_score,
            makhraj_score = v_m_score,
            question_score = v_q_score,
            updated_at = now()
        WHERE id = v_asm.id;

        v_total_calculated := v_total_calculated + v_q_score;
    END LOOP;

    v_total_calculated := ROUND(v_total_calculated, 2);

    IF v_total_calculated > 100.00 THEN
        RETURN json_build_object('success', false, 'message', 'Integritas nilai gagal: Total nilai melebihi 100.');
    END IF;

    v_is_passed := (v_total_calculated >= v_period.kkm);

    -- 6. Finalisasi Status Attempt Remedial (ORIGINAL ATTEMPT TETAP IMMUTABLE!)
    UPDATE exam_remedial_attempts SET
        status = 'submitted',
        total_score = v_total_calculated,
        submitted_at = now(),
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Update session status
    UPDATE exam_remedial_sessions SET
        status = 'submitted',
        updated_at = now()
    WHERE id = v_session.id;

    -- Update assignment status
    UPDATE exam_remedial_examiner_assignments SET
        status = 'completed',
        updated_at = now()
    WHERE remedial_session_id = v_session.id;

    -- 7. Audit Log Kanonikal
    v_audit_id := 'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        v_audit_id,
        v_session.original_exam_period_id,
        v_session.student_id,
        'remedial_exam_submitted',
        v_user.id,
        jsonb_build_object('attemptId', p_attempt_id, 'status', 'in_progress'),
        jsonb_build_object('attemptId', p_attempt_id, 'status', 'submitted', 'totalScore', v_total_calculated, 'kkm', v_period.kkm, 'isPassed', v_is_passed),
        'Finalisasi dan pengiriman nilai remedial',
        now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Ujian remedial berhasil difinalisasi dan dikirim.',
        'totalScore', v_total_calculated,
        'submittedAt', now(),
        'kkm', v_period.kkm,
        'isPassed', v_is_passed,
        'effectiveScore', v_total_calculated
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 7: reopen_remedial_attempt
-- Admin Only: Membuka Kembali Remedial yang Sudah Disubmit
-- Mempertahankan Question Set, Question IDs, dan Riwayat Nilai
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS reopen_remedial_attempt(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION reopen_remedial_attempt(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT,
    p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
    v_session RECORD;
    v_audit_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    -- 2. Otorisasi Admin Saja
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuka kembali (reopen) ujian remedial.');
    END IF;

    -- 3. Validasi Alasan Wajib
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan pembukaan kembali ujian remedial.');
    END IF;

    SELECT * INTO v_attempt FROM exam_remedial_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian remedial tidak ditemukan.');
    END IF;

    IF v_attempt.status != 'submitted' THEN
        RETURN json_build_object('success', false, 'message', 'Hanya sesi ujian remedial yang berstatus submitted yang dapat dibuka kembali.');
    END IF;

    SELECT * INTO v_session FROM exam_remedial_sessions WHERE id = v_attempt.remedial_session_id;

    -- 4. Kembalikan Status Attempt ke reopened (Increment version token)
    UPDATE exam_remedial_attempts SET
        status = 'reopened',
        reopened_at = now(),
        reopened_by = v_user.id,
        reopen_reason = p_reason,
        version = version + 1,
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Kembalikan status session ke reopened
    UPDATE exam_remedial_sessions SET
        status = 'reopened',
        updated_at = now()
    WHERE id = v_session.id;

    -- Kembalikan status assignment ke assigned
    UPDATE exam_remedial_examiner_assignments SET
        status = 'assigned',
        updated_at = now()
    WHERE remedial_session_id = v_session.id;

    -- 5. Audit Log Kanonikal
    v_audit_id := 'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6);
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        v_audit_id,
        v_session.original_exam_period_id,
        v_session.student_id,
        'remedial_exam_reopened',
        v_user.id,
        jsonb_build_object('attemptId', p_attempt_id, 'oldStatus', 'submitted', 'score', v_attempt.total_score),
        jsonb_build_object('attemptId', p_attempt_id, 'newStatus', 'reopened'),
        p_reason,
        now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Ujian remedial berhasil dibuka kembali untuk koreksi nilai oleh penguji resmi.',
        'attemptId', p_attempt_id,
        'status', 'reopened'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ============================================================
-- 7. SECURITY & PERMISSIONS
-- ============================================================
REVOKE EXECUTE ON FUNCTION assign_remedial_examiner_secure(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_examiner_remedial_students(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION start_remedial_attempt(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION save_remedial_question_assessment(TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_remedial_attempt_detail(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION submit_remedial_attempt(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reopen_remedial_attempt(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION assign_remedial_examiner_secure(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_examiner_remedial_students(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION start_remedial_attempt(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION save_remedial_question_assessment(TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, BOOLEAN) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_remedial_attempt_detail(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION submit_remedial_attempt(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION reopen_remedial_attempt(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
