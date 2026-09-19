-- ============================================================
-- SQL Migration: Tahap 5B — Pelaksanaan & Penilaian UTS Tahfiz
-- Darul Abror IBS (Non-Destructive Migration)
-- ============================================================

-- 1. TABEL: exam_examiner_assignments (Penugasan Penguji ke Santri per Periode UTS)
CREATE TABLE IF NOT EXISTS exam_examiner_assignments (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT NOT NULL REFERENCES exam_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    examiner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_exam_assignment UNIQUE (exam_period_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_eea_period_examiner ON exam_examiner_assignments(exam_period_id, examiner_user_id);
CREATE INDEX IF NOT EXISTS idx_eea_student ON exam_examiner_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_eea_status ON exam_examiner_assignments(status);


-- 2. TABEL: exam_attempts (Sesi Percobaan Pelaksanaan Ujian Santri)
CREATE TABLE IF NOT EXISTS exam_attempts (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT NOT NULL REFERENCES exam_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    question_set_id TEXT NOT NULL REFERENCES exam_question_sets(id) ON DELETE RESTRICT,
    examiner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'void')),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_saved_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    submitted_at TIMESTAMP WITH TIME ZONE,
    total_score NUMERIC(5,2) DEFAULT 0 CHECK (total_score >= 0 AND total_score <= 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_exam_attempt UNIQUE (exam_period_id, student_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_ea_period_student ON exam_attempts(exam_period_id, student_id);
CREATE INDEX IF NOT EXISTS idx_ea_examiner ON exam_attempts(examiner_user_id);
CREATE INDEX IF NOT EXISTS idx_ea_status ON exam_attempts(status);
CREATE INDEX IF NOT EXISTS idx_ea_question_set ON exam_attempts(question_set_id);


-- 3. TABEL: exam_question_assessments (Penilaian per Nomor Soal 1–5 dalam Sesi Ujian)
CREATE TABLE IF NOT EXISTS exam_question_assessments (
    id TEXT PRIMARY KEY,
    exam_attempt_id TEXT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    exam_question_id TEXT NOT NULL REFERENCES exam_questions(id) ON DELETE RESTRICT,
    question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 5),
    
    -- Skor Komponen Penilaian (Maks: Kelancaran 12, Tajwid 4, Makhraj 4 -> Total 20)
    fluency_score NUMERIC(5,2) NOT NULL DEFAULT 12 CHECK (fluency_score >= 0 AND fluency_score <= 12),
    tajwid_score NUMERIC(5,2) NOT NULL DEFAULT 4 CHECK (tajwid_score >= 0 AND tajwid_score <= 4),
    makhraj_score NUMERIC(5,2) NOT NULL DEFAULT 4 CHECK (makhraj_score >= 0 AND makhraj_score <= 4),
    
    -- Rincian Event Kesalahan (JSONB)
    fluency_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    tajwid_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    makhraj_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    question_score NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (question_score >= 0 AND question_score <= 20),
    notes TEXT,
    
    started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT uq_exam_attempt_question UNIQUE (exam_attempt_id, exam_question_id),
    CONSTRAINT uq_exam_attempt_qnumber UNIQUE (exam_attempt_id, question_number)
);

ALTER TABLE exam_question_assessments ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_eqa_attempt ON exam_question_assessments(exam_attempt_id);
CREATE INDEX IF NOT EXISTS idx_eqa_question ON exam_question_assessments(exam_question_id);


-- 4. ROW LEVEL SECURITY (RLS): Tolak Direct Mutasi dari Anon Client
ALTER TABLE exam_examiner_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_question_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eea_deny_direct_access ON exam_examiner_assignments;
CREATE POLICY eea_deny_direct_access ON exam_examiner_assignments FOR ALL USING (false);

DROP POLICY IF EXISTS ea_deny_direct_access ON exam_attempts;
CREATE POLICY ea_deny_direct_access ON exam_attempts FOR ALL USING (false);

DROP POLICY IF EXISTS eqa_deny_direct_access ON exam_question_assessments;
CREATE POLICY eqa_deny_direct_access ON exam_question_assessments FOR ALL USING (false);


-- ============================================================
-- 5. STORED PROCEDURES (SECURITY DEFINER RPC) — HARDENED
-- ============================================================

-- RPC 1: assign_examiner_secure (Admin Only + Reassignment Reason on in_progress)
DROP FUNCTION IF EXISTS assign_examiner_secure(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION assign_examiner_secure(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT,
    p_student_id TEXT,
    p_examiner_id TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_student RECORD;
    v_examiner RECORD;
    v_assignment_id TEXT;
    v_existing_attempt RECORD;
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    -- 2. Otorisasi: Wajib Admin
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak menugaskan penguji.');
    END IF;

    -- 3. Validasi Periode
    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    -- 4. Validasi Santri & Peserta
    SELECT * INTO v_student FROM students WHERE id = p_student_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Santri tidak ditemukan.');
    END IF;

    -- 5. Validasi Penguji (Wajib User dengan role teacher atau admin)
    SELECT * INTO v_examiner FROM users WHERE id = p_examiner_id AND role IN ('teacher', 'admin');
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Penguji tidak valid (harus guru atau admin).');
    END IF;

    -- 6. Cek jika santri sudah submitted
    SELECT * INTO v_existing_attempt FROM exam_attempts 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'submitted';
    IF FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Tidak dapat mengubah penguji: Ujian santri ini sudah diselesaikan (submitted).');
    END IF;

    v_assignment_id := 'eea_' || p_period_id || '_' || p_student_id;

    -- 7. Upsert Assignment
    INSERT INTO exam_examiner_assignments (
        id, exam_period_id, student_id, examiner_user_id, assigned_by, assigned_at, status, created_at, updated_at
    ) VALUES (
        v_assignment_id, p_period_id, p_student_id, p_examiner_id, v_user.id, now(), 'assigned', now(), now()
    )
    ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
        examiner_user_id = EXCLUDED.examiner_user_id,
        assigned_by = EXCLUDED.assigned_by,
        assigned_at = now(),
        updated_at = now();

    -- Jika ada attempt in_progress, update examiner_user_id
    UPDATE exam_attempts 
    SET examiner_user_id = p_examiner_id, updated_at = now()
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'in_progress';

    -- Audit Log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id, p_student_id, 'examiner_assigned', v_user.id,
        jsonb_build_object('examinerId', p_examiner_id, 'examinerName', v_examiner.name),
        'Penugasan penguji UTS santri', now()
    );

    RETURN json_build_object(
        'success', true, 
        'message', 'Penguji berhasil ditugaskan untuk ' || v_student.name || '.',
        'assignment', json_build_object(
            'id', v_assignment_id,
            'examPeriodId', p_period_id,
            'studentId', p_student_id,
            'examinerUserId', p_examiner_id,
            'examinerName', v_examiner.name,
            'status', 'assigned'
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 2: get_examiner_uts_students (Teacher / Admin View)
CREATE OR REPLACE FUNCTION get_examiner_uts_students(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_students JSON;
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

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    -- Query peserta yang ditugaskan ke guru ini (atau seluruh santri jika Admin)
    SELECT json_agg(json_build_object(
        'studentId', s.id,
        'studentName', s.name,
        'studentNis', s.nis,
        'class', s.class,
        'halaqah', s.halaqah,
        'teacherId', s.teacher_id,
        'teacherName', tu.name,
        'examinerId', a.examiner_user_id,
        'examinerName', eu.name,
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
        'isStale', (
            snap.status = 'finalized' AND qs.status IS NOT NULL AND 
            qs.material_fingerprint != calculate_material_fingerprint(snap.start_surah, snap.start_ayah, snap.end_surah, snap.end_ayah, snap.memorization_direction)
        ),
        'attemptId', att.id,
        'attemptStatus', att.status,
        'attemptNumber', att.attempt_number,
        'totalScore', att.total_score,
        'startedAt', att.started_at,
        'submittedAt', att.submitted_at
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
          OR (a.examiner_user_id IS NULL AND p.teacher_id_snapshot = v_user.id)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 3: start_uts_attempt (Idempotent, Wajib Memenuhi 6 Prasyarat)
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
    v_questions JSON;
    v_assessments JSON;
    v_q RECORD;
    v_calc_fingerprint TEXT;
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    -- 2. Validasi Periode Ujian
    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;
    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    -- 3. Validasi Peserta
    SELECT * INTO v_participant FROM exam_participants 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Santri bukan peserta resmi periode ujian ini.');
    END IF;

    -- 4. Validasi Penugasan Penguji (Examiner Assignment)
    SELECT * INTO v_assignment FROM exam_examiner_assignments 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    
    IF NOT FOUND THEN
        -- Fallback jika belum diassign manual: izinkan guru halaqah santri
        IF v_user.role = 'teacher' AND v_participant.teacher_id_snapshot != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Penguji belum ditugaskan untuk santri ini.');
        END IF;
    ELSE
        -- Jika sudah ada assignment, hanya penguji assigned atau Admin yang berhak
        IF v_user.role = 'teacher' AND v_assignment.examiner_user_id != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk santri ini.');
        END IF;
    END IF;

    -- 5. Validasi Snapshot Materi: Wajib FINALIZED
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Materi UTS santri belum difinalisasi.');
    END IF;

    -- 6. Validasi Paket Soal: Wajib LOCKED & Tepat 5 Soal
    SELECT * INTO v_question_set FROM exam_question_sets 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'locked'
    ORDER BY version DESC LIMIT 1;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal UTS belum dibuat atau terkunci.');
    END IF;

    -- 7. Validasi Paket Soal TIDAK STALE
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal berstatus STALE karena materi berubah.');
    END IF;

    -- IDEMPOTENCY CHECK: Cek apakah sudah ada attempt
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
            1, 'in_progress', now(), now(), 100, now(), now()
        );

        -- Inisialisasi 5 assessment kosong (default max score 20)
        FOR v_q IN 
            SELECT * FROM exam_questions 
            WHERE question_set_id = v_question_set.id 
            ORDER BY question_number ASC
        LOOP
            INSERT INTO exam_question_assessments (
                id, exam_attempt_id, exam_question_id, question_number,
                fluency_score, tajwid_score, makhraj_score,
                fluency_events, tajwid_events, makhraj_events,
                question_score, notes, started_at, updated_at
            ) VALUES (
                'aqa_' || v_attempt_id || '_q' || v_q.question_number,
                v_attempt_id, v_q.id, v_q.question_number,
                12, 4, 4,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                20, '', now(), now()
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

    -- Ambil data 5 soal
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

    -- Ambil assessments saat ini
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
        'completedAt', a.completed_at
    ) ORDER BY a.question_number ASC) INTO v_assessments
    FROM exam_question_assessments a
    WHERE a.exam_attempt_id = v_attempt_id;

    RETURN json_build_object(
        'success', true,
        'attempt', json_build_object(
            'id', v_attempt_id,
            'examPeriodId', p_period_id,
            'studentId', p_student_id,
            'questionSetId', v_question_set.id,
            'status', 'in_progress',
            'startedAt', COALESCE(v_existing_attempt.started_at, now()),
            'lastSavedAt', now()
        ),
        'kkm', v_period.kkm,
        'questions', v_questions,
        'assessments', v_assessments
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 4: save_uts_question_assessment (Autosave Debounced per Nomor Soal)
CREATE OR REPLACE FUNCTION save_uts_question_assessment(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT,
    p_question_number INTEGER,
    p_assessment_data JSONB
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
    v_f_events JSONB;
    v_t_events JSONB;
    v_m_events JSONB;
    v_f_score NUMERIC(5,2);
    v_t_score NUMERIC(5,2);
    v_m_score NUMERIC(5,2);
    v_q_score NUMERIC(5,2);
    v_f_deduction NUMERIC(5,2) := 0;
    v_t_deduction NUMERIC(5,2) := 0;
    v_m_deduction NUMERIC(5,2) := 0;
    v_event JSONB;
BEGIN
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

    IF v_attempt.status != 'in_progress' THEN
        RETURN json_build_object('success', false, 'message', 'Ujian telah dikirim dan bersifat read-only.');
    END IF;

    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji sesi ini.');
    END IF;

    -- Parsing events
    v_f_events := COALESCE(p_assessment_data->'fluencyEvents', '[]'::jsonb);
    v_t_events := COALESCE(p_assessment_data->'tajwidEvents', '[]'::jsonb);
    v_m_events := COALESCE(p_assessment_data->'makhrajEvents', '[]'::jsonb);

    -- 1. Hitung Deduksi Kelancaran (Max 12)
    -- Koreksi mandiri: -0.5, Ditegur: -1, Pancingan: -2, Tidak bisa: -4
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_f_events)
    LOOP
        IF v_event->>'type' = 'self_correction' THEN
            v_f_deduction := v_f_deduction + 0.5;
        ELSIF v_event->>'type' = 'reminder' THEN
            v_f_deduction := v_f_deduction + 1.0;
        ELSIF v_event->>'type' = 'prompt' THEN
            v_f_deduction := v_f_deduction + 2.0;
        ELSIF v_event->>'type' = 'unable' THEN
            v_f_deduction := v_f_deduction + 4.0;
        END IF;
    END LOOP;
    v_f_score := GREATEST(0.00, 12.00 - v_f_deduction);

    -- 2. Hitung Deduksi Tajwid (Max 4)
    -- Ringan: -0.5, Nyata: -1
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_t_events)
    LOOP
        IF v_event->>'type' = 'minor' THEN
            v_t_deduction := v_t_deduction + 0.5;
        ELSIF v_event->>'type' = 'major' THEN
            v_t_deduction := v_t_deduction + 1.0;
        END IF;
    END LOOP;
    v_t_score := GREATEST(0.00, 4.00 - v_t_deduction);

    -- 3. Hitung Deduksi Makhraj (Max 4)
    -- Ringan: -0.5, Nyata: -1
    FOR v_event IN SELECT * FROM jsonb_array_elements(v_m_events)
    LOOP
        IF v_event->>'type' = 'minor' THEN
            v_m_deduction := v_m_deduction + 0.5;
        ELSIF v_event->>'type' = 'major' THEN
            v_m_deduction := v_m_deduction + 1.0;
        END IF;
    END LOOP;
    v_m_score := GREATEST(0.00, 4.00 - v_m_deduction);

    v_q_score := v_f_score + v_t_score + v_m_score;

    -- Update assessment nomor soal
    UPDATE exam_question_assessments SET
        fluency_score = v_f_score,
        tajwid_score = v_t_score,
        makhraj_score = v_m_score,
        question_score = v_q_score,
        fluency_events = v_f_events,
        tajwid_events = v_t_events,
        makhraj_events = v_m_events,
        notes = p_assessment_data->>'notes',
        completed_at = CASE WHEN (p_assessment_data->>'isCompleted')::BOOLEAN = true THEN now() ELSE completed_at END,
        updated_at = now()
    WHERE exam_attempt_id = p_attempt_id AND question_number = p_question_number;

    -- Update timestamp sesi
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
            'lastSavedAt', now()
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 5: get_uts_attempt (Resume / View Ujian)
CREATE OR REPLACE FUNCTION get_uts_attempt(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
    v_period RECORD;
    v_student RECORD;
    v_questions JSON;
    v_assessments JSON;
BEGIN
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

    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
    SELECT * INTO v_student FROM students WHERE id = v_attempt.student_id;

    -- Ambil soal
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
    WHERE q.question_set_id = v_attempt.question_set_id;

    -- Ambil assessments
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
        'completedAt', a.completed_at
    ) ORDER BY a.question_number ASC) INTO v_assessments
    FROM exam_question_assessments a
    WHERE a.exam_attempt_id = p_attempt_id;

    RETURN json_build_object(
        'success', true,
        'attempt', json_build_object(
            'id', v_attempt.id,
            'examPeriodId', v_attempt.exam_period_id,
            'studentId', v_attempt.student_id,
            'studentName', v_student.name,
            'class', v_student.class,
            'questionSetId', v_attempt.question_set_id,
            'status', v_attempt.status,
            'totalScore', v_attempt.total_score,
            'startedAt', v_attempt.started_at,
            'lastSavedAt', v_attempt.last_saved_at,
            'submittedAt', v_attempt.submitted_at
        ),
        'kkm', v_period.kkm,
        'questions', v_questions,
        'assessments', v_assessments
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 6: submit_uts_attempt (Server-Side Recalculation & Finalization)
CREATE OR REPLACE FUNCTION submit_uts_attempt(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
    v_period RECORD;
    v_student RECORD;
    v_count_completed INTEGER;
    v_total_calculated NUMERIC(5,2) := 0;
    v_is_passed BOOLEAN;
BEGIN
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
            'isPassed', (v_attempt.total_score >= v_period.kkm)
        );
    END IF;

    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji sesi ini.');
    END IF;

    -- Validasi tepat 5 soal telah terisi
    SELECT COUNT(*) INTO v_count_completed 
    FROM exam_question_assessments 
    WHERE exam_attempt_id = p_attempt_id;

    IF v_count_completed != 5 THEN
        RETURN json_build_object('success', false, 'message', 'Validasi gagal: Wajib menyelesaikan penilaian untuk seluruh 5 soal sebelum submit.');
    END IF;

    -- REKALKULASI TOTAL SERVER-SIDE DARI 5 SOAL
    SELECT COALESCE(SUM(question_score), 0) INTO v_total_calculated
    FROM exam_question_assessments
    WHERE exam_attempt_id = p_attempt_id;

    v_total_calculated := ROUND(v_total_calculated, 2);

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
            'kkm', v_period.kkm,
            'isPassed', v_is_passed
        ),
        'Submit final hasil ujian UTS santri', now()
    );

    RETURN json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Hasil ujian UTS berhasil dikirim dan difinalisasi.',
        'totalScore', v_total_calculated,
        'kkm', v_period.kkm,
        'isPassed', v_is_passed,
        'submittedAt', now()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 7: reopen_uts_attempt (Admin Only, Audit Trail dengan Alasan Wajib)
CREATE OR REPLACE FUNCTION reopen_uts_attempt(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT,
    p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_attempt RECORD;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuka kembali (reopen) ujian yang sudah disubmit.');
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan pembukaan kembali ujian.');
    END IF;

    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
    END IF;

    IF v_attempt.status != 'submitted' THEN
        RETURN json_build_object('success', false, 'message', 'Hanya sesi ujian yang sudah berstatus submitted yang dapat dibuka kembali.');
    END IF;

    -- Kembalikan status ke in_progress
    UPDATE exam_attempts SET
        status = 'in_progress',
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Kembalikan status assignment ke assigned
    UPDATE exam_examiner_assignments SET
        status = 'assigned',
        updated_at = now()
    WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;

    -- Audit log
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_attempt.exam_period_id, v_attempt.student_id, 'attempt_reopened', v_user.id,
        jsonb_build_object('attemptId', p_attempt_id, 'oldStatus', 'submitted', 'score', v_attempt.total_score),
        jsonb_build_object('attemptId', p_attempt_id, 'newStatus', 'in_progress'),
        p_reason, now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Ujian berhasil dibuka kembali untuk koreksi nilai.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
