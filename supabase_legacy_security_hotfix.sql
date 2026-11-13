-- ============================================================================
-- SITA (Sistem Informasi Tahfidz Al-Qur'an)
-- EMERGENCY SECURITY HOTFIX: PENUTUPAN CELAH AKSES ANONIM PADA TABEL LEGACY
-- File: supabase_legacy_security_hotfix.sql
-- Sifat: Idempoten, Non-Destruktif (Tidak mengubah atau menghapus data riil)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. PEMBERSIHAN KEBIJAKAN RLS PERMISIF LAMA (YANG MEMBUKA AKSES ANONIM)
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
-- 2. PASTIKAN ROW LEVEL SECURITY AKTIF PADA KELIMA TABEL
-- ----------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------------------
-- 3. TERAPKAN KEBIJAKAN PENGUNCIAN AKSES LANGSUNG (LOCKDOWN DIRECT ACCESS)
--    Menolak seluruh pembacaan dan penulisan langsung via REST API anonim.
--    Seluruh operasional diarahkan 100% melalui RPC SECURITY DEFINER resmi.
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
-- 5. PASTIKAN IZIN EKSEKUSI RPC RESMI SITA TERSEDIA
--    RPC ini berstatus SECURITY DEFINER yang memeriksa kredensial pengguna
--    sebelum mengeksekusi operasi data.
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

-- ============================================================================
-- PROSEDUR PEMULIHAN (ROLLBACK PROCEDURE) - JIKA DIPERLUKAN SECARA DARURAT:
-- ============================================================================
-- Apabila terdapat kebutuhan darurat mengembalikan konfigurasi RLS lama:
--
-- BEGIN;
-- DROP POLICY IF EXISTS users_deny_direct_access ON public.users;
-- DROP POLICY IF EXISTS students_deny_direct_access ON public.students;
-- DROP POLICY IF EXISTS records_deny_direct_access ON public.records;
-- DROP POLICY IF EXISTS attendance_deny_direct_access ON public.attendance;
-- DROP POLICY IF EXISTS exams_deny_direct_access ON public.exams;
--
-- CREATE POLICY "Allow Insert for Anon" ON public.users FOR INSERT TO authenticated, anon WITH CHECK (true);
-- CREATE POLICY "Allow Update for Anon" ON public.users FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow Delete for Anon" ON public.users FOR DELETE TO authenticated, anon USING (true);
--
-- CREATE POLICY "Allow Insert for Anon" ON public.students FOR INSERT TO authenticated, anon WITH CHECK (true);
-- CREATE POLICY "Allow Update for Anon" ON public.students FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow Delete for Anon" ON public.students FOR DELETE TO authenticated, anon USING (true);
--
-- CREATE POLICY "Akses Publik Anon" ON public.records FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
-- CREATE POLICY "Akses Publik Anon" ON public.attendance FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
-- CREATE POLICY "Akses Publik Anon" ON public.exams FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);
--
-- GRANT ALL ON public.users, public.students, public.records, public.attendance, public.exams TO anon, authenticated;
-- COMMIT;
-- ============================================================================
