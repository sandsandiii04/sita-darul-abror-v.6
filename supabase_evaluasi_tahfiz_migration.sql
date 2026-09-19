-- ============================================================
-- SQL Migration: Evaluasi Tahfiz - Periode & Persiapan Materi UTS/UAS
-- Tahap 4: Darul Abror IBS (Non-Destructive Migration)
-- ============================================================

-- 1. TABEL: academic_terms (Tahun Ajaran & Semester)
CREATE TABLE IF NOT EXISTS academic_terms (
    id TEXT PRIMARY KEY,
    academic_year TEXT NOT NULL, -- Contoh: '2026/2027'
    semester TEXT NOT NULL CHECK (semester IN ('ganjil', 'genap')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed')),
    
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT chk_academic_term_dates CHECK (start_date <= end_date)
);

-- Partial unique index: hanya boleh ada satu semester berstatus 'active' pada satu waktu
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_terms_unique_active 
ON academic_terms(status) 
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_academic_terms_year_sem 
ON academic_terms(academic_year, semester);

-- 2. TABEL: exam_periods (Periode Ujian UTS/UAS)
CREATE TABLE IF NOT EXISTS exam_periods (
    id TEXT PRIMARY KEY,
    academic_term_id TEXT NOT NULL REFERENCES academic_terms(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- Contoh: 'UTS Tahfiz Semester Ganjil 2026/2027'
    exam_type TEXT NOT NULL CHECK (exam_type IN ('uts', 'uas')),
    material_cutoff_date DATE NOT NULL,
    exam_start_date DATE,
    exam_end_date DATE,
    kkm NUMERIC NOT NULL DEFAULT 75 CHECK (kkm >= 0 AND kkm <= 100),
    
    target_classes TEXT[] DEFAULT '{}',
    target_halaqahs TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'preparation', 'active', 'completed')),
    
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT chk_exam_period_dates CHECK (
        (exam_start_date IS NULL OR exam_end_date IS NULL) OR (exam_start_date <= exam_end_date)
    )
);

CREATE INDEX IF NOT EXISTS idx_exam_periods_term_id ON exam_periods(academic_term_id);
CREATE INDEX IF NOT EXISTS idx_exam_periods_status ON exam_periods(status);

-- 3. TABEL: exam_participants (Peserta & Snapshot Profil Santri)
CREATE TABLE IF NOT EXISTS exam_participants (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT NOT NULL REFERENCES exam_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    
    -- Snapshot historis agar data ujian tidak berubah bila santri pindah kelas/halaqah kemudian
    student_name_snapshot TEXT NOT NULL,
    class_snapshot TEXT NOT NULL,
    halaqah_snapshot TEXT NOT NULL,
    teacher_id_snapshot TEXT REFERENCES users(id) ON DELETE SET NULL,
    
    status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'exempt', 'completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_exam_participant UNIQUE(exam_period_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_participants_period ON exam_participants(exam_period_id);
CREATE INDEX IF NOT EXISTS idx_exam_participants_student ON exam_participants(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_participants_teacher ON exam_participants(teacher_id_snapshot);

-- 4. TABEL: exam_material_snapshots (Snapshot Batas Materi Ujian Santri)
CREATE TABLE IF NOT EXISTS exam_material_snapshots (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT NOT NULL REFERENCES exam_periods(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    
    source_type TEXT NOT NULL DEFAULT 'automatic' CHECK (source_type IN ('automatic', 'manual_override')),
    
    -- Koordinat Batas Materi
    start_surah INTEGER NOT NULL CHECK (start_surah BETWEEN 1 AND 114),
    start_ayah INTEGER NOT NULL CHECK (start_ayah >= 1),
    end_surah INTEGER NOT NULL CHECK (end_surah BETWEEN 1 AND 114),
    end_ayah INTEGER NOT NULL CHECK (end_ayah >= 1),
    
    start_page INTEGER CHECK (start_page BETWEEN 1 AND 604),
    end_page INTEGER CHECK (end_page BETWEEN 1 AND 604),
    start_juz INTEGER CHECK (start_juz BETWEEN 1 AND 30),
    end_juz INTEGER CHECK (end_juz BETWEEN 1 AND 30),
    estimated_pages NUMERIC DEFAULT 0,
    
    start_surah_name TEXT,
    end_surah_name TEXT,
    
    -- Metadata Analisis
    first_record_date DATE,
    last_record_date DATE,
    total_records_analyzed INTEGER DEFAULT 0,
    memorization_direction TEXT DEFAULT 'forward' CHECK (memorization_direction IN ('forward', 'backward', 'single_surah', 'unknown')),
    
    -- Status Alur Persiapan
    status TEXT NOT NULL DEFAULT 'not_ready' CHECK (status IN ('not_ready', 'needs_review', 'ready', 'finalized')),
    review_reason TEXT,
    
    -- Verifikasi & Finalisasi
    verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    finalized_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    finalized_at TIMESTAMP WITH TIME ZONE,
    override_reason TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_exam_material_snapshot UNIQUE(exam_period_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_material_period ON exam_material_snapshots(exam_period_id);
CREATE INDEX IF NOT EXISTS idx_exam_material_student ON exam_material_snapshots(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_material_status ON exam_material_snapshots(status);

-- 5. TABEL: exam_audit_logs (Audit Trail Evaluasi Tahfiz)
CREATE TABLE IF NOT EXISTS exam_audit_logs (
    id TEXT PRIMARY KEY,
    exam_period_id TEXT,
    student_id TEXT,
    action TEXT NOT NULL, -- 'period_created', 'material_generated', 'material_override', 'material_finalized', 'material_reopened', 'bulk_finalized'
    actor_id TEXT NOT NULL,
    before_data JSONB,
    after_data JSONB,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exam_audit_period_act ON exam_audit_logs(exam_period_id, action);
CREATE INDEX IF NOT EXISTS idx_exam_audit_student ON exam_audit_logs(student_id);

-- 6. RLS: Proteksi Akses Langsung
ALTER TABLE academic_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_material_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS terms_deny_direct_access ON academic_terms;
CREATE POLICY terms_deny_direct_access ON academic_terms FOR ALL USING (false);

DROP POLICY IF EXISTS periods_deny_direct_access ON exam_periods;
CREATE POLICY periods_deny_direct_access ON exam_periods FOR ALL USING (false);

DROP POLICY IF EXISTS participants_deny_direct_access ON exam_participants;
CREATE POLICY participants_deny_direct_access ON exam_participants FOR ALL USING (false);

DROP POLICY IF EXISTS material_deny_direct_access ON exam_material_snapshots;
CREATE POLICY material_deny_direct_access ON exam_material_snapshots FOR ALL USING (false);

DROP POLICY IF EXISTS audit_deny_direct_access ON exam_audit_logs;
CREATE POLICY audit_deny_direct_access ON exam_audit_logs FOR ALL USING (false);


-- ============================================================
-- 7. STORED PROCEDURES (SECURITY DEFINER RPC)
-- ============================================================

-- RPC 1: upsert_academic_term (Admin Only)
CREATE OR REPLACE FUNCTION upsert_academic_term(
    p_username TEXT,
    p_password TEXT,
    p_term JSONB
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_id TEXT;
    v_year TEXT;
    v_sem TEXT;
    v_start DATE;
    v_end DATE;
    v_status TEXT;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengelola Semester.');
    END IF;

    v_id := COALESCE(p_term->>'id', 'term_' || extract(epoch from now())::bigint);
    v_year := p_term->>'academicYear';
    v_sem := p_term->>'semester';
    v_start := (p_term->>'startDate')::DATE;
    v_end := (p_term->>'endDate')::DATE;
    v_status := COALESCE(p_term->>'status', 'draft');

    IF v_start > v_end THEN
        RETURN json_build_object('success', false, 'message', 'Tanggal mulai semester tidak boleh lebih besar dari tanggal selesai.');
    END IF;

    -- Jika diset menjadi 'active', nonaktifkan semester aktif lainnya terlebih dahulu
    IF v_status = 'active' THEN
        UPDATE academic_terms SET status = 'completed', updated_at = now() WHERE status = 'active' AND id != v_id;
    END IF;

    INSERT INTO academic_terms (id, academic_year, semester, start_date, end_date, status, created_by, created_at, updated_at)
    VALUES (v_id, v_year, v_sem, v_start, v_end, v_status, v_user.id, now(), now())
    ON CONFLICT (id) DO UPDATE SET
        academic_year = EXCLUDED.academic_year,
        semester = EXCLUDED.semester,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        status = EXCLUDED.status,
        updated_at = now();

    RETURN json_build_object('success', true, 'id', v_id, 'message', 'Semester berhasil disimpan.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 2: get_academic_terms (Admin / Teacher)
CREATE OR REPLACE FUNCTION get_academic_terms(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_terms JSON;
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
        'id', t.id,
        'academicYear', t.academic_year,
        'semester', t.semester,
        'startDate', t.start_date,
        'endDate', t.end_date,
        'status', t.status,
        'createdBy', t.created_by,
        'createdAt', t.created_at,
        'updatedAt', t.updated_at
    ) ORDER BY t.start_date DESC) INTO v_terms
    FROM academic_terms t;

    RETURN json_build_object('success', true, 'data', COALESCE(v_terms, '[]'::json));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 3: create_exam_period_with_participants (Admin Only, Transaction-Safe)
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

    -- 1. Insert exam_period
    INSERT INTO exam_periods (
        id, academic_term_id, name, exam_type, material_cutoff_date,
        exam_start_date, exam_end_date, kkm, target_classes, target_halaqahs,
        status, created_by, created_at, updated_at
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
                updated_at = now();

            v_count := v_count + 1;
        END LOOP;
    END IF;

    -- 3. Audit log
    INSERT INTO exam_audit_logs (id, exam_period_id, action, actor_id, after_data, reason, created_at)
    VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_period_id,
        'period_created',
        v_user.id,
        jsonb_build_object('name', p_period->>'name', 'participantsCount', v_count),
        'Pembuatan periode evaluasi dan pendaftaran peserta awal',
        now()
    );

    RETURN json_build_object('success', true, 'periodId', v_period_id, 'participantsCount', v_count, 'message', 'Periode ujian dan peserta berhasil disimpan.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 4: save_material_snapshots_batch (Admin Only, Atomic)
CREATE OR REPLACE FUNCTION save_material_snapshots_batch(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT,
    p_snapshots JSONB
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_item JSONB;
    v_count INTEGER := 0;
    v_skipped INTEGER := 0;
    v_existing_status TEXT;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;
    
    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak memperbarui snapshot materi.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_snapshots)
    LOOP
        -- Periksa apakah snapshot untuk santri ini sudah berstatus 'finalized'
        SELECT status INTO v_existing_status 
        FROM exam_material_snapshots 
        WHERE exam_period_id = p_period_id AND student_id = v_item->>'studentId';

        IF v_existing_status = 'finalized' THEN
            -- JANGAN TIMPA snapshot yang sudah final!
            v_skipped := v_skipped + 1;
        ELSE
            INSERT INTO exam_material_snapshots (
                id, exam_period_id, student_id, source_type,
                start_surah, start_ayah, end_surah, end_ayah,
                start_page, end_page, start_juz, end_juz, estimated_pages,
                start_surah_name, end_surah_name,
                first_record_date, last_record_date, total_records_analyzed, memorization_direction,
                status, review_reason,
                created_at, updated_at
            ) VALUES (
                COALESCE(v_item->>'id', 'snap_' || p_period_id || '_' || (v_item->>'studentId')),
                p_period_id,
                v_item->>'studentId',
                COALESCE(v_item->>'sourceType', 'automatic'),
                (v_item->>'startSurah')::INTEGER,
                (v_item->>'startAyah')::INTEGER,
                (v_item->>'endSurah')::INTEGER,
                (v_item->>'endAyah')::INTEGER,
                (v_item->>'startPage')::INTEGER,
                (v_item->>'endPage')::INTEGER,
                (v_item->>'startJuz')::INTEGER,
                (v_item->>'endJuz')::INTEGER,
                COALESCE((v_item->>'estimatedPages')::NUMERIC, 0),
                v_item->>'startSurahName',
                v_item->>'endSurahName',
                (v_item->>'firstRecordDate')::DATE,
                (v_item->>'lastRecordDate')::DATE,
                COALESCE((v_item->>'totalRecordsAnalyzed')::INTEGER, 0),
                COALESCE(v_item->>'memorizationDirection', 'forward'),
                COALESCE(v_item->>'status', 'not_ready'),
                v_item->>'reviewReason',
                now(),
                now()
            )
            ON CONFLICT (exam_period_id, student_id) DO UPDATE SET
                source_type = EXCLUDED.source_type,
                start_surah = EXCLUDED.start_surah,
                start_ayah = EXCLUDED.start_ayah,
                end_surah = EXCLUDED.end_surah,
                end_ayah = EXCLUDED.end_ayah,
                start_page = EXCLUDED.start_page,
                end_page = EXCLUDED.end_page,
                start_juz = EXCLUDED.start_juz,
                end_juz = EXCLUDED.end_juz,
                estimated_pages = EXCLUDED.estimated_pages,
                start_surah_name = EXCLUDED.start_surah_name,
                end_surah_name = EXCLUDED.end_surah_name,
                first_record_date = EXCLUDED.first_record_date,
                last_record_date = EXCLUDED.last_record_date,
                total_records_analyzed = EXCLUDED.total_records_analyzed,
                memorization_direction = EXCLUDED.memorization_direction,
                status = EXCLUDED.status,
                review_reason = EXCLUDED.review_reason,
                updated_at = now();

            v_count := v_count + 1;
        END IF;
    END LOOP;

    -- Audit log
    INSERT INTO exam_audit_logs (id, exam_period_id, action, actor_id, after_data, reason, created_at)
    VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        'material_generated',
        v_user.id,
        jsonb_build_object('savedCount', v_count, 'skippedFinalizedCount', v_skipped),
        'Auto-generate / batch snapshot materi ujian santri',
        now()
    );

    RETURN json_build_object('success', true, 'savedCount', v_count, 'skippedFinalizedCount', v_skipped, 'message', 'Snapshot materi berhasil disimpan.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 5: verify_or_override_material_snapshot (Teacher / Admin)
CREATE OR REPLACE FUNCTION verify_or_override_material_snapshot(
    p_username TEXT,
    p_password TEXT,
    p_snapshot_id TEXT,
    p_action TEXT, -- 'verify', 'override', 'finalize'
    p_data JSONB,
    p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_snap RECORD;
    v_participant RECORD;
    v_period RECORD;
    v_before JSONB;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    SELECT * INTO v_snap FROM exam_material_snapshots WHERE id = p_snapshot_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi tidak ditemukan.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_snap.exam_period_id;
    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    SELECT * INTO v_participant FROM exam_participants 
    WHERE exam_period_id = v_snap.exam_period_id AND student_id = v_snap.student_id;

    -- Otorisasi Role: Jika guru, harus sesuai dengan halaqah santri
    IF v_user.role = 'teacher' THEN
        IF v_participant.teacher_id_snapshot != v_user.id THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda hanya dapat memverifikasi santri halaqah Anda sendiri.');
        END IF;
    ELSIF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    v_before := to_jsonb(v_snap);

    IF p_action = 'verify' THEN
        UPDATE exam_material_snapshots SET
            status = 'ready',
            verified_by = v_user.id,
            verified_at = now(),
            updated_at = now()
        WHERE id = p_snapshot_id;

        INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
        VALUES ('audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6), v_snap.exam_period_id, v_snap.student_id, 'material_verified', v_user.id, v_before, to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)), p_reason, now());

        RETURN json_build_object('success', true, 'message', 'Materi berhasil diverifikasi.');

    ELSIF p_action = 'override' THEN
        IF p_reason IS NULL OR trim(p_reason) = '' THEN
            RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan koreksi manual.');
        END IF;

        UPDATE exam_material_snapshots SET
            source_type = 'manual_override',
            start_surah = (p_data->>'startSurah')::INTEGER,
            start_ayah = (p_data->>'startAyah')::INTEGER,
            end_surah = (p_data->>'endSurah')::INTEGER,
            end_ayah = (p_data->>'endAyah')::INTEGER,
            start_page = (p_data->>'startPage')::INTEGER,
            end_page = (p_data->>'endPage')::INTEGER,
            start_juz = (p_data->>'startJuz')::INTEGER,
            end_juz = (p_data->>'endJuz')::INTEGER,
            estimated_pages = COALESCE((p_data->>'estimatedPages')::NUMERIC, 0),
            start_surah_name = p_data->>'startSurahName',
            end_surah_name = p_data->>'endSurahName',
            override_reason = p_reason,
            status = 'ready',
            verified_by = v_user.id,
            verified_at = now(),
            updated_at = now()
        WHERE id = p_snapshot_id;

        INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
        VALUES ('audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6), v_snap.exam_period_id, v_snap.student_id, 'material_override', v_user.id, v_before, to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)), p_reason, now());

        RETURN json_build_object('success', true, 'message', 'Koreksi materi manual berhasil disimpan.');

    ELSIF p_action = 'finalize' THEN
        IF v_snap.status NOT IN ('ready', 'needs_review') THEN
            RETURN json_build_object('success', false, 'message', 'Materi belum siap untuk difinalisasi.');
        END IF;

        UPDATE exam_material_snapshots SET
            status = 'finalized',
            finalized_by = v_user.id,
            finalized_at = now(),
            updated_at = now()
        WHERE id = p_snapshot_id;

        INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
        VALUES ('audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6), v_snap.exam_period_id, v_snap.student_id, 'material_finalized', v_user.id, v_before, to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)), p_reason, now());

        RETURN json_build_object('success', true, 'message', 'Materi berhasil difinalisasi.');
    ELSE
        RETURN json_build_object('success', false, 'message', 'Aksi tidak dikenali.');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 6: reopen_material_snapshot (Admin Only)
CREATE OR REPLACE FUNCTION reopen_material_snapshot(
    p_username TEXT,
    p_password TEXT,
    p_snapshot_id TEXT,
    p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_snap RECORD;
    v_period RECORD;
    v_before JSONB;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuka kembali materi final.');
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Wajib mencantumkan alasan pembukaan kembali materi.');
    END IF;

    SELECT * INTO v_snap FROM exam_material_snapshots WHERE id = p_snapshot_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi tidak ditemukan.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = v_snap.exam_period_id;
    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    v_before := to_jsonb(v_snap);

    UPDATE exam_material_snapshots SET
        status = 'ready',
        finalized_by = NULL,
        finalized_at = NULL,
        updated_at = now()
    WHERE id = p_snapshot_id;

    INSERT INTO exam_audit_logs (id, exam_period_id, student_id, action, actor_id, before_data, after_data, reason, created_at)
    VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        v_snap.exam_period_id,
        v_snap.student_id,
        'material_reopened',
        v_user.id,
        v_before,
        to_jsonb((SELECT s FROM exam_material_snapshots s WHERE s.id = p_snapshot_id)),
        p_reason,
        now()
    );

    RETURN json_build_object('success', true, 'message', 'Materi berhasil dibuka kembali untuk revisi.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 7: bulk_finalize_material_snapshots (Admin Only, Ready Items Only)
CREATE OR REPLACE FUNCTION bulk_finalize_material_snapshots(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_finalized_count INTEGER := 0;
    v_needs_review_count INTEGER := 0;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak melakukan finalisasi massal.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    IF v_period.status = 'completed' THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian telah selesai dan terkunci.');
    END IF;

    -- Hitung yang berstatus needs_review (ini TIDAK boleh ikut finalisasi massal)
    SELECT count(*) INTO v_needs_review_count 
    FROM exam_material_snapshots 
    WHERE exam_period_id = p_period_id AND status = 'needs_review';

    -- Update hanya yang statusnya 'ready'
    WITH updated AS (
        UPDATE exam_material_snapshots SET
            status = 'finalized',
            finalized_by = v_user.id,
            finalized_at = now(),
            updated_at = now()
        WHERE exam_period_id = p_period_id AND status = 'ready'
        RETURNING id
    )
    SELECT count(*) INTO v_finalized_count FROM updated;

    INSERT INTO exam_audit_logs (id, exam_period_id, action, actor_id, after_data, reason, created_at)
    VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_period_id,
        'bulk_finalized',
        v_user.id,
        jsonb_build_object('finalizedCount', v_finalized_count, 'skippedNeedsReview', v_needs_review_count),
        'Finalisasi massal seluruh santri yang berstatus Siap (Ready)',
        now()
    );

    RETURN json_build_object(
        'success', true,
        'finalizedCount', v_finalized_count,
        'skippedNeedsReview', v_needs_review_count,
        'message', v_finalized_count || ' santri berhasil difinalisasi. ' || v_needs_review_count || ' santri perlu verifikasi manual.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RPC 8: get_tahfiz_evaluation_data (Role-Based Secure Query)
CREATE OR REPLACE FUNCTION get_tahfiz_evaluation_data(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_period RECORD;
    v_term RECORD;
    v_participants JSON;
    v_snapshots JSON;
    v_audit_logs JSON;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal.');
    END IF;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Parent tidak memiliki akses ke data evaluasi.');
    END IF;

    SELECT * INTO v_period FROM exam_periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian tidak ditemukan.');
    END IF;

    SELECT * INTO v_term FROM academic_terms WHERE id = v_period.academic_term_id;

    -- Query Peserta: Admin melihat semua, Guru hanya melihat santri halaqahnya
    IF v_user.role = 'admin' THEN
        SELECT json_agg(json_build_object(
            'id', p.id,
            'examPeriodId', p.exam_period_id,
            'studentId', p.student_id,
            'studentName', p.student_name_snapshot,
            'class', p.class_snapshot,
            'halaqah', p.halaqah_snapshot,
            'teacherId', p.teacher_id_snapshot,
            'status', p.status
        ) ORDER BY p.class_snapshot, p.student_name_snapshot) INTO v_participants
        FROM exam_participants p
        WHERE p.exam_period_id = p_period_id;

        SELECT json_agg(json_build_object(
            'id', s.id,
            'examPeriodId', s.exam_period_id,
            'studentId', s.student_id,
            'sourceType', s.source_type,
            'startSurah', s.start_surah,
            'startAyah', s.start_ayah,
            'endSurah', s.end_surah,
            'endAyah', s.end_ayah,
            'startPage', s.start_page,
            'endPage', s.end_page,
            'startJuz', s.start_juz,
            'endJuz', s.end_juz,
            'estimatedPages', s.estimated_pages,
            'startSurahName', s.start_surah_name,
            'endSurahName', s.end_surah_name,
            'firstRecordDate', s.first_record_date,
            'lastRecordDate', s.last_record_date,
            'totalRecordsAnalyzed', s.total_records_analyzed,
            'memorizationDirection', s.memorization_direction,
            'status', s.status,
            'reviewReason', s.review_reason,
            'overrideReason', s.override_reason,
            'verifiedBy', s.verified_by,
            'verifiedAt', s.verified_at,
            'finalizedBy', s.finalized_by,
            'finalizedAt', s.finalized_at
        )) INTO v_snapshots
        FROM exam_material_snapshots s
        WHERE s.exam_period_id = p_period_id;

        SELECT json_agg(json_build_object(
            'id', a.id,
            'examPeriodId', a.exam_period_id,
            'studentId', a.student_id,
            'action', a.action,
            'actorId', a.actor_id,
            'beforeData', a.before_data,
            'afterData', a.after_data,
            'reason', a.reason,
            'createdAt', a.created_at
        ) ORDER BY a.created_at DESC) INTO v_audit_logs
        FROM exam_audit_logs a
        WHERE a.exam_period_id = p_period_id;

    ELSE
        -- TEACHER: Filter hanya santri halaqahnya
        SELECT json_agg(json_build_object(
            'id', p.id,
            'examPeriodId', p.exam_period_id,
            'studentId', p.student_id,
            'studentName', p.student_name_snapshot,
            'class', p.class_snapshot,
            'halaqah', p.halaqah_snapshot,
            'teacherId', p.teacher_id_snapshot,
            'status', p.status
        ) ORDER BY p.student_name_snapshot) INTO v_participants
        FROM exam_participants p
        WHERE p.exam_period_id = p_period_id 
          AND p.teacher_id_snapshot = v_user.id;

        SELECT json_agg(json_build_object(
            'id', s.id,
            'examPeriodId', s.exam_period_id,
            'studentId', s.student_id,
            'sourceType', s.source_type,
            'startSurah', s.start_surah,
            'startAyah', s.start_ayah,
            'endSurah', s.end_surah,
            'endAyah', s.end_ayah,
            'startPage', s.start_page,
            'endPage', s.end_page,
            'startJuz', s.start_juz,
            'endJuz', s.end_juz,
            'estimatedPages', s.estimated_pages,
            'startSurahName', s.start_surah_name,
            'endSurahName', s.end_surah_name,
            'firstRecordDate', s.first_record_date,
            'lastRecordDate', s.last_record_date,
            'totalRecordsAnalyzed', s.total_records_analyzed,
            'memorizationDirection', s.memorization_direction,
            'status', s.status,
            'reviewReason', s.review_reason,
            'overrideReason', s.override_reason,
            'verifiedBy', s.verified_by,
            'verifiedAt', s.verified_at,
            'finalizedBy', s.finalized_by,
            'finalizedAt', s.finalized_at
        )) INTO v_snapshots
        FROM exam_material_snapshots s
        JOIN exam_participants ep ON ep.exam_period_id = s.exam_period_id AND ep.student_id = s.student_id
        WHERE s.exam_period_id = p_period_id
          AND ep.teacher_id_snapshot = v_user.id;

        v_audit_logs := '[]'::json;
    END IF;

    RETURN json_build_object(
        'success', true,
        'period', json_build_object(
            'id', v_period.id,
            'academicTermId', v_period.academic_term_id,
            'name', v_period.name,
            'examType', v_period.exam_type,
            'materialCutoffDate', v_period.material_cutoff_date,
            'examStartDate', v_period.exam_start_date,
            'examEndDate', v_period.exam_end_date,
            'kkm', v_period.kkm,
            'targetClasses', v_period.target_classes,
            'targetHalaqahs', v_period.target_halaqahs,
            'status', v_period.status
        ),
        'academicTerm', json_build_object(
            'id', v_term.id,
            'academicYear', v_term.academic_year,
            'semester', v_term.semester,
            'startDate', v_term.start_date,
            'endDate', v_term.end_date,
            'status', v_term.status
        ),
        'participants', COALESCE(v_participants, '[]'::json),
        'materialSnapshots', COALESCE(v_snapshots, '[]'::json),
        'auditLogs', COALESCE(v_audit_logs, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
