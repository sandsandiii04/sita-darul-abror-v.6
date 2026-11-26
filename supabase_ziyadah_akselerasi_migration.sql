-- ============================================================================
-- SITA DARUL ABROR — ADDITIVE DATABASE MIGRATION & SECURE RPC
-- Modul: UJIAN ZIYADAH AKSELERASI (Revisi Hardening Audit B-01 s.d. B-12)
-- Sifat: 100% Additive & Modular (TIDAK mengubah tabel UTS, UAS, Tahsin, atau Harian)
-- CATATAN: File ini disiapkan secara lokal untuk pengujian & review Admin.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABEL DELEGASI KOORDINATOR AKSELERASI (TANPA MENGUBAH ROLE GLOBAL USERS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ziyadah_accel_coordinators (
  user_id text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  granted_by text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ============================================================================
-- 2. TABEL KEGIATAN UJIAN ZIYADAH AKSELERASI
-- (signer_name diatur Admin per kegiatan, tidak dipaksa hardcode ke 1 nama)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ziyadah_accel_events (
  id text PRIMARY KEY,
  academic_term_id text REFERENCES public.academic_terms(id) ON DELETE SET NULL,
  name text NOT NULL,
  academic_year text NOT NULL,
  semester text NOT NULL CHECK (semester IN ('ganjil', 'genap')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'active', 'closed', 'finalized', 'cancelled')),
  coordinator_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  signer_city text NOT NULL DEFAULT 'Garut',
  signer_title text NOT NULL DEFAULT 'Bagian Tahsin & Tahfidz Al Qur''an Ma''had Darul Abror Islamic Boarding School',
  signer_name text NOT NULL DEFAULT '',
  notes text,
  finalized_at timestamptz,
  finalized_by text REFERENCES public.users(id) ON DELETE SET NULL,
  reopened_at timestamptz,
  reopened_by text REFERENCES public.users(id) ON DELETE SET NULL,
  reopen_reason text,
  version integer NOT NULL DEFAULT 1,
  created_by text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT chk_za_event_dates CHECK (start_date <= end_date)
);

-- ============================================================================
-- 3. TABEL PESERTA KEGIATAN (FK KE STUDENTS + SNAPSHOT HISTORIS IMMUTABLE)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ziyadah_accel_participants (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES public.ziyadah_accel_events(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  student_name_snapshot text NOT NULL,
  nis_snapshot text NOT NULL,
  class_snapshot text NOT NULL,
  halaqah_snapshot text NOT NULL,
  halaqah_teacher_id_snapshot text,
  halaqah_teacher_name_snapshot text,
  memorization_direction_hint text NOT NULL DEFAULT 'unknown'
    CHECK (memorization_direction_hint IN ('forward', 'backward', 'single_surah', 'unknown')),
  baseline_surah integer CHECK (baseline_surah IS NULL OR (baseline_surah BETWEEN 1 AND 114)),
  baseline_ayah integer CHECK (baseline_ayah IS NULL OR baseline_ayah >= 1),
  baseline_page integer CHECK (baseline_page IS NULL OR (baseline_page BETWEEN 1 AND 604)),
  baseline_label text,
  participant_status text NOT NULL DEFAULT 'active'
    CHECK (participant_status IN ('active', 'withdrawn')),
  withdraw_reason text,
  created_by text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_za_event_student UNIQUE (event_id, student_id)
);

-- ============================================================================
-- 4. TABEL SESI KEGIATAN DINAMIS (1 .. N SESI)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ziyadah_accel_sessions (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES public.ziyadah_accel_events(id) ON DELETE CASCADE,
  session_number integer NOT NULL CHECK (session_number >= 1),
  name text NOT NULL,
  session_date date NOT NULL,
  start_time text,
  end_time text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'active', 'closed', 'cancelled')),
  queue_mode text NOT NULL DEFAULT 'akselerasi_last'
    CHECK (queue_mode IN ('akselerasi_last', 'custom_order')),
  regular_queue_offset integer NOT NULL DEFAULT 0 CHECK (regular_queue_offset >= 0),
  activated_at timestamptz,
  activated_by text REFERENCES public.users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  closed_by text REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by text REFERENCES public.users(id) ON DELETE SET NULL,
  cancel_reason text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_za_event_session_number UNIQUE (event_id, session_number)
);

-- ============================================================================
-- 5. TABEL PENUGASAN PENGUJI & ANTREAN MAJELIS PER KELOMPOK PENGUJI
-- (Mendukung offset reguler & konfirmasi selesai setoran reguler per kelompok)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ziyadah_accel_session_examiners (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES public.ziyadah_accel_events(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES public.ziyadah_accel_sessions(id) ON DELETE CASCADE,
  examiner_user_id text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  examiner_name_snapshot text NOT NULL,
  group_label text,
  can_examine_all boolean NOT NULL DEFAULT false,
  assigned_classes text[] NOT NULL DEFAULT '{}'::text[],
  assigned_halaqahs text[] NOT NULL DEFAULT '{}'::text[],
  assigned_participant_ids text[] NOT NULL DEFAULT '{}'::text[],
  regular_queue_offset integer NOT NULL DEFAULT 0 CHECK (regular_queue_offset >= 0),
  regular_finish_confirmed boolean NOT NULL DEFAULT false,
  regular_finished_at timestamptz,
  regular_finished_by text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_za_session_examiner UNIQUE (session_id, examiner_user_id)
);

-- ============================================================================
-- 6. TABEL KEWAJIBAN, ANTREAN GILIRAN, & SETORAN UTAMA PER PESERTA x SESI
-- (Mencatat identitas penguji individual + akun login bersama bila via PIN)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ziyadah_accel_submissions (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES public.ziyadah_accel_events(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES public.ziyadah_accel_sessions(id) ON DELETE CASCADE,
  participant_id text NOT NULL REFERENCES public.ziyadah_accel_participants(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  assigned_examiner_id text REFERENCES public.users(id) ON DELETE SET NULL,
  group_label text,
  queue_tier text NOT NULL DEFAULT 'akselerasi_last'
    CHECK (queue_tier IN ('regular_before', 'akselerasi_last')),
  queue_order integer NOT NULL DEFAULT 1 CHECK (queue_order >= 1),
  fulfillment_status text NOT NULL DEFAULT 'waiting_turn'
    CHECK (fulfillment_status IN (
      'waiting_turn',
      'called_not_submitted',
      'submitted',
      'absent',
      'pending_examiner_input',
      'cancelled'
    )),
  verification_status text NOT NULL DEFAULT 'clean'
    CHECK (verification_status IN (
      'clean',
      'needs_verification',
      'verified_approved',
      'verified_rejected'
    )),
  verification_flags text[] NOT NULL DEFAULT '{}'::text[],
  confirmed_pages numeric(6,2)
    CHECK (confirmed_pages IS NULL OR (confirmed_pages > 0 AND mod(confirmed_pages * 100, 25) = 0)),
  system_suggested_pages numeric(6,2)
    CHECK (system_suggested_pages IS NULL OR system_suggested_pages >= 0),
  approved_unique_pages numeric(6,2)
    CHECK (approved_unique_pages IS NULL OR (approved_unique_pages >= 0 AND mod(approved_unique_pages * 100, 25) = 0)),
  score numeric(5,2)
    CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  absence_reason text
    CHECK (absence_reason IS NULL OR absence_reason IN ('sick', 'permission', 'alpha', 'other')),
  examiner_notes text,
  recorded_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_by_name_snapshot text,
  login_account_id text,
  login_account_username text,
  submitted_at timestamptz,
  verified_by text REFERENCES public.users(id) ON DELETE SET NULL,
  verified_by_name_snapshot text,
  verified_at timestamptz,
  verification_note text,
  cancel_reason text,
  last_idempotency_key text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_za_session_participant UNIQUE (session_id, participant_id),
  CONSTRAINT uq_za_session_student UNIQUE (session_id, student_id),
  CONSTRAINT chk_za_submitted_non_null CHECK (
    fulfillment_status != 'submitted'
    OR (confirmed_pages IS NOT NULL AND score IS NOT NULL)
  ),
  CONSTRAINT chk_za_non_submitted_null_score CHECK (
    fulfillment_status = 'submitted'
    OR (score IS NULL AND confirmed_pages IS NULL AND approved_unique_pages IS NULL)
  )
);

-- ============================================================================
-- 7. TABEL RINCIAN MULTI-RENTANG SURAH & AYAT PER SETORAN
-- PERBAIKAN B-01: Gunakan Partial Unique Index khusus range_status = 'active'
-- agar koreksi/edit setoran tidak gagal duplicate key terhadap baris 'void'!
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ziyadah_accel_submission_ranges (
  id text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES public.ziyadah_accel_submissions(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES public.ziyadah_accel_events(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES public.ziyadah_accel_sessions(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  range_order integer NOT NULL CHECK (range_order >= 1),
  juz_number integer NOT NULL CHECK (juz_number BETWEEN 1 AND 30),
  surah_number integer NOT NULL CHECK (surah_number BETWEEN 1 AND 114),
  surah_name_snapshot text NOT NULL,
  ayah_start integer NOT NULL CHECK (ayah_start >= 1),
  ayah_end integer NOT NULL CHECK (ayah_end >= ayah_start),
  start_page integer NOT NULL CHECK (start_page BETWEEN 1 AND 604),
  end_page integer NOT NULL CHECK (end_page BETWEEN 1 AND 604),
  range_status text NOT NULL DEFAULT 'active'
    CHECK (range_status IN ('active', 'void')),
  overlap_flag boolean NOT NULL DEFAULT false,
  overlap_detail text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.ziyadah_accel_submission_ranges
  DROP CONSTRAINT IF EXISTS uq_za_submission_range_order;

CREATE UNIQUE INDEX IF NOT EXISTS uq_za_submission_active_range_order
  ON public.ziyadah_accel_submission_ranges (submission_id, range_order)
  WHERE range_status = 'active';

-- ============================================================================
-- 8. TABEL AUDIT LOG & SNAPSHOT ARSIP FINALISASI IMMUTABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ziyadah_accel_audit_logs (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES public.ziyadah_accel_events(id) ON DELETE CASCADE,
  session_id text,
  submission_id text,
  student_id text,
  action_type text NOT NULL,
  actor_user_id text NOT NULL,
  actor_name_snapshot text NOT NULL,
  actor_role text NOT NULL,
  login_account_id text,
  login_account_username text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.ziyadah_accel_final_snapshots (
  id text PRIMARY KEY,
  event_id text NOT NULL UNIQUE REFERENCES public.ziyadah_accel_events(id) ON DELETE CASCADE,
  snapshot_version integer NOT NULL DEFAULT 1,
  frozen_summary jsonb NOT NULL,
  frozen_student_rows jsonb NOT NULL,
  frozen_session_matrix jsonb NOT NULL DEFAULT '[]'::jsonb,
  finalized_by text NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  finalized_by_name text NOT NULL,
  finalized_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ============================================================================
-- 9. INDEKS QUERY MONITORING, FILTER, & DETEKSI OVERLAP
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_za_participants_event_filter
  ON public.ziyadah_accel_participants (event_id, participant_status, class_snapshot, halaqah_snapshot);

CREATE INDEX IF NOT EXISTS idx_za_sessions_event_num
  ON public.ziyadah_accel_sessions (event_id, session_number);

CREATE INDEX IF NOT EXISTS idx_za_examiners_user_sess
  ON public.ziyadah_accel_session_examiners (examiner_user_id, session_id);

CREATE INDEX IF NOT EXISTS idx_za_submissions_event_sess_status
  ON public.ziyadah_accel_submissions (event_id, session_id, fulfillment_status);

CREATE INDEX IF NOT EXISTS idx_za_submissions_student_event
  ON public.ziyadah_accel_submissions (event_id, student_id);

CREATE INDEX IF NOT EXISTS idx_za_submissions_needs_verify
  ON public.ziyadah_accel_submissions (event_id, verification_status)
  WHERE verification_status = 'needs_verification';

CREATE INDEX IF NOT EXISTS idx_za_ranges_overlap_lookup
  ON public.ziyadah_accel_submission_ranges (event_id, student_id, surah_number, ayah_start, ayah_end)
  WHERE range_status = 'active';

CREATE INDEX IF NOT EXISTS idx_za_audit_event_created
  ON public.ziyadah_accel_audit_logs (event_id, created_at DESC);

-- ============================================================================
-- 10. ROW LEVEL SECURITY (STRICT DENY DIRECT ACCESS VIA ANON/REST)
-- ============================================================================
ALTER TABLE public.ziyadah_accel_coordinators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ziyadah_accel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ziyadah_accel_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ziyadah_accel_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ziyadah_accel_session_examiners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ziyadah_accel_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ziyadah_accel_submission_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ziyadah_accel_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ziyadah_accel_final_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS za_coord_deny_direct ON public.ziyadah_accel_coordinators;
CREATE POLICY za_coord_deny_direct ON public.ziyadah_accel_coordinators FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS za_events_deny_direct ON public.ziyadah_accel_events;
CREATE POLICY za_events_deny_direct ON public.ziyadah_accel_events FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS za_participants_deny_direct ON public.ziyadah_accel_participants;
CREATE POLICY za_participants_deny_direct ON public.ziyadah_accel_participants FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS za_sessions_deny_direct ON public.ziyadah_accel_sessions;
CREATE POLICY za_sessions_deny_direct ON public.ziyadah_accel_sessions FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS za_examiners_deny_direct ON public.ziyadah_accel_session_examiners;
CREATE POLICY za_examiners_deny_direct ON public.ziyadah_accel_session_examiners FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS za_submissions_deny_direct ON public.ziyadah_accel_submissions;
CREATE POLICY za_submissions_deny_direct ON public.ziyadah_accel_submissions FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS za_ranges_deny_direct ON public.ziyadah_accel_submission_ranges;
CREATE POLICY za_ranges_deny_direct ON public.ziyadah_accel_submission_ranges FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS za_audit_deny_direct ON public.ziyadah_accel_audit_logs;
CREATE POLICY za_audit_deny_direct ON public.ziyadah_accel_audit_logs FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS za_snapshots_deny_direct ON public.ziyadah_accel_final_snapshots;
CREATE POLICY za_snapshots_deny_direct ON public.ziyadah_accel_final_snapshots FOR ALL USING (false) WITH CHECK (false);

-- ============================================================================
-- 11. HELPER INTERNAL MANDIRI (SURAH, RESOLUSI IDENTITAS AKUN BERSAMA + PIN, & OTORISASI)
-- ============================================================================
CREATE OR REPLACE FUNCTION public._za_surah_max_ayah(p_surah integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_counts integer[] := ARRAY[
    7,286,200,176,120,165,206,75,129,109,
    123,111,43,52,99,128,111,110,98,135,
    112,78,118,64,77,227,93,88,69,60,
    34,30,73,54,45,83,182,88,75,85,
    54,53,89,59,37,35,38,29,18,45,
    60,49,62,55,78,96,29,22,24,13,
    14,11,11,18,12,12,30,52,52,44,
    28,28,20,56,40,31,50,40,46,42,
    29,19,36,25,22,17,19,26,30,20,
    15,21,11,8,8,19,5,8,8,11,
    11,8,3,9,5,4,7,3,6,3,
    5,4,5,6
  ];
BEGIN
  IF p_surah IS NULL OR p_surah < 1 OR p_surah > 114 THEN
    RETURN 0;
  END IF;
  RETURN v_counts[p_surah];
END;
$$;

-- PERBAIKAN B-03: Resolusi aktor individual yang mendukung:
-- (1) Akun Admin / Guru pribadi ('admin', 'teacher')
-- (2) Akun Bersama Ujian ('shared_uas_examiner') dengan sesi login aktif di user_sessions
--     + verifikasi PIN Guru aktif di uas_verified_examiner_sessions + status PIN aktif di uas_examiner_pins
-- TANPA mengubah mekanisme login UAS reguler.
CREATE OR REPLACE FUNCTION public._za_resolve_actor(
  p_username text,
  p_password text,
  OUT is_valid boolean,
  OUT error_code text,
  OUT error_message text,
  OUT actor_user_id text,
  OUT actor_name text,
  OUT effective_role text,
  OUT login_role text,
  OUT login_account_id text,
  OUT login_username text,
  OUT is_shared_account boolean
)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_auth RECORD;
  v_ves RECORD;
  v_pin RECORD;
BEGIN
  is_valid := FALSE;
  is_shared_account := FALSE;

  SELECT * INTO v_auth FROM public.validate_session_or_credential(p_username, p_password);
  IF NOT COALESCE(v_auth.out_is_valid, FALSE) THEN
    error_code := 'AUTH_INVALID';
    error_message := 'Sesi login tidak valid atau telah berakhir.';
    RETURN;
  END IF;

  login_role := v_auth.out_role;
  login_account_id := v_auth.out_user_id;
  login_username := v_auth.out_username;

  IF v_auth.out_role IN ('admin', 'teacher') THEN
    is_valid := TRUE;
    actor_user_id := v_auth.out_user_id;
    actor_name := v_auth.out_name;
    effective_role := v_auth.out_role;
    RETURN;
  END IF;

  IF v_auth.out_role = 'shared_uas_examiner' THEN
    is_shared_account := TRUE;

    -- Wajib menggunakan session_token aktif per perangkat di user_sessions (bukan password mentah bersama)
    IF to_regclass('public.user_sessions') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.user_sessions s
        WHERE s.session_token = p_password
          AND s.user_id = v_auth.out_user_id
          AND s.role = 'shared_uas_examiner'
          AND s.expires_at > timezone('utc'::text, now())
      ) THEN
        error_code := 'AUTH_INVALID';
        error_message := 'Sesi perangkat akun bersama tidak valid atau telah berakhir. Silakan login kembali.';
        RETURN;
      END IF;
    END IF;

    IF to_regclass('public.uas_verified_examiner_sessions') IS NULL THEN
      error_code := 'PIN_REQUIRED';
      error_message := 'Tabel sesi verifikasi PIN penguji belum tersedia.';
      RETURN;
    END IF;

    SELECT ves.verified_teacher_id, ves.verified_teacher_name, ves.expires_at, u.role AS teacher_role
    INTO v_ves
    FROM public.uas_verified_examiner_sessions ves
    JOIN public.users u ON u.id = ves.verified_teacher_id
    WHERE ves.session_token = p_password
      AND ves.shared_account_id = v_auth.out_user_id;

    IF NOT FOUND THEN
      error_code := 'PIN_REQUIRED';
      error_message := 'Pilih nama Guru Penguji dan masukkan PIN verifikasi pribadi Anda terlebih dahulu.';
      RETURN;
    END IF;

    IF v_ves.expires_at <= now() THEN
      error_code := 'PIN_EXPIRED';
      error_message := 'Verifikasi PIN penguji telah kedaluwarsa. Silakan masukkan kembali PIN Guru Anda.';
      RETURN;
    END IF;

    -- Selaras dengan verify_uas_examiner_identity pada SITA: identitas penguji pada akun bersama wajib role 'teacher'
    IF v_ves.teacher_role != 'teacher' THEN
      error_code := 'ROLE_DENIED';
      error_message := 'Identitas Guru Penguji pada akun bersama wajib berasal dari akun Guru resmi.';
      RETURN;
    END IF;

    -- Pastikan PIN Guru masih aktif dan tidak sedang dicabut/dikunci Admin di uas_examiner_pins
    IF to_regclass('public.uas_examiner_pins') IS NOT NULL THEN
      SELECT ep.is_active, ep.locked_until
      INTO v_pin
      FROM public.uas_examiner_pins ep
      WHERE ep.teacher_id = v_ves.verified_teacher_id;

      IF NOT FOUND OR NOT COALESCE(v_pin.is_active, FALSE) OR (v_pin.locked_until IS NOT NULL AND v_pin.locked_until > now()) THEN
        error_code := 'PIN_REVOKED';
        error_message := 'PIN Guru Penguji telah dinonaktifkan atau sedang terkunci sementara. Hubungi Admin.';
        RETURN;
      END IF;
    END IF;

    is_valid := TRUE;
    actor_user_id := v_ves.verified_teacher_id;
    actor_name := v_ves.verified_teacher_name;
    -- Akun bersama selalu dibatasi sebagai penguji (tidak pernah memperoleh hak koordinator manajemen)
    effective_role := 'teacher';
    RETURN;
  END IF;

  error_code := 'ROLE_DENIED';
  error_message := 'Akses ditolak untuk peran akun ini.';
END;
$$;

-- Helper pemeriksaan kesinambungan ayat & antarsurah secara konservatif:
-- Jika referensi Mushaf tidak dapat membuktikan ketiadaan celah ayat (surah sebelumnya belum tuntas di ayat terakhir,
-- surah berikutnya tidak dimulai dari ayat 1, melompati surah antara, atau lompatan mundur tanpa arah backward),
-- wajib mengembalikan flag verifikasi ('AYAH_GAP_DETECTED' / 'CROSS_SURAH_GAP' / 'CROSS_SURAH_UNVERIFIED_JUMP').
CREATE OR REPLACE FUNCTION public._za_check_range_continuity(
  p_prev_surah integer,
  p_prev_ayah_end integer,
  p_cur_surah integer,
  p_cur_ayah_start integer,
  p_direction_hint text DEFAULT 'forward'
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_prev_max integer;
  v_dir text := COALESCE(NULLIF(trim(p_direction_hint), ''), 'forward');
BEGIN
  IF p_prev_surah IS NULL OR p_prev_ayah_end IS NULL OR p_cur_surah IS NULL OR p_cur_ayah_start IS NULL THEN
    RETURN NULL;
  END IF;

  v_prev_max := public._za_surah_max_ayah(p_prev_surah);
  IF v_prev_max <= 0 THEN
    RETURN 'CROSS_SURAH_UNVERIFIED_JUMP';
  END IF;

  -- 1. Surah yang sama: cek apakah ada ayat yang terlewat
  IF p_cur_surah = p_prev_surah THEN
    IF p_cur_ayah_start > p_prev_ayah_end + 1 THEN
      RETURN 'AYAH_GAP_DETECTED';
    END IF;
    RETURN NULL;
  END IF;

  -- 2. Pindah maju ke surah berikutnya yang berurutan (N -> N + 1)
  IF p_cur_surah = p_prev_surah + 1 THEN
    IF v_dir = 'backward' THEN
      RETURN 'CROSS_SURAH_UNVERIFIED_JUMP';
    END IF;
    IF p_prev_ayah_end = v_prev_max AND p_cur_ayah_start = 1 THEN
      RETURN NULL;
    END IF;
    RETURN 'CROSS_SURAH_GAP';
  END IF;

  -- 3. Pindah mundur ke surah sebelumnya yang berurutan (N -> N - 1, lazim pada program Juz 30 -> 29)
  IF p_cur_surah = p_prev_surah - 1 THEN
    IF v_dir = 'backward' THEN
      IF p_prev_ayah_end = v_prev_max AND p_cur_ayah_start = 1 THEN
        RETURN NULL;
      END IF;
      RETURN 'CROSS_SURAH_GAP';
    END IF;
    RETURN 'CROSS_SURAH_UNVERIFIED_JUMP';
  END IF;

  -- 4. Melompati >= 1 surah di antaranya (|cur - prev| > 1): tidak dapat dibuktikan tanpa verifikasi Koordinator
  RETURN 'CROSS_SURAH_UNVERIFIED_JUMP';
END;
$$;

CREATE OR REPLACE FUNCTION public._za_is_coordinator(
  p_user_id text,
  p_effective_role text,
  p_event_id text DEFAULT NULL,
  p_is_shared_account boolean DEFAULT FALSE
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  -- Akun bersama UJIAN tidak boleh mendapatkan hak manajemen Koordinator
  IF COALESCE(p_is_shared_account, FALSE) THEN
    RETURN FALSE;
  END IF;
  IF p_effective_role = 'admin' THEN
    RETURN TRUE;
  END IF;
  IF p_effective_role != 'teacher' OR p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ziyadah_accel_coordinators
    WHERE user_id = p_user_id AND is_active = true
  ) THEN
    RETURN TRUE;
  END IF;
  IF p_event_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.ziyadah_accel_events
      WHERE id = p_event_id AND coordinator_user_id = p_user_id AND status != 'cancelled'
    ) THEN
      RETURN TRUE;
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.ziyadah_accel_events
      WHERE coordinator_user_id = p_user_id AND status != 'cancelled'
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;
  RETURN FALSE;
END;
$$;

-- PERBAIKAN B-09: Hapus fallback longgar! Jika can_examine_all = false dan ketiga array kosong,
-- maka penguji TIDAK diizinkan menguji peserta mana pun (RETURN FALSE).
CREATE OR REPLACE FUNCTION public._za_can_examine_participant(
  p_session_id text,
  p_user_id text,
  p_effective_role text,
  p_event_id text,
  p_participant_id text,
  p_class_snapshot text,
  p_halaqah_snapshot text,
  p_is_shared_account boolean DEFAULT FALSE
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_assign RECORD;
BEGIN
  IF public._za_is_coordinator(p_user_id, p_effective_role, p_event_id, p_is_shared_account) THEN
    RETURN TRUE;
  END IF;
  IF p_effective_role != 'teacher' OR p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_assign
  FROM public.ziyadah_accel_session_examiners
  WHERE session_id = p_session_id AND examiner_user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_assign.can_examine_all THEN
    RETURN TRUE;
  END IF;

  IF array_length(v_assign.assigned_participant_ids, 1) IS NOT NULL
     AND p_participant_id = ANY(v_assign.assigned_participant_ids) THEN
    RETURN TRUE;
  END IF;

  IF array_length(v_assign.assigned_classes, 1) IS NOT NULL
     AND p_class_snapshot = ANY(v_assign.assigned_classes) THEN
    RETURN TRUE;
  END IF;

  IF array_length(v_assign.assigned_halaqahs, 1) IS NOT NULL
     AND p_halaqah_snapshot = ANY(v_assign.assigned_halaqahs) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- ============================================================================
-- 12. RPC 1: KONTEKS AKSES DINAMIS MENU & DELEGASI KOORDINATOR
-- ============================================================================
CREATE OR REPLACE FUNCTION public.za_get_access_context_secure(
  p_username text,
  p_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_is_coord boolean := FALSE;
  v_assigned_sessions integer := 0;
  v_shared_active_events integer := 0;
  v_can_show_menu boolean := FALSE;
  v_coordinators jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);

  -- Khusus akun bersama UJIAN yang belum verifikasi PIN atau PIN kedaluwarsa:
  -- izinkan menu tampil HANYA jika sedang ada kegiatan aktif/terjadwal yang memiliki penugasan penguji!
  IF NOT v_actor.is_valid THEN
    IF v_actor.error_code IN ('PIN_REQUIRED', 'PIN_EXPIRED', 'PIN_REVOKED') THEN
      SELECT COUNT(DISTINCT e.id) INTO v_shared_active_events
      FROM public.ziyadah_accel_events e
      JOIN public.ziyadah_accel_session_examiners se ON se.event_id = e.id
      JOIN public.ziyadah_accel_sessions s ON s.id = se.session_id
      WHERE e.status IN ('scheduled', 'active')
        AND s.status IN ('scheduled', 'active');

      RETURN jsonb_build_object(
        'success', true,
        'loginRole', v_actor.login_role,
        'isSharedAccount', true,
        'pinRequired', true,
        'isPinExpired', (v_actor.error_code = 'PIN_EXPIRED'),
        'isCoordinator', false,
        'assignedSessionCount', 0,
        'sharedActiveEventsCount', v_shared_active_events,
        'canShowMenu', (v_shared_active_events > 0),
        'coordinators', '[]'::jsonb,
        'message', v_actor.error_message
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'errorCode', v_actor.error_code,
      'canShowMenu', false,
      'message', v_actor.error_message
    );
  END IF;

  v_is_coord := public._za_is_coordinator(
    v_actor.actor_user_id,
    v_actor.effective_role,
    NULL,
    v_actor.is_shared_account
  );

  SELECT COUNT(*) INTO v_assigned_sessions
  FROM public.ziyadah_accel_session_examiners se
  JOIN public.ziyadah_accel_sessions s ON s.id = se.session_id
  JOIN public.ziyadah_accel_events e ON e.id = se.event_id
  WHERE se.examiner_user_id = v_actor.actor_user_id
    AND s.status IN ('scheduled', 'active', 'closed')
    AND e.status NOT IN ('cancelled');

  IF v_actor.is_shared_account THEN
    SELECT COUNT(DISTINCT e.id) INTO v_shared_active_events
    FROM public.ziyadah_accel_events e
    JOIN public.ziyadah_accel_session_examiners se ON se.event_id = e.id
    WHERE e.status IN ('scheduled', 'active');
    v_can_show_menu := (v_assigned_sessions > 0 OR v_shared_active_events > 0);
  ELSE
    -- Keputusan Admin A.2: Guru tanpa penugasan & bukan Koordinator TIDAK menampilkan menu penguji!
    v_can_show_menu := (v_actor.effective_role = 'admin' OR v_is_coord OR v_assigned_sessions > 0);
  END IF;

  IF v_actor.effective_role = 'admin' OR v_is_coord THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'userId', c.user_id,
      'userName', u.name,
      'isActive', c.is_active,
      'notes', c.notes,
      'updatedAt', c.updated_at
    ) ORDER BY u.name ASC), '[]'::jsonb)
    INTO v_coordinators
    FROM public.ziyadah_accel_coordinators c
    JOIN public.users u ON u.id = c.user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'userId', v_actor.actor_user_id,
    'actorName', v_actor.actor_name,
    'role', v_actor.effective_role,
    'loginRole', v_actor.login_role,
    'isSharedAccount', v_actor.is_shared_account,
    'pinRequired', false,
    'verifiedExaminer', CASE
      WHEN v_actor.is_shared_account THEN jsonb_build_object(
        'teacherId', v_actor.actor_user_id,
        'teacherName', v_actor.actor_name
      )
      ELSE NULL
    END,
    'isCoordinator', v_is_coord,
    'assignedSessionCount', v_assigned_sessions,
    'canShowMenu', v_can_show_menu,
    'coordinators', v_coordinators
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.za_manage_coordinator_secure(
  p_username text,
  p_password text,
  p_target_user_id text,
  p_is_active boolean,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_target RECORD;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  IF NOT v_actor.is_valid OR v_actor.is_shared_account OR v_actor.effective_role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin utama yang dapat mengatur hak Koordinator Akselerasi.');
  END IF;

  SELECT id, name, role INTO v_target FROM public.users WHERE id = p_target_user_id;
  IF NOT FOUND OR v_target.role NOT IN ('teacher', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pengguna tidak ditemukan atau bukan Guru/Admin.');
  END IF;

  INSERT INTO public.ziyadah_accel_coordinators (user_id, is_active, notes, granted_by, updated_at)
  VALUES (p_target_user_id, COALESCE(p_is_active, true), p_notes, v_actor.actor_user_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET is_active = EXCLUDED.is_active,
        notes = COALESCE(EXCLUDED.notes, public.ziyadah_accel_coordinators.notes),
        granted_by = v_actor.actor_user_id,
        updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'message', CASE WHEN p_is_active THEN 'Hak Koordinator Akselerasi diaktifkan untuk ' || v_target.name ELSE 'Hak Koordinator Akselerasi dinonaktifkan untuk ' || v_target.name END
  );
END;
$$;

-- ============================================================================
-- 13. RPC 2: DAFTAR & SIMPAN KEGIATAN AKSELERASI
-- ============================================================================
CREATE OR REPLACE FUNCTION public.za_list_events_secure(
  p_username text,
  p_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_is_global_coord boolean;
  v_events jsonb;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  IF NOT v_actor.is_valid THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorCode', v_actor.error_code,
      'pinRequired', (v_actor.error_code IN ('PIN_REQUIRED', 'PIN_EXPIRED', 'PIN_REVOKED')),
      'message', v_actor.error_message
    );
  END IF;

  v_is_global_coord := public._za_is_coordinator(
    v_actor.actor_user_id,
    v_actor.effective_role,
    NULL,
    v_actor.is_shared_account
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'academicTermId', e.academic_term_id,
    'name', e.name,
    'academicYear', e.academic_year,
    'semester', e.semester,
    'startDate', e.start_date,
    'endDate', e.end_date,
    'status', e.status,
    'coordinatorUserId', e.coordinator_user_id,
    'signerCity', e.signer_city,
    'signerTitle', e.signer_title,
    'signerName', e.signer_name,
    'notes', e.notes,
    'finalizedAt', e.finalized_at,
    'finalizedBy', e.finalized_by,
    'version', e.version,
    'createdAt', e.created_at,
    'updatedAt', e.updated_at,
    'participantCount', (
      SELECT COUNT(*) FROM public.ziyadah_accel_participants p
      WHERE p.event_id = e.id AND p.participant_status = 'active'
    ),
    'sessionCount', (
      SELECT COUNT(*) FROM public.ziyadah_accel_sessions s
      WHERE s.event_id = e.id AND s.status != 'cancelled'
    ),
    'activeSessionName', (
      SELECT s.name FROM public.ziyadah_accel_sessions s
      WHERE s.event_id = e.id AND s.status = 'active'
      ORDER BY s.session_number ASC LIMIT 1
    ),
    'needsVerificationCount', (
      SELECT COUNT(*) FROM public.ziyadah_accel_submissions sub
      WHERE sub.event_id = e.id AND sub.verification_status = 'needs_verification'
        AND sub.fulfillment_status = 'submitted'
    )
  ) ORDER BY e.start_date DESC, e.created_at DESC), '[]'::jsonb)
  INTO v_events
  FROM public.ziyadah_accel_events e
  WHERE v_is_global_coord
     OR (NOT v_actor.is_shared_account AND e.coordinator_user_id = v_actor.actor_user_id)
     OR (
       e.status IN ('scheduled', 'active', 'closed', 'finalized')
       AND EXISTS (
         SELECT 1 FROM public.ziyadah_accel_session_examiners se
         JOIN public.ziyadah_accel_sessions s ON s.id = se.session_id
         WHERE se.event_id = e.id
           AND se.examiner_user_id = v_actor.actor_user_id
           AND s.status != 'cancelled'
       )
     );

  RETURN jsonb_build_object(
    'success', true,
    'isCoordinator', v_is_global_coord,
    'actorUserId', v_actor.actor_user_id,
    'actorName', v_actor.actor_name,
    'isSharedAccount', v_actor.is_shared_account,
    'events', v_events
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.za_upsert_event_secure(
  p_username text,
  p_password text,
  p_event jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_id text;
  v_existing RECORD;
  v_name text;
  v_year text;
  v_sem text;
  v_start date;
  v_end date;
  v_status text;
  v_signer_city text;
  v_signer_title text;
  v_signer_name text;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  IF NOT v_actor.is_valid THEN
    RETURN jsonb_build_object('success', false, 'errorCode', v_actor.error_code, 'message', v_actor.error_message);
  END IF;

  v_id := COALESCE(NULLIF(trim(p_event->>'id'), ''), 'za_evt_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text);

  IF NOT public._za_is_coordinator(v_actor.actor_user_id, v_actor.effective_role, v_id, v_actor.is_shared_account) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Admin atau Koordinator Akselerasi yang dapat mengelola kegiatan.');
  END IF;

  SELECT * INTO v_existing FROM public.ziyadah_accel_events WHERE id = v_id FOR UPDATE;
  IF FOUND AND v_existing.status = 'finalized' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kegiatan sudah difinalisasi dan terkunci. Buka kembali (reopen) terlebih dahulu jika perlu perubahan.');
  END IF;

  v_name := trim(COALESCE(p_event->>'name', ''));
  v_year := trim(COALESCE(p_event->>'academicYear', '2026/2027'));
  v_sem := lower(trim(COALESCE(p_event->>'semester', 'ganjil')));
  v_start := (p_event->>'startDate')::date;
  v_end := (p_event->>'endDate')::date;
  v_status := COALESCE(NULLIF(trim(p_event->>'status'), ''), COALESCE(v_existing.status, 'draft'));

  -- Keputusan Admin A.3: Nama penandatangan diatur penuh oleh Admin (tidak dipaksa hardcode)
  v_signer_city := CASE
    WHEN p_event ? 'signerCity' THEN COALESCE(NULLIF(trim(p_event->>'signerCity'), ''), 'Garut')
    ELSE COALESCE(v_existing.signer_city, 'Garut')
  END;
  v_signer_title := CASE
    WHEN p_event ? 'signerTitle' THEN trim(COALESCE(p_event->>'signerTitle', ''))
    ELSE COALESCE(v_existing.signer_title, 'Bagian Tahsin & Tahfidz Al Qur''an Ma''had Darul Abror Islamic Boarding School')
  END;
  v_signer_name := CASE
    WHEN p_event ? 'signerName' THEN trim(COALESCE(p_event->>'signerName', ''))
    ELSE COALESCE(v_existing.signer_name, '')
  END;

  IF v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nama kegiatan wajib diisi.');
  END IF;
  IF v_start IS NULL OR v_end IS NULL OR v_start > v_end THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tanggal pelaksanaan tidak valid (tanggal mulai harus <= tanggal selesai).');
  END IF;
  IF v_status = 'finalized' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Gunakan prosedur finalisasi resmi untuk mengunci kegiatan.');
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.ziyadah_accel_events (
      id, academic_term_id, name, academic_year, semester, start_date, end_date,
      status, coordinator_user_id, signer_city, signer_title, signer_name, notes, created_by
    ) VALUES (
      v_id,
      NULLIF(trim(COALESCE(p_event->>'academicTermId', '')), ''),
      v_name, v_year, v_sem, v_start, v_end, v_status,
      COALESCE(NULLIF(trim(COALESCE(p_event->>'coordinatorUserId', '')), ''), v_actor.actor_user_id),
      v_signer_city,
      v_signer_title,
      v_signer_name,
      NULLIF(trim(COALESCE(p_event->>'notes', '')), ''),
      v_actor.actor_user_id
    );

    INSERT INTO public.ziyadah_accel_audit_logs (
      id, event_id, action_type, actor_user_id, actor_name_snapshot, actor_role,
      login_account_id, login_account_username, after_data
    ) VALUES (
      'za_aud_' || gen_random_uuid()::text, v_id, 'CREATE_EVENT',
      v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
      v_actor.login_account_id, v_actor.login_username, p_event
    );
  ELSE
    UPDATE public.ziyadah_accel_events
    SET academic_term_id = NULLIF(trim(COALESCE(p_event->>'academicTermId', academic_term_id)), ''),
        name = v_name,
        academic_year = v_year,
        semester = v_sem,
        start_date = v_start,
        end_date = v_end,
        status = v_status,
        coordinator_user_id = COALESCE(NULLIF(trim(COALESCE(p_event->>'coordinatorUserId', '')), ''), coordinator_user_id),
        signer_city = v_signer_city,
        signer_title = v_signer_title,
        signer_name = v_signer_name,
        notes = CASE WHEN p_event ? 'notes' THEN NULLIF(trim(COALESCE(p_event->>'notes', '')), '') ELSE notes END,
        version = version + 1,
        updated_at = now()
    WHERE id = v_id;

    INSERT INTO public.ziyadah_accel_audit_logs (
      id, event_id, action_type, actor_user_id, actor_name_snapshot, actor_role,
      login_account_id, login_account_username, before_data, after_data
    ) VALUES (
      'za_aud_' || gen_random_uuid()::text, v_id, 'UPDATE_EVENT',
      v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
      v_actor.login_account_id, v_actor.login_username, to_jsonb(v_existing), p_event
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'eventId', v_id, 'message', 'Kegiatan Ujian Ziyadah Akselerasi berhasil disimpan.');
END;
$$;

-- ============================================================================
-- 14. RPC 3: MANAJEMEN PESERTA (TUNGGAL & MASSAL DARI STUDENTS EXISTING)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.za_enroll_participants_secure(
  p_username text,
  p_password text,
  p_event_id text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_event RECORD;
  v_item jsonb;
  v_student RECORD;
  v_teacher_name text;
  v_part_id text;
  v_added_count integer := 0;
  v_skipped_count integer := 0;
  v_sess RECORD;
  v_next_order integer;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  IF NOT v_actor.is_valid OR NOT public._za_is_coordinator(v_actor.actor_user_id, v_actor.effective_role, p_event_id, v_actor.is_shared_account) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Koordinator/Admin yang dapat mendaftarkan peserta.');
  END IF;

  SELECT * INTO v_event FROM public.ziyadah_accel_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kegiatan tidak ditemukan.');
  END IF;
  IF v_event.status IN ('finalized', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tidak dapat menambah peserta pada kegiatan yang sudah difinalisasi atau dibatalkan.');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    SELECT * INTO v_student FROM public.students WHERE id = (v_item->>'studentId');
    IF NOT FOUND THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    SELECT name INTO v_teacher_name FROM public.users WHERE id = v_student.teacher_id;

    SELECT id INTO v_part_id
    FROM public.ziyadah_accel_participants
    WHERE event_id = p_event_id AND student_id = v_student.id;

    IF FOUND THEN
      UPDATE public.ziyadah_accel_participants
      SET participant_status = 'active',
          withdraw_reason = NULL,
          updated_at = now()
      WHERE id = v_part_id AND participant_status = 'withdrawn';

      IF FOUND THEN
        v_added_count := v_added_count + 1;
      ELSE
        v_skipped_count := v_skipped_count + 1;
      END IF;
    ELSE
      v_part_id := 'za_prt_' || p_event_id || '_' || v_student.id;
      INSERT INTO public.ziyadah_accel_participants (
        id, event_id, student_id,
        student_name_snapshot, nis_snapshot, class_snapshot, halaqah_snapshot,
        halaqah_teacher_id_snapshot, halaqah_teacher_name_snapshot,
        memorization_direction_hint,
        baseline_surah, baseline_ayah, baseline_page, baseline_label,
        created_by
      ) VALUES (
        v_part_id, p_event_id, v_student.id,
        v_student.name, COALESCE(v_student.nis, '-'), COALESCE(v_student.class, '-'), COALESCE(v_student.halaqah, '-'),
        v_student.teacher_id, v_teacher_name,
        COALESCE(NULLIF(v_item->>'directionHint', ''), 'unknown'),
        NULLIF(v_item->>'baselineSurah', '')::integer,
        NULLIF(v_item->>'baselineAyah', '')::integer,
        NULLIF(v_item->>'baselinePage', '')::integer,
        NULLIF(trim(COALESCE(v_item->>'baselineLabel', '')), ''),
        v_actor.actor_user_id
      );
      v_added_count := v_added_count + 1;
    END IF;

    FOR v_sess IN
      SELECT * FROM public.ziyadah_accel_sessions
      WHERE event_id = p_event_id AND status != 'cancelled'
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.ziyadah_accel_submissions
        WHERE session_id = v_sess.id AND participant_id = v_part_id
      ) THEN
        SELECT COALESCE(MAX(queue_order), 0) + 1 INTO v_next_order
        FROM public.ziyadah_accel_submissions
        WHERE session_id = v_sess.id;

        INSERT INTO public.ziyadah_accel_submissions (
          id, event_id, session_id, participant_id, student_id,
          queue_tier, queue_order, fulfillment_status
        ) VALUES (
          'za_sub_' || v_sess.id || '_' || v_student.id,
          p_event_id, v_sess.id, v_part_id, v_student.id,
          'akselerasi_last', v_next_order, 'waiting_turn'
        ) ON CONFLICT (session_id, participant_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO public.ziyadah_accel_audit_logs (
    id, event_id, action_type, actor_user_id, actor_name_snapshot, actor_role,
    login_account_id, login_account_username, after_data
  ) VALUES (
    'za_aud_' || gen_random_uuid()::text, p_event_id, 'ENROLL_PARTICIPANTS',
    v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
    v_actor.login_account_id, v_actor.login_username,
    jsonb_build_object('addedCount', v_added_count, 'skippedCount', v_skipped_count)
  );

  RETURN jsonb_build_object(
    'success', true,
    'addedCount', v_added_count,
    'skippedCount', v_skipped_count,
    'message', format('Berhasil mendaftarkan %s peserta (%s sudah terdaftar dilewati).', v_added_count, v_skipped_count)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.za_update_participant_status_secure(
  p_username text,
  p_password text,
  p_participant_id text,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_part RECORD;
  v_event RECORD;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  SELECT * INTO v_part FROM public.ziyadah_accel_participants WHERE id = p_participant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Peserta tidak ditemukan.');
  END IF;

  IF NOT v_actor.is_valid OR NOT public._za_is_coordinator(v_actor.actor_user_id, v_actor.effective_role, v_part.event_id, v_actor.is_shared_account) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
  END IF;

  SELECT * INTO v_event FROM public.ziyadah_accel_events WHERE id = v_part.event_id;
  IF v_event.status = 'finalized' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kegiatan sudah difinalisasi dan terkunci.');
  END IF;

  IF p_status NOT IN ('active', 'withdrawn') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status peserta tidak valid.');
  END IF;

  UPDATE public.ziyadah_accel_participants
  SET participant_status = p_status,
       withdraw_reason = CASE WHEN p_status = 'withdrawn' THEN COALESCE(p_reason, 'Dinonaktifkan oleh Koordinator') ELSE NULL END,
      updated_at = now()
  WHERE id = p_participant_id;

  INSERT INTO public.ziyadah_accel_audit_logs (
    id, event_id, student_id, action_type, actor_user_id, actor_name_snapshot, actor_role,
    login_account_id, login_account_username, reason, before_data, after_data
  ) VALUES (
    'za_aud_' || gen_random_uuid()::text, v_part.event_id, v_part.student_id, 'UPDATE_PARTICIPANT_STATUS',
    v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
    v_actor.login_account_id, v_actor.login_username, p_reason,
    jsonb_build_object('status', v_part.participant_status),
    jsonb_build_object('status', p_status)
  );

  RETURN jsonb_build_object('success', true, 'message', 'Status kepesertaan berhasil diperbarui.');
END;
$$;

-- ============================================================================
-- 15. RPC 4: MANAJEMEN SESI DINAMIS (1..N), PENGUJI, & ANTREAN PER KELOMPOK
-- ============================================================================
CREATE OR REPLACE FUNCTION public.za_upsert_session_secure(
  p_username text,
  p_password text,
  p_session jsonb,
  p_examiners jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_event_id text;
  v_event RECORD;
  v_sess_id text;
  v_existing RECORD;
  v_sess_num integer;
  v_name text;
  v_date date;
  v_offset integer;
  v_ex jsonb;
  v_teacher RECORD;
  v_old_ex RECORD;
  v_part RECORD;
  v_order integer := 0;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  v_event_id := trim(COALESCE(p_session->>'eventId', ''));

  IF NOT v_actor.is_valid OR NOT public._za_is_coordinator(v_actor.actor_user_id, v_actor.effective_role, v_event_id, v_actor.is_shared_account) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Koordinator/Admin yang dapat mengatur sesi.');
  END IF;

  SELECT * INTO v_event FROM public.ziyadah_accel_events WHERE id = v_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kegiatan tidak ditemukan.');
  END IF;
  IF v_event.status IN ('finalized', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kegiatan sudah difinalisasi atau dibatalkan.');
  END IF;

  v_sess_id := COALESCE(NULLIF(trim(p_session->>'id'), ''), 'za_ses_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_' || substr(md5(random()::text), 1, 4));
  SELECT * INTO v_existing FROM public.ziyadah_accel_sessions WHERE id = v_sess_id FOR UPDATE;

  IF FOUND THEN
    v_sess_num := COALESCE(NULLIF(p_session->>'sessionNumber', '')::integer, v_existing.session_number);
  ELSE
    v_sess_num := COALESCE(
      NULLIF(p_session->>'sessionNumber', '')::integer,
      (SELECT COALESCE(MAX(session_number), 0) + 1 FROM public.ziyadah_accel_sessions WHERE event_id = v_event_id)
    );
  END IF;

  v_name := COALESCE(NULLIF(trim(p_session->>'name'), ''), 'Sesi ' || v_sess_num::text);
  v_date := COALESCE(NULLIF(p_session->>'sessionDate', '')::date, v_event.start_date);
  v_offset := GREATEST(0, COALESCE(NULLIF(p_session->>'regularQueueOffset', '')::integer, 0));

  IF NOT FOUND THEN
    INSERT INTO public.ziyadah_accel_sessions (
      id, event_id, session_number, name, session_date, start_time, end_time,
      status, queue_mode, regular_queue_offset
    ) VALUES (
      v_sess_id, v_event_id, v_sess_num, v_name, v_date,
      NULLIF(trim(COALESCE(p_session->>'startTime', '')), ''),
      NULLIF(trim(COALESCE(p_session->>'endTime', '')), ''),
      COALESCE(NULLIF(trim(p_session->>'status'), ''), 'scheduled'),
      COALESCE(NULLIF(trim(p_session->>'queueMode'), ''), 'akselerasi_last'),
      v_offset
    );
  ELSE
    UPDATE public.ziyadah_accel_sessions
    SET session_number = v_sess_num,
        name = v_name,
        session_date = v_date,
        start_time = NULLIF(trim(COALESCE(p_session->>'startTime', '')), ''),
        end_time = NULLIF(trim(COALESCE(p_session->>'endTime', '')), ''),
        queue_mode = COALESCE(NULLIF(trim(p_session->>'queueMode'), ''), queue_mode),
        regular_queue_offset = v_offset,
        version = version + 1,
        updated_at = now()
    WHERE id = v_sess_id;
  END IF;

  -- Sinkronisasi daftar penguji sesi beserta regular_queue_offset per kelompok penguji
  IF jsonb_typeof(p_examiners) = 'array' THEN
    -- Hapus penugasan yang tidak lagi ada di payload
    DELETE FROM public.ziyadah_accel_session_examiners
    WHERE session_id = v_sess_id
      AND examiner_user_id NOT IN (
        SELECT COALESCE(x->>'examinerUserId', '')
        FROM jsonb_array_elements(p_examiners) x
      );

    FOR v_ex IN SELECT * FROM jsonb_array_elements(p_examiners)
    LOOP
      SELECT id, name INTO v_teacher FROM public.users
      WHERE id = (v_ex->>'examinerUserId') AND role IN ('teacher', 'admin');

      IF FOUND THEN
        SELECT * INTO v_old_ex FROM public.ziyadah_accel_session_examiners
        WHERE session_id = v_sess_id AND examiner_user_id = v_teacher.id;

        INSERT INTO public.ziyadah_accel_session_examiners (
          id, event_id, session_id, examiner_user_id, examiner_name_snapshot,
          group_label, can_examine_all, assigned_classes, assigned_halaqahs, assigned_participant_ids,
          regular_queue_offset, regular_finish_confirmed, regular_finished_at, regular_finished_by
        ) VALUES (
          'za_sex_' || v_sess_id || '_' || v_teacher.id,
          v_event_id, v_sess_id, v_teacher.id, v_teacher.name,
          NULLIF(trim(COALESCE(v_ex->>'groupLabel', '')), ''),
          COALESCE((v_ex->>'canExamineAll')::boolean, false),
          COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_ex->'assignedClasses', '[]'::jsonb))), '{}'::text[]),
          COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_ex->'assignedHalaqahs', '[]'::jsonb))), '{}'::text[]),
          COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_ex->'assignedParticipantIds', '[]'::jsonb))), '{}'::text[]),
          GREATEST(0, COALESCE(NULLIF(v_ex->>'regularQueueOffset', '')::integer, v_old_ex.regular_queue_offset, v_offset)),
          COALESCE((v_ex->>'regularFinishConfirmed')::boolean, v_old_ex.regular_finish_confirmed, false),
          v_old_ex.regular_finished_at,
          v_old_ex.regular_finished_by
        )
        ON CONFLICT (session_id, examiner_user_id) DO UPDATE
          SET examiner_name_snapshot = EXCLUDED.examiner_name_snapshot,
              group_label = EXCLUDED.group_label,
              can_examine_all = EXCLUDED.can_examine_all,
              assigned_classes = EXCLUDED.assigned_classes,
              assigned_halaqahs = EXCLUDED.assigned_halaqahs,
              assigned_participant_ids = EXCLUDED.assigned_participant_ids,
              regular_queue_offset = EXCLUDED.regular_queue_offset,
              regular_finish_confirmed = EXCLUDED.regular_finish_confirmed;
      END IF;
    END LOOP;
  END IF;

  -- Inisialisasi slot giliran ('waiting_turn', tier 'akselerasi_last') untuk seluruh peserta aktif
  SELECT COALESCE(MAX(queue_order), 0) INTO v_order
  FROM public.ziyadah_accel_submissions WHERE session_id = v_sess_id;

  FOR v_part IN
    SELECT * FROM public.ziyadah_accel_participants
    WHERE event_id = v_event_id AND participant_status = 'active'
    ORDER BY class_snapshot ASC, student_name_snapshot ASC
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.ziyadah_accel_submissions
      WHERE session_id = v_sess_id AND participant_id = v_part.id
    ) THEN
      v_order := v_order + 1;
      INSERT INTO public.ziyadah_accel_submissions (
        id, event_id, session_id, participant_id, student_id,
        queue_tier, queue_order, fulfillment_status
      ) VALUES (
        'za_sub_' || v_sess_id || '_' || v_part.student_id,
        v_event_id, v_sess_id, v_part.id, v_part.student_id,
        'akselerasi_last', v_order, 'waiting_turn'
      ) ON CONFLICT (session_id, participant_id) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO public.ziyadah_accel_audit_logs (
    id, event_id, session_id, action_type, actor_user_id, actor_name_snapshot, actor_role,
    login_account_id, login_account_username, after_data
  ) VALUES (
    'za_aud_' || gen_random_uuid()::text, v_event_id, v_sess_id, 'UPSERT_SESSION',
    v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
    v_actor.login_account_id, v_actor.login_username,
    jsonb_build_object('session', p_session, 'examinerCount', jsonb_array_length(COALESCE(p_examiners, '[]'::jsonb)))
  );

  RETURN jsonb_build_object('success', true, 'sessionId', v_sess_id, 'message', 'Sesi ujian akselerasi berhasil disimpan.');
END;
$$;

CREATE OR REPLACE FUNCTION public.za_set_session_status_secure(
  p_username text,
  p_password text,
  p_session_id text,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_sess RECORD;
  v_event RECORD;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  SELECT * INTO v_sess FROM public.ziyadah_accel_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak ditemukan.');
  END IF;

  IF NOT v_actor.is_valid OR NOT public._za_is_coordinator(v_actor.actor_user_id, v_actor.effective_role, v_sess.event_id, v_actor.is_shared_account) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
  END IF;

  SELECT * INTO v_event FROM public.ziyadah_accel_events WHERE id = v_sess.event_id FOR UPDATE;
  IF v_event.status = 'finalized' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kegiatan sudah difinalisasi dan terkunci.');
  END IF;

  IF p_status NOT IN ('draft', 'scheduled', 'active', 'closed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status sesi tidak valid.');
  END IF;

  IF p_status = 'cancelled' AND EXISTS (
    SELECT 1 FROM public.ziyadah_accel_submissions
    WHERE session_id = p_session_id AND fulfillment_status = 'submitted'
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi yang sudah memiliki setoran nilai santri tidak dapat dibatalkan langsung. Tutup sesi atau batalkan setoran terlebih dahulu.');
  END IF;

  UPDATE public.ziyadah_accel_sessions
  SET status = p_status,
      activated_at = CASE WHEN p_status = 'active' THEN COALESCE(activated_at, now()) ELSE activated_at END,
      activated_by = CASE WHEN p_status = 'active' THEN v_actor.actor_user_id ELSE activated_by END,
      closed_at = CASE WHEN p_status = 'closed' THEN now() ELSE closed_at END,
      closed_by = CASE WHEN p_status = 'closed' THEN v_actor.actor_user_id ELSE closed_by END,
      cancelled_at = CASE WHEN p_status = 'cancelled' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN p_status = 'cancelled' THEN v_actor.actor_user_id ELSE cancelled_by END,
      cancel_reason = CASE WHEN p_status = 'cancelled' THEN COALESCE(p_reason, 'Dibatalkan oleh Koordinator') ELSE cancel_reason END,
      version = version + 1,
      updated_at = now()
  WHERE id = p_session_id;

  IF p_status = 'active' AND v_event.status IN ('draft', 'scheduled') THEN
    UPDATE public.ziyadah_accel_events SET status = 'active', updated_at = now() WHERE id = v_event.id;
  END IF;

  IF p_status = 'closed' THEN
    UPDATE public.ziyadah_accel_submissions
    SET fulfillment_status = 'pending_examiner_input',
        updated_at = now()
    WHERE session_id = p_session_id AND fulfillment_status = 'waiting_turn';
  ELSIF p_status = 'active' THEN
    UPDATE public.ziyadah_accel_submissions
    SET fulfillment_status = 'waiting_turn',
        updated_at = now()
    WHERE session_id = p_session_id AND fulfillment_status = 'pending_examiner_input';
  END IF;

  INSERT INTO public.ziyadah_accel_audit_logs (
    id, event_id, session_id, action_type, actor_user_id, actor_name_snapshot, actor_role,
    login_account_id, login_account_username, reason, before_data, after_data
  ) VALUES (
    'za_aud_' || gen_random_uuid()::text, v_sess.event_id, p_session_id, 'SET_SESSION_STATUS',
    v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
    v_actor.login_account_id, v_actor.login_username, p_reason,
    jsonb_build_object('status', v_sess.status),
    jsonb_build_object('status', p_status)
  );

  RETURN jsonb_build_object('success', true, 'status', p_status, 'message', 'Status sesi diperbarui menjadi ' || upper(p_status) || '.');
END;
$$;

-- PERBAIKAN B-11 & A.4:
-- 1. Kunci kegiatan finalized/cancelled
-- 2. Dukung pengaturan offset reguler & konfirmasi selesai reguler per kelompok penguji (examinerGroupSettings)
-- 3. Izinkan penguji tertugas mengonfirmasi selesainya setoran reguler pada majelisnya sendiri
-- 4. Catat seluruh perubahan di ziyadah_accel_audit_logs
CREATE OR REPLACE FUNCTION public.za_reorder_queue_secure(
  p_username text,
  p_password text,
  p_session_id text,
  p_orders jsonb,
  p_regular_offset integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_sess RECORD;
  v_event RECORD;
  v_is_coord boolean;
  v_item jsonb;
  v_ex_id text;
  v_ex_offset integer;
  v_ex_confirmed boolean;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  IF NOT v_actor.is_valid THEN
    RETURN jsonb_build_object('success', false, 'errorCode', v_actor.error_code, 'message', v_actor.error_message);
  END IF;

  SELECT * INTO v_sess FROM public.ziyadah_accel_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi tidak ditemukan.');
  END IF;

  SELECT * INTO v_event FROM public.ziyadah_accel_events WHERE id = v_sess.event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status IN ('finalized', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'EVENT_LOCKED', 'message', 'Kegiatan sudah difinalisasi atau dibatalkan sehingga antrean tidak dapat diubah.');
  END IF;

  v_is_coord := public._za_is_coordinator(
    v_actor.actor_user_id,
    v_actor.effective_role,
    v_sess.event_id,
    v_actor.is_shared_account
  );

  -- Mode khusus konfirmasi selesai reguler oleh Penguji Majelis sendiri (jika p_orders berupa objek dgn action = 'confirm_regular_done')
  IF jsonb_typeof(p_orders) = 'object' AND (p_orders->>'action') = 'confirm_regular_done' THEN
    v_ex_id := COALESCE(NULLIF(trim(p_orders->>'examinerUserId'), ''), v_actor.actor_user_id);
    IF NOT v_is_coord AND v_ex_id != v_actor.actor_user_id THEN
      RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Anda hanya dapat mengubah status antrean majelis Anda sendiri.');
    END IF;

    IF NOT v_is_coord AND NOT EXISTS (
      SELECT 1 FROM public.ziyadah_accel_session_examiners
      WHERE session_id = p_session_id AND examiner_user_id = v_actor.actor_user_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Anda tidak ditugaskan pada sesi ini.');
    END IF;

    v_ex_confirmed := COALESCE((p_orders->>'confirmed')::boolean, true);
    v_ex_offset := NULLIF(p_orders->>'regularQueueOffset', '')::integer;

    UPDATE public.ziyadah_accel_session_examiners
    SET regular_finish_confirmed = v_ex_confirmed,
        regular_finished_at = CASE WHEN v_ex_confirmed THEN now() ELSE NULL END,
        regular_finished_by = CASE WHEN v_ex_confirmed THEN v_actor.actor_user_id ELSE NULL END,
        regular_queue_offset = CASE WHEN v_ex_offset IS NOT NULL AND v_ex_offset >= 0 THEN v_ex_offset ELSE regular_queue_offset END
    WHERE session_id = p_session_id AND examiner_user_id = v_ex_id;

    INSERT INTO public.ziyadah_accel_audit_logs (
      id, event_id, session_id, action_type, actor_user_id, actor_name_snapshot, actor_role,
      login_account_id, login_account_username, after_data
    ) VALUES (
      'za_aud_' || gen_random_uuid()::text, v_sess.event_id, p_session_id, 'CONFIRM_REGULAR_QUEUE_DONE',
      v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
      v_actor.login_account_id, v_actor.login_username,
      jsonb_build_object('examinerUserId', v_ex_id, 'regularFinishConfirmed', v_ex_confirmed, 'regularQueueOffset', v_ex_offset)
    );

    RETURN jsonb_build_object('success', true, 'message', 'Status selesainya setoran reguler majelis berhasil diperbarui.');
  END IF;

  -- Untuk pengurutan ulang penuh peserta, wajib Koordinator/Admin
  IF NOT v_is_coord THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Koordinator/Admin yang dapat mengatur ulang urutan peserta.');
  END IF;

  IF p_regular_offset IS NOT NULL AND p_regular_offset >= 0 THEN
    UPDATE public.ziyadah_accel_sessions
    SET regular_queue_offset = p_regular_offset, updated_at = now()
    WHERE id = p_session_id;
  END IF;

  -- Mendukung baik p_orders berupa array langsung maupun objek { orders: [...], examinerOffsets: [...] }
  IF jsonb_typeof(p_orders) = 'object' THEN
    IF jsonb_typeof(p_orders->'examinerOffsets') = 'array' THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_orders->'examinerOffsets')
      LOOP
        UPDATE public.ziyadah_accel_session_examiners
        SET regular_queue_offset = GREATEST(0, COALESCE((v_item->>'regularQueueOffset')::integer, regular_queue_offset)),
            group_label = COALESCE(NULLIF(trim(v_item->>'groupLabel'), ''), group_label),
            regular_finish_confirmed = COALESCE((v_item->>'regularFinishConfirmed')::boolean, regular_finish_confirmed),
            regular_finished_at = CASE
              WHEN (v_item->>'regularFinishConfirmed')::boolean IS TRUE THEN COALESCE(regular_finished_at, now())
              WHEN (v_item->>'regularFinishConfirmed')::boolean IS FALSE THEN NULL
              ELSE regular_finished_at
            END
        WHERE session_id = p_session_id
          AND examiner_user_id = (v_item->>'examinerUserId');
      END LOOP;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_orders->'orders', '[]'::jsonb))
    LOOP
      UPDATE public.ziyadah_accel_submissions
      SET queue_order = GREATEST(1, COALESCE((v_item->>'queueOrder')::integer, queue_order)),
          assigned_examiner_id = CASE
            WHEN v_item ? 'assignedExaminerId' THEN NULLIF(trim(COALESCE(v_item->>'assignedExaminerId', '')), '')
            ELSE assigned_examiner_id
          END,
          group_label = CASE
            WHEN v_item ? 'groupLabel' THEN NULLIF(trim(COALESCE(v_item->>'groupLabel', '')), '')
            ELSE group_label
          END,
          updated_at = now()
      WHERE session_id = p_session_id
        AND participant_id = (v_item->>'participantId');
    END LOOP;
  ELSIF jsonb_typeof(p_orders) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_orders)
    LOOP
      UPDATE public.ziyadah_accel_submissions
      SET queue_order = GREATEST(1, COALESCE((v_item->>'queueOrder')::integer, queue_order)),
          assigned_examiner_id = COALESCE(NULLIF(v_item->>'assignedExaminerId', ''), assigned_examiner_id),
          group_label = COALESCE(NULLIF(v_item->>'groupLabel', ''), group_label),
          updated_at = now()
      WHERE session_id = p_session_id
        AND participant_id = (v_item->>'participantId');
    END LOOP;
  END IF;

  INSERT INTO public.ziyadah_accel_audit_logs (
    id, event_id, session_id, action_type, actor_user_id, actor_name_snapshot, actor_role,
    login_account_id, login_account_username, after_data
  ) VALUES (
    'za_aud_' || gen_random_uuid()::text, v_sess.event_id, p_session_id, 'REORDER_QUEUE',
    v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
    v_actor.login_account_id, v_actor.login_username,
    jsonb_build_object('regularOffset', p_regular_offset, 'payloadType', jsonb_typeof(p_orders))
  );

  RETURN jsonb_build_object('success', true, 'message', 'Urutan giliran peserta akselerasi berhasil diperbarui.');
END;
$$;

-- ============================================================================
-- 16. RPC 5: WORKSPACE LENGKAP (MEMBATASI PESERTA & SESI BAGI PENGUJI BIASA — B-11)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.za_get_event_workspace_secure(
  p_username text,
  p_password text,
  p_event_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_event RECORD;
  v_is_coord boolean;
  v_participants jsonb;
  v_sessions jsonb;
  v_examiners jsonb;
  v_submissions jsonb;
  v_snapshot jsonb := NULL;
  v_audits jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  IF NOT v_actor.is_valid THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorCode', v_actor.error_code,
      'pinRequired', (v_actor.error_code IN ('PIN_REQUIRED', 'PIN_EXPIRED', 'PIN_REVOKED')),
      'message', v_actor.error_message
    );
  END IF;

  SELECT * INTO v_event FROM public.ziyadah_accel_events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kegiatan tidak ditemukan.');
  END IF;

  v_is_coord := public._za_is_coordinator(
    v_actor.actor_user_id,
    v_actor.effective_role,
    p_event_id,
    v_actor.is_shared_account
  );

  IF NOT v_is_coord AND NOT EXISTS (
    SELECT 1 FROM public.ziyadah_accel_session_examiners se
    JOIN public.ziyadah_accel_sessions s ON s.id = se.session_id
    WHERE se.event_id = p_event_id
      AND se.examiner_user_id = v_actor.actor_user_id
      AND s.status != 'cancelled'
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'ACCESS_DENIED', 'message', 'Akses ditolak: Anda tidak ditugaskan sebagai penguji pada kegiatan ini.');
  END IF;

  -- PERBAIKAN B-11: Penguji non-koordinator HANYA menerima daftar peserta yang berhak diujinya!
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'eventId', p.event_id,
    'studentId', p.student_id,
    'studentNameSnapshot', p.student_name_snapshot,
    'nisSnapshot', p.nis_snapshot,
    'classSnapshot', p.class_snapshot,
    'halaqahSnapshot', p.halaqah_snapshot,
    'halaqahTeacherIdSnapshot', p.halaqah_teacher_id_snapshot,
    'halaqahTeacherNameSnapshot', p.halaqah_teacher_name_snapshot,
    'memorizationDirectionHint', p.memorization_direction_hint,
    'baselineSurah', p.baseline_surah,
    'baselineAyah', p.baseline_ayah,
    'baselinePage', p.baseline_page,
    'baselineLabel', p.baseline_label,
    'participantStatus', p.participant_status,
    'withdrawReason', p.withdraw_reason,
    'createdAt', p.created_at
  ) ORDER BY p.student_name_snapshot ASC), '[]'::jsonb)
  INTO v_participants
  FROM public.ziyadah_accel_participants p
  WHERE p.event_id = p_event_id
    AND (
      v_is_coord
      OR EXISTS (
        SELECT 1 FROM public.ziyadah_accel_sessions sx
        WHERE sx.event_id = p_event_id
          AND sx.status != 'cancelled'
          AND public._za_can_examine_participant(
            sx.id, v_actor.actor_user_id, v_actor.effective_role, p_event_id,
            p.id, p.class_snapshot, p.halaqah_snapshot, v_actor.is_shared_account
          )
      )
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'eventId', s.event_id,
    'sessionNumber', s.session_number,
    'name', s.name,
    'sessionDate', s.session_date,
    'startTime', s.start_time,
    'endTime', s.end_time,
    'status', s.status,
    'queueMode', s.queue_mode,
    'regularQueueOffset', s.regular_queue_offset,
    'activatedAt', s.activated_at,
    'closedAt', s.closed_at,
    'cancelledAt', s.cancelled_at,
    'cancelReason', s.cancel_reason,
    'version', s.version
  ) ORDER BY s.session_number ASC), '[]'::jsonb)
  INTO v_sessions
  FROM public.ziyadah_accel_sessions s
  WHERE s.event_id = p_event_id
    AND (
      v_is_coord
      OR EXISTS (
        SELECT 1 FROM public.ziyadah_accel_session_examiners se
        WHERE se.session_id = s.id AND se.examiner_user_id = v_actor.actor_user_id
      )
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', se.id,
    'eventId', se.event_id,
    'sessionId', se.session_id,
    'examinerUserId', se.examiner_user_id,
    'examinerNameSnapshot', se.examiner_name_snapshot,
    'groupLabel', se.group_label,
    'canExamineAll', se.can_examine_all,
    'assignedClasses', se.assigned_classes,
    'assignedHalaqahs', se.assigned_halaqahs,
    'assignedParticipantIds', se.assigned_participant_ids,
    'regularQueueOffset', se.regular_queue_offset,
    'regularFinishConfirmed', se.regular_finish_confirmed,
    'regularFinishedAt', se.regular_finished_at
  )), '[]'::jsonb)
  INTO v_examiners
  FROM public.ziyadah_accel_session_examiners se
  WHERE se.event_id = p_event_id
    AND (v_is_coord OR se.examiner_user_id = v_actor.actor_user_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', sub.id,
    'eventId', sub.event_id,
    'sessionId', sub.session_id,
    'participantId', sub.participant_id,
    'studentId', sub.student_id,
    'assignedExaminerId', sub.assigned_examiner_id,
    'groupLabel', sub.group_label,
    'queueTier', sub.queue_tier,
    'queueOrder', sub.queue_order,
    'fulfillmentStatus', sub.fulfillment_status,
    'verificationStatus', sub.verification_status,
    'verificationFlags', sub.verification_flags,
    'confirmedPages', sub.confirmed_pages,
    'systemSuggestedPages', sub.system_suggested_pages,
    'approvedUniquePages', sub.approved_unique_pages,
    'score', sub.score,
    'absenceReason', sub.absence_reason,
    'examinerNotes', sub.examiner_notes,
    'recordedByUserId', sub.recorded_by_user_id,
    'recordedByNameSnapshot', sub.recorded_by_name_snapshot,
    'loginAccountUsername', sub.login_account_username,
    'submittedAt', sub.submitted_at,
    'verifiedBy', sub.verified_by,
    'verifiedByNameSnapshot', sub.verified_by_name_snapshot,
    'verifiedAt', sub.verified_at,
    'verificationNote', sub.verification_note,
    'version', sub.version,
    'updatedAt', sub.updated_at,
    'ranges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'rangeOrder', r.range_order,
        'juzNumber', r.juz_number,
        'surahNumber', r.surah_number,
        'surahNameSnapshot', r.surah_name_snapshot,
        'ayahStart', r.ayah_start,
        'ayahEnd', r.ayah_end,
        'startPage', r.start_page,
        'endPage', r.end_page,
        'overlapFlag', r.overlap_flag,
        'overlapDetail', r.overlap_detail
      ) ORDER BY r.range_order ASC)
      FROM public.ziyadah_accel_submission_ranges r
      WHERE r.submission_id = sub.id AND r.range_status = 'active'
    ), '[]'::jsonb)
  ) ORDER BY sub.queue_order ASC), '[]'::jsonb)
  INTO v_submissions
  FROM public.ziyadah_accel_submissions sub
  JOIN public.ziyadah_accel_participants p ON p.id = sub.participant_id
  WHERE sub.event_id = p_event_id
    AND (
      v_is_coord
      OR EXISTS (
        SELECT 1 FROM public.ziyadah_accel_sessions sx
        WHERE sx.event_id = p_event_id
          AND sx.status != 'cancelled'
          AND public._za_can_examine_participant(
            sx.id, v_actor.actor_user_id, v_actor.effective_role, p_event_id,
            p.id, p.class_snapshot, p.halaqah_snapshot, v_actor.is_shared_account
          )
      )
    );

  IF v_event.status = 'finalized' AND v_is_coord THEN
    SELECT jsonb_build_object(
      'id', fs.id,
      'snapshotVersion', fs.snapshot_version,
      'frozenSummary', fs.frozen_summary,
      'frozenStudentRows', fs.frozen_student_rows,
      'frozenSessionMatrix', fs.frozen_session_matrix,
      'finalizedBy', fs.finalized_by,
      'finalizedByName', fs.finalized_by_name,
      'finalizedAt', fs.finalized_at
    )
    INTO v_snapshot
    FROM public.ziyadah_accel_final_snapshots fs
    WHERE fs.event_id = p_event_id;
  END IF;

  IF v_is_coord THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'sessionId', a.session_id,
      'submissionId', a.submission_id,
      'studentId', a.student_id,
      'actionType', a.action_type,
      'actorUserId', a.actor_user_id,
      'actorNameSnapshot', a.actor_name_snapshot,
      'actorRole', a.actor_role,
      'loginAccountUsername', a.login_account_username,
      'beforeData', a.before_data,
      'afterData', a.after_data,
      'reason', a.reason,
      'createdAt', a.created_at
    ) ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO v_audits
    FROM (
      SELECT * FROM public.ziyadah_accel_audit_logs
      WHERE event_id = p_event_id
      ORDER BY created_at DESC LIMIT 120
    ) a;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'isCoordinator', v_is_coord,
    'actorUserId', v_actor.actor_user_id,
    'actorName', v_actor.actor_name,
    'isSharedAccount', v_actor.is_shared_account,
    'event', jsonb_build_object(
      'id', v_event.id,
      'academicTermId', v_event.academic_term_id,
      'name', v_event.name,
      'academicYear', v_event.academic_year,
      'semester', v_event.semester,
      'startDate', v_event.start_date,
      'endDate', v_event.end_date,
      'status', v_event.status,
      'coordinatorUserId', v_event.coordinator_user_id,
      'signerCity', v_event.signer_city,
      'signerTitle', v_event.signer_title,
      'signerName', v_event.signer_name,
      'notes', v_event.notes,
      'finalizedAt', v_event.finalized_at,
      'finalizedBy', v_event.finalized_by,
      'reopenedAt', v_event.reopened_at,
      'reopenReason', v_event.reopen_reason,
      'version', v_event.version
    ),
    'participants', v_participants,
    'sessions', v_sessions,
    'sessionExaminers', v_examiners,
    'submissions', v_submissions,
    'finalSnapshot', v_snapshot,
    'auditLogs', v_audits
  );
END;
$$;

-- ============================================================================
-- 17. RPC 6: INPUT / KOREKSI SETORAN PENGUJI (ATOMIK, IDEMPOTENT, LOCKED, AUDIT INDIVIDUAL)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.za_submit_setoran_secure(
  p_username text,
  p_password text,
  p_payload jsonb,
  p_expected_version integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_session_id text;
  v_participant_id text;
  v_sess RECORD;
  v_event RECORD;
  v_part RECORD;
  v_sub RECORD;
  v_old_ranges jsonb := '[]'::jsonb;
  v_is_coord boolean;
  v_fulfillment text;
  v_confirmed_pages numeric(6,2);
  v_suggested_pages numeric(6,2);
  v_score numeric(5,2);
  v_absence_reason text;
  v_notes text;
  v_reason text;
  v_ranges jsonb;
  v_r jsonb;
  v_idx integer := 0;
  v_surah integer;
  v_ayah_start integer;
  v_ayah_end integer;
  v_max_ayah integer;
  v_start_page integer;
  v_end_page integer;
  v_juz integer;
  v_flags text[] := '{}'::text[];
  v_verify_status text := 'clean';
  v_unique_pages numeric(6,2) := NULL;
  v_overlap_rec RECORD;
  v_prior_ref RECORD;
  v_prev_loop_surah integer := NULL;
  v_prev_loop_ayah_end integer := NULL;
  v_cont_flag text := NULL;
  v_has_exact_dup boolean := false;
  v_sub_id text;
  v_new_version integer;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  IF NOT v_actor.is_valid THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorCode', v_actor.error_code,
      'pinRequired', (v_actor.error_code IN ('PIN_REQUIRED', 'PIN_EXPIRED', 'PIN_REVOKED')),
      'message', v_actor.error_message
    );
  END IF;

  v_session_id := trim(COALESCE(p_payload->>'sessionId', ''));
  v_participant_id := trim(COALESCE(p_payload->>'participantId', ''));
  v_fulfillment := trim(COALESCE(p_payload->>'fulfillmentStatus', 'submitted'));
  v_reason := NULLIF(trim(COALESCE(p_payload->>'correctionReason', '')), '');

  SELECT * INTO v_sess FROM public.ziyadah_accel_sessions WHERE id = v_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sesi ujian tidak ditemukan.');
  END IF;

  SELECT * INTO v_event FROM public.ziyadah_accel_events WHERE id = v_sess.event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kegiatan tidak ditemukan.');
  END IF;

  IF v_event.status IN ('finalized', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'EVENT_LOCKED', 'message', 'Kegiatan sudah difinalisasi atau dibatalkan sehingga data tidak dapat diubah.');
  END IF;

  SELECT * INTO v_part FROM public.ziyadah_accel_participants WHERE id = v_participant_id AND event_id = v_event.id;
  IF NOT FOUND OR v_part.participant_status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Peserta tidak ditemukan atau tidak aktif pada kegiatan ini.');
  END IF;

  v_is_coord := public._za_is_coordinator(
    v_actor.actor_user_id,
    v_actor.effective_role,
    v_event.id,
    v_actor.is_shared_account
  );

  IF NOT public._za_can_examine_participant(
    v_session_id, v_actor.actor_user_id, v_actor.effective_role, v_event.id,
    v_part.id, v_part.class_snapshot, v_part.halaqah_snapshot, v_actor.is_shared_account
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'ACCESS_DENIED', 'message', 'Akses ditolak: Anda tidak ditugaskan menguji peserta ini pada sesi terpilih.');
  END IF;

  IF v_sess.status != 'active' AND NOT v_is_coord THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'SESSION_NOT_ACTIVE', 'message', 'Sesi saat ini tidak berstatus Aktif (' || upper(v_sess.status) || '). Hubungi Koordinator jika memerlukan koreksi.');
  END IF;

  INSERT INTO public.ziyadah_accel_submissions (
    id, event_id, session_id, participant_id, student_id, queue_tier, queue_order, fulfillment_status
  ) VALUES (
    'za_sub_' || v_session_id || '_' || v_part.student_id,
    v_event.id, v_session_id, v_part.id, v_part.student_id, 'akselerasi_last', 1, 'waiting_turn'
  ) ON CONFLICT (session_id, participant_id) DO NOTHING;

  SELECT * INTO v_sub
  FROM public.ziyadah_accel_submissions
  WHERE session_id = v_session_id AND participant_id = v_part.id
  FOR UPDATE;

  v_sub_id := v_sub.id;

  -- 1. Idempotency Guard (Anti Klik Ganda / Retry Jaringan)
  IF p_idempotency_key IS NOT NULL AND p_idempotency_key != '' AND v_sub.last_idempotency_key = p_idempotency_key THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotentReplay', true,
      'submissionId', v_sub.id,
      'version', v_sub.version,
      'verificationStatus', v_sub.verification_status,
      'message', 'Setoran telah tersimpan dengan aman di server.'
    );
  END IF;

  -- 2. Optimistic Concurrency Check (Anti Tertimpa Penguji Lain)
  IF p_expected_version IS NOT NULL AND v_sub.version != p_expected_version THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorCode', 'VERSION_CONFLICT',
      'currentVersion', v_sub.version,
      'currentRecordedBy', v_sub.recorded_by_name_snapshot,
      'message', 'Konflik perubahan terdeteksi: Data peserta ini baru saja diperbarui oleh ' || COALESCE(v_sub.recorded_by_name_snapshot, 'pengguna lain') || '. Muat ulang sebelum menyimpan.'
    );
  END IF;

  -- 3. Perlindungan Kepemilikan Penguji Individual (Berlaku baik akun pribadi maupun ganti PIN pada akun bersama!)
  IF NOT v_is_coord
     AND v_sub.fulfillment_status = 'submitted'
     AND v_sub.recorded_by_user_id IS NOT NULL
     AND v_sub.recorded_by_user_id != v_actor.actor_user_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorCode', 'OTHER_EXAMINER_LOCKED',
      'message', 'Setoran ini telah dicatat oleh ' || COALESCE(v_sub.recorded_by_name_snapshot, 'penguji lain') || '. Hanya penguji pencatat asli atau Koordinator yang dapat mengoreksi.'
    );
  END IF;

  -- Wajibkan alasan koreksi jika mengubah setoran yang sudah submitted
  IF v_sub.fulfillment_status = 'submitted' AND (v_reason IS NULL OR length(v_reason) < 3) THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorCode', 'REASON_REQUIRED',
      'message', 'Alasan koreksi wajib diisi (minimal 3 karakter) untuk perubahan nilai/setoran yang sudah tersimpan.'
    );
  END IF;

  -- Ambil snapshot rentang aktif lama sebelum koreksi untuk kelengkapan audit log
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'surahNumber', r.surah_number,
    'surahName', r.surah_name_snapshot,
    'ayahStart', r.ayah_start,
    'ayahEnd', r.ayah_end
  ) ORDER BY r.range_order ASC), '[]'::jsonb)
  INTO v_old_ranges
  FROM public.ziyadah_accel_submission_ranges r
  WHERE r.submission_id = v_sub_id AND r.range_status = 'active';

  v_notes := NULLIF(trim(COALESCE(p_payload->>'examinerNotes', '')), '');

  -- CABANG A: STATUS NON-SUBMITTED -> NILAI & HALAMAN WAJIB NULL!
  IF v_fulfillment IN ('absent', 'called_not_submitted', 'waiting_turn', 'pending_examiner_input', 'cancelled') THEN
    v_absence_reason := CASE
      WHEN v_fulfillment = 'absent' THEN COALESCE(NULLIF(trim(COALESCE(p_payload->>'absenceReason', '')), ''), 'other')
      ELSE NULL
    END;

    UPDATE public.ziyadah_accel_submission_ranges
    SET range_status = 'void'
    WHERE submission_id = v_sub_id AND range_status = 'active';

    v_new_version := v_sub.version + 1;

    UPDATE public.ziyadah_accel_submissions
    SET fulfillment_status = v_fulfillment,
        verification_status = 'clean',
        verification_flags = '{}'::text[],
        confirmed_pages = NULL,
        system_suggested_pages = NULL,
        approved_unique_pages = NULL,
        score = NULL,
        absence_reason = v_absence_reason,
        examiner_notes = v_notes,
        recorded_by_user_id = v_actor.actor_user_id,
        recorded_by_name_snapshot = v_actor.actor_name,
        login_account_id = v_actor.login_account_id,
        login_account_username = v_actor.login_username,
        submitted_at = CASE WHEN v_fulfillment = 'absent' THEN now() ELSE NULL END,
        cancel_reason = CASE WHEN v_fulfillment = 'cancelled' THEN COALESCE(v_reason, 'Dibatalkan') ELSE NULL END,
        last_idempotency_key = COALESCE(NULLIF(p_idempotency_key, ''), last_idempotency_key),
        version = v_new_version,
        updated_at = now()
    WHERE id = v_sub_id;

    INSERT INTO public.ziyadah_accel_audit_logs (
      id, event_id, session_id, submission_id, student_id,
      action_type, actor_user_id, actor_name_snapshot, actor_role,
      login_account_id, login_account_username, reason, idempotency_key,
      before_data, after_data
    ) VALUES (
      'za_aud_' || gen_random_uuid()::text, v_event.id, v_session_id, v_sub_id, v_part.student_id,
      'UPDATE_NON_SUBMISSION_STATUS', v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
      v_actor.login_account_id, v_actor.login_username, v_reason, p_idempotency_key,
      jsonb_build_object('fulfillmentStatus', v_sub.fulfillment_status, 'score', v_sub.score, 'confirmedPages', v_sub.confirmed_pages, 'ranges', v_old_ranges),
      jsonb_build_object('fulfillmentStatus', v_fulfillment, 'absenceReason', v_absence_reason)
    );

    RETURN jsonb_build_object(
      'success', true,
      'submissionId', v_sub_id,
      'version', v_new_version,
      'verificationStatus', 'clean',
      'recordedByName', v_actor.actor_name,
      'message', 'Status peserta berhasil diperbarui.'
    );
  END IF;

  -- CABANG B: STATUS SUBMITTED (Setoran Sah)
  IF v_fulfillment != 'submitted' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Status kewajiban setoran tidak dikenali.');
  END IF;

  v_confirmed_pages := NULLIF(p_payload->>'confirmedPages', '')::numeric(6,2);
  v_suggested_pages := NULLIF(p_payload->>'systemSuggestedPages', '')::numeric(6,2);
  v_score := NULLIF(p_payload->>'score', '')::numeric(5,2);
  v_ranges := COALESCE(p_payload->'ranges', '[]'::jsonb);

  IF v_confirmed_pages IS NULL OR v_confirmed_pages <= 0 OR mod(v_confirmed_pages * 100, 25) != 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Jumlah halaman wajib lebih dari 0 dan menggunakan kelipatan 0,25 halaman.');
  END IF;

  IF v_score IS NULL OR v_score < 0 OR v_score > 100 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nilai setoran wajib berada pada rentang 0 sampai 100.');
  END IF;

  IF jsonb_typeof(v_ranges) != 'array' OR jsonb_array_length(v_ranges) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Minimal satu rentang surah dan ayat wajib diisi untuk setoran sah.');
  END IF;

  -- Nonaktifkan rincian rentang lama pada submission yang sama (aman dgn Partial Unique Index B-01!)
  UPDATE public.ziyadah_accel_submission_ranges
  SET range_status = 'void'
  WHERE submission_id = v_sub_id AND range_status = 'active';

  -- Cari batas akhir hafalan dari sesi sah sebelumnya pada kegiatan ini (atau baseline harian jika sesi pertama)
  SELECT r.surah_number, r.ayah_end
  INTO v_prior_ref
  FROM public.ziyadah_accel_submission_ranges r
  JOIN public.ziyadah_accel_submissions sub ON sub.id = r.submission_id
  JOIN public.ziyadah_accel_sessions s ON s.id = r.session_id
  WHERE r.event_id = v_event.id
    AND r.student_id = v_part.student_id
    AND r.submission_id != v_sub_id
    AND r.range_status = 'active'
    AND sub.fulfillment_status = 'submitted'
    AND s.status != 'cancelled'
    AND s.session_number < v_sess.session_number
  ORDER BY s.session_number DESC, r.range_order DESC
  LIMIT 1;

  FOR v_r IN SELECT * FROM jsonb_array_elements(v_ranges)
  LOOP
    v_idx := v_idx + 1;
    v_surah := (v_r->>'surahNumber')::integer;
    v_ayah_start := (v_r->>'ayahStart')::integer;
    v_ayah_end := (v_r->>'ayahEnd')::integer;
    v_start_page := COALESCE(NULLIF(v_r->>'startPage', '')::integer, 1);
    v_end_page := COALESCE(NULLIF(v_r->>'endPage', '')::integer, v_start_page);
    v_juz := COALESCE(NULLIF(v_r->>'juzNumber', '')::integer, 1);
    v_max_ayah := public._za_surah_max_ayah(v_surah);

    IF v_max_ayah = 0 THEN
      RAISE EXCEPTION 'Nomor surah tidak valid (%).', v_surah;
    END IF;
    IF v_ayah_start IS NULL OR v_ayah_end IS NULL OR v_ayah_start < 1 OR v_ayah_end < v_ayah_start OR v_ayah_end > v_max_ayah THEN
      RAISE EXCEPTION 'Rentang ayat tidak valid pada surah ke-% (ayat %-% melebihi batas 1..%).', v_surah, v_ayah_start, v_ayah_end, v_max_ayah;
    END IF;
    IF v_juz < 1 OR v_juz > 30 OR v_start_page < 1 OR v_start_page > 604 OR v_end_page < 1 OR v_end_page > 604 THEN
      RAISE EXCEPTION 'Data halaman atau juz tidak valid.';
    END IF;

    -- Pemeriksaan kesinambungan ayat & antarsurah di sisi server (lintas sesi/baseline maupun intra-sesi)
    IF v_idx = 1 THEN
      IF v_prior_ref.surah_number IS NOT NULL THEN
        v_cont_flag := public._za_check_range_continuity(
          v_prior_ref.surah_number,
          v_prior_ref.ayah_end,
          v_surah,
          v_ayah_start,
          v_part.memorization_direction_hint
        );
      ELSIF v_part.baseline_surah IS NOT NULL AND v_part.baseline_ayah IS NOT NULL THEN
        v_cont_flag := public._za_check_range_continuity(
          v_part.baseline_surah,
          v_part.baseline_ayah,
          v_surah,
          v_ayah_start,
          v_part.memorization_direction_hint
        );
      ELSE
        v_cont_flag := NULL;
      END IF;
    ELSE
      v_cont_flag := public._za_check_range_continuity(
        v_prev_loop_surah,
        v_prev_loop_ayah_end,
        v_surah,
        v_ayah_start,
        v_part.memorization_direction_hint
      );
    END IF;

    IF v_cont_flag IS NOT NULL THEN
      v_flags := array_append(v_flags, v_cont_flag);
    END IF;

    v_prev_loop_surah := v_surah;
    v_prev_loop_ayah_end := v_ayah_end;

    -- PERBAIKAN B-10: Cek Duplikasi Persis / Subset Penuh baik lintas sesi MAUPUN intra-sesi (ex.submission_id = v_sub_id)
    IF EXISTS (
      SELECT 1
      FROM public.ziyadah_accel_submission_ranges ex
      JOIN public.ziyadah_accel_submissions exsub ON exsub.id = ex.submission_id
      WHERE ex.event_id = v_event.id
        AND ex.student_id = v_part.student_id
        AND ex.range_status = 'active'
        AND (ex.submission_id = v_sub_id OR exsub.fulfillment_status = 'submitted')
        AND ex.surah_number = v_surah
        AND (
          (v_ayah_start >= ex.ayah_start AND v_ayah_end <= ex.ayah_end)
          OR (v_ayah_start = ex.ayah_start AND v_ayah_end = ex.ayah_end)
        )
    ) THEN
      v_has_exact_dup := true;
    END IF;

    IF v_has_exact_dup THEN
      RAISE EXCEPTION 'DUPLICATE_RANGE: Rentang surah ke-% ayat %-% sudah tercatat sebelumnya dan tidak boleh dihitung dua kali.', v_surah, v_ayah_start, v_ayah_end;
    END IF;

    -- Cek Partial Overlap (Irisan sebagian) baik intra-submission maupun lintas sesi
    SELECT ex.ayah_start, ex.ayah_end, ex.submission_id, s.name AS session_name
    INTO v_overlap_rec
    FROM public.ziyadah_accel_submission_ranges ex
    JOIN public.ziyadah_accel_submissions exsub ON exsub.id = ex.submission_id
    JOIN public.ziyadah_accel_sessions s ON s.id = ex.session_id
    WHERE ex.event_id = v_event.id
      AND ex.student_id = v_part.student_id
      AND ex.range_status = 'active'
      AND (ex.submission_id = v_sub_id OR exsub.fulfillment_status = 'submitted')
      AND ex.surah_number = v_surah
      AND GREATEST(v_ayah_start, ex.ayah_start) <= LEAST(v_ayah_end, ex.ayah_end)
    LIMIT 1;

    IF FOUND THEN
      IF v_overlap_rec.submission_id = v_sub_id THEN
        v_flags := array_append(v_flags, 'OVERLAP_INTRA_SESSION');
      ELSE
        v_flags := array_append(v_flags, 'OVERLAP_PREVIOUS_SESSION');
      END IF;
    END IF;

    INSERT INTO public.ziyadah_accel_submission_ranges (
      id, submission_id, event_id, session_id, student_id,
      range_order, juz_number, surah_number, surah_name_snapshot,
      ayah_start, ayah_end, start_page, end_page, range_status,
      overlap_flag, overlap_detail
    ) VALUES (
      'za_rng_' || v_sub_id || '_v' || (v_sub.version + 1)::text || '_' || v_idx::text || '_' || substr(md5(clock_timestamp()::text || v_idx::text), 1, 5),
      v_sub_id, v_event.id, v_session_id, v_part.student_id,
      v_idx, v_juz, v_surah, COALESCE(NULLIF(trim(v_r->>'surahNameSnapshot'), ''), 'Surah ' || v_surah::text),
      v_ayah_start, v_ayah_end, v_start_page, v_end_page, 'active',
      FOUND,
      CASE WHEN FOUND THEN format('Beririsan dengan %s (ayat %s-%s)', v_overlap_rec.session_name, v_overlap_rec.ayah_start, v_overlap_rec.ayah_end) ELSE NULL END
    );
  END LOOP;

  IF jsonb_typeof(p_payload->'clientFlags') = 'array' THEN
    v_flags := v_flags || ARRAY(SELECT jsonb_array_elements_text(p_payload->'clientFlags'));
  END IF;

  SELECT COALESCE(ARRAY(SELECT DISTINCT unnest(v_flags)), '{}'::text[]) INTO v_flags;

  IF COALESCE(array_length(v_flags, 1), 0) > 0 THEN
    v_verify_status := 'needs_verification';
    v_unique_pages := 0;
  ELSE
    v_verify_status := 'clean';
    v_unique_pages := v_confirmed_pages;
  END IF;

  v_new_version := v_sub.version + 1;

  UPDATE public.ziyadah_accel_submissions
  SET fulfillment_status = 'submitted',
      verification_status = v_verify_status,
      verification_flags = v_flags,
      confirmed_pages = v_confirmed_pages,
      system_suggested_pages = v_suggested_pages,
      approved_unique_pages = v_unique_pages,
      score = v_score,
      absence_reason = NULL,
      examiner_notes = v_notes,
      recorded_by_user_id = v_actor.actor_user_id,
      recorded_by_name_snapshot = v_actor.actor_name,
      login_account_id = v_actor.login_account_id,
      login_account_username = v_actor.login_username,
      submitted_at = COALESCE(submitted_at, now()),
      verified_by = NULL,
      verified_by_name_snapshot = NULL,
      verified_at = NULL,
      verification_note = NULL,
      last_idempotency_key = COALESCE(NULLIF(p_idempotency_key, ''), last_idempotency_key),
      version = v_new_version,
      updated_at = now()
  WHERE id = v_sub_id;

  INSERT INTO public.ziyadah_accel_audit_logs (
    id, event_id, session_id, submission_id, student_id,
    action_type, actor_user_id, actor_name_snapshot, actor_role,
    login_account_id, login_account_username, reason, idempotency_key,
    before_data, after_data
  ) VALUES (
    'za_aud_' || gen_random_uuid()::text, v_event.id, v_session_id, v_sub_id, v_part.student_id,
    CASE WHEN v_sub.fulfillment_status = 'submitted' THEN 'CORRECTION_SETORAN' ELSE 'SUBMIT_SETORAN' END,
    v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
    v_actor.login_account_id, v_actor.login_username, v_reason, p_idempotency_key,
    CASE
      WHEN v_sub.fulfillment_status = 'submitted' THEN jsonb_build_object(
        'score', v_sub.score,
        'confirmedPages', v_sub.confirmed_pages,
        'approvedUniquePages', v_sub.approved_unique_pages,
        'verificationStatus', v_sub.verification_status,
        'recordedByUserId', v_sub.recorded_by_user_id,
        'recordedByName', v_sub.recorded_by_name_snapshot,
        'ranges', v_old_ranges
      )
      ELSE NULL
    END,
    jsonb_build_object(
      'score', v_score,
      'confirmedPages', v_confirmed_pages,
      'approvedUniquePages', v_unique_pages,
      'verificationStatus', v_verify_status,
      'flags', v_flags,
      'rangeCount', v_idx,
      'isSharedAccount', v_actor.is_shared_account
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'submissionId', v_sub_id,
    'version', v_new_version,
    'verificationStatus', v_verify_status,
    'verificationFlags', v_flags,
    'approvedUniquePages', v_unique_pages,
    'recordedByName', v_actor.actor_name,
    'message', CASE
      WHEN v_verify_status = 'needs_verification'
        THEN 'Setoran tersimpan atas nama Penguji ' || v_actor.actor_name || ' dan ditandai Memerlukan Verifikasi Koordinator.'
      ELSE 'Setoran ziyadah berhasil disimpan atas nama Penguji ' || v_actor.actor_name || '.'
    END
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorCode', CASE WHEN SQLERRM LIKE 'DUPLICATE_RANGE:%' THEN 'DUPLICATE_RANGE' ELSE 'VALIDATION_ERROR' END,
      'message', replace(SQLERRM, 'DUPLICATE_RANGE: ', '')
    );
END;
$$;

-- ============================================================================
-- 18. RPC 7: VERIFIKASI KOORDINATOR & FINALISASI ARSIP OTORITATIF SERVER (B-12)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.za_verify_submission_secure(
  p_username text,
  p_password text,
  p_submission_id text,
  p_decision text,
  p_approved_unique_pages numeric DEFAULT NULL,
  p_corrected_score numeric DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_sub RECORD;
  v_event RECORD;
  v_final_unique numeric(6,2);
  v_final_score numeric(5,2);
  v_new_ver_status text;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  SELECT * INTO v_sub FROM public.ziyadah_accel_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Data setoran tidak ditemukan.');
  END IF;

  IF NOT v_actor.is_valid OR NOT public._za_is_coordinator(v_actor.actor_user_id, v_actor.effective_role, v_sub.event_id, v_actor.is_shared_account) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya Koordinator/Admin yang dapat memverifikasi setoran.');
  END IF;

  SELECT * INTO v_event FROM public.ziyadah_accel_events WHERE id = v_sub.event_id;
  IF v_event.status = 'finalized' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kegiatan sudah difinalisasi dan terkunci.');
  END IF;

  IF v_sub.fulfillment_status != 'submitted' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Hanya setoran berstatus submitted yang dapat diverifikasi.');
  END IF;

  IF p_decision = 'approve' THEN
    v_new_ver_status := 'verified_approved';
    v_final_unique := COALESCE(p_approved_unique_pages, v_sub.confirmed_pages);
    IF v_final_unique < 0 OR mod(v_final_unique * 100, 25) != 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Halaman unik yang disetujui harus kelipatan 0,25 halaman (>= 0).');
    END IF;
  ELSIF p_decision = 'reject' THEN
    v_new_ver_status := 'verified_rejected';
    v_final_unique := 0;
  ELSE
    RETURN jsonb_build_object('success', false, 'message', 'Keputusan verifikasi tidak valid.');
  END IF;

  v_final_score := COALESCE(p_corrected_score, v_sub.score);
  IF v_final_score < 0 OR v_final_score > 100 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nilai koreksi harus 0 sampai 100.');
  END IF;

  UPDATE public.ziyadah_accel_submissions
  SET verification_status = v_new_ver_status,
      approved_unique_pages = v_final_unique,
      score = v_final_score,
      verified_by = v_actor.actor_user_id,
      verified_by_name_snapshot = v_actor.actor_name,
      verified_at = now(),
      verification_note = NULLIF(trim(COALESCE(p_note, '')), ''),
      version = version + 1,
      updated_at = now()
  WHERE id = p_submission_id;

  INSERT INTO public.ziyadah_accel_audit_logs (
    id, event_id, session_id, submission_id, student_id,
    action_type, actor_user_id, actor_name_snapshot, actor_role,
    login_account_id, login_account_username, reason,
    before_data, after_data
  ) VALUES (
    'za_aud_' || gen_random_uuid()::text, v_sub.event_id, v_sub.session_id, v_sub.id, v_sub.student_id,
    'VERIFY_SUBMISSION', v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
    v_actor.login_account_id, v_actor.login_username, p_note,
    jsonb_build_object('verificationStatus', v_sub.verification_status, 'approvedUniquePages', v_sub.approved_unique_pages, 'score', v_sub.score),
    jsonb_build_object('verificationStatus', v_new_ver_status, 'approvedUniquePages', v_final_unique, 'score', v_final_score)
  );

  RETURN jsonb_build_object('success', true, 'verificationStatus', v_new_ver_status, 'approvedUniquePages', v_final_unique, 'message', 'Keputusan verifikasi setoran berhasil disimpan.');
END;
$$;

-- ============================================================================
-- HELPER B-12: KALKULASI SNAPSHOT FINAL 100% OTORITATIF SERVER DARI TRANSAKSI DB SAH
-- Menghitung frozen_summary, frozen_student_rows, dan frozen_session_matrix
-- sepenuhnya di PostgreSQL tanpa mempercayai payload browser klien sedikit pun!
-- ============================================================================
CREATE OR REPLACE FUNCTION public._za_compute_authoritative_event_snapshot(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_session_matrix jsonb := '[]'::jsonb;
  v_student_rows jsonb := '[]'::jsonb;
  v_session_progress jsonb := '[]'::jsonb;
  v_class_progress jsonb := '[]'::jsonb;
  v_halaqah_progress jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_active_parts integer := 0;
  v_valid_sess integer := 0;
  v_closed_sess integer := 0;
  v_submitted_cnt integer := 0;
  v_absent_cnt integer := 0;
  v_not_sub_cnt integer := 0;
  v_needs_ver_subs integer := 0;
  v_needs_ver_students integer := 0;
  v_submitted_pages numeric(10,2) := 0;
  v_unique_pages numeric(10,2) := 0;
  v_unverified_pages numeric(10,2) := 0;
  v_avg_by_student numeric(6,2) := NULL;
  v_scored_students integer := 0;
  v_avg_by_sub numeric(6,2) := NULL;
  v_scored_subs integer := 0;
BEGIN
  -- 1. Matriks Sesi Pelaksanaan yang Sah (mengecualikan sesi cancelled)
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE s.status = 'closed'),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'eventId', s.event_id,
      'sessionNumber', s.session_number,
      'name', s.name,
      'sessionDate', s.session_date,
      'startTime', s.start_time,
      'endTime', s.end_time,
      'status', s.status,
      'queueMode', s.queue_mode,
      'regularQueueOffset', s.regular_queue_offset,
      'activatedAt', s.activated_at,
      'closedAt', s.closed_at,
      'version', s.version
    ) ORDER BY s.session_number ASC), '[]'::jsonb)
  INTO v_valid_sess, v_closed_sess, v_session_matrix
  FROM public.ziyadah_accel_sessions s
  WHERE s.event_id = p_event_id
    AND s.status != 'cancelled';

  SELECT COUNT(*) INTO v_active_parts
  FROM public.ziyadah_accel_participants p
  WHERE p.event_id = p_event_id
    AND p.participant_status = 'active';

  -- 2. Baris Rekap Per Santri & Sel Matriks Sesi 100% dari Transaksi Sah di Database
  --    - Setoran berstatus 'cancelled' diperlakukan belum menyetor (halaman & nilai tidak dihitung)
  --    - Rentang berstatus 'void' dikecualikan
  --    - Nilai NULL tetap NULL (tidak dihitung sebagai 0); Nilai 0 sah tetap masuk pembagi rata-rata
  --    - Setoran 'needs_verification' / 'verified_rejected' tidak menambah halaman unik terverifikasi
  WITH valid_sessions AS (
    SELECT s.id, s.session_number, s.name, s.session_date, s.status
    FROM public.ziyadah_accel_sessions s
    WHERE s.event_id = p_event_id
      AND s.status != 'cancelled'
  ),
  active_participants AS (
    SELECT
      p.id,
      p.student_id,
      p.student_name_snapshot,
      p.nis_snapshot,
      p.class_snapshot,
      p.halaqah_snapshot,
      COALESCE(NULLIF(p.halaqah_teacher_name_snapshot, ''), '-') AS teacher_name,
      COALESCE(NULLIF(p.baseline_label, ''), '-') AS baseline_label
    FROM public.ziyadah_accel_participants p
    WHERE p.event_id = p_event_id
      AND p.participant_status = 'active'
  ),
  range_texts AS (
    SELECT
      r.submission_id,
      string_agg(
        format('%s : %s–%s', r.surah_name_snapshot, r.ayah_start, r.ayah_end),
        '; ' ORDER BY r.range_order ASC
      ) AS range_summary
    FROM public.ziyadah_accel_submission_ranges r
    WHERE r.event_id = p_event_id
      AND r.range_status = 'active'
    GROUP BY r.submission_id
  ),
  grid AS (
    SELECT
      ap.id AS participant_id,
      ap.student_id,
      ap.student_name_snapshot,
      ap.nis_snapshot,
      ap.class_snapshot,
      ap.halaqah_snapshot,
      ap.teacher_name,
      ap.baseline_label,
      vs.id AS session_id,
      vs.session_number,
      vs.name AS session_name,
      vs.session_date,
      vs.status AS session_status,
      CASE
        WHEN sub.id IS NULL OR sub.fulfillment_status = 'cancelled' THEN
          CASE WHEN vs.status = 'closed' THEN 'pending_examiner_input' ELSE 'waiting_turn' END
        ELSE sub.fulfillment_status
      END AS eff_fulfillment,
      CASE
        WHEN sub.id IS NULL OR sub.fulfillment_status != 'submitted' THEN 'clean'
        ELSE sub.verification_status
      END AS eff_verification,
      CASE
        WHEN sub.fulfillment_status = 'submitted' THEN ROUND(COALESCE(sub.confirmed_pages, 0), 2)
        ELSE NULL
      END AS cell_confirmed_pages,
      CASE
        WHEN sub.fulfillment_status = 'submitted' AND sub.verification_status IN ('clean', 'verified_approved')
          THEN ROUND(COALESCE(sub.approved_unique_pages, sub.confirmed_pages, 0), 2)
        ELSE 0::numeric(10,2)
      END AS cell_unique_pages,
      CASE
        WHEN sub.fulfillment_status = 'submitted' AND sub.verification_status = 'needs_verification'
          THEN ROUND(COALESCE(sub.confirmed_pages, 0), 2)
        ELSE 0::numeric(10,2)
      END AS cell_unverified_pages,
      CASE
        WHEN sub.fulfillment_status = 'submitted' AND sub.score IS NOT NULL
          THEN ROUND(sub.score, 2)
        ELSE NULL
      END AS cell_score,
      CASE
        WHEN sub.fulfillment_status = 'submitted' AND sub.score IS NOT NULL AND sub.verification_status != 'verified_rejected'
          THEN ROUND(sub.score, 2)
        ELSE NULL
      END AS valid_score_for_avg,
      CASE
        WHEN sub.fulfillment_status = 'submitted' THEN COALESCE(rt.range_summary, '-')
        WHEN sub.fulfillment_status = 'absent' THEN 'Tidak Hadir'
        ELSE '-'
      END AS range_text,
      CASE
        WHEN sub.fulfillment_status = 'submitted' THEN sub.recorded_by_name_snapshot
        WHEN sub.fulfillment_status = 'absent' THEN sub.recorded_by_name_snapshot
        ELSE NULL
      END AS examiner_name
    FROM active_participants ap
    CROSS JOIN valid_sessions vs
    LEFT JOIN public.ziyadah_accel_submissions sub
      ON sub.session_id = vs.id AND sub.participant_id = ap.id
    LEFT JOIN range_texts rt
      ON rt.submission_id = sub.id
  ),
  per_student AS (
    SELECT
      g.participant_id,
      g.student_id,
      g.student_name_snapshot,
      g.nis_snapshot,
      g.class_snapshot,
      g.halaqah_snapshot,
      g.teacher_name,
      g.baseline_label,
      COUNT(*) AS total_expected,
      COUNT(*) FILTER (WHERE g.eff_fulfillment = 'submitted') AS sub_cnt,
      COUNT(*) FILTER (WHERE g.valid_score_for_avg IS NOT NULL) AS scored_cnt,
      COUNT(*) FILTER (WHERE g.eff_fulfillment = 'absent') AS absent_cnt,
      COUNT(*) FILTER (WHERE g.eff_fulfillment NOT IN ('submitted', 'absent')) AS pending_cnt,
      COUNT(*) FILTER (WHERE g.eff_fulfillment = 'submitted' AND g.eff_verification = 'needs_verification') AS needs_ver_cnt,
      COALESCE(ROUND(SUM(COALESCE(g.cell_confirmed_pages, 0)), 2), 0) AS st_submitted_pages,
      COALESCE(ROUND(SUM(g.cell_unique_pages), 2), 0) AS st_unique_pages,
      COALESCE(ROUND(SUM(g.cell_unverified_pages), 2), 0) AS st_unverified_pages,
      ROUND(AVG(g.valid_score_for_avg), 2) AS st_avg_score,
      COALESCE(
        NULLIF(
          string_agg(
            CASE
              WHEN g.eff_fulfillment = 'submitted' AND g.range_text != '-'
                THEN format('S%s: %s', g.session_number, g.range_text)
              ELSE NULL
            END,
            ' | ' ORDER BY g.session_number ASC
          ),
          ''
        ),
        '-'
      ) AS combined_ranges_text,
      BOOL_OR(g.session_status = 'closed' AND g.eff_fulfillment != 'submitted') AS is_lagging,
      jsonb_agg(jsonb_build_object(
        'sessionId', g.session_id,
        'sessionNumber', g.session_number,
        'sessionName', g.session_name,
        'fulfillmentStatus', g.eff_fulfillment,
        'verificationStatus', g.eff_verification,
        'confirmedPages', g.cell_confirmed_pages,
        'uniqueVerifiedPages', g.cell_unique_pages,
        'unverifiedPages', g.cell_unverified_pages,
        'score', g.cell_score,
        'rangeSummaryText', g.range_text,
        'examinerName', g.examiner_name
      ) ORDER BY g.session_number ASC) AS cells_json
    FROM grid g
    GROUP BY
      g.participant_id, g.student_id, g.student_name_snapshot, g.nis_snapshot,
      g.class_snapshot, g.halaqah_snapshot, g.teacher_name, g.baseline_label
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'participantId', ps.participant_id,
      'studentId', ps.student_id,
      'studentName', ps.student_name_snapshot,
      'nis', ps.nis_snapshot,
      'className', ps.class_snapshot,
      'halaqah', ps.halaqah_snapshot,
      'halaqahTeacherName', ps.teacher_name,
      'baselineLabel', ps.baseline_label,
      'cells', ps.cells_json,
      'totalSessionsExpected', ps.total_expected,
      'submittedSessionCount', ps.sub_cnt,
      'scoredSessionCount', ps.scored_cnt,
      'absentSessionCount', ps.absent_cnt,
      'pendingSessionCount', ps.pending_cnt,
      'needsVerificationCount', ps.needs_ver_cnt,
      'totalSubmittedPages', ps.st_submitted_pages,
      'totalUniqueVerifiedPages', ps.st_unique_pages,
      'totalUnverifiedPages', ps.st_unverified_pages,
      'averageScore', ps.st_avg_score,
      'combinedRangesText', ps.combined_ranges_text,
      'isCompleteAllSessions', (ps.total_expected > 0 AND ps.sub_cnt = ps.total_expected),
      'isLagging', (v_closed_sess > 0 AND COALESCE(ps.is_lagging, false))
    ) ORDER BY lower(ps.student_name_snapshot) ASC, ps.student_id ASC), '[]'::jsonb),
    COALESCE(SUM(ps.sub_cnt), 0)::integer,
    COALESCE(SUM(ps.absent_cnt), 0)::integer,
    COALESCE(SUM(ps.pending_cnt), 0)::integer,
    COALESCE(SUM(ps.needs_ver_cnt), 0)::integer,
    COUNT(*) FILTER (WHERE ps.needs_ver_cnt > 0)::integer,
    COALESCE(ROUND(SUM(ps.st_submitted_pages), 2), 0),
    COALESCE(ROUND(SUM(ps.st_unique_pages), 2), 0),
    COALESCE(ROUND(SUM(ps.st_unverified_pages), 2), 0),
    COUNT(*) FILTER (WHERE ps.st_avg_score IS NOT NULL)::integer,
    ROUND(AVG(ps.st_avg_score), 2)
  INTO
    v_student_rows,
    v_submitted_cnt,
    v_absent_cnt,
    v_not_sub_cnt,
    v_needs_ver_subs,
    v_needs_ver_students,
    v_submitted_pages,
    v_unique_pages,
    v_unverified_pages,
    v_scored_students,
    v_avg_by_student
  FROM per_student ps;

  -- 3. Rata-rata Seluruh Setoran Bernilai Sah (Metode 2)
  SELECT
    COUNT(*),
    ROUND(AVG(ROUND(sub.score, 2)), 2)
  INTO v_scored_subs, v_avg_by_sub
  FROM public.ziyadah_accel_submissions sub
  JOIN public.ziyadah_accel_participants p ON p.id = sub.participant_id
  JOIN public.ziyadah_accel_sessions s ON s.id = sub.session_id
  WHERE sub.event_id = p_event_id
    AND p.participant_status = 'active'
    AND s.status != 'cancelled'
    AND sub.fulfillment_status = 'submitted'
    AND sub.score IS NOT NULL
    AND sub.verification_status != 'verified_rejected';

  -- 4. Breakdown Per Sesi, Per Kelas, & Per Halaqah 100% dari Server
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sessionId', sp.session_id,
    'sessionNumber', sp.session_number,
    'sessionName', sp.session_name,
    'sessionDate', sp.session_date,
    'status', sp.status,
    'totalParticipants', v_active_parts,
    'submittedCount', sp.submitted_cnt,
    'waitingTurnCount', sp.waiting_cnt,
    'calledNotSubmittedCount', sp.called_cnt,
    'absentCount', sp.absent_cnt,
    'pendingExaminerInputCount', sp.pending_input_cnt,
    'needsVerificationCount', sp.needs_ver_cnt,
    'totalUniquePages', sp.sess_unique_pages,
    'averageSessionScore', sp.sess_avg_score
  ) ORDER BY sp.session_number ASC), '[]'::jsonb)
  INTO v_session_progress
  FROM (
    SELECT
      s.id AS session_id,
      s.session_number,
      s.name AS session_name,
      s.session_date,
      s.status,
      COUNT(*) FILTER (WHERE sub.fulfillment_status = 'submitted') AS submitted_cnt,
      COUNT(*) FILTER (
        WHERE (sub.id IS NULL OR sub.fulfillment_status IN ('waiting_turn', 'cancelled')) AND s.status != 'closed'
      ) AS waiting_cnt,
      COUNT(*) FILTER (WHERE sub.fulfillment_status = 'called_not_submitted') AS called_cnt,
      COUNT(*) FILTER (WHERE sub.fulfillment_status = 'absent') AS absent_cnt,
      COUNT(*) FILTER (
        WHERE sub.fulfillment_status = 'pending_examiner_input'
           OR ((sub.id IS NULL OR sub.fulfillment_status = 'cancelled') AND s.status = 'closed')
      ) AS pending_input_cnt,
      COUNT(*) FILTER (
        WHERE sub.fulfillment_status = 'submitted' AND sub.verification_status = 'needs_verification'
      ) AS needs_ver_cnt,
      COALESCE(ROUND(SUM(
        CASE
          WHEN sub.fulfillment_status = 'submitted' AND sub.verification_status IN ('clean', 'verified_approved')
            THEN COALESCE(sub.approved_unique_pages, sub.confirmed_pages, 0)
          ELSE 0
        END
      ), 2), 0) AS sess_unique_pages,
      ROUND(AVG(ROUND(sub.score, 2)) FILTER (
        WHERE sub.fulfillment_status = 'submitted' AND sub.score IS NOT NULL AND sub.verification_status != 'verified_rejected'
      ), 2) AS sess_avg_score
    FROM public.ziyadah_accel_sessions s
    CROSS JOIN public.ziyadah_accel_participants p
    LEFT JOIN public.ziyadah_accel_submissions sub
      ON sub.session_id = s.id AND sub.participant_id = p.id
    WHERE s.event_id = p_event_id
      AND s.status != 'cancelled'
      AND p.event_id = p_event_id
      AND p.participant_status = 'active'
    GROUP BY s.id, s.session_number, s.name, s.session_date, s.status
  ) sp;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'groupKey', cg.grp_key,
    'participantCount', cg.part_cnt,
    'totalObligations', (cg.part_cnt * v_valid_sess),
    'submittedObligations', cg.sub_cnt,
    'absentObligations', cg.abs_cnt,
    'totalUniqueVerifiedPages', cg.uniq_pages,
    'averageScoreByStudent', cg.avg_score
  ) ORDER BY cg.grp_key ASC), '[]'::jsonb)
  INTO v_class_progress
  FROM (
    SELECT
      COALESCE(NULLIF(r->>'className', ''), '-') AS grp_key,
      COUNT(*) AS part_cnt,
      COALESCE(SUM((r->>'submittedSessionCount')::integer), 0) AS sub_cnt,
      COALESCE(SUM((r->>'absentSessionCount')::integer), 0) AS abs_cnt,
      COALESCE(ROUND(SUM((r->>'totalUniqueVerifiedPages')::numeric), 2), 0) AS uniq_pages,
      ROUND(AVG(NULLIF(r->>'averageScore', '')::numeric), 2) AS avg_score
    FROM jsonb_array_elements(v_student_rows) r
    GROUP BY COALESCE(NULLIF(r->>'className', ''), '-')
  ) cg;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'groupKey', hg.grp_key,
    'participantCount', hg.part_cnt,
    'totalObligations', (hg.part_cnt * v_valid_sess),
    'submittedObligations', hg.sub_cnt,
    'absentObligations', hg.abs_cnt,
    'totalUniqueVerifiedPages', hg.uniq_pages,
    'averageScoreByStudent', hg.avg_score
  ) ORDER BY hg.grp_key ASC), '[]'::jsonb)
  INTO v_halaqah_progress
  FROM (
    SELECT
      COALESCE(NULLIF(r->>'halaqah', ''), '-') AS grp_key,
      COUNT(*) AS part_cnt,
      COALESCE(SUM((r->>'submittedSessionCount')::integer), 0) AS sub_cnt,
      COALESCE(SUM((r->>'absentSessionCount')::integer), 0) AS abs_cnt,
      COALESCE(ROUND(SUM((r->>'totalUniqueVerifiedPages')::numeric), 2), 0) AS uniq_pages,
      ROUND(AVG(NULLIF(r->>'averageScore', '')::numeric), 2) AS avg_score
    FROM jsonb_array_elements(v_student_rows) r
    GROUP BY COALESCE(NULLIF(r->>'halaqah', ''), '-')
  ) hg;

  v_summary := jsonb_build_object(
    'uniqueParticipantsCount', v_active_parts,
    'activeSessionsCount', 0,
    'totalSessionsCount', v_valid_sess,
    'currentActiveSessionId', NULL,
    'currentActiveSessionName', NULL,
    'activeSessionSubmittedStudents', 0,
    'activeSessionPendingStudents', 0,
    'activeSessionAbsentStudents', 0,
    'totalObligationsCount', (v_active_parts * v_valid_sess),
    'submittedObligationsCount', v_submitted_cnt,
    'notSubmittedObligationsCount', v_not_sub_cnt,
    'absentObligationsCount', v_absent_cnt,
    'needsVerificationSubmissionsCount', v_needs_ver_subs,
    'needsVerificationStudentsCount', v_needs_ver_students,
    'totalSubmittedPages', v_submitted_pages,
    'totalUniqueVerifiedPages', v_unique_pages,
    'totalUnverifiedPages', v_unverified_pages,
    'averageScoreByStudent', v_avg_by_student,
    'studentsWithScoreCount', v_scored_students,
    'averageScoreBySubmission', v_avg_by_sub,
    'validScoredSubmissionsCount', v_scored_subs,
    'sessionProgress', v_session_progress,
    'classProgress', v_class_progress,
    'halaqahProgress', v_halaqah_progress,
    'serverAuthoritative', true,
    'serverVerifiedAt', now()
  );

  RETURN jsonb_build_object(
    'summary', v_summary,
    'studentRows', v_student_rows,
    'sessionMatrix', v_session_matrix
  );
END;
$$;

-- Trigger Imutabilitas Snapshot Final (B-12):
-- Melarang keras UPDATE maupun DELETE pada ziyadah_accel_final_snapshots selama kegiatan berstatus 'finalized'.
CREATE OR REPLACE FUNCTION public._za_guard_final_snapshot_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT e.status INTO v_status
  FROM public.ziyadah_accel_events e
  WHERE e.id = OLD.event_id;

  IF v_status = 'finalized' THEN
    RAISE EXCEPTION 'SNAPSHOT_IMMUTABLE: Snapshot final kegiatan % terkunci permanen selama kegiatan berstatus Finalized. Buka kembali (reopen) melalui otorisasi Admin terlebih dahulu.', OLD.event_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_za_final_snapshot_immutable ON public.ziyadah_accel_final_snapshots;
CREATE TRIGGER trg_za_final_snapshot_immutable
  BEFORE UPDATE OR DELETE ON public.ziyadah_accel_final_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public._za_guard_final_snapshot_immutability();

-- PERBAIKAN MENYELURUH B-12:
-- 1. Blokir finalisasi bila masih ada sesi berstatus 'draft', 'scheduled', atau 'active',
--    masih ada setoran 'needs_verification', atau ditemukan irisan ayat aktif yang belum diverifikasi (anti double-count!).
-- 2. Seluruh frozen_summary, frozen_student_rows, dan frozen_session_matrix dihitung 100% oleh server
--    melalui _za_compute_authoritative_event_snapshot(p_event_id); parameter p_snapshot dari browser DIABAIKAN SEPENUHNYA!
-- 3. Snapshot dikunci imutabel dengan trigger trg_za_final_snapshot_immutable selama status = 'finalized'.
-- 4. Reopen hanya diizinkan untuk Admin utama (bukan akun bersama / koordinator delegasi) dengan alasan audit wajib.
CREATE OR REPLACE FUNCTION public.za_finalize_or_reopen_event_secure(
  p_username text,
  p_password text,
  p_event_id text,
  p_action text,
  p_reason text DEFAULT NULL,
  p_snapshot jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_actor RECORD;
  v_event RECORD;
  v_old_snap RECORD;
  v_unverified integer;
  v_unclosed_sess integer;
  v_valid_sess integer;
  v_active_parts integer;
  v_double_count_conflicts integer := 0;
  v_snap_ver integer;
  v_server_snapshot jsonb;
  v_srv_summary jsonb;
  v_srv_student_rows jsonb;
  v_srv_session_matrix jsonb;
BEGIN
  SELECT * INTO v_actor FROM public._za_resolve_actor(p_username, p_password);
  SELECT * INTO v_event FROM public.ziyadah_accel_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Kegiatan tidak ditemukan.');
  END IF;

  IF NOT v_actor.is_valid OR NOT public._za_is_coordinator(v_actor.actor_user_id, v_actor.effective_role, p_event_id, v_actor.is_shared_account) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak.');
  END IF;

  IF p_action = 'finalize' THEN
    IF v_event.status = 'finalized' THEN
      RETURN jsonb_build_object('success', true, 'message', 'Kegiatan sudah berstatus Finalized.');
    END IF;

    SELECT COUNT(*) INTO v_active_parts
    FROM public.ziyadah_accel_participants
    WHERE event_id = p_event_id AND participant_status = 'active';

    IF v_active_parts = 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Kegiatan belum memiliki peserta aktif untuk difinalisasi.');
    END IF;

    SELECT COUNT(*) INTO v_valid_sess
    FROM public.ziyadah_accel_sessions
    WHERE event_id = p_event_id AND status != 'cancelled';

    IF v_valid_sess = 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Kegiatan belum memiliki sesi pelaksanaan yang sah.');
    END IF;

    SELECT COUNT(*) INTO v_unclosed_sess
    FROM public.ziyadah_accel_sessions
    WHERE event_id = p_event_id AND status IN ('draft', 'scheduled', 'active');

    IF v_unclosed_sess > 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Masih terdapat ' || v_unclosed_sess || ' sesi berstatus Draft/Terjadwal/Aktif. Tutup (Close) atau batalkan sesi tersebut sebelum finalisasi kegiatan.');
    END IF;

    SELECT COUNT(*) INTO v_unverified
    FROM public.ziyadah_accel_submissions sub
    JOIN public.ziyadah_accel_participants p ON p.id = sub.participant_id
    JOIN public.ziyadah_accel_sessions s ON s.id = sub.session_id
    WHERE sub.event_id = p_event_id
      AND p.participant_status = 'active'
      AND s.status != 'cancelled'
      AND sub.fulfillment_status = 'submitted'
      AND sub.verification_status = 'needs_verification';

    IF v_unverified > 0 THEN
      RETURN jsonb_build_object('success', false, 'message', 'Masih terdapat ' || v_unverified || ' setoran berstatus Memerlukan Verifikasi. Selesaikan verifikasi terlebih dahulu.');
    END IF;

    -- Guard anti hitung ganda (zero double-counted pages): pastikan tidak ada dua rentang aktif 'clean' milik santri yang sama yang beririsan ayatnya tanpa deduplikasi verifikasi
    SELECT COUNT(*) INTO v_double_count_conflicts
    FROM public.ziyadah_accel_submission_ranges r1
    JOIN public.ziyadah_accel_submissions sub1 ON sub1.id = r1.submission_id
    JOIN public.ziyadah_accel_sessions s1 ON s1.id = r1.session_id
    JOIN public.ziyadah_accel_participants p1 ON p1.id = sub1.participant_id
    JOIN public.ziyadah_accel_submission_ranges r2
      ON r2.event_id = r1.event_id
     AND r2.student_id = r1.student_id
     AND r2.surah_number = r1.surah_number
     AND r2.id > r1.id
    JOIN public.ziyadah_accel_submissions sub2 ON sub2.id = r2.submission_id
    JOIN public.ziyadah_accel_sessions s2 ON s2.id = r2.session_id
    WHERE r1.event_id = p_event_id
      AND p1.participant_status = 'active'
      AND r1.range_status = 'active'
      AND r2.range_status = 'active'
      AND s1.status != 'cancelled'
      AND s2.status != 'cancelled'
      AND sub1.fulfillment_status = 'submitted'
      AND sub2.fulfillment_status = 'submitted'
      AND sub1.verification_status = 'clean'
      AND sub2.verification_status = 'clean'
      AND GREATEST(r1.ayah_start, r2.ayah_start) <= LEAST(r1.ayah_end, r2.ayah_end);

    IF v_double_count_conflicts > 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'errorCode', 'DOUBLE_COUNT_DETECTED',
        'message', 'Terdeteksi ' || v_double_count_conflicts || ' irisan rentang hafalan yang belum terdeduplikasi. Verifikasi halaman unik terlebih dahulu agar tidak ada halaman yang dihitung dua kali.'
      );
    END IF;

    -- Hitung SELURUH snapshot (summary, studentRows, sessionMatrix) 100% di server; abaikan p_snapshot dari browser!
    v_server_snapshot := public._za_compute_authoritative_event_snapshot(p_event_id);
    v_srv_summary := v_server_snapshot->'summary';
    v_srv_student_rows := v_server_snapshot->'studentRows';
    v_srv_session_matrix := v_server_snapshot->'sessionMatrix';

    SELECT * INTO v_old_snap FROM public.ziyadah_accel_final_snapshots WHERE event_id = p_event_id;
    v_snap_ver := COALESCE(v_old_snap.snapshot_version, 0) + 1;

    -- Catatan urutan: ziyadah_accel_events.status masih 'closed'/'active' pada titik ini sehingga upsert snapshot diizinkan trigger,
    -- lalu tepat setelahnya status kegiatan diubah menjadi 'finalized' yang mengunci imutabilitas snapshot.
    INSERT INTO public.ziyadah_accel_final_snapshots (
      id, event_id, snapshot_version, frozen_summary, frozen_student_rows, frozen_session_matrix,
      finalized_by, finalized_by_name, finalized_at
    ) VALUES (
      'za_snap_' || p_event_id,
      p_event_id,
      v_snap_ver,
      v_srv_summary,
      v_srv_student_rows,
      v_srv_session_matrix,
      v_actor.actor_user_id,
      v_actor.actor_name,
      now()
    ) ON CONFLICT (event_id) DO UPDATE
      SET snapshot_version = EXCLUDED.snapshot_version,
          frozen_summary = EXCLUDED.frozen_summary,
          frozen_student_rows = EXCLUDED.frozen_student_rows,
          frozen_session_matrix = EXCLUDED.frozen_session_matrix,
          finalized_by = EXCLUDED.finalized_by,
          finalized_by_name = EXCLUDED.finalized_by_name,
          finalized_at = now();

    UPDATE public.ziyadah_accel_events
    SET status = 'finalized',
        finalized_at = now(),
        finalized_by = v_actor.actor_user_id,
        version = version + 1,
        updated_at = now()
    WHERE id = p_event_id;

    INSERT INTO public.ziyadah_accel_audit_logs (
      id, event_id, action_type, actor_user_id, actor_name_snapshot, actor_role,
      login_account_id, login_account_username, reason, before_data, after_data
    ) VALUES (
      'za_aud_' || gen_random_uuid()::text, p_event_id, 'FINALIZE_EVENT',
      v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
      v_actor.login_account_id, v_actor.login_username, p_reason,
      CASE
        WHEN v_old_snap.id IS NOT NULL THEN jsonb_build_object(
          'previousSnapshotVersion', v_old_snap.snapshot_version,
          'previousSummary', v_old_snap.frozen_summary,
          'previousStudentRowsCount', jsonb_array_length(v_old_snap.frozen_student_rows)
        )
        ELSE NULL
      END,
      jsonb_build_object(
        'snapshotVersion', v_snap_ver,
        'serverSummary', v_srv_summary,
        'serverStudentRowsCount', jsonb_array_length(v_srv_student_rows),
        'serverSessionMatrixCount', jsonb_array_length(v_srv_session_matrix),
        'clientSnapshotIgnored', (p_snapshot IS NOT NULL)
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'finalized',
      'snapshotVersion', v_snap_ver,
      'message', 'Kegiatan berhasil difinalisasi secara otoritatif oleh server (seluruh rekap santri, matriks sesi, dan ringkasan dikunci dari database).'
    );

  ELSIF p_action = 'reopen' THEN
    IF v_actor.is_shared_account OR v_actor.effective_role != 'admin' THEN
      RETURN jsonb_build_object('success', false, 'errorCode', 'ADMIN_REQUIRED', 'message', 'Hanya Admin utama yang berwenang membuka kembali kegiatan yang sudah difinalisasi.');
    END IF;
    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
      RETURN jsonb_build_object('success', false, 'errorCode', 'REASON_REQUIRED', 'message', 'Alasan pembukaan kembali (reopen) wajib diisi minimal 5 karakter untuk keperluan audit.');
    END IF;

    SELECT * INTO v_old_snap FROM public.ziyadah_accel_final_snapshots WHERE event_id = p_event_id;

    UPDATE public.ziyadah_accel_events
    SET status = 'closed',
        reopened_at = now(),
        reopened_by = v_actor.actor_user_id,
        reopen_reason = trim(p_reason),
        version = version + 1,
        updated_at = now()
    WHERE id = p_event_id;

    INSERT INTO public.ziyadah_accel_audit_logs (
      id, event_id, action_type, actor_user_id, actor_name_snapshot, actor_role,
      login_account_id, login_account_username, reason, before_data, after_data
    ) VALUES (
      'za_aud_' || gen_random_uuid()::text, p_event_id, 'REOPEN_EVENT',
      v_actor.actor_user_id, v_actor.actor_name, v_actor.effective_role,
      v_actor.login_account_id, v_actor.login_username, trim(p_reason),
      jsonb_build_object(
        'previousStatus', v_event.status,
        'snapshotVersion', v_old_snap.snapshot_version,
        'frozenSummary', v_old_snap.frozen_summary
      ),
      jsonb_build_object('newStatus', 'closed', 'reopenedBy', v_actor.actor_user_id)
    );

    RETURN jsonb_build_object('success', true, 'status', 'closed', 'message', 'Kegiatan dibuka kembali untuk koreksi terkontrol oleh Admin.');
  ELSE
    RETURN jsonb_build_object('success', false, 'message', 'Aksi tidak dikenali.');
  END IF;
END;
$$;

-- ============================================================================
-- 19. PRIVILEGE HARDENING (REVOKE PUBLIC, GRANT EXECUTE TO ANON/AUTHENTICATED)
-- ============================================================================
REVOKE ALL ON FUNCTION public._za_surah_max_ayah(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._za_check_range_continuity(integer, integer, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._za_resolve_actor(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._za_is_coordinator(text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._za_can_examine_participant(text, text, text, text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._za_compute_authoritative_event_snapshot(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._za_guard_final_snapshot_immutability() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.za_get_access_context_secure(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_manage_coordinator_secure(text, text, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_list_events_secure(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_upsert_event_secure(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_enroll_participants_secure(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_update_participant_status_secure(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_upsert_session_secure(text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_set_session_status_secure(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_reorder_queue_secure(text, text, text, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_get_event_workspace_secure(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_submit_setoran_secure(text, text, jsonb, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_verify_submission_secure(text, text, text, text, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.za_finalize_or_reopen_event_secure(text, text, text, text, text, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT EXECUTE ON FUNCTION public.za_get_access_context_secure(text, text) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_manage_coordinator_secure(text, text, text, boolean, text) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_list_events_secure(text, text) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_upsert_event_secure(text, text, jsonb) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_enroll_participants_secure(text, text, text, jsonb) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_update_participant_status_secure(text, text, text, text, text) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_upsert_session_secure(text, text, jsonb, jsonb) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_set_session_status_secure(text, text, text, text, text) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_reorder_queue_secure(text, text, text, jsonb, integer) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_get_event_workspace_secure(text, text, text) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_submit_setoran_secure(text, text, jsonb, integer, text) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_verify_submission_secure(text, text, text, text, numeric, numeric, text) TO anon;
    GRANT EXECUTE ON FUNCTION public.za_finalize_or_reopen_event_secure(text, text, text, text, text, jsonb) TO anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.za_get_access_context_secure(text, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_manage_coordinator_secure(text, text, text, boolean, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_list_events_secure(text, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_upsert_event_secure(text, text, jsonb) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_enroll_participants_secure(text, text, text, jsonb) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_update_participant_status_secure(text, text, text, text, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_upsert_session_secure(text, text, jsonb, jsonb) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_set_session_status_secure(text, text, text, text, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_reorder_queue_secure(text, text, text, jsonb, integer) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_get_event_workspace_secure(text, text, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_submit_setoran_secure(text, text, jsonb, integer, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_verify_submission_secure(text, text, text, text, numeric, numeric, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.za_finalize_or_reopen_event_secure(text, text, text, text, text, jsonb) TO authenticated;
  END IF;
END;
$$;

COMMIT;
