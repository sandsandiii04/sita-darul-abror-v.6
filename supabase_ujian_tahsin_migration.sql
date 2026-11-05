-- ============================================================
-- SQL Migration: Modul Ujian Tahsin Al-Qur'an (Non-Destructive)
-- Darul Abror Islamic Boarding School — SITA
-- ============================================================

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
    
    -- Snapshot data santri saat ujian agar historis tetap valid
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
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_tahsin_session UNIQUE(period_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_tahsin_sessions_period ON tahsin_sessions(period_id);
CREATE INDEX IF NOT EXISTS idx_tahsin_sessions_student ON tahsin_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_tahsin_sessions_examiner ON tahsin_sessions(examiner_id);
CREATE INDEX IF NOT EXISTS idx_tahsin_sessions_status ON tahsin_sessions(status);
CREATE INDEX IF NOT EXISTS idx_tahsin_sessions_class ON tahsin_sessions(class_snapshot);

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
    finalized_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT uq_tahsin_attempt UNIQUE(session_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_tahsin_attempts_session ON tahsin_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_tahsin_attempts_date ON tahsin_attempts(exam_date);
CREATE INDEX IF NOT EXISTS idx_tahsin_attempts_status ON tahsin_attempts(status);

-- Enable Row Level Security (RLS) safely
ALTER TABLE tahsin_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE tahsin_examiners ENABLE ROW LEVEL SECURITY;
ALTER TABLE tahsin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tahsin_attempts ENABLE ROW LEVEL SECURITY;

-- Non-restrictive policies for authenticated & anon in SITA standard
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tahsin_periods' AND policyname = 'tahsin_periods_open_access') THEN
        CREATE POLICY tahsin_periods_open_access ON tahsin_periods FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tahsin_examiners' AND policyname = 'tahsin_examiners_open_access') THEN
        CREATE POLICY tahsin_examiners_open_access ON tahsin_examiners FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tahsin_sessions' AND policyname = 'tahsin_sessions_open_access') THEN
        CREATE POLICY tahsin_sessions_open_access ON tahsin_sessions FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tahsin_attempts' AND policyname = 'tahsin_attempts_open_access') THEN
        CREATE POLICY tahsin_attempts_open_access ON tahsin_attempts FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;
