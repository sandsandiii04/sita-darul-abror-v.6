-- ============================================================================
-- SITA (Sistem Informasi Tahfidz Al-Qur'an)
-- EMERGENCY SECURITY HOTFIX: PENUTUPAN PERMANEN AKSES ANONIM TABEL UTAMA
-- File: supabase_legacy_security_hotfix.sql
-- Komitmen: Idempoten, 100% Non-Destruktif (Zero Data Loss)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. DROP SELURUH KEBIJAKAN RLS PERMISIF LAMA (CELAH AKSES ANONIM)
-- ----------------------------------------------------------------------------

-- A. Tabel users
DROP POLICY IF EXISTS "Allow Insert for Anon" ON public.users;
DROP POLICY IF EXISTS "Allow Update for Anon" ON public.users;
DROP POLICY IF EXISTS "Allow Delete for Anon" ON public.users;
DROP POLICY IF EXISTS "users_deny_direct_write" ON public.users;
DROP POLICY IF EXISTS "users_deny_direct_access" ON public.users;

-- B. Tabel students
DROP POLICY IF EXISTS "Allow Insert for Anon" ON public.students;
DROP POLICY IF EXISTS "Allow Update for Anon" ON public.students;
DROP POLICY IF EXISTS "Allow Delete for Anon" ON public.students;
DROP POLICY IF EXISTS "students_deny_direct_access" ON public.students;

-- C. Tabel records (Sabaq, Sabqi, Manzil)
DROP POLICY IF EXISTS "Akses Publik Anon" ON public.records;
DROP POLICY IF EXISTS "records_deny_direct_access" ON public.records;

-- D. Tabel attendance (Presensi Harian Santri & Guru)
DROP POLICY IF EXISTS "Akses Publik Anon" ON public.attendance;
DROP POLICY IF EXISTS "attendance_deny_direct_access" ON public.attendance;

-- E. Tabel exams (Ujian Tahfiz Lama)
DROP POLICY IF EXISTS "Akses Publik Anon" ON public.exams;
DROP POLICY IF EXISTS "exams_deny_direct_access" ON public.exams;


-- ----------------------------------------------------------------------------
-- 2. PASTIKAN ROW LEVEL SECURITY AKTIF PADA SEMUA TABEL UTAMA
-- ----------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------------------
-- 3. TERAPKAN KEBIJAKAN ISOLASI TOTAL DARI REST API (LOCKDOWN DIRECT ACCESS)
--    Menolak seluruh pembacaan langsung (SELECT) dan penulisan langsung
--    (INSERT, UPDATE, DELETE) dari PostgREST / anonim / authenticated.
-- ----------------------------------------------------------------------------
CREATE POLICY users_deny_direct_access 
    ON public.users 
    FOR ALL 
    TO public 
    USING (false) 
    WITH CHECK (false);

CREATE POLICY students_deny_direct_access 
    ON public.students 
    FOR ALL 
    TO public 
    USING (false) 
    WITH CHECK (false);

CREATE POLICY records_deny_direct_access 
    ON public.records 
    FOR ALL 
    TO public 
    USING (false) 
    WITH CHECK (false);

CREATE POLICY attendance_deny_direct_access 
    ON public.attendance 
    FOR ALL 
    TO public 
    USING (false) 
    WITH CHECK (false);

CREATE POLICY exams_deny_direct_access 
    ON public.exams 
    FOR ALL 
    TO public 
    USING (false) 
    WITH CHECK (false);


-- ----------------------------------------------------------------------------
-- 4. CABUT HAK MUTASI DATA LANGSUNG (INSERT, UPDATE, DELETE, TRUNCATE)
--    DARI PERAN anon & authenticated PADA KELIMA TABEL
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.users FROM anon;
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.students FROM anon;
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.records FROM anon;
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance FROM anon;
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.exams FROM anon;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.users FROM authenticated;
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.students FROM authenticated;
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.records FROM authenticated;
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attendance FROM authenticated;
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.exams FROM authenticated;
    END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 5. PASTIKAN SELURUH RPC RESMI SITA MEMILIKI IZIN EKSEKUSI
--    Fungsi RPC ini berjalan sebagai SECURITY DEFINER dengan otentikasi
--    kredensial dan otorisasi role di level server.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT EXECUTE ON FUNCTION public.verify_login(text, text) TO anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.load_secure_data(text, text) TO anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.upsert_data(text, text, text, jsonb) TO anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.delete_data_secure(text, text, text, text) TO anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.get_teacher_list() TO anon, authenticated;
    END IF;
END $$;

COMMIT;
