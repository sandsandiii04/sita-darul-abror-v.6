-- ============================================================
-- MIGRATION: admin_bulk_open_attendance & admin_bulk_delete_open_requests
-- Sistem Informasi Tahfidz Al Qur'an (SITA) Darul Abror
-- Fitur Buka Absen Massal (Bulan / Rentang Tanggal) untuk Admin
-- ============================================================

-- 1. Pastikan tabel attendance_open_requests memiliki indeks yang optimal
CREATE INDEX IF NOT EXISTS idx_aor_teacher_date_status ON attendance_open_requests(teacher_id, date, status);
CREATE INDEX IF NOT EXISTS idx_aor_date ON attendance_open_requests(date);

-- 2. RPC: admin_bulk_open_attendance
DROP FUNCTION IF EXISTS admin_bulk_open_attendance(TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION admin_bulk_open_attendance(
    p_username TEXT,
    p_password TEXT,
    p_teacher_id TEXT, -- user ID spesifik atau 'ALL'
    p_start_date DATE,
    p_end_date DATE,
    p_session TEXT,    -- 'pagi', 'malam', atau 'all'
    p_type TEXT,       -- 'student' atau 'teacher'
    p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_teacher RECORD;
    v_curr_date DATE;
    v_sess TEXT;
    v_count INT := 0;
    v_req_id TEXT;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuka akses absensi santri/guru massal.');
    END IF;

    IF p_start_date > p_end_date THEN
        RETURN json_build_object('success', false, 'message', 'Tanggal mulai tidak boleh melebihi tanggal selesai.');
    END IF;

    -- 2. Generate series tanggal dan upsert request disetujui (approved)
    FOR v_curr_date IN SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date LOOP
        FOR v_sess IN SELECT UNNEST(CASE WHEN p_session = 'all' THEN ARRAY['pagi', 'malam'] ELSE ARRAY[p_session] END) LOOP
            IF p_teacher_id = 'ALL' THEN
                FOR v_teacher IN SELECT id FROM users WHERE role = 'teacher' LOOP
                    v_req_id := 'req_' || v_teacher.id || '_' || v_curr_date::text || '_' || v_sess || '_' || p_type;
                    INSERT INTO attendance_open_requests (id, teacher_id, date, session, type, status, late_reason, created_at)
                    VALUES (v_req_id, v_teacher.id, v_curr_date, v_sess, p_type, 'approved', p_reason, now())
                    ON CONFLICT (id) DO UPDATE SET 
                        status = 'approved',
                        late_reason = EXCLUDED.late_reason;
                    v_count := v_count + 1;
                END LOOP;
            ELSE
                v_req_id := 'req_' || p_teacher_id || '_' || v_curr_date::text || '_' || v_sess || '_' || p_type;
                INSERT INTO attendance_open_requests (id, teacher_id, date, session, type, status, late_reason, created_at)
                VALUES (v_req_id, p_teacher_id, v_curr_date, v_sess, p_type, 'approved', p_reason, now())
                ON CONFLICT (id) DO UPDATE SET 
                    status = 'approved',
                    late_reason = EXCLUDED.late_reason;
                v_count := v_count + 1;
            END IF;
        END LOOP;
    END LOOP;

    RETURN json_build_object(
        'success', true, 
        'count', v_count, 
        'message', 'Berhasil membuka akses absensi untuk ' || v_count || ' sesi halaqah.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION admin_bulk_open_attendance(TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_bulk_open_attendance(TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

-- 3. RPC: admin_bulk_revoke_attendance (Kunci kembali / batalkan akses yang telah dibuka)
DROP FUNCTION IF EXISTS admin_bulk_revoke_attendance(TEXT, TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION admin_bulk_revoke_attendance(
    p_username TEXT,
    p_password TEXT,
    p_request_ids TEXT[]
)
RETURNS JSON AS $$
DECLARE
    v_user RECORD;
    v_deleted_count INT := 0;
BEGIN
    SELECT * INTO v_user FROM users 
    WHERE username = p_username 
      AND (password = p_password OR password = extensions.crypt(p_password, password));
      
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Username atau password salah.');
    END IF;

    IF v_user.role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak mencabut akses absensi.');
    END IF;

    DELETE FROM attendance_open_requests 
    WHERE id = ANY(p_request_ids);
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN json_build_object(
        'success', true,
        'count', v_deleted_count,
        'message', 'Berhasil mengunci kembali ' || v_deleted_count || ' sesi absensi.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION admin_bulk_revoke_attendance(TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_bulk_revoke_attendance(TEXT, TEXT, TEXT[]) TO anon, authenticated, service_role;
