-- ============================================================================
-- SITA (Sistem Informasi Tahfidz Al-Qur'an)
-- EMERGENCY RECOVERY / ROLLBACK PLAN (TETAP AMAN DARI AKSES ANONIM)
-- File: supabase_legacy_security_rollback.sql
-- Prinsip: Memulihkan fungsi RPC tanpa membuka kembali celah akses anonim langsung.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- JIKA TERJADI KENDALA OPERASIONAL PADA RPC RESMI SITA:
-- Langkah perbaikan yang benar BUKAN mengaktifkan kembali policy anonim,
-- melainkan memastikan ownership dan izin fungsi SECURITY DEFINER diperbarui.
-- ----------------------------------------------------------------------------

-- 1. Pastikan seluruh fungsi RPC resmi SITA dimiliki oleh postgres superuser
ALTER FUNCTION public.verify_login(text, text) OWNER TO postgres;
ALTER FUNCTION public.load_secure_data(text, text) OWNER TO postgres;
ALTER FUNCTION public.upsert_data(text, text, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.delete_data_secure(text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.get_teacher_list() OWNER TO postgres;

-- 2. Berikan kembali izin eksekusi eksplisit RPC kepada peran gateway Supabase
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT EXECUTE ON FUNCTION public.verify_login(text, text) TO anon, authenticated, service_role;
        GRANT EXECUTE ON FUNCTION public.load_secure_data(text, text) TO anon, authenticated, service_role;
        GRANT EXECUTE ON FUNCTION public.upsert_data(text, text, text, jsonb) TO anon, authenticated, service_role;
        GRANT EXECUTE ON FUNCTION public.delete_data_secure(text, text, text, text) TO anon, authenticated, service_role;
        GRANT EXECUTE ON FUNCTION public.get_teacher_list() TO anon, authenticated, service_role;
    END IF;
END $$;

-- 3. PERINGATAN KEAMANAN:
-- JANGAN PERNAH membuat ulang policy 'Allow Insert for Anon' atau 'Akses Publik Anon'.
-- Semua pembacaan dan modifikasi data harus tetap melewati RPC resmi.

COMMIT;
