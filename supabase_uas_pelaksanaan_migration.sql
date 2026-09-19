-- ============================================================
-- SQL Migration: Tahap 6B — Pelaksanaan & Penilaian UAS Tahfiz
-- Darul Abror IBS (Non-Destructive Migration & Hardened RPCs)
-- File: supabase_uas_pelaksanaan_migration.sql
-- ============================================================

-- 1. SCHEMA HARDENING: Dukung Butir Soal 1 s.d. 9 pada exam_question_assessments
-- Mengganti batasan 1..5 (UTS) menjadi 1..9 (mendukung UTS & UAS)
ALTER TABLE exam_question_assessments 
DROP CONSTRAINT IF EXISTS exam_question_assessments_question_number_check;

ALTER TABLE exam_question_assessments 
ADD CONSTRAINT exam_question_assessments_question_number_check 
CHECK (question_number BETWEEN 1 AND 9);


-- ============================================================
-- 2. STORED PROCEDURES (SECURITY DEFINER RPC) UNTUK PELAKSANAAN UAS
-- ============================================================

-- ------------------------------------------------------------
-- RPC 1: get_examiner_uas_students
-- Mengambil daftar santri peserta UAS untuk penguji (atau seluruhnya untuk Admin)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_examiner_uas_students(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_examiner_uas_students(
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
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat mengakses.');
    END IF;

    -- 2. Validasi Periode UAS
    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uas' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian bukan periode UAS.');
    END IF;

    -- 3. Query peserta UAS: Teacher HANYA melihat santri yang eksplisit ditugaskan kepadanya
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
      );

    RETURN json_build_object(
        'success', true,
        'period', json_build_object(
            'id', v_period.id,
            'name', v_period.name,
            'kkm', v_period.kkm,
            'status', v_period.status,
            'examType', v_period.exam_type
        ),
        'students', COALESCE(v_students, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 2: start_uas_attempt
-- Memulai sesi ujian UAS santri dengan validasi ketat 11 prasyarat
-- Inisialisasi 9 butir soal (2 Wajib @ 15 + 7 Acak @ 10)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS start_uas_attempt(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION start_uas_attempt(
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
    v_total_questions INTEGER;
    v_mandatory_count INTEGER;
    v_random_count INTEGER;
    v_mand_15_count INTEGER;
    v_rand_10_count INTEGER;
    v_rand_distinct_zones INTEGER;
    v_total_max_score NUMERIC(5,2);
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    -- Role Whitelist: Hanya Admin dan Teacher yang diizinkan
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat memulai ujian.');
    END IF;

    -- 2. Validasi Periode Ujian
    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    -- Pre-Start 1: exam_period.exam_type = 'uas'
    IF v_period.exam_type != 'uas' THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Periode ujian bukan periode UAS.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian UAS telah selesai dan terkunci.');
    END IF;

    -- Pre-Start 2: participant valid
    SELECT * INTO v_participant FROM exam_participants 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Santri bukan peserta resmi periode UAS ini.');
    END IF;

    -- Pre-Start 3: examiner assigned
    SELECT * INTO v_assignment FROM exam_examiner_assignments 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Penguji belum ditugaskan untuk santri ini.');
    END IF;

    -- Teacher caller wajib cocok dengan official assigned examiner
    IF v_user.role = 'teacher' AND v_assignment.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk santri ini.');
    END IF;

    -- Pre-Start 4: material snapshot FINALIZED
    SELECT * INTO v_snapshot FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Materi UAS santri belum difinalisasi.');
    END IF;

    -- Pre-Start 5 & 6: question set tersedia & status LOCKED
    SELECT * INTO v_question_set FROM exam_question_sets 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'locked'
    ORDER BY version DESC LIMIT 1;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal UAS belum dibuat atau terkunci.');
    END IF;

    -- Pre-Start 7: question set TIDAK STALE
    v_calc_fingerprint := calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        v_snapshot.memorization_direction
    );

    IF v_question_set.material_fingerprint != v_calc_fingerprint THEN
        UPDATE exam_question_sets SET status = 'stale', updated_at = now() WHERE id = v_question_set.id;
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal UAS berstatus STALE karena materi santri berubah.');
    END IF;

    -- Pre-Start 8, 9, 10, 11: exactly 9 questions, 2 mandatory (max 15), 7 random (max 10), zones 1..7, total max_score = 100
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE question_role = 'mandatory'),
        COUNT(*) FILTER (WHERE question_role = 'random'),
        COUNT(*) FILTER (WHERE question_role = 'mandatory' AND max_score = 15.00),
        COUNT(*) FILTER (WHERE question_role = 'random' AND max_score = 10.00),
        COUNT(DISTINCT zone_number) FILTER (WHERE question_role = 'random' AND zone_number BETWEEN 1 AND 7),
        COALESCE(SUM(max_score), 0)
    INTO v_total_questions, v_mandatory_count, v_random_count,
         v_mand_15_count, v_rand_10_count, v_rand_distinct_zones, v_total_max_score
    FROM exam_questions
    WHERE question_set_id = v_question_set.id;

    IF v_total_questions != 9 THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal UAS harus tepat memiliki 9 butir soal.');
    END IF;

    IF v_mandatory_count != 2 OR v_random_count != 7 THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Paket soal UAS harus terdiri dari 2 soal wajib dan 7 soal acak.');
    END IF;

    IF v_mand_15_count != 2 OR v_rand_10_count != 7 THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Bobot soal wajib harus 15 dan bobot soal acak harus 10.');
    END IF;

    IF v_rand_distinct_zones != 7 THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: 7 soal acak harus mencakup zona 1 sampai 7 secara lengkap tanpa duplikasi.');
    END IF;

    IF v_total_max_score != 100.00 THEN
        RETURN json_build_object('success', false, 'message', 'Prasyarat gagal: Total bobot nilai paket soal UAS harus tepat 100. Terhitung: ' || v_total_max_score);
    END IF;

    -- IDEMPOTENCY CHECK
    SELECT * INTO v_existing_attempt FROM exam_attempts 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND attempt_number = 1;

    IF FOUND THEN
        IF v_existing_attempt.status = 'submitted' THEN
            RETURN json_build_object('success', false, 'message', 'Ujian santri ini sudah selesai dan telah dikirim (submitted).');
        END IF;

        -- Jika caller adalah guru, verifikasi bahwa guru ini adalah penguji attempt yang berwenang
        IF v_user.role = 'teacher' AND v_existing_attempt.examiner_user_id != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi ujian ini.');
        END IF;

        v_attempt_id := v_existing_attempt.id;
    ELSE
        -- Buat attempt baru: BINDING EXAMINER_USER_ID WAJIB DARI v_assignment, BUKAN v_user.id
        v_attempt_id := 'att_uas_' || p_period_id || '_' || p_student_id || '_a1';
        
        INSERT INTO exam_attempts (
            id, exam_period_id, student_id, question_set_id, examiner_user_id,
            attempt_number, status, started_at, last_saved_at, total_score, created_at, updated_at
        ) VALUES (
            v_attempt_id, p_period_id, p_student_id, v_question_set.id, v_assignment.examiner_user_id,
            1, 'in_progress', now(), now(), 0, now(), now()
        );

        -- Inisialisasi 9 butir assessment:
        -- Soal Wajib (1..2): Max 15 (Kelancaran 9, Tajwid 3, Makhraj 3)
        -- Soal Acak (3..9): Max 10 (Kelancaran 6, Tajwid 2, Makhraj 2)
        -- completed_at WAJIB NULL!
        FOR v_q IN 
            SELECT * FROM exam_questions 
            WHERE question_set_id = v_question_set.id 
            ORDER BY question_number ASC
        LOOP
            IF v_q.question_role = 'mandatory' THEN
                INSERT INTO exam_question_assessments (
                    id, exam_attempt_id, exam_question_id, question_number,
                    fluency_score, tajwid_score, makhraj_score,
                    fluency_events, tajwid_events, makhraj_events,
                    question_score, notes, started_at, completed_at, updated_at, version
                ) VALUES (
                    'aqa_' || v_attempt_id || '_q' || v_q.question_number,
                    v_attempt_id, v_q.id, v_q.question_number,
                    9.00, 3.00, 3.00,
                    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                    15.00, '', now(), NULL, now(), 1
                );
            ELSE
                INSERT INTO exam_question_assessments (
                    id, exam_attempt_id, exam_question_id, question_number,
                    fluency_score, tajwid_score, makhraj_score,
                    fluency_events, tajwid_events, makhraj_events,
                    question_score, notes, started_at, completed_at, updated_at, version
                ) VALUES (
                    'aqa_' || v_attempt_id || '_q' || v_q.question_number,
                    v_attempt_id, v_q.id, v_q.question_number,
                    6.00, 2.00, 2.00,
                    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                    10.00, '', now(), NULL, now(), 1
                );
            END IF;
        END LOOP;

        -- Audit log kanonikal
        INSERT INTO exam_audit_logs (
            id, exam_period_id, student_id, action, actor_id,
            before_data, after_data, reason, created_at
        ) VALUES (
            'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
            p_period_id, p_student_id, 'uas_attempt_started', v_user.id,
            NULL,
            jsonb_build_object(
                'attemptId', v_attempt_id,
                'questionSetId', v_question_set.id,
                'questionSetVersion', v_question_set.version,
                'examinerUserId', v_assignment.examiner_user_id,
                'totalQuestions', 9
            ),
            'Mulai pelaksanaan ujian UAS santri', now()
        );
    END IF;

    -- Ambil data 9 butir soal (tanpa teks quran di database)
    SELECT json_agg(json_build_object(
        'id', q.id,
        'questionNumber', q.question_number,
        'questionRole', q.question_role,
        'zoneNumber', q.zone_number,
        'maxScore', q.max_score,
        'pageNumber', q.page_number,
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

    -- Ambil data 9 butir assessments
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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 3: save_uas_question_assessment
-- Menyimpan penilaian per butir soal UAS dengan server-authoritative scoring
-- Menangani perbedaan batas nilai Soal Wajib (Max 15) vs Soal Acak (Max 10)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS save_uas_question_assessment(TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION save_uas_question_assessment(
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
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 4: get_uas_attempt
-- Mengambil sesi ujian UAS aktif atau riwayat penilaian
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_uas_attempt(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_uas_attempt(
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
    -- 1. Autentikasi Pengguna & Whitelist Role
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    -- Role Whitelist: Hanya Admin dan Teacher yang diizinkan
    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat melihat detail ujian.');
    END IF;

    -- 2. Validasi Attempt
    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian UAS tidak ditemukan.');
    END IF;

    -- Teacher authorization: harus penguji sesi attempt ini
    IF v_user.role = 'teacher' AND v_attempt.examiner_user_id != v_user.id THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang berwenang untuk sesi ini.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_attempt.exam_period_id;
    SELECT * INTO v_student FROM students WHERE id = v_attempt.student_id;

    -- 3. Ambil 9 Butir Soal
    SELECT json_agg(json_build_object(
        'id', q.id,
        'questionNumber', q.question_number,
        'questionRole', q.question_role,
        'zoneNumber', q.zone_number,
        'maxScore', q.max_score,
        'pageNumber', q.page_number,
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

    -- 4. Ambil 9 Butir Assessments
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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 5: submit_uas_attempt
-- Finalisasi nilai UAS dengan validasi 9/9 butir soal completed
-- Rekalkulasi authoritative server-side untuk seluruh 9 butir
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS submit_uas_attempt(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION submit_uas_attempt(
    p_username TEXT,
    p_password TEXT,
    p_attempt_id TEXT
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
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 6: reopen_uas_attempt
-- Pembukaan kembali sesi ujian UAS yang telah disubmit (Admin Only)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS reopen_uas_attempt(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION reopen_uas_attempt(
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
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    -- 2. Otorisasi Admin
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuka kembali (reopen) ujian UAS yang sudah disubmit.');
    END IF;

    -- 3. Validasi Alasan Wajib
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan pembukaan kembali ujian.');
    END IF;

    SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Sesi ujian UAS tidak ditemukan.');
    END IF;

    IF v_attempt.status != 'submitted' THEN
        RETURN json_build_object('success', false, 'message', 'Hanya sesi ujian yang sudah berstatus submitted yang dapat dibuka kembali.');
    END IF;

    -- 4. Kembalikan status attempt ke in_progress
    UPDATE exam_attempts SET
        status = 'in_progress',
        updated_at = now()
    WHERE id = p_attempt_id;

    -- Kembalikan status assignment ke assigned
    UPDATE exam_examiner_assignments SET
        status = 'assigned',
        updated_at = now()
    WHERE exam_period_id = v_attempt.exam_period_id AND student_id = v_attempt.student_id;

    -- 5. Audit Log Kanonikal
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_attempt.exam_period_id, v_attempt.student_id, 'uas_exam_reopened', v_user.id,
        jsonb_build_object('attemptId', p_attempt_id, 'oldStatus', 'submitted', 'score', v_attempt.total_score),
        jsonb_build_object('attemptId', p_attempt_id, 'newStatus', 'in_progress'),
        p_reason, now()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Ujian UAS berhasil dibuka kembali untuk koreksi nilai.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;


-- ------------------------------------------------------------
-- RPC 7: assign_examiner_secure
-- Penugasan & Reassignment Penguji (Admin Only)
-- Mendukung UTS & UAS dengan Lifecycle Guard Ketat:
-- - Reassignment sebelum ujian dimulai: Bebas
-- - Reassignment saat in_progress: Wajib alasan audit, sinkronisasi assignment & attempt
-- - Reassignment saat submitted: DITOLAK (Wajib reopen dahulu)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS assign_examiner_secure(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
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
    v_old_assignment RECORD;
    v_action TEXT := 'examiner_assigned';
    v_attempt_status TEXT := 'no_attempt';
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
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

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
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

    -- 6. Cek jika santri sudah submitted: DITOLAK
    SELECT * INTO v_existing_attempt FROM exam_attempts 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'submitted';
    IF FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Tidak dapat mengubah penguji: Ujian santri ini sudah diselesaikan (submitted).');
    END IF;

    -- 7. Cek jika sesi sedang in_progress: Wajib alasan reassignment
    SELECT * INTO v_existing_attempt FROM exam_attempts 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'in_progress';
    IF FOUND THEN
        IF p_reason IS NULL OR trim(p_reason) = '' THEN
            RETURN json_build_object('success', false, 'message', 'Sesi ujian santri sedang berjalan (in_progress). Wajib mencantumkan alasan pengalihan/penggantian penguji.');
        END IF;
        v_action := 'examiner_reassigned';
        v_attempt_status := 'in_progress';
    END IF;

    SELECT * INTO v_old_assignment FROM exam_examiner_assignments 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;

    v_assignment_id := 'eea_' || p_period_id || '_' || p_student_id;

    -- 8. Upsert Assignment
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

    -- Jika ada attempt in_progress, update examiner_user_id pada attempt secara konsisten
    UPDATE exam_attempts 
    SET examiner_user_id = p_examiner_id, updated_at = now()
    WHERE exam_period_id = p_period_id AND student_id = p_student_id AND status = 'in_progress';

    -- Audit Log Kanonikal
    INSERT INTO exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id, p_student_id, v_action, v_user.id,
        jsonb_build_object(
            'oldExaminerId', v_old_assignment.examiner_user_id,
            'attemptStatus', v_attempt_status
        ),
        jsonb_build_object(
            'newExaminerId', p_examiner_id, 
            'examinerName', v_examiner.name,
            'attemptStatus', v_attempt_status
        ),
        COALESCE(p_reason, 'Penugasan penguji ujian santri'), now()
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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;
