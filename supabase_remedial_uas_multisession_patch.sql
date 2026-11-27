-- ============================================================================
-- SITA DARUL ABROR — PATCH REMEDIAL UAS MULTI-SESI & PERBAIKAN ARAH MATERI
-- ============================================================================
-- Sifat: ADDITIVE & IDEMPOTENT (CREATE OR REPLACE FUNCTION saja; tanpa mengubah
--        struktur tabel, tanpa menghapus data, tanpa mengubah nilai ujian).
--
-- Tujuan:
-- 1. Mendukung generate paket soal remedial UAS untuk santri dengan multi-sesi
--    UAS (exam_uas_sessions > 1), menggunakan rata-rata nilai UAS lintas sesi
--    sebagai dasar kelayakan remedial (< KKM), anti-reuse lintas seluruh sesi
--    original, serta resolusi/sinkronisasi snapshot materi terfinalisasi.
-- 2. Memperbaiki validasi arah materi (Gate 18 UTS & Gate 19 UAS) agar arah
--    'single_surah' dan NULL tidak salah masuk ke cabang 'backward'.
-- 3. Memperbarui get_examiner_remedial_students agar menampilkan originalScore
--    berupa rata-rata multi-sesi UAS (konsisten dengan Rekap Semester).
-- 4. Menambahkan RPC get_student_uas_original_questions untuk mengumpulkan
--    seluruh butir soal UAS original lintas sesi guna anti-reuse di frontend.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RPC HELPER: get_student_uas_original_questions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_uas_original_questions(
    p_username text,
    p_password text,
    p_period_id text,
    p_student_id text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
    v_auth RECORD;
    v_questions JSONB;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa.');
    END IF;

    IF v_auth.out_role NOT IN ('admin', 'teacher') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
    END IF;

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_set_id, eq.question_number)
    INTO v_questions
    FROM public.exam_questions eq
    WHERE eq.question_set_id IN (
        SELECT DISTINCT a.question_set_id
        FROM public.exam_attempts a
        WHERE a.exam_period_id = p_period_id
          AND a.student_id = p_student_id
          AND a.status = 'submitted'
          AND a.question_set_id IS NOT NULL
        UNION
        SELECT DISTINCT s.question_set_id
        FROM public.exam_uas_sessions s
        WHERE s.exam_period_id = p_period_id
          AND s.student_id = p_student_id
          AND s.status = 'submitted'
          AND s.question_set_id IS NOT NULL
    );

    RETURN jsonb_build_object(
        'success', true,
        'questions', COALESCE(v_questions, '[]'::jsonb)
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. RPC: generate_uas_remedial_question_set (Support Multi-Sesi UAS + Legacy)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_uas_remedial_question_set(
    p_username text,
    p_password text,
    p_original_period_id text,
    p_student_id text,
    p_strategy text DEFAULT 'hybrid'::text,
    p_seed text DEFAULT NULL::text,
    p_fingerprint text DEFAULT NULL::text,
    p_questions jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_orig_attempt RECORD;
    v_snapshot RECORD;
    v_session RECORD;
    v_existing_set RECORD;
    v_session_id TEXT;
    v_set_id TEXT;
    v_calc_fingerprint TEXT;
    v_ret_questions JSONB;
    v_q_count INTEGER;
    v_q_elem JSONB;
    v_q_num INTEGER;
    v_q_role TEXT;
    v_q_score NUMERIC(5,2);
    v_q_zone INTEGER;
    v_q_source TEXT;
    v_q_bank_id TEXT;
    v_q_page INTEGER;
    v_ps_surah INTEGER;
    v_ps_ayah INTEGER;
    v_ps_word INTEGER;
    v_pe_surah INTEGER;
    v_pe_ayah INTEGER;
    v_pe_word INTEGER;
    v_as_surah INTEGER;
    v_as_ayah INTEGER;
    v_as_word INTEGER;
    v_ae_surah INTEGER;
    v_ae_ayah INTEGER;
    v_ae_word INTEGER;
    v_total_score NUMERIC(5,2) := 0;
    v_mandatory_count INTEGER := 0;
    v_random_count INTEGER := 0;
    v_used_zones INTEGER[] := '{}';
    v_used_mand_pages INTEGER[] := '{}';
    v_used_random_b TEXT[] := '{}';
    v_orig_mand_pages INTEGER[] := '{}';
    v_orig_random_b TEXT[] := '{}';
    v_orig_qb_ids TEXT[] := '{}';
    v_b_key TEXT;
    v_submitted_count INTEGER := 0;
    v_active_uas_sessions_count INTEGER := 0;
    v_submitted_uas_sessions_count INTEGER := 0;
    v_effective_uas_score NUMERIC(5,2);
    v_first_sess RECORD;
    v_last_sess RECORD;
    v_row RECORD;
BEGIN
    -- 1. Autentikasi Pengguna & Whitelist Role Admin
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN jsonb_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membangkitkan paket soal remedial UAS.');
    END IF;

    -- 2. Validasi Periode Original (Khusus UAS)
    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_original_period_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Periode ujian UAS tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uas' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Generator ini khusus untuk remedial ujian UAS.');
    END IF;

    -- 3. Deteksi Mode Multi-Sesi UAS vs Legacy Single-Session UAS
    SELECT
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE status = 'submitted')::int
    INTO v_active_uas_sessions_count, v_submitted_uas_sessions_count
    FROM public.exam_uas_sessions
    WHERE exam_period_id = p_original_period_id
      AND student_id = p_student_id
      AND status != 'void';

    IF v_active_uas_sessions_count > 0 THEN
        -- MODE MULTI-SESI UAS
        IF v_submitted_uas_sessions_count = 0 OR v_submitted_uas_sessions_count < v_active_uas_sessions_count THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Santri belum menyelesaikan seluruh sesi UAS original (' || v_submitted_uas_sessions_count || ' dari ' || v_active_uas_sessions_count || ' sesi selesai).'
            );
        END IF;

        -- Hitung rata-rata nilai UAS lintas sesi secara otoritatif
        SELECT ROUND(AVG(COALESCE(s.score, a.total_score)), 2)
        INTO v_effective_uas_score
        FROM public.exam_uas_sessions s
        LEFT JOIN public.exam_attempts a ON a.id = s.attempt_id AND a.status = 'submitted'
        WHERE s.exam_period_id = p_original_period_id
          AND s.student_id = p_student_id
          AND s.status = 'submitted';

        IF v_effective_uas_score IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', 'Nilai UAS multi-sesi santri tidak ditemukan.');
        END IF;

        IF v_effective_uas_score >= v_period.kkm THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Rata-rata nilai UAS santri (' || v_effective_uas_score || ') sudah mencapai KKM (' || v_period.kkm || '). Santri tidak berhak mengikuti remedial.'
            );
        END IF;

        -- Pilih attempt original representatif secara deterministik (nilai terendah, tie-break session_number ASC)
        SELECT a.* INTO v_orig_attempt
        FROM public.exam_uas_sessions s
        JOIN public.exam_attempts a
          ON (a.id = s.attempt_id OR (s.attempt_id IS NULL AND a.uas_session_id = s.id))
         AND a.status = 'submitted'
        WHERE s.exam_period_id = p_original_period_id
          AND s.student_id = p_student_id
          AND s.status = 'submitted'
        ORDER BY COALESCE(s.score, a.total_score) ASC, s.session_number ASC, a.submitted_at ASC NULLS LAST, a.id ASC
        LIMIT 1;

        IF NOT FOUND THEN
            SELECT a.* INTO v_orig_attempt
            FROM public.exam_attempts a
            WHERE a.exam_period_id = p_original_period_id
              AND a.student_id = p_student_id
              AND a.status = 'submitted'
            ORDER BY a.total_score ASC NULLS LAST, a.submitted_at ASC NULLS LAST, a.id ASC
            LIMIT 1;
        END IF;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', 'Attempt UAS original berstatus submitted tidak ditemukan untuk santri ini.');
        END IF;
    ELSE
        -- MODE LEGACY SINGLE-SESSION UAS (Proteksi Gate 9 tetap dipertahankan penuh)
        SELECT COUNT(*) INTO v_submitted_count
        FROM public.exam_attempts
        WHERE exam_period_id = p_original_period_id
          AND student_id = p_student_id
          AND status = 'submitted';

        IF v_submitted_count > 1 THEN
            RETURN jsonb_build_object('success', false, 'message', 'INTEGRITY_VIOLATION: Ditemukan lebih dari 1 attempt original berstatus submitted untuk santri ini (' || v_submitted_count || ' attempt). Pemilihan attempt tidak boleh ambigu (LIMIT 1 dilarang).');
        END IF;

        IF v_submitted_count = 0 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Santri belum menyelesaikan ujian UAS original.');
        END IF;

        SELECT * INTO v_orig_attempt
        FROM public.exam_attempts
        WHERE exam_period_id = p_original_period_id
          AND student_id = p_student_id
          AND status = 'submitted';

        v_effective_uas_score := v_orig_attempt.total_score;

        IF v_effective_uas_score >= v_period.kkm THEN
            RETURN jsonb_build_object('success', false, 'message', 'Nilai UAS santri (' || v_effective_uas_score || ') sudah mencapai KKM (' || v_period.kkm || '). Santri tidak berhak mengikuti remedial.');
        END IF;
    END IF;

    -- 4. Validasi / Resolusi Snapshot Materi Original: Wajib FINALIZED
    SELECT * INTO v_snapshot
    FROM public.exam_material_snapshots
    WHERE id = (
        SELECT material_snapshot_id FROM public.exam_question_sets WHERE id = v_orig_attempt.question_set_id
    );

    IF NOT FOUND THEN
        SELECT * INTO v_snapshot
        FROM public.exam_material_snapshots
        WHERE exam_period_id = p_original_period_id
          AND student_id = p_student_id
        LIMIT 1;
    END IF;

    -- Untuk Multi-Sesi UAS: jika snapshot belum ada atau belum finalized, sinkronkan dari sesi UAS submitted
    IF (NOT FOUND OR v_snapshot.status != 'finalized') AND v_active_uas_sessions_count > 0 THEN
        SELECT * INTO v_first_sess
        FROM public.exam_uas_sessions
        WHERE exam_period_id = p_original_period_id
          AND student_id = p_student_id
          AND status = 'submitted'
        ORDER BY start_surah ASC, start_ayah ASC
        LIMIT 1;

        SELECT * INTO v_last_sess
        FROM public.exam_uas_sessions
        WHERE exam_period_id = p_original_period_id
          AND student_id = p_student_id
          AND status = 'submitted'
        ORDER BY end_surah DESC, end_ayah DESC
        LIMIT 1;

        IF v_first_sess.id IS NOT NULL AND v_last_sess.id IS NOT NULL THEN
            IF v_snapshot.id IS NOT NULL THEN
                UPDATE public.exam_material_snapshots
                SET
                    start_surah = v_first_sess.start_surah,
                    start_ayah = v_first_sess.start_ayah,
                    end_surah = v_last_sess.end_surah,
                    end_ayah = v_last_sess.end_ayah,
                    start_page = v_first_sess.start_page,
                    end_page = v_last_sess.end_page,
                    start_juz = v_first_sess.juz_number,
                    end_juz = v_last_sess.juz_number,
                    memorization_direction = 'forward',
                    status = 'finalized',
                    finalized_by = COALESCE(finalized_by, v_user.id),
                    finalized_at = COALESCE(finalized_at, now()),
                    updated_at = now()
                WHERE id = v_snapshot.id
                RETURNING * INTO v_snapshot;
            ELSE
                INSERT INTO public.exam_material_snapshots (
                    id, exam_period_id, student_id, source_type,
                    start_surah, start_ayah, end_surah, end_ayah,
                    start_page, end_page, start_juz, end_juz,
                    memorization_direction, status,
                    finalized_by, finalized_at, created_at, updated_at
                ) VALUES (
                    'ems_uas_rem_' || p_original_period_id || '_' || p_student_id,
                    p_original_period_id, p_student_id, 'automatic',
                    v_first_sess.start_surah, v_first_sess.start_ayah,
                    v_last_sess.end_surah, v_last_sess.end_ayah,
                    v_first_sess.start_page, v_last_sess.end_page,
                    v_first_sess.juz_number, v_last_sess.juz_number,
                    'forward', 'finalized',
                    v_user.id, now(), now(), now()
                )
                RETURNING * INTO v_snapshot;
            END IF;
        END IF;
    END IF;

    IF v_snapshot.id IS NULL OR v_snapshot.status != 'finalized' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Snapshot materi UAS santri belum difinalisasi.');
    END IF;

    -- Hitung fingerprint
    v_calc_fingerprint := public.calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        COALESCE(v_snapshot.memorization_direction, 'forward')
    );

    -- Validasi Fingerprint (Gate 11)
    IF p_fingerprint IS NOT NULL AND p_fingerprint != '' AND p_fingerprint != v_calc_fingerprint THEN
        RETURN jsonb_build_object('success', false, 'message', 'Material fingerprint mismatch: Materi santri tidak sesuai.');
    END IF;

    -- 5. Ambil exclusion list dari SELURUH soal original UAS santri (Anti-Reuse lintas sesi)
    FOR v_row IN
        SELECT DISTINCT
            eq.question_role,
            eq.page_number,
            eq.answer_start_surah,
            eq.answer_start_ayah,
            eq.answer_start_word,
            eq.question_bank_id
        FROM public.exam_questions eq
        WHERE eq.question_set_id IN (
            SELECT DISTINCT a.question_set_id
            FROM public.exam_attempts a
            WHERE a.exam_period_id = p_original_period_id
              AND a.student_id = p_student_id
              AND a.status = 'submitted'
              AND a.question_set_id IS NOT NULL
            UNION
            SELECT DISTINCT s.question_set_id
            FROM public.exam_uas_sessions s
            WHERE s.exam_period_id = p_original_period_id
              AND s.student_id = p_student_id
              AND s.status = 'submitted'
              AND s.question_set_id IS NOT NULL
        )
    LOOP
        IF v_row.question_role = 'mandatory' AND v_row.page_number IS NOT NULL THEN
            v_orig_mand_pages := array_append(v_orig_mand_pages, v_row.page_number);
        ELSE
            v_orig_random_b := array_append(v_orig_random_b, v_row.answer_start_surah || ':' || v_row.answer_start_ayah || ':' || v_row.answer_start_word);
        END IF;
        IF v_row.question_bank_id IS NOT NULL THEN
            v_orig_qb_ids := array_append(v_orig_qb_ids, v_row.question_bank_id);
        END IF;
    END LOOP;

    -- 6. IDEMPOTENCY CHECK
    SELECT * INTO v_session
    FROM public.exam_remedial_sessions
    WHERE original_exam_period_id = p_original_period_id
      AND student_id = p_student_id;

    IF FOUND AND v_session.remedial_question_set_id IS NOT NULL THEN
        SELECT * INTO v_existing_set
        FROM public.exam_remedial_question_sets
        WHERE id = v_session.remedial_question_set_id
          AND status = 'locked';

        IF FOUND THEN
            SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
            INTO v_ret_questions
            FROM public.exam_remedial_questions eq
            WHERE eq.remedial_question_set_id = v_existing_set.id;

            RETURN jsonb_build_object(
                'success', true,
                'isExisting', true,
                'message', 'Paket soal UAS remedial sudah terkunci dan siap digunakan.',
                'remedialSession', row_to_json(v_session),
                'questionSet', row_to_json(v_existing_set),
                'questions', COALESCE(v_ret_questions, '[]'::jsonb)
            );
        END IF;
    END IF;

    -- 7. Validasi Struktur Paket 9 Soal (2 Wajib + 7 Acak)
    v_q_count := jsonb_array_length(p_questions);
    IF v_q_count != 9 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Paket soal UAS remedial harus memiliki tepat 9 butir soal (2 wajib + 7 acak). Diterima: ' || v_q_count);
    END IF;

    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        v_q_num := (v_q_elem->>'questionNumber')::INTEGER;
        v_q_role := COALESCE(v_q_elem->>'questionRole', v_q_elem->>'question_role');
        v_q_score := COALESCE((v_q_elem->>'maxScore')::NUMERIC, (v_q_elem->>'max_score')::NUMERIC, 0);
        v_q_zone := (v_q_elem->>'zoneNumber')::INTEGER;
        v_q_source := COALESCE(v_q_elem->>'sourceType', v_q_elem->>'source_type', 'auto');
        v_q_bank_id := NULLIF(v_q_elem->>'questionBankId', '');
        v_q_page := (v_q_elem->>'pageNumber')::INTEGER;

        v_as_surah := COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER);
        v_as_ayah := COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER);
        v_as_word := COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER);

        v_ae_surah := COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER);
        v_ae_ayah := COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER);
        v_ae_word := COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER);

        IF v_as_surah NOT BETWEEN 1 AND 114 OR v_as_ayah < 1 OR v_as_word < 1 OR
           v_ae_surah NOT BETWEEN 1 AND 114 OR v_ae_ayah < 1 OR v_ae_word < 1 THEN
            RETURN jsonb_build_object('success', false, 'message', 'Koordinat ayat/kata butir soal remedial ' || v_q_num || ' tidak valid.');
        END IF;

        IF (v_as_surah > v_ae_surah) OR
           (v_as_surah = v_ae_surah AND v_as_ayah > v_ae_ayah) OR
           (v_as_surah = v_ae_surah AND v_as_ayah = v_ae_ayah AND v_as_word > v_ae_word) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Urutan jawaban B ke C pada butir soal remedial ' || v_q_num || ' tidak valid.');
        END IF;

        v_total_score := v_total_score + v_q_score;

        -- Validasi Soal Wajib (Q1 & Q2)
        IF v_q_role = 'mandatory' THEN
            v_mandatory_count := v_mandatory_count + 1;

            IF v_q_num NOT IN (1, 2) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib UAS hanya boleh bernomor 1 atau 2.');
            END IF;

            IF v_q_score != 15 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal wajib remedial harus tepat 15. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NOT NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal wajib remedial tidak boleh memiliki zone_number.');
            END IF;

            IF v_q_page IS NULL OR v_q_page NOT BETWEEN 1 AND 604 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor halaman soal wajib remedial tidak valid (1-604).');
            END IF;

            IF v_q_page = ANY(v_orig_mand_pages) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Halaman wajib ' || v_q_page || ' telah digunakan pada UAS original (anti-reuse terlanggar).');
            END IF;

            IF v_q_bank_id IS NOT NULL AND v_q_bank_id = ANY(v_orig_qb_ids) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bank Soal butir wajib ' || v_q_num || ' telah digunakan pada UAS original (anti-reuse terlanggar).');
            END IF;

            IF v_q_page = ANY(v_used_mand_pages) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Kedua halaman soal wajib remedial harus berbeda (halaman duplikat: ' || v_q_page || ').');
            END IF;
            v_used_mand_pages := array_append(v_used_mand_pages, v_q_page);

        -- Validasi Soal Acak (Q3..Q9)
        ELSIF v_q_role = 'random' THEN
            v_random_count := v_random_count + 1;

            IF v_q_num NOT BETWEEN 3 AND 9 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak remedial harus bernomor 3 s.d. 9.');
            END IF;

            IF v_q_score != 10 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bobot nilai soal acak remedial harus tepat 10. Diterima: ' || v_q_score);
            END IF;

            IF v_q_zone IS NULL OR v_q_zone NOT BETWEEN 1 AND 7 THEN
                RETURN jsonb_build_object('success', false, 'message', 'Nomor zona soal acak remedial harus antara 1 dan 7.');
            END IF;

            IF v_q_zone = ANY(v_used_zones) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Setiap zona 1 s.d. 7 harus unik (duplikasi zona: ' || v_q_zone || ').');
            END IF;
            v_used_zones := array_append(v_used_zones, v_q_zone);

            v_ps_surah := (v_q_elem->'promptStart'->>'surahNumber')::INTEGER;
            v_ps_ayah := (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER;
            v_ps_word := (v_q_elem->'promptStart'->>'wordPosition')::INTEGER;

            v_pe_surah := (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER;
            v_pe_ayah := (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER;
            v_pe_word := (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER;

            IF v_ps_surah IS NULL OR v_pe_surah IS NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Soal acak remedial sambung ayat wajib memiliki prompt penguji A dan A-aksen.');
            END IF;

            IF (v_ps_surah > v_pe_surah) OR
               (v_ps_surah = v_pe_surah AND v_ps_ayah > v_pe_ayah) OR
               (v_ps_surah = v_pe_surah AND v_ps_ayah = v_pe_ayah AND v_ps_word > v_pe_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Urutan prompt A ke A-aksen soal remedial ' || v_q_num || ' tidak valid.');
            END IF;

            IF (v_pe_surah > v_as_surah) OR
               (v_pe_surah = v_as_surah AND v_pe_ayah > v_as_ayah) OR
               (v_pe_surah = v_as_surah AND v_pe_ayah = v_as_ayah AND v_pe_word >= v_as_word) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik B harus setelah A-aksen pada butir soal remedial ' || v_q_num || '.');
            END IF;

            -- Validasi Batas Snapshot Materi Santri (Gate 19 - mendukung forward, single_surah, NULL, dan backward)
            IF COALESCE(v_snapshot.memorization_direction, 'forward') != 'backward' THEN
                IF (v_ps_surah < v_snapshot.start_surah) OR
                   (v_ps_surah = v_snapshot.start_surah AND v_ps_ayah < v_snapshot.start_ayah) OR
                   (v_ae_surah > v_snapshot.end_surah) OR
                   (v_ae_surah = v_snapshot.end_surah AND v_ae_ayah > v_snapshot.end_ayah) THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Butir soal acak UAS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
                END IF;
            ELSE
                IF (v_ps_surah > v_snapshot.start_surah) OR
                   (v_ps_surah = v_snapshot.start_surah AND v_ps_ayah < v_snapshot.start_ayah) OR
                   (v_ae_surah < v_snapshot.end_surah) OR
                   (v_ae_surah = v_snapshot.end_surah AND v_ae_ayah > v_snapshot.end_ayah) THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Butir soal acak UAS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
                END IF;
            END IF;

            v_b_key := v_as_surah || ':' || v_as_ayah || ':' || v_as_word;

            IF v_b_key = ANY(v_orig_random_b) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal B butir soal acak ' || v_q_num || ' menduplikasi titik soal UAS original (anti-reuse terlanggar).');
            END IF;

            IF v_q_bank_id IS NOT NULL AND v_q_bank_id = ANY(v_orig_qb_ids) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Bank Soal butir acak ' || v_q_num || ' telah digunakan pada UAS original (anti-reuse terlanggar).');
            END IF;

            IF v_b_key = ANY(v_used_random_b) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Titik awal B soal acak remedial harus unik (duplikasi: ' || v_b_key || ').');
            END IF;
            v_used_random_b := array_append(v_used_random_b, v_b_key);
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Role soal remedial tidak valid: ' || v_q_role);
        END IF;
    END LOOP;

    IF v_mandatory_count != 2 OR v_random_count != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Struktur soal UAS remedial harus tepat 2 soal wajib dan 7 soal acak.');
    END IF;

    IF array_length(v_used_zones, 1) != 7 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Tepat 7 zona (Zona 1 s.d. 7) harus terpenuhi pada UAS remedial.');
    END IF;

    IF v_total_score != 100 THEN
        RETURN jsonb_build_object('success', false, 'message', 'Total bobot nilai UAS remedial harus tepat 100. Diterima: ' || v_total_score);
    END IF;

    -- 8. Eksekusi Atomik Penyimpanan Data Remedial UAS
    v_session_id := 'ers_' || p_original_period_id || '_' || p_student_id;
    v_set_id := 'erqs_' || p_original_period_id || '_' || p_student_id || '_v1';

    INSERT INTO public.exam_remedial_sessions (
        id, original_exam_period_id, student_id, exam_type,
        original_attempt_id, original_question_set_id, material_snapshot_id,
        status, generation_version, created_by, created_at, updated_at
    ) VALUES (
        v_session_id, p_original_period_id, p_student_id, 'uas',
        v_orig_attempt.id, v_orig_attempt.question_set_id, v_snapshot.id,
        'locked', 1, v_user.id, now(), now()
    )
    ON CONFLICT (original_exam_period_id, student_id) DO UPDATE SET
        original_attempt_id = EXCLUDED.original_attempt_id,
        original_question_set_id = EXCLUDED.original_question_set_id,
        material_snapshot_id = EXCLUDED.material_snapshot_id,
        status = 'locked',
        updated_at = now()
    RETURNING * INTO v_session;

    INSERT INTO public.exam_remedial_question_sets (
        id, remedial_session_id, original_exam_period_id, student_id, exam_type,
        material_snapshot_id, version, generation_strategy, generation_seed,
        material_fingerprint, status, generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_set_id, v_session.id, p_original_period_id, p_student_id, 'uas',
        v_snapshot.id, 1, COALESCE(p_strategy, 'hybrid'),
        COALESCE(p_seed, 'seed_uas_rem_' || p_student_id || '_' || extract(epoch from now())::text),
        v_calc_fingerprint, 'locked', v_user.id, now(), now(), now(), now()
    )
    RETURNING * INTO v_existing_set;

    UPDATE public.exam_remedial_sessions
    SET remedial_question_set_id = v_set_id, status = 'locked', updated_at = now()
    WHERE id = v_session.id
    RETURNING * INTO v_session;

    FOR v_q_elem IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        v_q_num := (v_q_elem->>'questionNumber')::INTEGER;
        v_q_role := COALESCE(v_q_elem->>'questionRole', v_q_elem->>'question_role');
        v_q_score := COALESCE((v_q_elem->>'maxScore')::NUMERIC, (v_q_elem->>'max_score')::NUMERIC);
        v_q_zone := (v_q_elem->>'zoneNumber')::INTEGER;
        v_q_source := COALESCE(v_q_elem->>'sourceType', v_q_elem->>'source_type', 'auto');
        v_q_bank_id := NULLIF(v_q_elem->>'questionBankId', '');
        v_q_page := (v_q_elem->>'pageNumber')::INTEGER;

        INSERT INTO public.exam_remedial_questions (
            id, remedial_question_set_id, question_number, zone_number, question_role,
            source_type, question_bank_id, page_number, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'erq_' || v_set_id || '_q' || v_q_num,
            v_set_id,
            v_q_num,
            v_q_zone,
            v_q_role,
            v_q_source,
            v_q_bank_id,
            v_q_page,
            v_q_score,
            CASE WHEN v_q_role = 'random' THEN (v_q_elem->'promptStart'->>'surahNumber')::INTEGER ELSE NULL END,
            CASE WHEN v_q_role = 'random' THEN (v_q_elem->'promptStart'->>'ayahNumber')::INTEGER ELSE NULL END,
            CASE WHEN v_q_role = 'random' THEN (v_q_elem->'promptStart'->>'wordPosition')::INTEGER ELSE NULL END,
            CASE WHEN v_q_role = 'random' THEN (v_q_elem->'promptEnd'->>'surahNumber')::INTEGER ELSE NULL END,
            CASE WHEN v_q_role = 'random' THEN (v_q_elem->'promptEnd'->>'ayahNumber')::INTEGER ELSE NULL END,
            CASE WHEN v_q_role = 'random' THEN (v_q_elem->'promptEnd'->>'wordPosition')::INTEGER ELSE NULL END,
            COALESCE((v_q_elem->'answerStart'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_start_surah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_start_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerStart'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_start_word')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'surahNumber')::INTEGER, (v_q_elem->>'answer_end_surah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'ayahNumber')::INTEGER, (v_q_elem->>'answer_end_ayah')::INTEGER),
            COALESCE((v_q_elem->'answerEnd'->>'wordPosition')::INTEGER, (v_q_elem->>'answer_end_word')::INTEGER),
            COALESCE((v_q_elem->>'startPage')::INTEGER, v_q_page),
            COALESCE((v_q_elem->>'endPage')::INTEGER, v_q_page),
            COALESCE(v_q_elem->'metadata', v_q_elem->'generatedMetadata', '{}'::jsonb),
            now()
        );
    END LOOP;

    SELECT jsonb_agg(row_to_json(eq.*) ORDER BY eq.question_number)
    INTO v_ret_questions
    FROM public.exam_remedial_questions eq
    WHERE eq.remedial_question_set_id = v_set_id;

    -- 9. Audit Log
    INSERT INTO public.exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_original_period_id,
        p_student_id,
        'remedial_question_set_generated',
        v_user.id,
        NULL,
        jsonb_build_object(
            'remedialSessionId', v_session.id,
            'remedialQuestionSetId', v_set_id,
            'originalAttemptId', v_orig_attempt.id,
            'originalQuestionSetId', v_orig_attempt.question_set_id,
            'effectiveOriginalScore', v_effective_uas_score,
            'multiSessionCount', v_submitted_uas_sessions_count,
            'kkm', v_period.kkm,
            'questionsCount', 9,
            'mandatoryPages', v_used_mand_pages,
            'fingerprint', v_calc_fingerprint,
            'status', 'locked'
        ),
        'Pembuatan otomatis 9 soal UAS remedial dengan proteksi anti-reuse',
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Berhasil membuat dan mengunci 9 butir soal UAS remedial.',
        'remedialSession', row_to_json(v_session),
        'questionSet', row_to_json(v_existing_set),
        'questions', COALESCE(v_ret_questions, '[]'::jsonb)
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. RPC: generate_uts_remedial_question_set (Fix Gate 18 single_surah/NULL)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_uts_remedial_question_set(
    p_username text,
    p_password text,
    p_original_period_id text,
    p_student_id text,
    p_strategy text,
    p_questions_data jsonb,
    p_seed text,
    p_fingerprint text
) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_period RECORD;
    v_snapshot RECORD;
    v_orig_attempt RECORD;
    v_session RECORD;
    v_existing_set RECORD;
    v_session_id TEXT;
    v_set_id TEXT;
    v_q JSONB;
    v_q_num INTEGER;
    v_z_num INTEGER;
    v_as_s INTEGER;
    v_as_a INTEGER;
    v_as_w INTEGER;
    v_ae_s INTEGER;
    v_ae_a INTEGER;
    v_ae_w INTEGER;
    v_ps_s INTEGER;
    v_ps_a INTEGER;
    v_ps_w INTEGER;
    v_pe_s INTEGER;
    v_pe_a INTEGER;
    v_pe_w INTEGER;
    v_qb_id TEXT;
    v_b_key TEXT;
    v_used_b_keys TEXT[] := ARRAY[]::TEXT[];
    v_used_zones INTEGER[] := ARRAY[]::INTEGER[];
    v_orig_b_keys TEXT[] := ARRAY[]::TEXT[];
    v_orig_qb_ids TEXT[] := ARRAY[]::TEXT[];
    v_calc_fingerprint TEXT;
    v_inserted_questions JSONB := '[]'::jsonb;
    v_submitted_count INTEGER := 0;
    v_row RECORD;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role != 'admin' THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin yang berhak membuat soal remedial UTS.');
    END IF;

    SELECT * INTO v_period FROM public.exam_periods WHERE id = p_original_period_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Periode ujian UTS tidak ditemukan.');
    END IF;

    IF v_period.exam_type != 'uts' THEN
        RETURN json_build_object('success', false, 'message', 'Generator ini khusus untuk remedial ujian UTS.');
    END IF;

    SELECT COUNT(*) INTO v_submitted_count
    FROM public.exam_attempts
    WHERE exam_period_id = p_original_period_id
      AND student_id = p_student_id
      AND status = 'submitted';

    IF v_submitted_count > 1 THEN
        RETURN json_build_object('success', false, 'message', 'INTEGRITY_VIOLATION: Ditemukan lebih dari 1 attempt original berstatus submitted untuk santri ini (' || v_submitted_count || ' attempt). Pemilihan attempt tidak boleh ambigu (LIMIT 1 dilarang).');
    END IF;

    IF v_submitted_count = 0 THEN
        RETURN json_build_object('success', false, 'message', 'Santri belum menyelesaikan ujian UTS original.');
    END IF;

    SELECT * INTO v_orig_attempt
    FROM public.exam_attempts
    WHERE exam_period_id = p_original_period_id
      AND student_id = p_student_id
      AND status = 'submitted';

    IF v_orig_attempt.total_score >= v_period.kkm THEN
        RETURN json_build_object('success', false, 'message', 'Nilai UTS santri (' || v_orig_attempt.total_score || ') sudah mencapai KKM (' || v_period.kkm || '). Santri tidak berhak mengikuti remedial.');
    END IF;

    SELECT * INTO v_snapshot
    FROM public.exam_material_snapshots
    WHERE id = (
        SELECT material_snapshot_id FROM public.exam_question_sets WHERE id = v_orig_attempt.question_set_id
    );

    IF NOT FOUND THEN
        SELECT * INTO v_snapshot
        FROM public.exam_material_snapshots
        WHERE exam_period_id = p_original_period_id AND student_id = p_student_id;
    END IF;

    IF NOT FOUND OR v_snapshot.status != 'finalized' THEN
        RETURN json_build_object('success', false, 'message', 'Snapshot materi original santri belum difinalisasi.');
    END IF;

    v_calc_fingerprint := public.calculate_material_fingerprint(
        v_snapshot.start_surah, v_snapshot.start_ayah,
        v_snapshot.end_surah, v_snapshot.end_ayah,
        COALESCE(v_snapshot.memorization_direction, 'forward')
    );

    IF p_fingerprint IS NOT NULL AND p_fingerprint != '' AND p_fingerprint != v_calc_fingerprint THEN
        RETURN json_build_object('success', false, 'message', 'Material fingerprint mismatch: Materi santri tidak sesuai.');
    END IF;

    FOR v_row IN
        SELECT answer_start_surah, answer_start_ayah, answer_start_word, question_bank_id
        FROM public.exam_questions
        WHERE question_set_id = v_orig_attempt.question_set_id
    LOOP
        v_orig_b_keys := array_append(v_orig_b_keys, v_row.answer_start_surah || ':' || v_row.answer_start_ayah || ':' || v_row.answer_start_word);
        IF v_row.question_bank_id IS NOT NULL THEN
            v_orig_qb_ids := array_append(v_orig_qb_ids, v_row.question_bank_id);
        END IF;
    END LOOP;

    SELECT * INTO v_session
    FROM public.exam_remedial_sessions
    WHERE original_exam_period_id = p_original_period_id AND student_id = p_student_id;

    IF FOUND AND v_session.remedial_question_set_id IS NOT NULL THEN
        SELECT * INTO v_existing_set
        FROM public.exam_remedial_question_sets
        WHERE id = v_session.remedial_question_set_id AND status = 'locked';

        IF FOUND THEN
            SELECT json_agg(row_to_json(q.*) ORDER BY q.question_number)
            INTO v_inserted_questions
            FROM public.exam_remedial_questions q
            WHERE q.remedial_question_set_id = v_existing_set.id;

            RETURN json_build_object(
                'success', true,
                'isExisting', true,
                'message', 'Paket soal remedial UTS santri sudah dibuat dan terkunci sebelumnya.',
                'remedialSession', row_to_json(v_session),
                'questionSet', row_to_json(v_existing_set),
                'questions', COALESCE(v_inserted_questions, '[]'::jsonb)
            );
        END IF;
    END IF;

    IF jsonb_array_length(p_questions_data) != 5 THEN
        RETURN json_build_object('success', false, 'message', 'Generator gagal: Wajib menghasilkan tepat 5 soal remedial UTS.');
    END IF;

    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        v_q_num := (v_q->>'questionNumber')::INTEGER;
        v_z_num := (v_q->>'zoneNumber')::INTEGER;
        v_qb_id := NULLIF(v_q->>'questionBankId', '');

        IF v_q_num NOT BETWEEN 1 AND 5 THEN
            RETURN json_build_object('success', false, 'message', 'Nomor soal UTS remedial harus antara 1 dan 5.');
        END IF;

        IF v_z_num NOT BETWEEN 1 AND 5 THEN
            RETURN json_build_object('success', false, 'message', 'Nomor zona UTS remedial harus antara 1 dan 5.');
        END IF;

        IF v_z_num = ANY(v_used_zones) THEN
            RETURN json_build_object('success', false, 'message', 'Duplikasi zona terdeteksi pada butir soal remedial nomor ' || v_q_num);
        END IF;
        v_used_zones := array_append(v_used_zones, v_z_num);

        v_ps_s := (v_q->>'promptStartSurah')::INTEGER;
        v_ps_a := (v_q->>'promptStartAyah')::INTEGER;
        v_ps_w := (v_q->>'promptStartWord')::INTEGER;
        v_pe_s := (v_q->>'promptEndSurah')::INTEGER;
        v_pe_a := (v_q->>'promptEndAyah')::INTEGER;
        v_pe_w := (v_q->>'promptEndWord')::INTEGER;

        v_as_s := (v_q->>'answerStartSurah')::INTEGER;
        v_as_a := (v_q->>'answerStartAyah')::INTEGER;
        v_as_w := (v_q->>'answerStartWord')::INTEGER;
        v_ae_s := (v_q->>'answerEndSurah')::INTEGER;
        v_ae_a := (v_q->>'answerEndAyah')::INTEGER;
        v_ae_w := (v_q->>'answerEndWord')::INTEGER;

        IF v_as_s NOT BETWEEN 1 AND 114 OR v_as_a < 1 OR v_as_w < 1 OR
           v_ae_s NOT BETWEEN 1 AND 114 OR v_ae_a < 1 OR v_ae_w < 1 OR
           v_ps_s NOT BETWEEN 1 AND 114 OR v_ps_a < 1 OR v_ps_w < 1 OR
           v_pe_s NOT BETWEEN 1 AND 114 OR v_pe_a < 1 OR v_pe_w < 1 THEN
            RETURN json_build_object('success', false, 'message', 'Koordinat ayat/kata pada butir soal remedial ' || v_q_num || ' tidak valid.');
        END IF;

        IF (v_ps_s > v_pe_s) OR (v_ps_s = v_pe_s AND v_ps_a > v_pe_a) OR (v_ps_s = v_pe_s AND v_ps_a = v_pe_a AND v_ps_w > v_pe_w) THEN
            RETURN json_build_object('success', false, 'message', 'Urutan prompt A ke A-aksen tidak valid pada butir ' || v_q_num);
        END IF;

        IF (v_pe_s > v_as_s) OR (v_pe_s = v_as_s AND v_pe_a > v_as_a) OR (v_pe_s = v_as_s AND v_pe_a = v_as_a AND v_pe_w >= v_as_w) THEN
            RETURN json_build_object('success', false, 'message', 'Titik B harus setelah A-aksen pada butir ' || v_q_num);
        END IF;

        IF (v_as_s > v_ae_s) OR (v_as_s = v_ae_s AND v_as_a > v_ae_a) OR (v_as_s = v_ae_s AND v_as_a = v_ae_a AND v_as_w > v_ae_w) THEN
            RETURN json_build_object('success', false, 'message', 'Urutan jawaban B ke C tidak valid pada butir ' || v_q_num);
        END IF;

        -- Gate 18: mendukung forward, single_surah, NULL, dan backward
        IF COALESCE(v_snapshot.memorization_direction, 'forward') != 'backward' THEN
            IF (v_ps_s < v_snapshot.start_surah) OR
               (v_ps_s = v_snapshot.start_surah AND v_ps_a < v_snapshot.start_ayah) OR
               (v_ae_s > v_snapshot.end_surah) OR
               (v_ae_s = v_snapshot.end_surah AND v_ae_a > v_snapshot.end_ayah) THEN
                RETURN json_build_object('success', false, 'message', 'Butir soal UTS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
            END IF;
        ELSE
            IF (v_ps_s > v_snapshot.start_surah) OR
               (v_ps_s = v_snapshot.start_surah AND v_ps_a < v_snapshot.start_ayah) OR
               (v_ae_s < v_snapshot.end_surah) OR
               (v_ae_s = v_snapshot.end_surah AND v_ae_a > v_snapshot.end_ayah) THEN
                RETURN json_build_object('success', false, 'message', 'Butir soal UTS remedial ' || v_q_num || ' berada di luar batas materi snapshot santri.');
            END IF;
        END IF;

        v_b_key := v_as_s || ':' || v_as_a || ':' || v_as_w;
        IF v_b_key = ANY(v_orig_b_keys) THEN
            RETURN json_build_object('success', false, 'message', 'Titik awal B butir soal ' || v_q_num || ' menduplikasi titik soal UTS original (anti-reuse terlanggar).');
        END IF;

        IF v_qb_id IS NOT NULL AND v_qb_id = ANY(v_orig_qb_ids) THEN
            RETURN json_build_object('success', false, 'message', 'Bank Soal butir ' || v_q_num || ' telah digunakan pada UTS original (anti-reuse terlanggar).');
        END IF;

        IF v_b_key = ANY(v_used_b_keys) THEN
            RETURN json_build_object('success', false, 'message', 'Duplikasi titik B terdeteksi pada butir soal remedial nomor ' || v_q_num);
        END IF;
        v_used_b_keys := array_append(v_used_b_keys, v_b_key);
    END LOOP;

    v_session_id := 'ers_' || p_original_period_id || '_' || p_student_id;
    v_set_id := 'erqs_' || p_original_period_id || '_' || p_student_id || '_v1';

    INSERT INTO public.exam_remedial_sessions (
        id, original_exam_period_id, student_id, exam_type,
        original_attempt_id, original_question_set_id, material_snapshot_id,
        status, generation_version, created_by, created_at, updated_at
    ) VALUES (
        v_session_id, p_original_period_id, p_student_id, 'uts',
        v_orig_attempt.id, v_orig_attempt.question_set_id, v_snapshot.id,
        'locked', 1, v_user.id, now(), now()
    )
    ON CONFLICT (original_exam_period_id, student_id) DO UPDATE SET
        original_attempt_id = EXCLUDED.original_attempt_id,
        original_question_set_id = EXCLUDED.original_question_set_id,
        material_snapshot_id = EXCLUDED.material_snapshot_id,
        status = 'locked',
        updated_at = now()
    RETURNING * INTO v_session;

    INSERT INTO public.exam_remedial_question_sets (
        id, remedial_session_id, original_exam_period_id, student_id, exam_type,
        material_snapshot_id, version, generation_strategy, generation_seed,
        material_fingerprint, status, generated_by, generated_at, locked_at, created_at, updated_at
    ) VALUES (
        v_set_id, v_session.id, p_original_period_id, p_student_id, 'uts',
        v_snapshot.id, 1, COALESCE(p_strategy, 'hybrid'),
        COALESCE(p_seed, 'seed_uts_rem_' || p_student_id || '_' || extract(epoch from now())::text),
        v_calc_fingerprint, 'locked', v_user.id, now(), now(), now(), now()
    )
    RETURNING * INTO v_existing_set;

    UPDATE public.exam_remedial_sessions
    SET remedial_question_set_id = v_set_id, status = 'locked', updated_at = now()
    WHERE id = v_session.id
    RETURNING * INTO v_session;

    FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions_data)
    LOOP
        v_q_num := (v_q->>'questionNumber')::INTEGER;
        INSERT INTO public.exam_remedial_questions (
            id, remedial_question_set_id, question_number, zone_number, question_role,
            source_type, question_bank_id, max_score,
            prompt_start_surah, prompt_start_ayah, prompt_start_word,
            prompt_end_surah, prompt_end_ayah, prompt_end_word,
            answer_start_surah, answer_start_ayah, answer_start_word,
            answer_end_surah, answer_end_ayah, answer_end_word,
            start_page, end_page, generated_metadata, created_at
        ) VALUES (
            'erq_' || v_set_id || '_q' || v_q_num,
            v_set_id,
            v_q_num,
            (v_q->>'zoneNumber')::INTEGER,
            'random',
            COALESCE(v_q->>'sourceType', 'auto'),
            NULLIF(v_q->>'questionBankId', ''),
            20.00,
            (v_q->>'promptStartSurah')::INTEGER,
            (v_q->>'promptStartAyah')::INTEGER,
            (v_q->>'promptStartWord')::INTEGER,
            (v_q->>'promptEndSurah')::INTEGER,
            (v_q->>'promptEndAyah')::INTEGER,
            (v_q->>'promptEndWord')::INTEGER,
            (v_q->>'answerStartSurah')::INTEGER,
            (v_q->>'answerStartAyah')::INTEGER,
            (v_q->>'answerStartWord')::INTEGER,
            (v_q->>'answerEndSurah')::INTEGER,
            (v_q->>'answerEndAyah')::INTEGER,
            (v_q->>'answerEndWord')::INTEGER,
            (v_q->>'startPage')::INTEGER,
            (v_q->>'endPage')::INTEGER,
            COALESCE(v_q->'generatedMetadata', '{}'::jsonb),
            now()
        );
    END LOOP;

    SELECT json_agg(row_to_json(q.*) ORDER BY q.question_number)
    INTO v_inserted_questions
    FROM public.exam_remedial_questions q
    WHERE q.remedial_question_set_id = v_set_id;

    INSERT INTO public.exam_audit_logs (
        id, exam_period_id, student_id, action, actor_id,
        before_data, after_data, reason, created_at
    ) VALUES (
        'audit_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 6),
        p_original_period_id,
        p_student_id,
        'remedial_question_set_generated',
        v_user.id,
        NULL,
        jsonb_build_object(
            'remedialSessionId', v_session.id,
            'remedialQuestionSetId', v_set_id,
            'originalAttemptId', v_orig_attempt.id,
            'originalQuestionSetId', v_orig_attempt.question_set_id,
            'originalScore', v_orig_attempt.total_score,
            'kkm', v_period.kkm,
            'questionsCount', 5,
            'fingerprint', v_calc_fingerprint,
            'status', 'locked'
        ),
        'Pembuatan otomatis 5 soal UTS remedial dengan proteksi anti-reuse',
        now()
    );

    RETURN json_build_object(
        'success', true,
        'isExisting', false,
        'message', 'Berhasil membuat dan mengunci 5 butir soal UTS remedial.',
        'remedialSession', row_to_json(v_session),
        'questionSet', row_to_json(v_existing_set),
        'questions', COALESCE(v_inserted_questions, '[]'::jsonb)
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. RPC: get_examiner_remedial_students (Multi-Sesi UAS originalScore)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_examiner_remedial_students(
    p_username text,
    p_password text
) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
    v_auth RECORD;
    v_user RECORD;
    v_result JSON;
BEGIN
    SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
    IF NOT v_auth.out_is_valid THEN
        RETURN json_build_object('success', false, 'message', 'Autentikasi gagal: Sesi tidak valid atau telah kedaluwarsa. Silakan login kembali.');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id = v_auth.out_user_id;

    IF v_user.role NOT IN ('admin', 'teacher') THEN
        RETURN json_build_object('success', false, 'message', 'Akses ditolak: Hanya Penguji (Guru) atau Admin yang dapat mengakses daftar remedial.');
    END IF;

    SELECT json_agg(row_to_json(t)) INTO v_result
    FROM (
        SELECT
            s.id AS "remedialSessionId",
            s.original_exam_period_id AS "examPeriodId",
            ep.name AS "periodName",
            ep.exam_type AS "periodExamType",
            s.exam_type AS "examType",
            ep.kkm AS "kkm",
            st.id AS "studentId",
            st.name AS "studentName",
            st.nis AS "nis",
            st.class AS "className",
            st.class AS "class",
            s.examiner_user_id AS "examinerId",
            eu.name AS "examinerName",
            s.status AS "sessionStatus",
            s.remedial_question_set_id AS "remedialQuestionSetId",
            rqs.status AS "questionSetStatus",
            rqs.material_fingerprint AS "materialFingerprint",
            orig_att.id AS "originalAttemptId",
            COALESCE(uas_avg.avg_score, orig_att.total_score) AS "originalScore",
            ra.id AS "remedialAttemptId",
            ra.status AS "remedialAttemptStatus",
            ra.total_score AS "remedialScore",
            ra.started_at AS "remedialStartedAt",
            ra.submitted_at AS "remedialSubmittedAt",
            CASE
                WHEN ra.status = 'submitted' THEN ra.total_score
                ELSE COALESCE(uas_avg.avg_score, orig_att.total_score)
            END AS "effectiveScore",
            CASE
                WHEN ra.status = 'submitted' AND ra.total_score >= ep.kkm THEN 'TUNTAS_MELALUI_REMEDIAL'
                WHEN ra.status = 'submitted' AND ra.total_score < ep.kkm THEN 'BELUM_TUNTAS_SETELAH_REMEDIAL'
                WHEN ra.status IN ('in_progress', 'reopened') THEN 'SEDANG_REMEDIAL'
                WHEN rqs.status = 'locked' THEN 'REMEDIAL_DIJADWALKAN'
                ELSE 'PERLU_REMEDIAL'
            END AS "derivedStatus",
            (SELECT COUNT(*) FROM public.exam_remedial_questions eq WHERE eq.remedial_question_set_id = s.remedial_question_set_id) AS "questionCount",
            (SELECT COUNT(*) FROM public.exam_remedial_question_assessments eqa WHERE eqa.remedial_attempt_id = ra.id AND eqa.completed_at IS NOT NULL) AS "completedQuestionCount"
        FROM public.exam_remedial_sessions s
        JOIN public.students st ON st.id = s.student_id
        JOIN public.exam_periods ep ON ep.id = s.original_exam_period_id
        JOIN public.exam_attempts orig_att ON orig_att.id = s.original_attempt_id
        JOIN public.exam_remedial_question_sets rqs ON rqs.id = s.remedial_question_set_id
        LEFT JOIN public.users eu ON eu.id = s.examiner_user_id
        LEFT JOIN public.exam_remedial_attempts ra ON ra.remedial_session_id = s.id
        LEFT JOIN LATERAL (
            SELECT ROUND(AVG(COALESCE(us.score, ua.total_score)), 2) AS avg_score
            FROM public.exam_uas_sessions us
            LEFT JOIN public.exam_attempts ua ON ua.id = us.attempt_id AND ua.status = 'submitted'
            WHERE s.exam_type = 'uas'
              AND us.exam_period_id = s.original_exam_period_id
              AND us.student_id = s.student_id
              AND us.status = 'submitted'
        ) uas_avg ON true
        WHERE rqs.status = 'locked'
          AND (v_user.role = 'admin' OR s.examiner_user_id = v_user.id)
        ORDER BY st.name ASC
    ) t;

    RETURN json_build_object(
        'success', true,
        'students', COALESCE(v_result, '[]'::json)
    );
END;
$$;
