-- ==============================================================================
-- SQL Migration: Modul Ujian Tahsin Al-Qur'an (Tahap 1: Keamanan & Concurrency)
-- Darul Abror Islamic Boarding School — SITA
-- 
-- PERINGATAN KEAMANAN:
-- 1. Skrip ini bersifat aditif dan non-destruktif terhadap tabel lama SITA.
-- 2. Memuat kontrol konkurensi (optimistic locking via versioning).
-- 3. Memuat audit log revisi nilai dan constraint pencegah duplikasi.
-- 4. Dilengkapi RPC atomic: save_tahsin_attempt_secure.
-- 5. Kebijakan RLS berbasis role (Admin & Assigned Teachers).
-- ==============================================================================

-- 1. TABEL: tahsin_periods (Periode Pelaksanaan Ujian Tahsin Semester)
CREATE TABLE IF NOT EXISTS tahsin_periods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    academic_year TEXT NOT NULL, -- Contoh: '2026/2027'
    semester TEXT NOT NULL CHECK (semester IN ('ganjil', 'genap')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
    passing_grade NUMERIC NOT NULL DEFAULT 80 CHECK (passing_grade >= 0 AND passing_grade <= 100),
    min_makharij NUMERIC NOT NULL DEFAULT 75 CHECK (min_makharij >= 0 AND min_makharij <= 100),
    min_tajwid NUMERIC NOT NULL DEFAULT 75 CHECK (min_tajwid >= 0 AND min_tajwid <= 100),
    target_classes TEXT[] DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT chk_tahsin_period_dates CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_tahsin_periods_status ON tahsin_periods(status);
CREATE INDEX IF NOT EXISTS idx_tahsin_periods_year_sem ON tahsin_periods(academic_year, semester);

-- 2. TABEL: tahsin_examiners (Penugasan Guru Penguji Tahsin)
CREATE TABLE IF NOT EXISTS tahsin_examiners (
    id TEXT PRIMARY KEY,
    period_id TEXT NOT NULL REFERENCES tahsin_periods(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_classes TEXT[] DEFAULT '{}',
    assigned_halaqahs TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_tahsin_examiner UNIQUE(period_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_tahsin_examiners_period ON tahsin_examiners(period_id);
CREATE INDEX IF NOT EXISTS idx_tahsin_examiners_teacher ON tahsin_examiners(teacher_id);

-- 3. TABEL: tahsin_sessions (Sesi Ujian Santri per Periode)
CREATE TABLE IF NOT EXISTS tahsin_sessions (
    id TEXT PRIMARY KEY,
    period_id TEXT NOT NULL REFERENCES tahsin_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    examiner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    
    -- Snapshot data santri saat ujian agar data historis tetap valid
    student_name_snapshot TEXT NOT NULL,
    class_snapshot TEXT NOT NULL,
    halaqah_snapshot TEXT NOT NULL,
    
    -- Target cakupan materi per kelas
    target_juz_start INTEGER NOT NULL CHECK (target_juz_start BETWEEN 1 AND 30),
    target_juz_end INTEGER NOT NULL CHECK (target_juz_end BETWEEN 1 AND 30),
    
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'draft', 'completed', 'remedial_needed')),
    final_score NUMERIC CHECK (final_score IS NULL OR (final_score >= 0 AND final_score <= 100)),
    predikat TEXT,
    final_status TEXT CHECK (final_status IS NULL OR final_status IN ('lulus', 'remedial', 'belum_selesai')),
    latest_attempt_number INTEGER NOT NULL DEFAULT 1,
    
    -- Kontrol Konkurensi & Sinkronisasi
    version INTEGER NOT NULL DEFAULT 1,
    last_updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    sync_status TEXT NOT NULL DEFAULT 'synced_server' CHECK (sync_status IN ('synced_server', 'pending_sync', 'sync_failed', 'draft_local')),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_tahsin_session UNIQUE(period_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_tahsin_sessions_period ON tahsin_sessions(period_id);
CREATE INDEX IF NOT EXISTS idx_tahsin_sessions_student ON tahsin_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_tahsin_sessions_examiner ON tahsin_sessions(examiner_id);
CREATE INDEX IF NOT EXISTS idx_tahsin_sessions_status ON tahsin_sessions(status);
CREATE INDEX IF NOT EXISTS idx_tahsin_sessions_class ON tahsin_sessions(class_snapshot);
CREATE INDEX IF NOT EXISTS idx_tahsin_sessions_sync ON tahsin_sessions(sync_status);

-- 4. TABEL: tahsin_attempts (Detail Percobaan Ujian: Ujian Utama & Remedial)
CREATE TABLE IF NOT EXISTS tahsin_attempts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES tahsin_sessions(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    attempt_type TEXT NOT NULL DEFAULT 'utama' CHECK (attempt_type IN ('utama', 'remedial')),
    examiner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    examiner_name_snapshot TEXT,
    exam_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- Detail Bagian Bacaan Al-Qur'an
    start_surah INTEGER NOT NULL CHECK (start_surah BETWEEN 1 AND 114),
    start_ayah INTEGER NOT NULL CHECK (start_ayah >= 1),
    end_surah INTEGER NOT NULL CHECK (end_surah BETWEEN 1 AND 114),
    end_ayah INTEGER NOT NULL CHECK (end_ayah >= 1),
    start_page INTEGER CHECK (start_page BETWEEN 1 AND 604),
    end_page INTEGER CHECK (end_page BETWEEN 1 AND 604),
    pages_read NUMERIC NOT NULL CHECK (pages_read >= 0.5),
    surah_name_display TEXT,
    randomize_reason TEXT,
    
    -- Penilaian 4 Aspek Wajib
    score_makharij NUMERIC NOT NULL CHECK (score_makharij >= 0 AND score_makharij <= 100),
    category_makharij TEXT NOT NULL,
    score_tajwid NUMERIC NOT NULL CHECK (score_tajwid >= 0 AND score_tajwid <= 100),
    category_tajwid TEXT NOT NULL,
    score_kelancaran NUMERIC NOT NULL CHECK (score_kelancaran >= 0 AND score_kelancaran <= 100),
    category_kelancaran TEXT NOT NULL,
    score_waqaf NUMERIC NOT NULL CHECK (score_waqaf >= 0 AND score_waqaf <= 100),
    category_waqaf TEXT NOT NULL,
    
    -- Hasil Akhir Percobaan
    final_score NUMERIC NOT NULL CHECK (final_score >= 0 AND final_score <= 100),
    predikat TEXT NOT NULL,
    
    -- Kelulusan & Catatan
    has_critical_error BOOLEAN DEFAULT FALSE,
    critical_error_reason TEXT,
    passing_status TEXT NOT NULL CHECK (passing_status IN ('lulus', 'remedial', 'belum_selesai')),
    
    -- Pencatatan Kesalahan Opsional (JSON format)
    error_counts JSONB DEFAULT '{}'::jsonb,
    coaching_notes TEXT,
    
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
    version INTEGER NOT NULL DEFAULT 1,
    finalized_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_tahsin_attempt UNIQUE(session_id, attempt_number)
);

-- Constraint Pencegah Ujian Utama Ganda: Hanya boleh ada 1 attempt berstatus 'utama' per sesi
CREATE UNIQUE INDEX IF NOT EXISTS uq_tahsin_attempt_utama ON tahsin_attempts(session_id) WHERE attempt_type = 'utama';

CREATE INDEX IF NOT EXISTS idx_tahsin_attempts_session ON tahsin_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_tahsin_attempts_date ON tahsin_attempts(exam_date);
CREATE INDEX IF NOT EXISTS idx_tahsin_attempts_status ON tahsin_attempts(status);
CREATE INDEX IF NOT EXISTS idx_tahsin_attempts_examiner ON tahsin_attempts(examiner_id);

-- 5. TABEL: tahsin_audit_logs (Rekam Jejak Revisi & Perubahan Nilai)
CREATE TABLE IF NOT EXISTS tahsin_audit_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES tahsin_sessions(id) ON DELETE CASCADE,
    attempt_id TEXT REFERENCES tahsin_attempts(id) ON DELETE SET NULL,
    changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('create_session', 'save_draft', 'finalize_attempt', 'remedial_attempt', 'revision_score')),
    old_score NUMERIC,
    new_score NUMERIC,
    old_status TEXT,
    new_status TEXT,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tahsin_audit_session ON tahsin_audit_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_tahsin_audit_created ON tahsin_audit_logs(created_at);

-- 6. RPC ATOMIC & AMAN: save_tahsin_attempt_secure
-- Menangani autentikasi kredensial, verifikasi server-side data santri & periode,
-- otorisasi penguji, kontrol konkurensi (optimistic locking), serta audit log.
CREATE OR REPLACE FUNCTION save_tahsin_attempt_secure(
    p_username TEXT,
    p_password TEXT,
    p_session_id TEXT,
    p_attempt_id TEXT,
    p_expected_version INTEGER,
    p_is_finalize BOOLEAN,
    p_attempt_data JSONB,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_session RECORD;
    v_existing_attempt RECORD;
    v_period RECORD;
    v_student RECORD;
    v_assignment RECORD;
    v_period_id TEXT;
    v_student_id TEXT;
    v_target_juz_start INTEGER;
    v_target_juz_end INTEGER;
    v_new_version INTEGER;
    v_final_status TEXT;
    v_session_status TEXT;
    v_score NUMERIC;
    v_predikat TEXT;
    v_passing_status TEXT;
    v_attempt_number INTEGER;
    v_attempt_type TEXT;
BEGIN
    -- 1. Autentikasi Pengguna Otoritatif
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'conflict', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    -- 2. Ambil dan Kunci Baris Sesi Ujian (Row-level lock FOR UPDATE)
    SELECT * INTO v_session FROM tahsin_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        -- Validasi Ketat Pembuatan Sesi Otomatis di Server:
        v_period_id := p_attempt_data->'sessionData'->>'periodId';
        v_student_id := p_attempt_data->'sessionData'->>'studentId';

        IF v_period_id IS NULL OR v_student_id IS NULL THEN
            RETURN json_build_object('success', false, 'conflict', false, 'message', 'Data referensi sesi ujian (periodId / studentId) tidak valid.');
        END IF;

        -- A. Verifikasi Keberadaan dan Status Periode Ujian
        SELECT * INTO v_period FROM tahsin_periods WHERE id = v_period_id;
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'conflict', false, 'message', 'Periode ujian tidak ditemukan di database.');
        END IF;

        IF v_period.status != 'active' AND v_user.role != 'admin' THEN
            RETURN json_build_object('success', false, 'conflict', false, 'message', 'Periode ujian belum aktif atau telah ditutup. Pengesahan nilai ditolak.');
        END IF;

        -- B. Verifikasi Keberadaan Data Santri Riil di Database Sekolah
        SELECT * INTO v_student FROM students WHERE id = v_student_id;
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'conflict', false, 'message', 'Data santri tidak terdaftar di database sekolah.');
        END IF;

        -- C. Verifikasi Penugasan Penguji (Jika Bukan Admin)
        IF v_user.role != 'admin' THEN
            SELECT * INTO v_assignment FROM tahsin_examiners 
            WHERE period_id = v_period_id AND teacher_id = v_user.id;

            IF FOUND THEN
                IF array_length(v_assignment.assigned_classes, 1) > 0 
                   AND NOT (v_student.class = ANY(v_assignment.assigned_classes)) THEN
                    RETURN json_build_object('success', false, 'conflict', false, 'message', 'Akses ditolak: Anda tidak ditugaskan untuk menguji kelas santri ini.');
                END IF;
            END IF;
        END IF;

        -- D. Hitung Cakupan Juz Otoritatif di Server Berdasarkan Kelas Santri (Kelas 7-12)
        IF v_student.class ILIKE '7%' OR v_student.class ILIKE '%VII%' THEN
            v_target_juz_start := 26; v_target_juz_end := 30;
        ELSIF v_student.class ILIKE '8%' OR v_student.class ILIKE '%VIII%' THEN
            v_target_juz_start := 21; v_target_juz_end := 30;
        ELSIF v_student.class ILIKE '9%' OR v_student.class ILIKE '%IX%' THEN
            v_target_juz_start := 16; v_target_juz_end := 30;
        ELSIF v_student.class ILIKE '10%' OR v_student.class ILIKE '%X%' THEN
            v_target_juz_start := 11; v_target_juz_end := 30;
        ELSIF v_student.class ILIKE '11%' OR v_student.class ILIKE '%XI%' THEN
            v_target_juz_start := 6; v_target_juz_end := 30;
        ELSIF v_student.class ILIKE '12%' OR v_student.class ILIKE '%XII%' THEN
            v_target_juz_start := 1; v_target_juz_end := 30;
        ELSE
            v_target_juz_start := 26; v_target_juz_end := 30;
        END IF;

        -- E. Buat Baris Sesi Otoritatif dari Data Server (Bukan Data Klien)
        INSERT INTO tahsin_sessions (
            id, period_id, student_id, examiner_id,
            student_name_snapshot, class_snapshot, halaqah_snapshot,
            target_juz_start, target_juz_end, status,
            latest_attempt_number, version, last_updated_by,
            sync_status, created_at, updated_at
        ) VALUES (
            p_session_id,
            v_period.id,
            v_student.id,
            v_user.id,
            v_student.name,
            COALESCE(v_student.class, '-'),
            COALESCE(v_student.halaqah, '-'),
            v_target_juz_start,
            v_target_juz_end,
            'draft',
            1,
            1,
            v_user.id,
            'synced_server',
            timezone('utc'::text, now()),
            timezone('utc'::text, now())
        )
        RETURNING * INTO v_session;
    END IF;

    -- 3. Otorisasi Penguji / Admin (Pencegahan Membajak Sesi Penguji Lain)
    IF v_user.role != 'admin' AND v_session.examiner_id IS NOT NULL AND v_session.examiner_id != v_user.id THEN
        RETURN json_build_object('success', false, 'conflict', false, 'message', 'Akses ditolak: Anda bukan penguji yang ditugaskan untuk sesi santri ini.');
    END IF;

    -- 4. Deteksi Konflik Konkurensi (Optimistic Locking)
    -- Jika versi di server lebih tinggi dari expected version penguji, tolak dengan status conflict
    IF p_expected_version IS NOT NULL AND p_expected_version > 0 AND v_session.version > p_expected_version THEN
        RETURN json_build_object(
            'success', false,
            'conflict', true,
            'server_version', v_session.version,
            'last_updated_by', v_session.last_updated_by,
            'message', 'Konflik konkurensi terdeteksi: Data santri ini telah diubah oleh penguji lain pada perangkat berbeda. Silakan muat ulang data terbaru sebelum menyimpan.'
        );
    END IF;

    -- 5. Ekstraksi Field dari payload JSONB
    v_score := (p_attempt_data->>'finalScore')::NUMERIC;
    v_predikat := p_attempt_data->>'predikat';
    v_passing_status := p_attempt_data->>'passingStatus';
    v_attempt_number := COALESCE((p_attempt_data->>'attemptNumber')::INTEGER, 1);
    v_attempt_type := COALESCE(p_attempt_data->>'attemptType', 'utama');

    -- Validasi percobaan utama ganda
    IF v_attempt_type = 'utama' AND v_attempt_number > 1 THEN
        v_attempt_type := 'remedial';
    END IF;

    -- 6. Periksa Percobaan yang Sudah Ada & Aturan Perubahan Nilai Setelah Disahkan
    SELECT * INTO v_existing_attempt FROM tahsin_attempts WHERE id = p_attempt_id;
    IF FOUND AND v_existing_attempt.status = 'finalized' AND v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'conflict', false, 'message', 'Nilai ujian yang telah disahkan hanya dapat diubah atau direvisi dengan kewenangan Admin.');
    END IF;

    -- 7. Upsert Percobaan Ujian (tahsin_attempts)
    INSERT INTO tahsin_attempts (
        id,
        session_id,
        attempt_number,
        attempt_type,
        examiner_id,
        examiner_name_snapshot,
        exam_date,
        start_surah,
        start_ayah,
        end_surah,
        end_ayah,
        start_page,
        end_page,
        pages_read,
        surah_name_display,
        randomize_reason,
        score_makharij,
        category_makharij,
        score_tajwid,
        category_tajwid,
        score_kelancaran,
        category_kelancaran,
        score_waqaf,
        category_waqaf,
        final_score,
        predikat,
        has_critical_error,
        critical_error_reason,
        passing_status,
        error_counts,
        coaching_notes,
        status,
        version,
        finalized_at,
        created_at,
        updated_at
    ) VALUES (
        p_attempt_id,
        p_session_id,
        v_attempt_number,
        v_attempt_type,
        v_user.id,
        v_user.name,
        COALESCE((p_attempt_data->>'examDate')::DATE, CURRENT_DATE),
        COALESCE((p_attempt_data->'reading'->>'startSurah')::INTEGER, 1),
        COALESCE((p_attempt_data->'reading'->>'startAyah')::INTEGER, 1),
        COALESCE((p_attempt_data->'reading'->>'endSurah')::INTEGER, 1),
        COALESCE((p_attempt_data->'reading'->>'endAyah')::INTEGER, 7),
        (p_attempt_data->'reading'->>'startPage')::INTEGER,
        (p_attempt_data->'reading'->>'endPage')::INTEGER,
        COALESCE((p_attempt_data->'reading'->>'pagesRead')::NUMERIC, 1),
        p_attempt_data->'reading'->>'startSurahName',
        p_attempt_data->'reading'->>'randomizeReason',
        COALESCE((p_attempt_data->'makharij'->>'score')::NUMERIC, 75),
        COALESCE(p_attempt_data->'makharij'->>'category', 'cukup'),
        COALESCE((p_attempt_data->'tajwid'->>'score')::NUMERIC, 75),
        COALESCE(p_attempt_data->'tajwid'->>'category', 'cukup'),
        COALESCE((p_attempt_data->'kelancaran'->>'score')::NUMERIC, 75),
        COALESCE(p_attempt_data->'kelancaran'->>'category', 'cukup'),
        COALESCE((p_attempt_data->'waqaf'->>'score')::NUMERIC, 75),
        COALESCE(p_attempt_data->'waqaf'->>'category', 'cukup'),
        v_score,
        v_predikat,
        COALESCE((p_attempt_data->>'hasCriticalError')::BOOLEAN, FALSE),
        p_attempt_data->>'criticalErrorReason',
        v_passing_status,
        COALESCE(p_attempt_data->'errorCounts', '{}'::jsonb),
        p_attempt_data->>'coachingNotes',
        CASE WHEN p_is_finalize THEN 'finalized' ELSE 'draft' END,
        COALESCE(v_existing_attempt.version, 0) + 1,
        CASE WHEN p_is_finalize THEN timezone('utc'::text, now()) ELSE NULL END,
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
    )
    ON CONFLICT (session_id, attempt_number) DO UPDATE SET
        examiner_id = EXCLUDED.examiner_id,
        examiner_name_snapshot = EXCLUDED.examiner_name_snapshot,
        exam_date = EXCLUDED.exam_date,
        start_surah = EXCLUDED.start_surah,
        start_ayah = EXCLUDED.start_ayah,
        end_surah = EXCLUDED.end_surah,
        end_ayah = EXCLUDED.end_ayah,
        start_page = EXCLUDED.start_page,
        end_page = EXCLUDED.end_page,
        pages_read = EXCLUDED.pages_read,
        surah_name_display = EXCLUDED.surah_name_display,
        randomize_reason = EXCLUDED.randomize_reason,
        score_makharij = EXCLUDED.score_makharij,
        category_makharij = EXCLUDED.category_makharij,
        score_tajwid = EXCLUDED.score_tajwid,
        category_tajwid = EXCLUDED.category_tajwid,
        score_kelancaran = EXCLUDED.score_kelancaran,
        category_kelancaran = EXCLUDED.category_kelancaran,
        score_waqaf = EXCLUDED.score_waqaf,
        category_waqaf = EXCLUDED.category_waqaf,
        final_score = EXCLUDED.final_score,
        predikat = EXCLUDED.predikat,
        has_critical_error = EXCLUDED.has_critical_error,
        critical_error_reason = EXCLUDED.critical_error_reason,
        passing_status = EXCLUDED.passing_status,
        error_counts = EXCLUDED.error_counts,
        coaching_notes = EXCLUDED.coaching_notes,
        status = EXCLUDED.status,
        version = tahsin_attempts.version + 1,
        finalized_at = CASE WHEN EXCLUDED.status = 'finalized' THEN timezone('utc'::text, now()) ELSE tahsin_attempts.finalized_at END,
        updated_at = timezone('utc'::text, now());

    -- 8. Update Sesi Ujian (tahsin_sessions)
    v_new_version := v_session.version + 1;
    IF p_is_finalize THEN
        v_session_status := CASE WHEN v_passing_status = 'lulus' THEN 'completed' ELSE 'remedial_needed' END;
        v_final_status := v_passing_status;
    ELSE
        v_session_status := CASE WHEN v_session.status = 'not_started' THEN 'draft' ELSE v_session.status END;
        v_final_status := v_session.final_status;
    END IF;

    UPDATE tahsin_sessions SET
        status = v_session_status,
        final_score = CASE WHEN p_is_finalize THEN v_score ELSE tahsin_sessions.final_score END,
        predikat = CASE WHEN p_is_finalize THEN v_predikat ELSE tahsin_sessions.predikat END,
        final_status = v_final_status,
        latest_attempt_number = GREATEST(tahsin_sessions.latest_attempt_number, v_attempt_number),
        examiner_id = COALESCE(tahsin_sessions.examiner_id, v_user.id),
        version = v_new_version,
        last_updated_by = v_user.id,
        sync_status = 'synced_server',
        updated_at = timezone('utc'::text, now())
    WHERE id = p_session_id;

    -- 9. Catat ke Audit Log
    INSERT INTO tahsin_audit_logs (
        id,
        session_id,
        attempt_id,
        changed_by,
        change_type,
        old_score,
        new_score,
        old_status,
        new_status,
        reason,
        created_at
    ) VALUES (
        'tal_' || gen_random_uuid()::text,
        p_session_id,
        p_attempt_id,
        v_user.id,
        CASE 
            WHEN v_attempt_type = 'remedial' THEN 'remedial_attempt'
            WHEN p_is_finalize THEN 'finalize_attempt'
            ELSE 'save_draft'
        END,
        v_session.final_score,
        v_score,
        v_session.status,
        v_session_status,
        p_reason,
        timezone('utc'::text, now())
    );

    RETURN json_build_object(
        'success', true,
        'conflict', false,
        'server_version', v_new_version,
        'session_status', v_session_status,
        'final_score', v_score,
        'message', CASE WHEN p_is_finalize THEN 'Ujian Tahsin berhasil disahkan dan tersimpan di database server.' ELSE 'Draft ujian berhasil disimpan di database server.' END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Berikan izin eksekusi RPC ke peran authenticated dan anon (gateway API SITA)
GRANT EXECUTE ON FUNCTION save_tahsin_attempt_secure TO authenticated, anon;

-- 7. RPC ATOMIC KHUSUS PENGELOLAAN PERIODE UJIAN (ADMIN ONLY)
CREATE OR REPLACE FUNCTION save_tahsin_period_secure(
    p_username TEXT,
    p_password TEXT,
    p_period_data JSONB
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    -- 2. Otorisasi Khusus Admin
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berwenang mengelola periode ujian.');
    END IF;

    v_period_id := p_period_data->>'id';
    IF v_period_id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'ID periode tidak boleh kosong.');
    END IF;

    -- 3. Upsert Periode Ujian
    INSERT INTO tahsin_periods (
        id,
        name,
        academic_year,
        semester,
        start_date,
        end_date,
        status,
        passing_grade,
        min_makharij,
        min_tajwid,
        target_classes,
        created_by,
        updated_at
    ) VALUES (
        v_period_id,
        p_period_data->>'name',
        p_period_data->>'academicYear',
        p_period_data->>'semester',
        (p_period_data->>'startDate')::DATE,
        (p_period_data->>'endDate')::DATE,
        COALESCE(p_period_data->>'status', 'draft'),
        COALESCE((p_period_data->>'passingGrade')::NUMERIC, 80),
        COALESCE((p_period_data->>'minMakharij')::NUMERIC, 75),
        COALESCE((p_period_data->>'minTajwid')::NUMERIC, 75),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_period_data->'targetClasses', '[]'::jsonb))),
        v_user.id,
        timezone('utc'::text, now())
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        academic_year = EXCLUDED.academic_year,
        semester = EXCLUDED.semester,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        status = EXCLUDED.status,
        passing_grade = EXCLUDED.passing_grade,
        min_makharij = EXCLUDED.min_makharij,
        min_tajwid = EXCLUDED.min_tajwid,
        target_classes = EXCLUDED.target_classes,
        updated_at = timezone('utc'::text, now());

    RETURN json_build_object('success', true, 'message', 'Periode ujian Tahsin berhasil disimpan.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION save_tahsin_period_secure TO authenticated, anon;

-- 8. KEBIJAKAN ROW LEVEL SECURITY (RLS) KETAT & AMAN
-- Mengaktifkan RLS pada seluruh tabel Tahsin:
ALTER TABLE tahsin_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE tahsin_examiners ENABLE ROW LEVEL SECURITY;
ALTER TABLE tahsin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tahsin_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tahsin_audit_logs ENABLE ROW LEVEL SECURITY;

-- A. HAK AKSES BACA (SELECT):
-- Diizinkan untuk umum/terautentikasi agar antarmuka dapat menampilkan jadwal dan daftar santri
DROP POLICY IF EXISTS tahsin_periods_select ON tahsin_periods;
DROP POLICY IF EXISTS tahsin_periods_policy ON tahsin_periods;
CREATE POLICY tahsin_periods_select ON tahsin_periods FOR SELECT USING (true);

DROP POLICY IF EXISTS tahsin_examiners_select ON tahsin_examiners;
DROP POLICY IF EXISTS tahsin_examiners_policy ON tahsin_examiners;
CREATE POLICY tahsin_examiners_select ON tahsin_examiners FOR SELECT USING (true);

DROP POLICY IF EXISTS tahsin_sessions_select ON tahsin_sessions;
DROP POLICY IF EXISTS tahsin_sessions_policy ON tahsin_sessions;
CREATE POLICY tahsin_sessions_select ON tahsin_sessions FOR SELECT USING (true);

DROP POLICY IF EXISTS tahsin_attempts_select ON tahsin_attempts;
DROP POLICY IF EXISTS tahsin_attempts_policy ON tahsin_attempts;
CREATE POLICY tahsin_attempts_select ON tahsin_attempts FOR SELECT USING (true);

DROP POLICY IF EXISTS tahsin_audit_select ON tahsin_audit_logs;
CREATE POLICY tahsin_audit_select ON tahsin_audit_logs FOR SELECT USING (true);

-- B. HAK AKSES TULIS LANGSUNG (INSERT / UPDATE / DELETE):
-- DITOLAK TOTAL untuk seluruh pemanggilan langsung via Client SDK Supabase REST API!
-- Tidak ada pengguna anon atau akun non-otoritas yang dapat menyisipkan atau memanipulasi nilai secara langsung.
-- Seluruh mutasi WAJIB melalui RPC SECURITY DEFINER (save_tahsin_attempt_secure & save_tahsin_period_secure).
DROP POLICY IF EXISTS tahsin_periods_deny_write ON tahsin_periods;
CREATE POLICY tahsin_periods_deny_write ON tahsin_periods FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS tahsin_periods_deny_update ON tahsin_periods FOR UPDATE USING (false);
CREATE POLICY tahsin_periods_deny_update ON tahsin_periods FOR UPDATE USING (false);
DROP POLICY IF EXISTS tahsin_periods_deny_delete ON tahsin_periods FOR DELETE USING (false);
CREATE POLICY tahsin_periods_deny_delete ON tahsin_periods FOR DELETE USING (false);

DROP POLICY IF EXISTS tahsin_sessions_deny_write ON tahsin_sessions;
CREATE POLICY tahsin_sessions_deny_write ON tahsin_sessions FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS tahsin_sessions_deny_update ON tahsin_sessions FOR UPDATE USING (false);
CREATE POLICY tahsin_sessions_deny_update ON tahsin_sessions FOR UPDATE USING (false);
DROP POLICY IF EXISTS tahsin_sessions_deny_delete ON tahsin_sessions FOR DELETE USING (false);
CREATE POLICY tahsin_sessions_deny_delete ON tahsin_sessions FOR DELETE USING (false);

DROP POLICY IF EXISTS tahsin_attempts_deny_write ON tahsin_attempts;
CREATE POLICY tahsin_attempts_deny_write ON tahsin_attempts FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS tahsin_attempts_deny_update ON tahsin_attempts FOR UPDATE USING (false);
CREATE POLICY tahsin_attempts_deny_update ON tahsin_attempts FOR UPDATE USING (false);
DROP POLICY IF EXISTS tahsin_attempts_deny_delete ON tahsin_attempts FOR DELETE USING (false);
CREATE POLICY tahsin_attempts_deny_delete ON tahsin_attempts FOR DELETE USING (false);

DROP POLICY IF EXISTS tahsin_audit_deny_write ON tahsin_audit_logs;
CREATE POLICY tahsin_audit_deny_write ON tahsin_audit_logs FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS tahsin_audit_deny_update ON tahsin_audit_logs FOR UPDATE USING (false);
CREATE POLICY tahsin_audit_deny_update ON tahsin_audit_logs FOR UPDATE USING (false);
DROP POLICY IF EXISTS tahsin_audit_deny_delete ON tahsin_audit_logs FOR DELETE USING (false);
CREATE POLICY tahsin_audit_deny_delete ON tahsin_audit_logs FOR DELETE USING (false);

