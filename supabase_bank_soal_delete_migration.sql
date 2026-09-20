-- ============================================================
-- SQL Migration: Fitur Hapus, Hapus Semua, & Aktifkan Massal Bank Soal Tahfiz
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

-- 2. RPC: Delete All Question Bank Items (Admin Only, dengan klausa WHERE aman)
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

    -- Eksekusi penghapusan (selalu sertakan id IS NOT NULL agar mematuhi aturan safeupdate)
    IF p_exam_type IS NOT NULL AND p_exam_type <> 'all' AND p_status IS NOT NULL AND p_status <> 'all' THEN
        DELETE FROM question_bank WHERE exam_type = p_exam_type AND status = p_status AND id IS NOT NULL;
    ELSIF p_exam_type IS NOT NULL AND p_exam_type <> 'all' THEN
        DELETE FROM question_bank WHERE exam_type = p_exam_type AND id IS NOT NULL;
    ELSIF p_status IS NOT NULL AND p_status <> 'all' THEN
        DELETE FROM question_bank WHERE status = p_status AND id IS NOT NULL;
    ELSE
        DELETE FROM question_bank WHERE id IS NOT NULL;
    END IF;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN json_build_object(
        'success', true, 
        'deleted_count', v_deleted_count, 
        'message', format('%s soal berhasil dihapus permanen dari Bank Soal.', v_deleted_count)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RPC: Bulk Activate Draft Questions (Admin Only)
CREATE OR REPLACE FUNCTION bulk_activate_question_bank_drafts(
    p_username TEXT, 
    p_password TEXT,
    p_exam_type TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
    v_updated_count INT := 0;
BEGIN
    -- Verifikasi user & admin role
    SELECT role INTO v_role FROM users 
    WHERE username = p_username AND (password = p_password OR password = crypt(p_password, password));
    
    IF NOT FOUND OR v_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mengaktifkan soal draft.');
    END IF;

    -- Aktifkan semua soal yang saat ini berstatus 'draft'
    IF p_exam_type IS NOT NULL AND p_exam_type <> 'all' THEN
        UPDATE question_bank 
        SET status = 'active', updated_at = timezone('utc'::text, now())
        WHERE status = 'draft' AND exam_type = p_exam_type AND id IS NOT NULL;
    ELSE
        UPDATE question_bank 
        SET status = 'active', updated_at = timezone('utc'::text, now())
        WHERE status = 'draft' AND id IS NOT NULL;
    END IF;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RETURN json_build_object(
        'success', true, 
        'updated_count', v_updated_count, 
        'message', format('%s soal draft berhasil diaktifkan.', v_updated_count)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Beri izin eksekusi ke anon & authenticated
GRANT EXECUTE ON FUNCTION delete_question_bank_item(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_all_question_bank_items(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bulk_activate_question_bank_drafts(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
