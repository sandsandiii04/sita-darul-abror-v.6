-- =========================================================================
-- MIGRATION: DEFAULT EXAMINER (PENGUJI DEFAULT GURU HALAQAH) FOR UTS & UAS
-- =========================================================================
-- Memastikan seluruh santri langsung tampil dan dapat diuji oleh guru halaqahnya
-- masing-masing secara otomatis tanpa harus menunggu penugasan manual dari admin.
-- Jika admin kemudian menugaskan penguji silang secara manual, penugasan eksplisit
-- tersebut akan diprioritaskan.
-- =========================================================================

-- 1. FIX: get_examiner_uts_students
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

    -- Query peserta:
    -- Admin melihat semua santri.
    -- Penguji melihat santri yang eksplisit ditugaskan kepadanya ATAU
    -- santri halaqahnya sendiri jika belum ada penguji lain yang ditugaskan secara eksplisit.
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. FIX: start_uts_attempt (Izinkan guru halaqah default jika belum di-assign spesifik)
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

    -- 4. Validasi Penugasan Penguji: Explicit Assignment ATAU Default Guru Halaqah
    SELECT * INTO v_assignment FROM exam_examiner_assignments 
    WHERE exam_period_id = p_period_id AND student_id = p_student_id;
    
    IF FOUND THEN
        IF v_user.role = 'teacher' AND v_assignment.examiner_user_id != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk santri ini.');
        END IF;
    ELSE
        -- Default ke guru halaqah
        IF v_user.role = 'teacher' AND v_participant.teacher_id_snapshot != v_user.id AND (SELECT teacher_id FROM students WHERE id = p_student_id) != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda bukan guru halaqah santri ini dan belum ditugaskan sebagai penguji.');
        END IF;

        -- Auto create assignment agar tercatat resmi
        INSERT INTO exam_examiner_assignments (
            id, exam_period_id, student_id, examiner_user_id, status, assigned_by, assigned_at, created_at, updated_at
        ) VALUES (
            'eea_' || p_period_id || '_' || p_student_id,
            p_period_id, p_student_id, v_user.id, 'active', v_user.id, now(), now(), now()
        ) ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
            examiner_user_id = EXCLUDED.examiner_user_id,
            updated_at = now();
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

    -- IDEMPOTENCY CHECK
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

        -- Inisialisasi 5 assessment: Default score 20, completed_at = NULL
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
                12, 4, 4,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                20, '', now(), NULL, now(), 1
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

    -- Ambil data assessments
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. FIX: get_examiner_uas_students
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. FIX: start_uas_attempt
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
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

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
            p_period_id, p_student_id, v_user.id, 'active', v_user.id, now(), now(), now()
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. GRANTS
GRANT EXECUTE ON FUNCTION get_examiner_uts_students(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION start_uts_attempt(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_examiner_uas_students(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION start_uas_attempt(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
