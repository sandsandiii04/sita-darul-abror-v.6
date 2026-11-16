-- ==============================================================================
-- SITA DARUL ABROR — EMERGENCY PRODUCTION FIX MIGRATION
-- File: supabase_emergency_fix_sync_attendance_and_tahsin_edit.sql
--
-- CAKUPAN PERBAIKAN:
-- 1. [P0] Idempotent Auto-Sync & Draft-to-Finalize Tolerance pada save_tahsin_attempt_secure
--         Mencegah nilai ujian lokal terjebak "Belum Sync" akibat timeout jaringan
--         atau perbedaan versi draft milik guru yang sama.
-- 2. [P1] Perbaikan RPC upsert_data, admin_bulk_open_attendance, & admin_bulk_revoke_attendance
--         Memperbaiki kegagalan Absensi Guru (ERROR: null value in column "created_at"
--         violates not-null constraint pada jsonb_populate_record) serta mencegah
--         duplikasi absensi pada hari & sesi yang sama.
-- 3. [P2] Fitur Edit Nilai Ujian Tahsin (Revisi Nilai Terotorisasi & Audit Trail Lengkap)
--         - Mengizinkan guru halaqah pemilik santri (students.teacher_id = v_user.id)
--           dan Admin mengoreksi nilai yang sudah disahkan pada periode aktif.
--         - Mewajibkan alasan perubahan (p_reason).
--         - Menolak edit oleh guru lain (Pure Owner-First Security).
--         - Menolak edit oleh guru jika periode sudah ditutup (closed).
--         - Melindungi dari konflik 2 perangkat dengan Optimistic Locking (version).
--         - Menyimpan riwayat nilai lama, nilai baru, status lama, status baru,
--           alasan, pengubah, dan waktu perubahan di tahsin_audit_logs.
--         - Menyertakan auditLogs pada get_tahsin_sessions_secure.
--
-- KEAMANAN & INTEGRITAS DATA:
-- - 100% Non-Destruktif (TIDAK ADA DROP TABLE, TRUNCATE, atau DELETE data).
-- - Mempertahankan Session Token Authentication, RLS, dan Pure Owner-First.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. PERBAIKAN RPC: upsert_data (Memperbaiki Absensi Guru, Santri & Data Operasional)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.upsert_data(
    p_username TEXT,
    p_password TEXT,
    p_table TEXT,
    p_data JSONB
)
RETURNS JSON AS $$
DECLARE
    v_role TEXT;
    v_user_id TEXT;
    v_auth RECORD;
    v_target_user_id TEXT;
    v_existing_id TEXT;
BEGIN
    -- 1. Verifikasi kredensial menggunakan validate_session_or_credential
    SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);

    IF v_auth.out_is_valid THEN
        v_user_id := v_auth.out_user_id;
        v_role := v_auth.out_role;
    ELSE
        -- Akses Khusus untuk Absen Cepat Guru (tanpa login) menggunakan QR Code yang valid
        IF p_table = 'attendance'
           AND (p_data->>'type') = 'teacher'
           AND (p_data->>'status') = 'present'
           AND (p_data->>'qr_token') = 'SITA_ABSENSI_GURU_TETAP' THEN
            v_role := 'teacher';
            v_user_id := split_part(trim(COALESCE(p_data->>'user_id', '')), ' | ', 1);
            IF v_user_id = '' OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND role IN ('teacher', 'ustadz')) THEN
                RETURN json_build_object('success', false, 'message', 'Akses ditolak: ID Guru tidak valid untuk absensi QR.');
            END IF;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Sesi login tidak valid atau telah kedaluwarsa. Silakan login kembali.');
        END IF;
    END IF;

    -- 2. Validasi Hak Akses (Otorisasi Berdasarkan Role)
    IF v_role = 'admin' THEN
        -- Admin memiliki wewenang penuh
    ELSIF v_role IN ('teacher', 'ustadz') THEN
        IF p_table = 'users' THEN
            IF (p_data->>'id') != v_user_id THEN
                RETURN json_build_object('success', false, 'message', 'Akses ditolak: Guru hanya dapat memperbarui profilnya sendiri.');
            END IF;
        ELSIF p_table = 'attendance' THEN
            -- Jika absensi guru, pastikan guru hanya mencatat absensi dirinya sendiri
            IF (p_data->>'type') = 'teacher' THEN
                v_target_user_id := split_part(trim(COALESCE(p_data->>'user_id', '')), ' | ', 1);
                IF v_target_user_id != v_user_id THEN
                    RETURN json_build_object('success', false, 'message', 'Akses ditolak: Guru hanya dapat mencatat kehadiran untuk akunnya sendiri.');
                END IF;
            END IF;
        ELSIF p_table = 'attendance_open_requests' THEN
            v_target_user_id := split_part(trim(COALESCE(p_data->>'teacher_id', '')), ' | ', 1);
            IF v_target_user_id != '' AND v_target_user_id != v_user_id THEN
                RETURN json_build_object('success', false, 'message', 'Akses ditolak: Guru hanya dapat mengajukan permohonan buka absen untuk akunnya sendiri.');
            END IF;
        ELSIF p_table NOT IN ('records', 'exams', 'students') THEN
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Anda tidak memiliki izin untuk mengubah tabel ini.');
        END IF;
    ELSIF v_role = 'parent' THEN
        IF p_table = 'attendance' THEN
            IF split_part(trim(COALESCE(p_data->>'user_id', '')), ' | ', 1) != v_user_id THEN
                RETURN json_build_object('success', false, 'message', 'Akses ditolak: Wali hanya dapat mengisi absensi santri yang bersangkutan.');
            END IF;
        ELSIF p_table = 'attendance_open_requests' THEN
            IF COALESCE(p_data->>'student_id', '') != v_user_id THEN
                RETURN json_build_object('success', false, 'message', 'Akses ditolak: Wali hanya dapat mengirim permohonan buka absen santri miliknya.');
            END IF;
        ELSE
            RETURN json_build_object('success', false, 'message', 'Akses ditolak: Wali santri tidak memiliki izin untuk mengubah data tabel ini.');
        END IF;
    ELSE
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Peran pengguna tidak dikenali.');
    END IF;

    -- 3. Validasi Nama Tabel & Eksekusi Upsert Eksplisit yang Aman (Mencegah NULL created_at & Duplikasi)
    IF p_table = 'attendance' THEN
        v_target_user_id := split_part(trim(COALESCE(p_data->>'user_id', '')), ' | ', 1);

        -- Cegah duplikasi absensi pada user, tanggal, sesi, dan tipe yang sama
        SELECT id INTO v_existing_id
        FROM public.attendance
        WHERE user_id = v_target_user_id
          AND date = (p_data->>'date')::DATE
          AND session = (p_data->>'session')
          AND type = (p_data->>'type')
        LIMIT 1;

        v_existing_id := COALESCE(v_existing_id, p_data->>'id');

        INSERT INTO public.attendance (
            id, user_id, date, session, status, approval_status, type, class, late_reason, created_at
        ) VALUES (
            v_existing_id,
            v_target_user_id,
            (p_data->>'date')::DATE,
            p_data->>'session',
            p_data->>'status',
            NULLIF(p_data->>'approval_status', ''),
            p_data->>'type',
            NULLIF(p_data->>'class', ''),
            NULLIF(p_data->>'late_reason', ''),
            COALESCE((p_data->>'created_at')::TIMESTAMPTZ, timezone('utc'::text, now()))
        )
        ON CONFLICT (id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            date = EXCLUDED.date,
            session = EXCLUDED.session,
            status = EXCLUDED.status,
            approval_status = EXCLUDED.approval_status,
            type = EXCLUDED.type,
            class = COALESCE(EXCLUDED.class, public.attendance.class),
            late_reason = EXCLUDED.late_reason;

    ELSIF p_table = 'attendance_open_requests' THEN
        v_target_user_id := split_part(trim(COALESCE(p_data->>'teacher_id', '')), ' | ', 1);

        SELECT id INTO v_existing_id
        FROM public.attendance_open_requests
        WHERE teacher_id = v_target_user_id
          AND date = (p_data->>'date')::DATE
          AND session = (p_data->>'session')
          AND type = (p_data->>'type')
        LIMIT 1;

        v_existing_id := COALESCE(v_existing_id, p_data->>'id');

        INSERT INTO public.attendance_open_requests (
            id, teacher_id, date, session, type, status, late_reason, created_at
        ) VALUES (
            v_existing_id,
            v_target_user_id,
            (p_data->>'date')::DATE,
            p_data->>'session',
            p_data->>'type',
            COALESCE(NULLIF(p_data->>'status', ''), 'pending'),
            COALESCE(p_data->>'late_reason', '-'),
            COALESCE((p_data->>'created_at')::TIMESTAMPTZ, timezone('utc'::text, now()))
        )
        ON CONFLICT (id) DO UPDATE SET
            teacher_id = EXCLUDED.teacher_id,
            date = EXCLUDED.date,
            session = EXCLUDED.session,
            type = EXCLUDED.type,
            status = EXCLUDED.status,
            late_reason = EXCLUDED.late_reason;

    ELSIF p_table = 'records' THEN
        INSERT INTO public.records (
            id, student_id, date, type, surah, ayah_start, ayah_end, grade, notes, class, created_at
        ) VALUES (
            p_data->>'id',
            split_part(trim(COALESCE(p_data->>'student_id', '')), ' | ', 1),
            (p_data->>'date')::DATE,
            p_data->>'type',
            p_data->>'surah',
            COALESCE((p_data->>'ayah_start')::INTEGER, 0),
            COALESCE((p_data->>'ayah_end')::INTEGER, 0),
            p_data->>'grade',
            NULLIF(p_data->>'notes', ''),
            NULLIF(p_data->>'class', ''),
            COALESCE((p_data->>'created_at')::TIMESTAMPTZ, timezone('utc'::text, now()))
        )
        ON CONFLICT (id) DO UPDATE SET
            student_id = EXCLUDED.student_id,
            date = EXCLUDED.date,
            type = EXCLUDED.type,
            surah = EXCLUDED.surah,
            ayah_start = EXCLUDED.ayah_start,
            ayah_end = EXCLUDED.ayah_end,
            grade = EXCLUDED.grade,
            notes = EXCLUDED.notes,
            class = EXCLUDED.class;

    ELSIF p_table = 'exams' THEN
        INSERT INTO public.exams (
            id, student_id, student_name, date, category, score, examiner, status, notes, juz, class, details, created_at
        ) VALUES (
            p_data->>'id',
            split_part(trim(COALESCE(p_data->>'student_id', '')), ' | ', 1),
            p_data->>'student_name',
            (p_data->>'date')::DATE,
            p_data->>'category',
            COALESCE((p_data->>'score')::NUMERIC, 0),
            p_data->>'examiner',
            p_data->>'status',
            NULLIF(p_data->>'notes', ''),
            NULLIF(p_data->>'juz', ''),
            NULLIF(p_data->>'class', ''),
            p_data->'details',
            COALESCE((p_data->>'created_at')::TIMESTAMPTZ, timezone('utc'::text, now()))
        )
        ON CONFLICT (id) DO UPDATE SET
            student_id = EXCLUDED.student_id,
            student_name = COALESCE(EXCLUDED.student_name, public.exams.student_name),
            date = EXCLUDED.date,
            category = EXCLUDED.category,
            score = EXCLUDED.score,
            examiner = EXCLUDED.examiner,
            status = EXCLUDED.status,
            notes = EXCLUDED.notes,
            juz = EXCLUDED.juz,
            class = EXCLUDED.class,
            details = EXCLUDED.details;

    ELSIF p_table = 'students' THEN
        INSERT INTO public.students (
            id, name, nis, class, halaqah, teacher_id, total_juz, username, password, created_at
        ) VALUES (
            p_data->>'id',
            p_data->>'name',
            p_data->>'nis',
            p_data->>'class',
            p_data->>'halaqah',
            NULLIF(split_part(trim(COALESCE(p_data->>'teacher_id', '')), ' | ', 1), ''),
            COALESCE((p_data->>'total_juz')::NUMERIC, 0),
            COALESCE(NULLIF(p_data->>'username', ''), p_data->>'nis'),
            CASE
                WHEN COALESCE(NULLIF(p_data->>'password', ''), '') LIKE '$2%' THEN p_data->>'password'
                ELSE crypt(COALESCE(NULLIF(p_data->>'password', ''), p_data->>'nis', '123'), gen_salt('bf'))
            END,
            COALESCE((p_data->>'created_at')::TIMESTAMPTZ, timezone('utc'::text, now()))
        )
        ON CONFLICT (id) DO UPDATE SET
            name = COALESCE(NULLIF(EXCLUDED.name, ''), public.students.name),
            nis = COALESCE(NULLIF(EXCLUDED.nis, ''), public.students.nis),
            class = COALESCE(NULLIF(EXCLUDED.class, ''), public.students.class),
            halaqah = COALESCE(NULLIF(EXCLUDED.halaqah, ''), public.students.halaqah),
            teacher_id = COALESCE(EXCLUDED.teacher_id, public.students.teacher_id),
            total_juz = COALESCE(EXCLUDED.total_juz, public.students.total_juz),
            username = COALESCE(NULLIF(EXCLUDED.username, ''), public.students.username),
            password = CASE
                WHEN NULLIF(p_data->>'password', '') IS NULL THEN public.students.password
                WHEN (p_data->>'password') LIKE '$2%' THEN p_data->>'password'
                ELSE crypt(p_data->>'password', gen_salt('bf'))
            END;

    ELSIF p_table = 'users' THEN
        INSERT INTO public.users (
            id, name, role, username, password, phone_number, child_id, email, avatar, gender, created_at
        ) VALUES (
            p_data->>'id',
            p_data->>'name',
            p_data->>'role',
            p_data->>'username',
            CASE
                WHEN COALESCE(NULLIF(p_data->>'password', ''), '') LIKE '$2%' THEN p_data->>'password'
                ELSE crypt(COALESCE(NULLIF(p_data->>'password', ''), '123'), gen_salt('bf'))
            END,
            NULLIF(p_data->>'phone_number', ''),
            NULLIF(p_data->>'child_id', ''),
            NULLIF(p_data->>'email', ''),
            NULLIF(p_data->>'avatar', ''),
            NULLIF(p_data->>'gender', ''),
            COALESCE((p_data->>'created_at')::TIMESTAMPTZ, timezone('utc'::text, now()))
        )
        ON CONFLICT (id) DO UPDATE SET
            name = COALESCE(NULLIF(EXCLUDED.name, ''), public.users.name),
            role = COALESCE(NULLIF(EXCLUDED.role, ''), public.users.role),
            username = COALESCE(NULLIF(EXCLUDED.username, ''), public.users.username),
            password = CASE
                WHEN NULLIF(p_data->>'password', '') IS NULL THEN public.users.password
                WHEN (p_data->>'password') LIKE '$2%' THEN p_data->>'password'
                ELSE crypt(p_data->>'password', gen_salt('bf'))
            END,
            phone_number = EXCLUDED.phone_number,
            child_id = EXCLUDED.child_id,
            email = EXCLUDED.email,
            avatar = EXCLUDED.avatar,
            gender = COALESCE(EXCLUDED.gender, public.users.gender);
    ELSE
        RETURN json_build_object('success', false, 'message', 'Nama tabel tidak valid.');
    END IF;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;


-- ==============================================================================
-- 2. PERBAIKAN RPC: admin_bulk_open_attendance & admin_bulk_revoke_attendance
--    (Mendukung Session Token melalui validate_session_or_credential)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.admin_bulk_open_attendance(
    p_username TEXT,
    p_password TEXT,
    p_teacher_id TEXT,
    p_start_date DATE,
    p_end_date DATE,
    p_session TEXT,
    p_type TEXT,
    p_reason TEXT
)
RETURNS JSON AS $$
DECLARE
    v_auth RECORD;
    v_teacher RECORD;
    v_curr_date DATE;
    v_sess TEXT;
    v_count INT := 0;
    v_req_id TEXT;
BEGIN
    SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau kredensial salah.');
    END IF;

    IF v_auth.out_role <> 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuka akses absensi santri/guru massal.');
    END IF;

    IF p_start_date > p_end_date THEN
        RETURN json_build_object('success', false, 'message', 'Tanggal mulai tidak boleh melebihi tanggal selesai.');
    END IF;

    FOR v_curr_date IN SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date LOOP
        FOR v_sess IN SELECT UNNEST(CASE WHEN p_session = 'all' THEN ARRAY['pagi', 'malam'] ELSE ARRAY[p_session] END) LOOP
            IF p_teacher_id = 'ALL' THEN
                FOR v_teacher IN SELECT id FROM users WHERE role = 'teacher' LOOP
                    v_req_id := 'req_' || v_teacher.id || '_' || v_curr_date::text || '_' || v_sess || '_' || p_type;
                    INSERT INTO attendance_open_requests (id, teacher_id, date, session, type, status, late_reason, created_at)
                    VALUES (v_req_id, v_teacher.id, v_curr_date, v_sess, p_type, 'approved', COALESCE(NULLIF(p_reason, ''), 'Dibuka oleh Admin'), now())
                    ON CONFLICT (id) DO UPDATE SET
                        status = 'approved',
                        late_reason = EXCLUDED.late_reason;
                    v_count := v_count + 1;
                END LOOP;
            ELSE
                v_req_id := 'req_' || p_teacher_id || '_' || v_curr_date::text || '_' || v_sess || '_' || p_type;
                INSERT INTO attendance_open_requests (id, teacher_id, date, session, type, status, late_reason, created_at)
                VALUES (v_req_id, p_teacher_id, v_curr_date, v_sess, p_type, 'approved', COALESCE(NULLIF(p_reason, ''), 'Dibuka oleh Admin'), now())
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

CREATE OR REPLACE FUNCTION public.admin_bulk_revoke_attendance(
    p_username TEXT,
    p_password TEXT,
    p_request_ids TEXT[]
)
RETURNS JSON AS $$
DECLARE
    v_auth RECORD;
    v_deleted_count INT := 0;
BEGIN
    SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau kredensial salah.');
    END IF;

    IF v_auth.out_role <> 'admin' THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;


-- ==============================================================================
-- 3. PERBARUI RPC: get_tahsin_sessions_secure
--    (Tetap Pure Owner-First + Menyertakan Riwayat Audit Log Perubahan Nilai)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_tahsin_sessions_secure(
    p_username TEXT,
    p_password TEXT,
    p_period_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_auth RECORD;
    v_result JSON;
BEGIN
    SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau kredensial salah.');
    END IF;

    IF v_auth.out_role != 'admin' THEN
        SELECT COALESCE(json_agg(
            json_build_object(
                'id', s.id,
                'periodId', s.period_id,
                'studentId', s.student_id,
                'examinerId', s.examiner_id,
                'studentNameSnapshot', s.student_name_snapshot,
                'classSnapshot', s.class_snapshot,
                'halaqahSnapshot', s.halaqah_snapshot,
                'targetJuzStart', s.target_juz_start,
                'targetJuzEnd', s.target_juz_end,
                'status', s.status,
                'finalScore', s.final_score,
                'predikat', s.predikat,
                'finalStatus', s.final_status,
                'latestAttemptNumber', s.latest_attempt_number,
                'version', s.version,
                'lastUpdatedBy', s.last_updated_by,
                'syncStatus', s.sync_status,
                'createdAt', s.created_at,
                'updatedAt', s.updated_at,
                'attempts', (
                    SELECT COALESCE(json_agg(row_to_json(a.*) ORDER BY a.attempt_number ASC), '[]'::json)
                    FROM tahsin_attempts a WHERE a.session_id = s.id
                ),
                'auditLogs', (
                    SELECT COALESCE(json_agg(
                        json_build_object(
                            'id', al.id,
                            'sessionId', al.session_id,
                            'attemptId', al.attempt_id,
                            'changedBy', al.changed_by,
                            'changedByName', COALESCE(u.name, al.changed_by),
                            'changeType', al.change_type,
                            'oldScore', al.old_score,
                            'newScore', al.new_score,
                            'oldStatus', al.old_status,
                            'newStatus', al.new_status,
                            'reason', al.reason,
                            'createdAt', al.created_at
                        ) ORDER BY al.created_at DESC
                    ), '[]'::json)
                    FROM tahsin_audit_logs al
                    LEFT JOIN users u ON u.id = al.changed_by
                    WHERE al.session_id = s.id
                )
            )
        ), '[]'::json) INTO v_result
        FROM tahsin_sessions s
        WHERE s.period_id = p_period_id
          AND EXISTS (
              SELECT 1 FROM students st
              WHERE st.id = s.student_id AND st.teacher_id = v_auth.out_user_id
          );
    ELSE
        SELECT COALESCE(json_agg(
            json_build_object(
                'id', s.id,
                'periodId', s.period_id,
                'studentId', s.student_id,
                'examinerId', s.examiner_id,
                'studentNameSnapshot', s.student_name_snapshot,
                'classSnapshot', s.class_snapshot,
                'halaqahSnapshot', s.halaqah_snapshot,
                'targetJuzStart', s.target_juz_start,
                'targetJuzEnd', s.target_juz_end,
                'status', s.status,
                'finalScore', s.final_score,
                'predikat', s.predikat,
                'finalStatus', s.final_status,
                'latestAttemptNumber', s.latest_attempt_number,
                'version', s.version,
                'lastUpdatedBy', s.last_updated_by,
                'syncStatus', s.sync_status,
                'createdAt', s.created_at,
                'updatedAt', s.updated_at,
                'attempts', (
                    SELECT COALESCE(json_agg(row_to_json(a.*) ORDER BY a.attempt_number ASC), '[]'::json)
                    FROM tahsin_attempts a WHERE a.session_id = s.id
                ),
                'auditLogs', (
                    SELECT COALESCE(json_agg(
                        json_build_object(
                            'id', al.id,
                            'sessionId', al.session_id,
                            'attemptId', al.attempt_id,
                            'changedBy', al.changed_by,
                            'changedByName', COALESCE(u.name, al.changed_by),
                            'changeType', al.change_type,
                            'oldScore', al.old_score,
                            'newScore', al.new_score,
                            'oldStatus', al.old_status,
                            'newStatus', al.new_status,
                            'reason', al.reason,
                            'createdAt', al.created_at
                        ) ORDER BY al.created_at DESC
                    ), '[]'::json)
                    FROM tahsin_audit_logs al
                    LEFT JOIN users u ON u.id = al.changed_by
                    WHERE al.session_id = s.id
                )
            )
        ), '[]'::json) INTO v_result
        FROM tahsin_sessions s
        WHERE s.period_id = p_period_id;
    END IF;

    RETURN json_build_object(
        'success', true,
        'data', COALESCE(v_result, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;


-- ==============================================================================
-- 4. PERBARUI RPC: save_tahsin_attempt_secure
--    - Mendukung Pemeriksaan Idempoten (Mencegah duplikasi saat retry pasca-timeout)
--    - Mendukung Toleransi Versi Draft -> Finalize untuk Guru Pemilik yang Sama
--    - Mendukung Fitur Edit Nilai (Revisi Nilai yang Sudah Disahkan) dengan:
--      * Otorisasi Pure Owner-First (students.teacher_id = v_user.id) atau Admin
--      * Kewajiban mengisi alasan perubahan (p_reason)
--      * Penolakan otomatis bagi guru pada periode tertutup (status != 'active')
--      * Optimistic Locking ketat (mencegah 2 perangkat saling menimpa revisi)
--      * Pencatatan riwayat nilai lama & baru di tahsin_audit_logs (revision_score)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.save_tahsin_attempt_secure(
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
    v_auth RECORD;
    v_user RECORD;
    v_session RECORD;
    v_existing_attempt RECORD;
    v_period RECORD;
    v_student RECORD;
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
    v_is_revision BOOLEAN := FALSE;
    v_old_attempt_score NUMERIC;
    v_old_attempt_status TEXT;
    v_audit_reason TEXT;
BEGIN
    -- 1. Autentikasi Pengguna Otoritatif via Session Token / Password
    SELECT * INTO v_auth FROM validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'conflict', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau kredensial salah.');
    END IF;

    SELECT * INTO v_user FROM users WHERE id = v_auth.out_user_id;

    -- 2. Ambil dan Kunci Baris Sesi Ujian (Row-level lock FOR UPDATE)
    SELECT * INTO v_session FROM tahsin_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
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

        -- C. Verifikasi Kewenangan Penguji Owner-First Murni (Jika Bukan Admin)
        IF v_user.role != 'admin' THEN
            IF v_student.teacher_id != v_user.id THEN
                RETURN json_build_object(
                    'success', false, 'conflict', false,
                    'message', 'Akses ditolak: Anda hanya berwenang menguji santri binaan halaqah Anda sendiri. Santri ini berada di bawah bimbingan guru lain (' || COALESCE(v_student.halaqah, 'halaqah lain') || ').'
                );
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

        -- E. Buat Baris Sesi Otoritatif dari Data Server
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
    ELSE
        SELECT * INTO v_period FROM tahsin_periods WHERE id = v_session.period_id;
        SELECT * INTO v_student FROM students WHERE id = v_session.student_id;
    END IF;

    -- 3. Otorisasi Penguji pada Sesi Yang Sudah Ada (Pure Owner-First berdasarkan students.teacher_id)
    IF v_user.role != 'admin' THEN
        IF v_student.teacher_id != v_user.id THEN
            RETURN json_build_object(
                'success', false, 'conflict', false,
                'message', 'Akses ditolak: Anda bukan guru pembimbing halaqah yang berwenang untuk santri ini.'
            );
        END IF;
    END IF;

    -- 4. Ekstraksi & Perhitungan Otoritatif Nilai serta Status Kelulusan (KKM 70)
    v_score := ROUND((
        COALESCE((p_attempt_data->'makharij'->>'score')::NUMERIC, 70) * 0.35 +
        COALESCE((p_attempt_data->'tajwid'->>'score')::NUMERIC, 70) * 0.30 +
        COALESCE((p_attempt_data->'kelancaran'->>'score')::NUMERIC, 70) * 0.20 +
        COALESCE((p_attempt_data->'waqaf'->>'score')::NUMERIC, 70) * 0.15
    )::NUMERIC, 2);

    IF v_score >= 90 THEN
        v_predikat := 'Mumtaz';
    ELSIF v_score >= 80 THEN
        v_predikat := 'Jayyid Jiddan';
    ELSIF v_score >= 70 THEN
        v_predikat := 'Jayyid';
    ELSIF v_score >= 60 THEN
        v_predikat := 'Maqbul';
    ELSE
        v_predikat := 'Perlu Pembinaan';
    END IF;

    v_attempt_number := COALESCE((p_attempt_data->>'attemptNumber')::INTEGER, 1);
    v_attempt_type := COALESCE(p_attempt_data->>'attemptType', 'utama');

    IF v_attempt_type = 'utama' AND v_attempt_number > 1 THEN
        v_attempt_type := 'remedial';
    END IF;

    IF v_score < COALESCE(v_period.passing_grade, 70)
       OR COALESCE((p_attempt_data->'makharij'->>'score')::NUMERIC, 0) < COALESCE(v_period.min_makharij, 70)
       OR COALESCE((p_attempt_data->'tajwid'->>'score')::NUMERIC, 0) < COALESCE(v_period.min_tajwid, 70)
       OR COALESCE((p_attempt_data->>'hasCriticalError')::BOOLEAN, FALSE) = TRUE THEN
        v_passing_status := 'remedial';
    ELSE
        v_passing_status := 'lulus';
    END IF;

    -- 5. Cek Apakah Attempt Ini Sudah Ada di Server (Berdasarkan ID atau (session_id, attempt_number))
    SELECT * INTO v_existing_attempt
    FROM tahsin_attempts
    WHERE id = p_attempt_id
       OR (session_id = v_session.id AND attempt_number = v_attempt_number)
    ORDER BY CASE WHEN id = p_attempt_id THEN 0 ELSE 1 END
    LIMIT 1;

    -- 5A. Pemeriksaan Idempoten untuk Auto-Sync Retry:
    -- Jika attempt dengan skor yang sama sudah berstatus finalized di server dan TIDAK ada alasan revisi (bukan Edit Nilai),
    -- berarti request sebelumnya sebenarnya sudah berhasil di server sebelum koneksi terputus.
    IF FOUND AND v_existing_attempt.status = 'finalized' AND (p_reason IS NULL OR trim(p_reason) = '') THEN
        IF v_existing_attempt.examiner_id = v_user.id AND ABS(COALESCE(v_existing_attempt.final_score, 0) - v_score) < 0.01 THEN
            RETURN json_build_object(
                'success', true,
                'conflict', false,
                'idempotent', true,
                'session_id', v_session.id,
                'attempt_id', v_existing_attempt.id,
                'version', v_session.version,
                'server_version', v_session.version,
                'final_score', v_existing_attempt.final_score,
                'passing_status', v_session.final_status,
                'message', 'Nilai ujian Tahsin telah tersimpan di server (terverifikasi secara idempoten).'
            );
        END IF;
    END IF;

    -- 6. Deteksi Konflik Konkurensi (Optimistic Locking)
    -- Jika sesi di server sudah memiliki nilai resmi (completed / remedial_needed),
    -- wajib cek kesesuaian versi secara ketat agar 2 perangkat tidak saling menimpa!
    IF v_session.status IN ('completed', 'remedial_needed') OR (FOUND AND v_existing_attempt.status = 'finalized') THEN
        IF p_expected_version IS NOT NULL AND p_expected_version > 0 AND v_session.version != p_expected_version THEN
            RETURN json_build_object(
                'success', false,
                'conflict', true,
                'server_version', v_session.version,
                'last_updated_by', v_session.last_updated_by,
                'message', 'Konflik konkurensi terdeteksi: Data nilai santri ini telah diperbarui pada perangkat lain (Versi Server: ' || v_session.version || '). Silakan muat ulang data terbaru sebelum mengubah nilai.'
            );
        END IF;
    ELSE
        -- Jika sesi di server masih berstatus draft / not_started dan diubah oleh penguji berbeda
        IF p_expected_version IS NOT NULL AND p_expected_version > 0 AND v_session.version > p_expected_version AND v_session.last_updated_by IS DISTINCT FROM v_user.id THEN
            RETURN json_build_object(
                'success', false,
                'conflict', true,
                'server_version', v_session.version,
                'last_updated_by', v_session.last_updated_by,
                'message', 'Konflik konkurensi terdeteksi: Sesi santri ini telah diubah oleh pengguna lain.'
            );
        END IF;
    END IF;

    -- 7. Validasi Khusus Mode Revisi ("Edit Nilai") vs Percobaan Remedial Baru
    IF FOUND AND v_existing_attempt.status = 'finalized' THEN
        -- Ini adalah koreksi/edit terhadap attempt yang sudah disahkan (bukan attempt remedial baru)
        v_is_revision := TRUE;
        v_old_attempt_score := v_existing_attempt.final_score;
        v_old_attempt_status := v_existing_attempt.passing_status;

        -- Kebijakan Periode Tertutup: Guru tidak boleh mengedit nilai jika periode sudah ditutup tanpa persetujuan/kewenangan Admin
        IF v_period.status != 'active' AND v_user.role != 'admin' THEN
            RETURN json_build_object(
                'success', false,
                'conflict', false,
                'message', 'Periode ujian telah ditutup. Perubahan atau koreksi nilai pada periode tertutup memerlukan persetujuan Admin.'
            );
        END IF;

        -- Wajib mengisi alasan perubahan nilai (p_reason)
        IF p_reason IS NULL OR trim(p_reason) = '' THEN
            RETURN json_build_object(
                'success', false,
                'conflict', false,
                'message', 'Alasan perubahan nilai wajib diisi untuk mengoreksi hasil ujian yang telah disahkan.'
            );
        END IF;
    ELSE
        -- Ini adalah pengesahan baru (utama atau remedial baru)
        IF v_period.status != 'active' AND v_user.role != 'admin' THEN
            RETURN json_build_object(
                'success', false,
                'conflict', false,
                'message', 'Periode ujian belum aktif atau telah ditutup. Pengesahan nilai ditolak.'
            );
        END IF;

        -- Jika santri sudah LULUS dan ada percobaan remedial baru (attempt_number > existing), hanya Admin yang boleh membuka ujian ulang
        IF v_session.final_status = 'lulus' AND v_attempt_type = 'remedial' AND NOT (FOUND AND v_existing_attempt.id = p_attempt_id) THEN
            IF v_user.role != 'admin' THEN
                RETURN json_build_object(
                    'success', false,
                    'conflict', false,
                    'message', 'Santri telah dinyatakan LULUS pada ujian sebelumnya. Ujian remedial baru hanya dapat dibuka oleh Admin.'
                );
            ELSIF p_reason IS NULL OR trim(p_reason) = '' THEN
                RETURN json_build_object(
                    'success', false,
                    'conflict', false,
                    'message', 'Wewenang Admin: Ujian ulang untuk santri yang sudah lulus wajib menyertakan alasan tertulis.'
                );
            END IF;
        END IF;
    END IF;

    -- 8. Upsert Percobaan Ujian (tahsin_attempts)
    INSERT INTO tahsin_attempts (
        id, session_id, attempt_number, attempt_type, examiner_id, examiner_name_snapshot,
        exam_date, start_surah, start_ayah, end_surah, end_ayah, start_page, end_page,
        pages_read, surah_name_display, randomize_reason, score_makharij, category_makharij,
        score_tajwid, category_tajwid, score_kelancaran, category_kelancaran, score_waqaf,
        category_waqaf, final_score, predikat, has_critical_error, critical_error_reason,
        passing_status, error_counts, coaching_notes, status, version, finalized_at,
        created_at, updated_at
    ) VALUES (
        COALESCE(v_existing_attempt.id, p_attempt_id),
        v_session.id,
        v_attempt_number,
        v_attempt_type,
        COALESCE(v_existing_attempt.examiner_id, v_user.id),
        COALESCE(v_existing_attempt.examiner_name_snapshot, v_user.name),
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
        COALESCE((p_attempt_data->'makharij'->>'score')::NUMERIC, 70),
        COALESCE(p_attempt_data->'makharij'->>'category', 'cukup'),
        COALESCE((p_attempt_data->'tajwid'->>'score')::NUMERIC, 70),
        COALESCE(p_attempt_data->'tajwid'->>'category', 'cukup'),
        COALESCE((p_attempt_data->'kelancaran'->>'score')::NUMERIC, 70),
        COALESCE(p_attempt_data->'kelancaran'->>'category', 'cukup'),
        COALESCE((p_attempt_data->'waqaf'->>'score')::NUMERIC, 70),
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
        CASE WHEN p_is_finalize THEN COALESCE(v_existing_attempt.finalized_at, timezone('utc'::text, now())) ELSE NULL END,
        COALESCE(v_existing_attempt.created_at, timezone('utc'::text, now())),
        timezone('utc'::text, now())
    )
    ON CONFLICT (session_id, attempt_number) DO UPDATE SET
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
        finalized_at = COALESCE(tahsin_attempts.finalized_at, EXCLUDED.finalized_at),
        updated_at = timezone('utc'::text, now());

    -- 9. Sinkronisasi Ringkasan Nilai ke Baris Sesi
    v_new_version := v_session.version + 1;
    IF p_is_finalize THEN
        v_session_status := CASE WHEN v_passing_status = 'lulus' THEN 'completed' ELSE 'remedial_needed' END;
        v_final_status := v_passing_status;
    ELSE
        v_session_status := CASE WHEN v_session.status = 'not_started' THEN 'draft' ELSE v_session.status END;
        v_final_status := COALESCE(v_session.final_status, 'belum_selesai');
    END IF;

    -- Jika ini adalah revisi pada attempt lama sedangkan sudah ada attempt remedial yang lebih baru,
    -- hanya perbarui ringkasan sesi apabila attempt yang diedit adalah attempt terbaru
    IF NOT v_is_revision OR v_attempt_number >= COALESCE(v_session.latest_attempt_number, 1) THEN
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
        WHERE id = v_session.id;
    ELSE
        UPDATE tahsin_sessions SET
            version = v_new_version,
            last_updated_by = v_user.id,
            updated_at = timezone('utc'::text, now())
        WHERE id = v_session.id;
    END IF;

    -- 10. Catat Audit Log Lengkap (Menyimpan Nilai Lama, Nilai Baru, Status, Alasan, dan Detail Aspek)
    IF v_is_revision THEN
        v_audit_reason := trim(p_reason) ||
            ' [Oleh: ' || v_user.name ||
            ' | Skor Lama: ' || COALESCE(v_old_attempt_score::text, '-') ||
            ' (M:' || COALESCE(v_existing_attempt.score_makharij::text, '-') ||
            ', T:' || COALESCE(v_existing_attempt.score_tajwid::text, '-') ||
            ', K:' || COALESCE(v_existing_attempt.score_kelancaran::text, '-') ||
            ', W:' || COALESCE(v_existing_attempt.score_waqaf::text, '-') ||
            ') -> Skor Baru: ' || v_score::text ||
            ' (M:' || COALESCE((p_attempt_data->'makharij'->>'score'), '-') ||
            ', T:' || COALESCE((p_attempt_data->'tajwid'->>'score'), '-') ||
            ', K:' || COALESCE((p_attempt_data->'kelancaran'->>'score'), '-') ||
            ', W:' || COALESCE((p_attempt_data->'waqaf'->>'score'), '-') || ')]';
    ELSE
        v_audit_reason := p_reason;
    END IF;

    INSERT INTO tahsin_audit_logs (
        id, session_id, attempt_id, changed_by, change_type,
        old_score, new_score, old_status, new_status, reason, created_at
    ) VALUES (
        'tal_' || gen_random_uuid()::text,
        v_session.id,
        COALESCE(v_existing_attempt.id, p_attempt_id),
        v_user.id,
        CASE
            WHEN v_is_revision THEN 'revision_score'
            WHEN p_is_finalize AND v_attempt_type = 'remedial' THEN 'remedial_attempt'
            WHEN p_is_finalize THEN 'finalize_attempt'
            ELSE 'save_draft'
        END,
        CASE WHEN v_is_revision THEN v_old_attempt_score ELSE v_session.final_score END,
        v_score,
        CASE WHEN v_is_revision THEN v_old_attempt_status ELSE v_session.final_status END,
        v_passing_status,
        v_audit_reason,
        timezone('utc'::text, now())
    );

    RETURN json_build_object(
        'success', true,
        'conflict', false,
        'is_revision', v_is_revision,
        'session_id', v_session.id,
        'attempt_id', COALESCE(v_existing_attempt.id, p_attempt_id),
        'version', v_new_version,
        'server_version', v_new_version,
        'final_score', v_score,
        'predikat', v_predikat,
        'passing_status', v_passing_status,
        'updated_by_id', v_user.id,
        'updated_by_name', v_user.name,
        'updated_at', timezone('utc'::text, now()),
        'message', CASE
            WHEN v_is_revision THEN 'Perubahan nilai Ujian Tahsin berhasil disimpan dan tercatat pada log audit server.'
            WHEN p_is_finalize THEN 'Nilai ujian Tahsin berhasil disahkan dan tersimpan di server.'
            ELSE 'Draft ujian berhasil disimpan di server.'
        END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

-- 5. GRANTS
GRANT EXECUTE ON FUNCTION public.upsert_data(text, text, text, jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_open_attendance(text, text, text, date, date, text, text, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_bulk_revoke_attendance(text, text, text[]) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_tahsin_sessions_secure(text, text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.save_tahsin_attempt_secure(text, text, text, text, integer, boolean, jsonb, text) TO authenticated, anon;

COMMIT;
