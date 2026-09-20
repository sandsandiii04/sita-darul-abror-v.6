-- ============================================================
-- SQL Migration: Fitur Hapus & Hapus Semua Bank Soal Tahfiz
-- Darul Abror IBS
-- Jalankan skrip ini di SQL Editor Dashboard Supabase
-- ============================================================

-- 1. RPC: Delete Single Question Bank Item (Admin Only)
CREATE OR REPLACE FUNCTION delete_question_bank_item(
    p_username TEXT, 
    p_password TEXT, 
    p_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
    v_deleted_count INT := 0;
BEGIN
    -- Verifikasi user & admin role
    SELECT role INTO v_role FROM users 
    WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak menghapus soal.');
    END IF;

    -- Hapus soal dari bank soal (exam_questions.question_bank_id ber-ON DELETE SET NULL sehingga riwayat ujian tetap aman)
    DELETE FROM question_bank 
    WHERE id = p_id;
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    IF v_deleted_count > 0 THEN
        RETURN json_build_object('success', true, 'deleted_count', v_deleted_count, 'message', 'Soal berhasil dihapus permanen.');
    ELSE
        RETURN json_build_object('success', false, 'deleted_count', 0, 'message', 'Soal tidak ditemukan atau sudah dihapus.');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. RPC: Delete All Question Bank Items (Admin Only, dengan opsi filter exam_type / status)
CREATE OR REPLACE FUNCTION delete_all_question_bank_items(
    p_username TEXT, 
    p_password TEXT,
    p_exam_type TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
    v_deleted_count INT := 0;
BEGIN
    -- Verifikasi user & admin role
    SELECT role INTO v_role FROM users 
    WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak menghapus semua soal.');
    END IF;

    -- Eksekusi penghapusan sesuai parameter filter
    IF p_exam_type IS NOT NULL AND p_exam_type <> 'all' AND p_status IS NOT NULL AND p_status <> 'all' THEN
        DELETE FROM question_bank WHERE exam_type = p_exam_type AND status = p_status;
    ELSIF p_exam_type IS NOT NULL AND p_exam_type <> 'all' THEN
        DELETE FROM question_bank WHERE exam_type = p_exam_type;
    ELSIF p_status IS NOT NULL AND p_status <> 'all' THEN
        DELETE FROM question_bank WHERE status = p_status;
    ELSE
        DELETE FROM question_bank;
    END IF;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN json_build_object(
        'success', true, 
        'deleted_count', v_deleted_count, 
        'message', format('%s soal berhasil dihapus permanen dari Bank Soal.', v_deleted_count)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Beri izin eksekusi ke anon & authenticated (Security Definer memverifikasi password & role)
GRANT EXECUTE ON FUNCTION delete_question_bank_item(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_all_question_bank_items(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
